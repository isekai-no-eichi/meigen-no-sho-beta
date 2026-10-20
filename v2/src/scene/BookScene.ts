// ============================================================
// 3D書斎と本。app/index.html v42 の描画設定をそのまま移植。
//   Bloom / Bokeh(PCのみ) / GradeShader / ろうそく明滅3正弦 / 自動軽量化 auto-lite
//   栞の紐・印の金の印・塵・吸い込みの光の粒・端末の傾き
// ★拡張ポイント:
//   - 部屋の3D化      → RoomBackground を差し替える
//   - 開く演出の豪華化 → openProgress()/setOpening() と main.ts の beginRead 台本
//   - 紙の物質感      → applyLeather() と reader/Reader.ts の drawInner()
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { asset, MOBILE, QP, BUILD, PERF, loadFavs, hasBookmark, isUnlocked, fxOn } from '../state';
import { SmokeShader, EtchShader, applySurfaceEtch, type SurfaceEtchUniforms } from './BetaFx';
import { RoomBackground } from './RoomBackground';
import { MOTES, MOTES_COUNT_K, MOTES_SPEED, MOTES_WIND_X, equipSprites, Fireflies, equipGlow, GraceMotes, GLOW_U } from './Motes';
import { DiveBlurShader, diveBlurAmt } from './DiveBlur';
/** beta 2026-10-19: 傾きで灯りがゆっくり滑る（スイッチ tilt）。切なら従来の傾き追従だけ */
const TILT_FX = fxOn('tilt');

/** 表紙の箔押しタイトル「名言の書」。2026-09-08 KEI「チャチい」→ 無し。戻す時は true */
const TITLE_DECAL = false;
const QUALITY = !QP.has('classic');
const CAM_R = 1.55;
/** ?icon=1 … ホーム画面アイコン撮影用。本を直立させて正面から撮る（自転・部屋・栞・塵なし）。
 *  通常の閲覧には一切影響しない。角度は ?irx / ?iry / ?ith / ?iph / ?ir で微調整できる。 */
const ICON = QP.has('icon') && isUnlocked();   // 撮影モードは解錠済みの時だけ（2026-09-25 QA）
const qn = (k: string, d: number): number => (QP.has(k) ? Number(QP.get(k)) : d);
/** 撮影パラメータ。window.__icon で毎フレーム上書きできる（探索を速くするため。通常運転では未使用） */
const iq = (k: string, d: number): number => {
  const w = (window as unknown as { __icon?: Record<string, number> }).__icon;
  if (w && typeof w[k] === 'number') return w[k];
  return qn(k, d);
};
/**
 * 3Dの本の大きさ（2026-09-30 KEI「今若干大きすぎる」→ 90%）。pivot ごと縮める（栞・印・机の影も一緒）。
 * 縦画面の背景の「引き」（RoomBackground・aspect<0.72）はカメラ側なので触らない。
 * 潜り（dive）の終わりと、閉じる時の抜け始めは、カメラも本の中心へ同じ比率で寄せて
 * 読書画面とのマッチカットの見え方を 100% の時と同じに保つ（similarity: 本も視点も同じ比率なら像は同じ）。
 * ?bs=1 で旧サイズ。アイコン撮影（?icon=1）は対象外。
 */
const BOOK_SIZE = ICON ? 1 : qn('bs', 0.9);
const CANDLE_I = QUALITY ? 1.55 : 1.3;   // 2026-09-09 KEI: 右下の光が強い→半減
const DIVE_DUR = 1.6;                     // ページの間へ潜る時間（秒）
/** 開く演出の光の強さの係数。2026-09-07 KEI: 光が強すぎる→半分 */
export const FLARE_GAIN = 0.5;
/** ブルームの基準強度。2026-09-09 KEI: 開く時の右下のキラキラを半減 */
const BLOOM_BASE = MOBILE ? 0.24 : 0.30;

// ---- 試作スイッチ（2026-10-19 beta・state.ts fxOn）。OFF の時は従来と同じ値・同じ処理 ----
/** env: 環境マップを Poly Haven fireplace_1k.hdr に。映り込みが暖炉の色になる分、強さは ×0.6 */
const FX_ENV = fxOn('env');
const ENV_K = FX_ENV ? qn('envk', 0.6) : 1;   // 0.8 では表紙と小口が橙に光りすぎた（2026-10-19 撮影で比較）→ 0.6。?envk= で試せる
/** pbr: 表紙に革目（ambientCG Leather037）を重ねた法線・roughness、小口に紙の重なりの法線 */
const FX_PBR = fxOn('pbr');
/** smoke: 背景の机のろうそくから細い煙（既定 OFF） */
const FX_SMOKE = fxOn('smoke');
/** etch: 3Dの画面を銅版画風に（ハッチング＋輪郭・既定 OFF） */
const FX_ETCH = fxOn('etch');
/** dive: 潜る時の放射ぼかし（2026-10-20・DiveBlur.ts） */
const FX_DIVE = fxOn('dive');
/** cover: 表紙が本当に開く本（book_open.glb・CoverHinge/PageHinge＋クリップ CoverOpen 2.0s/FirstPage 1.6s）。2026-10-19 KEI「⑤表紙が開いてから潜る」 */
export const FX_COVER = fxOn('cover');
/** cover: 見返し・1枚目・紙の束の上面を羊皮紙に（Blender の M_Endpaper/M_PageTop は表紙内側の橙で明るすぎた） */
const PARCH_COLOR = 0xcdbf9c;
/** cover（K）: 古書の紙の色の掛け算。ろうそく・暖炉の光とグレードで橙に寄るので、緑青を持ち上げて打ち消す（?ptint=） */
const PARCH_TINT = [0.75, 0.95, 1.25];
/** cover（2026-10-20 本の質感）: 表紙が開く間（開く角度に比例）、カメラを横へ平行移動して「開いた本の外形の中心」を画面の中心へ寄せる。
 *  開いた表紙は本の左へ大きく張り出すので、自転の角度によっては縦画面の端で切れていた（J の宿題）。回り込み（camTheta）は変えない。
 *  幅が縦画面に収まらない時だけ少し後ろへ引く。潜りの間に 0 へ戻す（潜る先は従来どおり）。?cframe=0 で寄せない・?cframe=0.5 で半分 */
const COVER_FRAME = qn('cframe', 1.0);
const _frameBB = new THREE.Box3();
const _frameC = new THREE.Vector3();
const _frameR = new THREE.Vector3();
/** cover（2026-10-20）: 1枚目をめくる時の反り（glb のシェイプキー Curl）の強さ。?curl=0 で板に戻る */
const PAGE_CURL = qn('curl', 0.9);
/** 煙の立つ位置＝背景の絵（app-bg.jpg 941x1672）の机のろうそくの炎。絵の中心を 0 とした比率 */
const SMOKE_AT = { x: 268 / 470 - 0.5, y: 0.5 - 308 / 835 };

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 }, uVig: { value: 0.30 }, uGrain: { value: 0.018 }, uCA: { value: 0.0012 }, uWarm: { value: 1.0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uCA, uWarm; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv; vec2 d = uv - 0.5; float r2 = dot(d, d);
      vec2 off = d * uCA * r2 * 8.0;
      vec4 c; c.r = texture2D(tDiffuse, uv + off).r; c.g = texture2D(tDiffuse, uv).g; c.b = texture2D(tDiffuse, uv - off).b; c.a = texture2D(tDiffuse, uv).a;
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.95, 0.96, 1.04), lightTint = vec3(1.03, 1.0, 0.96);
      c.rgb *= mix(shadowTint, lightTint, smoothstep(0.05, 0.75, l));
      c.rgb = mix(vec3(l), c.rgb, 1.04);
      c.rgb = pow(max(c.rgb, 0.0), vec3(1.0 / uWarm));
      float vig = 1.0 - uVig * smoothstep(0.15, 0.95, r2 * 2.2);
      c.rgb *= vig;
      float g = (hash(uv * vec2(1920.0, 1080.0) + fract(uTime)) - 0.5) * uGrain;
      c.rgb += g * (0.35 + 0.65 * (1.0 - l));
      gl_FragColor = c;
    }`,
};

// ============================================================
// 合言葉のあとの本の出現（2026-09-21 KEI「全体的にゆっくり・豪華に」）
//   ★KEI が「もっと遅く／速く」と言った時に触るのはこのブロックだけ。
// ============================================================
/** 本が現れきるまで（秒）。main.ts の ui.start() もこの値に合わせて動く */
export const REVEAL_SEC = 8.0;   // 2026-09-24 KEI「もっとゆっくり・光と一緒に」3.2→8.0（約2.5倍）
/** 回りながら正面を向く角度（Y軸 +30°→0） */
const REVEAL_YAW = 30 * Math.PI / 180;
/** 奥から手前へ来る距離。カメラから見て、この分だけ奥に置いた状態から寄ってくる */
const REVEAL_DEPTH = 0.9;
/** 姿勢の傾き戻し（2026-09-22 KEI「簡素に」→ 0＝使わない） */
const REVEAL_ROLL = 0;
/** 2026-09-22 KEI「簡素に」: 光の粒とブルームの持ち上げはやめた。
 *  戻したい時は FX_ON / GLOW_ON を true にすれば、下のコードがそのまま動く。 */
const FX_ON = true, GLOW_ON = true;   // 2026-09-24 KEI 復活（光と一緒に浮かび上がる）
/** 光の粒: 1波目（本の中心から放射）／2波目（ゆっくり昇る塵）の出る時刻と寿命（秒） */
const FX_WAVE1 = 1.0, FX_WAVE2 = 4.0, FX_LIFE = 6.0;   // 出現8秒に合わせて2.5倍寄せ（旧 0.4/1.6/4.5）
/** 粒の総数（大粒と小粒に分けて撒く） */
const FX_N = MOTES === 'c' ? 0 : Math.round((MOBILE ? 160 : 260) * MOTES_COUNT_K);   // beta: スプライト化で 6.5 割・c は撒かない
/** 出現しきる少し前から、金の淡い発光をブルームに足す（+30%）。戻すのに2秒 */
const GLOW_LEAD = 2.0, GLOW_GAIN = 0.30, GLOW_FALL = 3.0;   // ゆっくり持ち上げ・上品に+30%のまま（旧 0.8/0.30/2.0）
/** 滑らかなS字（smootherstep）。最初はごく小さく静かに、中盤でふわっと大きくなる */
function smootherstep(k: number): number { return k * k * k * (k * (6 * k - 15) + 10); }

/** 光の粒のひとかたまり（大粒・小粒 × 1波目・2波目の4つ） */
interface Burst {
  pts: THREE.Points; geo: THREE.BufferGeometry;
  pos: Float32Array; vel: Float32Array; n: number;
  at: number;      // revealStart から何秒後に撒くか
  rise: boolean;   // true = ゆっくり昇る塵
  t: number;       // 経過（-1 = 出ていない）
}

/** 本が自分の影を受けるか。2026-09-22 KEI: 表紙を走る縞の影が邪魔 → false（机の接地影は残る） */
const BOOK_SELF_SHADOW = false;

const RIB_YAW = -0.06;   // 栞タブの向き（本の上端＝奥端から覗く。2026-09-07 夜 KEI「本の上に挟む」）

/** cover: 平面の UV を張り直す。一番薄い軸を法線、残り2軸の長い方を縦（v）として四隅 0..1。
 *  1200x1600 の絵が横に伸びないよう、面の縦横比に合わせて絵の上下を少し切る（cover 寄せ） */
function planarUV(g: THREE.BufferGeometry, flipV: boolean): void {
  g.computeBoundingBox();
  const bb = g.boundingBox!, size = bb.getSize(new THREE.Vector3());
  const s = [size.x, size.y, size.z];
  const nAx = s.indexOf(Math.min(...s));
  const rest = [0, 1, 2].filter(i => i !== nAx);
  const vAx = s[rest[0]] >= s[rest[1]] ? rest[0] : rest[1];
  const uAx = rest[0] === vAx ? rest[1] : rest[0];
  const mn = [bb.min.x, bb.min.y, bb.min.z];
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  // 絵（3:4）を面に cover で合わせる：面が絵より横長なら、絵の縦を (絵の比/面の比) だけ使う
  const aFace = s[uAx] / Math.max(1e-6, s[vAx]), aImg = 1200 / 1600;
  const vSpan = aFace > aImg ? aImg / aFace : 1, uSpan = aFace > aImg ? 1 : aFace / aImg;
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    let u = (p[uAx] - mn[uAx]) / Math.max(1e-6, s[uAx]);
    let v = (p[vAx] - mn[vAx]) / Math.max(1e-6, s[vAx]);
    if (flipV) v = 1 - v;
    u = 0.5 + (u - 0.5) * uSpan; v = 0.5 + (v - 0.5) * vSpan;
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
/** cover: 三角形を「up を向く面」（group 0）とそれ以外（group 1）に並べ替える。nm はジオメトリ→本の空間の法線行列 */
function splitByFacing(g: THREE.BufferGeometry, nm: THREE.Matrix3, up: THREE.Vector3): void {
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const n = idx ? idx.count : pos.count;
  const get = (k: number): number => (idx ? idx.getX(k) : k);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3();
  const front: number[] = [], rest: number[] = [];
  for (let t = 0; t < n; t += 3) {
    const i0 = get(t), i1 = get(t + 1), i2 = get(t + 2);
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    f.subVectors(c, b).cross(a.sub(b)).applyMatrix3(nm).normalize();
    (f.dot(up) > 0.7 ? front : rest).push(i0, i1, i2);
  }
  // 1枚目は厚みの無い面なので、表の三角形を裏向きに複製して group 2（素の紙・片面）に。表の絵は片面にして、めくって立った時に鏡文字が透けないように
  const back: number[] = [];
  for (let t = 0; t < front.length; t += 3) back.push(front[t], front[t + 2], front[t + 1]);
  g.setIndex([...front, ...rest, ...back]);
  g.clearGroups();
  g.addGroup(0, front.length, 0);
  g.addGroup(front.length, rest.length, 1);
  g.addGroup(front.length + rest.length, back.length, 2);
}

export class BookScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10);
  readonly room = new RoomBackground();

  book: THREE.Object3D | null = null;
  hinge: THREE.Object3D | null = null;
  /** cover: 1枚目の蝶番（PageHinge）とクリップ。旧 book.glb では null */
  pageHinge: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private coverAct: THREE.AnimationAction | null = null;
  private pageAct: THREE.AnimationAction | null = null;
  /** cover（2026-10-20）: シェイプキーを持つメッシュ。1枚目（Curl＝めくる時の反り）・背（Open＝表紙が開くと綴じ目の頂が沈む） */
  private firstMesh: THREE.Mesh | null = null;
  private spineMesh: THREE.Mesh | null = null;
  /** cover: 開き切った角度（rad）。閉じる時に手で戻す起点 */
  coverMax = 2.5; pageMax = 0;
  /** cover: クリップの長さ（秒）。main.ts の台本が使う */
  coverSec = 0; pageSec = 0;
  bookBB: THREE.Box3 | null = null;
  private pivot = new THREE.Group();
  private ribbon: THREE.Mesh | null = null;
  private favMarks: THREE.Group | null = null;
  private stageGroup: THREE.Group | null = null;

  private candleB: THREE.PointLight;
  private fireB: THREE.PointLight;
  private dust: THREE.Points;
  private dustGeo = new THREE.BufferGeometry();
  private dspd: number[] = [];
  private ND = MOBILE ? 120 : 220;

  private titleDecal: THREE.Mesh | null = null;
  private titleSweep: THREE.Mesh | null = null;
  private sweepTex: THREE.CanvasTexture | null = null;
  private flareA: THREE.PointLight;             // 表紙の内側から溢れる光
  private flareB: THREE.PointLight;             // ページの谷から立つ光
  private rimB: THREE.DirectionalLight;
  private rimHome = new THREE.Vector3(-0.8, 0.9, -0.6);
  private capture: ((url: string) => void) | null = null;
  private iconKey: THREE.DirectionalLight | null = null;
  /** 開く演出の光量 0..1（main.ts の台本が毎フレーム入れる） */
  openFlare = 0;
  /** 表紙の箔に光が走る 0..1 */
  gild = 0;

  /** 影マップを更新した最後の時刻（秒）。15Hz に間引く */
  private shadowT = 0;

  private motes: THREE.Points;
  private mGeo = new THREE.BufferGeometry();
  private mPos: Float32Array; private mVel: Float32Array; private mLife: Float32Array;
  private MN = Math.round((MOBILE ? 280 : 480) * MOTES_COUNT_K);
  private flies: Fireflies | null = null;       // ?motes=c のほたる
  private grace: GraceMotes | null = null;      // ?motes=d の漂う光
  private graceBoxT = 0;
  private tiltSlow = { x: 0, y: 0 };            // beta: 傾きを時間でなました値（TILT_FX）
  private motesOn = false; private moteT = 0;

  // ---- 合言葉のあとの本の出現（2026-09-21 KEI） ----
  /** 本が消えている間も部屋・ろうそく・塵は描く（合言葉の画面） */
  keepAmbience = false;
  private revealT = -1;                         // -1 = 出現演出をしていない
  private bursts: Burst[] = [];                 // 光の粒（大小×2波・FX_ON の時だけ）
  private glowT = -1;                           // ブルームを持ち上げている間の経過
  /** 出現中、カメラの視線方向へ退いている距離（0 = 通常位置） */
  private revealBack = 0;

  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private bokehPass: BokehPass | null = null;
  private gradePass: ShaderPass | null = null;
  private etchPass: ShaderPass | null = null;
  private divePass: ShaderPass | null = null; private divePrimed = false;
  private etchMats: { u: SurfaceEtchUniforms; mesh: THREE.Mesh }[] = [];
  private smoke: THREE.Mesh | null = null;
  private perfN = 0; private perfT = 0; private perfDone = false;

  camTheta = 0.35; camPhi = 1.02;
  bookScale = 0; bookTarget = 0;
  shake = 0;
  readonly tiltRaw = { x: 0, y: 0 };
  private tiltCur = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement) {
    // B: ポスト処理を使う時は 3D が MSAA なしの RT に描かれ、画面の AA は効かない＝帯域だけ食う → off。
    //    composer を作らない経路（?classic / q_post=0）だけ従来どおり AA あり。?perf=0 は常に AA あり
    const usesComposer = QUALITY && QP.get('q_post') !== '0';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !(PERF && usesComposer), alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72;
    this.renderer.autoClear = false;
    if (QUALITY) {
      this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true;   // 2026-09-09 軽量化: 影の更新は 15Hz
    }

    this.scene.add(this.camera);
    this.scene.add(new THREE.AmbientLight(0x2a2018, QUALITY ? 0.75 : 1.0));
    this.candleB = new THREE.PointLight(0xffc98f, CANDLE_I, 2.5, 2.0);
    this.candleB.position.set(0.28, 0.34, 0.30);
    this.scene.add(this.candleB);
    this.rimB = new THREE.DirectionalLight(QUALITY ? 0x6f80b8 : 0x7a86a8, QUALITY ? 0.55 : 0.9);
    this.rimB.position.copy(this.rimHome); this.scene.add(this.rimB);
    this.fireB = new THREE.PointLight(0xff6a22, QUALITY ? 0.9 : 0, 4.0, 2.0);
    this.fireB.position.set(-1.25, -0.05, 0.45); this.scene.add(this.fireB);
    // 開く瞬間の光は「本の内側」から出す。書斎の右下（ろうそく側）を強くすると
    // 画面右下が白く飛んで文字が読めなくなる（2026-09-07 KEI 指摘）ので、
    // ろうそくは逆に一瞬だけ落とし、光源は本の中に置く。
    this.flareA = new THREE.PointLight(0xffd9a4, 0, 1.15, 2.4);
    this.flareA.position.set(-0.06, 0.085, 0.0); this.scene.add(this.flareA);
    this.flareB = new THREE.PointLight(0xfff0cc, 0, 0.55, 2.4);
    this.flareB.position.set(0.02, 0.06, 0.0); this.scene.add(this.flareB);
    if (QUALITY) {
      this.candleB.castShadow = true;
      this.candleB.shadow.mapSize.set(MOBILE ? 512 : 1024, MOBILE ? 512 : 1024);
      this.candleB.shadow.bias = -0.003;
      this.candleB.shadow.radius = 4;
    }
    if (QUALITY) { this.camera.add(this.room.object); this.room.load(() => this.room.layout(this.camera)); }
    if (QUALITY && FX_SMOKE) this.buildSmoke();
    this.scene.add(this.pivot);

    // 塵
    const dpos = new Float32Array(this.ND * 3);
    for (let i = 0; i < this.ND; i++) {
      dpos[i * 3] = (Math.random() - 0.5) * 1.4; dpos[i * 3 + 1] = (Math.random() - 0.5) * 1.0; dpos[i * 3 + 2] = (Math.random() - 0.5) * 1.4;
      this.dspd.push(0.008 + Math.random() * 0.02);
    }
    this.dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    this.dust = new THREE.Points(this.dustGeo, new THREE.PointsMaterial({ color: 0xd8b878, size: 0.0035, transparent: true, opacity: 0.55, depthWrite: false }));
    this.scene.add(this.dust);
    if (MOTES === 'd') { (this.dust.material as THREE.Material).visible = false; this.grace = new GraceMotes(this.scene, this.camera); }   // d: 塵は漂う光が兼ねる
    else if (MOTES !== 'old') equipSprites(this.dust, 'speck', 0.0065, { sizeMin: 0.35, sizeMax: 1.5, range: 1.2 });
    if (MOTES === 'c') this.flies = new Fireflies(this.scene);

    // 吸い込みの光の粒
    this.mPos = new Float32Array(this.MN * 3); this.mVel = new Float32Array(this.MN * 3); this.mLife = new Float32Array(this.MN);
    this.mGeo.setAttribute('position', new THREE.BufferAttribute(this.mPos, 3));
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,240,200,1)'); r.addColorStop(0.35, 'rgba(255,200,120,.6)'); r.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    this.motes = new THREE.Points(this.mGeo, new THREE.PointsMaterial({
      size: 0.010, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, color: 0xe6c690,
    }));
    this.motes.visible = false;
    this.camera.add(this.motes);
    if (MOTES === 'd') equipGlow(this.motes, 0.010, { focus: 0.9, range: 0.8, floor: 0.45, lightR: 0.6 });
    else if (MOTES !== 'old') equipSprites(this.motes, MOTES === 'b' ? 'ember' : 'bokeh', MOTES === 'b' ? 0.016 : 0.011, { vel: this.mVel, focus: 0.9, range: 0.8 });

    // 合言葉のあとに散る金の粒。大粒と小粒を混ぜ、1波目=放射／2波目=ゆっくり昇る塵
    const fxTex = new THREE.CanvasTexture(c);
    const w1 = FX_ON ? Math.round(FX_N * 0.6) : 0, w2 = FX_ON ? FX_N - w1 : 0;
    const w1b = Math.round(w1 * 0.35), w2b = Math.round(w2 * 0.35);
    this.bursts = [
      this.makeBurst(w1b, 0.017, fxTex, FX_WAVE1, false),
      this.makeBurst(w1 - w1b, 0.009, fxTex, FX_WAVE1, false),
      this.makeBurst(w2b, 0.014, fxTex, FX_WAVE2, true),
      this.makeBurst(w2 - w2b, 0.008, fxTex, FX_WAVE2, true),
    ];

    this.buildComposer();
  }

  load(onReady: () => void, onFail?: () => void): void {
    const glbOverride = QP.get('glb');
    // v2: 本体は Draco + WebP(1024) に落とした自ホスト版（4.18MB → 0.86MB）。
    //     デコーダも public/draco/ に同梱して自ホスト（CDN依存ゼロ）。
    //     元の assets/book.glb は ?glb=assets/book.glb で読める（検証用）。
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(new URL('draco/', document.baseURI).href);
    loader.setDRACOLoader(draco);
    const url = glbOverride
      ? new URL('../' + glbOverride, document.baseURI).href + '?_=' + Date.now()
      : new URL((FX_COVER ? 'book_open.glb' : 'book.glb') + '?b=' + BUILD, document.baseURI).href;
    loader.load(url, g => {
      const book = g.scene; book.rotation.z = 0.06; this.pivot.add(book); this.book = book;
      book.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.roughness = Math.max(mat.roughness || 0, 0.95);
          mat.metalness = 0;
          if (mat.color) mat.color.multiplyScalar(0.86);
          // 2026-09-22 KEI「回している時、本に変な影が付く」→ 本は影を「落とす」だけにし、
          // 自分の影を「受けない」。机への柔らかい接地影はそのまま残る。
          if (QUALITY) { m.castShadow = true; m.receiveShadow = BOOK_SELF_SHADOW; mat.envMapIntensity = 0.22 * ENV_K; }
        }
      });
      const rig = FX_COVER ? book.getObjectByName('CoverHinge') : undefined;
      if (rig) this.applyParchment(book);
      if (QUALITY) this.applyLeather(book);
      if (FX_ETCH) this.applyEtch(book);
      const cover = book.getObjectByName('Cover_Front');
      if (rig) {
        // cover: Blender 側の蝶番 Empty をそのまま使う（hinge.attach(cover) で付け替えると見返しだけが開くので、しない）
        this.hinge = rig;
        this.pageHinge = book.getObjectByName('PageHinge') || null;
        book.traverse(o => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !m.morphTargetDictionary) return;
          if ('Curl' in m.morphTargetDictionary) this.firstMesh = m;
          if ('Open' in m.morphTargetDictionary) this.spineMesh = m;
        });
        const mixer = new THREE.AnimationMixer(book); this.mixer = mixer;
        const mk = (name: string): THREE.AnimationAction | null => {
          const clip = THREE.AnimationClip.findByName(g.animations, name);
          if (!clip) return null;
          const a = mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
          return a;
        };
        this.coverAct = mk('CoverOpen'); this.pageAct = mk('FirstPage');
        this.coverSec = this.coverAct ? this.coverAct.getClip().duration : 0;
        this.pageSec = this.pageAct ? this.pageAct.getClip().duration : 0;
        this.coverMax = THREE.MathUtils.degToRad(150); this.pageMax = THREE.MathUtils.degToRad(148);
        // 2026-10-20 KEI「一枚目捲れるやつは要らなかった」: 既定は1枚目をめくらない（表紙の着地で潜る）。?cpage=1 で比較用に旧（めくる）
        if (QP.get('cpage') !== '1') { this.pageAct = null; this.pageSec = 0; this.pageMax = 0; }
      } else if (cover) {
        const bb = new THREE.Box3().setFromObject(cover);
        const hinge = new THREE.Group();
        hinge.position.set(bb.min.x, (bb.min.y + bb.max.y) / 2, 0);
        book.add(hinge); hinge.attach(cover); this.hinge = hinge;
      }
      this.pivot.scale.setScalar(1); this.bookScale = 1; this.bookTarget = 1;
      this.buildRibbon(); this.buildFavMarks(); if (QUALITY) this.buildStage();
      if (TITLE_DECAL) this.buildTitleDecal(cover || null);   // 2026-09-08 KEI: 表紙の「名言の書」は消す
      if (ICON) {
        book.rotation.z = 0;
        if (this.ribbon) this.ribbon.visible = false;
        if (this.favMarks) this.favMarks.visible = false;
        if (this.stageGroup) this.stageGroup.visible = false;
        this.dust.visible = false; this.motes.visible = false;
        this.room.object.visible = false;
        this.fireB.intensity = 0;
        this.rimB.color.set(0xffe2ba); this.rimB.intensity = qn('irim', 0.30);
        const key = new THREE.DirectionalLight(0xffe4c0, qn('ikey', 2.0));
        key.position.set(0.55, 0.75, 1.9); this.scene.add(key); this.iconKey = key;
        this.scene.add(new THREE.AmbientLight(0xffdcb4, qn('ifill', 1.1)));
        if (this.gradePass) this.gradePass.uniforms.uVig.value = qn('ivig', 0.08);
      }
      onReady();
    }, undefined, err => {
      // 2026-10-19 beta: 取れなかった時は main.ts が「読み込めなかった　もう一度」を出す（?fx=0 では従来どおり何もしない）
      console.warn('book.glb load failed', err);
      if (onFail) onFail();
    });
  }

  /** cover: 見返し（Cover_Endpaper）・1枚目（Page_First）・紙の束の上面（M_PageTop）を古書の紙に（2026-10-19 K）。
   *  旧（J）: 無地 #cdbf9c×0.62・envMap 0.12 → 照明と暖炉の映り込みで平らな明るい黄色＝段ボール箱に見えた。
   *  新: backside.jpg（めくりの裏面＝染みと繊維のある素の紙）を貼り、色を PARCH_PK 倍に落とし、映り込みはほぼ 0・roughness 1。
   *  UV は Blender の物を使わず、各面の平面（一番薄い軸を法線とみなす）に四隅 0..1 で張り直す。
   *  1枚目の表（表紙側を向く面）だけは「最初に読むページ」の絵（pages/pN.jpg・既定 p1）。裏と縁は素の紙。
   *  ?pk= 明るさの倍率（既定 0.3）／?pek= 見返しだけさらに掛ける倍率（既定 0.7・立っていて正面から光を受けるので）／?parch=flat で J の無地／?pflip=0 で1枚目の絵の上下返しを外す（確認用）／?ptint=r,g,b 紙の色（暖色の光を打ち消す寒色寄り） */
  private parchMats: THREE.MeshStandardMaterial[] = [];
  private firstMat: THREE.MeshStandardMaterial | null = null;
  private firstPageUrl = '';
  private applyParchment(root: THREE.Object3D): void {
    const tl = new THREE.TextureLoader();
    const flat = QP.get('parch') === 'flat';
    const pk = qn('pk', 0.3);   // 0.2/0.3/0.45/0.6 を撮って比較（2026-10-19 K）。0.45 以上は橙に焼け、0.2 は文字が沈む
    const map = flat ? null : tl.load(asset('backside.jpg'));
    if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
    // 紙の地の色: 白×pk（テクスチャの色そのまま）。わずかに冷ましてろうそくの橙に焼けすぎないように
    const tq = (QP.get('ptint') || '').split(',').map(Number);
    const tc = tq.length === 3 && tq.every(x => x >= 0) ? tq : PARCH_TINT;
    const tint = flat ? new THREE.Color(PARCH_COLOR).multiplyScalar(pk) : new THREE.Color(tc[0], tc[1], tc[2]).multiplyScalar(pk);
    const mat = new THREE.MeshStandardMaterial({
      name: 'M_Parchment', map, color: tint,
      roughness: 1.0, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.03 * ENV_K,
    });
    if (FX_PBR) {
      const n = tl.load(asset('pbr/paper-normal.webp')); n.flipY = false; n.colorSpace = THREE.NoColorSpace;
      n.wrapS = n.wrapT = THREE.RepeatWrapping; n.repeat.set(2, 2);
      mat.normalMap = n; mat.normalScale = new THREE.Vector2(0.3, 0.3);
    }
    // 1枚目の表：名言のページ。テクスチャは setFirstPage() で差し替える（栞のページ）
    const fm = mat.clone(); fm.name = 'M_FirstPage'; fm.map = null; fm.side = THREE.FrontSide;
    this.firstMat = fm;
    this.setFirstPage(asset('pages/p1.jpg'));
    // 表紙側の向き（本の空間）: 紙の束の中心 → 表紙の中心
    root.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const ctr = (n: string): THREE.Vector3 | null => {
      const o = root.getObjectByName(n); if (!o) return null;
      return new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).applyMatrix4(inv);
    };
    const cf = ctr('Cover_Front'), pg = ctr('Pages');
    const up = cf && pg ? cf.sub(pg).normalize() : null;
    const targets: THREE.Mesh[] = [];
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      if (m.name === 'Cover_Endpaper' || m.name === 'Page_First' || (m.material as THREE.Material).name === 'M_PageTop') targets.push(m);
    });
    for (const m of targets) {
      const first = m.name === 'Page_First';
      planarUV(m.geometry, first && QP.get('pflip') !== '0');   // 1枚目の絵は上下を返すと、天が本の上端・鏡なし（撮影で確認）
      const c = mat.clone(); this.parchMats.push(c);
      if (m.name === 'Cover_Endpaper') {
        c.color.multiplyScalar(qn('pek', 0.7));
        // 2026-10-20: 見返しの縁だけ紙の繊維を強く（Paper005 CC0 から作った endpaper-normal・四隅 0..1 で1回）
        if (FX_PBR) {
          const en = new THREE.TextureLoader().load(asset('pbr/endpaper-normal.webp')); en.flipY = false; en.colorSpace = THREE.NoColorSpace;
          c.normalMap = en; c.normalScale = new THREE.Vector2(1.0, 1.0);
        }
      }   // etch がマテリアルごとに uniform を持つので、面ごとに分ける（テクスチャは共有）
      if (first && up) {
        // 表紙側を向く三角形だけを group 0（名言の絵）に、残りを group 1（素の紙）に並べ替える
        const nm = new THREE.Matrix3().getNormalMatrix(new THREE.Matrix4().copy(inv).multiply(m.matrixWorld));
        splitByFacing(m.geometry, nm, up);
        const cb = c.clone(); cb.side = THREE.FrontSide; this.parchMats.push(cb);
        m.material = [fm, c, cb];
      } else {
        m.material = c;
      }
      if (m.name !== 'Cover_Endpaper') m.receiveShadow = false;
    }
  }
  /** cover: 1枚目の表に貼る名言のページ（栞があればそのページ）。同じ URL なら何もしない */
  setFirstPage(url: string): void {
    if (!this.firstMat || url === this.firstPageUrl) return;
    this.firstPageUrl = url;
    new THREE.TextureLoader().load(url, t => {
      if (url !== this.firstPageUrl || !this.firstMat) { t.dispose(); return; }
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      const old = this.firstMat.map; this.firstMat.map = t; this.firstMat.needsUpdate = true;
      if (old) old.dispose();
    });
  }
  /** cover: 表紙を開くクリップ（CoverOpen）を頭から再生。終わったら clamp で止まる */
  coverPlay(): void { this.coverAct?.reset().play(); }
  /** cover: 1枚目（FirstPage）を頭から再生 */
  pagePlay(): void { this.pageAct?.reset().play(); }
  /** cover: クリップを止め、表紙と1枚目を手で回せる状態に戻す（rad） */
  coverSet(cover: number, page: number): void {
    this.coverAct?.stop(); this.pageAct?.stop();
    if (this.hinge) this.hinge.rotation.z = cover;
    if (this.pageHinge) this.pageHinge.rotation.z = page;
  }
  /** cover: 毎フレーム。ミキサーがある時だけ */
  tickMixer(dt: number): void { if (this.mixer) { this.mixer.update(dt); this.tickMorph(); } }
  /** cover（2026-10-20）: 背の Open は表紙の角度に、1枚目の Curl はめくりの途中だけ（0°と着地で 0・真ん中で最大） */
  private tickMorph(): void {
    const sm = this.spineMesh, fm = this.firstMesh;
    if (sm && this.hinge && sm.morphTargetInfluences && sm.morphTargetDictionary) {
      const k = THREE.MathUtils.clamp(this.hinge.rotation.z / Math.max(1e-3, this.coverMax), 0, 1);
      sm.morphTargetInfluences[sm.morphTargetDictionary.Open] = k * k * (3 - 2 * k);
    }
    if (fm && this.pageHinge && fm.morphTargetInfluences && fm.morphTargetDictionary) {
      const a = THREE.MathUtils.clamp(this.pageHinge.rotation.z / Math.max(1e-3, this.pageMax), 0, 1);
      fm.morphTargetInfluences[fm.morphTargetDictionary.Curl] = Math.sin(Math.PI * a) * PAGE_CURL;
    }
  }

  private applyLeather(root: THREE.Object3D): void {
    const tl = new THREE.TextureLoader();
    // pbr: 既存の型押し（目の紋章）に革目を重ねて焼いた地図（scripts/build-assets.mjs pbr）。UV は既存と同じ
    const nrm = tl.load(asset(FX_PBR ? 'pbr/cover-normal-pbr.webp' : 'cover-normal.webp')); nrm.flipY = false; nrm.colorSpace = THREE.NoColorSpace;
    const rgh = tl.load(asset(FX_PBR ? 'pbr/cover-rough-pbr.webp' : 'cover-rough.jpg')); rgh.flipY = false; rgh.colorSpace = THREE.NoColorSpace;
    if (FX_PBR) this.applyPagesPbr(root, tl);
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      if (/Cover_Front|Cover_Back/.test(m.name)) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.normalMap = nrm; mat.normalScale = FX_PBR ? new THREE.Vector2(0.8, 0.8) : new THREE.Vector2(0.55, 0.55);
        // cover（2026-10-20）: book_open.glb は手の触れる所（小口側の角・小口の縁・蝶番）だけ滑らかにした粗さを持つ → それを使う
        mat.roughnessMap = FX_COVER && mat.roughnessMap ? mat.roughnessMap : rgh; mat.roughness = 1.0; mat.envMapIntensity = 0.35 * ENV_K; mat.needsUpdate = true;
      }
    });
  }
  /** etch: 表紙・背・紙の束のマテリアルに「表面に彫る線」を差し込む（2026-10-19 夜 beta・BetaFx.applySurfaceEtch） */
  private applyEtch(root: THREE.Object3D): void {
    const amt = qn('etamt', 1.0), gain = qn('etgain', 0.55);
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      (Array.isArray(m.material) ? m.material : [m.material]).forEach(mat => {
        // 小口は1方向目を紙の重なりと平行に（+0.95 で 1方向目が π/2 = 水平の線）
        const u: SurfaceEtchUniforms = { uEtS: { value: 0.01 }, uEtAmt: { value: amt }, uEtGain: { value: gain }, uEtRot: { value: mat.name === 'M_Pages' ? 0.95 : 0 } };
        applySurfaceEtch(mat, u);
        this.etchMats.push({ u, mesh: m });
      });
    });
    this.etchSpacing();
  }
  /** 線の間隔: 入口の距離（CAM_R）で画面上 約3 CSS px（?etpx= で試せる）。ジオメトリ空間の長さに直して渡す */
  private etchSpacing(): void {
    if (!this.etchMats.length) return;
    const perPx = 2 * CAM_R * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.max(1, innerHeight);
    const px = qn('etpx', 3.2);
    // 入口の演出で pivot の縮尺は 0→1 と動くので、pivot から下の縮尺だけで測る（静止時 = pivot 1）
    const ws = new THREE.Vector3(), ps = new THREE.Vector3();
    this.pivot.updateWorldMatrix(true, false); this.pivot.getWorldScale(ps);
    const pk = Math.max(1e-6, (Math.abs(ps.x) + Math.abs(ps.y) + Math.abs(ps.z)) / 3);
    for (const e of this.etchMats) {
      e.mesh.updateWorldMatrix(true, false); e.mesh.getWorldScale(ws);
      const k = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3 / pk;
      e.u.uEtS.value = perPx * px / Math.max(1e-6, k);
    }
  }
  /** pbr: 紙の束。小口（M_Pages）は1枚ずつの重なりの法線、上面（M_PageTop）は紙の凹凸を薄く（2026-10-19 beta） */
  private applyPagesPbr(root: THREE.Object3D, tl: THREE.TextureLoader): void {
    const edge = tl.load(asset('pbr/edge-normal.webp')); edge.flipY = false; edge.colorSpace = THREE.NoColorSpace;
    edge.wrapS = edge.wrapT = THREE.RepeatWrapping;
    const paper = tl.load(asset('pbr/paper-normal.webp')); paper.flipY = false; paper.colorSpace = THREE.NoColorSpace;
    paper.wrapS = paper.wrapT = THREE.RepeatWrapping; paper.repeat.set(2, 2);
    let edgeAged: THREE.Texture | null = null;
    if (FX_COVER && root.getObjectByName('CoverHinge')) {
      edgeAged = tl.load(asset('pbr/edge-normal-aged.webp')); edgeAged.flipY = false; edgeAged.colorSpace = THREE.NoColorSpace;
    }
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.name === 'M_Pages') {
        // cover（2026-10-20）: book_open.glb の小口は UV を面ごとに 0..1 で張り直した → 同じ紙の並びから作った法線（edge-normal-aged）
        mat.normalMap = edgeAged || edge; mat.normalScale = new THREE.Vector2(0.9, 0.9);
        mat.roughness = 1.0; mat.needsUpdate = true;
      } else if (mat.name === 'M_PageTop') {
        mat.normalMap = paper; mat.normalScale = new THREE.Vector2(0.35, 0.35);
        mat.roughness = 1.0; mat.needsUpdate = true;
      }
    });
  }



  // ------------------------------------------------------------------
  // 表紙の箔押し「名言の書」（KEI 2026-09-07: DOM のタイトルカードは出さず、
  // 表紙そのものに刻む）。GLB の UV が分からないのでテクスチャに焼かず、
  // 表紙のすぐ上に薄い板（デカール）を貼る。見た目は箔押しと同じ。
  // 斜光でだけ読める控えめな金。位置は紋章の下。
  // ------------------------------------------------------------------
  private titleCanvas(): { tex: THREE.CanvasTexture; ratio: number } {
    const W = 1024, H = 300;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const chars = ['名', '言', 'の', '書'];
    const fs = 168, sp = fs * 0.30;
    g.font = '500 ' + fs + 'px "Hiragino Mincho ProN","Yu Mincho","Shippori Mincho",serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const widths = chars.map(ch => g.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
    let x = (W - total) / 2;
    const grad = g.createLinearGradient(0, H * 0.18, 0, H * 0.86);
    grad.addColorStop(0, '#f6e6ae'); grad.addColorStop(0.42, '#cda54c');
    grad.addColorStop(0.56, '#9d7a2c'); grad.addColorStop(1, '#e6cf88');
    for (let i = 0; i < chars.length; i++) {
      const cx = x + widths[i] / 2;
      // 押し込みの影（箔押しの窪み）
      g.fillStyle = 'rgba(20,12,4,.55)';
      g.fillText(chars[i], cx + 3, H / 2 + 3);
      g.fillStyle = grad;
      g.fillText(chars[i], cx, H / 2);
      // 縁の一本ハイライト
      g.strokeStyle = 'rgba(255,244,206,.35)'; g.lineWidth = 1.6;
      g.strokeText(chars[i], cx - 0.8, H / 2 - 1.2);
      x += widths[i] + sp;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { tex, ratio: W / H };
  }
  private sweepTexture(): THREE.CanvasTexture {
    const W = 256, H = 8;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const lg = g.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0.00, 'rgba(0,0,0,0)');
    lg.addColorStop(0.42, 'rgba(0,0,0,0)');
    lg.addColorStop(0.50, 'rgba(255,246,214,1)');
    lg.addColorStop(0.58, 'rgba(0,0,0,0)');
    lg.addColorStop(1.00, 'rgba(0,0,0,0)');
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  private buildTitleDecal(cover: THREE.Object3D | null): void {
    const book = this.book; if (!book || !cover || this.titleDecal) return;
    const hinge = this.hinge; if (!hinge) return;
    // 表紙のバウンディングボックスを本のローカル座標で測る（buildRibbon と同じ手）
    const rz = book.rotation.z, py = this.pivot.position.y, hz = hinge.rotation.z;
    book.rotation.z = 0; hinge.rotation.z = 0; this.pivot.position.y = 0;
    this.pivot.updateMatrixWorld(true);
    const cb = new THREE.Box3().setFromObject(cover);
    book.rotation.z = rz; hinge.rotation.z = hz; this.pivot.position.y = py;
    const cw = cb.max.x - cb.min.x, cz = cb.max.z - cb.min.z;
    const { tex, ratio } = this.titleCanvas();
    const w = cw * 0.52, h = w / ratio;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);                       // 表紙の面（+Y を向く）に寝かせる
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.02, depthWrite: false,
      metalness: 0.85, roughness: 0.28, envMapIntensity: 0.9,
      emissive: new THREE.Color(0xffd48a), emissiveIntensity: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const m = new THREE.Mesh(geo, mat);
    // 紋章の下（本の上端 = z 小、下端 = z 大）
    const px = (cb.min.x + cb.max.x) / 2 + cw * 0.02;
    const pz = cb.min.z + cz * 0.70;
    const pyTop = cb.max.y + 0.0006;
    m.position.set(px - hinge.position.x, pyTop - hinge.position.y, pz - hinge.position.z);
    m.renderOrder = 2;
    hinge.add(m); this.titleDecal = m;

    // 箔の上を光が走る板（同じ字型で抜く）
    this.sweepTex = this.sweepTexture();
    const sw = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({
      map: this.sweepTex, alphaMap: tex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    sw.position.copy(m.position); sw.position.y += 0.0002;
    sw.renderOrder = 3; sw.visible = false;
    hinge.add(sw); this.titleSweep = sw;
  }

  /** 直後の1フレームを画像にして返す（読書画面の背景に敷く） */
  captureFrame(cb: (url: string) => void): void { this.capture = cb; }

  private buildStage(): void {
    if (!this.book || !this.bookBB || this.stageGroup) return;
    const bb = this.bookBB;
    this.stageGroup = new THREE.Group();
    const y = bb.min.y - 0.004;
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.ShadowMaterial({ opacity: 0.5, color: 0x000000 }));
    desk.rotation.x = -Math.PI / 2; desk.position.y = y; desk.receiveShadow = true; this.stageGroup.add(desk);
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(128, 128, 20, 128, 128, 128);
    r.addColorStop(0, 'rgba(0,0,0,.85)'); r.addColorStop(0.55, 'rgba(0,0,0,.35)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 256, 256);
    const bw = bb.max.x - bb.min.x, bz = bb.max.z - bb.min.z;
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(bw * 1.55, bz * 1.45),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.9 }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.set((bb.min.x + bb.max.x) / 2 + bw * 0.03, y + 0.001, (bb.min.z + bb.max.z) / 2);
    contact.renderOrder = -1;
    this.stageGroup.add(contact);
    this.book.add(this.stageGroup);
  }

  private buildRibbon(): void {
    const book = this.book; if (!book) return;
    const rz = book.rotation.z, py = this.pivot.position.y;
    book.rotation.z = 0; this.pivot.position.y = 0; this.pivot.updateMatrixWorld(true);
    this.bookBB = new THREE.Box3().setFromObject(book);
    book.rotation.z = rz; this.pivot.position.y = py;
    const bb = this.bookBB;
    const bw = bb.max.x - bb.min.x, bh = bb.max.z - bb.min.z;

    // 羊皮紙の栞タブ。bookmark.webp の上端 F 分だけを使い、閉じた本の上端(min.z)から覗かせる。
    const F = 0.30;                                   // 使うテクスチャの割合（麻紐＋マーク＋少しの紙）
    const peek = bh * 0.21;                          // 本の上端から出ている長さ
    const len = peek / 0.72;                          // 残り 28% は本の中（ページに挟まっている）
    const w = len * (400 / (1805 * F));               // 切り出した領域の縦横比

    const tex = new THREE.TextureLoader().load(new URL('bookmark.webp', document.baseURI).href);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1, F); tex.offset.set(0, 1 - F);

    const geo = new THREE.PlaneGeometry(w, len, 1, 8);
    geo.translate(0, -len / 2, 0);                    // 原点＝タブの先端（テクスチャ上端）
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {             // 先端をわずかに反らせて光を受けさせる
      const k = 1 + pos.getY(i) / len;                // 先端 1 → 根元 0
      pos.setZ(i, k * k * len * 0.18);
    }
    geo.rotateX(-Math.PI / 2); geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: tex, color: 0xe8ddc6, transparent: true, alphaTest: 0.42, roughness: 0.96, metalness: 0, side: THREE.DoubleSide,
    });
    this.ribbon = new THREE.Mesh(geo, mat);
    // 本の上端（奥端 min.z）から覗かせる。表紙のすぐ下に挟み、先端を起こして本体に隠れないようにする
    this.ribbon.position.set(bb.min.x + bw * 0.58, bb.max.y - (bb.max.y - bb.min.y) * 0.22, bb.min.z - peek);
    this.ribbon.rotation.x = 0.30;          // 先端を持ち上げて面をカメラへ向ける
    this.ribbon.rotation.y = RIB_YAW;
    book.add(this.ribbon);
    this.ribbon.visible = hasBookmark();
  }

  buildFavMarks(): void {
    if (!this.book || !this.bookBB) return;
    if (this.favMarks) { this.book.remove(this.favMarks); this.favMarks = null; }
    const favs = loadFavs();
    if (!favs.length) return;
    const bb = this.bookBB;
    // 2026-09-30 KEI「ページの所々に何かはみ出てる」: 以前は本全体の外枠（表紙の縁 max.x）の外に置いていたため、
    // 小口より約5mm手前に金の小片が宙に浮いて見えていた。紙の束（Pages_*）の小口に半分埋めて挟み込む。
    const pb = this.pagesBox() || bb;
    this.favMarks = new THREE.Group();
    const bw = bb.max.x - bb.min.x, by = bb.max.y - bb.min.y, bz = bb.max.z - bb.min.z;
    const py = pb.max.y - pb.min.y, pz = pb.max.z - pb.min.z;
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9b25a, roughness: 0.35, metalness: 0.7, emissive: 0x3a2a08, envMapIntensity: ENV_K });
    const dx = bw * 0.012;
    const geo = new THREE.BoxGeometry(dx, Math.max(0.0006, by * 0.006), bz * 0.028);
    favs.slice(0, 80).forEach((p, i) => {
      const m = new THREE.Mesh(geo, mat);
      const k = (p % 790) / 790;
      const z = pb.max.z - pz * (0.12 + ((i * 0.618) % 1) * 0.76);
      // 小口から 1/3 だけ覗かせる（表紙の張り出しより内側に収まる）
      m.position.set(pb.max.x + dx * (1 / 3 - 0.5), pb.min.y + py * (0.15 + k * 0.70), z);
      this.favMarks!.add(m);
    });
    this.book.add(this.favMarks);
  }

  get ribbonMesh(): THREE.Mesh | null { return this.ribbon; }
  setRibbonVisible(v: boolean): void { if (this.ribbon) this.ribbon.visible = v; }
  /** 紙の束（Pages_*）の外枠を本のローカル座標で返す（pivot の縮尺・本の傾きに左右されない） */
  private pagesBox(): THREE.Box3 | null {
    const book = this.book; if (!book) return null;
    book.updateMatrixWorld(true);
    const inv = book.matrixWorld.clone().invert();
    const out = new THREE.Box3(), tmp = new THREE.Box3(), m = new THREE.Matrix4();
    book.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !/^Pages/.test(mesh.name)) return;
      mesh.geometry.computeBoundingBox();
      tmp.copy(mesh.geometry.boundingBox!).applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld));
      out.union(tmp);
    });
    return out.isEmpty() ? null : out;
  }
  refreshRibbon(): void { if (this.ribbon) this.ribbon.visible = hasBookmark(); }

  // ---- 吸い込みの光の粒 ----
  private moteSpawn(i: number): void {
    const z = -(0.35 + Math.random() * 1.4), spread = 0.62 * (-z);
    this.mPos[i * 3] = (Math.random() - 0.5) * 2 * spread;
    this.mPos[i * 3 + 1] = (Math.random() - 0.5) * 2 * spread * 1.6;
    this.mPos[i * 3 + 2] = z;
    this.mVel[i * 3] = (Math.random() - 0.5) * 0.08;
    this.mVel[i * 3 + 1] = 0.02 + Math.random() * 0.10;
    this.mVel[i * 3 + 2] = 0.35 + Math.random() * 0.9;
    this.mLife[i] = 0.6 + Math.random() * 1.6;
  }
  motesStart(): void { this.motesOn = true; this.moteT = 0; this.motes.visible = true; for (let i = 0; i < this.MN; i++) { this.moteSpawn(i); this.mLife[i] *= Math.random(); } }
  motesStop(): void { this.motesOn = false; this.motes.visible = false; }
  private motesStep(dt: number): void {
    if (!this.motesOn) return;
    this.moteT += dt;
    for (let i = 0; i < this.MN; i++) {
      this.mLife[i] -= dt;
      if (this.mLife[i] <= 0) { this.moteSpawn(i); continue; }
      this.mPos[i * 3] += this.mVel[i * 3] * dt;
      this.mPos[i * 3 + 1] += this.mVel[i * 3 + 1] * dt;
      this.mPos[i * 3 + 2] += this.mVel[i * 3 + 2] * dt * (1 + this.moteT * 0.8);
      if (this.mPos[i * 3 + 2] > -0.05) this.mLife[i] = 0;
    }
    this.mGeo.attributes.position.needsUpdate = true;
    (this.motes.material as THREE.PointsMaterial).opacity = Math.min(0.45, this.moteT * 1.0);
  }
  // ---- 合言葉のあとの出現（2026-09-21 KEI） ----
  /** 本を消しておく（合言葉の画面のあいだ） */
  hideBook(): void { this.bookScale = 0; this.bookTarget = 0; this.pivot.scale.setScalar(0.0001); }

  private makeBurst(n: number, size: number, map: THREE.Texture, at: number, rise: boolean): Burst {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size, map, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xe6c690,
    }));
    pts.visible = false;
    this.scene.add(pts);
    if (MOTES === 'd') equipGlow(pts, size * 1.5, { floor: 0.35, lightR: 0.5 });
    else if (MOTES !== 'old') equipSprites(pts, MOTES === 'b' ? 'ember' : 'bokeh', size * (MOTES === 'b' ? 2.8 : 1.8), { vel });
    return { pts, geo, pos, vel, n, at, rise, t: -1 };
  }

  /** 粒を撒く。rise=false は本の中心から放射、rise=true は本の周りからゆっくり昇る塵 */
  private burstSpawn(b: Burst): void {
    const o = this.pivot.position;
    for (let i = 0; i < b.n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      if (b.rise) {
        const r = 0.05 + Math.random() * 0.22;
        b.pos[i * 3] = o.x + Math.cos(th) * r;
        b.pos[i * 3 + 1] = o.y - 0.05 + Math.random() * 0.10;
        b.pos[i * 3 + 2] = o.z + Math.sin(th) * r;
        b.vel[i * 3] = (Math.random() - 0.5) * 0.020;
        b.vel[i * 3 + 1] = 0.018 + Math.random() * 0.038;
        b.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.020;
      } else {
        const sp = 0.07 + Math.random() * 0.20;
        b.pos[i * 3] = o.x + (Math.random() - 0.5) * 0.04;
        b.pos[i * 3 + 1] = o.y + (Math.random() - 0.5) * 0.03;
        b.pos[i * 3 + 2] = o.z + (Math.random() - 0.5) * 0.04;
        b.vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
        b.vel[i * 3 + 1] = Math.cos(ph) * sp * 0.6 + 0.035;
        b.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      }
    }
    b.geo.attributes.position.needsUpdate = true;
    b.pts.visible = true;
    b.t = 0;
  }

  /** 本が現れる。奥から手前へ寄りながら scale 0→1（REVEAL_SEC・S字）＋ Y +30°→0 */
  revealStart(): void {
    this.revealT = 0; this.bookTarget = 1; this.bookScale = 0;
    this.glowT = -1; this.revealBack = REVEAL_DEPTH;
    for (const b of this.bursts) { b.t = -1; b.pts.visible = false; }
  }
  /** 出現中か */
  get revealing(): boolean { return this.revealT >= 0; }

  private revealStep(dt: number): void {
    if (this.revealT >= 0) {
      this.revealT += dt;
      const k = Math.min(this.revealT / REVEAL_SEC, 1), e = smootherstep(k);
      this.bookScale = e;
      this.pivot.rotation.y = (1 - e) * REVEAL_YAW;
      this.pivot.rotation.z = (1 - e) * REVEAL_ROLL;
      // 「奥から」出てくる。カメラの視線方向へ (1-e)*REVEAL_DEPTH ぶん退いた所から寄ってくる。
      // カメラは本の周りを回るので、世界座標の固定軸ではなく視線に沿って動かす。
      this.revealBack = (1 - e) * REVEAL_DEPTH;
      // 波の点火（revealT を基準にするので、フレーム落ちしてもタイミングがずれない）
      if (FX_ON) for (const b of this.bursts) if (b.t < 0 && this.revealT >= b.at) this.burstSpawn(b);
      // 出来上がる少し前から、金の淡い発光
      if (GLOW_ON && this.glowT < 0 && this.revealT >= REVEAL_SEC - GLOW_LEAD) this.glowT = 0;
      if (k >= 1) {
        this.revealT = -1; this.revealBack = 0;
        this.pivot.rotation.y = 0; this.pivot.rotation.z = 0; this.bookScale = 1;
      }
    }
    // 光の粒
    for (const b of this.bursts) {
      if (b.t < 0) continue;
      b.t += dt;
      const k = Math.min(b.t / FX_LIFE, 1), drag = Math.exp(-dt / (b.rise ? 2.4 : 0.9));
      for (let i = 0; i < b.n; i++) {
        b.vel[i * 3] = b.vel[i * 3] * drag + MOTES_WIND_X * dt; b.vel[i * 3 + 2] *= drag;
        b.vel[i * 3 + 1] = b.vel[i * 3 + 1] * drag + 0.010 * dt;     // 最後はゆっくり昇る
        b.pos[i * 3] += b.vel[i * 3] * dt * MOTES_SPEED;
        b.pos[i * 3 + 1] += b.vel[i * 3 + 1] * dt * MOTES_SPEED;
        b.pos[i * 3 + 2] += b.vel[i * 3 + 2] * dt * MOTES_SPEED;
      }
      b.geo.attributes.position.needsUpdate = true;
      (b.pts.material as THREE.PointsMaterial).opacity = 0.8 * Math.min(1, b.t / 0.45) * (1 - k) * (1 - k * 0.25);
      if (k >= 1) { b.t = -1; b.pts.visible = false; }
    }
    // ブルームを +30% して 2秒でもとへ（ブルームが無い端末では大粒のグローが代わりになる）
    if (this.glowT >= 0) {
      this.glowT += dt;
      const up = Math.min(1, this.glowT / GLOW_LEAD);
      const down = this.glowT <= GLOW_LEAD ? 1 : Math.max(0, 1 - (this.glowT - GLOW_LEAD) / GLOW_FALL);
      const g = up * down;
      if (this.bloomPass) this.bloomPass.strength = BLOOM_BASE * (1 + GLOW_GAIN * g);
      if (g <= 0) { this.glowT = -1; if (this.bloomPass) this.bloomPass.strength = BLOOM_BASE; }
    }
  }

  /** 机に落ちた衝撃で塵が舞う */
  burstDust(): void {
    for (let i = 0; i < this.dspd.length; i++) this.dspd[i] = 0.05 + Math.random() * 0.08;
    setTimeout(() => { for (let i = 0; i < this.dspd.length; i++) this.dspd[i] = 0.008 + Math.random() * 0.02; }, 1800);
  }

  /** smoke: 背景の絵の机のろうそくから立つ細い煙。部屋の板（カメラの子）の子にして、絵と一緒に動く。
   *  半透明の通常合成・depthWrite なし。本より奥（板の 1mm 手前）なので本が前を通れば隠れる */
  private buildSmoke(): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(SmokeShader.uniforms),
      vertexShader: SmokeShader.vertexShader, fragmentShader: SmokeShader.fragmentShader,
      transparent: true, depthWrite: false, toneMapped: true,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    // 板は 1×1 を (pw,ph) に伸ばしている＝子の座標は絵の比率。幅は炎の数倍・高さは絵の約36%（縦画面では根元が本の陰に隠れ、本の上へ細く抜ける）
    const W = 0.16, H = 0.36;
    m.scale.set(W, H, 1);
    m.position.set(SMOKE_AT.x, SMOKE_AT.y + H / 2 - 0.002, 0.001);
    m.renderOrder = -9;
    this.room.object.add(m);
    this.smoke = m;
  }

  private buildComposer(): void {
    if (!QUALITY || QP.get('q_post') === '0') return;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (!MOBILE) {
      this.bokehPass = new BokehPass(this.scene, this.camera, { focus: CAM_R, aperture: 0.00004, maxblur: 0.0045 });
      this.composer.addPass(this.bokehPass);
    }
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), BLOOM_BASE, 0.45, 0.86);
    this.setBloomSize();
    this.composer.addPass(this.bloomPass);
    if (FX_ETCH) {                                   // etch: ブルームの後・色の仕上げ（Grade）の前に1枚
      this.etchPass = new ShaderPass(EtchShader);
      this.etchPass.uniforms.uPx.value = this.renderer.getPixelRatio();
      this.composer.addPass(this.etchPass);
    }
    if (FX_DIVE) {                                   // dive: 潜る間だけ動く放射ぼかし（普段は enabled=false）
      this.divePass = new ShaderPass(DiveBlurShader);
      this.divePass.enabled = false;
      this.composer.addPass(this.divePass);
    }
    this.gradePass = new ShaderPass(GradeShader);
    if (QP.get('q_vig')) this.gradePass.uniforms.uVig.value = +QP.get('q_vig')!;
    if (MOBILE) { this.gradePass.uniforms.uGrain.value = 0.012; this.gradePass.uniforms.uCA.value = 0.0; }
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    if (FX_ENV) this.loadFireplaceEnv();
  }

  /** env: 暖炉の夜の部屋（Poly Haven fireplace 1K・CC0）。読み終わるまでは RoomEnvironment のまま。失敗しても旧のまま */
  private loadFireplaceEnv(): void {
    new HDRLoader().load(asset('env/fireplace_1k.hdr'), t => {
      const pm = new THREE.PMREMGenerator(this.renderer);
      const old = this.scene.environment;
      this.scene.environment = pm.fromEquirectangular(t).texture;
      t.dispose(); pm.dispose();
      if (old) old.dispose();
    }, undefined, () => { /* 旧の環境のまま */ });
  }

  /** ブルームの描画先を実解像度の半分に落とす（2026-09-09 軽量化）。resolution だけでは実サイズが変わらない */
  private setBloomSize(): void {
    if (!this.bloomPass) return;
    const dpr = this.renderer.getPixelRatio();
    this.bloomPass.resolution.set(innerWidth / 2, innerHeight / 2);
    this.bloomPass.setSize(Math.max(1, Math.round(innerWidth * dpr * 0.5)), Math.max(1, Math.round(innerHeight * dpr * 0.5)));
  }

  resize(): void {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.room.layout(this.camera);
    if (this.composer) {
      this.composer.setSize(innerWidth, innerHeight);
      this.setBloomSize();
      if (this.etchPass) this.etchPass.uniforms.uPx.value = this.renderer.getPixelRatio();
    }
    this.etchSpacing();
  }

  /**
   * 毎フレーム。opts で「開く」「吸い込み」「閉じる」の状態を渡す。
   * 描画設定・数式は現行 app/ と1文字も変えていない。
   */
  update(opts: {
    dt: number; wdt: number; t: number; raw: number;
    dragging: boolean; opening: boolean; diving: boolean; diveT: number;
    autoSpin: boolean; camOverride: { r: number; ph: number; near?: number } | null;
  }): void {
    if (this.composer && !this.perfDone) {
      this.perfN++; this.perfT += opts.raw;
      if (this.perfT > 8) {
        this.perfDone = true;
        const fps = this.perfN / this.perfT;
        if (fps < 22) {
          this.composer = null; this.renderer.shadowMap.enabled = false; this.candleB.castShadow = false;
          console.log('quality: auto-lite', fps.toFixed(1));
        }
      }
    }
    this.renderer.clear();
    const book = this.book;
    if (!book) return;
    const { dt, wdt, t } = opts;

    if (this.revealT >= 0 || this.glowT >= 0 || this.bursts.some(b => b.t >= 0)) this.revealStep(wdt);
    else this.bookScale += (this.bookTarget - this.bookScale) * (1 - Math.exp(-wdt / 0.28));
    this.pivot.scale.setScalar(Math.max(0.0001, this.bookScale) * BOOK_SIZE);
    this.pivot.position.y = 0.10 + Math.sin(t * 0.9) * 0.008;
    if (this.revealBack > 0) {
      // カメラから本へ向かう向きの逆＝「奥」。出現中だけ、その分だけ退かせる
      const c = this.camera.position, d = Math.max(1e-4, Math.hypot(c.x, c.y, c.z));
      this.pivot.position.x = c.x / d * this.revealBack;
      this.pivot.position.y += c.y / d * this.revealBack;
      this.pivot.position.z = c.z / d * this.revealBack;
    } else if (this.pivot.position.x !== 0 || this.pivot.position.z !== 0) {
      this.pivot.position.x = 0; this.pivot.position.z = 0;
    }
    if (opts.autoSpin) this.camTheta += dt * 0.055;
    while (this.camTheta > Math.PI) this.camTheta -= Math.PI * 2;
    while (this.camTheta < -Math.PI) this.camTheta += Math.PI * 2;

    if (this.shake > 0) { this.shake *= Math.exp(-wdt / 0.18); if (this.shake < 0.01) this.shake = 0; }

    // 影マップの更新だけ 15Hz（ろうそくの明滅は 60Hz のまま）
    if (this.renderer.shadowMap.enabled && t - this.shadowT >= 1 / 15) { this.shadowT = t; this.renderer.shadowMap.needsUpdate = true; }

    // 60fps で 0.08/フレームだった追従を時間基準に（30fps でも同じ速さ。60fps では従来と同値）
    const tk = PERF ? 1 - Math.pow(0.92, wdt * 60) : 0.08;
    this.tiltCur.x += (this.tiltRaw.x - this.tiltCur.x) * tk;
    this.tiltCur.y += (this.tiltRaw.y - this.tiltCur.y) * tk;
    this.candleB.position.set(0.28 + this.tiltCur.x * 0.22, 0.34 + this.tiltCur.y * 0.12, 0.30 - this.tiltCur.y * 0.15);
    if (TILT_FX) {   // beta: 1.2秒でなました傾きぶん、灯りがさらに少し滑る（本の照りがゆっくり追ってくる）
      const ks = 1 - Math.exp(-wdt / 1.2);
      this.tiltSlow.x += (this.tiltCur.x - this.tiltSlow.x) * ks; this.tiltSlow.y += (this.tiltCur.y - this.tiltSlow.y) * ks;
      this.candleB.position.x += this.tiltSlow.x * 0.10; this.candleB.position.y += this.tiltSlow.y * 0.05; this.candleB.position.z -= this.tiltSlow.x * 0.05;
    }
    this.candleB.intensity = (CANDLE_I + Math.sin(t * 0.71) * 0.18 + Math.sin(t * 1.63 + 1.1) * 0.11 + Math.sin(t * 0.29 + 2.4) * 0.14 + this.shake * 0.6)
      * (1 - this.openFlare * 0.80);                 // 開く瞬間は書斎の灯りを引き、光を本の中に集める
    // 端末を傾けると縁の光の向きが動く（±8°ぶん）
    this.rimB.position.set(
      this.rimHome.x - this.tiltCur.x * 0.42,
      this.rimHome.y - Math.abs(this.tiltCur.y) * 0.10,
      this.rimHome.z + this.tiltCur.y * 0.30,
    );
    // 開く演出の光（本の内側から溢れる。白飛びさせないよう上限を切る）
    if (this.openFlare > 0.0001 || this.flareA.intensity > 0.0001) {
      const f = this.openFlare;
      const fl = 0.9 + Math.sin(t * 21) * 0.06 + Math.sin(t * 7.3) * 0.04;
      this.flareA.intensity = f * 0.90 * fl;
      this.flareB.intensity = f * f * 0.42 * fl;
      if (this.bloomPass) this.bloomPass.strength = BLOOM_BASE + f * (MOBILE ? 0.18 : 0.24);
      this.renderer.toneMappingExposure = 0.72 + f * 0.04;
      if (this.gradePass) this.gradePass.uniforms.uVig.value = 0.30 - f * 0.14;
    }
    // 表紙の箔に光が走る
    if (this.titleDecal) {
      const mat = this.titleDecal.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = (this.gild * 0.55 + this.openFlare * 0.35) * FLARE_GAIN;   // 2026-09-07 KEI: 光が強すぎる→半分
      if (this.titleSweep && this.sweepTex) {
        const on = this.gild > 0.001;
        this.titleSweep.visible = on;
        if (on) {
          const sm = this.titleSweep.material as THREE.MeshBasicMaterial;
          sm.opacity = Math.min(1, Math.sin(Math.PI * Math.min(1, this.gild)) * 1.6) * FLARE_GAIN;   // 2026-09-07 KEI: 光が強すぎる→半分
          this.sweepTex.offset.x = -0.5 + this.gild * 1.15;
        }
      }
    }
    if (QUALITY) {
      const fl = Math.sin(t * 1.9) * 0.5 + Math.sin(t * 3.7 + 0.8) * 0.3 + Math.sin(t * 0.53 + 2.0) * 0.2;
      this.fireB.intensity = 0.9 + fl * 0.22 + this.shake * 0.4;
      this.room.setBreath(0.97 + fl * 0.025 + (this.candleB.intensity - CANDLE_I) * 0.03);
      if (this.gradePass) this.gradePass.uniforms.uTime.value = t;
      if (this.smoke) (this.smoke.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
      if (this.bokehPass) (this.bokehPass.uniforms as Record<string, { value: number }>)['focus'].value = this.camera.position.length();
    }

    const p = this.dustGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < this.ND; i++) { p[i * 3 + 1] += this.dspd[i] * dt; if (p[i * 3 + 1] > 0.55) p[i * 3 + 1] = -0.55; }
    this.dustGeo.attributes.position.needsUpdate = true;
    this.dust.visible = this.bookScale > 0.2 || this.keepAmbience;   // 合言葉の画面でも塵は舞わせる

    if (this.ribbon && this.ribbon.visible) {
      this.ribbon.rotation.y = RIB_YAW + Math.sin(t * 0.7) * 0.03 + this.shake * Math.sin(t * 40) * 0.08;
    }
    this.motesStep(wdt);
    if (this.grace) this.graceStep(wdt, t);
    if (this.flies) this.flies.step(wdt, t, this.pivot.position, this.camera.position, this.dust.visible && !ICON, Math.min(1, this.bookScale));

    const sx0 = this.shake * Math.sin(t * 57) * 0.012, sy0 = this.shake * Math.sin(t * 43 + 1) * 0.008;
    const cam = this.camera;
    if (ICON) {
      // アイコン撮影モード：本を立てて正面から。揺れ・自転・浮遊なし。
      this.dust.visible = false; this.motes.visible = false;
      this.room.object.visible = false;
      this.pivot.position.y = 0;
      // 姿勢は yaw/pitch/roll（度）でワールド軸まわりに指定する。カメラは正面固定。
      const D = Math.PI / 180;
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 0, 1), iq('roll', -2) * D)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), iq('pitch', -5) * D))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), iq('yaw', -8) * D))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      this.pivot.quaternion.copy(q);
      this.candleB.position.set(iq('icx', 0.42), iq('icy', 0.34), iq('icz', 0.72));
      this.candleB.intensity = iq('ici', 2.4);
      if (this.iconKey) this.iconKey.intensity = iq('ikey', 2.0);
      this.rimB.intensity = iq('irim', 0.30);
      this.renderer.toneMappingExposure = iq('iexp', 1.32);
      if (this.gradePass) this.gradePass.uniforms.uVig.value = iq('ivig', 0.08);
      const fov = iq('fov', 38);
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      cam.position.set(0, 0, iq('dist', 1.02));
      cam.lookAt(0, 0, 0);
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, cam);
      if (this.capture) { const cb = this.capture; this.capture = null; cb(''); }
      return;
    }
    if (opts.diving) {
      const k = Math.min(opts.diveT / DIVE_DUR, 1), e2 = k * k * k * (k * (6 * k - 15) + 10);
      // 潜りは「表紙が開く間に寄せた距離」(CAM_R-0.26) から始める。CAM_R から始めると一瞬引いてガクッとなる（2026-09-07 夜 KEI指摘）
      const r = (CAM_R - 0.26) * (1 - e2) + 0.155 * e2, th = this.camTheta, ph = this.camPhi * (1 - e2) + 0.12 * e2;
      cam.position.set(r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph), r * Math.sin(ph) * Math.cos(th));
      this.nearLook(e2, 0.01);
      // 本の中へ潜るほど視野が広がる（覗き込む歪み）
      const fov = 38 + 20 * (k * k);
      if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
      this.frameOpenBook(1 - e2);
    } else if (opts.camOverride) {
      const { r, ph } = opts.camOverride, th = this.camTheta;
      cam.position.set(r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph), r * Math.sin(ph) * Math.cos(th));
      this.nearLook(opts.camOverride.near || 0, 0.01);
      this.frameOpenBook(1);
    } else {
      const hx = QUALITY ? Math.sin(t * 0.37) * 0.004 + Math.sin(t * 0.91 + 1.0) * 0.002 : 0;
      const hy = QUALITY ? Math.sin(t * 0.53 + 1.0) * 0.003 : 0;
      cam.position.set(
        CAM_R * Math.sin(this.camPhi) * Math.sin(this.camTheta) + sx0,
        CAM_R * Math.cos(this.camPhi) + sy0,
        CAM_R * Math.sin(this.camPhi) * Math.cos(this.camTheta),
      );
      cam.lookAt(this.tiltCur.x * 0.02 + hx, this.tiltCur.y * 0.015 + hy, 0);
    }

    if (this.divePass) {   // dive: 潜りの最初の 40% で入り、暗転まで保つ。潜っていない時は止める
      const amt = opts.diving ? diveBlurAmt(opts.diveT / DIVE_DUR) : 0;
      // 最初の1コマだけ強さ 0 で通しておく（シェーダーの準備を潜りの瞬間にしない＝引っかかり防止。見た目は変わらない）
      this.divePass.enabled = amt > 0.001 || !this.divePrimed;
      this.divePrimed = true;
      if (this.divePass.enabled) {
        const u = this.divePass.uniforms;
        cam.updateMatrixWorld();
        this._dv.copy(this.pivot.position).project(cam);
        u.uCenter.value.set(Math.max(0.15, Math.min(0.85, this._dv.x * 0.5 + 0.5)), Math.max(0.15, Math.min(0.85, this._dv.y * 0.5 + 0.5)));
        u.uAspect.value = cam.aspect; u.uAmt.value = amt; u.uTime.value = t;
      }
    }
    if (this.bookScale > 0.002 || this.keepAmbience) {
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, cam);
    }
    if (this.capture) {
      const cb = this.capture; this.capture = null;
      let url = '';
      try { url = this.renderer.domElement.toDataURL('image/jpeg', 0.62); } catch { /* noop */ }
      cb(url);
    }
  }

  /**
   * カメラを本の中心（pivot）へ BOOK_SIZE の比率で寄せてから注視する。near=0 で従来どおり、near=1 で完全に比率どおり。
   * 本を縮めても、潜りの終わり（読書画面へのマッチカット）の見え方が変わらないようにするため。
   */
  /** cover（2026-10-20）: 開いた本の外形（Box3）の中心が画面の横中央に来るよう、カメラを右ベクトル方向へ平行移動（向きは変えない） */
  private frameOpenBook(fade: number): void {
    if (!FX_COVER || !this.mixer || !this.hinge || !this.book || COVER_FRAME <= 0) return;
    const k = THREE.MathUtils.clamp(this.hinge.rotation.z / Math.max(1e-3, this.coverMax), 0, 1);
    const w = k * k * (3 - 2 * k) * fade * COVER_FRAME;
    if (w < 1e-3) return;
    const cam = this.camera;
    cam.updateMatrixWorld();
    // 本体のメッシュ（表紙・紙の束・背・裏表紙）の局所の外形箱の8隅を画面へ投影し、左右の端の中点を画面の中央へ。
    // book 直下には栞・机の影なども付くので含めない。世界の軸の箱だと回った時に空の隅まで数えて引きすぎた
    const meshes: THREE.Mesh[] = [];
    for (const nm of ['CoverHinge', 'Pages', 'Spine', 'Cover_Back']) {
      this.book.getObjectByName(nm)?.traverse(c => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); });
    }
    if (!meshes.length) return;
    const ext = (): [number, number] => {
      let lo = Infinity, hi = -Infinity;
      _frameBB.makeEmpty();
      for (const m of meshes) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox!;
        for (let i = 0; i < 8; i++) {
          _frameR.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld);
          _frameBB.expandByPoint(_frameR);
          _frameR.project(cam);
          lo = Math.min(lo, _frameR.x); hi = Math.max(hi, _frameR.x);
        }
      }
      return [lo, hi];
    };
    let [lo, hi] = ext();
    _frameBB.getCenter(_frameC);
    const dist = _frameC.distanceTo(cam.position);
    // 幅が画面（左右 4% の余白）に収まらない時だけ、その分だけ後ろへ引く（正面寄りの角度で開いた本は縦画面より広い）
    const span = (hi - lo) / 2 / 0.96;
    if (span > 1) {
      _frameR.setFromMatrixColumn(cam.matrixWorld, 2);
      cam.position.addScaledVector(_frameR, dist * (span - 1) * w);
      cam.updateMatrixWorld();
      [lo, hi] = ext();
    }
    // 左右の端の中点を画面の中央へ（引いた後の見え方で測り直す）
    const d2 = _frameC.distanceTo(cam.position);
    const half = d2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect;
    _frameR.setFromMatrixColumn(cam.matrixWorld, 0);
    cam.position.addScaledVector(_frameR, (lo + hi) / 2 * half * w);
    cam.updateMatrixWorld();
  }
  private nearLook(near: number, ty: number): void {
    const cam = this.camera;
    const f = 1 - (1 - BOOK_SIZE) * Math.max(0, Math.min(1, near));
    if (f === 1) { cam.lookAt(0, ty, 0); return; }
    const P = this.pivot.position;
    cam.position.set(P.x + (cam.position.x - P.x) * f, P.y + (cam.position.y - P.y) * f, P.z + (cam.position.z - P.z) * f);
    cam.lookAt(P.x + (0 - P.x) * f, P.y + (ty - P.y) * f, P.z + (0 - P.z) * f);
  }

  private _dv = new THREE.Vector3();
  /** d: 漂う光の共有 uniform（光だまり・明滅・本の箱・時刻）を入れる */
  private graceStep(wdt: number, t: number): void {
    const P = this.pivot.position, C = this.candleB.position;
    GLOW_U.uLight.value.set(P.x + (C.x - P.x) * 0.5, P.y + (C.y - P.y) * 0.5, P.z + (C.z - P.z) * 0.5);
    GLOW_U.uFlicker.value = this.candleB.intensity / CANDLE_I;
    GLOW_U.uTime.value = t;
    this.renderer.getDrawingBufferSize(this._v2);
    GLOW_U.uViewH.value = this._v2.y;
    if (this.book && (t - this.graceBoxT > 0.25 || t < this.graceBoxT)) {   // 本の箱は 4Hz で十分（開く時は表紙が動く）
      this.graceBoxT = t;
      // 本の部品（名前のあるメッシュ）だけ。影の受け板や栞（名前なし）は入れない
      this._bb.makeEmpty();
      this.book.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.name || !m.visible) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        this._bb2.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
        this._bb.union(this._bb2);
      });
      if (!this._bb.isEmpty()) { this._bb.getCenter(GLOW_U.uBoxC.value); this._bb.getSize(GLOW_U.uBoxH.value).multiplyScalar(0.5); }
    }
    this.grace!.step(wdt, this.dust.visible && !ICON, Math.min(1, this.bookScale));
  }
  private _v2 = new THREE.Vector2();
  private _bb = new THREE.Box3(); private _bb2 = new THREE.Box3();

  /** 開く演出が終わったら描画設定を平常へ戻す */
  resetOpenFX(): void {
    if (this.camera.fov !== 38) { this.camera.fov = 38; this.camera.updateProjectionMatrix(); }
    this.openFlare = 0; this.gild = 0;
    this.flareA.intensity = 0; this.flareB.intensity = 0;
    if (this.bloomPass) this.bloomPass.strength = BLOOM_BASE;
    if (this.divePass) { this.divePass.enabled = false; this.divePass.uniforms.uAmt.value = 0; }
    this.renderer.toneMappingExposure = 0.72;
    if (this.gradePass) this.gradePass.uniforms.uVig.value = QP.get('q_vig') ? +QP.get('q_vig')! : 0.30;
    if (this.titleSweep) this.titleSweep.visible = false;
    if (this.titleDecal) (this.titleDecal.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
  }

  static readonly CAM_R = CAM_R;
  static readonly BOOK_SIZE = BOOK_SIZE;
  static readonly DIVE_DUR = DIVE_DUR;
  static readonly QUALITY = QUALITY;
}
