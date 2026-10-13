// Production QuotaCard/TokenUsage, synthetic data. Browser evidence only.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createExactServer } from './preview-mecha-tabs-exact.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const phase = process.argv[2];
assert.ok(phase && /^[a-z0-9-]+$/.test(phase), 'Pass a new evidence phase');
const output = resolve('docs/design/v1.3.0/mecha-light/tabs-reference-exact', phase);
await mkdir(output);
const manifest = JSON.parse(await readFile('assets/mecha-light/tabs-reference-exact/label-patches.json', 'utf8'));
const names = ['总览', '按模型', '额度周'], english = ['Overview', 'By model', 'Quota week'];
const modes = ['overview', 'models', 'turns'];
const group = '.token-heading > .token-switch';
const base = { view: 'card', tokenStatus: 'ready', quotaStatus: 'ok', stale: false,
  skin: 'mecha-light', theme: 'light', language: 'zh-CN', mode: 'turns', percent: 70,
  shortWindow: true, opacityPercent: 100 };
const report = { task: 'CM-130-TABS-TEXT-LAYER-FINAL-20261002',
  evidence: 'Synthetic Chromium, real production components. No native, assistive-technology or human sign-off.',
  checks: [], errors: [], expectedDiagnostics: [], browser: null };
const server = await createExactServer();
let browser;
const check = async (name, fn) => {
  if (process.env.MECHA_LABEL_TEST_FILTER && !name.includes(process.env.MECHA_LABEL_TEST_FILTER)) return;
  try { report.checks.push({ name, passed: true, result: await fn() }); }
  catch (error) { report.checks.push({ name, passed: false, error: error.stack }); }
};
async function newPage(dpr = 1) {
  const page = await browser.newPage({ viewport: { width: 314, height: 514 }, deviceScaleFactor: dpr, reducedMotion: 'reduce' });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'warning' && m.text().includes('[MechaTabLabel]')) report.expectedDiagnostics.push(m.text()); });
  await page.addInitScript(() => {
    const NativeDate = Date, time = Date.parse('2026-09-30T12:00:00Z');
    window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } };
  });
  await page.goto(`${server.resolvedUrls.local[0]}src/test/tokenLayout.html?language=en`, { waitUntil: 'networkidle' });
  return page;
}
async function render(page, options, settle = true) {
  await page.evaluate(o => window.__renderTokenFixture(o), { ...base, ...options });
  if (settle) await page.waitForFunction(() => [...document.querySelectorAll('.token-tab-label')].every(n => n.dataset.labelStatus !== 'loading'));
  await page.mouse.move(0, 0);
  await page.evaluate(async () => { document.activeElement?.blur(); await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
}
async function inspect(page) {
  return page.evaluate(selector => {
    const rect = n => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    return [...document.querySelector(selector).children].map(b => {
      const label = b.querySelector('.token-tab-label'), image = b.querySelector('img'), s = getComputedStyle(label);
      let opacity = 1, opacityLayers = 0;
      for (let n = image || label; n; n = n.parentElement) { const o = Number(getComputedStyle(n).opacity); opacity *= o; if (o !== 1) opacityLayers++; }
      return { name: b.textContent, pressed: b.getAttribute('aria-pressed'), box: rect(b), label: rect(label),
        status: label.dataset.labelStatus, textClip: s.clipPath, textDisplay: s.display, textVisibility: s.visibility,
        opacity, opacityLayers, image: image ? { id: image.dataset.patchId, display: getComputedStyle(image).display,
          box: rect(image), pointerEvents: getComputedStyle(image).pointerEvents, draggable: image.draggable,
          width: image.naturalWidth, height: image.naturalHeight, ready: image.dataset.ready } : null };
    });
  }, group);
}
async function capture(page, name) {
  const box = await page.locator(group).boundingBox();
  await page.screenshot({ path: resolve(output, `${name}.png`), clip: { x: box.x, y: box.y - 2, width: 258, height: 36 }, animations: 'disabled' });
}
function assertRealText(info, expectedNames = names) {
  assert.deepEqual(info.map(b => b.name), expectedNames);
  for (const b of info) {
    assert.ok(b.label.width > 1 && b.label.height > 1);
    assert.equal(b.textClip, 'none'); assert.notEqual(b.textDisplay, 'none'); assert.equal(b.textVisibility, 'visible');
    assert.ok(!b.image || b.image.display === 'none');
  }
}
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ['--disable-gpu', '--force-color-profile=srgb'] });
  report.browser = browser.version();
  for (const dpr of [1, 2]) {
    const page = await newPage(dpr), cdp = await page.context().newCDPSession(page);
    for (const [color, percent] of [['blue', 70], ['amber', 34], ['red', 6]]) for (const mode of modes) {
      await check(`${color}-${mode}-dpr${dpr}`, async () => {
        await render(page, { percent, mode });
        const info = await inspect(page);
        assert.deepEqual(info.map(b => b.name), names);
        const ax = (await cdp.send('Accessibility.getFullAXTree')).nodes.filter(n => !n.ignored && n.role?.value === 'button');
        for (const [i, b] of info.entries()) {
          assert.equal(b.pressed, String(modes[i] === mode)); assert.equal(b.status, 'ready');
          assert.equal(ax.filter(n => n.name?.value === names[i]).length, 1, 'Exactly one accessible button name');
          assert.equal(b.image.display, 'block'); assert.equal(b.image.pointerEvents, 'none'); assert.equal(b.image.draggable, false);
          const patch = manifest.entries.find(p => p.id === b.image.id);
          assert.equal(patch.labelKey, modes[i]); assert.equal(patch.color, color);
          assert.equal(patch.renderState, mode === modes[i] ? 'active' : 'idle');
          assert.deepEqual([b.image.width, b.image.height], patch.size);
          assert.equal(b.box.height, 33); assert.equal(b.opacity, 1); assert.equal(b.opacityLayers, 0);
        }
        assert.equal(await page.locator(['.token-grid', '.token-model-view', '.token-turn-view'][modes.indexOf(mode)]).count(), 1);
        await capture(page, `${color}-${mode}-dpr${dpr}`);
        return { directReference: mode === 'turns' && dpr === 1, dpr, info,
          accessibilityNames: ax.filter(n => names.includes(n.name?.value)).map(n => n.name.value) };
      });
    }
    await page.close();
  }
  const page = await newPage();
  for (const [color, percent] of [['blue', 70], ['amber', 34], ['red', 6]]) await check(`${color}-opacity60-once`, async () => {
    await render(page, { percent, opacityPercent: 60 }); const info = await inspect(page);
    for (const b of info) { assert.equal(b.opacity, .6); assert.equal(b.opacityLayers, 1); assert.equal(b.status, 'ready'); }
    await capture(page, `${color}-opacity60`); return info;
  });
  await check('forced-colors-real-text', async () => {
    await page.emulateMedia({ forcedColors: 'active' }); await render(page, {});
    const info = await inspect(page); assertRealText(info); await capture(page, 'forced-colors');
    await page.emulateMedia({ forcedColors: 'none' }); return info;
  });
  await check('unknown-panel-real-text', async () => {
    await render(page, { quotaStatus: 'stale' }); const info = await inspect(page); assertRealText(info); return info;
  });
  await page.close();
  for (const [color, percent] of [['blue', 70], ['amber', 34], ['red', 6]]) for (const language of ['zh-CN', 'en'])
    await check(`hover-focus-${color}-${language}`, async () => {
      const p = await newPage(), states = [];
      for (const [i, mode] of modes.entries()) {
        await render(p, { percent, language, mode }); const before = await inspect(p);
        for (const index of [i, (i+1)%3]) {
          await p.locator(`${group} > button`).nth(index).hover();
          assert.deepEqual(await inspect(p), before, 'Hover changes label mapping, layout or readiness');
        }
        const button = p.locator(`${group} > button`).nth(i);
        await button.focus(); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
        const focus = await button.evaluate(b => ({ visible: b.matches(':focus-visible'),
          active: document.activeElement === b, outline: getComputedStyle(b).outline,
          clip: getComputedStyle(b).clipPath }));
        assert.ok(focus.active && focus.visible && focus.outline.includes('2px')); assert.equal(focus.clip, 'none');
        assert.deepEqual(await inspect(p), before, 'Focus changes label identity or layout');
        await capture(p, `focus-${color}-${language}-${mode}`); states.push({ mode, focus, labels: before });
      }
      await p.close(); return states;
    });
  for (const failure of ['missing-label', 'corrupt-label', 'missing-panel']) await check(failure, async () => {
    const p = await newPage();
    await p.route('**/*', route => {
      const q = route.request(), url = new URL(q.url());
      const label = url.pathname.includes('-label-'), panel = /\/(blue|amber|red)-(first|middle|last)-(active|idle)\.png$/.test(url.pathname);
      if (q.resourceType() === 'image' && (failure === 'missing-panel' ? panel : label))
        return failure === 'corrupt-label' ? route.fulfill({ status: 200, contentType: 'image/png', body: 'invalid synthetic PNG' }) : route.abort('failed');
      return route.continue();
    });
    await render(p, { percent: 6 }); const info = await inspect(p); assertRealText(info);
    assert.ok(info.every(b => b.status === 'error'));
    await capture(p, failure); await p.close(); return info;
  });
  for (const destination of ['language', 'skin', 'color', 'selection']) await check(`late-decode-${destination}`, async () => {
    const p = await newPage();
    await p.evaluate(() => {
      window.__heldDecodes = []; window.__holdDecode = true;
      const native = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        const result = native.call(this);
        return this.src.includes('tabs-reference-exact') && window.__holdDecode
          ? result.then(() => new Promise(resolve => window.__heldDecodes.push(resolve))) : result;
      };
    });
    await render(p, { preserveState: true }, false);
    await p.waitForFunction(() => window.__heldDecodes.length >= 6);
    const pending = await inspect(p); assertRealText(pending); assert.ok(pending.every(b => b.status === 'loading'));
    const options = destination === 'language' ? { language: 'en' } : destination === 'skin' ? { skin: 'default' }
      : destination === 'color' ? { percent: 34 } : { mode: 'models' };
    await p.evaluate(() => { window.__holdDecode = false; });
    await render(p, { preserveState: true, ...options }, false);
    await p.evaluate(() => { window.__heldDecodes.splice(0).forEach(resolve => resolve()); });
    await p.waitForFunction(() => [...document.querySelectorAll('.token-tab-label')].every(n => n.dataset.labelStatus !== 'loading'));
    const info = await inspect(p);
    if (destination === 'language' || destination === 'skin') assertRealText(info, destination === 'language' ? english : names);
    else {
      assert.ok(info.every(b => b.status === 'ready'));
      if (destination === 'color') assert.ok(info.every(b => b.image.id.includes(':amber-turns:')));
      if (destination === 'selection') assert.equal(info[1].pressed, 'true');
    }
    await capture(p, `late-decode-${destination}`); await p.close(); return { pending, after: info, preservesComponentState: true };
  });
} finally {
  await browser?.close(); await server.close();
  report.summary = { checks: report.checks.length, failed: report.checks.filter(c => !c.passed).length, runtimeErrors: report.errors.length };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary: report.summary, errors: report.errors, failures: report.checks.filter(c => !c.passed) }, null, 2));
  if (report.summary.failed || report.errors.length) process.exitCode = 1;
}
