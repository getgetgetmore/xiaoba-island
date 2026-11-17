// 农场地图数据（纯数据，不依赖 three / DOM，Node 里可直接 import）。画面（map.js）和逻辑（farmSim）都读它。
//
// 坐标：世界单位，原点在地图中心，+x 向东，+z 向南（朝镜头）。可玩范围 x ∈ [-32, 32]，z ∈ [-24, 24]。
// 朝向 heading：弧度，和 three 的 rotation.y 一致（0 = 朝 +z 南，π/2 = 朝 +x 东）。
// 碰撞体 box 的 rot 也是绕 y 的旋转（同 rotation.y）：局部 x 轴在世界里指向 (cos rot, -sin rot)（x, z）。
//
// FARM_MAP = {
//   size, zones, paths, colliders, water, bridges, interactables, hides, spawns,   // ← 逻辑用
//   terrain, props,                                                               // ← 画面用（地面分区、要摆的物件）
// }
// 本文件顶层用一个确定性的小程序生成树林里的树等（种子固定），所以每次 import 结果完全一样；
// 凡是挡路的（房子、栅栏段、树干、石头、井、草垛……）都在 colliders 里，位置和 props 一致。

// ---------------------------------------------------------------- 小工具（纯数学）
function rng(seed) {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function catmull(pts, sub = 6) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
}
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
  const L = vx * vx + vz * vz;
  const t = L > 0 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / L)) : 0;
  const dx = wx - t * vx, dz = wz - t * vz;
  return Math.sqrt(dx * dx + dz * dz);
}
function polyDist(px, pz, poly) {
  let m = 99;
  for (let i = 0; i < poly.length - 1; i++) {
    const d = segDist(px, pz, poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]);
    if (d < m) m = d;
  }
  return m;
}
const r2 = (v) => Math.round(v * 100) / 100;

const W = 64, D = 48;

// ---------------------------------------------------------------- 路（金黄色土路）
const PATH_DEFS = [
  { id: 'main', name: '主路', surf: 'dirt', hw: 0.95, pts: [[-29.5, 22.5], [-24, 19.8], [-17, 20], [-9, 18.8], [-1, 19.8], [7, 18.9], [15, 17.6], [22, 15.6], [27, 11], [27.6, 4], [26.4, -4], [27.6, -12], [28, -17.5], [28, -25]] },
  { id: 'farmhouse', name: '去农舍的小路', surf: 'dirt', hw: 0.7, pts: [[-17, 20], [-16.2, 14], [-14.5, 8], [-10.5, 4.6], [-7, 2.2]] },
  { id: 'garden', name: '去花园的小路', surf: 'dirt', hw: 0.6, pts: [[-14.5, 8], [-17.5, 5.5], [-20.5, 3.6]] },
  { id: 'woods', name: '去树林工地的小路', surf: 'dirt', hw: 0.65, pts: [[-3.8, 2.2], [-3.2, -2.4], [-4.0, -7.2], [-5.2, -11.2], [-7.4, -13.4]] },
  { id: 'barn', name: '去谷仓的小路', surf: 'dirt', hw: 0.7, pts: [[7, 18.9], [8.6, 13.6], [9.6, 9]] },
  { id: 'pens', name: '去猪圈羊圈的小路', surf: 'dirt', hw: 0.6, pts: [[27.2, 3], [25.8, 1.6]] },
  { id: 'plaza', name: '花园石径', surf: 'stone', hw: 0.45, pts: [[-20.5, 3.6], [-20.5, 0.8]] },
  // 林中小村的小路
  { id: 'vil_w', name: '小村西路', surf: 'dirt', hw: 0.6, pts: [[-7.4, -13.4], [-12, -12.2], [-17, -12.6], [-22.3, -11.0]] },
  { id: 'vil_w2', name: '小村支路 A', surf: 'dirt', hw: 0.5, pts: [[-17, -12.6], [-17.2, -15], [-17, -17.3]] },
  { id: 'vil_w3', name: '小村支路 B', surf: 'dirt', hw: 0.5, pts: [[-12, -12.2], [-12.4, -15], [-12.5, -17.8]] },
  { id: 'vil_e', name: '小村东路', surf: 'dirt', hw: 0.6, pts: [[-7.4, -13.4], [-2, -12.4], [3.6, -12.0], [8, -12.6]] },
  { id: 'vil_e2', name: '小村支路 C', surf: 'dirt', hw: 0.5, pts: [[8, -12.6], [8.6, -15.2], [7.6, -17.8]] },
  { id: 'vil_link', name: '小村通主路', surf: 'dirt', hw: 0.6, pts: [[8, -12.6], [14, -14.5], [21.4, -15.2], [27.6, -13.6]] },
];
const paths = PATH_DEFS.map((p) => ({ id: p.id, name: p.name, surf: p.surf, width: r2(p.hw * 2), points: catmull(p.pts, 7) }));

// ---------------------------------------------------------------- 水
const STREAM = [[-33, -8.2], [-26, -6.4], [-19, -7.6], [-12, -6.3], [-6, -7.4], [0, -6.4], [5, -6.9], [9, -6.1]];
const STREAM_OUT = [[9, -6.1], [13.5, -8.4], [18, -11.2], [21.5, -15.4], [24.5, -20.2], [26.2, -27]];
const streamPts = catmull(STREAM, 7).concat(catmull(STREAM_OUT, 7).slice(1));
const PONDS = [
  { id: 'pond_main', x: 9.2, z: -6.1, rx: 4.3, rz: 3.0, seed: 3, depth: 'deep' },
  { id: 'pond_small', x: 8.2, z: 15.6, rx: 1.9, rz: 1.4, seed: 7, depth: 'shallow' },
];
function pondPoly(p, n = 28) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const lim = 1 + 0.14 * Math.sin(3 * a + p.seed) + 0.1 * Math.sin(5 * a + p.seed * 1.7) + 0.05 * Math.sin(8 * a + p.seed * 2.3);
    out.push([r2(p.x + Math.cos(a) * p.rx * lim), r2(p.z + Math.sin(a) * p.rz * lim)]);
  }
  return out;
}
const water = [
  { id: 'stream', kind: 'stream', shape: 'poly', points: streamPts, width: 1.9, depth: 'deep' }, // 溪：狗能游、人绕路（过溪走桥）
  ...PONDS.map((p) => ({ id: p.id, kind: 'pond', shape: 'poly', points: pondPoly(p), depth: p.depth, x: p.x, z: p.z, rx: p.rx, rz: p.rz })),
];
const bridges = [
  { id: 'bridge_woods', x: -4.0, z: -7.2, w: 1.1, d: 2.9, rot: 0 },        // 去工地的路上；w 沿 x、d 沿 z（走向沿 z）
  { id: 'bridge_village', x: 21.4, z: -15.3, w: 2.9, d: 1.1, rot: 0 },     // 小村通主路
];

// ---------------------------------------------------------------- 地面分区（画面用；逻辑也可以用来判断“院子里”）
const yards = [
  { id: 'plaza', kind: 'stone', ell: true, cx: -20.5, cz: -0.6, rx: 3.3, rz: 2.7 },
  { id: 'mud', kind: 'mud', ell: true, cx: 21.0, cz: -2.9, rx: 2.9, rz: 1.8 },
  { id: 'site', kind: 'sawdust', ell: true, cx: -7.4, cz: -15, rx: 6.2, rz: 4.6 },
  { id: 'farmyard', kind: 'dirtLight', ell: true, cx: -6.2, cz: 2.8, rx: 4.6, rz: 2.0 },
  { id: 'vy1', kind: 'dirtLight', ell: true, cx: -22.4, cz: -11.6, rx: 2.4, rz: 1.5 },
  { id: 'vy2', kind: 'dirtLight', ell: true, cx: -17, cz: -17.8, rx: 2.4, rz: 1.5 },
  { id: 'vy3', kind: 'dirtLight', ell: true, cx: 3.6, cz: -12.2, rx: 2.4, rz: 1.5 },
  { id: 'vy4', kind: 'dirtLight', ell: true, cx: 7.6, cz: -18.0, rx: 2.4, rz: 1.5 },
  { id: 'vy5', kind: 'dirtLight', ell: true, cx: -12.5, cz: -18.0, rx: 2.4, rz: 1.5 },
  { id: 'chicken', kind: 'dirt', x0: -27, x1: -18, z0: 8.5, z1: 17 },
  { id: 'veg', kind: 'field', x0: -13.5, x1: -4.5, z0: 9.2, z1: 17.6 },
  { id: 'orchard', kind: 'grassLight', x0: -2.5, x1: 4.2, z0: 8.6, z1: 17.2 },
  { id: 'drying', kind: 'grassLight', x0: 4.4, x1: 11.2, z0: 8.8, z1: 17.4 },
  { id: 'barnyard', kind: 'dirt', x0: 5.6, x1: 15.2, z0: 0.6, z1: 9.4 },
  { id: 'cowyard', kind: 'dirt', x0: 13.5, x1: 22.5, z0: 9.6, z1: 15.2 },
  { id: 'pigs', kind: 'dirt', x0: 17.5, x1: 24.5, z0: -5.6, z1: 1.2 },
  { id: 'sheep', kind: 'grassLight', x0: 17.5, x1: 24.5, z0: 1.4, z1: 7.4 },
  { id: 'garden', kind: 'grassLight', x0: -26.5, x1: -14.8, z0: -5.4, z1: 5 },
  { id: 'exit', kind: 'grassLight', x0: 14, x1: 31.8, z0: -23.8, z1: -16.5 },
];
const cliffs = [
  { id: 'cliff_nw', x: -29.8, z: -17, rx: 3.6, rz: 7.5, h: 12 },
  { id: 'cliff_e', x: 30.4, z: 8.5, rx: 2.8, rz: 5.5, h: 12 },
  { id: 'cliff_w', x: -28.5, z: 12, rx: 3.0, rz: 4.2, h: 12 },
];

// ---------------------------------------------------------------- 区域
const zones = [
  { id: 'chicken', name: '鸡舍前院', x: -22.5, z: 12.8, r: 5.2, tags: ['mischief', 'chickens', 'pen'], unlock: null },
  { id: 'veg', name: '菜地', x: -9, z: 13.4, r: 5.5, tags: ['mischief', 'dig', 'crops'], unlock: null },
  { id: 'orchard', name: '晾晒场和果园', x: 4.5, z: 13, r: 7, tags: ['mischief', 'laundry', 'orchard'], unlock: null },
  { id: 'barn', name: '谷仓和牛棚', x: 14, z: 6, r: 8, tags: ['mischief', 'hay', 'cows'], unlock: null },
  { id: 'pens', name: '猪圈和羊圈', x: 21, z: 1, r: 7, tags: ['mischief', 'pigs', 'sheep', 'mud', 'pen'], unlock: null },
  { id: 'exit', name: '出口（篱笆狗洞）', x: 28, z: -21, r: 4, tags: ['exit'], unlock: null },
  { id: 'garden', name: '花园', x: -20.5, z: -0.3, r: 6, tags: ['mischief', 'flowers', 'fountain'], unlock: null },
  { id: 'farmhouse', name: '农舍', x: -6, z: -1.2, r: 5.5, tags: ['keeper_home'], unlock: null },
  { id: 'site', name: '林中工地', x: -7.4, z: -15, r: 6, tags: ['mischief', 'lumber', 'woods'], unlock: null },
  { id: 'forest_village', name: '林中小村', x: -9, z: -16.5, r: 16.5, tags: ['woods', 'houses', 'explore'], unlock: 'explore' },
  { id: 'pond', name: '池塘和小溪', x: 9.2, z: -6.1, r: 5, tags: ['water', 'wash'], unlock: null },
  { id: 'gate', name: '农场大门', x: -27.5, z: 21.5, r: 3, tags: ['spawn'], unlock: null },
];

// ---------------------------------------------------------------- 物件 / 碰撞体 / 可互动物 / 躲藏点
const props = [];
const colliders = [];
const interactables = [];
const hides = [];
const occ = new Map();
function occAdd(x, z, r) {
  for (let a = Math.floor(x - r); a <= Math.floor(x + r); a++) for (let b = Math.floor(z - r); b <= Math.floor(z + r); b++) {
    const k = a + ',' + b; if (!occ.has(k)) occ.set(k, []); occ.get(k).push([x, z, r]);
  }
}
function occFree(x, z, r) {
  for (let a = Math.floor(x - r - 2); a <= Math.floor(x + r + 2); a++) for (let b = Math.floor(z - r - 2); b <= Math.floor(z + r + 2); b++) {
    const l = occ.get(a + ',' + b); if (!l) continue;
    for (const [ox, oz, or] of l) if (Math.hypot(ox - x, oz - z) < r + or) return false;
  }
  return true;
}
// 各种物件在 s=1 时的碰撞体：{ box: [w, d] | circle: r, off: [dx, dz]（局部偏移） }
const COL = {
  barn: (s) => ({ box: [2.5 * s, 2.25 * s] }),
  silo: (s) => ({ circle: 0.62 * s }),
  henhouse: (s) => ({ box: [1.3 * s, 1.0 * s], off: [0.1 * s, 0] }),
  cowshed: (s) => ({ box: [2.75 * s, 1.6 * s] }),
  cabin: (s) => ({ box: [2.5 * s, 1.9 * s], off: [0, -0.15 * s] }),
  farmhouse: (s) => ({ box: [3.25 * s, 2.25 * s], off: [0, -0.15 * s] }),
  cabin_frame: (s) => ({ box: [2.5 * s, 1.9 * s] }),
  scaffold: (s) => ({ box: [2.75 * s, 0.7 * s] }),
  lumber_pile: (s) => ({ box: [1.6 * s, 0.8 * s] }),
  sawhorse: (s) => ({ box: [1.1 * s, 0.4 * s] }),
  well: (s) => ({ circle: 0.5 * s }),
  fountain: (s) => ({ circle: 0.75 * s }),
  windmill: (s) => ({ circle: 0.85 * s }),
  firewood: (s) => ({ box: [1.6 * s, 0.5 * s] }),
  bench: (s) => ({ box: [1.25 * s, 0.4 * s] }),
  trough: (s) => ({ box: [1.5 * s, 0.5 * s] }),
  hay_square: (s, o) => ({ box: [(o.count === 1 ? 0.9 : 1.4) * s, 0.7 * s] }),
  hay_round: (s) => ({ circle: 0.5 * s }),
  wheelbarrow: (s) => ({ circle: 0.4 * s }),
  scarecrow: (s) => ({ circle: 0.2 * s }),
  barrel: (s) => ({ circle: 0.25 * s }),
  crate: (s) => ({ circle: 0.3 * s }),
  milk_can: (s) => ({ circle: 0.22 * s }),
  stump: (s) => ({ circle: 0.28 * s }),
  rock: (s) => ({ circle: 0.5 * s }),
  tree: (s) => ({ circle: 0.26 * s }),
  apple_tree: (s) => ({ circle: 0.24 * s }),
  pink_tree: (s) => ({ circle: 0.24 * s }),
  pine: (s) => ({ circle: 0.2 * s }),
  mailbox: (s) => ({ circle: 0.12 * s }),
  signpost: (s) => ({ circle: 0.12 * s }),
  lamp: (s) => ({ circle: 0.1 * s }),
  hedge: (s, o) => ({ box: [(o.length || 32) / 16 * s, 0.5 * s] }),
  radish_big: () => null,
};
const ZONE_OF = (x, z) => {
  let best = null, bd = 1e9;
  for (const zn of zones) { const d = Math.hypot(zn.x - x, zn.z - z) - zn.r; if (d < bd) { bd = d; best = zn.id; } }
  return best;
};
let uid = 0;
/**
 * 摆一个物件。extra：r（占位半径，0 = 不占位）、y（固定高度）、noCol（不生成碰撞体）、
 * inter: { kind, r, ...参数 }（登记为可互动物，id 自动生成）、hide: { kind, r }、deco（纯装饰：不占位不碰撞）
 */
function put(kind, opts, x, z, rot = 0, s = 1, extra = {}) {
  x = r2(x); z = r2(z); rot = r2(rot);
  const id = kind + '_' + (++uid);
  const entry = { id, kind, opts: opts || {}, x, z, rot, s };
  if (extra.y !== undefined) entry.y = extra.y;
  if (extra.glow) entry.glow = true;
  props.push(entry);
  if (extra.deco) return entry;
  const col = COL[kind] ? COL[kind](s, opts || {}) : null;
  if (extra.r !== undefined ? extra.r > 0 : col) occAdd(x, z, extra.r !== undefined ? extra.r : (col.circle || Math.max(col.box[0], col.box[1]) * 0.5));
  if (col && !extra.noCol) {
    const c = Math.cos(rot), sn = Math.sin(rot);
    const off = col.off || [0, 0];
    const cx = x + off[0] * c + off[1] * sn, cz = z - off[0] * sn + off[1] * c;
    if (col.circle) colliders.push({ id: 'col_' + id, kind, shape: 'circle', x: r2(cx), z: r2(cz), r: r2(col.circle), prop: id });
    else colliders.push({ id: 'col_' + id, kind, shape: 'box', x: r2(cx), z: r2(cz), w: r2(col.box[0]), d: r2(col.box[1]), rot, prop: id });
  }
  if (extra.inter) interactables.push({ id: extra.inter.id || kind + '_' + uid, kind: extra.inter.kind || kind, zone: extra.inter.zone || ZONE_OF(x, z), x, z, r: 0.8, ...extra.inter, prop: id });
  if (extra.hide) hides.push({ id: 'hide_' + id, kind: extra.hide.kind, x, z, r: extra.hide.r, prop: id });
  return entry;
}
/** 栅栏线（水平 / 竖直）：每段 ≈ 2 单位。gate = 第几段换成圈门；holes = 哪些段是“狗洞”段（狗能钻、管理员过不去）。 */
function fenceLine(x0, z0, x1, z1, o = {}) {
  const horiz = z0 === z1;
  const len = Math.abs(horiz ? x1 - x0 : z1 - z0);
  const n = Math.max(1, Math.round(len / 2));
  const seg = len / n, sgn = Math.sign(horiz ? x1 - x0 : z1 - z0);
  for (let i = 0; i < n; i++) {
    const c = (i + 0.5) * seg * sgn;
    const x = horiz ? x0 + c : x0, z = horiz ? z0 : z0 + c;
    const rot = horiz ? 0 : Math.PI / 2;
    const length = Math.round(seg * 16);
    if (o.gate === i) {
      const e = put('gate', { length }, x, z, rot, 1, { r: 0.3, noCol: true });
      const gid = 'gate_' + (o.pen || 'x' + uid);
      colliders.push({ id: 'col_' + gid, kind: 'gate', shape: 'box', x: r2(x), z: r2(z), w: r2(seg), d: 0.22, rot: r2(rot), gate: gid, prop: e.id });
      interactables.push({ id: gid, kind: 'pen_gate', zone: o.pen || ZONE_OF(x, z), pen: o.pen || null, x: r2(x), z: r2(z), r: 1.1, open: false, prop: e.id });
    } else if (o.holes && o.holes.includes(i)) {
      const e = put('fence', { length, style: o.style, hole: true }, x, z, rot, 1, { r: 0.3, noCol: true });
      const side = Math.max(0.2, (seg - 1.0) / 2); // 洞宽 1.0：小狗（直径 0.7）钻得过去，管理员过不去
      for (const sg of [-1, 1]) {
        const lx = sg * (seg / 2 - side / 2), cc = Math.cos(rot), ss = Math.sin(rot);
        colliders.push({ id: 'col_' + e.id + (sg < 0 ? 'a' : 'b'), kind: 'fence', shape: 'box', x: r2(x + lx * cc), z: r2(z - lx * ss), w: r2(side), d: 0.22, rot: r2(rot), prop: e.id });
      }
      colliders.push({ id: 'col_' + e.id + 'gap', kind: 'fence', gap: true, blocks: ['keeper'], shape: 'box', x: r2(x), z: r2(z), w: r2(seg - 2 * side), d: 0.22, rot: r2(rot), prop: e.id });
    } else {
      const e = put('fence', { length, style: o.style }, x, z, rot, 1, { r: 0.3, noCol: true });
      colliders.push({ id: 'col_' + e.id, kind: 'fence', shape: 'box', x: r2(x), z: r2(z), w: r2(seg), d: 0.22, rot: r2(rot), prop: e.id });
    }
  }
}
const fenceRect = (x0, z0, x1, z1, o = {}) => {
  fenceLine(x0, z0, x1, z0, { pen: o.pen, ...(o.n || {}) });
  fenceLine(x0, z1, x1, z1, { pen: o.pen, ...(o.s || {}) });
  fenceLine(x0, z0, x0, z1, { pen: o.pen, ...(o.w || {}) });
  fenceLine(x1, z0, x1, z1, { pen: o.pen, ...(o.e || {}) });
};
const BED = (kind, zone) => ({ kind: 'radish_bed', zone });

// ---- 1 鸡舍前院
fenceRect(-27, 8.5, -18, 17, { pen: 'chicken', s: { gate: 2 }, n: { holes: [1] } });
put('henhouse', {}, -24.2, 11.6, 0, 1.4, { inter: { kind: 'henhouse', id: 'henhouse', r: 1.2 } });
put('trough', { fill: 'feed' }, -20.6, 14.2, 0, 0.8, { inter: { kind: 'feed_trough', id: 'trough_chicken', r: 0.9 } });
put('hay_square', { count: 1 }, -25.8, 15.4, 0, 1, { hide: { kind: 'hay', r: 0.7 }, inter: { kind: 'hay_bale', r: 0.8 } });
put('hay_round', {}, -20.2, 10.4, 0.3, 0.7, { inter: { kind: 'hay_bale', r: 0.7 } });
put('bush', { flower: true, seed: 11 }, -27.7, 12, 0, 1, { hide: { kind: 'bush', r: 0.6 } });
put('flowers', { seed: 4 }, -17.4, 17.8, 0, 1, { r: 0 });
// ---- 2 菜地
fenceRect(-13.5, 9.2, -4.5, 17.6, { pen: 'veg', s: { gate: 3 }, w: { holes: [2] } });
const bedKinds = [['radish', 'radish'], ['cabbage', 'cabbage'], ['pumpkin', 'pumpkin'], ['radish', 'cabbage']];
[10.7, 12.6, 14.5, 16.3].forEach((z, r) => [-11.2, -7.6].forEach((x, c) => {
  const crop = bedKinds[r][c];
  put('crop_bed', { crop }, x, z, 0, 1, { r: 0.6, noCol: true, inter: { kind: crop === 'radish' ? 'radish_bed' : crop === 'cabbage' ? 'cabbage_bed' : 'pumpkin_bed', crop, r: 0.95, id: 'bed_' + r + '_' + c } });
}));
put('scarecrow', {}, -5.6, 10.4, 0.2);
put('radish_big', {}, -14.6, 17.9, 0, 1, { r: 0 });
// ---- 3 晾晒场和果园
[[-0.8, 10.8], [1.8, 10.2], [3.2, 12.8], [0.2, 14.6], [-1.2, 12.6], [2.2, 15.6]].forEach(([x, z], i) => put('apple_tree', { seed: i + 3 }, x, z, 0, 1, { r: 0.8 }));
put('clothesline', {}, 7.6, 11.4, 0, 1, { inter: { kind: 'clothesline', id: 'clothesline_1', r: 1.6 } });
put('clothesline', {}, 8.2, 13.8, 0, 1, { inter: { kind: 'clothesline', id: 'clothesline_2', r: 1.6 } });
put('hedge', { length: 120, seed: 5 }, 4.3, 12.4, Math.PI / 2, 1, { r: 0.3 });
put('lily', { seed: 3 }, 8.2, 15.6, 0, 1, { r: 0, y: -2 / 16, deco: true });
put('reeds', { seed: 3 }, 6.6, 16.2, 0, 1, { r: 0.3, deco: true });
put('bush', { berries: true }, 10.8, 10.2, 0, 1, { hide: { kind: 'bush', r: 0.6 } });
put('flowers', { seed: 7 }, 5.6, 16.8, 0, 1, { r: 0 });
// ---- 4 谷仓和牛棚
put('barn', {}, 9.6, 4.4, 0, 1.4);
put('silo', {}, 13.6, 3.0, 0, 1.25);
put('hay_square', { count: 3, seed: 4 }, 6.6, 7.8, 0, 0.9, { hide: { kind: 'hay', r: 0.9 }, inter: { kind: 'hay_bale', id: 'hay_stack_1', r: 1.0 } });
put('hay_round', {}, 14.3, 6.9, 0.4, 0.8, { inter: { kind: 'hay_bale', r: 0.7 } });
put('milk_can', {}, 11.6, 8.3, 0, 1, { inter: { kind: 'milk_can', r: 0.5 } });
put('milk_can', {}, 12.2, 8.6, 0, 1, { inter: { kind: 'milk_can', r: 0.5 } });
put('wheelbarrow', { load: 'hay' }, 8, 8.8, 0.6);
put('cowshed', {}, 18, 12.2, 0, 1.15);
put('trough', { fill: 'water' }, 16.2, 10.3, 0, 0.9); // 靠北边的篱笆放：原来摆在圈门里面 1.2 的地方，门开了管理员也挤不进去
fenceRect(13.5, 9.6, 22.5, 15.2, { pen: 'cowyard', n: {}, w: { gate: 1 } });
put('barrel', {}, 15.2, 2.2, 0, 1, { inter: { kind: 'barrel', r: 0.5 } });
put('crate', {}, 15.8, 2.6, 0, 1, { inter: { kind: 'crate', r: 0.5 } });
// ---- 5 猪圈和羊圈
fenceRect(17.5, -5.6, 24.5, 1.2, { pen: 'pigs', e: { gate: 1 } });
fenceRect(17.5, 1.4, 24.5, 7.4, { pen: 'sheep', e: { gate: 1 } });
put('trough', { fill: 'feed' }, 19.4, -4.6, 0, 0.75, { inter: { kind: 'feed_trough', r: 0.9 } });
put('trough', { fill: 'feed' }, 23.0, -0.3, 0.3, 0.75, { inter: { kind: 'feed_trough', r: 0.9 } });
put('hay_round', {}, 19.6, 5.3, 0.2, 0.75, { inter: { kind: 'hay_bale', r: 0.7 } });
put('trough', { fill: 'water' }, 22.8, 3.2, 0, 0.7);
put('bush', { seed: 9 }, 18.4, 2.6, 0, 1, { hide: { kind: 'bush', r: 0.6 } });
put('bush', { seed: 10 }, 24, 6.6, 0, 1, { hide: { kind: 'bush', r: 0.6 } });
put('hay_square', { count: 2 }, 18.6, -1.2, 0, 0.7, { hide: { kind: 'hay', r: 0.7 }, inter: { kind: 'hay_bale', r: 0.8 } });
interactables.push({ id: 'mud_pit', kind: 'mud_pit', zone: 'pens', x: 21.0, z: -2.9, r: 2.0 });
// ---- 6 出口：长篱笆，中间有个洞；风车
const EXIT_Z = -21.6;
// 带洞的那段篱笆占 x 26.5–29.5：两边的篱笆要正好接到它的两端，不能盖住洞
for (const x of [19.25, 21.75, 24.25]) { const e = put('fence', { length: 40, style: 'picket' }, x, EXIT_Z, 0, 1, { r: 0.4, noCol: true }); colliders.push({ id: 'col_' + e.id, kind: 'fence', shape: 'box', x, z: EXIT_Z, w: 2.5, d: 0.25, rot: 0, prop: e.id }); }
{ const e = put('fence', { length: 16, style: 'picket' }, 26.0, EXIT_Z, 0, 1, { r: 0.4, noCol: true }); colliders.push({ id: 'col_' + e.id, kind: 'fence', shape: 'box', x: 26.0, z: EXIT_Z, w: 1.0, d: 0.25, rot: 0, prop: e.id }); }
for (const x of [30.75, 33.25]) { const e = put('fence', { length: 40, style: 'picket' }, x, EXIT_Z, 0, 1, { r: 0.4, noCol: true }); colliders.push({ id: 'col_' + e.id, kind: 'fence', shape: 'box', x, z: EXIT_Z, w: 2.5, d: 0.25, rot: 0, prop: e.id }); }
{
  const e = put('fence_hole', { length: 48 }, 28, EXIT_Z, 0, 1, { r: 0.4, noCol: true });
  colliders.push({ id: 'col_exit_a', kind: 'fence', shape: 'box', x: 27.0, z: EXIT_Z, w: 0.9, d: 0.25, rot: 0, prop: e.id });
  colliders.push({ id: 'col_exit_b', kind: 'fence', shape: 'box', x: 29.0, z: EXIT_Z, w: 0.9, d: 0.25, rot: 0, prop: e.id });
  colliders.push({ id: 'col_exit_gap', kind: 'fence', gap: true, blocks: ['keeper'], exit: true, shape: 'box', x: 28, z: EXIT_Z, w: 1.1, d: 0.25, rot: 0, prop: e.id });
}
put('windmill', {}, 18.5, -18.4, 0, 1.3);
put('signpost', {}, 26.2, -15.5, 0.2);
put('hay_square', { count: 3, seed: 6 }, 22.5, -19.2, 0, 0.8, { hide: { kind: 'hay', r: 0.8 }, inter: { kind: 'hay_bale', r: 0.9 } });
// ---- 花园
put('fountain', {}, -20.5, -0.6, 0, 1.0, { inter: { kind: 'fountain', id: 'fountain', r: 1.3 } });
[[-24.6, -3.6], [-16.6, -3.6], [-24.6, 3.2], [-16.7, 3.2], [-20.5, -4.3]].forEach(([x, z], i) => put('flower_bed', { seed: i + 1, w: i === 4 ? 36 : 28, d: 14 }, x, z, 0, 1, { r: 1, noCol: true, inter: { kind: 'flower_bed', id: 'flower_bed_' + (i + 1), r: 1.1 } }));
put('bench', {}, -23.4, 0.5, Math.PI / 2);
put('bench', {}, -17.6, 0.5, -Math.PI / 2);
put('trellis', {}, -20.5, 4.6, 0, 1, { r: 0.8, noCol: true });
put('pink_tree', { seed: 2 }, -25.4, -1.2); put('pink_tree', { seed: 5 }, -15.6, -1.8);
put('bush', { pink: true, flower: true, seed: 3 }, -26, 3.8, 0, 1, { hide: { kind: 'bush', r: 0.6 } });
put('bush', { pink: true, seed: 4 }, -15.2, 4, 0, 1, { hide: { kind: 'bush', r: 0.6 } });
fenceLine(-26.7, -5.6, -14.6, -5.6);
fenceLine(-26.7, -5.6, -26.7, 4.8);
// ---- 农舍
put('farmhouse', { seed: 3 }, -6.1, -1.9, 0, 1.3, { r: 4, glow: true });
put('mailbox', {}, -9.7, 4.0, 0.3, 1, { inter: { kind: 'mailbox', r: 0.5 } });
put('well', {}, -1.6, 0.2, 0, 1);
put('firewood', {}, -1.2, -3.8, 0, 0.9, { r: 1 });
put('barrel', {}, -10.3, -1.8, 0, 1, { inter: { kind: 'barrel', r: 0.5 } }); put('barrel', {}, -10.3, -0.9, 0, 1, { inter: { kind: 'barrel', r: 0.5 } });
put('crate', {}, -10.4, -3.2, 0, 1, { inter: { kind: 'crate', r: 0.5 } });
put('bench', {}, -7.6, 1.5, 0, 0.8, { r: 0, noCol: true });
put('flowers', { seed: 12 }, -9.2, 2.6, 0, 1, { r: 0 }); put('flowers', { seed: 13 }, -3.2, 3.3, 0, 1, { r: 0 });
put('bush', { flower: true, seed: 8 }, -10.2, 1.4, 0, 1, { hide: { kind: 'bush', r: 0.6 } });
put('bush', { seed: 18 }, -1.4, -1.9, 0, 1, { hide: { kind: 'bush', r: 0.6 } });
fenceLine(-11.2, 5.0, -2.2, 5.0, { gate: 0, pen: 'farmhouse' });
put('lamp', {}, -9.2, 5.6, 0, 1, { glow: true }); put('lamp', {}, -3.4, 4.2, 0, 1, { glow: true });
// ---- 小溪上的桥 + 池塘
put('reeds', { seed: 5 }, 4.6, -8.2, 0, 1, { r: 0, deco: true }); put('reeds', { seed: 6 }, 13.6, -4.4, 0, 1, { r: 0, deco: true });
put('lily', { seed: 7 }, 9.2, -6.4, 0, 1, { r: 0, y: -2 / 16, deco: true }); put('lily', { seed: 8 }, 11.2, -5.6, 0, 1, { r: 0, y: -2 / 16, deco: true });
put('reeds', { seed: 7 }, 6.2, -4.0, 0, 1, { r: 0, deco: true }); put('rock', { seed: 3 }, 12.4, -3.6, 0.5, 1);
put('bench', {}, 5.4, -3.6, 0.3);
put('lily', { seed: 9 }, -12, -6.6, 0, 1, { r: 0, y: -2 / 16, deco: true });
for (const b of bridges) put('bridge', { w: b.w, d: b.d }, b.x, b.z, b.w > b.d ? 0 : Math.PI / 2, 1.05, { r: 0, noCol: true });
// ---- 林中工地
put('cabin_frame', {}, -7.6, -15.2, 0, 1.25, { r: 3.5 });
put('scaffold', {}, -2.4, -17.6, 0, 1.2, { r: 2.2 });
put('lumber_pile', {}, -12.8, -13.6, 0.1, 1, { r: 1.5, inter: { kind: 'lumber_pile', id: 'lumber_pile_1', r: 1.2 } });
put('sawhorse', {}, -12, -17, 0.4);
put('stump', {}, -4.6, -13.2); put('stump', {}, -10.6, -19.6); put('stump', {}, -2.6, -20, 0.5, 0.8);
put('barrel', {}, -4.2, -11.8, 0, 1, { inter: { kind: 'barrel', r: 0.5 } }); put('crate', {}, -3.4, -11.6, 0, 1, { inter: { kind: 'crate', r: 0.5 } }); put('crate', {}, -10.2, -12, 0.3, 0.9, { inter: { kind: 'crate', r: 0.5 } });
put('firewood', {}, -14.8, -16.5, Math.PI / 2, 0.8, { r: 1 });
put('lamp', {}, -6.2, -11.6, 0, 1, { glow: true });
// ---- 林中小村：盖好的小木屋（门朝南），带小院、柴堆、晾衣绳、菜圃、信箱
{
  const cab = (x, z, roof, seed) => put('cabin', { roof, seed }, x, z, 0, 1.2, { r: 2.2, glow: true });
  cab(-22.5, -13.6, 'green', 1);
  put('firewood', {}, -25.4, -13.2, 0, 0.8, { r: 0.8 }); put('mailbox', {}, -21.0, -10.6, 0.2); put('flowers', { seed: 21 }, -23.6, -10.8, 0, 1, { r: 0 }); put('bush', { flower: true, seed: 22 }, -25, -11.2, 0, 1, { hide: { kind: 'bush', r: 0.6 } });
  cab(-17, -19.8, 'red', 2);
  put('clothesline', {}, -17.5, -22.6, 0, 0.9, { inter: { kind: 'clothesline', id: 'clothesline_v1', r: 1.5 } }); put('crop_bed', { crop: 'cabbage' }, -20.4, -16.8, 0, 0.8, { r: 0.6, noCol: true, inter: { kind: 'cabbage_bed', crop: 'cabbage', id: 'bed_v1', r: 0.8 } }); put('barrel', {}, -14.6, -18.4, 0, 1, { inter: { kind: 'barrel', r: 0.5 } });
  cab(-12.5, -20.6, 'green', 3);
  put('crop_bed', { crop: 'radish' }, -9.8, -18.6, 0, 0.8, { r: 0.6, noCol: true, inter: { kind: 'radish_bed', crop: 'radish', id: 'bed_v2', r: 0.8 } }); put('mailbox', {}, -13.8, -17.2, 0.1); put('stump', {}, -15.4, -21, 0);
  cab(3.6, -14.8, 'green', 4);
  put('well', {}, 6.2, -12.4, 0, 0.9); put('bench', {}, 1.0, -12.1, 0, 0.9); put('bush', { berries: true, seed: 5 }, 0.6, -15.6, 0, 1, { hide: { kind: 'bush', r: 0.6 } });
  cab(7.6, -20.4, 'red', 5);
  put('firewood', {}, 10.4, -20.4, 0, 0.8, { r: 0.8 }); put('crate', {}, 5.4, -17.2, 0, 1, { inter: { kind: 'crate', r: 0.5 } }); put('scarecrow', {}, 10.2, -17.4, -0.4);
  put('lamp', {}, -19.4, -11.8, 0, 1, { glow: true }); put('lamp', {}, 5.4, -11.2, 0, 1, { glow: true });
}
// ---- 散落的小东西
[[-14, 3.2], [3.6, 6.2], [10.4, 20.6], [24, 19.6], [-22.4, 20], [14.6, 14.6], [-4.8, 6.8]].forEach(([x, z], i) => put(i % 2 ? 'rock' : 'stump', { seed: i + 1 }, x, z, i, 0.9));
[[1.4, 4.6], [-12.6, 8], [13.6, 18.8], [-3.8, 18.2], [25.5, 12.5]].forEach(([x, z], i) => put('mushroom', {}, x, z, i, 1, { r: 0.2, deco: true }));
put('signpost', {}, -15.4, 20.8, 0.2); put('signpost', {}, -3.2, 3.6, 0); put('signpost', {}, 6.5, 19.8, 3.0);
put('farm_gate', {}, -28.6, 21.6, -1.25, 1.2, { r: 2 });
put('barrel', {}, 26.2, 14.2, 0, 1, { inter: { kind: 'barrel', r: 0.5 } }); put('crate', {}, 25.4, 14.6, 0, 1, { inter: { kind: 'crate', r: 0.5 } });
put('lamp', {}, -26.2, 19.8, 0, 1, { glow: true }); put('lamp', {}, 4, 20.2, 0, 1, { glow: true }); put('lamp', {}, 25.6, 8, 0, 1, { glow: true });

// ---------------------------------------------------------------- 撒树（确定性）：阻挡检查 = 路 / 水 / 区域 / 已有物件
const rr = rng(7 * 101);
function blocked(x, z, m) {
  for (const p of paths) {
    if (x < -40 || true) { /* 路都不长，直接算 */ }
    if (polyDist(x, z, p.points) < p.width / 2 + m + 0.1) return true;
  }
  for (const y of yards) {
    if (y.id === 'exit') continue;
    if (y.ell) { if (((x - y.cx) / (y.rx + m)) ** 2 + ((z - y.cz) / (y.rz + m)) ** 2 < 1) return true; }
    else if (x > y.x0 - m && x < y.x1 + m && z > y.z0 - m && z < y.z1 + m) return true;
  }
  if (polyDist(x, z, streamPts) < 0.95 + 0.6 + m + 0.4) return true;
  for (const p of PONDS) if (((x - p.x) / (p.rx + 1 + m)) ** 2 + ((z - p.z) / (p.rz + 1 + m)) ** 2 < 1) return true;
  for (const b of bridges) if (Math.abs(x - b.x) < b.w / 2 + 1 + m && Math.abs(z - b.z) < b.d / 2 + 1 + m) return true;
  return false;
}
function scatter(x0, x1, z0, z1, step, make, accept) {
  for (let z = z0; z < z1; z += step) for (let x = x0; x < x1; x += step) {
    const px = x + (rr() - 0.5) * step * 0.9, pz = z + (rr() - 0.5) * step * 0.9;
    if (accept && !accept(px, pz)) continue;
    const m = make(px, pz);
    if (!m) continue;
    if (blocked(px, pz, m.margin)) continue;
    if (!occFree(px, pz, m.r)) continue;
    put(m.kind, m.opts, px, pz, rr() * 6.28, m.s || 1, { r: m.r, hide: m.hide, noCol: m.noCol });
  }
}
const sd = () => Math.floor(rr() * 6) + 1;
// 北边树林：深青色松树为主，夹杂橡树（避开工地和小村的空地）
const CLEARINGS = [[-7.4, -15, 7.2, 5.6], [-22.4, -13, 3.6, 2.8], [-17, -19.6, 3.4, 2.8], [-12.5, -20.6, 3.4, 2.8], [3.6, -14.8, 3.4, 2.8], [7.6, -20.4, 3.4, 2.8]];
const inClearing = (x, z) => CLEARINGS.some(([cx, cz, rx, rz]) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 < 1);
scatter(-31.5, 15.5, -23.8, -8.2, 1.3, () => {
  const v = rr();
  if (v < 0.74) return { kind: 'pine', opts: { seed: sd(), tall: rr() > 0.6 }, r: 0.42, margin: 0.35, s: 0.9 + rr() * 0.35 };
  if (v < 0.9) return { kind: 'tree', opts: { seed: sd() }, r: 0.95, margin: 0.8 };
  return { kind: 'bush', opts: { seed: sd() }, r: 0.4, margin: 0.3, hide: { kind: 'bush', r: 0.55 }, noCol: true };
}, (x, z) => !inClearing(x, z) && rr() < 0.8);
// 边缘一圈
scatter(-31.8, 31.8, 22.0, 23.9, 1.45, () => ({ kind: rr() > 0.4 ? 'pine' : 'tree', opts: { seed: sd() }, r: 0.65, margin: 0.4 }), () => rr() < 0.85);
scatter(-31.8, -26.2, -8, 22, 1.55, () => ({ kind: rr() > 0.35 ? 'pine' : 'tree', opts: { seed: sd() }, r: 0.65, margin: 0.4 }), () => rr() < 0.8);
scatter(29.2, 31.9, -23, 22, 1.55, () => ({ kind: rr() > 0.35 ? 'pine' : 'tree', opts: { seed: sd() }, r: 0.65, margin: 0.4 }), () => rr() < 0.8);
scatter(-31.8, 31.8, -23.9, -21.8, 1.55, (x) => (x < 17 ? { kind: 'pine', opts: { seed: sd() }, r: 0.65, margin: 0.4 } : null), () => rr() < 0.8);
// 林墙顶上的一圈远景松树（纯装饰）
for (let z = -(D / 2 + 7.2); z < D / 2 + 7.5; z += 2.2) for (let x = -(W / 2 + 7.2); x < W / 2 + 7.5; x += 2.2) {
  const out = Math.max(Math.abs(x) - W / 2, Math.abs(z) - D / 2);
  if (out < 0.4 || out > 5.4) continue;
  if (Math.abs(x - 28) < 2 && z < -22) continue;
  if (rr() < 0.2) continue;
  put('pine', { lo: true, seed: Math.floor(rr() * 5) + 1 }, x + (rr() - 0.5) * 1.6, z + (rr() - 0.5) * 1.6, rr() * 6.28, 1.0 + rr() * 0.5, { deco: true, y: 0.875 });
}
// 草地上疏疏落落的橡树 / 果树 / 粉色花树 / 灌木
scatter(-31, 31, -8, 22, 3.2, () => {
  const v = rr();
  if (v < 0.4) return { kind: 'tree', opts: { seed: sd() }, r: 1.0, margin: 0.9 };
  if (v < 0.55) return { kind: 'pink_tree', opts: { seed: sd() }, r: 0.9, margin: 0.8 };
  if (v < 0.65) return { kind: 'apple_tree', opts: { seed: sd() }, r: 0.9, margin: 0.8 };
  return { kind: 'bush', opts: { seed: Math.floor(rr() * 8) + 1, flower: rr() > 0.6, berries: rr() > 0.7 }, r: 0.5, margin: 0.4, hide: { kind: 'bush', r: 0.55 }, noCol: true };
}, () => rr() < 0.66);
// 小花丛
scatter(-31, 31, -22, 22, 2.8, () => ({ kind: 'flowers', opts: { seed: Math.floor(rr() * 12) + 1 }, r: 0.1, margin: 0.2 }), () => rr() < 0.28);
// 灌木 / 石头沿路
scatter(-31, 31, -22, 22, 1.8, () => (rr() > 0.5 ? { kind: 'bush', opts: { seed: Math.floor(rr() * 8) + 1 }, r: 0.4, margin: 0.2, hide: { kind: 'bush', r: 0.55 }, noCol: true } : { kind: 'rock', opts: { seed: sd() }, s: 0.6, r: 0.3, margin: 0.2 }),
  (x, z) => { for (const p of paths) { const d = polyDist(x, z, p.points); if (d > p.width / 2 + 0.5 && d < p.width / 2 + 1.4) return rr() < 0.09; } return false; });
// 溪边的芦苇
scatter(-31, 27, -26, -2, 1.2, () => ({ kind: 'reeds', opts: { seed: Math.floor(rr() * 8) + 1 }, r: 0.1, margin: -0.5, noCol: true }), (x, z) => {
  const d = polyDist(x, z, streamPts);
  return d > 1.0 && d < 1.9 && rr() < 0.22;
});

// ---------------------------------------------------------------- 出生点
const animals = [];
let aid = 0;
const A = (kind, zone, x, z, count, roam, pen) => animals.push({ id: kind + '_' + (++aid), kind, zone, x, z, count, roam, pen: pen || null });
A('hen', 'chicken', -22.5, 14.5, 3, 3.0, 'chicken');
A('chick', 'chicken', -21.5, 12.5, 6, 3.0, 'chicken');
A('hen', 'orchard', 1.5, 13.0, 2, 3.0, null);
A('duck', 'pond', 10.6, -5.6, 3, 2.0, null);
A('duck', 'pond', 7.4, 15.8, 2, 1.0, null);
A('pig', 'pens', 20.6, -2.6, 3, 2.4, 'pigs');
A('sheep', 'pens', 21.0, 4.6, 4, 2.4, 'sheep');
A('alpaca', 'pens', 22.6, 5.4, 2, 2.0, 'sheep');
A('cow', 'barn', 18.0, 13.6, 2, 3.0, 'cowyard');
A('bull', 'barn', 20.6, 11.6, 1, 1.6, 'cowyard');
A('hen', 'forest_village', -18.5, -13.6, 2, 2.5, null);
A('chick', 'forest_village', 4.8, -12.2, 3, 2.0, null);

const spawns = {
  gate: { x: -27.0, z: 20.6, heading: 1.2 },
  exit: { x: 28, z: EXIT_Z, r: 1.1 },
  keeper: {
    home: { x: -6.2, z: 3.3 },
    patrol: [[-6.2, 3.3], [-10.5, 4.6], [-14.5, 8], [-16.2, 14], [-17, 20], [-9, 18.8], [-1, 19.8], [7, 18.9], [8.6, 13.6], [9.6, 9], [8.6, 13.6], [15, 17.6], [22, 15.6], [27, 11], [27.6, 4], [26.4, -4], [27.6, -12], [21.4, -15.3], [14, -14.5], [8, -12.6], [3.6, -12], [-7.4, -13.4], [-5.2, -11.2], [-4, -7.2], [-3.2, -2.4], [-3.8, 2.2]],
  },
  goose: { x: 24.2, z: 17.4 },
  animals,
};

export const FARM_MAP = {
  version: 3,
  size: { w: W, d: D },
  zones,
  paths,
  colliders,
  water,
  bridges,
  interactables,
  hides,
  spawns,
  terrain: { yards, cliffs, ponds: PONDS, stream: streamPts, streamWidth: 1.9 },
  props,
};
export default FARM_MAP;
