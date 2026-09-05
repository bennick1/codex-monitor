import { renderToStaticMarkup } from "react-dom/server";
import { QuotaCard } from "../components/QuotaCard";
import { DESKTOP_PALETTES } from "../lib/desktopPalette";
import { tokenSnapshot, totals } from "./tokenFixtures";
import type { Language, WidgetTheme, ProviderSnapshot } from "../types";
import type { TokenStatisticsSnapshot } from "../lib/tokenStatistics";

export function layoutFixture(language: Language, theme: WidgetTheme, status: TokenStatisticsSnapshot["status"], quotaStatus: ProviderSnapshot["status"], stale: boolean) {
  const snapshot = tokenSnapshot({ status, isStale: stale, today: totals("12685398", true), thisWeek: totals("99999999", true), thisMonth: totals("1300000000", true), total: totals("18446744073709551615", true) });
  return renderToStaticMarkup(<QuotaCard snapshot={{ provider: "codex", displayName: "CODEX", plan: "TEST", shortWindow: { remainingPercent: 74, resetsAt: "2026-09-30T18:30:00Z", windowSeconds: 18000 }, weeklyWindow: { remainingPercent: 42, resetsAt: "2026-10-04T18:30:00Z", windowSeconds: 604800 }, resetCredits: 1, updatedAt: "2026-09-05T00:00:00Z", status: quotaStatus, message: null }} preferences={{ locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null, autoRotateSeconds: 12, language, appearance: theme }} providerCount={1} onPrevious={() => {}} onNext={() => {}} onTogglePin={() => {}} onLock={() => {}} onToggleStayExpanded={() => {}} onDrag={() => {}} onHover={() => {}} onRefresh={() => {}} theme={theme} style={DESKTOP_PALETTES[theme].healthy} tokens={{ snapshot, loading: false, failed: false, listenerFailed: false }} />);
}
