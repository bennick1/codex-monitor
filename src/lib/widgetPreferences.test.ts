import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, normalizeOpacityPercent, normalizePreferences } from "./widgetPreferences";
import type { WidgetSkin } from "../types";

describe("widget opacity normalization", () => {
  it.each([
    [undefined, 100], [null, 100], ["80", 100], [true, 100], [{}, 100], [[], 100],
    [Number.NaN, 100], [Number.POSITIVE_INFINITY, 100], [Number.NEGATIVE_INFINITY, 100],
    [-1, 60], [0, 60], [59.9, 60], [60, 60], [62.49, 60], [62.5, 65],
    [79, 80], [80, 80], [97.5, 100], [100, 100], [150, 100],
  ])("normalizes %s to %s without coercing types", (value, expected) => {
    expect(normalizeOpacityPercent(value)).toBe(expected);
  });

  it("upgrades older preferences and keeps every existing preference", () => {
    const old = { locked: true, alwaysOnTop: false, stayExpanded: true, pinnedProvider: "codex" as const,
      autoRotateSeconds: 42, language: "en" as const, appearance: "system" as const, selectedSkin: "computer" as const };
    expect(normalizePreferences(old)).toEqual({ ...DEFAULT_PREFERENCES, ...old, opacityPercent: 100 });
    expect(normalizePreferences({ ...old, opacityPercent: 82 })).toEqual({ ...DEFAULT_PREFERENCES, ...old, opacityPercent: 80 });
    expect(normalizePreferences(DEFAULT_PREFERENCES)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("built-in skin normalization", () => {
  it.each(["default", "blur", "computer", "mecha-light"] as const)("keeps %s and independent preferences", (skin) => {
    const preferences = { ...DEFAULT_PREFERENCES, selectedSkin: skin, appearance: "dark" as const, opacityPercent: 75 };
    expect(normalizePreferences(preferences)).toEqual(preferences);
  });

  it.each([undefined, null, "mecha-dark", "Mecha Light", "unknown", 1])("rejects unsupported skin %s", (skin) => {
    expect(normalizePreferences({ selectedSkin: skin as WidgetSkin }).selectedSkin).toBe("default");
  });
});

describe("merged floating and sidebar preferences", () => {
  it("retains independent opacity, skin, scale, glass and updater choices in both modes", () => {
    const saved = { ...DEFAULT_PREFERENCES, opacityPercent: 75, selectedSkin: "mecha-light" as const,
      sidebarSide: "top" as const, sidebarOpacity: .35, sidebarScale: 1.2,
      sidebarGlassEnabled: false, autoCheckUpdates: false, locked: true };
    expect(normalizePreferences(saved)).toEqual(saved);
    expect(normalizePreferences({ ...saved, displayMode: "sidebar" })).toEqual({ ...saved, displayMode: "sidebar", locked: false });
  });

  it("normalizes malformed sidebar values without affecting floating preferences", () => {
    const result = normalizePreferences({ ...DEFAULT_PREFERENCES, displayMode: "sidebar", opacityPercent: 75,
      sidebarOpacity: Number.NaN, sidebarScale: Number.POSITIVE_INFINITY, selectedSkin: "mecha-light", locked: true });
    expect(result).toMatchObject({ displayMode: "sidebar", sidebarOpacity: .9, sidebarScale: 1,
      opacityPercent: 75, selectedSkin: "mecha-light", locked: false });
    expect(normalizePreferences({ sidebarOpacity: .05, sidebarScale: 3 })).toMatchObject({ sidebarOpacity: .2, sidebarScale: 1.3 });
  });
});
