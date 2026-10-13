import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { repository, stableVersion } from "./release-gate.mjs";

const platforms = { macos: { keys: ["darwin-aarch64", "darwin-x86_64"], installer: ".dmg", update: ".app.tar.gz" }, windows: { keys: ["windows-x86_64"], installer: "-setup.exe", update: "-setup.exe" } };
const digest = async path => createHash("sha256").update(await readFile(path)).digest("hex");
async function walk(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...await walk(join(path, entry.name)));
    else if (entry.isFile()) result.push(join(path, entry.name));
  }
  return result;
}
const hashBytes = bytes => createHash("sha256").update(bytes).digest("hex");
const safeArchivePath = name => {
  if (!name || name.startsWith("/") || name.startsWith("-") || /^[A-Za-z]:/.test(name) || name.includes("\\") || name.split("/").includes("..") || /[\x00-\x1f*?\[\]]/.test(name)) throw new Error("Unsafe archive member path");
  return name;
};
export function inspectPayload(platform, artifact, provenance) {
  const command = (name, args, options = {}) => execFileSync(name, args, { maxBuffer: 256 * 1024 * 1024, ...options });
  let binary;
  let identity;
  if (platform === "macos") {
    const members = command("tar", ["-tzf", artifact], { encoding: "utf8" }).trim().split("\n");
    for (const member of members) safeArchivePath(member);
    if (new Set(members).size !== members.length) throw new Error("Duplicate archive members");
    const plists = members.filter(member => /^[^/]+\.app\/Contents\/Info\.plist$/.test(member));
    if (plists.length !== 1) throw new Error("Expected one application Info.plist inside updater archive");
    const appRoot = plists[0].split("/")[0];
    if (members.some(member => member !== appRoot && !member.startsWith(`${appRoot}/`))) throw new Error("Updater archive contains entries outside its single application");
    // stdout extraction never writes archive paths to the filesystem.
    const plistBytes = command("tar", ["-xOzf", artifact, plists[0]]);
    const plist = JSON.parse(command("python3", ["-c", "import json,plistlib,sys; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))"], { input: plistBytes, encoding: "utf8" }));
    const executable = safeArchivePath(plist.CFBundleExecutable);
    if (executable.includes("/")) throw new Error("Invalid archive executable name");
    const binaryMember = plists[0].replace(/Info\.plist$/, `MacOS/${executable}`);
    if (!members.includes(binaryMember)) throw new Error("Missing updater archive main executable");
    binary = command("tar", ["-xOzf", artifact, binaryMember]);
    identity = { identifier: plist.CFBundleIdentifier, version: plist.CFBundleShortVersionString, productName: plist.CFBundleDisplayName };
    if (identity.identifier !== provenance.identity.identifier || identity.version !== provenance.identity.version || identity.productName !== provenance.identity.productName) throw new Error("Updater archive internal identity/version mismatch");
  } else if (platform === "windows") {
    const sevenZip = process.platform === "win32" ? join(process.env.ProgramFiles ?? "C:\\Program Files", "7-Zip", "7z.exe") : "7z";
    const listing = command(sevenZip, ["l", "-slt", artifact], { encoding: "utf8" });
    const executables = [...listing.matchAll(/^Path = (.+)$/gm)].map(match => match[1].trim()).filter(name => /(?:^|[\\/])codex-monitor\.exe$/i.test(name));
    if (executables.length !== 1) throw new Error("Expected exactly one codex-monitor.exe inside NSIS installer");
    safeArchivePath(executables[0].replaceAll("\\", "/"));
    binary = command(sevenZip, ["x", "-so", artifact, executables[0]]);
    // The VERSIONINFO-verified build binary must be byte-identical to the NSIS member.
    identity = provenance.identity;
  } else throw new Error("Unknown payload platform");
  if (!binary.length || hashBytes(binary) !== provenance.binarySha256) throw new Error("Updater payload main binary differs from verified build binary");
  return { ...identity, binarySha256: hashBytes(binary), method: platform === "macos" ? "archive plist and executable stdout extraction" : "NSIS executable stdout extraction bound to verified VERSIONINFO" };
}
export function validateInventories(inventories, version, sourceSha) {
  stableVersion(version);
  if (inventories.length !== 2 || new Set(inventories.map(i => i.platform)).size !== 2) throw new Error("Both complete platforms required");
  if (new Set(inventories.map(i => i.verificationKeySha256)).size !== 1) throw new Error("Platforms use different updater public keys");
  for (const inventory of inventories) {
    if (!platforms[inventory.platform] || inventory.version !== version || inventory.sourceSha !== sourceSha || inventory.qa !== false || inventory.identifier !== "app.quotafloat.desktop") throw new Error("Invalid production provenance or QA artifact");
    if (inventory.signatureVerified !== true || !/^[a-f0-9]{64}$/.test(inventory.verificationKeySha256)) throw new Error("Missing mature-library signature verification");
    if (inventory.payloadIdentity?.identifier !== inventory.identifier || inventory.payloadIdentity?.version !== version || !/^[a-f0-9]{64}$/.test(inventory.payloadIdentity?.binarySha256)) throw new Error("Missing verified internal payload identity");
    if (!inventory.signature || !inventory.update || !inventory.installer || !inventory.files?.length) throw new Error("Incomplete signed platform");
    if (inventory.signatureFile !== `${inventory.update}.sig`) throw new Error("Signature must belong to exact updater asset");
    for (const name of [inventory.update, inventory.installer, inventory.signatureFile]) {
      if (!inventory.files.some(f => f.name === name && /^[a-f0-9]{64}$/.test(f.sha256))) throw new Error("Missing asset digest");
    }
    if (inventory.files.some(f => basename(f.name) !== f.name || /(?:latest\.json|qa|updater-test)/i.test(f.name))) throw new Error("Unsafe or partial manifest asset");
  }
}
export async function collect(platform, bundle, output, version, sourceSha, verifySignature = (artifact, signature) => {
  if (!process.env.CODEX_MONITOR_UPDATER_PUBLIC_KEY?.trim()) throw new Error("Expected release verification public key");
  execFileSync("cargo", ["run", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--example", "verify_updater_signature", "--", artifact, signature], { stdio: "inherit" });
}, inspect = inspectPayload) {
  const spec = platforms[platform];
  if (!spec) throw new Error("Unknown platform");
  stableVersion(version);
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("Invalid source SHA");
  const provenance = JSON.parse(await readFile(join(output, `${platform}-build-environment.json`), "utf8"));
  if (provenance.sourceSha !== sourceSha || provenance.platform !== platform || provenance.qa !== false || provenance.releaseBuild !== true || provenance.identity?.identifier !== "app.quotafloat.desktop" || provenance.identity?.version !== version || provenance.identity?.productName !== "Codex Monitor" || !/^[a-f0-9]{64}$/.test(provenance.binarySha256)) throw new Error("Unverified actual production bundle identity");
  const paths = await walk(bundle);
  if (paths.some(p => /updater.?qa|updater-test/i.test(basename(p)))) throw new Error("QA named bundle cannot become a production artifact");
  const one = (suffix, requireVersion = true) => {
    const found = paths.filter(p => p.endsWith(suffix) && (!requireVersion || basename(p).includes(version)));
    if (found.length !== 1) throw new Error(`Expected one ${suffix} asset, found ${found.length}`);
    return found[0];
  };
  const installerSource = one(spec.installer);
  const updateSource = one(spec.update, platform !== "macos");
  const signatureSource = `${updateSource}.sig`;
  const signature = (await readFile(signatureSource, "utf8")).trim();
  if (!signature) throw new Error("Empty updater signature");
  await verifySignature(updateSource, signatureSource);
  const payloadIdentity = await inspect(platform, updateSource, provenance);
  const verificationKeySha256 = createHash("sha256").update(process.env.CODEX_MONITOR_UPDATER_PUBLIC_KEY?.trim() ?? "fixture").digest("hex");
  const installer = `Codex-Monitor-${version}-${platform}${platform === "macos" ? ".dmg" : ".exe"}`;
  const update = platform === "macos" ? `Codex-Monitor-${version}-macos.app.tar.gz` : installer;
  const signatureFile = `${update}.sig`;
  await mkdir(output, { recursive: true });
  const pairs = new Map([[installer, installerSource], [update, updateSource], [signatureFile, signatureSource]]);
  const files = [];
  for (const [name, source] of pairs) {
    if (!(await readFile(source)).length) throw new Error("Empty release asset");
    await copyFile(source, join(output, name));
    files.push({ name, sha256: await digest(join(output, name)) });
  }
  const inventory = { platform, version, sourceSha, identifier: provenance.identity.identifier, qa: provenance.qa, signatureVerified: true, payloadIdentity, verificationKeySha256, installer, update, signatureFile, signature, files };
  await writeFile(join(output, `${platform}-inventory.json`), JSON.stringify(inventory, null, 2));
  return inventory;
}
export async function assemble(input, output, version, sourceSha) {
  const inventories = await Promise.all(Object.keys(platforms).map(p => readFile(join(input, `${p}-inventory.json`), "utf8").then(JSON.parse)));
  validateInventories(inventories, version, sourceSha);
  if (process.env.CODEX_MONITOR_UPDATER_PUBLIC_KEY) {
    const expectedKey = createHash("sha256").update(process.env.CODEX_MONITOR_UPDATER_PUBLIC_KEY.trim()).digest("hex");
    if (inventories.some(i => i.verificationKeySha256 !== expectedKey)) throw new Error("Production verification key changed between jobs");
  }
  const files = inventories.flatMap(i => i.files);
  for (const platform of Object.keys(platforms)) {
    const environment = JSON.parse(await readFile(join(input, `${platform}-build-environment.json`), "utf8"));
    if (inventories.find(i => i.platform === platform)?.payloadIdentity.binarySha256 !== environment.binarySha256) throw new Error("Manifest payload binary provenance mismatch");
    if (environment.sourceSha !== sourceSha || environment.platform !== platform || environment.updaterSigned !== true || environment.qa !== false || environment.releaseBuild !== true || environment.identity?.identifier !== "app.quotafloat.desktop" || environment.identity?.version !== version || !environment.rust || !environment.node || !environment.tauri || !environment.runUrl) throw new Error("Invalid build environment provenance");
  }
  for (const file of files) if (await digest(join(input, file.name)) !== file.sha256) throw new Error(`Changed asset: ${file.name}`);
  for (const i of inventories) if ((await readFile(join(input, i.signatureFile), "utf8")).trim() !== i.signature) throw new Error("Wrong signature mapping");
  const manifest = { version, notes: `Codex Monitor ${version}`, pub_date: new Date().toISOString(), platforms: {} };
  for (const i of inventories) for (const key of platforms[i.platform].keys) manifest.platforms[key] = { signature: i.signature, url: `https://github.com/${repository}/releases/download/v${version}/${i.update}` };
  // No manifest is written until both inventories and every asset have passed validation.
  await mkdir(output, { recursive: true });
  for (const f of files) await copyFile(join(input, f.name), join(output, f.name));
  for (const platform of Object.keys(platforms)) await copyFile(join(input, `${platform}-inventory.json`), join(output, `${platform}-inventory.json`));
  for (const platform of Object.keys(platforms)) await copyFile(join(input, `${platform}-build-environment.json`), join(output, `${platform}-build-environment.json`));
  await writeFile(join(output, "latest.json"), JSON.stringify(manifest, null, 2));
  const allNames = (await readdir(output)).filter(n => n !== "SHA256SUMS").sort();
  await writeFile(join(output, "SHA256SUMS"), (await Promise.all(allNames.map(async n => `${await digest(join(output, n))}  ${n}`))).join("\n") + "\n");
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "collect") await collect(...args);
  else if (mode === "assemble") {
    if (!process.env.CODEX_MONITOR_UPDATER_PUBLIC_KEY?.trim()) throw new Error("Manifest assembly requires expected production public key");
    await assemble(...args);
  }
  else throw new Error("Usage: updater-artifacts.mjs collect <macos|windows> <bundle> <output> <version> <sha> | assemble <input> <output> <version> <sha>");
}
