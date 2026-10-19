// ============================================================
// 試作版（beta 2026-10-19）の入口演出シェーダー。state.ts の fxOn('smoke' / 'etch') が ON の時だけ BookScene が使う。
//   どちらも自前で書いたもの（Shadertoy 等のコードは使っていない）。
// ============================================================
import * as THREE from 'three';

/** ろうそくの細い煙。値ノイズの fbm を UV で上へゆっくり流し、細い柱の形で切り抜く。薄く・ゆっくり */
export const SmokeShader = {
  uniforms: {
    uTime: { value: 0 },
    uOpacity: { value: 0.26 },
    uColor: { value: new THREE.Color(0.62, 0.57, 0.50) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform float uTime, uOpacity; uniform vec3 uColor; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 3; k++) { s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
    void main(){
      float y = vUv.y, t = uTime;
      // 立ち昇るほど揺れて広がる。根元はほぼ一本
      // 根元はまっすぐ細く、上へ行くほど二つの周期で揺れて巻く（plane の幅いっぱいまでは振らない）
      float yy = y * y;
      float sway = (fbm(vec2(y * 2.6 - t * 0.06, t * 0.025)) - 0.5) * 0.70 * yy
                 + sin(y * 7.0 - t * 0.45) * 0.07 * yy + sin(y * 3.1 - t * 0.21 + 1.3) * 0.05 * y;
      float x = vUv.x - 0.5 - sway;
      float w = mix(0.012, 0.24, pow(y, 1.5));
      float col = 1.0 - smoothstep(0.0, w, abs(x));
      float n = fbm(vec2(x * 7.0, y * 3.5 - t * 0.12));
      float wisp = smoothstep(0.26, 0.70, n + (1.0 - y) * 0.30);
      float fade = smoothstep(0.0, 0.06, y) * (1.0 - smoothstep(0.62, 1.0, y));
      float a = col * wisp * fade * uOpacity;
      if (a < 0.002) discard;
      gl_FragColor = vec4(uColor, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/**
 * 銅版画風（etch）の後処理。ブルームの後・Grade の前の1枚（入力はトーンマップ前の線形色）。
 *   2026-10-19 夜: 画面に固定の斜線は外した（線は applySurfaceEtch で本の表面に彫る）。ここに残すのは
 *   ・Roberts の対角差分（4回の参照）で輪郭を薄く
 *   ・彩度を少し落とす
 */
export const EtchShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uPx: { value: 1 },          // 画素比（互換のため残す）
    uEdge: { value: 0.22 },     // 輪郭の濃さ
    uSat: { value: 0.86 },      // 彩度（1 = そのまま）
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uPx, uEdge, uSat; varying vec2 vUv;
    float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main(){
      vec2 texel = 1.0 / vec2(textureSize(tDiffuse, 0));
      vec4 c = texture2D(tDiffuse, vUv);
      float l = pow(clamp(lum(c.rgb) * 0.72, 0.0, 1.0), 1.0 / 2.2);
      vec2 o = texel * 1.25;
      float a = lum(texture2D(tDiffuse, vUv + vec2(-o.x, -o.y)).rgb), b = lum(texture2D(tDiffuse, vUv + vec2(o.x, o.y)).rgb);
      float e = lum(texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb), f = lum(texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb);
      float edge = smoothstep(0.035, 0.16, length(vec2(a - b, e - f)) / (0.15 + l));
      vec3 col = mix(vec3(lum(c.rgb)), c.rgb, uSat);
      col = mix(col, col * vec3(0.30, 0.24, 0.19), clamp(edge * uEdge, 0.0, 0.9));
      gl_FragColor = vec4(col, c.a);
    }`,
};

/**
 * 表面の銅版画（etch・2026-10-19 夜）。本のマテリアルに onBeforeCompile で差し込み、線を「物体の座標」に彫る。
 *   ・座標: 物体（ジオメトリ）空間の位置を、面の向きで一番近い面へ投影（表紙=XZ・背/小口=ZY・天地=XY）＝本が回っても線は本に付く
 *   ・明るさ: 陰影 = outgoingLight の輝度 ÷ 地の色の輝度（革の暗さでなく光の当たり方）に絶対の明るさを少し混ぜ、4段に量子化
 *       明るい → 線なし ／ 1方向 ／ 2方向の交差（約60°）／ 3方向（約60°ずつ） ／ 最暗部は1方向目の間にもう1本（密）
 *   ・手彫り: 線を値ノイズで横へ揺らす（波打ち）＋線の長さ方向に太さのむら＋線ごとの太さの差＋まれな途切れ
 *   ・紙の束の小口（M_Pages）は uEtRot で1方向目を紙の重なりと平行（水平）にする
 *   ・線の色: 下の色を焦げ茶へ落とす。線の間は少し明るく・彩度を少し落とす
 *   ・間隔: uEtS（ジオメトリ空間の長さ）。BookScene が「入口の距離で画面上 約2.6 CSS px」になるよう決める
 *   ・線が潰れる斜めの面（fwidth が大きい）は線を平均の濃さに溶かしてモアレを防ぐ
 *   テクスチャ参照は増やさない（ノイズは数式）。
 */
export interface SurfaceEtchUniforms { uEtS: { value: number }; uEtAmt: { value: number }; uEtGain: { value: number }; uEtRot: { value: number } }
export function applySurfaceEtch(mat: THREE.Material, u: SurfaceEtchUniforms): void {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vEtP; varying vec3 vEtN;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n  vEtP = position; vEtN = normal;');
    sh.fragmentShader = ETCH_HEAD + sh.fragmentShader.replace('#include <opaque_fragment>', ETCH_BODY + '\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'surface-etch-2';
  mat.needsUpdate = true;
}
const ETCH_HEAD = `
varying vec3 vEtP; varying vec3 vEtN;
uniform float uEtS, uEtAmt, uEtGain, uEtRot;
float etHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float etNoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(etHash(i), etHash(i + vec2(1.0, 0.0)), f.x), mix(etHash(i + vec2(0.0, 1.0)), etHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// 彫り線1組（濃さ 0..1）。p は「線の間隔=1」の座標。ang=線の向き・w=太さ(0..0.5)・off=ずらし
//   res には「線が潰れて平均の濃さへ溶かした割合」を返す（モアレ防止）
float etLine(vec2 p, float ang, float w, float off, float seed, out float res){
  vec2 d = vec2(cos(ang), sin(ang));
  float a = dot(p, d) + off;                         // 線を横切る向き（1 = 1本ぶん）
  float b = dot(p, vec2(-d.y, d.x));                 // 線に沿う向き
  float fa = fwidth(a);
  a += (etNoise(vec2(b * 0.045 + seed, a * 0.18)) - 0.5) * 0.70    // 手の揺れ（ゆるい波打ち）
     + (etNoise(vec2(b * 0.011 - seed, a * 0.05)) - 0.5) * 1.40;   // 腕の大きな流れ（数十本ぶんでゆっくり曲がる）
  float id = floor(a);
  float n = etNoise(vec2(b * 0.035 + id * 7.13 + seed, id * 1.37));
  float wv = w * (0.35 + 1.25 * n) * (0.8 + 0.4 * etHash(vec2(id, seed)));   // 太さのむら（膨らみと痩せ）
  wv *= smoothstep(0.03, 0.09, n);                   // まれに途切れる（ビュランの浮き）
  float dd = abs(fract(a) - 0.5);
  float aa = fa * 0.75 + 0.03;
  res = smoothstep(0.42, 0.85, fa);                  // 線の間隔が約2画素を切ったら平均へ溶かす
  float line = 1.0 - smoothstep(wv - aa, wv + aa, dd);
  return mix(line, w * 1.6, res);
}
`;
const ETCH_BODY = `
  {
    vec3 en = abs(normalize(vEtN));
    vec2 ep = en.y >= max(en.x, en.z) ? vEtP.xz : (en.x >= en.z ? vEtP.zy : vEtP.xy);
    ep /= uEtS;
    float eL = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
    float eA = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.03);
    // 陰影（地の色で割った光の当たり方）に、見た目の明るさを3割混ぜる
    float tone = mix(clamp(eL / eA * uEtGain, 0.0, 1.0), clamp(eL * uEtGain * 3.0, 0.0, 1.0), 0.3);
    tone = pow(tone, 0.4545);
    float k1 = 1.0 - smoothstep(0.84, 0.90, tone);   // 1方向
    float k2 = 1.0 - smoothstep(0.58, 0.64, tone);   // 2方向の交差
    float k3 = 1.0 - smoothstep(0.36, 0.42, tone);   // 3方向
    float k4 = 1.0 - smoothstep(0.17, 0.23, tone);   // 最暗部: 1方向目の間にもう1本＋太く
    float r1, r2, r3, r4;
    float wb = 0.13 + 0.07 * k3 + 0.06 * k4;
    float ink = k1 * etLine(ep, 0.62 + uEtRot, wb, 0.0, 0.0, r1);
    ink = max(ink, k2 * etLine(ep, 1.72 + uEtRot, wb * 0.92, 0.25, 17.0, r2));
    ink = max(ink, k3 * etLine(ep * 1.08, 2.75 + uEtRot, wb * 0.80, 0.5, 41.0, r3));
    ink = max(ink, k4 * etLine(ep, 0.62 + uEtRot, wb * 0.85, 0.5, 63.0, r4));
    float eBl = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
    vec3 paper = mix(vec3(eBl), outgoingLight, 0.78) * 1.30 + vec3(0.010, 0.008, 0.006);   // 線の間: 少し明るく・彩度を落とす
    vec3 inkC = min(outgoingLight * vec3(0.16, 0.12, 0.09), vec3(0.016, 0.010, 0.006));   // 線: 焦げ茶のインク（暗い所はそのまま暗く）
    outgoingLight = mix(paper, inkC, clamp(ink * uEtAmt, 0.0, 1.0));
  }
`;
