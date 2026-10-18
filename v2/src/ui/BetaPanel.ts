// ============================================================
// 試作版の切替パネル（2026-10-19 beta）
//   右上の「試作版」を押すと開く。5つの試作スイッチ（state.ts の fxOn/fxSet）を「入」「切」で切り替える。
//   切り替えたら保存して1秒後に開き直す（効果は読み込み時に決まるため）。配色と書体は説明パネル（黒革・明朝）と同じ。
// ============================================================
import { fxOn, fxSet, type FxKey } from '../state';

const ROWS: [FxKey, string][] = [
  ['env', '暖炉の反射'],
  ['pbr', '革と紙の質感'],
  ['smoke', 'ろうそくの煙'],
  ['etch', '銅版画の線'],
  ['reverb', '書斎の残響と柱時計'],
];

export function initBetaPanel(): void {
  const tag = document.getElementById('betaTag');
  if (!tag) return;
  tag.setAttribute('role', 'button');
  tag.classList.add('tap');

  const wrap = document.createElement('div');
  wrap.id = 'betaPanel';
  wrap.innerHTML =
    '<div class="bbox frame">' +
    '<p class="bh">試作の切替</p>' +
    ROWS.map(([k, label]) =>
      `<div class="brow" data-k="${k}"><span class="bl">${label}</span>` +
      `<span class="bsw"><button type="button" class="bon" data-v="1">入</button><button type="button" class="boff" data-v="0">切</button></span></div>`).join('') +
    '<p class="bnote">切り替えると本を開き直す</p>' +
    '<button type="button" class="bclose">閉じる</button>' +
    '</div>';
  document.body.appendChild(wrap);

  const paint = (): void => {
    wrap.querySelectorAll<HTMLDivElement>('.brow').forEach(r => {
      const on = fxOn(r.dataset.k as FxKey);
      r.querySelector('.bon')!.classList.toggle('sel', on);
      r.querySelector('.boff')!.classList.toggle('sel', !on);
    });
  };
  let reloading = false;
  wrap.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t === wrap || t.classList.contains('bclose')) { wrap.classList.remove('show'); return; }
    const b = t.closest('button[data-v]') as HTMLButtonElement | null;
    if (!b || reloading) return;
    const row = b.closest('.brow') as HTMLDivElement;
    const k = row.dataset.k as FxKey, v = b.dataset.v === '1';
    if (fxOn(k) === v) return;
    fxSet(k, v);
    // URL の ?<k>= / ?fx= が保存値より優先されるので、外してから開き直す
    const u = new URL(location.href);
    u.searchParams.delete(k); u.searchParams.delete('fx');
    row.querySelector('.bon')!.classList.toggle('sel', v);
    row.querySelector('.boff')!.classList.toggle('sel', !v);
    reloading = true;
    setTimeout(() => { if (u.href !== location.href) location.replace(u.href); else location.reload(); }, 1000);
  });
  tag.addEventListener('click', () => { paint(); wrap.classList.add('show'); });
}
