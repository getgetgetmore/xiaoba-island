// “农场捣乱”小游戏（caper）的纯逻辑层：宠物移动、捣乱点、动物、管理员（草帽女孩）、大鹅、计分与结算。
// 不依赖 three / DOM，可在 Node 里直接跑（scripts/farm-test.mjs）。需求与接口见 docs/DESIGN.md
// “农场（定稿方向）”一节的“约定二：逻辑层”。
//
// 确定性：update 里只用内部的可序列化随机数（算法同 core/util.js 的 mulberry32，状态放在 snapshot 里），
// 不用 Math.random / Date。固定步长 FARM.STEP，update(dt) 内部细分。
//
// 坐标与朝向：原点在地图中心，+x 向东，+z 向南；heading = atan2(dx, dz)（0 = 朝 +z，与 three.js 的 rotation.y 一致）。
// 盒子碰撞体 { shape: 'box', x, z, w, d, rot }：w 沿局部 x、d 沿局部 z，rot 同 three.js 的 rotation.y：
//   局部 (lx, lz) → 世界 (x + lx·cos(rot) + lz·sin(rot), z − lx·sin(rot) + lz·cos(rot))。
//
// 谁被什么挡住：
//   碰撞体不带 blocks（也不带 gap）→ 挡所有人；带 gap: true 或 blocks: ['keeper'] → 只挡“大个子 NPC”
//   （管理员、大鹅、动物），宠物能钻。blocks 里写了 'pet' / 'dog' 才挡宠物。
//   圈门（interactables 里的 pen_gate）：关着时挡所有人，被撞开后谁都能过（管理员、大鹅的寻路也按门开没开走）。
//   门的形状优先取 colliders 里对应的静态碰撞体（带 gate: 圈门 id，或 kind: 'gate' 且位置重合），没有就用 pen_gate 自己的 w / d / rot。
//   深水：宠物能游（更慢），管理员 / 大鹅不进；浅水都能走（减速）。水可以是 circle、闭合的 poly，或带 width 的折线（points 是中心线，如小溪）。
//   地图数据可以带 bridges: [{ id, x, z, w, d, rot }]，桥面范围内不算水（这是约定一之外新增的字段）。
//
// 地图：createFarmSim({ map }) 必须传入地图数据（通常是 farm/mapData.js 的 FARM_MAP）。这里不静态 import mapData.js，
// 让逻辑层和测试不依赖那份文件是否已经写好。
import { clamp } from '../core/util.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

export const FARM = {
  // ---- 一局
  STEP: 1 / 60,            // 固定步长
  MAX_DT: 0.25,            // 单次 update 最多吃进这么多时间（防止卡顿后一次补太多）
  INTRO: 1.0,              // 开场（挣脱牵引绳）时长，这段时间不计入 sim.time
  DURATION: 300,
  WANTED_AT: 240,          // 进入“全场通缉”
  CAUGHT_MAX: 3,
  // ---- 宠物
  DOG_SPEED: 5.2,          // 全速
  PET_R: 0.35,             // 碰撞半径
  FULL_DIST: 3.0,          // moveTo 离得这么远以上才全速（越近越慢）
  STOP_DIST: 0.15,         // 离 moveTo 这么近就停
  ACCEL: 16, DECEL: 24,    // 加 / 减速（单位 / 秒²）
  TURN_RATE: 9,            // 转向速率（弧度 / 秒；低速时翻倍）
  POUNCE_SPEED: 9.0, POUNCE_DUR: 0.3, POUNCE_CD: 1.1, POUNCE_BUFFER: 0.15, POUNCE_REACH: 0.3,
  BONK_STUN: 0.8,          // 扑的时候一头撞上障碍：眩晕
  SHALLOW_MULT: 0.6,       // 浅水速度倍率
  SWIM_MULT: 0.45,         // 深水（游泳）速度倍率
  SLOW_MULT: 0.55,         // 被啄后的减速倍率
  MUD_TIME: 60,            // 泥狗状态持续多久（没洗掉也会自己干掉）
  MUD_PRINT_DIST: 1.5,     // 泥狗在石板地上走多远留下一串泥爪印
  IMMUNE_T: 5,             // 被放下后这段时间不会被再次抓住
  // ---- 管理员
  KEEPER_R: 0.35,
  WALK_SPEED: 2.2, SUSPECT_SPEED: 3, SEARCH_SPEED: 2.8, CARRY_SPEED: 3.0,
  WANTED_SPEED: 1.05,      // 通缉阶段追逐速度倍率（仍低于小狗全速）
  KEEPER_TURN: 7,
  NEAR_SENSE: 1.4,         // 贴这么近时不看朝向也能察觉
  CATCH_R: 0.9,
  CARRY_T: 1.5,            // 至少拎这么久（抓的地方就在路边也要拎一会儿）
  CARRY_MAX_T: 10,         // 最多拎这么久（路太远 / 走不到：到时间就地扔）
  ROAD_MIN: 3.5,           // 扔的地方离抓到的地方至少这么远
  TOSS_WIND: 0.35,         // 站定、抡一下的时间
  TOSS_T: 0.55, TOSS_DIST: 2.4, TOSS_H: 1.0, // 扔出去：飞行时间、距离、抛物线高度
  TOSS_STUN: 0.6,          // 落地打个滚、晕一下
  CATCH_PENALTY: 8,        // 被抓扣分
  LOSE_T: 2.5,             // 追逐中看不见这么久 → 丢失目标，转搜索
  GIVEUP_T: 2.5,           // 追逐中目标够不着（狗洞 / 深水另一边）这么久 → 放弃，转搜索
  SEARCH_T: 7, SEARCH_R: 4.5,
  LOOK_T: 1.8,             // 赶到现场没看见小狗：张望这么久，然后回去巡逻
  PATROL_WAIT: 0.8,        // 巡逻每个路点停一下
  ANGER_FULL: 0.9,         // 火气满了：不再先驱赶，看见小狗直接抓（巡逻 / 往回走时看见也追）
  ANGER_SEE: 2.5,          // 亲眼看见捣乱：火气涨 = 该捣乱点的火气值 × 这个倍率
  ANGER_HEAR: 1.0,         // 只听见
  ANGER_DECAY: 0.006,      // 每秒自然消火
  ANGER_AFTER_CATCH: 0.3,
  ANGER_FAR: 0.3,          // 离得远、听不见的捣乱：火气只涨这个倍率
  SHOO_T: 4,             // 驱赶：她到了小狗跟前（SHOO_NEAR 以内）以后给这么久，小狗还赖在现场 = 驱赶无效 → 抓
  SHOO_NEAR: 6,
  SHOO_HIDE_T: 1.5,        // 驱赶时这么久看不见小狗（躲起来 / 跑没影了）= 不在现场了，回去巡逻
  SHOO_ANGER: 0.08,        // 每驱赶一次火气涨这么多
  SHOO_CD: 8,             // 刚被赶走这么久以内又回到原地（AGAIN_R 以内）捣乱 = 驱赶无效，她回来直接抓
  LOST_RELIEF: 0.25,        // 搜了一圈没找到：火气降这么多
  REACT_T: 1.2,            // 听说有捣乱以后先愣一下、转过身，这么久以后才动身
  AGAIN_R: 7,              // “又回原地捣乱”的判定半径（离刚赶过的地方）
  SCENE_R: 7,              // “现场”：离出事地点这么近以内
  SUSPECT_CHASE: 0.35,     // 起疑 / 搜索时看见小狗，火气到这里就开追（巡逻时要火气满了才追）
  WANTED_KNOW: 3,          // 通缉开始时管理员“知道”小狗在哪的时长
  REPLAN_CHASE: 0.35,
  NAV_CELL: 0.5,           // 管理员寻路栅格
  NAV_CELL_PET: 0.25,      // 宠物（机器人用）寻路栅格
  NAV_SWIM_COST: 4,        // 宠物栅格里深水格子的额外代价
  // ---- 大鹅
  GOOSE_SPEED: 5.6, GOOSE_R: 0.3, GOOSE_PECK_R: 0.75, GOOSE_CD: 3, GOOSE_SLOW: 2.0, GOOSE_ALERT: 2.0,
  // ---- 计分
  ZONE_BONUS: 10,          // 清完一个区域
  ESCAPE_BONUS: 20,        // 通缉阶段钻出口
  FULL_FRAC: 0.75,         // 完成度 100 = 地图“基础分潜力”的这个比例（潜力 = 各捣乱点一次 + 区域奖励 + 鸡群鸭群 + 出口）
  STARS: [30, 60, 85],
  // 捣乱点种类：trigger = pounce（扑）/ dig（按住刨）/ trample（踩过去）/ roll（在里面待一会儿）/ splash（跳进去）
  // points 分值，hits 要扑几下，noise 响动半径，anger 火气
  KINDS: {
    radish_bed: { trigger: 'dig', points: 3, bigPoints: 8, count: 3, digTime: 1.0, bigTime: 2.2, noise: 5, anger: 0.05 },
    flower_bed: { trigger: 'trample', points: 6, need: 3, noise: 4, anger: 0.08 },
    clothesline: { trigger: 'pounce', points: 8, hits: 1, noise: 7, anger: 0.12 },
    milk_can: { trigger: 'pounce', points: 5, hits: 1, noise: 10, anger: 0.10 },
    hay_bale: { trigger: 'pounce', points: 5, hits: 1, noise: 5, anger: 0.08 },
    crate: { trigger: 'pounce', points: 4, hits: 1, noise: 6, anger: 0.08 },
    lumber_pile: { trigger: 'pounce', points: 10, hits: 2, noise: 12, anger: 0.15 },
    pen_gate: { trigger: 'pounce', points: 6, hits: 2, noise: 8, anger: 0.12 },
    mud_pit: { trigger: 'roll', points: 4, need: 0.8, noise: 3, anger: 0.03 },
    fountain: { trigger: 'splash', points: 5, noise: 6, anger: 0.08 },
  },
  // 附加的捣乱（不在清单里，或是连带加分）
  EXTRA: {
    mud_print: { points: 6, noise: 2, anger: 0.05 },     // 泥狗碰床单 / 走过喷泉石板地
    scatter: { points: 5, repeat: 2, cd: 20, noise: 6, anger: 0.06 }, // 冲散一群鸡 / 鸭（第一次进清单）
    pounce_bird: { points: 2, noise: 4, anger: 0.04 },   // 扑中一只（每只一次）
    spook: { points: 2, noise: 4, anger: 0.04 },         // 扑圈里的猪羊牛（每只一次）
    loose: { points: 2, noise: 3, anger: 0.05 },         // 圈里的动物跑出来（每只一次）
    bull: { points: 4, noise: 8, anger: 0.08 },          // 惹毛公牛
  },
  // 动物：r 半径，walk / flee 速度，fleeR 受惊距离
  CRITTERS: {
    chick: { r: 0.2, walk: 0.9, flee: 3.6, fleeR: 2.6, poultry: true, cat: 'chickens' },
    hen: { r: 0.28, walk: 1.0, flee: 3.8, fleeR: 2.6, poultry: true, cat: 'chickens' },
    duck: { r: 0.28, walk: 0.9, flee: 3.2, fleeR: 2.4, poultry: true, cat: 'ducks' },
    pig: { r: 0.45, walk: 0.8, flee: 3.0, fleeR: 2.2, cat: 'pigs' },
    sheep: { r: 0.45, walk: 0.8, flee: 3.2, fleeR: 2.4, cat: 'sheep' },
    alpaca: { r: 0.45, walk: 0.9, flee: 3.2, fleeR: 2.4, cat: 'sheep' },
    cow: { r: 0.7, walk: 0.6, flee: 2.2, fleeR: 1.8, cat: 'cows' },
    bull: { r: 0.75, walk: 0.6, flee: 2.2, fleeR: 1.8, cat: 'cows' },
  },
  SCARED_T: [1.4, 2.4],
  LOOSE_ROAM: 5,
  HEN_PECK_CHANCE: 0.6, HEN_CHASE_T: 2.5, HEN_CHASE_SPEED: 4.2, HEN_SLOW: 1.2,
  BULL_WIND: 0.6, BULL_CHARGE_T: 1.1, BULL_SPEED: 7.5, BULL_PROVOKE_R: 1.4, KNOCK_SPEED: 8, KNOCK_STUN: 1.2,
  // 挡视线的碰撞体种类（碰撞体也可以自己写 sight: true / false）
  SIGHT_BLOCK: ['house', 'farmhouse', 'barn', 'shed', 'coop', 'henhouse', 'cowshed', 'silo', 'windmill', 'cabin', 'cabin_frame', 'stable', 'well_house',
    'tree', 'pine', 'apple_tree', 'pink_tree', 'woods', 'hedge', 'rock', 'wall'],
  // 树：碰撞体只是树干，挡视线按树冠算（至少这么粗）
  TREE_KINDS: ['tree', 'pine', 'apple_tree', 'pink_tree', 'woods'],
  TREE_SIGHT_R: 0.7,
};
// 真实地图里还有这些可互动物，按同类处理
Object.assign(FARM.KINDS, {
  cabbage_bed: { ...FARM.KINDS.radish_bed, bigPoints: 7 },
  pumpkin_bed: { ...FARM.KINDS.radish_bed, count: 2, bigPoints: 10, bigTime: 2.6 },
  barrel: { trigger: 'pounce', points: 5, hits: 1, noise: 9, anger: 0.10 },
  feed_trough: { trigger: 'pounce', points: 4, hits: 1, noise: 6, anger: 0.08 },
  mailbox: { trigger: 'pounce', points: 4, hits: 1, noise: 5, anger: 0.08 },
  henhouse: { trigger: 'pounce', points: 5, hits: 1, noise: 7, anger: 0.10 },
});
/** 不认识的种类：当作“扑一下就倒”的小东西 */
const DEFAULT_KIND = { trigger: 'pounce', points: 3, hits: 1, noise: 5, anger: 0.05 };

/** 白天的默认规则（farm/rules.js 的 FARM_RULES.day 应当和它同形）。visionAngle 单位：度 */
export const DEFAULT_RULES = {
  phase: 'day',
  lighting: 'day',
  keeper: { awake: true, speed: 4.6, visionRange: 10, visionAngle: 110, lantern: false, hearing: 1 },
  goose: { speed: FARM.GOOSE_SPEED },
  animals: { chickens: 'roam', ducks: 'roam', pigs: 'roam', sheep: 'roam', cows: 'roam' },
  spawns: [],
  // 可用的捣乱点种类：分值倍率（没列出的种类不可用；'*' = 其余所有种类）
  mischief: {
    radish_bed: 1, cabbage_bed: 1, pumpkin_bed: 1, flower_bed: 1, clothesline: 1, milk_can: 1, hay_bale: 1, crate: 1, barrel: 1,
    feed_trough: 1, mailbox: 1, henhouse: 1, lumber_pile: 1, pen_gate: 1, mud_pit: 1, fountain: 1,
    mud_print: 1, scatter: 1, pounce_bird: 1, spook: 1, loose: 1, bull: 1, '*': 1,
  },
  events: [],
};

function normalizeRules(r) {
  const d = DEFAULT_RULES;
  r = r || {};
  return JSON.parse(JSON.stringify({
    ...d, ...r,
    keeper: { ...d.keeper, ...(r.keeper || {}) },
    goose: { ...d.goose, ...(r.goose || {}) },
    animals: { ...d.animals, ...(r.animals || {}) },
    mischief: r.mischief ? { ...r.mischief } : { ...d.mischief },
  }));
}

// ====================================================================== 静态世界（由地图数据生成，不进 snapshot）
const P = { nx: 0, nz: 0 }; // penetrate 的输出法线（复用，避免分配）

/** 圆 (x, z, r) 与碰撞体 c 的穿透深度（> 0 表示重叠），法线写进 P（从碰撞体指向圆心） */
function penetrate(c, x, z, r) {
  const dx = x - c.x, dz = z - c.z;
  if (c.shape === 'circle') {
    const d = Math.hypot(dx, dz);
    if (d > 1e-9) { P.nx = dx / d; P.nz = dz / d; } else { P.nx = 1; P.nz = 0; }
    return c.r + r - d;
  }
  const lx = dx * c.co - dz * c.si, lz = dx * c.si + dz * c.co;
  const cx = lx < -c.hw ? -c.hw : lx > c.hw ? c.hw : lx, cz = lz < -c.hd ? -c.hd : lz > c.hd ? c.hd : lz;
  const ox = lx - cx, oz = lz - cz, d = Math.hypot(ox, oz);
  let lnx, lnz, depth;
  if (d > 1e-9) { lnx = ox / d; lnz = oz / d; depth = r - d; }
  else {
    const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
    if (px < pz) { lnx = lx >= 0 ? 1 : -1; lnz = 0; depth = px + r; } else { lnx = 0; lnz = lz >= 0 ? 1 : -1; depth = pz + r; }
  }
  P.nx = lnx * c.co + lnz * c.si; P.nz = -lnx * c.si + lnz * c.co;
  return depth;
}

function prepShape(s) {
  const o = { ...s };
  if (o.shape === 'circle') { o.ax0 = o.x - o.r; o.ax1 = o.x + o.r; o.az0 = o.z - o.r; o.az1 = o.z + o.r; return o; }
  o.shape = 'box';
  const rot = o.rot || 0;
  o.co = Math.cos(rot); o.si = Math.sin(rot); o.hw = (o.w || 1) / 2; o.hd = (o.d || 1) / 2;
  const ex = Math.abs(o.co) * o.hw + Math.abs(o.si) * o.hd, ez = Math.abs(o.si) * o.hw + Math.abs(o.co) * o.hd;
  o.ax0 = o.x - ex; o.ax1 = o.x + ex; o.az0 = o.z - ez; o.az1 = o.z + ez;
  return o;
}

function pointInPoly(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 线段与盒子（局部坐标里做 Liang–Barsky 裁剪）是否相交 */
function segHitsBox(c, x0, z0, x1, z1, shrink) {
  const tx0 = x0 - c.x, tz0 = z0 - c.z, tx1 = x1 - c.x, tz1 = z1 - c.z;
  const ax = tx0 * c.co - tz0 * c.si, az = tx0 * c.si + tz0 * c.co;
  const bx = tx1 * c.co - tz1 * c.si, bz = tx1 * c.si + tz1 * c.co;
  const hw = c.hw * shrink, hd = c.hd * shrink;
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  const p = [-dx, dx, -dz, dz], q = [ax + hw, hw - ax, az + hd, hd - az];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}
function segPointDist(x0, z0, x1, z1, px, pz) {
  const dx = x1 - x0, dz = z1 - z0, L = dx * dx + dz * dz;
  let t = L > 1e-12 ? ((px - x0) * dx + (pz - z0) * dz) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x0 + dx * t - px, z0 + dz * t - pz);
}

const WORLD_CACHE = new WeakMap();

/** 由地图数据生成静态世界（碰撞体、水、桥、躲藏点、空间索引、寻路栅格）。同一份地图对象只生成一次。 */
export function buildFarmWorld(map) {
  if (WORLD_CACHE.has(map)) return WORLD_CACHE.get(map);
  const W = map.size.w, D = map.size.d;
  const w = { map, W, D, minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
  // 圈门：interactables 里的 pen_gate。地图里如果另有对应的静态碰撞体（kind: 'gate'，或带 gate: 圈门 id），
  // 就把它当作这扇门的形状，从静态碰撞体里拿掉（门开了就不挡）。
  const gateInters = [];
  (map.interactables || []).forEach((it, i) => { if (it.kind === 'pen_gate') gateInters.push({ it, i, col: null }); });
  const staticCols = [];
  for (const c of map.colliders || []) {
    let g = null;
    if (c.gate) g = gateInters.find((q) => q.it.id === c.gate);
    if (!g && c.kind === 'gate') g = gateInters.find((q) => !q.col && Math.hypot(q.it.x - c.x, q.it.z - c.z) < 0.6);
    if (g && !g.col) g.col = c; else staticCols.push(c);
  }
  w.colliders = staticCols.map((c) => {
    const o = prepShape(c);
    let blocks = c.blocks;
    if (!blocks && c.gap) blocks = ['keeper'];
    o.blockPet = !blocks || blocks.includes('pet') || blocks.includes('dog');
    o.blockNpc = !blocks || blocks.includes('keeper') || blocks.includes('npc');
    o.sight = c.sight !== undefined ? !!c.sight : FARM.SIGHT_BLOCK.includes(c.kind);
    o.sr = o.shape === 'circle' ? (FARM.TREE_KINDS.includes(c.kind) ? Math.max(o.r, FARM.TREE_SIGHT_R) : o.r * 0.9) : 0; // 挡视线的半径
    return o;
  });
  w.sightColliders = w.colliders.filter((c) => c.sight);
  // 圈门：关着时挡所有人
  w.gates = gateInters.map(({ it, i, col }) => {
    const src = col && col.shape !== 'circle' ? col : it;
    const g = prepShape({ id: it.id, kind: 'pen_gate', shape: 'box', x: src.x, z: src.z, w: src.w || 2, d: src.d || 0.3, rot: src.rot || 0 });
    g.oi = i; g.gate = true; g.blockPet = true; g.blockNpc = true;
    return g;
  });
  // 空间索引（4 单位一格，碰撞体按外接框放进所有覆盖到的格子，外扩 1.2）
  const BS = 4, BNX = Math.ceil(W / BS) + 2, BNZ = Math.ceil(D / BS) + 2;
  const buckets = Array.from({ length: BNX * BNZ }, () => []);
  const bix = (x) => clamp(Math.floor((x - w.minX) / BS) + 1, 0, BNX - 1), biz = (z) => clamp(Math.floor((z - w.minZ) / BS) + 1, 0, BNZ - 1);
  for (const c of w.colliders) {
    for (let iz = biz(c.az0 - 1.2); iz <= biz(c.az1 + 1.2); iz++) for (let ix = bix(c.ax0 - 1.2); ix <= bix(c.ax1 + 1.2); ix++) buckets[iz * BNX + ix].push(c);
  }
  w.bucketAt = (x, z) => buckets[biz(z) * BNX + bix(x)];
  // 水：circle（x, z, r）、poly（points 是闭合多边形）、或者带 width 的折线（points 是中心线，比如小溪）
  w.water = (map.water || []).map((q) => {
    const o = { ...q };
    if (q.shape === 'circle') { o.ax0 = q.x - q.r; o.ax1 = q.x + q.r; o.az0 = q.z - q.r; o.az1 = q.z + q.r; }
    else {
      const pts = q.points || q.pts || [];
      o.pts = pts;
      o.shape = q.width > 0 || q.shape === 'line' || q.shape === 'polyline' || q.shape === 'path' ? 'band' : 'poly';
      o.hw = (q.width || 1) / 2;
      const m = o.shape === 'band' ? o.hw : 0;
      o.ax0 = Math.min(...pts.map((p) => p[0])) - m; o.ax1 = Math.max(...pts.map((p) => p[0])) + m;
      o.az0 = Math.min(...pts.map((p) => p[1])) - m; o.az1 = Math.max(...pts.map((p) => p[1])) + m;
    }
    o.deep = q.depth === 'deep';
    return o;
  });
  const inBand = (q, x, z) => {
    const p = q.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      if (x < Math.min(a[0], b[0]) - q.hw || x > Math.max(a[0], b[0]) + q.hw || z < Math.min(a[1], b[1]) - q.hw || z > Math.max(a[1], b[1]) + q.hw) continue;
      if (segPointDist(a[0], a[1], b[0], b[1], x, z) < q.hw) return true;
    }
    return false;
  };
  w.bridges = (map.bridges || []).map((b) => prepShape({ ...b, shape: 'box' }));
  w.hides = (map.hides || []).map((h) => ({ ...h }));
  w.exit = map.spawns.exit;
  w.gapColliders = w.colliders.filter((c) => !c.blockPet && c.blockNpc);

  const inBridge = (x, z) => { for (const b of w.bridges) if (x >= b.ax0 && x <= b.ax1 && z >= b.az0 && z <= b.az1 && penetrate(b, x, z, 0) >= 0) return true; return false; };
  /** 这个点上的水（桥上不算水），没有返回 null；深水优先 */
  w.waterAt = (x, z) => {
    let found = null;
    for (const q of w.water) {
      if (x < q.ax0 || x > q.ax1 || z < q.az0 || z > q.az1) continue;
      const inside = q.shape === 'circle' ? Math.hypot(x - q.x, z - q.z) < q.r : q.shape === 'band' ? inBand(q, x, z) : pointInPoly(q.pts, x, z);
      if (inside && (!found || (q.deep && !found.deep))) found = q;
    }
    if (found && w.bridges.length && inBridge(x, z)) return null;
    return found;
  };
  w.deepAt = (x, z) => { const q = w.waterAt(x, z); return !!(q && q.deep); };
  /** 圆心周围 m 范围内（9 个采样点）有没有深水 */
  w.deepNear = (x, z, m) => {
    if (w.deepAt(x, z)) return true;
    if (m <= 0) return false;
    for (let k = 0; k < 8; k++) { const a = (k * TAU) / 8; if (w.deepAt(x + Math.sin(a) * m, z + Math.cos(a) * m)) return true; }
    return false;
  };
  w.hideAt = (x, z) => { for (const h of w.hides) if (Math.hypot(x - h.x, z - h.z) < h.r) return h; return null; };
  /** 圆 (x, z, r) 是否和 who（'pet' | 'npc'）的碰撞体重叠；gateOpen(oi) 判断圈门是否已开（不传 = 都关着） */
  w.blocked = (x, z, r, who, gateOpen) => {
    const pet = who === 'pet';
    for (const c of w.bucketAt(x, z)) { if (pet ? !c.blockPet : !c.blockNpc) continue; if (penetrate(c, x, z, r) > 0) return true; }
    for (const g of w.gates) { if (gateOpen && gateOpen(g.oi)) continue; if (penetrate(g, x, z, r) > 0) return true; }
    return false;
  };
  /** 附近碰撞体的最大穿透深度 */
  w.penAt = (x, z, r, who, gateOpen) => {
    const pet = who === 'pet';
    let m = 0;
    for (const c of w.bucketAt(x, z)) { if (pet ? !c.blockPet : !c.blockNpc) continue; const d = penetrate(c, x, z, r); if (d > m) m = d; }
    for (const g of w.gates) { if (gateOpen && gateOpen(g.oi)) continue; const d = penetrate(g, x, z, r); if (d > m) m = d; }
    return m;
  };
  /** 最大穿透深度（测试用，遍历全部碰撞体） */
  w.maxPenetration = (x, z, r, who, gateOpen) => {
    const pet = who === 'pet';
    let m = 0;
    for (const c of w.colliders) { if (pet ? !c.blockPet : !c.blockNpc) continue; m = Math.max(m, penetrate(c, x, z, r)); }
    for (const g of w.gates) { if (gateOpen && gateOpen(g.oi)) continue; m = Math.max(m, penetrate(g, x, z, r)); }
    return m;
  };
  /** 把实体 e（有 x、z）推出碰撞体并夹在地图内；返回撞到的碰撞体（没撞到 null）和法线 */
  const RES = { hit: null, nx: 0, nz: 0 };
  w.resolve = (e, r, who, gateOpen) => {
    const pet = who === 'pet';
    RES.hit = null;
    for (let it = 0; it < 4; it++) {
      let any = false;
      for (const c of w.bucketAt(e.x, e.z)) {
        if (pet ? !c.blockPet : !c.blockNpc) continue;
        const dep = penetrate(c, e.x, e.z, r);
        if (dep > 0) { e.x += P.nx * dep; e.z += P.nz * dep; any = true; RES.hit = c; RES.nx = P.nx; RES.nz = P.nz; }
      }
      for (const g of w.gates) {
        if (gateOpen && gateOpen(g.oi)) continue;
        const dep = penetrate(g, e.x, e.z, r);
        if (dep > 0) { e.x += P.nx * dep; e.z += P.nz * dep; any = true; RES.hit = g; RES.nx = P.nx; RES.nz = P.nz; }
      }
      if (!any) break;
    }
    e.x = clamp(e.x, w.minX + r, w.maxX - r); e.z = clamp(e.z, w.minZ + r, w.maxZ - r);
    return RES;
  };
  /** 视线是否被房子 / 树等挡住 */
  w.sightBlocked = (x0, z0, x1, z1) => {
    const ax0 = Math.min(x0, x1), ax1 = Math.max(x0, x1), az0 = Math.min(z0, z1), az1 = Math.max(z0, z1);
    for (const c of w.sightColliders) {
      const m = c.shape === 'circle' ? c.sr : 0;
      if (c.ax1 + m < ax0 || c.ax0 - m > ax1 || c.az1 + m < az0 || c.az0 - m > az1) continue;
      if (c.shape === 'circle') { if (segPointDist(x0, z0, x1, z1, c.x, c.z) < c.sr) return true; }
      else if (segHitsBox(c, x0, z0, x1, z1, 0.97)) return true;
    }
    return false;
  };
  const navs = {};
  w.nav = (who) => navs[who] || (navs[who] = buildNav(w, who));
  WORLD_CACHE.set(map, w);
  return w;
}

// ---------------------------------------------------------------------- 栅格寻路
// 'keeper'：0.5 一格，格子中心离碰撞体（含狗洞）≥ 管理员半径 + 半格，离深水 ≥ 0.8 倍半径（窄桥也能过）；浅水能走但代价高。
//           沿路点走时管理员仍会被推出碰撞体（world.resolve），所以栅格只管“路线”，不负责精确的贴边。
// 'pet'   ：0.25 一格，只按小狗半径留边（狗洞能钻）；深水能走但代价高（游得慢）。机器人用。
// 圈门：被圈门挡住的格子单独记下（gate[i] = 第几扇门 + 1），寻路时按调用方给的 open(oi) 判断门开没开；
// 连通分量按“门都开着”算。
const CLOSED = () => false;
function buildNav(w, who) {
  const pet = who === 'pet';
  const CELL = pet ? FARM.NAV_CELL_PET : FARM.NAV_CELL;
  const bodyR = pet ? FARM.PET_R : FARM.KEEPER_R;
  const R = pet ? FARM.PET_R : FARM.KEEPER_R + CELL * 0.5;
  const x0 = w.minX, z0 = w.minZ;
  const NX = Math.floor(w.W / CELL) + 1, NZ = Math.floor(w.D / CELL) + 1, N = NX * NZ;
  const free = new Uint8Array(N), gate = new Uint8Array(N), cost = new Float32Array(N), comp = new Int32Array(N).fill(-1);
  const gvx = (i) => x0 + i * CELL, gvz = (i) => z0 + i * CELL;
  const ALL_OPEN = () => true;
  for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
    const x = gvx(ix), z = gvz(iz);
    if (x < w.minX + bodyR || x > w.maxX - bodyR || z < w.minZ + bodyR || z > w.maxZ - bodyR) continue;
    if (w.blocked(x, z, R, pet ? 'pet' : 'npc', ALL_OPEN)) continue;
    const i = iz * NX + ix;
    if (pet) {
      const q = w.waterAt(x, z);
      free[i] = 1; cost[i] = q ? (q.deep ? FARM.NAV_SWIM_COST : 0.8) : 0;
    } else {
      if (w.deepNear(x, z, FARM.KEEPER_R * 0.8)) continue;
      free[i] = 1; cost[i] = w.waterAt(x, z) ? 1.5 : 0;
    }
    for (let g = 0; g < w.gates.length && g < 255; g++) if (penetrate(w.gates[g], x, z, R) > 0) { gate[i] = g + 1; break; }
  }
  // 贴墙的格子略贵，路线自然离墙远一点
  for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
    const i = iz * NX + ix;
    if (!free[i]) continue;
    if (ix === 0 || iz === 0 || ix === NX - 1 || iz === NZ - 1 || !free[i - 1] || !free[i + 1] || !free[i - NX] || !free[i + NX]) cost[i] += 0.5;
  }
  // 连通分量（门都开着；和 A* 同样的 8 邻接规则）
  let nc = 0;
  const stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!free[s] || comp[s] >= 0) continue;
    let sp = 0; stack[sp++] = s; comp[s] = nc;
    while (sp) {
      const cur = stack[--sp], cx = cur % NX, cz = (cur / NX) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= NX || nz >= NZ) continue;
        const ni = nz * NX + nx;
        if (!free[ni] || comp[ni] >= 0) continue;
        if (dx && dz && (!free[cz * NX + nx] || !free[nz * NX + cx])) continue;
        comp[ni] = nc; stack[sp++] = ni;
      }
    }
    nc++;
  }
  let open = CLOSED;   // 当前这次寻路用的“门开没开”
  const pass = (i) => free[i] === 1 && (!gate[i] || open(w.gates[gate[i] - 1].oi));
  const ixOf = (x) => Math.round((x - x0) / CELL), izOf = (z) => Math.round((z - z0) / CELL);
  const cellAt = (x, z) => { const ix = ixOf(x), iz = izOf(z); return ix >= 0 && iz >= 0 && ix < NX && iz < NZ ? iz * NX + ix : -1; };
  const freeAt0 = (x, z) => { const i = cellAt(x, z); return i >= 0 && pass(i); };
  function freeAt(x, z, o = CLOSED) { open = o; return freeAt0(x, z); }
  function los0(xa, za, xb, zb) {
    const d = Math.hypot(xb - xa, zb - za), n = Math.max(1, Math.ceil(d / (CELL * 0.5)));
    for (let k = 0; k <= n; k++) { const u = k / n; if (!freeAt0(xa + (xb - xa) * u, za + (zb - za) * u)) return false; }
    return true;
  }
  function los(xa, za, xb, zb, o = CLOSED) { open = o; return los0(xa, za, xb, zb); }
  /** 离 (x, z) 最近的能站的格子（可限定连通分量、可限定已知距离场里够得着的格子），没有返回 -1 */
  function nearestFree0(x, z, maxR = 24, compId = -1, dist = null, ok = null) {
    const cx = ixOf(x), cz = izOf(z);
    let best = -1, bd = 1e9;
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const ix = cx + dx, iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= NX || iz >= NZ) continue;
        const i = iz * NX + ix;
        if (!pass(i) || (compId >= 0 && comp[i] !== compId) || (dist && !(dist[i] < 1e30))) continue;
        if (ok && !ok(gvx(ix), gvz(iz))) continue;
        const d = Math.hypot(gvx(ix) - x, gvz(iz) - z);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0 && r * CELL > bd + CELL) break;
    }
    return best;
  }
  function nearestFree(x, z, maxR = 24, compId = -1, dist = null, o = CLOSED) { open = o; return nearestFree0(x, z, maxR, compId, dist); }
  // 二叉堆（按 key 取最小）
  const heap = new Int32Array(N * 4); let hn = 0;
  function hpush(i, key) {
    if (hn >= heap.length) return;
    heap[hn] = i; let c = hn++;
    while (c > 0) { const p = (c - 1) >> 1; if (key[heap[p]] <= key[heap[c]]) break; const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p; }
  }
  function hpop(key) {
    const top = heap[0]; hn--;
    if (hn > 0) {
      heap[0] = heap[hn]; let p = 0;
      for (;;) { const l = 2 * p + 1, r = l + 1; let m = p; if (l < hn && key[heap[l]] < key[heap[m]]) m = l; if (r < hn && key[heap[r]] < key[heap[m]]) m = r; if (m === p) break; const t = heap[p]; heap[p] = heap[m]; heap[m] = t; p = m; }
    }
    return top;
  }
  const gScore = new Float32Array(N), fScore = new Float32Array(N), came = new Int32Array(N), stamp = new Uint32Array(N), closed = new Uint32Array(N);
  let planId = 0;
  function straighten(xs, zs, cells) {
    const pts = [[xs, zs]].concat(cells), out = [];
    for (let i = 0; i < pts.length - 1;) {
      let j = pts.length - 1;
      while (j > i + 1 && !los0(pts[i][0], pts[i][1], pts[j][0], pts[j][1])) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  }
  /**
   * A*：返回路点 [[x, z], …]（最后一个是目标或能到的最近处），out.partial = 目标够不着（被墙 / 洞 / 深水 / 关着的门隔开）；
   * 起点附近没有能站的格子返回 null。o(oi) = 第 oi 个可互动物（圈门）开没开。
   */
  function plan(xa, za, xb, zb, o = CLOSED) {
    open = o;
    if (freeAt0(xa, za) && freeAt0(xb, zb) && los0(xa, za, xb, zb)) { const r = [[xb, zb]]; r.partial = false; return r; }
    // 起点不在能站的格子上（贴着墙 / 篱笆）：先找不用穿过碰撞体就能走到的最近格子，没有再退回“最近的”
    const reach = (cx, cz) => {
      const d = Math.hypot(cx - xa, cz - za), n = Math.max(1, Math.ceil(d / 0.1));
      for (let k = 1; k <= n; k++) { const u = k / n; if (w.penAt(xa + (cx - xa) * u, za + (cz - za) * u, bodyR * 0.5, who, o) > 0.02) return false; }
      return true;
    };
    let sI = nearestFree0(xa, za, 12, -1, null, reach);
    if (sI < 0) sI = nearestFree0(xa, za, 12);
    if (sI < 0) return null;
    const gI = nearestFree0(xb, zb, 60, comp[sI]);
    if (gI < 0) return null;
    const gx = gI % NX, gz = (gI / NX) | 0;
    let partial = Math.hypot(gvx(gx) - xb, gvz(gz) - zb) > 1.0;
    planId++; hn = 0;
    gScore[sI] = 0; stamp[sI] = planId; came[sI] = -1; fScore[sI] = 0; hpush(sI, fScore);
    let found = false, bestI = sI, bestH = 1e9;
    while (hn) {
      const cur = hpop(fScore);
      if (closed[cur] === planId) continue;
      closed[cur] = planId;
      if (cur === gI) { found = true; break; }
      const cx = cur % NX, cz = (cur / NX) | 0;
      const hh = Math.hypot(cx - gx, cz - gz);
      if (hh < bestH) { bestH = hh; bestI = cur; }
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= NX || nz >= NZ) continue;
        const ni = nz * NX + nx;
        if (!pass(ni) || closed[ni] === planId) continue;
        if (dx && dz && (!pass(cz * NX + nx) || !pass(nz * NX + cx))) continue;
        const g = gScore[cur] + (dx && dz ? 1.4142 : 1) * (1 + cost[ni]);
        if (stamp[ni] === planId && g >= gScore[ni]) continue;
        stamp[ni] = planId; gScore[ni] = g; came[ni] = cur;
        fScore[ni] = g + Math.hypot(nx - gx, nz - gz);
        hpush(ni, fScore);
      }
    }
    const end = found ? gI : bestI;
    if (!found) partial = true;  // 被关着的门隔开：走到能到的最近处
    const cells = [];
    for (let c = end; c >= 0; c = came[c]) cells.push([gvx(c % NX), gvz((c / NX) | 0)]);
    cells.reverse();
    const out = straighten(xa, za, cells);
    if (!partial && freeAt0(xb, zb)) { const last = out[out.length - 1]; if (!last || Math.hypot(last[0] - xb, last[1] - zb) > 0.02) out.push([xb, zb]); }
    if (!out.length) out.push([gvx(end % NX), gvz((end / NX) | 0)]);
    out.partial = partial;
    return out;
  }
  /** Dijkstra 距离场：从 (x, z) 出发到每个格子的代价（单位：世界单位，含水 / 贴墙代价），机器人用来估路程和取路线 */
  function field(xa, za, o = CLOSED) {
    open = o;
    const dist = new Float32Array(N).fill(1e38), from = new Int32Array(N).fill(-1);
    const sI = nearestFree0(xa, za, 12);
    const f = { dist, from, src: sI, x: xa, z: za, open: o };
    if (sI < 0) return f;
    dist[sI] = 0; hn = 0; hpush(sI, dist);
    planId++;
    while (hn) {
      const cur = hpop(dist);
      if (closed[cur] === planId) continue;
      closed[cur] = planId;
      const cx = cur % NX, cz = (cur / NX) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= NX || nz >= NZ) continue;
        const ni = nz * NX + nx;
        if (!pass(ni) || closed[ni] === planId) continue;
        if (dx && dz && (!pass(cz * NX + nx) || !pass(nz * NX + cx))) continue;
        const g = dist[cur] + (dx && dz ? 1.4142 : 1) * CELL * (1 + cost[ni]);
        if (g >= dist[ni]) continue;
        dist[ni] = g; from[ni] = cur; hpush(ni, dist);
      }
    }
    return f;
  }
  /** 距离场里到 (x, z) 的路程（够不着返回 Infinity） */
  function fieldDist(f, x, z) {
    open = f.open;
    const i = nearestFree0(x, z, 8, -1, f.dist);
    if (i < 0) return Infinity;
    return f.dist[i] + Math.hypot(gvx(i % NX) - x, gvz((i / NX) | 0) - z);
  }
  /** 用距离场取到 (x, z) 的路线（拉直后的路点） */
  function fieldPath(f, x, z) {
    open = f.open;
    const gI = nearestFree0(x, z, 8, -1, f.dist);
    if (gI < 0) return null;
    const cells = [];
    for (let c = gI, n = 0; c >= 0 && n < N; c = f.from[c], n++) cells.push([gvx(c % NX), gvz((c / NX) | 0)]);
    cells.reverse();
    const out = straighten(f.x, f.z, cells);
    if (freeAt0(x, z)) out.push([x, z]);
    return out;
  }
  return { who, CELL, NX, NZ, free, gate, cost, comp, cellAt, freeAt, los, nearestFree, plan, field, fieldDist, fieldPath, gvx, gvz };
}

// ====================================================================== 模拟
/**
 * @param {object} o
 * @param {object} o.map   地图数据（约定一的格式；通常传 farm/mapData.js 的 FARM_MAP）
 * @param {object} [o.rules]  规则表（FARM_RULES[phase]），缺省 DEFAULT_RULES
 * @param {number} [o.seed]
 * @param {string} [o.mode]   本版只有 'caper'
 * @param {object} [o.test]   测试开关：{ skipIntro, noKeeper, noAnimals, noGoose, endless（不进通缉、不结束）, keeperPatrol: [[x, z], …] }
 */
export function createFarmSim({ map, rules, seed = 1, mode = 'caper', test = {} } = {}) {
  if (!map || !map.size) throw new Error('createFarmSim: 需要传入地图数据 map（farm/mapData.js 的 FARM_MAP）');
  const world = buildFarmWorld(map);
  const STEP = FARM.STEP;
  const END_TICK = Math.round(FARM.DURATION / STEP), WANTED_TICK = Math.round(FARM.WANTED_AT / STEP), INTRO_TICK = Math.round((test.skipIntro ? 0 : FARM.INTRO) / STEP);
  const events = [];
  const ev = (type, extra) => { const e = { type, t: S ? Math.round(S.time * 1000) / 1000 : 0 }; if (extra) Object.assign(e, extra); events.push(e); };

  let S = null;
  // ---------------------------------------------------------------- 随机数（mulberry32，状态在 S.rng）
  function rnd() {
    const a = (S.rng + 0x6d2b79f5) >>> 0; S.rng = a;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rr = (a, b) => a + (b - a) * rnd();

  const gateOpen = (oi) => S.objects[oi].done;
  const sp = map.spawns;
  // 路面上的落点（沿每条路大约每 1 个单位取一个，带上路的走向）：管理员抓到小狗后拎到路上再扔
  const roadPts = [];
  for (const path of map.paths || []) {
    const pts = path.points || [];
    let lx = 1e9, lz = 1e9;
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1], L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-6) continue;
      const n = Math.max(1, Math.round(L));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (Math.hypot(x - lx, z - lz) < 0.9) continue;
        if (world.waterAt(x, z) || world.penAt(x, z, FARM.KEEPER_R, 'npc', () => false) > 0.005) continue;
        roadPts.push({ x, z, dx: (bx - ax) / L, dz: (bz - az) / L }); lx = x; lz = z;
      }
    }
  }
  const patrolPts = test.keeperPatrol || (sp.keeper.patrol && sp.keeper.patrol.length ? sp.keeper.patrol : [[sp.keeper.home.x, sp.keeper.home.z]]);

  // ---------------------------------------------------------------- 初始状态
  function initState() {
    S = {
      seed, rng: seed >>> 0, mode, tick: 0, time: 0, acc: 0, phase: INTRO_TICK > 0 ? 'intro' : 'play', finished: false, endReason: null,
      score: 0, caught: 0, escaped: false, mischief: {}, zonesCleared: 0, zones: {}, fullScore: 1,
      rules: normalizeRules(rules), nextPet: 1, pets: [], objects: [], animals: [], groups: [],
      keeper: null, goose: null,
    };
    for (const z of map.zones || []) S.zones[z.id] = { done: 0, total: 0, cleared: false };
    const zoneOf = (id) => { if (id && !S.zones[id]) S.zones[id] = { done: 0, total: 0, cleared: false }; return id ? S.zones[id] : null; }; // 数据里引用了但没列在 zones 里的区域也建一个清单
    S.objects = (map.interactables || []).map((it, i) => {
      const k = kindDef(it.kind);
      const o = { id: it.id, kind: it.kind, zone: it.zone || null, x: it.x, z: it.z, r: it.r || 1, state: 'idle', progress: 0, done: false, hits: 0, oi: i };
      if (k.trigger === 'dig') { o.count = it.count || k.count; o.dug = 0; o.dig = 0; o.big = 0; }
      if (k.trigger === 'trample') o.walked = 0;
      if (k.trigger === 'roll') o.stay = 0;
      if (it.kind === 'clothesline' || it.kind === 'fountain') { o.mudded = false; o.plazaWalk = 0; o.plaza = it.plaza || 0; }
      if (it.kind === 'pen_gate') { o.pen = it.pen || null; o.openedBy = null; if (it.open) { o.done = true; o.state = 'open'; o.progress = 1; } }
      return o;
    });
    // 清单只算本规则下可用、还没做的
    for (const o of S.objects) { o.listed = !o.done && mult(o.kind) > 0; if (o.listed && o.zone) zoneOf(o.zone).total++; }
    // 动物
    if (!test.noAnimals) {
      (sp.animals || []).forEach((g, gi) => {
        const def = FARM.CRITTERS[g.kind] || FARM.CRITTERS.pig;
        const grp = { id: g.id || `${g.kind}${gi}`, kind: g.kind, zone: g.zone || null, x: g.x, z: g.z, roam: g.roam || 2, pen: g.pen || null, poultry: !!def.poultry, done: false, scatterCd: 0, count: g.count || 1 };
        S.groups.push(grp);
        if (grp.poultry && grp.zone && mult('scatter') > 0) zoneOf(grp.zone).total++;
        for (let k = 0; k < (g.count || 1); k++) {
          const a = rnd() * TAU, rad = Math.sqrt(rnd()) * grp.roam * 0.6;
          const an = { id: `${grp.id}_${k}`, kind: g.kind, group: gi, x: g.x + Math.sin(a) * rad, z: g.z + Math.cos(a) * rad, heading: rnd() * TAU, action: 'idle', speed: 0,
            loose: false, scared: 0, fx: 0, fz: 0, jit: 0, tx: g.x, tz: g.z, waitT: rr(0, 2), tumbleT: 0, hitCd: 0, scoredHit: false, scoredLoose: false,
            stage: 0, hx: g.x, hz: g.z, roam: grp.roam, target: null, peckT: 0, windT: 0, chargeT: 0, cdx: 0, cdz: 0, localScareT: -99 };
          world.resolve(an, def.r, 'npc', gateOpenSafe);
          S.animals.push(an);
        }
      });
    }
    // 管理员
    const h = sp.keeper.home;
    S.keeper = { x: h.x, z: h.z, heading: 0, speed: 0, action: 'idle', anger: 0, state: 'patrol', target: null, active: !test.noKeeper,
      path: [], gx: 1e9, gz: 1e9, planT: 0, partial: false, patrolI: 0, waitT: 0, stateT: 0, lookT: 0, searchT: 0, carryT: 0, tossT: 0, stuckT: 0, dropX: 0, dropZ: 0, dropDx: 0, dropDz: 1, landX: 0, landZ: 0, landOk: false, giveUpT: 0,
      lastX: 0, lastZ: 0, unseenT: 99, knowsT: 0, sx: 0, sz: 0, lookBase: 0, sceneX: 0, sceneZ: 0, sceneAgain: false, noShoo: false, shoo: false, shooT: 0, shooLostT: 0, shooCd: 0, shooX: 1e9, shooZ: 1e9 };
    S.goose = { active: false, x: sp.goose ? sp.goose.x : 0, z: sp.goose ? sp.goose.z : 0, heading: 0, speed: 0, action: 'idle', cd: 0, path: [], planT: 0 };
    // 完成度的满分
    let pot = 0;
    for (const o of S.objects) { if (!o.listed) continue; const k = kindDef(o.kind); pot += (k.trigger === 'dig' ? k.points * o.count : k.points) * mult(o.kind); }
    for (const id in S.zones) if (S.zones[id].total > 0) pot += FARM.ZONE_BONUS;
    for (const g of S.groups) if (g.poultry) pot += FARM.EXTRA.scatter.points * mult('scatter');
    if (sp.exit) pot += FARM.ESCAPE_BONUS;
    S.fullScore = Math.max(1, pot * FARM.FULL_FRAC);
  }
  function gateOpenSafe(oi) { return S && S.objects[oi] ? S.objects[oi].done : false; }
  function mult(kind) { const m = S.rules.mischief || {}; return m[kind] !== undefined ? m[kind] : m['*'] !== undefined && !FARM.EXTRA[kind] ? m['*'] : 0; }
  function kindDef(kind) { return FARM.KINDS[kind] || DEFAULT_KIND; }

  // ---------------------------------------------------------------- 宠物
  function addPet(profile = {}, { owner = 'local' } = {}) {
    let id = profile.id || `pet${S.nextPet}`;
    while (S.pets.some((p) => p.id === id)) id = `${id}_${S.nextPet}`;
    S.nextPet++;
    const g = sp.gate, k = S.pets.length;
    const h = g.heading || 0;
    const p = { id, owner, name: profile.name || '', species: profile.species || 'shiba', appearance: profile.appearance || {},
      x: g.x + Math.cos(h) * (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.9, z: g.z - Math.sin(h) * (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.9,
      heading: h, speed: 0, spd: 0, action: 'idle', muddy: false, muddyT: 0, hidden: false, hideId: null, hideSeen: false, held: false, escaped: false,
      pounceT: 0, pounceCd: 0, pounceReq: 0, stunT: 0, slowT: 0, immuneT: 0, kvx: 0, kvz: 0, inWater: null, emote: null, emoteT: 0,
      fountain: null, dig: false, wallNx: 0, wallNz: 0, wallT: 0, wallR: 0, wallCx: 0, wallCz: 0, hit: [], hitObj: false, bonk: null, tossT: 0, tossX0: 0, tossZ0: 0, tossX1: 0, tossZ1: 0, air: 0, cmd: { moveTo: null, pounce: false, dig: false } };
    world.resolve(p, FARM.PET_R, 'pet', gateOpen);
    S.pets.push(p);
    return id;
  }
  function removePet(id) { const i = S.pets.findIndex((p) => p.id === id); if (i >= 0) S.pets.splice(i, 1); }
  const petById = (id) => S.pets.find((p) => p.id === id) || null;
  const localPet = () => S.pets.find((p) => p.owner === 'local') || null;

  function command(id, c = {}) {
    const p = petById(id);
    if (!p) return;
    const m = c.moveTo;
    p.cmd.moveTo = m && Number.isFinite(m.x) && Number.isFinite(m.z) ? { x: m.x, z: m.z } : null;
    p.cmd.dig = !!c.dig;
    if (c.pounce) p.pounceReq = FARM.POUNCE_BUFFER;
    if (c.emote) { p.emote = c.emote; p.emoteT = 2; ev('emote', { petId: id, id: c.emote }); }
    if (c.say) ev('say', { petId: id, text: String(c.say).slice(0, 40) });
  }

  function stepPet(p, dt) {
    const local = p.owner === 'local';
    p.emoteT = Math.max(0, p.emoteT - dt); if (p.emoteT <= 0) p.emote = null;
    if (p.held) { const K = S.keeper; p.x = K.x + Math.sin(K.heading) * 0.45; p.z = K.z + Math.cos(K.heading) * 0.45; p.heading = K.heading; p.speed = 0; p.spd = 0; p.action = 'held'; return; }
    if (p.escaped) { p.speed = 0; p.action = 'escaped'; return; }
    if (p.tossT > 0) { // 被扔出去：沿抛物线飞到落点（air = 离地高度，给画面用），落地打个滚
      p.tossT -= dt;
      const k = clamp(1 - p.tossT / FARM.TOSS_T, 0, 1), ux = p.tossX1 - p.tossX0, uz = p.tossZ1 - p.tossZ0, ul = Math.hypot(ux, uz) || 1;
      p.x = p.tossX0 + ux * k; p.z = p.tossZ0 + uz * k; p.air = Math.sin(Math.PI * k) * FARM.TOSS_H + (1 - k) * 0.8;
      p.speed = 0; p.spd = 0; p.dig = false; p.pounceT = 0; p.action = 'tossed';
      if (p.tossT <= 0) {
        p.tossT = 0; p.air = 0; p.stunT = FARM.TOSS_STUN; p.kvx = (ux / ul) * 2.5; p.kvz = (uz / ul) * 2.5;
        world.resolve(p, FARM.PET_R, 'pet', gateOpen);
        ev('landed', { petId: p.id, x: p.x, z: p.z });
      }
      return;
    }
    p.pounceCd = Math.max(0, p.pounceCd - dt); p.slowT = Math.max(0, p.slowT - dt); p.immuneT = Math.max(0, p.immuneT - dt);
    if (p.muddy) { p.muddyT -= dt; if (p.muddyT <= 0) { p.muddy = false; ev('dry', { petId: p.id }); } }
    const x0 = p.x, z0 = p.z;
    const q = world.waterAt(p.x, p.z);
    let m = q ? (q.deep ? FARM.SWIM_MULT : FARM.SHALLOW_MULT) : 1;
    if (p.slowT > 0) m *= FARM.SLOW_MULT;
    let dig = false;
    if (p.stunT > 0) {
      p.stunT -= dt;
      p.x += p.kvx * dt; p.z += p.kvz * dt;
      const f = Math.max(0, 1 - 5 * dt); p.kvx *= f; p.kvz *= f;
      p.spd = 0; p.pounceT = 0; p.action = 'stunned';
    } else {
      const mt = p.cmd.moveTo;
      if (p.pounceReq > 0) {
        p.pounceReq -= dt;
        if (p.pounceCd <= 0 && !(q && q.deep) && S.phase !== 'intro') {
          if (mt) { const dx = mt.x - p.x, dz = mt.z - p.z; if (Math.hypot(dx, dz) > 0.3) p.heading = Math.atan2(dx, dz); }
          p.pounceT = FARM.POUNCE_DUR; p.pounceCd = FARM.POUNCE_CD; p.pounceReq = 0; p.hit.length = 0; p.hitObj = false;
          ev('pounce', { petId: p.id, x: p.x, z: p.z });
        }
      }
      if (p.pounceT > 0) {
        p.pounceT -= dt;
        p.spd = FARM.POUNCE_SPEED;
        p.action = 'pounce';
        if (p.pounceT <= 0) p.spd = Math.min(p.spd, FARM.DOG_SPEED);
      } else if (p.cmd.dig && !q) {
        dig = true;
        p.spd = Math.max(0, p.spd - FARM.DECEL * 2 * dt);
        p.action = 'dig';
      } else {
        let tSpeed = 0;
        if (mt) {
          let dx = mt.x - p.x, dz = mt.z - p.z;
          // 贴着墙、目标在墙后面：改为朝“目标在墙面上的投影”跑（沿墙滑过去，滑到最近处停下）
          if (p.wallT > 0 && world.blocked(p.x - p.wallNx * 0.06, p.z - p.wallNz * 0.06, FARM.PET_R, 'pet', gateOpen)) {
            const dn = dx * p.wallNx + dz * p.wallNz;
            if (dn < 0) {
              const D = Math.hypot(dx, dz);
              dx -= dn * p.wallNx; dz -= dn * p.wallNz;
              // 圆的障碍（树干、柱子、石头）：目标在它正后方时绕过去，而不是停在背面
              // （目标就在障碍里面时，绕到离目标最近的那一面停下）
              if (p.wallR > 0) {
                const wx = mt.x - p.wallCx, wz = mt.z - p.wallCz, wl = Math.hypot(wx, wz) || 1;
                if ((wx * p.wallNx + wz * p.wallNz) / wl < 0.98) {
                  let tx = -p.wallNz, tz = p.wallNx;
                  if (tx * wx + tz * wz < 0) { tx = -tx; tz = -tz; }
                  const L = Math.max(D, 1);
                  dx = tx * L; dz = tz * L;
                }
              }
            }
          } else p.wallT = 0;
          const d = Math.hypot(dx, dz);
          if (d > FARM.STOP_DIST) {
            tSpeed = FARM.DOG_SPEED * clamp((d - FARM.STOP_DIST) / FARM.FULL_DIST, 0, 1);
            const err = wrap(Math.atan2(dx, dz) - p.heading);
            const maxTurn = FARM.TURN_RATE * dt * (p.spd < 1.5 ? 2 : 1);
            p.heading = wrap(p.heading + clamp(err, -maxTurn, maxTurn));
            tSpeed *= clamp(1.3 - Math.abs(err) / 1.4, 0.15, 1);
            // 离目标很近时别冲过头：一步走不超过剩下的距离
            tSpeed = Math.min(tSpeed, d / dt);
          }
        }
        p.spd += clamp(tSpeed - p.spd, -FARM.DECEL * dt, FARM.ACCEL * dt);
        p.action = q && q.deep ? 'swim' : p.spd > 3.2 ? 'run' : p.spd > 0.2 ? 'walk' : 'idle';
      }
      p.x += Math.sin(p.heading) * p.spd * m * dt;
      p.z += Math.cos(p.heading) * p.spd * m * dt;
    }
    const res = world.resolve(p, FARM.PET_R, 'pet', gateOpen);
    // 推不出来（比如挤进比身子还窄的缝）：退回这一步之前的位置
    if (res.hit && world.penAt(p.x, p.z, FARM.PET_R, 'pet', gateOpen) > 0.005) { p.x = x0; p.z = z0; }
    if (res.hit) {
      p.wallNx = res.nx; p.wallNz = res.nz; p.wallT = 0.5;
      if (res.hit.shape === 'circle') { p.wallR = res.hit.r; p.wallCx = res.hit.x; p.wallCz = res.hit.z; } else p.wallR = 0;
    } else p.wallT = Math.max(0, p.wallT - dt);
    if (res.hit && p.pounceT > 0 && !res.hit.gate) {
      const dot = Math.sin(p.heading) * res.nx + Math.cos(p.heading) * res.nz;
      // 一头撞上了东西：先记下，等物件判定跑完再定（settleBonk）——撞的是要捣乱的东西就不算撞墙
      if (dot < -0.6) p.bonk = { nx: res.nx, nz: res.nz, cx: res.hit.x, cz: res.hit.z };
    }
    p.speed = Math.hypot(p.x - x0, p.z - z0) / dt;
    if (p.stunT <= 0 && p.pounceT <= 0 && !dig && p.speed < 0.05 && p.spd > 0.5 && res.hit) p.spd *= 0.5; // 顶着墙：别一直蓄着速度
    p.dig = dig;
    // 水
    const q2 = world.waterAt(p.x, p.z);
    if (q2 && !p.inWater) {
      ev('splash', { petId: p.id, x: p.x, z: p.z, water: q2.id });
      if (p.muddy) { p.muddy = false; ev('wash', { petId: p.id }); }
    }
    p.inWater = q2 ? q2.id : null;
    // 躲藏
    const h = p.pounceT > 0 ? null : world.hideAt(p.x, p.z);
    if (h && !p.hidden) {
      const seen = local && S.keeper.active && canSee(p, true);
      p.hidden = true; p.hideId = h.id; p.hideSeen = seen;
      ev('hide', { petId: p.id, hide: h.id, seen });
    } else if (!h && p.hidden) { p.hidden = false; p.hideId = null; p.hideSeen = false; ev('unhide', { petId: p.id }); }
    // 出口
    if (local && S.phase === 'wanted' && sp.exit && Math.hypot(p.x - sp.exit.x, p.z - sp.exit.z) < sp.exit.r) {
      p.escaped = true; S.escaped = true;
      S.score += FARM.ESCAPE_BONUS;
      ev('escaped', { petId: p.id, points: FARM.ESCAPE_BONUS });
      finish('escaped');
    }
  }

  // ---------------------------------------------------------------- 捣乱与计分
  function award(p, kind, base, x, z, objectId, noise, anger, ruleKind = kind) {
    const pts = Math.round(base * mult(ruleKind));
    S.score += pts;
    S.mischief[kind] = (S.mischief[kind] || 0) + 1;
    ev('mischief', { kind, objectId, points: pts, x, z, petId: p.id });
    keeperNotice(p, x, z, noise, anger);
  }
  function markDone(o) {
    if (o.done) return;
    o.done = true; o.state = o.kind === 'pen_gate' ? 'open' : 'done'; o.progress = 1;
    if (o.listed) zoneTick(o.zone);
  }
  function zoneTick(zid) {
    const zn = zid && S.zones[zid];
    if (!zn) return;
    zn.done++;
    if (!zn.cleared && zn.done >= zn.total) {
      zn.cleared = true; S.zonesCleared++; S.score += FARM.ZONE_BONUS;
      ev('zoneCleared', { zone: zid, bonus: FARM.ZONE_BONUS });
    }
  }
  function mudPrint(p, o) {
    o.mudded = true;
    const e = FARM.EXTRA.mud_print;
    award(p, 'mud_print', e.points, p.x, p.z, o.id, e.noise, e.anger);
  }

  /** 扑的时候撞上了障碍：这一扑撞到过要捣乱的东西 → 只是停下；否则眩晕并弹开 */
  function settleBonk(p) {
    const b = p.bonk; if (!b) return;
    p.bonk = null; p.pounceT = 0; p.spd = 0;
    if (p.hitObj || p.held || p.escaped) return;
    p.stunT = FARM.BONK_STUN; p.kvx = b.nx * 1.5; p.kvz = b.nz * 1.5; ev('bonk', { petId: p.id, x: p.x, z: p.z });
  }

  function stepObjects(p, dt) {
    if (!p || p.held || p.escaped || p.owner !== 'local') return;
    for (const o of S.objects) {
      const k = kindDef(o.kind);
      const avail = mult(o.kind) > 0;
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      if (k.trigger === 'dig') {
        const digging = avail && p.dig && d < o.r + 0.2 && o.dug < o.count;
        if (digging) {
          o.dig += dt; o.state = 'digging'; o.progress = (o.dug + Math.min(1, o.dig / k.digTime)) / o.count;
          if (o.dig >= k.bigTime) popRadish(p, o, k, true);
        } else if (o.dig >= k.digTime) popRadish(p, o, k, false);
        else if (o.state === 'digging') o.state = o.dug ? 'dug' : 'idle';
        continue;
      }
      if (d > o.r + 3) continue;
      if (!avail) continue;
      if (k.trigger === 'pounce') {
        let reach;
        if (o.kind === 'pen_gate') { const g = world.gates.find((gg) => gg.oi === o.oi); reach = g ? penetrate(g, p.x, p.z, FARM.PET_R + FARM.POUNCE_REACH + 0.1) > 0 : d < o.r + FARM.PET_R; }
        else reach = d < o.r + FARM.PET_R + FARM.POUNCE_REACH
          // 这一步正好撞在它的碰撞体上（方的东西从侧面撞，离中心比较远）：也算撞到
          || (!!p.bonk && Math.hypot(p.bonk.cx - o.x, p.bonk.cz - o.z) < o.r + 0.6 && d < o.r + FARM.PET_R + 1.2);
        if (!o.done && p.pounceT > 0 && reach && !p.hit.includes(o.id)) {
          p.hit.push(o.id); p.hitObj = true;
          o.hits++; o.progress = o.hits / k.hits; o.state = 'hit';
          ev('bump', { objectId: o.id, petId: p.id });
          if (o.hits >= k.hits) {
            markDone(o);
            award(p, o.kind, k.points, o.x, o.z, o.id, k.noise, k.anger);
            if (o.kind === 'clothesline' && p.muddy) mudPrint(p, o);
            if (o.kind === 'pen_gate') openGate(p, o);
          } else keeperNotice(p, o.x, o.z, k.noise * 0.6, k.anger * 0.3);
        } else if (o.kind === 'clothesline' && o.done && p.muddy && !o.mudded && d < o.r + FARM.PET_R && mult('mud_print') > 0) mudPrint(p, o);
      } else if (k.trigger === 'trample') {
        if (!o.done && d < o.r + 0.1 && p.speed > 1) {
          o.walked += p.speed * dt; o.progress = Math.min(1, o.walked / k.need); o.state = 'trampling';
          if (o.walked >= k.need) { markDone(o); award(p, o.kind, k.points, o.x, o.z, o.id, k.noise, k.anger); }
        }
      } else if (k.trigger === 'roll') {
        if (d < o.r) {
          o.stay += dt;
          if (!o.done) o.progress = Math.min(1, o.stay / k.need);
          if (o.stay >= k.need && !p.muddy) {
            p.muddy = true; p.muddyT = FARM.MUD_TIME; p.action = 'roll';
            ev('muddy', { petId: p.id });
            if (!o.done) { markDone(o); award(p, o.kind, k.points, o.x, o.z, o.id, k.noise, k.anger); }
          }
        } else o.stay = 0;
      } else if (k.trigger === 'splash') {
        if (d < o.r) {
          if (!o.done) { markDone(o); award(p, o.kind, k.points, o.x, o.z, o.id, k.noise, k.anger); }
          if (p.muddy) { p.muddy = false; ev('wash', { petId: p.id, objectId: o.id }); }
          if (p.fountain !== o.id) { p.fountain = o.id; ev('splash', { petId: p.id, x: o.x, z: o.z, water: o.id }); }
        } else if (p.fountain === o.id) p.fountain = null;
        if (d >= o.r && o.plaza && p.muddy && !o.mudded && d < o.plaza && p.speed > 1 && mult('mud_print') > 0) {
          o.plazaWalk += p.speed * dt;
          if (o.plazaWalk >= FARM.MUD_PRINT_DIST) mudPrint(p, o);
        }
      }
    }
  }
  function popRadish(p, o, k, big) {
    o.dug++; o.dig = 0; o.progress = o.dug / o.count; o.state = o.dug >= o.count ? 'done' : 'dug';
    if (big) { o.big++; award(p, 'big_radish', k.bigPoints, o.x, o.z, o.id, k.noise * 1.2, k.anger * 1.5, 'radish_bed'); }
    else award(p, 'radish_bed', k.points, o.x, o.z, o.id, k.noise, k.anger);
    if (o.dug >= o.count) markDone(o);
  }
  function openGate(p, o) {
    o.openedBy = p.id;
    let n = 0;
    for (const a of S.animals) {
      const g = S.groups[a.group];
      if (g.pen && g.pen === o.pen && !a.loose) { a.loose = true; a.stage = 0; a.scared = 0; n++; }
    }
    ev('loose', { pen: o.pen, count: n, objectId: o.id });
  }

  // ---------------------------------------------------------------- 动物
  function stepAnimals(dt) {
    const roost = (def) => S.rules.animals[def.cat] === 'roost';
    for (const a of S.animals) {
      const def = FARM.CRITTERS[a.kind] || FARM.CRITTERS.pig;
      const grp = S.groups[a.group];
      a.hitCd = Math.max(0, a.hitCd - dt);
      // 最近的宠物
      let near = null, nd = 1e9;
      for (const p of S.pets) { if (p.held || p.escaped || p.hidden) continue; const d = Math.hypot(p.x - a.x, p.z - a.z); if (d < nd) { nd = d; near = p; } }
      const sleeping = roost(def) && a.scared <= 0 && !a.loose;
      // 被扑中
      if (near && near.pounceT > 0 && nd < def.r + FARM.PET_R + FARM.POUNCE_REACH && !near.hit.includes(a.id)) {
        near.hit.push(a.id);
        a.tumbleT = 0.5; a.scared = rr(...FARM.SCARED_T); a.fx = near.x; a.fz = near.z; a.jit = rr(-0.6, 0.6);
        if (near.owner === 'local') {
          a.localScareT = S.time;
          if (def.poultry && !a.scoredHit && mult('pounce_bird') > 0) { a.scoredHit = true; const e = FARM.EXTRA.pounce_bird; award(near, 'pounce_bird', e.points, a.x, a.z, a.id, e.noise, e.anger); }
          else if (a.kind === 'bull') provokeBull(a, near);
          else if (!def.poultry && !a.scoredHit && mult('spook') > 0) { a.scoredHit = true; const e = FARM.EXTRA.spook; award(near, 'spook', e.points, a.x, a.z, a.id, e.noise, e.anger); }
          if (a.kind === 'hen' && rnd() < FARM.HEN_PECK_CHANCE) { a.peckT = FARM.HEN_CHASE_T; a.target = near.id; }
        }
      } else if (near && nd < def.fleeR && (near.speed > 1.2 || near.pounceT > 0) && a.windT <= 0 && a.chargeT <= 0 && a.peckT <= 0) {
        if (a.scared <= 0.3) { a.jit = rr(-0.6, 0.6); }
        a.scared = Math.max(a.scared, rr(...FARM.SCARED_T)); a.fx = near.x; a.fz = near.z;
        if (near.owner === 'local') a.localScareT = S.time;
        if (a.kind === 'bull' && near.owner === 'local' && nd < FARM.BULL_PROVOKE_R && near.speed > 3) provokeBull(a, near);
      }
      // 行为
      let vx = 0, vz = 0, spd = 0;
      const ph = a.heading;
      if (a.tumbleT > 0) { a.tumbleT -= dt; a.action = 'tumble'; }
      else if (a.windT > 0) {
        a.windT -= dt; a.action = 'paw';
        const tp = petById(a.target);
        if (tp) a.heading = Math.atan2(tp.x - a.x, tp.z - a.z);
        if (a.windT <= 0) { a.chargeT = FARM.BULL_CHARGE_T; a.cdx = Math.sin(a.heading); a.cdz = Math.cos(a.heading); ev('charge', { id: a.id }); }
      } else if (a.chargeT > 0) {
        a.chargeT -= dt; a.action = 'charge'; vx = a.cdx; vz = a.cdz; spd = FARM.BULL_SPEED;
        for (const p of S.pets) {
          if (p.held || p.escaped || p.stunT > 0) continue;
          if (Math.hypot(p.x - a.x, p.z - a.z) < def.r + FARM.PET_R + 0.1) {
            p.stunT = FARM.KNOCK_STUN; p.kvx = a.cdx * FARM.KNOCK_SPEED; p.kvz = a.cdz * FARM.KNOCK_SPEED; p.pounceT = 0; p.spd = 0;
            ev('knocked', { petId: p.id, by: a.id }); a.chargeT = 0;
          }
        }
      } else if (a.peckT > 0) {
        a.peckT -= dt; a.action = 'peck';
        const tp = petById(a.target);
        if (!tp || tp.held || tp.escaped) a.peckT = 0;
        else {
          const dx = tp.x - a.x, dz = tp.z - a.z, d = Math.hypot(dx, dz);
          if (d < def.r + FARM.PET_R + 0.15) { tp.slowT = Math.max(tp.slowT, FARM.HEN_SLOW); a.peckT = 0; a.scared = 0.6; a.fx = tp.x; a.fz = tp.z; ev('peck', { petId: tp.id, by: a.id }); }
          else { vx = dx / d; vz = dz / d; spd = FARM.HEN_CHASE_SPEED; }
        }
      } else if (a.loose && a.stage < 2 && grp.pen) {
        // 圈门开了：先走到门口，再走到门外
        const gate = S.objects.find((o) => o.kind === 'pen_gate' && o.pen === grp.pen);
        const it = gate && map.interactables[gate.oi];
        const out = it && it.out ? it.out : gate ? [gate.x + (gate.x - grp.x) * 0.6, gate.z + (gate.z - grp.z) * 0.6] : [a.x, a.z];
        const tx = a.stage === 0 && gate ? gate.x : out[0], tz = a.stage === 0 && gate ? gate.z : out[1];
        const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
        if (d < (a.stage === 0 ? 0.7 : 0.9)) {
          a.stage++;
          if (a.stage === 2) {
            a.hx = out[0]; a.hz = out[1]; a.roam = FARM.LOOSE_ROAM; a.tx = a.x; a.tz = a.z; a.waitT = 0;
            if (!a.scoredLoose && gate && gate.openedBy) {
              a.scoredLoose = true;
              const p = petById(gate.openedBy);
              if (p && p.owner === 'local' && mult('loose') > 0) { const e = FARM.EXTRA.loose; award(p, 'loose', e.points, a.x, a.z, a.id, e.noise, e.anger); }
            }
          }
        } else { vx = dx / d; vz = dz / d; spd = def.flee * 0.7; a.action = 'run'; }
      } else if (a.scared > 0) {
        a.scared -= dt; a.action = 'flee';
        let dx = a.x - a.fx, dz = a.z - a.fz;
        let d = Math.hypot(dx, dz) || 1;
        dx /= d; dz /= d;
        // 群体分散：再加一点“离群中心远一点”
        let cx = 0, cz = 0, n = 0;
        for (const b of S.animals) if (b.group === a.group && b !== a) { cx += b.x; cz += b.z; n++; }
        if (n) { cx = a.x - cx / n; cz = a.z - cz / n; const cd = Math.hypot(cx, cz) || 1; dx += (cx / cd) * 0.6; dz += (cz / cd) * 0.6; }
        const c = Math.cos(a.jit), s = Math.sin(a.jit);
        let ex = dx * c + dz * s, ez = -dx * s + dz * c;
        // 别跑出自己的范围太远
        const hd = Math.hypot(a.hx - a.x, a.hz - a.z), lim = a.roam + (grp.pen && !a.loose ? 0.5 : 4);
        if (hd > lim) { ex += ((a.hx - a.x) / hd) * 1.5; ez += ((a.hz - a.z) / hd) * 1.5; }
        d = Math.hypot(ex, ez) || 1;
        vx = ex / d; vz = ez / d; spd = def.flee;
      } else if (sleeping) { a.action = 'sleep'; }
      else {
        // 闲逛
        if (a.waitT > 0) { a.waitT -= dt; a.action = 'idle'; }
        else {
          const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
          if (d < 0.2) {
            a.waitT = rr(0.8, 3);
            const an = rnd() * TAU, rad = Math.sqrt(rnd()) * a.roam;
            a.tx = a.hx + Math.sin(an) * rad; a.tz = a.hz + Math.cos(an) * rad;
          } else { vx = dx / d; vz = dz / d; spd = def.walk; a.action = 'walk'; }
        }
      }
      if (spd > 0) {
        const ox = a.x, oz = a.z;
        a.x += vx * spd * dt; a.z += vz * spd * dt;
        if (world.deepAt(a.x, a.z) && a.kind !== 'duck') { a.x = ox; a.z = oz; if (a.action === 'walk') a.waitT = 0.3, a.tx = a.x, a.tz = a.z; }
        const res = world.resolve(a, def.r, 'npc', gateOpen);
        if (res.hit && a.chargeT > 0) { a.chargeT = 0; a.tumbleT = 0.6; }
        if (res.hit && a.action === 'walk' && Math.hypot(a.x - ox, a.z - oz) < spd * dt * 0.3) { a.tx = a.x; a.tz = a.z; }
        a.heading = Math.atan2(vx, vz);
      } else a.heading = ph;
      a.speed = spd;
    }
    // 同一群里互相推开
    for (let i = 0; i < S.animals.length; i++) {
      const a = S.animals[i], ra = (FARM.CRITTERS[a.kind] || FARM.CRITTERS.pig).r;
      for (let j = i + 1; j < S.animals.length; j++) {
        const b = S.animals[j];
        if (b.group !== a.group) continue;
        const rb = (FARM.CRITTERS[b.kind] || FARM.CRITTERS.pig).r;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), m = ra + rb;
        if (d < m && d > 1e-6) { const k = (m - d) / 2 / d; a.x -= dx * k; a.z -= dz * k; b.x += dx * k; b.z += dz * k; world.resolve(a, ra, 'npc', gateOpen); world.resolve(b, rb, 'npc', gateOpen); }
      }
    }
    // 鸡群 / 鸭群被冲散
    const lp = localPet();
    for (const g of S.groups) {
      g.scatterCd = Math.max(0, g.scatterCd - dt);
      if (!g.poultry || !lp || g.scatterCd > 0) continue;
      let n = 0, cx = 0, cz = 0, tot = 0;
      for (const a of S.animals) if (S.groups[a.group] === g) { tot++; cx += a.x; cz += a.z; if (S.time - a.localScareT < 1.0) n++; }
      if (tot && n >= Math.ceil(tot / 2) && mult('scatter') > 0) {
        const e = FARM.EXTRA.scatter;
        award(lp, 'scatter', g.done ? e.repeat : e.points, cx / tot, cz / tot, g.id, e.noise, e.anger);
        if (!g.done) { g.done = true; zoneTick(g.zone); }
        g.scatterCd = e.cd;
      }
    }
  }
  function provokeBull(a, p) {
    if (a.windT > 0 || a.chargeT > 0) return;
    a.windT = FARM.BULL_WIND; a.target = p.id; a.scared = 0;
    if (!a.scoredHit && mult('bull') > 0) { a.scoredHit = true; const e = FARM.EXTRA.bull; award(p, 'bull', e.points, a.x, a.z, a.id, e.noise, e.anger); }
  }

  // ---------------------------------------------------------------- 管理员
  function keeperSeesPoint(x, z) {
    const K = S.keeper, kr = S.rules.keeper;
    if (!K.active || !kr.awake) return false;
    const dx = x - K.x, dz = z - K.z, d = Math.hypot(dx, dz);
    if (d > kr.visionRange) return false;
    if (d > FARM.NEAR_SENSE && Math.abs(wrap(Math.atan2(dx, dz) - K.heading)) > (kr.visionAngle * DEG) / 2) return false;
    return !world.sightBlocked(K.x, K.z, x, z);
  }
  /** 管理员现在能不能看见这只宠物（躲起来且她没看着进去 → 看不见） */
  function canSee(p, ignoreHide = false) {
    if (!p || p.held || p.escaped) return false;
    if (!ignoreHide && p.hidden && !p.hideSeen) return false;
    return keeperSeesPoint(p.x, p.z);
  }
  function setKState(st) {
    const K = S.keeper;
    if (K.state === st) return;
    if (K.state === 'chase' && st !== 'carry') ev('chaseEnd', { reason: st });
    K.state = st; K.stateT = 0; K.path = []; K.gx = 1e9; K.gz = 1e9; K.giveUpT = 0; K.looking = false; K.waitT = 0;
    if (st === 'chase') {
      K.target = localPet() ? localPet().id : null;
      // 先驱赶（shoo）；火气满了 / 通缉阶段 / 刚赶走又回原地捣乱（noShoo）→ 直接抓
      const again = K.noShoo; K.noShoo = false;
      K.shoo = !again && K.anger < FARM.ANGER_FULL && S.phase !== 'wanted';
      K.shooT = 0; K.shooLostT = 0;
      ev('chaseStart', { x: K.x, z: K.z, shoo: K.shoo });
      if (again) ev('shooFail', { reason: 'back' });
    }
    else if (st !== 'carry') K.target = null;
  }
  /** 驱赶无效：改成抓 */
  function failShoo(reason) { const K = S.keeper; if (!K.shoo) return; K.shoo = false; ev('shooFail', { reason }); }
  /** 驱赶有效（小狗离开现场 / 不见了）：记下刚赶过的地方，回去巡逻 */
  function endShoo() {
    const K = S.keeper;
    K.anger = Math.min(1, K.anger + FARM.SHOO_ANGER); K.shooCd = FARM.SHOO_CD; K.shooX = K.sceneX; K.shooZ = K.sceneZ;
    ev('shooed', { x: K.x, z: K.z, anger: K.anger });
    setKState('return');
  }
  /**
   * 小狗捣乱了（在 (x, z)）。流程：不管她在哪儿，先赶到现场 → 小狗还在就驱赶 → 驱赶无效才抓（拎到最近的路上）→ 小狗不在就回去巡逻。
   * 亲眼看见的等于已经在现场：直接开始驱赶。正在驱赶时小狗当着她的面又捣乱 = 驱赶无效。
   */
  function keeperNotice(p, x, z, noise, anger) {
    const K = S.keeper, kr = S.rules.keeper;
    if (!K.active || !kr.awake || p.owner !== 'local' || K.state === 'carry' || S.finished) return;
    const sees = canSee(p), near = Math.hypot(K.x - x, K.z - z) <= noise * (kr.hearing ?? 1);
    K.anger = Math.min(1, K.anger + anger * (sees ? FARM.ANGER_SEE : near ? FARM.ANGER_HEAR : FARM.ANGER_FAR));
    const again = K.shooCd > 0 && Math.hypot(x - K.shooX, z - K.shooZ) < FARM.AGAIN_R; // 刚被赶走又回原地
    if (K.state === 'chase') {
      if (sees) { K.lastX = p.x; K.lastZ = p.z; K.unseenT = 0; }
      if (K.shoo) { K.sceneX = x; K.sceneZ = z; if (sees || again) failShoo('again'); }
      return;
    }
    if (!sees && !near && kr.respondAll === false) return; // 规则表可以关掉“远处的也去”（比如夜里犯困）；默认都去
    K.sceneX = x; K.sceneZ = z; K.sceneAgain = again;
    if (sees && p.immuneT <= 0) { K.lastX = p.x; K.lastZ = p.z; K.unseenT = 0; K.noShoo = again; setKState('chase'); return; }
    if (K.state !== 'suspicious') { setKState('suspicious'); ev('alert', { x, z, anger: K.anger, far: !near }); }
    K.looking = false; K.lookT = FARM.LOOK_T; K.path = []; K.gx = 1e9;
  }
  /** 沿寻路走向 (x, z)；返回是否已到达 */
  function keeperGo(x, z, speed, dt, replan = 0) {
    const K = S.keeper, nav = world.nav('keeper');
    K.planT -= dt;
    const moved = Math.hypot(x - K.gx, z - K.gz);
    if (moved > (replan > 0 ? 2.5 : 0.6) || (moved > 0.1 && (K.planT <= 0 || !K.path.length) && replan > 0)) {
      const path = nav.plan(K.x, K.z, x, z, gateOpen);
      K.path = path ? path.slice() : []; K.partial = path ? !!path.partial : true;
      K.gx = x; K.gz = z; K.planT = replan;
    }
    let remain = speed * dt, mvx = 0, mvz = 0;
    const ox = K.x, oz = K.z;
    while (remain > 1e-6 && K.path.length) {
      const [wx, wz] = K.path[0];
      const dx = wx - K.x, dz = wz - K.z, d = Math.hypot(dx, dz);
      if (d <= remain) { K.x = wx; K.z = wz; remain -= d; K.path.shift(); }
      else { K.x += (dx / d) * remain; K.z += (dz / d) * remain; remain = 0; }
    }
    mvx = K.x - ox; mvz = K.z - oz;
    world.resolve(K, FARM.KEEPER_R, 'npc', gateOpen); // 开着的圈门不挡她（和寻路一致）
    if (world.deepAt(K.x, K.z)) { K.x = ox; K.z = oz; }
    const mv = Math.hypot(mvx, mvz);
    K.speed = mv / dt;
    if (mv > 1e-4) turnKeeper(Math.atan2(mvx, mvz), dt);
    return !K.path.length;
  }
  /** 管理员从 a 直线走到 b 会不会撞墙 / 钻洞（沿途采样） */
  function clearForKeeper(xa, za, xb, zb) {
    const d = Math.hypot(xb - xa, zb - za), n = Math.max(1, Math.ceil(d / 0.2));
    for (let k = 1; k <= n; k++) { const u = k / n; if (world.blocked(xa + (xb - xa) * u, za + (zb - za) * u, FARM.KEEPER_R * 0.9, 'npc', gateOpen)) return false; }
    return true;
  }
  function turnKeeper(h, dt) { const K = S.keeper; const e = wrap(h - K.heading), m = FARM.KEEPER_TURN * dt; K.heading = wrap(K.heading + clamp(e, -m, m)); }
  function look(dt) { const K = S.keeper; K.speed = 0; K.action = 'look'; K.heading = wrap(K.lookBase + Math.sin(K.stateT * 1.6) * 1.3); }
  function nearestPatrol() {
    const K = S.keeper; let bi = 0, bd = 1e9;
    patrolPts.forEach((pt, i) => { const d = Math.hypot(pt[0] - K.x, pt[1] - K.z); if (d < bd) { bd = d; bi = i; } });
    return bi;
  }
  function pickSearchPoint() {
    const K = S.keeper, nav = world.nav('keeper');
    for (let k = 0; k < 8; k++) {
      const a = rnd() * TAU, r = rr(1, FARM.SEARCH_R);
      const x = K.lastX + Math.sin(a) * r, z = K.lastZ + Math.cos(a) * r;
      if (nav.freeAt(x, z, gateOpen)) { K.sx = x; K.sz = z; return; }
    }
    K.sx = K.lastX; K.sz = K.lastZ;
  }
  function stepKeeper(dt) {
    const K = S.keeper, kr = S.rules.keeper;
    if (!K.active) return;
    K.stateT += dt;
    if (!kr.awake) { K.action = 'sleep'; K.speed = 0; return; }
    if (K.state !== 'chase') K.anger = Math.max(0, K.anger - FARM.ANGER_DECAY * dt);
    K.shooCd = Math.max(0, (K.shooCd || 0) - dt);
    const p = localPet();
    K.knowsT = Math.max(0, K.knowsT - dt);
    const vis = canSee(p);
    const know = vis || (K.knowsT > 0 && p && !p.held && !p.escaped);
    if (know) { K.lastX = p.x; K.lastZ = p.z; K.unseenT = 0; } else K.unseenT += dt;
    const wanted = S.phase === 'wanted';
    switch (K.state) {
      case 'patrol': {
        if (vis && p.immuneT <= 0 && K.anger >= FARM.ANGER_FULL) { setKState('chase'); break; }
        if (K.waitT > 0) { K.waitT -= dt; K.speed = 0; K.action = 'idle'; break; }
        const pt = patrolPts[K.patrolI % patrolPts.length];
        K.action = 'walk';
        if (keeperGo(pt[0], pt[1], FARM.WALK_SPEED, dt)) { K.patrolI = (K.patrolI + 1) % patrolPts.length; K.waitT = FARM.PATROL_WAIT; }
        break;
      }
      case 'suspicious': { // 赶往出事地点
        // 小狗还在现场（被她看见）→ 驱赶
        if (vis && p.immuneT <= 0 && Math.hypot(p.x - K.sceneX, p.z - K.sceneZ) < FARM.SCENE_R) { K.noShoo = !!K.sceneAgain; setKState('chase'); break; }
        if (vis && p.immuneT <= 0 && (K.anger >= FARM.ANGER_FULL || wanted)) { setKState('chase'); break; }
        if (!K.looking) {
          if (K.stateT < FARM.REACT_T) { K.speed = 0; K.action = 'look'; turnKeeper(Math.atan2(K.sceneX - K.x, K.sceneZ - K.z), dt * 0.6); break; }
          K.action = 'run';
          const arrived = keeperGo(K.sceneX, K.sceneZ, FARM.SUSPECT_SPEED, dt);
          if (arrived || Math.hypot(K.sceneX - K.x, K.sceneZ - K.z) < 1.2 || K.stateT > 25) { K.looking = true; K.lookBase = K.heading; K.stateT = 0; }
        } else { // 到了，没看见小狗：张望一下，回去巡逻
          K.lookT -= dt; look(dt);
          if (K.lookT <= 0) setKState('return');
        }
        break;
      }
      case 'chase': {
        if (!p || p.held || p.escaped) { setKState('return'); break; }
        let aware = know; // 驱赶时：知不知道小狗在哪儿（见下）
        if (K.shoo) { // 驱赶：冲着小狗去，但不抓
          if (K.anger >= FARM.ANGER_FULL || wanted) failShoo('angry');
          else {
            const dk = Math.hypot(p.x - K.x, p.z - K.z), ds = Math.hypot(p.x - K.sceneX, p.z - K.sceneZ);
            // 她是冲着现场的小狗来的：绕篱笆、找门的时候眼睛没盯着也知道它还在那儿——除非它躲起来了（她没看着进去）或者离开了现场
            aware = know || (!(p.hidden && !p.hideSeen) && ds <= FARM.SCENE_R + 1.5);
            if (aware && !know) { K.lastX = p.x; K.lastZ = p.z; }
            K.shooLostT = aware ? 0 : K.shooLostT + dt;
            // 有效：小狗离开现场了（或者躲起来 / 跑没影了）→ 回去巡逻
            if (K.shooLostT > FARM.SHOO_HIDE_T || (know && ds > FARM.SCENE_R + 1.5 && dk > 3)) { endShoo(); break; }
            // 无效：她到跟前以后小狗还赖着不走
            if (aware && dk < FARM.SHOO_NEAR) K.shooT += dt;
            if (K.shooT > FARM.SHOO_T || K.stateT > FARM.SHOO_T + 14) failShoo('stay');
          }
        }
        if (!K.shoo && know && p.immuneT <= 0 && Math.hypot(p.x - K.x, p.z - K.z) < FARM.CATCH_R) { catchPet(p); break; }
        if (!K.shoo && !know && K.unseenT > FARM.LOSE_T) { ev('lost', { x: K.lastX, z: K.lastZ }); setKState('search'); K.searchT = FARM.SEARCH_T; pickSearchPoint(); break; }
        const speed = kr.speed * (wanted ? FARM.WANTED_SPEED : 1) * (K.shoo ? 0.9 : 1);
        K.action = 'run';
        const d = Math.hypot(p.x - K.x, p.z - K.z);
        if (K.shoo && aware && d < 1.1) { // 驱赶：到跟前就站住，冲着小狗挥手（不贴上去、不抓）
          K.speed = 0; K.action = 'shoo'; K.path = []; K.gx = 1e9;
          if (d > 1e-3) turnKeeper(Math.atan2(p.x - K.x, p.z - K.z), dt);
          break;
        }
        if (know && d < 1.6 && !world.deepAt(p.x, p.z) && clearForKeeper(K.x, K.z, p.x, p.z)) {
          // 贴身：直接扑过去（仍然推出碰撞体、不下深水）
          const ox = K.x, oz = K.z, st = Math.min(d, speed * dt);
          K.x += ((p.x - K.x) / d) * st; K.z += ((p.z - K.z) / d) * st;
          world.resolve(K, FARM.KEEPER_R, 'npc', gateOpen); // 开着的圈门不挡她（和寻路一致）
          if (world.deepAt(K.x, K.z)) { K.x = ox; K.z = oz; }
          K.speed = Math.hypot(K.x - ox, K.z - oz) / dt; turnKeeper(Math.atan2(p.x - ox, p.z - oz), dt);
          K.path = []; K.gx = 1e9;
          if (!K.shoo && Math.hypot(p.x - K.x, p.z - K.z) < FARM.CATCH_R && p.immuneT <= 0) catchPet(p);
          break;
        }
        const arrived = keeperGo(K.lastX, K.lastZ, speed, dt, FARM.REPLAN_CHASE);
        if (arrived && !know && !K.shoo) { ev('lost', { x: K.lastX, z: K.lastZ }); setKState('search'); K.searchT = FARM.SEARCH_T; pickSearchPoint(); break; }
        if (K.partial && arrived && K.shoo) {
          // 驱赶时够不着小狗（隔着关着的圈门 / 狗洞 / 深水）：就站在能到的最近处隔着赶，时间照算
          K.action = 'shoo'; K.speed = 0; K.giveUpT = 0;
          if (aware) { turnKeeper(Math.atan2(p.x - K.x, p.z - K.z), dt); if (d >= FARM.SHOO_NEAR) K.shooT += dt; }
        } else if (K.partial && arrived) {
          K.giveUpT += dt; K.action = 'look'; K.speed = 0;
          if (know) turnKeeper(Math.atan2(p.x - K.x, p.z - K.z), dt);
          if (K.giveUpT > FARM.GIVEUP_T) { ev('lost', { x: K.lastX, z: K.lastZ, unreachable: true }); setKState('search'); K.searchT = FARM.SEARCH_T * 0.6; K.lastX = K.x; K.lastZ = K.z; pickSearchPoint(); }
        } else K.giveUpT = 0;
        break;
      }
      case 'search': {
        if (vis && p.immuneT <= 0 && (K.anger >= FARM.SUSPECT_CHASE || wanted)) { setKState('chase'); break; }
        K.searchT -= dt;
        if (K.searchT <= 0) { K.anger = Math.max(0, K.anger - FARM.LOST_RELIEF); setKState('return'); break; }
        if (K.waitT > 0) { K.waitT -= dt; look(dt); break; }
        K.action = 'walk';
        if (keeperGo(K.sx, K.sz, FARM.SEARCH_SPEED, dt)) { K.waitT = 0.9; K.lookBase = K.heading; pickSearchPoint(); }
        break;
      }
      case 'carry': { // 拎到路上（catchPet 里挑好了落点），站定、顺着路的方向扔出去
        K.carryT += dt; K.action = 'carry';
        if (K.tossT > 0) {
          K.speed = 0; turnKeeper(Math.atan2(K.dropDx, K.dropDz), dt * 2);
          K.tossT -= dt;
          if (K.tossT <= 0) { K.tossT = 0; K.heading = Math.atan2(K.dropDx, K.dropDz); release(p, K.landOk); }
          break;
        }
        const kx0 = K.x, kz0 = K.z;
        const there = keeperGo(K.dropX, K.dropZ, FARM.CARRY_SPEED, dt, 1.5) || Math.hypot(K.dropX - K.x, K.dropZ - K.z) < 0.5;
        K.stuckT = Math.hypot(K.x - kx0, K.z - kz0) < 0.3 * dt ? K.stuckT + dt : 0; // 按真实位移算（顶着东西走时 K.speed 不是 0）
        if (((there || K.stuckT > 0.8) && K.carryT >= FARM.CARRY_T) || K.carryT >= FARM.CARRY_MAX_T) {
          pickLanding(); // 选好往哪儿扔，接下来 TOSS_WIND 这段时间转过去
          K.tossT = FARM.TOSS_WIND;
        }
        break;
      }
      case 'return': {
        if (vis && p.immuneT <= 0 && (K.anger >= FARM.ANGER_FULL || wanted)) { setKState('chase'); break; }
        if (K.stateT <= dt) K.patrolI = nearestPatrol();
        const pt = patrolPts[K.patrolI % patrolPts.length];
        K.action = 'walk';
        if (keeperGo(pt[0], pt[1], FARM.WALK_SPEED, dt)) { setKState('patrol'); K.patrolI = (K.patrolI + 1) % patrolPts.length; }
        break;
      }
    }
  }
  function catchPet(p) {
    const K = S.keeper;
    S.caught++;
    const pen = Math.min(S.score, FARM.CATCH_PENALTY);
    S.score -= pen;
    p.held = true; p.hidden = false; p.hideSeen = false; p.pounceT = 0; p.spd = 0; p.stunT = 0;
    setKState('carry'); K.carryT = 0; K.tossT = 0; K.stuckT = 0; K.target = p.id;
    const r = pickRoadDrop();
    if (r) { K.dropX = r.x; K.dropZ = r.z; K.dropDx = r.dx; K.dropDz = r.dz; }
    else { const h = sp.keeper.home; K.dropX = h.x; K.dropZ = h.z; K.dropDx = Math.sin(K.heading); K.dropDz = Math.cos(K.heading); }
    ev('caught', { petId: p.id, count: S.caught, penalty: pen, x: p.x, z: p.z });
    if (S.caught >= FARM.CAUGHT_MAX) finish('caught');
  }
  /** 离管理员最近、走得到、又离这儿有一段距离的路面落点；找不到返回 null */
  function pickRoadDrop() {
    const K = S.keeper, nav = world.nav('keeper');
    const c = roadPts.map((r) => ({ r, d: Math.hypot(r.x - K.x, r.z - K.z) })).filter((q) => q.d >= FARM.ROAD_MIN).sort((a, b) => a.d - b.d);
    // 从近到远试几段路（试过的那一段旁边 2.5 以内的不重复试），挑实际走过去最近的；直线和路程差不多的直接用
    const tried = [];
    let best = null, bl = 1e9;
    for (let i = 0; i < c.length && tried.length < 10; i++) {
      const r = c[i].r;
      if (c[i].d > bl) break; // 直线都比已经找到的路程远了
      if (tried.some((b) => Math.hypot(b.x - r.x, b.z - r.z) < 2.5)) continue;
      tried.push(r);
      const path = nav.plan(K.x, K.z, r.x, r.z, gateOpen);
      if (!path || path.partial) continue;
      let len = 0, px = K.x, pz = K.z;
      for (const wp of path) { len += Math.hypot(wp[0] - px, wp[1] - pz); px = wp[0]; pz = wp[1]; }
      if (len < bl) { bl = len; best = r; }
      if (len <= c[i].d * 1.3 + 1) break;
    }
    return best;
  }
  /** 选扔的落点：优先附近路面上最顺着朝向的那一点；路面上没有合适的就朝各个方向找一块空地；都没有 → landOk = false（放在脚边） */
  function pickLanding() {
    const K = S.keeper, sx = Math.sin(K.heading), sz = Math.cos(K.heading);
    const freeFor = (x, z) => world.penAt(x, z, FARM.PET_R, 'pet', gateOpen) <= 0.005 && !world.waterAt(x, z);
    let lx = 0, lz = 0, bs = -1e9;
    for (const r of roadPts) {
      const dx = r.x - K.x, dz = r.z - K.z, d = Math.hypot(dx, dz);
      if (d < 1.6 || d > 3.2 || !freeFor(r.x, r.z)) continue;
      const sc = (dx * sx + dz * sz) / d - Math.abs(d - FARM.TOSS_DIST) * 0.3;
      if (sc > bs) { bs = sc; lx = r.x; lz = r.z; }
    }
    if (bs < -1e8) {
      const base = Math.atan2(K.dropDx, K.dropDz);
      search: for (const a of [0, Math.PI, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) {
        for (let d = FARM.TOSS_DIST; d > 1.2; d -= 0.4) {
          const x = K.x + Math.sin(base + a) * d, z = K.z + Math.cos(base + a) * d;
          if (freeFor(x, z)) { lx = x; lz = z; bs = 0; break search; }
        }
      }
    }
    K.landOk = bs > -1e8;
    if (K.landOk) { K.landX = lx; K.landZ = lz; const d = Math.hypot(lx - K.x, lz - K.z) || 1; K.dropDx = (lx - K.x) / d; K.dropDz = (lz - K.z) / d; }
  }
  function release(p, toss = false) {
    const K = S.keeper;
    if (p) {
      p.held = false; p.immuneT = FARM.IMMUNE_T;
      p.x = K.x + Math.sin(K.heading) * 0.6; p.z = K.z + Math.cos(K.heading) * 0.6;
      if (toss) { // 扔到 pickLanding 选好的落点
        const sx = Math.sin(K.heading), sz = Math.cos(K.heading);
        p.tossT = FARM.TOSS_T; p.tossX0 = K.x + sx * 0.45; p.tossZ0 = K.z + sz * 0.45; p.tossX1 = K.landX; p.tossZ1 = K.landZ;
        p.x = p.tossX0; p.z = p.tossZ0; p.heading = K.heading; p.air = 0.8; p.immuneT += FARM.TOSS_T + FARM.TOSS_STUN;
      }
      if (!(p.tossT > 0)) world.resolve(p, FARM.PET_R, 'pet', gateOpen);
      ev('released', { petId: p.id, x: p.x, z: p.z, toss: p.tossT > 0 });
    }
    K.anger = S.phase === 'wanted' ? 1 : FARM.ANGER_AFTER_CATCH;
    setKState('return');
  }

  // ---------------------------------------------------------------- 大鹅
  function stepGoose(dt) {
    const G = S.goose;
    if (!G.active) return;
    G.cd = Math.max(0, G.cd - dt);
    const p = localPet();
    const tgt = p && !p.held && !p.escaped && !(p.hidden && !p.hideSeen) ? p : null;
    let tx, tz, spd;
    if (!tgt) { tx = sp.goose.x; tz = sp.goose.z; spd = 1.2; G.action = 'walk'; }
    else if (G.cd > 0) { tx = G.x + (G.x - tgt.x); tz = G.z + (G.z - tgt.z); spd = 1.5; G.action = 'strut'; }
    else { tx = tgt.x; tz = tgt.z; spd = S.rules.goose.speed || FARM.GOOSE_SPEED; G.action = 'chase'; }
    const dx = tx - G.x, dz = tz - G.z, d = Math.hypot(dx, dz);
    if (d < 0.2) { G.speed = 0; G.action = tgt ? G.action : 'idle'; }
    else {
      // 避障：借用管理员的寻路栅格（大鹅也不钻洞、不下深水），每 0.5 秒重新规划；看得见就直线冲
      G.planT -= dt;
      if (G.planT <= 0 || !G.path || !G.path.length) {
        const pth = world.nav('keeper').plan(G.x, G.z, tx, tz, gateOpen);
        G.path = pth ? pth.slice() : [[tx, tz]]; G.planT = 0.5;
      }
      const ox = G.x, oz = G.z;
      let remain = Math.min(spd * dt, d);
      while (remain > 1e-6 && G.path.length) {
        const [wx, wz] = G.path[0];
        const ddx = wx - G.x, ddz = wz - G.z, dd = Math.hypot(ddx, ddz);
        if (dd <= remain) { G.x = wx; G.z = wz; remain -= dd; G.path.shift(); }
        else { G.x += (ddx / dd) * remain; G.z += (ddz / dd) * remain; remain = 0; }
      }
      world.resolve(G, FARM.GOOSE_R, 'npc', gateOpen);
      if (world.deepAt(G.x, G.z)) { G.x = ox; G.z = oz; G.path = []; }
      const mv = Math.hypot(G.x - ox, G.z - oz);
      if (mv > 1e-4) G.heading = Math.atan2(G.x - ox, G.z - oz);
      G.speed = mv / dt;
    }
    if (tgt && G.cd <= 0 && Math.hypot(tgt.x - G.x, tgt.z - G.z) < FARM.GOOSE_PECK_R) {
      tgt.slowT = Math.max(tgt.slowT, FARM.GOOSE_SLOW); G.cd = FARM.GOOSE_CD; G.action = 'peck';
      ev('peck', { petId: tgt.id, by: 'goose' });
      ev('honk', { x: G.x, z: G.z });
      const K = S.keeper;
      if (K.active && K.state !== 'carry' && tgt.immuneT <= 0) { K.lastX = tgt.x; K.lastZ = tgt.z; K.knowsT = FARM.GOOSE_ALERT; K.unseenT = 0; if (K.state !== 'chase') setKState('chase'); }
    }
  }

  // ---------------------------------------------------------------- 阶段与主循环
  function startWanted() {
    if (S.phase === 'wanted' || S.finished) return;
    S.phase = 'wanted';
    ev('wanted', { exit: sp.exit ? { x: sp.exit.x, z: sp.exit.z } : null });
    const K = S.keeper, p = localPet();
    if (!test.noGoose && sp.goose) { S.goose.active = true; S.goose.x = sp.goose.x; S.goose.z = sp.goose.z; ev('goose', { x: S.goose.x, z: S.goose.z }); }
    if (K.active && S.rules.keeper.awake) {
      K.anger = 1;
      if (p && !p.held && K.state !== 'carry') { K.lastX = p.x; K.lastZ = p.z; K.knowsT = FARM.WANTED_KNOW; K.unseenT = 0; setKState('chase'); }
    }
  }
  function finish(reason) {
    if (S.finished) return;
    S.finished = true; S.phase = 'done'; S.endReason = reason;
    if (reason === 'time') S.time = FARM.DURATION;
    ev('finished', { reason, score: S.score, caught: S.caught, escaped: S.escaped });
  }
  function step(dt) {
    if (S.finished) return;
    if (S.phase === 'intro') {
      S.introTick = (S.introTick || 0) + 1;
      for (const p of S.pets) { p.speed = 0; p.action = 'idle'; }
      if (S.introTick >= INTRO_TICK) { S.phase = 'play'; ev('phase', { phase: 'play' }); }
      return;
    }
    S.tick++;
    S.time = S.tick * STEP;
    if (S.phase === 'play' && S.tick >= WANTED_TICK && !test.endless) startWanted();
    for (const p of S.pets) { stepPet(p, dt); if (S.finished) return; }
    stepObjects(localPet(), dt);
    for (const p of S.pets) settleBonk(p);
    stepAnimals(dt);
    stepKeeper(dt);
    if (S.finished) return;
    stepGoose(dt);
    if (S.tick >= END_TICK && !test.endless) finish('time');
  }
  function update(dt) {
    if (!(dt > 0) || S.finished) return;
    S.acc += Math.min(dt, FARM.MAX_DT);
    while (S.acc >= STEP - 1e-9 && !S.finished) { S.acc -= STEP; step(STEP); }
    if (S.finished) S.acc = 0;
  }

  function result(aborted = false) {
    const completion = clamp(Math.round((100 * S.score) / S.fullScore), 0, 100);
    const st = FARM.STARS;
    const stars = completion >= st[2] ? 3 : completion >= st[1] ? 2 : completion >= st[0] ? 1 : 0;
    return {
      game: 'farm', mode: S.mode, completion, stars, score: S.score, caught: S.caught, escaped: S.escaped,
      mischief: { ...S.mischief }, zonesCleared: S.zonesCleared, duration: Math.round(S.time * 100) / 100, aborted: !!aborted,
    };
  }
  const snapshot = () => JSON.parse(JSON.stringify(S));
  function applySnapshot(s) {
    if (!s || !s.keeper || !Array.isArray(s.pets)) throw new Error('applySnapshot: 不是 farmSim 的快照');
    S = JSON.parse(JSON.stringify(s)); events.length = 0;
  }
  function setRules(r) { S.rules = normalizeRules(r); ev('rules', { phase: S.rules.phase }); }

  initState();

  const sim = {
    map, world, events, mode,
    get time() { return S.time; },
    get phase() { return S.phase; },
    get finished() { return S.finished; },
    get endReason() { return S.endReason; },
    get pets() { return S.pets; },
    get keeper() { return S.keeper; },
    get goose() { return S.goose; },
    get animals() { return S.animals; },
    get groups() { return S.groups; },
    get objects() { return S.objects; },
    get score() { return S.score; },
    get caught() { return S.caught; },
    get escaped() { return S.escaped; },
    get zones() { return S.zones; },
    get rules() { return S.rules; },
    get fullScore() { return S.fullScore; },
    get seed() { return S.seed; },
    addPet, removePet, command, update, result, snapshot, applySnapshot, setRules,
    clearEvents() { events.length = 0; },
    petById, localPet,
    /** 第 oi 个可互动物（圈门）开没开（寻路用：sim.nav('pet').field(x, z, sim.gateOpen)） */
    gateOpen,
    /** 管理员现在能不能看见这只宠物（id 或宠物对象） */
    canKeeperSee(p) { return canSee(typeof p === 'string' ? petById(p) : p); },
    /** 管理员现在能不能看见地图上的这个点（不考虑躲藏） */
    keeperSeesPoint,
    /** 寻路栅格：'keeper' | 'pet' */
    nav: (who) => world.nav(who),
    /** 调试 / 测试用 */
    debug: {
      placePet(id, x, z, heading) { const p = petById(id); if (!p) return; p.x = x; p.z = z; if (heading !== undefined) p.heading = heading; p.spd = 0; p.speed = 0; p.wallT = 0; p.stunT = 0; p.pounceT = 0; p.tossT = 0; p.air = 0; },
      /** 测试用：当作这只宠物在 (x, z) 捣乱了一下（只走管理员的反应，不计分） */
      notice(id, x, z, noise, anger) { const p = petById(id); if (p) keeperNotice(p, x, z, noise, anger); },
      setKeeper(o) { Object.assign(S.keeper, o); if (o.state) { S.keeper.path = []; S.keeper.gx = 1e9; } },
      startWanted, finish: () => finish('debug'),
      skipTo(t) { while (!S.finished && S.time < t - 1e-9) step(STEP); },
      get state() { return S; },
    },
  };
  return sim;
}

export default createFarmSim;
