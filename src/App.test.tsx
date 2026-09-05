// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { tokenSnapshot, totals } from "./test/tokenFixtures";

const api = vi.hoisted(() => ({ get: vi.fn(), tokenListen: vi.fn(), desktopListen: vi.fn(), refreshTokens: vi.fn(), expand: vi.fn(), quota: vi.fn(), preferences: vi.fn() }));
vi.mock("./lib/bridge", () => ({
  getTokenStatistics: api.get, listenTokenStatisticsUpdated: api.tokenListen, refreshTokenStatistics: api.refreshTokens,
  fetchSnapshots: api.quota, getPreferences: api.preferences, listenDesktopEvents: api.desktopListen,
  setWidgetExpanded: api.expand, syncWidgetAppearance: vi.fn(async () => {}), startDragging: vi.fn(), updatePreferences: vi.fn(), setAlwaysOnTop: vi.fn(),
}));
vi.mock("./lib/appUpdate", () => ({ checkForAppUpdate: vi.fn(), openReleasePage: vi.fn() }));
const prefs = { locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN", appearance: "light" };
const quota = { provider: "codex", displayName: "CODEX", plan: "TEST", shortWindow: { remainingPercent: 74, resetsAt: null, windowSeconds: 18000 }, weeklyWindow: { remainingPercent: 42, resetsAt: null, windowSeconds: 604800 }, resetCredits: null, updatedAt: new Date().toISOString(), status: "ok", message: null };
async function flush() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  api.get.mockResolvedValue(tokenSnapshot()); api.tokenListen.mockResolvedValue(() => {}); api.desktopListen.mockResolvedValue(() => {});
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
    expect(screen.getByText("统计暂不可用")).toBeTruthy();
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
    expect(screen.getByLabelText("本周: 1200")).toBeTruthy();
    if (failed === "tokens") expect(screen.getByText("暂未更新")).toBeTruthy();
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
});
