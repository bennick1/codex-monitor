//! Native lifecycle for the temporary, tray-anchored view of `widget`.
//! No additional WebView or local-command capability is introduced.
use crate::{
    models::{ProviderSnapshot, UsageWindow, WidgetPreferences},
    AppState, WidgetRect,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
#[cfg(any(not(target_os = "macos"), test))]
use tauri::PhysicalSize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};

// Match the expanded floating QuotaCard: 306 px content + 4 px on each side.
pub const WINDOW_WIDTH: f64 = crate::EXPANDED_LOGICAL_SIZE + 2.0 * crate::EDGE_SAFE_INSET_LOGICAL;

pub struct MenubarState {
    height: Mutex<f64>,
    floating_rect: Mutex<Option<WidgetRect>>,
    menu_open: AtomicBool,
    tray_pressed: AtomicBool,
    visible_at_press: AtomicBool,
}

impl Default for MenubarState {
    fn default() -> Self {
        Self {
            height: Mutex::new(
                crate::EXPANDED_LOGICAL_HEIGHT + 2.0 * crate::EDGE_SAFE_INSET_LOGICAL,
            ),
            floating_rect: Mutex::new(None),
            menu_open: AtomicBool::new(false),
            tray_pressed: AtomicBool::new(false),
            visible_at_press: AtomicBool::new(false),
        }
    }
}

pub fn enabled(app: &AppHandle) -> bool {
    cfg!(target_os = "macos")
        && app
            .try_state::<AppState>()
            .is_some_and(|s| crate::preferences_lock(&s).display_mode == "menubar")
}

pub fn set_menu_open(app: &AppHandle, open: bool) {
    if let Some(state) = app.try_state::<MenubarState>() {
        state.menu_open.store(open, Ordering::Release);
    }
}

pub fn menu_is_open(app: &AppHandle) -> bool {
    if app
        .try_state::<MenubarState>()
        .is_some_and(|s| s.menu_open.load(Ordering::Acquire))
    {
        return true;
    }
    #[cfg(target_os = "macos")]
    {
        crate::macos_widget::menu_is_tracking(app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

pub fn valid_window(window: Option<&UsageWindow>) -> Option<&UsageWindow> {
    window
        .filter(|w| w.remaining_percent.is_finite() && (0.0..=100.0).contains(&w.remaining_percent))
}

pub fn percent(value: f64) -> String {
    if !value.is_finite() || !(0.0..=100.0).contains(&value) {
        return "—".into();
    }
    if value > 0.0 && value < 1.0 {
        return "<1%".into();
    }
    format!("{}%", value.floor() as u8)
}

pub fn period_label(seconds: u64, english: bool) -> String {
    if seconds == 0 {
        return if english { "Period" } else { "周期" }.into();
    }
    if seconds == 604_800 {
        return if english { "Wk" } else { "周" }.into();
    }
    if seconds.is_multiple_of(86_400) {
        return format!("{}{}", seconds / 86_400, if english { "d" } else { "天" });
    }
    if seconds.is_multiple_of(3_600) {
        return format!("{}{}", seconds / 3_600, if english { "h" } else { "小时" });
    }
    if seconds.is_multiple_of(60) {
        return format!("{}{}", seconds / 60, if english { "m" } else { "分钟" });
    }
    format!("{}{}", seconds, if english { "s" } else { "秒" })
}

pub fn title(snapshot: Option<&ProviderSnapshot>, preferences: &WidgetPreferences) -> String {
    let Some(s) = snapshot else {
        return "—".into();
    };
    let expired = s.status == "stale"
        && chrono::DateTime::parse_from_rfc3339(&s.updated_at)
            .map(|at| chrono::Utc::now().signed_duration_since(at).num_minutes() >= 30)
            .unwrap_or(true);
    if !matches!(s.status.as_str(), "ok" | "stale") || expired {
        return "—".into();
    }
    let short = valid_window(s.short_window.as_ref());
    let weekly = valid_window(s.weekly_window.as_ref());
    let selected: Vec<_> = match (short, weekly, preferences.menubar_quota_display.as_str()) {
        (Some(a), Some(b), "both") => vec![a, b],
        (_, Some(b), "weekly") => vec![b],
        (Some(a), _, _) => vec![a],
        (_, Some(b), _) => vec![b],
        _ => vec![],
    };
    let text = selected
        .iter()
        .map(|w| {
            format!(
                "{} {}",
                period_label(w.window_seconds, preferences.language == "en"),
                percent(w.remaining_percent)
            )
        })
        .collect::<Vec<_>>()
        .join(" · ");
    if text.is_empty() {
        "—".into()
    } else {
        text
    }
}

pub fn update_tray(app: &AppHandle, _snapshots: &[ProviderSnapshot]) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        // Preference commits from menus/IPC run on the main thread. Resolve
        // against the newest cache here, so background refreshes cannot save
        // an older preference copy over a simultaneous user's edit.
        update_tray_on_main(&handle, &crate::quota_service::cached(&handle));
    });
}

fn update_tray_on_main(app: &AppHandle, snapshots: &[ProviderSnapshot]) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    // Only a confirmed successful response can change capability preference.
    // Missing/failed refreshes and the initial loading epoch never rewrite it.
    if let Some(snapshot) = snapshots
        .iter()
        .find(|s| s.provider == "codex" && s.status == "ok")
    {
        let mut saved = crate::preferences_lock(&state);
        let fallback = confirmed_selection(snapshot, &saved.menubar_quota_display);
        if fallback != saved.menubar_quota_display {
            let mut next = saved.clone();
            next.menubar_quota_display = fallback;
            if crate::persist_preferences(&state.preferences_path, &next).is_ok() {
                *saved = next.clone();
                let _ = app.emit_to("widget", "preferences-changed", next);
            }
        }
    }
    let preferences = crate::preferences_lock(&state).clone();
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    let snapshot = snapshots.iter().find(|s| s.provider == "codex");
    let value = title(snapshot, &preferences);
    #[cfg(target_os = "macos")]
    let _ = tray.set_title(Some(if preferences.display_mode == "menubar" {
        value.as_str()
    } else {
        ""
    }));
    let status = snapshot.map(|s| s.status.as_str()).unwrap_or("loading");
    let english = preferences.language == "en";
    let status_text = match (status, english) {
        ("stale", false) => "数据已过期，正在重试",
        ("stale", true) => "Stale data; retrying",
        ("signed_out", false) => "请登录 Codex",
        ("signed_out", true) => "Sign in to Codex",
        ("loading", false) => "正在获取额度",
        ("loading", true) => "Loading quota",
        ("ok", _) => "",
        (_, false) => "额度暂不可用",
        (_, true) => "Quota unavailable",
    };
    let updated = snapshot
        .filter(|s| matches!(s.status.as_str(), "ok" | "stale"))
        .map(|s| {
            format!(
                "\n{}: {}",
                if english {
                    "Last success"
                } else {
                    "最后成功更新"
                },
                s.updated_at
            )
        })
        .unwrap_or_default();
    let _ = tray.set_tooltip(Some(format!(
        "Codex Monitor · {value}\n{status_text}{updated}"
    )));
    let _ = crate::operations_menu::refresh(app);
}

fn confirmed_selection(snapshot: &ProviderSnapshot, current: &str) -> String {
    if snapshot.status != "ok" {
        return current.into();
    }
    match (
        valid_window(snapshot.short_window.as_ref()),
        valid_window(snapshot.weekly_window.as_ref()),
    ) {
        (Some(_), None) => "short".into(),
        (None, Some(_)) => "weekly".into(),
        _ => current.into(),
    }
}

// All inputs/outputs use physical desktop coordinates. Negative monitor origins
// are valid; fit against the selected monitor's work area, never screen (0,0).
#[cfg(any(not(target_os = "macos"), test))]
fn placement(
    anchor: (f64, f64, f64, f64),
    origin: PhysicalPosition<i32>,
    bounds: PhysicalSize<u32>,
    scale: f64,
    height: f64,
) -> WidgetRect {
    let inset = (4.0 * scale).round() as i32;
    let width = (WINDOW_WIDTH * scale)
        .round()
        .min(f64::from(bounds.width))
        .max(1.0) as u32;
    let height = (height * scale)
        .round()
        .min(f64::from(bounds.height))
        .max(1.0) as u32;
    let min_x = origin.x;
    let min_y = origin.y;
    let max_x = origin.x + bounds.width.saturating_sub(width) as i32;
    let max_y = origin.y + bounds.height.saturating_sub(height) as i32;
    WidgetRect {
        position: PhysicalPosition::new(
            (anchor.0 + anchor.2 / 2.0 - f64::from(width) / 2.0)
                .round()
                .clamp(f64::from(min_x), f64::from(max_x)) as i32,
            ((anchor.1 + anchor.3).round() as i32 + inset).clamp(min_y, max_y),
        ),
        size: PhysicalSize::new(width, height),
    }
}

#[cfg(target_os = "macos")]
fn position(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or("widget unavailable")?;
    let height = *app
        .state::<MenubarState>()
        .height
        .lock()
        .map_err(|_| "panel unavailable")?;
    crate::macos_widget::position_menubar(&window, height)
}

#[cfg(not(target_os = "macos"))]
fn position(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or("widget unavailable")?;
    let tray = app.tray_by_id("main").ok_or("tray unavailable")?;
    let rect = tray
        .rect()
        .map_err(|_| "tray anchor unavailable")?
        .ok_or("tray anchor unavailable")?;
    let origin = rect.position.to_physical::<f64>(1.0);
    let size = rect.size.to_physical::<f64>(1.0);
    let center = (origin.x + size.width / 2.0, origin.y + size.height / 2.0);
    let monitors = window
        .available_monitors()
        .map_err(|_| "monitor unavailable")?;
    let monitor = monitors
        .iter()
        .min_by(|a, b| {
            let distance = |m: &tauri::Monitor| {
                let p = m.position();
                let s = m.size();
                let x = center
                    .0
                    .clamp(f64::from(p.x), f64::from(p.x) + f64::from(s.width));
                let y = center
                    .1
                    .clamp(f64::from(p.y), f64::from(p.y) + f64::from(s.height));
                (center.0 - x).powi(2) + (center.1 - y).powi(2)
            };
            distance(a).total_cmp(&distance(b))
        })
        .ok_or("monitor unavailable")?;
    let height = *app
        .state::<MenubarState>()
        .height
        .lock()
        .map_err(|_| "panel unavailable")?;
    let area = monitor.work_area();
    let rect = placement(
        (origin.x, origin.y, size.width, size.height),
        area.position,
        area.size,
        monitor.scale_factor(),
        height,
    );
    window
        .set_min_size(None::<tauri::LogicalSize<f64>>)
        .map_err(|_| "panel size unavailable")?;
    window
        .set_max_size(None::<tauri::LogicalSize<f64>>)
        .map_err(|_| "panel size unavailable")?;
    window
        .set_size(rect.size)
        .map_err(|_| "panel size unavailable")?;
    window
        .set_position(rect.position)
        .map_err(|_| "panel position unavailable")?;
    Ok(())
}

pub fn show(app: &AppHandle) -> Result<(), String> {
    if !enabled(app) {
        return Ok(());
    }
    position(app)?;
    let window = app
        .get_webview_window("widget")
        .ok_or("widget unavailable")?;
    window
        .set_ignore_cursor_events(false)
        .map_err(|_| "panel input unavailable")?;
    #[cfg(target_os = "macos")]
    crate::macos_widget::set_always_on_top(&window, true)?;
    let was_visible = window.is_visible().unwrap_or(false);
    window.show().map_err(|_| "panel unavailable")?;
    window.set_focus().map_err(|_| "panel focus unavailable")?;
    if !was_visible {
        let _ = window.emit("menubar-opened", ());
    }
    debug_note("panel shown by explicit entry");
    Ok(())
}

pub fn toggle(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or("widget unavailable")?;
    if window.is_visible().unwrap_or(false) {
        hide_menubar_panel(app.clone())
    } else {
        show(app)
    }
}

pub fn begin_tray_click(app: &AppHandle) {
    if let Some(state) = app.try_state::<MenubarState>() {
        state.visible_at_press.store(
            app.get_webview_window("widget")
                .is_some_and(|w| w.is_visible().unwrap_or(false)),
            Ordering::Release,
        );
        state.tray_pressed.store(true, Ordering::Release);
    }
}

pub fn finish_tray_click(app: &AppHandle, control: bool) -> Result<(), String> {
    let state = app.state::<MenubarState>();
    let pressed = state.tray_pressed.swap(false, Ordering::AcqRel);
    if control {
        return crate::operations_menu::open_at_pointer(app.clone());
    }
    if !pressed {
        return toggle(app);
    }
    if state.visible_at_press.load(Ordering::Acquire) {
        hide_menubar_panel(app.clone())
    } else {
        show(app)
    }
}

#[tauri::command]
pub fn hide_menubar_panel(app: AppHandle) -> Result<(), String> {
    if enabled(&app) {
        let window = app
            .get_webview_window("widget")
            .ok_or("widget unavailable")?;
        window.hide().map_err(|_| "could not close panel")?;
        if !window.is_visible().unwrap_or(true) {
            debug_note("panel hidden");
        }
    }
    Ok(())
}

pub fn dismiss(app: &AppHandle) {
    let tray_pressed = app
        .try_state::<MenubarState>()
        .is_some_and(|state| state.tray_pressed.load(Ordering::Acquire));
    if enabled(app) && !tray_pressed && !menu_is_open(app) {
        let _ = hide_menubar_panel(app.clone());
    }
}

fn debug_note(note: &str) {
    if cfg!(debug_assertions)
        && std::env::var("CODEX_MONITOR_SYNTHETIC_QUOTA").as_deref() == Ok("1")
    {
        eprintln!("menubar QA: {note}");
    }
}

#[tauri::command]
pub fn resize_menubar_panel(app: AppHandle, height: f64) -> Result<(), String> {
    if !enabled(&app) {
        return Ok(());
    }
    if !height.is_finite() {
        return Err("invalid panel height".into());
    }
    *app.state::<MenubarState>()
        .height
        .lock()
        .map_err(|_| "panel unavailable")? = height.clamp(160.0, 760.0);
    position(&app)
}

#[tauri::command]
pub fn get_desktop_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "other"
    }
}

pub fn apply_mode(
    app: &AppHandle,
    previous: &WidgetPreferences,
    next: &WidgetPreferences,
) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or("widget unavailable")?;
    if next.display_mode == "menubar" {
        if !cfg!(target_os = "macos") {
            return Err("menu bar mode requires macOS".into());
        }
        let tray = app.tray_by_id("main").ok_or("tray unavailable")?;
        tray.set_visible(true).map_err(|_| "menu bar unavailable")?;
        if previous.display_mode != "menubar" {
            // Save the floating geometry even when coming through sidebar.
            if previous.display_mode == "sidebar" {
                crate::sidebar::apply_mode(app, previous, next)?;
            }
            *app.state::<MenubarState>()
                .floating_rect
                .lock()
                .map_err(|_| "panel unavailable")? = Some(crate::current_widget_rect(&window)?);
            window.hide().map_err(|_| "could not hide widget")?;
        }
        crate::sidebar_glass::clear_on_main(app);
        window
            .set_ignore_cursor_events(false)
            .map_err(|_| "panel input unavailable")?;
        // Resolve a real anchor before accepting/saving the mode transition.
        position(app)?;
    } else {
        if previous.display_mode == "menubar" {
            window.hide().map_err(|_| "could not hide panel")?;
            if let Some(rect) = app
                .state::<MenubarState>()
                .floating_rect
                .lock()
                .map_err(|_| "panel unavailable")?
                .take()
            {
                window
                    .set_size(rect.size)
                    .map_err(|_| "widget size unavailable")?;
                window
                    .set_position(rect.position)
                    .map_err(|_| "widget position unavailable")?;
            } else {
                window
                    .set_size(tauri::LogicalSize::new(80.0, 80.0))
                    .map_err(|_| "widget size unavailable")?;
                if let Some((x, y)) = next.floating_position {
                    window
                        .set_position(PhysicalPosition::new(x, y))
                        .map_err(|_| "widget position unavailable")?;
                } else {
                    window.center().map_err(|_| "widget position unavailable")?;
                }
            }
            #[cfg(target_os = "macos")]
            crate::macos_widget::ensure_visible(&window)?;
            // The temporary panel is raised while open. Restore the saved
            // level for either legacy host before revealing its window.
            #[cfg(target_os = "macos")]
            crate::macos_widget::set_always_on_top(&window, next.always_on_top)?;
            *app.state::<AppState>()
                .geometry
                .lock()
                .map_err(|_| "widget unavailable")? = None;
        }
        crate::sidebar::apply_mode(app, previous, next)?;
        if next.display_mode == "floating" {
            window
                .set_min_size(Some(tauri::LogicalSize::new(80.0, 80.0)))
                .map_err(|_| "widget size unavailable")?;
            window
                .set_max_size(Some(tauri::LogicalSize::new(314.0, 514.0)))
                .map_err(|_| "widget size unavailable")?;
            window
                .set_ignore_cursor_events(next.locked)
                .map_err(|_| "widget input unavailable")?;
            #[cfg(target_os = "macos")]
            crate::macos_widget::set_always_on_top(&window, next.always_on_top)?;
            if previous.display_mode == "menubar" {
                crate::show_widget(&window);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn weekly_only_and_failure_titles_follow_actual_windows_and_last_success() {
        let mut snapshot = ProviderSnapshot::failure("ok", "");
        snapshot.weekly_window = Some(UsageWindow {
            remaining_percent: 42.9,
            window_seconds: 604800,
            resets_at: None,
        });
        let mut prefs = WidgetPreferences::default();
        assert_eq!(confirmed_selection(&snapshot, "both"), "weekly");
        assert_eq!(title(Some(&snapshot), &prefs), "周 42%");
        snapshot.short_window = Some(UsageWindow {
            remaining_percent: 0.7,
            window_seconds: 7200,
            resets_at: None,
        });
        assert_eq!(title(Some(&snapshot), &prefs), "2小时 <1%");
        prefs.menubar_quota_display = "both".into();
        assert_eq!(title(Some(&snapshot), &prefs), "2小时 <1% · 周 42%");
        snapshot.status = "stale".into();
        assert_eq!(confirmed_selection(&snapshot, "both"), "both");
        assert_eq!(title(Some(&snapshot), &prefs), "2小时 <1% · 周 42%");
        snapshot.updated_at = (chrono::Utc::now() - chrono::Duration::minutes(31)).to_rfc3339();
        assert_eq!(title(Some(&snapshot), &prefs), "—");
        snapshot.status = "signed_out".into();
        assert_eq!(title(Some(&snapshot), &prefs), "—");
        assert_eq!(title(None, &prefs), "—");
    }
    #[test]
    fn compact_percent_does_not_round_up_or_invent_values() {
        for (v, expected) in [
            (0.0, "0%"),
            (0.001, "<1%"),
            (0.99, "<1%"),
            (1.99, "1%"),
            (99.99, "99%"),
            (100.0, "100%"),
            (-1.0, "—"),
            (101.0, "—"),
            (f64::NAN, "—"),
            (f64::INFINITY, "—"),
        ] {
            assert_eq!(percent(v), expected);
        }
    }
    #[test]
    fn actual_periods_are_named_without_assuming_five_hours() {
        assert_eq!(period_label(604800, false), "周");
        assert_eq!(period_label(7200, false), "2小时");
        assert_eq!(period_label(90, true), "90s");
    }
    #[test]
    fn anchored_bounds_include_negative_monitors_retina_and_tall_content() {
        let rect = placement(
            (-1500.0, 0.0, 150.0, 48.0),
            PhysicalPosition::new(-1600, 48),
            PhysicalSize::new(1600, 1100),
            2.0,
            260.0,
        );
        assert_eq!(rect.position.x, -1600);
        assert_eq!(rect.position.y, 56);
        assert_eq!(rect.size.width, 628);
        let edge = placement(
            (1590.0, 0.0, 40.0, 24.0),
            PhysicalPosition::new(0, 24),
            PhysicalSize::new(1600, 876),
            1.0,
            760.0,
        );
        assert_eq!(edge.position.x, 1286);
        assert_eq!(edge.position.y, 28);
        let tiny = placement(
            (0.0, 0.0, 40.0, 24.0),
            PhysicalPosition::new(0, 24),
            PhysicalSize::new(300, 240),
            1.0,
            760.0,
        );
        assert_eq!(tiny.size, PhysicalSize::new(300, 240));
        assert_eq!(tiny.position.y, 24);
    }
}
