import type { ProviderSnapshot } from "../types";
import { quotaAvailable } from "./quotaWeek";

export type ExpandedHeightMode = "full" | "compact";
export function expandedHeightMode(snapshot: ProviderSnapshot): ExpandedHeightMode {
  return quotaAvailable(snapshot) && snapshot.shortWindow === null && snapshot.weeklyWindow !== null ? "compact" : "full";
}
