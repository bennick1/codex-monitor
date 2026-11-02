// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuotaCard, QuotaOrb } from "./QuotaCard";
import { tokenSnapshot } from "../test/tokenFixtures";
import { INITIAL_TOKEN_VIEW } from "../lib/tokenStatisticsController";
import { copy } from "../lib/i18n";
import { formatDateTime } from "../lib/format";
import type { ProviderSnapshot, WidgetPreferences, WidgetSkin } from "../types";

afterEach(cleanup);
const snapshot: ProviderSnapshot = {
  provider: "codex", displayName: "CODEX", plan: "TEST",
  shortWindow: { remainingPercent: 74, resetsAt: null, windowSeconds: 18000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: null, windowSeconds: 604800 },
  resetCredits: 1, updatedAt: new Date().toISOString(), status: "ok", message: null,
};
const preferences: WidgetPreferences = {
  locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null,
  autoRotateSeconds: 12, language: "zh-CN", appearance: "light", selectedSkin: "default", opacityPercent: 100,
};

describe("free built-in widget skins", () => {
  for (const language of ["zh-CN", "en"] as const) {
    for (const theme of ["light", "dark"] as const) {
      it(`retains quota, hover, drag and card controls in ${language} / ${theme}`, () => {
        const hover = vi.fn(), drag = vi.fn(), pin = vi.fn(), expand = vi.fn();
        const view = render(<QuotaCard snapshot={snapshot} preferences={{ ...preferences, language }}
          providerCount={1} onPrevious={vi.fn()} onNext={vi.fn()} onTogglePin={vi.fn()}
          onLock={pin} onToggleStayExpanded={expand} onDrag={drag} onHover={hover} theme={theme} />);
        expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("74");
        fireEvent.mouseEnter(screen.getByRole("main"));
        fireEvent.mouseLeave(screen.getByRole("main"));
        expect(hover.mock.calls).toEqual([[true], [false]]);
        fireEvent.click(screen.getByRole("button", { name: copy[language].pinOff }));
        fireEvent.click(screen.getByRole("button", { name: copy[language].keepExpandedOn }));
        expect(pin).toHaveBeenCalledOnce(); expect(expand).toHaveBeenCalledOnce();
        expect(drag).not.toHaveBeenCalled();
        fireEvent.mouseDown(screen.getByRole("main"), { button: 0 });
        expect(drag).toHaveBeenCalledOnce();
        expect(screen.getByRole("main").className).not.toMatch(/skin-(blur|computer)/);
        expect(view.container.innerHTML).not.toMatch(/supporter|license|purchase|unlock/i);
        view.unmount();
        render(<QuotaOrb snapshot={snapshot} language={language} theme={theme} onDrag={drag} onHover={hover} />);
        expect(screen.getByRole("main").getAttribute("aria-label")).toBe(copy[language].availableLabel(74));
        expect(screen.getByRole("main").className).not.toMatch(/skin-(blur|computer)/);
      });
    }
  }

  it.each([
    ["default", null, null],
    ["blur", "quota-card--skin-blur", "blur-progress"],
    ["computer", "quota-card--skin-computer", "computer-progress"],
  ] as Array<[WidgetSkin, string | null, string | null]>)
  ("renders the %s card and orb without any access gate", (skin, cardClass, progressClass) => {
    const view = render(<QuotaCard snapshot={snapshot} preferences={{ ...preferences, selectedSkin: skin }}
      providerCount={1} onPrevious={vi.fn()} onNext={vi.fn()} onTogglePin={vi.fn()}
      onLock={vi.fn()} onToggleStayExpanded={vi.fn()} onDrag={vi.fn()} onHover={vi.fn()}
      skin={skin} theme="dark" />);
    const card = screen.getByRole("main");
    if (cardClass) {
      expect(card.className).toContain(cardClass);
      expect(view.container.querySelector(`.${progressClass}`)).toBeTruthy();
    } else {
      expect(card.className).not.toMatch(/skin-(blur|computer)/);
      expect(view.container.querySelector(".progress")).toBeTruthy();
    }
    expect(view.container.innerHTML).not.toMatch(/supporter|license|purchase|unlock/i);
    view.unmount();

    const orbView = render(<QuotaOrb snapshot={snapshot} language="en" theme="dark" skin={skin} onDrag={vi.fn()} onHover={vi.fn()} />);
    const orb = screen.getByRole("main");
    if (skin === "default") expect(orb.className).not.toMatch(/skin-(blur|computer)/);
    else expect(orb.className).toContain(`quota-orb--skin-${skin}`);
    expect(orbView.container.innerHTML).not.toMatch(/supporter|license|purchase|unlock/i);
  });
});


describe("TokenUsage drag boundary", () => {
  function showTokens() {
    const drag = vi.fn();
    const view = render(<QuotaCard snapshot={snapshot} preferences={preferences}
      tokens={{ ...INITIAL_TOKEN_VIEW, snapshot: tokenSnapshot() }}
      providerCount={1} onPrevious={vi.fn()} onNext={vi.fn()} onTogglePin={vi.fn()}
      onLock={vi.fn()} onToggleStayExpanded={vi.fn()} onDrag={drag} onHover={vi.fn()} />);
    return { ...view, drag };
  }

  it("switches By Model and Overview without starting card drag", () => {
    const { drag } = showTokens();
    for (const name of ["按模型", "总览"]) {
      const button = screen.getByRole("button", { name });
      fireEvent.mouseDown(button, { button: 0 });
      fireEvent.click(button);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(drag).not.toHaveBeenCalled();
    }
  });

  it("switches all five model periods without starting card drag", () => {
    const { drag } = showTokens();
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    for (const name of ["今日", "额度周期", "近7天", "近30天", "总计"]) {
      const button = screen.getByRole("button", { name });
      fireEvent.mouseDown(button, { button: 0 });
      fireEvent.click(button);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(drag).not.toHaveBeenCalled();
    }
  });

  it("keeps exact values focusable and list interactions outside card drag", () => {
    const { drag } = showTokens();
    const exact = screen.getByLabelText("本周: 1,200");
    expect(fireEvent.mouseDown(exact, { button: 0 })).toBe(true);
    exact.focus();
    expect(document.activeElement).toBe(exact);
    expect(drag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    const list = screen.getByRole("list", { name: "按模型 · 额度周期" });
    const model = screen.getByText("gpt-synthetic-alpha");
    const modelExact = screen.getByLabelText("gpt-synthetic-alpha: 800");
    for (const element of [list, model, modelExact]) {
      expect(fireEvent.mouseDown(element, { button: 0 })).toBe(true);
      fireEvent.click(element);
    }
    modelExact.focus();
    expect(document.activeElement).toBe(modelExact);
    expect(fireEvent.wheel(list, { deltaY: 100 })).toBe(true);
    fireEvent.scroll(list, { target: { scrollTop: 100 } });
    expect(drag).not.toHaveBeenCalled();
  });

  it("preserves drag on the card outside TokenUsage", () => {
    const { drag } = showTokens();
    fireEvent.mouseDown(screen.getByRole("main"), { button: 0 });
    expect(drag).toHaveBeenCalledOnce();
  });
});


describe("expanded product title", () => {
  for (const skin of ["default", "blur", "computer"] as const) {
    for (const language of ["zh-CN", "en"] as const) {
      it.each(["PROLITE", "PRO", null])(`uses the fixed title in ${skin} / ${language} with plan %s`, (plan) => {
        const { container } = render(<QuotaCard snapshot={{ ...snapshot, plan }} preferences={{ ...preferences, language }}
          tokens={{ ...INITIAL_TOKEN_VIEW, snapshot: tokenSnapshot() }} skin={skin}
          providerCount={1} onPrevious={vi.fn()} onNext={vi.fn()} onTogglePin={vi.fn()}
          onLock={vi.fn()} onToggleStayExpanded={vi.fn()} onDrag={vi.fn()} onHover={vi.fn()} />);
        expect(container.querySelector(".card-header .eyebrow")?.textContent).toBe("Codex-Monitor");
        expect(container.textContent).not.toMatch(/CODEX · PROLITE|CODEX · PRO|codex·plus/);
      });
    }
  }
});

it("labels a non-five-hour period by its actual duration in the card and orb", () => {
  const actual = { ...snapshot, shortWindow: { ...snapshot.shortWindow!, windowSeconds: 7200 }, weeklyWindow: null };
  const view = render(<QuotaCard snapshot={actual} preferences={preferences} providerCount={1}
    onPrevious={vi.fn()} onNext={vi.fn()} onTogglePin={vi.fn()} onLock={vi.fn()}
    onToggleStayExpanded={vi.fn()} onDrag={vi.fn()} onHover={vi.fn()} />);
  expect(screen.getByText("2 小时 剩余")).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "2 小时额度 剩余 74%" })).toBeTruthy();
  expect(screen.queryByText(/本周剩余/)).toBeNull();
  view.unmount();
  render(<QuotaOrb snapshot={actual} onDrag={vi.fn()} onHover={vi.fn()} />);
  expect(screen.getByRole("main").getAttribute("aria-label")).toBe("2 小时额度 剩余 74%");
});

it("does not label a one-day secondary period as weekly", () => {
  const actual = { ...snapshot, shortWindow: null, weeklyWindow: { ...snapshot.weeklyWindow!, windowSeconds: 86400 } };
  const view = render(<QuotaOrb snapshot={actual} onDrag={vi.fn()} onHover={vi.fn()} />);
  expect(screen.getByRole("main").getAttribute("aria-label")).toBe("1 天额度 剩余 42%");
  expect(view.container.querySelector(".orb-weekly-badge")).toBeNull();
});

it.each(["default", "blur", "computer", "mecha-light"] as const)("reuses the exact %s quota/statistics content and styling for the menu-bar host", skin => {
  const props = { snapshot, preferences, providerCount: 1, skin, theme: "light" as const,
    tokens: { ...INITIAL_TOKEN_VIEW, snapshot: tokenSnapshot(), loading: false },
    onPrevious: vi.fn(), onNext: vi.fn(), onTogglePin: vi.fn(), onLock: vi.fn(),
    onToggleStayExpanded: vi.fn(), onDrag: vi.fn(), onHover: vi.fn(), onMenu: vi.fn() };
  const view = render(<QuotaCard {...props} host="floating" />);
  const parts = [".primary-metric", ".progress, .blur-progress, .computer-progress, .mecha-progress", ".reset-time", ".card-footer", ".token-grid"];
  const before = parts.map(selector => view.container.querySelector(selector)?.outerHTML);
  const classes = screen.getByRole("main").className;
  const style = screen.getByRole("main").getAttribute("style");
  view.rerender(<QuotaCard {...props} host="menubar" />);
  expect(screen.getByRole("main").className).toBe(classes);
  expect(screen.getByRole("main").getAttribute("style")).toBe(style);
  expect(parts.map(selector => view.container.querySelector(selector)?.outerHTML)).toEqual(before);
  expect(screen.getByRole("button", { name: "总览" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "按模型" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "额度周" })).toBeTruthy();
  fireEvent.mouseEnter(screen.getByRole("main"));
  fireEvent.mouseLeave(screen.getByRole("main"));
  fireEvent.mouseDown(screen.getByRole("main"), { button: 0 });
  expect(props.onHover).not.toHaveBeenCalled();
  expect(props.onDrag).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "更多" }));
  fireEvent.click(screen.getByRole("button", { name: "收起面板" }));
  fireEvent.click(screen.getByRole("button", { name: "切换到悬浮窗" }));
  expect(props.onMenu).toHaveBeenCalledOnce();
  expect(props.onToggleStayExpanded).toHaveBeenCalledOnce();
  expect(props.onLock).toHaveBeenCalledOnce();
});

describe("stale quota last-success text", () => {
  for (const host of ["floating", "menubar"] as const) {
    for (const language of ["zh-CN", "en"] as const) {
      const cardProps = { host, preferences: { ...preferences, language }, providerCount: 1,
        tokens: { ...INITIAL_TOKEN_VIEW, snapshot: tokenSnapshot(), loading: false },
        onPrevious: vi.fn(), onNext: vi.fn(), onTogglePin: vi.fn(), onLock: vi.fn(),
        onToggleStayExpanded: vi.fn(), onDrag: vi.fn(), onHover: vi.fn() };

      it(`shows the stale status and last success in the existing reset line for ${host} / ${language}`, () => {
        const updatedAt = new Date(Date.now() - 5 * 60_000).toISOString();
        const resetsAt = new Date(Date.now() + 45 * 60_000).toISOString();
        const stale: ProviderSnapshot = { ...snapshot, status: "stale", updatedAt,
          shortWindow: { ...snapshot.shortWindow!, resetsAt } };
        const lastSuccess = `${language === "zh-CN" ? "最后成功" : "Last success"} ${formatDateTime(updatedAt, language)}`;
        const status = `${copy[language].dataStale} · ${lastSuccess}`;
        const view = render(<QuotaCard {...cardProps} snapshot={stale} isConsuming />);
        const reset = view.container.querySelector(".reset-time")!;
        expect(reset.textContent).toBe(`${language === "zh-CN" ? "已过期" : "Stale"} · ${lastSuccess}`);
        expect(reset.getAttribute("title")).toContain(formatDateTime(resetsAt, language));
        expect(reset.getAttribute("aria-label")).toContain(reset.getAttribute("title"));
        expect(screen.getByRole("status", { name: status }).getAttribute("title")).toBe(status);
        expect(screen.getByRole("progressbar")).toBeTruthy();
        expect(view.container.querySelectorAll(".reset-time")).toHaveLength(1);
        expect(reset.children).toHaveLength(0);
        const resetText = reset.getAttribute("title");
        view.rerender(<QuotaCard {...cardProps} snapshot={{ ...stale, status: "ok" }} />);
        expect(view.container.querySelector(".reset-time")!.textContent).toBe(resetText);
        expect(view.container.querySelector(".reset-time")!.hasAttribute("title")).toBe(false);
      });

      it(`keeps the expired error paragraph concise and exposes its reason for ${host} / ${language}`, () => {
        const updatedAt = new Date(Date.now() - 31 * 60_000).toISOString();
        const lastSuccess = `${language === "zh-CN" ? "最后成功" : "Last success"} ${formatDateTime(updatedAt, language)}`;
        const description = `${copy[language].errorUnavailable} · ${lastSuccess}`;
        const view = render(<QuotaCard {...cardProps} snapshot={{ ...snapshot, status: "stale", updatedAt }} />);
        expect(screen.getByText(copy[language].staleExpired)).toBeTruthy();
        const paragraph = view.container.querySelector(".error-state p")!;
        expect(paragraph.textContent).toBe(lastSuccess);
        expect(paragraph.getAttribute("title")).toBe(description);
        expect(paragraph.getAttribute("aria-label")).toBe(description);
        expect(view.container.querySelectorAll(".error-state p")).toHaveLength(1);
        expect(paragraph.children).toHaveLength(0);
        expect(screen.queryByRole("progressbar")).toBeNull();
        expect(screen.getByRole("status", { name: `${copy[language].dataStale} · ${lastSuccess}` })).toBeTruthy();
        expect(screen.getByRole("region", { name: language === "zh-CN" ? "Token 用量" : "Token usage" })).toBeTruthy();
      });
    }
  }
});
