// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTokenStatistics } from "./useTokenStatistics";
import { tokenSnapshot, totals } from "../test/tokenFixtures";
import type { TokenStatisticsNotification, TokenStatisticsSnapshot } from "../lib/tokenStatistics";

const api = vi.hoisted(() => ({ get: vi.fn(), listen: vi.fn(), refresh: vi.fn() }));
vi.mock("../lib/bridge", () => ({ getTokenStatistics: api.get, listenTokenStatisticsUpdated: api.listen, refreshTokenStatistics: api.refresh }));
let events: Set<(event: TokenStatisticsNotification) => void>;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function flush() { await act(async () => { await Promise.resolve(); }); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function emit(patch: Partial<TokenStatisticsNotification> = {}) { act(() => { for (const handler of events) handler({ schemaVersion: 1, sourceId: "synthetic-source-a", generation: "8", scanning: false, ...patch }); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); events = new Set();
  api.get.mockReset().mockResolvedValue(tokenSnapshot());
  api.refresh.mockReset().mockResolvedValue({ queued: true });
  api.listen.mockReset().mockImplementation(async (handler) => { events.add(handler); return () => events.delete(handler); });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("stable token lifecycle", () => {
  it("registers once before initial query; repeated hover never scans or adds listeners", async () => {
    const hook = renderHook(({ open }) => useTokenStatistics(open), { initialProps: { open: false } });
    await flush(); expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.listen.mock.invocationCallOrder[0]).toBeLessThan(api.get.mock.invocationCallOrder[0]);
    for (let i = 0; i < 4; i++) { hook.rerender({ open: true }); await flush(); hook.rerender({ open: false }); }
    expect(api.listen).toHaveBeenCalledTimes(1); expect(events.size).toBe(1); expect(api.refresh).not.toHaveBeenCalled();
    hook.unmount(); expect(events.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("captures events during asynchronous registration and cleans late listeners", async () => {
    const registration = deferred<() => void>(); const stop = vi.fn();
    api.listen.mockImplementation((handler) => { handler({ sourceId: "synthetic-source-a", generation: "9", scanning: true }); return registration.promise; });
    const hook = renderHook(() => useTokenStatistics(true));
    expect(api.get).not.toHaveBeenCalled();
    await act(async () => registration.resolve(stop)); await flush();
    expect(api.get).toHaveBeenCalledTimes(1);
    hook.unmount(); expect(stop).toHaveBeenCalledOnce();
    const late = deferred<() => void>(); api.listen.mockReturnValue(late.promise);
    const second = renderHook(() => useTokenStatistics(true)); second.unmount();
    const lateStop = vi.fn(); await act(async () => late.resolve(lateStop));
    expect(lateStop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("coalesces dense events and keeps one trailing request with no concurrent reads", async () => {
    const first = deferred<TokenStatisticsSnapshot>(); api.get.mockReturnValueOnce(first.promise);
    const hook = renderHook(() => useTokenStatistics(true)); await flush();
    for (let i = 0; i < 100; i++) emit();
    await tick(1000); expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(tokenSnapshot()));
    api.get.mockResolvedValue(tokenSnapshot({ generation: "8", today: totals("82") }));
    await tick(500); expect(api.get).toHaveBeenCalledTimes(2); expect(hook.result.current.snapshot?.today?.totalTokens).toBe("82");
  });
  it("does not regress on older generation responses, but accepts lower corrected totals", async () => {
    const hook = renderHook(() => useTokenStatistics(true)); await flush();
    api.get.mockResolvedValueOnce(tokenSnapshot({ generation: "6", today: totals("100") })); emit(); await tick(500);
    expect(hook.result.current.snapshot?.generation).toBe("7");
    api.get.mockResolvedValueOnce(tokenSnapshot({ generation: "8", total: totals("1") })); emit(); await tick(500);
    expect(hook.result.current.snapshot?.total?.totalTokens).toBe("1");
  });
  it("retains same-source data after IPC failure and clears it on a source switch", async () => {
    const hook = renderHook(() => useTokenStatistics(true)); await flush();
    api.get.mockRejectedValue(new Error("offline")); emit(); await tick(500);
    expect(hook.result.current.failed).toBe(true); expect(hook.result.current.snapshot?.total).not.toBeNull();
    emit({ sourceId: "synthetic-source-b" }); await tick(500);
    expect(hook.result.current.snapshot).toBeNull();
  });
  it("rejects a response for an old source after a source-change notification", async () => {
    const old = deferred<TokenStatisticsSnapshot>(); api.get.mockReturnValueOnce(old.promise);
    const hook = renderHook(() => useTokenStatistics(true)); await flush(); emit({ sourceId: "synthetic-source-b" });
    await act(async () => old.resolve(tokenSnapshot())); expect(hook.result.current.snapshot).toBeNull();
    api.get.mockResolvedValue(tokenSnapshot({ sourceId: "synthetic-source-b", generation: "1" }));
    await tick(500); expect(hook.result.current.snapshot?.sourceId).toBe("synthetic-source-b");
  });
  it("refreshes calendar ranges at the same generation and stops polling when closed", async () => {
    const hook = renderHook(({ open }) => useTokenStatistics(open), { initialProps: { open: true } }); await flush();
    api.get.mockResolvedValue(tokenSnapshot({ queryAtUtc: "2026-10-01T00:00:01Z", thisMonthStartUtc: "2026-10-01T00:00:00Z", today: totals("14"), thisMonth: totals("14") }));
    await tick(60_000); expect(hook.result.current.snapshot?.thisMonth?.totalTokens).toBe("14"); expect(api.get).toHaveBeenCalledTimes(2);
    hook.rerender({ open: false }); emit(); await tick(180_000); expect(api.get).toHaveBeenCalledTimes(2);
    hook.rerender({ open: true }); await flush(); expect(api.get).toHaveBeenCalledTimes(3);
  });
  it("survives StrictMode repeated mount and ignores responses after disposal", async () => {
    const hook = renderHook(() => useTokenStatistics(true), { wrapper: StrictMode }); await flush();
    expect(events.size).toBe(1); expect(api.get).toHaveBeenCalledTimes(1);
    const last = deferred<TokenStatisticsSnapshot>(); api.get.mockReturnValueOnce(last.promise); emit(); await tick(500);
    hook.unmount(); await act(async () => last.resolve(tokenSnapshot({ generation: "99" })));
    expect(events.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("still queries after listener failure and isolates manual refresh failures", async () => {
    api.listen.mockRejectedValue(new Error("listener"));
    const hook = renderHook(() => useTokenStatistics(true)); await flush();
    expect(hook.result.current.listenerFailed).toBe(true); expect(hook.result.current.snapshot).not.toBeNull();
    api.refresh.mockRejectedValue(new Error("refresh")); await act(async () => hook.result.current.refresh());
    expect(hook.result.current.failed).toBe(true); expect(hook.result.current.snapshot).not.toBeNull();
  });
});
