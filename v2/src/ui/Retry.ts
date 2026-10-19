// ============================================================
// 読み込み失敗の知らせ（2026-10-19 beta・Codex 指摘 → 2026-10-20 KEI「読み込み出来ない時に出るメッセージを出すこと」）
//   「読み込み中」のまま待たせない。取れなかった時・12秒たっても届かない時・つながりが切れている時に、
//   古い紙の小さな札（明朝・墨色）で知らせ、文字だけのボタン「もう一度」を置く。
//   つながりが切れている時は「戻れば続きを開く」と書き、online に戻ったら自分で取り直す。
//   文言は仮（KEI が口述で決める）。?fx=0 では出さない（旧動作）。
//   showRetry(cb, kind) / hideRetry(kind?) の名前は 10-19 版と同じ（Reader・main が呼ぶ）。
// ============================================================
import { QP } from '../state';

const ON = QP.get('fx') !== '0';

/** book = 本（book_open.glb / book.glb）／ page = 読書中のページ画像／ part = 書斎の一部（質感・暖炉の光） */
export type FailKind = 'book' | 'page' | 'part';

// ---- 文言（仮・KEI 確認待ち）----
const COPY: Record<FailKind | 'offline', { h: string; s?: string }> = {
  book: { h: '書斎に届かなかった。' },
  page: { h: 'ページが届いていない。' },
  part: { h: '書斎の一部が届かなかった。' },
  offline: { h: 'つながりが切れている。', s: '戻れば続きを開く。' },
};
const BTN = 'もう一度';

let el: HTMLDivElement | null = null;
let cb: (() => void) | null = null;
let cur: FailKind | null = null;

function offline(): boolean { try { return navigator.onLine === false; } catch { return false; } }

function node(): HTMLDivElement {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'retry';
  el.setAttribute('role', 'alert');
  el.innerHTML = '<div class="rcard"><p class="rh"></p><p class="rs"></p><button type="button" class="rbtn">' + BTN + '</button></div>';
  el.querySelector('.rbtn')!.addEventListener('click', () => fire());
  // 後ろの canvas（2回タップ・回転）・読書のめくりへ通さない（click は document の押下音フックまで上げる）
  (['pointerdown', 'pointerup', 'touchstart', 'touchend'] as const).forEach(ev => el!.addEventListener(ev, e => e.stopPropagation()));
  document.body.appendChild(el);
  return el;
}
function paint(): void {
  if (!el || !cur) return;
  const off = offline(), c = off ? COPY.offline : COPY[cur];
  (el.querySelector('.rh') as HTMLElement).textContent = c.h;
  const s = el.querySelector('.rs') as HTMLElement;
  s.textContent = c.s || ''; s.style.display = c.s ? '' : 'none';
  el.classList.toggle('off', off);
  el.dataset.kind = cur;
}
function fire(): void {
  const f = cb; hideRetry();
  if (f) f();
}

/** 失敗を知らせる。同じ札が出ていれば文言と取り直し先だけ差し替える */
export function showRetry(onRetry: () => void, kind: FailKind = 'book'): void {
  if (!ON) return;
  // 本が無い札は他より重い。page/part で上書きしない
  if (cur === 'book' && kind !== 'book') return;
  cb = onRetry; cur = kind;
  const b = node(); paint();
  document.body.classList.add('lfail');
  b.classList.add('show');
}
/** kind を渡すと、その札の時だけ消す（届いたら自動で消す用） */
export function hideRetry(kind?: FailKind): void {
  if (kind && cur !== kind) return;
  cb = null; cur = null;
  document.body.classList.remove('lfail');
  if (el) el.classList.remove('show');
}
export function retryShown(): FailKind | null { return cur; }

// つながりが戻ったら、押されなくても取り直す。切れたら文言を切り替える
addEventListener('online', () => { if (cur && cb) setTimeout(() => { if (cur && cb && !offline()) fire(); }, 400); });
addEventListener('offline', () => paint());

// ============================================================
// 保存できなかった時の一行（2026-10-20・Codex 指摘 4）。印・栞の localStorage 書き込みが throw した時に1回だけ
// ============================================================
let noted = false;
export function noteStoreFail(): void {
  if (noted || !ON) return;
  noted = true;
  const n = document.createElement('div');
  n.id = 'storeNote';
  n.setAttribute('role', 'status');
  n.textContent = 'この端末に保存できなかった';
  document.body.appendChild(n);
  requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add('show')));
  setTimeout(() => n.classList.remove('show'), 3600);
}
