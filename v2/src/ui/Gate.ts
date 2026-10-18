// ============================================================
// 合言葉のゲート（2026-09-21 KEI）
//   初回（localStorage bookexp-unlocked が無い時）だけ出る。
//     本は出さない（scale 0）。背景・ロウソク・塵はそのまま。
//     細い金の罫線の枠 →「合言葉は？」→ 下線だけの1行入力 →「ひらく」
//   間違い: 枠ごと左右に小さく揺れ、「合言葉が違います」を1.5秒。
//   正解  : 「解けた」一拍（0.5s）→ ゲート全体がフェード（1.2s）→ 本が出現（BookScene.revealStart）
//   ?reset=1 で解錠の記憶（bookexp-unlocked）だけ消して初回に戻す（撮影用・処理は state.ts・2026-09-30）。
//   ?gate=1 で毎回出す（検証用）。?gate=0 のスキップは発売で廃止（2026-09-25）。クエリでゲートを飛ばす経路は無い（?icon / ?stats も未解錠ならゲートを出す・2026-09-25 QA）。
// ============================================================
import { QP, isUnlocked } from '../state';

/** 合言葉の正解は平文で置かない（2026-09-25 KEI GO・発売準備）。
 *  値 = SHA-256( norm(合言葉) ) の hex。変える時は node で下の norm と同じ処理を通した文字列をハッシュして差し替える。
 *  （例: node -e "…createHash('sha256').update(normした合言葉).digest('hex')"）
 *  2026-10-02: 合言葉を変えたら state.ts の GATE_VERSION も変える（全端末が1回だけ再入力・印と栞は残る）。 */
const PASSPHRASE_HASH = '53fac1b40bddfa94876e3b6929f70e318f00d889094506364b916c3cb3abc263';

// ---- 演出の長さ（KEI の微調整はこの3つ。CSS へも変数で渡すので、ここを直せば見た目も揃う） ----
// 2026-09-22 KEI「簡素に」: 枠の光の一周はやめ、枠は静かに消えるだけ。
// 2026-09-25 KEI: 縁の光と割れは廃止 → 「解けた」一拍 → ゲート全体がフェード → 奥から本。
const SWEEP_MS = 0;        // 0 = 縁を走る光を出さない
const RELEASE_MS = 500;    // 「解けた」一拍（枠の内側がふっと明るくなり、わずかに緩む）
const SPLIT_MS = 1200;     // ゲート全体（枠・文字・入力欄）がゆっくりフェードアウトする時間
const ERR_MS = 1500;       // 「合言葉が違います」を出しておく時間

function norm(s: string): string {
  let v = (s || '');
  try { v = v.normalize('NFKC'); } catch { /* 古い端末 */ }
  v = v.replace(/[\s　​-‍﻿]/g, '');           // 空白・全角空白・ゼロ幅を全部落とす
  v = v.replace(/[❓❔⁇‽﹖︖؟？]/g, '?');   // ❓❔⁇‽﹖︖؟？ → ?
  v = v.replace(/️/g, '');                                     // 絵文字の異体字セレクタ
  return v;
}
/** 全角「？」・半角「?」のどちらも正解（NFKC で寄せてから SHA-256 で照合） */
export async function matchPassphrase(input: string): Promise<boolean> {
  const v = norm(input);
  if (v === '') return false;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
    const hex = Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    return hex === PASSPHRASE_HASH;
  } catch (e) {
    // crypto.subtle は https（または localhost）でしか使えない。http のローカル確認などで落ちた時
    console.warn('[gate] crypto.subtle が使えないため照合できません（https で開いてください）', e);
    return false;
  }
}

/** この訪問で合言葉を出すか */
/** 発売モード（2026-09-25 KEI GO）: 未解錠なら毎回出す */
const GATE_DEFAULT = true;

export function gateNeeded(): boolean {
  const g = QP.get('gate');
  if (g === '1') return true;                               // 検証用（解錠済みでも出す）
  // ?gate=0 のスキップは発売で廃止（誰でも URL に付けられるため・2026-09-25）
  return GATE_DEFAULT && !isUnlocked();
}

export class Gate {
  private root: HTMLDivElement;
  private wrap!: HTMLDivElement;
  /** 入力欄は contenteditable の div（2026-09-30 KEI: <input> だと iOS が住所欄と推定して連絡先の自動入力候補を出すため） */
  private input!: HTMLDivElement;
  private err!: HTMLElement;
  private errTimer: ReturnType<typeof setTimeout> | null = null;
  private done = false;

  /** @param onOpen 枠が割れ終わった時に呼ぶ（本を出しはじめる合図） */
  constructor(private onOpen: () => void) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
<div id="gate">
  <div class="gwrap">
    <div class="gpane l"></div><div class="gpane r"></div>
    <svg class="gsweep" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="99" height="99" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="gin">
      <div class="gq">合言葉は？</div>
      <form id="gateForm" action="#" autocomplete="off">
      <div id="k7x" class="gfield" role="textbox" aria-label="合言葉" aria-multiline="false" tabindex="0" contenteditable="true" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" inputmode="text" enterkeyhint="go"></div>
      <div class="gerr" id="gateErr">合言葉が違います</div>
      <button class="gbtn" id="gateGo" type="submit">ひらく</button>
      </form>
    </div>
  </div>
</div>`;
    this.root = wrap.firstElementChild as HTMLDivElement;
    // 演出の長さは CSS にも渡す（定数はこのファイルだけが持つ）
    this.root.style.setProperty('--gsweep', SWEEP_MS + 'ms');
    this.root.style.setProperty('--gsplit', SPLIT_MS + 'ms');
    this.root.style.setProperty('--grelease', RELEASE_MS + 'ms');
    document.body.appendChild(this.root);
    const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    this.wrap = this.root.querySelector('.gwrap') as HTMLDivElement;
    this.input = $<HTMLDivElement>('k7x');
    this.err = $('gateErr');
    // 書式なしの編集（対応ブラウザだけ。未対応は "true" のまま・貼り付けは下で文字だけにする）
    try { this.input.contentEditable = 'plaintext-only'; } catch { /* 未対応 */ }
    if (this.input.contentEditable !== 'plaintext-only') this.input.contentEditable = 'true';
    // 改行を入れない（Enter は送信に使う・iOS の「go」も insertParagraph で来る）
    this.input.addEventListener('beforeinput', (e: InputEvent) => {
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') e.preventDefault();
    });
    // 貼り付けは文字だけ・1行に
    this.input.addEventListener('paste', (e: ClipboardEvent) => {
      e.preventDefault();
      const t = (e.clipboardData?.getData('text/plain') || '').replace(/[\r\n]+/g, ' ');
      if (t) document.execCommand('insertText', false, t);
    });
    // 全部消した時に残る <br> などを掃除（:empty の案内文・高さを保つ）。変換中は触らない
    this.input.addEventListener('input', (e: Event) => {
      if ((e as InputEvent).isComposing) return;
      if (this.input.textContent === '' && this.input.childNodes.length) this.input.textContent = '';
    });

    // iOS のキーボード「go」/ Enter は form の submit で受ける（IME の確定と二重にならない）
    $('gateForm').addEventListener('submit', (e: Event) => { e.preventDefault(); this.submit(); });
    // ボタンを押した瞬間に入力欄がぼやけてキーボードが閉じ、click が消える事故を防ぐ
    $('gateGo').addEventListener('pointerdown', (e: Event) => e.preventDefault());
    this.input.addEventListener('keydown', (e: KeyboardEvent) => {
      const composing = e.isComposing || (e as KeyboardEvent & { keyCode: number }).keyCode === 229;
      if (e.key === 'Enter' && !composing) { e.preventDefault(); this.submit(); }
      e.stopPropagation();                       // Enter/Space で本が開くのを止める
    });
    this.root.addEventListener('pointerdown', e => e.stopPropagation());
    this.root.addEventListener('pointerup', e => e.stopPropagation());
  }

  show(): void {
    requestAnimationFrame(() => {
      this.root.classList.add('show');
      try { this.input.focus({ preventScroll: true }); } catch { /* noop */ }
    });
  }

  private checking = false;                      // ハッシュ照合中の連打を無視
  private async submit(): Promise<void> {
    if (this.done || this.checking) return;
    this.checking = true;
    const ok = await matchPassphrase(this.input.textContent || '');
    this.checking = false;
    if (this.done) return;
    if (ok) { this.done = true; this.succeed(); }
    else this.fail();
  }

  private fail(): void {
    if (QP.get('dbg') === '1') {                 // ?gate=1&dbg=1: 入力の文字コードを表示（実機の調査用）
      const cps = Array.from(this.input.textContent || '').map(c => c.codePointAt(0)!.toString(16)).join(' ');
      this.err.textContent = '合言葉が違います [' + cps + ']';
    }
    this.input.textContent = '';
    this.wrap.classList.remove('shake');
    void this.wrap.offsetWidth;                  // アニメーションを巻き戻す
    this.wrap.classList.add('shake');
    this.err.classList.add('show');
    if (this.errTimer) clearTimeout(this.errTimer);
    this.errTimer = setTimeout(() => this.err.classList.remove('show'), ERR_MS);
  }

  private succeed(): void {
    this.err.classList.remove('show');
    this.input.blur();
    this.input.contentEditable = 'false';
    this.root.classList.add('ok');               // 「解けた」一拍（内側がふっと明るく・わずかに緩む）
    setTimeout(() => {
      this.root.classList.add('release');        // ゲート全体がゆっくりフェードアウト
      setTimeout(() => {
        this.root.classList.add('gone');
        this.onOpen();
      }, SPLIT_MS);
    }, SWEEP_MS + RELEASE_MS);
  }
}
