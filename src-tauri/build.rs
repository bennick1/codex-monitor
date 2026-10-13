fn main() {
    for key in [
        "CODEX_MONITOR_UPDATER_PUBLIC_KEY",
        "CODEX_MONITOR_RELEASE_BUILD",
        "CODEX_MONITOR_UPDATER_TEST_BUILD",
        "CODEX_MONITOR_UPDATER_TEST_ENDPOINT",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    let release = std::env::var("CODEX_MONITOR_RELEASE_BUILD").as_deref() == Ok("1");
    let test = std::env::var("CODEX_MONITOR_UPDATER_TEST_BUILD").as_deref() == Ok("1");
    let endpoint = std::env::var("CODEX_MONITOR_UPDATER_TEST_ENDPOINT").ok();
    let key = std::env::var("CODEX_MONITOR_UPDATER_PUBLIC_KEY").unwrap_or_default();
    assert!(
        !release || !key.trim().is_empty(),
        "release requires updater public key"
    );
    assert!(
        !release || (!test && endpoint.is_none()),
        "release cannot use updater test configuration"
    );
    assert!(
        endpoint.is_none() || test,
        "test endpoint requires explicit test build"
    );
    if test {
        let mut config: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string("tauri.conf.json").expect("read tauri config"),
        )
        .expect("parse tauri config");
        if let Ok(overrides) = std::env::var("TAURI_CONFIG") {
            let overrides: serde_json::Value =
                serde_json::from_str(&overrides).expect("parse Tauri configuration override");
            if let Some(identifier) = overrides.get("identifier") {
                config["identifier"] = identifier.clone();
            }
        }
        let identifier = config["identifier"].as_str().unwrap_or_default();
        assert!(
            identifier == "app.codexmonitor.updater-test"
                || identifier.starts_with("app.codexmonitor.updater-test."),
            "updater test build requires isolated identifier"
        );
        assert!(
            endpoint.is_some(),
            "updater test build requires loopback endpoint"
        );
    }
    tauri_build::build()
}
