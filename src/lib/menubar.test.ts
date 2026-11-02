import { describe, expect, it } from "vitest";
import type { ProviderSnapshot } from "../types";
import { quotaPeriodLabel, quotaWindows } from "./menubar";

const window = { remainingPercent: 42.9, windowSeconds: 604800, resetsAt: null };
const snapshot: ProviderSnapshot = { provider: "codex", displayName: "CODEX", plan: "PRO", shortWindow: null, weeklyWindow: window, resetCredits: null, updatedAt: "2026-11-02T00:00:00Z", status: "ok", message: null };

describe("shared quota period presentation", () => {
  it.each([[604800, "每周额度", "Weekly quota"], [18000, "5 小时额度", "5-hour quota"], [7200, "2 小时额度", "2-hour quota"], [86400, "1 天额度", "1-day quota"], [5400, "90 分钟额度", "90-minute quota"], [0, "周期额度", "Quota period"]])("labels actual %s seconds", (seconds, zh, en) => {
    expect(quotaPeriodLabel({ ...window, windowSeconds: seconds as number }, "zh-CN")).toBe(zh);
    expect(quotaPeriodLabel({ ...window, windowSeconds: seconds as number }, "en")).toBe(en);
  });
  it("does not hide a period because of the plan name and only offers real windows", () => {
    const both = { ...snapshot, shortWindow: { ...window, windowSeconds: 7200 } };
    expect(quotaWindows(snapshot)).toHaveLength(1);
    expect(quotaWindows(both)).toHaveLength(2);
    expect(quotaWindows({ ...snapshot, weeklyWindow: null })).toHaveLength(0);
    expect(quotaWindows({ ...snapshot, weeklyWindow: { ...window, remainingPercent: -1 } })).toHaveLength(0);
    expect(quotaWindows({ ...snapshot, weeklyWindow: { ...window, windowSeconds: 0 } })).toHaveLength(1);
  });
});
