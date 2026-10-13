import { useEffect, useRef, useState } from "react";
import { isTauri } from "../lib/bridge";
import { openReleasePage } from "../lib/releasePage";
import { checkForUpdates, downloadUpdate, installUpdate, type UpdateState } from "../lib/updater";
import { useUpdater } from "../hooks/useUpdater";
import "./updateWindow.css";

export function UpdateWindow() {
  const { state, execute, connectionError } = useUpdater();
  const query = new URLSearchParams(window.location.search);
  const zh = query.get("language") !== "en";
  const appearance = query.get("appearance");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const theme = appearance === "dark" || appearance === "light" ? appearance : systemDark ? "dark" : "light";
  useEffect(() => {
    if (appearance === "dark" || appearance === "light") return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const change = () => setSystemDark(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [appearance]);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const lock = useRef(false);
  const words = (cn: string, en: string) => zh ? cn : en;
  useEffect(() => {
    document.body.classList.add("update-window-body");
    return () => document.body.classList.remove("update-window-body");
  }, []);
  async function run(operation: () => Promise<UpdateState>) {
    if (lock.current) return;
    lock.current = true; setPending(true); setFailure(null);
    try { await execute(operation); } catch (error) { setFailure(String(error)); }
    finally { lock.current = false; setPending(false); }
  }
  const busy = pending || ["checking", "downloading", "installing"].includes(state.phase);
  const downloadRetry = state.phase === "error" && state.errorStage === "download";
  const installRetry = state.phase === "error" && state.errorStage === "install";
  const status = state.phase === "checking" ? words("正在检查更新…", "Checking for updates…")
    : state.phase === "downloading" ? words("正在下载；关闭窗口不会取消下载。", "Downloading. Closing this window will not cancel the download.")
    : state.phase === "ready" ? words("下载和验签完成，可以安装并重启。", "Download and signature verification complete. Ready to install and restart.")
    : state.phase === "installing" ? words("正在安装并重启…", "Installing and restarting…")
    : state.phase === "available" ? words("有新版本可下载。", "A new version is available.")
    : state.phase === "error" ? words("更新失败，请重试。", "Update failed. Please retry.")
    : !state.configured ? words("此构建未配置在线更新，请使用版本下载页。", "Online updates are not configured for this build. Use release downloads.")
    : state.checkedAt ? words("当前已是最新版本。", "You are up to date.") : words("点击检查更新以获取新版本。", "Check for updates to find a new version.");
  const total = state.totalBytes && state.totalBytes > 0 ? state.totalBytes : null;
  const bytes = (value: number) => `${(value / 1048576).toFixed(1)} MB`;
  return <main className={`update-window update-window--${theme}`}>
    <h1>{words("软件更新", "Software update")}</h1>
    {!isTauri() && <p className="update-preview">{words("浏览器界面预览，不会下载或安装更新。", "Browser UI preview. No updates will be downloaded or installed.")}</p>}
    <dl><dt>{words("当前版本", "Current version")}</dt><dd>{state.currentVersion}</dd>{state.version && <><dt>{words("新版本", "New version")}</dt><dd>{state.version}</dd></>}</dl>
    <p role="status" aria-live="polite">{status}</p>
    {state.phase === "downloading" && <div><progress aria-label={words("下载进度", "Download progress")} max={total ?? undefined} value={total ? Math.min(state.downloadedBytes, total) : undefined} /><p>{bytes(state.downloadedBytes)}{total ? ` / ${bytes(total)}` : words(" · 总大小未知", " · Total size unknown")}</p></div>}
    {state.notes && <section><h2>{words("发布说明", "Release notes")}</h2><pre>{state.notes}</pre></section>}
    {(failure || connectionError || state.error) && <p role="alert" className="update-error">{failure || connectionError || state.error}</p>}
    <div className="update-actions">
      <button disabled={busy || state.phase === "ready"} onClick={() => void run(checkForUpdates)}>{words("检查更新", "Check for updates")}</button>
      {(state.phase === "available" || downloadRetry) && <button disabled={busy} onClick={() => void run(downloadUpdate)}>{downloadRetry ? words("重试下载", "Retry download") : words("下载更新", "Download update")}</button>}
      {(state.phase === "ready" || installRetry) && <button disabled={busy} onClick={() => void run(installUpdate)}>{installRetry ? words("重试安装并重启", "Retry install and restart") : words("安装并重启", "Install and restart")}</button>}
      <button onClick={() => void openReleasePage().catch(error => setFailure(String(error)))}>{words("打开版本下载页", "Release downloads")}</button>
    </div>
  </main>;
}
