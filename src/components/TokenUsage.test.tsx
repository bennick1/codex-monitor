// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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


describe("model token presentation", () => {
  it("defaults to the unchanged two-by-two overview, then opens this week and switches all periods", () => {
    const { container } = show(tokenSnapshot());
    expect(screen.getByRole("button", { name: "总览" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".token-grid > div")).toHaveLength(4);
    expect(container.querySelector(".token-model-view")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    expect(container.querySelector(".token-grid")).toBeNull();
    expect(screen.getByRole("button", { name: "本周" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("gpt-synthetic-alpha")).toBeTruthy();
    expect(screen.getByText("66.7%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    expect(screen.getByText("当前周期暂无用量")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "本月" }));
    expect(screen.getByLabelText("gpt-synthetic-month: 3,450,000").childNodes[0].textContent).toBe("345.00万");
    fireEvent.click(screen.getByRole("button", { name: "总计" }));
    const exact = screen.getByLabelText("gpt-synthetic-total: 9,007,199,254,740,993");
    expect(exact.childNodes[0].textContent).toBe("90071992.55亿");
    expect(exact.getAttribute("tabindex")).toBe("0");
    fireEvent.focus(exact);
    expect(within(exact).getByRole("tooltip").textContent).toBe("gpt-synthetic-total: 9,007,199,254,740,993");
    fireEvent.mouseEnter(exact);
    expect(exact.querySelector(".token-exact")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "总览" }));
    expect(container.querySelectorAll(".token-grid > div")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    expect(screen.getByRole("button", { name: "总计" }).getAttribute("aria-pressed")).toBe("true");
  });
  it.each(["zh-CN", "en"] as const)("localizes unknown and puts it last in %s without altering slugs", (language) => {
    const snapshot = tokenSnapshot();
    snapshot.modelStatistics!.periods.thisWeek = { totalTokens: "1200", models: [
      { model: "unknown", tokens: "900", share: 75 },
      { model: "gpt-future-raw-slug", tokens: "300", share: 25 },
    ] };
    const { container } = render(<TokenUsage language={language} view={{ ...INITIAL_TOKEN_VIEW, snapshot }} />);
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "By model" : "按模型" }));
    const rows = container.querySelectorAll(".token-model-list li");
    expect(rows[0].getAttribute("data-model")).toBe("gpt-future-raw-slug");
    expect(rows[1].getAttribute("data-model")).toBe("unknown");
    expect(rows[1].querySelector(".token-model-name")?.textContent).toBe(language === "en" ? "Unknown" : "未归属");
    expect(screen.getByText("75.0%")).toBeTruthy();
    expect(container.querySelector(".token-status")).toBeNull();
    if (language === "en") {
      for (const label of ["Today", "Week", "Month", "Total"]) expect(screen.getByRole("button", { name: label })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
    }
  });
  it.each(["scanning", "partial", "empty", "unavailable"] as const)("retains shared %s feedback in model mode", (status) => {
    const snapshot = tokenSnapshot({ status });
    show(snapshot);
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    const labels = { scanning: "扫描中", partial: "统计不完整", empty: "暂无本机用量记录", unavailable: "统计暂不可用" };
    expect(screen.getByText(labels[status])).toBeTruthy();
    expect(screen.getByText("本机 Codex 已采集用量")).toBeTruthy();
    expect(screen.getByText(/成功采集/)).toBeTruthy();
  });
  it("retains confirmed model amounts during stale scan and marks partial exact details", () => {
    show(tokenSnapshot({ status: "scanning", isStale: true, thisWeek: totals("1200", true) }));
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    expect(screen.getByText("扫描中 · 统计不完整 · 暂未更新")).toBeTruthy();
    const value = screen.getByLabelText("gpt-synthetic-alpha: 800 · 统计不完整");
    expect(value.querySelector("small")?.textContent).toBe("*");
  });
  it("does not expose unconfirmed model rows or invent zero for absent model data", () => {
    const mounted = show(tokenSnapshot({ status: "scanning", lastSuccessAt: null, total: { ...totals("0"), factCount: "0" } }));
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    expect(screen.getByText("…")).toBeTruthy();
    expect(screen.queryByText("gpt-synthetic-alpha")).toBeNull();
    mounted.unmount();
    show(tokenSnapshot({ status: "unavailable", modelStatistics: null }));
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("统计暂不可用")).toBeTruthy();
  });
  it("keeps future long model names accessible and every row inside the scroll container", () => {
    const snapshot = tokenSnapshot();
    const name = "future-model-" + "unabridged-".repeat(12);
    snapshot.modelStatistics!.periods.thisWeek = { totalTokens: "1000", models: Array.from({ length: 10 }, (_, index) => ({ model: name + index, tokens: "100", share: 10 })) };
    const { container } = show(snapshot);
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    expect(container.querySelectorAll(".token-model-list li")).toHaveLength(10);
    expect(screen.getByTitle(name + "0").textContent).toBe(name + "0");
    expect(screen.getByLabelText(name + "0: 100")).toBeTruthy();
  });
});
