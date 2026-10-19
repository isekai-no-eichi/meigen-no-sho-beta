// ============================================================
// 潜る時に画面がにじむ（2026-10-20 beta・KEI「本を押すと吸い込まれる時、FF10 の敵と遭遇する時みたいに少しぼかしたい」）
//   ブルームの後・Grade の前に全画面 1 枚。本の画面位置を中心にした放射（ズーム）ぼかし 8 回参照＋
//   中心へ向かう小さな波打ち＋ほとんど見えない色ずれ（参照は増やさず、外側の参照ほど赤・内側ほど青に重みを寄せる）。
//   FF10 の渦を穏やかにした形。ガラスが割れる演出はしない。
//   uAmt=0 の間はパス自体を止める（enabled=false）ので、普段の描画コストは 0。
//   FxKey 'dive'（既定 入・?dive=0 で無し）。
// ============================================================
import * as THREE from 'three';

export const DiveBlurShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 0.5 },
    uAmt: { value: 0 },          // 0..1
    uTime: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uCenter; uniform float uAspect, uAmt, uTime;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - uCenter;
      vec2 da = vec2(d.x * uAspect, d.y);           // 縦横の比を揃えた距離
      float r = length(da);
      // 中心へ向かってゆっくり寄せる波（渦の名残。振れ幅はごく小さい）
      float wave = sin(r * 34.0 - uTime * 5.0) * 0.0045 * uAmt * smoothstep(0.02, 0.25, r);
      vec2 dir = r > 1e-4 ? d / r : vec2(0.0);
      vec2 uv0 = vUv - dir * wave - d * 0.018 * uAmt;   // 少しだけ中心へ吸う
      // 放射ぼかし: 中心へ向かって 8 回。中心ほどぶれない（ぶれ幅は中心からの距離に比例）
      float len = 0.05 * uAmt;
      // 参照位置を画素ごとに少しずらす（交互勾配ノイズ）→ 8 回でも筋の段が出ない
      float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec3 acc = vec3(0.0); vec3 wsum = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float k = (float(i) + jit) / 8.0;
        vec3 c = texture2D(tDiffuse, uCenter + (uv0 - uCenter) * (1.0 - len * k)).rgb;
        // 色ずれ: 赤は外側の参照、青は内側の参照をわずかに重く（0.12＝ほとんど見えない）
        vec3 w = vec3(1.0 + 0.12 * uAmt * (0.5 - k), 1.0, 1.0 - 0.12 * uAmt * (0.5 - k)) * (1.0 - 0.35 * k);
        acc += c * w; wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, 1.0);
    }`,
};

/** 潜りの進み k(0..1) → にじみの強さ。最初の 40% で S 字に入り、そのまま暗転まで保つ */
export function diveBlurAmt(k: number): number {
  const x = Math.max(0, Math.min(1, k / 0.4));
  return x * x * (3 - 2 * x);
}
