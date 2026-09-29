// @vitest-environment jsdom
import { StrictMode, type ReactElement } from "react";
import { act, cleanup, fireEvent, render as renderInto, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { tokenSnapshot, totals } from "./test/tokenFixtures";

const api = vi.hoisted(() => ({ get: vi.fn(), tokenListen: vi.fn(), desktopListen: vi.fn(), refreshTokens: vi.fn(), expand: vi.fn(), quota: vi.fn(), preferences: vi.fn(), save: vi.fn(), drag: vi.fn() }));
vi.mock("./lib/bridge", () => ({
  getTokenStatistics: api.get, listenTokenStatisticsUpdated: api.tokenListen, refreshTokenStatistics: api.refreshTokens,
  fetchSnapshots: api.quota, getPreferences: api.preferences, listenDesktopEvents: api.desktopListen,
  setWidgetExpanded: api.expand, syncWidgetAppearance: vi.fn(async () => {}), startDragging: api.drag, updatePreferences: api.save, setAlwaysOnTop: vi.fn(),
}));
vi.mock("./lib/releasePage", () => ({ openReleasePage: vi.fn() }));
const prefs = { locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN", appearance: "light", selectedSkin: "default" };
const quota = { provider: "codex", displayName: "CODEX", plan: "TEST", shortWindow: { remainingPercent: 74, resetsAt: null, windowSeconds: 18000 }, weeklyWindow: { remainingPercent: 42, resetsAt: null, windowSeconds: 604800 }, resetCredits: null, updatedAt: new Date().toISOString(), status: "ok", message: null };
async function flush() { await act(async () => { await Promise.resolve(); }); }
function render(node: ReactElement) {
  // App mounts into this existing host in production; it never creates a new
  // wrapper or moves the semantic main element when opacity changes.
  const container = document.createElement("div");
  container.id = "root";
  document.body.append(container);
  const view = renderInto(node, { container });
  return { ...view, unmount() { view.unmount(); container.remove(); } };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  api.get.mockResolvedValue(tokenSnapshot()); api.tokenListen.mockResolvedValue(() => {}); api.desktopListen.mockResolvedValue(() => {});
  api.expand.mockResolvedValue(undefined); api.quota.mockResolvedValue([quota]); api.preferences.mockResolvedValue(prefs); api.refreshTokens.mockResolvedValue({ queued: true });
  api.save.mockResolvedValue(undefined);
});

describe("whole widget opacity with the production card and orb", () => {
  it("uses only the existing host and cleans up its opacity on unmount", async () => {
    api.preferences.mockResolvedValue({ ...prefs, opacityPercent: 60 });
    const view = render(<StrictMode><App /></StrictMode>); await flush();
    expect(view.container.children).toHaveLength(1);
    expect(view.container.firstElementChild).toBe(screen.getByRole("main"));
    expect(view.container.style.opacity).toBe("0.6");
    expect(view.container.style.transform).toBe("translateZ(0)");
    expect(view.container.classList.contains("widget-visual-root")).toBe(true);
    view.unmount();
    expect(view.container.style.opacity).toBe("");
    expect(view.container.style.transform).toBe("");
    expect(view.container.classList.contains("widget-visual-root")).toBe(false);
  });

  it.each(["default", "blur", "computer"])("keeps %s skin opacity across full/compact expansion, collapse and preference events", async (skin) => {
    api.preferences.mockResolvedValue({ ...prefs, selectedSkin: skin, opacityPercent: 80 });
    const view = render(<App />); await flush();
    const root = view.container;
    expect(root.style.opacity).toBe("0.8");
    expect(screen.getByRole("main").parentElement).toBe(root);
    expect(screen.getByRole("main").style.opacity).toBe("");
    fireEvent.mouseDown(screen.getByRole("main"), { button: 0 });
    expect(api.drag).toHaveBeenCalledOnce();
    fireEvent.mouseEnter(screen.getByRole("main")); await flush();
    expect(screen.getByRole("main").className).toContain("quota-card--height-full");
    expect(root.style.opacity).toBe("0.8");
    expect(root.contains(screen.getByRole("region", { name: "Token 用量" }))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "保持常态展开" }));
    expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ selectedSkin: skin, opacityPercent: 80, stayExpanded: true }));
    expect(api.drag).toHaveBeenCalledOnce();

    act(() => api.desktopListen.mock.calls.at(-1)![0].onPreferences({ ...prefs, selectedSkin: skin, opacityPercent: 60 }));
    expect(root.style.opacity).toBe("0.6");
    api.quota.mockResolvedValue([{ ...quota, shortWindow: null }]);
    act(() => api.desktopListen.mock.calls.at(-1)![0].onRefresh()); await flush();
    expect(screen.getByRole("main").className).toContain("quota-card--height-compact");
    expect(root.style.opacity).toBe("0.6");
    fireEvent.mouseLeave(screen.getByRole("main"));
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(screen.getByRole("main").className).toContain("quota-orb");
    expect(screen.getByRole("main").parentElement).toBe(root);
    expect(root.style.opacity).toBe("0.6");
    act(() => api.desktopListen.mock.calls.at(-1)![0].onPreferences({ ...prefs, selectedSkin: skin, opacityPercent: 100 }));
    expect(root.style.opacity).toBe("1");
    expect(root.style.transform).toBe("");
  });

  it("uses 100% for older preferences and safely normalizes incoming invalid values", async () => {
    api.preferences.mockResolvedValue({ ...prefs, selectedSkin: "computer", language: "en", alwaysOnTop: false });
    const view = render(<App />); await flush();
    const root = view.container;
    expect(root.style.opacity).toBe("1");
    expect(screen.getByRole("main").className).toContain("skin-computer");
    for (const [input, expected] of [["60", "1"], [null, "1"], [Number.NaN, "1"], [0, "0.6"], [83, "0.85"]] as const) {
      act(() => api.desktopListen.mock.calls.at(-1)![0].onPreferences({ ...prefs, selectedSkin: "computer", opacityPercent: input }));
      expect(root.style.opacity).toBe(expected);
      expect(screen.getByRole("main").className).toContain("skin-computer");
    }
  });

  it.each(["loading", "unavailable", "signed_out", "stale"])("dims %s states in both widget modes", async (status) => {
    api.preferences.mockResolvedValue({ ...prefs, opacityPercent: 60 });
    api.quota.mockResolvedValue([{ ...quota, status, shortWindow: null, weeklyWindow: null }]);
    const view = render(<App />); await flush();
    const root = view.container;
    expect(root.style.opacity).toBe("0.6");
    fireEvent.mouseEnter(screen.getByRole("main")); await flush();
    expect(root.style.opacity).toBe("0.6");
    expect(screen.getByRole("main").parentElement).toBe(root);
    expect(screen.getByRole("main").style.opacity).toBe("");
  });
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
