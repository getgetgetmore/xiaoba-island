// 太阳 / 月亮（带光晕的屏幕对齐圆盘）与星星。
import * as THREE from 'three';
import { PAINT_NOISE_GLSL } from '../../core/paint.js';

const DISC_VERT = `
varying vec2 vP;
void main(){
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DISC_FRAG = `
uniform vec3 uColor; uniform vec3 uHaloColor;
uniform float uCore; uniform float uHalo; uniform float uAlpha; uniform float uMoon;
varying vec2 vP;
${PAINT_NOISE_GLSL}
void main(){
  float d = length(vP);
  // 手绘感：边缘带笔触抖动，盘内有深浅斑驳
  float wob = (pNoise(vec3(vP * 9.0, 1.3)) - 0.5) * 0.07 * uCore + (pNoise(vec3(vP * 22.0, 4.1)) - 0.5) * 0.03 * uCore;
  d += wob;
  float disc = 1.0 - smoothstep(uCore * 0.9, uCore, d);
  vec3 col = uColor * (0.93 + 0.14 * pNoise(vec3(vP * 6.0 / uCore, 7.7)));
  if (uMoon > 0.5) {
    vec2 q = vP / uCore;
    float c = 0.0;
    c += smoothstep(0.30, 0.0, length(q - vec2(-0.30, 0.25))) * 0.7;
    c += smoothstep(0.22, 0.0, length(q - vec2(0.38, -0.12))) * 0.6;
    c += smoothstep(0.16, 0.0, length(q - vec2(-0.10, -0.48))) * 0.5;
    c += smoothstep(0.13, 0.0, length(q - vec2(0.20, 0.50))) * 0.45;
    col *= 1.0 - 0.15 * c;
  }
  float halo = pow(clamp(1.0 - d, 0.0, 1.0), 2.4) * uHalo * (0.9 + 0.2 * pNoise(vec3(vP * 5.0, 2.2)));
  float a = clamp(disc + halo * (1.0 - disc), 0.0, 1.0) * uAlpha;
  vec3 rgb = mix(uHaloColor, col, disc);
  gl_FragColor = vec4(rgb, a);
  #include <colorspace_fragment>
}`;

function makeDisc(name, core, moon) {
  const uniforms = {
    uColor: { value: new THREE.Color() },
    uHaloColor: { value: new THREE.Color() },
    uCore: { value: core },
    uHalo: { value: 0.6 },
    uAlpha: { value: 0 },
    uMoon: { value: moon ? 1 : 0 },
  };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: DISC_VERT,
      fragmentShader: DISC_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = -50;
  mesh.visible = false;
  return { mesh, uniforms, core };
}

export function createSunMoon() {
  return { sun: makeDisc('sky.sun', 0.2, false), moon: makeDisc('sky.moon', 0.3, true) };
}

// ---------------- 星星 ----------------
const STAR_VERT = `
attribute vec2 aNdc; attribute vec3 aStar; // x=phase y=size z=speed
attribute vec3 aColor;
uniform float uTanH; uniform float uTanV; uniform float uDepth; uniform float uTime; uniform float uScale;
varying float vTw; varying vec3 vCol;
void main(){
  vec3 p = vec3(aNdc.x * uTanH * uDepth, aNdc.y * uTanV * uDepth, -uDepth);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  float tw = 0.5 + 0.5 * sin(uTime * aStar.z + aStar.x * 6.2831);
  vTw = 0.35 + 0.65 * tw;
  vCol = aColor;
  gl_PointSize = aStar.y * uScale * (0.8 + 0.4 * tw);
}`;
const STAR_FRAG = `
uniform float uAlpha;
varying float vTw; varying vec3 vCol;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  gl_FragColor = vec4(vCol, a * vTw * uAlpha);
  #include <colorspace_fragment>
}`;

export function createStars(stage, rng, count = 150, depth = 190) {
  const ndc = new Float32Array(count * 2);
  const st = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const pos = new Float32Array(count * 3); // 占位（three 需要 position 属性来确定顶点数）
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    ndc[i * 2] = (rng() * 2 - 1) * 1.04;
    // 偏上多、两侧和岛下方也有一些
    ndc[i * 2 + 1] = -0.55 + 1.58 * Math.pow(rng(), 0.7);
    st[i * 3] = rng();
    st[i * 3 + 1] = 3.2 + Math.pow(rng(), 3) * 4.5;
    st[i * 3 + 2] = 0.8 + rng() * 2.2;
    const k = rng();
    c.setRGB(0.85 + 0.15 * k, 0.9 + 0.1 * k, 1.0 - 0.15 * k).convertSRGBToLinear();
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aNdc', new THREE.BufferAttribute(ndc, 2));
  geo.setAttribute('aStar', new THREE.BufferAttribute(st, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const uniforms = {
    uTanH: stage.uTanH,
    uTanV: stage.uTanV,
    uDepth: { value: depth },
    uTime: { value: 0 },
    uScale: { value: 1 },
    uAlpha: { value: 0 },
  };
  const mesh = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  mesh.name = 'sky.stars';
  mesh.frustumCulled = false;
  mesh.renderOrder = -60;
  mesh.visible = false;
  return { mesh, uniforms };
}
