import { isTauri } from "./bridge";

export const RELEASE_URL = "https://github.com/bennick1/codex-monitor/releases";

export async function openReleasePage(): Promise<void> {
  if (!isTauri()) {
    window.open(RELEASE_URL, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(RELEASE_URL);
}
