// 岛面（平滑着色，顶点色）与厚实的岩土侧壁/底部（大块面、橙红斑块、裂缝、垂根）。
import * as THREE from 'three';
import { smoothstep, valueNoise2, hash2, TAU, mulberry32 } from '../../core/util.js';
import { C } from './colors.js';
import { L, outlineR, heightAt, pondU } from './shape.js';
import { mixHex, linRGB, GeoBuilder, cylBetween, jitterGeo } from './geo.js';

export const NS = 96;
const T_RINGS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.78, 0.85, 0.91, 0.96, 1.0];

const edgeR = new Float32Array(NS);
for (let i = 0; i < NS; i++) edgeR[i] = outlineR((i / NS) * TAU) + (hash2(i, 3, 5) - 0.5) * 0.1 + (valueNoise2(i * 0.7, 2, 9) - 0.5) * 0.12;

const angN = (a, k, f, seed = 31) => valueNoise2(Math.cos(a) * f + k * 13.1, Math.sin(a) * f + k * 5.7, seed);

function topColorHex(x, z, e) {
  const n1 = valueNoise2(x * 0.3 + 5, z * 0.3 + 9, 3), n2 = valueNoise2(x * 0.9, z * 0.9, 5);
  let c = mixHex(C.groundDark, C.ground, smoothstep(0.25, 0.65, n1));
  c = mixHex(c, C.grassOlive, smoothstep(0.55, 0.9, n1) * 0.6);
  c = mixHex(c, C.grassDeep, (1 - smoothstep(0.35, 0.55, n2)) * 0.25);
  const dx = x - L.lawn.x, dz = z - L.lawn.z;
  const a = Math.atan2(dz, dx);
  const dl = Math.hypot(dx, dz) / (1 + 0.05 * Math.sin(a * 3 + 1.3) + 0.03 * Math.sin(a * 5 + 0.4));
  const lk = 1 - smoothstep(L.lawn.r - 0.7, L.lawn.r + 0.5, dl);
  c = mixHex(c, mixHex(C.lawnDark, C.lawn, n2), lk * 0.9);
  c = mixHex(c, C.groundDark, (1 - smoothstep(0, 0.9, e)) * 0.5);
  const pu = pondU(x, z);
  c = mixHex(c, C.soil, (1 - smoothstep(0.95, 1.5, pu)) * 0.75);
  const door = L.kennel;
  const ddx = x - (door.x + door.dx * 1.9), ddz = z - (door.z + door.dz * 1.9);
  c = mixHex(c, C.soilMid, (1 - smoothstep(0.2, 1.0, Math.hypot(ddx, ddz))) * 0.5);
  return c;
}

export function buildTopGeometry() {
  const K = T_RINGS.length;
  const nv = 1 + (K - 1) * NS;
  const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const rgb = [0, 0, 0];
  const vi = (k, i) => (k === 0 ? 0 : 1 + (k - 1) * NS + (((i % NS) + NS) % NS));
  for (let k = 0; k < K; k++) {
    for (let i = 0; i < (k === 0 ? 1 : NS); i++) {
      const a = (i / NS) * TAU;
      const r = edgeR[i] * T_RINGS[k];
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = heightAt(x, z);
      const idx = vi(k, i);
      pos[idx * 3] = x; pos[idx * 3 + 1] = y; pos[idx * 3 + 2] = z;
      const e = edgeR[i] - r;
      linRGB(topColorHex(x, z, e), rgb);
      col[idx * 3] = rgb[0]; col[idx * 3 + 1] = rgb[1]; col[idx * 3 + 2] = rgb[2];
    }
  }
  const idxs = [];
  for (let i = 0; i < NS; i++) {
    idxs.push(0, vi(1, i + 1), vi(1, i));
    for (let k = 1; k < K - 1; k++) {
      const p00 = vi(k, i), p01 = vi(k, i + 1), p10 = vi(k + 1, i), p11 = vi(k + 1, i + 1);
      if ((i + k) % 2) { idxs.push(p00, p01, p10, p11, p10, p01); } else { idxs.push(p00, p01, p11, p00, p11, p10); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idxs);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------------- 侧壁 / 底部 ----------------
const RINGS = [
  { f: 1.0, y: null },
  { f: 1.02, y: null },
  { f: 0.985, y: -0.75, jr: 0.012, jy: 0.08 },
  { f: 0.96, y: -1.5, jr: 0.03, jy: 0.14 },
  { f: 0.92, y: -2.3, jr: 0.05, jy: 0.18 },
  { f: 0.84, y: -3.0, jr: 0.06, jy: 0.2 },
  { f: 0.68, y: -3.6, jr: 0.07, jy: 0.18 },
  { f: 0.42, y: -3.95, jr: 0.08, jy: 0.14 },
  { f: 0.0, y: -4.05 },
];
const STRIP_COL = [
  [0x4b5f2c, 0x3a4a26], [0x6e4636, 0x5c3a2e], [0x5c3a2e, 0x4f3229], [0x4a2f27, 0x4a3430],
  [0x4d3a33, 0x57493f], [0x57493f, 0x4e4038], [0x4e4038, 0x433732], [0x433732, 0x3a2f2b],
];
const CH = 4; // 块面宽度（段数）

function ringVertex(k, i, out) {
  const a = (i / NS) * TAU;
  const R = RINGS[k];
  const er = edgeR[i % NS];
  if (k === 0) {
    const x = Math.cos(a) * er, z = Math.sin(a) * er;
    out[0] = x; out[1] = heightAt(x, z); out[2] = z;
    return out;
  }
  if (k === 1) {
    const x = Math.cos(a) * er * R.f, z = Math.sin(a) * er * R.f;
    const x0 = Math.cos(a) * er, z0 = Math.sin(a) * er;
    out[0] = x; out[1] = heightAt(x0, z0) - (0.14 + 0.2 * hash2(i, 1, 4) * hash2(i >> 1, 2, 4)); out[2] = z;
    return out;
  }
  if (k === RINGS.length - 1) {
    out[0] = 0.25; out[1] = R.y; out[2] = -0.1;
    return out;
  }
  const blk = Math.floor((i + k * 2) / CH);
  const nr = (angN(a, k, 2.2) - 0.5) * 2 * 0.6 + (hash2(blk, k, 7) - 0.5) * 2 * 0.4 + (hash2(i, k, 3) - 0.5) * 0.15;
  const ny = (angN(a, k + 9, 2.6) - 0.5) * 2 * 0.6 + (hash2(blk, k, 17) - 0.5) * 2 * 0.4;
  // 底部凸起的块
  const lobe = Math.pow(angN(a, 0, 1.7), 2.0) * (k >= 4 ? (k - 3) * 0.17 : 0);
  const r = er * R.f * (1 + nr * R.jr);
  out[0] = Math.cos(a) * r; out[1] = R.y + ny * R.jy - lobe; out[2] = Math.sin(a) * r;
  return out;
}

export function buildBodyGeometry() {
  const rng = mulberry32(77);
  const P = [], Cc = [];
  const rows = [];
  for (let k = 0; k < RINGS.length; k++) {
    const row = [];
    for (let i = 0; i <= NS; i++) row.push(ringVertex(k, i, [0, 0, 0]));
    rows.push(row);
  }
  const ca = [0, 0, 0], cb = [0, 0, 0], tmp = [0, 0, 0];
  const emit = (a, b, c, hexA, hexB, hexC, f) => {
    if ((Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) < 1e-6) return;
    if ((Math.abs(b[0] - c[0]) + Math.abs(b[1] - c[1]) + Math.abs(b[2] - c[2])) < 1e-6) return;
    if ((Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) + Math.abs(a[2] - c[2])) < 1e-6) return;
    P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (const h of [hexA, hexB, hexC]) {
      linRGB(h, tmp);
      Cc.push(tmp[0] * f, tmp[1] * f, tmp[2] * f);
    }
  };
  for (let k = 0; k < RINGS.length - 1; k++) {
    const [c0, c1] = STRIP_COL[k];
    for (let i = 0; i < NS; i++) {
      const p00 = rows[k][i], p01 = rows[k][i + 1], p10 = rows[k + 1][i], p11 = rows[k + 1][i + 1];
      const a = ((i + 0.5) / NS) * TAU;
      const my = (p00[1] + p10[1]) / 2;
      let f = 1 + (rng() - 0.5) * 0.18;
      let m0 = c0, m1 = c1;
      if (k >= 1 && k <= 5) {
        const n = valueNoise2(Math.cos(a) * 3.1 + k * 2.3, my * 0.9 + Math.sin(a) * 3.1, 13);
        if (n > 0.7) { const t = Math.min(1, (n - 0.7) * 6) * 0.8; m0 = mixHex(c0, C.rust, t); m1 = mixHex(c1, C.rust, t * 0.85); }
        else if (n < 0.22) { m0 = mixHex(c0, C.rockLight, 0.35); m1 = mixHex(c1, C.rockLight, 0.3); }
      }
      if (k >= 2 && ((i + k * 2) % CH === 0)) f *= 0.62; // 裂缝
      if (k === 0) f *= 0.95;
      if ((i + k) % 2) {
        emit(p00, p01, p10, m0, m0, m1, f);
        emit(p11, p10, p01, m1, m1, m0, f * (1 + (rng() - 0.5) * 0.1));
      } else {
        emit(p00, p01, p11, m0, m0, m1, f);
        emit(p00, p11, p10, m0, m1, m1, f * (1 + (rng() - 0.5) * 0.1));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  g.computeVertexNormals();
  return g;
}

/** 近似侧壁半径（用于贴岩块、树根） */
function sideRadius(a, y) {
  const er = outlineR(a);
  let k = 2;
  while (k < RINGS.length - 2 && y < RINGS[k + 1].y) k++;
  const r0 = RINGS[k], r1 = RINGS[k + 1];
  const t = Math.max(0, Math.min(1, (y - r0.y) / (r1.y - r0.y)));
  return er * (r0.f + (r1.f - r0.f) * t);
}

/** 突出的岩块、垂根、裂缝 */
export function buildBodyDecor() {
  const b = new GeoBuilder({ seed: 55, jitter: 0.09, aoK: 0 });
  const rng = mulberry32(99);
  // 岩块
  for (let n = 0; n < 22; n++) {
    const front = n < 15;
    const a = front ? (0.15 + 0.7 * rng()) * Math.PI : rng() * TAU;
    const y = -0.9 - rng() * 2.6;
    const rad = 0.38 + rng() * 0.5;
    const sr = sideRadius(a, y) - rad * 0.35;
    const g = new THREE.IcosahedronGeometry(1, 1);
    jitterGeo(g, 0.18, n * 3.7);
    const rustish = rng() < 0.3;
    b.add(g, {
      pos: [Math.cos(a) * sr, y, Math.sin(a) * sr], rot: [rng() * 3, rng() * 6, rng() * 3],
      scale: [rad * (0.9 + rng() * 0.5), rad * (0.6 + rng() * 0.4), rad * (0.9 + rng() * 0.5)],
      color: (nx, ny) => {
        let c = mixHex(C.rockCool, C.rockLight, Math.max(0, ny) * 0.8);
        if (rustish) c = mixHex(c, C.rust, 0.55);
        return mixHex(c, C.soilDark, Math.max(0, -ny) * 0.5);
      },
    });
  }
  // 垂根
  for (let n = 0; n < 11; n++) {
    const a = (n < 8 ? (0.1 + 0.8 * rng()) * Math.PI : rng() * TAU);
    const y0 = -0.5 - rng() * 0.5, len = 1.0 + rng() * 1.6;
    let px = Math.cos(a) * (sideRadius(a, y0) + 0.02), py = y0, pz = Math.sin(a) * (sideRadius(a, y0) + 0.02);
    let r = 0.07 + rng() * 0.05;
    const dir = (rng() - 0.5) * 1.2;
    for (let s = 0; s < 4; s++) {
      const ny = py - len / 4;
      const sr = sideRadius(a, Math.max(ny, -3.4)) + 0.12 + 0.1 * s;
      const nx = Math.cos(a + dir * 0.03 * (s + 1)) * sr + (rng() - 0.5) * 0.12;
      const nz = Math.sin(a + dir * 0.03 * (s + 1)) * sr + (rng() - 0.5) * 0.12;
      cylBetween(b, [px, py, pz], [nx, ny, nz], r, r * 0.72, 5, { color: mixHex(0x6b4a34, 0x8b6a4a, rng() * 0.6), ao: false });
      px = nx; py = ny; pz = nz; r *= 0.72;
    }
  }
  // 裂缝
  for (let n = 0; n < 7; n++) {
    const a = (0.1 + 0.8 * rng()) * Math.PI;
    let y = -0.9 - rng() * 0.5, aa = a;
    let sr = sideRadius(aa, y) * 1.0;
    let px = Math.cos(aa) * sr, pz = Math.sin(aa) * sr;
    const segs = 3 + Math.floor(rng() * 3);
    for (let s = 0; s < segs; s++) {
      const ny = y - 0.3 - rng() * 0.3;
      aa += (rng() - 0.5) * 0.06;
      sr = sideRadius(aa, ny) * 1.003;
      const nx = Math.cos(aa) * sr, nz = Math.sin(aa) * sr;
      cylBetween(b, [px, y, pz], [nx, ny, nz], 0.028, 0.018, 3, { color: C.crack, ao: false, jitter: 0 });
      px = nx; pz = nz; y = ny;
    }
  }
  return b.build();
}

export function buildFloaters() {
  const out = [];
  const defs = [[1.8, -6.2, 1.4, 0.42], [-2.6, -7.0, 0.6, 0.3], [0.4, -5.6, 2.8, 0.26], [3.4, -6.8, -1.2, 0.2]];
  defs.forEach(([x, y, z, r], n) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    jitterGeo(g, 0.2, n * 5.3);
    const b = new GeoBuilder({ seed: 300 + n, jitter: 0.1, aoK: 0 });
    b.add(g, { scale: [r, r * 0.8, r], color: (nx, ny) => mixHex(mixHex(C.rockCool, C.rockLight, Math.max(0, ny)), C.rust, n === 1 ? 0.5 : 0.1) });
    out.push({ geo: b.build(), pos: [x, y, z] });
  });
  return out;
}
