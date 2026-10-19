// ============================================================
// 光の粒のスプライト化（2026-10-19 beta・KEI「粒が安っぽい」）
//   丸い点（PointsMaterial＋自前の放射グラデ）→ Kenney Particle Pack（CC0）の画像を貼った点に替える。
//   方針: 少なく・小さく・ゆっくり・紙と炎の間の褐色〜淡い金・加算は弱く。
//   大きさは頂点ごとにばらつかせ、本（焦点）から前後に離れた粒ほど柔らかい玉へ寄せて薄くする＝ボケ。
//
//   ?motes=d  自前シェーダーの光（2026-10-20・画像を使わない・芯＋淡い暈の2段・灯りの中だけ光る） ← 既定
//   ?motes=a  ボケ玉（light_01）
//   ?motes=b  細い光の筋・火の粉（trace_05・進む向きに回す・斜めに流れる）
//   ?motes=c  粒を撒かず、本の周りを数粒のほたるがゆっくり漂う（circle_05）
//   ?motes=old または ?fx=0  旧（丸い点）
//   塵（dust）は old 以外で不定形の埃（smoke_05）に替える。
//
//   既存コードはそのまま material.opacity を書き換えればよい（onBeforeRender で uniform に写す）。
// ============================================================
import * as THREE from 'three';
import { asset, QP, MOBILE } from '../state';

export type MotesKind = 'old' | 'a' | 'b' | 'c' | 'd';
export const MOTES: MotesKind = (() => {
  const q = QP.get('motes');
  if (q === 'a' || q === 'b' || q === 'c' || q === 'd' || q === 'old') return q;
  if (QP.get('fx') === '0') return 'old';
  return 'd';
})();
/** 粒の数の倍率（旧の 6.5 割・d は少なく良くの 4.5 割） */
export const MOTES_COUNT_K = MOTES === 'old' ? 1 : MOTES === 'd' ? 0.45 : 0.65;
/** 動く速さの倍率（ゆっくり） */
export const MOTES_SPEED = MOTES === 'old' ? 1 : 0.7;
/** b だけ、右上へ斜めに流す風（m/s²相当・速度へ毎秒足す） */
export const MOTES_WIND_X = MOTES === 'b' ? 0.014 : 0;

export type SpriteStyle = 'bokeh' | 'ember' | 'speck' | 'glow';

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
function tex(name: string): THREE.Texture {
  let t = cache.get(name);
  if (!t) {
    t = loader.load(asset('fx/' + name + '.png'));
    t.colorSpace = THREE.NoColorSpace;          // 明るさのデータとして使う
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    cache.set(name, t);
  }
  return t;
}

const VERT = /* glsl */`
uniform float uSize, uScale, uTime, uFocus, uRange, uSpin, uStretch;
attribute float aSize; attribute float aSeed;
#ifdef USE_VEL
attribute vec3 aVel;
#endif
varying float vBlur; varying float vSeed; varying float vAng;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(0.05, -mv.z);
  vBlur = clamp(abs(d - uFocus) / uRange, 0.0, 1.0);
  vSeed = aSeed;
  // ボケた粒は少しだけ大きく（ただし遠いぶんの縮みはそのまま）
  gl_PointSize = max(1.0, uSize * aSize * (1.0 + vBlur * 0.6) * uScale / d);
#ifdef USE_VEL
  vec4 p2 = projectionMatrix * modelViewMatrix * vec4(position + aVel * 0.08, 1.0);
  vec2 dd = p2.xy / p2.w - gl_Position.xy / gl_Position.w;
  dd.x *= projectionMatrix[1][1] / projectionMatrix[0][0];
  vAng = (length(dd) > 1e-6 ? atan(dd.y, dd.x) : 1.5708) - 1.5708;
#else
  vAng = aSeed * 6.2832 + uTime * uSpin * (aSeed - 0.5);
#endif
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap, uSoft; uniform vec3 uColA, uColB; uniform float uOpacity, uTime, uGain, uTw, uBlurMix;
varying float vBlur; varying float vSeed; varying float vAng;
void main() {
  vec2 c = vec2(gl_PointCoord.x - 0.5, 0.5 - gl_PointCoord.y);
  float s = sin(-vAng), co = cos(-vAng);
  vec2 uv = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;
  float sharp = texture2D(uMap, uv).r;
  float soft = texture2D(uSoft, c + 0.5).r * 0.75;
  float lum = mix(sharp, soft, vBlur * uBlurMix);
  // ゆっくり瞬く（3〜8秒周期・振れ幅は小さく）
  float tw = 1.0 - uTw + uTw * (0.5 + 0.5 * sin(uTime * (0.8 + vSeed * 1.2) + vSeed * 40.0));
  float a = lum * uOpacity * uGain * tw * (1.0 - vBlur * 0.55);
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(uColA, uColB, fract(vSeed * 7.13)), a);
}`;

interface Look { map: string; soft: string; colA: number; colB: number; gain: number; additive: boolean; spin: number; vel: boolean }
const LOOK: Record<SpriteStyle, Look> = {
  // 淡い金〜紙の褐色。加算でも gain を抑えて白飛びさせない
  bokeh: { map: 'bokeh', soft: 'glow', colA: 0xe8cf9c, colB: 0xb88a52, gain: 1.0, additive: true, spin: 0.15, vel: false },
  ember: { map: 'ember', soft: 'glow', colA: 0xf0c27e, colB: 0xc0763a, gain: 1.2, additive: true, spin: 0, vel: true },
  glow: { map: 'glow', soft: 'glow', colA: 0xf3dca6, colB: 0xd9b070, gain: 1.6, additive: true, spin: 0, vel: false },
  // 塵は光らない。紙の褐色で通常合成
  speck: { map: 'speck', soft: 'glow', colA: 0xd8b878, colB: 0x9c7a4c, gain: 1.0, additive: false, spin: 0.25, vel: false },
};

const _v = new THREE.Vector2();

/**
 * 既にある THREE.Points の見た目をスプライトに替える。頂点ごとの大きさ・種を足す。
 * vel を渡すと（ember）進む向きに筋を回す。vel は毎フレーム GPU へ送り直す（同じ配列を共有）。
 */
export function equipSprites(pts: THREE.Points, style: SpriteStyle, size: number, opts: { vel?: Float32Array; twinkle?: number; focus?: number; range?: number; sizeMin?: number; sizeMax?: number } = {}): void {
  const L = LOOK[style];
  const geo = pts.geometry as THREE.BufferGeometry;
  const n = geo.attributes.position.count;
  const aSize = new Float32Array(n), aSeed = new Float32Array(n);
  const lo = opts.sizeMin ?? 0.45, hi = opts.sizeMax ?? 1.6;
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    aSize[i] = lo + (hi - lo) * r * r * r;       // ほとんど小さく、ときどき大きい
    aSeed[i] = Math.random();
  }
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  const useVel = L.vel && !!opts.vel;
  if (useVel) geo.setAttribute('aVel', new THREE.BufferAttribute(opts.vel!, 3));
  const old = pts.material as THREE.Material;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex(L.map) }, uSoft: { value: tex(L.soft) },
      uColA: { value: new THREE.Color(L.colA) }, uColB: { value: new THREE.Color(L.colB) },
      uSize: { value: size }, uScale: { value: 400 }, uTime: { value: 0 },
      uFocus: { value: opts.focus ?? 1.55 }, uRange: { value: opts.range ?? 0.9 },
      uSpin: { value: L.spin }, uStretch: { value: 1 },
      uOpacity: { value: old.opacity }, uGain: { value: L.gain }, uTw: { value: opts.twinkle ?? 0.22 }, uBlurMix: { value: L.vel ? 0.3 : 0.85 },
    },
    vertexShader: VERT, fragmentShader: FRAG,
    defines: useVel ? { USE_VEL: '' } : {},
    transparent: true, depthWrite: false,
    blending: L.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  mat.opacity = old.opacity;
  old.dispose();
  pts.material = mat;
  pts.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(_v);
    const u = mat.uniforms;
    u.uScale.value = _v.y * 0.5;
    u.uTime.value = performance.now() / 1000;
    u.uOpacity.value = mat.opacity;
    if (useVel) (geo.attributes.aVel as THREE.BufferAttribute).needsUpdate = true;
  };
}

/** ?motes=c: 本の周りを数粒だけ、羽虫のようにゆっくり漂う光 */
export class Fireflies {
  readonly pts: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private prm: Float32Array;   // 1粒につき 8: 半径, 高さ, 位相, 周期x, 周期y, 周期z, 明滅周期, 明滅位相
  private level = 0;
  constructor(parent: THREE.Object3D) {
    this.n = MOBILE ? 6 : 7;
    this.pos = new Float32Array(this.n * 3);
    this.prm = new Float32Array(this.n * 8);
    for (let i = 0; i < this.n; i++) {
      const p = this.prm, o = i * 8;
      p[o] = 0.07 + Math.random() * 0.12;              // 漂う輪の半径
      p[o + 1] = -0.10 + Math.random() * 0.22;         // 高さ
      p[o + 2] = (i / this.n) * Math.PI * 2 + Math.random() * 0.6;
      p[o + 3] = 9 + Math.random() * 8;                // 周回（秒）…とてもゆっくり
      p[o + 4] = 5 + Math.random() * 5;
      p[o + 5] = 3 + Math.random() * 4;
      p[o + 6] = 3.5 + Math.random() * 3.5;            // 明滅（秒）
      p[o + 7] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.pts = new THREE.Points(geo, new THREE.PointsMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    equipSprites(this.pts, 'glow', 0.034, { sizeMin: 0.6, sizeMax: 1.2, twinkle: 0.65 });
    this.pts.visible = false;
    this.pts.frustumCulled = false;
    parent.add(this.pts);
  }
  /** show: 出していい時（本が出ている）。fade は 0..1（本の出現に合わせる） */
  private base = new THREE.Vector3();
  /** center=本の中心。輪は本からカメラへ 0.4 寄せた所に置く（本の陰に隠れない・縦画面に収まる） */
  step(dt: number, t: number, center: THREE.Vector3, camPos: THREE.Vector3, show: boolean, fade: number): void {
    const target = show ? fade : 0;
    this.level += (target - this.level) * Math.min(1, dt / 1.2);
    this.pts.visible = this.level > 0.01;
    if (!this.pts.visible) return;
    const p = this.prm;
    const b = this.base.copy(camPos).sub(center).normalize().multiplyScalar(0.4).add(center);
    for (let i = 0; i < this.n; i++) {
      const o = i * 8;
      const th = p[o + 2] + (t / p[o + 3]) * Math.PI * 2;
      const r = p[o] * (1 + 0.18 * Math.sin(t / p[o + 4] * 6.28 + i));
      this.pos[i * 3] = b.x + Math.cos(th) * r + 0.02 * Math.sin(t * 1.3 + i * 2.1);
      this.pos[i * 3 + 1] = b.y + p[o + 1] + 0.05 * Math.sin(t / p[o + 5] * 6.28 + i) + 0.012 * Math.sin(t * 2.7 + i);
      this.pos[i * 3 + 2] = b.z + Math.sin(th) * r * 0.6;
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    // 明滅は shader の瞬き（tw）に任せ、全体の濃さだけここで決める
    (this.pts.material as THREE.ShaderMaterial).opacity = 0.75 * this.level;
  }
}

// ============================================================
// ?motes=d（2026-10-20 beta・KEI「光のパーティクルもちゃっちいのをちょっといいバージョンに」）
//   画像を貼らず、点ごとにシェーダーで光を描く。参照: Ori の精霊の光／エルデンリング祝福の金の粒／
//   フェルメールの室内の蝋燭に浮く埃。方針は「少なく・良く」。
//   - 形: きつい芯（ガウス）＋広くごく薄い暈（指数）の2段。焦点から外れるほど柔らかい円盤（ボケ）へ移る
//   - 色: 芯は蝋燭の琥珀、暈はわずかに淡い金。白と虹は出さない
//   - 灯り: 蝋燭と本の間の「光だまり」からの距離で明るさが落ちる＝光を横切る時だけ見える（Codex 助言）
//   - 明滅: シーンの蝋燭の揺らぎ（candleB.intensity）に緩く同期＋粒ごとの遅い揺らぎ
//   - 深さ: 本の箱との距離で消える（本に刺さって見切れない）・カメラ直前でも消える
//   - 寿命: 7〜15秒で生まれて消える（入り・抜けともにゆっくり）
//   動きは GPU（頂点シェーダー）で時間から計算するので、毎フレームの CPU 仕事は uniform の更新だけ。
// ============================================================

/** d の粒が共有する uniform（BookScene が毎フレーム入れる） */
export const GLOW_U = {
  uLight: { value: new THREE.Vector3(0.14, 0.22, 0.15) },   // 光だまりの中心（world）
  uFlicker: { value: 1 },                                   // 蝋燭の明滅 1 前後
  uBoxC: { value: new THREE.Vector3(0, 0.1, 0) },           // 本の箱（world・軸平行）
  uBoxH: { value: new THREE.Vector3(0.0001, 0.0001, 0.0001) },
  uTime: { value: 0 },
  uViewH: { value: 860 },                                   // 描画バッファの高さ（px）
};

const GLOW_FRAG = /* glsl */`
uniform vec3 uCore, uHalo;
varying float vA; varying float vBlur;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;                        // 0=中心 1=点の縁
  if (r >= 1.0) discard;
  float edge = 1.0 - smoothstep(0.7, 1.0, r);       // 暈が四角く切れないよう縁で落とす
  float core = exp(-r * r * 34.0);                  // きつい芯
  float halo = exp(-r * 4.0) * 0.12;                // 広くごく薄い暈
  float disc = (1.0 - smoothstep(0.55, 0.92, r)) * (0.8 + 0.2 * smoothstep(0.3, 0.8, r)) * 0.20;   // ボケ玉（縁がわずかに立つ）
  float s = mix(core * 1.5 + halo, disc, vBlur);
  float a = s * edge * vA;
  if (a < 0.002) discard;
  // 芯は琥珀・暈は淡い金。ボケ玉は琥珀寄り（淡い金のままだと暗い背景で灰色の「レンズの汚れ」に見えた）
  vec3 col = mix(uHalo, uCore, mix(clamp(core * 1.6, 0.0, 1.0), 0.7, vBlur));
  gl_FragColor = vec4(col, a);
}`;

/** 頂点側の共通部分: 位置 wp(world) と大きさから、ボケ・灯り・深さの消え・点の大きさを決める */
const GLOW_COMMON = /* glsl */`
uniform vec3 uLight, uBoxC, uBoxH; uniform float uFlicker, uTime, uViewH;
uniform float uSize, uFocus, uRange, uLightR, uFloor, uOpacity, uBokehK; uniform vec2 uNF;
varying float vA; varying float vBlur;
float glowSetup(vec3 wp, float sz, float seed) {
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(0.05, -mv.z);
  float blur = clamp(abs(d - uFocus) / uRange, 0.0, 1.0);
  blur = blur * blur * (3.0 - 2.0 * blur);
  vBlur = blur;
  // 光だまりからの距離（光を横切る時だけ見える）
  vec3 dl = wp - uLight;
  float L = uFloor + (1.0 - uFloor) * exp(-dot(dl, dl) / (uLightR * uLightR));
  // 本の箱との距離（刺さる前に消える）
  vec3 q = abs(wp - uBoxC) - uBoxH;
  float sd = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  float bf = smoothstep(0.0, 0.035, sd);
  float nf = smoothstep(uNF.x, uNF.y, d);           // カメラ直前（漂う光は本より手前のボケ玉が本に被らないよう広めに消す）
  // 蝋燭に緩く同期した明滅＋粒ごとの遅い揺らぎ
  float fl = mix(1.0, uFlicker, 0.75) * (0.80 + 0.20 * sin(uTime * (0.55 + seed * 1.1) + seed * 51.0));
  // ボケるほど大きく・薄く（光の量はおおよそ保つが、玉は控えめに）
  float grow = 1.0 + blur * uBokehK;
  gl_PointSize = clamp(uSize * sz * grow * projectionMatrix[1][1] * uViewH * 0.5 / d, 1.0, 160.0);
  return L * bf * nf * fl * uOpacity / (1.0 + blur * (uBokehK * 0.55));
}`;

interface GlowOpts { core?: number; halo?: number; focus?: number; range?: number; lightR?: number; floor?: number; bokehK?: number; nf?: [number, number] }
function glowUniforms(size: number, o: GlowOpts): Record<string, THREE.IUniform> {
  return {
    ...GLOW_U,
    uCore: { value: new THREE.Color(o.core ?? 0xffb760) }, uHalo: { value: new THREE.Color(o.halo ?? 0xf2d08a) },
    uSize: { value: size }, uFocus: { value: o.focus ?? 1.55 }, uRange: { value: o.range ?? 0.9 },
    uNF: { value: new THREE.Vector2(...(o.nf ?? [0.18, 0.42])) }, uLightR: { value: o.lightR ?? 0.34 }, uFloor: { value: o.floor ?? 0.06 }, uOpacity: { value: 1 }, uBokehK: { value: o.bokehK ?? 2.2 },
  };
}

/** GPU で動かす: 寿命の中で生まれ・昇り・消える。昇りは発散なしの流れ場（curl 的）で揺らし、2割は螺旋 */
const MOTION_VERT = /* glsl */`
attribute vec4 aP;   // seed, 寿命, 大きさ, 螺旋
float h1(float n) { return fract(sin(n) * 43758.5453); }
// 各成分が他の軸だけに依存する場 → 発散 0（渦を巻くだけで、集まったり散ったりしない）
vec3 flow(vec3 p, float t) {
  return vec3(sin(p.y * 3.1 + t * 0.21) + cos(p.z * 2.3 - t * 0.17),
              0.5 * (sin(p.z * 2.7 + t * 0.19) + cos(p.x * 3.3 + t * 0.13)),
              sin(p.x * 2.9 - t * 0.23) + cos(p.y * 2.1 + t * 0.15));
}
void main() {
  float seed = aP.x, per = aP.y;
  float u = uTime / per + seed;
  float ph = fract(u), cyc = floor(u);
  // 生まれ直すたびに少し違う場所から
  vec3 j = vec3(h1(cyc * 12.9 + seed * 78.2), h1(cyc * 4.1 + seed * 31.7), h1(cyc * 7.7 + seed * 11.3)) - 0.5;
#ifdef FAR
  vec3 base = position + j * vec3(0.25, 0.2, 0.0);
  vec3 p = base + vec3(0.0, ph * 0.10, 0.0) + flow(base * 0.6, uTime * 0.6) * 0.03;
  vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
#else
  vec3 base = position + j * vec3(0.22, 0.10, 0.22);
  float rise = 0.10 + h1(seed * 91.0) * 0.16;
  vec3 p = base + vec3(0.0, ph * rise, 0.0) + flow(base * 1.4 + vec3(0.0, ph * 0.4, 0.0), uTime) * 0.022;
  if (aP.w > 0.5) {   // ゆるい螺旋（寿命の中ほどだけ）
    float w = uTime * (0.5 + seed * 0.4) + seed * 6.28, rr = 0.018 * sin(3.14159 * ph);
    p += vec3(cos(w) * rr, 0.0, sin(w) * rr);
  }
  vec3 wp = p;
#endif
  float life = smoothstep(0.0, 0.28, ph) * (1.0 - smoothstep(0.62, 1.0, ph));
  vA = glowSetup(wp, aP.z, seed) * life;
}`;

/**
 * 既にある CPU で動かす点（開く時の吸い込み・本の出現の粒）を d の光に替える。
 * 呼び出し側はこれまでどおり material.opacity を書けばよい。
 */
export function equipGlow(pts: THREE.Points, size: number, o: GlowOpts = {}): void {
  const geo = pts.geometry as THREE.BufferGeometry;
  const n = geo.attributes.position.count;
  const aSize = new Float32Array(n), aSeed = new Float32Array(n);
  for (let i = 0; i < n; i++) { const r = Math.random(); aSize[i] = 0.55 + 1.0 * r * r * r; aSeed[i] = Math.random(); }
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  const old = pts.material as THREE.Material;
  const mat = new THREE.ShaderMaterial({
    uniforms: glowUniforms(size, o),
    vertexShader: GLOW_COMMON + `
attribute float aSize; attribute float aSeed;
void main() {
  vA = glowSetup((modelMatrix * vec4(position, 1.0)).xyz, aSize, aSeed);
}`,
    fragmentShader: GLOW_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  mat.opacity = old.opacity;
  old.dispose();
  pts.material = mat;
  pts.frustumCulled = false;
  pts.onBeforeRender = () => { mat.uniforms.uOpacity.value = mat.opacity; };
}

/**
 * d の常に漂う光（塵の代わり）。2群:
 *   near … 本の周りの空気（world）。小さく鋭い点が多く、2割はゆるく螺旋を描く。灯りの中だけ光る
 *   far  … カメラの子・本より奥の数粒の大きなボケ玉。とても薄い
 */
export class GraceMotes {
  readonly near: THREE.Points;
  readonly far: THREE.Points;
  private nearMat: THREE.ShaderMaterial; private farMat: THREE.ShaderMaterial;
  private level = 0;
  constructor(scene: THREE.Object3D, camera: THREE.Object3D) {
    const NN = MOBILE ? 54 : 80, NF = MOBILE ? 4 : 6;
    // ---- near ----
    const pos = new Float32Array(NN * 3), prm = new Float32Array(NN * 4);
    const g = (): number => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    for (let i = 0; i < NN; i++) {
      // 光だまり（本の右上手前）寄りに撒く。外にも少し（光を横切って入ってくる粒）
      pos[i * 3] = 0.10 + g() * 0.50;
      pos[i * 3 + 1] = 0.10 + Math.random() * 0.36;
      pos[i * 3 + 2] = 0.10 + g() * 0.50;
      const r = Math.random();
      prm[i * 4] = Math.random();                       // seed
      prm[i * 4 + 1] = 7 + Math.random() * 8;           // 寿命（秒）
      prm[i * 4 + 2] = 0.55 + 0.9 * r * r * r;          // 大きさ（ほとんど小さい）
      prm[i * 4 + 3] = Math.random() < 0.2 ? 1 : 0;     // 1=螺旋
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aP', new THREE.BufferAttribute(prm, 4));
    this.nearMat = new THREE.ShaderMaterial({
      uniforms: glowUniforms(0.017, { focus: 1.55, range: 1.2, lightR: 0.45, floor: 0.1, nf: [0.6, 1.05] }),
      vertexShader: GLOW_COMMON + MOTION_VERT, fragmentShader: GLOW_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.near = new THREE.Points(geo, this.nearMat);
    this.near.frustumCulled = false; this.near.visible = false;
    scene.add(this.near);
    // ---- far（カメラ座標・本より奥 2.0〜2.7）----
    const fp = new Float32Array(NF * 3), fprm = new Float32Array(NF * 4);
    for (let i = 0; i < NF; i++) {
      const z = 2.0 + Math.random() * 0.7;
      fp[i * 3] = (Math.random() - 0.5) * 0.55 * z;
      fp[i * 3 + 1] = (Math.random() - 0.35) * 0.6 * z;
      fp[i * 3 + 2] = -z;
      fprm[i * 4] = Math.random(); fprm[i * 4 + 1] = 11 + Math.random() * 8; fprm[i * 4 + 2] = 0.8 + Math.random() * 0.5; fprm[i * 4 + 3] = 0;
    }
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    fgeo.setAttribute('aP', new THREE.BufferAttribute(fprm, 4));
    this.farMat = new THREE.ShaderMaterial({
      uniforms: glowUniforms(0.015, { focus: 1.55, range: 0.7, floor: 1, bokehK: 1.6 }),
      vertexShader: GLOW_COMMON + MOTION_VERT, fragmentShader: GLOW_FRAG,
      defines: { FAR: '' },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.far = new THREE.Points(fgeo, this.farMat);
    this.far.frustumCulled = false; this.far.visible = false;
    this.far.renderOrder = -5;
    camera.add(this.far);
  }
  /** show: 出していい時。fade 0..1（本の出現に合わせる） */
  step(dt: number, show: boolean, fade: number): void {
    const target = show ? fade : 0;
    this.level += (target - this.level) * Math.min(1, dt / 0.9);
    const on = this.level > 0.01;
    this.near.visible = on; this.far.visible = on;
    this.nearMat.uniforms.uOpacity.value = 0.95 * this.level;
    this.farMat.uniforms.uOpacity.value = 0.42 * this.level;
  }
}
