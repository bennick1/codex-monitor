import { describe, expect, it } from "vitest";
import { mechaPalette, mechaPercent, mechaTier } from "./mecha";
import type { ProviderSnapshot } from "../types";

const snapshot = (percent: number): ProviderSnapshot => ({ provider: "codex", displayName: "CODEX", plan: null,
  shortWindow: { remainingPercent: percent, resetsAt: null, windowSeconds: 18_000 }, weeklyWindow: { remainingPercent: 70, resetsAt: null, windowSeconds: 604_800 },
  resetCredits: null, resetCreditExpiresAt: [], updatedAt: new Date().toISOString(), status: "ok", message: null });

describe("Mecha raw primary quota", () => {
  it.each([[70, "healthy"], [50.01, "healthy"], [50, "caution"], [49.99, "caution"], [34, "caution"],
    [11, "caution"], [10.01, "caution"], [10, "critical"], [9.99, "critical"], [6, "critical"], [0, "critical"]] as const)("%s uses %s before display rounding", (value, state) => {
    expect(mechaTier(snapshot(value))).toBe(state);
  });
  it("uses valid 5h first and weekly fallback without a valid 5h value", () => {
    expect(mechaTier(snapshot(6))).toBe("critical");
    const weekly = { ...snapshot(6), shortWindow: null };
    expect(mechaTier(weekly)).toBe("healthy");
    expect(mechaTier(snapshot(NaN))).toBe("healthy");
    expect(mechaPalette(weekly)).toEqual(mechaPalette(snapshot(70)));
  });
  it.each(["stale", "signed_out", "unavailable", "loading"] as const)("%s retains neutral error state", status => {
    expect(mechaTier({ ...snapshot(0), status })).toBe("unknown");
  });
  it("does not convert missing or invalid quota to zero", () => {
    for (const value of [undefined, NaN, Infinity, -Infinity, -1, 101]) expect(mechaPercent(value)).toBeNull();
    expect(mechaTier({ ...snapshot(0), shortWindow: null, weeklyWindow: null })).toBe("unknown");
    expect(mechaPercent(0)).toBe(0);
  });
});
