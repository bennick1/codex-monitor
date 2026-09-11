import { useId, useState } from "react";
import type { Language } from "../types";
import type { TokenStatisticsView } from "../lib/tokenStatisticsController";
import type { ModelTokenPeriodKey } from "../lib/tokenStatistics";
import { TurnUsage } from "./TurnUsage";
import { formatTokenCount, formatTokenCountExact } from "../lib/tokenFormat";

export function TokenUsage({ view, language }: { view: TokenStatisticsView; language: Language }) {
  const id = useId();
  const [mode, setMode] = useState<"overview" | "models" | "turns">("overview");
  const [period, setPeriod] = useState<ModelTokenPeriodKey>("quotaPeriod");
  const periods: ModelTokenPeriodKey[] = ["today", "quotaPeriod", "last7Days", "last30Days", "total"];
  const zh = language === "zh-CN";
  const t = zh ? {
    overview: "总览", models: "按模型", turns: "按对话", unknown: "未识别模型", period: "统计周期", noPeriod: "当前周期暂无用量",
    periodLabels: ["今日", "额度周期", "近7天", "近30天", "总计"],
    title: "Token 用量", labels: ["今日", "本周", "本月", "总计"],
  } : {
    overview: "Overview", models: "By model", turns: "By turn", unknown: "Unidentified", period: "Period", noPeriod: "No usage in this period",
    periodLabels: ["Today", "Quota Period", "7 Days", "30 Days", "Total"],
    title: "Token usage", labels: ["Today", "This week", "This month", "Total"],
  };
  const { snapshot, failed, loading } = view;
  const items = [snapshot?.today, snapshot?.thisWeek, snapshot?.thisMonth, snapshot?.total];
  const unconfirmedScan = snapshot?.status === "scanning" && !snapshot.lastSuccessAt
    && (!snapshot.total || snapshot.total.factCount === "0");
  const partial = snapshot?.status === "partial" || items.some((item) => item?.isPartial);
  const modelPeriod = snapshot?.modelStatistics?.periods[period];
  // The backend owns amount ordering; keep unknown last without Number conversion.
  const models = modelPeriod?.models.filter((item) => item.model !== "unknown") ?? [];
  models.push(...(modelPeriod?.models.filter((item) => item.model === "unknown") ?? []));
  const selectedPartial = period === "today" || period === "total" ? snapshot?.[period]?.isPartial : partial;
  return <section className={`token-usage${mode !== "overview" ? " token-usage--models" : ""}`} aria-labelledby={id}
    onMouseDown={(event) => event.stopPropagation()}>
    <div className="token-heading">
      <h2 id={id}>{t.title}</h2>
      <div className="token-switch" role="group" aria-label={t.title}>
        <button type="button" aria-pressed={mode === "overview"} onClick={() => setMode("overview")}>{t.overview}</button>
        <button type="button" aria-pressed={mode === "models"} onClick={() => setMode("models")}>{t.models}</button>
        <button type="button" aria-pressed={mode === "turns"} onClick={() => setMode("turns")}>{t.turns}</button>
      </div>
    </div>
    {mode === "overview" ? <dl className="token-grid">
      {items.map((item, index) => {
        const value = item?.totalTokens;
        const valid = !unconfirmedScan && typeof value === "string" && /^\d+$/.test(value);
        const text = valid ? formatTokenCount(value) : ((!snapshot && loading && !failed) || snapshot?.status === "scanning") ? "…" : "—";
        const exact = valid ? formatTokenCountExact(value) : null;
        return <div key={t.labels[index]} data-period={["today", "thisWeek", "thisMonth", "total"][index]}>
          <dt>{t.labels[index]}</dt>
          <dd><span className={`token-value${text.length > 10 ? " token-value--long" : ""}`} tabIndex={valid ? 0 : undefined}
            aria-label={valid ? `${t.labels[index]}: ${exact}` : undefined}>
            {text}{item?.isPartial ? <small aria-hidden="true">*</small> : null}
            {valid ? <span className="token-exact" role="tooltip">{t.labels[index]}: {exact}</span> : null}
          </span></dd>
        </div>;
      })}
    </dl> : mode === "turns" ? <TurnUsage statistics={snapshot?.turnStatistics ?? null} language={language} loading={unconfirmedScan || (!snapshot && loading && !failed)} /> : <div className="token-model-view">
      <div className="token-period-switch token-switch" role="group" aria-label={t.period}>
        {periods.map((value, index) => <button key={value} type="button" aria-pressed={period === value}
          onClick={() => setPeriod(value)}>{t.periodLabels[index]}</button>)}
      </div>
      {unconfirmedScan || !modelPeriod ? <p className="token-model-placeholder">
        {unconfirmedScan || (!snapshot && loading && !failed) || snapshot?.status === "scanning" ? "…" : "—"}
      </p> : models.length === 0 ? <p className="token-model-placeholder">{t.noPeriod}</p> :
        <ul className="token-model-list" aria-label={`${t.models} · ${t.periodLabels[periods.indexOf(period)]}`}>
          {models.map((item) => {
            const name = item.model === "unknown" ? t.unknown : item.model;
            const text = formatTokenCount(item.tokens);
            const exact = formatTokenCountExact(item.tokens);
            return <li key={item.model} data-model={item.model}>
              <span className="token-model-name" title={name}>{name}</span>
              <span className={`token-value${text.length > 10 ? " token-value--long" : ""}`} tabIndex={0}
                aria-label={`${name}: ${exact}`}>
                {text}{selectedPartial ? <small aria-hidden="true">*</small> : null}
                <span className="token-exact" role="tooltip">{name}: {exact}</span>
              </span>
              <span className="token-model-share">{item.share.toFixed(1)}%</span>
            </li>;
          })}
        </ul>}
    </div>}
  </section>;
}
