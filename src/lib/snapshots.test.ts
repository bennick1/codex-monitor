import { describe, expect, it } from "vitest";
import type { ProviderSnapshot } from "../types";
import { mergeSnapshots } from "./snapshots";

const success: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74, resetsAt: "2026-07-07T02:00:00Z", windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: "2026-07-10T00:00:00Z", windowSeconds: 604_800 },
  resetCredits: 1,
  updatedAt: "2026-07-07T00:00:00Z",
  status: "ok",
  message: null,
};

describe("snapshot failure handling", () => {
  it("retains the last successful values during a transient failure", () => {
    const failure: ProviderSnapshot = { ...success, shortWindow: null, weeklyWindow: null, status: "unavailable", message: "Network unavailable", updatedAt: "2026-07-07T01:00:00Z" };
    expect(mergeSnapshots([success], [failure])[0]).toEqual({ ...success, status: "stale", message: "Network unavailable" });
  });

  it("shows a failure when no successful snapshot exists", () => {
    const signedOut: ProviderSnapshot = { ...success, shortWindow: null, weeklyWindow: null, status: "signed_out", message: "Please sign in" };
    expect(mergeSnapshots([], [signedOut])[0].status).toBe("signed_out");
  });

  it("does not hide an expired login behind stale quota data", () => {
    const signedOut: ProviderSnapshot = { ...success, shortWindow: null, weeklyWindow: null, status: "signed_out", message: "Please sign in" };
    expect(mergeSnapshots([success], [signedOut])[0].status).toBe("signed_out");
  });

  it("replaces stale data after recovery", () => {
    expect(mergeSnapshots([{ ...success, status: "stale" }], [{ ...success, shortWindow: { ...success.shortWindow!, remainingPercent: 88 } }])[0].shortWindow?.remainingPercent).toBe(88);
  });
  it("retains weekly-only snapshots and their last success across repeated failures", () => {
    const weekly = { ...success, shortWindow: null };
    const failure: ProviderSnapshot = { ...weekly, weeklyWindow: null, status: "unavailable", updatedAt: "2026-07-07T01:00:00Z" };
    const stale = mergeSnapshots([weekly], [failure])[0];
    expect(stale.status).toBe("stale");
    expect(stale.shortWindow).toBeNull();
    expect(stale.weeklyWindow).toEqual(weekly.weeklyWindow);
    expect(stale.updatedAt).toBe(success.updatedAt);
    expect(mergeSnapshots([stale], [{ ...failure, updatedAt: "2026-07-07T02:00:00Z" }])[0].updatedAt).toBe(success.updatedAt);
  });

  it("does not retain invalid or unauthenticated values", () => {
    const failure: ProviderSnapshot = { ...success, shortWindow: null, weeklyWindow: null, status: "unavailable" };
    for (const percent of [NaN, Infinity, -1, 101]) {
      const invalid = { ...success, shortWindow: null, weeklyWindow: { ...success.weeklyWindow!, remainingPercent: percent } };
      expect(mergeSnapshots([invalid], [failure])[0]).toEqual(failure);
    }
    expect(mergeSnapshots([{ ...success, status: "signed_out" }], [failure])[0]).toEqual(failure);
  });

  it("accepts backend stale values with the backend's successful timestamp", () => {
    const old = { ...success, accountGeneration: 1 };
    const authoritative: ProviderSnapshot = { ...old, status: "stale", updatedAt: "2026-07-07T00:30:00Z" };
    expect(mergeSnapshots([old], [authoritative])[0]).toEqual(authoritative);
  });

  it("never borrows cached values across a backend account generation", () => {
    const old = { ...success, accountGeneration: 1 };
    for (const status of ["loading", "unavailable", "signed_out"] as const) {
      const next: ProviderSnapshot = { ...success, shortWindow: null, weeklyWindow: null, accountGeneration: 2, status };
      expect(mergeSnapshots([old], [next])[0]).toEqual(next);
    }
  });

  it("rejects late results from an earlier account and unscoped responses", () => {
    const latest: ProviderSnapshot = { ...success, accountGeneration: 3, shortWindow: null, weeklyWindow: null, status: "signed_out" };
    expect(mergeSnapshots([latest], [{ ...success, accountGeneration: 2 }])[0]).toEqual(latest);
    expect(mergeSnapshots([latest], [success])[0]).toEqual(latest);
  });

  it("does not turn an authoritative empty failure into old values in the same generation", () => {
    const failure: ProviderSnapshot = { ...success, accountGeneration: 2, shortWindow: null, weeklyWindow: null, status: "unavailable" };
    expect(mergeSnapshots([{ ...success, accountGeneration: 2 }], [failure])[0]).toEqual(failure);
  });
});
