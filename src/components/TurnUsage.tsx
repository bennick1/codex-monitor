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
  if (!statistics.turns.length) return <p className="token-model-placeholder">{zh ? "当前额度周暂无可用记录" : "No observed turns in this quota week"}</p>;
  const rows = [...statistics.turns].sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
  return <div className="token-turn-view" role="table" aria-label={zh ? "额度周 · 当前额度周逐轮明细" : "Quota week · Turn details in current quota week"}>
    <div className="token-turn-header" role="row">
      {(zh ? ["模型", "档位", "Token", "周额度"] : ["Model", "Effort", "Token", "Weekly"]).map(label => <span role="columnheader" key={label}>{label}</span>)}
    </div>
    <div className="token-turn-list" role="rowgroup">
      {rows.map((row, index) => {
        const model = row.model === "unknown" ? (zh ? "未识别模型" : "Unidentified") : row.model;
        const exact = formatTokenCountExact(row.tokens);
        const text = formatTokenCount(row.tokens);
        const remaining = row.weeklyRemaining !== null && Number.isFinite(row.weeklyRemaining) && row.weeklyRemaining >= 0 && row.weeklyRemaining <= 100 ? `${row.weeklyRemaining}%` : "—";
        const observation = row.quotaObservedAt ? formatDateTime(row.quotaObservedAt, language) : "—";
        return <div className="token-turn-row" role="row" key={index}>
          <span role="cell" className="token-model-name" title={model} tabIndex={0}>{model}</span>
          <span role="cell" className="token-turn-effort" title={displayEffort(row.effort)}>{displayEffort(row.effort)}</span>
          <span role="cell" className={`token-value${text.length > 10 ? " token-value--long" : ""}`} tabIndex={0} aria-label={`${model}: ${exact}`}>
            {text}{row.isPartial ? <small aria-hidden="true">*</small> : null}
            <span className="token-exact" role="tooltip">{model}: {exact} · {zh ? "完成" : "Completed"}: {formatDateTime(row.completedAt, language)}</span>
          </span>
          <span role="cell" className="token-turn-quota" tabIndex={0} aria-label={`${zh ? "周额度剩余" : "Weekly remaining"}: ${remaining}`}>
            <span className="token-turn-quota-value">{remaining}</span><span className="token-exact" role="tooltip">{zh ? "完成后观测的周额度剩余" : "Weekly remaining observed after completion"}: {remaining} · {zh ? "观测" : "Observed"}: {observation}</span>
          </span>
        </div>;
      })}
    </div>
  </div>;
}
