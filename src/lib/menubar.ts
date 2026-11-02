import type { Language, ProviderSnapshot, UsageWindow } from "../types";

export function validQuotaWindow(value: UsageWindow | null | undefined): value is UsageWindow {
  return !!value && Number.isFinite(value.remainingPercent) && value.remainingPercent >= 0
    && value.remainingPercent <= 100 && Number.isFinite(value.windowSeconds) && value.windowSeconds >= 0;
}

export function quotaPeriodLabel(window: UsageWindow, language: Language, compact = false): string {
  const zh = language === "zh-CN";
  const seconds = window.windowSeconds;
  if (seconds === 0) return zh ? (compact ? "周期" : "周期额度") : (compact ? "Quota" : "Quota period");
  if (seconds === 604_800) return zh ? (compact ? "周" : "每周额度") : (compact ? "W" : "Weekly quota");
  if (seconds % 86_400 === 0) return zh ? `${seconds / 86_400} 天${compact ? "" : "额度"}` : `${seconds / 86_400}${compact ? "d" : "-day quota"}`;
  if (seconds % 3600 === 0) return zh ? `${seconds / 3600} 小时${compact ? "" : "额度"}` : `${seconds / 3600}${compact ? "h" : "-hour quota"}`;
  if (seconds % 60 === 0) return zh ? `${seconds / 60} 分钟${compact ? "" : "额度"}` : `${seconds / 60}${compact ? "m" : "-minute quota"}`;
  return zh ? `${seconds} 秒${compact ? "" : "额度"}` : `${seconds}${compact ? "s" : "-second quota"}`;
}

export function quotaWindows(snapshot: ProviderSnapshot) {
  return [
    ...(validQuotaWindow(snapshot.shortWindow) ? [{ kind: "short" as const, value: snapshot.shortWindow }] : []),
    ...(validQuotaWindow(snapshot.weeklyWindow) ? [{ kind: "weekly" as const, value: snapshot.weeklyWindow }] : []),
  ];
}
