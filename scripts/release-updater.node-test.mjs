import test from "node:test";
import assert from "node:assert/strict";
import { validateGate } from "./release-gate.mjs";
import { validateInventories, selectWindowsPayloadMember } from "./updater-artifacts.mjs";
import { deriveNsisBinaryIdentity } from "./windows-nsis-provenance.mjs";

function rawWindowsPe() {
  const bytes = Buffer.alloc(1024);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(64, 0x3c);
  bytes.writeUInt32LE(0x4550, 64);
  bytes.writeUInt16LE(0x8664, 68);
  bytes.writeUInt16LE(240, 84);
  bytes.writeUInt16LE(0x20b, 88);
  bytes.writeUInt16LE(2, 156);
  bytes.writeUInt32LE(16, 196);
  Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK").copy(bytes, 512);
  return bytes;
}

const windowsProductionIdentity = { identifier: "app.quotafloat.desktop", productName: "Codex Monitor", version: "1.4.0" };
const windowsQaIdentity = { identifier: "app.codexmonitor.updater-test.local", productName: "Codex Monitor Updater QA", version: "0.0.1", binaryName: "codex-monitor-updater-qa.exe" };
test("Windows NSIS provenance binds separate production and QA process names", () => {
  assert.equal(selectWindowsPayloadMember("Path = installer.exe\r\nPath = codex-monitor.exe\r\nPath = uninstall.exe\r\n", windowsProductionIdentity), "codex-monitor.exe");
  assert.equal(selectWindowsPayloadMember("Path = $INSTDIR\\codex-monitor-updater-qa.exe\r\n", windowsQaIdentity), "$INSTDIR\\codex-monitor-updater-qa.exe");
  assert.throws(() => selectWindowsPayloadMember("Path = codex-monitor.exe\n", windowsQaIdentity), /exactly one isolated/);
  assert.throws(() => selectWindowsPayloadMember("Path = codex-monitor-updater-qa.exe\n", windowsProductionIdentity), /exactly one isolated/);
});
test("Windows NSIS provenance rejects mixed, duplicate, unsafe or spoofed executable identities", () => {
  for (const listing of ["Path = codex-monitor.exe\nPath = codex-monitor-updater-qa.exe\n", "Path = codex-monitor-updater-qa.exe\nPath = CODEX-MONITOR-UPDATER-QA.EXE\n", "Path = ../codex-monitor-updater-qa.exe\n", "Path = C:\\codex-monitor-updater-qa.exe\n"]) assert.throws(() => selectWindowsPayloadMember(listing, windowsQaIdentity));
  const qaListing = "Path = codex-monitor-updater-qa.exe\n";
  for (const patch of [{ binaryName: undefined }, { binaryName: "codex-monitor.exe" }, { binaryName: "../codex-monitor-updater-qa.exe" }, { identifier: "other.app" }, { productName: "Codex Monitor" }, { version: "1.4.0" }]) assert.throws(() => selectWindowsPayloadMember(qaListing, { ...windowsQaIdentity, ...patch }));
  assert.throws(() => selectWindowsPayloadMember("Path = codex-monitor.exe\n", { ...windowsProductionIdentity, binaryName: "codex-monitor-updater-qa.exe" }));
});

test("Windows NSIS provenance derives only the official bundle marker patch without mutating raw input", () => {
  const raw = rawWindowsPe();
  const before = Buffer.from(raw);
  const expected = Buffer.from(raw);
  Buffer.from("__TAURI_BUNDLE_TYPE_VAR_NSS").copy(expected, 512);
  const identity = deriveNsisBinaryIdentity(raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(identity, { buildBinarySha256: createHash("sha256").update(raw).digest("hex"), binarySha256: createHash("sha256").update(expected).digest("hex"), bundleType: "nsis", bundleMarkerOffset: 512 });
  assert.notEqual(identity.binarySha256, identity.buildBinarySha256);
  const unrelatedMutation = Buffer.from(expected); unrelatedMutation[800] ^= 1;
  assert.notEqual(createHash("sha256").update(unrelatedMutation).digest("hex"), identity.binarySha256, "unrelated payload changes still fail the exact hash comparison");
});
test("Windows NSIS provenance fails closed on missing, ambiguous, or already patched markers", () => {
  for (const marker of ["__TAURI_BUNDLE_TYPE_VAR_NSS", "__TAURI_BUNDLE_TYPE_VAR_MSI", "__TAURI_BUNDLE_TYPE_VAR_BAD"]) {
    const bytes = rawWindowsPe(); Buffer.from(marker).copy(bytes, 512);
    assert.throws(() => deriveNsisBinaryIdentity(bytes), /one unpatched/);
  }
  const duplicate = rawWindowsPe(); Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK").copy(duplicate, 700);
  assert.throws(() => deriveNsisBinaryIdentity(duplicate), /one unpatched/);
});
test("Windows NSIS provenance rejects signed, truncated, non-GUI or non-x64 PE input", () => {
  for (const offset of [232, 236]) {
    const signed = rawWindowsPe(); signed.writeUInt32LE(8, offset);
    assert.throws(() => deriveNsisBinaryIdentity(signed), /Authenticode/);
  }
  for (const [offset, value] of [[68, 0x14c], [88, 0x10b], [156, 3], [84, 80]]) {
    const bytes = rawWindowsPe(); bytes.writeUInt16LE(value, offset);
    assert.throws(() => deriveNsisBinaryIdentity(bytes), /x64 GUI/);
  }
  const noDirectory = rawWindowsPe(); noDirectory.writeUInt32LE(4, 196);
  assert.throws(() => deriveNsisBinaryIdentity(noDirectory), /certificate directory/);
  assert.throws(() => deriveNsisBinaryIdentity(rawWindowsPe().subarray(0, 100)));
  const hugeOffset = rawWindowsPe(); hugeOffset.writeUInt32LE(0xffffffff, 0x3c);
  assert.throws(() => deriveNsisBinaryIdentity(hugeOffset), /PE header/);
});
const sha = "a".repeat(40);
const gate = { event: "workflow_dispatch", repo: "bennick1/codex-monitor", ref: "refs/heads/main", version: "1.4.0", cargoVersion: "1.4.0", tauriVersion: "1.4.0", latestVersion: "v1.3.1", tagExists: false, sourceSha: sha };
test("canonical manual main with newer coherent version", () => assert.equal(validateGate(gate).tag, "v1.4.0"));
for (const patch of [{ event: "push" }, { repo: "fork/codex-monitor" }, { ref: "refs/heads/main-evil" }, { ref: "refs/tags/main" }, { cargoVersion: "1.3.1" }, { tauriVersion: "1.3.1" }, { latestVersion: "v1.4.0" }, { latestVersion: "v2.0.0" }, { tagExists: true }, { version: "1.4.0-qa" }, { sourceSha: "main" }]) {
  test(`gate rejects ${JSON.stringify(patch)}`, () => assert.throws(() => validateGate({ ...gate, ...patch })));
}
const inventory = platform => {
  const installer = `${platform}.installer`;
  const update = `${platform}.update`;
  const signatureFile = `${update}.sig`;
  return { platform, version: "1.4.0", sourceSha: sha, identifier: "app.quotafloat.desktop", qa: false, signatureVerified: true, payloadIdentity: { identifier: "app.quotafloat.desktop", version: "1.4.0", binarySha256: "b".repeat(64) }, verificationKeySha256: "b".repeat(64), installer, update, signatureFile, signature: "synthetic fixture; cryptographic verification belongs to official updater", files: [installer, update, signatureFile].map(name => ({ name, sha256: "b".repeat(64) })) };
};
const complete = () => [inventory("macos"), inventory("windows")];
test("both platform inventories required", () => { validateInventories(complete(), "1.4.0", sha); assert.throws(() => validateInventories([inventory("macos")], "1.4.0", sha)); });
for (const patch of [{ qa: true }, { identifier: "app.codexmonitor.updater-test" }, { sourceSha: "c".repeat(40) }, { signature: "" }, { signatureFile: "wrong.sig" }, { files: [] }, { signatureVerified: false }, { verificationKeySha256: "" }]) {
  test(`inventory rejects ${JSON.stringify(patch)}`, () => { const all = complete(); Object.assign(all[0], patch); assert.throws(() => validateInventories(all, "1.4.0", sha)); });
}
test("reject half manifest and QA asset", () => { for (const name of ["latest.json", "qa.update", "../asset"]) { const all = complete(); all[0].files.push({ name, sha256: "d".repeat(64) }); assert.throws(() => validateInventories(all, "1.4.0", sha)); } });

import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collect, assemble } from "./updater-artifacts.mjs";
test("collect versionless Mac archive; assemble full manifest and reject changed signature", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-release-fixture-"));
  try {
    const incoming = join(dir, "incoming");
    await mkdir(incoming);
    for (const platform of ["macos", "windows"]) {
      const bundle = join(dir, platform);
      await mkdir(bundle);
      const installer = platform === "macos" ? "Codex Monitor_1.4.0_universal.dmg" : "Codex Monitor_1.4.0_x64-setup.exe";
      const update = platform === "macos" ? "Codex Monitor.app.tar.gz" : installer;
      await writeFile(join(bundle, installer), "synthetic installer");
      await writeFile(join(bundle, update), "synthetic update");
      await writeFile(join(bundle, `${update}.sig`), `${platform}-fixture-signature`);
      await writeFile(join(incoming, `${platform}-build-environment.json`), JSON.stringify({ sourceSha: sha, platform, identity: { identifier: "app.quotafloat.desktop", version: "1.4.0", productName: "Codex Monitor" }, binarySha256: "b".repeat(64), qa: false, releaseBuild: true, updaterSigned: true, rust: "fixture", node: "fixture", tauri: "fixture", runUrl: "fixture" }));
      await collect(platform, bundle, incoming, "1.4.0", sha, async () => {}, async (_platform, _artifact, report) => ({ ...report.identity, binarySha256: report.binarySha256 }));
    }
    const notesPath = join(dir, "release-notes.md");
    const notes = "# Codex Monitor 1.4.0\n\n菜单栏与在线更新。\n下载和安装由用户确认。";
    await writeFile(notesPath, `${notes}\n`);
    const output = join(dir, "complete");
    const manifest = await assemble(incoming, output, "1.4.0", sha, notesPath);
    assert.equal(manifest.notes, notes);
    const manifestBytes = await readFile(join(output, "latest.json"));
    assert.equal(JSON.parse(manifestBytes).notes, notes);
    const manifestHash = createHash("sha256").update(manifestBytes).digest("hex");
    assert.ok((await readFile(join(output, "SHA256SUMS"), "utf8")).includes(`${manifestHash}  latest.json\n`));
    assert.deepEqual(Object.keys(manifest.platforms).sort(), ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]);
    assert.match(manifest.platforms["darwin-aarch64"].url, /releases\/download\/v1\.4\.0\/Codex-Monitor-1\.4\.0-macos\.app\.tar\.gz$/);
    const oldInventory = JSON.parse(await readFile(join(incoming, "macos-inventory.json"), "utf8"));
    // Preserve asset digest to test mapping itself, not only byte tampering.
    oldInventory.signature = "windows-fixture-signature";
    await writeFile(join(incoming, "macos-inventory.json"), JSON.stringify(oldInventory));
    const rejected = join(dir, "rejected");
    await assert.rejects(assemble(incoming, rejected, "1.4.0", sha, notesPath), /Wrong signature mapping/);
    await assert.rejects(readdir(rejected), { code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("missing or empty release notes cannot produce a manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-release-notes-fixture-"));
  try {
    const output = join(dir, "rejected");
    const notesPath = join(dir, "release-notes.md");
    await assert.rejects(assemble(dir, output, "1.4.0", sha), /Release notes file is required/);
    await assert.rejects(assemble(dir, output, "1.4.0", sha, notesPath), { code: "ENOENT" });
    await writeFile(notesPath, " \n\t");
    await assert.rejects(assemble(dir, output, "1.4.0", sha, notesPath), /Release notes file is empty/);
    await assert.rejects(readdir(output), { code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("reject mismatched production verification keys", () => {
  const all = complete(); all[1].verificationKeySha256 = "c".repeat(64);
  assert.throws(() => validateInventories(all, "1.4.0", sha), /different updater public keys/);
});
import { spawnSync } from "node:child_process";
test("production CLI overlay contains exact public config and rejects QA flags", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-overlay-fixture-"));
  const file = join(dir, "overlay.json");
  try {
    const env = { ...process.env, CODEX_MONITOR_RELEASE_BUILD: "1", CODEX_MONITOR_UPDATER_PUBLIC_KEY: 'fixture-public-key"with-quote', CODEX_MONITOR_UPDATER_TEST_BUILD: "", CODEX_MONITOR_UPDATER_TEST_ENDPOINT: "" };
    const call = patch => spawnSync(process.execPath, ["scripts/write-updater-build-config.mjs", file], { env: { ...env, ...patch }, encoding: "utf8" });
    assert.equal(call({}).status, 0);
    const config = JSON.parse(await readFile(file, "utf8"));
    assert.equal(config.plugins.updater.pubkey, env.CODEX_MONITOR_UPDATER_PUBLIC_KEY);
    assert.deepEqual(config.plugins.updater.endpoints, ["https://github.com/bennick1/codex-monitor/releases/latest/download/latest.json"]);
    for (const patch of [{ CODEX_MONITOR_UPDATER_TEST_BUILD: "1" }, { CODEX_MONITOR_UPDATER_TEST_ENDPOINT: "http://127.0.0.1/latest.json" }, { CODEX_MONITOR_UPDATER_PUBLIC_KEY: "" }]) assert.notEqual(call(patch).status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { inspectPayload } from "./updater-artifacts.mjs";
test("tar payload rejects internal old version, old binary and QA identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-signed-payload-fixture-"));
  try {
    const hash = value => createHash("sha256").update(value).digest("hex");
    const currentBinary = "synthetic new main binary";
    const report = { platform: "macos", sourceSha: sha, qa: false, releaseBuild: true, identity: { identifier: "app.quotafloat.desktop", version: "1.4.0", productName: "Codex Monitor" }, binarySha256: hash(currentBinary) };
    const bundleDir = join(dir, "bundle");
    await mkdir(bundleDir);
    const proof = join(dir, "proof");
    await mkdir(proof);
    await writeFile(join(proof, "macos-build-environment.json"), JSON.stringify(report));
    await writeFile(join(bundleDir, "Codex Monitor_1.4.0_universal.dmg"), "synthetic companion installer");
    const app = join(bundleDir, "content", "Codex Monitor.app");
    await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
    const archive = join(bundleDir, "Codex Monitor.app.tar.gz");
    const signatureVerifier = process.env.CODEX_MONITOR_SIGNATURE_VERIFY_BIN;
    let fixturePublicKey;
    if (signatureVerifier) {
      const keyGeneration = spawnSync(process.execPath, ["node_modules/@tauri-apps/cli/tauri.js", "signer", "generate", "--ci", "-p", "", "-w", join(dir, "test.key")], { encoding: "utf8" });
      assert.equal(keyGeneration.status, 0, "official fixture signer generation");
      fixturePublicKey = (await readFile(join(dir, "test.key.pub"), "utf8")).trim();
    }
    const fixture = async (identity, binary) => {
      const plist = { CFBundleIdentifier: identity.identifier, CFBundleShortVersionString: identity.version, CFBundleDisplayName: identity.productName, CFBundleExecutable: "codex-monitor" };
      execFileSync("python3", ["-c", "import plistlib,json,sys; plistlib.dump(json.loads(sys.argv[1]),open(sys.argv[2],'wb'))", JSON.stringify(plist), join(app, "Contents", "Info.plist")]);
      await writeFile(join(app, "Contents", "MacOS", "codex-monitor"), binary);
      execFileSync("tar", ["-czf", archive, "-C", join(bundleDir, "content"), "Codex Monitor.app"]);
      if (signatureVerifier) {
        const signing = spawnSync(process.execPath, ["node_modules/@tauri-apps/cli/tauri.js", "signer", "sign", "--private-key-path", join(dir, "test.key"), archive], { env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" }, encoding: "utf8" });
        assert.equal(signing.status, 0, "official fixture signing");
        const verified = spawnSync(signatureVerifier, [archive, `${archive}.sig`], { env: { ...process.env, CODEX_MONITOR_UPDATER_PUBLIC_KEY: fixturePublicKey }, encoding: "utf8" });
        assert.equal(verified.status, 0, "mature verifier accepts valid signature over exact fixture bytes");
      } else await writeFile(`${archive}.sig`, "synthetic accepted signature for payload unit isolation");
    };
    await fixture(report.identity, currentBinary);
    assert.equal(inspectPayload("macos", archive, report).binarySha256, report.binarySha256);
    const verifier = async (artifact, signatureFile) => {
      if (!signatureVerifier) return;
      const result = spawnSync(signatureVerifier, [artifact, signatureFile], { env: { ...process.env, CODEX_MONITOR_UPDATER_PUBLIC_KEY: fixturePublicKey }, encoding: "utf8" });
      assert.equal(result.status, 0, "collector signature gate passes before payload rejection");
    };
    await collect("macos", bundleDir, proof, "1.4.0", sha, verifier);
    // With CODEX_MONITOR_SIGNATURE_VERIFY_BIN, every changed archive is signed
    // by official CLI and verified by the mature Rust example before inspection.
    for (const [name, identity, binary] of [
      ["old version", { ...report.identity, version: "1.3.1" }, currentBinary],
      ["old binary", report.identity, "synthetic old main binary"],
      ["QA identity", { ...report.identity, identifier: "app.codexmonitor.updater-test.local" }, currentBinary],
    ]) {
      await fixture(identity, binary);
      assert.throws(() => inspectPayload("macos", archive, report), /identity\/version mismatch|differs from verified build binary/, name);
      await assert.rejects(collect("macos", bundleDir, proof, "1.4.0", sha, verifier), /identity\/version mismatch|differs from verified build binary/, name);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
