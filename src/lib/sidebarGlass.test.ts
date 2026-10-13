// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createSidebarGlassQueue, glassColorAlpha, roundedGlassPath, sampleSidebarGlass, sidebarRailGlassPath, type SidebarGlassFrame, type SidebarGlassSnapshot, type SidebarGlassStatus } from "./sidebarGlass";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it("keeps the bezel joins on the selected edge and transposes top docking", () => {
  const right = sidebarRailGlassPath("right", 180);
  const left = sidebarRailGlassPath("left", 180);
  const top = sidebarRailGlassPath("top", 180);
  expect(right[0]).toEqual({ op: "move", x: 1, y: 0 });
  expect(right.at(-2)).toMatchObject({ x: 1, y: 1 });
  expect(left[0]).toEqual({ op: "move", x: 0, y: 0 });
  expect(left.at(-2)).toMatchObject({ x: 0, y: 1 });
  expect(top[0]).toEqual({ op: "move", x: 0, y: 0 });
  expect(top.at(-2)).toMatchObject({ x: 1, y: 0 });
  for (const height of [60, 98, 180]) for (const side of ["left", "right", "top"] as const) {
    for (const command of sidebarRailGlassPath(side, height)) {
      for (const value of Object.values(command)) if (typeof value === "number") expect(value).toBeGreaterThanOrEqual(0);
      for (const value of Object.values(command)) if (typeof value === "number") expect(value).toBeLessThanOrEqual(1);
    }
  }
});

it("retains fixed panel corner radius and a true round action mask", () => {
  expect(roundedGlassPath(272, 360, 20)[0]).toEqual({ op: "move", x: 20 / 272, y: 0 });
  expect(roundedGlassPath(42, 42, 21)[0]).toEqual({ op: "move", x: .5, y: 0 });
  expect(roundedGlassPath(12, 10, 20)[0]).toEqual({ op: "move", x: 5 / 12, y: 0 });
});

it("samples only painted surfaces, including partially revealed buttons, never a transparent hover corridor", () => {
  const root = document.createElement("main");
  root.innerHTML = '<div class="sidebar-dock" style="opacity: .4"><svg class="sidebar-silhouette"></svg><button class="sidebar-gear"><svg class="sidebar-action-arc"><circle style="fill: rgba(241, 244, 249, 0.45)"></circle></svg></button></div><section class="sidebar-panel" style="opacity: .75; border-top-left-radius: 20px"></section><button class="sidebar-handle"></button>';
  document.body.append(root);
  for (const [selector, rect] of [
    [".sidebar-silhouette", new DOMRect(0, 140, 60, 240)],
    [".sidebar-panel", new DOMRect(72, 80, 272, 360)],
    ["circle", new DOMRect(9, 359, 42, 42)],
  ] as const) vi.spyOn(root.querySelector(selector)!, "getBoundingClientRect").mockReturnValue(rect);
  const options = { theme: "light", enabled: true, side: "left", dockHeight: 180, surfaceOpacity: .9 } as const;
  const frame = sampleSidebarGlass(root, options);
  expect(frame.regions.map(region => region.id)).toEqual(["rail", "panel", "gear"]);
  expect(frame.regions[0]).toMatchObject({ x: 0, y: 140, width: 60, height: 240, opacity: .4 });
  expect(frame.regions[1]).toMatchObject({ x: 72, opacity: .75 });
  expect(frame.regions[2].opacity).toBeCloseTo(.2);
  expect(frame.regions.some(region => region.x === 60 && region.width === 12)).toBe(false);
  (root.querySelector(".sidebar-dock") as HTMLElement).style.opacity = "0";
  (root.querySelector(".sidebar-panel") as HTMLElement).style.opacity = "0";
  expect(sampleSidebarGlass(root, options).regions).toEqual([]);
  expect(sampleSidebarGlass(root, { ...options, enabled: false }).regions).toEqual([]);
});

it("reads fill alpha during legacy and Color 4 transitions", () => {
  expect(glassColorAlpha("transparent")).toBe(0);
  expect(glassColorAlpha("rgba(240, 240, 245, 0.3)")).toBe(.3);
  expect(glassColorAlpha("rgb(240 240 245 / 45%)")).toBe(.45);
  expect(glassColorAlpha("color(srgb 1 1 1 / 0.6)")).toBe(.6);
  expect(glassColorAlpha("rgb(240, 240, 245)")).toBe(1);
});

const snapshot: SidebarGlassSnapshot = { width: 376, height: 580, theme: "light", enabled: true, regions: [] };
it("sends one request at a time and replaces intermediate frames with the latest one", async () => {
  const frames: SidebarGlassFrame[] = []; const replies: ((status: SidebarGlassStatus) => void)[] = [];
  const send = vi.fn((frame: SidebarGlassFrame) => { frames.push(frame); return new Promise<SidebarGlassStatus>(resolve => replies.push(resolve)); });
  const status = vi.fn(); const queue = createSidebarGlassQueue(send, status);
  queue.push(snapshot); queue.push({ ...snapshot, width: 380 }); queue.push({ ...snapshot, width: 390 });
  expect(send).toHaveBeenCalledTimes(1);
  replies[0]("active"); await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(2); expect(frames[1].width).toBe(390); expect(status).not.toHaveBeenCalled();
  replies[1]("active"); await Promise.resolve();
  expect(status).toHaveBeenLastCalledWith("active");
  queue.push({ ...snapshot, width: 390 }); expect(send).toHaveBeenCalledTimes(2);
  queue.push({ ...snapshot, width: 390 }, true); expect(send).toHaveBeenCalledTimes(3);
  replies[2]("active"); await Promise.resolve();
});

it("clears on teardown with a newer sequence and ignores late status replies", async () => {
  const replies: ((status: SidebarGlassStatus) => void)[] = [];
  const send = vi.fn((_frame: SidebarGlassFrame) => new Promise<SidebarGlassStatus>(resolve => replies.push(resolve)));
  const status = vi.fn(); const queue = createSidebarGlassQueue(send, status);
  queue.push(snapshot); queue.push({ ...snapshot, theme: "dark" }); queue.dispose(snapshot);
  replies[0]("active"); await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0]).toMatchObject({ enabled: false, regions: [] });
  expect(send.mock.calls[1][0].sequence).toBeGreaterThan(send.mock.calls[0][0].sequence);
  replies[1]("disabled"); await Promise.resolve();
  expect(status).not.toHaveBeenCalled();
  queue.push(snapshot); expect(send).toHaveBeenCalledTimes(2);
  const later = createSidebarGlassQueue(send, status); later.push(snapshot);
  expect(send.mock.calls[2][0].sequence).toBeGreaterThan(send.mock.calls[1][0].sequence);
  replies[2]("active"); await Promise.resolve();
});

it("reports native failures as unavailable without breaking subsequent refreshes", async () => {
  const send = vi.fn<(frame: SidebarGlassFrame) => Promise<SidebarGlassStatus>>().mockRejectedValueOnce(new Error("synthetic")).mockResolvedValue("active");
  const status = vi.fn(); const queue = createSidebarGlassQueue(send, status);
  queue.push(snapshot); await Promise.resolve();
  expect(status).toHaveBeenLastCalledWith("unavailable");
  queue.push(snapshot, true); await Promise.resolve();
  expect(status).toHaveBeenLastCalledWith("active");
});
