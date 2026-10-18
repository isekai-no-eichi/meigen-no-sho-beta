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
 * 銅版画風（etch）。ブルームの後・Grade の前の1枚（入力はトーンマップ前の線形色）。
 *   ・輝度に応じた斜線ハッチング（暗い所ほど密・2方向クロス・最暗部は細かい3本目）。線は画面の画素基準
 *   ・Roberts の対角差分（4回の参照）で輪郭を薄く
 *   ・彩度を少し落とし、線の色は焦げ茶のインク
 *   テクスチャ参照は中心1＋輪郭4＝5回。解像度は composer の既定のまま。
 */
export const EtchShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uPx: { value: 1 },          // 画素比（線の間隔を CSS ピクセル基準でそろえる）
    uAmt: { value: 0.42 },      // 線の濃さ
    uEdge: { value: 0.32 },     // 輪郭の濃さ
    uSat: { value: 0.78 },      // 彩度（1 = そのまま）
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uPx, uAmt, uEdge, uSat; varying vec2 vUv;
    float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float hsh(float n){ return fract(sin(n * 91.345) * 47453.21); }
    // 斜線1本ぶんの濃さ（0..1）。sp=間隔(px)・wd=太さ(0..0.5)。線ごとに太さを少し揺らして手の痕跡を出す
    float hatch(vec2 p, vec2 dir, float sp, float wd){
      float u = dot(p, dir) / sp;
      float id = floor(u);
      float jw = wd * (0.75 + 0.5 * hsh(id));
      float d = abs(fract(u) - 0.5);
      return 1.0 - smoothstep(jw - 0.08, jw + 0.08, d);
    }
    void main(){
      vec2 texel = 1.0 / vec2(textureSize(tDiffuse, 0));
      vec4 c = texture2D(tDiffuse, vUv);
      // トーンマップ前なので見た目の明るさに寄せてから判定する
      float l = pow(clamp(lum(c.rgb) * 0.72, 0.0, 1.0), 1.0 / 2.2);
      vec2 p = gl_FragCoord.xy / max(uPx, 1.0);
      // かすかな揺れ（銅板を手で引いた線の不揃い）
      p += vec2(sin(p.y * 0.045) * 0.6, sin(p.x * 0.038) * 0.6);
      float ink = 0.0;
      ink = max(ink, hatch(p, normalize(vec2( 1.0, 1.0)), 4.0, 0.13) * (1.0 - smoothstep(0.20, 0.40, l)));
      ink = max(ink, hatch(p, normalize(vec2(-1.0, 1.0)), 4.0, 0.12) * (1.0 - smoothstep(0.08, 0.20, l)));
      ink = max(ink, hatch(p + 2.0, normalize(vec2( 1.0, 1.0)), 4.0, 0.10) * (1.0 - smoothstep(0.02, 0.07, l)));
      // 輪郭（Roberts の対角差分）
      vec2 o = texel * 1.25;
      float a = lum(texture2D(tDiffuse, vUv + vec2(-o.x, -o.y)).rgb), b = lum(texture2D(tDiffuse, vUv + vec2(o.x, o.y)).rgb);
      float e = lum(texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb), f = lum(texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb);
      float edge = smoothstep(0.035, 0.16, length(vec2(a - b, e - f)) / (0.15 + l));
      vec3 col = mix(vec3(lum(c.rgb)), c.rgb, uSat);
      vec3 inkCol = col * vec3(0.30, 0.24, 0.19);
      col = mix(col, inkCol, clamp(ink * uAmt + edge * uEdge, 0.0, 0.9));
      gl_FragColor = vec4(col, c.a);
    }`,
};
