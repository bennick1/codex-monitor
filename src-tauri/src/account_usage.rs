use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsage {
    pub lifetime_tokens: Option<String>,
    pub peak_daily_tokens: Option<String>,
    pub longest_running_turn_seconds: Option<f64>,
    pub current_streak_days: Option<u64>,
    pub longest_streak_days: Option<u64>,
    pub daily: Vec<DailyUsage>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct DailyUsage {
    pub date: String,
    pub tokens: String,
}

fn counter(value: &Value) -> Option<String> {
    value.as_u64().map(|n| n.to_string()).or_else(|| {
        let s = value.as_str()?;
        (!s.is_empty() && s.len() <= 40 && s.bytes().all(|b| b.is_ascii_digit()))
            .then(|| s.to_owned())
    })
}

pub fn parse(value: &Value) -> Result<AccountUsage, String> {
    let stats = value
        .get("stats")
        .filter(|v| v.is_object())
        .ok_or("account statistics unavailable")?;
    let mut days = std::collections::BTreeMap::new();
    if let Some(rows) = stats.get("daily_usage_buckets").and_then(Value::as_array) {
        for row in rows {
            if let (Some(date), Some(tokens)) = (
                row.get("start_date").and_then(Value::as_str),
                counter(&row["tokens"]),
            ) {
                if date.len() == 10
                    && chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok()
                    && days.insert(date.to_owned(), tokens).is_some()
                {
                    return Err("duplicate account usage date".into());
                }
            }
        }
    }
    Ok(AccountUsage {
        lifetime_tokens: counter(&stats["lifetime_tokens"]),
        peak_daily_tokens: counter(&stats["peak_daily_tokens"]),
        longest_running_turn_seconds: stats["longest_running_turn_sec"]
            .as_f64()
            .filter(|n| n.is_finite() && *n >= 0.0),
        current_streak_days: stats["current_streak_days"].as_u64(),
        longest_streak_days: stats["longest_streak_days"].as_u64(),
        daily: days
            .into_iter()
            .map(|(date, tokens)| DailyUsage { date, tokens })
            .collect(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn preserves_large_counts_and_missing_is_not_zero() {
        let parsed = parse(&json!({"stats":{"lifetime_tokens":9007199254740993u64,"current_streak_days":18,"daily_usage_buckets":[{"start_date":"2026-09-30","tokens":"9007199254740995"}]}})).unwrap();
        assert_eq!(parsed.lifetime_tokens.as_deref(), Some("9007199254740993"));
        assert_eq!(parsed.daily[0].tokens, "9007199254740995");
        assert_eq!(parsed.peak_daily_tokens, None);
        assert_eq!(parsed.current_streak_days, Some(18));
    }
    #[test]
    fn rejects_unknown_shape_negative_values_and_duplicate_days() {
        assert!(parse(&json!({"other":1})).is_err());
        let p =
            parse(&json!({"stats":{"lifetime_tokens":-1,"longest_running_turn_sec":-3}})).unwrap();
        assert_eq!(p.lifetime_tokens, None);
        assert_eq!(p.longest_running_turn_seconds, None);
        assert!(parse(&json!({"stats":{"daily_usage_buckets":[{"start_date":"2026-09-30","tokens":1},{"start_date":"2026-09-30","tokens":2}]}})).is_err());
    }
}
