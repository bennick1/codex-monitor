import { expect, it } from 'vitest';
import { expandedHeightMode, sidebarInputRegions, type SidebarInputRect } from './widgetGeometry';
import type { ProviderSnapshot } from '../types';
const snapshot:ProviderSnapshot={provider:'codex',displayName:'CODEX',plan:null,shortWindow:null,weeklyWindow:{remainingPercent:50,resetsAt:null,windowSeconds:604800},resetCredits:null,updatedAt:new Date().toISOString(),status:'ok',message:null};
it('uses compact only for displayable weekly-only providers',()=>{
 expect(expandedHeightMode(snapshot)).toBe('compact');
 for(const status of ['signed_out','unavailable','loading'] as const) expect(expandedHeightMode({...snapshot,status})).toBe('full');
 expect(expandedHeightMode({...snapshot,weeklyWindow:null})).toBe('full');
 expect(expandedHeightMode({...snapshot,shortWindow:{remainingPercent:70,resetsAt:null,windowSeconds:18000}})).toBe('full');
 expect(expandedHeightMode({...snapshot,status:'stale'})).toBe('compact');
 expect(expandedHeightMode({...snapshot,status:'stale',updatedAt:'2000-01-01T00:00:00Z'})).toBe('full');
});

const hits = (regions: SidebarInputRect[], x: number, y: number) => regions.some(rect => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);

it.each(["left", "right"] as const)("limits the fixed %s canvas input to the handle, dock, visible panel and crossing corridor", side => {
  const mirror = (x: number) => side === "left" ? x : 376 - x;
  const handle = sidebarInputRegions(376, 580, side, "handle", 180, { width: 272, height: 400 });
  expect(hits(handle, mirror(4), 290)).toBe(true);
  expect(hits(handle, mirror(30), 290)).toBe(false);
  expect(hits(handle, mirror(4), 100)).toBe(false);
  const rail = sidebarInputRegions(376, 580, side, "rail", 180, { width: 272, height: 400 });
  expect(hits(rail, mirror(30), 240)).toBe(true);
  expect(hits(rail, mirror(30), 410)).toBe(true); // gear
  expect(hits(rail, mirror(30), 100)).toBe(false); // top margin
  expect(hits(rail, mirror(150), 290)).toBe(false); // hidden cached detail
  const detail = sidebarInputRegions(376, 580, side, "detail", 180, { width: 272, height: 400 });
  expect(hits(detail, mirror(150), 290)).toBe(true);
  expect(hits(detail, mirror(66), 290)).toBe(true); // 12px crossing gap
  expect(hits(detail, mirror(66), 420)).toBe(false);
  expect(hits(detail, mirror(150), 530)).toBe(false); // below the card
  const menu = sidebarInputRegions(376, 580, side, "menu", 180, { width: 304, height: 560 });
  expect(hits(menu, mirror(100), 550)).toBe(true);
  expect(hits(menu, mirror(66), 290)).toBe(false); // outside-menu clicks pass through
});

it("keeps the empty dock gear reachable and clips regions to small work areas", () => {
  const empty = sidebarInputRegions(376, 580, "left", "rail", 60);
  expect(hits(empty, 30, 290)).toBe(true);
  const clipped = sidebarInputRegions(180, 180, "right", "detail", 180, { width: 108, height: 168 });
  expect(clipped.length).toBeGreaterThan(0);
  expect(clipped.every(rect => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 180 && rect.y + rect.height <= 180)).toBe(true);
});
