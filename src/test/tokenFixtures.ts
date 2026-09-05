import type { TokenStatisticsSnapshot, TokenTotals } from "../lib/tokenStatistics";

/** Entirely synthetic; no local sessions or databases are copied into tests. */
export const totals = (totalTokens: string, isPartial = false): TokenTotals => ({
  inputTokens: "999", cachedInputTokens: "888", outputTokens: "777", reasoningOutputTokens: "666",
  totalTokens, factCount: "1", missingCachedFacts: "0", missingReasoningFacts: "0", isPartial,
});
export const tokenSnapshot = (patch: Partial<TokenStatisticsSnapshot> = {}): TokenStatisticsSnapshot => ({
  schemaVersion: 1, sourceId: "synthetic-source-a", scope: "localCodexHome", generation: "7",
  queryAtUtc: "2026-09-05T15:59:55.000000000Z", timeZone: "Asia/Shanghai",
  todayStartUtc: "2026-09-04T16:00:00.000000000Z", thisWeekStartUtc: "2026-08-30T16:00:00.000000000Z", thisMonthStartUtc: "2026-08-31T16:00:00.000000000Z",
  today: totals("0"), thisWeek: totals("1200"), thisMonth: totals("3450000"), total: totals("9007199254740993"),
  datedTotals: null, undatedTotals: null, timeUncertainTotals: null, futureDeferredTotals: null,
  status: "ready", isStale: false, lastScanAt: "2026-09-05T15:50:00Z", lastSuccessAt: "2026-09-05T15:49:00Z",
  coverage: { discoveredFiles: 1, scannedFiles: 1, failedFiles: 0, retainedMissingFiles: 0, threadsWithUsage: 1, threadsWithoutUsage: 0, earliestUsageAt: null, latestUsageAt: null, readBytes: 0, integrityReadBytes: 0, complete: true },
  quality: { issueCounts: {}, pendingCount: "0", ambiguousCount: "0", futureDeferredCount: "0", warningCodes: [] },
  ...patch,
});
