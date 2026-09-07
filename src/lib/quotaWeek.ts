import type { ProviderSnapshot } from "../types";
import type { QuotaWindowBoundary } from "./tokenStatistics";

/** Shared with the quota card: retain stale quota for at most 30 minutes. */
export function quotaAvailable(snapshot: ProviderSnapshot, now = Date.now()): boolean {
  return snapshot.status === "ok" || (snapshot.status === "stale"
    && !(now - Date.parse(snapshot.updatedAt) > 30 * 60_000));
}

export function quotaWeekBoundary(snapshot: ProviderSnapshot | undefined, now = Date.now()): QuotaWindowBoundary | null {
  const window = snapshot?.weeklyWindow;
  if (!snapshot || !quotaAvailable(snapshot, now) || !window?.resetsAt || window.windowSeconds !== 604800) return null;
  if (snapshot.status === "stale" && !Number.isFinite(Date.parse(snapshot.updatedAt))) return null;
  const reset = Date.parse(window.resetsAt);
  if (!Number.isFinite(reset) || now >= reset || now < reset - window.windowSeconds * 1000) return null;
  return { resetsAt: window.resetsAt, windowSeconds: window.windowSeconds };
}
