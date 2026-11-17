// 农场大地图（画面）：buildFarmMap() → { group, size: { w, d }, zones, paths, data, heightAt, glowMaterial, stats }
// 布局全部来自 mapData.js 的 FARM_MAP（区域、路、水、物件、树……），这里只负责把它摆成画面，所以画面和逻辑数据的位置一致。
// 坐标：世界单位，原点在地图中心，+x 向东，+z 向南（朝镜头）。可玩区域 64×48，外面再包一圈 8 单位宽的林墙。
// 地面是整张地形网格：每个 4 方块（0.25 单位）的小格有高度和颜色（草的深浅斑块、金黄土路按曲线刷出来、
// 水面低一档、石崖 / 林墙高一档），相邻高度不同的格子之间补侧面。物件、地面细节（草丛 / 小花 / 石子，都是小圆球小圆锥）
// 按 4×4 单位分块合并，每块 1 个网格（视锥裁剪有效，整张图 320 块）；窗玻璃和路灯灯泡合并成一个发光网格（lighting.js 控制夜里的暖光）。
import * as THREE from 'three';
import { TIER as T, PAL as P } from './palette.js';
import { mergeStatic } from './voxel.js';
import { createFarmPropGeometry, createInteractiveProp, createShapeBuilder, farmToonMaterial, hash3 } from './props.js';
import { farmGlowMaterial } from './lighting.js';
import { FARM_MAP } from './mapData.js';

export const MAP_W = FARM_MAP.size.w, MAP_D = FARM_MAP.size.d, MARGIN = 8;
const CS = 4;                       // 地面小格 = 4 个方块
const CU = CS / 16;                 // 小格边长（世界单位）
const X0 = -(MAP_W / 2 + MARGIN), Z0 = -(MAP_D / 2 + MARGIN);
const NX = Math.round((MAP_W + 2 * MARGIN) / CU), NZ = Math.round((MAP_D + 2 * MARGIN) / CU);
const CHUNK = 4;

// ---------------------------------------------------------------- 噪声 / 几何小工具
function smooth(t) { return t * t * (3 - 2 * t); }
function noise2(x, z, seed = 0) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = smooth(x - xi), fz = smooth(z - zi);
  const a = hash3(xi, zi, 0, seed), b = hash3(xi + 1, zi, 0, seed), c = hash3(xi, zi + 1, 0, seed), d = hash3(xi + 1, zi + 1, 0, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
const tierAt = (arr, v) => arr[Math.max(0, Math.min(arr.length - 1, Math.floor(v * arr.length)))];
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
  const L = vx * vx + vz * vz;
  const t = L > 0 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / L)) : 0;
  const dx = wx - t * vx, dz = wz - t * vz;
  return Math.sqrt(dx * dx + dz * dz);
}
function polyDist(px, pz, poly, bb) {
  if (bb && (px < bb[0] || px > bb[1] || pz < bb[2] || pz > bb[3])) return 99;
  let m = 99;
  for (let i = 0; i < poly.length - 1; i++) {
    const d = segDist(px, pz, poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]);
    if (d < m) m = d;
  }
  return m;
}
function bbox(poly, pad) {
  let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
  for (const [x, z] of poly) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); }
  return [a - pad, b + pad, c - pad, d + pad];
}

// ---------------------------------------------------------------- 主函数
export function buildFarmMap(opts = {}) {
  const seed = opts.seed || 7;
  const data = FARM_MAP;
  const sPaths = data.paths.map((p) => ({ ...p, hw: p.width / 2, poly: p.points, bb: bbox(p.points, p.width / 2 + 1.2) }));
  const sStream = data.terrain.stream;
  const streamBB = bbox(sStream, 3);
  const PONDS = data.terrain.ponds, YARDS = data.terrain.yards, CLIFFS = data.terrain.cliffs;

  // ---- 1. 地形网格：每格 类型 / 高度 / 颜色
  const H = new Int16Array(NX * NZ);
  const COL = new Uint32Array(NX * NZ);
  const TYP = new Uint8Array(NX * NZ); // 0 草 1 路 2 水 3 岸 4 院 5 墙 6 崖 7 田 8 石 9 泥 10 锯末
  const SIDE = new Uint32Array(NX * NZ);
  const idx = (i, j) => j * NX + i;

  function grassColor(x, z, hh, shade) {
    let n = noise2(x * 0.42, z * 0.42, 71) * 0.5 + noise2(x * 1.5, z * 1.5, 72) * 0.3 + hh * 0.2 - shade;
    if (noise2(x * 0.9 + 9, z * 0.9, 73) > 0.8) n -= 0.12;
    return tierAt(T.grass, Math.max(0, n - 0.06) * 1.12);
  }
  function classify(x, z, i, j) {
    const hh = hash3(i, j, 1, seed);
    const adx = Math.abs(x) - MAP_W / 2, adz = Math.abs(z) - MAP_D / 2;
    const out = Math.max(adx, adz);
    // 林墙：可玩区域之外，一整片平的树冠（用颜色画出一团团树冠，不做起伏）
    if (out > -0.2) {
      let h = 14;
      if (Math.abs(x - 28) < 1.4 && z < -22) h = 1;
      const cl = noise2(x * 0.85, z * 0.85, 22) * 0.62 + noise2(x * 2.4, z * 2.4, 23) * 0.3 + (hh - 0.5) * 0.14;
      const rimShade = Math.max(0, 1 - (out + 0.2) / 2.2) * 0.12;
      return { t: 5, h, c: tierAt(T.pine, cl * 1.15 - 0.08 - rimShade), s: hh > 0.5 ? T.pine[0] : T.pine[1] };
    }
    for (const c of CLIFFS) {
      const e = ((x - c.x) / c.rx) ** 2 + ((z - c.z) / c.rz) ** 2 + (noise2(x * 0.8, z * 0.8, 31) - 0.5) * 0.5;
      if (e < 1) return { t: 6, h: c.h, c: tierAt(T.grass, 0.25 + noise2(x * 1.4, z * 1.4, 4) * 0.5), s: hh > 0.5 ? T.stone[1] : T.stone[2] };
    }
    // 水：小溪 + 池塘
    let wd = 99, wr = 1;
    const sd = polyDist(x, z, sStream, streamBB);
    const sw = 0.95 + (noise2(x * 0.5, z * 0.5, 41) - 0.5) * 0.7;
    if (sd < sw + 0.6) { wd = sd - sw; wr = sw; }
    for (const p of PONDS) {
      const ang = Math.atan2((z - p.z) / p.rz, (x - p.x) / p.rx);
      const lim = 1 + 0.14 * Math.sin(3 * ang + p.seed) + 0.1 * Math.sin(5 * ang + p.seed * 1.7) + 0.05 * Math.sin(8 * ang + p.seed * 2.3);
      const rr = Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz);
      const d2 = (rr - lim) * Math.min(p.rx, p.rz);
      if (d2 < wd) { wd = d2; wr = Math.min(p.rx, p.rz); }
    }
    if (wd < 0) {
      const depth = Math.min(1, -wd / Math.min(wr, 1.6));
      const v = 0.95 - depth * 0.8 + (hh - 0.5) * 0.2 + (noise2(x * 2, z * 2, 5) > 0.82 ? 0.25 : 0);
      return { t: 2, h: -2, c: tierAt(T.water, v), s: T.soil[1] };
    }
    const bank = wd < 0.42;
    let best = null;
    for (const p of sPaths) {
      const d = polyDist(x, z, p.poly, p.bb);
      const lim = p.hw + (noise2(x * 1.1, z * 1.1, 51) - 0.5) * 0.55;
      if (d < lim && (!best || d - lim < best.m)) best = { m: d - lim, p, edge: lim - d < 0.28 };
    }
    if (best && !(bank && wd < 0.1)) {
      if (best.p.surf === 'stone') return { t: 8, h: 0, c: tierAt(T.stone, 0.45 + hh * 0.5 + (best.edge ? -0.25 : 0)), s: T.stone[0] };
      const v = noise2(x * 1.6, z * 1.6, 52) * 0.55 + hh * 0.35 + 0.1;
      return { t: 1, h: 0, c: best.edge ? (hh > 0.5 ? T.road[0] : T.road[1]) : tierAt(T.road, v), s: T.road[0] };
    }
    if (bank) return { t: 3, h: 0, c: tierAt([T.road[1], T.road[2], T.road[3], T.stone[3]], hh * 0.9 + (wd < 0.18 ? 0 : 0.1)), s: T.road[0] };
    let yard = null;
    for (const y of YARDS) {
      let inside;
      if (y.ell) { const e = ((x - y.cx) / y.rx) ** 2 + ((z - y.cz) / y.rz) ** 2 + (noise2(x * 0.9, z * 0.9, 61) - 0.5) * 0.35; inside = e < 1; }
      else {
        const ex = Math.min(x - y.x0, y.x1 - x), ez = Math.min(z - y.z0, y.z1 - z);
        inside = ex > 0 && ez > 0 && ex + (noise2(x * 1.2, z * 1.2, 62) - 0.5) * 0.4 > 0;
      }
      if (inside) { yard = y; break; }
    }
    if (yard) {
      const k = yard.kind;
      if (k === 'dirt' || k === 'dirtLight') {
        const v = noise2(x * 1.3, z * 1.3, 63) * 0.5 + hh * 0.3 + (k === 'dirtLight' ? 0.35 : 0.1);
        return { t: 4, h: 0, c: tierAt(T.soil, 0.3 + v * 0.75), s: T.soil[0] };
      }
      if (k === 'field') return { t: 7, h: 0, c: tierAt(T.soil, 0.4 + noise2(x * 1.5, z * 1.5, 64) * 0.5 + (hh - 0.5) * 0.2), s: T.soil[0] };
      if (k === 'stone') return { t: 8, h: 0, c: tierAt(T.stone, 0.4 + hh * 0.55), s: T.stone[0] };
      if (k === 'mud') return { t: 9, h: -1, c: tierAt(T.mud, noise2(x * 2, z * 2, 65) * 0.7 + hh * 0.3), s: T.mud[0] };
      if (k === 'sawdust') return { t: 10, h: 0, c: tierAt(T.lumber, 0.1 + noise2(x * 1.8, z * 1.8, 66) * 0.5 + hh * 0.35), s: T.soil[1] };
      return { t: 0, h: 0, c: grassColor(x, z, hh, -0.14), s: T.soil[1] };
    }
    const forest = z < -8.5 && x < 16 ? 0.28 : 0;
    return { t: 0, h: 0, c: grassColor(x, z, hh, forest + (adx > -4 || adz > -4 ? 0.12 : 0)), s: T.soil[1] };
  }
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const x = X0 + (i + 0.5) * CU, z = Z0 + (j + 0.5) * CU;
      const c = classify(x, z, i, j);
      const k = idx(i, j);
      H[k] = c.h; COL[k] = c.c; TYP[k] = c.t; SIDE[k] = c.s;
    }
  }
  const cellOf = (x, z) => [Math.max(0, Math.min(NX - 1, Math.floor((x - X0) / CU))), Math.max(0, Math.min(NZ - 1, Math.floor((z - Z0) / CU)))];
  const heightAt = (x, z) => { const [i, j] = cellOf(x, z); return H[idx(i, j)] / 16; };

  // ---- 2. 物件：全部来自 FARM_MAP.props
  const objs = [];
  const occ = new Map();
  function occAdd(x, z, r) {
    for (let a = Math.floor(x - r); a <= Math.floor(x + r); a++) for (let b = Math.floor(z - r); b <= Math.floor(z + r); b++) {
      const k = a + ',' + b; if (!occ.has(k)) occ.set(k, []); occ.get(k).push([x, z, r]);
    }
  }
  function occFree(x, z, r) {
    const l = occ.get(Math.floor(x) + ',' + Math.floor(z)); if (!l) return true;
    for (const [ox, oz, or] of l) if (Math.hypot(ox - x, oz - z) < r + or) return false;
    return true;
  }
  const SKIP_OCC = new Set(['flowers', 'lily', 'reeds', 'mushroom', 'bush', 'radish_big']);
  const SEE_KINDS = new Set(['tree', 'apple_tree', 'pink_tree', 'pine']); // 挡住小狗时会变半透明的东西（见 props.js 的 farmSeeThrough）
  const interByProp = new Map();
  for (const it of data.interactables) if (it.prop) interByProp.set(it.prop, it);
  for (const e of data.props) {
    const g = createFarmPropGeometry(e.kind, e.opts || {});
    objs.push({ g, e, inter: interByProp.get(e.id) || null });
    if (!SKIP_OCC.has(e.kind)) { const sz = g.userData.size; occAdd(e.x, e.z, Math.min(1.6, Math.max(sz.w, sz.d) * e.s * 0.46)); }
  }

  // ---- 3. 分块：地面网格 + 物件 + 地面细节，合并成每块 1 个网格
  const NCX = Math.ceil((MAP_W + 2 * MARGIN) / CHUNK), NCZ = Math.ceil((MAP_D + 2 * MARGIN) / CHUNK);
  const cellsPerChunk = CHUNK / CU;
  const chunkObjs = Array.from({ length: NCX * NCZ }, () => []);
  for (const o of objs) {
    const cx = Math.max(0, Math.min(NCX - 1, Math.floor((o.e.x - X0) / CHUNK))), cz = Math.max(0, Math.min(NCZ - 1, Math.floor((o.e.z - Z0) / CHUNK)));
    chunkObjs[cz * NCX + cx].push(o);
  }

  const group = new THREE.Group();
  group.name = 'farm_map';
  let tris = 0, groundTris = 0, decorTris = 0, objTris = 0;
  const kindTris = {};
  const chunkInfo = [];
  const glowList = [];
  for (let cz = 0; cz < NCZ; cz++) {
    for (let cx = 0; cx < NCX; cx++) {
      const list = [];
      const gg = groundGeometry(cx, cz);
      groundTris += gg.attributes.position.count / 3;
      list.push(new THREE.Mesh(gg, farmToonMaterial));
      const decor = decorGeometry(cx, cz);
      if (decor) { decorTris += decor.attributes.position.count / 3; list.push(new THREE.Mesh(decor, farmToonMaterial)); }
      for (const o of chunkObjs[cz * NCX + cx]) {
        const e = o.e;
        if (o.inter) continue; // 可互动物件不合并进静态网格，单独成对象（见下面的 objects）
        const m = new THREE.Mesh(o.g, farmToonMaterial);
        m.position.set(e.x, e.y !== undefined ? e.y : heightAt(e.x, e.z), e.z);
        m.rotation.y = e.rot; m.scale.setScalar(e.s);
        m.updateMatrixWorld(true);
        if (SEE_KINDS.has(e.kind)) { const sz = o.g.userData.size; m.userData.occ = [e.x, e.z, (Math.max(sz.w, sz.d) * e.s) / 2, sz.h * e.s]; }
        const ot = o.g.attributes.position.count / 3;
        objTris += ot; kindTris[e.kind] = (kindTris[e.kind] || 0) + ot;
        list.push(m);
        if (o.g.userData.glow) {
          const gm = new THREE.Mesh(o.g.userData.glow, farmGlowMaterial);
          gm.position.copy(m.position); gm.rotation.copy(m.rotation); gm.scale.copy(m.scale);
          gm.updateMatrixWorld(true);
          glowList.push(gm);
        }
      }
      const geo = mergeStatic(list);
      for (const m of list) if (m.geometry.userData.owned) m.geometry.dispose();
      const mesh = new THREE.Mesh(geo, farmToonMaterial);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = 'farm_chunk_' + cx + '_' + cz;
      group.add(mesh);
      const t = geo.attributes.position.count / 3;
      tris += t;
      chunkInfo.push({ cx, cz, tris: t });
    }
  }
  // 可互动物件：每个都是独立对象（没被捣乱时 1 个网格），setState 切换“捣乱后”的样子
  const objects = new Map();
  const live = [];
  for (const o of objs) {
    if (!o.inter) continue;
    const api = createInteractiveProp(o.inter, o.e);
    api.object.position.y = o.e.y !== undefined ? o.e.y : heightAt(o.e.x, o.e.z);
    api.object.updateMatrixWorld(true);
    group.add(api.object);
    objects.set(o.inter.id, { id: o.inter.id, kind: o.inter.kind, object: api.object, setState: api.setState, tick: api.tick });
    live.push(api);
    objTris += o.g.attributes.position.count / 3; kindTris[o.e.kind] = (kindTris[o.e.kind] || 0) + o.g.attributes.position.count / 3;
  }
  for (const it of data.interactables) { // 没有对应物件的（泥塘是地形）：给个空壳，setState 什么都不做
    if (objects.has(it.id)) continue;
    objects.set(it.id, { id: it.id, kind: it.kind, object: new THREE.Group(), setState() {}, tick() {} });
  }
  const update = (dt) => { for (let i = 0; i < live.length; i++) live[i].tick(dt); };

  // 发光部件（窗玻璃、灯泡）：整张图合成一个网格；顶点色改成白色，颜色由 farmGlowMaterial.color 决定
  if (glowList.length) {
    const gg = mergeStatic(glowList);
    const colA = gg.attributes.color;
    for (let i = 0; i < colA.array.length; i++) colA.array[i] = 1;
    const gm = new THREE.Mesh(gg, farmGlowMaterial);
    gm.name = 'farm_glow';
    group.add(gm);
    tris += gg.attributes.position.count / 3;
  }

  // ---- 地面网格
  function groundGeometry(cx, cz) {
    const pos = [], nor = [], col = [];
    const c = new THREE.Color();
    const lin = new Map();
    const lc = (hex) => { let v = lin.get(hex); if (!v) { c.setHex(hex); v = [c.r, c.g, c.b]; lin.set(hex, v); } return v; };
    const i0 = cx * cellsPerChunk, j0 = cz * cellsPerChunk;
    const i1 = Math.min(NX, i0 + cellsPerChunk), j1 = Math.min(NZ, j0 + cellsPerChunk);
    const quad = (a, b, cc, d, n, hex) => {
      const k = lc(hex);
      for (const v of [a, b, cc, a, cc, d]) { pos.push(v[0], v[1], v[2]); nor.push(n[0], n[1], n[2]); col.push(k[0], k[1], k[2]); }
    };
    const V = 1 / 16;
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1;) {
        const k = idx(i, j), h = H[k], hex = COL[k];
        let w = 1;
        while (i + w < i1 && H[idx(i + w, j)] === h && COL[idx(i + w, j)] === hex) w++;
        const xa = X0 + i * CU, xb = X0 + (i + w) * CU, za = Z0 + j * CU, zb = Z0 + (j + 1) * CU, y = h * V;
        quad([xa, y, zb], [xb, y, zb], [xb, y, za], [xa, y, za], [0, 1, 0], hex);
        i += w;
      }
      for (let i = i0; i < i1; i++) {
        const k = idx(i, j), h = H[k];
        const xa = X0 + i * CU, xb = X0 + (i + 1) * CU, za = Z0 + j * CU, zb = Z0 + (j + 1) * CU;
        const sh = SIDE[k];
        if (j + 1 < NZ && H[idx(i, j + 1)] < h) { const y0 = H[idx(i, j + 1)] * V, y1 = h * V; quad([xa, y0, zb], [xb, y0, zb], [xb, y1, zb], [xa, y1, zb], [0, 0, 1], sh); }
        if (j - 1 >= 0 && H[idx(i, j - 1)] < h) { const y0 = H[idx(i, j - 1)] * V, y1 = h * V; quad([xb, y0, za], [xa, y0, za], [xa, y1, za], [xb, y1, za], [0, 0, -1], sh); }
        if (i + 1 < NX && H[idx(i + 1, j)] < h) { const y0 = H[idx(i + 1, j)] * V, y1 = h * V; quad([xb, y0, zb], [xb, y0, za], [xb, y1, za], [xb, y1, zb], [1, 0, 0], sh); }
        if (i - 1 >= 0 && H[idx(i - 1, j)] < h) { const y0 = H[idx(i - 1, j)] * V, y1 = h * V; quad([xa, y0, za], [xa, y0, zb], [xa, y1, zb], [xa, y1, za], [-1, 0, 0], sh); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.userData.owned = true;
    return g;
  }

  // ---- 地面细节：草丛（细圆锥）、小花（茎 + 小圆球）、三叶草（扁圆）、石子（小圆球）、蘑菇
  function decorGeometry(cx, cz) {
    const b = createShapeBuilder();
    const i0 = cx * cellsPerChunk, j0 = cz * cellsPerChunk;
    const i1 = Math.min(NX, i0 + cellsPerChunk), j1 = Math.min(NZ, j0 + cellsPerChunk);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const k = idx(i, j), t = TYP[k];
      if (t === 2 || t === 5 || t === 6 || t === 7 || t === 8 || t === 9) continue;
      const x0 = X0 + i * CU, z0 = Z0 + j * CU;
      if (Math.abs(x0) > MAP_W / 2 || Math.abs(z0) > MAP_D / 2) continue;
      const r = hash3(i, j, 9, seed);
      const px = x0 + hash3(i, j, 10, seed) * CU, pz = z0 + hash3(i, j, 11, seed) * CU, py = H[k] / 16;
      if (t === 0) {
        if (r < 0.03) {
          if (!occFree(px, pz, 0.08)) continue;
          const hgt = 0.11 + hash3(i, j, 12, seed) * 0.08;
          b.cone(T.grass[3], [px, py + hgt / 2, pz], [0.022, hgt, 0.022], [0.15, 0, 0.2], 4);
          b.cone(T.grass[2], [px + 0.035, py + hgt * 0.4, pz + 0.01], [0.02, hgt * 0.85, 0.02], [-0.1, 0, -0.25], 4);
        } else if (r < 0.038) {
          if (!occFree(px, pz, 0.08)) continue;
          const cols = [P.flowerPink, P.flowerWhite, P.flowerYellow, P.flowerBlue, P.flowerPurple];
          const c = cols[Math.floor(hash3(i, j, 13, seed) * cols.length)];
          b.cyl(T.grass[1], [px, py + 0.05, pz], [0.006, 0.1, 0.006], null, 3);
          b.ball(c, [px, py + 0.11, pz], 0.034, null, [5, 4]);
        } else if (r < 0.046) {
          if (!occFree(px, pz, 0.1)) continue;
          b.ball(T.grass[hash3(i, j, 15, seed) > 0.5 ? 3 : 0], [px, py + 0.005, pz], [0.1, 0.012, 0.1], null, [6, 3]);
        } else if (r < 0.052) {
          if (!occFree(px, pz, 0.08)) continue;
          b.ball(T.stone[2], [px, py + 0.02, pz], [0.05, 0.035, 0.04], null, [5, 4]);
          if (hash3(i, j, 16, seed) > 0.5) b.ball(T.stone[3], [px + 0.07, py + 0.015, pz + 0.02], [0.03, 0.022, 0.03], null, [4, 3]);
        } else if (r < 0.055 && z0 < -8) {
          b.cyl(P.sack, [px, py + 0.03, pz], [0.012, 0.06, 0.012], null, 4);
          b.ball(P.mushroomRed, [px, py + 0.07, pz], [0.045, 0.03, 0.045], null, [5, 4]);
        }
      } else if (t === 1) {
        if (r < 0.04) b.ball(T.stone[2], [px, py + 0.02, pz], [0.05, 0.03, 0.04], null, [5, 4]);
        else if (r < 0.055) b.ball(T.road[0], [px, py + 0.008, pz], [0.07, 0.014, 0.05], null, [5, 3]);
      } else if (t === 3) {
        if (r < 0.15) b.ball(T.stone[1 + (r > 0.08 ? 1 : 0)], [px, py + 0.025, pz], [0.07, 0.04, 0.05], null, [5, 4]);
      } else if (t === 4 || t === 10) {
        if (r < 0.03) b.ball(T.soil[0], [px, py + 0.01, pz], [0.06, 0.015, 0.04], null, [5, 3]);
        else if (r < 0.05) b.ball(T.hay[2], [px, py + 0.01, pz], [0.05, 0.012, 0.025], [0, r * 20, 0], [5, 3]);
      }
    }
    const g = b.build();
    if (g.attributes.position.count === 0) return null;
    g.userData.owned = true;
    return g;
  }

  group.updateMatrixWorld(true);
  return {
    group,
    size: { w: MAP_W, d: MAP_D },
    zones: data.zones.map((z) => ({ ...z })),
    paths: data.paths,
    data,
    heightAt,
    objects,
    update,
    glowMaterial: farmGlowMaterial,
    stats: { triangles: tris, groundTris, decorTris, objTris, kindTris, chunks: chunkInfo, objects: objs.length },
  };
}
