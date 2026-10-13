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
  expect(hits(rail, mirror(30), 160)).toBe(true); // direction arc/button
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

it.each([.6, .8, 1.3])("scales the dock while retaining panel dimensions and the crossing gap at scale %s", scale => {
  for (const side of ["left", "right"] as const) {
    const width = 316 + 60 * scale;
    const x = (value: number) => side === "left" ? value : width - value;
    const regions = sidebarInputRegions(width, 580, side, "detail", 180, { width: 272, height: 400 }, scale);
    expect(regions[0].width).toBeCloseTo(60 * scale);
    expect(regions[1]).toMatchObject({ width: 272, height: 400, y: 90 });
    expect(regions[2].width).toBeCloseTo(12);
    expect(hits(regions, x(30 * scale), 290)).toBe(true);
    expect(hits(regions, x(60 * scale + 6), 290)).toBe(true);
    expect(hits(regions, x(60 * scale + 150), 480)).toBe(true);
    expect(hits(regions, x(60 * scale + 150), 500)).toBe(false);
    expect(hits(regions, x(30 * scale), 100)).toBe(false);
    const menu = sidebarInputRegions(width, 580, side, "menu", 180, { width: 304, height: 560 }, scale);
    expect(menu[1]).toMatchObject({ width: 304, height: 560, y: 10 });
    expect(hits(menu, x(60 * scale + 6), 290)).toBe(false);
    const handle = sidebarInputRegions(width, 580, side, "handle", 180, undefined, scale);
    expect(hits(handle, x(4 * scale), 290)).toBe(true);
    expect(hits(handle, x(20 * scale), 290)).toBe(false);
  }
});

it.each([.8, 1, 1.3])("keeps top docking controls and downward detail reachable at scale %s", scale => {
  const width = Math.max(304, 288 * scale);
  const height = 60 * scale + 12 + 580;
  const center = width / 2;
  const handle = sidebarInputRegions(width, height, "top", "handle", 180, undefined, scale);
  expect(hits(handle, center, 4 * scale)).toBe(true);
  expect(hits(handle, center + 40 * scale, 4 * scale)).toBe(false);
  expect(hits(handle, center, 100)).toBe(false);
  const rail = sidebarInputRegions(width, height, "top", "rail", 180, undefined, scale);
  for (const dx of [-120, 0, 120]) expect(hits(rail, center + dx * scale, 30 * scale)).toBe(true);
  expect(hits(rail, center, 60 * scale + 6)).toBe(false);
  const detail = sidebarInputRegions(width, height, "top", "detail", 180, { width: 272, height: 400 }, scale);
  expect(detail[1]).toEqual({ x: center - 136, y: 60 * scale + 12, width: 272, height: 400 });
  expect(detail[2].height).toBe(12);
  expect(hits(detail, center, 60 * scale + 6)).toBe(true);
  expect(hits(detail, center + 120 * scale, 60 * scale + 6)).toBe(false);
  expect(hits(detail, center, height - 20)).toBe(false);
  const menu = sidebarInputRegions(width, height, "top", "menu", 180, { width: 304, height: 560 }, scale);
  expect(menu[1].width).toBe(304);
  expect(hits(menu, center, 60 * scale + 6)).toBe(false);
});

it("keeps both top shortcuts reachable with zero or one provider and clips to a narrow screen", () => {
  for (const length of [60, 98, 180]) {
    const rail = sidebarInputRegions(304, 652, "top", "rail", length);
    expect(hits(rail, 152 - length / 2 - 30, 30)).toBe(true);
    expect(hits(rail, 152 + length / 2 + 30, 30)).toBe(true);
  }
  const regions = sidebarInputRegions(170, 160, "top", "detail", 180, { width: 170, height: 82 }, .8);
  expect(regions.every(rect => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 170 && rect.y + rect.height <= 160)).toBe(true);
});
