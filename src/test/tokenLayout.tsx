import { createRoot } from "react-dom/client";
import { QuotaCard, QuotaOrb } from "../components/QuotaCard";
import { DESKTOP_PALETTES, type DesktopPaletteName } from "../lib/desktopPalette";
import { tokenSnapshot, totals } from "./tokenFixtures";
import type { Language, ProviderSnapshot, WidgetSkin, WidgetTheme } from "../types";
import type { ModelTokenUsage, TokenStatisticsSnapshot } from "../lib/tokenStatistics";
import "../styles.css";

export interface TokenLayoutFixtureOptions {
  view: "card" | "orb";
  language: Language;
  theme: WidgetTheme;
  skin: WidgetSkin;
  tokenStatus: TokenStatisticsSnapshot["status"];
  quotaStatus: ProviderSnapshot["status"];
  stale: boolean;
  mode: "overview" | "models";
  orbState?: "healthy" | "caution" | "critical" | "stale" | "unavailable" | "signed_out";
}

declare global {
  interface Window {
    __renderTokenFixture?: (options: TokenLayoutFixtureOptions) => Promise<void>;
  }
}

const modelRows: ModelTokenUsage[] = [
  { model: "gpt-synthetic-model-with-an-intentionally-very-long-slug-for-overflow", tokens: "18446744073709551615", share: 44.4 },
  ...Array.from({ length: 10 }, (_, index) => ({
    model: `gpt-synthetic-${String(index + 1).padStart(2, "0")}`,
    tokens: `${9007199254740900 - index * 101}`,
    share: 5.05,
  })),
  { model: "unknown", tokens: "12345678901234567890", share: 5.1 },
];

function stressedTokenSnapshot(status: TokenStatisticsSnapshot["status"], stale: boolean): TokenStatisticsSnapshot {
  const period = { totalTokens: "18446744073709551615", models: modelRows };
  return tokenSnapshot({
    status,
    isStale: stale,
    today: totals("12685398", status === "partial"),
    thisWeek: totals("99999999", status === "partial"),
    thisMonth: totals("1300000000", status === "partial"),
    total: totals("18446744073709551615", status === "partial"),
    modelStatistics: { periods: {
      today: period,
      quotaPeriod: period,
      last7Days: period,
      last30Days: period,
      total: period,
    } },
  });
}

function quotaSnapshot(status: ProviderSnapshot["status"], percent = 74): ProviderSnapshot {
  return {
    provider: "codex",
    displayName: "CODEX",
    plan: "SYNTHETIC",
    shortWindow: { remainingPercent: percent, resetsAt: "2026-09-30T18:30:00Z", windowSeconds: 18_000 },
    weeklyWindow: { remainingPercent: 42, resetsAt: "2026-10-04T18:30:00Z", windowSeconds: 604_800 },
    resetCredits: 1,
    resetCreditExpiresAt: ["2026-10-01T18:30:00Z"],
    updatedAt: new Date().toISOString(),
    status,
    message: status === "ok" ? null : "Synthetic local-only status message for visual validation.",
  };
}

function paletteName(snapshot: ProviderSnapshot, percent: number): DesktopPaletteName {
  if (snapshot.status !== "ok") return snapshot.status === "loading" ? "unavailable" : snapshot.status;
  if (percent <= 15) return "critical";
  if (percent <= 40) return "caution";
  return "healthy";
}

const rootNode = document.getElementById("root");
if (!rootNode) throw new Error("token layout fixture root is missing");
const root = createRoot(rootNode);
let renderKey = 0;
const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

window.__renderTokenFixture = async (options) => {
  renderKey += 1;
  if (options.view === "orb") {
    const state = options.orbState ?? "healthy";
    const percent = state === "critical" ? 8 : state === "caution" ? 35 : 74;
    const status = state === "healthy" || state === "caution" || state === "critical" ? "ok" : state;
    const snapshot = quotaSnapshot(status, percent);
    root.render(<QuotaOrb key={renderKey} snapshot={snapshot} language={options.language} theme={options.theme}
      skin={options.skin} style={DESKTOP_PALETTES[options.theme][paletteName(snapshot, percent)]}
      onDrag={() => {}} onHover={() => {}} />);
    await settle();
    return;
  }

  const snapshot = quotaSnapshot(options.quotaStatus);
  root.render(<QuotaCard key={renderKey} snapshot={snapshot}
    preferences={{ locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null,
      autoRotateSeconds: 12, language: options.language, appearance: options.theme, selectedSkin: options.skin }}
    providerCount={1} onPrevious={() => {}} onNext={() => {}} onTogglePin={() => {}}
    onLock={() => {}} onToggleStayExpanded={() => {}} onDrag={() => {}} onHover={() => {}} onRefresh={() => {}}
    theme={options.theme} skin={options.skin} style={DESKTOP_PALETTES[options.theme][paletteName(snapshot, 74)]}
    tokens={{ snapshot: stressedTokenSnapshot(options.tokenStatus, options.stale), loading: false, failed: false, listenerFailed: false }} />);
  await settle();
  if (options.mode === "models") {
    const buttons = document.querySelectorAll<HTMLButtonElement>(".token-heading .token-switch button");
    buttons.item(1).click();
    await settle();
  }
};

document.documentElement.dataset.fixtureReady = "true";
