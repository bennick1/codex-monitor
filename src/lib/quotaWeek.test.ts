import { describe, expect, it } from "vitest";
import { quotaWeekBoundary } from "./quotaWeek";
import type { ProviderSnapshot } from "../types";
const now = Date.parse("2026-09-07T04:00:00Z");
const quota: ProviderSnapshot = { provider: "codex", displayName: "CODEX", plan: null, shortWindow: null, resetCredits: null, status: "ok", message: null, updatedAt: new Date(now).toISOString(), weeklyWindow: { resetsAt: "2026-09-11T09:09:19+08:00", windowSeconds: 604800, remainingPercent: 50 } };
describe("quota week boundary", () => {
  it("uses only the existing seven-day window and allows valid stale quota", () => {
    expect(quotaWeekBoundary(quota, now)).toEqual({ resetsAt: quota.weeklyWindow!.resetsAt, windowSeconds: 604800 });
    expect(quotaWeekBoundary({ ...quota, status: "stale" }, now + 1800000)).not.toBeNull();
    expect(quotaWeekBoundary({ ...quota, status: "stale" }, now + 1800001)).toBeNull();
  });
  it("never substitutes calendar week for missing, invalid or unavailable quota", () => {
    for (const patch of [{ weeklyWindow: null }, { status: "unavailable" }, { status: "signed_out" }, { status: "loading" }, { status: "stale", updatedAt: "bad" }, ...[null, "bad", "2026-09-07T04:00:00Z", "2026-10-01T00:00:00Z"].map(resetsAt => ({ weeklyWindow: { ...quota.weeklyWindow!, resetsAt } })), { weeklyWindow: { ...quota.weeklyWindow!, windowSeconds: 3600 } }] as Partial<ProviderSnapshot>[]) {
      expect(quotaWeekBoundary({ ...quota, ...patch }, now)).toBeNull();
    }
  });
});
