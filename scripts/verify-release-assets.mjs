import { readdir, stat, mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const [directory, tag] = process.argv.slice(2);
const remote = JSON.parse(execFileSync("gh", ["release", "view", tag, "--repo", "bennick1/codex-monitor", "--json", "isDraft,assets"], { encoding: "utf8" }));
if (!remote.isDraft) throw new Error("Release must remain draft until all assets verified");
const names = await readdir(directory);
if (remote.assets.length !== names.length) throw new Error("Draft asset count mismatch");
for (const name of names) {
  const asset = remote.assets.find(a => a.name === name);
  if (!asset || asset.size !== (await stat(join(directory, name))).size) throw new Error(`Missing or partial draft asset: ${name}`);
}
const downloaded = await mkdtemp(join(tmpdir(), "codex-release-check-"));
try {
  execFileSync("gh", ["release", "download", tag, "--repo", "bennick1/codex-monitor", "--dir", downloaded]);
  const hash = async file => createHash("sha256").update(await readFile(file)).digest("hex");
  for (const name of names) if (await hash(join(directory, name)) !== await hash(join(downloaded, name))) throw new Error(`Draft asset content mismatch: ${name}`);
} finally { await rm(downloaded, { recursive: true, force: true }); }
console.log("Draft contains the complete verified release set and matching SHA256");
