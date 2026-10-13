// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CSSProperties } from "react";
import type { WidgetSkin, WidgetTheme } from "../types";
import { DesignPlayground } from "./DesignPlayground";

type PreviewProps = { skin: WidgetSkin; theme: WidgetTheme; style: CSSProperties };
vi.mock("./QuotaCard", () => ({
  QuotaCard: ({ skin, theme, style }: PreviewProps) => <div data-testid="card" data-skin={skin} data-theme={theme} style={style} />,
  QuotaOrb: ({ skin, theme, style }: PreviewProps) => <div data-testid="orb" data-skin={skin} data-theme={theme} style={style} />,
}));
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

it("selects every registered skin and keeps selection when switching preview language", () => {
  window.history.replaceState(null, "", "?skin=mecha-light&theme=dark");
  render(<DesignPlayground />);
  expect(screen.getByTestId("card").dataset.skin).toBe("mecha-light");
  expect(screen.getByTestId("card").dataset.theme).toBe("dark");
  const selector = within(screen.getByRole("group", { name: "预览皮肤" }));
  expect(selector.getByRole("button", { name: "浅色机甲" }).getAttribute("aria-pressed")).toBe("true");
  for (const [label, skin] of [["Blur", "blur"], ["Computer", "computer"], ["默认皮肤", "default"], ["浅色机甲", "mecha-light"]]) {
    fireEvent.click(selector.getByRole("button", { name: label }));
    expect(screen.getByTestId("card").dataset.skin).toBe(skin);
    expect(selector.getAllByRole("button", { pressed: true })).toHaveLength(1);
  }
  fireEvent.click(screen.getByRole("button", { name: "English" }));
  expect(screen.getByRole("button", { name: "Mecha Light" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByTestId("card").dataset.skin).toBe("mecha-light");
});

it("passes the Mecha selection to the existing collapsed preview", () => {
  window.history.replaceState(null, "", "?skin=mecha-light&mode=orb&language=en");
  render(<DesignPlayground />);
  const orb = screen.getByTestId("orb");
  expect(orb.dataset.skin).toBe("mecha-light");
  expect(orb.style.getPropertyValue("--cool")).toBe("");
});

it("falls back to Default for an unsupported preview skin", () => {
  window.history.replaceState(null, "", "?skin=mecha-dark");
  render(<DesignPlayground />);
  expect(screen.getByTestId("card").dataset.skin).toBe("default");
});
