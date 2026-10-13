import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const repository = "bennick1/codex-monitor";
export const endpoint = `https://github.com/${repository}/releases/latest/download/latest.json`;
export function stableVersion(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error("Expected stable semver");
  return value.split(".").map(BigInt);
}
export function validateGate({ event, repo, ref, version, cargoVersion, tauriVersion, latestVersion, tagExists, sourceSha }) {
  if (event !== "workflow_dispatch" || repo !== repository || ref !== "refs/heads/main") throw new Error("Only manual dispatch on canonical main can release");
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("Invalid frozen source SHA");
  const current = stableVersion(version);
  if (cargoVersion !== version || tauriVersion !== version) throw new Error("Package/Cargo/Tauri version mismatch");
  const latest = stableVersion(latestVersion.replace(/^v/, ""));
  const comparison = current.findIndex((part, i) => part !== latest[i]);
  if (comparison < 0 || current[comparison] < latest[comparison]) throw new Error("Version must exceed latest published release");
  if (tagExists) throw new Error("Release tag already exists");
  return { version, tag: `v${version}`, sourceSha };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
  const cargo = await readFile("src-tauri/Cargo.toml", "utf8");
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
  const latestVersion = gh("api", `repos/${repository}/releases/latest`, "--jq", ".tag_name");
  // List matching refs: network failures must propagate, never count as tag absence.
  const tags = JSON.parse(gh("api", `repos/${repository}/git/matching-refs/tags/v${pkg.version}`));
  const result = validateGate({ event: process.env.GITHUB_EVENT_NAME, repo: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF, sourceSha: process.env.GITHUB_SHA, version: pkg.version, cargoVersion, tauriVersion: config.version, latestVersion, tagExists: tags.some(t => t.ref === `refs/tags/v${pkg.version}`) });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_OUTPUT, `version=${result.version}\ntag=${result.tag}\nsha=${result.sourceSha}\n`);
  }
}
