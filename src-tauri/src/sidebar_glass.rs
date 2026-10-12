//! Private visual-only bridge. Input regions and native window geometry remain
//! owned by sidebar.rs; transparent hover corridors never become glass surfaces.
use std::cell::RefCell;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WebviewWindow};

#[cfg(target_os = "macos")]
use crate::sidebar_glass_macos as platform;
#[cfg(target_os = "windows")]
use crate::sidebar_glass_windows as platform;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum GlassPathCommand {
    Move {
        x: f64,
        y: f64,
    },
    Line {
        x: f64,
        y: f64,
    },
    Curve {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        x: f64,
        y: f64,
    },
    Close,
}

impl GlassPathCommand {
    fn valid(&self) -> bool {
        let unit = |n: f64| n.is_finite() && (-0.00001..=1.00001).contains(&n);
        match *self {
            Self::Move { x, y } | Self::Line { x, y } => unit(x) && unit(y),
            Self::Curve {
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => [x1, y1, x2, y2, x, y].into_iter().all(unit),
            Self::Close => true,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlassRegion {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub opacity: f64,
    pub path: Vec<GlassPathCommand>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlassFrame {
    pub sequence: u64,
    pub width: f64,
    pub height: f64,
    pub theme: String,
    pub enabled: bool,
    pub regions: Vec<GlassRegion>,
}

impl GlassFrame {
    fn valid(&self) -> bool {
        let dimension = |n: f64| n.is_finite() && n > 0.0 && n <= 8192.0;
        dimension(self.width)
            && dimension(self.height)
            && matches!(self.theme.as_str(), "light" | "dark")
            && self.regions.len() <= 4
            && self.regions.iter().enumerate().all(|(index, region)| {
                matches!(region.id.as_str(), "rail" | "panel" | "direction" | "gear")
                    && !self.regions[..index]
                        .iter()
                        .any(|prior| prior.id == region.id)
                    && region.x.is_finite()
                    && region.x.abs() <= 8192.0
                    && region.y.is_finite()
                    && region.y.abs() <= 8192.0
                    && dimension(region.width)
                    && dimension(region.height)
                    && region.opacity.is_finite()
                    && (0.0..=1.0).contains(&region.opacity)
                    && (3..=32).contains(&region.path.len())
                    && matches!(region.path.first(), Some(GlassPathCommand::Move { .. }))
                    && matches!(region.path.last(), Some(GlassPathCommand::Close))
                    && region.path.iter().all(GlassPathCommand::valid)
            })
    }

    fn matches_viewport(&self, width: f64, height: f64) -> bool {
        (self.width - width).abs() <= 1.0 && (self.height - height).abs() <= 1.0
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
// Wire statuses are shared; individual platforms do not construct every case.
#[allow(dead_code)]
pub enum GlassStatus {
    Active,
    #[default]
    Disabled,
    Unsupported,
    ReducedTransparency,
    Unavailable,
}

#[derive(Default)]
struct GlassState {
    sequence: u64,
    status: GlassStatus,
}

impl GlassState {
    fn accept(&mut self, sequence: u64) -> bool {
        if sequence <= self.sequence {
            return false;
        }
        self.sequence = sequence;
        true
    }
}

thread_local! {
    // Accessed only on the widget's UI thread, like the platform compositor.
    static STATE: RefCell<GlassState> = RefCell::new(GlassState::default());
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::*;
    pub fn apply(_: &WebviewWindow, frame: &GlassFrame) -> Result<GlassStatus, String> {
        Ok(if frame.enabled {
            GlassStatus::Unsupported
        } else {
            GlassStatus::Disabled
        })
    }
    pub fn clear(_: &WebviewWindow) -> Result<(), String> {
        Ok(())
    }
}

fn apply(window: &WebviewWindow, mut frame: GlassFrame) -> Result<GlassStatus, String> {
    if !frame.valid() {
        return Err("invalid sidebar material frame".into());
    }
    let accepted = STATE.with(|state| state.borrow_mut().accept(frame.sequence));
    if !accepted {
        return Ok(STATE.with(|state| state.borrow().status));
    }
    // A queued frame may arrive after the mode changed or the switch was saved.
    let app = window.app_handle();
    let preferences = crate::preferences_lock(&app.state::<crate::AppState>()).clone();
    frame.enabled &= preferences.display_mode == "sidebar" && preferences.sidebar_glass_enabled;
    if frame.enabled {
        let scale = window
            .scale_factor()
            .map_err(|_| "material scale unavailable")?;
        let size = window
            .inner_size()
            .map_err(|_| "material viewport unavailable")?;
        if !frame.matches_viewport(
            f64::from(size.width) / scale,
            f64::from(size.height) / scale,
        ) {
            let _ = window.emit("sidebar-glass-invalidated", ());
            return Ok(STATE.with(|state| state.borrow().status));
        }
    }
    let status = platform::apply(window, &frame).unwrap_or_else(|_| {
        let _ = platform::clear(window);
        GlassStatus::Unavailable
    });
    STATE.with(|state| state.borrow_mut().status = status);
    Ok(status)
}

#[tauri::command]
pub async fn sync_sidebar_glass(
    window: WebviewWindow,
    frame: GlassFrame,
) -> Result<GlassStatus, String> {
    if window.label() != "widget" {
        return Err("unsupported caller".into());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let owned = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(apply(&owned, frame));
        })
        .map_err(|_| "material UI thread unavailable")?;
    rx.await.map_err(|_| "material update interrupted")?
}

/// Called on the UI thread before switching away or during application exit.
pub fn clear(window: &WebviewWindow) {
    let _ = platform::clear(window);
    STATE.with(|state| state.borrow_mut().status = GlassStatus::Disabled);
}

pub fn clear_on_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("widget") {
        let owned = window.clone();
        let _ = window.run_on_main_thread(move || clear(&owned));
    }
}

#[cfg(target_os = "windows")]
struct SystemWatcher(std::sync::Arc<std::sync::atomic::AtomicBool>);

#[cfg(target_os = "windows")]
pub fn watch_system_settings(app: &tauri::AppHandle) {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    let stop = Arc::new(AtomicBool::new(false));
    app.manage(SystemWatcher(stop.clone()));
    let app = app.clone();
    // Only check system policy, never redraw or poll geometry when idle.
    std::thread::spawn(move || {
        let mut previous = None;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            if stop.load(Ordering::Relaxed) {
                break;
            }
            let preferences = crate::preferences_lock(&app.state::<crate::AppState>()).clone();
            // 关闭磨砂后仍观察无障碍策略，让半透明底色遵守系统实色要求。
            if preferences.display_mode != "sidebar" {
                previous = None;
                continue;
            }
            let Some(window) = app.get_webview_window("widget") else {
                break;
            };
            let owned = window.clone();
            let stopped = stop.clone();
            let (tx, rx) = std::sync::mpsc::channel();
            if window
                .run_on_main_thread(move || {
                    let status = if stopped.load(Ordering::Relaxed) {
                        None
                    } else {
                        Some(platform::poll_status(&owned).unwrap_or(GlassStatus::Unavailable))
                    };
                    let _ = tx.send(status);
                })
                .is_err()
            {
                break;
            }
            // Never leave a worker waiting on a UI thread that has exited.
            let Ok(Some(status)) = rx.recv_timeout(std::time::Duration::from_secs(2)) else {
                continue;
            };
            if previous != Some(status) {
                previous = Some(status);
                let _ = window.emit("sidebar-glass-invalidated", ());
            }
        }
    });
}

pub fn shutdown(app: &tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    if let Some(watcher) = app.try_state::<SystemWatcher>() {
        watcher.0.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    if let Some(window) = app.get_webview_window("widget") {
        clear(&window);
        #[cfg(target_os = "windows")]
        let _ = platform::shutdown(&window);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> GlassFrame {
        serde_json::from_value(serde_json::json!({
            "sequence": 1, "width": 376.0, "height": 580.0,
            "theme": "light", "enabled": true, "regions": [{
                "id": "panel", "x": 72.0, "y": 80.0, "width": 272.0,
                "height": 400.0, "opacity": 0.5,
                "path": [{"op":"move","x":0.0,"y":0.0},
                    {"op":"line","x":1.0,"y":1.0},{"op":"close"}]
            }]
        }))
        .unwrap()
    }

    #[test]
    fn accepts_animated_offsets_and_rejects_invalid_shapes() {
        let mut value = frame();
        value.regions[0].x = -20.0;
        assert!(value.valid());
        value.regions[0].opacity = f64::NAN;
        assert!(!value.valid());
        value = frame();
        value.regions[0].path[1] = GlassPathCommand::Line { x: 1.5, y: 0.0 };
        assert!(!value.valid());
        value = frame();
        value.regions.push(value.regions[0].clone());
        assert!(!value.valid());
        value = frame();
        value.regions[0].path.pop();
        assert!(!value.valid());
    }

    #[test]
    fn disabled_frame_can_clear_all_regions_without_matching_old_viewport() {
        let mut value = frame();
        value.enabled = false;
        value.regions.clear();
        assert!(value.valid());
        assert!(!value.matches_viewport(80.0, 80.0));
    }

    #[test]
    fn stale_or_duplicate_frames_cannot_replace_a_newer_clear() {
        let mut state = GlassState::default();
        assert!(state.accept(12));
        assert!(state.accept(14));
        assert!(!state.accept(13));
        assert!(!state.accept(14));
        assert!(state.accept(15));
    }

    #[test]
    fn viewport_comparison_tolerates_rounding_but_not_a_previous_size() {
        assert!(frame().matches_viewport(375.5, 580.0));
        assert!(!frame().matches_viewport(380.0, 580.0));
    }
}
