import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Keep the approved sources unchanged. Tauri owns platform rasterization.
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'codex-monitor-icons-'));
const run = (...args) => {
  const result = spawnSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'icon', ...args], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Tauri icon generation failed (${result.status})`);
};
try {
  run('docs/branding/v1.2/app-icon-source.svg', '--output', 'src-tauri/icons', '--ios-color', '#0b1b31');
  run('docs/branding/v1.2/app-icon-source.svg', '--output', join(scratch, 'app'), '--png', '1024');
  run('docs/branding/v1.2/tray-icon-source.svg', '--output', join(scratch, 'tray'),
    '--png', '16', '--png', '20', '--png', '24', '--png', '32');
  copyFileSync(join(root, 'docs/branding/v1.2/app-icon-source.svg'), join(root, 'src-tauri/icons/icon.svg'));
  copyFileSync(join(scratch, 'app/1024x1024.png'), join(root, 'src-tauri/icons/app-master-1024.png'));
  for (const size of [16, 20, 24, 32]) {
    copyFileSync(join(scratch, `tray/${size}x${size}.png`), join(root, `src-tauri/icons/tray-${size}.png`));
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
