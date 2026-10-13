// Synthetic Chromium checks and same-condition Before/After captures.
// This fixture does not access user data or establish native/human acceptance.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseline = '1980d03dc0468ea499b0718280a3ad49dbf7a223';
const output = resolve('outputs/v1.3.0-tabs-round2');
const fixedTime = '2026-09-30T12:00:00.000Z';
const browserArgs = ['--disable-gpu', '--force-color-profile=srgb'];
const tabSelector = '.token-heading > .token-switch';
const modes = ['overview', 'models', 'turns'];
const states = [{ state: 'blue', percent: 70 }, { state: 'amber', percent: 34 }, { state: 'red', percent: 6 }];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const beforeCss = execFileSync('git', ['show', `${baseline}:src/mecha.css`], { encoding: 'utf8' });
const afterCss = await readFile(resolve('src/mecha.css'), 'utf8');
// Vite normally rewrites these relative font URLs. A replaced <style> resolves
// them against the HTML fixture, so retain the original stylesheet location.
const inlineCss = css => css.replace(/url\((['"]?)([^'"\)]+)\1\)/g, (all, quote, url) =>
  /^(?:[a-z]+:|\/|#)/i.test(url) ? all : `url("${posix.resolve('/src', url)}")`);

// Decode Chromium's lossless PNG output to RGBA, avoiding a new dependency and
// comparing pixels rather than PNG metadata/compression bytes.
function decodePng(png) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
  let width, height, channels;
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'PNG must use 8-bit channels');
      assert.ok([2, 6].includes(data[9]), `unsupported PNG color type ${data[9]}`);
      assert.equal(data[12], 0, 'PNG must not be interlaced');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') chunks.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  assert.equal(raw.length, (stride + 1) * height, 'PNG scanline length');
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4, `unsupported PNG filter ${filter}`);
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      row[x] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const dest = (y * width + x) * 4, src = x * channels;
      pixels[dest] = row[src]; pixels[dest + 1] = row[src + 1]; pixels[dest + 2] = row[src + 2];
      pixels[dest + 3] = channels === 4 ? row[src + 3] : 255;
    }
    previous = row;
  }
  return { width, height, pixels, rgbaSha256: sha256(pixels) };
}

function comparePixels(before, after, excluded = null) {
  if (before.width !== after.width || before.height !== after.height) return { equal: false, dimensionsDiffer: true };
  let changedPixels = 0, comparedPixels = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width; x++) {
    if (excluded && x >= excluded.x && x < excluded.x + excluded.width && y >= excluded.y && y < excluded.y + excluded.height) continue;
    comparedPixels++;
    const i = (y * before.width + x) * 4;
    if (before.pixels[i] !== after.pixels[i] || before.pixels[i + 1] !== after.pixels[i + 1]
      || before.pixels[i + 2] !== after.pixels[i + 2] || before.pixels[i + 3] !== after.pixels[i + 3]) {
      changedPixels++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return { equal: changedPixels === 0, changedPixels, comparedPixels,
    changedBounds: changedPixels ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null };
}

const report = {
  evidence: 'Synthetic Chromium fixture only. Native interaction and human Tab visual acceptance remain Pending.',
  baseline, afterHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  css: { beforeSha256: sha256(beforeCss), afterSha256: sha256(afterCss), replacement: 'Entire Vite mecha.css style text on the same fixture DOM; relative URLs resolved from /src/' },
  environment: { browser: 'Chromium', browserArgs, deviceScaleFactor: 1, fixedTime, hover: 'outside card', focus: 'blurred except explicit keyboard captures' },
  matrix: { states, modes, languages: ['zh-CN', 'en'], heights: ['full', 'compact'], opacityPercent: [100, 60],
    primaryTheme: 'light', darkSupplement: 'All 9 state/mode combinations, English Compact 60%' },
  instrumentation: 'Vite in-memory transform replaces the two fixture-only no-op onDrag callbacks with counters; fixture/production files remain unchanged.',
  comparisons: [], interactions: [], runtimeErrors: [],
};
await mkdir(output, { recursive: true });
let instrumentationCount = 0;
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  plugins: [{ name: 'mecha-tabs-fixture-drag-counter', enforce: 'pre', transform(code, id) {
    if (!id.split('?')[0].endsWith('/src/test/tokenLayout.tsx')) return null;
    let count = 0;
    const transformed = code.replace(/onDrag=\{\(\) => \{\}\}/g, () => {
      count++;
      return 'onDrag={() => { window.__mechaFixtureDragCount = (window.__mechaFixtureDragCount || 0) + 1; }}';
    });
    assert.equal(count, 2, 'fixture onDrag instrumentation must match both original no-op callbacks');
    instrumentationCount = count;
    return { code: transformed, map: null };
  } }],
});
let browser;

const caseName = options => [options.skin === 'mecha-light' ? options.state : options.skin, options.mode,
  options.language, options.shortWindow ? 'full' : 'compact', options.opacityPercent, options.theme].join('-');

try {
  await server.listen();
  // Software rasterization and sRGB avoid nondeterministic 8-bit rounding in
  // Default's blur layers without altering CSS or tolerating changed pixels.
  browser = await chromium.launch({ headless: true, args: browserArgs, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  report.environment.browserVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 314, height: 514 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page.on('pageerror', error => report.runtimeErrors.push(error.message));
  page.on('requestfailed', request => report.runtimeErrors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  await page.addInitScript(timestamp => {
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [timestamp])); }
      static now() { return timestamp; }
    };
    window.__mechaFixtureDragCount = 0;
  }, Date.parse(fixedTime));
  await page.goto(`${server.resolvedUrls.local[0]}src/test/tokenLayout.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'true');
  assert.equal(instrumentationCount, 2, 'fixture drag instrumentation was not loaded');
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  await page.evaluate(async () => {
    const assets = ['token-tabs.svg', 'token-tab-lights.svg'];
    await Promise.all(assets.map(file => new Promise((resolve, reject) => {
      const img = new Image(); img.onload = resolve; img.onerror = reject;
      img.src = `/assets/mecha-light/${file}`;
    })));
  });

  const settle = async () => page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const neutral = async () => {
    await page.mouse.move(0, 0);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await settle();
  };
  const replaceCss = async css => page.evaluate(css => {
      const styles = document.querySelectorAll('style[data-vite-dev-id$="/src/mecha.css"]');
      if (styles.length !== 1) throw new Error(`expected one mecha.css style, found ${styles.length}`);
      styles[0].textContent = css;
  }, inlineCss(css));
  const render = async (options, css) => {
    await page.setViewportSize({ width: 314, height: options.shortWindow ? 514 : 460 });
    await replaceCss(css);
    await page.evaluate(async options => {
      await window.__renderTokenFixture({ view: 'card', tokenStatus: 'ready', quotaStatus: 'ok', stale: false, ...options });
      window.__mechaFixtureDragCount = 0;
    }, options);
    await neutral();
  };
  const inspect = async (options, after) => page.evaluate(({ options, after, tabSelector }) => {
    const errors = [];
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const host = document.querySelector('.quota-card');
    const group = host.querySelector(tabSelector);
    const tabs = [...group.querySelectorAll('button')];
    const content = host.querySelector('.token-grid, .token-model-view, .token-turn-view');
    const list = host.querySelector('.token-model-list, .token-turn-list');
    const geometry = { card: rect(host), tokenUsage: rect(host.querySelector('.token-usage')), title: rect(host.querySelector('.token-heading h2')), heading: rect(host.querySelector('.token-heading')),
      tabs: rect(group), buttons: tabs.map(rect), content: content && rect(content), list: list && rect(list) };
    if (geometry.card.width !== 306 || geometry.card.height !== (options.shortWindow ? 506 : 452)) errors.push('widget dimensions changed');
    if (group.getAttribute('role') !== 'group' || !group.getAttribute('aria-label')) errors.push('mode group semantics changed');
    const selected = tabs.flatMap((tab, index) => tab.getAttribute('aria-pressed') === 'true' ? [index] : []);
    if (tabs.length !== 3 || selected.length !== 1 || selected[0] !== ['overview', 'models', 'turns'].indexOf(options.mode)) errors.push('mode/aria-pressed contract changed');
    if (document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth) errors.push('outer horizontal overflow');
    host.scrollTop = 40;
    if (host.scrollTop !== 0) errors.push('outer card scrolls');
    let scroll = null;
    if (options.mode !== 'overview') {
      if (!list || list.scrollHeight <= list.clientHeight) errors.push('fixture does not exercise list scrolling');
      else if (after) {
        // Keep behavior validation after both neutral captures so the pair
        // contains no intermediate scrolling or focus actions.
        const before = rect(host);
        list.scrollTop = 50;
        scroll = { scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight };
        if (!list.scrollTop || JSON.stringify(before) !== JSON.stringify(rect(host))) errors.push('internal list scroll moves/fails');
        list.scrollTop = 0;
      }
    }
    const hostStyle = getComputedStyle(host);
    const probe = document.createElement('i'); probe.style.color = 'var(--mecha-accent)'; host.append(probe);
    const accent = getComputedStyle(probe).color; probe.remove();
    const tabsStyle = tabs.map(tab => {
      const style = getComputedStyle(tab), beforeStyle = getComputedStyle(tab, '::before'), afterStyle = getComputedStyle(tab, '::after');
      const range = document.createRange(); range.selectNodeContents(tab);
      const label = range.getBoundingClientRect(), bounds = tab.getBoundingClientRect();
      if (tab.scrollWidth > tab.clientWidth + 1 || label.left < bounds.left || label.right > bounds.right) errors.push('mode label overflow');
      if (Math.abs((label.left + label.right) / 2 - (bounds.left + bounds.right) / 2) > 0.6) errors.push('mode label is not horizontally centered');
      let opacity = 1;
      for (let node = tab; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      if (Math.abs(opacity - options.opacityPercent / 100) > 0.001) errors.push('mode tab repeats or bypasses widget opacity');
      if (after && options.skin === 'mecha-light') {
        if (style.clipPath !== 'none') errors.push('button hit area/focus is clipped');
        if (tab.getAttribute('aria-pressed') === 'true'
          && !`${style.borderColor};${beforeStyle.background};${afterStyle.background}`.includes(accent))
          errors.push('selected tab edge does not reuse the resolved Mecha accent');
        for (const decoration of [beforeStyle, afterStyle]) if (decoration.content !== 'none' && decoration.content !== 'normal') {
          if (decoration.pointerEvents !== 'none') errors.push('tab decoration intercepts input');
          if (!['""', "''"].includes(decoration.content)) errors.push('tab decoration adds accessible text');
        }
      }
      return { label: tab.textContent, ariaPressed: tab.getAttribute('aria-pressed'), fontFamily: style.fontFamily, fontSize: style.fontSize,
        fontWeight: style.fontWeight, lineHeight: style.lineHeight, clipPath: style.clipPath, opacity,
        borderColor: style.borderColor, background: style.background, boxShadow: style.boxShadow,
        before: { clipPath: beforeStyle.clipPath, pointerEvents: beforeStyle.pointerEvents, background: beforeStyle.background },
        after: { clipPath: afterStyle.clipPath, pointerEvents: afterStyle.pointerEvents, background: afterStyle.background } };
    });
    const period = host.querySelector('.token-period-switch');
    const periodStyles = period ? [period, ...period.children].map(node => [null, '::before', '::after'].map(pseudo => {
      const style = getComputedStyle(node, pseudo);
      return Object.fromEntries([...style].map(name => [name, style.getPropertyValue(name)]));
    })) : null;
    if (period && period.children.length !== 5) errors.push('five period buttons changed');
    return { errors: [...new Set(errors)], geometry, tabsStyle, accent, rawAccent: hostStyle.getPropertyValue('--mecha-accent').trim(), scroll, periodStyles };
  }, { options, after, tabSelector });

  const clipFor = (box, padding = 0) => ({ x: Math.floor(box.x) - padding, y: Math.floor(box.y) - padding,
    width: Math.ceil(box.x + box.width) - Math.floor(box.x) + 2 * padding,
    height: Math.ceil(box.y + box.height) - Math.floor(box.y) + 2 * padding });
  const capturePair = async options => {
    const name = caseName(options), sides = {}, screenshots = {};
    // Keep the full verification matrix, but publish only the five requested
    // comparisons and one English/60% supplement, not hundreds of duplicates.
    const primary = options.skin === 'mecha-light' && options.language === 'zh-CN'
      && options.shortWindow && options.opacityPercent === 100 && options.theme === 'light'
      && (options.mode === 'turns' || options.state === 'blue');
    const supplement = options.skin === 'mecha-light' && options.state === 'blue' && options.mode === 'models'
      && options.language === 'en' && !options.shortWindow && options.opacityPercent === 60 && options.theme === 'light';
    const saveCard = primary && options.state === 'blue' && options.mode === 'turns';
    for (const [side, css] of [['before', beforeCss], ['after', afterCss]]) {
      // Keep the same component instances and compositor layers for the pair;
      // only the scoped stylesheet changes. Unrelated skin blur layers must
      // not be independently remounted before an exact RGBA comparison.
      if (side === 'before') await render(options, css);
      else { await replaceCss(css); await neutral(); }
      const geometry = await page.locator(tabSelector).boundingBox();
      const tabsPath = `${side}-${name}-tabs.png`;
      const tabsPng = await page.screenshot({ ...(primary || supplement ? { path: resolve(output, tabsPath) } : {}), clip: clipFor(geometry), animations: 'disabled' });
      if (primary || supplement) screenshots[`${side}Tabs`] = tabsPath;
      const cardPath = `${side}-${name}-card.png`;
      const cardPng = await page.locator('.quota-card').screenshot({ ...(saveCard || supplement && side === 'after' ? { path: resolve(output, cardPath) } : {}), animations: 'disabled' });
      if (saveCard || supplement && side === 'after') screenshots[`${side}Card`] = cardPath;
      const periodsPng = options.mode === 'models' ? await page.locator('.token-period-switch').screenshot({ animations: 'disabled' }) : null;
      const data = await inspect(options, side === 'after');
      sides[side] = { data, card: decodePng(cardPng), tabs: decodePng(tabsPng), periods: periodsPng && decodePng(periodsPng) };
    }
    const { before, after } = sides;
    const errors = [...before.data.errors.map(error => `before: ${error}`), ...after.data.errors.map(error => `after: ${error}`)];
    const geometryEqual = JSON.stringify(before.data.geometry) === JSON.stringify(after.data.geometry);
    const stableGeometryEqual = ['card', 'tokenUsage', 'title', 'content', 'list'].every(key =>
      JSON.stringify(before.data.geometry[key]) === JSON.stringify(after.data.geometry[key]));
    if (!stableGeometryEqual) errors.push('Before/After card, title, content, or list geometry changed');
    if (options.skin !== 'mecha-light' && !geometryEqual) errors.push('unrelated skin geometry changed');
    const tabBefore = before.data.geometry.tabs, tabAfter = after.data.geometry.tabs;
    if (options.skin === 'mecha-light' && (tabAfter.width !== 258 || tabAfter.height !== 33
      || tabAfter.x !== tabBefore.x || tabAfter.height - tabBefore.height !== 5))
      errors.push('measured Tab proportion or bounded +5px height allocation changed');
    const labelsEqual = before.data.tabsStyle.every((tab, index) => ['label', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight']
      .every(key => tab[key] === after.data.tabsStyle[index]?.[key]));
    if (!labelsEqual) errors.push('mode label/font contract changed');
    const cardBox = before.data.geometry.card;
    // Only the union of the old/new Tab rectangles may change. Recovering the
    // surrounding 5px must not move the title or consume any data/list space.
    const excluded = clipFor({ x: tabBefore.x - cardBox.x, y: Math.min(tabBefore.y, tabAfter.y) - cardBox.y,
      width: tabBefore.width, height: Math.max(tabBefore.y + tabBefore.height, tabAfter.y + tabAfter.height) - Math.min(tabBefore.y, tabAfter.y) });
    const unchangedPixels = comparePixels(before.card, after.card, options.skin === 'mecha-light' ? excluded : null);
    if (!unchangedPixels.equal) errors.push(options.skin === 'mecha-light' ? 'pixels outside mode-tab rectangle changed' : 'unrelated skin RGBA pixels changed');
    const periodsEqual = !before.periods || (comparePixels(before.periods, after.periods).equal
      && JSON.stringify(before.data.periodStyles) === JSON.stringify(after.data.periodStyles));
    if (!periodsEqual) errors.push('five period buttons changed in computed styles or RGBA pixels');
    report.comparisons.push({ name, options, screenshots, geometryEqual, stableGeometryEqual, allowedPixelRegion: excluded, labelsEqual, unchangedPixels, periodsEqual,
      modeTabsPixels: comparePixels(before.tabs, after.tabs), geometry: { before: before.data.geometry, after: after.data.geometry },
      accent: after.data.accent, rawAccent: after.data.rawAccent, tabsStyle: { before: before.data.tabsStyle, after: after.data.tabsStyle },
      internalScroll: after.data.scroll, cardRgbaSha256: { before: before.card.rgbaSha256, after: after.card.rgbaSha256 }, errors: [...new Set(errors)] });
  };

  // First group exactly matches the approved reference's blue/Quota-week state.
  const base = { skin: 'mecha-light', language: 'zh-CN', theme: 'light', shortWindow: true, opacityPercent: 100 };
  const coreOrder = ['turns', 'overview', 'models'];
  for (const state of states) for (const mode of coreOrder) for (const language of ['zh-CN', 'en'])
    for (const shortWindow of [true, false]) for (const opacityPercent of [100, 60]) {
      await capturePair({ ...base, ...state, mode, language, shortWindow, opacityPercent });
    }
  for (const state of states) for (const mode of coreOrder)
    await capturePair({ ...base, ...state, mode, language: 'en', theme: 'dark', shortWindow: false, opacityPercent: 60 });

  // Mecha CSS cannot affect any of the three established skins: exact full-card
  // RGBA comparisons cover each mode, language, height, opacity and OS theme.
  for (const skin of ['default', 'blur', 'computer']) for (const mode of modes)
    for (const supplement of [{ language: 'zh-CN', theme: 'light', shortWindow: true, opacityPercent: 100 },
      { language: 'en', theme: 'dark', shortWindow: false, opacityPercent: 60 }])
      await capturePair({ ...base, ...states[0], ...supplement, skin, mode });

  for (const state of states) for (const language of ['zh-CN', 'en']) for (const theme of ['light', 'dark']) for (const opacityPercent of [100, 60]) {
    const options = { ...base, ...state, language, theme, opacityPercent, mode: 'overview', shortWindow: opacityPercent === 100 };
    const name = caseName(options), errors = [], pointer = [], keyboard = [];
    await render(options, afterCss);
    const tabs = page.locator(`${tabSelector} > button`);
    // Positive control proves the counter is attached to the real onDrag path.
    await page.locator('.eyebrow').click();
    const positiveControl = await page.evaluate(() => window.__mechaFixtureDragCount);
    if (positiveControl !== 1) errors.push('drag counter positive control failed');
    await page.evaluate(() => { window.__mechaFixtureDragCount = 0; });
    const selectedIndex = async () => page.evaluate(tabSelector => [...document.querySelectorAll(`${tabSelector} > button`)]
      .flatMap((tab, index) => tab.getAttribute('aria-pressed') === 'true' ? [index] : []), tabSelector);
    for (let index = 0; index < 3; index++) {
      for (const location of ['label', 'top-left-cut', 'top-right-cut', 'bottom-left-cut', 'bottom-right-cut']) {
        await tabs.nth((index + 1) % 3).click();
        const bounds = await tabs.nth(index).boundingBox();
        const point = { name: location,
          x: bounds.x + (location === 'label' ? bounds.width / 2 : location.includes('left') ? 1 : bounds.width - 1),
          y: bounds.y + (location === 'label' ? bounds.height / 2 : location.includes('top') ? 1 : bounds.height - 1) };
        const hit = await page.evaluate(({ tabSelector, index, point }) => {
          const tab = document.querySelectorAll(`${tabSelector} > button`)[index];
          const target = document.elementFromPoint(point.x, point.y);
          return target === tab || tab.contains(target);
        }, { tabSelector, index, point });
        await page.mouse.click(point.x, point.y);
        const selected = await selectedIndex();
        if (!hit || selected.length !== 1 || selected[0] !== index) errors.push(`${modes[index]} ${point.name}: hit/selection failed`);
        pointer.push({ mode: modes[index], point: point.name, hit, selected });
      }
    }
    // Each tab is reached with Tab from the preceding focusable element. Enter
    // and Space both activate every position from a different selected mode.
    for (let index = 0; index < 3; index++) for (const key of ['Enter', 'Space']) {
      await tabs.nth((index + 1) % 3).click();
      await neutral();
      const tabsBox = await page.locator(tabSelector).boundingBox();
      const beforeFocus = decodePng(await page.screenshot({ clip: clipFor(tabsBox, 4), animations: 'disabled' }));
      await tabs.nth(index).focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(tabSelector => {
        const element = document.activeElement, tabs = [...document.querySelectorAll(`${tabSelector} > button`)];
        const style = getComputedStyle(element), r = element.getBoundingClientRect();
        const reach = Math.max(0, parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth));
        const expanded = { x: r.left - reach, y: r.top - reach, right: r.right + reach, bottom: r.bottom + reach };
        const clipping = [];
        for (let node = element; node; node = node.parentElement) {
          const s = getComputedStyle(node), n = node.getBoundingClientRect();
          if (s.clipPath !== 'none' || s.clip !== 'auto') clipping.push(`${node.tagName}: clip`);
          if (node !== element && ['hidden', 'clip', 'scroll', 'auto'].includes(s.overflowX)
            && (expanded.x < n.left || expanded.right > n.right)) clipping.push(`${node.tagName}: overflow-x`);
          if (node !== element && ['hidden', 'clip', 'scroll', 'auto'].includes(s.overflowY)
            && (expanded.y < n.top || expanded.bottom > n.bottom)) clipping.push(`${node.tagName}: overflow-y`);
        }
        return { focusedIndex: tabs.indexOf(element), focusVisible: element.matches(':focus-visible'),
          outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), outlineOffset: style.outlineOffset,
          outlineColor: style.outlineColor, accentColor: getComputedStyle(document.querySelector('.primary-metric')).color,
          clipPath: style.clipPath, clipping };
      }, tabSelector);
      const saveFocus = state.state === 'blue' && language === 'zh-CN' && theme === 'light'
        && opacityPercent === 100 && index === 1 && key === 'Enter';
      const focusedPath = saveFocus ? `focus-${name}-${modes[index]}-${key.toLowerCase()}-tabs.png` : null;
      const focused = decodePng(await page.screenshot({ ...(saveFocus ? { path: resolve(output, focusedPath) } : {}), clip: clipFor(tabsBox, 4), animations: 'disabled' }));
      const visibleChange = comparePixels(beforeFocus, focused);
      if (focus.focusedIndex !== index || !focus.focusVisible) errors.push(`${modes[index]} ${key}: Tab focus failed`);
      if (focus.outlineStyle === 'none' || focus.outlineWidth < 1 || focus.outlineColor !== focus.accentColor || visibleChange.equal)
        errors.push(`${modes[index]} ${key}: focus is invisible or does not reuse accent`);
      if (focus.clipping.length) errors.push(`${modes[index]} ${key}: focus may be clipped (${focus.clipping.join(', ')})`);
      await page.keyboard.press(key);
      const selected = await selectedIndex();
      if (selected.length !== 1 || selected[0] !== index) errors.push(`${modes[index]} ${key}: keyboard activation failed`);
      keyboard.push({ mode: modes[index], key, ...focus, visibleChange, selected, screenshot: focusedPath });
    }
    const dragCount = await page.evaluate(() => window.__mechaFixtureDragCount);
    if (dragCount !== 0) errors.push(`mode interaction triggered drag ${dragCount} times`);
    report.interactions.push({ name, options, positiveControl, dragCount, pointer, keyboard, errors: [...new Set(errors)] });
  }
} catch (error) {
  report.runtimeErrors.push(error.stack || String(error));
} finally {
  await browser?.close();
  await server.close();
  const failed = [...report.comparisons, ...report.interactions].filter(result => result.errors.length);
  report.summary = { comparisons: report.comparisons.length, interactions: report.interactions.length,
    mechaComparisons: report.comparisons.filter(result => result.options.skin === 'mecha-light').length,
    failed: failed.length, runtimeErrors: report.runtimeErrors.length,
    humanVisualAcceptance: 'Pending', nativeAcceptance: 'Pending' };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report.summary, examples: failed.slice(0, 8).map(({ name, errors }) => ({ name, errors })),
    runtimeErrors: report.runtimeErrors, output }, null, 2));
  if (failed.length || report.runtimeErrors.length) process.exitCode = 1;
}
