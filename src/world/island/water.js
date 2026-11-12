// 池塘水面（轻微波动、雨天涟漪、笔触色斑）与一只小黄鸭。
import * as THREE from 'three';
import { TAU } from '../../core/util.js';
import { applyPaint } from '../../core/paint.js';
import { C } from './colors.js';
import { L, pondR } from './shape.js';
import { GeoBuilder, jitterGeo } from './geo.js';

export const WATER_Y = -0.1;

export function buildWater() {
  const seg = 44;
  const pos = [0, WATER_Y, 0], idx = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * TAU;
    const r = pondR(t) * 1.06;
    pos.push(Math.cos(t) * r, WATER_Y, Math.sin(t) * r);
  }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos.map((v, i) => (i % 3 === 0 ? v + L.pond.x : i % 3 === 2 ? v + L.pond.z : v)), 3));
  const n = [];
  for (let i = 0; i <= seg; i++) n.push(0, 1, 0);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();

  const uniforms = {
    uWTime: { value: 0 },
    uRain: { value: 0 },
    uPondC: { value: new THREE.Vector2(L.pond.x, L.pond.z) },
    uPondR: { value: L.pond.r },
    uDeep: { value: new THREE.Color(C.waterDeep) },
    uShallow: { value: new THREE.Color(C.water) },
    uFoam: { value: new THREE.Color(C.waterFoam) },
    uSparkle: { value: 0 },
    uSparkX: { value: 0 },
    uSparkCol: { value: new THREE.Color(1, 0.95, 0.8) },
  };
  // 半透明：能看到水面下游动的小鱼
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.52, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vWXZ;\nuniform float uWTime;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWXZ = position.xz;\n  transformed.y += sin(uWTime * 1.3 + position.x * 3.0 + position.z * 2.0) * 0.006;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `varying vec2 vWXZ;\nuniform float uWTime;\nuniform float uRain;\nuniform vec2 uPondC;\nuniform float uPondR;\nuniform vec3 uDeep;\nuniform vec3 uShallow;\nuniform vec3 uFoam;\nuniform float uSparkle;\nuniform float uSparkX;\nuniform vec3 uSparkCol;\nfloat wHash(vec2 p){return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);}\nvoid main() {\n  float wGlint = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float pr = length(vWXZ - uPondC) / uPondR;
        vec3 wc = mix(uDeep, uShallow, smoothstep(0.1, 1.0, pr));
        float br = pNoise(vec3(vWXZ * 3.2, uWTime * 0.12));
        wc *= 0.88 + br * 0.3;
        wc = mix(wc, uFoam, smoothstep(0.84, 1.02, pr) * 0.4);
        // 涟漪
        vec2 cell = floor(vWXZ * 2.2);
        vec2 f = fract(vWXZ * 2.2) - 0.5;
        float h1 = wHash(cell), h2 = wHash(cell + 7.3);
        float ph = fract(uWTime * 0.8 + h1);
        float d = length(f - (vec2(h1, h2) - 0.5) * 0.4);
        float ring = smoothstep(0.035, 0.0, abs(d - ph * 0.42)) * (1.0 - ph) * step(0.3, h2);
        wc += ring * uRain * 0.45;
        diffuseColor.rgb = wc;
        // 波光：两层流动噪声相乘出细碎的亮点，集中在朝向太阳一侧的一条光带上
        float g1 = pNoise(vec3(vWXZ * 17.0 + vec2(uWTime * 0.3, 0.0), uWTime * 0.8));
        float g2 = pNoise(vec3(vWXZ * 27.0 - vec2(0.0, uWTime * 0.45), uWTime * 1.2 + 4.0));
        float band = exp(-pow((vWXZ.x - uPondC.x - uSparkX * uPondR * 0.45) / (uPondR * 0.62), 2.0));
        wGlint = smoothstep(0.43, 0.5, g1 * g2 + 0.06 * uSparkle) * band * uSparkle * (1.0 - smoothstep(0.8, 1.0, pr));
        diffuseColor.a = mix(diffuseColor.a, 1.0, clamp(wGlint, 0.0, 1.0));
      }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uSparkCol * wGlint * 1.05;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize(normal + vec3(sin(vWXZ.x * 7.0 + uWTime * 1.3), 0.0, cos(vWXZ.y * 6.0 + uWTime * 1.1)) * 0.035);');
  };
  mat.customProgramCacheKey = () => 'isl-water';
  applyPaint(mat, { scale: 2.2, strength: 0.1, hue: 0.4, bands: 0.2, levels: 5 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'pondWater';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  return { mesh, uniforms };
}

export function buildDuck() {
  const b = new GeoBuilder({ seed: 12, jitter: 0.04, aoK: 0 });
  const body = new THREE.IcosahedronGeometry(1, 1);
  jitterGeo(body, 0.05, 2);
  b.add(body, { pos: [0, 0.07, 0], scale: [0.12, 0.09, 0.16], color: C.duck });
  b.add(new THREE.IcosahedronGeometry(0.075, 1), { pos: [0, 0.17, 0.11], color: C.duck });
  b.add(new THREE.ConeGeometry(0.03, 0.07, 4), { pos: [0, 0.16, 0.2], rot: [Math.PI / 2, 0, 0], color: C.beak });
  for (const sx of [-0.04, 0.04]) b.add(new THREE.IcosahedronGeometry(0.012, 0), { pos: [sx, 0.19, 0.17], color: 0x2a211d });
  b.add(new THREE.ConeGeometry(0.05, 0.1, 4), { pos: [0, 0.1, -0.16], rot: [-Math.PI / 2.4, 0, 0], color: C.duck });
  const mesh = new THREE.Mesh(b.build(), null);
  mesh.name = 'duck';
  return mesh;
}
