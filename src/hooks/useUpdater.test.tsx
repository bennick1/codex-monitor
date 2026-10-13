// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useUpdater } from "./useUpdater";
import { INITIAL_UPDATE_STATE, type UpdateState } from "../lib/updater";
const api = vi.hoisted(() => ({ get: vi.fn(), listener: undefined as undefined | ((state: UpdateState) => void), stop: vi.fn() }));
vi.mock("../lib/updater", async importOriginal => ({ ...await importOriginal<typeof import("../lib/updater")>(), getUpdaterState: api.get, listenUpdaterState: async (listener: (state: UpdateState) => void) => { api.listener = listener; return api.stop; } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("does not overwrite a newer progress event with a slow initial snapshot", async () => {
  let resolve!: (state: UpdateState) => void;
  api.get.mockReturnValue(new Promise<UpdateState>(done => { resolve = done; }));
  const { result } = renderHook(useUpdater);
  await waitFor(() => expect(api.get).toHaveBeenCalledOnce());
  act(() => api.listener?.({ ...INITIAL_UPDATE_STATE, phase: "downloading", downloadedBytes: 200 }));
  await act(async () => resolve({ ...INITIAL_UPDATE_STATE, phase: "available" }));
  expect(result.current.state.phase).toBe("downloading");
  expect(result.current.state.downloadedBytes).toBe(200);
});
it("keeps a newer event when a command returns an older state", async () => {
  api.get.mockResolvedValue({ ...INITIAL_UPDATE_STATE, phase: "available" });
  const { result } = renderHook(useUpdater);
  await waitFor(() => expect(result.current.state.phase).toBe("available"));
  let resolve!: (state: UpdateState) => void;
  let operation!: Promise<void>;
  act(() => { operation = result.current.execute(() => new Promise<UpdateState>(done => { resolve = done; })); });
  act(() => api.listener?.({ ...INITIAL_UPDATE_STATE, phase: "ready", downloadedBytes: 1000 }));
  await act(async () => { resolve({ ...INITIAL_UPDATE_STATE, phase: "downloading", downloadedBytes: 100 }); await operation; });
  expect(result.current.state.phase).toBe("ready");
  expect(result.current.state.downloadedBytes).toBe(1000);
});
