// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuotaCard } from "./QuotaCard";
import { TokenUsage } from "./TokenUsage";
import { displayEffort } from "./TurnUsage";
import { tokenSnapshot } from "../test/tokenFixtures";
import { INITIAL_TOKEN_VIEW } from "../lib/tokenStatisticsController";
import { formatDateTime } from "../lib/format";
import type { TurnTokenUsage } from "../lib/tokenStatistics";
import type { ProviderSnapshot, WidgetPreferences } from "../types";
afterEach(cleanup);
const provider: ProviderSnapshot = { provider: "codex", displayName: "CODEX", plan: "TEST", shortWindow: { remainingPercent: 74, resetsAt: null, windowSeconds: 18000 }, weeklyWindow: { remainingPercent: 42, resetsAt: null, windowSeconds: 604800 }, resetCredits: 1, updatedAt: new Date().toISOString(), status: "ok", message: null };
const preferences: WidgetPreferences = { locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null, autoRotateSeconds: 12, language: "en", appearance: "light", selectedSkin: "default" };
const turn = (overrides: Partial<TurnTokenUsage> = {}): TurnTokenUsage => ({ model: "synthetic-model-very-long-name", effort: "xhigh", tokens: "9223372036854775807", completedAt: "2026-09-10T01:00:00Z", weeklyRemaining: 65.125, quotaObservedAt: "2026-09-10T01:10:00Z", isPartial: true, ...overrides });
function snapshot(rows = [turn()]) { return tokenSnapshot({ turnStatistics: { weeklyResetAt: "2026-09-13T00:00:00Z", turns: rows } }); }
for (const skin of ["default", "blur", "computer"] as const) for (const language of ["zh-CN", "en"] as const) for (const short of [true, false]) for (const mode of ["overview", "models", "turns"] as const) {
  it(`matrix ${skin}/${language}/${short ? "full" : "compact"}/${mode}`, () => {
    const drag = vi.fn();
    const { container } = render(<QuotaCard snapshot={{ ...provider, shortWindow: short ? provider.shortWindow : null }} preferences={{ ...preferences, language, selectedSkin: skin }} tokens={{ ...INITIAL_TOKEN_VIEW, snapshot: snapshot() }} skin={skin} theme="light" providerCount={1} onPrevious={vi.fn()} onNext={vi.fn()} onTogglePin={vi.fn()} onLock={vi.fn()} onToggleStayExpanded={vi.fn()} onDrag={drag} onHover={vi.fn()} />);
    const label = language === "en" ? { overview: "Overview", models: "By model", turns: "Quota week" }[mode] : { overview: "总览", models: "按模型", turns: "额度周" }[mode];
    const button = screen.getByRole("button", { name: label });
    fireEvent.mouseDown(button, { button: 0 }); fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true"); expect(drag).not.toHaveBeenCalled();
    expect(screen.getByRole("main").className).toContain(`height-${short ? "full" : "compact"}`);
    expect(container.querySelector('.provider-mark, .computer-gpt-mark, .weekly-note')).toBeNull();
    expect(container.innerHTML).not.toMatch(/Incomplete|统计不完整|统计不完善/);
    if (mode === "turns") {
      expect(screen.getByRole("table", { name: language === "en" ? "Quota week · Turn details in current quota week" : "额度周 · 当前额度周逐轮明细" })).toBeTruthy();
      expect(screen.getAllByRole("row")).toHaveLength(2);
      expect(container.querySelector('.token-period-switch')).toBeNull();
      const value = screen.getByLabelText('synthetic-model-very-long-name: 9,223,372,036,854,775,807');
      fireEvent.mouseDown(value, { button: 0 }); value.focus(); expect(document.activeElement).toBe(value); expect(drag).not.toHaveBeenCalled();
      expect(value.querySelector('small')?.textContent).toBe('*');
    }
    fireEvent.mouseDown(screen.getByRole('main'), { button: 0 }); expect(drag).toHaveBeenCalledOnce();
  });
}
it('preserves repeated turns and newest-first ordering with complete row metadata', () => {
  const oldest = turn({ tokens: '1001' });
  const newest = turn({ model: 'synthetic-newest-model', completedAt: '2026-09-10T03:00:00Z', effort: 'future-effort', tokens: '3003', weeklyRemaining: 80, quotaObservedAt: '2026-09-10T03:12:00Z', isPartial: false });
  const middle = turn({ completedAt: '2026-09-10T02:00:00Z', effort: null, tokens: '2002', weeklyRemaining: null, quotaObservedAt: null, isPartial: false });
  const rows = [oldest, newest, middle];
  const originalRows = rows.map(row => ({ ...row }));
  const { container } = render(<TokenUsage language="en" view={{ ...INITIAL_TOKEN_VIEW, snapshot: snapshot(rows) }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Quota week' }));
  const renderedRows = [...container.querySelectorAll('.token-turn-row')];
  expect(renderedRows).toHaveLength(3);
  expect(renderedRows.map(row => row.querySelector('.token-turn-effort')?.textContent)).toEqual(['future-effort', '—', 'xHigh']);
  expect(renderedRows.map(row => row.querySelector('.token-turn-quota-value')?.textContent)).toEqual(['80%', '—', '65.125%']);
  for (const [index, expected] of [newest, middle, oldest].entries()) {
    const row = renderedRows[index];
    const exactTokens = ['3,003', '2,002', '1,001'][index];
    expect(row.querySelector('.token-model-name')?.textContent).toBe(expected.model);
    expect(row.querySelector('.token-value')?.getAttribute('aria-label')).toBe(`${expected.model}: ${exactTokens}`);
    expect(row.querySelector('.token-value')?.firstChild?.textContent).toBe(expected.tokens);
    expect(row.querySelector('.token-value [role="tooltip"]')?.textContent).toBe(`${expected.model}: ${exactTokens} · Completed: ${formatDateTime(expected.completedAt, 'en')}`);
    expect(row.querySelector('.token-value small')?.textContent ?? null).toBe(expected.isPartial ? '*' : null);
    expect(row.querySelector('.token-turn-quota [role="tooltip"]')?.textContent).toBe(expected.quotaObservedAt
      ? `Weekly remaining observed after completion: ${expected.weeklyRemaining}% · Observed: ${formatDateTime(expected.quotaObservedAt, 'en')}`
      : 'No historical weekly quota observation is available after this turn');
  }
  expect(rows).toEqual(originalRows);
});
it('preserves backend tie order without secondary UI sorting', () => {
  const first = turn({ model: 'z-model', effort: 'ultra', tokens: '9000', weeklyRemaining: 90 });
  const second = turn({ model: 'a-model', effort: 'low', tokens: '1000', weeklyRemaining: 10 });
  const rows = [first, second];
  const mounted = render(<TokenUsage language="en" view={{ ...INITIAL_TOKEN_VIEW, snapshot: snapshot(rows) }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Quota week' }));
  const renderedModels = () => [...mounted.container.querySelectorAll('.token-turn-row .token-model-name')].map(row => row.textContent);
  expect(renderedModels()).toEqual(['z-model', 'a-model']);
  mounted.rerender(<TokenUsage language="en" view={{ ...INITIAL_TOKEN_VIEW, snapshot: snapshot([second, first]) }} />);
  expect(renderedModels()).toEqual(['a-model', 'z-model']);
  expect(rows).toEqual([first, second]);
});
it.each(["zh-CN", "en"] as const)('distinguishes unavailable and empty turns in %s', language => {
  const mounted = render(<TokenUsage language={language} view={{ ...INITIAL_TOKEN_VIEW, snapshot: tokenSnapshot({ turnStatistics: null }) }} />);
  fireEvent.click(screen.getByRole('button', { name: language === 'en' ? 'Quota week' : '额度周' }));
  expect(screen.getByText(language === 'en' ? 'Current quota week unavailable' : '当前额度周不可用')).toBeTruthy();
  mounted.rerender(<TokenUsage language={language} view={{ ...INITIAL_TOKEN_VIEW, snapshot: snapshot([]) }} />);
  expect(screen.getByText(language === 'en' ? 'No completed turns in this quota week' : '当前额度周暂无已完成记录')).toBeTruthy();
});
it('normalizes known effort enums only', () => { expect(['low','medium','high','xhigh','max','ultra',null,'future'].map(displayEffort)).toEqual(['Low','Medium','High','xHigh','Max','Ultra','—','future']); });
it('keeps many rows and exact extreme integers in the internal list', () => {
  const {container} = render(<TokenUsage language="en" view={{...INITIAL_TOKEN_VIEW,snapshot:snapshot(Array.from({length:40},(_,i)=>turn({tokens:i === 0 ? '9999' : '999999999999999999999999999999999999999999'})))}} />);
  fireEvent.click(screen.getByRole('button',{name:'Quota week'}));
  expect(container.querySelectorAll('.token-turn-list .token-turn-row')).toHaveLength(40);
  expect(screen.getByLabelText('synthetic-model-very-long-name: 9,999')).toBeTruthy();
});

it.each(["zh-CN", "en"] as const)('retains full precision behind quota ellipsis and in accessible details in %s', language => {
  const remaining = 65.12345678901234;
  const {container} = render(<TokenUsage language={language} view={{...INITIAL_TOKEN_VIEW,snapshot:snapshot([turn({weeklyRemaining:remaining})])}} />);
  fireEvent.click(screen.getByRole('button',{name:language === 'en' ? 'Quota week' : '额度周'}));
  const quota = screen.getByLabelText(`${language === 'en' ? 'Weekly remaining' : '周额度剩余'}: ${remaining}%`);
  const display = quota.querySelector('.token-turn-quota-value');
  expect(display?.textContent).toBe('65.12345678901234%');
  expect(quota.querySelector('[role="tooltip"]')?.textContent).toContain('65.12345678901234%');
  expect(container.querySelectorAll('.token-turn-row')).toHaveLength(1);
  quota.focus(); expect(document.activeElement).toBe(quota);
});

it.each(["zh-CN", "en"] as const)('renders an observed row with its weekly remaining in %s', language => {
  const {container} = render(<TokenUsage language={language} view={{...INITIAL_TOKEN_VIEW,snapshot:snapshot([turn({weeklyRemaining:0})])}} />);
  fireEvent.click(screen.getByRole('button',{name:language === 'en' ? 'Quota week' : '额度周'}));
  expect(container.querySelectorAll('.token-turn-row')).toHaveLength(1);
  expect(container.querySelector('.token-turn-quota-value')?.textContent).toBe('0%');
});


it.each(["zh-CN", "en"] as const)('preserves unobserved history without adding accounting partial marks in %s', language => {
  const rows = [turn({weeklyRemaining:null, quotaObservedAt:null, isPartial:false}), turn({completedAt:'2026-09-10T02:00:00Z', weeklyRemaining:82, isPartial:false})];
  const {container} = render(<TokenUsage language={language} view={{...INITIAL_TOKEN_VIEW,snapshot:snapshot(rows)}} />);
  fireEvent.click(screen.getByRole('button',{name:language === 'en' ? 'Quota week' : '额度周'}));
  const quota = screen.getByLabelText(language === 'en' ? 'Weekly remaining: no historical observation' : '周额度剩余：无历史观测');
  expect(quota.querySelector('.token-turn-quota-value')?.textContent).toBe('—');
  expect(quota.querySelector('[role="tooltip"]')?.textContent).toBe(language === 'en' ? 'No historical weekly quota observation is available after this turn' : '该轮完成后无可用的历史周额度观测');
  expect(container.querySelectorAll('.token-turn-row')).toHaveLength(2);
  expect(container.querySelector('.token-value small')).toBeNull();
  expect([...container.querySelectorAll('.token-turn-quota-value')].map(el => el.textContent)).toEqual(['82%','—']);
});
