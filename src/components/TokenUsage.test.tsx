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
    expect(container.querySelector("time")).toBeNull();
    expect(screen.queryByText("本机 Codex 已采集用量")).toBeNull();
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
    if (labels[status]) expect(screen.queryByText(labels[status]!)).toBeNull();
  });
  it("keeps confirmed results during scan and shows per-item partial quality", () => {
    show(tokenSnapshot({ status: "scanning", thisWeek: totals("1200", true), today: null }));
    expect(screen.queryByText("扫描中 · 统计不完整")).toBeNull();
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
    expect(screen.queryByText("统计暂不可用")).toBeNull();
  });
  it.each([false, true])("retains a snapshot marked stale by backend or IPC failure (%s)", (failed) => {
    show(tokenSnapshot({ isStale: !failed }), failed);
    expect(screen.queryByText("暂未更新")).toBeNull();
    expect(screen.getByLabelText("本周: 1,200")).toBeTruthy();
  });
  it("never presents query time as scan time", () => {
    const { container } = show(tokenSnapshot({ lastScanAt: null, lastSuccessAt: null }));
    expect(container.querySelector("time")).toBeNull();
  });
});


describe("model token presentation", () => {
  it("defaults to the unchanged two-by-two overview, then opens quota period and switches all periods", () => {
    const { container } = show(tokenSnapshot());
    expect(screen.getByRole("button", { name: "总览" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".token-grid > div")).toHaveLength(4);
    expect(container.querySelector(".token-model-view")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    expect(container.querySelector(".token-grid")).toBeNull();
    expect(screen.getByRole("button", { name: "额度周期" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("gpt-synthetic-alpha")).toBeTruthy();
    expect(screen.getByText("66.7%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    expect(screen.getByText("当前周期暂无用量")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "近30天" }));
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
    snapshot.modelStatistics!.periods.quotaPeriod = { totalTokens: "1200", models: [
      { model: "unknown", tokens: "900", share: 75 },
      { model: "gpt-future-raw-slug", tokens: "300", share: 25 },
    ] };
    const { container } = render(<TokenUsage language={language} view={{ ...INITIAL_TOKEN_VIEW, snapshot }} />);
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "By model" : "按模型" }));
    const rows = container.querySelectorAll(".token-model-list li");
    expect(rows[0].getAttribute("data-model")).toBe("gpt-future-raw-slug");
    expect(rows[1].getAttribute("data-model")).toBe("unknown");
    expect(rows[1].querySelector(".token-model-name")?.textContent).toBe(language === "en" ? "Unidentified" : "未识别模型");
    expect(screen.getByText("75.0%")).toBeTruthy();
    expect(container.querySelector(".token-status")).toBeNull();
    if (language === "en") {
      for (const label of ["Today", "Quota Period", "7 Days", "30 Days", "Total"]) expect(screen.getByRole("button", { name: label })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Quota Period" }).getAttribute("aria-pressed")).toBe("true");
    }
  });
  it.each(["scanning", "partial", "empty", "unavailable"] as const)("omits footer feedback for %s in model mode", (status) => {
    const snapshot = tokenSnapshot({ status });
    show(snapshot);
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    const labels = { scanning: "扫描中", partial: "统计不完整", empty: "暂无本机用量记录", unavailable: "统计暂不可用" };
    expect(screen.queryByText(labels[status])).toBeNull();
    expect(screen.queryByText("本机 Codex 已采集用量")).toBeNull();
    expect(screen.queryByText(/成功采集/)).toBeNull();
  });
  it("retains confirmed model amounts during stale scan and marks partial exact details", () => {
    show(tokenSnapshot({ status: "scanning", isStale: true, thisWeek: totals("1200", true) }));
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    expect(screen.queryByText("扫描中 · 统计不完整 · 暂未更新")).toBeNull();
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
    expect(screen.queryByText("统计暂不可用")).toBeNull();
  });
  it("keeps future long model names accessible and every row inside the scroll container", () => {
    const snapshot = tokenSnapshot();
    const name = "future-model-" + "unabridged-".repeat(12);
    snapshot.modelStatistics!.periods.quotaPeriod = { totalTokens: "1000", models: Array.from({ length: 10 }, (_, index) => ({ model: name + index, tokens: "100", share: 10 })) };
    const { container } = show(snapshot);
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    expect(container.querySelectorAll(".token-model-list li")).toHaveLength(10);
    expect(screen.getByTitle(name + "0").textContent).toBe(name + "0");
    expect(screen.getByLabelText(name + "0: 100")).toBeTruthy();
  });
});

it("quota unavailable never reuses overview week and leaves the other model periods usable", () => {
  const snapshot = tokenSnapshot(); snapshot.modelStatistics!.periods.quotaPeriod = null;
  show(snapshot); expect(screen.getByLabelText("本周: 1,200")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "按模型" }));
  expect(screen.getByText("—")).toBeTruthy(); expect(screen.queryByRole("button", { name: "本周" })).toBeNull();
  for (const label of ["今日", "近7天", "近30天", "总计"]) { fireEvent.click(screen.getByRole("button", { name: label })); expect(screen.queryByText("—")).toBeNull(); }
});

it.each(["zh-CN", "en"] as const)("maps all five model periods and preserves overview in %s", (language) => {
  const { container } = render(<TokenUsage language={language} view={{ ...INITIAL_TOKEN_VIEW, snapshot: tokenSnapshot() }} />);
  const zh = language === "zh-CN";
  const overview = container.querySelector(".token-grid")!.innerHTML;
  fireEvent.click(screen.getByRole("button", { name: zh ? "按模型" : "By model" }));
  const labels = zh ? ["今日", "额度周期", "近7天", "近30天", "总计"] : ["Today", "Quota Period", "7 Days", "30 Days", "Total"];
  const buttons = within(screen.getByRole("group", { name: zh ? "统计周期" : "Period" })).getAllByRole("button");
  expect(buttons.map(b => b.textContent)).toEqual(labels);
  expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("button", { name: zh ? "本月" : "This month" })).toBeNull();
  for (const [index, model] of [null, "gpt-synthetic-alpha", "gpt-synthetic-week", "gpt-synthetic-month", "gpt-synthetic-total"].entries()) {
    fireEvent.click(buttons[index]);
    expect(buttons[index].getAttribute("aria-pressed")).toBe("true");
    if (model) expect(screen.getByTitle(model)).toBeTruthy();
    else expect(screen.getByText(zh ? "当前周期暂无用量" : "No usage in this period")).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("button", { name: zh ? "总览" : "Overview" }));
  expect(container.querySelector(".token-grid")!.innerHTML).toBe(overview);
});


it.each(["zh-CN", "en"] as const)("removes metadata while retaining numeric partial details in %s", (language) => {
  for (const isPartial of [false, true]) {
    const snapshot = tokenSnapshot({ status: isPartial ? "partial" : "ready", thisWeek: totals("1200", isPartial) });
    const { container, unmount } = render(<TokenUsage language={language} view={{ ...INITIAL_TOKEN_VIEW, snapshot }} />);
    for (const mode of ["overview", "models"]) {
      if (mode === "models") fireEvent.click(screen.getByRole("button", { name: language === "en" ? "By model" : "按模型" }));
      expect(container.querySelector(".token-meta")).toBeNull();
      expect(container.querySelector(".token-status")).toBeNull();
      expect(container.querySelector("time")).toBeNull();
      expect(screen.queryByText(/本机 Codex 已采集用量|Collected on this Mac\/PC · Codex|成功采集|Last success|^扫描|^Scan/)).toBeNull();
      expect(screen.queryByText(/^(统计不完整|Incomplete)$/)).toBeNull();
      const value = container.querySelector(mode === "overview" ? '[data-period="thisWeek"] .token-value' : '.token-model-list .token-value')!;
      const partialText = language === "en" ? "Incomplete" : "统计不完整";
      expect(value.querySelector("small")?.textContent ?? null).toBe(isPartial ? "*" : null);
      expect(value.getAttribute("aria-label")?.includes(partialText)).toBe(isPartial);
      expect(value.querySelector('[role="tooltip"]')?.textContent?.includes(partialText)).toBe(isPartial);
    }
    unmount();
  }
});
