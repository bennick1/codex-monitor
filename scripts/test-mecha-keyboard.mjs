// Synthetic Chromium regression for visible Mecha tab keyboard focus.
// This does not establish native keyboard or human visual acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = resolve('outputs/v1.3.0-validation/mecha-keyboard');
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
const results = [];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 314, height: 514 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await page.goto(`${server.resolvedUrls.local[0]}src/test/tokenLayout.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'true');
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  for (const language of ['zh-CN', 'en']) for (const theme of ['light', 'dark']) {
    const name = `${language}-${theme}`;
    await page.evaluate(async options => {
      await window.__renderTokenFixture({ view: 'card', skin: 'mecha-light', tokenStatus: 'ready', quotaStatus: 'ok', stale: false, mode: 'overview', shortWindow: true, percent: 70, opacityPercent: 100, ...options });
      await document.fonts.ready;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }, { language, theme });
    const host = page.locator('.quota-card');
    const before = await host.screenshot({ path: resolve(output, `${name}-before.png`) });
    await page.locator('.token-heading .token-switch button').first().focus();
    await page.keyboard.press('Tab');
    const focused = await host.screenshot({ path: resolve(output, `${name}-focused.png`) });
    const state = await page.evaluate(() => {
      const element = document.activeElement;
      const tabs = [...document.querySelectorAll('.token-heading .token-switch button')];
      const style = getComputedStyle(element);
      const accentColor = getComputedStyle(document.querySelector('.quota-card .primary-metric')).color;
      return { focusedTabIndex: tabs.indexOf(element), focusVisible: element.matches(':focus-visible'), outline: style.outline, outlineColor: style.outlineColor, accentColor, outlineOffset: style.outlineOffset, clipPath: style.clipPath };
    });
    const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
    const result = { name, ...state, focusChangesPixels: !before.equals(focused), beforeSha256: sha256(before), focusedSha256: sha256(focused) };
    results.push(result);
    assert.equal(result.focusedTabIndex, 1, `${name}: Tab must reach the existing second Token tab`);
    assert.equal(result.focusVisible, true, `${name}: keyboard focus must match :focus-visible`);
    assert.equal(result.outlineColor, result.accentColor, `${name}: focus must use the Mecha accent in both OS themes`);
    assert.equal(result.focusChangesPixels, true, `${name}: focus is visually unchanged, possibly clipped by the tab outline`);
  }
  console.log(`Mecha keyboard focus: ${results.length}/${results.length} passed`);
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await server.close();
}
