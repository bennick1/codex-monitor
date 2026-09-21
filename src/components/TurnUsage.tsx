import { Lightning } from "@phosphor-icons/react";
import type { Language } from "../types";
import type { TurnTokenStatistics } from "../lib/tokenStatistics";
import { formatTokenCount, formatTokenCountExact } from "../lib/tokenFormat";
import { formatDateTime } from "../lib/format";

export function displayEffort(effort: string | null): string {
  if (!effort) return "—";
  const labels: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "xHigh", max: "Max", ultra: "Ultra", minimal: "Minimal", none: "None" };
  return labels[effort] ?? effort;
}

export function TurnUsage({ statistics, language, loading }: { statistics: TurnTokenStatistics | null; language: Language; loading: boolean }) {
  const zh = language === "zh-CN";
  if (loading) return <p className="token-model-placeholder">…</p>;
  if (!statistics) return <p className="token-model-placeholder">{zh ? "当前额度周不可用" : "Current quota week unavailable"}</p>;
  if (!statistics.turns.length) return <p className="token-model-placeholder">{zh ? "当前额度周暂无已完成记录" : "No completed turns in this quota week"}</p>;
  const rows = [...statistics.turns].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  return <div className="token-turn-view" role="table" aria-label={zh ? "额度周 · 当前额度周逐轮明细" : "Quota week · Turn details in current quota week"}>
    <div className="token-turn-header" role="row">
      {(zh ? ["模型", "档位", "Token", "周额度"] : ["Model", "Effort", "Token", "Weekly"]).map(label => <span role="columnheader" key={label}>{label}</span>)}
    </div>
    <div className="token-turn-list" role="rowgroup">
      {rows.map((row, index) => {
        const model = row.model === "unknown" ? (zh ? "未识别模型" : "Unidentified") : row.model;
        const effort = displayEffort(row.effort);
        const fastLabel = row.fastMode === true
          ? (zh ? `档位${row.effort ? ` ${effort}` : "未知"}，极速模式` : `Effort ${row.effort ? effort : "unknown"}, Fast mode`)
          : undefined;
        const exact = formatTokenCountExact(row.tokens);
        const text = formatTokenCount(row.tokens);
        const remaining = row.weeklyRemaining !== null && Number.isFinite(row.weeklyRemaining) && row.weeklyRemaining >= 0 && row.weeklyRemaining <= 100 ? `${row.weeklyRemaining}%` : "—";
        const observation = row.quotaObservedAt ? formatDateTime(row.quotaObservedAt, language) : "—";
        const quotaLabel = remaining === "—"
          ? (zh ? "周额度剩余：无历史观测" : "Weekly remaining: no historical observation")
          : `${zh ? "周额度剩余" : "Weekly remaining"}: ${remaining}`;
        const quotaTooltip = remaining === "—"
          ? (zh ? "该轮完成后无可用的历史周额度观测" : "No historical weekly quota observation is available after this turn")
          : `${zh ? "完成后观测的周额度剩余" : "Weekly remaining observed after completion"}: ${remaining} · ${zh ? "观测" : "Observed"}: ${observation}`;
        return <div className="token-turn-row" role="row" key={index}>
          <span role="cell" className="token-model-name" title={model} tabIndex={0}>{model}</span>
          <span role="cell" className="token-turn-effort" title={fastLabel ?? effort} aria-label={fastLabel}>
            {row.fastMode === true ? <Lightning className="token-turn-fast" size={12} weight="fill" aria-hidden="true" /> : null}
            <span className="token-turn-effort-text">{effort}</span>
          </span>
          <span role="cell" className={`token-value${text.length > 10 ? " token-value--long" : ""}`} tabIndex={0} aria-label={`${model}: ${exact}`}>
            {text}{row.isPartial ? <small aria-hidden="true">*</small> : null}
            <span className="token-exact" role="tooltip">{model}: {exact} · {zh ? "完成" : "Completed"}: {formatDateTime(row.completedAt, language)}</span>
          </span>
          <span role="cell" className="token-turn-quota" tabIndex={0} aria-label={quotaLabel}>
            <span className="token-turn-quota-value">{remaining}</span><span className="token-exact" role="tooltip">{quotaTooltip}</span>
          </span>
        </div>;
      })}
    </div>
  </div>;
}
