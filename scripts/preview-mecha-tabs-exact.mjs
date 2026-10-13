// Synthetic data only; the production QuotaCard, TokenUsage and CSS are untouched.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export async function createExactServer(port = 0) {
  const server = await createServer({
    server: { host: '127.0.0.1', port, strictPort: port !== 0, hmr: false },
    plugins: [{ name: 'mecha-exact-synthetic-input', enforce: 'pre', transform(code, id) {
      if (!id.split('?')[0].endsWith('/src/test/tokenLayout.tsx')) return null;
      let count = 0;
      code = code.replace(/onDrag=\{\(\) => \{\}\}/g, () => {
        count++;
        return 'onDrag={() => { window.__mechaFixtureDragCount = (window.__mechaFixtureDragCount || 0) + 1; }}';
      });
      assert.equal(count, 2);
      return { code: code + `\nconst params = new URLSearchParams(location.search);
        window.__renderTokenFixture({ view: 'card', tokenStatus: 'ready', quotaStatus: 'ok', stale: false,
          skin: params.get('skin') || 'mecha-light', language: params.get('language') || 'zh-CN',
          theme: params.get('theme') || 'light', mode: params.get('mode') || 'turns',
          percent: Number(params.get('percent') || 70), shortWindow: params.get('height') !== 'compact',
          opacityPercent: Number(params.get('opacity') || 100) });`, map: null };
    } }],
  });
  await server.listen();
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createExactServer(Number(process.env.MECHA_PREVIEW_PORT || 1434));
  console.log(`${server.resolvedUrls.local[0]}docs/design/v1.3.0/mecha-light/tabs-reference-exact/`);
}
