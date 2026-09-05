//! macOS Spaces policy for the existing Tauri NSWindow.
//! Never activate the app or change keyboard focus to maintain visibility.
use std::{fs, path::Path, sync::mpsc};

use objc2::{available, MainThreadMarker};
use objc2_app_kit::{
    NSFloatingWindowLevel, NSNormalWindowLevel, NSWindow, NSWindowCollectionBehavior as Behavior,
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt, DEFAULT_FILENAME};

// The plugin's VISIBLE restore calls show() + set_focus(). Restore geometry
// separately; visibility is applied once, without activation, after AppKit setup.
pub fn state_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_window_state::Builder::default()
        .with_state_flags(saved_flags())
        .skip_initial_state("widget")
        .build()
}

fn saved_flags() -> StateFlags {
    StateFlags::POSITION | StateFlags::SIZE | StateFlags::VISIBLE
}

pub fn prepare_config(config: &mut tauri::Config) {
    if let Some(widget) = config.app.windows.iter_mut().find(|w| w.label == "widget") {
        widget.visible = false;
        widget.focus = false;
        widget.fullscreen = false;
    }
}

fn collection_behavior(mut current: Behavior, modern_spaces: bool) -> Behavior {
    // Apple's mutually exclusive groups must be cleared before choosing a member.
    current.remove(
        Behavior::MoveToActiveSpace | Behavior::FullScreenPrimary | Behavior::FullScreenNone,
    );
    current.insert(Behavior::CanJoinAllSpaces | Behavior::FullScreenAuxiliary);
    if modern_spaces {
        current.remove(Behavior::Primary | Behavior::Auxiliary);
        current.insert(Behavior::CanJoinAllApplications);
    }
    current
}

/// Own a Tauri window handle until the main-thread operation completes. Obtain
/// and borrow the NSWindow pointer only inside that operation, never off-thread.
fn on_main<T: Send + 'static>(
    window: &WebviewWindow,
    operation: impl FnOnce(&NSWindow) -> T + Send + 'static,
) -> Result<T, String> {
    let owned = window.clone();
    let execute = move || {
        let _main = MainThreadMarker::new().ok_or("AppKit requires the main thread")?;
        let ptr = owned.ns_window().map_err(|e| e.to_string())?;
        // SAFETY: Tauri owns this live NSWindow; `owned` retains the window for
        // the closure's lifetime and the main-thread marker was checked above.
        let native = unsafe { ptr.cast::<NSWindow>().as_ref() }.ok_or("widget NSWindow missing")?;
        Ok(operation(native))
    };
    if MainThreadMarker::new().is_some() {
        return execute();
    }
    let (tx, rx) = mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let _ = tx.send(execute());
        })
        .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|_| "main-thread widget operation interrupted".to_string())?
}

fn saved_visibility(path: &Path) -> bool {
    fs::read(path)
        .ok()
        .and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok())
        .and_then(|value| value.get("widget")?.get("visible")?.as_bool())
        .unwrap_or(true)
}

pub fn initialize(window: &WebviewWindow, always_on_top: bool) -> Result<(), String> {
    let state_path = window
        .app_handle()
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(DEFAULT_FILENAME);
    let visible = saved_visibility(&state_path);
    // Never restore FULLSCREEN/MAXIMIZED/DECORATIONS to this fixed-size widget.
    window
        .restore_state(StateFlags::POSITION | StateFlags::SIZE)
        .map_err(|e| e.to_string())?;
    on_main(window, |native| {
        native.setCollectionBehavior(collection_behavior(
            native.collectionBehavior(),
            available!(macos = 13.0),
        ));
        native.setHidesOnDeactivate(false);
    })?;
    set_always_on_top(window, always_on_top)?;
    if visible {
        show(window)?;
    }
    Ok(())
}

pub fn set_always_on_top(window: &WebviewWindow, enabled: bool) -> Result<(), String> {
    on_main(window, move |native| {
        // Match tao 0.35.3 exactly. Disabling the switch returns to level 0.
        native.setLevel(if enabled {
            NSFloatingWindowLevel
        } else {
            NSNormalWindowLevel
        });
    })
}

pub fn show(window: &WebviewWindow) -> Result<(), String> {
    on_main(window, |native| {
        if !native.isVisible() {
            // Unlike tao's show(), this does not make the window key. This is
            // only called on initial display or an explicit user show request.
            native.orderFrontRegardless();
        }
    })
}

pub fn save_visibility(app: &tauri::AppHandle) {
    if app.save_window_state(saved_flags()).is_err() {
        eprintln!("failed to save widget visibility");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn space_flags_replace_conflicts_and_preserve_unrelated_flags() {
        let old = Behavior::MoveToActiveSpace
            | Behavior::FullScreenPrimary
            | Behavior::Primary
            | Behavior::IgnoresCycle;
        let new = collection_behavior(old, true);
        assert!(new.contains(
            Behavior::CanJoinAllSpaces
                | Behavior::FullScreenAuxiliary
                | Behavior::CanJoinAllApplications
                | Behavior::IgnoresCycle
        ));
        assert!(!new.intersects(
            Behavior::MoveToActiveSpace
                | Behavior::FullScreenPrimary
                | Behavior::FullScreenNone
                | Behavior::Primary
                | Behavior::Auxiliary
        ));
        assert_eq!(collection_behavior(new, true), new);
        assert!(!collection_behavior(Behavior::empty(), false)
            .contains(Behavior::CanJoinAllApplications));
    }

    #[test]
    fn restored_hidden_window_stays_hidden_and_other_state_is_not_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DEFAULT_FILENAME);
        assert!(saved_visibility(&path));
        let raw = br#"{"widget":{"x":150,"y":200,"visible":false,"fullscreen":true}}"#;
        fs::write(&path, raw).unwrap();
        assert!(!saved_visibility(&path));
        assert_eq!(fs::read(&path).unwrap(), raw);
        assert!(!saved_flags()
            .intersects(StateFlags::FULLSCREEN | StateFlags::MAXIMIZED | StateFlags::DECORATIONS));
    }

    #[test]
    fn initial_window_waits_for_native_policy_without_enabling_fullscreen_or_disabling_clicks() {
        let mut config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        prepare_config(&mut config);
        let widget = &config.app.windows[0];
        assert_eq!(widget.label, "widget");
        assert!(!widget.visible && !widget.focus && !widget.fullscreen);
        assert!(widget.focusable && widget.always_on_top);
        assert_eq!(widget.width, 80.0);
        assert_eq!(widget.height, 80.0);
    }
}
