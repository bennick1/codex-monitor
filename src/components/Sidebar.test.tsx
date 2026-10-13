// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { EMPTY_DEEPSEEK } from "../lib/sidebarData";
import type { ProviderSnapshot, WidgetPreferences } from "../types";
import type { SidebarPointer } from "../lib/bridge";

const api = vi.hoisted(() => ({ phase: vi.fn(), regions: vi.fn(), glass: vi.fn(), glassInvalidated: vi.fn(), account: vi.fn(), deepseek: vi.fn(), session: vi.fn(), action: vi.fn(), recovery: vi.fn(), dismiss: vi.fn(), pointer: vi.fn(), hit: vi.fn() }));
vi.mock("../lib/bridge", () => ({
  setSidebarPhase: api.phase, syncSidebarRegions: api.regions, getAccountUsage: api.account, getDeepSeekUsage: api.deepseek,
  syncSidebarGlass: api.glass, listenSidebarGlassInvalidated: api.glassInvalidated,
  setAlwaysOnTop: vi.fn(), sidebarAction: api.action, getAutostart: vi.fn(async () => false), deepSeekSession: api.session,
  listenDeepSeekReady: vi.fn(async () => () => {}), listenSidebarRecovery: api.recovery, listenSidebarDismiss: api.dismiss, listenSidebarPointer: api.pointer,
}));
const prefs: WidgetPreferences = { displayMode: "sidebar", sidebarSide: "right", sidebarOpacity: .9, locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN", appearance: "light", selectedSkin: "default" };
const quota: ProviderSnapshot = { provider: "codex", displayName: "CODEX", plan: "TEST", shortWindow: { remainingPercent: 74, resetsAt: null, windowSeconds: 18000 }, weeklyWindow: null, resetCredits: 4, updatedAt: "2026-10-01T00:00:00Z", status: "ok", message: null };
const update = vi.fn();
const updaterOpen = vi.hoisted(() => vi.fn());
vi.mock("../lib/updater", () => ({ openUpdateWindow: updaterOpen }));
vi.mock("../hooks/useUpdater", () => ({ useUpdater: () => ({ state: { version: "2.0" } }) }));
function mount(patch: Partial<WidgetPreferences> = {}, snapshot = quota) { return render(<Sidebar snapshot={snapshot} preferences={{ ...prefs, ...patch }} theme="light" onPreferences={update} onRefresh={vi.fn()} notice={null} />); }
async function flush() { await act(async () => { await Promise.resolve(); }); }
async function expand() { fireEvent.mouseEnter(screen.getByRole("main"), { screenX: 1900, screenY: 500 }); await flush(); }
function hover(name: string, y = 450) { fireEvent.mouseEnter(screen.getByRole("button", { name }), { screenX: 1880, screenY: y }); }
async function nativeHover(target: Element | null, movement: number, patch: Partial<NonNullable<SidebarPointer["position"]>> = {}) {
  api.hit.mockReturnValue(target);
  act(() => api.pointer.mock.calls[0][0]({ inside: true, position: {
    x: 30, y: 90, width: window.innerWidth, height: window.innerHeight, movement, ...patch,
  } }));
  await flush();
}
beforeEach(() => {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: api.hit });
  vi.useFakeTimers(); vi.clearAllMocks(); api.phase.mockResolvedValue(undefined); api.regions.mockResolvedValue(undefined); api.recovery.mockResolvedValue(() => {}); api.dismiss.mockResolvedValue(() => {}); api.pointer.mockResolvedValue(() => {});
  api.account.mockResolvedValue({ lifetimeTokens: "9007199254740993", peakDailyTokens: "1234", longestRunningTurnSeconds: 11460, currentStreakDays: 18, longestStreakDays: 25, daily: [], updatedAt: "2026-10-01T00:00:00Z" });
  api.deepseek.mockResolvedValue({ ...EMPTY_DEEPSEEK, status: "ok", balance: 8.89, spent: 21.11 });
  api.glass.mockResolvedValue("active"); api.glassInvalidated.mockResolvedValue(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("defaults glass on, saves the switch independently and clears the native layer when disabled", async () => {
  function Harness() {
    const [value, save] = useState<WidgetPreferences>(prefs);
    return <Sidebar snapshot={quota} preferences={value} theme="light" onPreferences={next => { update(next); save(next); }} onRefresh={vi.fn()} notice={null} />;
  }
  render(<Harness />); await expand();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  expect((screen.getByRole("switch", { name: "毛玻璃效果" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("switch", { name: "毛玻璃效果" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarGlassEnabled: false, sidebarOpacity: .9 }));
  expect(screen.getByRole("main").dataset.glass).toBe("disabled");
  expect(api.glass).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, regions: [] }));
  expect(screen.getByRole("dialog", { name: "侧边栏菜单" })).toBeTruthy();
});

it("explains the solid accessibility fallback and refreshes after native invalidation", async () => {
  api.glass.mockResolvedValue("reducedTransparency");
  mount(); await expand();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  expect(screen.getByRole("main").dataset.glass).toBe("reducedTransparency");
  expect(screen.getByText("系统已减少透明度，当前使用实色背景。")).toBeTruthy();
  api.glass.mockResolvedValue("active");
  act(() => api.glassInvalidated.mock.calls[0][0]());
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  expect(screen.getByRole("main").dataset.glass).toBe("active");
  expect(screen.queryByText("系统已减少透明度，当前使用实色背景。")).toBeNull();
});

it("honors system transparency requirements while glass is disabled and retains the user's choice after recovery", async () => {
  api.glass.mockResolvedValue("reducedTransparency");
  mount({ sidebarGlassEnabled: false }); await expand();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  expect(screen.getByRole("main").dataset.glass).toBe("reducedTransparency");
  expect(screen.getByText("系统已减少透明度，当前使用实色背景。")).toBeTruthy();
  expect((screen.getByRole("switch", { name: "毛玻璃效果" }) as HTMLInputElement).checked).toBe(false);
  expect(api.glass).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, regions: [] }));
  expect(update).not.toHaveBeenCalled();
  api.glass.mockResolvedValue("disabled");
  act(() => api.glassInvalidated.mock.calls[0][0]());
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  expect(screen.getByRole("main").dataset.glass).toBe("disabled");
  expect(screen.queryByText("系统已减少透明度，当前使用实色背景。")).toBeNull();
  expect((screen.getByRole("switch", { name: "毛玻璃效果" }) as HTMLInputElement).checked).toBe(false);
  expect(api.glass).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, regions: [] }));
  expect(update).not.toHaveBeenCalled();
});

it("updates sidebar size during input without waiting for release and avoids duplicate saves", async () => {
  api.phase.mockResolvedValue({ width: 394, height: 580, scale: 1.3 });
  mount({ sidebarScale: 1.3 }); await flush(); await expand();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  expect(screen.getByRole("main").style.getPropertyValue("--sidebar-scale")).toBe("1.3");
  const slider = screen.getByRole("slider", { name: "侧边栏大小" });
  expect((slider as HTMLInputElement).value).toBe("130");
  fireEvent.pointerDown(slider);
  fireEvent.change(slider, { target: { value: "80" } });
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarScale: .8, sidebarOpacity: .9 }));
  fireEvent.change(slider, { target: { value: "100" } });
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarScale: 1 }));
  expect(update).toHaveBeenCalledTimes(2);
  fireEvent.pointerUp(slider);
  fireEvent.keyUp(slider, { key: "ArrowRight" });
  fireEvent.blur(slider);
  expect(update).toHaveBeenCalledTimes(2);
});

it("uses the native fitted scale after a work-area resize without changing the saved preference", async () => {
  api.phase.mockResolvedValue({ width: 394, height: 580, scale: 1.3 });
  mount({ sidebarScale: 1.3 }); await flush(); await expand();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  api.phase.mockResolvedValue({ width: 376, height: 288, scale: 1 });
  fireEvent(window, new Event("resize")); await flush();
  expect(screen.getByRole("main").style.getPropertyValue("--sidebar-scale")).toBe("1");
  expect((screen.getByRole("slider", { name: "侧边栏大小" }) as HTMLInputElement).value).toBe("130");
  expect(screen.getByText("已缩小以适应当前屏幕")).toBeTruthy();
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
});

function LiveScaleSidebar() {
  const [value, save] = useState<WidgetPreferences>({ ...prefs, sidebarScale: 1 });
  return <Sidebar snapshot={quota} preferences={value} theme="light" onPreferences={save} onRefresh={vi.fn()} notice={null} />;
}

it("reveals the direction arrow through native hover and cycles right, left, top without dismissing settings", async () => {
  render(<LiveScaleSidebar />); await flush(); await expand();
  const direction = screen.getByRole("button", { name: "贴靠右侧，切换到左侧" });
  await nativeHover(direction.querySelector("svg"), 1);
  expect(direction.getAttribute("data-native-hover")).toBe("true");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  const panel = screen.getByRole("dialog");
  for (const [label, side, nextLabel] of [
    ["贴靠右侧，切换到左侧", "left", "贴靠左侧，切换到顶部"],
    ["贴靠左侧，切换到顶部", "top", "贴靠顶部，切换到右侧"],
    ["贴靠顶部，切换到右侧", "right", "贴靠右侧，切换到左侧"],
  ]) {
    const button = screen.getByRole("button", { name: label });
    fireEvent.pointerDown(button); fireEvent.click(button); await flush();
    expect(screen.getByRole("main").className).toContain(`sidebar--${side}`);
    expect(screen.getByRole("button", { name: nextLabel })).toBeTruthy();
    expect((screen.getByLabelText("贴边位置") as HTMLSelectElement).value).toBe(side);
    expect(screen.getByRole("dialog")).toBe(panel);
    expect(panel.getAttribute("data-visible")).toBe("true");
  }
});

it("keeps top direction and menu shortcuts available when both providers are disabled", async () => {
  mount({ sidebarSide: "top", sidebarShowCodex: false, sidebarShowDeepseek: false }); await expand();
  expect(screen.getByRole("button", { name: "贴靠顶部，切换到右侧" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  fireEvent.change(screen.getByLabelText("贴边位置"), { target: { value: "top" } });
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarSide: "top" }));
});

it("reverses a closing top rail over its direction shortcut but ignores transparent margins", async () => {
  vi.stubGlobal("innerWidth", 304); vi.stubGlobal("innerHeight", 652);
  mount({ sidebarSide: "top" }); await flush(); await expand();
  await nativeHover(screen.getByRole("button", { name: "侧边栏菜单" }), 1);
  act(() => api.pointer.mock.calls[0][0]({ inside: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByRole("main").className).toContain("sidebar--handle");
  await nativeHover(screen.getByRole("main"), 2, { x: 20, y: 100 });
  expect(screen.getByRole("main").className).toContain("sidebar--handle");
  api.phase.mockClear();
  await nativeHover(screen.getByRole("main"), 3, { x: 32, y: 30 });
  expect(screen.getByRole("main").className).toContain("sidebar--rail");
  expect(api.phase).not.toHaveBeenCalled();
});

it("keeps menu rows stable while an unconstrained size change awaits the native viewport", async () => {
  api.phase.mockResolvedValue({ width: 376, height: 580, scale: 1 });
  render(<LiveScaleSidebar />); await flush(); await expand();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  const panel = screen.getByRole("dialog");
  const count = panel.children.length;
  for (const scale of [1.3, .8, 1.1, 1]) {
    let finish!: (value: { width: number; height: number; scale: number }) => void;
    api.phase.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.change(screen.getByRole("slider", { name: "侧边栏大小" }), { target: { value: String(scale * 100) } });
    await flush();
    expect(screen.queryByText("已缩小以适应当前屏幕")).toBeNull();
    expect(panel.children.length).toBe(count);
    await act(async () => finish({ width: 316 + 60 * scale, height: 580, scale })); await flush();
    expect(screen.queryByText("已缩小以适应当前屏幕")).toBeNull();
    expect(panel.children.length).toBe(count);
    expect(screen.getByRole("dialog")).toBe(panel);
  }
});

it.each([false, true])("coalesces resize bursts and newer size choices after the pending request settles (failure: %s)", async fail => {
  api.phase.mockResolvedValue({ width: 376, height: 580, scale: 1 });
  render(<LiveScaleSidebar />); await flush(); await expand();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  let finish!: (value: { width: number; height: number; scale: number }) => void;
  let reject!: (error: Error) => void;
  api.phase.mockClear();
  api.phase.mockImplementationOnce(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
  fireEvent.change(screen.getByRole("slider", { name: "侧边栏大小" }), { target: { value: "130" } }); await flush();
  fireEvent(window, new Event("resize"));
  fireEvent(window, new Event("resize"));
  fireEvent.change(screen.getByRole("slider", { name: "侧边栏大小" }), { target: { value: "80" } }); await flush();
  expect(api.phase).toHaveBeenCalledTimes(1);
  api.phase.mockResolvedValue({ width: 364, height: 580, scale: .8 });
  await act(async () => { if (fail) reject(new Error("old request failed")); else finish({ width: 394, height: 580, scale: 1.3 }); }); await flush();
  expect(api.phase).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("main").style.getPropertyValue("--sidebar-scale")).toBe("0.8");
  expect(screen.queryByText("已缩小以适应当前屏幕")).toBeNull();
  fireEvent(window, new Event("resize")); await flush();
  expect(api.phase).toHaveBeenCalledTimes(3);
});

it("finishes the visual exit before shrinking the native footprint and makes exiting controls inert", async () => {
  mount(); await expand();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  const panel = screen.getByRole("dialog");
  act(() => api.dismiss.mock.calls[0][0]()); await flush();
  expect(panel.isConnected).toBe(true);
  expect(panel.hasAttribute("inert")).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(api.phase).toHaveBeenLastCalledWith("menu");
  await act(async () => { await vi.advanceTimersByTimeAsync(149); });
  expect(api.phase).toHaveBeenLastCalledWith("menu");
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(api.phase).toHaveBeenLastCalledWith("handle");
  expect(panel.isConnected).toBe(false);
});
it("reverses a closing hover without remounting the dock or applying the cancelled shrink", async () => {
  mount(); await expand();
  api.phase.mockClear();
  const dock = screen.getByRole("button", { name: "Codex 剩余 74%" }).closest(".sidebar-dock");
  fireEvent.mouseLeave(screen.getByRole("main"));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeTruthy();
  await expand();
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(api.phase.mock.calls.some(([phase]) => phase === "handle")).toBe(false);
  expect(screen.getByRole("button", { name: "Codex 剩余 74%" }).closest(".sidebar-dock")).toBe(dock);
  expect(api.phase).not.toHaveBeenCalled();
});
it("does not queue duplicate expansions while the native window is resizing", async () => {
  mount(); await flush(); api.phase.mockClear();
  let finish!: () => void;
  api.phase.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pointer = api.pointer.mock.calls[0][0];
  act(() => { pointer({ inside: true }); pointer({ inside: true }); pointer({ inside: true }); });
  expect(api.phase).toHaveBeenCalledTimes(1);
  await act(async () => finish()); await flush();
  expect(screen.getByRole("button", { name: "Codex 剩余 74%" })).toBeTruthy();
});
it("skips the exit delay for reduced motion and cancels pending work on unmount", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  const view = mount(); await expand();
  fireEvent.mouseLeave(screen.getByRole("main"));
  await act(async () => { await vi.advanceTimersByTimeAsync(450); });
  expect(api.phase).toHaveBeenLastCalledWith("handle");
  view.unmount(); vi.unstubAllGlobals();
  const next = mount(); await expand();
  fireEvent.mouseLeave(screen.getByRole("main"));
  await act(async () => { await vi.advanceTimersByTimeAsync(450); });
  api.phase.mockClear(); next.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(api.phase).not.toHaveBeenCalled();
});
it("replaces an interrupted detail-height animation from its current height without resizing the OS window", async () => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  let currentHeight = 0;
  const animations: { cancel: ReturnType<typeof vi.fn>; playState: string }[] = [];
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    const animation = { playState: "running", cancel: vi.fn(() => { currentHeight = 0; }) };
    animations.push(animation); return animation;
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function(this: HTMLElement) {
    return currentHeight || (this.classList.contains("sidebar-detail--codex") ? 350 : 260);
  });
  try {
    mount(); await expand(); hover("Codex 剩余 74%"); await flush(); api.phase.mockClear();
    hover("DeepSeek 剩余 30%", 530); await flush();
    expect(animate.mock.calls[0]?.[0]).toEqual([{ height: "350px", overflow: "hidden" }, { height: "260px", overflow: "hidden" }]);
    currentHeight = 300;
    hover("Codex 剩余 74%", 450); await flush();
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(animate.mock.calls[1]?.[0]).toEqual([{ height: "300px", overflow: "hidden" }, { height: "350px", overflow: "hidden" }]);
    expect(api.phase).not.toHaveBeenCalled();
  } finally {
    height.mockRestore();
    if (original) Object.defineProperty(HTMLElement.prototype, "animate", original);
    else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  }
});
it("keeps sub-cent usage visible and does not infer holiday pricing", async () => {
  vi.setSystemTime(new Date("2026-10-01T07:00:00Z"));
  api.deepseek.mockResolvedValue({ ...EMPTY_DEEPSEEK, status: "ok", balance: 1, spent: 2, cost: .00072, daily: [{ date: "2026-10-01", tokens: "100", cost: .00072 }] });
  mount(); await expand();
  hover("DeepSeek 剩余 33%", 530); await flush();
  expect(screen.getByText("<¥0.01")).toBeTruthy();
  expect(screen.getByLabelText("2026-10-01: <¥0.01")).toBeTruthy();
  expect(screen.queryByText("高峰 · 2× 基准价")).toBeNull();
  expect(screen.queryByText("下次闲时")).toBeNull();
});
it("opens and switches provider details from native hover alone, keeping details open while crossing the panel", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }).querySelector("img"), 1);
  expect(screen.getByText("账户统计")).toBeTruthy();
  await nativeHover(screen.getByRole("button", { name: "DeepSeek 剩余 30%" }).querySelector("img"), 2, { y: 170 });
  expect(screen.getByText("29.6% 剩余")).toBeTruthy();
  await nativeHover(screen.getByLabelText("DeepSeek 用量详情"), 3, { x: 130 });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByText("29.6% 剩余")).toBeTruthy();
});
it.each(["blank", "gear"])("closes only the detail on native hover over %s, even when the rail is pinned", async target => {
  mount({ stayExpanded: true }); await flush();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  await nativeHover(target === "gear" ? screen.getByRole("button", { name: "侧边栏菜单" }) : screen.getByRole("main"), 2);
  await act(async () => { await vi.advanceTimersByTimeAsync(119); });
  expect(screen.getByRole("main").className).toContain("sidebar--detail");
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("main").className).toContain("sidebar--rail");
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(screen.queryByRole("region", { name: "Codex 用量详情" })).toBeNull();
  expect(api.phase).toHaveBeenLastCalledWith("rail");
  expect(screen.getByRole("button", { name: "Codex 剩余 74%" })).toBeTruthy();
});
it("allows crossing the gap into details and between providers without collapsing", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  await nativeHover(screen.getByRole("main"), 2);
  await act(async () => { await vi.advanceTimersByTimeAsync(80); });
  await nativeHover(screen.getByLabelText("Codex 用量详情"), 3);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByRole("main").className).toContain("sidebar--detail");
  await nativeHover(screen.getByRole("main"), 4);
  await act(async () => { await vi.advanceTimersByTimeAsync(80); });
  await nativeHover(screen.getByRole("button", { name: "DeepSeek 剩余 30%" }), 5);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByLabelText("DeepSeek 用量详情")).toBeTruthy();
  expect(screen.getByRole("main").className).toContain("sidebar--detail");
});
it("reverses the detail exit when the pointer returns before native shrink", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  api.phase.mockClear();
  await nativeHover(screen.getByRole("main"), 2);
  await act(async () => { await vi.advanceTimersByTimeAsync(160); });
  expect(screen.getByRole("main").className).toContain("sidebar--rail");
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 3);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(screen.getByRole("main").className).toContain("sidebar--detail");
  expect(api.phase.mock.calls.some(([phase]) => phase === "rail")).toBe(false);
});
it("reverses a visual exit immediately without waiting for another native resize", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  const detail = screen.getByLabelText("Codex 用量详情");
  await nativeHover(screen.getByRole("main"), 2);
  await act(async () => { await vi.advanceTimersByTimeAsync(160); });
  api.phase.mockClear();
  api.phase.mockImplementation(() => new Promise<void>(() => {}));
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 3);
  expect(screen.getByRole("main").className).toContain("sidebar--detail");
  expect(detail.getAttribute("data-visible")).toBe("true");
  expect(api.phase).not.toHaveBeenCalled();
});
it("replays a work-area resize deferred by a detail exit that is reversed", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  await nativeHover(screen.getByRole("main"), 2);
  await act(async () => { await vi.advanceTimersByTimeAsync(160); });
  api.phase.mockClear();
  api.phase.mockResolvedValue({ width: 300.8, height: 464, scale: .8 });
  fireEvent(window, new Event("resize")); await flush();
  expect(api.phase).not.toHaveBeenCalled();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 3);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(api.phase).toHaveBeenCalledWith("detail");
  expect(screen.getByRole("main").style.getPropertyValue("--sidebar-scale")).toBe("0.8");
  expect(screen.getByRole("main").className).toContain("sidebar--detail");
});
it("keeps the detail surface mounted through a complete close and reopen", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  const detail = screen.getByLabelText("Codex 用量详情");
  const animate = vi.fn();
  Object.defineProperty(detail, "animate", { configurable: true, value: animate });
  vi.spyOn(detail, "offsetHeight", "get").mockImplementation(() => screen.getByRole("main").className.includes("sidebar--detail") ? 380 : 180);
  await nativeHover(screen.getByRole("main"), 2);
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(detail.isConnected).toBe(true);
  expect(detail.hasAttribute("inert")).toBe(true);
  expect(detail.getAttribute("data-parked")).toBe("true");
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 3);
  expect(screen.getByLabelText("Codex 用量详情")).toBe(detail);
  expect(detail.hasAttribute("inert")).toBe(false);
  expect(detail.getAttribute("data-parked")).toBe("false");
  expect(animate).not.toHaveBeenCalled();
});
it("prepares a hidden noninteractive detail until the native viewport is ready", async () => {
  mount(); await expand();
  let finish!: () => void;
  api.phase.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  hover("Codex 剩余 74%"); await flush();
  const detail = screen.getByLabelText("Codex 用量详情");
  expect(detail.getAttribute("data-visible")).toBe("false");
  expect(detail.getAttribute("data-parked")).toBe("true");
  expect(detail.hasAttribute("inert")).toBe(true);
  expect(screen.queryByRole("region", { name: "Codex 用量详情" })).toBeNull();
  await act(async () => finish()); await flush();
  expect(screen.getByRole("region", { name: "Codex 用量详情" })).toBe(detail);
});
it("updates native input regions without resizing on provider changes and removes hidden details from hit testing", async () => {
  vi.stubGlobal("innerWidth", 376); vi.stubGlobal("innerHeight", 580);
  const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function(this: HTMLElement) {
    return this.classList.contains("sidebar-panel") ? 272 : 0;
  });
  const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function(this: HTMLElement) {
    return this.classList.contains("sidebar-detail--codex") ? 400 : 340;
  });
  try {
    mount({ sidebarSide: "left" }); await flush();
    expect(api.regions).toHaveBeenLastCalledWith("handle", [{ x: 0, y: 262, width: 8, height: 56 }]);
    await expand();
    await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
    const detail = screen.getByRole("region", { name: "Codex 用量详情" });
    expect(api.regions).toHaveBeenLastCalledWith("detail", expect.arrayContaining([{ x: 72, y: 90, width: 272, height: 400 }]));
    api.phase.mockClear();
    await nativeHover(screen.getByRole("button", { name: "DeepSeek 剩余 30%" }), 2);
    expect(api.regions).toHaveBeenLastCalledWith("detail", expect.arrayContaining([{ x: 72, y: 120, width: 272, height: 340 }]));
    expect(api.phase).not.toHaveBeenCalled();
    act(() => api.pointer.mock.calls[0][0]({ inside: false }));
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    expect(detail.isConnected).toBe(true);
    expect(detail.getAttribute("data-visible")).toBe("false");
    // The exiting card remains a crossing target until its 150ms exit ends.
    expect(api.regions.mock.calls.at(-1)?.[0]).toBe("detail");
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(api.regions).toHaveBeenLastCalledWith("rail", [{ x: 0, y: 146, width: 60, height: 288 }]);
    expect(detail.isConnected).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(330); });
    expect(api.regions).toHaveBeenLastCalledWith("handle", [{ x: 0, y: 262, width: 8, height: 56 }]);
    expect(window.innerWidth).toBe(376); expect(window.innerHeight).toBe(580);
  } finally { width.mockRestore(); height.mockRestore(); }
});
it.each(["left", "right", "top"] as const)("keeps the %s-side crossing corridor open without keeping unrelated rail blanks open", async side => {
  mount({ sidebarSide: side }); await expand();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  const detail = screen.getByLabelText("Codex 用量详情");
  const dock = screen.getByRole("button", { name: "Codex 剩余 74%" }).closest(".sidebar-dock")!;
  const rect = (left: number, right: number, top: number, bottom: number) => ({ left, right, top, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) });
  vi.spyOn(dock, "getBoundingClientRect").mockReturnValue(side === "top" ? rect(62, 242, 0, 60) : side === "left" ? rect(0, 60, 150, 330) : rect(284, 344, 150, 330));
  vi.spyOn(detail, "getBoundingClientRect").mockReturnValue(side === "top" ? rect(16, 288, 72, 452) : side === "left" ? rect(72, 344, 50, 430) : rect(0, 272, 50, 430));
  await nativeHover(screen.getByRole("main"), 2, side === "top" ? { x: 152, y: 66 } : { x: side === "left" ? 66 : 278, y: 230 });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByRole("main").className).toContain("sidebar--detail");
  await nativeHover(screen.getByRole("main"), 3, side === "top" ? { x: 32, y: 66 } : { x: side === "left" ? 66 : 278, y: 350 });
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  expect(screen.getByRole("main").className).toContain("sidebar--rail");
  // The fading panel is inert, so hit testing returns the root. Its visible
  // rectangle must still allow an immediate reversal before native shrink.
  api.phase.mockClear();
  await nativeHover(screen.getByRole("main"), 4, { x: 200, y: 400 });
  expect(screen.getByRole("main").className).toContain("sidebar--detail");
  expect(detail.getAttribute("data-visible")).toBe("true");
  expect(api.phase).not.toHaveBeenCalled();
});
it("closes detail earlier on native exit without postponing the whole sidebar's 450ms deadline", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  act(() => api.pointer.mock.calls[0][0]({ inside: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  expect(screen.getByRole("main").className).toContain("sidebar--rail");
  await act(async () => { await vi.advanceTimersByTimeAsync(329); });
  expect(screen.getByRole("main").className).toContain("sidebar--rail");
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("main").className).toContain("sidebar--handle");
});
it("uses WebView mouse movement to close detail, preserves keyboard focus, and cancels work on unmount", async () => {
  const view = mount(); await expand(); hover("Codex 剩余 74%"); await flush();
  const root = screen.getByRole("main");
  const pin = screen.getByRole("button", { name: "保持侧边栏展开" });
  fireEvent.keyDown(root, { key: "Tab" }); act(() => pin.focus());
  fireEvent.mouseMove(root, { screenX: 1870, screenY: 540 });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(root.className).toContain("sidebar--detail");
  act(() => pin.blur());
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  expect(root.className).toContain("sidebar--rail");
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  hover("Codex 剩余 74%"); await flush();
  fireEvent.mouseMove(root, { screenX: 1870, screenY: 540 });
  view.unmount(); api.phase.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(api.phase).not.toHaveBeenCalled();
});
it("rejects old footprint samples and stationary native cursor samples after expansion", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  const deepseek = screen.getByRole("button", { name: "DeepSeek 剩余 30%" });
  hover("DeepSeek 剩余 30%", 530); await flush();
  expect(screen.getByText("账户统计")).toBeTruthy();
  await nativeHover(deepseek, 1);
  expect(screen.getByText("账户统计")).toBeTruthy();
  await nativeHover(deepseek, 2, { width: window.innerWidth + 10 });
  expect(screen.getByText("账户统计")).toBeTruthy();
  await nativeHover(deepseek, 3);
  expect(screen.getByText("29.6% 剩余")).toBeTruthy();
});
it("does not let an old native footprint reopen a handle during top-edge reentry", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  act(() => api.pointer.mock.calls[0][0]({ inside: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(650); });
  api.phase.mockClear();
  await nativeHover(screen.getByRole("main"), 2, { height: window.innerHeight + 192, y: 8 });
  expect(screen.getByRole("main").className).toContain("sidebar--handle");
  expect(api.phase).not.toHaveBeenCalled();
});
it("ignores WebView reentry after native exit, including while the old rail is fading", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "侧边栏菜单" }), 1);
  const root = screen.getByRole("main");
  act(() => api.pointer.mock.calls[0][0]({ inside: false }));
  fireEvent.mouseEnter(root, { screenX: 1900, screenY: 360 });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(root.className).toContain("sidebar--handle");
  fireEvent.mouseMove(root, { screenX: 1900, screenY: 361 });
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(root.className).toContain("sidebar--handle");
  expect(api.phase).toHaveBeenLastCalledWith("handle");
});
it("does not reopen from the transparent top margin of a closing rail", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "侧边栏菜单" }), 1);
  const root = screen.getByRole("main");
  act(() => api.pointer.mock.calls[0][0]({ inside: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  api.phase.mockClear();
  await nativeHover(root, 2, { x: window.innerWidth - 20, y: 8 });
  expect(root.className).toContain("sidebar--handle");
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(api.phase).toHaveBeenLastCalledWith("handle");
});
it.each(["left", "right"] as const)("accepts a real %s-side top reentry over the fading rail, then reopens details", async side => {
  // Use the actual native phase sizes: top-relative coordinates change even
  // though the dock remains centred on the same screen point.
  vi.stubGlobal("innerWidth", 8); vi.stubGlobal("innerHeight", 56);
  api.phase.mockImplementation(async (phase: string) => {
    const [width, height] = phase === "handle" ? [8, 56] : phase === "rail" ? [64, 288] : [344, 480];
    vi.stubGlobal("innerWidth", width); vi.stubGlobal("innerHeight", height);
  });
  mount({ sidebarSide: side }); await flush();
  await nativeHover(screen.getByRole("button", { name: "展开侧边栏" }), 1, { x: 4, y: 28 });
  const codex = screen.getByRole("button", { name: "Codex 剩余 74%" });
  await nativeHover(codex, 2, { x: side === "left" ? 30 : 34, y: 104 });
  expect(screen.getByRole("main").className).toContain("sidebar--detail");
  act(() => api.pointer.mock.calls[0][0]({ inside: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(window.innerHeight).toBe(288);
  expect(screen.getByRole("main").className).toContain("sidebar--handle");
  api.phase.mockClear();
  // Pointer returns through the top of the real dock during its exit. Inert
  // content reports the root, but its resting bounds must still be reachable.
  await nativeHover(screen.getByRole("main"), 3, { x: side === "left" ? 30 : 34, y: 60 });
  expect(screen.getByRole("main").className).toContain("sidebar--rail");
  expect(api.phase).not.toHaveBeenCalled();
  await nativeHover(codex, 4, { x: side === "left" ? 30 : 34, y: 104 });
  expect(screen.getByRole("main").className).toContain("sidebar--detail");
  expect(window.innerHeight).toBe(480);
  await nativeHover(screen.getByRole("region", { name: "Codex 用量详情" }), 5, { x: 170, y: 200 });
  await act(async () => { await vi.advanceTimersByTimeAsync(650); });
  expect(screen.getByRole("main").className).toContain("sidebar--detail");
});
it("applies an exit that arrived while the native viewport was settling", async () => {
  mount(); await expand();
  let finish!: () => void;
  api.phase.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  act(() => api.pointer.mock.calls[0][0]({ inside: false }));
  await act(async () => finish()); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(650); });
  expect(screen.getByRole("main").className).toContain("sidebar--handle");
  expect(api.phase).toHaveBeenLastCalledWith("handle");
});
it.each([true, false])("replays the last native presence after the handle resize finishes: inside=%s", async entered => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "侧边栏菜单" }), 1);
  let finish!: () => void;
  api.phase.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  act(() => api.pointer.mock.calls[0][0]({ inside: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  await nativeHover(screen.getByRole("main"), 2, { width: 8.5, height: 56.5, x: 4, y: 28 });
  if (!entered) act(() => api.pointer.mock.calls[0][0]({ inside: false }));
  vi.stubGlobal("innerWidth", 8); vi.stubGlobal("innerHeight", 56);
  await act(async () => finish()); await flush();
  expect(screen.getByRole("main").className).toContain(entered ? "sidebar--rail" : "sidebar--handle");
  expect(api.phase).toHaveBeenLastCalledWith(entered ? "rail" : "handle");
});
it("does not postpone the 450ms exit deadline for repeated native outside samples", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "侧边栏菜单" }), 1);
  act(() => api.pointer.mock.calls[0][0]({ inside: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  act(() => api.pointer.mock.calls[0][0]({ inside: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(screen.getByRole("main").className).toContain("sidebar--handle");
});
it("accepts a stationary pointer becoming outside when native interactive regions change", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  // The cursor has not moved, but the area underneath it became transparent.
  act(() => api.pointer.mock.calls[0][0]({ inside: false, position: {
    x: 160, y: 90, width: window.innerWidth, height: window.innerHeight, movement: 1,
  } }));
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(screen.getByRole("main").className).toContain("sidebar--handle");
});
it("retains the current detail when a region update brings the stationary cursor inside", async () => {
  mount(); await expand();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  act(() => api.pointer.mock.calls[0][0]({ inside: false }));
  await nativeHover(screen.getByRole("region", { name: "Codex 用量详情" }), 1, { x: 160 });
  await act(async () => { await vi.advanceTimersByTimeAsync(650); });
  expect(screen.getByRole("main").className).toContain("sidebar--detail");
});
it("resolves a pointer that moved during native resize after the matching layout commits", async () => {
  mount(); await expand();
  let finish!: () => void;
  api.phase.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 1);
  await nativeHover(screen.getByRole("button", { name: "DeepSeek 剩余 30%" }), 2);
  expect(screen.queryByText("29.6% 剩余")).toBeNull();
  await act(async () => finish()); await flush();
  expect(screen.getByText("29.6% 剩余")).toBeTruthy();
});
it("reveals the gear from native hover without opening it and does not replace an open menu", async () => {
  mount(); await expand();
  const gear = screen.getByRole("button", { name: "侧边栏菜单" });
  await nativeHover(gear.querySelector("svg"), 1);
  expect(gear.getAttribute("data-native-hover")).toBe("true");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(gear); await flush();
  await nativeHover(screen.getByRole("button", { name: "Codex 剩余 74%" }), 2);
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByText("账户统计")).toBeNull();
  act(() => api.pointer.mock.calls[0][0]({ inside: false })); await flush();
  expect(gear.getAttribute("data-native-hover")).toBe("false");
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("opens from native pointer presence without a WebView enter or click and collapses after native exit", async () => {
  mount(); await flush();
  const pointer = api.pointer.mock.calls[0][0];
  act(() => pointer({ inside: true })); await flush();
  expect(screen.getByRole("main").className).toContain("sidebar--rail");
  // Resizing the inactive WebView may emit an obsolete leave event.
  fireEvent.mouseLeave(screen.getByRole("main"));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByRole("main").className).toContain("sidebar--rail");
  act(() => pointer({ inside: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(449); });
  expect(screen.getByRole("main").className).toContain("sidebar--rail");
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeTruthy();
});
it("preserves menus and keyboard focus on native pointer exit and releases the listener", async () => {
  const unsubscribe = vi.fn(); api.pointer.mockResolvedValue(unsubscribe);
  const view = mount(); await flush();
  const pointer = api.pointer.mock.calls[0][0];
  act(() => pointer({ inside: true })); await flush();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  act(() => pointer({ inside: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("main"), { key: "Escape" }); await flush();
  act(() => pointer({ inside: true })); await flush();
  fireEvent.keyDown(screen.getByRole("main"), { key: "Tab" });
  act(() => screen.getByRole("button", { name: "Codex 剩余 74%" }).focus());
  act(() => pointer({ inside: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByRole("main").className).toContain("sidebar--rail");
  view.unmount(); expect(unsubscribe).toHaveBeenCalledOnce();
});
it("recovers a missed enter event on mouse movement over the handle", async () => {
  mount(); await flush();
  fireEvent.mouseMove(screen.getByRole("button", { name: "展开侧边栏" }), { screenX: 1919, screenY: 500 }); await flush();
  expect(screen.getByRole("main").className).toContain("sidebar--rail");
});
it("opens remaining details on hover and shows only account statistics in the sidebar", async () => {
  mount(); await expand();
  hover("Codex 剩余 74%"); await flush();
  expect(screen.getByText("账户统计")).toBeTruthy(); expect(screen.queryByText("本机统计")).toBeNull(); expect(screen.queryByRole("button", { name: "按模型" })).toBeNull();
  expect(screen.getByText("18d")).toBeTruthy(); expect(screen.getByTitle("9,007,199,254,740,993")).toBeTruthy();
  hover("DeepSeek 剩余 30%", 530); await flush();
  expect(screen.getByText("29.6% 剩余")).toBeTruthy();
});
it("does not collapse while crossing into details, using the menu or holding keyboard focus", async () => {
  mount(); await expand(); const root = screen.getByRole("main");
  fireEvent.mouseLeave(root); await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  fireEvent.mouseEnter(root); await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(root.className).toContain("sidebar--rail");
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  fireEvent.mouseLeave(root); await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(root, { key: "Escape" }); await flush();
  await expand();
  act(() => screen.getByRole("button", { name: "Codex 剩余 74%" }).focus());
  fireEvent.mouseLeave(root); await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(root.className).toContain("sidebar--rail");
  act(() => (document.activeElement as HTMLElement).blur());
  await act(async () => { await vi.advanceTimersByTimeAsync(450); });
  expect(root.className).toContain("sidebar--handle");
});
it("does not switch providers because the native window moved during expansion", async () => {
  mount(); await expand();
  let finish!: () => void;
  api.phase.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  hover("DeepSeek 剩余 30%", 530);
  hover("Codex 剩余 74%", 531);
  await act(async () => finish());
  expect(screen.getByText("29.6% 剩余")).toBeTruthy();
  fireEvent.mouseMove(screen.getByRole("button", { name: "Codex 剩余 74%" }), { screenX: 1880, screenY: 450 }); await flush();
  expect(screen.getByText("账户统计")).toBeTruthy();
});
it("ignores stationary pointer enters after resize settles, including keyboard expansion", async () => {
  mount(); await expand();
  const codex = screen.getByRole("button", { name: "Codex 剩余 74%" });
  act(() => codex.focus()); fireEvent.keyDown(codex, { key: " " }); fireEvent.click(codex); await flush();
  fireEvent.mouseEnter(screen.getByRole("button", { name: "DeepSeek 剩余 30%" }), { screenX: 1900, screenY: 500 }); await flush();
  expect(screen.getByText("账户统计")).toBeTruthy();
  expect(screen.queryByText("29.6% 剩余")).toBeNull();
  hover("DeepSeek 剩余 30%", 530); await flush();
  expect(screen.getByText("29.6% 剩余")).toBeTruthy();
});
it.each([true, false])("protects settings controls and provider hover regardless of stayExpanded=%s", async stayExpanded => {
  mount({ stayExpanded }); await flush(); await expand();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  fireEvent.pointerDown(screen.getByRole("slider", { name: "背景不透明度" })); await flush();
  expect(screen.getByRole("dialog")).toBeTruthy();
  // Hovering another service must not replace a settings menu in use.
  fireEvent.mouseEnter(screen.getByRole("button", { name: "Codex 剩余 74%" })); await flush();
  fireEvent.mouseLeave(screen.getByRole("main"));
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it.each([true, false].flatMap(stayExpanded => ["native-dismiss", "outside-panel", "window-blur", "close-button", "escape"].map(action => ({ stayExpanded, action }))))(
  "dismisses settings using $action while respecting stayExpanded=$stayExpanded", async ({ stayExpanded, action }) => {
    mount({ stayExpanded }); await flush(); await expand();
    const root = screen.getByRole("main");
    fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
    if (action === "native-dismiss") act(() => api.dismiss.mock.calls[0][0]());
    else if (action === "outside-panel") fireEvent.pointerDown(root);
    else if (action === "window-blur") fireEvent.blur(window);
    else if (action === "close-button") fireEvent.click(screen.getByRole("button", { name: "关闭菜单" }));
    else fireEvent.keyDown(root, { key: "Escape" });
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(root.className).toContain(stayExpanded ? "sidebar--rail" : "sidebar--handle");
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(api.phase).toHaveBeenLastCalledWith(stayExpanded ? "rail" : "handle");
    expect(root.className).toContain(stayExpanded ? "sidebar--rail" : "sidebar--handle");
  },
);

it("applies the saved rail pin immediately when closing settings and leaving the sidebar", async () => {
  function Harness() {
    const [value, save] = useState<WidgetPreferences>(prefs);
    return <Sidebar snapshot={quota} preferences={value} theme="light" onPreferences={next => { update(next); save(next); }} onRefresh={vi.fn()} notice={null} />;
  }
  render(<Harness />); await flush(); await expand();
  const root = screen.getByRole("main");
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  fireEvent.click(screen.getByRole("checkbox", { name: "保持侧边栏展开" })); await flush();
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ stayExpanded: true }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  act(() => api.dismiss.mock.calls[0][0]()); await flush();
  fireEvent.mouseLeave(root);
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(root.className).toContain("sidebar--rail");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  expect((screen.getByRole("checkbox", { name: "保持侧边栏展开" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "保持侧边栏展开" })); await flush();
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ stayExpanded: false }));
  act(() => api.dismiss.mock.calls[0][0]()); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(root.className).toContain("sidebar--handle");
});
it("uses only the weekly quota for Pro and does not substitute a short window when weekly is missing", async () => {
  const view = mount({}, { ...quota, plan: "PRO", weeklyWindow: { remainingPercent: 42, resetsAt: null, windowSeconds: 604800 } });
  await expand(); hover("Codex 剩余 42%"); await flush();
  expect(screen.getByRole("progressbar", { name: "每周额度 剩余" })).toBeTruthy();
  expect(screen.queryByText("5 小时额度")).toBeNull();
  view.unmount(); mount({}, { ...quota, plan: "prolite" }); await expand();
  expect(screen.getByRole("button", { name: "Codex 剩余 —" })).toBeTruthy();
});
it("can change side, opacity and return to the existing mode from the gear", async () => {
  mount({ sidebarSide: "left" }); await expand();
  expect(screen.getByRole("main").className).toContain("sidebar--left");
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  fireEvent.change(screen.getByLabelText("贴边位置"), { target: { value: "right" } });
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarSide: "right" }));
  const slider = screen.getByRole("slider", { name: "背景不透明度" }); fireEvent.change(slider, { target: { value: "55" } }); fireEvent.pointerUp(slider);
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarOpacity: .55 }));
  fireEvent.change(screen.getByLabelText("展示模式"), { target: { value: "floating" } });
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ displayMode: "floating" }));
});
it("saves independent display switches, keeps settings reachable with both hidden, and restores a service", async () => {
  function Harness() {
    const [value, save] = useState<WidgetPreferences>({ ...prefs, deepseekEnabled: true });
    return <Sidebar snapshot={quota} preferences={value} theme="light" onPreferences={next => { update(next); save(next); }} onRefresh={vi.fn()} notice={null} />;
  }
  render(<Harness />); await expand();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  expect((screen.getByRole("switch", { name: "显示 Codex" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("switch", { name: "显示 DeepSeek" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("switch", { name: "显示 Codex" })); await flush();
  expect(screen.queryByRole("button", { name: "Codex 剩余 74%" })).toBeNull();
  expect(screen.getByRole("button", { name: "DeepSeek 剩余 30%" })).toBeTruthy();
  fireEvent.click(screen.getByRole("switch", { name: "显示 DeepSeek" })); await flush();
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarShowCodex: false, sidebarShowDeepseek: false, deepseekEnabled: true }));
  expect(api.session).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭菜单" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  await expand();
  expect(screen.queryByRole("button", { name: /剩余/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  fireEvent.click(screen.getByRole("switch", { name: "显示 Codex" })); await flush();
  expect(screen.getByRole("button", { name: "Codex 剩余 74%" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "DeepSeek 剩余 30%" })).toBeNull();
});
it.each([[false, true], [true, false], [false, false]])("restores provider visibility on mount: Codex=%s DeepSeek=%s", async (codex, deepseek) => {
  mount({ sidebarShowCodex: codex, sidebarShowDeepseek: deepseek }); await expand();
  expect(Boolean(screen.queryByRole("button", { name: "Codex 剩余 74%" }))).toBe(codex);
  expect(Boolean(screen.queryByRole("button", { name: "DeepSeek 剩余 30%" }))).toBe(deepseek);
  expect(screen.getByRole("button", { name: "侧边栏菜单" })).toBeTruthy();
});
it("moves an open detail to a visible provider after an external preference update", async () => {
  const view = mount(); await expand(); hover("Codex 剩余 74%"); await flush();
  const rerender = (patch: Partial<WidgetPreferences>) => view.rerender(<Sidebar snapshot={quota} preferences={{ ...prefs, ...patch }} theme="light" onPreferences={update} onRefresh={vi.fn()} notice={null} />);
  rerender({ sidebarShowCodex: false }); await flush();
  expect(screen.getByLabelText("DeepSeek 用量详情")).toBeTruthy();
  expect(screen.queryByLabelText("Codex 用量详情")).toBeNull();
  rerender({ sidebarShowCodex: false, sidebarShowDeepseek: false }); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(screen.queryByRole("region", { name: "DeepSeek 用量详情" })).toBeNull();
  expect(api.phase).toHaveBeenLastCalledWith("rail");
});
it("collapses after mouse-only interaction but retains keyboard focus", async () => {
  mount(); await expand();
  const root = screen.getByRole("main");
  const ring = screen.getByRole("button", { name: "Codex 剩余 74%" });
  fireEvent.pointerDown(ring); act(() => ring.focus()); fireEvent.click(ring); await flush();
  fireEvent.mouseLeave(root);
  await act(async () => { await vi.advanceTimersByTimeAsync(450); });
  expect(root.className).toContain("sidebar--handle");
});
it("reopen restores the rail and no unknown values become a full ring", async () => {
  api.deepseek.mockResolvedValue(EMPTY_DEEPSEEK); mount(); await flush();
  act(() => api.recovery.mock.calls[0][0]()); await flush();
  expect(screen.getByRole("button", { name: "DeepSeek 剩余 —" })).toBeTruthy();
  expect(api.phase).toHaveBeenLastCalledWith("rail");
});
it("republishes input regions when reopening an already expanded sidebar", async () => {
  mount({ stayExpanded: true }); await flush();
  api.regions.mockClear(); api.phase.mockClear();
  act(() => api.recovery.mock.calls[0][0]()); await flush();
  expect(api.regions).toHaveBeenCalledWith("rail", expect.any(Array));
  expect(api.phase).not.toHaveBeenCalled();
});


it("defaults automatic update checks on and saves the update preference independently", async () => {
  mount(); await expand();
  fireEvent.click(screen.getByRole("button", { name: "侧边栏菜单" })); await flush();
  const automatic = screen.getByRole("checkbox", { name: "自动检查更新" }) as HTMLInputElement;
  expect(automatic.checked).toBe(true);
  fireEvent.click(automatic);
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ autoCheckUpdates: false, sidebarOpacity: .9 }));
  fireEvent.click(screen.getByRole("button", { name: /检查更新/ })); await flush();
  expect(updaterOpen).toHaveBeenCalledOnce();
  expect(screen.getByText("2.0")).toBeTruthy();
});
