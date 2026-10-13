// Production-component regression against the protected, uncommitted 33px baseline.
// This validates behavior/scope, never certifies reference restoration or native UI.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { posix, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { createExactServer } from './preview-mecha-tabs-exact.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = resolve(process.env.MECHA_REGRESSION_OUTPUT || 'docs/design/v1.3.0/mecha-light/tabs-reference-exact');
const baselinePath = process.env.MECHA_BASELINE_CSS || 'outputs/v1.3.0-tabs-reference-exact/before-mecha.css';
const baseline = await readFile(baselinePath, 'utf8');
const inlineCss = css => css.replace(/url\((['"]?)([^'"\)]+)\1\)/g, (all, quote, url) =>
  /^(?:[a-z]+:|\/|#)/i.test(url) ? all : `url("${posix.resolve('/src', url)}")`);
const sha = value => createHash('sha256').update(value).digest('hex');
const selector = '.token-heading > .token-switch';
const modes = ['overview', 'models', 'turns'];

function decode(png) {
  let w, h, channels; const chunks = [];
  assert.equal(png.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  for (let p = 8; p < png.length;) {
    const n = png.readUInt32BE(p), type = png.toString('ascii',p+4,p+8), data = png.subarray(p+8,p+8+n);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      assert.equal(data[8],8); assert.ok([2,6].includes(data[9])); assert.equal(data[12],0);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') chunks.push(data);
    p += n+12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = w*channels, rgba = Buffer.alloc(w*h*4);
  let prev = Buffer.alloc(stride);
  const paeth = (a,b,c) => { const p=a+b-c, x=Math.abs(p-a), y=Math.abs(p-b), z=Math.abs(p-c); return x<=y && x<=z ? a : y<=z ? b : c; };
  for (let y=0;y<h;y++) {
    const filter=raw[y*(stride+1)], row=Buffer.alloc(stride); assert.ok(filter<=4);
    for(let x=0;x<stride;x++) {
      const a=x>=channels?row[x-channels]:0,b=prev[x],c=x>=channels?prev[x-channels]:0;
      row[x]=(raw[y*(stride+1)+x+1]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;
    }
    for(let x=0;x<w;x++) for(let c=0;c<4;c++) rgba[(y*w+x)*4+c]=c===3 && channels===3?255:row[x*channels+c];
    prev=row;
  }
  return { w,h,rgba };
}
function compare(a,b,excluded) {
  assert.equal(a.w,b.w); assert.equal(a.h,b.h); let pixels=0,different=0,max=0;
  for(let y=0;y<a.h;y++) for(let x=0;x<a.w;x++) {
    if(excluded && x>=excluded.x && x<excluded.x+excluded.width && y>=excluded.y && y<excluded.y+excluded.height) continue;
    pixels++; let changed=false;
    for(let c=0;c<4;c++) {const d=Math.abs(a.rgba[(y*a.w+x)*4+c]-b.rgba[(y*a.w+x)*4+c]);if(d) changed=true;max=Math.max(max,d);}
    if(changed) different++;
  }
  return {pixels,different,max};
}

const report = { evidence: 'Synthetic Chromium, production components/CSS. Human and native acceptance not performed.',
  baselineCssSha256: sha(baseline), comparisons: [], interactions: [], errors: [] };
await mkdir(output,{recursive:true});
const server=await createExactServer();let browser;
try {
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--force-color-profile=srgb'],executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  report.browser=browser.version();
  const page=await browser.newPage({viewport:{width:314,height:514},deviceScaleFactor:1,reducedMotion:'reduce'});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{const NativeDate=Date,t=Date.parse('2026-09-30T12:00:00Z');window.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:[t]));}static now(){return t;}};});
  await page.goto(`${server.resolvedUrls.local[0]}src/test/tokenLayout.html`,{waitUntil:'networkidle'});
  const currentCss=await page.locator('style[data-vite-dev-id$="/src/mecha.css"]').textContent();
  // Vite inlines @import. Keep the shared font face and all external paint
  // registered once; re-registering them on every tab switch invalidated the
  // unrelated 60%-opacity header raster during the earlier diagnostic run.
  const importEnd=currentCss.indexOf('@font-face');assert.ok(importEnd>0);
  const currentTabs=currentCss.slice(0,importEnd), common=currentCss.slice(importEnd);
  const oldStart=baseline.indexOf('/* Measured from expanded-three-states.png:');
  const oldEnd=baseline.indexOf('.quota-card.quota-card--skin-mecha-light .token-turn-row',oldStart);
  assert.ok(oldStart>0&&oldEnd>oldStart);
  const beforeTabs=inlineCss(baseline.slice(oldStart,oldEnd));
  const withoutComments=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\s+/g,'');
  const rawCurrent=await readFile('src/mecha.css','utf8');
  assert.equal(withoutComments(rawCurrent.replace('@import "./mecha-tabs-reference.css";','')),
    withoutComments(baseline.slice(0,oldStart)+baseline.slice(oldEnd)), 'CSS outside the authorized tabs changed');
  await page.evaluate(({common,currentTabs})=>{
    document.querySelector('style[data-vite-dev-id$="/src/mecha.css"]').textContent=common;
    const style=document.createElement('style');style.id='mecha-tabs-under-test';style.textContent=currentTabs;document.head.append(style);
  },{common,currentTabs});
  const useCurrent=async current=>page.evaluate(css=>{
    document.getElementById('mecha-tabs-under-test').textContent=css;
  },current?currentTabs:beforeTabs);
  const neutral=async()=>{await page.mouse.move(0,0);await page.evaluate(async()=>{document.activeElement?.blur();await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});};
  const inspect=async()=>page.evaluate(selector=>{
    const rect=n=>{if(!n)return null;const b=n.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
    const one=s=>rect(document.querySelector(s)),group=document.querySelector(selector),buttons=[...group.children];
    const period=document.querySelector('.token-period-switch');
    const allStyles=n=>Object.fromEntries([...getComputedStyle(n)].map(k=>[k,getComputedStyle(n).getPropertyValue(k)]));
    return {geometry:{card:one('.quota-card'),title:one('.token-heading h2'),tabs:rect(group),content:one('.token-grid,.token-model-view,.token-turn-view'),list:one('.token-turn-list,.token-model-list')},
      period:period?[period,...period.children].map(allStyles):null,
      buttons:buttons.map(b=>{const s=getComputedStyle(b),p=getComputedStyle(b,'::before'),r=document.createRange();r.selectNodeContents(b);let opacity=1;for(let n=b;n;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity);return {label:b.textContent,pressed:b.getAttribute('aria-pressed'),box:rect(b),text:rect(r),overflow:b.scrollWidth>b.clientWidth+1,clip:s.clipPath,opacity,decorationPointer:p.pointerEvents,background:p.backgroundImage};})};
  },selector);
  const cases=[];
  for(const [state,percent] of [['blue',70],['amber',34],['red',6]]) for(const mode of modes) for(const language of ['zh-CN','en']) for(const shortWindow of [true,false]) for(const opacityPercent of [100,60])
    cases.push({state,percent,mode,language,shortWindow,opacityPercent,skin:'mecha-light',theme:'light'});
  for(const skin of ['default','blur','computer']) for(const mode of modes) for(const language of ['zh-CN','en']) for(const theme of ['light','dark'])
    cases.push({state:skin,percent:70,mode,language,shortWindow:true,opacityPercent:100,skin,theme});
  for(const [state,percent] of [['blue',70],['amber',34],['red',6]]) for(const mode of modes)
    cases.push({state,percent,mode,language:'en',shortWindow:false,opacityPercent:60,skin:'mecha-light',theme:'dark'});
  for(const o of cases.filter(o=>!process.env.MECHA_CASE_FILTER||JSON.stringify(o).includes(process.env.MECHA_CASE_FILTER))) {
    await useCurrent(false);
    await page.setViewportSize({width:314,height:o.shortWindow?514:460});
    await page.evaluate(async o=>window.__renderTokenFixture({view:'card',tokenStatus:'ready',quotaStatus:'ok',stale:false,...o}),o);
    // Restore exactly the pre-task label markup for the Before capture; After
    // restores the same React span nodes before any interaction is exercised.
    await page.waitForFunction(() => [...document.querySelectorAll('.token-tab-label')].every(n => n.dataset.labelStatus !== 'loading'));
    await page.evaluate(selector=>{window.__labels=[...document.querySelectorAll(`${selector} > button`)].map(b=>{const nodes=[...b.childNodes];b.replaceChildren(document.createTextNode(b.textContent));return nodes;});},selector);
    await neutral(); const beforeInfo=await inspect(), beforePng=await page.locator('.quota-card').screenshot({animations:'disabled'}), before=decode(beforePng);
    const beforePeriods=o.mode==='models'?decode(await page.locator('.token-period-switch').screenshot({animations:'disabled'})):null;
    await page.evaluate(selector=>{[...document.querySelectorAll(`${selector} > button`)].forEach((b,i)=>b.replaceChildren(...window.__labels[i]));},selector);
    await useCurrent(true);await neutral();const afterInfo=await inspect(), afterPng=await page.locator('.quota-card').screenshot({animations:'disabled'}), after=decode(afterPng);
    const {card,tabs}=afterInfo.geometry;
    const allowed=o.skin==='mecha-light'?{x:tabs.x-card.x,y:tabs.y-card.y-2,width:258,height:36}:null;
    const outside=compare(before,after,allowed),errors=[];
    if(outside.different){
      errors.push('Pixels outside the fixed tab paint area changed');
      const n=[o.state,o.mode,o.language,o.shortWindow?'full':'compact',o.opacityPercent,o.theme].join('-');
      await writeFile(resolve(output,`scope-failure-${n}-before.png`),beforePng);
      await writeFile(resolve(output,`scope-failure-${n}-after.png`),afterPng);
    }
    for(const k of ['card','title','content','list'])if(JSON.stringify(beforeInfo.geometry[k])!==JSON.stringify(afterInfo.geometry[k]))errors.push(`${k} geometry changed`);
    if(o.skin==='mecha-light' && (tabs.width!==258||tabs.height!==33))errors.push('33px allocation changed');
    for(const [i,b]of afterInfo.buttons.entries()){
      if(b.pressed!==String(i===modes.indexOf(o.mode)))errors.push('aria-pressed mismatch');
      if(b.overflow||b.text.x<b.box.x||b.text.x+b.text.width>b.box.x+b.box.width)errors.push('Label overflow');
      if(Math.abs(b.opacity-o.opacityPercent/100)>.000001)errors.push('Opacity applied more than once');
      if(o.skin==='mecha-light'){
        if(b.clip!=='none'||b.decorationPointer!=='none')errors.push('Decoration clips or intercepts hit area');
        if(!b.background.includes(`${o.state}-${['first','middle','last'][i]}-${i===modes.indexOf(o.mode)?'active':'idle'}.png`))errors.push('Selected decoration does not follow real button state');
      }
    }
    let periods=null;
    if(beforePeriods){periods=compare(beforePeriods,decode(await page.locator('.token-period-switch').screenshot()));if(periods.different||JSON.stringify(beforeInfo.period)!==JSON.stringify(afterInfo.period))errors.push('Five period buttons changed');}
    const scroll=await page.evaluate(()=>{const l=document.querySelector('.token-turn-list,.token-model-list');if(!l)return null;l.scrollTop=40;return {scrollTop:l.scrollTop,scrollHeight:l.scrollHeight,clientHeight:l.clientHeight,outerScroll:document.querySelector('.quota-card').scrollTop};});
    if(o.mode!=='overview'&&(!scroll?.scrollTop||scroll.outerScroll))errors.push('Internal scrolling failed');
    report.comparisons.push({options:o,geometry:afterInfo.geometry,outside,periods,scroll,errors});
  }
  for(const [state,percent]of [['blue',70],['amber',34],['red',6]])for(const language of ['zh-CN','en']){
    await page.setViewportSize({width:314,height:514});await useCurrent(true);
    await page.evaluate(async o=>{await window.__renderTokenFixture({view:'card',tokenStatus:'ready',quotaStatus:'ok',stale:false,skin:'mecha-light',theme:'light',mode:'turns',shortWindow:true,opacityPercent:100,...o});window.__mechaFixtureDragCount=0;},{percent,language});
    await page.locator('.primary-metric').click();assert.equal(await page.evaluate(()=>window.__mechaFixtureDragCount),1,'positive drag control');
    await page.evaluate(()=>window.__mechaFixtureDragCount=0);const events=[];
    for(let i=0;i<3;i++){
      const button=page.locator(`${selector} > button`).nth(i), box=await button.boundingBox();
      for(const point of [{x:box.x+1,y:box.y+1},{x:box.x+box.width-1,y:box.y+box.height-1},{x:box.x+box.width/2,y:box.y+box.height/2}]){
        await page.mouse.click(point.x,point.y);assert.equal(await button.getAttribute('aria-pressed'),'true');
      }
      for(const key of ['Enter','Space']){
        await page.locator(`${selector} > button`).nth((i+1)%3).click();await button.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
        const focused=await button.evaluate(b=>{const s=getComputedStyle(b);return {active:document.activeElement===b,visible:b.matches(':focus-visible'),outline:s.outline,offset:s.outlineOffset,clip:s.clipPath};});
        assert.ok(focused.active&&focused.visible);assert.equal(focused.clip,'none');assert.ok(focused.outline.includes('2px'));
        if(state==='blue'&&language==='zh-CN'&&i===1&&key==='Enter')await page.screenshot({path:resolve(output,'focus-derived.png'),clip:{x:28,y:317,width:258,height:36}});
        await page.keyboard.press(key);assert.equal(await button.getAttribute('aria-pressed'),'true');
        const content=await page.locator(['.token-grid','.token-model-view','.token-turn-view'][i]).count();assert.equal(content,1);events.push({i,key,focused,content});
      }
    }
    const dragCount=await page.evaluate(()=>window.__mechaFixtureDragCount);assert.equal(dragCount,0);
    report.interactions.push({state,language,dragCount,events});
  }
}catch(e){report.errors.push(e.stack||String(e));}finally{
  await browser?.close();await server.close();
  report.summary={comparisons:report.comparisons.length,failed:report.comparisons.filter(c=>c.errors.length).length,interactions:report.interactions.length,runtimeErrors:report.errors.length};
  await writeFile(resolve(output,'regression.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({summary:report.summary,errors:report.errors,failures:report.comparisons.filter(c=>c.errors.length).slice(0,6)},null,2));
  if(report.summary.failed||report.errors.length)process.exitCode=1;
}
