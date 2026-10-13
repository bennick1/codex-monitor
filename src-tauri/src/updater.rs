use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const ENDPOINT: &str =
    "https://github.com/bennick1/codex-monitor/releases/latest/download/latest.json";
const TEST_PREFIX: &str = "app.codexmonitor.updater-test";
const PUBLIC_KEY: Option<&str> = option_env!("CODEX_MONITOR_UPDATER_PUBLIC_KEY");
pub fn test_build_enabled() -> bool {
    matches!(option_env!("CODEX_MONITOR_UPDATER_TEST_BUILD"), Some("1"))
}
const TEST_ENDPOINT: Option<&str> = option_env!("CODEX_MONITOR_UPDATER_TEST_ENDPOINT");

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub phase: &'static str,
    pub configured: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub error: Option<String>,
    pub error_stage: Option<&'static str>,
    pub checked_at: Option<String>,
}

struct Inner {
    state: UpdateState,
    update: Option<Update>,
    bytes: Option<Arc<Vec<u8>>>,
}

impl Inner {
    fn prepare_check(&mut self, manual: bool) -> bool {
        if self.bytes.is_none() {
            return true;
        }
        if !manual || self.state.phase != "error" || self.state.error_stage != Some("install") {
            return false;
        }
        // A manual retry after installation failed must fetch a fresh candidate.
        self.bytes = None;
        self.update = None;
        self.state.version = None;
        self.state.notes = None;
        self.state.downloaded_bytes = 0;
        self.state.total_bytes = None;
        true
    }

    fn progress(&mut self, bytes: usize, total: Option<u64>) {
        self.state.downloaded_bytes = self.state.downloaded_bytes.saturating_add(bytes as u64);
        self.state.total_bytes = total;
    }
    fn fail(&mut self, stage: &'static str, error: &str) {
        self.state.phase = "error";
        self.state.error = Some(error.into());
        self.state.error_stage = Some(stage);
    }
}

pub struct UpdateService {
    inner: Mutex<Inner>,
    operation: tokio::sync::Mutex<()>,
    endpoint: String,
}

fn endpoint_for(identifier: &str, test: bool, endpoint: Option<&str>) -> Result<String, String> {
    if !test && endpoint.is_none() {
        return Ok(ENDPOINT.into());
    }
    if !test || !(identifier == TEST_PREFIX || identifier.starts_with(&format!("{TEST_PREFIX}."))) {
        return Err("updater test configuration requires an isolated test identifier".into());
    }
    let endpoint = endpoint.ok_or("updater test endpoint missing")?;
    let url = reqwest::Url::parse(endpoint).map_err(|_| "invalid updater test endpoint")?;
    let loopback = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if url.scheme() != "http" || !loopback || !url.username().is_empty() || url.password().is_some()
    {
        return Err("updater test endpoint must be loopback HTTP without credentials".into());
    }
    Ok(endpoint.into())
}

pub fn configure(context: &mut tauri::Context<tauri::Wry>) -> Result<(), String> {
    let endpoint = endpoint_for(
        &context.config().identifier,
        test_build_enabled(),
        TEST_ENDPOINT,
    )?;
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": PUBLIC_KEY.unwrap_or(""),
            "endpoints": [endpoint],
            "dangerousInsecureTransportProtocol": test_build_enabled()
        }),
    );
    Ok(())
}

impl UpdateService {
    fn new(version: String, endpoint: String) -> Self {
        Self {
            inner: Mutex::new(Inner {
                state: UpdateState {
                    phase: "idle",
                    configured: PUBLIC_KEY.is_some_and(|key| !key.trim().is_empty()),
                    current_version: version,
                    version: None,
                    notes: None,
                    downloaded_bytes: 0,
                    total_bytes: None,
                    error: None,
                    error_stage: None,
                    checked_at: None,
                },
                update: None,
                bytes: None,
            }),
            operation: tokio::sync::Mutex::new(()),
            endpoint,
        }
    }
    fn snapshot(&self) -> UpdateState {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .state
            .clone()
    }
    fn change(&self, app: &AppHandle, change: impl FnOnce(&mut Inner)) -> UpdateState {
        let state = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            change(&mut inner);
            inner.state.clone()
        };
        for label in ["widget", "updater"] {
            let _ = app.emit_to(label, "updater-state-changed", &state);
        }
        state
    }
    fn fail(&self, app: &AppHandle, stage: &'static str, error: &str) -> UpdateState {
        self.change(app, |inner| inner.fail(stage, error))
    }
    async fn check(&self, app: &AppHandle, manual: bool) -> Result<UpdateState, String> {
        let Ok(_operation) = self.operation.try_lock() else {
            return Ok(self.snapshot());
        };
        // Background checks and normal ready state retain the verified download.
        if !self
            .inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .prepare_check(manual)
        {
            return Ok(self.snapshot());
        }
        if !self.snapshot().configured {
            return Ok(self.fail(app, "check", "在线更新未配置，请打开版本下载页"));
        }
        self.change(app, |inner| {
            inner.state.phase = "checking";
            inner.state.error = None;
            inner.state.error_stage = None;
        });
        let exit_app = app.clone();
        let endpoint = self
            .endpoint
            .parse()
            .map_err(|_| "invalid updater endpoint")?;
        let updater = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .map_err(|_| "invalid updater endpoint")?
            .timeout(Duration::from_secs(30))
            .version_comparator(|_, _| true)
            .on_before_exit(move || {
                exit_app.cleanup_before_exit();
            })
            .build();
        let result = match updater {
            Ok(updater) => updater.check().await,
            Err(error) => Err(error),
        };
        self.change(app, |inner| {
            inner.state.checked_at = Some(chrono::Utc::now().to_rfc3339())
        });
        match result {
            Ok(Some(mut update)) => {
                // Always resolve the current platform first; a missing platform is
                // an unavailable manifest, even when its version is not newer.
                let current = semver::Version::parse(&update.current_version);
                let remote = semver::Version::parse(&update.version);
                if !matches!((current, remote), (Ok(ref current), Ok(ref remote)) if stable_newer(current, remote))
                {
                    return Ok(self.change(app, |inner| {
                        inner.state.phase = "idle";
                        inner.state.version = None;
                        inner.state.notes = None;
                        inner.state.downloaded_bytes = 0;
                        inner.state.total_bytes = None;
                        inner.update = None;
                    }));
                }
                // Enforce transport for payloads too, including the isolated HTTP fixture.
                let url_ok = if test_build_enabled() {
                    endpoint_for(
                        app.config().identifier.as_str(),
                        true,
                        Some(update.download_url.as_str()),
                    )
                    .is_ok()
                } else {
                    update.download_url.scheme() == "https"
                };
                if !url_ok {
                    return Ok(self.fail(app, "check", "更新下载地址不符合安全要求"));
                }
                update.timeout = Some(Duration::from_secs(300));
                Ok(self.change(app, |inner| {
                    inner.state.phase = "available";
                    inner.state.version = Some(update.version.clone());
                    inner.state.notes = update.body.clone();
                    inner.state.downloaded_bytes = 0;
                    inner.state.total_bytes = None;
                    inner.bytes = None;
                    inner.update = Some(update);
                }))
            }
            Ok(None) => Ok(self.change(app, |inner| {
                inner.state.phase = "idle";
                inner.state.version = None;
                inner.state.notes = None;
                inner.state.downloaded_bytes = 0;
                inner.state.total_bytes = None;
                inner.update = None;
            })),
            Err(error) => Ok(self.fail(app, "check", check_error(&error))),
        }
    }
    async fn download(&self, app: &AppHandle) -> Result<UpdateState, String> {
        let Ok(_operation) = self.operation.try_lock() else {
            return Ok(self.snapshot());
        };
        let update = {
            let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if inner.bytes.is_some() {
                return Ok(inner.state.clone());
            }
            inner.update.clone().ok_or("请先检查更新")?
        };
        self.change(app, |inner| {
            inner.state.phase = "downloading";
            inner.state.error = None;
            inner.state.error_stage = None;
            inner.state.downloaded_bytes = 0;
            inner.state.total_bytes = None;
        });
        let result = update
            .download(
                |bytes, total| {
                    self.change(app, |inner| inner.progress(bytes, total));
                },
                || {},
            )
            .await;
        match result {
            Ok(bytes) => Ok(self.change(app, |inner| {
                inner.bytes = Some(Arc::new(bytes));
                inner.state.phase = "ready";
            })),
            Err(_) => Ok(self.fail(
                app,
                "download",
                "下载或签名校验失败，请重试或打开版本下载页",
            )),
        }
    }
    async fn install(&self, app: &AppHandle) -> Result<UpdateState, String> {
        let Ok(_operation) = self.operation.try_lock() else {
            return Ok(self.snapshot());
        };
        let (update, bytes) = {
            let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            (
                inner.update.clone().ok_or("请先下载更新")?,
                inner.bytes.clone().ok_or("请先下载更新")?,
            )
        };
        self.change(app, |inner| {
            inner.state.phase = "installing";
            inner.state.error = None;
            inner.state.error_stage = None;
        });
        let service = app
            .state::<crate::token_stats::TokenStatisticsService>()
            .inner()
            .clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            crate::begin_update_install();
            service.pause_and_wait();
            let result = update.install(bytes.as_slice());
            if result.is_err() {
                service.resume();
                crate::end_update_install();
            }
            result
        })
        .await;
        match result {
            Ok(Ok(())) => {
                #[cfg(not(target_os = "windows"))]
                app.restart();
                #[cfg(target_os = "windows")]
                {
                    Ok(self.snapshot())
                }
            }
            _ => {
                app.state::<crate::token_stats::TokenStatisticsService>()
                    .resume();
                crate::end_update_install();
                Ok(self.fail(app, "install", "安装失败，可重试或打开版本下载页"))
            }
        }
    }
}

fn stable_newer(current: &semver::Version, remote: &semver::Version) -> bool {
    remote.pre.is_empty() && remote > current
}
fn check_error(error: &tauri_plugin_updater::Error) -> &'static str {
    match error {
        tauri_plugin_updater::Error::TargetNotFound(_) => {
            "当前平台暂无在线更新包，请打开版本下载页"
        }
        tauri_plugin_updater::Error::ReleaseNotFound => "更新清单暂不可用，请重试或打开版本下载页",
        _ => "检查更新失败，请检查网络后重试",
    }
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    let endpoint = endpoint_for(
        &app.config().identifier,
        test_build_enabled(),
        TEST_ENDPOINT,
    )?;
    app.manage(UpdateService::new(
        app.package_info().version.to_string(),
        endpoint,
    ));
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            let enabled =
                crate::preferences_lock(&handle.state::<crate::AppState>()).auto_check_updates;
            if enabled {
                let _ = handle.state::<UpdateService>().check(&handle, false).await;
            }
            tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
        }
    });
    Ok(())
}

pub fn allowed_command(label: &str, command: &str) -> bool {
    label == "widget"
        || (label == "updater"
            && matches!(
                command,
                "get_updater_state"
                    | "check_for_updates"
                    | "download_update"
                    | "install_update"
                    | "open_update_window"
            ))
}

fn trusted_navigation(url: &reqwest::Url, dev_url: Option<&reqwest::Url>) -> bool {
    (matches!(url.scheme(), "tauri" | "http" | "https")
        && matches!(url.host_str(), Some("localhost" | "tauri.localhost"))
        && (url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")))
        || (cfg!(debug_assertions) && dev_url.is_some_and(|dev| url.origin() == dev.origin()))
}

#[tauri::command]
pub fn get_updater_state(service: State<'_, UpdateService>) -> UpdateState {
    service.snapshot()
}
#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    service: State<'_, UpdateService>,
) -> Result<UpdateState, String> {
    service.check(&app, true).await
}
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    service: State<'_, UpdateService>,
) -> Result<UpdateState, String> {
    service.download(&app).await
}
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    service: State<'_, UpdateService>,
) -> Result<UpdateState, String> {
    service.install(&app).await
}
#[tauri::command]
pub async fn open_update_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("updater") {
        window.show().map_err(|_| "无法显示更新窗口")?;
        window.set_focus().map_err(|_| "无法聚焦更新窗口")?;
        request_check(app);
        return Ok(());
    }
    let prefs = crate::preferences_lock(&app.state::<crate::AppState>()).clone();
    let url = format!(
        "index.html?updates=1&language={}&appearance={}",
        prefs.language, prefs.appearance
    );
    let dev_url = app.config().build.dev_url.clone();
    WebviewWindowBuilder::new(&app, "updater", WebviewUrl::App(url.into()))
        .on_navigation(move |url| trusted_navigation(url, dev_url.as_ref()))
        .title("Codex Monitor · 更新")
        .inner_size(520.0, 520.0)
        .min_inner_size(400.0, 400.0)
        .center()
        .resizable(true)
        .focused(true)
        .build()
        .map_err(|_| "无法创建更新窗口")?;
    request_check(app);
    Ok(())
}

fn request_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let _ = app.state::<UpdateService>().check(&app, true).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn updater_commands_and_navigation_are_restricted() {
        assert!(allowed_command("widget", "get_preferences"));
        assert!(allowed_command("updater", "install_update"));
        assert!(!allowed_command("updater", "get_preferences"));
        assert!(!allowed_command("deepseek-login", "install_update"));
        assert!(!trusted_navigation(
            &reqwest::Url::parse("https://example.com").unwrap(),
            None
        ));
        assert!(trusted_navigation(
            &reqwest::Url::parse("tauri://localhost/index.html").unwrap(),
            None
        ));
    }
    #[test]
    fn test_endpoint_isolated_and_loopback_only() {
        assert_eq!(
            endpoint_for("app.quotafloat.desktop", false, None).unwrap(),
            ENDPOINT
        );
        for id in [
            "app.quotafloat.desktop",
            "app.codexmonitor.updater-test-evil",
        ] {
            assert!(endpoint_for(id, true, Some("http://127.0.0.1/latest.json")).is_err());
        }
        assert!(endpoint_for(TEST_PREFIX, false, Some("http://127.0.0.1/latest.json")).is_err());
        for url in [
            "http://example.com/update",
            "https://localhost/update",
            "http://user@localhost/update",
        ] {
            assert!(endpoint_for(TEST_PREFIX, true, Some(url)).is_err());
        }
        assert!(endpoint_for(TEST_PREFIX, true, Some("http://127.0.0.1:8080/latest.json")).is_ok());
    }
    #[test]
    fn stable_versions_only_and_strictly_newer() {
        let current = semver::Version::parse("1.2.1").unwrap();
        for value in ["1.2.0", "1.2.1", "1.3.0-beta.1"] {
            assert!(!stable_newer(
                &current,
                &semver::Version::parse(value).unwrap()
            ));
        }
        assert!(stable_newer(
            &current,
            &semver::Version::parse("1.2.2").unwrap()
        ));
    }
    #[test]
    fn unavailable_manifest_and_missing_platform_are_errors() {
        let release: tauri_plugin_updater::RemoteRelease =
            serde_json::from_value(serde_json::json!({"version":"1.2.1", "platforms":{}})).unwrap();
        assert!(matches!(
            release.download_url("darwin-aarch64"),
            Err(tauri_plugin_updater::Error::TargetNotFound(_))
        ));
        assert_ne!(
            check_error(&tauri_plugin_updater::Error::ReleaseNotFound),
            ""
        );
        assert!(
            check_error(&tauri_plugin_updater::Error::TargetNotFound("test".into()))
                .contains("平台")
        );
    }
    #[test]
    fn progress_and_install_failure_keep_verified_download_for_retry() {
        let service = UpdateService::new("1.2.1".into(), ENDPOINT.into());
        let mut inner = service.inner.lock().unwrap();
        inner.progress(10, None);
        inner.progress(20, Some(30));
        assert_eq!(inner.state.downloaded_bytes, 30);
        assert_eq!(inner.state.total_bytes, Some(30));
        inner.bytes = Some(Arc::new(vec![1, 2, 3]));
        inner.fail("install", "fixture failure");
        assert_eq!(inner.state.phase, "error");
        assert_eq!(inner.state.error_stage, Some("install"));
        assert_eq!(inner.bytes.as_ref().unwrap().as_slice(), &[1, 2, 3]);
    }
    #[test]
    fn manual_check_after_install_failure_discards_cache_and_can_recheck() {
        let service = UpdateService::new("1.2.1".into(), ENDPOINT.into());
        let mut inner = service.inner.lock().unwrap();
        inner.bytes = Some(Arc::new(vec![1, 2, 3]));
        inner.state.version = Some("1.2.2".into());
        inner.state.notes = Some("failed candidate".into());
        inner.progress(3, Some(3));
        inner.fail("install", "fixture failure");
        assert!(inner.prepare_check(true));
        assert!(inner.bytes.is_none());
        assert!(inner.update.is_none());
        assert!(inner.state.version.is_none());
        assert!(inner.state.notes.is_none());
        assert_eq!(inner.state.downloaded_bytes, 0);
        assert_eq!(inner.state.total_bytes, None);
    }
    #[test]
    fn background_checks_preserve_ready_and_install_failure_cache() {
        let service = UpdateService::new("1.2.1".into(), ENDPOINT.into());
        let mut inner = service.inner.lock().unwrap();
        let bytes = Arc::new(vec![1, 2, 3]);
        inner.bytes = Some(bytes.clone());
        inner.state.phase = "ready";
        assert!(!inner.prepare_check(false));
        assert!(!inner.prepare_check(true));
        assert!(Arc::ptr_eq(inner.bytes.as_ref().unwrap(), &bytes));
        assert_eq!(inner.state.phase, "ready");
        inner.fail("install", "fixture failure");
        assert!(!inner.prepare_check(false));
        assert!(Arc::ptr_eq(inner.bytes.as_ref().unwrap(), &bytes));
        assert_eq!(inner.state.error_stage, Some("install"));
    }
    #[test]
    fn single_operation_and_state_survive_window_lifetime() {
        let service = UpdateService::new("1.2.1".into(), ENDPOINT.into());
        let guard = service.operation.try_lock().unwrap();
        assert!(service.operation.try_lock().is_err());
        service.inner.lock().unwrap().state.phase = "ready";
        assert_eq!(service.snapshot().phase, "ready");
        drop(guard);
        assert!(service.operation.try_lock().is_ok());
    }
}
