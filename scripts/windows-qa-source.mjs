import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

const windowsSchema = "src-tauri/gen/schemas/windows-schema.json";
const desktopSchema = "src-tauri/gen/schemas/desktop-schema.json";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// Only this known stale generated editor schema may differ after a Windows
// build. Its entire content must equal the already-committed current schema.
// No tracked files are restored, rewritten, or silently excluded from evidence.
export async function auditWindowsQaSource(repository = process.cwd()) {
  const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 4 * 1024 * 1024 });
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=no"]).toString("utf8").split("\0");
  const changes = [];
  for (let i = 0; i < status.length; i++) {
    if (!status[i]) continue;
    const entry = { status: status[i].slice(0, 2), path: status[i].slice(3) };
    if (/[RC]/.test(entry.status)) entry.originalPath = status[++i];
    changes.push(entry);
  }
  const report = {
    accepted: false,
    sourceSha: git(["rev-parse", "HEAD"]).toString("utf8").trim(),
    trackedChanges: changes,
    diffstat: git(["diff", "--stat", "HEAD", "--"]).toString("utf8").trim(),
    generatedOutputs: [],
  };
  if (!changes.length) return { ...report, accepted: true, reason: "Tracked checkout unchanged" };
  if (changes.length !== 1 || changes[0].status !== " M" || changes[0].path !== windowsSchema) return { ...report, reason: "Unexpected tracked, staged, deleted, or renamed source changes" };
  if (git(["diff", "--summary", "--", windowsSchema]).length) return { ...report, reason: "Generated schema file mode or type changed" };
  const metadata = await lstat(join(repository, windowsSchema));
  if (!metadata.isFile()) return { ...report, reason: "Generated schema must be a regular file" };
  const previous = git(["show", `HEAD:${windowsSchema}`]);
  const expected = git(["show", `HEAD:${desktopSchema}`]);
  const current = await readFile(join(repository, windowsSchema));
  const evidence = { path: windowsSchema, previousSha256: sha256(previous), currentSha256: sha256(current), expectedSha256: sha256(expected), expectedSource: `HEAD:${desktopSchema}` };
  if (!current.equals(expected)) return { ...report, generatedOutputs: [evidence], reason: "Generated Windows schema differs from the exact committed desktop schema" };
  return {
    ...report,
    accepted: true,
    reason: "Only exact known generated Windows editor schema changed; tracked build inputs unchanged",
    generatedOutputs: [{
      ...evidence,
      rationale: "Locked tauri-build 2.6.3 calls ACL schema generation for application and example builds. tauri-utils 2.9.3 writes gen/schemas/<target>-schema.json; the committed Windows schema still contains removed process-plugin entries. Only byte equality to the committed current desktop schema is accepted, with no source restore.",
      owningSource: "tauri-build 2.6.3 src/lib.rs:528; src/acl.rs:419-432; tauri-utils 2.9.3 src/acl/schema.rs:310-341",
      diff: git(["diff", "--no-ext-diff", "--no-color", "--", windowsSchema]).toString("utf8"),
    }],
  };
}
