import type { ProviderSnapshot } from "../types";
import { quotaWeekBoundary } from "../lib/quotaWeek";
import { useEffect, useState } from "react";
import { INITIAL_TOKEN_VIEW, TokenStatisticsController } from "../lib/tokenStatisticsController";

export function useTokenStatistics(expanded: boolean, quota?: ProviderSnapshot) {
  const [controller] = useState(() => new TokenStatisticsController());
  const [view, setView] = useState(INITIAL_TOKEN_VIEW);
  const [now, setNow] = useState(Date.now);
  const boundary = quotaWeekBoundary(quota, Math.max(now, Date.now()));
  const reset = boundary?.resetsAt ?? null;
  const seconds = boundary?.windowSeconds ?? null;
  useEffect(() => {
    controller.setQuotaWindow(reset && seconds ? { resetsAt: reset, windowSeconds: seconds } : null);
  }, [controller, reset, seconds]);
  useEffect(() => {
    const deadlines = [Date.parse(quota?.weeklyWindow?.resetsAt ?? "")];
    if (quota?.status === "stale") deadlines.push(Date.parse(quota.updatedAt) + 30 * 60_000 + 1);
    const next = Math.min(...deadlines.filter((time) => time > Date.now()));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(next - Date.now(), 2147483647));
    return () => clearTimeout(timer);
  }, [quota, now]);
  useEffect(() => controller.start(setView), [controller]);
  useEffect(() => controller.setExpanded(expanded), [controller, expanded]);
  return { ...view, refresh: controller.refresh };
}
