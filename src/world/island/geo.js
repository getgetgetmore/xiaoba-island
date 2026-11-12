// 几何构建工具：把大量零件合并成一个带顶点色的 BufferGeometry（非索引）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, smoothstep } from '../../core/util.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();

export function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + 0.123) * 43758.5453;
  return s - Math.floor(s);
}

/** 按位置哈希扰动顶点（重合顶点同扰动，不裂缝） */
export function jitterGeo(geo, amt, seed = 0) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i,
      x + (hash3(x + seed, y, z) - 0.5) * 2 * amt,
      y + (hash3(x, y + seed, z + 7.1) - 0.5) * 2 * amt,
      z + (hash3(x + 3.3, y, z + seed) - 0.5) * 2 * amt);
  }
  p.needsUpdate = true;
  return geo;
}

export function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

export function linRGB(hex, out = []) {
  _c.setHex(hex);
  out[0] = _c.r; out[1] = _c.g; out[2] = _c.b;
  return out;
}

export class GeoBuilder {
  constructor({ seed = 1, jitter = 0.06, aoH = 0.5, aoK = 0.25 } = {}) {
    this.parts = [];
    this.rng = mulberry32(seed);
    this.jitter = jitter;
    this.aoH = aoH;
    this.aoK = aoK;
  }

  /** o: pos, rot, scale, color(hex|fn(nx,ny,nz,cx,cy,cz)), jitter, ao */
  add(geo, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
    g.clearGroups();
    const pp = o.pos || [0, 0, 0], rr = o.rot || [0, 0, 0], sc = o.scale === undefined ? 1 : o.scale;
    _p.set(pp[0], pp[1], pp[2]);
    _e.set(rr[0], rr[1], rr[2]);
    _q.setFromEuler(_e);
    if (typeof sc === 'number') _s.set(sc, sc, sc); else _s.set(sc[0], sc[1], sc[2]);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3);
    const jit = o.jitter === undefined ? this.jitter : o.jitter;
    const useAo = o.ao === undefined ? true : o.ao;
    for (let i = 0; i < n; i += 3) {
      const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
      const bx = pos.getX(i + 1) - ax, by = pos.getY(i + 1) - ay, bz = pos.getZ(i + 1) - az;
      const cx2 = pos.getX(i + 2) - ax, cy2 = pos.getY(i + 2) - ay, cz2 = pos.getZ(i + 2) - az;
      let nx = by * cz2 - bz * cy2, ny = bz * cx2 - bx * cz2, nz = bx * cy2 - by * cx2;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const cx = ax + (bx + cx2) / 3, cy = ay + (by + cy2) / 3, cz = az + (bz + cz2) / 3;
      const hex = typeof o.color === 'function' ? o.color(nx, ny, nz, cx, cy, cz) : (o.color === undefined ? 0xffffff : o.color);
      _c.setHex(hex);
      const f = 1 + (this.rng() - 0.5) * 2 * jit;
      for (let k = 0; k < 3; k++) {
        const vy = pos.getY(i + k);
        const ao = useAo ? 1 - this.aoK * (1 - smoothstep(0, this.aoH, vy)) : 1;
        col[(i + k) * 3] = _c.r * f * ao; col[(i + k) * 3 + 1] = _c.g * f * ao; col[(i + k) * 3 + 2] = _c.b * f * ao;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }

  build() {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const g = mergeGeometries(this.parts, false);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** 两点间的锥形圆柱（树枝、树根、栅栏横梁） */
export function cylBetween(b, p, q, r0, r1, sides, o = {}) {
  _d.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  const len = _d.length() || 1e-4;
  _d.normalize();
  _q.setFromUnitVectors(_up, _d);
  _e.setFromQuaternion(_q, 'XYZ');
  b.add(new THREE.CylinderGeometry(r1, r0, len, sides, 1), {
    ...o, pos: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], rot: [_e.x, _e.y, _e.z],
  });
}

export function blob(b, pos, radius, detail, o = {}) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  if (o.jit) jitterGeo(g, o.jit, o.seed || 0);
  const s = o.scale || [1, 1, 1];
  b.add(g, { ...o, pos, scale: [radius * s[0], radius * s[1], radius * s[2]] });
}
