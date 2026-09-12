/** Rebuild only CM branding assets. Requires npm ci, Tauri v2 CLI, Python + Pillow.
 * Set BRANDING_PYTHON to an interpreter with Pillow if python3 lacks it.
 * All raster/container/contact-sheet inputs descend from the maintained CM SVG.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const branding = 'docs/branding/v1.2';
const output = 'src-tauri/icons';
const reference = readFileSync(`${branding}/app-icon-reference.png`);
if (reference.length !== 1316884 || createHash('sha256').update(reference).digest('hex') !== '373af7dca75b1e45310c6c8b43602d44f16629c1f5225279f0efdb8c98af45c5') {
  throw new Error('Blocked — Approved CM Reference Integrity Failed');
}
const source = `${branding}/app-icon-source.svg`;
const svg = readFileSync(source, 'utf8');
for (const id of ['letter-c', 'letter-m', 'segmented-arc']) {
  if (!svg.includes(`id="${id}"`)) throw new Error(`Missing CM component: ${id}`);
}
const python = process.env.BRANDING_PYTHON || 'python3';
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
// Fail before changing assets when the validation dependency is unavailable.
run(python, ['-c', 'from PIL import Image, ImageDraw, ImageFont']);
function tauri(input, dest, sizes = []) {
  run(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'icon', input, '-o', dest,
    '--ios-color', '#101820', ...sizes.flatMap(size => ['-p', String(size)])]);
}
const temp = mkdtempSync(join(tmpdir(), 'cm-icons-'));
try {
  mkdirSync(output, { recursive: true });
  // Tauri regenerates all standard desktop, Windows Store, Android and iOS outputs.
  tauri(source, output);
  tauri(source, temp, [16, 20, 24, 32, 48, 64, 128, 256, 512, 1024]);
  // Tiny-only optical correction: three spaced ticks, reduced glow, stronger M edge.
  tauri(`${branding}/app-icon-small-source.svg`, temp, [16, 20]);
  copyFileSync(`${temp}/20x20.png`, `${output}/ios/AppIcon-20x20@1x.png`);
  run(python, ['scripts/validate-brand-icons.py', '--normalize', output, temp]);
  copyFileSync(source, `${output}/icon.svg`);
  for (const size of [16, 20, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    copyFileSync(`${temp}/${size}x${size}.png`, `${output}/app-${size}.png`);
  }
  for (const size of [32, 64, 128]) copyFileSync(`${output}/app-${size}.png`, `${output}/${size}x${size}.png`);
  copyFileSync(`${output}/app-256.png`, `${output}/128x128@2x.png`);
  copyFileSync(`${output}/app-1024.png`, `${output}/app-master-1024.png`);
  copyFileSync(`${output}/app-1024.png`, `${output}/icon.png`);
  // Tray uses the same CM mapping: tiny at 16/20, main at 24/32.
  for (const size of [16, 20, 24, 32]) copyFileSync(`${output}/app-${size}.png`, `${output}/tray-${size}.png`);

  // PNG-compressed representations, decoded and source-compared by the validator.
  const icoSizes = [16, 20, 24, 32, 48, 64, 128, 256];
  const icoHeader = Buffer.alloc(6 + 16 * icoSizes.length);
  icoHeader.writeUInt16LE(1, 2);
  icoHeader.writeUInt16LE(icoSizes.length, 4);
  let offset = icoHeader.length;
  const icoImages = icoSizes.map((size, i) => {
    const png = readFileSync(`${output}/app-${size}.png`);
    const entry = 6 + i * 16;
    icoHeader[entry] = icoHeader[entry + 1] = size === 256 ? 0 : size;
    icoHeader.writeUInt16LE(1, entry + 4);
    icoHeader.writeUInt16LE(32, entry + 6);
    icoHeader.writeUInt32LE(png.length, entry + 8);
    icoHeader.writeUInt32LE(offset, entry + 12);
    offset += png.length;
    return png;
  });
  writeFileSync(`${output}/icon.ico`, Buffer.concat([icoHeader, ...icoImages]));
  // Standard 1x and Retina 2x logical representations (20/24 are ICO/PNG only).
  const icnsTypes = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024,
    ic11: 32, ic12: 64, ic13: 256, ic14: 512 };
  const chunks = Object.entries(icnsTypes).map(([type, size]) => {
    const png = readFileSync(`${output}/app-${size}.png`);
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  writeFileSync(`${output}/icon.icns`, Buffer.concat([header, ...chunks]));
  run(python, ['scripts/validate-brand-icons.py']);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
