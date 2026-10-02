import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createExactServer } from './preview-mecha-tabs-exact.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const phase = process.argv[2] || 'actual';
assert.ok(/^[a-z0-9-]+$/.test(phase));
const output = resolve('docs/design/v1.3.0/mecha-light/tabs-reference-exact', phase);
// Evidence phases are append-only. Pick a new phase name for each capture.
await mkdir(output);
const server = await createExactServer();
const report = { phase, source: 'production runtime components and CSS, synthetic data', environment: {}, cases: [], errors: [] };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--force-color-profile=srgb'], executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  report.environment = { browser: browser.version(), dpr: 1, colorProfile: 'sRGB', reducedMotion: 'reduce', time: '2026-09-30T12:00:00Z', hover: 'outside', focus: 'blurred' };
  const page = await browser.newPage({ viewport: { width: 314, height: 514 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  page.on('pageerror', e => report.errors.push(e.message));
  await page.addInitScript(() => {
    const NativeDate = Date, time = Date.parse('2026-09-30T12:00:00Z');
    window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } };
  });
  for (const [state, percent] of [['blue', 70], ['amber', 34], ['red', 6]]) {
    if (process.env.MECHA_CAPTURE_COLOR && process.env.MECHA_CAPTURE_COLOR !== state) continue;
    for (const height of ['full', 'compact']) for (const mode of ['turns', 'overview', 'models']) {
      if (process.env.MECHA_CAPTURE_DIRECT_ONLY && (height !== 'full' || mode !== 'turns')) continue;
      const name = `${state}-${mode}-${height}`;
      await page.setViewportSize({ width: 314, height: height === 'full' ? 514 : 460 });
      await page.goto(`${server.resolvedUrls.local[0]}src/test/tokenLayout.html?percent=${percent}&height=${height}&mode=${mode}`, { waitUntil: 'networkidle' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll('.mecha-tab-label-patch')].map(image => image.decode()));
        document.activeElement?.blur();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      await page.mouse.move(0, 0);
      const geometry = await page.evaluate(() => {
        const rect = n => { if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const one = s => rect(document.querySelector(s));
        const group = document.querySelector('.token-heading > .token-switch');
        return { card: one('.quota-card'), title: one('.token-heading h2'), heading: one('.token-heading'), tabs: rect(group),
          content: one('.token-grid, .token-model-view, .token-turn-view'), list: one('.token-model-list, .token-turn-list'),
          buttons: [...group.children].map(n => { const range = document.createRange(); range.selectNodeContents(n); const c = getComputedStyle(n); return { box: rect(n), text: rect(range), label: n.textContent, pressed: n.getAttribute('aria-pressed'), font: c.font, color: c.color }; }) };
      });
      assert.equal(geometry.tabs.width, 258); assert.equal(geometry.tabs.height, 33);
      if (height === 'full') {
        await page.locator('.quota-card').screenshot({ path: resolve(output, `${name}-widget.png`), animations: 'disabled' });
        // The fixed 258x36 registered canvas includes the complete true bottom.
        await page.screenshot({ path: resolve(output, `${name}-tabs.png`), clip: { x: geometry.tabs.x, y: geometry.tabs.y - 2, width: 258, height: 36 }, animations: 'disabled' });
      }
      const platformFonts = [];
      if (height === 'full' && mode === 'turns') {
        const dom = await cdp.send('DOM.getDocument');
        for (let i = 1; i <= 3; i++) {
          const node = await cdp.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: `.token-heading > .token-switch button:nth-child(${i}) > span` });
          platformFonts.push(await cdp.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId }));
        }
      }
      report.cases.push({ name, state, percent, height, mode, geometry, platformFonts });
    }
  }
  assert.equal(report.errors.length, 0);
} finally {
  await browser?.close(); await server.close();
  await writeFile(resolve(output, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ phase, cases: report.cases.length, errors: report.errors, first: report.cases[0] }, null, 2));
