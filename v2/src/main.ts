// ============================================================
// 名言の書 v2 — 状態機械
//   book（3D書斎・本） → opening（開く演出） → read（読書） → closing
// iframe は廃止し、読書は同一ページの全画面レイヤー（reader/Reader.ts）。
// ============================================================
import * as THREE from 'three';
import { BookScene, FLARE_GAIN, REVEAL_SEC } from './scene/BookScene';
import { Reader } from './reader/Reader';
import { Ui } from './ui/Ui';
import { Gate, gateNeeded } from './ui/Gate';
import {
  S, ST, saveStats, hasBookmark, favCount, MOBILE, QP, markUnlocked, PERF,
} from './state';
import {
  initAudioGlobalHooks, ensureAudio, toggleSound, onSoundChange, activity, flipDuck,
  bgmTick, bgmFadeOut, bgmWant, setAmbBoost, setReadingProbe, setFullscreenHook, setTiltGrantHandler,
  thudHeavy, openBookSound, blip, haptic, audioDebug,
} from './audio';
import { track } from './track';
import { initCounter } from './counter';
import { fsEnter, fsOn } from './fullscreen';

type Stage = 'book' | 'opening' | 'read' | 'closing';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const canvas = document.getElementById('c') as HTMLCanvasElement;
// 負荷対策（2026-10-05）。?perf=0 は旧動作（grain 200%・flameGlow あり・60fps・AA あり・読書中も #c/#grain を合成）
if (!PERF) document.documentElement.classList.add('perf0');
/** A: 読書中は不透明な読書画面の下にある 3D canvas と #grain を合成から外す（visibility なのでレイアウトは動かない） */
function hideUnder(on: boolean): void {
  if (!PERF) return;
  const v = on ? 'hidden' : '';
  canvas.style.visibility = v;
  const g = document.getElementById('grain'); if (g) g.style.visibility = v;
}

// ---- 画面に足す要素（HTML を小さく保つ） ----
// タイトルカード「名言の書」は開く時に出す（2026-09-13 KEI 復活。09-07 に消したが「あった方がいい」）。
const fade = document.createElement('div');
fade.id = 'fade';
document.body.appendChild(fade);
const flash = document.createElement('div');
flash.id = 'flash';
document.body.appendChild(flash);

// 新しい版が入ったら自動で読み直す（古い画面が端末に残り続けるのを防ぐ・2026-09-07 KEI「反映されてない」）
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
}

let stage: Stage = 'book';
function setStage(s: Stage): void {
  stage = s;
  document.body.classList.remove('stage-book', 'stage-opening', 'stage-read', 'stage-closing');
  document.body.classList.add('stage-' + s);
}
setReadingProbe(() => stage === 'read');

// ============================================================ この端末の記録
ST.visits++; ST.lastVisit = Date.now(); saveStats();
initCounter();          // 訪問数（合計1本・外部API・失敗しても何も起きない）
let pagesSession = 0, flipTimes: number[] = [], rushSeen = false;

// ============================================================ 字幕（本の声）
const talk = $('talk'), talkTxt = $('talkTxt');
let typing: ReturnType<typeof setInterval> | null = null;
let talkHide: ReturnType<typeof setTimeout> | null = null;
function say(line: string, hold = 3000): void {
  line = line.replace(/\n/g, '');
  if (typing) { clearInterval(typing); typing = null; }
  if (talkHide) { clearTimeout(talkHide); talkHide = null; }
  talk.classList.remove('slow');
  talk.classList.add('show');
  talkTxt.textContent = '';
  let i = 0;
  typing = setInterval(() => {
    talkTxt.textContent = line.slice(0, ++i);
    blip(i);
    if (i >= line.length) {
      clearInterval(typing!); typing = null;
      talkHide = setTimeout(() => { talk.classList.add('slow'); talk.classList.remove('show'); }, hold);
    }
  }, 55);
}

// ============================================================ 没入（モバイル）
// 2026-09-09 KEI「ボタンはいらない。開くたびに勝手に全画面に」。
// 一度きりの見張り（fsTried）を外し、触られるたびに要求する。すでに全画面なら fsEnter は何もしない。
setFullscreenHook(() => {
  fsEnter();
  try {
    const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (so && so.lock) { const p = so.lock('portrait'); if (p && p.catch) p.catch(() => {}); }
  } catch { /* noop */ }
});

// ============================================================ 3D
const scene = new BookScene(canvas);
const clock = new THREE.Clock();
let opening = false, openT = 0, diving = false, diveT = 0;
let closing: { phase: 'wait' | 'pull' | 'shut'; t: number } | null = null;
let dragging = false, lastX = 0, lastY = 0;

// ============================================================ 読書レイヤー
const reader = new Reader({
  onClose: () => closeBook(),
  onFlip: info => {
    activity(); flipDuck(); pagesSession++;
    ST.pagesTotal = (ST.pagesTotal || 0) + 1; saveStats();
    const now = performance.now();
    flipTimes.push(now);
    while (flipTimes.length && now - flipTimes[0] > 9000) flipTimes.shift();
    if (flipTimes.length >= 6) { rushSeen = true; flipTimes = []; }
    void info;
  },
  onFav: info => { activity(); track('seal', { on: info.on, count: info.count }); },
  // 2026-09-09 KEI: 栞を挟んでも外しても、本は閉じない（外した時に閉じるバグの元だった予約閉じを廃止）。
  // 次に開いた時は、一番あとに挟んだ栞のページから始まる。
  onBookmark: info => { activity(); scene.setRibbonVisible(hasBookmark()); track('bookmark', { off: info.off }); },
  onActivity: () => activity(),
  onFirstTouch: () => { bgmWant(); ensureAudio(); activity(); },
  onSoundToggle: () => { toggleSound(); activity(); },
});

// ============================================================ UI
const ui = new Ui({
  onOpen: (mode, title) => beginRead(mode, title),
  onToggleSound: () => toggleSound(),
  // 2026-09-30 KEI「『2回タップ〜』以外は画面に文字を出なくていい」: 本の画面の状況の文は出さない。
  // 戻す時は下の行を say(line, 2500) に（#talk の display:none も styles.css で外す）
  onSay: line => { void line; void say; },
  // 「しおりを外す」（2026-09-17 KEI）。3Dの本から紐を消し、次は栞なし＝シャッフルで開く
  onClearBookmark: () => { scene.refreshRibbon(); },
});
onSoundChange(on => { ui.paintSound(on); reader.paintSound(on); });

// 開いたあと、読書画面の最初の一触りでもう一度だけ全画面を要求する。
// （開いた瞬間の要求が断られた時の保険。1回の開きにつき1度きり）
let fsRetry = false;
addEventListener('pointerdown', () => {
  if (fsRetry || stage !== 'read' || fsOn()) return;
  fsRetry = true;
  fsEnter();
}, { capture: true });

// ============================================================ 開く演出（作品最大の一発）
// 台本（秒。openBookSound は 0.85s に鳴らし、その内部タイミング＝紙2枚 0/0.55、革の着地 1.30 に合わせる）
//   0.00 環境音がすっと引く／表紙の金箔に光が走る
//   0.15 表紙が5°持ち上がり、カメラが寄る
//   0.85 表紙が開きはじめる（openBookSound）。光が本の内側から溢れはじめる
//   1.45 ページの間へドリー（視野が歪む）
//   2.15 革が着地する重い音に合わせて光が最大
//   2.42 暗転せずに読書画面へマッチカット（同じ位置・同じ明るさの紙／背景は直前の3D画面）
// 2026-09-07 夜 KEI: 5秒は遅い→「表紙はパタッと気持ちよく、そこからスーッと潜る」。台本は OK 倍・表紙の開きは短く固定
const OK = 1.5;
const OPEN_LIFT = 0.09;              // 表紙が持ち上がる角度（rad ≈ 5°）
const OPEN_DUR = 0.95;               // 表紙が開ききるまで（パタッ）
const T_SOUND = 0.85 * OK, T_MOTES = 1.00 * OK, T_DIVE = 1.45 * OK, T_CUT = 2.42 * OK;
const T_SFX = T_SOUND + OPEN_DUR - 1.30;   // 革の着地音(呼び出し+1.30s)が表紙の着地と合う時刻
let openT0 = 0, lifting = false;

// 2026-09-17 KEI の起動演出:
//   「2回タップで、本を読む」→ タップで文字がフェードで消える（0.6秒）
//   → 約1秒の間（何も出ない）→「名言の書」がフェードで現れる → 本の中へ吸い込まれる
const PRELUDE = 1.55;                 // 文字が消える 0.6 ＋ 間 0.95

// 横向き（高さ 500px 未満）の入口では「縦にしてください」を出し、ボタンと2回タップを止める（2026-09-26 QA D13）。
// 縦に戻せば通常。読書画面はそのまま。
const LAND = matchMedia('(orientation: landscape) and (max-height: 499px)');
const syncLand = () => document.body.classList.toggle('land-block', LAND.matches);
try { LAND.addEventListener('change', syncLand); } catch { LAND.addListener(syncLand); }
syncLand();

function beginRead(mode: string, title?: string): void {
  if (stage !== 'book') return;
  if (gateUp) return;                 // 合言葉が済むまでは、どの経路からも開かない（2026-09-22）
  if (LAND.matches) return;           // 横向きの入口からは開かない（2026-09-26 QA）
  // 2026-09-09 KEI: 開くたびに自動で全画面。ダブルタップ／「しおりから読む」「お気に入りを読む」／
  // Enter・Space のどれもこの関数へ直に来るので、ここが「利用者の操作の中」。
  // **await や setTimeout より前**に呼ばないとブラウザに断られる。
  fsEnter();
  fsRetry = false;
  setStage('opening');
  ui.setLocked(true);                 // ここで一文と入口ボタンがフェードで消える
  ensureAudio();
  talk.classList.remove('show');
  activity(); pagesSession = 0; flipTimes = []; rushSeen = false;
  track('open_book', { mode });
  // 文字が消え、1秒ほど何もない「間」をおいてから、題名と開く演出を始める
  setTimeout(() => startOpening(mode, title), PRELUDE * 1000);
}

function startOpening(mode: string, title?: string): void {
  if (stage !== 'opening') return;
  const rt = $('readTitle');
  rt.querySelector('.main')!.textContent = title || '名言の書';
  rt.classList.add('show');
  setTimeout(() => rt.classList.remove('show'), 2800);

  openT0 = performance.now(); lifting = true;
  setAmbBoost(0.34);                                        // 環境音がすっと引く
  const at = (sec: number, fn: () => void) => setTimeout(fn, sec * 1000);

  at(T_SOUND, () => { opening = true; haptic(8); });
  at(T_SFX, () => openBookSound());
  at(T_MOTES, () => scene.motesStart());
  at(T_DIVE, () => { diving = true; });
  at(2.10 * OK, () => haptic(16));                               // 革が着地する直前
  // 2026-09-07 夜 KEI: 光で切り替えず、ページの間へ潜ったら真っ暗になる。そこからろうそくが灯り、紙が浮かんでくる
  at(2.12 * OK, () => { fade.style.transition = 'opacity .4s ease-in'; fade.style.opacity = '1'; });
  // 2026-09-07 KEI: 読書の背景は3Dスクショでなく書斎の絵(hall-bg.jpg)に戻す。スクショは撮らない
  at(T_CUT, () => {
    setStage('read');
    $('bgDim').style.opacity = '1';
    reader.open(mode, { matchCut: true, dawn: true });
    setTimeout(() => { fade.style.transition = 'opacity .6s ease-out'; fade.style.opacity = '0'; }, 350);
    setTimeout(() => {
      scene.motesStop(); scene.resetOpenFX();
      setAmbBoost(1);                                         // 引いた環境音を読書の部屋の音として戻す
      opening = false; diving = false; lifting = false; openT = 0; diveT = 0;
      if (scene.hinge) scene.hinge.rotation.z = 0;
    }, 600);
    // A: 読書画面（matchcut .45s）と暗転の解け（350ms+.6s）が終わってから隠す
    setTimeout(() => { if (stage === 'read') hideUnder(true); }, 1000);
  });
}

/** 開く演出の連続量（光・箔の走り・表紙の持ち上げ・寄り）。毎フレーム呼ぶ */
/** 本の内側から溢れる光の強さ。2026-09-08 KEI「眩しすぎていらない」→ 0（戻す時は FLARE_GAIN）*/
const OPEN_FLARE = 0;
function openEnvelope(): { r: number; ph: number } | null {
  if (stage !== 'opening' && stage !== 'read') return null;
  if (!lifting) return null;
  const ot = (performance.now() - openT0) / 1000;
  // 表紙の金箔に光が走る（0.00 → 0.85）
  scene.gild = Math.max(0, Math.min(1, (ot - 0.02) / (0.83 * OK)));
  // 光が本の内側から溢れる。2.15 の着地で最大、そのあとすっと引く
  let f = 0;
  if (ot > T_SOUND) f = Math.min(1, (ot - T_SOUND) / (0.70 * OK));
  if (ot > 2.20 * OK) f = Math.max(0.35, 1 - (ot - 2.20 * OK) / (0.55 * OK));
  scene.openFlare = f * OPEN_FLARE;   // 2026-09-08 KEI: 開く時の光は眩しすぎる→無し（光の粒だけ残す）
  // 表紙が5°持ち上がる（0.15 → 0.80）。開きはじめたら hinge は下のループに任せる
  if (!opening && scene.hinge) {
    const k = Math.max(0, Math.min(1, (ot - 0.15 * OK) / (0.65 * OK)));
    scene.hinge.rotation.z = OPEN_LIFT * (k * k * (3 - 2 * k));
  }
  // カメラが寄る（1.55 → 1.30）。潜り込みが始まったら dive 側が持つ
  if (ot < T_DIVE) {
    const k = Math.max(0, Math.min(1, (ot - 0.15 * OK) / (1.20 * OK)));
    return { r: BookScene.CAM_R - 0.26 * (k * k * (3 - 2 * k)), ph: scene.camPhi };
  }
  return null;
}

// 本を閉じる儀式（約3秒）
function closeBook(): void {
  if (closing || stage !== 'read') return;
  track('close_book', { pages: pagesSession });
  setStage('closing');
  hideUnder(false);                 // A: 読書画面がまだ全面を覆っている間に戻す（3D は closing から描き始める）
  closing = { phase: 'wait', t: 0 };
  reader.closeRitual();
  bgmFadeOut(1300);
  setAmbBoost(0.85);
  fade.style.transition = 'opacity .5s ease-in';
  setTimeout(() => { fade.style.opacity = '1'; }, 900);
  setTimeout(() => {
    reader.hide();
    $('bgDim').style.opacity = '0';
    scene.bookTarget = 1;
    if (scene.hinge) scene.hinge.rotation.z = 2.5;
    closing = { phase: 'pull', t: 0 };
    fade.style.transition = 'opacity .7s ease-out'; fade.style.opacity = '0';
  }, 1450);
}
function closeBookDone(): void {
  closing = null;
  if (scene.hinge) scene.hinge.rotation.z = 0;
  setStage('book');
  thudHeavy(); haptic(18); scene.shake = 1;
  scene.burstDust();
  setAmbBoost(1);
  scene.refreshRibbon();
  scene.buildFavMarks();
  ui.setLocked(false);
  ui.start();                       // 戻ってきたら、また5秒後に一文
}

// ============================================================ 本の画面の入力（回転 / タップ）
let downAt = 0, downX = 0, downY = 0, moved = false;
canvas.addEventListener('pointerdown', e => {
  if (stage !== 'book' || gateUp) return;
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  downAt = performance.now(); downX = e.clientX; downY = e.clientY; moved = false;
});
addEventListener('pointermove', e => {
  if (!dragging) return;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) moved = true;
  scene.camTheta -= (e.clientX - lastX) * 0.006;
  scene.camPhi = Math.max(0.4, Math.min(2.2, scene.camPhi - (e.clientY - lastY) * 0.004));
  lastX = e.clientX; lastY = e.clientY;
});
addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  if (!moved && performance.now() - downAt < 300 && stage === 'book' && !gateUp && !LAND.matches) ui.tap();
});

// ============================================================ 端末の傾き
function listenTilt(): void {
  addEventListener('deviceorientation', ev => {
    if (ev.gamma == null || ev.beta == null) return;
    scene.tiltRaw.x = Math.max(-1, Math.min(1, ev.gamma / 35));
    scene.tiltRaw.y = Math.max(-1, Math.min(1, (ev.beta - 45) / 35));
  }, { passive: true });
  reader.listenTilt();
}
// PC は mousemove で代替（光の向きが視線に付いてくる）
if (!MOBILE) {
  addEventListener('mousemove', e => {
    scene.tiltRaw.x = Math.max(-1, Math.min(1, (e.clientX / innerWidth - 0.5) * 2));
    scene.tiltRaw.y = Math.max(-1, Math.min(1, (e.clientY / innerHeight - 0.5) * 2));
  }, { passive: true });
  reader.listenMouse();
}
setTiltGrantHandler(listenTilt);
try {
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
  if (!(DOE && typeof DOE.requestPermission === 'function')) listenTilt();
} catch { /* noop */ }

// ============================================================ ループ
addEventListener('resize', () => scene.resize());
scene.resize();
initAudioGlobalHooks();

// 初回だけの合言葉ゲート（2026-09-21 KEI）。
//   本は出さず（scale 0・塵と灯りはそのまま）、合言葉が合ったら枠が消えて本が奥から現れる。
//   2回目以降（bookexp-unlocked あり）は今までどおり、いきなり本が出る。
// 2026-09-22 KEI【バグ修正】合言葉を打たずに連打すると開くことがあった。
//   原因は本(GLB)の読み込み待ちのすき間。scene.load のコールバックで初めて錠を下ろしていたため、
//   読み込み中の数百ms〜数秒は錠なし＝2回タップがそのまま通っていた。
//   → 錠（ui.setLocked）と合言葉の画面は **読み込みを待たず、ここで先に** 出す。
//     さらに gateUp を「本を開く」全経路（beginRead・canvas のタップ）の入口で見る。
const GATE = gateNeeded();
const REVEAL_MS = REVEAL_SEC * 1000;  // 出現の長さは BookScene の REVEAL_SEC が正（そこを直せば両方動く）
// 合言葉を出している間と出現中は、自転も「本を開く」操作も止める
let gateUp = GATE;

if (GATE) {
  scene.hideBook();
  scene.keepAmbience = true;
  ui.setLocked(true);                      // 読み込みを待たずに錠を下ろす（連打で開く穴を塞ぐ）
  const gate = new Gate(() => {
    scene.revealStart();
    reader.prime();                        // 出現の約10秒で最初の3枚を先読み（遅い回線でも読書画面が真っ暗にならない・2026-09-26 QA）
    setTimeout(() => {
      scene.keepAmbience = false;          // 本が出そろってから、ふだんの描画条件に戻す
      gateUp = false;                      // ここから自転も、本を開く操作も再開
      markUnlocked();
      ui.setLocked(false);
      ui.start();                          // ここから通常運転（2秒後に「2回タップで、本を読む」）
    }, REVEAL_MS);
  });
  gate.show();
}

scene.load(() => {
  scene.resize();
  if (GATE) { scene.hideBook(); return; }  // 読み込み完了時にも本を消し直す（load が scale 1 にするため）
  ui.start();
});

// F: 部屋の3Dは常に 30fps（2026-10-05 KEI）。動きは時間基準なので速さは同じ。読書のめくり canvas は別ループで全速のまま
const FRAME_MIN = 1000 / 30 - 3;
let lastDraw = -1e9;
scene.renderer.setAnimationLoop((now: number) => {
  if (PERF && !(stage === 'read' && !diving)) {
    if (now - lastDraw < FRAME_MIN) return;
    lastDraw = now;
  }
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.05), wdt = Math.min(raw, 0.5), t = clock.elapsedTime;
  bgmTick(wdt);
  if (stage === 'read' && !diving) return;       // 読書中は3Dを描かない（電池）

  if (opening && scene.hinge) {
    openT = Math.min(openT + wdt / OPEN_DUR, 1);
    const k = openT * openT * (3 - 2 * openT);
    scene.hinge.rotation.z = OPEN_LIFT + (2.5 - OPEN_LIFT) * k;
  }
  if (diving) diveT += wdt;

  // 本を閉じる儀式: 本から抜ける(1.0s) → 表紙が重く閉じる(0.85s) → ドスッ
  let closeCam: { r: number; ph: number; near?: number } | null = openEnvelope();
  if (closing && scene.hinge) {
    closing.t += wdt;
    if (closing.phase === 'pull') {
      const k = Math.min(closing.t / 1.0, 1), e2 = 1 - Math.pow(1 - k, 3);
      // near: 抜け始めは本の縮尺（BOOK_SIZE）に合わせて寄せ、抜け切ったら通常の距離へ（2026-09-30 本90%）
      closeCam = { r: 0.19 + (BookScene.CAM_R - 0.19) * e2, ph: 0.12 + (scene.camPhi - 0.12) * e2, near: 1 - e2 };
      scene.hinge.rotation.z = 2.5;
      if (k >= 1) closing = { phase: 'shut', t: 0 };
    } else if (closing.phase === 'shut') {
      const k = Math.min(closing.t / 0.85, 1), e2 = k * k * k;
      scene.hinge.rotation.z = 2.5 * (1 - e2);
      if (k >= 1) closeBookDone();
    }
  }

  scene.update({
    dt, wdt, t, raw,
    dragging, opening, diving, diveT,
    autoSpin: !dragging && !opening && !diving && !gateUp && stage === 'book',
    camOverride: closeCam,
  });
});

// ============================================================ デバッグ
window.__app = {
  get stage() { return stage; },
  get audio() { return audioDebug(); },
  get reader() { return reader.debug(); },
  get info() { return { favs: favCount(), bookmark: hasBookmark(), visits: ST.visits, mobile: MOBILE, sound: S.sound, q: QP.toString() }; },
  beginRead, closeBook,
  setCam(th: number, ph: number) { scene.camTheta = th; scene.camPhi = ph; },
  ui, scene,
};
