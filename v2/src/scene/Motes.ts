// ============================================================
// 光の粒のスプライト化（2026-10-19 beta・KEI「粒が安っぽい」）
//   丸い点（PointsMaterial＋自前の放射グラデ）→ Kenney Particle Pack（CC0）の画像を貼った点に替える。
//   方針: 少なく・小さく・ゆっくり・紙と炎の間の褐色〜淡い金・加算は弱く。
//   大きさは頂点ごとにばらつかせ、本（焦点）から前後に離れた粒ほど柔らかい玉へ寄せて薄くする＝ボケ。
//
//   ?motes=a  ボケ玉（light_01）           ← 既定
//   ?motes=b  細い光の筋・火の粉（trace_05・進む向きに回す・斜めに流れる）
//   ?motes=c  粒を撒かず、本の周りを数粒のほたるがゆっくり漂う（circle_05）
//   ?motes=old または ?fx=0  旧（丸い点）
//   塵（dust）は old 以外で不定形の埃（smoke_05）に替える。
//
//   既存コードはそのまま material.opacity を書き換えればよい（onBeforeRender で uniform に写す）。
// ============================================================
import * as THREE from 'three';
import { asset, QP, MOBILE } from '../state';

export type MotesKind = 'old' | 'a' | 'b' | 'c';
export const MOTES: MotesKind = (() => {
  const q = QP.get('motes');
  if (q === 'a' || q === 'b' || q === 'c' || q === 'old') return q;
  if (QP.get('fx') === '0') return 'old';
  return 'a';
})();
/** 粒の数の倍率（旧の 6.5 割） */
export const MOTES_COUNT_K = MOTES === 'old' ? 1 : 0.65;
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
