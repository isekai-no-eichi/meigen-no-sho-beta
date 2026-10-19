// 表面の銅版画（?etch=1）の止め絵。正面／少し回った／寄り と ?etch=0 の正面を撮る（2026-10-19 夜）
// 使い方: node scripts/shot-etch.mjs [出力フォルダ] [--base=URL] [--qs=追加のクエリ]
import pw from 'file:///C:/Users/kooo4/KEI-Workshop/himari/materials-bot/node_modules/playwright-core/index.js';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = pw;
const arg = k => (process.argv.find(a => a.startsWith('--' + k + '=')) || '').slice(k.length + 3);
const BASE = arg('base') || 'http://127.0.0.1:8123/meigen-no-sho-beta/app2/';
const EXTRA = arg('qs');
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'D:/kei-work/2026-10-19_meigen-beta/shots2';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
async function shot(name, qs, ev) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
  await page.route('**/registerSW.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(() => { localStorage.setItem('bookexp-beta-unlocked', '2026-10-02a'); localStorage.removeItem('bookexp-beta-fx'); });
  await page.goto(BASE + qs + (EXTRA ? '&' + EXTRA : ''), { waitUntil: 'load' });
  await page.evaluate(() => { const s = window.__app && window.__app.scene; if (s) s.perfDone = true; });
  await sleep(9000);
  if (ev) { await page.evaluate(ev); await sleep(1500); }
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('shot', name);
  await ctx.close();
}
const turn = () => { const s = window.__app.scene; s.camTheta = 1.05; s.camPhi = 1.12; };
const near = () => { const c = window.__app.scene.camera; c.fov = 15; c.updateProjectionMatrix(); };
const only = arg('only');
if (!only || only === 'front') await shot('etch_1_front', '?etch=1');
if (!only || only === 'turn') await shot('etch_2_turned', '?etch=1', turn);
if (!only || only === 'near') await shot('etch_3_near', '?etch=1', near);
if (!only) await shot('etch_0_off_front', '?etch=0');
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
