// Only package verified build outputs; never creates a GitHub Release.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const [input, output] = process.argv.slice(2).map(p => resolve(p));
if (!input || !output) throw new Error('Usage: node scripts/prepare-release-artifacts.mjs <bundle-dir> <output-dir>');
if (input === output) throw new Error('Use separate build and release output directories.');
if (pkg.version !== '1.0.0') throw new Error('This preparation script is scoped to V1.0.0.');
const names = ['dmg', 'exe'].map(ext => `Codex-Monitor-${pkg.version}.${ext}`);
const digest = async p => createHash('sha256').update(await readFile(p)).digest('hex');
async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
const paths = await walk(input);
const candidates = paths.filter(p => /^Codex[ .-]Monitor_1\.0\.0_.+\.dmg$/.test(basename(p)) || /^Codex[ .-]Monitor_1\.0\.0_.+-setup\.exe$/.test(basename(p)));
if (!candidates.length) throw new Error('No V1.0.0 Codex Monitor DMG / NSIS installers found.');
const seen = new Set();
const copies = [];
for (const source of candidates) {
  const ext = extname(source);
  if (seen.has(ext)) throw new Error(`Multiple ${ext} installers: select one architecture/build first.`);
  seen.add(ext);
  if (!(await stat(source)).size) throw new Error(`Empty installer: ${source}`);
  const destination = join(output, `Codex-Monitor-${pkg.version}${ext}`);
  try {
    if (await digest(destination) !== await digest(source)) throw new Error(`Refusing to overwrite different artifact: ${destination}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  copies.push({ source, destination });
}
await mkdir(output, { recursive: true });
for (const { source, destination } of copies) await copyFile(source, destination);
const sums = [];
for (const name of names) {
  try { sums.push(`${await digest(join(output, name))}  ${name}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await writeFile(join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(JSON.stringify({ output, files: sums.length, complete: sums.length === 2, copied: copies.map(c => basename(c.destination)) }, null, 2));
