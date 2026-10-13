//! Synthetic native validation only. The existing startup guard requires a
//! separate bundle identifier whenever CODEX_MONITOR_SYNTHETIC_QUOTA is set.
use chrono::{Duration, Local};
use serde_json::{json, Value};
use std::path::Path;

pub fn validate_acceptance_home(home: &Path) -> Result<(), &'static str> {
    let is_plain_directory =
        |path: &Path| std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir());
    let marker = home.join(".codex-monitor-acceptance");
    if !home.is_absolute()
        || !is_plain_directory(home)
        || !std::fs::symlink_metadata(&marker).is_ok_and(|meta| meta.is_file())
        || !std::fs::read_to_string(marker)
            .is_ok_and(|value| value == "codex-monitor-sidebar-acceptance-v1")
    {
        return Err("acceptance requires a marked isolated CODEX_HOME");
    }
    for name in ["sessions", "archived_sessions"] {
        let path = home.join(name);
        if !is_plain_directory(&path)
            || !std::fs::read_dir(path).is_ok_and(|mut entries| entries.next().is_none())
        {
            return Err("acceptance session directories must be empty and not symlinks");
        }
    }
    Ok(())
}

pub fn enabled() -> bool {
    std::env::var("CODEX_MONITOR_SYNTHETIC_QUOTA").as_deref() == Ok("1")
}

pub fn account() -> Value {
    let today = Local::now().date_naive();
    let daily: Vec<_> = (0..30)
        .map(|i| {
            json!({
                "start_date": (today - Duration::days(29-i)).to_string(),
                "tokens": ((i * 17 + 11) % 41) * 1200000
            })
        })
        .collect();
    json!({"stats": {"lifetime_tokens":"3633123456", "peak_daily_tokens":"405100000", "longest_running_turn_sec":11460,
        "current_streak_days":18,"longest_streak_days":25,"daily_usage_buckets":daily}})
}

pub fn deepseek() -> Value {
    let now = Local::now();
    let end = now.timestamp();
    let start = end - 30 * 86400;
    let amount: Vec<_> = (0..30).map(|i| json!({"time":start+i*86400,"usage":{
        "PROMPT_CACHE_HIT_TOKEN":"1234","PROMPT_CACHE_MISS_TOKEN":((i*7+3)%17*1000).to_string(),"RESPONSE_TOKEN":"321","REQUEST":"3"
    }})).collect();
    let costs: Vec<_> = (0..30)
        .map(|i| json!({"time":start+i*86400,"cost":((i*7+3)%17) as f64 / 1000.0}))
        .collect();
    json!({"summary":json!({"data":{"biz_data":{"normal_wallets":[{"currency":"CNY","balance":"8.89"}],"total_costs":[{"currency":"CNY","amount":"21.11"}]}}}).to_string(),
        "amount":json!({"data":{"biz_data":{"series":[{"api_key":{"tracking_id":"SYNTHETIC-TEST"},"buckets":amount}]}}}).to_string(),
        "cost":json!({"data":{"biz_data":{"data":[{"currency":"CNY","series":[{"buckets":costs}]}]}}}).to_string(),
        "start":start,"end":end,"timeZoneSeconds":now.offset().local_minus_utc()})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acceptance_rejects_unmarked_or_nonempty_home() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        assert!(validate_acceptance_home(home).is_err());
        std::fs::write(
            home.join(".codex-monitor-acceptance"),
            "codex-monitor-sidebar-acceptance-v1",
        )
        .unwrap();
        for name in ["sessions", "archived_sessions"] {
            std::fs::create_dir(home.join(name)).unwrap();
        }
        assert!(validate_acceptance_home(home).is_ok());
        std::fs::write(home.join("sessions/example.jsonl"), "fixture").unwrap();
        assert!(validate_acceptance_home(home).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn acceptance_rejects_linked_session_directory() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir(&home).unwrap();
        std::fs::write(
            home.join(".codex-monitor-acceptance"),
            "codex-monitor-sidebar-acceptance-v1",
        )
        .unwrap();
        std::fs::create_dir(home.join("archived_sessions")).unwrap();
        let source = dir.path().join("source");
        std::fs::create_dir(&source).unwrap();
        std::os::unix::fs::symlink(source, home.join("sessions")).unwrap();
        assert!(validate_acceptance_home(&home).is_err());
    }
}
