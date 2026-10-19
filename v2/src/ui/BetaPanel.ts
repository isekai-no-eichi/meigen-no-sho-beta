// ============================================================
// 試作版の切替パネル（2026-10-19 beta）
//   右上の「試作版」を押すと開く。試作スイッチ（state.ts の fxOn/fxSet）を「入」「切」で切り替える。
//   切り替えたら保存して1秒後に開き直す（効果は読み込み時に決まるため）。配色と書体は説明パネル（黒革・明朝）と同じ。
// ============================================================
import { fxOn, fxSet, type FxKey } from '../state';
import { hapticTest } from '../audio';

const ROWS: [FxKey, string][] = [
  ['cover', '表紙が開いてから潜る'],
  ['env', '暖炉の反射'],
  ['pbr', '革と紙の質感'],
  ['smoke', 'ろうそくの煙'],
  ['etch', '銅版画の線'],
  // ['reverb', '書斎の残響と柱時計'],   // 2026-10-19 KEI「いらない」→ 外した（?reverb=1 では今も鳴らせる）
  ['tilt', '傾きで光と雨が動く'],
  ['haptic', '触覚'],
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
    // 2026-10-20 KEI: 両方の端末で触覚を確かめる（表紙の着地と同じ形・スイッチに関係なく鳴らす）
    '<div class="brow btest"><span class="bl">振動を試す</span><span class="bsw"><button type="button" class="bhap">鳴らす</button></span></div>' +
    '<p class="bnote bhapres"></p>' +
    '<p class="bnote">切り替えると本を開き直す</p>' +
    '<button type="button" class="bclose">閉じる</button>' +
    '</div>';
  document.body.appendChild(wrap);

  const paint = (): void => {
    wrap.querySelectorAll<HTMLDivElement>('.brow[data-k]').forEach(r => {
      const on = fxOn(r.dataset.k as FxKey);
      r.querySelector('.bon')!.classList.toggle('sel', on);
      r.querySelector('.boff')!.classList.toggle('sel', !on);
    });
  };
  let reloading = false;
  wrap.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t === wrap || t.classList.contains('bclose')) { wrap.classList.remove('show'); return; }
    if (t.classList.contains('bhap')) {
      const r = hapticTest();
      (wrap.querySelector('.bhapres') as HTMLElement).textContent =
        r === 'android' ? 'Android の振動で鳴らした' : r === 'ios' ? 'iPhone の方式で鳴らした（iOS 18 以降の Safari）' : 'この端末は振動に対応していない';
      return;
    }
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
