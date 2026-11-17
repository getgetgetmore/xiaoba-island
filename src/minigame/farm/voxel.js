// 方块建模工具：1 个方块 = 1/16 世界单位（VOX）。
// 用法：const b = new VoxelBuilder(); b.box(x, y, z, w, h, d, 0xRRGGBB); ... const geo = b.build();
//  - 坐标都是方块坐标（整数，y 向上），后加的盒子覆盖先加的；b.clear 可以挖洞。
//  - build() 先栅格化到稠密网格，再做“贪心网格”：被挡住的内部面全部剔除，同色的相邻面合并成大矩形，
//    所以面数很少；每个面一个法线（平直着色），颜色写进顶点色（线性空间），没有贴图。
//  - 默认把 x/z 方向的包围盒中心移到原点、底面放到 y=0（原点在底面中心，且仍对齐方块网格）。
import * as THREE from 'three';

export const VOX = 1 / 16;

/** 所有方块物件共用的简单材质（顶点色 + 朗伯光照，平直着色由几何的面法线保证）。 */
export const voxelMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

const _c = new THREE.Color();

export class VoxelBuilder {
  constructor() {
    this.ops = [];
    this.colors = [0]; // 调色板索引（1..255），0 = 空
    this.colorIndex = new Map();
  }

  _ci(color) {
    let i = this.colorIndex.get(color);
    if (i === undefined) {
      i = this.colors.length;
      if (i > 255) throw new Error('VoxelBuilder: 颜色超过 255 种');
      this.colors.push(color);
      this.colorIndex.set(color, i);
    }
    return i;
  }

  /** 实心盒子：最小角 (x,y,z)，尺寸 (w,h,d)，单位都是方块。 */
  box(x, y, z, w, h, d, color) {
    w = Math.round(w); h = Math.round(h); d = Math.round(d);
    if (w <= 0 || h <= 0 || d <= 0) return this;
    this.ops.push({ t: 1, x: Math.round(x), y: Math.round(y), z: Math.round(z), w, h, d, c: this._ci(color) });
    return this;
  }

  /** 单个方块。 */
  set(x, y, z, color) { return this.box(x, y, z, 1, 1, 1, color); }

  /** 挖掉一个盒子（做门洞、窗洞）。 */
  clear(x, y, z, w, h, d) {
    w = Math.round(w); h = Math.round(h); d = Math.round(d);
    if (w <= 0 || h <= 0 || d <= 0) return this;
    this.ops.push({ t: 0, x: Math.round(x), y: Math.round(y), z: Math.round(z), w, h, d, c: 0 });
    return this;
  }

  /** 逐格填充：fn(x, y, z) 返回颜色或 null/undefined（不填）。用于圆柱、球、花纹。 */
  cells(x, y, z, w, h, d, fn) {
    for (let k = 0; k < d; k++) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = fn(i, j, k);
      if (c !== null && c !== undefined) this.set(x + i, y + j, z + k, c);
    }
    return this;
  }

  /** 竖直圆柱：中心 (cx, cz)（可为半格），半径 r，从 y 起高 h。 */
  cylY(cx, cz, r, y, h, color, colorFn) {
    const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), z0 = Math.floor(cz - r), z1 = Math.ceil(cz + r);
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
      if (dx * dx + dz * dz <= r * r) {
        if (colorFn) {
          for (let j = 0; j < h; j++) { const c = colorFn(x, y + j, z, dx, dz); if (c !== null && c !== undefined) this.set(x, y + j, z, c); }
        } else this.box(x, y, z, 1, h, 1, color);
      }
    }
    return this;
  }

  /**
   * 合并成一个 BufferGeometry（非索引，position / normal / color）。
   * opts.center = false 时保留原坐标（不平移）。
   */
  build(opts = {}) {
    const center = opts.center !== false;
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (const o of this.ops) {
      if (!o.t) continue;
      mnx = Math.min(mnx, o.x); mny = Math.min(mny, o.y); mnz = Math.min(mnz, o.z);
      mxx = Math.max(mxx, o.x + o.w); mxy = Math.max(mxy, o.y + o.h); mxz = Math.max(mxz, o.z + o.d);
    }
    if (!isFinite(mnx)) return new THREE.BufferGeometry();
    const W = mxx - mnx, H = mxy - mny, D = mxz - mnz;
    const grid = new Uint8Array(W * H * D);
    const idx = (x, y, z) => (z * H + y) * W + x;
    for (const o of this.ops) {
      const x0 = o.x - mnx, y0 = o.y - mny, z0 = o.z - mnz;
      for (let z = Math.max(0, z0); z < Math.min(D, z0 + o.d); z++)
        for (let y = Math.max(0, y0); y < Math.min(H, y0 + o.h); y++)
          for (let x = Math.max(0, x0); x < Math.min(W, x0 + o.w); x++) grid[idx(x, y, z)] = o.c;
    }
    // 平移：x/z 取包围盒中心（取整，保持方块对齐），y 取底面
    const ox = center ? -Math.round((mnx + mxx) / 2) : 0;
    const oz = center ? -Math.round((mnz + mxz) / 2) : 0;
    const oy = center ? -mny : 0;
    const base = [mnx + ox, mny + oy, mnz + oz];

    const pos = [], nor = [], col = [];
    const dims = [W, H, D];
    const get = (c) => (c[0] < 0 || c[1] < 0 || c[2] < 0 || c[0] >= W || c[1] >= H || c[2] >= D) ? 0 : grid[idx(c[0], c[1], c[2])];
    const lin = this.colors.map((hex) => { _c.setHex(hex); return [_c.r, _c.g, _c.b]; });

    for (let d = 0; d < 3; d++) {
      const u = (d + 1) % 3, v = (d + 2) % 3;
      const nu = dims[u], nv = dims[v];
      const mask = new Uint8Array(nu * nv);
      const c = [0, 0, 0], n = [0, 0, 0];
      for (const side of [1, -1]) {
        for (let i = 0; i < dims[d]; i++) {
          mask.fill(0);
          for (let b = 0; b < nv; b++) for (let a = 0; a < nu; a++) {
            c[d] = i; c[u] = a; c[v] = b;
            const cur = grid[idx(c[0], c[1], c[2])];
            if (!cur) continue;
            n[0] = c[0]; n[1] = c[1]; n[2] = c[2]; n[d] += side;
            if (!get(n)) mask[b * nu + a] = cur;
          }
          for (let b = 0; b < nv; b++) {
            for (let a = 0; a < nu;) {
              const m = mask[b * nu + a];
              if (!m) { a++; continue; }
              let w = 1;
              while (a + w < nu && mask[b * nu + a + w] === m) w++;
              let h = 1;
              outer: for (; b + h < nv; h++) {
                for (let k = 0; k < w; k++) if (mask[(b + h) * nu + a + k] !== m) break outer;
              }
              for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[(b + hh) * nu + a + k] = 0;
              // 输出四边形
              const plane = i + (side > 0 ? 1 : 0);
              const q = [[a, b], [a + w, b], [a + w, b + h], [a, b + h]];
              const P = q.map(([qu, qv]) => {
                const p = [0, 0, 0];
                p[d] = plane; p[u] = qu; p[v] = qv;
                return [(p[0] + base[0]) * VOX, (p[1] + base[1]) * VOX, (p[2] + base[2]) * VOX];
              });
              const order = side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
              const nn = [0, 0, 0]; nn[d] = side;
              const cc = lin[m];
              for (const k of order) { pos.push(P[k][0], P[k][1], P[k][2]); nor.push(nn[0], nn[1], nn[2]); col.push(cc[0], cc[1], cc[2]); }
              a += w;
            }
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData.size = { w: W * VOX, h: H * VOX, d: D * VOX };
    return geo;
  }
}

/** 几何的三角形数。 */
export function triCount(geo) {
  return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
}

/**
 * 把一批静态网格（带世界矩阵）烘进一个几何，减少 draw call。
 * 只支持 voxel.js 产出的几何（非索引，position / normal / color）。
 */
export function mergeStatic(meshes) {
  let n = 0;
  for (const m of meshes) n += m.geometry.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const occ = new Float32Array(n * 4); // aOcc：mesh.userData.occ = [x, z, 半径, 高度]（会挡住小狗的树），没有就是 0
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let o = 0;
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    nm.getNormalMatrix(m.matrixWorld);
    const g = m.geometry, p = g.attributes.position, nn = g.attributes.normal, cc = g.attributes.color, oc = m.userData.occ || null;
    for (let i = 0; i < p.count; i++, o++) {
      if (oc) { occ[o * 4] = oc[0]; occ[o * 4 + 1] = oc[1]; occ[o * 4 + 2] = oc[2]; occ[o * 4 + 3] = oc[3]; }
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
      v.fromBufferAttribute(nn, i).applyMatrix3(nm).normalize();
      nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
      col[o * 3] = cc.getX(i); col[o * 3 + 1] = cc.getY(i); col[o * 3 + 2] = cc.getZ(i);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aOcc', new THREE.BufferAttribute(occ, 4));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
