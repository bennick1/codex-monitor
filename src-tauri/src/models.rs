use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub remaining_percent: f64,
    pub resets_at: Option<String>,
    pub window_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshot {
    pub provider: String,
    pub display_name: String,
    pub plan: Option<String>,
    pub short_window: Option<UsageWindow>,
    pub weekly_window: Option<UsageWindow>,
    pub reset_credits: Option<u64>,
    pub reset_credit_expires_at: Vec<String>,
    pub updated_at: String,
    pub status: String,
    pub message: Option<String>,
}

impl ProviderSnapshot {
    pub fn failure(status: &str, message: &str) -> Self {
        Self {
            provider: "codex".into(),
            display_name: "CODEX".into(),
            plan: None,
            short_window: None,
            weekly_window: None,
            reset_credits: None,
            reset_credit_expires_at: Vec::new(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            status: status.into(),
            message: Some(message.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WidgetPreferences {
    pub locked: bool,
    #[serde(default = "default_always_on_top")]
    pub always_on_top: bool,
    #[serde(default)]
    pub stay_expanded: bool,
    pub pinned_provider: Option<String>,
    pub auto_rotate_seconds: u64,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_appearance")]
    pub appearance: String,
    #[serde(default = "default_skin")]
    pub selected_skin: String,
    #[serde(
        default = "default_opacity_percent",
        deserialize_with = "deserialize_opacity_percent"
    )]
    pub opacity_percent: u8,
}

fn default_always_on_top() -> bool {
    true
}
fn default_language() -> String {
    "zh-CN".into()
}
fn default_appearance() -> String {
    "light".into()
}
fn default_skin() -> String {
    "default".into()
}
fn default_opacity_percent() -> u8 {
    100
}

fn normalize_opacity_percent(value: f64) -> u8 {
    if !value.is_finite() {
        return default_opacity_percent();
    }
    ((value.clamp(60.0, 100.0) / 5.0).round() * 5.0) as u8
}

fn deserialize_opacity_percent<'de, D>(deserializer: D) -> Result<u8, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // A malformed new field must not discard otherwise valid older settings.
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value
        .as_f64()
        .map(normalize_opacity_percent)
        .unwrap_or_else(default_opacity_percent))
}
impl Default for WidgetPreferences {
    fn default() -> Self {
        Self {
            locked: false,
            always_on_top: true,
            stay_expanded: false,
            pinned_provider: None,
            auto_rotate_seconds: 12,
            language: default_language(),
            appearance: default_appearance(),
            selected_skin: default_skin(),
            opacity_percent: default_opacity_percent(),
        }
    }
}

impl WidgetPreferences {
    pub fn normalized(mut self) -> Self {
        self.opacity_percent = normalize_opacity_percent(f64::from(self.opacity_percent));
        self.auto_rotate_seconds = self.auto_rotate_seconds.clamp(5, 300);
        if self.pinned_provider.as_deref() != Some("codex") {
            self.pinned_provider = None;
        }
        if self.language != "en" && self.language != "zh-CN" {
            self.language = default_language();
        }
        if self.appearance != "system" && self.appearance != "light" && self.appearance != "dark" {
            self.appearance = default_appearance();
        }
        if !matches!(
            self.selected_skin.as_str(),
            "default" | "blur" | "computer" | "mecha-light"
        ) {
            self.selected_skin = default_skin();
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opacity_normalization_handles_non_finite_boundaries_and_steps() {
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(normalize_opacity_percent(value), 100);
        }
        for (value, expected) in [
            (-1.0, 60),
            (0.0, 60),
            (59.9, 60),
            (60.0, 60),
            (62.49, 60),
            (62.5, 65),
            (79.0, 80),
            (80.0, 80),
            (97.5, 100),
            (100.0, 100),
            (150.0, 100),
        ] {
            assert_eq!(normalize_opacity_percent(value), expected);
        }
    }
}
