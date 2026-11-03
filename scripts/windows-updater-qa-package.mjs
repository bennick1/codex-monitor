// Windows-only distributable QA kit. Never reads a production signing key.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectPayload } from "./updater-artifacts.mjs";
import { deriveNsisBinaryIdentity } from "./windows-nsis-provenance.mjs";
import { auditWindowsQaSource } from "./windows-qa-source.mjs";

const identifier = "app.codexmonitor.updater-test.local";
const productName = "Codex Monitor Updater QA";
const binaryName = "codex-monitor-updater-qa.exe";
const endpoint = "http://127.0.0.1:18765/latest.json";
const versions = ["0.0.1", "0.0.2"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sha = async file => hash(await readFile(file));
const cli = (name, args, options = {}) => execFileSync(name, args, { encoding: "utf8", ...options }).trim();

export function validateOverlay(overlay, version) {
  if (!versions.includes(version) || overlay.version !== version || overlay.identifier !== identifier || overlay.productName !== productName || overlay.mainBinaryName !== binaryName.slice(0, -4) || overlay.bundle?.createUpdaterArtifacts !== true) throw new Error("Unexpected QA identity/version");
  if (overlay.plugins?.updater?.endpoints?.length !== 1 || overlay.plugins.updater.endpoints[0] !== endpoint || overlay.plugins.updater.dangerousInsecureTransportProtocol !== true || !overlay.plugins.updater.pubkey?.trim()) throw new Error("Expected isolated QA public key and loopback endpoint");
}

export function inspectPe(bytes) {
  if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) throw new Error("Invalid DOS header");
  const pe = bytes.readUInt32LE(0x3c);
  if (pe < 64 || pe + 24 + 70 > bytes.length || bytes.readUInt32LE(pe) !== 0x00004550) throw new Error("Invalid PE header");
  if (bytes.readUInt16LE(pe + 4) !== 0x8664 || bytes.readUInt16LE(pe + 24) !== 0x20b || bytes.readUInt16LE(pe + 24 + 68) !== 2) throw new Error("Expected Windows x64 GUI application");
  return { architecture: "x64", subsystem: "GUI" };
}

async function source(root, version) {
  const overlay = JSON.parse(await readFile(join(root, `${version}.json`), "utf8"));
  validateOverlay(overlay, version);
  const bundle = join(root, `target-${version}`, "release", "bundle", "nsis");
  const files = (await readdir(bundle)).filter(name => name.endsWith("-setup.exe"));
  if (files.length !== 1) throw new Error("Expected one QA NSIS installer");
  return { overlay, installer: join(bundle, files[0]) };
}

async function snapshot(root, version) {
  if (process.platform !== "win32") throw new Error("Record actual VERSIONINFO on Windows");
  const { installer } = await source(root, version);
  const binary = join(root, "target-build", "release", binaryName);
  const pe = inspectPe(await readFile(binary));
  const info = JSON.parse(cli("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$v=(Get-Item -LiteralPath $env:CM_QA_BINARY).VersionInfo; @{ productName=$v.ProductName; version=('{0}.{1}.{2}' -f $v.FileMajorPart,$v.FileMinorPart,$v.FileBuildPart) } | ConvertTo-Json -Compress"], { env: { ...process.env, CM_QA_BINARY: binary } }));
  if (info.productName !== productName || info.version !== version) throw new Error("QA actual binary VERSIONINFO mismatch");
  const record = { identity: { identifier, binaryName, ...info }, ...deriveNsisBinaryIdentity(await readFile(binary)), ...pe };
  record.payloadIdentity = inspectPayload("windows", installer, record);
  await writeFile(join(root, `${version}-identity.json`), JSON.stringify(record, null, 2), { flag: "wx" });
  console.log(`Verified ${version} Windows x64 GUI binary and exact NSIS member`);
}

export function validateRecords(records, publicKey, sourceSha) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("Expected exact source commit");
  if (records.length !== 2) throw new Error("Both QA versions required");
  for (const [index, record] of records.entries()) {
    if (record.identity?.version !== versions[index] || record.identity?.identifier !== identifier || record.identity?.productName !== productName || record.identity?.binaryName !== binaryName || record.payloadIdentity?.binaryName !== binaryName || !/^[a-f0-9]{64}$/.test(record.binarySha256) || record.payloadIdentity?.binarySha256 !== record.binarySha256) throw new Error("Unverified QA payload identity");
    if (record.publicKey !== publicKey || record.signatureVerified !== true) throw new Error("QA signatures must use the same verified public key");
  }
}

async function makePackage(root, output) {
  if (process.platform !== "win32") throw new Error("Assemble on the Windows build runner");
  const sourceSha = cli("git", ["rev-parse", "HEAD"]);
  if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== sourceSha) throw new Error("Checkout differs from dispatched SHA");
  const sourceValidation = await auditWindowsQaSource();
  await writeFile(join(root, "source-diagnostics.json"), JSON.stringify(sourceValidation, null, 2));
  if (!sourceValidation.accepted || sourceValidation.sourceSha !== sourceSha) {
    console.error(JSON.stringify({ reason: sourceValidation.reason, trackedChanges: sourceValidation.trackedChanges, diffstat: sourceValidation.diffstat }));
    throw new Error("QA source provenance rejected; see public source-diagnostics.json");
  }
  const publicKey = (await readFile(join(root, "test.key.pub"), "utf8")).trim();
  const verifier = process.env.CODEX_MONITOR_SIGNATURE_VERIFY_BIN;
  if (!verifier) throw new Error("Existing mature signature verifier is required");
  const records = [];
  for (const version of versions) {
    const { installer, overlay } = await source(root, version);
    if (overlay.plugins.updater.pubkey !== publicKey) throw new Error("QA build public keys differ");
    execFileSync(verifier, [installer, `${installer}.sig`], { env: { ...process.env, CODEX_MONITOR_UPDATER_PUBLIC_KEY: publicKey }, stdio: "inherit" });
    const record = JSON.parse(await readFile(join(root, `${version}-identity.json`), "utf8"));
    inspectPayload("windows", installer, record);
    records.push({ ...record, installer, signatureVerified: true, publicKey });
  }
  validateRecords(records, publicKey, sourceSha);
  // Refuse reuse and copy only explicit public assets, never the QA build tree.
  await mkdir(output);
  const names = ["A-0.0.1-setup.exe", "B-0.0.2-setup.exe"];
  for (const [index, record] of records.entries()) {
    await copyFile(record.installer, join(output, names[index]));
    await copyFile(`${record.installer}.sig`, join(output, `${names[index]}.sig`));
  }
  const signature = (await readFile(join(output, `${names[1]}.sig`), "utf8")).trim();
  const manifest = { version: "0.0.2", notes: "Windows isolated QA A to B. Synthetic data only; not a production release.", pub_date: new Date().toISOString(), platforms: { "windows-x86_64": { signature, url: "http://127.0.0.1:18765/B-0.0.2-setup.exe" } } };
  await writeFile(join(output, "latest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(output, "qa-public-key.pub"), `${publicKey}\n`);
  await mkdir(join(output, "scripts"));
  for (const name of ["common.ps1", "action.ps1", "server.ps1"]) await copyFile(join("scripts", "windows-updater-qa", name), join(output, "scripts", name));
  const actions = { "01-Install-A": "install", "02-Start-QA": "start", "03-Seed-Stats-and-Start-A": "seed", "04-Start-Update-Server": "server", "05-Record-State": "snapshot", "06-Stop-Server-and-Check": "cleanup" };
  for (const [name, action] of Object.entries(actions)) await writeFile(join(output, `${name}.cmd`), `@echo off\r\nsetlocal\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\action.ps1" -Action ${action}\r\nset QA_EXIT=%ERRORLEVEL%\r\necho.\r\nif not "%QA_EXIT%"=="0" echo QA operation failed. Preserve the error and stop here.\r\npause\r\nexit /b %QA_EXIT%\r\n`);
  await copyFile(join("scripts", "windows-updater-qa", "README.zh-CN.txt"), join(output, "README.zh-CN.txt"));
  const provenance = {
    schema: 1, qa: true, releaseBuild: false, nativeAcceptance: "PENDING",
    sourceSha, sourceValidation, repository: "bennick1/codex-monitor", identifier, productName, binaryName,
    endpoint, publicKeySha256: hash(publicKey), generatedAt: new Date().toISOString(),
    runUrl: process.env.GITHUB_RUN_ID ? `https://github.com/bennick1/codex-monitor/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    tools: { node: process.version, rust: cli("rustc", ["--version"]), tauri: cli(process.execPath, ["node_modules/@tauri-apps/cli/tauri.js", "--version"]) },
    versions: await Promise.all(records.map(async (record, index) => ({ version: versions[index], binaryName, installer: names[index], installerSha256: await sha(join(output, names[index])), buildBinarySha256: record.buildBinarySha256, binarySha256: record.binarySha256, bundleType: record.bundleType, bundleMarkerOffset: record.bundleMarkerOffset, signatureVerified: true, payloadIdentity: record.payloadIdentity }))),
  };
  await writeFile(join(output, "QA-SOURCE.json"), JSON.stringify(provenance, null, 2));
  const all = [...(await readdir(output)).filter(name => name !== "scripts"), ...(await readdir(join(output, "scripts"))).map(name => `scripts/${name}`)].sort();
  await writeFile(join(output, "SHA256SUMS"), (await Promise.all(all.map(async name => `${await sha(join(output, name))}  ${name}`))).join("\n") + "\n");
  console.log(`QA package verified: source ${sourceSha}; actual Windows installation and upgrade remain pending`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, directory, argument] = process.argv.slice(2);
  if (!directory || !argument) throw new Error("Usage: windows-updater-qa-package.mjs snapshot <qa-dir> <version> | package <qa-dir> <new-share-dir>");
  if (mode === "snapshot") await snapshot(resolve(directory), argument);
  else if (mode === "package") await makePackage(resolve(directory), resolve(argument));
  else throw new Error("Unknown QA packaging mode");
}
