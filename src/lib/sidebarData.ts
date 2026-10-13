import { formatTokenCount, formatTokenCountExact } from "./tokenFormat";
import type { ProviderSnapshot } from "../types";

// Sidebar presentation only; keep all server windows available to the floating widget.
export function sidebarQuotaWindows(snapshot: ProviderSnapshot) {
  const pro = /^pro(?:$|[\s_-]|lite)/i.test(snapshot.plan?.trim() ?? "");
  return [
    ...(!pro && snapshot.shortWindow ? [{ kind: "short" as const, value: snapshot.shortWindow }] : []),
    ...(snapshot.weeklyWindow ? [{ kind: "weekly" as const, value: snapshot.weeklyWindow }] : []),
  ];
}

export interface DailyUsage { date: string; tokens: string }
export interface AccountUsage {
  lifetimeTokens: string | null;
  peakDailyTokens: string | null;
  longestRunningTurnSeconds: number | null;
  currentStreakDays: number | null;
  longestStreakDays: number | null;
  daily: DailyUsage[];
  updatedAt: string;
}
export interface DeepSeekDay { date: string; tokens: string; cost: number }
export interface DeepSeekUsage {
  status: "signed_out" | "loading" | "ok" | "unavailable" | "stale";
  currency: string;
  balance: number | null;
  spent: number | null;
  tokens: string | null;
  cost: number | null;
  requests: string | null;
  apiKeys: number | null;
  timeZoneSeconds: number;
  daily: DeepSeekDay[];
  updatedAt: string | null;
}
export const EMPTY_DEEPSEEK: DeepSeekUsage = { status: "signed_out", currency: "CNY", balance: null, spent: null, tokens: null, cost: null, requests: null, apiKeys: null, timeZoneSeconds: 0, daily: [], updatedAt: null };

export function remainingFunds(usage: DeepSeekUsage): number | null {
  const { balance, spent } = usage;
  if (balance === null || spent === null || !Number.isFinite(balance) || !Number.isFinite(spent) || balance < 0 || spent < 0 || balance + spent <= 0) return null;
  return balance / (balance + spent) * 100;
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function accountDays(usage: AccountUsage, now: Date): { date: string; tokens: string | null }[] {
  const byDate = new Map(usage.daily.map(day => [day.date, day.tokens]));
  return Array.from({ length: 30 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29 + i);
    const key = dayKey(date);
    return { date: key, tokens: byDate.get(key) ?? null };
  });
}

export function sumTokens(values: (string | null)[]): string {
  return values.reduce<bigint>((sum, value) => sum + (value && /^\d+$/.test(value) ? BigInt(value) : 0n), 0n).toString();
}
export function durationText(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
export { formatTokenCount, formatTokenCountExact };

export function formatMoney(value: number | null, locale: string, currency: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  const unit = 10 ** -(formatter.resolvedOptions().maximumFractionDigits ?? 2);
  return value > 0 && value < unit ? `<${formatter.format(unit)}` : formatter.format(value);
}
