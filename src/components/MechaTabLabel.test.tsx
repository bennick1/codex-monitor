// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TokenUsage } from "./TokenUsage";
import { tokenSnapshot } from "../test/tokenFixtures";
import { INITIAL_TOKEN_VIEW } from "../lib/tokenStatisticsController";
import patches from "../../assets/mecha-light/tabs-reference-exact/label-patches.json";

const view = { ...INITIAL_TOKEN_VIEW, snapshot: tokenSnapshot({ turnStatistics: {
  weeklyResetAt: "2026-10-04T00:00:00Z", turns: [{ model: "synthetic-model", effort: "high", fastMode: null,
    tokens: "1234", completedAt: "2026-10-01T00:00:00Z", weeklyRemaining: 70,
    quotaObservedAt: "2026-10-01T00:00:01Z", isPartial: false }],
} }) };
const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");
let decode: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;
function size(image: HTMLImageElement) {
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: image.width || 91 });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: image.height || 36 });
}
beforeEach(() => {
  decode = vi.fn(function (this: HTMLImageElement) { size(this); return Promise.resolve(); });
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: decode });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, "decode", originalDecode);
  else Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
});
const labels = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".token-tab-label")];
const ready = async (container: HTMLElement) => waitFor(() => expect(labels(container).map(n => n.dataset.labelStatus)).toEqual(["ready", "ready", "ready"]));

it.each(["healthy", "caution", "critical"] as const)("keeps label identities, names and actual content for every selection in %s", async tone => {
  const { container } = render(<TokenUsage view={view} language="zh-CN" mechaTabTone={tone} />);
  for (const [index, name] of ["总览", "按模型", "额度周"].entries()) {
    const button = screen.getByRole("button", { name });
    fireEvent.click(button); await ready(container);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector([".token-grid", ".token-model-view", ".token-turn-view"][index])).toBeTruthy();
    const names = ["总览", "按模型", "额度周"];
    for (const [i, key] of ["overview", "models", "turns"].entries()) {
      const b = screen.getByRole("button", { name: names[i] });
      const img = b.querySelector("img")!;
      expect(b.textContent).toBe(names[i]);
      expect(img.dataset.patchId).toContain(`:${key}:`);
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("aria-hidden")).toBe("true");
      expect(img.draggable).toBe(false);
      expect(b.querySelector("span")?.getAttribute("aria-hidden")).toBeNull();
    }
  }
  expect(warn).not.toHaveBeenCalled();
});

it("keeps real text during loading and ignores late decode after language and skin changes", async () => {
  const pending: Array<() => void> = [];
  decode.mockImplementation(function (this: HTMLImageElement) { size(this); return new Promise<void>(r => pending.push(r)); });
  const mounted = render(<TokenUsage view={view} language="zh-CN" mechaTabTone="healthy" />);
  await act(async () => {});
  expect(labels(mounted.container).every(n => n.dataset.labelStatus === "loading")).toBe(true);
  mounted.rerender(<TokenUsage view={view} language="en" mechaTabTone="healthy" />);
  await act(async () => pending.splice(0).forEach(resolve => resolve()));
  expect(screen.getByRole("button", { name: "Overview" })).toBeTruthy();
  expect(mounted.container.querySelectorAll(".mecha-tab-label-patch")).toHaveLength(0);
  expect(labels(mounted.container).every(n => n.dataset.labelStatus === "text")).toBe(true);
  mounted.rerender(<TokenUsage view={view} language="zh-CN" mechaTabTone="critical" />);
  await act(async () => {});
  mounted.rerender(<TokenUsage view={view} language="zh-CN" />);
  await act(async () => pending.splice(0).forEach(resolve => resolve()));
  expect(screen.getByRole("button", { name: "总览" })).toBeTruthy();
  expect(mounted.container.querySelectorAll(".mecha-tab-label-patch")).toHaveLength(0);
  expect(labels(mounted.container).every(n => n.dataset.labelStatus === "text")).toBe(true);
});

it.each(["label", "panel"])("restores real text if %s decode fails", async failed => {
  decode.mockImplementation(function (this: HTMLImageElement) {
    size(this);
    return (this.src.includes("-label-") === (failed === "label")) ? Promise.reject(new Error("synthetic decode failure")) : Promise.resolve();
  });
  const { container } = render(<TokenUsage view={view} language="zh-CN" mechaTabTone="healthy" />);
  await waitFor(() => expect(labels(container).map(n => n.dataset.labelStatus)).toEqual(["error", "error", "error"]));
  expect(screen.getByRole("button", { name: "总览" })).toBeTruthy();
  expect([...container.querySelectorAll<HTMLImageElement>(".mecha-tab-label-patch")].every(n => n.dataset.ready === "false")).toBe(true);
  expect(warn).toHaveBeenCalledTimes(3);
});

it("uses diagnosable text fallback when an exact label/background mapping is absent", async () => {
  const index = patches.entries.findIndex(p => p.color === "blue" && p.labelKey === "overview" && p.renderState === "active");
  const [removed] = patches.entries.splice(index, 1);
  try {
    const { container } = render(<TokenUsage view={view} language="zh-CN" mechaTabTone="healthy" />);
    await waitFor(() => expect(labels(container)[0].dataset.labelStatus).toBe("missing"));
    expect(screen.getByRole("button", { name: "总览" }).querySelector("img")).toBeNull();
    expect(warn).toHaveBeenCalledWith("[MechaTabLabel] Missing background-bound label mapping", expect.any(String));
  } finally { patches.entries.splice(index, 0, removed); }
});

it("rejects decodable assets with wrong dimensions and uses text for unknown panel tone", async () => {
  decode.mockImplementation(function (this: HTMLImageElement) {
    Object.defineProperty(this, "naturalWidth", { configurable: true, value: 1 });
    Object.defineProperty(this, "naturalHeight", { configurable: true, value: 1 });
    return Promise.resolve();
  });
  const mounted = render(<TokenUsage view={view} language="zh-CN" mechaTabTone="healthy" />);
  await waitFor(() => expect(labels(mounted.container).every(n => n.dataset.labelStatus === "error")).toBe(true));
  mounted.rerender(<TokenUsage view={view} language="zh-CN" mechaTabTone="unknown" />);
  expect(labels(mounted.container).every(n => n.dataset.labelStatus === "text")).toBe(true);
  expect(mounted.container.querySelectorAll(".mecha-tab-label-patch")).toHaveLength(0);
});
