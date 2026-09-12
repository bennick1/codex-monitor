import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'codex-monitor-icons-'));
const source = (kind, tiny = false) => `docs/branding/v1.2/${kind}-icon-${tiny ? 'small-' : ''}source.svg`;
const run = (...args) => {
  const result = spawnSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'icon', ...args], {
    cwd: root, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Tauri icon generation failed (${result.status})`);
};
const raster = (kind, size, tiny = size <= 20) => join(scratch, `${kind}-${tiny ? 'tiny' : 'main'}`, `${size}x${size}.png`);
const output = (name) => join(root, 'src-tauri/icons', name);
const chunk = (type, data) => {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
};
try {
  // Retain Tauri's platform/mobile resources, then explicitly pack desktop sizes.
  run(source('app'), '--output', 'src-tauri/icons', '--ios-color', '#0b1b31');
  for (const kind of ['app', 'tray']) {
    for (const tiny of [false, true]) {
      const sizes = tiny ? [16, 20, 32] : [16, 20, 24, 32, 48, 64, 128, 256, 512, 1024];
      run(source(kind, tiny), '--output', join(scratch, `${kind}-${tiny ? 'tiny' : 'main'}`),
        ...sizes.flatMap((size) => ['--png', String(size)]));
    }
    for (const size of [16, 20, 24, 32, 64, 128, 256, 512, 1024]) {
      // Tray runtime needs only 16–32; larger outputs remain available for QA.
      if (kind === 'app' || size <= 32) copyFileSync(raster(kind, size), output(`${kind}-${size}.png`));
    }
  }
  copyFileSync(raster('app', 20), output('ios/AppIcon-20x20@1x.png'));
  copyFileSync(join(root, source('app')), output('icon.svg'));
  copyFileSync(raster('app', 1024), output('app-master-1024.png'));

  // ICO entries contain their selected raster, never a downscaled master.
  const sizes = [16, 20, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => readFileSync(raster('app', size)));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const pos = 6 + index * 16;
    header[pos] = header[pos + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, pos + 4);
    header.writeUInt16LE(32, pos + 6);
    header.writeUInt32LE(images[index].length, pos + 8);
    header.writeUInt32LE(offset, pos + 12);
    offset += images[index].length;
  });
  writeFileSync(output('icon.ico'), Buffer.concat([header, ...images]));

  // ICNS logical 16 @2x uses tiny at 32 physical pixels; logical 32 uses main.
  const representations = [
    ['icp4', 16, true], ['icp5', 32, false], ['icp6', 64, false],
    ['ic07', 128, false], ['ic08', 256, false], ['ic09', 512, false],
    ['ic10', 1024, false], ['ic11', 32, true], ['ic12', 64, false],
    ['ic13', 256, false], ['ic14', 512, false],
  ];
  writeFileSync(output('icon.icns'), chunk('icns', Buffer.concat(representations.map(
    ([type, size, tiny]) => chunk(type, readFileSync(raster('app', size, tiny))),
  ))));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
