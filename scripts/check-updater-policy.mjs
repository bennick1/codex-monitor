import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = async (path) => readFile(resolve(root, path), "utf8");
const files = {
  package: await read("package.json"),
  cargo: await read("src-tauri/Cargo.toml"),
  config: await read("src-tauri/tauri.conf.json"),
  capability: await read("src-tauri/capabilities/default.json"),
  generatedCapability: await read("src-tauri/gen/schemas/capabilities.json"),
  rust: await read("src-tauri/src/lib.rs"),
  app: await read("src/App.tsx"),
  releasePage: await read("src/lib/releasePage.ts"),
};

const runtime = Object.values(files).join("\n");
const forbidden = [
  "change-42-yhmm/quota-float/releases",
  "tauri-plugin-updater",
  "@tauri-apps/plugin-updater",
  "updater:default",
  "createUpdaterArtifacts\": true",
  "update-check-requested",
  ".updater()",
  "downloadAndInstall",
];
for (const value of forbidden) {
  if (runtime.includes(value)) throw new Error(`Forbidden runtime updater reference: ${value}`);
}
const releaseUrl = "https://github.com/bennick1/codex-monitor/releases";
if (!files.releasePage.includes(releaseUrl) || !files.capability.includes(`"url": "${releaseUrl}"`)) {
  throw new Error("Manual update page must target bennick1/codex-monitor releases.");
}
if (!files.config.includes('"createUpdaterArtifacts": false')) {
  throw new Error("Updater artifact generation must remain disabled.");
}
console.log("V1 manual GitHub Release update policy: verified");
