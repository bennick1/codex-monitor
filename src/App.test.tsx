// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { tokenSnapshot, totals } from "./test/tokenFixtures";
import type { WidgetPreferences } from "./types";

const api = vi.hoisted(() => ({ get: vi.fn(), tokenListen: vi.fn(), desktopListen: vi.fn(), refreshTokens: vi.fn(), expand: vi.fn(), quota: vi.fn(), preferences: vi.fn(), save: vi.fn(), phase: vi.fn(), regions: vi.fn(), account: vi.fn(), deepseek: vi.fn(), sideListen: vi.fn(), autostart: vi.fn(), desktop: vi.fn() }));
vi.mock("./lib/bridge", () => ({
  getTokenStatistics: api.get, listenTokenStatisticsUpdated: api.tokenListen, refreshTokenStatistics: api.refreshTokens,
  fetchSnapshots: api.quota, getPreferences: api.preferences, listenDesktopEvents: api.desktopListen,
  setSidebarPhase: api.phase, syncSidebarRegions: api.regions, getAccountUsage: api.account, getDeepSeekUsage: api.deepseek, listenSidebarRecovery: api.sideListen, listenSidebarDismiss: api.sideListen, listenSidebarPointer: api.sideListen, listenDeepSeekReady: api.sideListen,
  syncSidebarGlass: vi.fn(async () => "active"), listenSidebarGlassInvalidated: vi.fn(async () => () => {}),
  isTauri: api.desktop, getAutostart: api.autostart, setWidgetExpanded: api.expand, syncWidgetAppearance: vi.fn(async () => {}), startDragging: vi.fn(), updatePreferences: api.save, setAlwaysOnTop: vi.fn(),
}));
vi.mock("./lib/releasePage", () => ({ openReleasePage: vi.fn() }));
const prefs = { locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN", appearance: "light", selectedSkin: "default" };
const quota = { provider: "codex", displayName: "CODEX", plan: "TEST", shortWindow: { remainingPercent: 74, resetsAt: null, windowSeconds: 18000 }, weeklyWindow: { remainingPercent: 42, resetsAt: null, windowSeconds: 604800 }, resetCredits: null, updatedAt: new Date().toISOString(), status: "ok", message: null };
async function flush() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  api.desktop.mockReturnValue(true);
  api.get.mockResolvedValue(tokenSnapshot()); api.tokenListen.mockResolvedValue(() => {}); api.desktopListen.mockResolvedValue(() => {});
  api.save.mockImplementation(async value => { api.preferences.mockResolvedValue(value); }); api.autostart.mockResolvedValue(false); api.phase.mockResolvedValue(undefined); api.account.mockRejectedValue(new Error("synthetic unavailable")); api.deepseek.mockResolvedValue({ status: "signed_out", balance: null, spent: null }); api.sideListen.mockResolvedValue(() => {});
  api.regions.mockResolvedValue(undefined);
  api.expand.mockResolvedValue(undefined); api.quota.mockResolvedValue([quota]); api.preferences.mockResolvedValue(prefs); api.refreshTokens.mockResolvedValue({ queued: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("App hover integration with the real TokenUsage component", () => {
  it("shrinks a restored expanded native footprint when starting in orb mode", async () => {
    render(<App />); await flush();
    expect(api.expand).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("region", { name: "Token 用量" })).toBeNull();
  });

  it("does not collapse over a hover started before preferences finish loading", async () => {
    let resolve!: (value: typeof prefs) => void;
    api.preferences.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<App />); fireEvent.mouseEnter(screen.getByRole("main")); await flush();
    await act(async () => resolve(prefs));
    expect(api.expand).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("region", { name: "Token 用量" })).toBeTruthy();
  });

  it("mounts all four totals on hover before a slow query completes; panel hover retains original collapse delay", async () => {
    render(<StrictMode><App /></StrictMode>); await flush();
    expect(screen.queryByRole("region", { name: "Token 用量" })).toBeNull();
    api.get.mockImplementation(() => new Promise(() => {}));
    fireEvent.mouseEnter(screen.getByRole("main")); await flush();
    expect(screen.getByRole("region", { name: "Token 用量" })).toBeTruthy();
    for (const label of ["今日", "本周", "本月", "总计"]) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("74");
    const listens = api.tokenListen.mock.calls.length;
    fireEvent.mouseLeave(screen.getByRole("main"));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.mouseEnter(screen.getByRole("main"));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole("region", { name: "Token 用量" })).toBeTruthy();
    expect(api.tokenListen).toHaveBeenCalledTimes(listens); expect(api.refreshTokens).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByRole("main"));
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(screen.queryByRole("region", { name: "Token 用量" })).toBeNull();
    expect(api.expand).toHaveBeenLastCalledWith(false);
  });
  it("Token failure leaves quota and controls usable; later event updates visible totals", async () => {
    api.get.mockRejectedValue(new Error("offline"));
    render(<App />); await flush(); fireEvent.mouseEnter(screen.getByRole("main")); await flush();
    expect(screen.queryByText("统计暂不可用")).toBeNull();
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消置顶" })).toBeTruthy();
    api.get.mockResolvedValue(tokenSnapshot({ today: totals("456") }));
    act(() => api.tokenListen.mock.calls[0][0]({ schemaVersion: 1, sourceId: "synthetic-source-a", generation: "7", scanning: false }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByLabelText("今日: 456")).toBeTruthy();
  });
  it.each(["quota", "tokens"])("manual refresh isolates a %s failure", async (failed) => {
    render(<App />); await flush(); fireEvent.mouseEnter(screen.getByRole("main")); await flush();
    if (failed === "quota") api.quota.mockRejectedValue(new Error("quota")); else api.refreshTokens.mockRejectedValue(new Error("tokens"));
    act(() => api.desktopListen.mock.calls[0][0].onRefresh()); await flush();
    expect(api.refreshTokens).toHaveBeenCalledOnce();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByLabelText("本周: 1,200")).toBeTruthy();
    if (failed === "tokens") expect(screen.queryByText("暂未更新")).toBeNull();
  });
  it("preserves follow-system appearance while open", async () => {
    let change = () => {}; const media = { matches: false, addEventListener: (_: string, cb: () => void) => { change = cb; }, removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", () => media); api.preferences.mockResolvedValue({ ...prefs, appearance: "system" });
    render(<App />); await flush(); fireEvent.mouseEnter(screen.getByRole("main")); await flush();
    expect(screen.getByRole("main").className).toContain("theme-light");
    act(() => { media.matches = true; change(); });
    expect(screen.getByRole("main").className).toContain("theme-dark");
    vi.unstubAllGlobals();
  });

  it.each(["system", "light", "dark"])("applies %s appearance to the sidebar and responds only when following the system", async (appearance) => {
    let change = () => {};
    const media = { matches: false, addEventListener: (_: string, cb: () => void) => { change = cb; }, removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", () => media);
    api.preferences.mockResolvedValue({ ...prefs, displayMode: "sidebar", appearance });
    const view = render(<App />); await flush();
    expect(screen.getByRole("main").className).toContain(`sidebar--theme-${appearance === "dark" ? "dark" : "light"}`);
    act(() => { media.matches = true; change(); });
    expect(screen.getByRole("main").className).toContain(`sidebar--theme-${appearance === "light" ? "light" : "dark"}`);
    act(() => { media.matches = false; change(); });
    expect(screen.getByRole("main").className).toContain(`sidebar--theme-${appearance === "dark" ? "dark" : "light"}`);
    view.unmount(); expect(media.removeEventListener).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("loads valid skins, rejects invalid values, and applies desktop changes immediately", async () => {
    api.preferences.mockResolvedValue({ ...prefs, selectedSkin: "blur" });
    const view = render(<App />); await flush();
    expect(screen.getByRole("main").className).toContain("quota-orb--skin-blur");
    act(() => api.desktopListen.mock.calls[0][0].onPreferences({ ...prefs, selectedSkin: "computer" }));
    expect(screen.getByRole("main").className).toContain("quota-orb--skin-computer");
    view.unmount();

    api.preferences.mockResolvedValue({ ...prefs, selectedSkin: "whatever" });
    render(<App />); await flush();
    expect(screen.getByRole("main").className).not.toMatch(/skin-(blur|computer)/);
  });
});

 it("keeps the display menu operable after pointer exit and switches to the sidebar", async () => {
  render(<App />); await flush(); fireEvent.mouseEnter(screen.getByRole("main")); await flush();
  fireEvent.click(screen.getByRole("button", { name: "展示模式" }));
  fireEvent.mouseLeave(screen.getByRole("main"));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByRole("dialog", { name: "展示模式" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "切换到侧边栏" })); await flush();
  expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ displayMode: "sidebar", sidebarSide: "right", locked: false }));
  expect(screen.getByRole("main", { name: "侧边栏" })).toBeTruthy();
 });


it("restores top docking and persists the quick direction cycle through the real preferences flow", async () => {
  api.preferences.mockResolvedValue({ ...prefs, displayMode: "sidebar", sidebarSide: "top", stayExpanded: true });
  render(<App />); await flush();
  expect(screen.getByRole("main").className).toContain("sidebar--top");
  fireEvent.click(screen.getByRole("button", { name: "贴靠顶部，切换到右侧" })); await flush();
  expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarSide: "right", displayMode: "sidebar" }));
  fireEvent.click(screen.getByRole("button", { name: "贴靠右侧，切换到左侧" })); await flush();
  fireEvent.click(screen.getByRole("button", { name: "贴靠左侧，切换到顶部" })); await flush();
  expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarSide: "top" }));
  expect(screen.getByRole("main").className).toContain("sidebar--top");
});

function pendingSaves() {
  const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
  api.save.mockImplementation(() => new Promise<void>((resolve, reject) => { pending.push({ resolve, reject }); }));
  return pending;
}
async function sidebarSizeControl() {
  api.preferences.mockResolvedValue({ ...prefs, displayMode: "sidebar", stayExpanded: true, sidebarScale: 1.3 });
  render(<App />); await flush();
  fireEvent.contextMenu(screen.getByRole("main")); await flush();
  return screen.getByRole("slider", { name: "侧边栏大小" }) as HTMLInputElement;
}
async function stepSizeLeft(slider: HTMLInputElement) {
  fireEvent.change(slider, { target: { value: String(Number(slider.value) - 10) } });
  fireEvent.keyUp(slider, { key: "ArrowLeft" });
  await flush();
}
async function preferenceEvent(value: WidgetPreferences) {
  act(() => api.desktopListen.mock.calls.at(-1)![0].onPreferences(value));
  await flush();
}

it("migrates missing glass preferences to enabled and retains an explicitly disabled saved value", async () => {
  api.preferences.mockResolvedValue({ ...prefs, displayMode: "sidebar", stayExpanded: true });
  render(<App />); await flush();
  fireEvent.contextMenu(screen.getByRole("main")); await flush();
  expect((screen.getByRole("switch", { name: "毛玻璃效果" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("switch", { name: "毛玻璃效果" })); await flush();
  expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarGlassEnabled: false, sidebarOpacity: .9 }));
  await preferenceEvent(api.save.mock.calls.at(-1)![0]);
  expect((screen.getByRole("switch", { name: "毛玻璃效果" }) as HTMLInputElement).checked).toBe(false);
});

it("applies the native size during a held drag before releasing the pointer", async () => {
  const pending = pendingSaves();
  api.phase.mockImplementation(async () => ({ width: 376, height: 580, scale: api.save.mock.calls.at(-1)?.[0].sidebarScale ?? 1.3 }));
  const slider = await sidebarSizeControl();
  fireEvent.pointerDown(slider);
  for (const value of [110, 80]) {
    fireEvent.change(slider, { target: { value: String(value) } });
    await flush();
    expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarScale: value / 100 }));
    expect(screen.getByRole("main").style.getPropertyValue("--sidebar-scale")).toBe(String(value / 100));
  }
  fireEvent.pointerUp(slider);
  expect(api.save).toHaveBeenCalledTimes(2);
  api.preferences.mockResolvedValue(api.save.mock.calls[1][0]);
  await act(async () => pending.forEach(save => save.resolve()));
  await flush();
  expect(slider.value).toBe("80");
});

it("keeps all five size steps when older save events arrive between keyboard inputs", async () => {
  const pending = pendingSaves();
  const slider = await sidebarSizeControl();
  await stepSizeLeft(slider);
  await stepSizeLeft(slider);
  await preferenceEvent(api.save.mock.calls[0][0]);
  expect(slider.value).toBe("110");
  await stepSizeLeft(slider);
  await preferenceEvent(api.save.mock.calls[1][0]);
  await stepSizeLeft(slider);
  await preferenceEvent(api.save.mock.calls[2][0]);
  await stepSizeLeft(slider);
  await preferenceEvent(api.save.mock.calls[3][0]);
  await preferenceEvent(api.save.mock.calls[4][0]);
  expect(api.save.mock.calls.map(([value]) => value.sidebarScale)).toEqual([1.2, 1.1, 1, .9, .8]);
  expect(slider.value).toBe("80");
  const latest = api.save.mock.calls[4][0];
  api.preferences.mockResolvedValue({ ...latest, sidebarShowDeepseek: false });
  await act(async () => { pending.forEach(save => save.resolve()); }); await flush();
  expect(slider.value).toBe("80");
  expect((screen.getByRole("switch", { name: "显示 DeepSeek" }) as HTMLInputElement).checked).toBe(false);
  await preferenceEvent({ ...latest, sidebarScale: .9 });
  expect(slider.value).toBe("90");
});

it("does not roll back later size input when an older save fails", async () => {
  const pending = pendingSaves();
  const slider = await sidebarSizeControl();
  await stepSizeLeft(slider);
  await stepSizeLeft(slider);
  await act(async () => pending[0].reject(new Error("older save failed"))); await flush();
  expect(slider.value).toBe("110");
  expect(screen.queryByText("设置保存失败，已恢复之前的状态。")).toBeNull();
  api.preferences.mockResolvedValue(api.save.mock.calls[1][0]);
  await act(async () => pending[1].resolve()); await flush();
  expect(slider.value).toBe("110");
});

it("reconciles a final failed save with disk and then accepts external preference events", async () => {
  const pending = pendingSaves();
  const slider = await sidebarSizeControl();
  await stepSizeLeft(slider);
  await stepSizeLeft(slider);
  await act(async () => pending[0].resolve()); await flush();
  const saved = api.save.mock.calls[0][0];
  api.preferences.mockResolvedValue(saved);
  await act(async () => pending[1].reject(new Error("latest save failed"))); await flush();
  expect(slider.value).toBe("120");
  expect(screen.getByText("设置保存失败，已恢复之前的状态。")).toBeTruthy();
  await preferenceEvent({ ...saved, sidebarScale: .9 });
  expect(slider.value).toBe("90");
});

it.each(["success", "failure"])("does not apply a %s reconciliation read after a newer size input", async result => {
  const pending = pendingSaves();
  const slider = await sidebarSizeControl();
  await stepSizeLeft(slider);
  const older = api.save.mock.calls[0][0];
  let finishRead!: (value: WidgetPreferences) => void;
  api.preferences.mockImplementationOnce(() => new Promise<WidgetPreferences>(resolve => { finishRead = resolve; }));
  await act(async () => { if (result === "success") pending[0].resolve(); else pending[0].reject(new Error("older save failed")); }); await flush();
  await stepSizeLeft(slider);
  const latest = api.save.mock.calls[1][0];
  expect(slider.value).toBe("110");
  await act(async () => finishRead(older)); await flush();
  expect(slider.value).toBe("110");
  await preferenceEvent(older);
  expect(slider.value).toBe("110");
  api.preferences.mockResolvedValue(latest);
  await act(async () => pending[1].resolve()); await flush();
  expect(slider.value).toBe("110");
});

it("falls back to the last confirmed preference when the final save and read both fail", async () => {
  const pending = pendingSaves();
  const slider = await sidebarSizeControl();
  await stepSizeLeft(slider);
  await stepSizeLeft(slider);
  api.preferences.mockRejectedValue(new Error("read unavailable"));
  await act(async () => {
    pending[0].reject(new Error("older save failed"));
    pending[1].reject(new Error("latest save failed"));
  }); await flush();
  expect(slider.value).toBe("130");
  await preferenceEvent({ ...api.save.mock.calls[1][0], sidebarScale: .8 });
  expect(slider.value).toBe("80");
});


it("preserves browser preference edits instead of rereading static preview defaults", async () => {
  api.desktop.mockReturnValue(false);
  const slider = await sidebarSizeControl();
  const reads = api.preferences.mock.calls.length;
  await stepSizeLeft(slider);
  expect(slider.value).toBe("120");
  expect(api.preferences).toHaveBeenCalledTimes(reads);
});

it("repeats reconciliation when an external preference change arrives during the read", async () => {
  const pending = pendingSaves();
  const slider = await sidebarSizeControl();
  await stepSizeLeft(slider);
  const latest = api.save.mock.calls[0][0];
  let finishRead!: (value: WidgetPreferences) => void;
  api.preferences.mockImplementationOnce(() => new Promise<WidgetPreferences>(resolve => { finishRead = resolve; }));
  await act(async () => pending[0].resolve()); await flush();
  const external = { ...latest, sidebarScale: .9 };
  await preferenceEvent(external);
  expect(slider.value).toBe("120");
  api.preferences.mockResolvedValue(external);
  await act(async () => finishRead(latest)); await flush();
  expect(slider.value).toBe("90");
});


it("retains an earlier confirmed save if a later save and its read fail", async () => {
  const pending = pendingSaves();
  const slider = await sidebarSizeControl();
  await stepSizeLeft(slider);
  await stepSizeLeft(slider);
  await act(async () => pending[0].resolve()); await flush();
  expect(slider.value).toBe("110");
  api.preferences.mockRejectedValue(new Error("read unavailable"));
  await act(async () => pending[1].reject(new Error("latest save failed"))); await flush();
  expect(slider.value).toBe("120");
});
