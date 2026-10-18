// ============================================================
// 読み込み失敗の立て直し（2026-10-19 beta・Codex 指摘）
//   3Dの本（BookScene.load）や読書のページ画像が取れなかった時だけ「読み込めなかった　もう一度」を出す。
//   書体と位置は #hint と同じ（本の下 66dvh・明朝・金）。押すと消えて再試行する。?fx=0 では出さない（旧動作）。
// ============================================================
import { QP } from '../state';

const ON = QP.get('fx') !== '0';
let el: HTMLButtonElement | null = null;
let cb: (() => void) | null = null;

function node(): HTMLButtonElement {
  if (el) return el;
  el = document.createElement('button');
  el.id = 'retry';
  el.type = 'button';
  el.innerHTML = '<span class="txt">読み込めなかった　もう一度</span><span class="rule"></span>';
  el.addEventListener('click', () => {
    const f = cb; hideRetry();
    if (f) f();
  });
  document.body.appendChild(el);
  return el;
}

export function showRetry(onRetry: () => void): void {
  if (!ON) return;
  cb = onRetry;
  const b = node();
  b.classList.add('show');
}
export function hideRetry(): void {
  cb = null;
  if (el) el.classList.remove('show');
}
