import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { endpoint } from "./release-gate.mjs";
const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [configText, backend, build, workflow, frontend, artifacts, overlay] = await Promise.all(["src-tauri/tauri.conf.json", "src-tauri/src/updater.rs", "src-tauri/build.rs", ".github/workflows/release.yml", "src/lib/updater.ts", "scripts/updater-artifacts.mjs", "scripts/write-updater-build-config.mjs"].map(read));
const config = JSON.parse(configText);
const requirePolicy = (condition, message) => { if (!condition) throw new Error(message); };
requirePolicy(config.identifier === "app.quotafloat.desktop" && config.bundle.createUpdaterArtifacts === false, "Base config must retain production ID and unsigned development artifact policy");
requirePolicy(!config.plugins?.updater && !configText.includes("updater-test") && !configText.includes("127.0.0.1"), "No QA endpoint or test keys in production config");
const endpointConstants = [...backend.matchAll(/pub const ENDPOINT: &str\s*=\s*"([^"]+)"/g)];
requirePolicy(endpointConstants.length === 1 && endpointConstants[0][1] === endpoint, "Production updater endpoint must match fixed canonical HTTPS manifest");
requirePolicy(backend.includes('option_env!("CODEX_MONITOR_UPDATER_PUBLIC_KEY")') && !backend.includes("TAURI_SIGNING_PRIVATE_KEY"), "Runtime uses compile-time public key only");
for (const name of await readdir(resolve(root, "src-tauri/capabilities"))) {
  if (!name.endsWith(".json")) continue;
  const capability = JSON.parse(await read(`src-tauri/capabilities/${name}`));
  requirePolicy(!JSON.stringify(capability.permissions).includes("updater:"), "JS must not receive updater plugin permissions");
}
requirePolicy(!frontend.includes("@tauri-apps/plugin-updater"), "Frontend must use private Rust command bridge");
// Check only scheduled section: user-triggered download/install commands remain permitted.
const scheduled = backend.slice(backend.indexOf("pub fn start("), backend.indexOf("#[tauri::command]", backend.indexOf("pub fn start(")));
requirePolicy(scheduled.includes(".check(") && !/\.download\(|\.install\(|download_and_install/.test(scheduled), "Background schedule must check only; download/install require user action");
for (const fragment of ["!release || !key.trim().is_empty()", "!release || (!test && endpoint.is_none())", "endpoint.is_none() || test", "app.codexmonitor.updater-test"]) requirePolicy(build.includes(fragment), `Missing build isolation guard: ${fragment}`);
for (const fragment of ["workflow_dispatch:", "github.repository == 'bennick1/codex-monitor'", "github.ref == 'refs/heads/main'", "needs.gate.outputs.sha", "environment: release", "node scripts/release-gate.mjs", "node scripts/updater-artifacts.mjs assemble", "--draft", "node scripts/verify-release-assets.mjs", "--draft=false"]) requirePolicy(workflow.includes(fragment), `Missing release gate: ${fragment}`);
requirePolicy(!/^  (push|pull_request):/m.test(workflow), "Push/PR cannot trigger publication");
requirePolicy(workflow.indexOf("node scripts/verify-release-assets.mjs") < workflow.indexOf("--draft=false"), "Complete draft verification must precede publication");
requirePolicy(artifacts.includes('"verify_updater_signature"') && artifacts.includes("await verifySignature(updateSource, signatureSource)") && artifacts.includes("provenance.identity?.identifier") && artifacts.includes("verificationKeySha256"), "Artifact collection must verify real identity and signatures before manifest");
requirePolicy(overlay.includes("CODEX_MONITOR_RELEASE_BUILD") && overlay.includes("CODEX_MONITOR_UPDATER_TEST_ENDPOINT") && overlay.includes("endpoints: [endpoint]"), "Production CLI overlay must reject QA config and use fixed endpoint");
console.log("在线更新策略：固定正式源、私钥隔离、仅后台检查、QA隔离、双平台完整发布门禁通过（静态检查）");
