// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuotaCard, QuotaOrb } from "./QuotaCard";
import { tokenSnapshot } from "../test/tokenFixtures";
import { INITIAL_TOKEN_VIEW } from "../lib/tokenStatisticsController";
import { copy } from "../lib/i18n";
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
  autoRotateSeconds: 12, language: "zh-CN", appearance: "light", selectedSkin: "default",
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
