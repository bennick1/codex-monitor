// Real App composition with synthetic IPC only; no native or human acceptance claim.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = 'outputs/v1.3.0-validation/opacity';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 314, height: 514 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const callbacks = new Map();
    const listeners = new Map();
    let next = 0;
    const now = Date.now();
    const reset = new Date(now + 86400000).toISOString();
    window.__opacityQA = {
      commands: [],
      preferences: { locked: false, alwaysOnTop: true, stayExpanded: false, pinnedProvider: null,
        autoRotateSeconds: 12, language: 'en', appearance: 'light', selectedSkin: 'default', opacityPercent: 100 },
      snapshot: { provider: 'codex', displayName: 'CODEX', plan: 'SYNTHETIC',
        shortWindow: { remainingPercent: 74, resetsAt: reset, windowSeconds: 18000 },
        weeklyWindow: { remainingPercent: 42, resetsAt: reset, windowSeconds: 604800 },
        resetCredits: 1, resetCreditExpiresAt: [reset], updatedAt: new Date(now).toISOString(), status: 'ok', message: null },
      tokens: null,
      emit(event, payload) {
        for (const [id, entry] of listeners) if (entry.event === event) callbacks.get(entry.handler)?.({ event, id, payload });
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event, id) => listeners.delete(id) };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(callback) { const id = ++next; callbacks.set(id, callback); return id; },
      async invoke(command, args = {}) {
        const qa = window.__opacityQA;
        qa.commands.push(command);
        if (command === 'plugin:event|listen') { const id = ++next; listeners.set(id, args); return id; }
        if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
        if (command === 'get_preferences') return qa.preferences;
        if (command === 'set_preferences') { qa.preferences = args.preferences; qa.emit('preferences-changed', qa.preferences); return; }
        if (command === 'get_snapshots' || command === 'refresh_snapshots') return [qa.snapshot];
        if (command === 'get_token_statistics') return qa.tokens;
        if (command === 'refresh_token_statistics') return { accepted: true };
        if (command === 'plugin:window|current_monitor') return null;
        if (command === 'plugin:window|outer_position') return { x: 0, y: 0 };
        if (['sync_widget_appearance', 'expand_widget', 'collapse_widget', 'begin_widget_drag', 'finish_widget_drag', 'plugin:window|start_dragging'].includes(command)) return;
        throw new Error(`Unexpected synthetic IPC: ${command}`);
      },
    };
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator('.widget-visual-root .quota-orb').waitFor();
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  await page.evaluate(async () => {
    const { tokenSnapshot } = await import('/src/test/tokenFixtures.ts');
    const qa = window.__opacityQA;
    qa.tokens = tokenSnapshot({ queryAtUtc: new Date().toISOString(), turnStatistics: {
      weeklyResetAt: qa.snapshot.weeklyWindow.resetsAt,
      turns: Array.from({ length: 20 }, (_, i) => ({ model: 'synthetic-model-with-long-label', effort: 'xhigh',
        fastMode: [true, false, null][i % 3], tokens: `${10000 + i}`, isPartial: false,
        completedAt: new Date(Date.now() - (i + 1) * 60000).toISOString(), weeklyRemaining: 70 - i, quotaObservedAt: null })),
    } });
    qa.emit('refresh-requested');
  });
  for (const variant of [
    { language: 'en', theme: 'light', percent: 74, statuses: ['ok', 'unavailable', 'stale', 'signed_out'] },
    { language: 'zh-CN', theme: 'dark', percent: 34, statuses: ['ok'] },
    { language: 'zh-CN', theme: 'light', percent: 6, statuses: ['ok'] },
    { language: 'en', theme: 'dark', percent: 74, statuses: ['stale'], expired: true },
  ]) for (const skin of ['default', 'blur', 'computer', 'mecha-light']) {
    for (const mode of ['orb', 'full', 'compact']) {
      for (const status of variant.statuses) {
        // Reset cached quota so an unavailable fixture cannot silently become stale.
        await page.evaluate(async () => {
          const qa = window.__opacityQA;
          qa.snapshot = { ...qa.snapshot, status: 'signed_out', shortWindow: null, weeklyWindow: null };
          qa.emit('refresh-requested');
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        await page.evaluate(({ skin, mode, status, variant }) => {
          const qa = window.__opacityQA;
          qa.preferences = { ...qa.preferences, selectedSkin: skin, language: variant.language, appearance: variant.theme, stayExpanded: mode !== 'orb', opacityPercent: 100 };
          qa.snapshot = { ...qa.snapshot, status, shortWindow: mode === 'compact' ? null : {
            remainingPercent: variant.percent, resetsAt: new Date(Date.now() + 86400000).toISOString(), windowSeconds: 18000 },
            weeklyWindow: { remainingPercent: variant.percent, resetsAt: new Date(Date.now() + 86400000).toISOString(), windowSeconds: 604800 },
            updatedAt: new Date(Date.now() - (variant.expired ? 31 * 60000 : 0)).toISOString(),
            message: status === 'ok' ? null : 'Synthetic quota status.' };
          qa.emit('preferences-changed', qa.preferences);
          qa.emit('refresh-requested');
        }, { skin, mode, status, variant });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        if (mode === 'orb') {
          if (await page.locator('.quota-card').count()) await page.locator('.card-header').hover();
          await page.mouse.move(313, 513);
          await page.locator('.quota-orb').waitFor();
          await page.locator('.quota-orb--idle').waitFor();
        } else {
          await page.locator('.quota-card').waitFor();
          if (status === 'ok') {
            await page.locator('.token-heading .token-switch button').nth(2).click();
            await page.locator('.token-turn-fast').first().waitFor();
          }
        }
        await page.locator(`.widget-visual-root > .quota-card--${status}`).waitFor();
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        let baseline;
        let baselineGeometry;
        let baselineChildOpacity;
        for (const opacity of [100, 80, 60]) {
          await page.evaluate(value => {
            const qa = window.__opacityQA;
            qa.preferences = { ...qa.preferences, opacityPercent: value };
            qa.emit('preferences-changed', qa.preferences);
          }, opacity);
          await page.waitForFunction(value => Number(getComputedStyle(document.querySelector('.widget-visual-root')).opacity) === value / 100, opacity);
          const details = await page.evaluate(() => {
            const root = document.querySelector('.widget-visual-root');
            const card = root.firstElementChild;
            const box = card.getBoundingClientRect();
            const firstProgressCell = card.querySelector('.computer-progress i');
            const cellBox = firstProgressCell?.getBoundingClientRect();
            return { geometry: [box.x, box.y, box.width, box.height], opacity: Number(getComputedStyle(root).opacity),
              firstProgressCell: firstProgressCell ? { geometry: [cellBox.x, cellBox.y, cellBox.width, cellBox.height],
                background: getComputedStyle(firstProgressCell).backgroundColor, borderRadius: getComputedStyle(firstProgressCell).borderRadius } : null,
              rootDisplay: getComputedStyle(root).display,
              stateClasses: card.className, childOpacity: Number(getComputedStyle(card).opacity), hit: getComputedStyle(card).pointerEvents,
              rootCount: document.querySelectorAll('.widget-visual-root').length,
              outerOverflow: document.documentElement.scrollWidth > innerWidth,
              sampledInside: root.contains(document.querySelector('.primary-metric, .orb-metric, .error-state, .orb-unavailable')) };
          });
          assert.equal(details.rootCount, 1);
          assert.equal(details.rootDisplay, 'block');
          assert.equal(await page.locator('#root > main').count(), 1);
          assert(details.stateClasses.includes(`--theme-${variant.theme}`));
          if (skin !== 'default') assert(details.stateClasses.includes(`--skin-${skin}`), `expected ${skin} skin`);
          else assert(!details.stateClasses.includes('--skin-'), 'expected the default skin');
          if (opacity === 100) baselineChildOpacity = details.childOpacity;
          else assert.equal(details.childOpacity, baselineChildOpacity);
          assert.equal(details.hit, 'auto');
          assert.equal(details.outerOverflow, false);
          assert.equal(details.sampledInside, true);
          if (opacity === 100) baselineGeometry = details.geometry;
          else assert.deepEqual(details.geometry, baselineGeometry);
          const screenshot = await page.screenshot({ omitBackground: true });
          let alphaCheck = null;
          let baselineCheck = null;
          if (opacity === 100) {
            baseline = screenshot.toString('base64');
            // Disable the opacity feature on the unchanged original host/main
            // DOM. There is no wrapper to unbox and no reparenting or repaint
            // caused by introducing/removing a formatting context.
            await page.locator('#root').evaluate(el => { el.style.removeProperty('opacity'); el.classList.remove('widget-visual-root'); });
            const unboxed = await page.screenshot({ omitBackground: true });
            await page.locator('#root').evaluate(el => { el.style.opacity = '1'; el.classList.add('widget-visual-root'); });
            baselineCheck = await page.evaluate(async ({ original, current }) => {
              const decode = async data => {
                const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
                const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
                const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
                return context.getImageData(0, 0, img.width, img.height).data;
              };
              const a = await decode(original), b = await decode(current);
              let maxChannelDelta = 0, differingChannels = 0;
              const samples = [];
              for (let i = 0; i < a.length; i++) {
                const delta = Math.abs(a[i] - b[i]);
                maxChannelDelta = Math.max(maxChannelDelta, delta);
                if (delta) {
                  differingChannels++;
                  const pixelStart = i - i % 4;
                  const x = (pixelStart / 4) % innerWidth, y = Math.floor(pixelStart / 4 / innerWidth);
                  if (samples.length < 12) samples.push({ x, y, channel: i % 4,
                    before: [...a.slice(pixelStart, pixelStart + 4)], after: [...b.slice(pixelStart, pixelStart + 4)],
                    element: document.elementFromPoint(x, y)?.className });
                }
              }
              return { maxChannelDelta, differingChannels, samples };
            }, { original: baseline, current: unboxed.toString('base64') });
            if (baselineCheck.maxChannelDelta > 0) {
              await writeFile(`${output}/baseline-difference-before.png`, screenshot);
              await writeFile(`${output}/baseline-difference-after.png`, unboxed);
              await writeFile(`${output}/baseline-difference-restored.png`, await page.screenshot({ omitBackground: true }));
              await page.locator('.widget-visual-root').evaluate(el => el.style.removeProperty('opacity'));
              await writeFile(`${output}/baseline-difference-no-explicit-opacity.png`, await page.screenshot({ omitBackground: true }));
              await page.locator('.widget-visual-root').evaluate(el => { el.style.opacity = '1'; });
              await writeFile(`${output}/baseline-failure.json`, JSON.stringify({ skin, mode, status, variant, ...details, baselineCheck }, null, 2));
            }
            assert.equal(baselineCheck.maxChannelDelta, 0, `${skin}/${mode}/${status}: 100% opacity changed original host/main pixels`);
          }
          else alphaCheck = await page.evaluate(async ({ original, current, opacity }) => {
            const decode = async base64 => {
              const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode();
              const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
              const context = canvas.getContext('2d'); context.drawImage(img, 0, 0); return context.getImageData(0, 0, img.width, img.height).data;
            };
            const a = await decode(original), b = await decode(current);
            let opaque = 0, mismatch = 0, colorMismatch = 0, maxAlphaDelta = 0, maxPremultipliedDelta = 0;
            const samples = [];
            for (let i = 3; i < a.length; i += 4) if (a[i] > 20 || b[i] > 20) {
              opaque++;
              const alphaDelta = Math.abs(b[i] - a[i] * opacity / 100);
              maxAlphaDelta = Math.max(maxAlphaDelta, alphaDelta);
              if (alphaDelta > 3) mismatch++;
              for (let channel = 1; channel <= 3; channel++) {
                const expected = a[i - channel] * a[i] / 255 * opacity / 100;
                const actual = b[i - channel] * b[i] / 255;
                const delta = Math.abs(actual - expected);
                maxPremultipliedDelta = Math.max(maxPremultipliedDelta, delta);
                if (delta > 4) {
                  colorMismatch++;
                  if (samples.length < 12) samples.push({ x: ((i - 3) / 4) % innerWidth,
                    y: Math.floor(((i - 3) / 4) / innerWidth), channel: 3 - channel,
                    before: [...a.slice(i - 3, i + 1)], after: [...b.slice(i - 3, i + 1)], delta });
                }
              }
            }
            return { opaque, mismatch, colorMismatch, maxAlphaDelta, maxPremultipliedDelta, samples };
          }, { original: baseline, current: screenshot.toString('base64'), opacity });
          if (alphaCheck) {
            const label = `${skin}/${mode}/${status}/${variant.language}/${variant.theme}/${variant.percent}/${opacity}`;
            if (alphaCheck.mismatch || alphaCheck.colorMismatch) {
              await writeFile(`${output}/scaling-difference-before.png`, Buffer.from(baseline, 'base64'));
              await writeFile(`${output}/scaling-difference-after.png`, screenshot);
              await writeFile(`${output}/scaling-failure.json`, JSON.stringify({ label, ...details, alphaCheck }, null, 2));
            }
            assert(alphaCheck.opaque > 500, label);
            assert.equal(alphaCheck.mismatch, 0, `${label}: alpha mismatch`);
            assert.equal(alphaCheck.colorMismatch, 0, `${label}: premultiplied RGB mismatch`);
          }
          if (status === 'ok' && opacity !== 80) await writeFile(`${output}/${skin}-${mode}-${variant.language}-${variant.theme}-${variant.percent}-${opacity}.png`, screenshot);
          results.push({ skin, mode, status, variant, opacity, ...details, alphaCheck, baselineCheck });
        }
      }
    }
  }
  // Pointer expansion/collapse and Token click isolation at the lowest opacity.
  await page.evaluate(() => {
    const qa = window.__opacityQA;
    qa.snapshot.status = 'ok';
    qa.preferences = { ...qa.preferences, stayExpanded: false, opacityPercent: 60 };
    qa.emit('preferences-changed', qa.preferences); qa.emit('refresh-requested');
  });
  await page.mouse.move(313, 513);
  await page.locator('.card-header').hover();
  await page.mouse.move(313, 513);
  await page.locator('.quota-orb').waitFor();
  await page.locator('.quota-orb').hover();
  await page.locator('.quota-card').waitFor();
  await page.locator('.token-heading .token-switch button').nth(2).click();
  await page.locator('.token-turn-fast').first().waitFor();
  const interaction = await page.evaluate(() => {
    const qa = window.__opacityQA;
    const list = document.querySelector('.token-turn-list'); list.scrollTop = 80;
    return { dragBefore: qa.commands.filter(c => c === 'begin_widget_drag').length,
      scrollTop: list.scrollTop, opacity: getComputedStyle(document.querySelector('.widget-visual-root')).opacity };
  });
  assert.equal(interaction.dragBefore, 0); assert(interaction.scrollTop > 0); assert.equal(interaction.opacity, '0.6');
  await page.locator('.token-heading .token-switch button').nth(2).focus();
  const focused = await page.locator('.token-heading .token-switch button').nth(2).elementHandle();
  const beforeReset = await page.locator('.quota-card').boundingBox();
  for (const value of [100, 60, 100]) {
    await page.evaluate(value => {
      const qa = window.__opacityQA; qa.preferences = { ...qa.preferences, opacityPercent: value };
      qa.emit('preferences-changed', qa.preferences);
    }, value);
    await page.waitForFunction(value => Number(getComputedStyle(document.querySelector('.widget-visual-root')).opacity) === value / 100, value);
    assert.deepEqual(await page.locator('.quota-card').boundingBox(), beforeReset);
    assert.equal(await focused.evaluate(el => document.activeElement === el), true);
    assert.equal(await page.locator('.token-turn-list').evaluate(el => el.scrollTop), interaction.scrollTop);
  }
  await page.locator('.card-header .eyebrow').click();
  await page.waitForFunction(() => window.__opacityQA.commands.includes('begin_widget_drag'));
  assert.deepEqual(pageErrors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ cases: results.length, results, interaction, pageErrors }, null, 2));
  console.log(JSON.stringify({ cases: results.length, premultipliedRgbaScaling: 'passed', hostAt100: 'pixel-identical to original host/main composition', geometry: 'passed', syntheticInteractions: 'passed', pageErrors }));
} finally { await browser?.close(); await server.close(); }
