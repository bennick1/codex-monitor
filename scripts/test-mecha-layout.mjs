// Synthetic Chromium engineering checks. Screenshots aid review; neither these
// DOM assertions nor this fixture establish native or human visual acceptance.
// No user preferences, Codex rollouts, account state, or databases are accessed.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = resolve('outputs/v1.3.0-validation/mecha');
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const results = [];
const runtimeErrors = [];
const canonicalAccents = new Map();
const orbGeometry = new Map();
let browser;

const thresholds = [70, 50, 34, 11, 10, 6, 0, 50.01, 49.99, 10.01, 9.99];
const languages = ['zh-CN', 'en'];
const opacities = [100, 60];
const modes = ['overview', 'models', 'turns'];
const tier = percent => percent > 50 ? 'healthy' : percent > 10 ? 'caution' : 'critical';
const label = options => [options.view, options.language, options.shortWindow ? '5h' : 'weekly',
  options.quotaStatus, options.stale ? 'expired' : 'fresh', options.percent, options.mode, options.opacityPercent].join('-');

try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 314, height: 514 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('requestfailed', request => runtimeErrors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.goto(`${server.resolvedUrls.local[0]}src/test/tokenLayout.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'true');
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });

  const render = async options => {
    const retainedQuota = options.quotaStatus === 'ok' || options.quotaStatus === 'stale' && !options.stale;
    await page.setViewportSize(options.view === 'orb' ? { width: 80, height: 80 }
      : { width: 314, height: options.shortWindow === false && retainedQuota ? 460 : 514 });
    await page.evaluate(async value => {
      await window.__renderTokenFixture(value);
      await document.fonts.ready;
    }, { skin: 'mecha-light', theme: 'light', tokenStatus: 'ready', stale: false, ...options });
  };

  const inspect = async options => page.evaluate(options => {
    const errors = [];
    const add = value => errors.push(value);
    const box = node => node.getBoundingClientRect();
    const near = (a, b) => Math.abs(a - b) <= 0.6;
    const host = document.querySelector(options.view === 'orb' ? '.quota-orb' : '.quota-card');
    if (!host) return { errors: ['widget missing'] };
    const hostBox = box(host);
    const hostStyle = getComputedStyle(host);
    const isOrb = options.view === 'orb';
    // The existing card retains cached stale quota for 30 minutes. The orb
    // presents stale as unavailable immediately; preserve both established rules.
    const available = options.quotaStatus === 'ok' || !isOrb && options.quotaStatus === 'stale' && !options.stale;
    const expectedHeight = isOrb ? 72 : options.shortWindow === false && available ? 452 : 506;
    if (!near(hostBox.width, isOrb ? 72 : 306) || !near(hostBox.height, expectedHeight)) add(`widget dimensions ${hostBox.width}x${hostBox.height}`);
    if (!host.classList.contains(`${isOrb ? 'quota-orb' : 'quota-card'}--skin-mecha-light`)) add('Mecha skin class missing');
    if (hostBox.left < -0.6 || hostBox.top < -0.6 || hostBox.right > innerWidth + 0.6 || hostBox.bottom > innerHeight + 0.6) add('widget outside viewport');
    if (document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth) add('outer horizontal overflow');
    host.scrollTop = 80;
    if (host.scrollTop || ['auto', 'scroll'].includes(hostStyle.overflowY) && host.scrollHeight > host.clientHeight + 1) add('outer vertical scrolling');

    let effectiveOpacity = 1;
    for (let node = host; node instanceof Element; node = node.parentElement) effectiveOpacity *= Number(getComputedStyle(node).opacity);
    if (Math.abs(effectiveOpacity - options.opacityPercent / 100) > 0.001) add(`whole-widget opacity ${effectiveOpacity}`);
    const shell = host.querySelector('svg.mecha-shell');
    if (!shell) add('runtime Mecha shell SVG missing');
    else {
      if (shell.getAttribute('aria-hidden') !== 'true') add('decorative shell exposed to accessibility tree');
      if (getComputedStyle(shell).pointerEvents !== 'none') add('shell can intercept controls');
      if (shell.querySelector('text, image, foreignObject')) add('shell embeds runtime content or bitmap');
    }
    const rawAccent = hostStyle.getPropertyValue('--mecha-accent').trim();
    if (!rawAccent) add('shared Mecha accent variable missing');
    const probe = document.createElement('i');
    probe.style.color = 'var(--mecha-accent)';
    host.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const channels = accent.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
    const strips = [...host.querySelectorAll('.mecha-light-strip')];
    if (!strips.length) add('Mecha light strips missing');
    for (const strip of strips) {
      if (getComputedStyle(strip).color !== accent || getComputedStyle(strip).stroke !== accent) add('light strips differ from common accent');
    }
    const metric = host.querySelector(isOrb ? '.orb-metric' : '.primary-metric');
    const progress = host.querySelector('.mecha-progress');
    if (available) {
      if (!metric) add('live quota metric missing');
      else {
        const expected = String(Math.max(0, Math.min(100, Math.round(options.percent))));
        if (metric.querySelector('span')?.textContent !== expected || metric.querySelector('small')?.textContent !== '%') add('runtime quota number or percent sign incorrect');
        for (const node of metric.querySelectorAll('span, small')) {
          if (getComputedStyle(node).color !== accent) add('quota number/percent differs from common accent');
          const rect = box(node);
          if (rect.left < hostBox.left || rect.right > hostBox.right || rect.top < hostBox.top || rect.bottom > hostBox.bottom) add('quota number clipped');
        }
      }
      if (!progress) add('live Mecha progress missing');
      else {
        if (progress.getAttribute('role') !== 'progressbar' || Number(progress.getAttribute('aria-valuenow')) !== options.percent) add('raw progress value/accessibility mismatch');
        const segments = [...progress.children];
        const fillPercent = segments.reduce((sum, segment) => sum + parseFloat(getComputedStyle(segment).getPropertyValue('--mecha-fill')), 0) / segments.length;
        if (!segments.length || Math.abs(fillPercent - options.percent) > 0.0001) add('raw progress fill mismatch');
        for (const segment of segments) if (getComputedStyle(segment, '::after').backgroundColor !== accent) add('progress differs from common accent');
      }
      const [r, g, b] = channels;
      const expectedTier = options.quotaStatus !== 'ok' ? 'unknown' : options.percent > 50 ? 'healthy' : options.percent > 10 ? 'caution' : 'critical';
      if (expectedTier === 'healthy' && !(b > r + 25 && b > g)) add('healthy accent is not blue');
      if (expectedTier === 'caution' && !(r > g && g > b + 25)) add('caution accent is not amber');
      if (expectedTier === 'critical' && !(r > g + 35 && r > b + 25)) add('critical accent is not red');
      if (expectedTier === 'unknown') {
        if (r > g + 35 && r > b + 25) add('stale cached quota falsely uses low-quota red');
        if (!host.querySelector('.usage-indicator--stale[role="status"]')?.getAttribute('aria-label')) add('stale cached quota lost status meaning');
      }
      if (options.shortWindow === false) {
        if (isOrb && host.querySelector('.orb-weekly-badge')?.textContent?.trim() !== 'W') add('weekly fallback W meaning missing');
        const name = isOrb ? host.getAttribute('aria-label') : metric?.getAttribute('aria-label');
        if (!name?.match(/本周|Weekly/)) add('weekly fallback accessible label missing');
      }
    } else {
      if (metric || progress || host.querySelector('[role="progressbar"]')) add('unavailable quota rendered a numeric metric/progress');
      if (!host.querySelector(isOrb ? '.orb-unavailable' : '.error-state')) add('error-state semantics missing');
      const [r, g, b] = channels;
      if (r > g + 35 && r > b + 25) add('unknown quota falsely uses low-quota red');
    }

    if (!isOrb) {
      const tabs = [...host.querySelectorAll('.token-heading .token-switch button')];
      if (tabs.length !== 3 || tabs.filter(tab => tab.getAttribute('aria-pressed') === 'true').length !== 1) add('three-tab selection contract changed');
      for (const tab of tabs) {
        const rect = box(tab);
        if (rect.left < hostBox.left || rect.right > hostBox.right || rect.bottom > hostBox.bottom) add('tab clipped');
        if (tab.scrollWidth > tab.clientWidth + 1) add('tab label overflow');
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (target !== tab && !tab.contains(target)) add('tab intercepted by decoration');
      }
      const list = host.querySelector(options.mode === 'turns' ? '.token-turn-list' : '.token-model-list');
      if (options.mode !== 'overview') {
        if (!list || list.scrollHeight <= list.clientHeight) add('fixture does not exercise internal list scrolling');
        else {
          const top = hostBox.top;
          list.scrollTop = 90;
          if (!list.scrollTop || box(host).top !== top) add('internal scroll failed');
          list.scrollTop = 0;
        }
      }
      if (options.mode === 'turns') {
        const heads = [...host.querySelectorAll('.token-turn-header > span')];
        const rows = [...host.querySelectorAll('.token-turn-row')];
        if (rows.length !== 20 || heads.length !== 4) add('turn stress rows/columns missing');
        for (const [index, row] of rows.entries()) {
          const cells = [...row.children];
          const effort = cells[1];
          const effortText = effort?.querySelector('.token-turn-effort-text');
          const icon = effort?.querySelector('.token-turn-fast');
          if (Boolean(icon) !== (index % 3 === 0)) add('Fast/standard/unknown row binding');
          if (!effortText || getComputedStyle(effortText).textOverflow !== 'ellipsis') add('effort ellipsis lost');
          if (getComputedStyle(cells[0]).textOverflow !== 'ellipsis') add('model ellipsis lost');
          if (icon) {
            const rect = box(icon);
            if (!near(rect.width, 12) || !near(rect.height, 12) || getComputedStyle(icon).flexShrink !== '0') add('12px Lightning shrank');
            if (rect.left < box(effort).left - 0.6 || rect.right > box(effort).right + 0.6 || rect.right > box(effortText).left + 0.6) add('Lightning clipped/overlapping');
            const height = box(row).height;
            icon.style.display = 'none';
            if (!near(box(row).height, height)) add('Lightning changes row height');
            icon.style.removeProperty('display');
            if (!effort.getAttribute('aria-label')?.includes(options.language === 'en' ? 'Fast mode' : '极速模式')) add('localized Lightning meaning missing');
            if (icon.getAttribute('aria-hidden') !== 'true') add('decorative Lightning exposed twice');
          }
          cells.forEach((cell, i) => {
            if (heads[i] && (!near(box(cell).x, box(heads[i]).x) || !near(box(cell).width, box(heads[i]).width))) add('header/data columns misaligned');
            if (i > 0 && getComputedStyle(cell).textAlign !== 'right') add('effort/token/weekly alignment changed');
            if ((i === 1 || i === 2) && cell.scrollWidth > cell.clientWidth + 1) add('effort/token content overflow');
          });
        }
      }
    }
    const geometry = shell ? [...shell.querySelectorAll('path, polygon, rect, circle, line')].map(node =>
      ['tagName', 'd', 'points', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2']
        .map(key => key === 'tagName' ? node.tagName : node.getAttribute(key)).join('|')).join('\n') : null;
    return { errors: [...new Set(errors)], accent, rawAccent, effectiveOpacity, geometry,
      dimensions: { width: hostBox.width, height: hostBox.height } };
  }, options);

  const run = async (options, screenshot = false) => {
    await render(options);
    const result = await inspect(options);
    const name = label(options);
    if (options.quotaStatus === 'ok') {
      const state = tier(options.percent);
      if (!canonicalAccents.has(state)) canonicalAccents.set(state, result.accent);
      else if (canonicalAccents.get(state) !== result.accent) result.errors.push('expanded/collapsed/source/opacity state accent diverges');
      if (options.view === 'orb') {
        const key = `${options.language}-${options.shortWindow}`;
        if (!orbGeometry.has(key)) orbGeometry.set(key, result.geometry);
        else if (orbGeometry.get(key) !== result.geometry) result.errors.push('collapsed shell geometry changes with quota tier');
      }
    }
    const { geometry, ...record } = result;
    results.push({ name, options, ...record });
    if (screenshot || result.errors.length) await page.screenshot({ path: `${output}/${name}.png` });
  };

  // Cover every threshold in both dimensions and both primary-window sources.
  for (const percent of thresholds) for (const language of languages) for (const shortWindow of [true, false]) for (const opacityPercent of opacities) {
    const options = { percent, language, shortWindow, opacityPercent, quotaStatus: 'ok', mode: 'turns' };
    await run({ ...options, view: 'card' }, language === 'zh-CN' && shortWindow && [70, 50, 34, 11, 10, 6].includes(percent));
    await run({ ...options, view: 'orb' }, language === 'zh-CN' && shortWindow && [70, 50, 34, 11, 10, 6].includes(percent));
  }

  for (const language of languages) for (const shortWindow of [true, false]) for (const opacityPercent of opacities) {
    for (const mode of ['overview', 'models']) await run({ view: 'card', percent: 34, language, shortWindow, opacityPercent, quotaStatus: 'ok', mode }, true);
    for (const quotaStatus of ['stale', 'unavailable', 'signed_out']) {
      for (const mode of modes) await run({ view: 'card', percent: 6, language, shortWindow, opacityPercent, quotaStatus, mode });
      await run({ view: 'orb', percent: 6, language, shortWindow, opacityPercent, quotaStatus, mode: 'overview' }, true);
    }
    for (const mode of modes) await run({ view: 'card', percent: 6, language, shortWindow, opacityPercent, quotaStatus: 'stale', stale: true, mode });
    await run({ view: 'orb', percent: 6, language, shortWindow, opacityPercent, quotaStatus: 'stale', stale: true, mode: 'overview' }, true);
  }

  // Use actual pointer clicks to ensure decoration does not consume tab input.
  for (const language of languages) {
    const options = { view: 'card', percent: 70, language, shortWindow: false, opacityPercent: 60, quotaStatus: 'ok', mode: 'overview' };
    await render(options);
    const errors = [];
    for (const [index, mode] of modes.entries()) {
      await page.locator('.token-heading .token-switch button').nth(index).click();
      const active = await page.locator('.token-heading .token-switch button').nth(index).getAttribute('aria-pressed');
      if (active !== 'true') errors.push(`${mode}: pointer click failed`);
      errors.push(...(await inspect({ ...options, mode })).errors.map(error => `${mode}: ${error}`));
    }
    results.push({ name: `pointer-tabs-${language}`, errors: [...new Set(errors)] });
  }
} finally {
  await browser?.close();
  await server.close();
  results.push({ name: 'runtime-errors', errors: runtimeErrors });
  await writeFile(`${output}/results.json`, JSON.stringify({
    evidence: 'Synthetic Chromium DOM/layout checks and screenshots; native and human visual acceptance not established.',
    thresholds, stateAccents: Object.fromEntries(canonicalAccents), results,
  }, null, 2));
}
const failed = results.filter(result => result.errors.length);
console.log(JSON.stringify({ cases: results.length, failed: failed.length, examples: failed.slice(0, 8), output,
  evidence: 'Synthetic browser engineering checks only. Human/native acceptance remains separate.' }, null, 2));
if (failed.length) process.exitCode = 1;
