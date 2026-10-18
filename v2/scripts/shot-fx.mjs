// 試作版（beta 2026-10-19）の入口の見え方を撮る。デバッグChrome(9222)が無ければ、ヘッドレスの Chrome を自前で起動する。
// 使い方: node scripts/shot-fx.mjs [出力フォルダ]
//   撮るもの: fx0（?fx=0 旧動作）／ default（env+pbr）／ etch ／ smoke ／ retry（book.glb を落として「もう一度」）
import pw from 'file:///C:/Users/kooo4/KEI-Workshop/himari/materials-bot/node_modules/playwright-core/index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { chromium } = pw;

const BASE = 'http://127.0.0.1:8123/meigen-no-sho-beta/app2/';
const OUT = process.argv[2] || 'D:/kei-work/2026-10-19_meigen-beta/shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let browser, own = false;
try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch {
  own = true;
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}
const errors = [];
async function shot(name, qs, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
  await page.route('**/registerSW.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  if (opts.failGlb) await page.route('**/book.glb*', r => r.abort());
  await page.addInitScript(() => {
    localStorage.setItem('bookexp-beta-unlocked', '2026-10-02a');
    localStorage.removeItem('bookexp-beta-fx');
  });
  await page.goto(BASE + qs, { waitUntil: 'load' });
  // ヘッドレス（ソフト描画）は遅く、8秒で auto-lite（後処理を外す）に落ちる → 撮影の間だけ判定を済ませた扱いにする
  await page.evaluate(() => { const s = window.__app && window.__app.scene; if (s) s.perfDone = true; });
  await sleep(opts.wait || 9000);
  if (opts.eval) await page.evaluate(opts.eval);
  if (opts.after) await sleep(opts.after);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('shot', name);
  await ctx.close();
}
if (!process.argv.includes('--fxonly')) { await shot('01_fx0', '?fx=0'); await shot('02_default_env_pbr', ''); }
if (!process.argv.includes('--smokeonly')) await shot('03_etch', '?etch=1');
await shot('04_smoke', '?smoke=1');
if (process.argv.includes('--smokedebug')) await shot('04b_smoke_x4', '?smoke=1', { eval: () => { const m = window.__app.scene.smoke; m.material.uniforms.uOpacity.value = 0.9; }, after: 300 });
if (!process.argv.includes('--smokeonly')) await shot('05_retry', '', { failGlb: true, wait: 5000 });
if (process.argv.includes('--panel')) await shot('06_panel', '', { eval: () => document.getElementById('betaTag').click(), after: 600 });
for (const a of process.argv.filter(x => x.startsWith('--qs='))) await shot('v_' + a.slice(5).replace(/[^a-z0-9.=]/gi, '_'), '?' + a.slice(5));
console.log(errors.length ? errors.join('\n') : 'no console errors');
if (own) await browser.close(); else await browser.close().catch(() => {});
