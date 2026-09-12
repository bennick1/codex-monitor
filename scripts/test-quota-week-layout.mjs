// Synthetic layout regression only; never reads real Codex data or app storage.
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const output = 'outputs/quota-week-layout';
await mkdir(output, { recursive: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 314, height: 514 }, deviceScaleFactor: 2 });
  await page.goto(`${server.resolvedUrls.local[0]}src/test/tokenLayout.html`);
  await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'true');
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  for (const skin of ['default', 'blur', 'computer']) for (const language of ['zh-CN', 'en']) for (const theme of ['light', 'dark']) for (const shortWindow of [true, false]) {
    const name = `${skin}-${language}-${theme}-${shortWindow ? 'full' : 'compact'}`;
    await page.evaluate(async options => {
      await window.__renderTokenFixture(options);
      await document.fonts.ready;
    }, { skin, language, theme, shortWindow, mode: 'turns', view: 'card', tokenStatus: 'ok', quotaStatus: 'ok', stale: false });
    const result = await page.evaluate(() => {
      const errors = [];
      const rect = el => el.getBoundingClientRect();
      const card = document.querySelector('.quota-card');
      const header = document.querySelector('.token-turn-header');
      const list = document.querySelector('.token-turn-list');
      const heads = [...header.children];
      const rows = [...list.children];
      const expectedHeight = card.classList.contains('quota-card--height-compact') ? 452 : 506;
      if (Math.abs(rect(card).width - 306) > 0.1 || Math.abs(rect(card).height - expectedHeight) > 0.1) errors.push('card size changed');
      card.scrollTop = 80;
      if (card.scrollTop !== 0 || document.documentElement.scrollWidth > innerWidth) errors.push('outer overflow');
      if (['auto', 'scroll'].includes(getComputedStyle(card).overflowY) && card.scrollHeight > card.clientHeight + 1) errors.push('outer scrollbar');
      for (const row of rows) {
        const cells = [...row.children];
        for (let i = 0; i < cells.length; i++) {
          const box = rect(cells[i]);
          if (Math.abs(box.x - rect(heads[i]).x) > 1 || Math.abs(box.width - rect(heads[i]).width) > 1) errors.push('header/row column mismatch');
          if (i > 0 && getComputedStyle(cells[i]).textAlign !== 'right') errors.push('numeric/effort alignment');
          if (i > 0 && getComputedStyle(heads[i]).textAlign !== 'right') errors.push('header alignment');
          if (i === 1 && cells[i].scrollWidth > cells[i].clientWidth + 1) errors.push('effort clipped');
          if (i === 2 && cells[i].scrollWidth > cells[i].clientWidth + 1) errors.push('token overflow');
          if (i < 3 && box.right > rect(cells[i+1]).left) errors.push('overlapping columns');
        }
        if (getComputedStyle(cells[0]).textOverflow !== 'ellipsis') errors.push('model ellipsis lost');
      }
      if (list.scrollHeight <= list.clientHeight) errors.push('fixture does not exercise internal scroll');
      const cardTop = rect(card).top;
      list.scrollTop = 90;
      if (!list.scrollTop || rect(card).top !== cardTop) errors.push('internal scroll failed');
      return { errors: [...new Set(errors)], columns: getComputedStyle(header).gridTemplateColumns, gap: getComputedStyle(header).columnGap };
    });
    await page.screenshot({ path: `${output}/${name}.png` });
    results.push({ name, ...result });
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  const failed = results.filter(r => r.errors.length);
  console.log(JSON.stringify({ cases: results.length, failed }, null, 2));
  if (failed.length) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
