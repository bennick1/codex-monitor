import { isTauri } from "./bridge";

export interface UpdateState {
  phase: "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";
  configured: boolean;
  currentVersion: string;
  version: string | null;
  notes: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
  errorStage: "check" | "download" | "install" | null;
  checkedAt: string | null;
}
export const INITIAL_UPDATE_STATE: UpdateState = { phase: "idle", configured: false, currentVersion: "—", version: null, notes: null, downloadedBytes: 0, totalBytes: null, error: null, errorStage: null, checkedAt: null };
async function command(name: string): Promise<UpdateState> {
  if (!isTauri()) return { ...INITIAL_UPDATE_STATE, currentVersion: "Preview", checkedAt: new Date().toISOString() };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<UpdateState>(name);
}
export const getUpdaterState = () => command("get_updater_state");
export const checkForUpdates = () => command("check_for_updates");
export const downloadUpdate = () => command("download_update");
export const installUpdate = () => command("install_update");
export async function openUpdateWindow(): Promise<void> {
  if (!isTauri()) { window.open("?updates=1", "updater"); return; }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_update_window");
}
export async function listenUpdaterState(handler: (state: UpdateState) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<UpdateState>("updater-state-changed", event => handler(event.payload));
}
