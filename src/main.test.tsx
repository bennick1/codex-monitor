// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("react-dom/client", () => ({ default: { createRoot: () => ({ render: (node: ReactNode) => render(node) }) } }));
vi.mock("./App", () => ({ default: () => <div>Default widget</div> }));
vi.mock("./components/DesignPlayground", () => ({ DesignPlayground: () => <div>Default designer</div> }));
afterEach(() => { cleanup(); vi.resetModules(); });

for (const query of ["?supporter", "?supporter&skin=blur", "?supporter&skin=computer", "?license=old"]) {
  it(`obsolete URL ${query} renders only the default widget`, async () => {
    window.history.replaceState(null, "", query);
    await import("./main");
    expect(screen.getByText("Default widget")).toBeTruthy();
  });
}
