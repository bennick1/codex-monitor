import test from "node:test";
import assert from "node:assert/strict";
import { validateOverlay, validateRecords, inspectPe } from "./windows-updater-qa-package.mjs";
import { mkdtemp, mkdir, readFile, writeFile, readdir, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { copyVersionedWindowsBundle } from "./windows-qa-bundle.mjs";
import { auditWindowsQaSource } from "./windows-qa-source.mjs";

async function sourceFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "cm-qa-source-provenance-"));
  const git = args => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  try {
    git(["init", "--quiet"]);
    git(["config", "core.autocrlf", "false"]);
    await mkdir(join(directory, "src-tauri", "gen", "schemas"), { recursive: true });
    await writeFile(join(directory, "src-tauri/gen/schemas/windows-schema.json"), '{"stale":"generated"}\n');
    await writeFile(join(directory, "src-tauri/gen/schemas/desktop-schema.json"), '{"current":"generated"}\n');
    await writeFile(join(directory, "src-tauri/build.rs"), "fn main() {}\n");
    git(["add", "src-tauri"]);
    git(["-c", "user.name=QA Fixture", "-c", "user.email=qa-fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Synthetic source fixture"]);
    await run(directory, git);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("source guard accepts only exact generated Windows schema and records its full public evidence", async () => sourceFixture(async directory => {
  const clean = await auditWindowsQaSource(directory);
  assert.equal(clean.accepted, true);
  assert.deepEqual(clean.generatedOutputs, []);
  const expected = await readFile(join(directory, "src-tauri/gen/schemas/desktop-schema.json"));
  const windows = join(directory, "src-tauri/gen/schemas/windows-schema.json");
  await writeFile(windows, expected);
  const report = await auditWindowsQaSource(directory);
  assert.equal(report.accepted, true);
  assert.deepEqual(report.trackedChanges, [{ status: " M", path: "src-tauri/gen/schemas/windows-schema.json" }]);
  assert.equal(report.generatedOutputs[0].currentSha256, report.generatedOutputs[0].expectedSha256);
  assert.notEqual(report.generatedOutputs[0].previousSha256, report.generatedOutputs[0].currentSha256);
  assert.match(report.generatedOutputs[0].diff, /-\{"stale":"generated"\}/);
  assert.match(report.generatedOutputs[0].diff, /\+\{"current":"generated"\}/);
  assert.deepEqual(await readFile(windows), expected, "audit never restores or edits the changed schema");
}));

test("source guard rejects real source mutation with names/statistics but no source-content disclosure", async () => sourceFixture(async directory => {
  await writeFile(join(directory, "src-tauri/build.rs"), "unapproved-source-content\n");
  const report = await auditWindowsQaSource(directory);
  assert.equal(report.accepted, false);
  assert.equal(report.trackedChanges[0].path, "src-tauri/build.rs");
  assert.match(report.diffstat, /build.rs/);
  assert.equal(JSON.stringify(report).includes("unapproved-source-content"), false);
}));

test("source guard rejects unexpected schema bytes and records hashes without its unapproved content", async () => sourceFixture(async directory => {
  await writeFile(join(directory, "src-tauri/gen/schemas/windows-schema.json"), '{"unapproved":"schema-content"}\n');
  const report = await auditWindowsQaSource(directory);
  assert.equal(report.accepted, false);
  assert.notEqual(report.generatedOutputs[0].currentSha256, report.generatedOutputs[0].expectedSha256);
  assert.equal(JSON.stringify(report).includes("schema-content"), false);
}));

for (const change of ["staged", "rename", "delete"]) test(`source guard rejects ${change} changes even for generated schema`, async () => sourceFixture(async (directory, git) => {
  const schema = "src-tauri/gen/schemas/windows-schema.json";
  if (change === "staged") {
    await writeFile(join(directory, schema), await readFile(join(directory, "src-tauri/gen/schemas/desktop-schema.json")));
    git(["add", schema]);
  } else if (change === "rename") git(["mv", schema, "src-tauri/gen/schemas/renamed-schema.json"]);
  else await rm(join(directory, schema));
  const report = await auditWindowsQaSource(directory);
  assert.equal(report.accepted, false);
  assert.equal(report.generatedOutputs.length, 0);
  if (change === "rename") assert.equal(report.trackedChanges[0].originalPath, schema);
}));

test("Windows B snapshot selects only exact B installer/signature and preserves A/shared cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cm-qa-versioned-bundle-"));
  try {
    const bundle = join(directory, "shared", "bundle");
    await mkdir(join(bundle, "nsis"), { recursive: true });
    const name = version => `Codex Monitor Updater QA_${version}_x64-setup.exe`;
    for (const version of ["0.0.1", "0.0.2"]) {
      await writeFile(join(bundle, "nsis", name(version)), `synthetic-${version}-installer`);
      await writeFile(join(bundle, "nsis", `${name(version)}.sig`), `synthetic-${version}-signature`);
    }
    await writeFile(join(bundle, "nsis", "unrelated.exe"), "must not be copied");
    const destinationA = join(directory, "target-A", "release", "bundle");
    const destinationB = join(directory, "target-B", "release", "bundle");
    await copyVersionedWindowsBundle(bundle, destinationA, "0.0.1");
    await copyVersionedWindowsBundle(bundle, destinationB, "0.0.2");
    assert.deepEqual((await readdir(join(destinationB, "nsis"))).sort(), [name("0.0.2"), `${name("0.0.2")}.sig`].sort());
    assert.equal(await readFile(join(destinationB, "nsis", name("0.0.2")), "utf8"), "synthetic-0.0.2-installer");
    assert.equal(await readFile(join(destinationA, "nsis", name("0.0.1")), "utf8"), "synthetic-0.0.1-installer");
    assert.equal(await readFile(join(bundle, "nsis", name("0.0.1")), "utf8"), "synthetic-0.0.1-installer");
    assert.equal((await readdir(join(bundle, "nsis"))).length, 5);
    await assert.rejects(copyVersionedWindowsBundle(bundle, destinationB, "0.0.2"), { code: "EEXIST" });
    await rm(join(bundle, "nsis", `${name("0.0.2")}.sig`));
    const missingSignature = join(directory, "missing-signature", "bundle");
    await assert.rejects(copyVersionedWindowsBundle(bundle, missingSignature, "0.0.2"), { code: "ENOENT" });
    await assert.rejects(access(missingSignature), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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
