// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UpdateWindow } from "./UpdateWindow";
import { INITIAL_UPDATE_STATE, type UpdateState } from "../lib/updater";
const api = vi.hoisted(() => ({ get: vi.fn(), check: vi.fn(), download: vi.fn(), install: vi.fn(), listen: vi.fn(), release: vi.fn(), handler: undefined as undefined | ((value: UpdateState) => void) }));
vi.mock("../lib/updater", async importOriginal => ({ ...await importOriginal<typeof import("../lib/updater")>(), getUpdaterState: api.get, checkForUpdates: api.check, downloadUpdate: api.download, installUpdate: api.install, listenUpdaterState: api.listen }));
vi.mock("../lib/bridge", () => ({ isTauri: () => true }));
vi.mock("../lib/releasePage", () => ({ openReleasePage: api.release }));
const available: UpdateState = { ...INITIAL_UPDATE_STATE, configured: true, currentVersion: "1.0", phase: "available", version: "2.0", notes: "<script>alert('test')</script>\nNotes" };
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(available); api.listen.mockImplementation(async handler => { api.handler = handler; return () => {}; }); api.download.mockResolvedValue({ ...available, phase: "ready" }); api.install.mockResolvedValue({ ...available, phase: "installing" }); api.check.mockResolvedValue({ ...INITIAL_UPDATE_STATE, configured: true, checkedAt: "2026-10-13" }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("UpdateWindow", () => {
  it("keeps release notes as text and requires download before install", async () => {
    render(<UpdateWindow />);
    const download = await screen.findByText("下载更新");
    expect(screen.queryByText("安装并重启")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/<script>/).textContent).toContain("<script>");
    fireEvent.click(download);
    const install = await screen.findByText("安装并重启");
    expect(api.install).not.toHaveBeenCalled();
    fireEvent.click(install);
    await waitFor(() => expect(api.install).toHaveBeenCalledOnce());
  });
  it("prevents repeated clicks and displays unknown download size", async () => {
    let resolve!: (value: UpdateState) => void;
    api.download.mockReturnValue(new Promise<UpdateState>(done => { resolve = done; }));
    render(<UpdateWindow />);
    const download = await screen.findByText("下载更新");
    fireEvent.click(download); fireEvent.click(download);
    expect(api.download).toHaveBeenCalledOnce();
    api.handler?.({ ...available, phase: "downloading", downloadedBytes: 1234 });
    expect(await screen.findByText(/总大小未知/)).toBeTruthy();
    expect((screen.getByText("检查更新") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("检查更新"));
    expect(api.check).not.toHaveBeenCalled();
    expect(screen.getByRole("progressbar").hasAttribute("value")).toBe(false);
    api.handler?.({ ...available, phase: "ready" });
    resolve({ ...available, phase: "ready" });
    await screen.findByText("安装并重启");
  });
  it("resynchronizes state when reopened without cancelling download", async () => {
    api.get.mockResolvedValue({ ...available, phase: "downloading" });
    const first = render(<UpdateWindow />);
    await screen.findByText(/正在下载/);
    first.unmount();
    api.get.mockResolvedValue({ ...available, phase: "ready" });
    render(<UpdateWindow />);
    await screen.findByText("安装并重启");
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.download).not.toHaveBeenCalled();
  });
  it("retries the failed stage and distinguishes unconfigured from no updates", async () => {
    api.get.mockResolvedValue({ ...available, phase: "error", errorStage: "download", error: "signature failed" });
    render(<UpdateWindow />);
    fireEvent.click(await screen.findByText("重试下载"));
    await screen.findByText("安装并重启");
    cleanup();
    api.get.mockResolvedValue(INITIAL_UPDATE_STATE);
    render(<UpdateWindow />);
    expect(await screen.findByText(/未配置在线更新/)).toBeTruthy();
    fireEvent.click(screen.getByText("检查更新"));
    expect(await screen.findByText("当前已是最新版本。")).toBeTruthy();
  });
});

it("responds to system appearance changes while open and removes its listener", async () => {
  let change: (() => void) | undefined;
  const remove = vi.fn();
  const media = { matches: false, addEventListener: vi.fn((_event, listener) => { change = listener; }), removeEventListener: remove };
  vi.stubGlobal("matchMedia", () => media);
  const view = render(<UpdateWindow />);
  await screen.findByText("下载更新");
  expect(screen.getByRole("main").className).toContain("--light");
  act(() => { media.matches = true; change?.(); });
  expect(screen.getByRole("main").className).toContain("--dark");
  view.unmount();
  expect(remove).toHaveBeenCalledWith("change", change);
});
