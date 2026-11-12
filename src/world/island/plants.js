// 密草（InstancedMesh 草叶，顶点着色器摆动）与成簇的花。
import * as THREE from 'three';
import { mulberry32, smoothstep, clamp, lerp, TAU, valueNoise2 } from '../../core/util.js';
import { applyPaint } from '../../core/paint.js';
import { C } from './colors.js';
import { L, outlineR, pondU, kennelToWorld } from './shape.js';

export const swayUniforms = {
  uSwayTime: { value: 0 },
  uWind: { value: 0.2 },
  // 狗垫压住的草：椭圆（中心 x,z、长轴方向 sin/cos 偏航）内的草叶被压到贴地
  uMatPose: { value: new THREE.Vector4(0, 0, 0, 1) }, // x, z, sin(yaw), cos(yaw)
  uMatHalf: { value: new THREE.Vector2(0.63, 0.97) },
  // 狗身下的草和花被压倒：x, z, 半径, 程度(0..1)
  uDogPress: { value: new THREE.Vector4(0, 0, 0.5, 0) },   // 半宽、半长（比垫子略大一圈）
};

/** kind: 'blade'（高度蒙版 y²，世界空间位移）| 'stem' | 'head'（整体跟随茎尖） */
export function swayMaterial(kind, amp, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, ...extra });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = swayUniforms.uSwayTime;
    shader.uniforms.uWind = swayUniforms.uWind;
    shader.uniforms.uMatPose = swayUniforms.uMatPose;
    shader.uniforms.uMatHalf = swayUniforms.uMatHalf;
    shader.uniforms.uDogPress = swayUniforms.uDogPress;
    shader.uniforms.uSwayAmp = { value: amp };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwayTime;\nuniform float uWind;\nuniform float uSwayAmp;\nuniform vec4 uMatPose;\nuniform vec2 uMatHalf;\nuniform vec4 uDogPress;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 swIP = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float swH = length(instanceMatrix[1].xyz);
        float swSq = 1.0;
        ${kind === 'blade' ? `{
          vec2 md = swIP.xz - uMatPose.xy;
          float mAlong = dot(md, vec2(uMatPose.z, uMatPose.w));
          float mAcross = dot(md, vec2(uMatPose.w, -uMatPose.z));
          float me = length(vec2(mAcross / uMatHalf.x, mAlong / uMatHalf.y));
          swSq = mix(0.04, 1.0, smoothstep(0.9, 1.12, me));
        }` : ''}
        {
          // 狗踩着/趴着的地方：草被压倒，花被压到看不见（狗走开后再立起来）
          float dd = length(swIP.xz - uDogPress.xy);
          swSq *= 1.0 - uDogPress.w * (1.0 - smoothstep(uDogPress.z * 0.72, uDogPress.z, dd));
          transformed *= max(swSq, 0.03);
        }
        float swM = ${kind === 'head' ? '1.0' : 'position.y * position.y'};
        float ph = dot(swIP.xz, vec2(0.55, 0.35)) - uSwayTime * 1.7;
        float g = sin(ph) * 0.6 + sin(ph * 2.3 + 1.7 + swIP.x * 0.9) * 0.4;
        float k = uSwayAmp * (0.35 + 1.65 * uWind) * swM * ${kind === 'head' ? '0.55' : 'swH'};
        vec3 dW = vec3(g * k, -abs(g) * k * 0.15, (cos(ph * 0.8 + 0.5)) * k * 0.45);
        transformed += inverse(mat3(instanceMatrix)) * dW * swSq;
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);');
  };
  mat.customProgramCacheKey = () => `isl-sway-${kind}`;
  return applyPaint(mat, { scale: 1.1, strength: 0.16, hue: 0.7, bands: 0.15, levels: 5, space: 'world' });
}

function bladeGeometry() {
  const w = 0.07;
  // 底宽 → 中段 → 尖，略向前弯；根深梢亮
  const V = [
    [-w / 2, 0, 0], [w / 2, 0, 0], [-w * 0.34, 0.5, 0.07], [w * 0.34, 0.5, 0.07], [0, 1, 0.24],
  ];
  const shade = [0.42, 0.42, 0.8, 0.8, 1.12];
  const idx = [0, 1, 3, 0, 3, 2, 2, 3, 4];
  const pos = [], col = [];
  for (const i of idx) { pos.push(...V[i]); col.push(shade[i], shade[i], shade[i]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const nrm = [];
  for (let i = 0; i < idx.length; i++) nrm.push(0, 1, 0);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/** 返回 (x,z) 处草的 [最小,最大] 高度；0 表示不长草 */
export function makeGrassField(blockers, stones) {
  const k = L.kennel;
  const out = [0, 0];
  return function grassRange(x, z) {
    out[0] = out[1] = 0;
    const e = outlineR(Math.atan2(z, x)) - Math.hypot(x, z);
    if (e < 0.04) return out;
    if (Math.hypot(x - k.x, z - k.z) < 1.62) return out;
    if (pondU(x, z) < 1.04) return out;
    for (let i = 0; i < blockers.length; i++) {
      const b = blockers[i];
      if (Math.hypot(x - b[0], z - b[1]) < b[2]) return out;
    }
    for (let i = 0; i < stones.length; i++) if (Math.hypot(x - stones[i][0], z - stones[i][1]) < 0.3) return out;
    const lw = L.lawn;
    const dl = Math.hypot(x - lw.x, z - lw.z) / (1 + 0.05 * Math.sin(Math.atan2(z - lw.z, x - lw.x) * 3 + 1.3));
    const df = Math.hypot(x - L.front.x, z - L.front.z);
    const door = Math.hypot(x - (k.x + k.dx * 1.9), z - (k.z + k.dz * 1.9));
    // 短草（0.1–0.2）与高草的过渡
    let t = smoothstep(lw.r + 0.0, lw.r + 1.5, dl);
    t = Math.min(t, smoothstep(1.7, 3.2, df), smoothstep(0.9, 2.3, door));
    const hmax = lerp(0.74, 0.34, smoothstep(0, 6.5, z)) * (e < 0.8 ? 0.8 : 1);
    out[0] = lerp(0.1, Math.max(0.24, hmax * 0.42), t);
    out[1] = lerp(0.2, hmax, t);
    return out;
  };
}

export function buildGrass(heightAt, field, count = 16000) {
  const rng = mulberry32(8080);
  const mesh = new THREE.InstancedMesh(bladeGeometry(), swayMaterial('blade', 0.22), count);
  mesh.name = 'grass';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const tallCols = [C.grassOlive, C.grassMoss, C.grassYellow, C.grassDeep, C.grassTeal, C.grassMoss];
  const lawnCols = [C.lawn, C.lawnDark, C.grassYellow, C.grassMoss];
  let n = 0, tries = 0;
  while (n < count && tries < count * 8) {
    tries++;
    const a = rng() * TAU, r = Math.sqrt(rng()) * 8.0;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rg = field(x, z);
    if (rg[1] <= 0) continue;
    const h = rg[0] + (rg[1] - rg[0]) * Math.pow(rng(), 0.8);
    const y = heightAt(x, z);
    dummy.position.set(x, y - 0.02, z);
    dummy.rotation.set((rng() - 0.5) * 0.5, rng() * TAU, (rng() - 0.5) * 0.5);
    const sx = 0.8 + rng() * 0.7;
    dummy.scale.set(sx, h, sx);
    dummy.updateMatrix();
    mesh.setMatrixAt(n, dummy.matrix);
    const lawnish = rg[1] < 0.4;
    const nz = valueNoise2(x * 0.5 + 2, z * 0.5, 3);
    const list = lawnish ? lawnCols : tallCols;
    const pick = Math.min(list.length - 1, Math.floor((nz * 0.7 + rng() * 0.3) * list.length));
    col.setHex(list[pick]);
    const v = 0.88 + rng() * 0.26;
    col.multiplyScalar(v);
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// ---------------- 花 ----------------
function stemGeometry() {
  const g = new THREE.CylinderGeometry(0.009, 0.015, 1, 3, 1, true);
  g.translate(0, 0.5, 0);
  const pos = Array.from(g.toNonIndexed().attributes.position.array);
  const extra = [
    0, 0.3, 0, 0.1, 0.38, 0.02, 0.02, 0.44, 0.0,
    0, 0.42, 0, -0.09, 0.5, -0.02, -0.02, 0.55, 0.01,
  ];
  const all = pos.concat(extra);
  const col = [];
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) col.push(0.22, 0.34, 0.09);
  for (let i = 0; i < extra.length / 3; i++) col.push(0.3, 0.44, 0.12);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const nrm = [];
  for (let i = 0; i < all.length / 3; i++) nrm.push(0, 1, 0);
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

function daisyGeometry(petals = 7) {
  const pos = [], col = [], nrm = [];
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * TAU;
    const c = Math.cos(a), s = Math.sin(a);
    const P = (r, side, y) => [c * r - s * side, y, s * r + c * side];
    const v = [P(0.02, 0, 0.0), P(0.07, 0.035, 0.012), P(0.07, -0.035, 0.012), P(0.125, 0, 0.026)];
    for (const idx of [[0, 1, 2], [1, 3, 2]]) for (const j of idx) { pos.push(...v[j]); col.push(1, 1, 1); nrm.push(0, 1, 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

function centerGeometry() {
  const g = new THREE.IcosahedronGeometry(0.04, 1);
  g.scale(1, 0.6, 1);
  const ng = g;
  const col = [];
  for (let i = 0; i < ng.attributes.position.count; i++) col.push(1, 1, 1);
  ng.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return ng;
}

function pomGeometry() {
  const g = new THREE.IcosahedronGeometry(0.075, 1);
  const p = g.attributes.position;
  const col = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const s = 0.82 + 0.3 * smoothstep(-0.07, 0.07, y);
    col.push(s, s, s);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** patches: [{x,z,r,n,colors:[hex..]}]；field 用于取当地草高，让花茎高出草尖 */
export function buildFlowers(heightAt, field, patches, blockers) {
  const rng = mulberry32(606);
  const daisies = [], poms = [];
  for (const p of patches) {
    for (let i = 0; i < p.n; i++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * p.r;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const rg = field(x, z);
      if (rg[1] <= 0 || rg[1] < 0.3) continue;
      let blocked = false;
      for (const b of blockers) if (Math.hypot(x - b[0], z - b[1]) < b[2]) { blocked = true; break; }
      if (blocked) continue;
      const len = rg[1] * (0.7 + rng() * 0.3) + 0.04 + rng() * 0.08;
      const c = p.colors[Math.floor(rng() * p.colors.length)];
      (rng() < 0.62 ? daisies : poms).push({ x, z, y: heightAt(x, z), len, c, yaw: rng() * TAU, s: 1.1 + rng() * 0.5 });
    }
  }
  const all = daisies.concat(poms);
  const stems = new THREE.InstancedMesh(stemGeometry(), swayMaterial('stem', 0.22), Math.max(1, all.length));
  const dai = new THREE.InstancedMesh(daisyGeometry(), swayMaterial('head', 0.22), Math.max(1, daisies.length));
  const cen = new THREE.InstancedMesh(centerGeometry(), swayMaterial('head', 0.22), Math.max(1, daisies.length));
  const pom = new THREE.InstancedMesh(pomGeometry(), swayMaterial('head', 0.22), Math.max(1, poms.length));
  const d = new THREE.Object3D(), col = new THREE.Color();
  all.forEach((f, i) => {
    d.position.set(f.x, f.y - 0.02, f.z);
    d.rotation.set(0, f.yaw, 0);
    d.scale.set(1, f.len, 1);
    d.updateMatrix();
    stems.setMatrixAt(i, d.matrix);
  });
  daisies.forEach((f, i) => {
    d.position.set(f.x, f.y + f.len - 0.02, f.z);
    d.rotation.set(((f.yaw % 1) - 0.5) * 0.5, f.yaw, (f.x % 1) * 0.3);
    d.scale.setScalar(f.s);
    d.updateMatrix();
    dai.setMatrixAt(i, d.matrix);
    cen.setMatrixAt(i, d.matrix);
    col.setHex(f.c);
    dai.setColorAt(i, col);
    col.setHex(C.flowerCenter);
    cen.setColorAt(i, col);
  });
  poms.forEach((f, i) => {
    d.position.set(f.x, f.y + f.len - 0.02, f.z);
    d.rotation.set(0, f.yaw, 0);
    d.scale.setScalar(f.s * 0.95);
    d.updateMatrix();
    pom.setMatrixAt(i, d.matrix);
    col.setHex(f.c);
    pom.setColorAt(i, col);
  });
  dai.count = cen.count = daisies.length;
  pom.count = poms.length;
  stems.count = all.length;
  const meshes = [stems, dai, cen, pom];
  for (const m of meshes) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  stems.name = 'flowerStems'; dai.name = 'daisies'; cen.name = 'daisyCenters'; pom.name = 'pompoms';
  // 每朵花的花头顶面位置（给昆虫当落脚点用）
  const heads = [];
  for (const f of daisies) heads.push({ x: f.x, z: f.z, top: f.y + f.len - 0.02 + 0.02 * f.s });
  for (const f of poms) heads.push({ x: f.x, z: f.z, top: f.y + f.len - 0.02 + 0.075 * f.s * 0.95 });
  return { meshes, count: all.length, heads };
}
