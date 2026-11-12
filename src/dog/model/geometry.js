// 柴犬几何工具：变形球体（blob）+ 毛簇扰动 + 法线焊接 + 蒙皮几何合并。
// 全部纯数学，Node 无头可运行。
import * as THREE from 'three';

// ---------------------------------------------------------------- 噪声
function hash3(x, y, z, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** 3D 值噪声 [0,1) */
export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let xf = x - xi, yf = y - yi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
    l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  );
}

export const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-9)));
  return t * t * (3 - 2 * t);
};

/**
 * 毛簇扰动系数：给单位方向 d 返回半径倍数（1 ± …）。
 *   amp    低频不规则（手工感）幅度
 *   tuft   毛簇尖起幅度（锯齿状蓬松轮廓）
 *   freq   毛簇密度
 */
export function fluff(d, { amp = 0.04, tuft = 0.05, freq = 5, seed = 1 } = {}) {
  const lo = noise3(d.x * 1.6 + 3.1, d.y * 1.6 + 1.7, d.z * 1.6 + 5.3, seed) - 0.5;
  const n = noise3(d.x * freq + 11, d.y * freq + 7, d.z * freq + 3, seed + 17);
  // 尖一点的毛簇：把噪声峰值锐化
  const t = ss(0.42, 0.8, n);
  return 1 + lo * 2 * amp + t * tuft;
}

// ---------------------------------------------------------------- blob
const _v = new THREE.Vector3();
const _o = new THREE.Vector3();

/**
 * 由单位球（极轴 Y）变形出的光滑形体。deform(v 单位球点, out) 写入新位置。
 * 法线按位置焊接平均，消除球面接缝。
 */
export function blob(ws, hs, deform) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    _o.set(0, 0, 0);
    deform(_v, _o);
    pos.setXYZ(i, _o.x, _o.y, _o.z);
  }
  g.deleteAttribute('uv');
  // 变形函数如果带镜像/轴对调（例如把球的极轴 Y 映射到身体的 Z），三角形的绕向会里外颠倒：
  // 外表面被当成背面剔除，从外面看到的是身体的内壁（表现为“身体有一边是透明的”）。
  // 这里用带符号体积检测，朝向反了就把每个三角形的绕向翻回来。
  fixWinding(g);
  g.computeVertexNormals();
  weldNormals(g);
  return g;
}

/** 保证封闭形体的三角形朝外（带符号体积为正）；朝内则翻转绕向 */
export function fixWinding(g) {
  const pos = g.attributes.position, idx = g.index;
  if (!idx) return g;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < pos.count; i++) { cx += pos.getX(i); cy += pos.getY(i); cz += pos.getZ(i); }
  cx /= pos.count; cy /= pos.count; cz /= pos.count;
  let vol = 0;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const ax = pos.getX(a) - cx, ay = pos.getY(a) - cy, az = pos.getZ(a) - cz;
    const bx = pos.getX(b) - cx, by = pos.getY(b) - cy, bz = pos.getZ(b) - cz;
    const dx = pos.getX(c) - cx, dy = pos.getY(c) - cy, dz = pos.getZ(c) - cz;
    vol += ax * (by * dz - bz * dy) - ay * (bx * dz - bz * dx) + az * (bx * dy - by * dx);
  }
  if (vol < 0) {
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1), c = idx.getX(i + 2);
      idx.setX(i + 1, c); idx.setX(i + 2, b);
    }
    idx.needsUpdate = true;
  }
  return g;
}

/** 椭球（可带毛簇扰动） */
export function ellipsoid(cx, cy, cz, rx, ry, rz, { ws = 24, hs = 16, fur = null, squashBottom = 1 } = {}) {
  return blob(ws, hs, (v, o) => {
    const f = fur ? fluff(v, fur) : 1;
    const by = v.y < 0 ? squashBottom : 1;
    o.set(cx + v.x * rx * f, cy + v.y * ry * f * by, cz + v.z * rz * f);
  });
}

export function weldNormals(g) {
  const pos = g.attributes.position, nor = g.attributes.normal;
  const map = new Map();
  const key = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let a = map.get(k);
    if (!a) { a = [0, 0, 0]; map.set(k, a); }
    a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i);
  }
  for (let i = 0; i < pos.count; i++) {
    const a = map.get(key(i));
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    nor.setXYZ(i, a[0] / l, a[1] / l, a[2] / l);
  }
}

// ---------------------------------------------------------------- 蒙皮合并
/**
 * 把多个部件合并成一个蒙皮几何。每个部件：
 *   geo      BufferGeometry（position/normal，可无索引）
 *   bone     骨骼下标（部件几何定义在该骨骼的局部空间，静止姿态）
 *   matrix   可选：部件在骨骼空间内的附加变换
 *   color    THREE.Color 或 colorFn(pBone, outColor)
 *   skinFn   可选：(pBone, outIdx[4], outW[4]) 自定义权重
 */
export class SkinBuilder {
  constructor(boneRest /* Matrix4[]：骨骼静止时在网格空间的矩阵 */) {
    this.rest = boneRest;
    this.pos = []; this.nor = []; this.col = []; this.si = []; this.sw = []; this.idx = [];
  }

  add(geo, { bone, matrix = null, color, skinFn = null }) {
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const base = this.pos.length / 3;
    const m = new THREE.Matrix4().copy(this.rest[bone]);
    if (matrix) m.multiply(matrix);
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const pm = matrix ? matrix : new THREE.Matrix4();
    const p = new THREE.Vector3(), pb = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
    const bi = [0, 0, 0, 0], bw = [0, 0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      pb.copy(p).applyMatrix4(pm);
      if (typeof color === 'function') color(pb, c); else c.copy(color);
      bi.fill(0); bw.fill(0);
      if (skinFn) skinFn(pb, bi, bw); else { bi[0] = bone; bw[0] = 1; }
      const s = bw[0] + bw[1] + bw[2] + bw[3] || 1;
      p.applyMatrix4(m);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(c.r, c.g, c.b);
      this.si.push(bi[0], bi[1], bi[2], bi[3]);
      this.sw.push(bw[0] / s, bw[1] / s, bw[2] / s, bw[3] / s);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < pos.count; i++) this.idx.push(base + i);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** 静态（非蒙皮）几何合并：带顶点色 */
export function mergeColored(list /* [{geo, matrix?, color}] */) {
  const pos = [], nor = [], col = [], idx = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  for (const { geo, matrix, color } of list) {
    const m = matrix || new THREE.Matrix4();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const P = geo.attributes.position, N = geo.attributes.normal;
    const base = pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i);
      if (typeof color === 'function') color(p, c); else c.copy(color);
      p.applyMatrix4(m);
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
