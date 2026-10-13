import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const output = process.argv[2];
const platform = process.env.PLATFORM;
const bundle = process.env.BUNDLE_DIR;
if (!output || !bundle || !["macos", "windows"].includes(platform)) throw new Error("Expected output, platform and bundle");
const run = (command, args) => execFileSync(command, args, { encoding: "utf8", shell: process.platform === "win32" && ["npm", "npx"].includes(command) }).trim();
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const sourceSha = run("git", ["rev-parse", "HEAD"]);
if (sourceSha !== process.env.SOURCE_SHA || config.identifier !== "app.quotafloat.desktop" || process.env.CODEX_MONITOR_RELEASE_BUILD !== "1" || process.env.CODEX_MONITOR_UPDATER_TEST_BUILD || process.env.CODEX_MONITOR_UPDATER_TEST_ENDPOINT) throw new Error("Invalid production build provenance");
let identity;
let binary;
if (platform === "macos") {
  const app = join(bundle, "macos", "Codex Monitor.app");
  const plist = join(app, "Contents", "Info.plist");
  const value = key => run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist]);
  identity = { identifier: value("CFBundleIdentifier"), version: value("CFBundleShortVersionString"), productName: value("CFBundleDisplayName"), method: "actual macOS bundle Info.plist" };
  binary = join(app, "Contents", "MacOS", value("CFBundleExecutable"));
} else {
  binary = resolve(bundle, "..", "codex-monitor.exe");
  // Pass the path through an environment variable rather than shell interpolation.
  process.env.RELEASE_BINARY_PATH = binary;
  const metadata = JSON.parse(run("pwsh", ["-NoProfile", "-Command", "$v=(Get-Item -LiteralPath $env:RELEASE_BINARY_PATH).VersionInfo; @{version=$v.ProductVersion;productName=$v.ProductName} | ConvertTo-Json -Compress"]));
  identity = { identifier: config.identifier, version: metadata.version?.replace(/\.0$/, match => metadata.version.split(".").length === 4 ? "" : match), productName: metadata.productName, method: "actual Windows binary VERSIONINFO plus frozen production config" };
}
if (identity.identifier !== "app.quotafloat.desktop" || identity.version !== config.version || identity.productName !== "Codex Monitor") throw new Error("Actual bundle identity/version mismatch or QA artifact");
const binarySha256 = createHash("sha256").update(await readFile(binary)).digest("hex");
await mkdir(output, { recursive: true });
await writeFile(join(output, `${platform}-build-environment.json`), JSON.stringify({ sourceSha, platform, arch: process.arch, identity, binarySha256, qa: false, releaseBuild: true, node: process.version, npm: run("npm", ["--version"]), rust: run("rustc", ["--version"]), tauri: run("npx", ["tauri", "--version"]), runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`, builtAt: new Date().toISOString(), updaterSigned: true, platformSigning: "Developer ID/notarization/Authenticode not configured" }, null, 2));
