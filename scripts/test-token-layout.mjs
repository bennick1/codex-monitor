// Headless rendering test using only synthetic props. Requires a local Playwright
// installation supplied via PLAYWRIGHT_MODULE_PATH; no app/user browser is used.
import { createServer } from 'vite';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const server = await createServer({ server: { middlewareMode: true } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const out = resolve('outputs/token-ui-layout');
await mkdir(out, { recursive: true });
const results = [];
try {
  const { layoutFixture } = await server.ssrLoadModule('/src/test/tokenLayout.tsx');
  const css = await readFile('src/styles.css', 'utf8');
  const page = await browser.newPage({ viewport: { width: 314, height: 514 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  for (const language of ['zh-CN', 'en']) for (const theme of ['light', 'dark']) for (const status of ['ready', 'scanning', 'partial', 'empty', 'unavailable']) for (const quota of ['ok', 'unavailable', 'signed_out', 'stale']) {
    const name = `${language}-${theme}-${status}-${quota}`;
    await page.setContent(`<html lang="${language}"><head><style>${css}</style></head><body><div id="root">${layoutFixture(language, theme, status, quota, true)}</div></body></html>`);
    const errors = await page.evaluate(() => {
      const errors = [];
      const card = document.querySelector('main').getBoundingClientRect();
      const nodes = document.querySelectorAll('.token-usage, .token-usage h2, .token-grid > div, .token-grid dt, .token-grid dd, .token-meta p, .card-header, .card-footer, .reset-time, .error-state');
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.right > card.right - 2 || r.bottom > card.bottom - 8 || r.left < card.left || r.top < card.top || el.scrollWidth > el.clientWidth + 1) errors.push(`${el.className || el.tagName}: overflow (${r.width} x ${r.height}, bottom ${r.bottom})`);
      }
      for (const el of document.querySelectorAll('.token-grid > div')) {
        const label = el.querySelector('dt').getBoundingClientRect(), value = el.querySelector('dd').getBoundingClientRect();
        if (label.bottom > value.top) errors.push('label/value overlap');
      }
      const quota = document.querySelector('.card-footer') || document.querySelector('.error-state');
      if (quota && quota.getBoundingClientRect().bottom > document.querySelector('.token-usage').getBoundingClientRect().top) errors.push('quota/token overlap');
      return errors;
    });
    results.push({ name, errors });
    if (status === 'partial' && quota === 'ok') await page.screenshot({ path: `${out}/${name}.png` });
  }
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
  const failed = results.filter(r => r.errors.length);
  console.log(JSON.stringify({ cases: results.length, failed: failed.length, examples: failed.slice(0, 4), output: out }, null, 2));
  if (failed.length) process.exitCode = 1;
} finally { await browser.close(); await server.close(); }
