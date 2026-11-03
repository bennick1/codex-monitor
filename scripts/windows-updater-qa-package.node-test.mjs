import test from "node:test";
import assert from "node:assert/strict";
import { validateOverlay, validateRecords, inspectPe } from "./windows-updater-qa-package.mjs";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("QA prepare preserves empty password and spaces/metacharacters as direct argv", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cm-qa-safe-argv-"));
  try {
    const moduleDirectory = join(directory, "node_modules", "@tauri-apps", "cli");
    await mkdir(moduleDirectory, { recursive: true });
    await writeFile(join(moduleDirectory, "tauri.js"), `const fs = require('node:fs'); const args = process.argv.slice(2); const destination = args[args.indexOf('-w') + 1]; fs.writeFileSync('captured-argv.json', JSON.stringify(args)); fs.writeFileSync(destination, 'synthetic-test-key'); fs.writeFileSync(destination + '.pub', 'synthetic-public');`);
    const qaOutput = join(directory, "QA output & argv");
    const result = spawnSync(process.execPath, [resolve("scripts/updater-qa.mjs"), "prepare", qaOutput], { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(join(directory, "captured-argv.json"), "utf8")), ["signer", "generate", "--ci", "-p", "", "-w", join(qaOutput, "test.key")]);
    const second = spawnSync(process.execPath, [resolve("scripts/updater-qa.mjs"), "prepare", qaOutput], { cwd: directory, encoding: "utf8" });
    assert.notEqual(second.status, 0, "existing QA key must not be overwritten");
    assert.equal(await readFile(join(qaOutput, "test.key"), "utf8"), "synthetic-test-key");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
const overlay = () => ({ version: "0.0.1", identifier: "app.codexmonitor.updater-test.local", productName: "Codex Monitor Updater QA", bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: "synthetic-public", endpoints: ["http://127.0.0.1:18765/latest.json"], dangerousInsecureTransportProtocol: true } } });
test("QA overlay rejects production identity, versions, and non-loopback manifests", () => {
  validateOverlay(overlay(), "0.0.1");
  for (const patch of [{ identifier: "app.quotafloat.desktop" }, { version: "1.4.0" }, { productName: "Codex Monitor" }, { bundle: { createUpdaterArtifacts: false } }, { plugins: { updater: { pubkey: "public", endpoints: ["https://example.invalid/latest.json"], dangerousInsecureTransportProtocol: true } } }]) assert.throws(() => validateOverlay({ ...overlay(), ...patch }, "0.0.1"));
});
const record = version => ({ identity: { version, identifier: "app.codexmonitor.updater-test.local", productName: "Codex Monitor Updater QA" }, binarySha256: "b".repeat(64), payloadIdentity: { binarySha256: "b".repeat(64) }, signatureVerified: true, publicKey: "fixture-public" });
test("both exact QA payload identities and shared verified key are required", () => {
  const records = [record("0.0.1"), record("0.0.2")];
  validateRecords(records, "fixture-public", "a".repeat(40));
  assert.throws(() => validateRecords(records.slice(0, 1), "fixture-public", "a".repeat(40)));
  assert.throws(() => validateRecords(records, "other-key", "a".repeat(40)));
  assert.throws(() => validateRecords(records, "fixture-public", "main"));
  for (const patch of [{ signatureVerified: false }, { binarySha256: "c".repeat(64) }, { identity: { ...records[1].identity, version: "0.0.1" } }]) assert.throws(() => validateRecords([records[0], { ...records[1], ...patch }], "fixture-public", "a".repeat(40)));
});
test("actual Windows payload must be x64 GUI PE, not installer shell or console", () => {
  const bytes = Buffer.alloc(256);
  bytes.writeUInt16LE(0x5a4d, 0); bytes.writeUInt32LE(64, 0x3c); bytes.writeUInt32LE(0x4550, 64);
  bytes.writeUInt16LE(0x8664, 68); bytes.writeUInt16LE(0x20b, 88); bytes.writeUInt16LE(2, 156);
  assert.deepEqual(inspectPe(bytes), { architecture: "x64", subsystem: "GUI" });
  for (const [offset, value] of [[68, 0x14c], [88, 0x10b], [156, 3]]) { const altered = Buffer.from(bytes); altered.writeUInt16LE(value, offset); assert.throws(() => inspectPe(altered)); }
  assert.throws(() => inspectPe(Buffer.alloc(3)));
  const invalid = Buffer.from(bytes); invalid.writeUInt32LE(0xffffffff, 0x3c); assert.throws(() => inspectPe(invalid));
});
