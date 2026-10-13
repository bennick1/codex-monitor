use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(target_os = "macos")]
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub status: String,
    pub currency: String,
    pub balance: Option<f64>,
    pub spent: Option<f64>,
    pub tokens: Option<String>,
    pub cost: Option<f64>,
    pub requests: Option<String>,
    pub api_keys: Option<usize>,
    pub time_zone_seconds: i64,
    pub daily: Vec<Day>,
    pub updated_at: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Day {
    date: String,
    tokens: String,
    cost: f64,
}
impl Usage {
    fn empty(status: &str) -> Self {
        Self {
            status: status.into(),
            currency: "CNY".into(),
            balance: None,
            spent: None,
            tokens: None,
            cost: None,
            requests: None,
            api_keys: None,
            time_zone_seconds: 0,
            daily: vec![],
            updated_at: None,
        }
    }
}
pub struct DeepSeekState {
    latest: Mutex<Usage>,
    ready: AtomicBool,
    fetch: tokio::sync::Mutex<Option<Instant>>,
}
impl Default for DeepSeekState {
    fn default() -> Self {
        Self {
            latest: Mutex::new(Usage::empty("signed_out")),
            ready: AtomicBool::new(false),
            fetch: tokio::sync::Mutex::new(None),
        }
    }
}

fn money(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|n: &f64| n.is_finite() && *n >= 0.0)
}
fn integer(value: &Value) -> Result<u64, String> {
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .ok_or("invalid usage counter".into())
}
fn add(a: u64, b: u64) -> Result<u64, String> {
    a.checked_add(b).ok_or("usage overflow".into())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    summary: String,
    amount: String,
    cost: String,
    start: i64,
    end: i64,
    time_zone_seconds: i64,
}

fn parse(value: Value) -> Result<Usage, String> {
    let payload: Payload = serde_json::from_value(value).map_err(|_| "invalid usage response")?;
    if payload
        .end
        .checked_sub(payload.start)
        .is_none_or(|span| !(1..=32 * 86400).contains(&span))
        || !(-86400..=86400).contains(&payload.time_zone_seconds)
    {
        return Err("invalid usage period".into());
    }
    let summary: Value =
        serde_json::from_str(&payload.summary).map_err(|_| "invalid usage summary")?;
    let amount: Value =
        serde_json::from_str(&payload.amount).map_err(|_| "invalid usage detail")?;
    let costs: Value = serde_json::from_str(&payload.cost).map_err(|_| "invalid usage cost")?;
    let summary = &summary["data"]["biz_data"];
    let wallet = summary["normal_wallets"]
        .as_array()
        .and_then(|v| v.first())
        .ok_or("wallet unavailable")?;
    let currency = wallet["currency"]
        .as_str()
        .filter(|s| s.len() == 3 && s.bytes().all(|b| b.is_ascii_uppercase()))
        .ok_or("currency unavailable")?;
    let balance = money(&wallet["balance"]).ok_or("balance unavailable")?;
    let spent = summary["total_costs"]
        .as_array()
        .and_then(|rows| rows.iter().find(|r| r["currency"] == currency))
        .and_then(|row| money(&row["amount"]))
        .ok_or("cost unavailable")?;
    let series = amount["data"]["biz_data"]["series"]
        .as_array()
        .ok_or("usage detail unavailable")?;
    let currencies = costs["data"]["biz_data"]["data"]
        .as_array()
        .ok_or("usage cost unavailable")?;
    let cost_series = currencies
        .iter()
        .find(|c| c["currency"] == currency)
        .and_then(|c| c["series"].as_array());
    if cost_series.is_none() && !currencies.is_empty() {
        return Err("usage currency mismatch".into());
    }
    let mut days: BTreeMap<i64, (u64, f64)> = BTreeMap::new();
    let mut total = 0;
    let mut requests = 0;
    let mut requests_known = true;
    let mut keys_known = true;
    let mut cost = 0.0;
    let mut keys = BTreeSet::new();
    for row in series {
        if let Some(key) = row["api_key"]["tracking_id"]
            .as_str()
            .or_else(|| row["api_key"]["name"].as_str())
        {
            keys.insert(key);
        } else {
            keys_known = false;
        }
        for bucket in row["buckets"].as_array().ok_or("invalid usage buckets")? {
            let at = bucket["time"].as_i64().ok_or("invalid usage timestamp")?;
            if at < payload.start || at >= payload.end {
                continue;
            }
            let counters = bucket["usage"]
                .as_object()
                .ok_or("invalid usage counters")?;
            let mut tokens = 0;
            let mut recognized = false;
            for name in [
                "PROMPT_CACHE_HIT_TOKEN",
                "PROMPT_CACHE_MISS_TOKEN",
                "RESPONSE_TOKEN",
            ] {
                if let Some(v) = counters.get(name) {
                    tokens = add(tokens, integer(v)?)?;
                    recognized = true;
                }
            }
            if !recognized {
                return Err("unknown usage counters".into());
            }
            total = add(total, tokens)?;
            if let Some(v) = counters.get("REQUEST") {
                requests = add(requests, integer(v)?)?;
            } else {
                requests_known = false;
            }
            let day = days
                .entry(
                    at.checked_add(payload.time_zone_seconds)
                        .ok_or("invalid usage date")?
                        .div_euclid(86400),
                )
                .or_default();
            day.0 = add(day.0, tokens)?;
        }
    }
    for row in cost_series.into_iter().flatten() {
        for bucket in row["buckets"].as_array().ok_or("invalid cost buckets")? {
            let at = bucket["time"].as_i64().ok_or("invalid cost timestamp")?;
            if at < payload.start || at >= payload.end {
                continue;
            }
            let value = money(&bucket["cost"]).ok_or("invalid daily cost")?;
            cost += value;
            days.entry(
                at.checked_add(payload.time_zone_seconds)
                    .ok_or("invalid usage date")?
                    .div_euclid(86400),
            )
            .or_default()
            .1 += value;
        }
    }
    if !cost.is_finite() {
        return Err("cost overflow".into());
    }
    let daily = days
        .into_iter()
        .map(|(at, (tokens, cost))| {
            let date = chrono::DateTime::from_timestamp(
                at.checked_mul(86400).ok_or("invalid usage date")?,
                0,
            )
            .ok_or("invalid usage date")?
            .format("%Y-%m-%d")
            .to_string();
            Ok(Day {
                date,
                tokens: tokens.to_string(),
                cost,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Usage {
        status: "ok".into(),
        currency: currency.into(),
        balance: Some(balance),
        spent: Some(spent),
        tokens: Some(total.to_string()),
        cost: Some(cost),
        requests: requests_known.then(|| requests.to_string()),
        api_keys: keys_known.then_some(keys.len()),
        time_zone_seconds: payload.time_zone_seconds,
        daily,
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
    })
}

fn enabled(app: &AppHandle) -> bool {
    crate::preferences_lock(&app.state::<crate::AppState>()).deepseek_enabled
}
fn set_enabled(app: &AppHandle, value: bool) -> Result<(), String> {
    let state = app.state::<crate::AppState>();
    let mut prefs = crate::preferences_lock(&state).clone();
    prefs.deepseek_enabled = value;
    crate::persist_preferences(&state.preferences_path, &prefs)?;
    *crate::preferences_lock(&state) = prefs.clone();
    let _ = app.emit_to("widget", "preferences-changed", prefs);
    Ok(())
}
fn origin(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("platform.deepseek.com")
        && url.port_or_known_default() == Some(443)
}

fn login_navigation(url: &tauri::Url) -> bool {
    // Login embeds (for example a QR frame) and policy links can use other
    // HTTPS origins. They receive no native capabilities; usage evaluation is
    // still restricted to the platform origin by get_deepseek_usage and JS.
    url.scheme() == "https" || url.as_str() == "about:blank"
}

fn create_window(app: &AppHandle, visible: bool) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("deepseek-login") {
        return Ok(window);
    }
    let handle = app.clone();
    let mut builder = WebviewWindowBuilder::new(
        app,
        "deepseek-login",
        WebviewUrl::External(
            "https://platform.deepseek.com/usage"
                .parse()
                .map_err(|_| "login unavailable")?,
        ),
    )
    .title("DeepSeek · 登录开放平台")
    .inner_size(960.0, 720.0)
    .visible(visible)
    .on_navigation(login_navigation)
    .on_page_load(move |webview, payload| {
        if let Some(host) = payload.url().host_str() {
            let _ = webview.set_title(&format!("DeepSeek · {host}"));
        }
        if origin(payload.url())
            && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
        {
            handle
                .state::<DeepSeekState>()
                .ready
                .store(true, Ordering::SeqCst);
            let _ = handle.emit_to("widget", "deepseek-ready", ());
        }
    });
    #[cfg(target_os = "macos")]
    {
        if objc2::available!(macos = 14.0) {
            let hash = Sha256::digest(format!("{}:deepseek", app.config().identifier));
            let mut id = [0u8; 16];
            id.copy_from_slice(&hash[..16]);
            builder = builder.data_store_identifier(id);
        } else {
            builder = builder.incognito(true);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.data_directory(
            app.path()
                .app_local_data_dir()
                .map_err(|_| "login storage unavailable")?
                .join("deepseek-webview"),
        );
    }
    let window = builder.build().map_err(|_| "DeepSeek login unavailable")?;
    let handle = app.clone();
    let owned = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = owned.hide();
            let _ = handle.emit_to("widget", "deepseek-ready", ());
        }
    });
    Ok(window)
}

#[tauri::command]
pub async fn open_deepseek_login(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    if window.label() != "widget" {
        return Err("unsupported caller".into());
    }
    set_enabled(&app, true)?;
    let login = create_window(&app, true)?;
    if !origin(&login.url().map_err(|_| "login unavailable")?) {
        login
            .navigate(
                "https://platform.deepseek.com/usage"
                    .parse()
                    .map_err(|_| "login unavailable")?,
            )
            .map_err(|_| "login unavailable")?;
    }
    login.show().map_err(|_| "login unavailable")?;
    login.set_focus().map_err(|_| "login unavailable".into())
}

#[tauri::command]
pub async fn disconnect_deepseek(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    if window.label() != "widget" {
        return Err("unsupported caller".into());
    }
    // Serialize logout against a pending refresh so an old response cannot sign us back in.
    let state = app.state::<DeepSeekState>();
    let mut gate = state.fetch.lock().await;
    if enabled(&app) {
        let login = create_window(&app, false)?;
        login
            .clear_all_browsing_data()
            .map_err(|_| "could not clear DeepSeek session")?;
        login
            .destroy()
            .map_err(|_| "could not close DeepSeek session")?;
    }
    set_enabled(&app, false)?;
    *state.latest.lock().map_err(|_| "usage unavailable")? = Usage::empty("signed_out");
    state.ready.store(false, Ordering::SeqCst);
    *gate = None;
    Ok(())
}

#[tauri::command]
pub async fn get_deepseek_usage(window: WebviewWindow, app: AppHandle) -> Result<Usage, String> {
    if window.label() != "widget" {
        return Err("unsupported caller".into());
    }
    #[cfg(debug_assertions)]
    if crate::sidebar_fixtures::enabled() {
        return parse(crate::sidebar_fixtures::deepseek());
    }
    if !enabled(&app) {
        return Ok(Usage::empty("signed_out"));
    }
    let state = app.state::<DeepSeekState>();
    let mut gate = state.fetch.lock().await;
    let login = create_window(&app, false)?;
    if !state.ready.load(Ordering::SeqCst) {
        return Ok(Usage::empty("loading"));
    }
    if gate.is_some_and(|at| at.elapsed() < Duration::from_secs(15)) {
        return Ok(state
            .latest
            .lock()
            .map_err(|_| "usage unavailable")?
            .clone());
    }
    *gate = Some(Instant::now());
    if !origin(&login.url().map_err(|_| "login unavailable")?) {
        return Ok(Usage::empty("signed_out"));
    }
    login
        .eval(include_str!("deepseek-read.js"))
        .map_err(|_| "usage unavailable")?;
    let mut result = Usage::empty("unavailable");
    for _ in 0..60 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        let (tx, rx) = tokio::sync::oneshot::channel();
        let sender = Mutex::new(Some(tx));
        login
            .eval_with_callback("window.__codexMonitorDeepSeek ?? null", move |value| {
                if let Ok(mut sender) = sender.lock() {
                    if let Some(tx) = sender.take() {
                        let _ = tx.send(value);
                    }
                }
            })
            .map_err(|_| "usage unavailable")?;
        let raw = tokio::time::timeout(Duration::from_secs(2), rx)
            .await
            .map_err(|_| "usage unavailable")?
            .map_err(|_| "usage unavailable")?;
        if raw.len() > 4 * 1024 * 1024 {
            break;
        }
        let value: Value = serde_json::from_str(&raw).map_err(|_| "usage unavailable")?;
        if value.is_null() {
            continue;
        }
        result = match value["status"].as_str() {
            Some("ok") => parse(value).unwrap_or_else(|_| Usage::empty("unavailable")),
            Some("signed_out") => Usage::empty("signed_out"),
            _ => Usage::empty("unavailable"),
        };
        break;
    }
    let _ = login.eval("delete window.__codexMonitorDeepSeek");
    let mut latest = state.latest.lock().map_err(|_| "usage unavailable")?;
    if result.status == "unavailable" && matches!(latest.status.as_str(), "ok" | "stale") {
        result = latest.clone();
        result.status = "stale".into();
    }
    *latest = result.clone();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> Value {
        json!({"summary":json!({"data":{"biz_data":{"normal_wallets":[{"currency":"CNY","balance":"8.89"}],"total_costs":[{"currency":"CNY","amount":"21.11"}]}}}).to_string(),
        "amount":json!({"data":{"biz_data":{"series":[{"api_key":{"tracking_id":"synthetic"},"buckets":[{"time":100,"usage":{"PROMPT_CACHE_HIT_TOKEN":"10","PROMPT_CACHE_MISS_TOKEN":"20","RESPONSE_TOKEN":"30","REQUEST":"3"}}]}]}}}).to_string(),
        "cost":json!({"data":{"biz_data":{"data":[{"currency":"CNY","series":[{"buckets":[{"time":100,"cost":"0.123"}]}]}]}}}).to_string(),"start":0,"end":86400,"timeZoneSeconds":28800})
    }
    #[test]
    fn merges_intraday_buckets_and_never_invents_unknown_counters() {
        let mut payload = fixture();
        let mut amount: Value = serde_json::from_str(payload["amount"].as_str().unwrap()).unwrap();
        let buckets = amount["data"]["biz_data"]["series"][0]["buckets"]
            .as_array_mut()
            .unwrap();
        let mut second = buckets[0].clone();
        second["time"] = json!(200);
        second["usage"].as_object_mut().unwrap().remove("REQUEST");
        buckets.push(second);
        payload["amount"] = json!(amount.to_string());
        let parsed = parse(payload.clone()).unwrap();
        assert_eq!(parsed.daily.len(), 1);
        assert_eq!(parsed.daily[0].tokens, "120");
        assert_eq!(parsed.requests, None);
        amount["data"]["biz_data"]["series"][0]["buckets"][0]["usage"] = json!({"UNKNOWN": 1});
        payload["amount"] = json!(amount.to_string());
        assert!(parse(payload).is_err());
    }

    #[test]
    fn separates_funds_from_period_cost_and_counts_tokens_once() {
        let result = parse(fixture()).unwrap();
        assert_eq!(result.balance, Some(8.89));
        assert_eq!(result.spent, Some(21.11));
        assert_eq!(result.tokens.as_deref(), Some("60"));
        assert_eq!(result.requests.as_deref(), Some("3"));
        assert_eq!(result.cost, Some(0.123));
        assert_eq!(result.api_keys, Some(1));
        assert_eq!(result.daily[0].date, "1970-01-01");
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains("synthetic"));
    }
    #[test]
    fn unknown_shapes_do_not_fabricate_zero_and_navigation_is_same_origin() {
        let mut value = fixture();
        value["amount"] = json!("{}");
        assert!(parse(value).is_err());
        assert!(origin(
            &"https://platform.deepseek.com/usage".parse().unwrap()
        ));
        assert!(login_navigation(
            &"https://open.weixin.qq.com/connect/qrconnect"
                .parse()
                .unwrap()
        ));
        assert!(login_navigation(&"about:blank".parse().unwrap()));
        assert!(!login_navigation(
            &"file:///private/tmp/example.html".parse().unwrap()
        ));
        assert!(!login_navigation(
            &"http://platform.deepseek.com/".parse().unwrap()
        ));
        for url in [
            "http://platform.deepseek.com",
            "https://platform.deepseek.com.evil.test",
            "https://platform.deepseek.com:444",
            "file:///tmp/auth",
        ] {
            assert!(!origin(&url.parse().unwrap()));
        }
    }
}
