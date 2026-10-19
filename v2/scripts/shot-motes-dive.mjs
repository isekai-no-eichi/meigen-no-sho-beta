// 光の粒 d と、潜る時のにじみ（dive）の止め絵とコスト計測（2026-10-20 beta）。
// 使い方: node scripts/shot-motes-dive.mjs [出力フォルダ] [--base=URL] [--only=rest|a|dive|nodive|perf] [--prefix=]
//   rest   … ?motes=d の静止 2 枚（3 秒あけて）
//   a      … ?motes=a の静止（比較用）
//   dive   … 潜りの途中（にじみ入り）
//   nodive … 潜りの途中（?dive=0）
//   perf   … フレーム間隔（静止 5 秒・潜りの間）。d＋にじみ入／d＋?dive=0／a＋?dive=0 を2巡
import pw from 'file:///C:/Users/kooo4/KEI-Workshop/himari/materials-bot/node_modules/playwright-core/index.js';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = pw;
const arg = k => (process.argv.find(a => a.startsWith('--' + k + '=')) || '').slice(k.length + 3);
const BASE = arg('base') || 'http://127.0.0.1:8137/meigen-no-sho-beta/app2/';
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'D:/kei-work/2026-10-20_meigen-beta2/shots_fx';
const PRE = arg('prefix') || '';
const ONLY = arg('only');
const EXTRA = arg('qs');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
async function open(name, qs) {
  // KEI の iPhone と同じ経路（MOBILE＝UA 判定：粒の数・Bokeh なし）で撮る。--desktop で PC 経路
  const ua = process.argv.includes('--desktop') ? undefined : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ctx = await browser.newContext({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2, ...(ua ? { userAgent: ua } : {}) });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
  await page.route('**/registerSW.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(() => { localStorage.setItem('bookexp-beta-unlocked', '2026-10-02a'); localStorage.removeItem('bookexp-beta-fx'); });
  await page.goto(BASE + '?shot=1' + (qs ? '&' + qs : '') + (EXTRA ? '&' + EXTRA : ''), { waitUntil: 'load' });
  await page.evaluate(() => { const s = window.__app && window.__app.scene; if (s) s.perfDone = true; });
  return { ctx, page };
}
// WebGL の1コマだけを PNG に（DOM の文字や暗転の幕は入らない）
async function grab(page, file) {
  await page.evaluate(() => { window.__g = null; window.__app.scene.captureFrame(() => { window.__g = window.__app.scene.renderer.domElement.toDataURL('image/png'); }); });
  await page.waitForFunction(() => window.__g !== null, null, { timeout: 30000, polling: 50 });
  const url = await page.evaluate(() => window.__g);
  fs.writeFileSync(path.join(OUT, file), Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', file);
}
async function rest(name, qs, two) {
  const { ctx, page } = await open(name, qs);
  await sleep(11000);
  if (arg('js')) await page.evaluate(arg('js'));   // 調整用（例 --js="window.__app.scene.grace.nearMat.uniforms.uFloor.value=1"）
  await grab(page, PRE + name + '_1.png');
  if (two) { await sleep(3000); await grab(page, PRE + name + '_2.png'); }
  await ctx.close();
}
// 潜りの途中: fov が 38+20k² なので、fov で k を見て、その時の1コマを撮る
async function dive(name, qs, kAt = 0.55) {
  const { ctx, page } = await open(name, qs);
  await sleep(9000);
  await page.evaluate((kAt) => {
    const s = window.__app.scene;
    window.__g = null;
    // 潜りの時刻を kAt で止めて（ソフト描画は1コマが遅く飛び越すため）、その1コマを撮る
    const orig = s.update.bind(s), T = kAt * 1.6;
    s.update = (o) => {
      if (o.diving && o.diveT >= T && window.__g === null) {
        o.diveT = T;
        s.captureFrame(() => { window.__g = [s.renderer.domElement.toDataURL('image/png'), s.camera.fov, s.divePass ? s.divePass.uniforms.uAmt.value : 0]; });
      }
      return orig(o);
    };
    window.__app.beginRead('read');
  }, kAt);
  await page.waitForFunction(() => window.__g !== null, null, { timeout: 60000, polling: 30 });
  const [url, fov, amt] = await page.evaluate(() => window.__g);
  fs.writeFileSync(path.join(OUT, PRE + name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', name, 'k=' + Math.sqrt((fov - 38) / 20).toFixed(2), 'amt=' + amt.toFixed(2));
  await ctx.close();
}
// フレーム間隔（本体のループのまま）。静止 5 秒の平均と、潜っている間（開く→暗転）の平均を取る
async function perf(name, qs) {
  const { ctx, page } = await open(name, qs);
  await sleep(10000);
  const r = await page.evaluate(async () => {
    const s = window.__app.scene, orig = s.update.bind(s);
    const rest = [], dive = []; let last = 0, phase = 'rest';
    s.update = (o) => {
      const now = performance.now();
      if (last) (phase === 'rest' ? rest : (o.diving ? dive : [])).push(now - last);
      last = now;
      return orig(o);
    };
    await new Promise(r => setTimeout(r, 5000));
    phase = 'open';
    window.__app.beginRead('read');
    await new Promise(r => setTimeout(r, 12000));
    const avg = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null;
    return { restMs: avg(rest), restN: rest.length, diveMs: avg(dive), diveN: dive.length };
  });
  console.log('perf', name, JSON.stringify(r));
  fs.appendFileSync(path.join(OUT, 'perf.txt'), name + ' ' + JSON.stringify(r) + '\n');
  await ctx.close();
}
if (!ONLY || ONLY === 'rest') await rest('motes_d_rest', 'motes=d', true);
if (!ONLY || ONLY === 'a') await rest('motes_a_rest', 'motes=a', false);
const KAT = parseFloat(arg('k') || '0.3');
if (!ONLY || ONLY === 'dive') await dive('dive_mid_blur', 'motes=d', KAT);
if (!ONLY || ONLY === 'nodive') await dive('dive_mid_dive0', 'motes=d&dive=0', KAT);
if (ONLY === 'perf') for (let i = 0; i < 2; i++) { await perf('perf_d_dive1', 'motes=d'); await perf('perf_d_dive0', 'motes=d&dive=0'); await perf('perf_a_dive0', 'motes=a&dive=0'); }
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
