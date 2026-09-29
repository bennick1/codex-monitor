import type { ProviderSnapshot } from "../types";
import { MECHA_PALETTES } from "./desktopPalette";

export function mechaPercent(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** Raw quota, before display rounding. Existing skins retain their own boundaries. */
export function mechaTier(snapshot: ProviderSnapshot): keyof typeof MECHA_PALETTES {
  if (snapshot.status !== "ok") return "unknown";
  const percent = mechaPercent(snapshot.shortWindow?.remainingPercent)
    ?? mechaPercent(snapshot.weeklyWindow?.remainingPercent);
  if (percent === null) return "unknown";
  return percent > 50 ? "healthy" : percent > 10 ? "caution" : "critical";
}

export function mechaPalette(snapshot: ProviderSnapshot) {
  return MECHA_PALETTES[mechaTier(snapshot)];
}
