import type { ProviderSnapshot, UsageWindow } from "../types";

const validWindow = (window: UsageWindow | null): boolean => window !== null
  && Number.isFinite(window.remainingPercent) && window.remainingPercent >= 0 && window.remainingPercent <= 100;

export function mergeSnapshots(current: ProviderSnapshot[], incoming: ProviderSnapshot[]): ProviderSnapshot[] {
  return incoming.map((next) => {
    const previous = current.find((item) => item.provider === next.provider);
    // Native snapshots already include the single backend service's account
    // boundary and stale policy. Never reconstruct values it deliberately
    // cleared, or let a late response overwrite a newer login's snapshot.
    if (next.accountGeneration !== undefined) {
      return previous?.accountGeneration !== undefined && previous.accountGeneration > next.accountGeneration
        ? previous : next;
    }
    if (previous?.accountGeneration !== undefined) return previous;
    if (next.status === "ok" || next.status === "signed_out" || next.status === "loading") return next;
    return previous && (previous.status === "ok" || previous.status === "stale")
      && (validWindow(previous.shortWindow) || validWindow(previous.weeklyWindow))
      ? { ...previous, status: "stale", message: next.message, updatedAt: previous.updatedAt }
      : next;
  });
}
