import type { WidgetTheme } from "../types";

export type SidebarGlassStatus = "active" | "disabled" | "unsupported" | "reducedTransparency" | "unavailable";
export interface GlassPathCommand {
  op: "move" | "line" | "curve" | "close";
  x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number;
}
export interface SidebarGlassRegion {
  id: "rail" | "panel" | "direction" | "gear";
  x: number; y: number; width: number; height: number; opacity: number;
  path: GlassPathCommand[];
}
export interface SidebarGlassFrame {
  sequence: number; width: number; height: number; theme: WidgetTheme; enabled: boolean;
  regions: SidebarGlassRegion[];
}
export type SidebarGlassSnapshot = Omit<SidebarGlassFrame, "sequence">;
export interface SidebarGlassOptions {
  theme: WidgetTheme; enabled: boolean; side: "left" | "right" | "top"; dockHeight: number; surfaceOpacity: number;
}

const KAPPA = 0.5522847498307936;
const move = (x: number, y: number): GlassPathCommand => ({ op: "move", x, y });
const line = (x: number, y: number): GlassPathCommand => ({ op: "line", x, y });
const curve = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): GlassPathCommand => ({ op: "curve", x1, y1, x2, y2, x, y });

/** The same four quarter circles as the sidebar SVG, in region-local coordinates. */
export function sidebarRailGlassPath(side: SidebarGlassOptions["side"], height: number): GlassPathCommand[] {
  const k30 = 30 * KAPPA; const k28 = 28 * KAPPA;
  const source = [move(60, -30), curve(60, -30 + k30, 30 + k30, 0, 30, 0), line(28, 0),
    curve(28 - k28, 0, 0, 28 - k28, 0, 28), line(0, height - 28),
    curve(0, height - 28 + k28, 28 - k28, height, 28, height), line(30, height),
    curve(30 + k30, height, 60, height + 30 - k30, 60, height + 30), { op: "close" } as GlassPathCommand];
  const point = (x: number, y: number) => side === "top"
    ? [(y + 30) / (height + 60), (60 - x) / 60]
    : [side === "left" ? 1 - x / 60 : x / 60, (y + 30) / (height + 60)];
  return source.map(command => {
    const result = { ...command };
    if (command.x !== undefined && command.y !== undefined) [result.x, result.y] = point(command.x, command.y);
    if (command.x1 !== undefined && command.y1 !== undefined) [result.x1, result.y1] = point(command.x1, command.y1);
    if (command.x2 !== undefined && command.y2 !== undefined) [result.x2, result.y2] = point(command.x2, command.y2);
    return result;
  });
}

export function roundedGlassPath(width: number, height: number, radius: number): GlassPathCommand[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const x = r / width; const y = r / height; const kx = x * KAPPA; const ky = y * KAPPA;
  return [move(x, 0), line(1 - x, 0), curve(1 - x + kx, 0, 1, y - ky, 1, y), line(1, 1 - y),
    curve(1, 1 - y + ky, 1 - x + kx, 1, 1 - x, 1), line(x, 1),
    curve(x - kx, 1, 0, 1 - y + ky, 0, 1 - y), line(0, y), curve(0, y - ky, x - kx, 0, x, 0), { op: "close" }];
}

function opacityOf(element: Element): number {
  const value = Number.parseFloat(getComputedStyle(element).opacity);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

/** Read both legacy rgba() and CSS Color 4 serialization during fill transitions. */
export function glassColorAlpha(color: string): number {
  if (!color || color === "transparent" || color === "none") return 0;
  const alpha = color.includes("/") ? color.split("/").at(-1)?.replace(")", "").trim()
    : /^rgba?\(/.test(color) && color.split(",").length === 4 ? color.split(",")[3].replace(")", "").trim() : undefined;
  if (alpha === undefined) return 1;
  const value = Number.parseFloat(alpha) / (alpha.endsWith("%") ? 100 : 1);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function sampleSidebarGlass(root: HTMLElement, options: SidebarGlassOptions): SidebarGlassSnapshot {
  const snapshot: SidebarGlassSnapshot = { width: window.innerWidth, height: window.innerHeight, theme: options.theme, enabled: options.enabled, regions: [] };
  if (!options.enabled) return snapshot;
  const add = (id: SidebarGlassRegion["id"], element: Element | null, opacity: number, path: (width: number, height: number) => GlassPathCommand[]) => {
    if (!element || opacity <= .001 || getComputedStyle(element).visibility === "hidden") return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    snapshot.regions.push({ id, x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity, path: path(rect.width, rect.height) });
  };
  const dock = root.querySelector(".sidebar-dock");
  const dockOpacity = dock ? opacityOf(dock) : 0;
  add("rail", root.querySelector(".sidebar-silhouette"), dockOpacity, () => sidebarRailGlassPath(options.side, options.dockHeight));
  const panel = root.querySelector<HTMLElement>(".sidebar-panel");
  // Hidden details stay mounted to reverse their exit without a fresh WebView paint.
  add("panel", panel, panel ? opacityOf(panel) : 0, (width, height) => {
    const radius = Number.parseFloat(getComputedStyle(panel!).borderTopLeftRadius) || 20;
    const visualScale = panel!.offsetWidth ? width / panel!.offsetWidth : 1;
    return roundedGlassPath(width, height, radius * visualScale);
  });
  for (const id of ["direction", "gear"] as const) {
    const circle = root.querySelector(`.sidebar-${id} .sidebar-action-arc circle`);
    const alpha = circle ? glassColorAlpha(getComputedStyle(circle).fill) : 0;
    const reveal = Math.min(1, alpha / Math.max(.01, options.surfaceOpacity));
    add(id, circle, dockOpacity * reveal, (width, height) => roundedGlassPath(width, height, Math.min(width, height) / 2));
  }
  return snapshot;
}

// Shared across mounts so a late reply/clear from an old sidebar cannot replace a new frame.
let glassSequence = Date.now() * 1000;
export function createSidebarGlassQueue(send: (frame: SidebarGlassFrame) => Promise<SidebarGlassStatus>, onStatus: (status: SidebarGlassStatus) => void) {
  let pending: SidebarGlassFrame | null = null;
  let busy = false; let disposed = false; let latest = 0; let signature = "";
  const drain = async () => {
    if (busy) return;
    busy = true;
    while (pending) {
      const frame: SidebarGlassFrame = pending; pending = null;
      let status: SidebarGlassStatus;
      try { status = await send(frame); } catch { status = "unavailable"; }
      if (!disposed && latest === frame.sequence) onStatus(status);
    }
    busy = false;
  };
  const push = (snapshot: SidebarGlassSnapshot, force = false) => {
    const nextSignature = JSON.stringify(snapshot);
    if (!force && signature === nextSignature) return;
    signature = nextSignature;
    latest = ++glassSequence;
    pending = { ...snapshot, sequence: latest };
    void drain();
  };
  return {
    push(snapshot: SidebarGlassSnapshot, force = false) { if (!disposed) push(snapshot, force); },
    dispose(snapshot: SidebarGlassSnapshot) {
      disposed = true;
      push({ ...snapshot, enabled: false, regions: [] }, true);
    },
  };
}
