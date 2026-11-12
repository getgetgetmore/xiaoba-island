// 闪电折线：在“舞台”中、岛后方天空里生成一道带分叉的光带，每次打雷重新随机。
import * as THREE from 'three';

const MAIN = 16;
const BR = 7;
// 条带：[点数, 宽度(画面高度比例), 透明度]
const STRIPS = [
  [MAIN, 0.011, 1.0], [MAIN, 0.05, 0.25],
  [BR, 0.007, 0.9], [BR, 0.032, 0.2],
  [BR, 0.007, 0.9], [BR, 0.032, 0.2],
];

export function createLightning(stage, rng, depth = 140) {
  let totalPts = 0;
  for (const s of STRIPS) totalPts += s[0];
  const verts = totalPts * 2;
  const pos = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 4);
  const idx = [];
  let vOff = 0;
  const stripVert = [];
  for (const [n, , a] of STRIPS) {
    stripVert.push(vOff);
    for (let i = 0; i < n; i++) {
      const j = (vOff + i * 2) * 4;
      const glow = a < 0.3;
      for (let k = 0; k < 2; k++) {
        col[j + k * 4] = glow ? 0.65 : 1;
        col[j + k * 4 + 1] = glow ? 0.78 : 1;
        col[j + k * 4 + 2] = 1;
        col[j + k * 4 + 3] = a;
      }
      if (i < n - 1) {
        const v = vOff + i * 2;
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    vOff += n * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, fog: false, toneMapped: false,
    side: THREE.DoubleSide, opacity: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky.bolt';
  mesh.frustumCulled = false;
  mesh.renderOrder = -45;
  mesh.visible = false;

  // 折线的 NDC 点
  const mainU = new Float32Array(MAIN), mainV = new Float32Array(MAIN);
  const b1U = new Float32Array(BR), b1V = new Float32Array(BR);
  const b2U = new Float32Array(BR), b2V = new Float32Array(BR);
  let seq = -1;

  function branch(bu, bv, srcU, srcV, startIdx, dir) {
    let u = srcU[startIdx], v = srcV[startIdx];
    for (let i = 0; i < BR; i++) {
      bu[i] = u; bv[i] = v;
      u += dir * (0.03 + rng() * 0.05) + (rng() - 0.5) * 0.03;
      v -= 0.05 + rng() * 0.05;
    }
  }

  function generate() {
    let u = (rng() * 2 - 1) * 0.55;
    let v = 1.08;
    const dv = (1.08 - 0.12) / (MAIN - 1);
    for (let i = 0; i < MAIN; i++) {
      mainU[i] = u; mainV[i] = v;
      u += (rng() - 0.5) * 0.11 + (i % 4 === 3 ? (rng() - 0.5) * 0.08 : 0);
      v -= dv * (0.8 + rng() * 0.4);
    }
    const s1 = 4 + Math.floor(rng() * 3), s2 = 8 + Math.floor(rng() * 3);
    branch(b1U, b1V, mainU, mainV, s1, rng() < 0.5 ? -1 : 1);
    branch(b2U, b2V, mainU, mainV, s2, rng() < 0.5 ? -1 : 1);
  }

  function writeStrip(si, us, vs) {
    const [n, w] = STRIPS[si];
    const hw = stage.size(w, depth) * 0.5;
    const o = stripVert[si];
    const tanH = stage.tanH * depth, tanV = stage.tanV * depth;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      const dx = (us[i1] - us[i0]) * tanH, dy = (vs[i1] - vs[i0]) * tanV;
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l;
      const taper = si >= 2 ? 1 - 0.8 * (i / (n - 1)) : 1 - 0.55 * (i / (n - 1));
      const x = us[i] * tanH, y = vs[i] * tanV;
      const j = (o + i * 2) * 3;
      pos[j] = x + nx * hw * taper; pos[j + 1] = y + ny * hw * taper; pos[j + 2] = -depth;
      pos[j + 3] = x - nx * hw * taper; pos[j + 4] = y - ny * hw * taper; pos[j + 5] = -depth;
    }
  }

  function update(env) {
    if (env.lightningSeq !== seq) {
      if (seq !== -1 || env.lightning > 0.3) generate();
      seq = env.lightningSeq;
    }
    const l = env.lightning;
    if (l < 0.02) { mesh.visible = false; return; }
    mesh.visible = true;
    mat.opacity = Math.min(1, l * 1.4);
    writeStrip(0, mainU, mainV); writeStrip(1, mainU, mainV);
    writeStrip(2, b1U, b1V); writeStrip(3, b1U, b1V);
    writeStrip(4, b2U, b2V); writeStrip(5, b2U, b2V);
    geo.attributes.position.needsUpdate = true;
  }
  generate();
  return { mesh, update };
}
