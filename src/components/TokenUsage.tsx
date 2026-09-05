import { useId } from "react";
import type { Language } from "../types";
import type { TokenStatisticsView } from "../lib/tokenStatisticsController";
import { formatTokenCount, formatTokenCountExact } from "../lib/tokenFormat";

export function TokenUsage({ view, language }: { view: TokenStatisticsView; language: Language }) {
  const id = useId();
  const zh = language === "zh-CN";
  const t = zh ? {
    title: "Token 用量", labels: ["今日", "本周", "本月", "总计"],
    scope: "本机 Codex 已采集用量", scanning: "扫描中", loading: "正在读取",
    partial: "统计不完整", empty: "暂无本机用量记录", unavailable: "统计暂不可用",
    stale: "暂未更新", listener: "实时更新暂不可用", scanned: "扫描", success: "成功采集",
  } : {
    title: "Token usage", labels: ["Today", "This week", "This month", "Total"],
    scope: "Collected on this Mac/PC · Codex", scanning: "Scanning", loading: "Loading",
    partial: "Incomplete", empty: "No local usage records", unavailable: "Statistics unavailable",
    stale: "Not up to date", listener: "Live updates unavailable", scanned: "Scan", success: "Last success",
  };
  const { snapshot, failed, loading, listenerFailed } = view;
  const items = [snapshot?.today, snapshot?.thisWeek, snapshot?.thisMonth, snapshot?.total];
  const unconfirmedScan = snapshot?.status === "scanning" && !snapshot.lastSuccessAt
    && (!snapshot.total || snapshot.total.factCount === "0");
  const partial = snapshot?.status === "partial" || items.some((item) => item?.isPartial);
  const stale = failed || snapshot?.isStale || listenerFailed;
  const messages = [
    snapshot?.status === "scanning" ? t.scanning : !snapshot && loading && !failed ? t.loading : null,
    partial ? t.partial : null,
    snapshot?.status === "empty" ? t.empty : null,
    snapshot?.status === "unavailable" || (!snapshot && failed) ? t.unavailable : null,
    stale && snapshot ? t.stale : null,
    listenerFailed && !snapshot ? t.listener : null,
  ].filter(Boolean);
  // queryAtUtc is deliberately never presented as collection time.
  const timestamp = snapshot?.lastSuccessAt ?? snapshot?.lastScanAt;
  const date = timestamp ? new Date(timestamp) : null;
  const time = date && Number.isFinite(date.getTime())
    ? date.toLocaleString(language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : null;
  return <section className="token-usage" aria-labelledby={id}>
    <h2 id={id}>{t.title}</h2>
    <dl className="token-grid">
      {items.map((item, index) => {
        const value = item?.totalTokens;
        const valid = !unconfirmedScan && typeof value === "string" && /^\d+$/.test(value);
        const text = valid ? formatTokenCount(value) : ((!snapshot && loading && !failed) || snapshot?.status === "scanning") ? "…" : "—";
        const exact = valid ? formatTokenCountExact(value) : null;
        return <div key={t.labels[index]} data-period={["today", "thisWeek", "thisMonth", "total"][index]}>
          <dt>{t.labels[index]}</dt>
          <dd><span className={`token-value${text.length > 10 ? " token-value--long" : ""}`} tabIndex={valid ? 0 : undefined}
            aria-label={valid ? `${t.labels[index]}: ${exact}${item?.isPartial ? ` · ${t.partial}` : ""}` : undefined}>
            {text}{item?.isPartial ? <small aria-hidden="true">*</small> : null}
            {valid ? <span className="token-exact" role="tooltip">{t.labels[index]}: {exact}{item?.isPartial ? ` · ${t.partial}` : ""}</span> : null}
          </span></dd>
        </div>;
      })}
    </dl>
    <div className="token-meta" role="status">
      {messages.length ? <p className="token-status">{messages.join(" · ")}</p> : null}
      <p>{t.scope}</p>
      {time ? <p>{snapshot?.lastSuccessAt ? t.success : t.scanned} <time dateTime={timestamp!}>{time}</time></p> : null}
    </div>
  </section>;
}
