import type { WidgetPreferences, WidgetSkin } from "../types";
import { normalizeLanguage } from "./i18n";

export const DEFAULT_PREFERENCES: WidgetPreferences = { autoCheckUpdates: true, displayMode: "floating", sidebarSide: "right", sidebarOpacity: 0.9, sidebarGlassEnabled: true, sidebarScale: 1, sidebarShowCodex: true, sidebarShowDeepseek: true, deepseekEnabled: false, locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN", appearance: "light", selectedSkin: "default", opacityPercent: 100 };

export function normalizeOpacityPercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 100;
  return Math.round(Math.min(100, Math.max(60, value)) / 5) * 5;
}

const normalizeSkin = (value: unknown): WidgetSkin => value === "blur" || value === "computer" || value === "mecha-light" ? value : "default";

export const normalizePreferences = (value: Partial<WidgetPreferences>): WidgetPreferences => ({
  ...DEFAULT_PREFERENCES,
  ...value,
  language: normalizeLanguage(value.language),
  selectedSkin: normalizeSkin(value.selectedSkin),
  opacityPercent: normalizeOpacityPercent(value.opacityPercent),
  displayMode: value.displayMode === "sidebar" ? "sidebar" : "floating",
  sidebarSide: value.sidebarSide === "left" || value.sidebarSide === "top" ? value.sidebarSide : "right",
  sidebarShowCodex: value.sidebarShowCodex !== false,
  sidebarShowDeepseek: value.sidebarShowDeepseek !== false,
  autoCheckUpdates: value.autoCheckUpdates !== false,
  sidebarGlassEnabled: value.sidebarGlassEnabled !== false,
  sidebarOpacity: typeof value.sidebarOpacity === "number" && Number.isFinite(value.sidebarOpacity) ? Math.min(1, Math.max(.2, value.sidebarOpacity)) : .9,
  sidebarScale: typeof value.sidebarScale === "number" && Number.isFinite(value.sidebarScale) ? Math.min(1.3, Math.max(.8, value.sidebarScale)) : 1,
  locked: value.displayMode === "sidebar" ? false : value.locked ?? false,
});
