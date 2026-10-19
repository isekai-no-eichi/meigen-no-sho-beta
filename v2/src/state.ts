// ============================================================
// 保存データ。localStorage のキーと形は現行 app/ a/ と完全に同じ。
// 既存ユーザーのお気に入り（bookexp-favs）と栞（bookexp-bookmark）はそのまま引き継がれる。
//   bookexp-settings : 音の設定（v3..v6 のマイグレーションも現行どおり）
//   bookexp-favs     : number[]（実ページ番号）
//   bookexp-bookmark : { list:[{ deck:number[], index:number, ts:number, fav:boolean }] }（旧: 単体オブジェクトも読める）
//   bookexp-stats    : { visits, lastVisit, pagesTotal, favSaid }
//   bookexp-a2hs     : '1'（ホーム画面に追加のヒントを出したか）
// ============================================================

// 2026-10-19 試作版(beta): 本番と同じ github.io オリジンで localStorage を共有するため、キーを bookexp-beta-* に分ける
export const K = {
  settings: 'bookexp-beta-settings',
  favs: 'bookexp-beta-favs',
  bookmark: 'bookexp-beta-bookmark',
  stats: 'bookexp-beta-stats',
  a2hs: 'bookexp-beta-a2hs',
  unlocked: 'bookexp-beta-unlocked',
} as const;

export interface Settings {
  bgm: boolean; rain: boolean; insects: boolean; candle: boolean;
  amb: number; flip: number; flipOn: boolean; rainKind: string; bgmVol: number;
  sound?: boolean;
  v3?: number; v4?: number; v5?: number; v6?: number;
  [k: string]: unknown;
}

export const DEFAULTS: Settings = {
  bgm: true, rain: true, insects: false, candle: false,
  amb: 0.6, flip: 1.0, flipOn: true, rainKind: 'study', bgmVol: 0.5,
};

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return (v == null ? fallback : v) as T;
  } catch { return fallback; }
}
function writeJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* プライベートブラウズ等 */ }
}

// ---- 設定 ----
export const S: Settings = { ...DEFAULTS, ...readJSON<Partial<Settings>>(K.settings, {}) };
if (!S.v3) { S.rainKind = 'study'; S.bgmVol = 0.5; S.v3 = 1; }
if (!S.v4) { S.insects = false; S.candle = false; S.v4 = 1; }
S.rainKind = 'study';                                   // 環境音は1種類（KEI 2026-09-04）
if (!S.v5) { S.bgmVol = 0.5; S.amb = 0.5; S.flip = 0.5; S.v5 = 1; }
if (!S.v6) { S.sound = true; S.v6 = 1; }                // 音は ON/OFF ひとつだけ（v20）

export function saveSettings(): void { writeJSON(K.settings, S); }
/** 音 ON/OFF は bgm / rain / flipOn をまとめて動かす（現行と同じ） */
export function applySoundFlags(): void { S.bgm = S.rain = S.flipOn = !!S.sound; }
export function curve(x: number): number { return x <= 0 ? 0 : Math.pow(x / 0.5, 1.6); }

// ---- お気に入り ----
export function loadFavs(): number[] {
  const v = readJSON<number[]>(K.favs, []);
  return Array.isArray(v) ? v : [];
}
export function saveFavs(favs: number[]): void { writeJSON(K.favs, favs); }
export function favCount(): number { return loadFavs().length; }

// ---- 栞（2026-09-09 KEI: 何本でも挟める） ----
// 保存の形は { list: Bookmark[] }。キーは bookexp-bookmark のまま。
// 旧い形（単体の {deck,index,ts,fav}）で保存された端末も、そのまま1本の栞として読み込む。
export interface Bookmark { deck: number[]; index: number; ts: number; fav: boolean; seen?: number[] }

function isBookmark(x: unknown): x is Bookmark {
  const b = x as Bookmark | null;
  return !!(b && Array.isArray(b.deck) && b.deck.length && typeof b.index === 'number');
}
/** その栞が指している実ページ番号 */
export function bookmarkPage(b: Bookmark): number {
  return b.deck[Math.min(Math.max(b.index, 0), b.deck.length - 1)];
}
export function loadBookmarks(): Bookmark[] {
  const raw = readJSON<unknown>(K.bookmark, null);
  if (!raw) return [];
  const arr: unknown[] = Array.isArray(raw) ? raw
    : Array.isArray((raw as { list?: unknown }).list) ? (raw as { list: unknown[] }).list
    : [raw];
  return arr.filter(isBookmark);
}
export function saveBookmarks(list: Bookmark[]): void {
  if (!list.length) { clearBookmark(); return; }
  writeJSON(K.bookmark, { list });
}
/** 一番あとに挟んだ栞。「栞から読む」で開く時はこれを使う */
export function loadBookmark(): Bookmark | null {
  const l = loadBookmarks();
  if (!l.length) return null;
  return l.reduce((a, b) => ((b.ts || 0) >= (a.ts || 0) ? b : a));
}
export function bookmarkPages(): number[] { return loadBookmarks().map(bookmarkPage); }
/** 同じページの栞は1本だけ。挟み直すと最新になる */
export function saveBookmark(b: Bookmark): void {
  const p = bookmarkPage(b);
  const l = loadBookmarks().filter(x => bookmarkPage(x) !== p);
  l.push(b);
  saveBookmarks(l);
}
/** そのページの栞1本だけを外す（他の栞は残る） */
export function removeBookmarkPage(page: number): void {
  saveBookmarks(loadBookmarks().filter(x => bookmarkPage(x) !== page));
}
export function clearBookmark(): void { try { localStorage.removeItem(K.bookmark); } catch { /* noop */ } }
export function hasBookmark(): boolean { return loadBookmarks().length > 0; }
export function bookmarkCount(): number { return loadBookmarks().length; }

// ---- この端末の記録 ----
export interface Stats { visits: number; lastVisit: number; pagesTotal: number; favSaid: boolean }
export const ST: Stats = { visits: 0, lastVisit: 0, pagesTotal: 0, favSaid: false, ...readJSON<Partial<Stats>>(K.stats, {}) };
export function saveStats(): void { writeJSON(K.stats, ST); }

// ---- ホーム画面に追加のヒント ----
export function a2hsSeen(): boolean { try { return !!localStorage.getItem(K.a2hs); } catch { return true; } }
export function a2hsMark(): void { try { localStorage.setItem(K.a2hs, '1'); } catch { /* noop */ } }

// ---- 合言葉（初回だけのゲート・2026-09-21 KEI） ----
/** 一度でも合言葉を通したか。通したあとは今までどおり本が最初から出る */
// localStorage が読めない（throw）時は「解錠済み」と誤判定せず、ゲートを出す（2026-09-25 QA）
// 2026-10-02: 解錠の印は GATE_VERSION の値で保存する。合言葉（Gate.ts の PASSPHRASE_HASH）を変えたら
//   ここも新しい値にする → 旧い値（'1' や前の版）の端末は全部1回だけ再入力になる。他の bookexp-*（印・栞・設定）は不変。
//   Gate.ts が state.ts を import しているので、循環を避けてここに置く。
export const GATE_VERSION = '2026-10-02a';
export function isUnlocked(): boolean { try { return localStorage.getItem(K.unlocked) === GATE_VERSION; } catch { return false; } }
export function markUnlocked(): void { try { localStorage.setItem(K.unlocked, GATE_VERSION); } catch { /* noop */ } }
// ?reset=1: bookexp-unlocked だけ消してゲートを未解錠の初回に戻す（KEI が撮影のため合言葉の画面へ戻す・2026-09-30）。
//   他の bookexp-*（設定・お気に入り・栞・統計）には触らない。解錠を外す方向なので誰が付けても安全。
//   ここ（state.ts）で消すのは、BookScene 等がモジュール読込時に isUnlocked() を見るより先に効かせるため。
if (/(^|[?&])reset=1(&|$)/.test(location.search)) { try { localStorage.removeItem(K.unlocked); } catch { /* noop */ } }

// ---- 共通 ----
/** リポジトリ直下の assets/ を指す。base が /meigen-no-sho/app2/ なので ../assets/ で届く */
export function asset(path: string): string {
  return new URL('../assets/' + path, document.baseURI).href;
}
export const MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
export const QP = new URLSearchParams(location.search);
export const BUILD = '20260918v20';
/** 負荷対策 A/B/C/F/G（2026-10-05 KEI）。?perf=0 で全部旧動作に戻す（実機での比較用） */
export const PERF = QP.get('perf') !== '0';

// 2026-09-09 KEI: BUILD を上げても栞・印・枚数は消さない（更新のたびに読者の記録が飛ぶ不具合）。
// 記録するのは「どの版まで見たか」だけ。設定の形を変える時だけ、ここに移行処理を足す。
try {
  if (localStorage.getItem('bookexp-beta-build') !== BUILD) localStorage.setItem('bookexp-beta-build', BUILD);
} catch { /* noop */ }

// ---- 試作スイッチ（2026-10-19 beta・入口の3D演出と音）----
//   優先順: ?fx=0 → 全部 false ／ ?<k>=0|1 → 個別 ／ localStorage 'bookexp-beta-fx'（JSON）／ FX_DEFAULT
//   音係（audio/index.ts）も同じキー 'bookexp-beta-fx' を自前で読む。キー名と形（{env:true,...}）は変えない。
export type FxKey = 'env' | 'pbr' | 'smoke' | 'etch' | 'reverb' | 'tilt' | 'haptic' | 'cover';
// 2026-10-19 KEI「残響と柱時計はいらない」→ reverb 既定 false・パネルから外した（?reverb=1 の時だけ作る）
export const FX_DEFAULT: Record<FxKey, boolean> = { env: true, pbr: true, smoke: false, etch: false, reverb: false, tilt: true, haptic: true, cover: true };
// cover: 2026-10-19 KEI「⑤表紙が開いてから潜る」→ book_open.glb（CoverHinge/PageHinge＋クリップ CoverOpen/FirstPage）と別台本。?cover=0 で旧 book.glb・旧台本
export const FX_KEY = 'bookexp-beta-fx';
export function fxOn(k: FxKey): boolean {
  if (QP.get('fx') === '0') return false;
  const q = QP.get(k);
  if (q === '0') return false;
  if (q === '1') return true;
  if (k === 'reverb') return false;   // パネルから外したので、前に保存した「入」も無視する
  const saved = readJSON<Partial<Record<FxKey, boolean>>>(FX_KEY, {});
  if (saved && typeof saved[k] === 'boolean') return saved[k] as boolean;
  return FX_DEFAULT[k];
}
export function fxSet(k: FxKey, v: boolean): void {
  const saved = readJSON<Partial<Record<FxKey, boolean>>>(FX_KEY, {});
  writeJSON(FX_KEY, { ...(saved && typeof saved === 'object' ? saved : {}), [k]: v });
}
