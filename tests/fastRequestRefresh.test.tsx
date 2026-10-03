// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TokenUsage } from "../src/components/TokenUsage";
import { useTokenStatistics } from "../src/hooks/useTokenStatistics";
import { tokenSnapshot } from "../src/test/tokenFixtures";
import type { TokenStatisticsNotification, TokenStatisticsSnapshot, TurnTokenUsage } from "../src/lib/tokenStatistics";

const api = vi.hoisted(() => ({ get: vi.fn(), listen: vi.fn(), refresh: vi.fn() }));
vi.mock("../src/lib/bridge", () => ({ getTokenStatistics: api.get, listenTokenStatisticsUpdated: api.listen, refreshTokenStatistics: api.refresh }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("shows late request evidence through the existing controller without changing other row values", async () => {
  const row: TurnTokenUsage = { model: "synthetic", effort: "max", tokens: "10", completedAt: "2026-09-05T01:00:00Z", weeklyRemaining: 72.5, quotaObservedAt: "2026-09-05T01:03:00Z", isPartial: false, fastMode: null };
  const before = tokenSnapshot({ schemaVersion: 4, turnStatistics: { weeklyResetAt: "2026-09-10T00:00:00Z", turns: [{ ...row, completedAt: "2026-09-05T01:02:00Z", tokens: "20", fastMode: false }, row] } });
  const after = { ...before, generation: "8", turnStatistics: { ...before.turnStatistics!, turns: before.turnStatistics!.turns.map((turn, i) => i === 1 ? { ...turn, fastMode: true } : turn) } };
  // The paired local run supplies snapshots and the actual commit notification
  // exported by the Rust service fixture; regular frontend CI uses synthetic data.
  const fixture: { before: TokenStatisticsSnapshot; after: TokenStatisticsSnapshot; notification: TokenStatisticsNotification } = process.env.FAST_REQUEST_REFRESH_FIXTURE
    ? JSON.parse(readFileSync(process.env.FAST_REQUEST_REFRESH_FIXTURE, "utf8"))
    : { before, after, notification: { schemaVersion: 4, sourceId: before.sourceId, generation: "8", scanning: false } };
  vi.useFakeTimers();
  vi.setSystemTime(new Date(fixture.before.queryAtUtc));
  let notify!: (event: TokenStatisticsNotification) => void;
  api.listen.mockResolvedValue(() => {});
  api.listen.mockImplementation(async (callback) => { notify = callback; return () => {}; });
  api.get.mockResolvedValue(fixture.before);
  function Harness() { return <TokenUsage language="en" view={useTokenStatistics(true)} />; }
  const mounted = render(<Harness />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "Quota week" }));
  const rows = () => [...mounted.container.querySelectorAll(".token-turn-row")];
  const values = () => rows().map(element => [
    element.querySelector(".token-model-name")?.textContent,
    element.querySelector(".token-turn-effort-text")?.textContent,
    element.querySelector(".token-value")?.outerHTML,
    element.querySelector(".token-turn-quota")?.outerHTML,
  ]);
  const originalValues = values();
  const ordinaryRow = rows()[0].outerHTML;
  expect(mounted.container.querySelector(".token-turn-fast")).toBeNull();
  expect(BigInt(fixture.after.generation)).toBeGreaterThan(BigInt(fixture.before.generation));
  expect(fixture.notification.generation).toBe(fixture.after.generation);
  expect(fixture.notification.sourceId).toBe(fixture.after.sourceId);
  expect(fixture.after.total).toEqual(fixture.before.total);
  api.get.mockResolvedValue(fixture.after);
  await act(async () => { notify(fixture.notification); await vi.advanceTimersByTimeAsync(500); });
  expect(rows().map(element => Boolean(element.querySelector(".token-turn-fast")))).toEqual([false, true]);
  expect(values()).toEqual(originalValues);
  expect(rows()[0].outerHTML).toBe(ordinaryRow);
  expect(api.listen).toHaveBeenCalledOnce();
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(api.refresh).not.toHaveBeenCalled();
});
