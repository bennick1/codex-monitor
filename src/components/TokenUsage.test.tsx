// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TokenUsage } from "./TokenUsage";
import { tokenSnapshot, totals } from "../test/tokenFixtures";
import { INITIAL_TOKEN_VIEW } from "../lib/tokenStatisticsController";
import type { TokenStatisticsSnapshot } from "../lib/tokenStatistics";

afterEach(cleanup);
function show(snapshot: TokenStatisticsSnapshot | null, failed = false) {
  return render(<TokenUsage language="zh-CN" view={{ ...INITIAL_TOKEN_VIEW, snapshot, failed, loading: !snapshot && !failed }} />);
}
describe("token status and field presentation", () => {
  it("renders four backend totals, including exact 0 and a large integer tooltip", () => {
    const { container } = show(tokenSnapshot());
    for (const label of ["今日", "本周", "本月", "总计"]) expect(screen.getByText(label)).toBeTruthy();
    expect(container.querySelector('[data-period="today"] dd')?.textContent).toContain("0");
    expect(screen.getByLabelText("本周: 1,200").childNodes[0].textContent).toBe("1200");
    expect(screen.getByLabelText("本月: 3,450,000").childNodes[0].textContent).toBe("345.00万");
    expect(screen.getByLabelText("总计: 9,007,199,254,740,993").textContent).toContain("9,007,199,254,740,993");
    expect(container.querySelector('time')?.dateTime).toBe("2026-09-05T15:49:00Z");
    expect(screen.getByText("本机 Codex 已采集用量")).toBeTruthy();
  });
  it.each(["zh-CN", "en"] as const)("uses Chinese summary units and grouped exact details in %s", (language) => {
    const snapshot = tokenSnapshot({
      today: totals("9999"), thisWeek: totals("12685398"),
      thisMonth: totals("1300000000"), total: totals("9223372036854775807", true),
    });
    const { container } = render(<TokenUsage language={language} view={{ ...INITIAL_TOKEN_VIEW, snapshot }} />);
    const values = container.querySelectorAll(".token-value");
    const expected = [
      ["9999", "9,999"], ["1268.54万", "12,685,398"],
      ["13.00亿", "1,300,000,000"], ["92233720368.55亿", "9,223,372,036,854,775,807"],
    ];
    expected.forEach(([summary, exact], index) => {
      expect(values[index].childNodes[0].textContent).toBe(summary);
      expect(values[index].getAttribute("aria-label")).toContain(exact);
      expect(values[index].querySelector('[role="tooltip"]')?.textContent).toContain(exact);
      expect(values[index].querySelector('[role="tooltip"]')?.textContent).not.toMatch(/[万亿]/);
      expect(values[index].getAttribute("tabindex")).toBe("0");
    });
    expect(values[3].querySelector("small")?.textContent).toBe("*");
    expect(snapshot.total?.totalTokens).toBe("9223372036854775807");
  });
  it.each(["ready", "scanning", "partial", "empty", "unavailable"] as const)("keeps the region for %s", (status) => {
    show(tokenSnapshot({ status }));
    expect(screen.getByRole("region", { name: "Token 用量" })).toBeTruthy();
    const labels = { ready: null, scanning: "扫描中", partial: "统计不完整", empty: "暂无本机用量记录", unavailable: "统计暂不可用" };
    if (labels[status]) expect(screen.getByText(labels[status]!)).toBeTruthy();
  });
  it("keeps confirmed results during scan and shows per-item partial quality", () => {
    show(tokenSnapshot({ status: "scanning", thisWeek: totals("1200", true), today: null }));
    expect(screen.getByText("扫描中 · 统计不完整")).toBeTruthy();
    expect(screen.getByLabelText("本周: 1,200 · 统计不完整")).toBeTruthy();
    expect(screen.getByText("…")).toBeTruthy();
  });
  it("uses scan coverage and fact count to distinguish unconfirmed zeros", () => {
    const zero = { ...totals("0", true), factCount: "0" };
    const view = show(tokenSnapshot({ status: "scanning", lastSuccessAt: null, total: zero, today: zero, thisWeek: zero, thisMonth: zero }));
    expect(screen.getAllByText("…")).toHaveLength(4);
    view.unmount();
    show(tokenSnapshot({ status: "empty", total: zero, today: zero, thisWeek: zero, thisMonth: zero }));
    expect(screen.getByLabelText("今日: 0 · 统计不完整")).toBeTruthy();
  });
  it("does not clear good fields when another period is missing", () => {
    const { container } = show(tokenSnapshot({ status: "partial", today: null }));
    expect(container.querySelector('[data-period="today"] dd')?.textContent).toBe("—");
    expect(screen.getByLabelText("本周: 1,200")).toBeTruthy();
  });
  it("shows placeholders for initial scanning and unavailable, never fake zeros", () => {
    const view = show(null);
    expect(screen.getAllByText("…")).toHaveLength(4);
    view.unmount();
    show(null, true);
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.getByText("统计暂不可用")).toBeTruthy();
  });
  it.each([false, true])("retains a snapshot marked stale by backend or IPC failure (%s)", (failed) => {
    show(tokenSnapshot({ isStale: !failed }), failed);
    expect(screen.getByText("暂未更新")).toBeTruthy();
    expect(screen.getByLabelText("本周: 1,200")).toBeTruthy();
  });
  it("never presents query time as scan time", () => {
    const { container } = show(tokenSnapshot({ lastScanAt: null, lastSuccessAt: null }));
    expect(container.querySelector("time")).toBeNull();
  });
});
