//! One in-process scheduler owns online quota freshness for every display mode.
//! No credential, identity digest, quota response or last-value cache is written
//! to disk. Local Token Statistics remains a separate service.
use std::{
    future::Future,
    io::Read,
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

use chrono::{DateTime, Utc};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{watch, Mutex as AsyncMutex};

use crate::{
    codex::{self, SessionScope},
    models::{ProviderSnapshot, UsageWindow},
    AppState,
};

const NORMAL_INTERVAL: Duration = Duration::from_secs(5 * 60);
const FAST_INTERVAL: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(30 * 60);
const IDENTITY_CHECK_INTERVAL: Duration = Duration::from_secs(5);
const STALE_LIFETIME: chrono::Duration = chrono::Duration::minutes(30);
const MANUAL_COALESCE: Duration = Duration::from_millis(750);

struct Inner {
    scope: Option<SessionScope>,
    generation: u64,
    completed_revision: u64,
    completed_generation: u64,
    last_completed: Option<Instant>,
    values: Vec<ProviderSnapshot>,
    failures: u32,
    next_due: DateTime<Utc>,
}

struct Core {
    inner: Mutex<Inner>,
    operation: AsyncMutex<()>,
    shutdown: watch::Sender<bool>,
    normal_interval: Duration,
}

pub(crate) struct QuotaService {
    core: Arc<Core>,
}

struct RefreshResult {
    values: Vec<ProviderSnapshot>,
    successful: bool,
}

fn valid_window(window: &UsageWindow) -> bool {
    window.remaining_percent.is_finite() && (0.0..=100.0).contains(&window.remaining_percent)
}

fn has_values(snapshot: &ProviderSnapshot) -> bool {
    snapshot.short_window.as_ref().is_some_and(valid_window)
        || snapshot.weekly_window.as_ref().is_some_and(valid_window)
}

fn valid_snapshot(snapshot: &ProviderSnapshot) -> bool {
    has_values(snapshot)
        && snapshot.short_window.as_ref().is_none_or(valid_window)
        && snapshot.weekly_window.as_ref().is_none_or(valid_window)
}

fn merge(previous: Option<&ProviderSnapshot>, mut next: ProviderSnapshot) -> ProviderSnapshot {
    if next.status == "ok" && !valid_snapshot(&next) {
        next = ProviderSnapshot {
            account_generation: next.account_generation,
            ..ProviderSnapshot::failure(
                "unavailable",
                "Quota response does not contain valid usage windows.",
            )
        };
    }
    if matches!(next.status.as_str(), "ok" | "signed_out" | "loading") {
        return next;
    }
    if let Some(previous) = previous.filter(|value| {
        value.provider == next.provider
            && value.account_generation == next.account_generation
            && matches!(value.status.as_str(), "ok" | "stale")
            && has_values(value)
    }) {
        return ProviderSnapshot {
            status: "stale".into(),
            message: next.message,
            ..previous.clone()
        };
    }
    next
}

fn next_delay(
    values: &[ProviderSnapshot],
    failures: u32,
    now: DateTime<Utc>,
    normal_interval: Duration,
) -> Duration {
    let mut delay = if failures == 0 {
        normal_interval
    } else {
        Duration::from_secs(30 * 2_u64.saturating_pow(failures.saturating_sub(1).min(6)))
            .min(MAX_BACKOFF)
    };
    for value in values {
        if value.status == "ok" {
            for window in [&value.short_window, &value.weekly_window]
                .into_iter()
                .flatten()
            {
                let Some(reset) = window
                    .resets_at
                    .as_deref()
                    .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                else {
                    continue;
                };
                let remaining = reset.signed_duration_since(now);
                if remaining > chrono::Duration::minutes(-5)
                    && remaining <= chrono::Duration::minutes(15)
                {
                    delay = delay.min(FAST_INTERVAL);
                }
                // Request fresh server data when reset is reached. Never set
                // the old percentage to 100 or request repeatedly for a past reset.
                if let Ok(until_reset) = remaining.to_std() {
                    if !until_reset.is_zero() {
                        delay = delay.min(until_reset);
                    }
                }
            }
        } else if value.status == "stale" {
            if let Ok(success) = DateTime::parse_from_rfc3339(&value.updated_at) {
                if let Ok(until_expired) = (success + STALE_LIFETIME)
                    .signed_duration_since(now)
                    .to_std()
                {
                    if !until_expired.is_zero() {
                        delay = delay.min(until_expired);
                    }
                }
            }
        }
    }
    delay.max(Duration::from_secs(1))
}

impl Core {
    fn new(normal_interval: Duration) -> Self {
        let (shutdown, _) = watch::channel(false);
        Self {
            inner: Mutex::new(Inner {
                scope: None,
                generation: 0,
                completed_revision: 0,
                completed_generation: 0,
                last_completed: None,
                values: Vec::new(),
                failures: 0,
                next_due: Utc::now(),
            }),
            operation: AsyncMutex::new(()),
            shutdown,
            normal_interval,
        }
    }

    fn inner(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn stopped(&self) -> bool {
        *self.shutdown.borrow()
    }

    fn stop(&self) {
        self.shutdown.send_replace(true);
    }

    async fn cancelled(&self) {
        let mut receiver = self.shutdown.subscribe();
        if *receiver.borrow() {
            return;
        }
        let _ = receiver.changed().await;
    }

    fn align_scope(&self, scope: &SessionScope) -> Option<Vec<ProviderSnapshot>> {
        let mut inner = self.inner();
        if inner.scope.as_ref() == Some(scope) {
            return None;
        }
        inner.scope = Some(scope.clone());
        inner.generation = inner.generation.saturating_add(1);
        inner.failures = 0;
        inner.last_completed = None;
        inner.next_due = Utc::now();
        let mut initial = if *scope == SessionScope::SignedOut {
            ProviderSnapshot::failure("signed_out", "Please sign in to Codex Desktop first.")
        } else {
            ProviderSnapshot::failure("loading", "Loading quota.")
        };
        initial.account_generation = Some(inner.generation);
        inner.values = vec![initial];
        Some(inner.values.clone())
    }

    fn cached(&self) -> Vec<ProviderSnapshot> {
        self.inner().values.clone()
    }

    async fn refresh_with<C, F, Fut, P>(
        &self,
        force: bool,
        read_scope: C,
        fetch: F,
        publish: P,
    ) -> Result<RefreshResult, String>
    where
        C: Fn() -> SessionScope,
        F: FnOnce(SessionScope) -> Fut,
        Fut: Future<Output = ProviderSnapshot>,
        P: Fn(&[ProviderSnapshot]),
    {
        if self.stopped() {
            return Err("quota service stopped".into());
        }
        if let Some(values) = self.align_scope(&read_scope()) {
            publish(&values);
        }
        let revision = self.inner().completed_revision;
        let _guard = tokio::select! {
            guard = self.operation.lock() => guard,
            _ = self.cancelled() => return Err("quota service stopped".into()),
        };
        if self.stopped() {
            return Err("quota service stopped".into());
        }
        let scope = read_scope();
        if let Some(values) = self.align_scope(&scope) {
            publish(&values);
        }
        {
            let inner = self.inner();
            let already_completed = inner.completed_generation == inner.generation
                && inner.completed_revision > revision;
            let recent = inner
                .last_completed
                .is_some_and(|at| at.elapsed() < MANUAL_COALESCE);
            if already_completed || recent || (!force && Utc::now() < inner.next_due) {
                return Ok(RefreshResult {
                    values: inner.values.clone(),
                    successful: false,
                });
            }
        }
        let generation = self.inner().generation;
        let snapshot = tokio::select! {
            value = fetch(scope.clone()) => value,
            _ = self.cancelled() => return Err("quota service stopped".into()),
        };
        if self.stopped() {
            return Err("quota service stopped".into());
        }
        let after = read_scope();
        if after != scope {
            if let Some(values) = self.align_scope(&after) {
                publish(&values);
            }
            return Ok(RefreshResult {
                values: self.cached(),
                successful: false,
            });
        }
        let successful = snapshot.status == "ok" && valid_snapshot(&snapshot);
        let values = {
            let mut inner = self.inner();
            // Another caller may already have observed an account transition
            // while this request was running, including an A -> B -> A switch.
            if inner.scope.as_ref() != Some(&scope) || inner.generation != generation {
                return Ok(RefreshResult {
                    values: inner.values.clone(),
                    successful: false,
                });
            }
            let mut snapshot = snapshot;
            snapshot.account_generation = Some(inner.generation);
            let snapshot = merge(inner.values.first(), snapshot);
            inner.failures = if successful {
                0
            } else {
                inner.failures.saturating_add(1)
            };
            inner.values = vec![snapshot];
            inner.completed_revision = inner.completed_revision.saturating_add(1);
            inner.completed_generation = inner.generation;
            inner.last_completed = Some(Instant::now());
            inner.next_due = Utc::now()
                + chrono::Duration::from_std(next_delay(
                    &inner.values,
                    inner.failures,
                    Utc::now(),
                    self.normal_interval,
                ))
                .unwrap_or(chrono::Duration::minutes(5));
            inner.values.clone()
        };
        publish(&values);
        Ok(RefreshResult { values, successful })
    }
}

fn synthetic_enabled() -> bool {
    (cfg!(debug_assertions) || crate::updater::test_build_enabled())
        && std::env::var("CODEX_MONITOR_SYNTHETIC_QUOTA").as_deref() == Ok("1")
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct SyntheticFixture {
    scenario: String,
    remaining: Option<f64>,
    window_seconds: Option<u64>,
    account: Option<u64>,
    reset_in_seconds: Option<i64>,
}

fn read_fixture(home: &Path) -> Result<Option<SyntheticFixture>, ()> {
    let path = home.join("quota-fixture.json");
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    if !metadata.is_file() || metadata.len() > 4096 {
        return Err(());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| ())?
        .take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.len() > 4096 {
        return Err(());
    }
    let fixture: SyntheticFixture = serde_json::from_slice(&bytes).map_err(|_| ())?;
    if !matches!(
        fixture.scenario.as_str(),
        "" | "weekly" | "short" | "dual" | "unavailable" | "signed_out" | "loading"
    ) {
        return Err(());
    }
    if fixture
        .remaining
        .is_some_and(|value| !value.is_finite() || !(0.0..=100.0).contains(&value))
    {
        return Err(());
    }
    Ok(Some(fixture))
}

fn synthetic_fixture() -> Result<Option<SyntheticFixture>, ()> {
    if cfg!(debug_assertions) && synthetic_enabled() {
        if let Some(home) = std::env::var_os("CODEX_HOME") {
            return read_fixture(Path::new(&home));
        }
    }
    Ok(None)
}

fn current_scope() -> SessionScope {
    if synthetic_enabled() {
        let fixture = synthetic_fixture().ok().flatten().unwrap_or_default();
        if fixture.scenario == "signed_out" {
            SessionScope::SignedOut
        } else {
            SessionScope::Synthetic(fixture.account.unwrap_or(1))
        }
    } else {
        codex::session_scope()
    }
}

fn apply_fixture(mut snapshot: ProviderSnapshot, fixture: &SyntheticFixture) -> ProviderSnapshot {
    match fixture.scenario.as_str() {
        "unavailable" => {
            return ProviderSnapshot::failure(
                "unavailable",
                "Network unavailable. It will retry automatically.",
            )
        }
        "signed_out" => {
            return ProviderSnapshot::failure(
                "signed_out",
                "Please sign in to Codex Desktop first.",
            )
        }
        "loading" => return ProviderSnapshot::failure("loading", "Loading quota."),
        _ => {}
    }
    let remaining = fixture.remaining.unwrap_or(64.25);
    let reset = fixture.reset_in_seconds.map(|seconds| {
        (Utc::now() + chrono::Duration::seconds(seconds.clamp(-86400, 604800))).to_rfc3339()
    });
    let make_window = |seconds| UsageWindow {
        remaining_percent: remaining,
        resets_at: reset.clone().or_else(|| {
            snapshot
                .weekly_window
                .as_ref()
                .and_then(|window| window.resets_at.clone())
        }),
        window_seconds: seconds,
    };
    let short = match fixture.scenario.as_str() {
        "short" | "dual" => Some(make_window(fixture.window_seconds.unwrap_or(7200))),
        _ => None,
    };
    let weekly = if fixture.scenario == "short" {
        None
    } else {
        Some(make_window(if fixture.scenario == "dual" {
            604800
        } else {
            fixture.window_seconds.unwrap_or(604800)
        }))
    };
    snapshot.short_window = short;
    snapshot.weekly_window = weekly;
    snapshot
}

fn normal_interval() -> Duration {
    // Shortening the interval is restricted to an existing isolated debug
    // fixture run. Production and real-account validation retain normal cadence.
    if cfg!(debug_assertions) && synthetic_enabled() {
        if let Ok(seconds) = std::env::var("CODEX_MONITOR_QUOTA_INTERVAL_SECONDS") {
            if let Ok(seconds) = seconds.parse::<u64>() {
                return Duration::from_secs(seconds.clamp(5, 300));
            }
        }
    }
    NORMAL_INTERVAL
}

fn publish(app: &AppHandle, values: &[ProviderSnapshot]) {
    crate::menubar::update_tray(app, values);
    let _ = app.emit_to("widget", "snapshots-updated", values);
}

pub(crate) async fn refresh(app: &AppHandle, force: bool) -> Result<Vec<ProviderSnapshot>, String> {
    let service = app
        .try_state::<QuotaService>()
        .ok_or("quota service unavailable")?;
    let state = app.state::<AppState>();
    let outcome = service
        .core
        .refresh_with(
            force,
            current_scope,
            |scope| async move {
                if synthetic_enabled() {
                    let snapshot = crate::fetch_provider_snapshot(&state.client).await;
                    if let Some(fixture) = match synthetic_fixture() {
                        Ok(value) => value,
                        Err(()) => {
                            return ProviderSnapshot::failure(
                                "unavailable",
                                "Synthetic quota fixture is invalid.",
                            )
                        }
                    } {
                        return apply_fixture(snapshot, &fixture);
                    }
                    let values = crate::apply_short_window_test_override(&state, vec![snapshot]);
                    values.into_iter().next().unwrap_or_else(|| {
                        ProviderSnapshot::failure(
                            "unavailable",
                            "Quota is temporarily unavailable.",
                        )
                    })
                } else {
                    codex::fetch_snapshot_for_scope(&state.client, &scope).await
                }
            },
            |values| publish(app, values),
        )
        .await?;
    if outcome.successful {
        let service = app.state::<crate::token_stats::TokenStatisticsService>();
        crate::persist_quota_observations(&service, &outcome.values).await;
        if cfg!(debug_assertions) && synthetic_enabled() {
            // A content-free marker makes native hidden-window scheduling
            // observable in the isolated QA process without logging responses.
            eprintln!("quota scheduler: refresh completed");
        }
    }
    // A settings/menu request can observe a new login while the observation
    // write awaits. Reply with the current epoch instead of a late old snapshot.
    Ok(service.core.cached())
}

pub(crate) fn cached(app: &AppHandle) -> Vec<ProviderSnapshot> {
    app.try_state::<QuotaService>()
        .map(|value| value.core.cached())
        .unwrap_or_default()
}

async fn run_scheduler<F, Fut>(core: &Core, interval: Duration, mut refresh: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = ()>,
{
    loop {
        if core.stopped() {
            break;
        }
        refresh().await;
        tokio::select! {
            _ = core.cancelled() => break,
            _ = tokio::time::sleep(interval) => {},
        }
    }
}

pub(crate) fn start(app: &AppHandle) {
    if app.try_state::<QuotaService>().is_some() {
        return;
    }
    let core = Arc::new(Core::new(normal_interval()));
    if !app.manage(QuotaService { core: core.clone() }) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_scheduler(&core, IDENTITY_CHECK_INTERVAL, || async {
            let _ = refresh(&app, false).await;
        })
        .await;
    });
}

pub(crate) fn stop(app: &AppHandle) {
    if let Some(service) = app.try_state::<QuotaService>() {
        service.core.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn scope(value: u8) -> SessionScope {
        SessionScope::Authenticated([value; 32])
    }
    fn snapshot(weekly: bool) -> ProviderSnapshot {
        let window = UsageWindow {
            remaining_percent: 42.75,
            resets_at: Some("2030-07-10T00:00:00Z".into()),
            window_seconds: if weekly { 604800 } else { 7200 },
        };
        ProviderSnapshot {
            account_generation: Some(1),
            provider: "codex".into(),
            display_name: "CODEX".into(),
            plan: None,
            short_window: if weekly { None } else { Some(window.clone()) },
            weekly_window: if weekly { Some(window) } else { None },
            reset_credits: None,
            reset_credit_expires_at: vec![],
            updated_at: "2030-07-07T00:00:00Z".into(),
            status: "ok".into(),
            message: None,
        }
    }
    fn failure(generation: u64) -> ProviderSnapshot {
        let mut value = ProviderSnapshot::failure("unavailable", "Network unavailable.");
        value.account_generation = Some(generation);
        value
    }
    fn allow_next(core: &Core) {
        let mut inner = core.inner();
        inner.last_completed = None;
        inner.next_due = Utc::now() - chrono::Duration::seconds(1);
    }

    #[test]
    fn weekly_only_and_short_only_keep_last_success_not_failure_time() {
        for weekly in [true, false] {
            let good = snapshot(weekly);
            let stale = merge(Some(&good), failure(1));
            assert_eq!(stale.status, "stale");
            assert_eq!(stale.updated_at, good.updated_at);
            assert_eq!(stale.short_window.is_some(), !weekly);
            assert_eq!(stale.weekly_window.is_some(), weekly);
            let again = merge(Some(&stale), failure(1));
            assert_eq!(again.updated_at, good.updated_at);
            assert_eq!(merge(Some(&again), good).status, "ok");
        }
    }

    #[test]
    fn errors_do_not_borrow_a_different_account_or_mask_logout() {
        let good = snapshot(true);
        assert_eq!(merge(Some(&good), failure(2)).status, "unavailable");
        let logout = ProviderSnapshot::failure("signed_out", "Please sign in.");
        assert!(merge(Some(&good), logout).weekly_window.is_none());
        let loading = ProviderSnapshot::failure("loading", "Loading quota.");
        assert!(merge(Some(&good), loading).weekly_window.is_none());
    }

    #[test]
    fn absent_and_invalid_windows_do_not_become_zero_or_full() {
        let mut next = snapshot(true);
        next.weekly_window.as_mut().unwrap().remaining_percent = f64::NAN;
        assert_eq!(merge(None, next).status, "unavailable");
        let mut empty = snapshot(true);
        empty.weekly_window = None;
        assert_eq!(merge(None, empty).status, "unavailable");
        for percent in [0.0, 0.5, 100.0] {
            let mut value = snapshot(true);
            value.weekly_window.as_mut().unwrap().remaining_percent = percent;
            assert_eq!(
                merge(None, value).weekly_window.unwrap().remaining_percent,
                percent
            );
        }
    }

    #[test]
    fn scheduler_cadence_reset_and_backoff_keep_existing_bounds() {
        let now = DateTime::parse_from_rfc3339("2030-07-07T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut value = snapshot(true);
        assert_eq!(
            next_delay(&[value.clone()], 0, now, NORMAL_INTERVAL),
            NORMAL_INTERVAL
        );
        value.weekly_window.as_mut().unwrap().resets_at =
            Some((now + chrono::Duration::seconds(17)).to_rfc3339());
        assert_eq!(
            next_delay(&[value.clone()], 0, now, NORMAL_INTERVAL),
            Duration::from_secs(17)
        );
        assert_eq!(
            next_delay(
                &[value.clone()],
                0,
                now + chrono::Duration::seconds(17),
                NORMAL_INTERVAL
            ),
            FAST_INTERVAL
        );
        value.status = "stale".into();
        assert_eq!(
            next_delay(&[value.clone()], 1, now, NORMAL_INTERVAL),
            Duration::from_secs(30)
        );
        assert_eq!(
            next_delay(&[value.clone()], 2, now, NORMAL_INTERVAL),
            Duration::from_secs(60)
        );
        assert_eq!(
            next_delay(&[value.clone()], 30, now, NORMAL_INTERVAL),
            MAX_BACKOFF
        );
        assert_eq!(
            next_delay(
                &[value],
                30,
                now + chrono::Duration::minutes(29),
                NORMAL_INTERVAL
            ),
            Duration::from_secs(60)
        );
    }

    #[tokio::test]
    async fn overlapping_manual_and_automatic_requests_share_one_fetch() {
        let core = Core::new(NORMAL_INTERVAL);
        let count = AtomicUsize::new(0);
        let request = |force| {
            core.refresh_with(
                force,
                || scope(1),
                |_| async {
                    count.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    snapshot(true)
                },
                |_| {},
            )
        };
        let (a, b, c) = tokio::join!(request(false), request(true), request(true));
        for result in [a, b, c] {
            assert_eq!(result.unwrap().values[0].status, "ok");
        }
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let result = request(false).await.unwrap();
        assert!(!result.successful);
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn failed_request_recovers_and_account_changes_clear_cached_values() {
        let core = Core::new(NORMAL_INTERVAL);
        core.refresh_with(true, || scope(1), |_| async { snapshot(true) }, |_| {})
            .await
            .unwrap();
        allow_next(&core);
        let stale = core
            .refresh_with(true, || scope(1), |_| async { failure(1) }, |_| {})
            .await
            .unwrap();
        assert_eq!(stale.values[0].status, "stale");
        assert_eq!(stale.values[0].updated_at, "2030-07-07T00:00:00Z");
        allow_next(&core);
        assert_eq!(
            core.refresh_with(true, || scope(1), |_| async { snapshot(true) }, |_| {})
                .await
                .unwrap()
                .values[0]
                .status,
            "ok"
        );
        let changed = core
            .refresh_with(true, || scope(2), |_| async { failure(2) }, |_| {})
            .await
            .unwrap();
        assert_eq!(changed.values[0].account_generation, Some(2));
        assert_eq!(changed.values[0].status, "unavailable");
        assert!(changed.values[0].weekly_window.is_none());
        let logout = core
            .refresh_with(
                true,
                || SessionScope::SignedOut,
                |_| async { ProviderSnapshot::failure("signed_out", "Please sign in.") },
                |_| {},
            )
            .await
            .unwrap();
        assert_eq!(logout.values[0].account_generation, Some(3));
        assert!(logout.values[0].weekly_window.is_none());
    }

    #[tokio::test]
    async fn account_changed_during_request_cannot_publish_old_result() {
        let core = Core::new(NORMAL_INTERVAL);
        let account = AtomicUsize::new(1);
        let result = core
            .refresh_with(
                true,
                || scope(account.load(Ordering::SeqCst) as u8),
                |_| async {
                    account.store(2, Ordering::SeqCst);
                    snapshot(true)
                },
                |_| {},
            )
            .await
            .unwrap();
        assert_eq!(result.values[0].status, "loading");
        assert_eq!(result.values[0].account_generation, Some(2));
        assert!(result.values[0].weekly_window.is_none());
        assert!(!result.successful);
    }

    #[tokio::test]
    async fn scheduler_runs_without_a_view_and_stops_inflight_work() {
        let core = Core::new(Duration::from_millis(2));
        let count = AtomicUsize::new(0);
        let completed = tokio::sync::Notify::new();
        let scheduler = run_scheduler(&core, Duration::from_millis(5), || async {
            // Ignore the user-click coalescing interval in this fast clock test.
            core.inner().last_completed = None;
            let _ = core
                .refresh_with(
                    false,
                    || scope(1),
                    |_| async {
                        count.fetch_add(1, Ordering::SeqCst);
                        completed.notify_one();
                        snapshot(true)
                    },
                    |_| {},
                )
                .await;
        });
        let stop = async {
            completed.notified().await;
            allow_next(&core);
            completed.notified().await;
            core.stop();
        };
        tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(scheduler, stop);
        })
        .await
        .unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 2);
        assert!(core
            .refresh_with(
                true,
                || scope(1),
                |_| async { panic!("stopped service fetched") },
                |_| {}
            )
            .await
            .is_err());

        let core = Core::new(NORMAL_INTERVAL);
        let request = core.refresh_with(
            true,
            || scope(1),
            |_| async {
                tokio::time::sleep(Duration::from_secs(5)).await;
                snapshot(true)
            },
            |_| {},
        );
        let stop = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            core.stop();
        };
        let (result, _) = tokio::join!(request, stop);
        assert!(result.is_err());
        assert_eq!(core.cached()[0].status, "loading");
    }
    #[test]
    fn native_fixture_reads_only_bounded_explicit_synthetic_fields() {
        let home = tempfile::tempdir().unwrap();
        assert!(read_fixture(home.path()).unwrap().is_none());
        let path = home.path().join("quota-fixture.json");
        std::fs::write(
            &path,
            r#"{"scenario":"short","remaining":0.4,"windowSeconds":7200,"account":2}"#,
        )
        .unwrap();
        let fixture = read_fixture(home.path()).unwrap().unwrap();
        let value = apply_fixture(snapshot(true), &fixture);
        assert_eq!(value.short_window.unwrap().remaining_percent, 0.4);
        assert!(value.weekly_window.is_none());
        for invalid in [
            r#"{"scenario":"unknown"}"#.to_string(),
            r#"{"scenario":"weekly","token":"not-a-credential"}"#.to_string(),
            r#"{"scenario":"weekly","remaining":101}"#.to_string(),
            " ".repeat(4097),
        ] {
            std::fs::write(&path, invalid).unwrap();
            assert!(read_fixture(home.path()).is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn native_fixture_refuses_links_outside_the_isolated_home() {
        let home = tempfile::tempdir().unwrap();
        let source = tempfile::NamedTempFile::new().unwrap();
        std::os::unix::fs::symlink(source.path(), home.path().join("quota-fixture.json")).unwrap();
        assert!(read_fixture(home.path()).is_err());
    }

    #[tokio::test]
    async fn a_b_a_switch_during_an_inflight_request_still_discards_the_old_result() {
        let core = Core::new(NORMAL_INTERVAL);
        let started = tokio::sync::Notify::new();
        let saw_b = tokio::sync::Notify::new();
        let saw_a_again = tokio::sync::Notify::new();
        let account = AtomicUsize::new(1);
        let old = core.refresh_with(
            true,
            || scope(account.load(Ordering::SeqCst) as u8),
            |_| async {
                started.notify_one();
                saw_a_again.notified().await;
                snapshot(true)
            },
            |_| {},
        );
        let b = async {
            started.notified().await;
            account.store(2, Ordering::SeqCst);
            core.refresh_with(
                true,
                || {
                    let scope = scope(account.load(Ordering::SeqCst) as u8);
                    saw_b.notify_one();
                    scope
                },
                |_| async { snapshot(false) },
                |_| {},
            )
            .await
        };
        let a = async {
            saw_b.notified().await;
            account.store(1, Ordering::SeqCst);
            core.refresh_with(
                true,
                || {
                    let scope = scope(account.load(Ordering::SeqCst) as u8);
                    saw_a_again.notify_one();
                    scope
                },
                |_| async { snapshot(false) },
                |_| {},
            )
            .await
        };
        let (old, b, a) = tokio::join!(old, b, a);
        let old = old.unwrap();
        assert!(!old.successful);
        assert_eq!(old.values[0].status, "loading");
        assert_eq!(old.values[0].account_generation, Some(3));
        assert!(old.values[0].weekly_window.is_none());
        assert_eq!(b.unwrap().values[0].account_generation, Some(3));
        assert_eq!(a.unwrap().values[0].account_generation, Some(3));
    }
}
