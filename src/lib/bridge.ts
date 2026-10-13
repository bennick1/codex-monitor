import type { QuotaWindowBoundary } from "./tokenStatistics";
import { EMPTY_DEEPSEEK, type AccountUsage, type DeepSeekUsage } from "./sidebarData";
import type { ProviderSnapshot, WidgetPreferences } from "../types";
import type { TokenStatisticsSnapshot, TokenStatisticsNotification, TokenStatisticsRefresh } from "./tokenStatistics";
import type { SidebarInputRect } from "./widgetGeometry";
import type { SidebarGlassFrame, SidebarGlassStatus } from "./sidebarGlass";

const defaultPreferences: WidgetPreferences = { autoCheckUpdates: true, locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN", appearance: "light", selectedSkin: "default" };

const mockSnapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74, resetsAt: new Date(Date.now() + 78 * 60_000).toISOString(), windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: new Date(Date.now() + 3.2 * 86_400_000).toISOString(), windowSeconds: 604_800 },
  resetCredits: 1,
  resetCreditExpiresAt: [new Date(Date.now() + 9 * 86_400_000).toISOString()],
  updatedAt: new Date().toISOString(),
  status: "ok",
  message: null,
};

let widgetTransition: Promise<void> = Promise.resolve();

function enqueueWidgetTransition<T>(operation: () => Promise<T>): Promise<T> {
  const next = widgetTransition.then(operation, operation);
  widgetTransition = next.then(() => undefined, () => undefined);
  return next;
}

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export type SidebarPhase = "handle" | "rail" | "detail" | "menu";
export interface SidebarViewport { width: number; height: number; scale: number }

function waitForSidebarViewport(size: SidebarViewport): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame = 0;
    let matchingFrames = 0;
    const finish = (error?: Error) => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      if (error) reject(error); else resolve();
    };
    const check = () => {
      // An AppKit/Windows resize reply may precede the WebView resize event.
      // Paint the hidden surface at its real size before starting its entrance.
      const matches = Math.abs(window.innerWidth - size.width) <= 1 && Math.abs(window.innerHeight - size.height) <= 1;
      matchingFrames = matches ? matchingFrames + 1 : 0;
      if (matchingFrames >= 2) finish();
      else frame = window.requestAnimationFrame(check);
    };
    const timeout = window.setTimeout(() => finish(new Error("Sidebar viewport did not settle")), 1500);
    frame = window.requestAnimationFrame(check);
  });
}

export function setSidebarPhase(phase: SidebarPhase): Promise<SidebarViewport | null> {
  if (!isTauri()) return Promise.resolve(null);
  return enqueueWidgetTransition(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const viewport = await invoke<SidebarViewport | null>("set_sidebar_phase", { phase });
    if (viewport) await waitForSidebarViewport(viewport);
    return viewport;
  });
}

export async function syncSidebarRegions(phase: SidebarPhase, interactiveRegions: SidebarInputRect[]): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  // Region updates use the existing command but never resize or take focus.
  await invoke("set_sidebar_phase", { phase, interactiveRegions });
}

export async function syncSidebarGlass(frame: SidebarGlassFrame): Promise<SidebarGlassStatus> {
  if (!isTauri()) return "unsupported";
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SidebarGlassStatus>("sync_sidebar_glass", { frame });
}

export async function listenSidebarGlassInvalidated(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("sidebar-glass-invalidated", handler);
}

export async function sidebarAction(action: "refresh" | "releases" | "quit" | "autostart"): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("sidebar_action", { action });
}

export async function getAutostart(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("get_autostart");
}

export async function listenSidebarRecovery(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("sidebar-recover", handler);
}

export async function listenSidebarDismiss(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("sidebar-dismiss", handler);
}

export interface SidebarPointer {
  inside: boolean;
  position?: { x: number; y: number; width: number; height: number; movement: number };
}

export async function listenSidebarPointer(handler: (pointer: SidebarPointer) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<SidebarPointer>("sidebar-pointer", event => handler(event.payload));
}

export async function getAccountUsage(): Promise<AccountUsage> {
  if (!isTauri()) throw new Error("Account statistics require the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AccountUsage>("get_account_usage");
}
export async function getDeepSeekUsage(): Promise<DeepSeekUsage> {
  if (!isTauri()) return EMPTY_DEEPSEEK;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DeepSeekUsage>("get_deepseek_usage");
}
export async function deepSeekSession(action: "open" | "disconnect"): Promise<void> {
  if (!isTauri()) throw new Error("DeepSeek login requires the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(action === "open" ? "open_deepseek_login" : "disconnect_deepseek");
}
export async function listenDeepSeekReady(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("deepseek-ready", handler);
}

export async function fetchSnapshots(force = false): Promise<ProviderSnapshot[]> {
  if (!isTauri()) return [mockSnapshot];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProviderSnapshot[]>(force ? "refresh_snapshots" : "get_snapshots");
}

export async function getTokenStatistics(quotaWindow: QuotaWindowBoundary | null = null): Promise<TokenStatisticsSnapshot> {
  if (!isTauri()) throw new Error("Local Token Statistics requires the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TokenStatisticsSnapshot>("get_token_statistics", { quotaWindow });
}

export async function refreshTokenStatistics(): Promise<TokenStatisticsRefresh> {
  if (!isTauri()) throw new Error("Local Token Statistics requires the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TokenStatisticsRefresh>("refresh_token_statistics");
}

export async function listenTokenStatisticsUpdated(handler: (event: TokenStatisticsNotification) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<TokenStatisticsNotification>("token-statistics-updated", (event) => handler(event.payload));
}

export async function getPreferences(): Promise<WidgetPreferences> {
  if (!isTauri()) return defaultPreferences;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("get_preferences");
}

export async function updatePreferences(value: WidgetPreferences): Promise<void> {
  if (!isTauri()) return;
  await enqueueWidgetTransition(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_preferences", { preferences: value });
  });
}

export async function setClickThrough(locked: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, locked };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_locked", { locked });
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, alwaysOnTop };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_always_on_top", { alwaysOnTop });
}

export function syncWidgetAppearance(appearance: "light" | "dark", expandedHeightMode: "full" | "compact" = "full"): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return enqueueWidgetTransition(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const monitor = await currentMonitor().catch(() => null);
    const workArea = monitor ? {
      position: { x: monitor.workArea.position.x, y: monitor.workArea.position.y },
      size: { width: monitor.workArea.size.width, height: monitor.workArea.size.height },
    } : null;
    await invoke("sync_widget_appearance", { appearance, expandedHeightMode, workArea });
  });
}

export async function startDragging(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { invoke } = await import("@tauri-apps/api/core");
  const currentWindow = getCurrentWindow();
  await invoke("begin_widget_drag");
  await currentWindow.startDragging();
  let previous = await currentWindow.outerPosition();
  let stableTicks = 0;
  let attempts = 0;
  const finishWhenStable = window.setInterval(() => {
    void currentWindow.outerPosition()
      .then((next) => {
        attempts += 1;
        const stable = Math.abs(next.x - previous.x) <= 1 && Math.abs(next.y - previous.y) <= 1;
        stableTicks = stable ? stableTicks + 1 : 0;
        previous = next;
        if (stableTicks >= 3 || attempts >= 25) {
          window.clearInterval(finishWhenStable);
          void invoke("finish_widget_drag").catch(() => undefined);
        }
      })
      .catch(() => {
        window.clearInterval(finishWhenStable);
        void invoke("finish_widget_drag").catch(() => undefined);
      });
  }, 80);
}

export function setWidgetExpanded(expanded: boolean): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return enqueueWidgetTransition(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    if (!expanded) {
      await invoke("collapse_widget");
      return;
    }
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const monitor = await currentMonitor().catch(() => null);
    const workArea = monitor ? {
      position: { x: monitor.workArea.position.x, y: monitor.workArea.position.y },
      size: { width: monitor.workArea.size.width, height: monitor.workArea.size.height },
    } : null;
    await invoke("expand_widget", { workArea });
  });
}

export async function listenDesktopEvents(handlers: {
  onPreferences: (value: WidgetPreferences) => void;
  onRefresh: () => void;
  onRelease: () => void;
}): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  const unlistenPreferences = await listen<WidgetPreferences>("preferences-changed", (event) => handlers.onPreferences(event.payload));
  const unlistenRefresh = await listen("refresh-requested", handlers.onRefresh);
  const unlistenRelease = await listen("release-page-requested", handlers.onRelease);
  return () => { unlistenPreferences(); unlistenRefresh(); unlistenRelease(); };
}
