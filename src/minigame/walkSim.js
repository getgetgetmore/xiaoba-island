// 遛狗小游戏的纯逻辑：难度曲线、赛道生成（预先生成整条赛道，公平性在生成时保证）、
// “手 → 绳子 → 小狗”的操控模型、小狗自己的意志（乱晃 / 诱惑 / 害怕 / 前冲 / 嗅）、握力、碰撞、连击、计分。
// 不依赖 three 渲染、不访问 DOM，可在 Node 里直接跑（scripts/walk-test.mjs）。
//
// 坐标：沿赛道的距离 s（米，向前为正）；dist 是狗当前跑过的距离；ahead = s - dist 是实体在狗前方多远。
//       横向 x（米，向右为正），步道宽 6 米，分成三条道：LANES = [-2, 0, 2]。
// 输入：update(dt, { hand, grip })  hand = 手的横向位置（米，±HAND_MAX），grip = 是否收紧绳子。
//
// 操控因果链：鼠标 → 手（handX，很小的平滑）→ 绳子（有松紧 slack：手与狗的横向差在 slack 以内，绳子只是荡，对狗没有拉力；
//   超出的部分才产生拉力，系数 k）→ 小狗。收紧：slack 0.9 → 0.15 米、k ×3，代价是小狗减速到 55% 并累积握力。
//   快速甩手 = 拽一下（给狗一个侧向冲量，0.6 秒冷却）。张力太大且持续 → 握力条涨满 → 脱手（小狗自由 2.5 秒）。
import { mulberry32, clamp } from '../core/util.js';

export const WALK = {
  DURATION: 180,
  V0: 6.5, V1: 12.5,        // 前进速度（米/秒）：开局 → 结束，线性增加
  GAP0: 14, GAP1: 5.8,      // 相邻两排之间的距离（米）：开局 → 结束
  LANES: [-2, 0, 2],
  PATH_HALF: 3,
  X_MAX: 2.75,              // 狗横向位置的上限（贴着路沿）
  HAND_MAX: 3.4,            // 手的横向范围
  RADIUS: 0.42,             // 狗的碰撞半径
  GRIP_SPEED: 0.55,         // 收紧时前进速度降到 55%
  SLACK_LOOSE: 0.9, SLACK_TIGHT: 0.15,
  K_LOOSE: 4.3, K_TIGHT_MUL: 3.2, // 拉力系数（加速度/米），收紧时 ×3
  HAND_SMOOTH: 28,          // 手的平滑（1/秒，约 35ms）
  TUG_SPEED: 7, TUG_IMPULSE: 5.5, TUG_COOLDOWN: 0.6, TUG_DIST: 0.7, // 拽
  GRIP_T0: 9.5, GRIP_RISE: 0.07, GRIP_FALL: 0.4, GRIP_BASE: 6, GRIP_TIRE: 0.5, GRIP_ROPE: 0.4, GRIP_FILTER: 0.6,         // 握力：张力 T = 0.4×|拉力| + 6×收紧×(1+0.5×连续握住秒数)（0.6 秒低通）；T>9.5 时涨
  SLIP_TIME: 2.5,
  START_S: 40,
  // 各类实体首次出现的时间（秒，按 180 秒标定）
  FIRST: { bump: 20, lure: 15, mover: 25, cross: 40, fear: 40, walker: 50, sniff: 60, dash: 75, dbl: 75, stack: 120 },
  WARN_DIST: 60,
  LURE_RANGE: 20,
};

export const FIXED_KINDS = {
  cone:     { hw: 0.32, hd: 0.32, w: 3 },
  puddle:   { hw: 0.85, hd: 0.65, w: 2 },
  hydrant:  { hw: 0.32, hd: 0.32, w: 2 },
  bin:      { hw: 0.45, hd: 0.45, w: 2 },
  box:      { hw: 0.55, hd: 0.5, w: 2 },
  barrier:  { hw: 1.0, hd: 0.3, w: 1.5 },
};
export const LURE_KINDS = {
  pigeons:  { hw: 0.75, hd: 0.6, pull: 0.9, w: 3 },
  dog:      { hw: 0.5, hd: 0.6, pull: 1.1, w: 3 },
  sausage:  { hw: 0.3, hd: 0.3, pull: 1.0, w: 2 },
  icecream: { hw: 0.3, hd: 0.3, pull: 1.0, w: 2 },
};
export const FEAR_KINDS = {   // 小狗害怕的东西：往反方向躲
  sprinkler: { hw: 0.5, hd: 0.5, push: 1.0, w: 3 },   // 洒水器
  sweeper:   { hw: 0.8, hd: 0.8, push: 1.1, w: 2 },   // 扫地车
  balloons:  { hw: 0.45, hd: 0.45, push: 0.95, w: 3 }, // 气球（会啪地爆）
};
export const CROSS_KINDS = {
  ball:  { hw: 0.32, hd: 0.32, vx: 5.2, T: 1.1, w: 3 },
  bike:  { hw: 0.7, hd: 0.35, vx: 6.5, T: 0.9, w: 2 },
  skate: { hw: 0.45, hd: 0.35, vx: 5.5, T: 1.0, w: 2 },
};
// 会动的障碍：lateral = 左右慢慢移动（扫地机器人、遥控车），approach = 迎面走来（行人、推婴儿车）
export const MOVER_KINDS = {
  roomba: { hw: 0.45, hd: 0.45, amp: 0.7, period: 3.4, mode: 'lateral', w: 2 },
  rccar:  { hw: 0.4, hd: 0.5, amp: 0.7, period: 2.1, mode: 'lateral', w: 2 },
  walker: { hw: 0.38, hd: 0.35, vw: 2.3, mode: 'approach', w: 3 },
  stroller: { hw: 0.65, hd: 0.7, vw: 1.7, mode: 'approach', w: 2 },
};
export const CRITTER_KINDS = { squirrel: { w: 1 }, cat: { w: 1 } }; // 前方横穿的小动物：小狗猛地前冲

const D180 = WALK.DURATION;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;

export function speedAt(t, D = D180) { return lerp(WALK.V0, WALK.V1, clamp01(t / D)); }
export function distAt(t, D = D180) { const u = clamp01(t / D) * D; return WALK.V0 * u + ((WALK.V1 - WALK.V0) * u * u) / (2 * D); }
export function timeAtDist(s, D = D180) {
  const a = (WALK.V1 - WALK.V0) / (2 * D);
  return (-WALK.V0 + Math.sqrt(WALK.V0 * WALK.V0 + 4 * a * Math.max(0, s))) / (2 * a);
}

/**
 * 相邻两排之间，狗最多能横移几条道（0/1/2）。按“高手收紧绳子（速度 55%）”估算可用时间：
 * 可用时间 = (间距 − 两排的纵深) / 速度。mult > 1：前冲之后（速度更快）。
 */
export function maxLaneShift(gap, t, D = D180, mult = 1) {
  const v = speedAt(Math.min(D, t + 12), D) * 1.1 * WALK.GRIP_SPEED * mult;
  const T = (gap - 1.8) / v;
  return T >= 3.5 ? 2 : T >= 0.5 ? 1 : 0;
}

function weighted(rng, table, seen) {
  const keys = Object.keys(table);
  if (seen) {
    const unseen = keys.filter((k) => !seen.has(k));
    if (unseen.length && rng() < 0.6) { const k = unseen[Math.floor(rng() * unseen.length)]; seen.add(k); return k; }
  }
  let sum = 0;
  for (const k of keys) sum += table[k].w;
  let r = rng() * sum;
  for (const k of keys) { r -= table[k].w; if (r <= 0) { if (seen) seen.add(k); return k; } }
  const k = keys[keys.length - 1];
  if (seen) seen.add(k);
  return k;
}

export function makeEntity(cls, kind, s, x, o = {}) {
  return { id: 0, cls, kind, s, x, vx: 0, hw: 0.4, hd: 0.4, row: -1, tSched: 0, state: 'idle', dir: 0, x0: x, trig: 0, active: false, warn: false, seed: 0.5, hitT: -1, fled: false, off: 0, amp: 0, period: 1, vw: 0, tAct: 0, pull: 1, push: 1, ...o };
}

/** 空赛道（测试用：没有任何障碍） */
export function emptyTrack(D = D180) {
  return { rows: [], ents: [], bonesTotal: 0, maxDistance: distAt(D, D) };
}
/** 用给定实体拼一条赛道（测试用；每个危险实体自成一排） */
export function customTrack(list, D = D180) {
  const rows = [], ents = [];
  for (const e of list) {
    const hazard = ['obstacle', 'lure', 'fear', 'crosser', 'mover'].includes(e.cls);
    let row = -1;
    if (hazard) { row = rows.length; rows.push({ index: row, s: e.s, t: timeAtDist(e.s, D), kind: e.cls, blocked: [], free: [0, 1, 2], safe: 1, gap: 99, shift: 2, dbl: false, hit: false, resolved: false, ents: [e], hazard: true }); }
    e.row = row; ents.push(e);
  }
  ents.sort((a, b) => a.s - b.s); ents.forEach((e, i) => { e.id = i; });
  return { rows, ents, bonesTotal: 0, maxDistance: distAt(D, D) };
}

// ------------------------------------------------------------------ 赛道生成
export function generateTrack(rng, D = D180) {
  const rows = [];
  const ents = [];
  const L = WALK.LANES, F = WALK.FIRST;
  const sMax = distAt(D, D) - 24;
  const first = { lure: false, cross: false, fear: false, dash: false, dbl: false, mover: false, walker: false };
  const seen = { f: new Set(), l: new Set(), c: new Set(), fe: new Set(), m: new Set(), cr: new Set() };
  let prevSafe = 1, prevS = 14, prevKindSpecial = false, afterDash = false;

  const mk = (cls, kind, s, x, hw, hd, row, t, o = {}) => {
    const e = makeEntity(cls, kind, s, x, { hw, hd, row, tSched: t, seed: rng(), ...o });
    ents.push(e);
    return e;
  };
  const addBones = (sa, sb, xa, xb, t) => {
    const G = sb - sa;
    if (G < 7) return;
    const lo = 2.6, hi = G - 2.6;
    if (xa === xb) {
      const n = G >= 12 ? 4 : G >= 9.5 ? 3 : 2;
      for (let i = 0; i < n; i++) mk('bone', 'bone', sa + lo + ((hi - lo) * i) / (n - 1), xa, 0.3, 0.3, -1, t);
    } else {
      const na = G >= 12 ? 2 : 1;
      for (let i = 0; i < na; i++) mk('bone', 'bone', sa + lo + i * 1.6, xa, 0.3, 0.3, -1, t);
      mk('bone', 'bone', sa + hi, xb, 0.3, 0.3, -1, t);
    }
  };
  addBones(0, 38, 0, 0, 0);

  let guard = 0;
  while (guard++ < 800) {
    const tPrev = timeAtDist(prevS, D);
    const phPrev = (tPrev * D180) / D;
    const stack = phPrev >= F.stack;
    const gapBase = lerp(WALK.GAP0, WALK.GAP1, clamp01(tPrev / D)) * (1 + 0.22 * rng()) * (afterDash ? 1.35 : 1);
    const sRow = rows.length === 0 ? WALK.START_S : prevS + gapBase;
    if (sRow > sMax) break;
    const t = timeAtDist(sRow, D);
    const ph = (t * D180) / D;
    const gap = sRow - prevS;
    const prevRow = rows.length ? rows[rows.length - 1] : null;
    const prevKind = prevRow ? prevRow.kind : 'fixed';
    // 上一排如果是会提前撞上来的行人（相遇点比名义位置早约 5 米），本排的可用时间更少
    const moverMargin = (prevRow && prevRow.kind === 'walker' ? 3 : 0) + 0;
    let shift = rows.length === 0 ? 2 : maxLaneShift(gap - moverMargin, t, D, afterDash ? 1.7 : 1);

    // —— 选这一排的类型 ——
    let kind = 'fixed';
    const specialOk = stack || !prevKindSpecial;
    const roll = rng();
    if (ph >= F.dash && !first.dash && specialOk) kind = 'dash';
    else if (ph >= F.walker && !first.walker && specialOk) kind = 'walker';
    else if (ph >= F.cross && !first.cross && specialOk) kind = 'crosser';
    else if (ph >= F.fear && !first.fear && specialOk) kind = 'fear';
    else if (ph >= F.mover && !first.mover && specialOk) kind = 'mover';
    else if (ph >= F.lure && !first.lure) kind = 'lure';
    else if (specialOk) {
      const k = stack ? 1.6 : 1;
      let r = roll;
      const tab = [];
      if (ph >= F.lure) tab.push(['lure', 0.15 * k]);
      if (ph >= F.mover) tab.push(['mover', 0.09 * k]);
      if (ph >= F.walker) tab.push(['walker', 0.08 * k]);
      if (ph >= F.cross) tab.push(['crosser', 0.08 * k]);
      if (ph >= F.fear) tab.push(['fear', 0.1 * k]);
      if (ph >= F.dash) tab.push(['dash', 0.06 * k]);
      for (const [name, p] of tab) { if (r < p) { kind = name; break; } r -= p; }
    }
    if (kind === 'dash' && (prevKind === 'dash')) kind = 'fixed';

    const row = { index: rows.length, s: sRow, t, kind, blocked: [], free: [], safe: prevSafe, gap, shift, dbl: false, hit: false, resolved: false, ents: [], hazard: true };
    const reach = [0, 1, 2].filter((l) => Math.abs(l - prevSafe) <= shift);
    const pickOf = (arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
    const others = (f) => [0, 1, 2].filter((l) => l !== f);
    // 安全道多半在两侧（路中间常被占），所以待在中间的玩家更容易撞
    const pickEdgy = (arr) => { const e = arr.filter((l) => l !== 1); return e.length && rng() < 0.75 ? pickOf(e) : pickOf(arr); };

    if (kind === 'fixed') {
      const dbl = ph >= F.dbl && (!first.dbl || rng() < 0.45);
      first.dbl = first.dbl || dbl;
      row.dbl = dbl;
      const f = pickEdgy(reach);
      let blocked;
      if (dbl) blocked = others(f);
      else {
        let b;
        if (f !== 1 && rng() < 0.65) b = 1; else if (prevSafe !== f && rng() < 0.7) b = prevSafe; else b = pickOf(others(f));
        blocked = [b];
      }
      row.safe = f; row.blocked = blocked; row.free = [0, 1, 2].filter((l) => !blocked.includes(l));
      if (dbl && rng() < 0.5) {
        // 窄通道：施工围挡只留一个口（只留中间 / 只留一侧）
        const sx = sRow + (rng() - 0.5) * 0.4;
        const hdG = 0.3;
        if (f === 1) {
          for (const sg of [-1, 1]) row.ents.push(mk('obstacle', 'gate', sx, sg * 2.2, 0.8, hdG, row.index, t));
        } else {
          const sg = f === 0 ? 1 : -1; // 口在左侧 → 围挡在右边
          row.ents.push(mk('obstacle', 'gate', sx, sg * 1.3, 1.7, hdG, row.index, t));
        }
      } else {
        for (const b of blocked) {
          const k = weighted(rng, FIXED_KINDS, seen.f);
          const K = FIXED_KINDS[k];
          row.ents.push(mk('obstacle', k, sRow + (rng() - 0.5) * 1.0, L[b] + (rng() - 0.5) * 0.36, K.hw, K.hd, row.index, t));
        }
      }
    } else if (kind === 'lure') {
      first.lure = true;
      const f = pickEdgy(reach);
      const oth = others(f);
      let b;
      if (prevSafe !== f && rng() < 0.5) b = prevSafe;
      else { const adj = oth.filter((l) => Math.abs(l - f) === 1); b = pickOf(adj.length ? adj : oth); }
      row.safe = f; row.blocked = [b]; row.free = [0, 1, 2].filter((l) => l !== b);
      const k = weighted(rng, LURE_KINDS, seen.l);
      const K = LURE_KINDS[k];
      row.ents.push(mk('lure', k, sRow + (rng() - 0.5) * 0.6, L[b] + (rng() - 0.5) * 0.3, K.hw, K.hd, row.index, t, { pull: K.pull }));
    } else if (kind === 'fear') {
      first.fear = true;
      const f = pickOf(reach);
      const oth = others(f);
      let b;
      const adj = oth.filter((l) => Math.abs(l - f) === 1);
      b = rng() < 0.55 && prevSafe !== f ? prevSafe : pickOf(adj.length ? adj : oth);
      row.safe = f; row.blocked = [b]; row.free = [0, 1, 2].filter((l) => l !== b);
      const k = weighted(rng, FEAR_KINDS, seen.fe);
      const K = FEAR_KINDS[k];
      row.ents.push(mk('fear', k, sRow + (rng() - 0.5) * 0.6, L[b] + (rng() - 0.5) * 0.3, K.hw, K.hd, row.index, t, { push: K.push }));
    } else if (kind === 'mover' || kind === 'walker') {
      first[kind] = true;
      const f = pickEdgy(reach);
      const oth = others(f);
      let b;
      if (prevSafe !== f && rng() < 0.6) b = prevSafe; else b = rng() < 0.5 && oth.includes(1) ? 1 : pickOf(oth);
      row.safe = f; row.blocked = [b]; row.free = [0, 1, 2].filter((l) => l !== b);
      const pool = {};
      for (const [k, K] of Object.entries(MOVER_KINDS)) if ((kind === 'mover') === (K.mode === 'lateral')) pool[k] = K;
      const k = weighted(rng, pool, seen.m);
      const K = pool[k];
      if (K.mode === 'lateral') {
        const e = mk('mover', k, sRow, L[b], K.hw, K.hd, row.index, t, { amp: K.amp, period: K.period, x0: L[b], mode: 'lateral' });
        e.tAct = rng() * 6.28;
        row.ents.push(e);
      } else {
        // 迎面走来：约 24 米外开始朝狗走，相遇点估计在名义位置前约 5 米，所以出发点放后 5 米
        const e = mk('mover', k, sRow + 5, L[b], K.hw, K.hd, row.index, t, { vw: K.vw, trig: 26, mode: 'approach' });
        row.ents.push(e);
        row.kind = 'walker';
      }
      row.s = sRow;
    } else if (kind === 'crosser') {
      first.cross = true;
      row.safe = prevSafe; row.free = [0, 1, 2];
      const k = weighted(rng, CROSS_KINDS, seen.c);
      const K = CROSS_KINDS[k];
      const dir = rng() < 0.5 ? -1 : 1;
      const e = mk('crosser', k, sRow, -dir * 4.6, K.hw, K.hd, row.index, t, { dir, vx: K.vx * dir, x0: -dir * 4.6, trig: K.T * (0.92 + 0.22 * rng()) * speedAt(t, D) });
      row.ents.push(e);
    } else if (kind === 'dash') {
      first.dash = true;
      row.hazard = false;
      row.safe = prevSafe; row.free = [0, 1, 2];
      const k = weighted(rng, CRITTER_KINDS, seen.cr);
      const dir = rng() < 0.5 ? -1 : 1;
      const e = mk('critter', k, sRow, -dir * 5, 0.3, 0.3, row.index, t, { dir, vx: dir * 7, x0: -dir * 5, trig: 26 });
      row.ents.push(e);
    }
    afterDash = kind === 'dash';
    prevKindSpecial = kind !== 'fixed';
    // 路上的“软”东西：减速带（踩到不算失误，但减速、小狗兴奋）、嗅嗅的树桩（小狗会停下来嗅，要拽一下才走）
    if (gap >= 10 && rows.length) {
      const mid = prevS + gap * 0.5;
      if (ph >= F.bump && rng() < 0.2) mk('soft', 'bump', mid, 0, 3, 0.45, -1, t);
      else if (ph >= F.sniff && rng() < 0.18) mk('sniff', 'stump', mid, (rng() < 0.5 ? -1 : 1) * 2.85, 0.45, 0.45, -1, t);
    }
    addBones(prevS, sRow, L[prevRow ? prevRow.safe : 1], L[row.safe], t);
    rows.push(row);
    prevSafe = row.safe; prevS = sRow;
  }
  const lastX = L[prevSafe];
  addBones(prevS, sMax + 24, lastX, lastX, D);
  ents.sort((a, b) => a.s - b.s);
  ents.forEach((e, i) => { e.id = i; });
  let bonesTotal = 0;
  for (const e of ents) if (e.cls === 'bone') bonesTotal++;
  return { rows, ents, bonesTotal, maxDistance: distAt(D, D) };
}

const HAZARD = { obstacle: 1, lure: 1, fear: 1, crosser: 1, mover: 1 };

// ------------------------------------------------------------------ 模拟
/**
 * opts: { rng, duration, test: { noWill, track } }
 *   test.noTug：关闭“拽”（测阶跃响应时用）
 *   test.noWill：小狗自己的乱晃力关闭（诱惑 / 害怕仍然有，只要赛道里有这类实体）
 *   test.track： 直接给定赛道（emptyTrack / customTrack）
 */
export function createWalkSim({ rng, duration = D180, test = {} } = {}) {
  const D = duration;
  const r = rng || mulberry32(1);
  const track = test.track || generateTrack(r, D);
  const { rows, ents } = track;
  const lures = ents.filter((e) => e.cls === 'lure');
  const fears = ents.filter((e) => e.cls === 'fear');
  const wph1 = r() * 6.28;

  const EV_N = 64;
  const evPool = Array.from({ length: EV_N }, () => ({ type: '', kind: '', id: 0, x: 0, s: 0 }));
  let evN = 0;
  const pushEvent = (type, e) => {
    if (evN >= EV_N) return;
    const ev = evPool[evN++];
    ev.type = type; ev.kind = e ? e.kind : ''; ev.id = e ? e.id : -1; ev.x = e ? e.x : 0; ev.s = e ? e.s + e.off : 0;
  };

  const sim = {
    duration: D, track, rows, entities: ents,
    maxDistance: track.maxDistance, bonesTotal: track.bonesTotal,
    time: 0, dist: 0, speed: WALK.V0,
    // 手 / 绳 / 狗
    hand: 0, handV: 0, slack: WALK.SLACK_LOOSE, k: WALK.K_LOOSE, gripAmt: 0, brakeF: 1,
    x: 0, vx: 0, ropeF: 0, will: 0, wander: 0, pullLure: 0, pullFear: 0, tension: 0,
    gripMeter: 0, holdT: 0, slipT: 0, slips: 0, tugs: 0, tugCd: 0, tugT: 0,
    dashT: 0, sniffT: 0, bumpT: 0, exciteT: 0, hitSlow: 1, stumble: 0,
    hits: 0, avoided: 0, passed: 0, bones: 0, combo: 0, maxCombo: 0,
    finished: false,
    iLo: 0, iHi: ents.length ? 0 : -1,
    lure: null, fear: null, warn: null,
    events: evPool, get eventCount() { return evN; }, clearEvents() { evN = 0; },
    input: { hand: 0, grip: false },
    update, result, baseSpeed: (t) => speedAt(t, D),
  };

  let iLo = 0, rowLo = 0, lureLo = 0, fearLo = 0;
  let wanderX = 0, wanderT = 0;

  function update(dt, input) {
    if (sim.finished) return;
    if (input) { sim.input.hand = clamp(+input.hand || 0, -WALK.HAND_MAX, WALK.HAND_MAX); sim.input.grip = !!input.grip; }
    dt = clamp(+dt || 0, 0, 0.25);
    while (dt > 1e-9 && !sim.finished) {
      const h = Math.min(dt, 1 / 60, D - sim.time);
      sub(h);
      dt -= h;
    }
  }

  function loseCombo() { sim.combo = 0; }
  function addCombo() { sim.combo++; if (sim.combo > sim.maxCombo) sim.maxCombo = sim.combo; }

  function sub(h) {
    const S = WALK;
    sim.time += h;
    if (sim.time >= D - 1e-9) { sim.time = D; sim.finished = true; }
    const t = sim.time, diff = clamp01(t / D);
    const inp = sim.input;
    const slipping = sim.slipT > 0;

    // —— 手：跟着鼠标，很小的平滑 ——
    const hNew = sim.hand + (inp.hand - sim.hand) * (1 - Math.exp(-S.HAND_SMOOTH * h));
    sim.handV = (hNew - sim.hand) / h;
    sim.hand = hNew;
    // —— 绳子的松紧 ——
    const wantGrip = inp.grip && !slipping;
    sim.gripAmt += ((wantGrip ? 1 : 0) - sim.gripAmt) * (1 - Math.exp(-(wantGrip ? 9 : 4) * h));
    sim.brakeF += ((wantGrip ? S.GRIP_SPEED : 1) - sim.brakeF) * (1 - Math.exp(-(wantGrip ? 5 : 2.4) * h));
    sim.slack = lerp(S.SLACK_LOOSE, S.SLACK_TIGHT, sim.gripAmt);
    sim.k = S.K_LOOSE * (1 + (S.K_TIGHT_MUL - 1) * sim.gripAmt);
    sim.hitSlow += (1 - sim.hitSlow) * (1 - Math.exp(-h / 1.2));
    sim.stumble = Math.max(0, sim.stumble - h);
    sim.tugCd = Math.max(0, sim.tugCd - h);
    sim.tugT = Math.max(0, sim.tugT - h);
    sim.exciteT = Math.max(0, sim.exciteT - h);
    sim.bumpT = Math.max(0, sim.bumpT - h);
    sim.dashT = Math.max(0, sim.dashT - h);
    sim.sniffT = Math.max(0, sim.sniffT - h);
    if (slipping) { sim.slipT = Math.max(0, sim.slipT - h); if (sim.slipT === 0) { sim.gripMeter = 0; pushEvent('regrip', null); } }

    // —— 速度 ——
    const dashMult = sim.dashT > 0 ? 1 + 0.8 * (1 - sim.gripAmt) * clamp01(sim.dashT / 0.4) : 1;
    const sniffMult = sim.sniffT > 0 ? lerp(1, 0.25, clamp01(sim.sniffT / 0.3)) : 1;
    const bumpMult = sim.bumpT > 0 ? 0.6 : 1;
    const speed = speedAt(t, D) * sim.brakeF * sim.hitSlow * dashMult * sniffMult * bumpMult;
    sim.speed = speed;
    const dPrev = sim.dist;
    sim.dist += speed * h;
    const dist = sim.dist;

    // —— 小狗自己的意志：乱晃 / 诱惑 / 害怕 ——
    wanderT -= h;
    if (wanderT <= 0) { wanderX = (r() * 2 - 1) * 2.2; wanderT = 1.6 + r() * 1.6; }
    const exc = sim.exciteT > 0 ? 2.2 : 1;
    const A = lerp(0.4, 1.3, diff) * exc;
    sim.wander = test.noWill ? 0 : clamp(A * (wanderX - sim.x) + 0.25 * Math.sin(t * 2.3 + wph1) * exc, -4, 4);
    while (lureLo < lures.length && lures[lureLo].s - dist < -1.5) lureLo++;
    let lure = null;
    for (let i = lureLo; i < lures.length; i++) {
      const e = lures[i]; const ahead = e.s - dist;
      if (ahead > S.LURE_RANGE) break;
      if (e.state === 'hit') continue;
      lure = e; break;
    }
    sim.lure = lure;
    let pt = 0;
    if (lure) {
      const ahead = lure.s - dist;
      const w = ahead >= 0 ? 1 - ahead / S.LURE_RANGE : Math.max(0, 1 + ahead / 1.5);
      pt = lerp(6.5, 12, diff) * lure.pull * Math.tanh((lure.x - sim.x) * 2) * w * w * (3 - 2 * w);
    }
    sim.pullLure += (pt - sim.pullLure) * (1 - Math.exp(-6 * h));
    while (fearLo < fears.length && fears[fearLo].s - dist < -1.5) fearLo++;
    let fear = null;
    for (let i = fearLo; i < fears.length; i++) {
      const e = fears[i]; const ahead = e.s - dist;
      if (ahead > 20) break;
      if (e.state === 'hit') continue;
      fear = e; break;
    }
    sim.fear = fear;
    let pf = 0;
    if (fear) {
      const ahead = fear.s - dist;
      const w = ahead >= 0 ? 1 - ahead / 20 : Math.max(0, 1 + ahead / 1.5);
      const dx = sim.x - fear.x;
      const dir = Math.abs(dx) < 0.25 ? (fear.x > 0 ? -1 : 1) : Math.sign(dx);
      pf = lerp(6, 10.5, diff) * fear.push * dir * Math.min(1, 0.4 + Math.abs(dx)) * w * w * (3 - 2 * w);
    }
    sim.pullFear += (pf - sim.pullFear) * (1 - Math.exp(-6 * h));
    let W = clamp(sim.wander + sim.pullLure + sim.pullFear, -13, 13);
    if (slipping) W *= 1.5;
    sim.will = W;

    // —— 绳子的拉力：手与狗的横向差超出 slack 的部分才有拉力 ——
    const d = sim.hand - sim.x;
    const ad = Math.abs(d);
    const e = ad > sim.slack ? (ad - sim.slack) * Math.sign(d) : 0;
    sim.ropeF = slipping ? 0 : sim.k * e;
    // 拽：手快速甩动，且绳子在该方向已经绷住或正要绷住 → 给小狗一个侧向冲量
    if (!slipping && !test.noTug && sim.tugCd <= 0 && Math.abs(sim.handV) > S.TUG_SPEED && Math.sign(sim.handV) === Math.sign(d) && ad > Math.max(S.TUG_DIST, sim.slack * 0.6)) {
      sim.vx += Math.sign(d) * S.TUG_IMPULSE;
      sim.tugCd = S.TUG_COOLDOWN; sim.tugT = 0.4;
      sim.tugs++;
      sim.gripMeter = Math.min(1, sim.gripMeter + 0.05);
      if (sim.sniffT > 0) sim.sniffT = 0; // 拽一下，小狗就不嗅了
      pushEvent('tug', null);
    }
    const c = 2 * Math.sqrt(sim.k);
    sim.vx += (sim.ropeF + W - c * sim.vx) * h;
    sim.x += sim.vx * h;
    if (sim.x > S.X_MAX) { sim.x = S.X_MAX; if (sim.vx > 0) sim.vx = 0; }
    else if (sim.x < -S.X_MAX) { sim.x = -S.X_MAX; if (sim.vx < 0) sim.vx = 0; }

    // —— 握力：张力 = 拉力大小 + 收紧的基础负担；超过阈值涨，低于回落；涨满脱手 ——
    const T = S.GRIP_ROPE * Math.abs(sim.ropeF) + S.GRIP_BASE * sim.gripAmt * (1 + S.GRIP_TIRE * Math.min(sim.holdT, 6)); // 握得越久越累
    sim.holdT = wantGrip ? sim.holdT + h : Math.max(0, sim.holdT - 2 * h);
    sim.tension += (T - sim.tension) * (1 - Math.exp(-h / S.GRIP_FILTER)); // 瞬时的大力拉（换道）不算，持续的张力才累积
    if (!slipping) {
      if (sim.tension > S.GRIP_T0) sim.gripMeter = Math.min(1, sim.gripMeter + S.GRIP_RISE * (sim.tension - S.GRIP_T0) * h);
      else sim.gripMeter = Math.max(0, sim.gripMeter - S.GRIP_FALL * (sim.gripAmt > 0.5 ? 0.6 : 1.3) * h);
      if (sim.gripMeter >= 1) {
        sim.slipT = S.SLIP_TIME; sim.slips++; sim.hits++; sim.stumble = 0.5; loseCombo();
        pushEvent('slip', null);
      }
    }

    // —— 实体 ——
    while (iLo < ents.length && ents[iLo].s + 12 < dist) iLo++;
    let iHi = iLo;
    while (iHi < ents.length && ents[iHi].s - dist < 135) iHi++;
    sim.iLo = iLo; sim.iHi = iHi - 1;
    let warn = null;
    const R = S.RADIUS;
    for (let i = iLo; i < iHi; i++) {
      const en = ents[i];
      const cls = en.cls;
      if (cls === 'mover') {
        if (en.mode === 'lateral') en.x = en.x0 + en.amp * Math.sin((t * 6.2832) / en.period + en.tAct);
        else {
          if (!en.active && en.state === 'idle' && en.s - dist <= en.trig) { en.active = true; en.tAct = t; en.state = 'active'; }
          if (en.active) en.off = -en.vw * (t - en.tAct);
        }
      }
      const pos = en.s + en.off;
      const ahead = pos - dist;
      if (cls === 'crosser') {
        if (!en.active && en.state === 'idle' && ahead <= en.trig) { en.active = true; en.state = 'active'; }
        if (en.active) {
          en.x += en.vx * h;
          if (Math.abs(en.x) > 5.4 + en.hw) { en.active = false; en.state = en.state === 'hit' ? 'hit' : 'done'; }
        }
        en.warn = ahead < S.WARN_DIST && ahead > -2 && en.state !== 'done';
        if (en.warn && !warn) warn = en;
      } else if (cls === 'critter') {
        if (!en.active && en.state === 'idle' && ahead <= en.trig) {
          en.active = true; en.state = 'active';
          sim.dashT = 1.5; // 小狗猛地前冲
          pushEvent('dash', en);
        }
        if (en.active) { en.x += en.vx * h; if (Math.abs(en.x) > 6) { en.active = false; en.state = 'done'; } }
        en.warn = ahead < S.WARN_DIST && ahead > -2 && en.state !== 'done';
        if (en.warn && !warn) warn = en;
      } else if (cls === 'bone') {
        if (en.state === 'idle' && ahead < R + 0.4 && pos - dPrev > -(R + 0.4) && Math.abs(en.x - sim.x) <= 0.85) {
          en.state = 'collected'; sim.bones++; addCombo(); pushEvent('bone', en);
        }
        continue;
      } else if (cls === 'soft') {
        if (en.state === 'idle' && pos - en.hd - R <= dist && pos + en.hd + R >= dPrev) {
          en.state = 'done'; sim.bumpT = 0.8; sim.exciteT = 2.2; pushEvent('bump', en);
        }
        continue;
      } else if (cls === 'sniff') {
        if (en.state === 'idle' && ahead < 2.5 && ahead > -1 && Math.abs(en.x - sim.x) < 1.5) {
          en.state = 'active'; sim.sniffT = 2.2; pushEvent('sniff', en);
        }
        continue;
      }
      if (!HAZARD[cls]) continue;
      const row = rows[en.row];
      if (row && pos - en.hd - R <= dist && pos + en.hd + R >= dPrev && !row.hit && (en.state === 'idle' || en.state === 'active')) {
        const hwE = en.hw;
        if (Math.abs(en.x - sim.x) <= hwE + R) {
          row.hit = true; en.state = 'hit'; en.hitT = sim.time;
          sim.hits++; sim.stumble = 0.7; sim.hitSlow = Math.min(sim.hitSlow, 0.2);
          loseCombo();
          pushEvent('hit', en);
        }
      }
    }
    sim.warn = warn;
    while (rowLo < rows.length && rows[rowLo].s + 2.0 < dist) {
      const rw = rows[rowLo++];
      rw.resolved = true;
      if (!rw.hazard) continue;
      sim.passed++;
      if (!rw.hit) {
        sim.avoided++; addCombo();
        for (const en of rw.ents) if (en.state === 'idle' || en.state === 'active') en.state = en.cls === 'crosser' && en.active ? 'active' : 'avoided';
        pushEvent('avoid', rw.ents[0]);
      }
    }
  }

  function result(aborted = false) {
    const total = sim.avoided + sim.hits;
    const avoidRatio = total > 0 ? sim.avoided / total : 0;
    let bonesSeen = 0;
    for (const en of ents) { if (en.cls === 'bone' && en.s - 0.4 <= sim.dist) bonesSeen++; }
    const boneDen = 0.5 * (bonesSeen + sim.bonesTotal); // 骨头比例 = 捡到 /（路过的与全程总数的平均）：跑得慢（一直收紧）只被扣一半
    const boneRatio = boneDen > 0 ? Math.min(1, sim.bones / boneDen) : 0;
    const distRatio = clamp01(sim.dist / sim.maxDistance);
    const comboRatio = Math.min(1, sim.maxCombo / 40);
    const completion = Math.round(100 * (0.4 * avoidRatio + 0.25 * boneRatio + 0.2 * distRatio + 0.15 * comboRatio));
    const stars = completion >= 85 ? 3 : completion >= 65 ? 2 : 1;
    return {
      game: 'walk', completion, stars, tier: stars === 3 ? 'gold' : stars === 2 ? 'silver' : 'bronze',
      avoided: sim.avoided, hits: sim.hits, bones: sim.bones, bonesTotal: sim.bonesTotal,
      distance: Math.round(sim.dist), duration: Math.round(sim.time * 10) / 10, aborted: !!aborted,
      maxCombo: sim.maxCombo, slips: sim.slips, tugs: sim.tugs,
    };
  }

  /** 调试 / 截图用：把游戏快进到 t 秒（用 pilot 自动驾驶） */
  sim.fastForward = (tt, pilot) => {
    const H = 1 / 30;
    while (sim.time < tt && !sim.finished) {
      const cmd = pilot ? pilot(sim) : null;
      update(H, cmd || { hand: 0, grip: false });
    }
  };
  return sim;
}

export default createWalkSim;
