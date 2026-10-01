use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State};
use tauri_plugin_autostart::ManagerExt;

use crate::{models::WidgetPreferences, AppState, WidgetRect};

#[derive(Default)]
pub struct SidebarState {
    phase: Mutex<String>,
    floating_rect: Mutex<Option<WidgetRect>>,
    interactive_regions: Mutex<Option<(String, Vec<SidebarInputRect>)>>,
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

    #[cfg(any(target_os = "macos", test))]
    fn input_regions(&self, size: (f64, f64), left: bool) -> Vec<SidebarInputRect> {
        let Ok(phase) = self.phase.lock() else {
            return fallback_input_regions("handle", size, left);
        };
        if let Ok(regions) = self.interactive_regions.lock() {
            if let Some((region_phase, rects)) = &*regions {
                if region_phase == &*phase {
                    return rects.clone();
                }
            }
        }
        fallback_input_regions(&phase, size, left)
    }
}

pub fn enabled(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .is_some_and(|state| crate::preferences_lock(&state).display_mode == "sidebar")
}

fn phase_dimensions(phase: &str) -> Result<(f64, f64), String> {
    match phase {
        "handle" => Ok((8.0, 56.0)),
        "rail" => Ok((64.0, 288.0)),
        "detail" => Ok((344.0, 480.0)),
        "menu" => Ok((376.0, 580.0)),
        _ => Err("invalid sidebar phase".into()),
    }
}

// WKWebView stays on one native canvas; only its visible layers animate.
// macOS input regions make the unused canvas transparent to mouse events.
fn dimensions(phase: &str) -> Result<(f64, f64), String> {
    let requested = phase_dimensions(phase)?;
    if cfg!(target_os = "macos") {
        Ok((376.0, 580.0))
    } else {
        Ok(requested)
    }
}

#[cfg(any(target_os = "macos", test))]
fn fallback_input_regions(phase: &str, size: (f64, f64), left: bool) -> Vec<SidebarInputRect> {
    let (width, height) = phase_dimensions(phase).unwrap_or((8.0, 56.0));
    let width = width.min(size.0);
    let height = height.min(size.1);
    vec![SidebarInputRect {
        x: if left { 0.0 } else { size.0 - width },
        y: (size.1 - height) / 2.0,
        width,
        height,
    }]
}

#[cfg(target_os = "macos")]
pub(crate) fn input_regions(app: &AppHandle, size: (f64, f64)) -> Vec<SidebarInputRect> {
    let left = crate::preferences_lock(&app.state::<AppState>()).sidebar_side == "left";
    // Clone under the locks; no lock guard crosses a call to AppKit.
    app.state::<SidebarState>().input_regions(size, left)
}

fn placement(
    origin: PhysicalPosition<i32>,
    bounds: PhysicalSize<u32>,
    requested: PhysicalSize<u32>,
    left: bool,
) -> WidgetRect {
    let size = PhysicalSize::new(
        requested.width.min(bounds.width),
        requested.height.min(bounds.height),
    );
    WidgetRect {
        position: PhysicalPosition::new(
            origin.x
                + if left {
                    0
                } else {
                    (bounds.width - size.width) as i32
                },
            origin.y + (bounds.height - size.height) as i32 / 2,
        ),
        size,
    }
}

pub fn resize(app: &AppHandle, preferences: &WidgetPreferences, phase: &str) -> Result<(), String> {
    let (width, height) = dimensions(phase)?;
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
    let rect = placement(
        area.position,
        area.size,
        PhysicalSize::new(
            (width * scale).round() as u32,
            (height * scale).round() as u32,
        ),
        preferences.sidebar_side == "left",
    );
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
    let previous_phase = {
        let state = app.state::<SidebarState>();
        let mut current = state.phase.lock().map_err(|_| "sidebar unavailable")?;
        if *current != phase || frame_changed {
            *state
                .interactive_regions
                .lock()
                .map_err(|_| "sidebar unavailable")? = None;
        }
        std::mem::replace(&mut *current, phase.into())
    };
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
    Ok(())
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
    resize(&app, &preferences, &phase)?;
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
    }))
}

#[derive(serde::Serialize)]
pub struct SidebarViewport {
    width: f64,
    height: f64,
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
        for phase in ["handle", "rail", "detail", "menu"] {
            assert_eq!(dimensions(phase).unwrap(), (376.0, 580.0));
        }
    }

    #[test]
    fn input_fallback_retains_the_handle_and_recovery_rail_on_both_edges() {
        for left in [true, false] {
            let state = SidebarState::default();
            let edge = if left { 4.0 } else { 372.0 };
            let regions = state.input_regions((376.0, 580.0), left);
            assert!(regions.iter().any(|rect| rect.contains(edge, 290.0)));
            assert!(!regions.iter().any(|rect| rect.contains(edge, 100.0)));
            assert!(!regions.iter().any(|rect| rect.contains(180.0, 290.0)));
            *state.phase.lock().unwrap() = "rail".into();
            let regions = state.input_regions((376.0, 580.0), left);
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
        let live = state.input_regions((376.0, 580.0), true);
        let hit = |x, y| live.iter().any(|rect| rect.contains(x, y));
        assert!(hit(30.0, 200.0));
        assert!(hit(66.0, 250.0));
        assert!(hit(200.0, 110.0));
        assert!(!hit(30.0, 100.0));
        assert!(!hit(66.0, 110.0));
        assert!(!hit(370.0, 290.0));
        *state.phase.lock().unwrap() = "handle".into();
        assert!(!state
            .input_regions((376.0, 580.0), true)
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
        let regions = state.input_regions((376.0, 580.0), false);
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
            assert!(state.input_regions((376.0, 580.0), true)[0].contains(4.0, 290.0));
        }
    }
    #[test]
    fn transitions_keep_rail_at_same_edge_and_center_on_negative_origin() {
        for left in [true, false] {
            for phase in ["handle", "rail", "detail", "menu"] {
                let (w, h) = dimensions(phase).unwrap();
                let rect = placement(
                    PhysicalPosition::new(-1920, 25),
                    PhysicalSize::new(1920, 1050),
                    PhysicalSize::new(w as u32, h as u32),
                    left,
                );
                assert_eq!(rect.position.y * 2 + rect.size.height as i32, 1100);
                if left {
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
            false,
        );
        assert_eq!(rect.size, PhysicalSize::new(300, 400));
        assert_eq!(rect.position, PhysicalPosition::new(0, 0));
        assert!(dimensions("invalid").is_err());
    }
}
