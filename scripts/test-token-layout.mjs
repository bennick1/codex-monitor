// Headless visual layout test using only synthetic props. Requires a local
// Playwright installation; no app preferences, sessions, or databases are read.
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0];
if (!base) throw new Error('Vite fixture URL is unavailable');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const out = resolve('outputs/token-ui-layout');
await mkdir(out, { recursive: true });
const results = [];
const requestFailures = [];
const consoleErrors = [];

function caseName(parts) { return parts.join('-').replaceAll('_', '-'); }

try {
  const page = await browser.newPage({ viewport: { width: 314, height: 514 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  page.on('requestfailed', request => requestFailures.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(`${base}src/test/tokenLayout.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'true');

  const render = async options => {
    await page.evaluate(async value => {
      if (!window.__renderTokenFixture) throw new Error('fixture renderer unavailable');
      await window.__renderTokenFixture(value);
      await document.fonts.ready;
    }, options);
  };

  const inspectCard = async (skin, mode) => page.evaluate(({ skin, mode }) => {
    const errors = [];
    const cardElement = document.querySelector('.quota-card');
    if (!(cardElement instanceof HTMLElement)) return ['card missing'];
    const card = cardElement.getBoundingClientRect();
    const computed = getComputedStyle(cardElement);
    if (Math.abs(card.width - 306) > 0.1 || Math.abs(card.height - 506) > 0.1) errors.push(`card geometry ${card.width}x${card.height}`);
    if (computed.width !== '306px' || computed.height !== '506px') errors.push(`computed geometry ${computed.width}x${computed.height}`);
    if (skin === 'default' && /skin-(blur|computer)/.test(cardElement.className)) errors.push('default has a skin class');
    if (skin !== 'default' && !cardElement.classList.contains(`quota-card--skin-${skin}`)) errors.push(`${skin} class missing`);
    if (document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth) errors.push('document horizontal overflow');

    const nodes = document.querySelectorAll('.token-usage, .token-usage h2, .token-grid > div, .token-grid dt, .token-grid dd, .token-meta p, .token-heading, .token-switch, .token-model-list, .token-model-list li, .card-header, .card-footer, .reset-time, .error-state');
    for (const el of nodes) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      const isScrollableListItem = el.matches('.token-model-list li');
      const outsideHorizontally = rect.right > card.right + 0.5 || rect.left < card.left - 0.5;
      const outsideVertically = !isScrollableListItem && (rect.bottom > card.bottom + 0.5 || rect.top < card.top - 0.5);
      if (outsideHorizontally || outsideVertically) errors.push(`${el.className || el.tagName}: outside card`);
      const allowsScroll = style.overflowX === 'auto' || style.overflowX === 'scroll';
      if (!allowsScroll && el.scrollWidth > el.clientWidth + 1) errors.push(`${el.className || el.tagName}: horizontal overflow ${el.scrollWidth}/${el.clientWidth}`);
    }
    for (const el of document.querySelectorAll('.token-grid > div')) {
      const label = el.querySelector('dt')?.getBoundingClientRect();
      const value = el.querySelector('dd')?.getBoundingClientRect();
      if (label && value && label.bottom > value.top + 0.5) errors.push('overview label/value overlap');
    }
    const quota = document.querySelector('.card-footer') || document.querySelector('.error-state');
    const token = document.querySelector('.token-usage');
    if (quota && token && quota.getBoundingClientRect().bottom > token.getBoundingClientRect().top + 0.5) errors.push('quota/token overlap');
    if (mode === 'models') {
      const list = document.querySelector('.token-model-list');
      if (list && list.scrollHeight <= list.clientHeight) errors.push('multi-model list does not scroll');
      const names = [...document.querySelectorAll('.token-model-name')];
      if (!names.some(name => name.getAttribute('title')?.includes('intentionally-very-long'))) errors.push('long model slug missing');
      if (!document.querySelector('[data-model="unknown"]')) errors.push('unknown model missing');
      if (!document.querySelector('.token-value--long')) errors.push('large token stress value missing');
    }
    if (/supporter|license|purchase|unlock/i.test(cardElement.innerHTML)) errors.push('access-gate terminology rendered');
    return errors;
  }, { skin, mode });

  const skins = ['default', 'blur', 'computer'];
  const themes = ['light', 'dark'];
  const languages = ['zh-CN', 'en'];
  const tokenStatuses = ['ready', 'scanning', 'partial', 'empty', 'unavailable'];
  const quotaStatuses = ['ok', 'stale', 'unavailable', 'signed_out'];
  const modes = ['overview', 'models'];
  for (const skin of skins) for (const theme of themes) for (const language of languages) for (const tokenStatus of tokenStatuses) for (const quotaStatus of quotaStatuses) for (const mode of modes) {
    const name = caseName([skin, theme, language, tokenStatus, quotaStatus, mode]);
    await render({ view: 'card', skin, theme, language, tokenStatus, quotaStatus, stale: tokenStatus !== 'ready', mode });
    const errors = await inspectCard(skin, mode);
    if (mode === 'models') {
      const periodButtons = page.locator('.token-period-switch button');
      if (await periodButtons.count() !== 5) errors.push('five model periods not rendered');
      for (let index = 0; index < await periodButtons.count(); index++) {
        await periodButtons.nth(index).click();
        const selectedErrors = await inspectCard(skin, mode);
        errors.push(...selectedErrors.map(error => `period-${index}: ${error}`));
      }
    }
    results.push({ name, errors: [...new Set(errors)] });
    if (language === 'zh-CN' && tokenStatus === 'partial' && quotaStatus === 'ok') {
      await page.screenshot({ path: `${out}/${name}.png` });
      const value = page.locator('.token-value').first();
      for (const interaction of ['hover', 'focus']) {
        await value[interaction]();
        const detailErrors = await value.evaluate(el => {
          const detail = el.querySelector('.token-exact');
          if (!(detail instanceof HTMLElement)) return ['detail missing'];
          const box = detail.getBoundingClientRect();
          const card = document.querySelector('.quota-card').getBoundingClientRect();
          const errors = [];
          if (!box.width || !box.height || getComputedStyle(detail).display === 'none') errors.push('detail not visible');
          if (box.left < card.left || box.right > card.right || box.top < card.top || box.bottom > card.bottom || detail.scrollWidth > detail.clientWidth + 1) errors.push('detail overflow');
          if (!/: \d{1,3}(,\d{3})*( · |$)/.test(detail.textContent) || /[万亿]/.test(detail.textContent)) errors.push('detail is not a grouped full integer');
          return errors;
        });
        results.push({ name: `${name}-${interaction}`, errors: detailErrors });
      }
    }
  }

  await page.setViewportSize({ width: 80, height: 80 });
  const orbStates = ['healthy', 'caution', 'critical', 'stale', 'unavailable', 'signed_out'];
  for (const skin of skins) for (const theme of themes) for (const state of orbStates) {
    const name = caseName(['orb', skin, theme, state]);
    await render({ view: 'orb', skin, theme, language: 'zh-CN', tokenStatus: 'ready', quotaStatus: 'ok', stale: false, mode: 'overview', orbState: state });
    const errors = await page.evaluate(({ skin, state }) => {
      const errors = [];
      const orb = document.querySelector('.quota-orb');
      if (!(orb instanceof HTMLElement)) return ['orb missing'];
      const box = orb.getBoundingClientRect();
      const style = getComputedStyle(orb);
      if (style.width !== '72px' || style.height !== '72px') errors.push(`orb geometry ${style.width}x${style.height}`);
      if (box.left < -0.5 || box.top < -0.5 || box.right > innerWidth + 0.5 || box.bottom > innerHeight + 0.5) errors.push(`orb artwork clipped ${box.left},${box.top},${box.right},${box.bottom}`);
      if (skin === 'default' && /skin-(blur|computer)/.test(orb.className)) errors.push('default orb has a skin class');
      if (skin !== 'default' && !orb.classList.contains(`quota-orb--skin-${skin}`)) errors.push(`${skin} orb class missing`);
      if (state === 'healthy' || state === 'caution' || state === 'critical') {
        if (!orb.querySelector('.orb-metric')) errors.push('orb metric missing');
      } else if (!orb.querySelector('.orb-unavailable')) errors.push('orb unavailable art missing');
      return errors;
    }, { skin, state });
    results.push({ name, errors });
    if (theme === 'light') await page.screenshot({ path: `${out}/${name}.png` });
  }
} finally {
  await browser.close();
  await server.close();
}

results.push({ name: 'network-and-console', errors: [...requestFailures, ...consoleErrors] });
await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter(result => result.errors.length);
console.log(JSON.stringify({ cases: results.length, failed: failed.length, examples: failed.slice(0, 6), output: out }, null, 2));
if (failed.length) process.exitCode = 1;
