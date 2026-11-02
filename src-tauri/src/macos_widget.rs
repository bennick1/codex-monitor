//! macOS Spaces policy for a tray accessory's Tauri NSWindow.
//! Never activate the app or change keyboard focus to maintain visibility.
use std::{
    cell::{Cell, RefCell},
    fs,
    path::Path,
    ptr::NonNull,
    sync::mpsc,
};

use block2::RcBlock;
use objc2::{available, rc::Retained, runtime::AnyObject, MainThreadMarker};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSEvent, NSEventMask, NSEventType,
    NSFloatingWindowLevel, NSNormalWindowLevel, NSScreen, NSWindow,
    NSWindowCollectionBehavior as Behavior,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt, DEFAULT_FILENAME};

thread_local! {
    static POINTER_MONITORS: RefCell<Vec<Retained<AnyObject>>> = const { RefCell::new(Vec::new()) };
    static POINTER_INSIDE: Cell<Option<bool>> = const { Cell::new(None) };
    static POINTER_POSITION: Cell<Option<(f64, f64)>> = const { Cell::new(None) };
    static POINTER_MOVEMENT: Cell<u64> = const { Cell::new(0) };
}

#[derive(Clone, serde::Serialize)]
struct SidebarPointerPosition {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    movement: u64,
}

#[derive(Clone, serde::Serialize)]
struct SidebarPointer {
    inside: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<SidebarPointerPosition>,
}

fn pointer_in_bounds(point: (f64, f64), origin: (f64, f64), size: (f64, f64)) -> bool {
    point.0 >= origin.0
        && point.0 < origin.0 + size.0
        && point.1 >= origin.1
        && point.1 < origin.1 + size.1
}

fn local_pointer_position(
    point: (f64, f64),
    origin: (f64, f64),
    size: (f64, f64),
    movement: u64,
) -> Option<SidebarPointerPosition> {
    pointer_in_bounds(point, origin, size).then_some(SidebarPointerPosition {
        x: point.0 - origin.0,
        // AppKit is bottom-up; WebView hit testing uses a top-left origin.
        y: origin.1 + size.1 - point.1,
        width: size.0,
        height: size.1,
        movement,
    })
}

fn sidebar_pointer(
    position: Option<SidebarPointerPosition>,
    regions: &[crate::sidebar::SidebarInputRect],
) -> SidebarPointer {
    let inside = position
        .as_ref()
        .is_some_and(|point| regions.iter().any(|rect| rect.contains(point.x, point.y)));
    SidebarPointer { inside, position }
}

pub fn track_sidebar_pointer(app: &tauri::AppHandle) {
    if !crate::sidebar::enabled(app) {
        POINTER_INSIDE.with(|inside| inside.set(None));
        POINTER_POSITION.with(|position| position.set(None));
        return;
    }
    let Some(window) = app.get_webview_window("widget") else {
        return;
    };
    let handle = app.clone();
    let pointer = on_main(&window, move |native| {
        let point = NSEvent::mouseLocation();
        let frame = native.frame();
        let previous = POINTER_POSITION.with(|value| value.replace(Some((point.x, point.y))));
        let movement = POINTER_MOVEMENT.with(|value| {
            if previous != Some((point.x, point.y)) {
                value.set(value.get().wrapping_add(1));
            }
            value.get()
        });
        let position = if native.isVisible() && native.isOnActiveSpace() {
            local_pointer_position(
                (point.x, point.y),
                (frame.origin.x, frame.origin.y),
                (frame.size.width, frame.size.height),
                movement,
            )
        } else {
            None
        };
        let regions = crate::sidebar::input_regions(&handle, (frame.size.width, frame.size.height));
        let pointer = sidebar_pointer(position, &regions);
        // CSS pointer-events cannot make a transparent NSWindow pass a click
        // to another application. The global monitor re-enables input as soon
        // as the pointer reaches a live control, including the folded handle.
        if native.ignoresMouseEvents() == pointer.inside {
            native.setIgnoresMouseEvents(!pointer.inside);
        }
        pointer
    });
    if let Ok(pointer) = pointer {
        let previous = POINTER_INSIDE.with(|value| value.replace(Some(pointer.inside)));
        // Only window-local coordinates cross the bridge, never outside positions.
        if pointer.position.is_some() || previous != Some(false) {
            let _ = window.emit("sidebar-pointer", pointer);
        }
    }
}

fn watch_pointer_events(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle().clone();
    on_main(window, move |native| {
        let widget_pointer = native as *const NSWindow as usize;
        let global_app = app.clone();
        let global = RcBlock::new(move |event: NonNull<NSEvent>| {
            // AppKit lends the event for this callback only.
            if matches!(
                unsafe { event.as_ref() }.r#type(),
                NSEventType::MouseMoved | NSEventType::LeftMouseDragged
            ) {
                track_sidebar_pointer(&global_app);
            } else {
                crate::sidebar::dismiss_menu(&global_app);
                crate::menubar::dismiss(&global_app);
            }
        });
        let local = RcBlock::new(move |event: NonNull<NSEvent>| {
            // AppKit invokes monitor blocks on the main thread and lends a live event.
            if let Some(main) = MainThreadMarker::new() {
                if matches!(
                    unsafe { event.as_ref() }.r#type(),
                    NSEventType::MouseMoved | NSEventType::LeftMouseDragged
                ) {
                    track_sidebar_pointer(&app);
                    return event.as_ptr();
                }
                let event_window = unsafe { event.as_ref() }.window(main);
                if event_window
                    .is_some_and(|window| &*window as *const NSWindow as usize != widget_pointer)
                {
                    crate::sidebar::dismiss_menu(&app);
                }
            }
            event.as_ptr()
        });
        let mask = NSEventMask::LeftMouseDown
            | NSEventMask::RightMouseDown
            | NSEventMask::OtherMouseDown
            | NSEventMask::MouseMoved
            | NSEventMask::LeftMouseDragged;
        POINTER_MONITORS.with(|monitors| {
            let mut monitors = monitors.borrow_mut();
            if !monitors.is_empty() {
                return;
            }
            if let Some(monitor) =
                NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global)
            {
                monitors.push(monitor);
            }
            // Return the original event unchanged; no input is intercepted or retained.
            if let Some(monitor) =
                unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local) }
            {
                monitors.push(monitor);
            }
        });
    })
}

pub fn stop_pointer_monitors() {
    POINTER_INSIDE.with(|inside| inside.set(None));
    POINTER_POSITION.with(|position| position.set(None));
    POINTER_MONITORS.with(|monitors| {
        for monitor in monitors.borrow_mut().drain(..) {
            // Each token was returned by AppKit's monitor registration above.
            unsafe {
                NSEvent::removeMonitor(&monitor);
            }
        }
    });
}

// The plugin's VISIBLE restore calls show() + set_focus(). Restore geometry
// separately; visibility is applied once, without activation, after AppKit setup.
pub fn state_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_window_state::Builder::default()
        .with_state_flags(saved_flags())
        .with_denylist(&["deepseek-login", "updater"])
        .skip_initial_state("widget")
        .build()
}

fn saved_flags() -> StateFlags {
    StateFlags::POSITION | StateFlags::SIZE | StateFlags::VISIBLE
}

pub fn prepare_config(config: &mut tauri::Config) {
    if let Some(widget) = config.app.windows.iter_mut().find(|w| w.label == "widget") {
        // Tauri normally creates configured windows before the setup callback.
        // Create this one explicitly after verifying the app policy and tray.
        widget.create = false;
        widget.visible = false;
        widget.focus = false;
        widget.fullscreen = false;
        // Hover never activates this accessory. Deliver its first real click
        // to WebKit instead of consuming that click only to activate the app.
        widget.accept_first_mouse = true;
    }
}

pub fn prepare_app(app: &mut tauri::App) {
    // With Tauri 2.11.5 this configures tao's launch policy, so it MUST be
    // called before App::run, not after the NSWindow has already been created.
    // A regular application window did not follow native fullscreen Spaces
    // during user acceptance even with all three collection-behavior flags.
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

pub fn create_widget(app: &tauri::App) -> Result<(), String> {
    let main = MainThreadMarker::new().ok_or("widget creation requires the main thread")?;
    if NSApplication::sharedApplication(main).activationPolicy()
        != NSApplicationActivationPolicy::Accessory
    {
        return Err(
            "macOS accessory activation policy was not applied before window creation".into(),
        );
    }
    if app.tray_by_id("main").is_none() {
        return Err("cannot create an accessory widget without its tray".into());
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "widget")
        .ok_or("widget configuration missing")?;
    tauri::WebviewWindowBuilder::from_config(app.handle(), config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
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

pub fn initialize(
    window: &WebviewWindow,
    always_on_top: bool,
    allow_visible: bool,
) -> Result<(), String> {
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
    watch_pointer_events(window)?;
    if visible && allow_visible {
        show(window)?;
    }
    Ok(())
}

pub fn control_pressed() -> bool {
    NSEvent::modifierFlags_class().contains(objc2_app_kit::NSEventModifierFlags::Control)
}

pub fn menu_is_tracking(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("widget").is_some_and(|window| {
        on_main(&window, |_| {
            objc2_foundation::NSRunLoop::currentRunLoop()
                .currentMode()
                .is_some_and(|mode| mode.to_string() == "NSEventTrackingRunLoopMode")
        })
        .unwrap_or(false)
    })
}

fn menubar_frame(anchor: NSRect, visible: NSRect, height: f64) -> Result<NSRect, String> {
    if ![
        anchor.origin.x,
        anchor.origin.y,
        anchor.size.width,
        anchor.size.height,
        visible.origin.x,
        visible.origin.y,
        visible.size.width,
        visible.size.height,
        height,
    ]
    .into_iter()
    .all(f64::is_finite)
        || anchor.size.width <= 0.0
        || anchor.size.height <= 0.0
        || visible.size.width <= 0.0
        || visible.size.height <= 0.0
        || height <= 0.0
    {
        return Err("menu bar geometry unavailable".into());
    }
    // These are AppKit points throughout, with a bottom-left origin. Never
    // compare per-monitor physical coordinates: a 2x screen and an adjacent
    // 1x screen can have overlapping numeric physical rectangles in Tauri.
    let width = crate::menubar::WINDOW_WIDTH.min(visible.size.width);
    let height = height.min(visible.size.height);
    let x = (anchor.origin.x + anchor.size.width / 2.0 - width / 2.0).clamp(
        visible.origin.x,
        visible.origin.x + visible.size.width - width,
    );
    let y = (anchor.origin.y - 4.0 - height).clamp(
        visible.origin.y,
        visible.origin.y + visible.size.height - height,
    );
    Ok(NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)))
}

pub fn position_menubar(window: &WebviewWindow, height: f64) -> Result<(), String> {
    let tray = window
        .app_handle()
        .tray_by_id("main")
        .ok_or("tray unavailable")?;
    window
        .set_min_size(None::<tauri::LogicalSize<f64>>)
        .map_err(|_| "panel size unavailable")?;
    window
        .set_max_size(None::<tauri::LogicalSize<f64>>)
        .map_err(|_| "panel size unavailable")?;
    let owned = window.clone();
    // This public Tauri/tray-icon API guarantees the closure runs on AppKit's
    // main thread. No borrowed native object or raw pointer leaves it.
    tray.with_inner_tray_icon(move |inner| {
        let main = MainThreadMarker::new().ok_or("menu bar requires the main thread")?;
        let item = inner.ns_status_item().ok_or("status item unavailable")?;
        let button = item.button(main).ok_or("status button unavailable")?;
        let status_window = button.window().ok_or("status window unavailable")?;
        let screen = status_window.screen().ok_or("status screen unavailable")?;
        let anchor =
            status_window.convertRectToScreen(button.convertRect_toView(button.bounds(), None));
        let frame = menubar_frame(anchor, screen.visibleFrame(), height)?;
        let pointer = owned.ns_window().map_err(|_| "panel unavailable")?;
        // SAFETY: the retained Tauri handle owns this NSWindow, and the main
        // thread marker above covers this short borrow and native mutation.
        let native = unsafe { pointer.cast::<NSWindow>().as_ref() }.ok_or("panel unavailable")?;
        // Apply position and size together, without ordering front or taking
        // focus. Calling this while hidden must leave the panel hidden.
        native.setFrame_display(frame, true);
        Ok(())
    })
    .map_err(|_| "menu bar positioning unavailable".to_string())?
}

fn fit_visible_frame(frame: NSRect, visible: NSRect) -> Option<NSRect> {
    if ![
        frame.origin.x,
        frame.origin.y,
        frame.size.width,
        frame.size.height,
        visible.origin.x,
        visible.origin.y,
        visible.size.width,
        visible.size.height,
    ]
    .into_iter()
    .all(f64::is_finite)
        || frame.size.width <= 0.0
        || frame.size.height <= 0.0
        || visible.size.width <= 0.0
        || visible.size.height <= 0.0
    {
        return None;
    }
    let width = frame.size.width.min(visible.size.width);
    let height = frame.size.height.min(visible.size.height);
    Some(NSRect::new(
        NSPoint::new(
            frame.origin.x.clamp(
                visible.origin.x,
                visible.origin.x + visible.size.width - width,
            ),
            frame.origin.y.clamp(
                visible.origin.y,
                visible.origin.y + visible.size.height - height,
            ),
        ),
        NSSize::new(width, height),
    ))
}

pub fn ensure_visible(window: &WebviewWindow) -> Result<(), String> {
    on_main(window, |native| {
        let main = MainThreadMarker::new().ok_or("window recovery requires the main thread")?;
        let screens = NSScreen::screens(main);
        let frame = native.frame();
        if screens.iter().any(|screen| {
            fit_visible_frame(frame, screen.visibleFrame()).is_some_and(|fitted| fitted == frame)
        }) {
            return Ok(());
        }
        let screen = native
            .screen()
            .or_else(|| NSScreen::mainScreen(main))
            .or_else(|| screens.firstObject())
            .ok_or("visible screen unavailable")?;
        let fitted =
            fit_visible_frame(frame, screen.visibleFrame()).ok_or("window geometry unavailable")?;
        // Saved floating positions can refer to a removed external display.
        // Reconcile only their frame; retain mode, appearance, focus and level.
        native.setFrame_display(fitted, true);
        Ok(())
    })?
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

fn resized_origin(
    origin: (f64, f64),
    old_height: f64,
    new_height: f64,
    top_left_delta: (f64, f64),
) -> (f64, f64) {
    (
        origin.0 + top_left_delta.0,
        origin.1 + old_height - new_height - top_left_delta.1,
    )
}

pub fn set_sidebar_rect(
    window: &WebviewWindow,
    rect: crate::WidgetRect,
    scale: f64,
) -> Result<(), String> {
    let current = window.outer_position().map_err(|e| e.to_string())?;
    on_main(window, move |native| {
        let mut frame = native.frame();
        let height = f64::from(rect.size.height) / scale;
        let (x, y) = resized_origin(
            (frame.origin.x, frame.origin.y),
            frame.size.height,
            height,
            (
                f64::from(rect.position.x - current.x) / scale,
                f64::from(rect.position.y - current.y) / scale,
            ),
        );
        frame.origin.x = x;
        frame.origin.y = y;
        frame.size.width = f64::from(rect.size.width) / scale;
        frame.size.height = height;
        // Position and size land in one AppKit update. Web content animates
        // within that footprint, avoiding a transient frame at the old size.
        native.setFrame_display(frame, true);
    })
}

pub fn save_visibility(app: &tauri::AppHandle) {
    // The window-state plugin holds its cache lock while querying NSWindow.
    // Saving from a worker can deadlock a pending resize event on the main
    // thread, which also needs that lock. Keep both operations on the UI thread.
    let save = |handle: &tauri::AppHandle| {
        if handle.save_window_state(saved_flags()).is_err() {
            eprintln!("failed to save widget visibility");
        }
    };
    if MainThreadMarker::new().is_some() {
        save(app);
    } else {
        let handle = app.clone();
        if app.run_on_main_thread(move || save(&handle)).is_err() {
            eprintln!("failed to schedule widget visibility save");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
        NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
    }

    #[test]
    fn menubar_uses_the_status_screen_points_instead_of_overlapping_mixed_dpi_bounds() {
        // A Retina primary screen is 1440 points wide (2880 device pixels).
        // The 1x external screen begins at x=1440 points. Its status item at
        // x=1980 must not be misidentified as residing on the primary screen.
        let external = rect(1440.0, 0.0, 1920.0, 1056.0);
        let anchor = rect(1980.0, 1056.0, 40.0, 24.0);
        let frame = menubar_frame(anchor, external, 514.0).unwrap();
        assert_eq!(frame, rect(1843.0, 538.0, 314.0, 514.0));
        assert!(frame.origin.x >= external.origin.x);
        // A different anchor on the Retina primary keeps the same readable
        // logical width while fitting that screen's narrower logical bounds.
        let primary = menubar_frame(
            rect(1300.0, 876.0, 40.0, 24.0),
            rect(0.0, 0.0, 1440.0, 876.0),
            514.0,
        )
        .unwrap();
        assert_eq!(primary, rect(1126.0, 358.0, 314.0, 514.0));
        assert_eq!(primary.size, frame.size);
    }

    #[test]
    fn menubar_fits_negative_and_vertically_offset_displays_without_changing_text_scale() {
        let left = rect(-1920.0, -300.0, 1920.0, 1056.0);
        let edge = menubar_frame(rect(-1910.0, 756.0, 40.0, 24.0), left, 514.0).unwrap();
        assert_eq!(edge, rect(-1920.0, 238.0, 314.0, 514.0));
        let right = menubar_frame(rect(-30.0, 756.0, 30.0, 24.0), left, 514.0).unwrap();
        assert_eq!(right.origin.x, -314.0);
        let short = menubar_frame(rect(-100.0, 756.0, 40.0, 24.0), left, 460.0).unwrap();
        assert_eq!(
            short.origin.y + short.size.height,
            edge.origin.y + edge.size.height
        );
    }

    #[test]
    fn menubar_clamps_tall_content_and_rejects_incomplete_native_geometry() {
        let visible = rect(0.0, 100.0, 300.0, 240.0);
        let anchor = rect(260.0, 340.0, 40.0, 24.0);
        assert_eq!(menubar_frame(anchor, visible, 760.0).unwrap(), visible);
        assert!(menubar_frame(anchor, visible, f64::NAN).is_err());
        assert!(menubar_frame(anchor, rect(0.0, 0.0, 0.0, 0.0), 260.0).is_err());
    }

    #[test]
    fn restored_frame_on_a_remaining_negative_display_is_preserved() {
        let visible = rect(-1920.0, -300.0, 1920.0, 1056.0);
        let frame = rect(-1700.0, -120.0, 306.0, 506.0);
        assert_eq!(fit_visible_frame(frame, visible), Some(frame));
    }

    #[test]
    fn removed_display_and_partial_overflow_return_to_a_usable_work_area() {
        let visible = rect(0.0, 30.0, 1440.0, 846.0);
        assert_eq!(
            fit_visible_frame(rect(-1800.0, -500.0, 80.0, 80.0), visible),
            Some(rect(0.0, 30.0, 80.0, 80.0))
        );
        assert_eq!(
            fit_visible_frame(rect(1420.0, 850.0, 306.0, 506.0), visible),
            Some(rect(1134.0, 370.0, 306.0, 506.0))
        );
        assert_eq!(
            fit_visible_frame(
                rect(0.0, 0.0, 500.0, 900.0),
                rect(100.0, 50.0, 300.0, 200.0)
            ),
            Some(rect(100.0, 50.0, 300.0, 200.0))
        );
        assert!(fit_visible_frame(rect(f64::NAN, 0.0, 80.0, 80.0), visible).is_none());
    }

    #[test]
    fn combined_sidebar_frame_preserves_center_and_negative_screen_coordinates() {
        // A 2x display expands 8x56 points to 64x288, keeping its right edge
        // and vertical center stationary. AppKit uses a bottom-left origin.
        let origin = resized_origin((-8.0, -200.0), 56.0, 288.0, (-56.0, -116.0));
        assert_eq!(origin, (-64.0, -316.0));
        assert_eq!(
            resized_origin(origin, 288.0, 56.0, (56.0, 116.0)),
            (-8.0, -200.0)
        );
        assert_eq!(
            resized_origin((-1440.0, -200.0), 56.0, 288.0, (0.0, -116.0)),
            (-1440.0, -316.0)
        );
    }

    #[test]
    fn native_pointer_becomes_local_top_left_points_without_exposing_outside_coordinates() {
        let position =
            local_pointer_position((-1420.0, -700.0), (-1440.0, -900.0), (64.0, 288.0), 7).unwrap();
        assert_eq!((position.x, position.y), (20.0, 88.0));
        assert_eq!(
            (position.width, position.height, position.movement),
            (64.0, 288.0, 7)
        );
        let position = local_pointer_position((100.0, 100.0), (-1440.0, -900.0), (64.0, 288.0), 8);
        assert!(position.is_none());
        assert_eq!(
            serde_json::to_value(SidebarPointer {
                inside: false,
                position
            })
            .unwrap(),
            serde_json::json!({"inside": false})
        );
    }

    #[test]
    fn transparent_canvas_keeps_local_coordinates_without_claiming_an_input_hit() {
        let regions = serde_json::from_str::<Vec<crate::sidebar::SidebarInputRect>>(
            r#"[{"x":0,"y":262,"width":8,"height":56}]"#,
        )
        .unwrap();
        let position = local_pointer_position((4.0, 290.0), (0.0, 0.0), (376.0, 580.0), 1);
        assert!(sidebar_pointer(position, &regions).inside);
        let position = local_pointer_position((4.0, 500.0), (0.0, 0.0), (376.0, 580.0), 2);
        let pointer = sidebar_pointer(position, &regions);
        assert!(!pointer.inside);
        let local = pointer.position.unwrap();
        assert_eq!((local.x, local.y, local.movement), (4.0, 80.0, 2));
        let position = local_pointer_position((500.0, 500.0), (0.0, 0.0), (376.0, 580.0), 3);
        let pointer = sidebar_pointer(position, &regions);
        assert!(!pointer.inside);
        assert!(pointer.position.is_none());
    }

    #[test]
    fn pointer_hit_test_uses_appkit_points_and_supports_negative_monitor_origins() {
        let origin = (-1440.0, -900.0);
        let size = (8.0, 56.0);
        assert!(pointer_in_bounds((-1440.0, -900.0), origin, size));
        assert!(pointer_in_bounds((-1432.5, -844.5), origin, size));
        assert!(!pointer_in_bounds((-1432.0, -870.0), origin, size));
        assert!(!pointer_in_bounds((-1440.5, -870.0), origin, size));
        assert!(!pointer_in_bounds((-1436.0, -844.0), origin, size));
        assert!(!pointer_in_bounds((-1436.0, -900.5), origin, size));
    }

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
        assert!(!widget.create && !widget.visible && !widget.focus && !widget.fullscreen);
        assert!(widget.focusable && widget.always_on_top);
        assert!(widget.accept_first_mouse);
        assert_eq!(widget.width, 80.0);
        assert_eq!(widget.height, 80.0);
    }
}
