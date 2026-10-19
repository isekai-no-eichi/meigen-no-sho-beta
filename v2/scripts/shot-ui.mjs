// 試作版（beta 2026-10-20）: 読み込み失敗の札・合言葉の誤入力・保存失敗・1枚目なしの潜り・触覚の呼び出しを、ヘッドレスで再現して撮る。
// 使い方: node scripts/shot-ui.mjs [BASE] [出力フォルダ] [名前の頭…]
//   例) node scripts/shot-ui.mjs http://127.0.0.1:8131/meigen-no-sho-beta/app2/ D:/kei-work/2026-10-20_meigen-beta2/shots_ui 01 06
import pw from 'file:///C:/Users/kooo4/KEI-Workshop/himari/materials-bot/node_modules/playwright-core/index.js';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = pw;
const BASE = process.argv[2] || 'http://127.0.0.1:8131/meigen-no-sho-beta/app2/';
const OUT = process.argv[3] || 'D:/kei-work/2026-10-20_meigen-beta2/shots_ui';
const ONLY = process.argv.slice(4);
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const log = [];
async function run(name, fn, { unlocked = true, init } = {}) {
  if (ONLY.length && !ONLY.some(o => name.startsWith(o))) return;
  const ctx = await browser.newContext({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => log.push(name + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') log.push(name + ' console: ' + m.text().slice(0, 160)); });
  await page.route('**/registerSW.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(([u]) => {
    if (u) localStorage.setItem('bookexp-beta-unlocked', '2026-10-02a'); else localStorage.removeItem('bookexp-beta-unlocked');
    localStorage.removeItem('bookexp-beta-fx');
    // navigator.vibrate の呼び出しを記録（Android の経路の確認用）
    const t0 = performance.now(); window.__vib = [];
    navigator.vibrate = p => { window.__vib.push({ t: Math.round(performance.now() - t0), p: JSON.stringify(p) }); return true; };
  }, [unlocked]);
  if (init) await page.addInitScript(init);
  const snap = async n => { await page.screenshot({ path: path.join(OUT, n + '.png') }); log.push('shot ' + n); };
  const c = { page, ctx, snap, perf: () => page.evaluate(() => { const s = window.__app && window.__app.scene; if (s) s.perfDone = true; }) };
  try { await fn(c); } catch (e) { log.push(name + ' ERROR ' + e.message.split('\n')[0]); }
  await ctx.close();
}
const open = async (c, qs = '') => { await c.page.goto(BASE + qs, { waitUntil: 'load' }); await c.perf(); };
const cls = c => c.page.evaluate(() => (document.getElementById('retry') || { className: 'none' }).className);
const hasBook = c => c.page.evaluate(() => !!window.__app.scene.book);

// 1) book_open.glb が取れない → 書斎に届かなかった →「もう一度」で本が出る
await run('01_book_fail', async c => {
  await c.page.route('**/book_open.glb*', r => r.abort());
  await open(c); await sleep(5000); await c.snap('01_book_fail');
  await c.page.unroute('**/book_open.glb*');
  await c.page.click('#retry .rbtn'); await sleep(7000);
  log.push('01 after retry: panel=' + await cls(c) + ' book=' + await hasBook(c));
  await c.snap('01b_book_retry_ok');
});
// 1c) ?cover=0 の book.glb が取れない
await run('01c_bookglb_fail', async c => {
  await c.page.route('**/book.glb*', r => r.abort());
  await open(c, '?cover=0'); await sleep(5000); await c.snap('01c_bookglb_fail');
});
// 2) 応答が無い（12秒）→ 同じ札
await run('02_book_timeout', async c => {
  await c.page.route('**/book_open.glb*', () => { /* 返さない */ });
  await open(c); await sleep(7000);
  log.push('02 at 7s: ' + await cls(c));
  await sleep(7000); log.push('02 at 14s: ' + await cls(c)); await c.snap('02_book_timeout_14s');
});
// 3) オフライン → つながりが切れている。戻れば自動で取り直す
await run('03_offline', async c => {
  let hold = null;
  await c.page.route('**/book_open.glb*', r => { hold = r; });
  await open(c); await sleep(1500);
  await c.ctx.setOffline(true); if (hold) await hold.abort(); await sleep(2500);
  await c.snap('03_offline');
  await c.page.unroute('**/book_open.glb*');
  await c.ctx.setOffline(false); await sleep(8000);
  log.push('03 after online: panel=' + await cls(c) + ' book=' + await hasBook(c));
  await c.snap('03b_online_auto_retry');
});
// 4) 暖炉の光（HDRI）が取れない → 書斎の一部（本は出る）
await run('04_part_fail', async c => {
  await c.page.route('**/env/fireplace_1k.hdr*', r => r.abort());
  await open(c); await sleep(8000);
  log.push('04 panel=' + await cls(c) + ' book=' + await hasBook(c));
  await c.snap('04_part_fail');
});
// 5) 読書中のページ画像が取れない → ページが届いていない
await run('05_page_fail', async c => {
  await c.page.route(/\/assets\/pages(-avif)?\//, r => r.abort());
  await open(c); await sleep(6000);
  await c.page.evaluate(() => window.__app.beginRead('read')); await sleep(14000);
  log.push('05 rload=' + await c.page.evaluate(() => getComputedStyle(document.getElementById('rload')).visibility) + ' panel=' + await cls(c));
  await c.snap('05_page_fail');
});
// 5b) ページの応答が無い（12秒）→ 同じ札
await run('05b_page_timeout', async c => {
  await c.page.route(/\/assets\/pages(-avif)?\//, () => { /* 返さない */ });
  await open(c); await sleep(6000);
  await c.page.evaluate(() => window.__app.beginRead('read')); await sleep(9000);
  log.push('05b at 9s: ' + await cls(c)); await c.snap('05b_page_wait_9s');
  await sleep(12000); log.push('05b at 21s: ' + await cls(c)); await c.snap('05c_page_timeout_21s');
});
// 6) 合言葉を間違える → 入力が残って全選択・案内は次の入力まで
await run('06_gate_wrong', async c => {
  await open(c); await sleep(2500);
  await c.page.click('#k7x'); await c.page.keyboard.type('ちがうことば');
  await c.page.click('#gateGo'); await sleep(2600);
  const st = await c.page.evaluate(() => ({ text: document.getElementById('k7x').textContent, sel: String(getSelection()), err: document.getElementById('gateErr').classList.contains('show') }));
  log.push('06 after 2.6s: ' + JSON.stringify(st));
  await c.snap('06_gate_wrong');
  await c.page.keyboard.press('End'); await c.page.keyboard.type('x'); await sleep(600);
  log.push('06 after key: err=' + await c.page.evaluate(() => document.getElementById('gateErr').classList.contains('show')));
  await c.snap('06b_gate_after_key');
}, { unlocked: false });
// 7) 印・栞の保存が throw → この端末に保存できなかった（1回だけ）＋ 触覚（印・栞）の呼び出し記録
await run('07_store_fail', async c => {
  await open(c); await sleep(6000);
  await c.page.evaluate(() => window.__app.beginRead('read')); await sleep(14000);
  await c.page.evaluate(() => { window.__vib.length = 0; });
  // 読書の下ボタンは 2.5 秒で隠れ、隠れている時の1回目は「出すだけ」。押す直前に出ている状態にしてから押す
  const press = async sel => { await c.page.evaluate(() => { const r = document.querySelector('.uihide'); if (r) r.classList.remove('uihide'); }); await c.page.evaluate(q => document.querySelector(q).click(), sel); };
  const tt = () => c.page.evaluate(() => document.getElementById('toast').textContent + '|' + window.__vib.length);
  await sleep(500); await press('#favBtn'); log.push('07 印1=' + await tt());
  await c.page.waitForSelector('#storeNote.show', { timeout: 5000 }).catch(() => {}); await sleep(250); await c.page.evaluate(() => { const r = document.querySelector('.uihide'); if (r) r.classList.remove('uihide'); });
  await c.snap('07_store_fail');
  await sleep(500); await press('#favBtn'); log.push('07 印2=' + await tt()); await sleep(600);
  await press('#favListBtn'); log.push('07 栞=' + await tt()); await sleep(600);
  await press('#backBtn'); await sleep(300);
  log.push('07 notes=' + await c.page.evaluate(() => document.querySelectorAll('#storeNote').length));
  log.push('07 vibrate(印,印,栞,戻る): ' + JSON.stringify(await c.page.evaluate(() => window.__vib)));
}, { init: () => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (/favs|bookmark/.test(k)) throw new Error('QuotaExceededError'); return o.call(this, k, v); }; } });
// 8) 表紙の着地 → 潜る（1枚目はめくらない）＋ 2回タップ・着地の触覚
await run('08_cover_dive', async c => {
  await open(c); await sleep(7000);
  await c.page.evaluate(() => { window.__vib.length = 0; window.__t0 = performance.now(); });
  // ヘッドレスは描画が遅く canvas の2回タップが通らないので、2回タップと同じ入口（Ui.tap → onOpen）を直接呼ぶ
  await c.page.evaluate(() => { const u = window.__app.ui; u.lastTap = performance.now(); u.tap(); });
  // 状態は頁の中で 100ms ごとに記録（撮影が遅いので撮影の時刻とは別にとる）
  await c.page.evaluate(() => { window.__trace = []; setInterval(() => { const a = window.__app, sc = a.scene; window.__trace.push({ t: Math.round(performance.now() - window.__t0), st: a.stage, c: +(sc.hinge?.rotation.z || 0).toFixed(2), p: +(sc.pageHinge?.rotation.z || 0).toFixed(2) }); }, 100); });
  for (const ms of [3600, 4900, 5900]) {
    const now = await c.page.evaluate(() => performance.now() - window.__t0);
    if (ms > now) await sleep(ms - now);
    await c.snap('08_cover_' + ms);
  }
  await sleep(1500);
  const tr = await c.page.evaluate(() => window.__trace);
  // 変化した所だけ残す
  const keep = tr.filter((r, k) => k === 0 || r.st !== tr[k - 1].st || Math.abs(r.c - tr[k - 1].c) > 0.3 || r.p !== tr[k - 1].p);
  log.push('08 trace: ' + JSON.stringify(keep) + ' maxPage=' + Math.max(...tr.map(r => r.p)) + ' pageSec=' + await c.page.evaluate(() => window.__app.scene.pageSec));
  log.push('08 vibrate(2回タップ→開く→着地): ' + JSON.stringify(await c.page.evaluate(() => window.__vib)));
});
// 8b) ?cpage=1 は1枚目をめくる（比較用）
await run('08b_cpage1', async c => {
  await open(c, '?cpage=1'); await sleep(7000);
  log.push('08b pageSec=' + await c.page.evaluate(() => window.__app.scene.pageSec));
});
// 9) 試作版パネル「振動を試す」
await run('09_panel', async c => {
  await open(c); await sleep(4000);
  await c.page.click('#betaTag'); await sleep(500);
  await c.page.evaluate(() => { window.__vib.length = 0; });
  await c.page.click('#betaPanel .bhap'); await sleep(300);
  log.push('09 vibrate: ' + JSON.stringify(await c.page.evaluate(() => window.__vib)) + ' text=' + await c.page.evaluate(() => document.querySelector('#betaPanel .bhapres').textContent));
  await c.snap('09_panel_haptic');
});
await browser.close();
fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n'));
console.log(log.join('\n'));
