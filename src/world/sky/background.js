// “画出来的”全屏背景（屏幕空间，永远铺满且不透明；深度写在远平面，被一切物体遮挡）。
// 画面自上而下：带笔触/画布颗粒的青蓝天空 → 厚涂积云（亮面暖白、暗面蓝灰、干笔触边缘）→ 远山与起伏草甸（含小岛投影暗区）。
import * as THREE from 'three';
import { PAINT_NOISE_GLSL } from '../../core/paint.js';

const VERT = `
varying vec2 vUv;
uniform vec2 uViewC; uniform float uViewZ;
void main(){
  vUv = uViewC + position.xy * 0.5 / uViewZ; // 缩放时只显示完整画面里的一小块（与相机的视图裁切一致）
  gl_Position = vec4(position.xy, 0.99999, 1.0);
}`;

const FRAG = `
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor;
uniform vec3 uCloudLit; uniform vec3 uCloudDark; uniform vec2 uLightXY;
uniform float uCloud; uniform float uOver; uniform float uTime; uniform float uAsp;
uniform vec3 uMeadowLight; uniform vec4 uShadow; // xy 中心(NDC) zw 半径
uniform float uShadowAmt;
uniform vec2 uSun; uniform vec3 uSunCol; uniform float uSunGlow;
uniform vec2 uMoon; uniform vec3 uMoonCol; uniform float uMoonGlow;
uniform float uFlash;
uniform float uBackdrop; // 1 = 完整背景画面；0 = 只留云（天空、草甸全透明，小岛漂浮在桌面上）
varying vec2 vUv;
${PAINT_NOISE_GLSL}
vec3 SRGB(vec3 c){ return pow(c, vec3(2.2)); }
float hash12(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float fbm(vec2 p, float s){
  float a = 0.5, r = 0.0;
  for (int i = 0; i < 4; i++) { r += a * pNoise(vec3(p, s)); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return r / 0.9375;
}
const vec3 SH[7] = vec3[7](
  vec3(-0.62,-0.04,0.22), vec3(-0.30,0.08,0.30), vec3(0.05,0.20,0.36), vec3(0.42,0.06,0.30),
  vec3(0.74,-0.05,0.21), vec3(-0.05,-0.06,0.27), vec3(0.30,-0.07,0.25));

// 一团厚涂积云：mass = 覆盖度，lit = 亮面程度
void cloudAt(vec2 q, vec2 c, float s, float flip, float seed, out float mass, out float lit){
  mass = 0.0; lit = 0.0;
  vec2 rel = (q - c) / s;
  if (abs(rel.x) > 1.25 || rel.y > 0.85 || rel.y < -0.5) return;
  float S = 0.0; vec3 n = vec3(0.0);
  for (int i = 0; i < 7; i++) {
    vec2 off = vec2(SH[i].x * flip, SH[i].y);
    vec2 d = (rel - off) / SH[i].z;
    float h = sqrt(max(0.0, 1.0 - dot(d, d)));
    S += h; n += vec3(d * h, h);
  }
  float br = fbm(vec2(q.x * 5.0, q.y * 15.0) + seed, seed);
  float br2 = fbm(q * vec2(3.0, 4.0) + seed * 3.1, seed + 2.0);
  float edge = S + (br - 0.5) * 0.6 + (br2 - 0.5) * 0.3;
  float cut = smoothstep(-0.36, -0.22, rel.y + (br - 0.5) * 0.12);
  mass = smoothstep(0.14, 0.44, edge) * cut;
  vec3 nn = normalize(vec3(n.xy, n.z + 0.001));
  vec3 L = normalize(vec3(uLightXY, 0.65));
  float l = dot(nn, L) * 0.5 + 0.5 + rel.y * 0.22 + (br - 0.5) * 0.34;
  lit = smoothstep(0.52, 0.68, l) * 0.7 + smoothstep(0.78, 0.95, l) * 0.3;
}

void main(){
  vec2 uv = vUv;
  float u = uv.x * 2.0 - 1.0, v = uv.y * 2.0 - 1.0;
  vec2 q = vec2(u * uAsp, v);
  float sz = mix(0.7, 1.0, clamp(uAsp / 1.2, 0.0, 1.0));

  // ---------- 天空：渐变 + 方向性笔触 ----------
  float t = clamp((v + 1.0) / 2.0, 0.0, 1.0); // 没有地面了：从画面底（地平线色）渐变到顶
  vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.5, t));
  col = mix(col, uTop, smoothstep(0.4, 1.0, t));
  vec2 w = vec2(fbm(q * 1.7, 1.0), fbm(q * 1.7 + 5.0, 2.0)) - 0.5;
  float b1 = fbm(vec2(q.x * 0.9 + w.x * 1.2, q.y * 9.0 + w.y * 1.5), 3.0);
  vec2 qr = mat2(0.88, 0.47, -0.47, 0.88) * q;
  float b2 = fbm(vec2(qr.x * 1.4, qr.y * 11.0) + 7.0, 4.0);
  float b3 = fbm(q * 2.6 + 3.0, 5.0);
  col *= 1.0 + (b1 - 0.5) * 0.20 + (b2 - 0.5) * 0.14;
  col += (b3 - 0.5) * vec3(-0.035, 0.02, 0.03);

  // ---------- 太阳 / 月亮的大光晕 ----------
  vec2 d = (uv - uSun) * vec2(uAsp, 1.0);
  float g1 = exp(-length(d * vec2(0.55, 1.35)) * 2.6);
  float g2 = exp(-length(d) * 7.0);
  float gn = 0.85 + 0.3 * b2;
  col = mix(col, uSunCol, clamp(uSunGlow * (0.65 * g1 + 0.6 * g2) * gn, 0.0, 0.92));
  vec2 dm = (uv - uMoon) * vec2(uAsp, 1.0);
  col = mix(col, uMoonCol, clamp(uMoonGlow * exp(-length(dm) * 5.0) * gn, 0.0, 0.6));

  // ---------- 厚涂积云 ----------
  float amt = uCloud;
  float aMain = smoothstep(-0.2, 0.15, amt + 0.25);
  float s0 = (0.5 + 0.22 * amt) * sz * mix(0.62, 1.0, uBackdrop);
  vec2 cPull = vec2(mix(0.7, 1.0, uBackdrop), mix(0.78, 1.0, uBackdrop));
  float cm, cl;
  // 各团略微漂移/呼吸
  float tt = uTime;
  vec2 cL1 = vec2(-0.92 * uAsp + 0.05 * sin(tt * 0.031), 0.50 + 0.01 * sin(tt * 0.05));
  vec2 cR1 = vec2( 0.95 * uAsp + 0.05 * sin(tt * 0.027 + 2.0), 0.36 + 0.01 * sin(tt * 0.045 + 1.0));
  vec2 cT1 = vec2(-0.18 * uAsp + 0.07 * sin(tt * 0.023 + 4.0), 0.90);
  vec2 cT2 = vec2( 0.62 * uAsp + 0.06 * sin(tt * 0.021 + 1.5), 0.88);
  vec2 cL2 = vec2(-1.0 * uAsp + 0.04 * sin(tt * 0.037 + 3.0), 0.02);
  vec3 cc;
  cL1 *= cPull; cR1 *= cPull; cT1 *= cPull; cT2 *= cPull; cL2 *= cPull;
  // 记录“纯天空”的颜色和它在最终颜色里剩余的权重，用来把云从天空里分离出来（透明输出）
  vec3 skyCol = col;
  float skyW = 1.0;
  cloudAt(q, cL2, s0 * 0.62, 1.0, 11.0, cm, cl);
  { float mm = cm * smoothstep(0.1, 0.5, amt + 0.2); col = mix(col, mix(uCloudDark, uCloudLit, cl), mm); skyW *= 1.0 - mm; }
  cloudAt(q, cT1, s0 * 0.5, -1.0, 7.0, cm, cl);
  { float mm = cm * smoothstep(0.0, 0.3, amt + 0.1); col = mix(col, mix(uCloudDark, uCloudLit, cl), mm); skyW *= 1.0 - mm; }
  cloudAt(q, cT2, s0 * 0.55, 1.0, 5.0, cm, cl);
  { float mm = cm * smoothstep(0.05, 0.35, amt + 0.12); col = mix(col, mix(uCloudDark, uCloudLit, cl), mm); skyW *= 1.0 - mm; }
  cloudAt(q, cL1, s0 * 1.15, 1.0, 1.0, cm, cl);
  { float mm = cm * aMain; col = mix(col, mix(uCloudDark, uCloudLit, cl), mm); skyW *= 1.0 - mm; }
  cloudAt(q, cR1, s0 * 1.2, -1.0, 3.0, cm, cl);
  { float mm = cm * aMain; col = mix(col, mix(uCloudDark, uCloudLit, cl), mm); skyW *= 1.0 - mm; }

  // 岛下方的两朵云（衬托“飘在天上”；只留小岛时不画）
  vec2 cB1 = vec2(-0.5 * uAsp + 0.06 * sin(tt * 0.025 + 5.0), -0.74);
  vec2 cB2 = vec2( 0.62 * uAsp + 0.05 * sin(tt * 0.029 + 0.7), -0.84);
  cloudAt(q, cB1, s0 * 0.95, -1.0, 13.0, cm, cl);
  { float mm = cm * aMain * uBackdrop; col = mix(col, mix(uCloudDark, uCloudLit, cl), mm); skyW *= 1.0 - mm; }
  cloudAt(q, cB2, s0 * 0.8, 1.0, 17.0, cm, cl);
  { float mm = cm * aMain * uBackdrop; col = mix(col, mix(uCloudDark, uCloudLit, cl), mm); skyW *= 1.0 - mm; }

  // 阴雨：满天的大片笔刷云层
  if (uOver > 0.01) {
    vec2 qo = vec2(q.x * 0.8 + tt * 0.004, q.y * 2.4);
    float f = fbm(qo + w * 0.8, 9.0);
    float f2 = fbm(vec2(q.x * 4.0 + tt * 0.006, q.y * 18.0), 10.0);
    float m = smoothstep(1.0 - uOver * 0.95, 1.0 - uOver * 0.95 + 0.28, f + (f2 - 0.5) * 0.25 + 0.18 * (v - 0.3));
    float lt = smoothstep(0.35, 0.7, f2 * 0.6 + (1.0 - f) * 0.5 + 0.2 * (1.0 - v));
    float mo = m * 0.88 * smoothstep(-0.25, 0.1, v) * uBackdrop;
    col = mix(col, mix(uCloudDark, uCloudLit, lt * 0.8), mo);
    skyW *= 1.0 - mo;
  }

  vec3 flashC = SRGB(vec3(0.82, 0.88, 1.0));
  col = mix(col, flashC, uFlash);
  skyCol = mix(skyCol, flashC, uFlash);
  // 画布颗粒
  float gr = 1.0 + (hash12(gl_FragCoord.xy) - 0.5) * 0.045;
  col *= gr; skyCol *= gr;
  // 分离：云（预乘）+ 按 uBackdrop 保留的背景
  vec3 pm = max(col - skyCol * skyW, 0.0) + skyCol * skyW * uBackdrop;
  float outA = clamp(1.0 - skyW * (1.0 - uBackdrop), 0.0, 1.0);
  vec3 straight = outA > 1e-4 ? pm / outA : vec3(0.0);
  straight += (hash12(gl_FragCoord.xy + 31.7) - 0.5) / 255.0;
  gl_FragColor = vec4(max(straight, 0.0), 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * outA, outA); // 预乘 alpha 输出
}`;

export function createBackground() {
  const C = () => ({ value: new THREE.Color() });
  const uniforms = {
    uTop: C(), uMid: C(), uHor: C(),
    uCloudLit: C(), uCloudDark: C(), uLightXY: { value: new THREE.Vector2(0, 0.5) },
    uCloud: { value: 0.15 }, uOver: { value: 0 }, uTime: { value: 0 }, uAsp: { value: 1 },
    uMeadowLight: C(), uShadow: { value: new THREE.Vector4(0, -0.6, 0.6, 0.12) }, uShadowAmt: { value: 0.6 },
    uSun: { value: new THREE.Vector2(0.5, 0.3) }, uSunCol: C(), uSunGlow: { value: 0 },
    uMoon: { value: new THREE.Vector2(0.5, 0.7) }, uMoonCol: C(), uMoonGlow: { value: 0 },
    uFlash: { value: 0 },
    uBackdrop: { value: 1 },
    uViewC: { value: new THREE.Vector2(0.5, 0.5) },
    uViewZ: { value: 1 },
  };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  mesh.name = 'sky.bg';
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return { mesh, uniforms };
}
