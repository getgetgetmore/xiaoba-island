// 小游戏用的几何 / 纹理小工具：
//  - mergeParts：把若干带颜色的基础形体烘成一个带顶点色的几何（一个物体只占一个 draw call），底部略压暗（贴地的“暗角”）；
//  - 程序化纹理（DataTexture，纯 JS 生成，Node 下也能 import）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** 一个形体：几何 + 颜色 + 变换。r 是欧拉角（弧度），s 是缩放（数字或 [x,y,z]） */
export function part(geo, color, o = {}) {
  return { geo, color, q: o.q || null, p: o.p || [0, 0, 0], r: o.r || [0, 0, 0], s: o.s === undefined ? [1, 1, 1] : typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s, ao: o.ao };
}

/** 合并为一个带顶点色的 BufferGeometry。aoH：离地多高以内逐渐压暗到 ~75%（0 = 不压暗） */
export function mergeParts(parts, { aoH = 0.5 } = {}) {
  const gs = [];
  for (const pt of parts) {
    let g = pt.geo.clone();
    if (pt.q) _q.copy(pt.q); else { _e.set(pt.r[0], pt.r[1], pt.r[2]); _q.setFromEuler(_e); }
    _m.compose(_p.set(pt.p[0], pt.p[1], pt.p[2]), _q, _s.set(pt.s[0], pt.s[1], pt.s[2]));
    g.applyMatrix4(_m);
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute('uv');
    _c.set(pt.color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const pa = g.attributes.position;
    const ao = pt.ao === undefined ? aoH : pt.ao;
    for (let i = 0; i < n; i++) {
      const y = pa.getY(i);
      let f = 1;
      if (ao > 0) { const t = Math.min(1, Math.max(0, y / ao)); f = 0.74 + 0.26 * (t * t * (3 - 2 * t)); }
      col[i * 3] = _c.r * f; col[i * 3 + 1] = _c.g * f; col[i * 3 + 2] = _c.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    gs.push(g);
  }
  const out = mergeGeometries(gs, false);
  for (const g of gs) g.dispose();
  out.computeBoundingSphere();
  return out;
}

// 常用基础形体（低面数，手绘风不需要太细）
export const G = {
  box: (x = 1, y = 1, z = 1) => new THREE.BoxGeometry(x, y, z),
  sphere: (r = 0.5, w = 9, h = 7) => new THREE.SphereGeometry(r, w, h),
  ico: (r = 0.5, d = 1) => new THREE.IcosahedronGeometry(r, d),
  cyl: (rt = 0.5, rb = 0.5, h = 1, n = 10) => new THREE.CylinderGeometry(rt, rb, h, n),
  cone: (r = 0.5, h = 1, n = 10) => new THREE.ConeGeometry(r, h, n),
  torus: (r = 0.5, t = 0.1, rs = 8, ts = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc),
  capsule: (r = 0.2, len = 0.5) => new THREE.CapsuleGeometry(r, len, 4, 8),
};

// ------------------------------------------------------------------ 程序化纹理
function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** 可平铺的值噪声（period 为格子周期） */
function tnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a) => ((a % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed), b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed), d = hash2(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function makeTexture(w, h, fill) {
  const data = new Uint8Array(w * h * 4);
  const rgb = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fill(x, y, rgb);
      const i = (y * w + x) * 4;
      data[i] = Math.max(0, Math.min(255, rgb[0])); data[i + 1] = Math.max(0, Math.min(255, rgb[1])); data[i + 2] = Math.max(0, Math.min(255, rgb[2])); data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** 步道铺砖：贴图覆盖 2.0 米（横向）× 1.2 米（纵向），两行错缝的长方砖，砖缝、色差、磨损。u 横向，v 沿路 */
export function makePaveTexture(size = 256) {
  const pal = [[222, 200, 165], [214, 186, 150], [228, 208, 176], [205, 176, 142], [219, 193, 158]];
  const grout = [150, 128, 104];
  return makeTexture(size, size, (x, y, out) => {
    const rowH = size / 2, colW = size / 2;
    const row = Math.floor(y / rowH);
    const xo = (x + (row % 2) * colW * 0.5 + size) % size;
    const col = Math.floor(xo / colW);
    const lx = xo - col * colW, ly = y - row * rowH;
    const edge = Math.min(lx, colW - lx, ly, rowH - ly);
    const id = row * 2 + col;
    const base = pal[Math.floor(hash2(id, 3, 7) * pal.length)];
    const n = tnoise(x / 9, y / 9, size / 9, 5) * 0.6 + tnoise(x / 3, y / 3, size / 3, 9) * 0.4;
    const k = 0.92 + (n - 0.5) * 0.2;
    // 每块砖内部略有渐变（像一笔扫过去）
    const g = 1 + (ly / rowH - 0.5) * 0.05;
    let r = base[0] * k * g, gg = base[1] * k * g, b = base[2] * k * g;
    if (edge < 4.5) { // 砖缝（带一点抖动）
      const t = Math.min(1, Math.max(0, (edge - 1.2 - (n - 0.5) * 2.2) / 3.2));
      r = grout[0] + (r - grout[0]) * t; gg = grout[1] + (gg - grout[1]) * t; b = grout[2] + (b - grout[2]) * t;
    } else if (edge < 7) { // 砖边略亮
      r *= 1.04; gg *= 1.04; b *= 1.03;
    }
    out[0] = r; out[1] = gg; out[2] = b;
  });
}

/** 草地：贴图覆盖 6 米见方；三种绿色的块状笔触 + 细草丛 + 偶尔的小花 */
export function makeGrassTexture(size = 256) {
  const A = [112, 168, 68], B = [92, 150, 58], C = [138, 188, 84], D = [74, 130, 56];
  return makeTexture(size, size, (x, y, out) => {
    const n1 = tnoise(x / 22, y / 22, size / 22, 1);
    const n2 = tnoise(x / 8, y / 8, size / 8, 2);
    const n3 = tnoise(x / 2.5, y / 2.5, size / 2.5, 3);
    let t = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
    let r, g, b;
    if (t < 0.4) { const k = t / 0.4; r = D[0] + (B[0] - D[0]) * k; g = D[1] + (B[1] - D[1]) * k; b = D[2] + (B[2] - D[2]) * k; }
    else if (t < 0.62) { const k = (t - 0.4) / 0.22; r = B[0] + (A[0] - B[0]) * k; g = B[1] + (A[1] - B[1]) * k; b = B[2] + (A[2] - B[2]) * k; }
    else { const k = Math.min(1, (t - 0.62) / 0.25); r = A[0] + (C[0] - A[0]) * k; g = A[1] + (C[1] - A[1]) * k; b = A[2] + (C[2] - A[2]) * k; }
    // 竖向的细草丛划痕
    const tuft = tnoise(x / 1.6, y / 6, size / 1.6, 4);
    if (tuft > 0.72) { r *= 1.12; g *= 1.1; b *= 0.95; }
    // 小花
    const fx = Math.floor(x / 16), fy = Math.floor(y / 16);
    const hv = hash2(fx, fy, 11);
    if (hv > 0.93) {
      const cx = fx * 16 + 4 + hash2(fx, fy, 12) * 8, cy = fy * 16 + 4 + hash2(fx, fy, 13) * 8;
      const dd = Math.hypot(x - cx, y - cy);
      if (dd < 2.2) {
        const kind = Math.floor(hash2(fx, fy, 14) * 3);
        const col = kind === 0 ? [250, 246, 232] : kind === 1 ? [250, 212, 90] : [244, 160, 180];
        r = col[0]; g = col[1]; b = col[2];
      }
    }
    out[0] = r; out[1] = g; out[2] = b;
  });
}

/** 软边圆形（阴影、云、光晕用）：中心不透明、向外渐隐。返回 alpha 在 A 通道、RGB 全白的贴图 */
export function makeSoftDisc(size = 64, hard = 0.35) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      let a = 1 - Math.min(1, Math.max(0, (d - hard) / (1 - hard)));
      a = a * a * (3 - 2 * a);
      const i = (y * size + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** 两点之间的一根圆柱（管子 / 肢体 / 车架） */
export function tube(a, b, r, color, seg = 8, r2 = r) {
  _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]);
  const len = _a.distanceTo(_b);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
  return part(new THREE.CylinderGeometry(r2, r, len, seg), color, { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], q, ao: 0 });
}

/** 确定性哈希，[0,1) */
export function hash1(k, salt = 0) { return hash2(k | 0, salt | 0, 91); }
