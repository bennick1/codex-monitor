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
    pub deepseek_enabled: bool,
    pub auto_check_updates: bool,
    pub display_mode: String,
    pub sidebar_side: String,
    pub sidebar_opacity: f64,
    pub sidebar_glass_enabled: bool,
    pub sidebar_scale: f64,
    pub sidebar_show_codex: bool,
    pub sidebar_show_deepseek: bool,
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
            deepseek_enabled: false,
            auto_check_updates: true,
            display_mode: "floating".into(),
            sidebar_side: "right".into(),
            sidebar_opacity: 0.9,
            sidebar_glass_enabled: true,
            sidebar_scale: 1.0,
            sidebar_show_codex: true,
            sidebar_show_deepseek: true,
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
        if self.display_mode != "sidebar" {
            self.display_mode = "floating".into();
        } else {
            // A sidebar is the only visible way back when its tray is hidden.
            self.locked = false;
        }
        if !matches!(self.sidebar_side.as_str(), "right" | "left" | "top") {
            self.sidebar_side = "right".into();
        }
        self.sidebar_opacity = if self.sidebar_opacity.is_finite() {
            self.sidebar_opacity.clamp(0.2, 1.0)
        } else {
            0.9
        };
        self.sidebar_scale = if self.sidebar_scale.is_finite() {
            self.sidebar_scale.clamp(0.8, 1.3)
        } else {
            1.0
        };
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
mod sidebar_preference_tests {
    use super::*;
    #[test]
    fn old_preferences_keep_floating_mode_and_sidebar_is_always_reachable() {
        let legacy: WidgetPreferences =
            serde_json::from_str(r#"{"locked":true,"selectedSkin":"blur"}"#).unwrap();
        assert_eq!(legacy.display_mode, "floating");
        assert_eq!(legacy.sidebar_side, "right");
        assert_eq!(legacy.sidebar_scale, 1.0);
        assert!(legacy.sidebar_glass_enabled);
        assert!(legacy.sidebar_show_codex && legacy.sidebar_show_deepseek);
        assert!(legacy.locked);
        let next = WidgetPreferences {
            display_mode: "sidebar".into(),
            sidebar_side: "invalid".into(),
            sidebar_opacity: 0.0,
            ..legacy
        }
        .normalized();
        assert!(!next.locked);
        assert_eq!(next.sidebar_opacity, 0.2);
        assert_eq!(next.sidebar_side, "right");
        assert_eq!(next.selected_skin, "blur");
    }

    #[test]
    fn sidebar_edges_survive_round_trip_and_unknown_edges_use_the_default() {
        for (side, expected) in [
            ("right", "right"),
            ("left", "left"),
            ("top", "top"),
            ("bottom", "right"),
            ("", "right"),
        ] {
            let preferences = WidgetPreferences {
                display_mode: "sidebar".into(),
                sidebar_side: side.into(),
                ..Default::default()
            }
            .normalized();
            assert_eq!(preferences.sidebar_side, expected);
            let saved = serde_json::to_string(&preferences).unwrap();
            let restored: WidgetPreferences = serde_json::from_str(&saved).unwrap();
            assert_eq!(restored.normalized().sidebar_side, expected);
        }
    }

    #[test]
    fn glass_choice_round_trips_without_rewriting_opacity_or_theme() {
        for enabled in [false, true] {
            let value = WidgetPreferences {
                sidebar_glass_enabled: enabled,
                sidebar_opacity: 0.7,
                appearance: "system".into(),
                ..Default::default()
            };
            let saved = serde_json::to_string(&value).unwrap();
            let restored: WidgetPreferences = serde_json::from_str(&saved).unwrap();
            let restored = restored.normalized();
            assert_eq!(restored.sidebar_glass_enabled, enabled);
            assert_eq!(restored.sidebar_opacity, 0.7);
            assert_eq!(restored.appearance, "system");
        }
    }

    #[test]
    fn sidebar_scale_is_bounded_and_non_finite_values_use_the_default() {
        for (scale, expected) in [
            (0.0, 0.8),
            (0.8, 0.8),
            (1.1, 1.1),
            (1.3, 1.3),
            (2.0, 1.3),
            (f64::NAN, 1.0),
            (f64::INFINITY, 1.0),
            (f64::NEG_INFINITY, 1.0),
        ] {
            let preferences = WidgetPreferences {
                sidebar_scale: scale,
                ..Default::default()
            }
            .normalized();
            assert_eq!(preferences.sidebar_scale, expected);
            let saved = serde_json::to_string(&preferences).unwrap();
            let restored: WidgetPreferences = serde_json::from_str(&saved).unwrap();
            assert_eq!(restored.sidebar_scale, expected);
        }
    }

    #[test]
    fn sidebar_visibility_survives_round_trip_without_changing_login_state() {
        for codex in [true, false] {
            for deepseek in [true, false] {
                let value = WidgetPreferences {
                    sidebar_show_codex: codex,
                    sidebar_show_deepseek: deepseek,
                    deepseek_enabled: true,
                    ..Default::default()
                };
                let saved = serde_json::to_string(&value).unwrap();
                let restored: WidgetPreferences = serde_json::from_str(&saved).unwrap();
                let restored = restored.normalized();
                assert_eq!(restored.sidebar_show_codex, codex);
                assert_eq!(restored.sidebar_show_deepseek, deepseek);
                assert!(restored.deepseek_enabled);
            }
        }
    }
}

#[cfg(test)]
mod updater_preferences_tests {
    use super::*;
    #[test]
    fn updates_default_on_and_false_survives_roundtrip() {
        let legacy: WidgetPreferences = serde_json::from_str("{}").unwrap();
        assert!(legacy.auto_check_updates);
        let disabled: WidgetPreferences =
            serde_json::from_str(r#"{"autoCheckUpdates":false}"#).unwrap();
        let saved = serde_json::to_string(&disabled.normalized()).unwrap();
        assert!(
            !serde_json::from_str::<WidgetPreferences>(&saved)
                .unwrap()
                .auto_check_updates
        );
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
