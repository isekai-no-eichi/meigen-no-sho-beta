// cover（表紙が開いてから潜る）の止め絵。2回タップ相当（beginRead('read')）→ 表紙が半分（75°）・開き切り（150°）・1枚目が開いた所を撮る（2026-10-19）
// 使い方: node scripts/shot-cover.mjs [出力フォルダ] [--base=URL] [--qs=追加のクエリ] [--th=カメラの回り]
import pw from 'file:///C:/Users/kooo4/KEI-Workshop/himari/materials-bot/node_modules/playwright-core/index.js';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = pw;
const arg = k => (process.argv.find(a => a.startsWith('--' + k + '=')) || '').slice(k.length + 3);
const BASE = arg('base') || 'http://127.0.0.1:8123/meigen-no-sho-beta/app2/';
const EXTRA = arg('qs');
const TH = parseFloat(arg('th') || '0.55');
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'D:/kei-work/2026-10-19_meigen-beta/shots2';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
// 撮る瞬間に表紙と1枚目のクリップを止める（mixer.timeScale=0）。ソフト描画で遅いので、角度を見て止めてから撮る
async function shot(name, idx, deg, qx = '') {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
  await page.route('**/registerSW.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(() => { localStorage.setItem('bookexp-beta-unlocked', '2026-10-02a'); localStorage.removeItem('bookexp-beta-fx'); });
  await page.goto(BASE + '?shot=1' + qx + (EXTRA ? '&' + EXTRA : ''), { waitUntil: 'load' });
  await page.evaluate(() => { const s = window.__app && window.__app.scene; if (s) s.perfDone = true; });
  await sleep(9000);
  await page.evaluate(([th, idx, deg]) => {
    const s = window.__app.scene;
    window.__app.setCam(th, s.camPhi);
    window.__frozen = null;
    const watch = () => {
      const h = idx === 0 ? s.hinge : s.pageHinge;
      if (h && h.rotation.z * 180 / Math.PI >= deg) {
        // 角度に来たらクリップを止め、次に描いた1コマをその場で PNG に（描いた直後なので WebGL の画が残っている）
        s.mixer.timeScale = 0;
        s.captureFrame(() => { window.__frozen = [s.renderer.domElement.toDataURL('image/png'), s.hinge.rotation.z, s.pageHinge ? s.pageHinge.rotation.z : 0]; });
        return;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    window.__app.beginRead('read');
  }, [TH, idx, deg]);
  await page.waitForFunction(() => window.__frozen !== null, null, { timeout: 30000, polling: 50 });
  const [url, cz, pz] = await page.evaluate(() => window.__frozen);
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', name, 'cover=' + (cz * 180 / Math.PI).toFixed(1), 'page=' + (pz * 180 / Math.PI).toFixed(1));
  await ctx.close();
}
const only = arg('only');
const PRE = arg('prefix') || 'cover';   // 2026-10-19 K: --prefix=cover2 で cover2_*.png
if (!only || only === 'half') await shot(PRE + '_1_half', 0, 75);
if (!only || only === 'open') await shot(PRE + '_2_open', 0, 149.9, '&cpage=0')   // 1枚目が動き出す前の「開き切り」（ソフト描画は1コマが遅いので1枚目を止めて撮る）;
if (!only || only === 'page') await shot(PRE + '_3_page', 1, 100);
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
