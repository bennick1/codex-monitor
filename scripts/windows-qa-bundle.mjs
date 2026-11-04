import { constants } from "node:fs";
import { copyFile, lstat, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

// Tauri reuses bundle/nsis across A/B builds and leaves earlier installers there.
// Snapshot only this version, without deleting the shared cache or old snapshots.
export async function copyVersionedWindowsBundle(bundle, destination, version) {
  if (!["0.0.1", "0.0.2"].includes(version)) throw new Error("Expected QA A/B version");
  const installer = `Codex Monitor Updater QA_${version}_x64-setup.exe`;
  const names = [installer, `${installer}.sig`];
  for (const name of names) {
    const info = await lstat(join(bundle, "nsis", name));
    if (!info.isFile() || info.size === 0) throw new Error("Expected nonempty current QA installer and signature");
  }
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination); // Existing snapshot is an error, even if it is empty.
  const output = join(destination, "nsis");
  await mkdir(output);
  for (const name of names) await copyFile(join(bundle, "nsis", name), join(output, name), constants.COPYFILE_EXCL);
}
