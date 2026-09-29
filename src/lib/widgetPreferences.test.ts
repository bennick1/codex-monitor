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
    expect(normalizePreferences(old)).toEqual({ ...old, opacityPercent: 100 });
    expect(normalizePreferences({ ...old, opacityPercent: 82 })).toEqual({ ...old, opacityPercent: 80 });
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
