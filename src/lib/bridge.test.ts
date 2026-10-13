import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  calls: [] as string[],
  invoke: vi.fn(async (command: string): Promise<unknown> => {
    api.calls.push(`start:${command}`);
    await Promise.resolve();
    api.calls.push(`end:${command}`);
    return undefined;
  }),
  currentMonitor: vi.fn(async () => ({
    workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ currentMonitor: api.currentMonitor }));

beforeEach(() => {
  vi.clearAllMocks();
  api.calls.length = 0;
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("uses the private glass command without changing the window phase", async () => {
  const { syncSidebarGlass } = await import("./bridge");
  const frame = { sequence: 1, width: 376, height: 580, theme: "light" as const, enabled: true, regions: [] };
  api.invoke.mockResolvedValueOnce("active");
  expect(await syncSidebarGlass(frame)).toBe("active");
  expect(api.invoke).toHaveBeenCalledExactlyOnceWith("sync_sidebar_glass", { frame });
  vi.stubGlobal("window", {});
  expect(await syncSidebarGlass(frame)).toBe("unsupported");
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("reports sidebar hit regions through the existing command without a viewport wait", async () => {
  const { syncSidebarRegions } = await import("./bridge");
  const regions = [{ x: 0, y: 262, width: 8, height: 56 }];
  await syncSidebarRegions("handle", regions);
  expect(api.invoke).toHaveBeenCalledWith("set_sidebar_phase", { phase: "handle", interactiveRegions: regions });
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("waits for the resized WebView and a painted frame before completing a sidebar transition", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  const view = {
    __TAURI_INTERNALS__: {}, innerWidth: 64, innerHeight: 288,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: (key: number) => frames.delete(key),
    setTimeout, clearTimeout,
  };
  vi.stubGlobal("window", view);
  api.invoke.mockResolvedValueOnce({ width: 344, height: 480, scale: .8 });
  const { setSidebarPhase } = await import("./bridge");
  let finished = false;
  const operation = setSidebarPhase("detail").then(viewport => { finished = true; return viewport; });
  await vi.waitFor(() => expect(api.invoke).toHaveBeenCalledWith("set_sidebar_phase", { phase: "detail" }));
  expect(finished).toBe(false);
  const paint = async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); await Promise.resolve(); };
  await paint(); await paint();
  expect(finished).toBe(false);
  view.innerWidth = 344; view.innerHeight = 480;
  await paint();
  expect(finished).toBe(false);
  view.innerWidth = 64;
  await paint();
  view.innerWidth = 344;
  await paint();
  expect(finished).toBe(false);
  await paint();
  expect(await operation).toEqual({ width: 344, height: 480, scale: .8 });
  expect(finished).toBe(true);
  expect(frames.size).toBe(0);
});

it("cleans up a stalled sidebar frame and allows the next native transition", async () => {
  vi.useFakeTimers();
  const cancelFrame = vi.fn();
  vi.stubGlobal("window", {
    __TAURI_INTERNALS__: {}, innerWidth: 64, innerHeight: 288,
    requestAnimationFrame: vi.fn(() => 42), cancelAnimationFrame: cancelFrame,
    setTimeout, clearTimeout,
  });
  api.invoke.mockResolvedValueOnce({ width: 344, height: 480 });
  const { setSidebarPhase } = await import("./bridge");
  const operation = setSidebarPhase("detail").catch(error => error as Error);
  await vi.waitFor(() => expect(api.invoke).toHaveBeenCalledWith("set_sidebar_phase", { phase: "detail" }));
  await vi.advanceTimersByTimeAsync(1500);
  expect(await operation).toEqual(new Error("Sidebar viewport did not settle"));
  expect(cancelFrame).toHaveBeenCalledWith(42);
  api.invoke.mockResolvedValueOnce(null);
  await setSidebarPhase("handle");
  expect(api.invoke).toHaveBeenLastCalledWith("set_sidebar_phase", { phase: "handle" });
});

describe("widget transitions", () => {
  it("passes the monitor work area to the Rust expansion command", async () => {
    const { setWidgetExpanded } = await import("./bridge");
    await setWidgetExpanded(true);
    expect(api.invoke).toHaveBeenCalledWith("expand_widget", {
      workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
    });
  });

  it("serializes rapid expand and collapse requests", async () => {
    const { setWidgetExpanded } = await import("./bridge");
    await Promise.all([setWidgetExpanded(true), setWidgetExpanded(false)]);
    expect(api.calls).toEqual([
      "start:expand_widget",
      "end:expand_widget",
      "start:collapse_widget",
      "end:collapse_widget",
    ]);
  });
});

it('serializes height/appearance sync with expansion and clamps using monitor work area', async () => {
  const { syncWidgetAppearance, setWidgetExpanded } = await import('./bridge');
  await Promise.all([syncWidgetAppearance('dark', 'compact'), setWidgetExpanded(true), syncWidgetAppearance('light', 'full'), setWidgetExpanded(false)]);
  expect(api.calls).toEqual(['start:sync_widget_appearance','end:sync_widget_appearance','start:expand_widget','end:expand_widget','start:sync_widget_appearance','end:sync_widget_appearance','start:collapse_widget','end:collapse_widget']);
  expect(api.invoke).toHaveBeenCalledWith('sync_widget_appearance', {appearance:'dark',expandedHeightMode:'compact',workArea:{position:{x:0,y:0},size:{width:1920,height:1040}}});
});
