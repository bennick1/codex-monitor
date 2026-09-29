import type { WidgetPreferences, WidgetSkin } from "../types";
import { normalizeLanguage } from "./i18n";

export const DEFAULT_PREFERENCES: WidgetPreferences = { locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN", appearance: "light", selectedSkin: "default", opacityPercent: 100 };

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
});
