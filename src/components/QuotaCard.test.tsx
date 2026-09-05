// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuotaCard, QuotaOrb } from "./QuotaCard";
import { copy } from "../lib/i18n";
import type { ProviderSnapshot, WidgetPreferences } from "../types";

afterEach(cleanup);
const snapshot: ProviderSnapshot = {
  provider: "codex", displayName: "CODEX", plan: "TEST",
  shortWindow: { remainingPercent: 74, resetsAt: null, windowSeconds: 18000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: null, windowSeconds: 604800 },
  resetCredits: 1, updatedAt: new Date().toISOString(), status: "ok", message: null,
};
const preferences: WidgetPreferences = {
  locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null,
  autoRotateSeconds: 12, language: "zh-CN", appearance: "light",
};

describe("default widget after paid skins are removed", () => {
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
        expect(view.container.innerHTML).not.toMatch(/supporter|skin-blur|skin-computer|license/i);
        view.unmount();
        render(<QuotaOrb snapshot={snapshot} language={language} theme={theme} onDrag={drag} onHover={hover} />);
        expect(screen.getByRole("main").getAttribute("aria-label")).toBe(copy[language].availableLabel(74));
      });
    }
  }
});
