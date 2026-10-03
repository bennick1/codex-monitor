import type { ProviderSnapshot } from "../types";
import { quotaAvailable } from "./quotaWeek";
import type { SidebarPhase } from "./bridge";

export type ExpandedHeightMode = "full" | "compact";
export function expandedHeightMode(snapshot: ProviderSnapshot): ExpandedHeightMode {
  return quotaAvailable(snapshot) && snapshot.shortWindow === null && snapshot.weeklyWindow !== null ? "compact" : "full";
}

export interface SidebarInputRect { x: number; y: number; width: number; height: number }

// Resting layout bounds, independent of the CSS entrance/exit transforms.
export function sidebarInputRegions(width: number, height: number, side: "left" | "right" | "top", phase: SidebarPhase,
  dockHeight: number, panelSize?: { width: number; height: number }, scale = 1): SidebarInputRect[] {
  const edge = (size: number) => side === "left" ? 0 : width - size;
  const dockWidth = 60 * scale;
  const dockSize = dockHeight * scale;
  const dockTop = (height - dockSize) / 2;
  const panelOffset = dockWidth + 12;
  const horizontal = side === "top";
  const dockLeft = (width - dockSize) / 2;
  const regions: SidebarInputRect[] = phase === "handle"
    ? [horizontal
      ? { x: (width - 56 * scale) / 2, y: 0, width: 56 * scale, height: 8 * scale }
      : { x: edge(8 * scale), y: (height - 56 * scale) / 2, width: 8 * scale, height: 56 * scale }]
    : [horizontal
      ? { x: dockLeft - 54 * scale, y: 0, width: dockSize + 108 * scale, height: dockWidth }
      : { x: edge(dockWidth), y: dockTop - 54 * scale, width: dockWidth, height: dockSize + 108 * scale }];
  if ((phase === "detail" || phase === "menu") && panelSize && panelSize.width > 0 && panelSize.height > 0) {
    const panel = { x: horizontal ? (width - panelSize.width) / 2 : side === "left" ? panelOffset : width - panelOffset - panelSize.width,
      y: horizontal ? panelOffset : (height - panelSize.height) / 2, ...panelSize };
    regions.push(panel);
    if (phase === "detail") {
      if (horizontal) {
        const left = Math.max(dockLeft, panel.x);
        regions.push({ x: left, y: dockWidth, width: Math.min(dockLeft + dockSize, panel.x + panel.width) - left, height: 12 });
      } else {
        const top = Math.max(dockTop, panel.y);
        regions.push({ x: side === "left" ? dockWidth : width - panelOffset, y: top, width: 12,
          height: Math.min(dockTop + dockSize, panel.y + panel.height) - top });
      }
    }
  }
  return regions.map(rect => {
    const x = Math.max(0, rect.x); const y = Math.max(0, rect.y);
    return { x, y, width: Math.min(width, rect.x + rect.width) - x, height: Math.min(height, rect.y + rect.height) - y };
  }).filter(rect => rect.width > 0 && rect.height > 0);
}
