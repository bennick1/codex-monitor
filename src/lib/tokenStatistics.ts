/** Exact decimal integers. Never convert token counters to JavaScript Number. */
export type TokenInteger = string;

export interface TokenTotals {
  inputTokens: TokenInteger;
  cachedInputTokens: TokenInteger | null;
  outputTokens: TokenInteger;
  reasoningOutputTokens: TokenInteger | null;
  totalTokens: TokenInteger;
  factCount: TokenInteger;
  missingCachedFacts: TokenInteger;
  missingReasoningFacts: TokenInteger;
  isPartial: boolean;
}

export type TokenPeriod = "today" | "thisWeek" | "thisMonth" | "total";

export interface ModelTokenUsage {
  model: string;
  tokens: TokenInteger;
  /** Percentage of this period's collected tokens, independent of quota. */
  share: number;
}

export interface ModelTokenPeriod {
  totalTokens: TokenInteger;
  models: ModelTokenUsage[];
}

export interface ModelTokenStatistics {
  periods: Record<TokenPeriod, ModelTokenPeriod>;
}

export interface TokenStatisticsSnapshot {
  schemaVersion: number;
  generation: TokenInteger;
  scope: "localCodexHome";
  /** Opaque backend source key; never a filesystem path. */
  sourceId: string | null;
  queryAtUtc: string;
  timeZone: string | null;
  todayStartUtc: string | null;
  thisWeekStartUtc: string | null;
  thisMonthStartUtc: string | null;
  today: TokenTotals | null;
  thisWeek: TokenTotals | null;
  thisMonth: TokenTotals | null;
  total: TokenTotals | null;
  modelStatistics: ModelTokenStatistics | null;
  datedTotals: TokenTotals | null;
  undatedTotals: TokenTotals | null;
  timeUncertainTotals: TokenTotals | null;
  futureDeferredTotals: TokenTotals | null;
  status: "scanning" | "ready" | "empty" | "partial" | "unavailable";
  isStale: boolean;
  lastScanAt: string | null;
  lastSuccessAt: string | null;
  coverage: {
    discoveredFiles: number;
    scannedFiles: number;
    failedFiles: number;
    retainedMissingFiles: number;
    threadsWithUsage: number;
    threadsWithoutUsage: number;
    earliestUsageAt: string | null;
    latestUsageAt: string | null;
    readBytes: number;
    integrityReadBytes: number;
    complete: boolean;
  };
  quality: {
    issueCounts: Record<string, TokenInteger>;
    pendingCount: TokenInteger;
    ambiguousCount: TokenInteger;
    futureDeferredCount: TokenInteger;
    warningCodes: string[];
  };
}

/** A commit/status notification: re-query to obtain a fresh common Q and timezone. */
export interface TokenStatisticsNotification {
  schemaVersion: number;
  sourceId: string | null;
  generation: TokenInteger;
  scanning: boolean;
}

export interface TokenStatisticsRefresh {
  queued: boolean;
  scanning: boolean;
  generation: TokenInteger;
}
