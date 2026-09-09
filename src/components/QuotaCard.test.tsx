// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuotaCard, QuotaOrb } from "./QuotaCard";
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
