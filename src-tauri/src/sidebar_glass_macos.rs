//! 局部桌面磨砂：材质始终位于透明 WebView 下方，不参与窗口命中或焦点管理。
use std::{cell::RefCell, collections::HashMap, ptr::NonNull};

use block2::RcBlock;
use objc2::{
    rc::Retained,
    runtime::{Bool, ProtocolObject},
    MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
    NSBezierPath, NSColor, NSImage, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
    NSVisualEffectState, NSVisualEffectView, NSWindow,
    NSWindowDidChangeBackingPropertiesNotification, NSWindowDidChangeScreenNotification,
    NSWindowOrderingMode, NSWorkspace, NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification,
    NSWorkspaceDidWakeNotification, NSWorkspaceScreensDidWakeNotification,
};
use objc2_foundation::{
    NSNotification, NSNotificationCenter, NSNotificationName, NSObjectProtocol, NSPoint, NSRect,
    NSSize,
};
use tauri::{Emitter, WebviewWindow};

use crate::sidebar_glass::{GlassFrame, GlassPathCommand, GlassRegion, GlassStatus};

thread_local! {
    static GLASS: RefCell<Option<GlassState>> = const { RefCell::new(None) };
}

#[derive(Clone, PartialEq)]
enum MaskCommand {
    Move(f64, f64),
    Line(f64, f64),
    Curve(f64, f64, f64, f64, f64, f64),
    Close,
}

#[derive(Clone, PartialEq)]
struct MaskGeometry {
    width: f64,
    height: f64,
    scale: f64,
    commands: Vec<MaskCommand>,
}

impl MaskGeometry {
    fn from_region(region: &GlassRegion, scale: f64) -> Self {
        Self {
            width: region.width,
            height: region.height,
            scale,
            commands: region
                .path
                .iter()
                .map(|command| match *command {
                    GlassPathCommand::Move { x, y } => MaskCommand::Move(x, y),
                    GlassPathCommand::Line { x, y } => MaskCommand::Line(x, y),
                    GlassPathCommand::Curve {
                        x1,
                        y1,
                        x2,
                        y2,
                        x,
                        y,
                    } => MaskCommand::Curve(x1, y1, x2, y2, x, y),
                    GlassPathCommand::Close => MaskCommand::Close,
                })
                .collect(),
        }
    }

    fn image(&self) -> Retained<NSImage> {
        let geometry = self.clone();
        let draw = RcBlock::new(move |_rect: NSRect| {
            // 图像采用左上角坐标；仅填充 alpha 轮廓，空白画布始终透明。
            let point = |x, y| NSPoint::new(x * geometry.width, y * geometry.height);
            let path = NSBezierPath::bezierPath();
            for command in &geometry.commands {
                match *command {
                    MaskCommand::Move(x, y) => path.moveToPoint(point(x, y)),
                    MaskCommand::Line(x, y) => path.lineToPoint(point(x, y)),
                    MaskCommand::Curve(x1, y1, x2, y2, x, y) => path
                        .curveToPoint_controlPoint1_controlPoint2(
                            point(x, y),
                            point(x1, y1),
                            point(x2, y2),
                        ),
                    MaskCommand::Close => path.closePath(),
                }
            }
            NSColor::whiteColor().setFill();
            path.fill();
            Bool::YES
        });
        NSImage::imageWithSize_flipped_drawingHandler(
            NSSize::new(self.width, self.height),
            true,
            &draw,
        )
    }
}

struct RegionView {
    view: Retained<NSVisualEffectView>,
    geometry: MaskGeometry,
}

struct Observer {
    center: Retained<NSNotificationCenter>,
    token: Retained<ProtocolObject<dyn NSObjectProtocol>>,
}

impl Drop for Observer {
    fn drop(&mut self) {
        // token 只用于其注册中心，且状态只会在主线程释放。
        unsafe { self.center.removeObserver((*self.token).as_ref()) };
    }
}

struct GlassState {
    window: usize,
    views: HashMap<String, RegionView>,
    _observers: Vec<Observer>,
}

impl GlassState {
    fn new(window: &WebviewWindow, native: &NSWindow) -> Self {
        let workspace = NSWorkspace::sharedWorkspace();
        let center = NSNotificationCenter::defaultCenter();
        // 通知回调只发失效事件，不读账户信息、不重入材质状态。
        let observers = unsafe {
            vec![
                observe(
                    window,
                    workspace.notificationCenter(),
                    NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification,
                    None,
                ),
                observe(
                    window,
                    workspace.notificationCenter(),
                    NSWorkspaceDidWakeNotification,
                    None,
                ),
                observe(
                    window,
                    workspace.notificationCenter(),
                    NSWorkspaceScreensDidWakeNotification,
                    None,
                ),
                observe(
                    window,
                    center.clone(),
                    NSWindowDidChangeBackingPropertiesNotification,
                    Some(native),
                ),
                observe(
                    window,
                    center,
                    NSWindowDidChangeScreenNotification,
                    Some(native),
                ),
            ]
        };
        Self {
            window: native as *const NSWindow as usize,
            views: HashMap::new(),
            _observers: observers,
        }
    }

    fn remove_views(&mut self) {
        for (_, region) in self.views.drain() {
            region.view.setHidden(true);
            region.view.removeFromSuperview();
        }
    }
}

impl Drop for GlassState {
    fn drop(&mut self) {
        self.remove_views();
    }
}

unsafe fn observe(
    window: &WebviewWindow,
    center: Retained<NSNotificationCenter>,
    name: &NSNotificationName,
    native: Option<&NSWindow>,
) -> Observer {
    let handle = window.clone();
    let callback = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        let _ = handle.emit("sidebar-glass-invalidated", ());
    });
    // 通知对象为空或该 NSWindow；Tauri 句柄可跨线程发送，回调不访问 AppKit。
    let token = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(name),
            native.map(|window| window.as_ref()),
            None,
            &callback,
        )
    };
    Observer { center, token }
}

fn region_frame(region: &GlassRegion, canvas_height: f64, flipped: bool) -> NSRect {
    NSRect::new(
        NSPoint::new(
            region.x,
            if flipped {
                region.y
            } else {
                canvas_height - region.y - region.height
            },
        ),
        NSSize::new(region.width, region.height),
    )
}

pub fn apply(window: &WebviewWindow, frame: &GlassFrame) -> Result<GlassStatus, String> {
    let main = MainThreadMarker::new().ok_or("glass requires the main thread")?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    // Tauri 句柄在调用期间持有原生窗口，且上方已经验证主线程。
    let native = unsafe { pointer.cast::<NSWindow>().as_ref() }.ok_or("glass NSWindow missing")?;
    let content = native.contentView().ok_or("glass content view missing")?;
    GLASS.with(|storage| {
        let mut storage = storage.borrow_mut();
        if storage
            .as_ref()
            .is_none_or(|state| state.window != native as *const NSWindow as usize)
        {
            *storage = Some(GlassState::new(window, native));
        }
        let state = storage.as_mut().expect("glass state initialized");
        let workspace = NSWorkspace::sharedWorkspace();
        // 即使用户关闭效果也保留监听与无障碍状态，以便前端启用实色回退。
        if workspace.accessibilityDisplayShouldReduceTransparency()
            || workspace.accessibilityDisplayShouldIncreaseContrast()
        {
            state.remove_views();
            return Ok(GlassStatus::ReducedTransparency);
        }
        if !frame.enabled {
            state.remove_views();
            return Ok(GlassStatus::Disabled);
        }
        let appearance_name = unsafe {
            if frame.theme == "dark" {
                NSAppearanceNameDarkAqua
            } else {
                NSAppearanceNameAqua
            }
        };
        let appearance = NSAppearance::appearanceNamed(appearance_name);
        for (id, region) in &state.views {
            if !frame.regions.iter().any(|next| next.id == *id) {
                // 收起只隐藏，下一次移入继续复用至多四个区域，避免重建材质。
                region.view.setHidden(true);
            }
        }
        for region in &frame.regions {
            let geometry = MaskGeometry::from_region(region, native.backingScaleFactor());
            let rect = region_frame(region, content.bounds().size.height, content.isFlipped());
            let entry = state.views.entry(region.id.clone()).or_insert_with(|| {
                let view = NSVisualEffectView::initWithFrame(NSVisualEffectView::alloc(main), rect);
                // 必须在加入层级前隐藏并裁剪，避免初始全矩形毛玻璃闪烁。
                view.setHidden(true);
                view.setMaterial(NSVisualEffectMaterial::Popover);
                view.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
                view.setState(NSVisualEffectState::Active);
                view.setMaskImage(Some(&geometry.image()));
                content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
                RegionView {
                    view,
                    geometry: geometry.clone(),
                }
            });
            if entry.geometry != geometry {
                entry.view.setMaskImage(Some(&geometry.image()));
                entry.geometry = geometry;
            }
            entry.view.setFrame(rect);
            entry.view.setAppearance(appearance.as_deref());
            entry.view.setAlphaValue(region.opacity);
            entry.view.setHidden(region.opacity <= 0.0);
        }
        Ok(GlassStatus::Active)
    })
}

pub fn clear(_window: &WebviewWindow) -> Result<(), String> {
    let _main = MainThreadMarker::new().ok_or("glass cleanup requires the main thread")?;
    GLASS.with(|storage| *storage.borrow_mut() = None);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region() -> GlassRegion {
        GlassRegion {
            id: "detail".into(),
            x: 24.0,
            y: 30.0,
            width: 260.0,
            height: 320.0,
            opacity: 1.0,
            path: vec![
                GlassPathCommand::Move { x: 0.0, y: 0.0 },
                GlassPathCommand::Line { x: 1.0, y: 1.0 },
                GlassPathCommand::Close,
            ],
        }
    }

    #[test]
    fn top_left_region_coordinates_match_both_appkit_orientations() {
        let region = region();
        let flipped = region_frame(&region, 500.0, true);
        let normal = region_frame(&region, 500.0, false);
        assert_eq!(flipped.origin, NSPoint::new(24.0, 30.0));
        assert_eq!(normal.origin, NSPoint::new(24.0, 150.0));
        assert_eq!(flipped.size, normal.size);
    }

    #[test]
    fn translation_and_fade_reuse_masks_but_resize_and_backing_scale_invalidate() {
        let mut region = region();
        let original = MaskGeometry::from_region(&region, 2.0);
        region.x += 12.5;
        region.y -= 10.0;
        region.opacity = 0.4;
        assert!(original == MaskGeometry::from_region(&region, 2.0));
        assert!(original != MaskGeometry::from_region(&region, 1.0));
        region.width *= 1.1;
        assert!(original != MaskGeometry::from_region(&region, 2.0));
    }
}
