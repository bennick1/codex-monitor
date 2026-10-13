// Local-only QA harness. Never invoke against the production application.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, readdir, chmod, access, cp, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
const [mode, directory = "outputs/updater-qa", argument = "normal"] = process.argv.slice(2);
const root = resolve(directory);
const port = 18765;
const endpoint = `http://127.0.0.1:${port}/latest.json`;
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} failed`);
};
await mkdir(root, { recursive: true });
if (mode === "prepare") {
  await mkdir(join(root, "empty-codex-home"), { recursive: true });
  // Test-only key; never print its private content or use it for a production build.
  try { await access(join(root, "test.key")); throw new Error("Existing test key: reuse it or choose a fresh output directory"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const generated = spawnSync("npx", ["tauri", "signer", "generate", "--ci", "-p", "", "-w", join(root, "test.key")], { encoding: "utf8", shell: process.platform === "win32" });
  // The CLI can print key content: suppress all output, including failure output.
  if (generated.status !== 0) throw new Error("Test signer generation failed; inspect CLI usage without printing key material");
  await chmod(join(root, "test.key"), 0o600);
  for (const version of ["0.0.1", "0.0.2"]) await writeFile(join(root, `${version}.json`), JSON.stringify({ version, identifier: "app.codexmonitor.updater-test.local", productName: "Codex Monitor Updater QA", bundle: { createUpdaterArtifacts: true, macOS: { signingIdentity: "-" } } }, null, 2));
  console.log(`QA配置与独立测试密钥已生成：${root}`);
} else if (mode === "build") {
  if (!["0.0.1", "0.0.2"].includes(argument)) throw new Error("QA version must be A=0.0.1 or B=0.0.2");
  const key = (await readFile(join(root, "test.key"), "utf8")).trim();
  const pubkey = (await readFile(join(root, "test.key.pub"), "utf8")).trim();
  const overlayPath = join(root, `${argument}.json`);
  const overlay = JSON.parse(await readFile(overlayPath, "utf8"));
  if (overlay.identifier !== "app.codexmonitor.updater-test.local" || overlay.version !== argument || overlay.productName !== "Codex Monitor Updater QA") throw new Error("Unexpected QA overlay identity/version");
  overlay.plugins = { updater: { pubkey, endpoints: [endpoint], dangerousInsecureTransportProtocol: true } };
  await writeFile(overlayPath, JSON.stringify(overlay, null, 2));
  const target = join(root, "target-build");
  const env = { ...process.env, CODEX_MONITOR_RELEASE_BUILD: "", CODEX_MONITOR_UPDATER_TEST_BUILD: "1", CODEX_MONITOR_UPDATER_TEST_ENDPOINT: endpoint, CODEX_MONITOR_UPDATER_PUBLIC_KEY: pubkey, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "", CARGO_TARGET_DIR: target, CODEX_HOME: join(root, "empty-codex-home") };
  run("npx", ["tauri", "build", "--bundles", process.platform === "darwin" ? "app,dmg" : "nsis", "--config", join(root, `${argument}.json`)], env);
  await cp(join(target, "release", "bundle"), join(root, `target-${argument}`, "release", "bundle"), { recursive: true, force: false, errorOnExist: true });
} else if (mode === "serve") {
  if (!["normal", "missing", "bad-signature", "older", "same", "missing-platform", "bad-download", "slow", "chunked", "interrupted", "bad-install"].includes(argument)) throw new Error("Unknown server scenario");
  const bundle = join(root, "target-0.0.2", "release", "bundle");
  const platform = process.platform === "darwin" ? "darwin-aarch64" : "windows-x86_64";
  const subdir = process.platform === "darwin" ? "macos" : "nsis";
  const suffix = process.platform === "darwin" ? ".app.tar.gz" : "-setup.exe";
  const names = await readdir(join(bundle, subdir));
  const updates = names.filter(n => n.endsWith(suffix));
  if (updates.length !== 1) throw new Error("Expected one signed B update archive");
  const asset = updates[0];
  const signature = (await readFile(join(bundle, subdir, `${asset}.sig`), "utf8")).trim();
  let servedSignature = signature;
  let payloadPath = join(bundle, subdir, asset);
  if (argument === "bad-install") {
    if (process.platform !== "darwin") throw new Error("bad-install is macOS-only; Windows installation safety not established");
    // tauri-plugin-updater 2.9.0 parses gzip/tar into a temp directory before
    // renaming the current .app. Invalid gzip fails before any app mutation.
    const fixture = join(root, "fixtures", "signed-not-gzip.app.tar.gz");
    await mkdir(join(root, "fixtures"), { recursive: true });
    await writeFile(fixture, "Codex Monitor isolated QA: deliberately invalid gzip payload\n");
    const signed = spawnSync("npx", ["tauri", "signer", "sign", "--private-key-path", join(root, "test.key"), fixture], {
      encoding: "utf8", shell: process.platform === "win32",
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" },
    });
    // Suppress signer output to keep all private key material out of logs.
    if (signed.status !== 0) throw new Error("QA bad-install fixture signing failed");
    servedSignature = (await readFile(`${fixture}.sig`, "utf8")).trim();
    payloadPath = fixture;
  }
  if (argument === "bad-signature") {
    const aDirectory = join(root, "target-0.0.1", "release", "bundle", subdir);
    const aSignatures = (await readdir(aDirectory)).filter(name => name.endsWith(`${suffix}.sig`));
    if (aSignatures.length !== 1) throw new Error("Expected exactly one A signature for real B verification failure");
    servedSignature = (await readFile(join(aDirectory, aSignatures[0]), "utf8")).trim();
  }
  const manifest = { version: argument === "older" ? "0.0.0" : argument === "same" ? "0.0.1" : "0.0.2", notes: "隔离 QA 更新", pub_date: new Date().toISOString(), platforms: argument === "missing-platform" ? {} : { [platform]: { signature: servedSignature, url: `http://127.0.0.1:${port}/${encodeURIComponent(asset)}` } } };
  createServer(async (req, res) => {
    console.log(`${new Date().toISOString()} ${req.url?.split("?")[0]}`);
    try {
      if (req.url === "/latest.json" && argument !== "missing") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(manifest)); }
      else if (req.url === `/${encodeURIComponent(asset)}` && argument !== "bad-download") {
        const bytes = await readFile(payloadPath);
        if (argument !== "chunked") res.setHeader("Content-Length", bytes.length);
        if (argument === "interrupted") {
          // Announce full length, deliver a bounded prefix, then break transport.
          res.write(bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 4))));
          await new Promise(done => setTimeout(done, 150));
          res.destroy();
        } else if (argument === "slow" || argument === "chunked") {
          for (let offset = 0; offset < bytes.length && !res.destroyed; offset += 64 * 1024) {
            res.write(bytes.subarray(offset, offset + 64 * 1024));
            await new Promise(done => setTimeout(done, 150));
          }
          res.end();
        } else res.end(bytes);
      }
      else { res.statusCode = 404; res.end("QA missing resource"); }
    } catch { res.statusCode = 500; res.end("QA server failure"); }
  }).listen(port, "127.0.0.1", () => console.log(`仅QA监听 ${endpoint}，场景=${argument}`));
} else if (mode === "launch" || mode === "start") {
  if (process.platform !== "darwin") throw new Error("Windows: launch installed QA exe with empty CODEX_HOME; see docs/UPDATER-QA.md");
  const source = join(root, "target-0.0.1", "release", "bundle", "macos", "Codex Monitor Updater QA.app");
  const app = join(root, "installed", "Codex Monitor Updater QA.app");
  if (mode === "launch") await cp(source, app, { recursive: true, force: false, errorOnExist: true });
  const executable = join(app, "Contents", "MacOS", "codex-monitor");
  await access(executable);
  const logPath = join(root, "qa-app.log");
  const log = await open(logPath, "a", 0o600);
  try {
    const child = spawn(executable, [], {
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: { ...process.env, CODEX_HOME: join(root, "empty-codex-home"), CODEX_MONITOR_SYNTHETIC_QUOTA: "1" },
    });
    await new Promise((done, reject) => { child.once("spawn", done); child.once("error", reject); });
    child.unref();
    await writeFile(join(root, "qa-launch.json"), JSON.stringify({ pid: child.pid, executable, logPath, startedAt: new Date().toISOString() }, null, 2));
    console.log(`QA 已独立启动，PID=${child.pid}，路径=${executable}，日志=${logPath}`);
  } finally { await log.close(); }
} else throw new Error("Usage: updater-qa.mjs prepare|build|serve|launch|start [output-dir] [version|scenario]");
