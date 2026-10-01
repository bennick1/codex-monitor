import type { ProviderSnapshot } from "../types";
import { quotaAvailable } from "./quotaWeek";
import type { SidebarPhase } from "./bridge";

export type ExpandedHeightMode = "full" | "compact";
export function expandedHeightMode(snapshot: ProviderSnapshot): ExpandedHeightMode {
  return quotaAvailable(snapshot) && snapshot.shortWindow === null && snapshot.weeklyWindow !== null ? "compact" : "full";
}

export interface SidebarInputRect { x: number; y: number; width: number; height: number }

// Resting layout bounds, independent of the CSS entrance/exit transforms.
export function sidebarInputRegions(width: number, height: number, side: "left" | "right", phase: SidebarPhase,
  dockHeight: number, panelSize?: { width: number; height: number }): SidebarInputRect[] {
  const edge = (size: number) => side === "left" ? 0 : width - size;
  const dockTop = (height - dockHeight) / 2;
  const regions: SidebarInputRect[] = phase === "handle"
    ? [{ x: edge(8), y: (height - 56) / 2, width: 8, height: 56 }]
    : [{ x: edge(60), y: dockTop - 30, width: 60, height: dockHeight + 84 }];
  if ((phase === "detail" || phase === "menu") && panelSize && panelSize.width > 0 && panelSize.height > 0) {
    const panel = { x: side === "left" ? 72 : width - 72 - panelSize.width,
      y: (height - panelSize.height) / 2, ...panelSize };
    regions.push(panel);
    if (phase === "detail") {
      const top = Math.max(dockTop, panel.y);
      regions.push({ x: side === "left" ? 60 : width - 72, y: top, width: 12,
        height: Math.min(dockTop + dockHeight, panel.y + panel.height) - top });
    }
  }
  return regions.map(rect => {
    const x = Math.max(0, rect.x); const y = Math.max(0, rect.y);
    return { x, y, width: Math.min(width, rect.x + rect.width) - x, height: Math.min(height, rect.y + rect.height) - y };
  }).filter(rect => rect.width > 0 && rect.height > 0);
}
