// 农场逻辑测试用的小地图（按 docs/DESIGN.md“约定一：地图数据”的格式手写，只给 scripts/farm-test.mjs 用）。
// 坐标：原点在地图中心，+x 向东，+z 向南；heading = atan2(dx, dz)（0 = 朝 +z）。
// 盒子碰撞体的 rot 与 three.js 的 rotation.y 一致：局部 (lx, lz) → 世界 (x + lx·cos + lz·sin, z − lx·sin + lz·cos)。
//
// 布局（48 × 36，x ∈ [-24, 24]，z ∈ [-18, 18]）：
//   西半边：菜地（一圈篱笆，北边有人能走的口子，西边有只有狗能钻的洞）、农舍前院（农舍、井、棚子、晾衣绳、喷泉、泥塘）、大门（西南角）
//   中间：一条从北到南的深水小溪（x 3..5），只有 (4, 0) 一座桥
//   东半边：猪羊圈（南边有圈门）、公牛围场（西边有狗洞）、谷仓、浅水池塘和鸭子、出口（东北角的篱笆洞）
const F = 0.3; // 篱笆厚度
const fence = (id, x, z, w, d, extra = {}) => ({ id, kind: 'fence', shape: 'box', x, z, w, d, rot: 0, ...extra });

export const FARM_MAP = {
  size: { w: 48, d: 36 },
  zones: [
    { id: 'veg', name: '菜地', x: -14, z: 9, r: 6.5, tags: ['mischief'], unlock: null },
    { id: 'yard', name: '农舍前院', x: -10, z: -6, r: 8, tags: ['mischief'], unlock: null },
    { id: 'pens', name: '猪羊圈和池塘', x: 14, z: -3, r: 10, tags: ['mischief'], unlock: null },
    { id: 'gate', name: '农场大门', x: -21, z: 15, r: 3, tags: ['spawn'], unlock: null },
    { id: 'exit', name: '出口（篱笆狗洞）', x: 22.5, z: -17, r: 3, tags: ['exit'], unlock: null },
  ],
  paths: [
    { id: 'main', width: 1.6, points: [[-21, 15], [-14, 2.5], [-4, 1], [4, 0], [12, -2.5], [20, -3], [22, -12], [22.5, -16.5]] },
  ],
  colliders: [
    // 菜地的一圈篱笆：x ∈ [-20, -8]，z ∈ [5, 13]
    fence('veg_n1', -17.5, 5, 5, F),           // 北边西段（x -20..-15）
    fence('veg_n2', -10.25, 5, 4.5, F),        // 北边东段（x -12.5..-8）；中间 x -15..-12.5 是人能走的口子
    fence('veg_s', -14, 13, 12.3, F),
    fence('veg_w1', -20, 6.8, F, 3.6),
    fence('veg_w2', -20, 11.3, F, 3.4),
    fence('veg_gap', -20, 9.1, F, 1.0, { gap: true, blocks: ['keeper'] }), // 西边的狗洞
    fence('veg_e', -8, 9, F, 8.3),
    // 农舍前院
    { id: 'farmhouse', kind: 'house', shape: 'box', x: -17, z: -12, w: 7, d: 5, rot: 0 },
    { id: 'well', kind: 'well', shape: 'circle', x: -14, z: -7.5, r: 0.6 },
    { id: 'shed', kind: 'shed', shape: 'box', x: -3, z: -14, w: 3, d: 3, rot: 0.3 },
    // 小树林（挡视线）
    { id: 'tree1', kind: 'tree', shape: 'circle', x: 0, z: 14, r: 0.5 },
    { id: 'tree2', kind: 'tree', shape: 'circle', x: 1.5, z: 15.5, r: 0.5 },
    { id: 'tree3', kind: 'tree', shape: 'circle', x: 0.2, z: 16.8, r: 0.5 },
    { id: 'tree4', kind: 'tree', shape: 'circle', x: 2.2, z: 13.2, r: 0.5 },
    { id: 'tree5', kind: 'tree', shape: 'circle', x: 17, z: -15, r: 0.6 },
    { id: 'rock1', kind: 'rock', shape: 'circle', x: 7, z: -6, r: 0.6 },
    // 谷仓
    { id: 'barn', kind: 'barn', shape: 'box', x: 10.5, z: 3.5, w: 5, d: 3.5, rot: 0.25 },
    // 猪羊圈：x ∈ [11, 19]，z ∈ [-12, -5]，南边 x 14..16 是圈门（pen_gate，关着时由逻辑层当作碰撞体）
    fence('pen1_n', 15, -12, 8.3, F),
    fence('pen1_w', 11, -8.5, F, 7.3),
    fence('pen1_e', 19, -8.5, F, 7.3),
    fence('pen1_s1', 12.5, -5, 3, F),
    fence('pen1_s2', 17.5, -5, 3, F),
    // 公牛围场：x ∈ [15, 22]，z ∈ [7, 13]，西边有狗洞
    fence('pad_n', 18.5, 7, 7.3, F),
    fence('pad_s', 18.5, 13, 7.3, F),
    fence('pad_e', 22, 10, F, 6.3),
    fence('pad_w1', 15, 8.25, F, 2.5),
    fence('pad_w2', 15, 11.75, F, 2.5),
    fence('pad_gap', 15, 10, F, 1.0, { gap: true, blocks: ['keeper'] }),
  ],
  water: [
    { id: 'stream', kind: 'stream', shape: 'poly', points: [[3, -18], [5, -18], [5, 18], [3, 18]], depth: 'deep' },
    { id: 'pond', kind: 'pond', shape: 'circle', x: 10, z: 9, r: 2.0, depth: 'shallow' },
  ],
  // 新增字段（约定一里没有）：桥 = 盖在水面上的可走区域（盒子，含义同 colliders 的 box）
  bridges: [{ id: 'bridge', x: 4, z: 0, w: 3.4, d: 3.0, rot: 0 }],
  interactables: [
    // 菜地
    { id: 'radish1', kind: 'radish_bed', zone: 'veg', x: -17, z: 10, r: 1.2, count: 3 },
    { id: 'radish2', kind: 'radish_bed', zone: 'veg', x: -12.5, z: 10.5, r: 1.2, count: 3 },
    { id: 'flower1', kind: 'flower_bed', zone: 'veg', x: -10.5, z: 7.5, r: 1.0 },
    // 农舍前院
    { id: 'flower2', kind: 'flower_bed', zone: 'yard', x: -16, z: -1, r: 1.0 },
    { id: 'sheet1', kind: 'clothesline', zone: 'yard', x: -12.5, z: -4.5, r: 1.6 },
    { id: 'sheet2', kind: 'clothesline', zone: 'yard', x: -8, z: -9, r: 1.6 },
    { id: 'milk1', kind: 'milk_can', zone: 'yard', x: -6, z: -11.5, r: 0.5 },
    { id: 'crate1', kind: 'crate', zone: 'yard', x: -1, z: -10, r: 0.5 },
    { id: 'mud1', kind: 'mud_pit', zone: 'yard', x: -9.5, z: 0.5, r: 1.4 },
    { id: 'fountain1', kind: 'fountain', zone: 'yard', x: -3, z: -4.5, r: 1.1, plaza: 2.8 },
    // 猪羊圈和池塘
    { id: 'gate_pen1', kind: 'pen_gate', zone: 'pens', x: 15, z: -5, r: 1.1, w: 2, d: F, rot: 0, pen: 'pen1', out: [15, -2] },
    { id: 'lumber1', kind: 'lumber_pile', zone: 'pens', x: 9, z: -15, r: 1.2 },
    { id: 'hay1', kind: 'hay_bale', zone: 'pens', x: 8.2, z: -9, r: 0.8 },
    { id: 'milk2', kind: 'milk_can', zone: 'pens', x: 10, z: -2, r: 0.5 },
  ],
  hides: [
    { id: 'bush1', kind: 'bush', x: -6, z: 15.5, r: 1.0 },
    { id: 'bush2', kind: 'bush', x: -22, z: 2, r: 1.0 },
    { id: 'kennel', kind: 'kennel', x: -12, z: -13, r: 0.8 },
    { id: 'hay_hide', kind: 'hay', x: 8, z: -12, r: 1.0 },
    { id: 'bush3', kind: 'bush', x: 21, z: -1, r: 1.0 },
  ],
  spawns: {
    gate: { x: -21, z: 15, heading: 2.356 },
    exit: { x: 22.5, z: -17, r: 1.3 },
    keeper: {
      home: { x: -11.5, z: -11 },
      patrol: [[-11.5, -11], [-6, -6], [-11, 2.5], [-13.75, 3.5], [-13.75, 8], [-10, 9.5], [-13.75, 7], [-13.75, 3.5], [-3, 1.5],
        [1.5, 0], [7, 0], [13, -2.5], [20, -3], [21, 4], [13, 6.5], [7, 0], [1.5, 0], [-4, -8]],
    },
    goose: { x: 10, z: 14 },
    animals: [
      { id: 'hens', kind: 'hen', zone: 'veg', x: -3, z: 10.5, count: 2, roam: 3, pen: null },
      { id: 'chicks', kind: 'chick', zone: 'veg', x: -3.5, z: 11, count: 4, roam: 3, pen: null },
      { id: 'ducks', kind: 'duck', zone: 'pens', x: 10, z: 12.5, count: 3, roam: 2.5, pen: null },
      { id: 'pigs', kind: 'pig', zone: 'pens', x: 13.5, z: -9, count: 3, roam: 1.8, pen: 'pen1' },
      { id: 'sheep', kind: 'sheep', zone: 'pens', x: 17, z: -9, count: 2, roam: 1.5, pen: 'pen1' },
      { id: 'bull', kind: 'bull', zone: 'pens', x: 19.5, z: 10, count: 1, roam: 1.2, pen: 'paddock' },
      { id: 'cow', kind: 'cow', zone: 'pens', x: 17.5, z: 9, count: 1, roam: 1.2, pen: 'paddock' },
    ],
  },
};

export default FARM_MAP;
