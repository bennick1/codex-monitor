import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTokenStatistics, refreshTokenStatistics, listenTokenStatisticsUpdated } from "./bridge";

const api = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: api.listen }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("window", { __TAURI_INTERNALS__: {} }); });

describe("independent token statistics bridge", () => {
  it("calls fixed commands without accepting source paths or periods", async () => {
    const snapshot = { generation: "9007199254740993", total: { totalTokens: "9007199254740995" } };
    api.invoke.mockResolvedValueOnce(snapshot).mockResolvedValueOnce({ queued: true });
    expect(await getTokenStatistics()).toEqual(snapshot);
    expect(await refreshTokenStatistics()).toEqual({ queued: true });
    expect(api.invoke.mock.calls).toEqual([["get_token_statistics"], ["refresh_token_statistics"]]);
  });
  it("forwards only the independent notification and cleanup", async () => {
    const stop = vi.fn();
    api.listen.mockImplementation(async (_name, callback) => {
      callback({ payload: { schemaVersion: 1, generation: "8", scanning: false } });
      return stop;
    });
    const handler = vi.fn();
    const cleanup = await listenTokenStatisticsUpdated(handler);
    expect(api.listen.mock.calls[0][0]).toBe("token-statistics-updated");
    expect(handler).toHaveBeenCalledWith({ schemaVersion: 1, generation: "8", scanning: false });
    cleanup(); expect(stop).toHaveBeenCalledOnce();
  });
  it("never substitutes browser mock quota or zero for unavailable local statistics", async () => {
    vi.stubGlobal("window", {});
    await expect(getTokenStatistics()).rejects.toThrow("desktop app");
    await expect(refreshTokenStatistics()).rejects.toThrow("desktop app");
    expect(api.invoke).not.toHaveBeenCalled();
  });
});
