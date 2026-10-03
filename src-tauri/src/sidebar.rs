use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State};
use tauri_plugin_autostart::ManagerExt;

use crate::{models::WidgetPreferences, AppState, WidgetRect};

#[derive(Default)]
pub struct SidebarState {
    phase: Mutex<String>,
    floating_rect: Mutex<Option<WidgetRect>>,
    interactive_regions: Mutex<Option<(String, Vec<SidebarInputRect>)>>,
    effective_scale: Mutex<Option<f64>>,
    layout_side: Mutex<String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct SidebarInputRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl SidebarInputRect {
    fn is_valid(&self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.width.is_finite()
            && self.height.is_finite()
            && self.width > 0.0
            && self.height > 0.0
            && (self.x + self.width).is_finite()
            && (self.y + self.height).is_finite()
    }

    #[cfg(any(target_os = "macos", test))]
    pub(crate) fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

impl SidebarState {
    fn update_interactive_regions(
        &self,
        phase: &str,
        regions: Vec<SidebarInputRect>,
    ) -> Result<bool, String> {
        if regions.is_empty() || regions.len() > 16 || regions.iter().any(|rect| !rect.is_valid()) {
            return Err("invalid sidebar input regions".into());
        }
        let current = self.phase.lock().map_err(|_| "sidebar unavailable")?;
        if *current != phase {
            return Ok(false);
        }
        *self
            .interactive_regions
            .lock()
            .map_err(|_| "sidebar unavailable")? = Some((phase.into(), regions));
        Ok(true)
    }

    fn update_layout(
        &self,
        phase: &str,
        scale: f64,
        side: &str,
        frame_changed: bool,
    ) -> Result<String, String> {
        let mut current = self.phase.lock().map_err(|_| "sidebar unavailable")?;
        let mut previous_scale = self
            .effective_scale
            .lock()
            .map_err(|_| "sidebar unavailable")?;
        let mut previous_side = self.layout_side.lock().map_err(|_| "sidebar unavailable")?;
        if *current != phase
            || frame_changed
            || *previous_scale != Some(scale)
            || *previous_side != side
        {
            *self
                .interactive_regions
                .lock()
                .map_err(|_| "sidebar unavailable")? = None;
        }
        *previous_scale = Some(scale);
        *previous_side = side.into();
        Ok(std::mem::replace(&mut *current, phase.into()))
    }

    #[cfg(any(target_os = "macos", test))]
    fn input_regions(&self, size: (f64, f64), side: &str) -> Vec<SidebarInputRect> {
        let scale = self
            .effective_scale
            .lock()
            .ok()
            .and_then(|value| *value)
            .unwrap_or(1.0);
        let Ok(phase) = self.phase.lock() else {
            return fallback_input_regions("handle", size, side, scale);
        };
        if let Ok(regions) = self.interactive_regions.lock() {
            if let Some((region_phase, rects)) = &*regions {
                if region_phase == &*phase {
                    return rects.clone();
                }
            }
        }
        fallback_input_regions(&phase, size, side, scale)
    }
}

pub fn enabled(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .is_some_and(|state| crate::preferences_lock(&state).display_mode == "sidebar")
}

const RAIL_WIDTH: f64 = 64.0;
const RAIL_HEIGHT: f64 = 288.0;
const DOCK_WIDTH: f64 = 60.0;
const PANEL_GAP: f64 = 12.0;

fn rail_dimensions(side: &str) -> (f64, f64) {
    if side == "top" {
        (RAIL_HEIGHT, RAIL_WIDTH)
    } else {
        (RAIL_WIDTH, RAIL_HEIGHT)
    }
}

fn phase_dimensions(phase: &str, scale: f64, side: &str) -> Result<(f64, f64), String> {
    let top = side == "top";
    match phase {
        "handle" => Ok(if top {
            (56.0 * scale, 8.0 * scale)
        } else {
            (8.0 * scale, 56.0 * scale)
        }),
        "rail" => {
            let (width, height) = rail_dimensions(side);
            Ok((width * scale, height * scale))
        }
        // Only the dock scales; panels retain their text size and dimensions.
        "detail" | "menu" => {
            let (panel_width, panel_height): (f64, f64) = if phase == "detail" {
                (272.0, 480.0)
            } else {
                (304.0, 580.0)
            };
            let offset = PANEL_GAP + DOCK_WIDTH * scale;
            Ok(if top {
                (panel_width.max(RAIL_HEIGHT * scale), offset + panel_height)
            } else {
                (panel_width + offset, panel_height)
            })
        }
        _ => Err("invalid sidebar phase".into()),
    }
}

// At each selected scale, WKWebView keeps one canvas for every hover phase.
// macOS input regions make the unused canvas transparent to mouse events.
fn dimensions(phase: &str, scale: f64, side: &str) -> Result<(f64, f64), String> {
    let requested = phase_dimensions(phase, scale, side)?;
    if cfg!(target_os = "macos") {
        phase_dimensions("menu", scale, side)
    } else {
        Ok(requested)
    }
}

#[cfg(any(target_os = "macos", test))]
fn fallback_input_regions(
    phase: &str,
    size: (f64, f64),
    side: &str,
    scale: f64,
) -> Vec<SidebarInputRect> {
    let handle = if side == "top" {
        (56.0 * scale, 8.0 * scale)
    } else {
        (8.0 * scale, 56.0 * scale)
    };
    let (width, height) = phase_dimensions(phase, scale, side).unwrap_or(handle);
    let width = width.min(size.0);
    let height = height.min(size.1);
    vec![SidebarInputRect {
        x: match side {
            "left" => 0.0,
            "top" => (size.0 - width) / 2.0,
            _ => size.0 - width,
        },
        y: if side == "top" {
            0.0
        } else {
            (size.1 - height) / 2.0
        },
        width,
        height,
    }]
}

#[cfg(target_os = "macos")]
pub(crate) fn input_regions(app: &AppHandle, size: (f64, f64)) -> Vec<SidebarInputRect> {
    let side = crate::preferences_lock(&app.state::<AppState>())
        .sidebar_side
        .clone();
    // Clone under the locks; no lock guard crosses a call to AppKit.
    app.state::<SidebarState>().input_regions(size, &side)
}

fn placement(
    origin: PhysicalPosition<i32>,
    bounds: PhysicalSize<u32>,
    requested: PhysicalSize<u32>,
    side: &str,
) -> WidgetRect {
    let size = PhysicalSize::new(
        requested.width.min(bounds.width),
        requested.height.min(bounds.height),
    );
    WidgetRect {
        position: PhysicalPosition::new(
            origin.x
                + match side {
                    "left" => 0,
                    "top" => (bounds.width - size.width) as i32 / 2,
                    _ => (bounds.width - size.width) as i32,
                },
            origin.y
                + if side == "top" {
                    0
                } else {
                    (bounds.height - size.height) as i32 / 2
                },
        ),
        size,
    }
}

fn scaled_placement(
    origin: PhysicalPosition<i32>,
    bounds: PhysicalSize<u32>,
    monitor_scale: f64,
    sidebar_scale: f64,
    phase: &str,
    side: &str,
) -> Result<(WidgetRect, f64), String> {
    // Fit the complete rail (including its gear) independently of panels.
    // Panels adapt to a smaller work area through their own width/height limits.
    let (rail_width, rail_height) = rail_dimensions(side);
    let scale = sidebar_scale
        .min(f64::from(bounds.width) / monitor_scale / rail_width)
        .min(f64::from(bounds.height) / monitor_scale / rail_height);
    let (width, height) = dimensions(phase, scale, side)?;
    let rect = placement(
        origin,
        bounds,
        PhysicalSize::new(
            (width * monitor_scale).round().max(1.0) as u32,
            (height * monitor_scale).round().max(1.0) as u32,
        ),
        side,
    );
    Ok((rect, scale))
}

pub fn resize(
    app: &AppHandle,
    preferences: &WidgetPreferences,
    phase: &str,
) -> Result<f64, String> {
    dimensions(phase, preferences.sidebar_scale, &preferences.sidebar_side)?;
    let window = app
        .get_webview_window("widget")
        .ok_or("widget unavailable")?;
    let monitor = window
        .current_monitor()
        .map_err(|_| "monitor unavailable")?
        .or(window
            .primary_monitor()
            .map_err(|_| "monitor unavailable")?)
        .ok_or("monitor unavailable")?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (rect, effective_scale) = scaled_placement(
        area.position,
        area.size,
        scale,
        preferences.sidebar_scale,
        phase,
        &preferences.sidebar_side,
    )?;
    window
        .set_min_size(None::<tauri::LogicalSize<f64>>)
        .map_err(|_| "sidebar size unavailable")?;
    window
        .set_max_size(None::<tauri::LogicalSize<f64>>)
        .map_err(|_| "sidebar size unavailable")?;
    #[cfg(not(target_os = "macos"))]
    window
        .set_ignore_cursor_events(false)
        .map_err(|_| "sidebar input unavailable")?;
    let frame_changed = window.outer_position().ok() != Some(rect.position)
        || window.outer_size().ok() != Some(rect.size);
    if frame_changed {
        #[cfg(target_os = "macos")]
        crate::macos_widget::set_sidebar_rect(&window, rect, scale)?;
        #[cfg(not(target_os = "macos"))]
        {
            if window.outer_position().ok() != Some(rect.position) {
                window
                    .set_position(rect.position)
                    .map_err(|_| "sidebar position unavailable")?;
            }
            if window.outer_size().ok() != Some(rect.size) {
                window
                    .set_size(rect.size)
                    .map_err(|_| "sidebar size unavailable")?;
            }
        }
    }
    let previous_phase = app.state::<SidebarState>().update_layout(
        phase,
        effective_scale,
        &preferences.sidebar_side,
        frame_changed,
    )?;
    crate::show_widget(&window);
    // Only an explicit settings action takes focus. Hover details never do.
    if phase == "menu" && previous_phase != "menu" {
        window
            .set_focus()
            .map_err(|_| "sidebar focus unavailable")?;
    }
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || crate::macos_widget::track_sidebar_pointer(&handle));
    }
    Ok(effective_scale)
}

pub fn dismiss_menu(app: &AppHandle) {
    let state = app.state::<SidebarState>();
    let menu_open = state.phase.lock().is_ok_and(|phase| *phase == "menu");
    if enabled(app) && menu_open {
        let _ = app.emit_to("widget", "sidebar-dismiss", ());
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
    let state = app.state::<SidebarState>();
    let tray = app.tray_by_id("main");
    if next.display_mode == "sidebar" {
        let tray = tray.ok_or("tray unavailable")?;
        if previous.display_mode != "sidebar" {
            *state
                .floating_rect
                .lock()
                .map_err(|_| "sidebar unavailable")? = Some(crate::current_widget_rect(&window)?);
        }
        let phase = state
            .phase
            .lock()
            .map_err(|_| "sidebar unavailable")?
            .clone();
        resize(app, next, if phase.is_empty() { "handle" } else { &phase })?;
        // Hide only after a usable sidebar exists. Retain the tray and its menu.
        tray.set_visible(false).map_err(|_| "could not hide tray")?;
    } else {
        if let Some(tray) = tray {
            tray.set_visible(true)
                .map_err(|_| "could not restore tray")?;
        }
        if previous.display_mode == "sidebar" {
            window
                .set_ignore_cursor_events(false)
                .map_err(|_| "widget input unavailable")?;
            let saved = state
                .floating_rect
                .lock()
                .map_err(|_| "sidebar unavailable")?
                .take();
            window
                .set_size(tauri::LogicalSize::new(80.0, 80.0))
                .map_err(|_| "widget size unavailable")?;
            if let Some(rect) = saved {
                window
                    .set_position(rect.position)
                    .map_err(|_| "widget position unavailable")?;
            } else {
                window.center().map_err(|_| "widget position unavailable")?;
            }
            window
                .set_min_size(Some(tauri::LogicalSize::new(80.0, 80.0)))
                .map_err(|_| "widget size unavailable")?;
            window
                .set_max_size(Some(tauri::LogicalSize::new(314.0, 514.0)))
                .map_err(|_| "widget size unavailable")?;
            *state.phase.lock().map_err(|_| "sidebar unavailable")? = "handle".into();
            *state
                .interactive_regions
                .lock()
                .map_err(|_| "sidebar unavailable")? = None;
            *app.state::<AppState>()
                .geometry
                .lock()
                .map_err(|_| "widget unavailable")? = None;
            crate::show_widget(&window);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_sidebar_phase(
    app: AppHandle,
    state: State<'_, AppState>,
    phase: String,
    interactive_regions: Option<Vec<SidebarInputRect>>,
) -> Result<Option<SidebarViewport>, String> {
    let preferences = crate::preferences_lock(&state).clone();
    if preferences.display_mode != "sidebar" {
        return Ok(None);
    }
    if let Some(regions) = interactive_regions {
        let updated = app
            .state::<SidebarState>()
            .update_interactive_regions(&phase, regions)?;
        #[cfg(target_os = "macos")]
        if updated {
            crate::macos_widget::track_sidebar_pointer(&app);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = updated;
        return Ok(None);
    }
    let effective_scale = resize(&app, &preferences, &phase)?;
    let window = app
        .get_webview_window("widget")
        .ok_or("widget unavailable")?;
    let size = window
        .inner_size()
        .map_err(|_| "sidebar size unavailable")?;
    let scale = window
        .scale_factor()
        .map_err(|_| "sidebar scale unavailable")?;
    Ok(Some(SidebarViewport {
        width: f64::from(size.width) / scale,
        height: f64::from(size.height) / scale,
        scale: effective_scale,
    }))
}

#[derive(serde::Serialize)]
pub struct SidebarViewport {
    width: f64,
    height: f64,
    scale: f64,
}

// Reopen is also the escape hatch for a hidden/click-through legacy widget.
pub fn recover(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut preferences = crate::preferences_lock(&state).clone();
    preferences.locked = false;
    crate::apply_lock(app, false)?;
    crate::persist_preferences(&state.preferences_path, &preferences)?;
    *crate::preferences_lock(&state) = preferences.clone();
    if preferences.display_mode == "sidebar" {
        *app.state::<SidebarState>()
            .interactive_regions
            .lock()
            .map_err(|_| "sidebar unavailable")? = None;
        resize(app, &preferences, "rail")?;
        let _ = app.emit_to("widget", "sidebar-recover", ());
    } else if let Some(window) = app.get_webview_window("widget") {
        let monitor = window.current_monitor().ok().flatten();
        if monitor.is_none() {
            let _ = window.center();
        }
        crate::show_widget(&window);
    }
    let _ = app.emit_to("widget", "preferences-changed", preferences);
    Ok(())
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|_| "autostart unavailable".into())
}

#[tauri::command]
pub fn sidebar_action(app: AppHandle, action: String) -> Result<bool, String> {
    match action.as_str() {
        "refresh" => app
            .emit_to("widget", "refresh-requested", ())
            .map_err(|_| "refresh unavailable")?,
        "releases" => app
            .emit_to("widget", "release-page-requested", ())
            .map_err(|_| "downloads unavailable")?,
        "autostart" => {
            let manager = app.autolaunch();
            let next = !manager.is_enabled().map_err(|_| "autostart unavailable")?;
            if next {
                manager.enable()
            } else {
                manager.disable()
            }
            .map_err(|_| "autostart update failed")?;
            return Ok(next);
        }
        "quit" => app.exit(0),
        _ => return Err("invalid sidebar action".into()),
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_hover_phases_keep_the_native_canvas_unchanged() {
        for (scale, width) in [(0.8, 364.0), (1.0, 376.0), (1.3, 394.0)] {
            for side in ["left", "right"] {
                for phase in ["handle", "rail", "detail", "menu"] {
                    assert_eq!(dimensions(phase, scale, side).unwrap(), (width, 580.0));
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_top_hover_phases_keep_one_downward_canvas() {
        for scale in [0.8, 1.0, 1.3] {
            let menu = (304.0_f64.max(288.0 * scale), 60.0 * scale + 12.0 + 580.0);
            for phase in ["handle", "rail", "detail", "menu"] {
                assert_eq!(dimensions(phase, scale, "top").unwrap(), menu);
            }
        }
    }

    #[test]
    fn detail_and_menu_reserve_fixed_panel_dimensions_at_every_sidebar_scale() {
        for scale in [0.6, 0.8, 1.0, 1.3] {
            for (phase, panel_width, height) in [("detail", 272.0, 480.0), ("menu", 304.0, 580.0)] {
                let actual = phase_dimensions(phase, scale, "right").unwrap();
                assert_eq!(actual.0 - DOCK_WIDTH * scale - PANEL_GAP, panel_width);
                assert_eq!(actual.1, height);
            }
            assert_eq!(
                phase_dimensions("handle", scale, "right").unwrap(),
                (8.0 * scale, 56.0 * scale)
            );
            assert_eq!(
                phase_dimensions("rail", scale, "right").unwrap(),
                (64.0 * scale, 288.0 * scale)
            );
        }
    }

    #[test]
    fn top_dock_scales_horizontally_while_panel_dimensions_remain_fixed() {
        for scale in [0.6, 0.8, 1.0, 1.3] {
            assert_eq!(
                phase_dimensions("handle", scale, "top").unwrap(),
                (56.0 * scale, 8.0 * scale)
            );
            assert_eq!(
                phase_dimensions("rail", scale, "top").unwrap(),
                (288.0 * scale, 64.0 * scale)
            );
            for (phase, panel_width, panel_height) in
                [("detail", 272.0_f64, 480.0), ("menu", 304.0_f64, 580.0)]
            {
                let (width, height) = phase_dimensions(phase, scale, "top").unwrap();
                assert_eq!(width, panel_width.max(288.0 * scale));
                assert_eq!(height - 60.0 * scale - 12.0, panel_height);
            }
        }
    }

    #[test]
    fn fallback_input_keeps_full_size_panels_reachable_at_smaller_sidebar_scales() {
        for scale in [0.6, 0.8, 1.0, 1.3] {
            let size = phase_dimensions("menu", scale, "right").unwrap();
            for side in ["left", "right"] {
                for (phase, panel_width, height) in
                    [("detail", 272.0, 480.0), ("menu", 304.0, 580.0)]
                {
                    let regions = fallback_input_regions(phase, size, side, scale);
                    let region = &regions[0];
                    assert_eq!(region.width - DOCK_WIDTH * scale - PANEL_GAP, panel_width);
                    assert_eq!(region.height, height);
                    let inner_edge = if side == "left" {
                        region.width - 1.0
                    } else {
                        size.0 - region.width + 1.0
                    };
                    assert!(region.contains(inner_edge, (size.1 - height) / 2.0 + 1.0));
                    assert!(region.contains(inner_edge, (size.1 + height) / 2.0 - 1.0));
                }
                let clipped = fallback_input_regions("menu", (240.0, 360.0), side, scale);
                assert_eq!((clipped[0].width, clipped[0].height), (240.0, 360.0));
                assert_eq!((clipped[0].x, clipped[0].y), (0.0, 0.0));
            }
        }
    }

    #[test]
    fn scaled_frames_follow_the_selected_edge_at_each_monitor_dpi() {
        for monitor_scale in [1.0, 1.5, 2.0] {
            for sidebar_scale in [0.8, 1.0, 1.3] {
                for side in ["left", "right"] {
                    for phase in ["handle", "rail", "detail", "menu"] {
                        let origin = PhysicalPosition::new(-2560, -120);
                        let bounds = PhysicalSize::new(2560, 1800);
                        let (rect, scale) = scaled_placement(
                            origin,
                            bounds,
                            monitor_scale,
                            sidebar_scale,
                            phase,
                            side,
                        )
                        .unwrap();
                        assert_eq!(scale, sidebar_scale);
                        let (width, height) = dimensions(phase, sidebar_scale, side).unwrap();
                        assert_eq!(
                            rect.size,
                            PhysicalSize::new(
                                (width * monitor_scale).round() as u32,
                                (height * monitor_scale).round() as u32,
                            )
                        );
                        let center_error = rect.position.y * 2 + rect.size.height as i32
                            - (origin.y * 2 + bounds.height as i32);
                        assert!(center_error.abs() <= 1);
                        if side == "left" {
                            assert_eq!(rect.position.x, origin.x);
                        } else {
                            assert_eq!(rect.position.x + rect.size.width as i32, 0);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn top_frames_follow_work_area_top_and_horizontal_center_at_each_monitor_dpi() {
        for monitor_scale in [1.0, 1.5, 2.0] {
            for sidebar_scale in [0.8, 1.0, 1.3] {
                for origin in [
                    PhysicalPosition::new(-2560, -120),
                    PhysicalPosition::new(100, 48),
                ] {
                    let bounds = PhysicalSize::new(2560, 1800);
                    for phase in ["handle", "rail", "detail", "menu"] {
                        let (rect, scale) = scaled_placement(
                            origin,
                            bounds,
                            monitor_scale,
                            sidebar_scale,
                            phase,
                            "top",
                        )
                        .unwrap();
                        assert_eq!(scale, sidebar_scale);
                        assert_eq!(rect.position.y, origin.y);
                        let (width, height) = dimensions(phase, sidebar_scale, "top").unwrap();
                        assert_eq!(
                            rect.size,
                            PhysicalSize::new(
                                (width * monitor_scale).round() as u32,
                                (height * monitor_scale).round() as u32,
                            )
                        );
                        let center_error = rect.position.x * 2 + rect.size.width as i32
                            - (origin.x * 2 + bounds.width as i32);
                        assert!(center_error.abs() <= 1);
                    }
                }
            }
        }
    }

    #[test]
    fn small_work_areas_fit_the_rail_and_clip_panels_without_scaling_their_content() {
        for bounds in [
            PhysicalSize::new(500, 1600),
            PhysicalSize::new(1600, 700),
            PhysicalSize::new(80, 400),
        ] {
            for monitor_scale in [1.0, 1.5, 2.0] {
                for side in ["left", "right"] {
                    let expected = 1.3_f64
                        .min(f64::from(bounds.width) / monitor_scale / RAIL_WIDTH)
                        .min(f64::from(bounds.height) / monitor_scale / RAIL_HEIGHT);
                    for phase in ["handle", "rail", "detail", "menu"] {
                        let (rect, scale) = scaled_placement(
                            PhysicalPosition::new(-500, 40),
                            bounds,
                            monitor_scale,
                            1.3,
                            phase,
                            side,
                        )
                        .unwrap();
                        assert_eq!(scale, expected);
                        assert!(rect.size.width <= bounds.width);
                        assert!(rect.size.height <= bounds.height);
                        assert!(rect.position.x >= -500);
                        assert!(rect.position.y >= 40);
                        assert!(
                            rect.position.x + rect.size.width as i32 <= -500 + bounds.width as i32
                        );
                        assert!(
                            rect.position.y + rect.size.height as i32 <= 40 + bounds.height as i32
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn small_top_work_areas_fit_horizontal_actions_and_keep_clipped_panels_onscreen() {
        let origin = PhysicalPosition::new(-500, 48);
        for bounds in [
            PhysicalSize::new(500, 1600),
            PhysicalSize::new(1600, 100),
            PhysicalSize::new(80, 400),
            PhysicalSize::new(1920, 30),
        ] {
            for monitor_scale in [1.0, 1.5, 2.0] {
                let expected = 1.3_f64
                    .min(f64::from(bounds.width) / monitor_scale / 288.0)
                    .min(f64::from(bounds.height) / monitor_scale / 64.0);
                for phase in ["handle", "rail", "detail", "menu"] {
                    let (rect, scale) =
                        scaled_placement(origin, bounds, monitor_scale, 1.3, phase, "top").unwrap();
                    assert_eq!(scale, expected);
                    assert!(288.0 * scale * monitor_scale <= f64::from(bounds.width) + 1e-9);
                    assert!(64.0 * scale * monitor_scale <= f64::from(bounds.height) + 1e-9);
                    assert!(rect.size.width <= bounds.width);
                    assert!(rect.size.height <= bounds.height);
                    assert!(rect.position.x >= origin.x);
                    assert_eq!(rect.position.y, origin.y);
                    assert!(
                        rect.position.x + rect.size.width as i32 <= origin.x + bounds.width as i32
                    );
                }
            }
        }
    }

    #[test]
    fn top_fallback_keeps_the_handle_actions_and_downward_panels_reachable() {
        for scale in [0.6, 0.8, 1.0, 1.3] {
            let size = phase_dimensions("menu", scale, "top").unwrap();
            let state = SidebarState::default();
            state.update_layout("handle", scale, "top", true).unwrap();
            let handle = state.input_regions(size, "top");
            assert!(handle[0].contains(size.0 / 2.0, 4.0 * scale));
            assert!(!handle[0].contains(size.0 / 2.0 + 29.0 * scale, 4.0 * scale));
            assert!(!handle[0].contains(size.0 / 2.0, 9.0 * scale));

            state.update_layout("rail", scale, "top", false).unwrap();
            let rail = state.input_regions(size, "top");
            for action_edge in [-143.0, 143.0] {
                assert!(rail[0].contains(size.0 / 2.0 + action_edge * scale, 4.0 * scale));
            }
            assert!(!rail[0].contains(size.0 / 2.0, 65.0 * scale));

            for (phase, panel_width, panel_height) in
                [("detail", 272.0_f64, 480.0), ("menu", 304.0_f64, 580.0)]
            {
                state.update_layout(phase, scale, "top", false).unwrap();
                let regions = state.input_regions(size, "top");
                assert_eq!(regions[0].width, panel_width.max(288.0 * scale));
                assert_eq!(regions[0].height, 60.0 * scale + 12.0 + panel_height);
                assert_eq!(regions[0].y, 0.0);
                assert!(regions[0].contains(size.0 / 2.0, regions[0].height - 1.0));
                assert!(!regions[0].contains(size.0 / 2.0, regions[0].height));
                let clipped = state.input_regions((80.0, 100.0), "top");
                assert_eq!((clipped[0].x, clipped[0].y), (0.0, 0.0));
                assert_eq!((clipped[0].width, clipped[0].height), (80.0, 100.0));
            }
        }
    }

    #[test]
    fn scaled_fallback_hit_testing_keeps_the_handle_and_rail_reachable() {
        for scale in [0.6, 0.8, 1.0, 1.3] {
            let size = phase_dimensions("menu", scale, "right").unwrap();
            for side in ["left", "right"] {
                let state = SidebarState::default();
                state.update_layout("handle", scale, side, true).unwrap();
                let edge = if side == "left" {
                    4.0 * scale
                } else {
                    size.0 - 4.0 * scale
                };
                let regions = state.input_regions(size, side);
                assert!(regions.iter().any(|rect| rect.contains(edge, size.1 / 2.0)));
                assert!(!regions
                    .iter()
                    .any(|rect| rect.contains(edge, size.1 / 2.0 + 29.0 * scale)));
                assert!(!regions
                    .iter()
                    .any(|rect| rect.contains(size.0 / 2.0, size.1 / 2.0)));
                state.update_layout("rail", scale, side, false).unwrap();
                let regions = state.input_regions(size, side);
                assert!(regions
                    .iter()
                    .any(|rect| rect.contains(edge, size.1 / 2.0 - 100.0 * scale)));
                assert!(!regions
                    .iter()
                    .any(|rect| rect.contains(size.0 / 2.0, size.1 / 2.0)));
            }
        }
    }

    #[test]
    fn scale_changes_discard_old_input_even_when_the_rounded_frame_does_not_change() {
        let state = SidebarState::default();
        state.update_layout("handle", 1.0, "left", false).unwrap();
        state
            .update_interactive_regions(
                "handle",
                vec![SidebarInputRect {
                    x: 100.0,
                    y: 100.0,
                    width: 20.0,
                    height: 20.0,
                }],
            )
            .unwrap();
        state.update_layout("handle", 1.0, "left", false).unwrap();
        assert!(state.input_regions((376.0, 580.0), "left")[0].contains(110.0, 110.0));
        state
            .update_layout("handle", 1.0001, "left", false)
            .unwrap();
        let regions = state.input_regions((376.0, 580.0), "left");
        assert!(!regions.iter().any(|rect| rect.contains(110.0, 110.0)));
        assert!(regions.iter().any(|rect| rect.contains(4.0, 290.0)));
    }

    #[test]
    fn edge_changes_discard_input_when_clipped_native_frames_are_identical() {
        let state = SidebarState::default();
        state.update_layout("handle", 1.0, "left", true).unwrap();
        state
            .update_interactive_regions(
                "handle",
                vec![SidebarInputRect {
                    x: 0.0,
                    y: 22.0,
                    width: 8.0,
                    height: 56.0,
                }],
            )
            .unwrap();
        assert!(state.input_regions((100.0, 100.0), "left")[0].contains(4.0, 50.0));
        state.update_layout("handle", 1.0, "top", false).unwrap();
        let regions = state.input_regions((100.0, 100.0), "top");
        assert!(!regions[0].contains(4.0, 50.0));
        assert!(regions[0].contains(50.0, 4.0));
    }

    #[test]
    fn input_fallback_retains_the_handle_and_recovery_rail_on_both_edges() {
        for side in ["left", "right"] {
            let state = SidebarState::default();
            let edge = if side == "left" { 4.0 } else { 372.0 };
            let regions = state.input_regions((376.0, 580.0), side);
            assert!(regions.iter().any(|rect| rect.contains(edge, 290.0)));
            assert!(!regions.iter().any(|rect| rect.contains(edge, 100.0)));
            assert!(!regions.iter().any(|rect| rect.contains(180.0, 290.0)));
            *state.phase.lock().unwrap() = "rail".into();
            let regions = state.input_regions((376.0, 580.0), side);
            assert!(regions.iter().any(|rect| rect.contains(edge, 200.0)));
            assert!(!regions.iter().any(|rect| rect.contains(180.0, 290.0)));
        }
    }

    #[test]
    fn interactive_regions_leave_transparent_gaps_and_hidden_details_click_through() {
        let state = SidebarState::default();
        *state.phase.lock().unwrap() = "detail".into();
        let regions = vec![
            SidebarInputRect {
                x: 0.0,
                y: 170.0,
                width: 60.0,
                height: 264.0,
            },
            SidebarInputRect {
                x: 60.0,
                y: 200.0,
                width: 12.0,
                height: 180.0,
            },
            SidebarInputRect {
                x: 72.0,
                y: 100.0,
                width: 272.0,
                height: 380.0,
            },
        ];
        assert!(state.update_interactive_regions("detail", regions).unwrap());
        let live = state.input_regions((376.0, 580.0), "left");
        let hit = |x, y| live.iter().any(|rect| rect.contains(x, y));
        assert!(hit(30.0, 200.0));
        assert!(hit(66.0, 250.0));
        assert!(hit(200.0, 110.0));
        assert!(!hit(30.0, 100.0));
        assert!(!hit(66.0, 110.0));
        assert!(!hit(370.0, 290.0));
        *state.phase.lock().unwrap() = "handle".into();
        assert!(!state
            .input_regions((376.0, 580.0), "left")
            .iter()
            .any(|rect| rect.contains(200.0, 110.0)));
    }

    #[test]
    fn stale_region_reports_do_not_replace_the_current_phase_or_its_input() {
        let state = SidebarState::default();
        *state.phase.lock().unwrap() = "rail".into();
        let rail = SidebarInputRect {
            x: 316.0,
            y: 170.0,
            width: 60.0,
            height: 264.0,
        };
        assert!(state
            .update_interactive_regions("rail", vec![rail.clone()])
            .unwrap());
        assert!(!state
            .update_interactive_regions(
                "detail",
                vec![SidebarInputRect {
                    x: 0.0,
                    y: 0.0,
                    width: 376.0,
                    height: 580.0,
                }]
            )
            .unwrap());
        let regions = state.input_regions((376.0, 580.0), "right");
        assert_eq!(*state.phase.lock().unwrap(), "rail");
        assert_eq!(regions.len(), 1);
        assert!(regions[0].contains(340.0, 200.0));
        assert!(!regions[0].contains(100.0, 200.0));
    }

    #[test]
    fn malformed_input_regions_cannot_remove_the_operation_entry() {
        let state = SidebarState::default();
        *state.phase.lock().unwrap() = "handle".into();
        let valid = SidebarInputRect {
            x: 0.0,
            y: 262.0,
            width: 8.0,
            height: 56.0,
        };
        for regions in [
            vec![],
            vec![valid.clone(); 17],
            vec![SidebarInputRect {
                width: 0.0,
                ..valid.clone()
            }],
            vec![SidebarInputRect {
                height: -1.0,
                ..valid.clone()
            }],
            vec![SidebarInputRect {
                x: f64::NAN,
                ..valid.clone()
            }],
            vec![SidebarInputRect {
                width: f64::INFINITY,
                ..valid.clone()
            }],
        ] {
            assert!(state.update_interactive_regions("handle", regions).is_err());
            assert!(state.input_regions((376.0, 580.0), "left")[0].contains(4.0, 290.0));
        }
    }
    #[test]
    fn transitions_keep_rail_at_same_edge_and_center_on_negative_origin() {
        for side in ["left", "right"] {
            for phase in ["handle", "rail", "detail", "menu"] {
                let (w, h) = dimensions(phase, 1.0, side).unwrap();
                let rect = placement(
                    PhysicalPosition::new(-1920, 25),
                    PhysicalSize::new(1920, 1050),
                    PhysicalSize::new(w as u32, h as u32),
                    side,
                );
                assert_eq!(rect.position.y * 2 + rect.size.height as i32, 1100);
                if side == "left" {
                    assert_eq!(rect.position.x, -1920);
                } else {
                    assert_eq!(rect.position.x + rect.size.width as i32, 0);
                }
            }
        }
    }
    #[test]
    fn small_displays_clamp_and_unknown_phases_are_rejected() {
        let rect = placement(
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(300, 400),
            PhysicalSize::new(800, 1160),
            "right",
        );
        assert_eq!(rect.size, PhysicalSize::new(300, 400));
        assert_eq!(rect.position, PhysicalPosition::new(0, 0));
        assert!(dimensions("invalid", 1.0, "top").is_err());
    }
}
