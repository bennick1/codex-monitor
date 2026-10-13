import { describe, expect, it } from "vitest";
import { accountDays, formatMoney, durationText, EMPTY_DEEPSEEK, remainingFunds, sumTokens, type AccountUsage } from "./sidebarData";

describe("sidebar data semantics", () => {
  it("shows remaining funds, not spent, and never invents an empty-account percentage", () => {
    expect(remainingFunds({ ...EMPTY_DEEPSEEK, balance: 8.89, spent: 21.11 })).toBeCloseTo(29.633333);
    for (const patch of [{ balance: 0, spent: 0 }, { balance: null, spent: 10 }, { balance: Infinity, spent: 0 }, { balance: -1, spent: 20 }]) expect(remainingFunds({ ...EMPTY_DEEPSEEK, ...patch })).toBeNull();
    expect(remainingFunds({ ...EMPTY_DEEPSEEK, balance: 0, spent: 20 })).toBe(0);
  });
  it("keeps missing days pending and exact large integers", () => {
    const data = { daily: [{ date: "2026-09-30", tokens: "9007199254740993" }, { date: "2026-09-29", tokens: "0" }] } as AccountUsage;
    const days = accountDays(data, new Date(2026, 9, 1));
    expect(days).toHaveLength(30); expect(days.at(-1)?.tokens).toBeNull();
    expect(days.find(day => day.date === "2026-09-29")?.tokens).toBe("0");
    expect(sumTokens(days.map(day => day.tokens))).toBe("9007199254740993");
    expect(sumTokens(["9007199254740993", "10"])).toBe("9007199254741003");
  });
  it("distinguishes positive sub-cent charges from zero and missing data", () => {
    expect(formatMoney(.00072, "zh-CN", "CNY")).toBe("<¥0.01");
    expect(formatMoney(0, "zh-CN", "CNY")).toBe("¥0.00");
    expect(formatMoney(.01, "zh-CN", "CNY")).toBe("¥0.01");
    expect(formatMoney(null, "zh-CN", "CNY")).toBe("—");
    expect(formatMoney(NaN, "zh-CN", "CNY")).toBe("—");
    expect(formatMoney(.005, "en-US", "USD")).toBe("<$0.01");
  });
  it("formats duration without inventing missing values", () => {
    expect(durationText(11460)).toBe("3h 11m"); expect(durationText(null)).toBe("—");
  });
});
