//! One command tree for the tray's native menu and the panel's More button.
//! The tree is rebuilt from committed preferences, never from optimistic checks.
#[cfg(not(target_os = "macos"))]
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, Wry,
};
use tauri_plugin_autostart::ManagerExt;

use crate::{models::ProviderSnapshot, models::WidgetPreferences, AppState};

#[derive(Debug, PartialEq)]
enum Entry {
    Command {
        id: String,
        title: String,
        checked: Option<bool>,
    },
    Group {
        title: String,
        children: Vec<Entry>,
    },
    Separator,
}

impl Entry {
    fn command(id: impl Into<String>, title: impl Into<String>) -> Self {
        Self::Command {
            id: id.into(),
            title: title.into(),
            checked: None,
        }
    }

    fn check(id: impl Into<String>, title: impl Into<String>, checked: bool) -> Self {
        Self::Command {
            id: id.into(),
            title: title.into(),
            checked: Some(checked),
        }
    }

    fn group(title: impl Into<String>, children: Vec<Self>) -> Self {
        Self::Group {
            title: title.into(),
            children,
        }
    }
}

fn has_two_windows(snapshots: &[ProviderSnapshot]) -> bool {
    let valid = |window: &Option<crate::models::UsageWindow>| {
        window.as_ref().is_some_and(|value| {
            value.remaining_percent.is_finite() && (0.0..=100.0).contains(&value.remaining_percent)
        })
    };
    snapshots.iter().any(|snapshot| {
        snapshot.provider == "codex"
            && matches!(snapshot.status.as_str(), "ok" | "stale")
            && valid(&snapshot.short_window)
            && valid(&snapshot.weekly_window)
    })
}

fn entries(
    preferences: &WidgetPreferences,
    snapshots: &[ProviderSnapshot],
    autostart: bool,
    supports_menubar: bool,
) -> Vec<Entry> {
    let english = preferences.language == "en";
    let text = |zh, en| if english { en } else { zh };
    let mut modes = Vec::new();
    if supports_menubar {
        modes.push(Entry::check(
            "mode-menubar",
            text("仅菜单栏", "Menu bar only"),
            preferences.display_mode == "menubar",
        ));
    }
    modes.extend([
        Entry::check(
            "mode-floating",
            text("悬浮窗", "Floating widget"),
            preferences.display_mode == "floating",
        ),
        Entry::check(
            "mode-sidebar",
            text("侧边栏", "Sidebar"),
            preferences.display_mode == "sidebar",
        ),
    ]);

    let skins = vec![
        Entry::check(
            "skin-default",
            text("默认", "Default"),
            preferences.selected_skin == "default",
        ),
        Entry::check("skin-blur", "Blur", preferences.selected_skin == "blur"),
        Entry::check(
            "skin-computer",
            "Computer",
            preferences.selected_skin == "computer",
        ),
        Entry::check(
            "skin-mecha-light",
            text("浅色机甲", "Mecha Light"),
            preferences.selected_skin == "mecha-light",
        ),
        Entry::Separator,
        Entry::group(
            text("系统外观", "Appearance"),
            vec![
                Entry::check(
                    "appearance-system",
                    text("跟随系统", "Follow system"),
                    preferences.appearance == "system",
                ),
                Entry::check(
                    "appearance-light",
                    text("浅色", "Light"),
                    preferences.appearance == "light",
                ),
                Entry::check(
                    "appearance-dark",
                    text("深色", "Dark"),
                    preferences.appearance == "dark",
                ),
            ],
        ),
    ];

    let mut settings = Vec::new();
    if supports_menubar && has_two_windows(snapshots) {
        let snapshot = snapshots.iter().find(|value| value.provider == "codex");
        let period_title = |window: Option<&crate::models::UsageWindow>| match window
            .map(|value| value.window_seconds)
            .filter(|value| *value > 0)
        {
            Some(seconds) => format!(
                "{}{}",
                crate::menubar::period_label(seconds, english),
                text("额度", " quota")
            ),
            None => text("周期待确认", "Period pending").into(),
        };
        settings.push(Entry::group(
            text("菜单栏额度显示", "Menu bar quota"),
            vec![
                Entry::check(
                    "quota-short",
                    period_title(snapshot.and_then(|value| value.short_window.as_ref())),
                    preferences.menubar_quota_display == "short",
                ),
                Entry::check(
                    "quota-weekly",
                    period_title(snapshot.and_then(|value| value.weekly_window.as_ref())),
                    preferences.menubar_quota_display == "weekly",
                ),
                Entry::check(
                    "quota-both",
                    text("双周期", "Both periods"),
                    preferences.menubar_quota_display == "both",
                ),
            ],
        ));
    }
    settings.extend([
        Entry::group(
            text("语言", "Language"),
            vec![
                Entry::check("language-zh-CN", "简体中文", !english),
                Entry::check("language-en", "English", english),
            ],
        ),
        Entry::check("autostart", text("开机启动", "Start at login"), autostart),
        Entry::check(
            "auto-check-updates",
            text("自动检查更新", "Check for updates automatically"),
            preferences.auto_check_updates,
        ),
        Entry::check(
            "pin",
            text("固定 Codex 服务", "Pin Codex provider"),
            preferences.pinned_provider.as_deref() == Some("codex"),
        ),
        Entry::Separator,
        Entry::check(
            "deepseek-enabled",
            text("启用 DeepSeek", "Enable DeepSeek"),
            preferences.deepseek_enabled,
        ),
        Entry::command(
            "deepseek-login",
            text("登录 / 管理 DeepSeek", "Sign in / manage DeepSeek"),
        ),
    ]);
    if preferences.deepseek_enabled {
        settings.push(Entry::command(
            "deepseek-disconnect",
            text("退出 DeepSeek 登录", "Sign out of DeepSeek"),
        ));
    }

    if preferences.display_mode == "floating" {
        let mut opacity: Vec<_> = crate::OPACITY_PERCENT_OPTIONS
            .into_iter()
            .map(|value| {
                Entry::check(
                    format!("opacity-{value}"),
                    format!("{value}%"),
                    preferences.opacity_percent == value,
                )
            })
            .collect();
        opacity.push(Entry::command(
            "opacity-reset",
            text("恢复 100%", "Reset to 100%"),
        ));
        settings.extend([
            Entry::Separator,
            Entry::group(
                text("悬浮窗", "Floating widget"),
                vec![
                    Entry::check(
                        "locked",
                        text("锁定并穿透鼠标", "Lock and pass clicks through"),
                        preferences.locked,
                    ),
                    Entry::check(
                        "always-on-top",
                        text("窗口置顶", "Keep window on top"),
                        preferences.always_on_top,
                    ),
                    Entry::check(
                        "stay-expanded",
                        text("保持展开", "Keep expanded"),
                        preferences.stay_expanded,
                    ),
                    Entry::group(text("不透明度", "Opacity"), opacity),
                ],
            ),
        ]);
    } else if preferences.display_mode == "sidebar" {
        settings.extend([
            Entry::Separator,
            Entry::group(
                text("侧边栏", "Sidebar"),
                vec![
                    Entry::group(
                        text("位置", "Position"),
                        [
                            ("left", text("左侧", "Left")),
                            ("right", text("右侧", "Right")),
                            ("top", text("顶部", "Top")),
                        ]
                        .into_iter()
                        .map(|(side, title)| {
                            Entry::check(
                                format!("sidebar-side-{side}"),
                                title,
                                preferences.sidebar_side == side,
                            )
                        })
                        .collect(),
                    ),
                    Entry::group(
                        text("大小", "Size"),
                        [80, 90, 100, 110, 120, 130]
                            .into_iter()
                            .map(|value| {
                                Entry::check(
                                    format!("sidebar-scale-{value}"),
                                    format!("{value}%"),
                                    (preferences.sidebar_scale * 100.0 - f64::from(value)).abs()
                                        < 0.5,
                                )
                            })
                            .collect(),
                    ),
                    Entry::group(
                        text("背景不透明度", "Background opacity"),
                        [20, 30, 40, 50, 60, 70, 80, 90, 100]
                            .into_iter()
                            .map(|value| {
                                Entry::check(
                                    format!("sidebar-opacity-{value}"),
                                    format!("{value}%"),
                                    (preferences.sidebar_opacity * 100.0 - f64::from(value)).abs()
                                        < 0.5,
                                )
                            })
                            .collect(),
                    ),
                    Entry::check(
                        "sidebar-glass",
                        text("毛玻璃", "Glass effect"),
                        preferences.sidebar_glass_enabled,
                    ),
                    Entry::check(
                        "sidebar-codex",
                        text("显示 Codex", "Show Codex"),
                        preferences.sidebar_show_codex,
                    ),
                    Entry::check(
                        "sidebar-deepseek",
                        text("显示 DeepSeek", "Show DeepSeek"),
                        preferences.sidebar_show_deepseek,
                    ),
                ],
            ),
        ]);
    }

    let mut result = vec![
        Entry::group(text("展示方式", "Display mode"), modes),
        Entry::group(text("外观与皮肤", "Appearance and skin"), skins),
        Entry::group(text("偏好设置", "Preferences"), settings),
        Entry::Separator,
    ];
    if preferences.display_mode != "menubar" {
        result.push(Entry::command(
            "show",
            if preferences.display_mode == "sidebar" {
                text("临时显示 / 隐藏侧边栏", "Show / hide sidebar temporarily")
            } else {
                text("临时显示 / 隐藏悬浮窗", "Show / hide widget temporarily")
            },
        ));
    }
    result.extend([
        // The shared expanded card keeps its established header. Manual
        // online refresh remains reachable here without adding a new toolbar.
        Entry::command("refresh", text("立即刷新", "Refresh now")),
        Entry::command("updates", text("检查更新", "Check for updates")),
        Entry::command("quit", text("退出 Codex Monitor", "Quit Codex Monitor")),
    ]);
    result
}

fn native_entry(app: &AppHandle, entry: Entry) -> tauri::Result<MenuItemKind<Wry>> {
    match entry {
        Entry::Command {
            id,
            title,
            checked: Some(checked),
        } => Ok(MenuItemKind::Check(CheckMenuItem::with_id(
            app,
            id,
            title,
            true,
            checked,
            None::<&str>,
        )?)),
        Entry::Command {
            id,
            title,
            checked: None,
        } => Ok(MenuItemKind::MenuItem(MenuItem::with_id(
            app,
            id,
            title,
            true,
            None::<&str>,
        )?)),
        Entry::Group { title, children } => {
            let menu = Submenu::new(app, title, true)?;
            for child in children {
                menu.append(&native_entry(app, child)?)?;
            }
            Ok(MenuItemKind::Submenu(menu))
        }
        Entry::Separator => Ok(MenuItemKind::Predefined(PredefinedMenuItem::separator(
            app,
        )?)),
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let preferences = crate::preferences_lock(&app.state::<AppState>()).clone();
    let snapshots = crate::quota_service::cached(app);
    let menu = Menu::new(app)?;
    for entry in entries(
        &preferences,
        &snapshots,
        app.autolaunch().is_enabled().unwrap_or(false),
        cfg!(target_os = "macos"),
    ) {
        menu.append(&native_entry(app, entry)?)?;
    }
    Ok(menu)
}

#[cfg(not(target_os = "macos"))]
static REFRESH_QUEUED: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
pub fn refresh(_app: &AppHandle) -> Result<(), String> {
    // macOS builds the shared command tree when explicitly opened. Attaching
    // an NSMenu here would let AppKit steal ordinary left clicks again.
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn refresh(app: &AppHandle) -> Result<(), String> {
    if crate::menubar::menu_is_open(app) {
        // Keep the tracked NSMenu alive. Poll the actual tracking state instead
        // of guessing that a menu must have closed after a fixed delay.
        if !REFRESH_QUEUED.swap(true, Ordering::SeqCst) {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                while crate::menubar::menu_is_open(&handle) {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                REFRESH_QUEUED.store(false, Ordering::SeqCst);
                if refresh(&handle).is_err() {
                    eprintln!("operation menu refresh failed");
                }
            });
        }
        return Ok(());
    }
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(build(app).map_err(|_| "operation menu unavailable")?))
            .map_err(|_| "operation menu unavailable")?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_operations_menu(app: AppHandle) -> Result<(), String> {
    popup(&app, true)
}

pub fn open_at_pointer(app: AppHandle) -> Result<(), String> {
    popup(&app, false)
}

fn popup(app: &AppHandle, anchor_to_panel: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or("widget unavailable")?;
    let menu = build(app).map_err(|_| "operation menu unavailable")?;
    // The More button has a stable local anchor even when opened with Enter
    // while the pointer is on a different display. Tray Control-click follows
    // the pointer and does not need to make the hidden panel visible.
    let anchor = if anchor_to_panel {
        let scale = window
            .scale_factor()
            .map_err(|_| "panel scale unavailable")?;
        let width = f64::from(
            window
                .inner_size()
                .map_err(|_| "panel size unavailable")?
                .width,
        ) / scale;
        Some(tauri::LogicalPosition::new((width - 40.0).max(0.0), 40.0))
    } else {
        None
    };
    crate::menubar::set_menu_open(app, true);
    // On macOS and Windows popup_menu returns after native tracking ends.
    // Keep the panel alive while a submenu or command owns keyboard focus.
    let result = match anchor {
        Some(position) => window.popup_menu_at(&menu, position),
        None => window.popup_menu(&menu),
    }
    .map_err(|_| "operation menu unavailable".into());
    crate::menubar::set_menu_open(app, false);
    let _ = refresh(app);
    result
}

fn preference_command(preferences: &WidgetPreferences, id: &str) -> Option<WidgetPreferences> {
    if let Some(next) = crate::preferences_for_theme_menu(preferences, id) {
        return Some(next);
    }
    if let Some(next) = crate::preferences_for_opacity_menu(preferences, id) {
        return Some(next);
    }
    let mut next = preferences.clone();
    match id {
        "mode-menubar" if cfg!(target_os = "macos") => next.display_mode = "menubar".into(),
        "mode-floating" => next.display_mode = "floating".into(),
        "mode-sidebar" => next.display_mode = "sidebar".into(),
        "skin-default" => next.selected_skin = "default".into(),
        "appearance-system" => next.appearance = "system".into(),
        "appearance-light" => next.appearance = "light".into(),
        "appearance-dark" => next.appearance = "dark".into(),
        "language-zh-CN" => next.language = "zh-CN".into(),
        "language-en" => next.language = "en".into(),
        "quota-short" => next.menubar_quota_display = "short".into(),
        "quota-weekly" => next.menubar_quota_display = "weekly".into(),
        "quota-both" => next.menubar_quota_display = "both".into(),
        "auto-check-updates" => next.auto_check_updates = !next.auto_check_updates,
        "deepseek-enabled" => next.deepseek_enabled = !next.deepseek_enabled,
        "stay-expanded" => next.stay_expanded = !next.stay_expanded,
        "pin" => {
            next.pinned_provider = if next.pinned_provider.is_some() {
                None
            } else {
                Some("codex".into())
            }
        }
        "sidebar-side-left" => next.sidebar_side = "left".into(),
        "sidebar-side-right" => next.sidebar_side = "right".into(),
        "sidebar-side-top" => next.sidebar_side = "top".into(),
        "sidebar-glass" => next.sidebar_glass_enabled = !next.sidebar_glass_enabled,
        "sidebar-codex" => next.sidebar_show_codex = !next.sidebar_show_codex,
        "sidebar-deepseek" => next.sidebar_show_deepseek = !next.sidebar_show_deepseek,
        _ => {
            if let Some(value) = id
                .strip_prefix("sidebar-scale-")
                .and_then(|s| s.parse::<u8>().ok())
                .filter(|v| [80, 90, 100, 110, 120, 130].contains(v))
            {
                next.sidebar_scale = f64::from(value) / 100.0;
            } else {
                let value = id
                    .strip_prefix("sidebar-opacity-")
                    .and_then(|s| s.parse::<u8>().ok())
                    .filter(|v| [20, 30, 40, 50, 60, 70, 80, 90, 100].contains(v))?;
                next.sidebar_opacity = f64::from(value) / 100.0;
            }
        }
    }
    Some(next.normalized())
}

fn run_command(app: &AppHandle, id: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let preferences = crate::preferences_lock(&state).clone();
    if let Some(next) = preference_command(&preferences, id) {
        return crate::set_preferences(next, app.clone(), state);
    }
    match id {
        "show" if preferences.display_mode != "menubar" => {
            let window = app
                .get_webview_window("widget")
                .ok_or("widget unavailable")?;
            if window.is_visible().unwrap_or(false) {
                // Hiding a sidebar restores its tray first, preserving an entry.
                if preferences.display_mode == "sidebar" {
                    app.tray_by_id("main")
                        .ok_or("tray unavailable")?
                        .set_visible(true)
                        .map_err(|_| "tray unavailable")?;
                }
                window.hide().map_err(|_| "widget unavailable")?;
                #[cfg(target_os = "macos")]
                crate::macos_widget::save_visibility(app);
            } else {
                crate::sidebar::recover(app)?;
            }
        }
        "refresh" => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::quota_service::refresh(&handle, true).await;
            });
        }
        "updates" => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if crate::updater::open_update_window(handle.clone())
                    .await
                    .is_err()
                {
                    report_error(&handle);
                }
            });
        }
        "deepseek-login" | "deepseek-disconnect" => {
            let handle = app.clone();
            let window = app
                .get_webview_window("widget")
                .ok_or("widget unavailable")?;
            let disconnect = id == "deepseek-disconnect";
            tauri::async_runtime::spawn(async move {
                let result = if disconnect {
                    crate::deepseek::disconnect_deepseek(window, handle.clone()).await
                } else {
                    crate::deepseek::open_deepseek_login(window, handle.clone()).await
                };
                if result.is_err() {
                    report_error(&handle);
                }
                let _ = refresh(&handle);
            });
        }
        "locked" if preferences.display_mode == "floating" => {
            crate::set_widget_locked(!preferences.locked, app.clone(), state)?;
        }
        "always-on-top" if preferences.display_mode == "floating" => {
            crate::set_widget_always_on_top(!preferences.always_on_top, app.clone(), state)?;
        }
        "autostart" => {
            let manager = app.autolaunch();
            let enabled = manager.is_enabled().map_err(|_| "autostart unavailable")?;
            if enabled {
                manager.disable()
            } else {
                manager.enable()
            }
            .map_err(|_| "autostart update failed")?;
        }
        "quit" => app.exit(0),
        _ => return Err("unsupported operation".into()),
    }
    Ok(())
}

fn report_error(app: &AppHandle) {
    eprintln!("operation could not be completed");
    let _ = app.emit_to("widget", "operation-failed", ());
}

pub fn handle(app: &AppHandle, id: &str) {
    if run_command(app, id).is_err() {
        report_error(app);
    }
    // Native check items may toggle themselves before the command completes.
    // Re-read persisted state after success or rollback, for both entry points.
    let _ = refresh(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flatten(entries: &[Entry]) -> Vec<(&str, Option<bool>)> {
        entries
            .iter()
            .flat_map(|entry| match entry {
                Entry::Command { id, checked, .. } => vec![(id.as_str(), *checked)],
                Entry::Group { children, .. } => flatten(children),
                Entry::Separator => vec![],
            })
            .collect()
    }

    fn command_title<'a>(entries: &'a [Entry], command: &str) -> Option<&'a str> {
        entries.iter().find_map(|entry| match entry {
            Entry::Command { id, title, .. } if id == command => Some(title.as_str()),
            Entry::Group { children, .. } => command_title(children, command),
            _ => None,
        })
    }

    fn weekly() -> ProviderSnapshot {
        let mut snapshot = ProviderSnapshot::failure("ok", "");
        snapshot.weekly_window = Some(crate::models::UsageWindow {
            remaining_percent: 42.0,
            resets_at: None,
            window_seconds: 604800,
        });
        snapshot
    }

    #[test]
    fn menubar_only_has_applicable_actions_and_one_selected_mode() {
        let preferences = WidgetPreferences {
            display_mode: "menubar".into(),
            ..Default::default()
        };
        let tree = entries(&preferences, &[weekly()], false, true);
        let commands = flatten(&tree);
        for absent in [
            "show",
            "locked",
            "always-on-top",
            "stay-expanded",
            "opacity-60",
            "quota-short",
            "quota-weekly",
            "quota-both",
            "releases",
        ] {
            assert!(
                !commands.iter().any(|(id, _)| *id == absent),
                "unexpected {absent}"
            );
        }
        for required in [
            "refresh",
            "mode-menubar",
            "mode-floating",
            "mode-sidebar",
            "deepseek-enabled",
            "deepseek-login",
            "updates",
            "quit",
        ] {
            assert!(
                commands.iter().any(|(id, _)| *id == required),
                "missing {required}"
            );
        }
        assert_eq!(
            commands
                .iter()
                .filter(|(id, checked)| id.starts_with("mode-") && *checked == Some(true))
                .count(),
            1
        );
    }

    #[test]
    fn dual_valid_windows_enable_persistent_choice_but_absence_is_not_capability() {
        let mut snapshot = weekly();
        snapshot.short_window = Some(crate::models::UsageWindow {
            remaining_percent: 0.5,
            resets_at: None,
            window_seconds: 7200,
        });
        let preferences = WidgetPreferences {
            menubar_quota_display: "both".into(),
            ..Default::default()
        };
        for status in ["ok", "stale"] {
            snapshot.status = status.into();
            let tree = entries(&preferences, &[snapshot.clone()], false, true);
            assert!(flatten(&tree).contains(&("quota-both", Some(true))));
        }
        snapshot.status = "signed_out".into();
        assert!(!has_two_windows(&[snapshot.clone()]));
        snapshot.status = "ok".into();
        snapshot.short_window.as_mut().unwrap().remaining_percent = f64::NAN;
        assert!(!has_two_windows(&[snapshot]));
    }

    #[test]
    fn period_choices_follow_observed_duration_and_keep_unknown_duration_explicit() {
        let mut snapshot = weekly();
        snapshot.short_window = Some(crate::models::UsageWindow {
            remaining_percent: 50.0,
            resets_at: None,
            window_seconds: 7200,
        });
        snapshot.weekly_window.as_mut().unwrap().window_seconds = 86400;
        let tree = entries(
            &WidgetPreferences::default(),
            &[snapshot.clone()],
            false,
            true,
        );
        assert_eq!(command_title(&tree, "quota-short"), Some("2小时额度"));
        assert_eq!(command_title(&tree, "quota-weekly"), Some("1天额度"));
        snapshot.short_window.as_mut().unwrap().window_seconds = 0;
        let tree = entries(&WidgetPreferences::default(), &[snapshot], false, true);
        assert_eq!(command_title(&tree, "quota-short"), Some("周期待确认"));
    }

    #[test]
    fn windows_menu_keeps_existing_modes_without_new_entry() {
        let tree = entries(&WidgetPreferences::default(), &[], false, false);
        let commands = flatten(&tree);
        assert!(!commands.iter().any(|(id, _)| *id == "mode-menubar"));
        assert!(commands.contains(&("mode-floating", Some(true))));
        assert!(commands.iter().any(|(id, _)| *id == "always-on-top"));
    }

    #[test]
    fn sidebar_controls_remain_available_and_pin_is_a_service_preference() {
        let original = WidgetPreferences {
            display_mode: "sidebar".into(),
            sidebar_scale: 1.2,
            sidebar_opacity: 0.7,
            sidebar_side: "top".into(),
            always_on_top: false,
            selected_skin: "computer".into(),
            opacity_percent: 65,
            ..Default::default()
        };
        let tree = entries(&original, &[], true, true);
        let commands = flatten(&tree);
        assert!(commands.contains(&("sidebar-scale-120", Some(true))));
        assert!(commands.contains(&("sidebar-opacity-70", Some(true))));
        assert!(commands.contains(&("sidebar-side-top", Some(true))));
        assert!(commands.contains(&("autostart", Some(true))));
        let pinned = preference_command(&original, "pin").unwrap();
        assert_eq!(pinned.pinned_provider.as_deref(), Some("codex"));
        assert!(!pinned.always_on_top);
        let floating = preference_command(&pinned, "mode-floating").unwrap();
        let restored = preference_command(&floating, "mode-sidebar").unwrap();
        assert_eq!(restored.sidebar_scale, original.sidebar_scale);
        assert_eq!(restored.sidebar_opacity, original.sidebar_opacity);
        assert_eq!(restored.sidebar_side, original.sidebar_side);
        assert_eq!(restored.selected_skin, original.selected_skin);
        assert_eq!(restored.opacity_percent, original.opacity_percent);
    }

    #[test]
    fn appearance_does_not_reset_skin_and_bad_commands_do_not_rewrite_preferences() {
        let original = WidgetPreferences {
            selected_skin: "mecha-light".into(),
            ..Default::default()
        };
        let next = preference_command(&original, "appearance-dark").unwrap();
        assert_eq!(next.appearance, "dark");
        assert_eq!(next.selected_skin, "mecha-light");
        assert!(preference_command(&original, "sidebar-opacity-0").is_none());
        assert!(preference_command(&original, "sidebar-scale-255").is_none());
        assert!(preference_command(&original, "quota-average").is_none());
    }
}
