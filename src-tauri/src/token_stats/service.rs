use super::{
    aggregate::{self, Snapshot},
    reader::{Scanner, Source},
    store, Result, SCHEMA_VERSION,
};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::Duration,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    schema_version: i64,
    generation: String,
    scanning: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    pub queued: bool,
    pub scanning: bool,
    pub generation: String,
}

#[derive(Default)]
struct Runtime {
    root: Option<String>,
    generation: i64,
    scanning: bool,
    error: Option<&'static str>,
    last: Option<Snapshot>,
}

#[derive(Default)]
pub(super) struct Trigger {
    pending: Mutex<bool>,
    wake: Condvar,
    pub stop: AtomicBool,
}

impl Trigger {
    pub fn request(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            *pending = true;
            self.wake.notify_one();
        }
    }
    pub fn wait(&self, timeout: Duration) -> bool {
        let Ok(pending) = self.pending.lock() else {
            return false;
        };
        let Ok((mut pending, _)) = self.wake.wait_timeout_while(pending, timeout, |p| {
            !*p && !self.stop.load(Ordering::Relaxed)
        }) else {
            return false;
        };
        *pending = false;
        !self.stop.load(Ordering::Relaxed)
    }
    pub fn cancel(&self) {
        self.stop.store(true, Ordering::Relaxed);
        self.wake.notify_all();
    }
}

struct Inner {
    path: Option<PathBuf>,
    runtime: Mutex<Runtime>,
    trigger: Trigger,
}

#[derive(Clone)]
pub struct TokenStatisticsService {
    inner: Arc<Inner>,
}

impl TokenStatisticsService {
    pub fn start(path: Option<PathBuf>, notify: impl Fn(Notification) + Send + 'static) -> Self {
        Self::start_source(path, Source::environment(), notify)
    }

    pub(super) fn start_source(
        path: Option<PathBuf>,
        source: Result<Source>,
        notify: impl Fn(Notification) + Send + 'static,
    ) -> Self {
        let inner = Arc::new(Inner {
            path,
            runtime: Mutex::new(Runtime {
                scanning: true,
                ..Runtime::default()
            }),
            trigger: Trigger::default(),
        });
        let service = Self {
            inner: inner.clone(),
        };
        let spawned = std::thread::Builder::new()
            .name("token-statistics".into())
            .spawn(move || {
                let mut scanner = Scanner::new();
                let mut connection = None;
                let mut failures = 0u32;
                loop {
                    if inner.trigger.stop.load(Ordering::Relaxed) {
                        break;
                    }
                    if let Ok(mut state) = inner.runtime.lock() {
                        state.scanning = true;
                    }
                    let result = (|| -> Result<()> {
                        let path = inner.path.as_ref().ok_or("databasePathUnavailable")?;
                        if connection.is_none() {
                            connection = Some(store::open(path)?);
                        }
                        let db = connection.as_mut().ok_or("databaseUnavailable")?;
                        let source = source.as_ref().map_err(Clone::clone)?;
                        let resolved = source.resolve();
                        let root = store::source(
                            db,
                            &source.locator,
                            resolved.as_ref().ok().map(|v| v.1.as_str()),
                        )?;
                        if let Ok(mut state) = inner.runtime.lock() {
                            if state.root != root {
                                state.last = None;
                            }
                            state.root = root;
                            state.generation = store::generation(db)?;
                        }
                        resolved?;
                        scanner.scan(db, source, &inner.trigger.stop, |generation| {
                            if let Ok(mut state) = inner.runtime.lock() {
                                state.generation = generation;
                            }
                            notify(Notification {
                                schema_version: SCHEMA_VERSION,
                                generation: generation.to_string(),
                                scanning: true,
                            });
                        })?;
                        Ok(())
                    })();
                    let failed = result.is_err();
                    let notification = inner.runtime.lock().ok().map(|mut state| {
                        state.scanning = false;
                        state.error = result.err().map(|e| e.0);
                        Notification {
                            schema_version: SCHEMA_VERSION,
                            generation: state.generation.to_string(),
                            scanning: false,
                        }
                    });
                    if let Some(notification) = notification {
                        notify(notification);
                    }
                    let timeout = if failed {
                        failures = failures.saturating_add(1);
                        Duration::from_secs(
                            (15u64.saturating_mul(1u64 << failures.min(5))).min(300),
                        )
                    } else {
                        failures = 0;
                        Duration::from_secs(15)
                    };
                    if !inner.trigger.wait(timeout) {
                        break;
                    }
                }
            });
        if spawned.is_err() {
            if let Ok(mut state) = service.inner.runtime.lock() {
                state.error = Some("workerUnavailable");
                state.scanning = false;
            }
        }
        service
    }

    pub fn refresh(&self) -> RefreshResult {
        self.inner.trigger.request();
        let state = self.inner.runtime.lock().unwrap_or_else(|e| e.into_inner());
        RefreshResult {
            queued: true,
            scanning: state.scanning,
            generation: state.generation.to_string(),
        }
    }

    pub fn stop(&self) {
        self.inner.trigger.cancel();
    }

    pub(super) fn query(&self) -> Snapshot {
        let (root, scanning, error, last) = {
            let state = self.inner.runtime.lock().unwrap_or_else(|e| e.into_inner());
            (
                state.root.clone(),
                state.scanning,
                state.error,
                state.last.clone(),
            )
        };
        let result = (|| -> Result<Snapshot> {
            let (q, zone) = aggregate::system_query()?;
            let mut db =
                store::open_reader(self.inner.path.as_ref().ok_or("databasePathUnavailable")?)?;
            aggregate::query(
                &mut db,
                root.as_deref().ok_or("sourceUnavailable")?,
                q,
                zone,
            )
        })();
        let mut snapshot = match result {
            Ok(snapshot) => snapshot,
            Err(e) => {
                let mut snapshot = last.unwrap_or_else(|| aggregate::unavailable(e.0));
                snapshot.is_stale = snapshot.total.is_some();
                snapshot.quality.warning_codes.push(e.0.into());
                if snapshot.total.is_some() {
                    snapshot.status = "partial".into();
                }
                snapshot
            }
        };
        if let Some(code) = error {
            snapshot.quality.warning_codes.push(code.into());
            let has_committed_result = snapshot.last_success_at.is_some()
                || snapshot.total.as_ref().is_some_and(|v| v.fact_count != "0")
                || snapshot.quality.future_deferred_count != "0"
                || snapshot.quality.pending_count != "0"
                || snapshot.quality.ambiguous_count != "0";
            if snapshot.total.is_some() && has_committed_result {
                snapshot.is_stale = true;
                snapshot.status = "partial".into();
            } else {
                let generation = snapshot.generation;
                snapshot = aggregate::unavailable(code);
                snapshot.generation = generation;
            }
        } else if scanning {
            snapshot.status = "scanning".into();
        }
        snapshot.quality.warning_codes.sort();
        snapshot.quality.warning_codes.dedup();
        if let Ok(mut state) = self.inner.runtime.lock() {
            if state.root == root && snapshot.total.is_some() {
                state.last = Some(snapshot.clone());
            }
        }
        snapshot
    }
}

#[tauri::command]
pub async fn get_token_statistics(
    service: tauri::State<'_, TokenStatisticsService>,
) -> std::result::Result<Snapshot, String> {
    let service = service.inner().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || service.query())
            .await
            .unwrap_or_else(|_| aggregate::unavailable("queryWorkerUnavailable")),
    )
}

#[tauri::command]
pub fn refresh_token_statistics(
    service: tauri::State<'_, TokenStatisticsService>,
) -> RefreshResult {
    service.refresh()
}
