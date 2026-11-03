use std::{fs, path::PathBuf};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::models::{ProviderSnapshot, UsageWindow};

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CREDITS_URL: &str = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;
const MAX_AUTH_BYTES: u64 = 256 * 1024;

struct Auth {
    access_token: String,
    account_id: Option<String>,
}

// Never serialized, persisted, logged or sent to a WebView. Comparing an opaque
// digest lets the quota cache follow the login without retaining credentials.
#[derive(Clone, PartialEq, Eq)]
pub(crate) enum SessionScope {
    SignedOut,
    Authenticated([u8; 32]),
    Synthetic(u64),
}

impl Auth {
    fn scope(&self) -> SessionScope {
        let subject = self
            .access_token
            .split('.')
            .nth(1)
            .and_then(|payload| URL_SAFE_NO_PAD.decode(payload).ok())
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|value| value.get("sub")?.as_str().map(str::to_owned));
        let mut digest = Sha256::new();
        if self.account_id.is_some() || subject.is_some() {
            for part in [self.account_id.as_deref(), subject.as_deref()] {
                let part = part.unwrap_or("").as_bytes();
                digest.update(part.len().to_le_bytes());
                digest.update(part);
            }
        } else {
            // Without a stable account identity, a changed token invalidates
            // the cache conservatively rather than borrowing another login.
            digest.update(self.access_token.as_bytes());
        }
        SessionScope::Authenticated(digest.finalize().into())
    }
}

pub(crate) fn session_scope() -> SessionScope {
    load_auth()
        .map(|auth| auth.scope())
        .unwrap_or(SessionScope::SignedOut)
}

fn auth_path() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
        .map(|home| home.join("auth.json"))
}

fn pick_string<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| value.get(*key)?.as_str())
}

fn account_id_from_jwt(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    pick_string(
        &value,
        &[
            "https://api.openai.com/auth.chatgpt_account_id",
            "chatgpt_account_id",
        ],
    )
    .map(str::to_owned)
}

fn load_auth() -> Result<Auth, &'static str> {
    let path = auth_path().ok_or("Codex login was not found.")?;
    let metadata = fs::metadata(&path).map_err(|_| "Please sign in to Codex Desktop first.")?;
    if !metadata.is_file() || metadata.len() > MAX_AUTH_BYTES {
        return Err("Codex login data is unavailable.");
    }
    let raw = fs::read_to_string(path).map_err(|_| "Please sign in to Codex Desktop first.")?;
    let value: Value = serde_json::from_str(&raw).map_err(|_| "Codex login format has changed.")?;
    let tokens = value.get("tokens").unwrap_or(&value);
    let access_token = pick_string(tokens, &["access_token", "accessToken"])
        .ok_or("Codex login expired. Please sign in again.")?
        .to_owned();
    let account_id = pick_string(tokens, &["account_id", "accountId"])
        .map(str::to_owned)
        .or_else(|| account_id_from_jwt(&access_token));
    Ok(Auth {
        access_token,
        account_id,
    })
}

fn headers(auth: &Auth) -> Result<HeaderMap, &'static str> {
    let mut result = HeaderMap::new();
    let mut bearer = HeaderValue::from_str(&format!("Bearer {}", auth.access_token))
        .map_err(|_| "Codex login data is invalid.")?;
    bearer.set_sensitive(true);
    result.insert(AUTHORIZATION, bearer);
    result.insert(ACCEPT, HeaderValue::from_static("application/json"));
    result.insert("originator", HeaderValue::from_static("Codex Desktop"));
    result.insert("OAI-Product-Sku", HeaderValue::from_static("CODEX"));
    if let Some(account_id) = &auth.account_id {
        let mut value =
            HeaderValue::from_str(account_id).map_err(|_| "Account identifier is invalid.")?;
        value.set_sensitive(true);
        result.insert("ChatGPT-Account-Id", value);
    }
    Ok(result)
}

fn number_with_key<'a>(value: &'a Value, keys: &[&'a str]) -> Option<(&'a str, f64)> {
    keys.iter()
        .find_map(|key| value.get(*key)?.as_f64().map(|number| (*key, number)))
}

fn integer(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        let value = value.get(*key)?;
        value
            .as_u64()
            .or_else(|| value.as_i64().and_then(|item| u64::try_from(item).ok()))
    })
}

fn timestamp(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        let item = value.get(*key)?;
        if let Some(text) = item.as_str() {
            return Some(text.to_owned());
        }
        item.as_i64()
            .and_then(|seconds| chrono::DateTime::from_timestamp(seconds, 0))
            .map(|time| time.to_rfc3339())
    })
}

fn collect_reset_credit_expirations(value: &Value) -> Vec<String> {
    fn visit(value: &Value, output: &mut Vec<String>) {
        match value {
            Value::Array(items) => {
                for item in items {
                    visit(item, output);
                }
            }
            Value::Object(map) => {
                if let Some(time) = timestamp(
                    value,
                    &[
                        "expires_at",
                        "expiresAt",
                        "expiration_time",
                        "expirationTime",
                        "expires",
                    ],
                ) {
                    output.push(time);
                }
                for key in [
                    "credits",
                    "reset_credits",
                    "resetCredits",
                    "available",
                    "items",
                    "grants",
                ] {
                    if let Some(child) = map.get(key) {
                        visit(child, output);
                    }
                }
            }
            _ => {}
        }
    }

    let mut expirations = Vec::new();
    visit(value, &mut expirations);
    expirations.sort();
    expirations.dedup();
    expirations
}

fn scale_ratio_field(key: &str, value: f64) -> bool {
    let lower = key.to_ascii_lowercase();
    matches!(
        key,
        "remaining_ratio" | "remainingRatio" | "used_ratio" | "usedRatio" | "utilization"
    ) || (!lower.contains("percent") && !lower.contains("pct") && value <= 1.0)
}

fn parse_window(value: Option<&Value>) -> Option<UsageWindow> {
    let value = value?;
    let remaining_percent = if let Some((key, remaining)) = number_with_key(
        value,
        &[
            "remaining_percent",
            "remainingPercent",
            "remaining_pct",
            "remainingPct",
            "remaining_ratio",
            "remainingRatio",
            "remaining",
        ],
    ) {
        if scale_ratio_field(key, remaining) {
            remaining * 100.0
        } else {
            remaining
        }
    } else {
        let (key, used) = number_with_key(
            value,
            &[
                "used_percent",
                "usedPercent",
                "used_pct",
                "usedPct",
                "used_ratio",
                "usedRatio",
                "utilization",
                "used",
            ],
        )?;
        let used_percent = if scale_ratio_field(key, used) {
            used * 100.0
        } else {
            used
        };
        100.0 - used_percent
    };
    if !remaining_percent.is_finite() || !(0.0..=100.0).contains(&remaining_percent) {
        return None;
    }
    Some(UsageWindow {
        remaining_percent,
        resets_at: timestamp(
            value,
            &[
                "reset_at",
                "resetAt",
                "resets_at",
                "resetsAt",
                "reset_time",
                "resetTime",
            ],
        ),
        window_seconds: integer(
            value,
            &[
                "limit_window_seconds",
                "limitWindowSeconds",
                "window_seconds",
                "windowSeconds",
                "duration_seconds",
                "durationSeconds",
                "period_seconds",
                "periodSeconds",
            ],
        )
        .unwrap_or(0),
    })
}

const PRIMARY_NAMES: &[&str] = &[
    "primary_window",
    "primaryWindow",
    "short_window",
    "shortWindow",
    "five_hour_window",
    "fiveHourWindow",
    "5h",
    "primary",
];
const SECONDARY_NAMES: &[&str] = &[
    "secondary_window",
    "secondaryWindow",
    "weekly_window",
    "weeklyWindow",
    "week_window",
    "weekWindow",
    "weekly",
    "secondary",
];

fn is_weekly(window: &UsageWindow) -> bool {
    window.window_seconds.abs_diff(604_800) <= 60
}

fn named_window(rate_limit: &Value, names: &[&str]) -> Result<Option<UsageWindow>, ()> {
    for name in names {
        if let Some(value) = rate_limit.get(*name).filter(|value| !value.is_null()) {
            // A present but malformed cycle is a failed response, not evidence
            // that the account lost that cycle. Preserve the last good snapshot.
            return parse_window(Some(value)).map(Some).ok_or(());
        }
    }
    Ok(None)
}

fn parse_usage_windows(
    rate_limit: &Value,
) -> Result<(Option<UsageWindow>, Option<UsageWindow>), ()> {
    let primary = named_window(rate_limit, PRIMARY_NAMES)?;
    let mut secondary = named_window(rate_limit, SECONDARY_NAMES)?;
    let mut short = None;
    if let Some(window) = primary {
        if is_weekly(&window) {
            if secondary.is_none() {
                secondary = Some(window);
            }
        } else {
            short = Some(window);
        }
    }
    for key in [
        "windows",
        "limit_windows",
        "limitWindows",
        "limits",
        "buckets",
    ] {
        let Some(items) = rate_limit.get(key).and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            let name = pick_string(item, &["name", "type", "id", "window", "label"])
                .unwrap_or("")
                .to_ascii_lowercase();
            let named_primary = PRIMARY_NAMES
                .iter()
                .any(|key| name == key.to_ascii_lowercase());
            let named_secondary = SECONDARY_NAMES
                .iter()
                .any(|key| name == key.to_ascii_lowercase());
            let Some(window) = parse_window(Some(item)) else {
                if named_primary || named_secondary {
                    return Err(());
                }
                continue;
            };
            if is_weekly(&window) || named_secondary {
                if secondary.is_none() {
                    secondary = Some(window);
                }
            } else if (named_primary || window.window_seconds > 0) && short.is_none() {
                short = Some(window);
            }
        }
    }
    if short.is_none() && secondary.is_none() {
        return Err(());
    }
    Ok((short, secondary))
}

fn safe_http_failure(status: reqwest::StatusCode) -> (&'static str, &'static str) {
    match status.as_u16() {
        401 | 403 => ("signed_out", "Codex login expired. Please sign in again."),
        429 => (
            "unavailable",
            "Quota service is rate limited. It will retry automatically.",
        ),
        _ => ("unavailable", "Quota service is temporarily unavailable."),
    }
}

async fn limited_json(mut response: reqwest::Response) -> Result<Value, ()> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES)
    {
        return Err(());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if bytes.len().saturating_add(chunk.len()) as u64 > MAX_RESPONSE_BYTES {
            return Err(());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| ())
}

pub async fn fetch_account_usage(
    client: &reqwest::Client,
) -> Result<crate::account_usage::AccountUsage, String> {
    let auth = load_auth()?;
    let response = client
        .get("https://chatgpt.com/backend-api/wham/profiles/me")
        .headers(headers(&auth)?)
        .send()
        .await
        .map_err(|_| "account statistics unavailable")?;
    if !response.status().is_success() {
        return Err("account statistics unavailable".into());
    }
    let value = limited_json(response)
        .await
        .map_err(|_| "account statistics unavailable")?;
    crate::account_usage::parse(&value)
}

pub async fn fetch_snapshot(client: &reqwest::Client) -> ProviderSnapshot {
    let auth = match load_auth() {
        Ok(value) => value,
        Err(message) => return ProviderSnapshot::failure("signed_out", message),
    };
    fetch_authenticated(client, auth).await
}

pub(crate) async fn fetch_snapshot_for_scope(
    client: &reqwest::Client,
    expected: &SessionScope,
) -> ProviderSnapshot {
    let auth = match load_auth() {
        Ok(value) => value,
        Err(message) => return ProviderSnapshot::failure("signed_out", message),
    };
    if &auth.scope() != expected {
        return ProviderSnapshot::failure("loading", "Account changed. Refreshing quota.");
    }
    fetch_authenticated(client, auth).await
}

async fn fetch_authenticated(client: &reqwest::Client, auth: Auth) -> ProviderSnapshot {
    let request_headers = match headers(&auth) {
        Ok(value) => value,
        Err(message) => return ProviderSnapshot::failure("signed_out", message),
    };

    let (usage_result, credits_result) = tokio::join!(
        client
            .get(USAGE_URL)
            .headers(request_headers.clone())
            .send(),
        client.get(CREDITS_URL).headers(request_headers).send(),
    );

    let usage_response = match usage_result {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            let (status, message) = safe_http_failure(response.status());
            return ProviderSnapshot::failure(status, message);
        }
        Err(_) => {
            return ProviderSnapshot::failure(
                "unavailable",
                "Network unavailable. It will retry automatically.",
            )
        }
    };
    let usage: Value = match limited_json(usage_response).await {
        Ok(value) => value,
        Err(_) => {
            return ProviderSnapshot::failure("unavailable", "Quota response format has changed.")
        }
    };
    let rate_limit = usage
        .get("rate_limit")
        .or_else(|| usage.get("rateLimit"))
        .unwrap_or(&usage);
    let (short_window, weekly_window) = match parse_usage_windows(rate_limit) {
        Ok(windows) => windows,
        Err(()) => {
            return ProviderSnapshot::failure(
                "unavailable",
                "Quota response does not contain valid usage windows.",
            )
        }
    };

    let usage_credits = usage
        .get("rate_limit_reset_credits")
        .or_else(|| usage.get("rateLimitResetCredits"));
    let usage_reset_credits = usage_credits.and_then(|value| {
        integer(
            value,
            &[
                "available_count",
                "availableCount",
                "remaining",
                "count",
                "quantity",
            ],
        )
    });
    let usage_reset_credit_expires_at = usage_credits
        .map(collect_reset_credit_expirations)
        .unwrap_or_default();

    let (reset_credits, reset_credit_expires_at) = match credits_result {
        Ok(response) if response.status().is_success() => match limited_json(response).await.ok() {
            Some(value) => (
                integer(
                    &value,
                    &[
                        "available_count",
                        "availableCount",
                        "remaining",
                        "count",
                        "quantity",
                    ],
                )
                .or(usage_reset_credits),
                {
                    let expirations = collect_reset_credit_expirations(&value);
                    if expirations.is_empty() {
                        usage_reset_credit_expires_at
                    } else {
                        expirations
                    }
                },
            ),
            None => (usage_reset_credits, usage_reset_credit_expires_at),
        },
        _ => (usage_reset_credits, usage_reset_credit_expires_at),
    };

    ProviderSnapshot {
        account_generation: None,
        provider: "codex".into(),
        display_name: "CODEX".into(),
        plan: pick_string(&usage, &["plan_type", "planType"]).map(|value| value.to_uppercase()),
        short_window,
        weekly_window,
        reset_credits,
        reset_credit_expires_at,
        updated_at: chrono::Utc::now().to_rfc3339(),
        status: "ok".into(),
        message: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_both_window_shapes() {
        let snake = serde_json::json!({
            "used_percent": 26,
            "reset_at": 1738300000,
            "limit_window_seconds": 18000
        });
        let window = parse_window(Some(&snake)).unwrap();
        assert_eq!(window.remaining_percent, 74.0);
        assert_eq!(window.window_seconds, 18000);
        let camel = serde_json::json!({
            "utilization": 0.4,
            "resetsAt": "2026-07-07T00:00:00Z",
            "windowSeconds": 604800
        });
        assert_eq!(parse_window(Some(&camel)).unwrap().remaining_percent, 60.0);
    }

    #[test]
    fn prefers_explicit_remaining_percent() {
        let value = serde_json::json!({
            "remainingPercent": 73.4,
            "usedPercent": 99,
            "resetTime": "2026-07-07T00:00:00Z",
            "durationSeconds": 18000
        });
        let window = parse_window(Some(&value)).unwrap();
        assert_eq!(window.remaining_percent, 73.4);
        assert_eq!(window.window_seconds, 18000);
    }

    #[test]
    fn treats_fractional_percent_fields_as_ratios() {
        let explicit_remaining = serde_json::json!({"remaining": 0.25, "periodSeconds": 18000});
        assert_eq!(
            parse_window(Some(&explicit_remaining))
                .unwrap()
                .remaining_percent,
            25.0
        );

        let used_ratio = serde_json::json!({"used": 0.25, "periodSeconds": 18000});
        assert_eq!(
            parse_window(Some(&used_ratio)).unwrap().remaining_percent,
            75.0
        );
    }

    #[test]
    fn does_not_scale_explicit_percent_fields() {
        let explicit_remaining =
            serde_json::json!({"remaining_percent": 0.4, "windowSeconds": 18000});
        assert_eq!(
            parse_window(Some(&explicit_remaining))
                .unwrap()
                .remaining_percent,
            0.4
        );

        let explicit_used = serde_json::json!({"used_percent": 0.4, "windowSeconds": 18000});
        assert_eq!(
            parse_window(Some(&explicit_used))
                .unwrap()
                .remaining_percent,
            99.6
        );
    }

    #[test]
    fn finds_window_by_duration_or_name_in_arrays() {
        let rate_limit = serde_json::json!({
            "windows": [
                {"name": "weekly", "remainingPercent": 88, "windowSeconds": 604800},
                {"name": "primary", "remainingPercent": 51, "windowSeconds": 18000}
            ]
        });
        let (short, weekly) = parse_usage_windows(&rate_limit).unwrap();
        assert_eq!(short.unwrap().remaining_percent, 51.0);
        assert_eq!(weekly.unwrap().remaining_percent, 88.0);
    }

    #[test]
    fn weekly_primary_is_not_duplicated_as_a_short_cycle() {
        for value in [
            serde_json::json!({"primary_window": {"remainingPercent":98,"windowSeconds":604800},"weekly_window":{"remainingPercent":98,"windowSeconds":604800}}),
            serde_json::json!({"primary": {"remainingPercent":98,"windowSeconds":604800}}),
        ] {
            let (short, weekly) = parse_usage_windows(&value).unwrap();
            assert!(short.is_none());
            let weekly = weekly.unwrap();
            assert_eq!(weekly.remaining_percent, 98.0);
            assert_eq!(weekly.window_seconds, 604_800);
        }
    }

    #[test]
    fn recognizes_actual_short_duration_instead_of_assuming_five_hours() {
        let value =
            serde_json::json!({"primary_window": {"remainingPercent":19,"windowSeconds":7200}});
        let (short, weekly) = parse_usage_windows(&value).unwrap();
        assert_eq!(short.unwrap().window_seconds, 7200);
        assert!(weekly.is_none());
        let value = serde_json::json!({"primary_window":{"remainingPercent":7}});
        let (short, weekly) = parse_usage_windows(&value).unwrap();
        assert_eq!(short.unwrap().window_seconds, 0);
        assert!(weekly.is_none());
    }

    #[test]
    fn secondary_cycle_preserves_its_actual_duration() {
        let value =
            serde_json::json!({"secondary_window":{"remainingPercent":72,"windowSeconds":86400}});
        let (short, secondary) = parse_usage_windows(&value).unwrap();
        assert!(short.is_none());
        assert_eq!(secondary.unwrap().window_seconds, 86400);
    }

    #[test]
    fn missing_null_and_malformed_cycles_are_not_equivalent() {
        let weekly = serde_json::json!({"remainingPercent":42,"windowSeconds":604800});
        for value in [
            serde_json::json!({"weekly_window":weekly}),
            serde_json::json!({"primary_window":null,"weekly_window":weekly}),
        ] {
            let (short, secondary) = parse_usage_windows(&value).unwrap();
            assert!(short.is_none());
            assert!(secondary.is_some());
        }
        for value in [
            serde_json::json!({}),
            serde_json::json!({"primary_window":{"windowSeconds":18000},"weekly_window":weekly}),
            serde_json::json!({"primary_window":{"remainingPercent":101},"weekly_window":weekly}),
            serde_json::json!({"windows":[{"name":"primary","remainingPercent":"unknown"},weekly]}),
        ] {
            assert!(parse_usage_windows(&value).is_err());
        }
    }

    #[test]
    fn percent_boundaries_are_preserved_and_invalid_values_are_rejected() {
        for percent in [0.0, 0.01, 0.99, 1.0, 99.99, 100.0] {
            let value = serde_json::json!({"remainingPercent":percent});
            assert_eq!(
                parse_window(Some(&value)).unwrap().remaining_percent,
                percent
            );
        }
        for percent in [-1.0, 100.01, 1000.0] {
            assert!(parse_window(Some(&serde_json::json!({"remainingPercent":percent}))).is_none());
            assert!(parse_window(Some(&serde_json::json!({"usedPercent":percent}))).is_none());
        }
    }

    #[test]
    fn login_scope_is_stable_across_token_rotation_but_separates_accounts_and_users() {
        let token = |subject: &str, suffix: &str| {
            format!(
                "header.{}.{}",
                URL_SAFE_NO_PAD.encode(serde_json::json!({"sub":subject}).to_string()),
                suffix
            )
        };
        let auth = |account: &str, subject: &str, suffix: &str| Auth {
            access_token: token(subject, suffix),
            account_id: Some(account.into()),
        };
        assert!(
            auth("account-a", "user-a", "old").scope()
                == auth("account-a", "user-a", "new").scope()
        );
        assert!(
            auth("account-a", "user-a", "old").scope()
                != auth("account-b", "user-a", "new").scope()
        );
        assert!(
            auth("account-a", "user-a", "old").scope()
                != auth("account-a", "user-b", "new").scope()
        );
        let anonymous = |token: &str| Auth {
            access_token: token.into(),
            account_id: None,
        };
        assert!(anonymous("old").scope() != anonymous("new").scope());
    }
}
