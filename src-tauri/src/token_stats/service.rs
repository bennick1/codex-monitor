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
        Arc, Condvar, Mutex, RwLock,
    },
    time::Duration,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    schema_version: i64,
    source_id: Option<String>,
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
    transactions: RwLock<()>,
    paused: AtomicBool,
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
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
            transactions: RwLock::new(()),
            paused: AtomicBool::new(false),
            worker: Mutex::new(None),
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
                    let transaction = inner.transactions.read().unwrap_or_else(|e| e.into_inner());
                    if inner.paused.load(Ordering::SeqCst) {
                        drop(transaction);
                        if !inner.trigger.wait(Duration::from_secs(15)) {
                            break;
                        }
                        continue;
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
                                source_id: inner.runtime.lock().ok().and_then(|s| s.root.clone()),
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
                            source_id: state.root.clone(),
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
                    drop(transaction);
                    if !inner.trigger.wait(timeout) {
                        break;
                    }
                }
            });
        if let Ok(worker) = spawned {
            *service
                .inner
                .worker
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(worker);
        } else {
            if let Ok(mut state) = service.inner.runtime.lock() {
                state.error = Some("workerUnavailable");
                state.scanning = false;
            }
        }
        service
    }

    /// Called only after an existing successful quota refresh; performs no network IO.
    pub fn record_quota_observation(
        &self,
        weekly: Option<&crate::models::UsageWindow>,
        observed_at: chrono::DateTime<chrono::Utc>,
    ) -> std::result::Result<bool, String> {
        let _transaction = self
            .inner
            .transactions
            .read()
            .unwrap_or_else(|e| e.into_inner());
        if self.inner.paused.load(Ordering::SeqCst) {
            return Ok(false);
        }
        let root = self
            .inner
            .runtime
            .lock()
            .map_err(|_| "statisticsUnavailable".to_string())?
            .root
            .clone();
        // No reliable source identity yet: do not attach an observation to a guessed root.
        let Some(root) = root else { return Ok(false) };
        let result = (|| -> Result<bool> {
            let mut db = store::open(self.inner.path.as_ref().ok_or("databasePathUnavailable")?)?;
            super::turns::observe(&mut db, &root, weekly, observed_at)
        })();
        result.map_err(|e| e.0.to_string())
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

    /// Pause new work and wait until every scan/query/write transaction has finished.
    pub fn pause_and_wait(&self) {
        self.inner.paused.store(true, Ordering::SeqCst);
        let _transaction = self
            .inner
            .transactions
            .write()
            .unwrap_or_else(|e| e.into_inner());
    }

    pub fn resume(&self) {
        self.inner.paused.store(false, Ordering::SeqCst);
        self.inner.trigger.request();
    }

    pub fn stop(&self) {
        self.inner.trigger.cancel();
        let worker = self
            .inner
            .worker
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(worker) = worker {
            let _ = worker.join();
        }
        let _transaction = self
            .inner
            .transactions
            .write()
            .unwrap_or_else(|e| e.into_inner());
    }

    #[cfg(test)]
    pub(super) fn query(&self) -> Snapshot {
        self.query_with_quota(None)
    }

    fn query_with_quota(&self, quota: Option<aggregate::QuotaWindow>) -> Snapshot {
        let _transaction = self
            .inner
            .transactions
            .read()
            .unwrap_or_else(|e| e.into_inner());
        if self.inner.paused.load(Ordering::SeqCst) {
            return aggregate::unavailable("statisticsPaused");
        }
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
            aggregate::query_with_quota(
                &mut db,
                root.as_deref().ok_or("sourceUnavailable")?,
                q,
                zone,
                quota.as_ref(),
            )
        })();
        let mut snapshot = match result {
            Ok(snapshot) => snapshot,
            Err(e) => {
                let mut snapshot = last.unwrap_or_else(|| aggregate::unavailable(e.0));
                if let Some(models) = &mut snapshot.model_statistics {
                    models.periods.quota_period = None;
                }
                snapshot.turn_statistics = None;
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
        snapshot.source_id = root.clone();
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
    quota_window: Option<aggregate::QuotaWindow>,
) -> std::result::Result<Snapshot, String> {
    let service = service.inner().clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || service.query_with_quota(quota_window))
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

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    #[test]
    fn pause_waits_for_transaction_and_failure_can_resume() {
        let service =
            TokenStatisticsService::start_source(None, Err("fixtureUnavailable".into()), |_| {});
        let inner = service.inner.clone();
        let transaction = inner.transactions.read().unwrap();
        let paused = service.clone();
        let (send, receive) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            paused.pause_and_wait();
            send.send(()).unwrap();
        });
        assert!(receive.recv_timeout(Duration::from_millis(30)).is_err());
        drop(transaction);
        receive.recv_timeout(Duration::from_secs(2)).unwrap();
        thread.join().unwrap();
        assert!(service.inner.paused.load(Ordering::SeqCst));
        assert!(!service.refresh().generation.is_empty());
        service.resume();
        assert!(!service.inner.paused.load(Ordering::SeqCst));
        service.stop();
        assert!(service.inner.worker.lock().unwrap().is_none());
        assert!(service.inner.trigger.stop.load(Ordering::Relaxed));
        service.stop();
    }
}
