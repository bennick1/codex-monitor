//! Windows 11 desktop material, clipped independently from the HWND input area.
//! All entry points run on Tauri's UI thread; no window or WebView is recreated.
use std::{
    cell::RefCell,
    collections::HashMap,
    mem::size_of,
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::WebviewWindow;
use windows::{
    core::{implement, Error, Interface, Ref, Result as WinResult, GUID, HSTRING, PCWSTR},
    Foundation::{IPropertyValue, PropertyValue},
    Graphics::{
        Effects::{
            IGraphicsEffect, IGraphicsEffectSource, IGraphicsEffectSource_Impl,
            IGraphicsEffect_Impl,
        },
        IGeometrySource2D, IGeometrySource2D_Impl,
    },
    System::{DispatcherQueue, DispatcherQueueController},
    Wdk::System::SystemServices::RtlGetVersion,
    Win32::{
        Foundation::{E_INVALIDARG, E_NOTIMPL, HWND},
        Graphics::{
            Direct2D::{
                CLSID_D2D1GaussianBlur,
                Common::{D2D1_BEZIER_SEGMENT, D2D1_FIGURE_BEGIN_FILLED, D2D1_FIGURE_END_CLOSED},
                D2D1CreateFactory, ID2D1Factory, ID2D1Geometry, ID2D1PathGeometry,
                D2D1_FACTORY_TYPE_MULTI_THREADED,
            },
            Dwm::{DwmSetWindowAttribute, DWMWA_USE_HOSTBACKDROPBRUSH},
        },
        System::{
            SystemInformation::OSVERSIONINFOW,
            WinRT::{
                Composition::ICompositorDesktopInterop,
                CreateDispatcherQueueController, DispatcherQueueOptions,
                Graphics::Direct2D::{
                    IGeometrySource2DInterop, IGeometrySource2DInterop_Impl,
                    IGraphicsEffectD2D1Interop, IGraphicsEffectD2D1Interop_Impl,
                    GRAPHICS_EFFECT_PROPERTY_MAPPING,
                },
                DQTAT_COM_NONE, DQTYPE_THREAD_CURRENT,
            },
        },
    },
    UI::{
        Composition::{
            CompositionEffectBrush, CompositionEffectSourceParameter, CompositionPath, Compositor,
            ContainerVisual, Desktop::DesktopWindowTarget, SpriteVisual, Visual,
        },
        ViewManagement::{AccessibilitySettings, UISettings},
    },
};
use windows_numerics::{Vector2, Vector3};

use crate::sidebar_glass::{GlassFrame, GlassPathCommand, GlassRegion, GlassStatus};

thread_local! {
    static HOST: RefCell<Option<GlassHost>> = const { RefCell::new(None) };
    // Kept across mode changes. Shutting a current-thread queue down and then
    // creating another before its asynchronous shutdown ends races WinRT.
    static QUEUE: RefCell<Option<OwnedQueue>> = const { RefCell::new(None) };
    static SYSTEM_STATUS: RefCell<Option<(Instant, GlassStatus)>> = const { RefCell::new(None) };
}

struct OwnedQueue(DispatcherQueueController);

impl Drop for OwnedQueue {
    fn drop(&mut self) {
        // The existing UI pump completes shutdown; never block its own thread.
        let _ = self.0.ShutdownQueueAsync();
    }
}

fn ensure_queue() -> WinResult<()> {
    if DispatcherQueue::GetForCurrentThread().is_ok() {
        return Ok(());
    }
    let controller = unsafe {
        CreateDispatcherQueueController(DispatcherQueueOptions {
            dwSize: size_of::<DispatcherQueueOptions>() as u32,
            threadType: DQTYPE_THREAD_CURRENT,
            // Tauri already owns the thread's COM apartment.
            apartmentType: DQTAT_COM_NONE,
        })?
    };
    QUEUE.with(|queue| *queue.borrow_mut() = Some(OwnedQueue(controller)));
    Ok(())
}

fn system_status(refresh: bool) -> GlassStatus {
    SYSTEM_STATUS.with(|cache| {
        if !refresh {
            if let Some((checked, status)) = *cache.borrow() {
                if checked.elapsed() < Duration::from_secs(2) {
                    return status;
                }
            }
        }
        let status = (|| -> WinResult<GlassStatus> {
            let mut version = OSVERSIONINFOW {
                dwOSVersionInfoSize: size_of::<OSVERSIONINFOW>() as u32,
                ..Default::default()
            };
            unsafe { RtlGetVersion(&mut version) }.ok()?;
            if version.dwBuildNumber < 22000 {
                return Ok(GlassStatus::Unsupported);
            }
            if AccessibilitySettings::new()?.HighContrast()?
                || !UISettings::new()?.AdvancedEffectsEnabled()?
            {
                return Ok(GlassStatus::ReducedTransparency);
            }
            Ok(GlassStatus::Active)
        })()
        .unwrap_or(GlassStatus::Unavailable);
        *cache.borrow_mut() = Some((Instant::now(), status));
        status
    })
}

/// Called by the shared low-frequency settings observer, not a drawing loop.
pub fn poll_status(window: &WebviewWindow) -> Result<GlassStatus, String> {
    let status = system_status(true);
    if status != GlassStatus::Active {
        clear(window)?;
    }
    Ok(status)
}

fn host_backdrop(hwnd: HWND, enabled: bool) -> WinResult<()> {
    let value: i32 = i32::from(enabled);
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_HOSTBACKDROPBRUSH,
            (&value as *const i32).cast(),
            size_of::<i32>() as u32,
        )
    }
}

struct RegionVisual {
    sprite: SpriteVisual,
    width: f64,
    height: f64,
    scale: f64,
    path: Vec<GlassPathCommand>,
}

struct GlassHost {
    hwnd: HWND,
    compositor: Compositor,
    target: DesktopWindowTarget,
    root: ContainerVisual,
    brush: CompositionEffectBrush,
    factory: ID2D1Factory,
    regions: HashMap<String, RegionVisual>,
}

impl GlassHost {
    fn new(hwnd: HWND) -> WinResult<Self> {
        ensure_queue()?;
        let compositor = Compositor::new()?;
        let interop: ICompositorDesktopInterop = compositor.cast()?;
        // false places the material below the transparent WebView2 child HWND.
        let target = unsafe { interop.CreateDesktopWindowTarget(hwnd, false)? };
        let root = compositor.CreateContainerVisual()?;
        root.SetOpacity(0.0)?;
        target.SetRoot(&root)?;
        let source_name = HSTRING::from("desktop");
        let source = CompositionEffectSourceParameter::Create(&source_name)?;
        let effect: IGraphicsEffect = DesktopBlur {
            source: source.cast()?,
            name: Mutex::new(HSTRING::from("sidebarBlur")),
        }
        .into();
        let brush = compositor.CreateEffectFactory(&effect)?.CreateBrush()?;
        brush.SetSourceParameter(&source_name, &compositor.CreateHostBackdropBrush()?)?;
        // The WinRT geometry adapter is agile; the compositor may query it from
        // its worker thread after this UI callback has finished.
        let factory = unsafe { D2D1CreateFactory(D2D1_FACTORY_TYPE_MULTI_THREADED, None)? };
        host_backdrop(hwnd, true)?;
        Ok(Self {
            hwnd,
            compositor,
            target,
            root,
            brush,
            factory,
            regions: HashMap::new(),
        })
    }

    fn apply(&mut self, frame: &GlassFrame, scale: f64) -> WinResult<()> {
        self.root.SetSize(Vector2 {
            X: (frame.width * scale) as f32,
            Y: (frame.height * scale) as f32,
        })?;
        for (id, native) in &self.regions {
            if !frame.regions.iter().any(|region| &region.id == id) {
                native.sprite.SetOpacity(0.0)?;
            }
        }
        for region in &frame.regions {
            if !self.regions.contains_key(&region.id) {
                let sprite = self.compositor.CreateSpriteVisual()?;
                // Start invisible. Install the exact clip before the first show.
                sprite.SetOpacity(0.0)?;
                sprite.SetBrush(&self.brush)?;
                self.root.Children()?.InsertAtTop(&sprite)?;
                self.regions.insert(
                    region.id.clone(),
                    RegionVisual {
                        sprite,
                        width: 0.0,
                        height: 0.0,
                        scale: 0.0,
                        path: Vec::new(),
                    },
                );
            }
            let native = self.regions.get_mut(&region.id).expect("region inserted");
            if native.width != region.width
                || native.height != region.height
                || native.scale != scale
                || native.path != region.path
            {
                let path = make_path(&self.factory, region, scale)?;
                let source: IGeometrySource2D = GeometrySource(path).into();
                let geometry = self
                    .compositor
                    .CreatePathGeometryWithPath(&CompositionPath::Create(&source)?)?;
                native
                    .sprite
                    .SetClip(&self.compositor.CreateGeometricClipWithGeometry(&geometry)?)?;
                native.width = region.width;
                native.height = region.height;
                native.scale = scale;
                native.path.clone_from(&region.path);
            }
            native.sprite.SetSize(Vector2 {
                X: (region.width * scale) as f32,
                Y: (region.height * scale) as f32,
            })?;
            native.sprite.SetOffset(Vector3 {
                X: (region.x * scale) as f32,
                Y: (region.y * scale) as f32,
                Z: 0.0,
            })?;
            native.sprite.SetOpacity(region.opacity as f32)?;
        }
        // WinRT batches property updates until the current UI callback returns.
        self.root.SetOpacity(1.0)
    }
}

impl Drop for GlassHost {
    fn drop(&mut self) {
        let _ = self.root.SetOpacity(0.0);
        let _ = self.target.SetRoot(None::<&Visual>);
        for region in self.regions.values() {
            let _ = region.sprite.Close();
        }
        let _ = self.root.Close();
        let _ = self.target.Close();
        let _ = self.brush.Close();
        let _ = self.compositor.Close();
        let _ = host_backdrop(self.hwnd, false);
    }
}

pub fn apply(window: &WebviewWindow, frame: &GlassFrame) -> Result<GlassStatus, String> {
    let status = system_status(false);
    // 系统无障碍要求优先于用户材质开关；关闭开关仍需实色回退。
    if status == GlassStatus::ReducedTransparency {
        clear(window)?;
        return Ok(status);
    }
    if !frame.enabled {
        clear(window)?;
        return Ok(GlassStatus::Disabled);
    }
    if status != GlassStatus::Active {
        clear(window)?;
        return Ok(status);
    }
    let hwnd = HWND(window.hwnd().map_err(|error| error.to_string())?.0);
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let result = HOST.with(|host| -> WinResult<()> {
        let mut host = host.borrow_mut();
        if host.as_ref().is_some_and(|host| host.hwnd != hwnd) {
            *host = None;
        }
        if host.is_none() {
            *host = Some(GlassHost::new(hwnd)?);
        }
        host.as_mut().expect("host initialized").apply(frame, scale)
    });
    if let Err(error) = result {
        clear(window)?;
        return Err(format!("Windows sidebar material unavailable: {error}"));
    }
    Ok(GlassStatus::Active)
}

pub fn clear(_: &WebviewWindow) -> Result<(), String> {
    HOST.with(|host| *host.borrow_mut() = None);
    Ok(())
}

/// Only for application exit; a mode toggle must retain a queue we created.
pub fn shutdown(window: &WebviewWindow) -> Result<(), String> {
    clear(window)?;
    QUEUE.with(|queue| *queue.borrow_mut() = None);
    Ok(())
}

fn make_path(
    factory: &ID2D1Factory,
    region: &GlassRegion,
    scale: f64,
) -> WinResult<ID2D1PathGeometry> {
    let point = |x: f64, y: f64| Vector2 {
        X: (x * region.width * scale) as f32,
        Y: (y * region.height * scale) as f32,
    };
    unsafe {
        let path = factory.CreatePathGeometry()?;
        let sink = path.Open()?;
        let mut open = false;
        for command in &region.path {
            match *command {
                GlassPathCommand::Move { x, y } => {
                    if open {
                        sink.EndFigure(D2D1_FIGURE_END_CLOSED);
                    }
                    sink.BeginFigure(point(x, y), D2D1_FIGURE_BEGIN_FILLED);
                    open = true;
                }
                GlassPathCommand::Line { x, y } => sink.AddLine(point(x, y)),
                GlassPathCommand::Curve {
                    x1,
                    y1,
                    x2,
                    y2,
                    x,
                    y,
                } => sink.AddBezier(&D2D1_BEZIER_SEGMENT {
                    point1: point(x1, y1),
                    point2: point(x2, y2),
                    point3: point(x, y),
                }),
                GlassPathCommand::Close => {
                    if open {
                        sink.EndFigure(D2D1_FIGURE_END_CLOSED);
                        open = false;
                    }
                }
            }
        }
        if open {
            sink.EndFigure(D2D1_FIGURE_END_CLOSED);
        }
        sink.Close()?;
        Ok(path)
    }
}

#[implement(IGeometrySource2D, IGeometrySource2DInterop)]
struct GeometrySource(ID2D1PathGeometry);

impl IGeometrySource2D_Impl for GeometrySource_Impl {}

impl IGeometrySource2DInterop_Impl for GeometrySource_Impl {
    fn GetGeometry(&self) -> WinResult<ID2D1Geometry> {
        self.0.cast()
    }

    fn TryGetGeometryUsingFactory(
        &self,
        factory: Ref<'_, ID2D1Factory>,
    ) -> WinResult<ID2D1Geometry> {
        unsafe {
            let path = factory.ok()?.CreatePathGeometry()?;
            let sink = path.Open()?;
            self.0.Stream(&sink)?;
            sink.Close()?;
            path.cast()
        }
    }
}

// A backdrop brush is an effect input, not a frosted surface on its own. This
// small Direct2D effect avoids adding Win2D or a second UI framework.
#[implement(IGraphicsEffect, IGraphicsEffectSource, IGraphicsEffectD2D1Interop)]
struct DesktopBlur {
    source: IGraphicsEffectSource,
    name: Mutex<HSTRING>,
}

impl IGraphicsEffectSource_Impl for DesktopBlur_Impl {}

impl IGraphicsEffect_Impl for DesktopBlur_Impl {
    fn Name(&self) -> WinResult<HSTRING> {
        Ok(self
            .name
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone())
    }
    fn SetName(&self, name: &HSTRING) -> WinResult<()> {
        *self.name.lock().unwrap_or_else(|error| error.into_inner()) = name.clone();
        Ok(())
    }
}

impl IGraphicsEffectD2D1Interop_Impl for DesktopBlur_Impl {
    fn GetEffectId(&self) -> WinResult<GUID> {
        Ok(CLSID_D2D1GaussianBlur)
    }
    fn GetNamedPropertyMapping(
        &self,
        _: &PCWSTR,
        _: *mut u32,
        _: *mut GRAPHICS_EFFECT_PROPERTY_MAPPING,
    ) -> WinResult<()> {
        Err(Error::from_hresult(E_NOTIMPL))
    }
    fn GetPropertyCount(&self) -> WinResult<u32> {
        Ok(3)
    }
    fn GetProperty(&self, index: u32) -> WinResult<IPropertyValue> {
        match index {
            0 => PropertyValue::CreateSingle(18.0)?.cast(),
            // Balanced optimization, hard border: no transparent halo at edges.
            1 => PropertyValue::CreateUInt32(1)?.cast(),
            2 => PropertyValue::CreateUInt32(1)?.cast(),
            _ => Err(Error::from_hresult(E_INVALIDARG)),
        }
    }
    fn GetSource(&self, index: u32) -> WinResult<IGraphicsEffectSource> {
        if index == 0 {
            Ok(self.source.clone())
        } else {
            Err(Error::from_hresult(E_INVALIDARG))
        }
    }
    fn GetSourceCount(&self) -> WinResult<u32> {
        Ok(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_mask_preserves_curved_cutout_at_fractional_dpi() {
        let factory: ID2D1Factory =
            unsafe { D2D1CreateFactory(D2D1_FACTORY_TYPE_MULTI_THREADED, None).unwrap() };
        let region = GlassRegion {
            id: "panel".into(),
            // Position belongs to SpriteVisual, never to its local mask.
            x: 300.0,
            y: 500.0,
            width: 100.0,
            height: 80.0,
            opacity: 1.0,
            path: vec![
                GlassPathCommand::Move { x: 0.25, y: 0.0 },
                GlassPathCommand::Line { x: 1.0, y: 0.0 },
                GlassPathCommand::Line { x: 1.0, y: 1.0 },
                GlassPathCommand::Line { x: 0.0, y: 1.0 },
                GlassPathCommand::Line { x: 0.0, y: 0.25 },
                GlassPathCommand::Curve {
                    x1: 0.0,
                    y1: 0.112,
                    x2: 0.112,
                    y2: 0.0,
                    x: 0.25,
                    y: 0.0,
                },
                GlassPathCommand::Close,
            ],
        };
        let path = make_path(&factory, &region, 1.5).unwrap();
        unsafe {
            let bounds = path.GetBounds(None).unwrap();
            assert_eq!(
                (bounds.left, bounds.top, bounds.right, bounds.bottom),
                (0.0, 0.0, 150.0, 120.0)
            );
            assert!(!path
                .FillContainsPoint(Vector2 { X: 1.0, Y: 1.0 }, None, 0.1)
                .unwrap()
                .as_bool());
            assert!(path
                .FillContainsPoint(Vector2 { X: 75.0, Y: 60.0 }, None, 0.1)
                .unwrap()
                .as_bool());

            let other: ID2D1Factory =
                D2D1CreateFactory(D2D1_FACTORY_TYPE_MULTI_THREADED, None).unwrap();
            let source: IGeometrySource2D = GeometrySource(path).into();
            let interop: IGeometrySource2DInterop = source.cast().unwrap();
            let copied = interop.TryGetGeometryUsingFactory(&other).unwrap();
            assert_eq!(copied.GetBounds(None).unwrap(), bounds);
        }
    }
}
