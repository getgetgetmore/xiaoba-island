// “尾巴钓鱼”小游戏的纯逻辑：战利品表、稀有度权重、阶段时长、挣扎节奏、尾巴疼、计分、结算。
// 不依赖 three 渲染、不访问 DOM，可在 Node 里直接跑（scripts/fish-test.mjs）。
//
// 一局固定 CASTS（6）次下钩，每一钩：
//   cast  下钩（小狗把尾巴垂进水里，0.9 秒，点击无效）
//   wait  等鱼（真咬出现前 2–6 秒）。期间可能有 0–2 次“假咬”（尾巴轻轻抖一下，持续 0.5 秒）。
//         等鱼阶段点击（不管是不是假咬）都会把鱼吓跑，这一钩作废（scared）。
//   bite  真咬：尾巴被猛地一拽。提竿窗口 0.5–1.0 秒（越稀有越短）内点击 = 提竿；错过 = 落空（late）。
//   fight 拉扯（最长 5 秒）：按住 = 用力拉，松开 = 放松。水里的东西一阵一阵地挣扎（先有 0.3 秒的“要挣扎了”预兆 warn，再 struggle）：
//         它安静时（calm / warn）按住 → 进度涨；它挣扎时还硬拉 → 尾巴疼涨，涨满 = 小狗嗷一声松开、东西跑了（pain）；
//         松开时尾巴疼快速回落，进度只缓慢倒退。进度满 = 出水。5 秒还没拉上来 = 跑了（timeout）。
//         越稀有：挣扎越频繁、挣扎时间越长、尾巴越容易疼、需要的进度越多。
//   land  出水（东西飞出水面落在岸边，小卡片 + 小狗的反应）；miss 落空后的停顿；prank 大鱼反拉（小狗被拽进池塘，这一钩算落空）。
//
// 输入：update(dt, { click, hold })  click = 本帧是否有一次按下（边沿），hold = 鼠标是否按住。
// 事件（sim.events，由表现层消费后 clearEvents()）：
//   { type: 'cast', index } | 'fake' | 'bite' | 'hook' | 'warn' | 'struggle' | 'calm' | 'scared' | 'late' | 'pain' | 'timeout' |
//   'land' { loot } | 'prank' | 'castEnd' { outcome } | 'finished'
import { clamp } from '../core/util.js';
import { pickMessage as defaultPick } from '../core/messages.js';

export const FISH = {
  CASTS: 6,
  CAST_INTRO: 0.9,
  WAIT: [2, 6],             // 等鱼：从下钩完成到真咬出现
  FAKE_DUR: 0.5,            // 假咬信号持续时间
  FAKE_GAP: 0.8,            // 假咬之间 / 假咬与真咬之间的最小间隔
  FAKE_COUNT: [0.3, 0.8],   // 累计概率：<0.3 → 0 次，<0.8 → 1 次，否则 2 次
  TELEGRAPH: 0.3,           // 挣扎前的预兆
  FIRST_CALM: [0.7, 1.0],   // 刚提竿后的第一段安静
  PAIN_REST: 1.0,           // 松开时尾巴疼回落（每秒）
  PAIN_PULL_CALM: 0.2,      // 安静时按住，尾巴疼也缓慢回落
  PROGRESS_LOSS: 0.04,      // 松开时进度缓慢倒退（每秒）
  FIGHT_MAX: 5.0,
  FIGHT_MIN: 2.0,           // 再快也要拉满 2 秒才出水（进度条停在 99%，东西还在水里扑腾）
  LAND_DUR: 3.2,
  LIFT: 0.62,               // 出水的第一段：东西挂在尾巴上被提出水面（之后才甩到岸上；各 landDur 从甩出去那一刻算起）
  MISS_DUR: { scared: 1.3, late: 1.5, pain: 1.9, timeout: 1.6 },
  PRANK_DUR: 5.0,
  PRANK_AT: [1.1, 1.6],     // 大鱼反拉：提竿后多久把小狗拽进水里
  BOTTLE_CHANCE: 0.04,      // 非“每天第一局”时，每一钩出漂流瓶的概率（每局最多 1 个）
  PRANK_CHANCE: 0.05,       // 每一钩遇到大鱼反拉的概率（每局最多 1 次）
  SCORE: { common: 5, uncommon: 12, rare: 25, special: 15 },
  STAR3: 85, STAR2: 60,
  SCORE_FULL: 60,
};

/** 稀有度：weight = 普通一钩抽到的概率（三档之和为 1；special = 漂流瓶，不参与普通抽取） */
export const RARITY = {
  common: { label: '常见', weight: 0.6, points: 5, window: 1.0, calm: [1.3, 1.8], thrash: [0.6, 0.85], pain: 1.5, need: 1.3 },
  uncommon: { label: '少见', weight: 0.28, points: 12, window: 0.8, calm: [1.0, 1.4], thrash: [0.7, 0.95], pain: 1.7, need: 1.5 },
  rare: { label: '稀有', weight: 0.12, points: 25, window: 0.6, calm: [0.75, 1.05], thrash: [0.8, 1.05], pain: 1.9, need: 1.7 },
  special: { label: '特殊', weight: 0, points: 15, window: 0.9, calm: [1.4, 1.9], thrash: [0.5, 0.7], pain: 1.3, need: 1.2 },
};

/**
 * 战利品表。只能是岛上 / 池塘里本来就可能有的东西。
 * live = 活物（出水后会自己回到水里）；react = 小狗的反应（表现层用）；line = 小卡片上的俏皮话。
 */
export const LOOT = [
  { id: 'goldfish', landDur: 3.8, name: '小金鱼', rarity: 'common', live: true, react: 'look', line: '圆滚滚的小金鱼，吐了个泡泡就游回去啦。' },
  { id: 'weed', landDur: 3.9, name: '水草', rarity: 'common', react: 'shake', line: '缠在尾巴上的水草！甩半天都甩不掉。' },
  { id: 'lotusLeaf', landDur: 3.2, name: '荷叶', rarity: 'common', react: 'look', line: '一片大荷叶，可以当小伞用。' },
  { id: 'lotusPod', landDur: 3.2, name: '莲蓬', rarity: 'common', react: 'look', line: '沉甸甸的莲蓬，里面藏着莲子。' },
  { id: 'pebble', landDur: 3, name: '鹅卵石', rarity: 'common', react: 'sniff', line: '被池水磨得圆圆的小石头，摸起来滑滑的。' },
  { id: 'crab', landDur: 4.5, name: '螃蟹', rarity: 'uncommon', live: true, react: 'crab', line: '夹住尾巴不松手！小柴蹦起来转圈甩掉了它。' },
  { id: 'frog', landDur: 4.4, name: '青蛙', rarity: 'uncommon', live: true, react: 'frog', line: '呱！它在小柴头上蹲了一会儿，才跳回水里。' },
  { id: 'loach', landDur: 3.8, name: '泥鳅', rarity: 'uncommon', live: true, react: 'sniff', line: '滑溜溜的泥鳅，从爪子底下溜走了。' },
  { id: 'clam', landDur: 3.2, name: '河蚌', rarity: 'uncommon', react: 'look', line: '紧紧闭着壳的河蚌，里面在想什么呢？' },
  { id: 'koi', landDur: 4, name: '金色锦鲤', rarity: 'rare', live: true, react: 'happy', line: '闪闪发光的锦鲤！今天一定会有好运。' },
  { id: 'twig', landDur: 3.9, name: '丢失的树枝', rarity: 'rare', react: 'happy', line: '小柴之前丢的树枝！失而复得，狂喜转圈。' },
  { id: 'pearlClam', landDur: 4.9, name: '珍珠河蚌', rarity: 'rare', react: 'pearl', line: '壳一打开——里面有一颗亮晶晶的珍珠！' },
  { id: 'bottle', landDur: 4, name: '漂流瓶', rarity: 'special', react: 'bottle', line: '一只漂流瓶，里面好像卷着一张小纸条。' },
];
export const LOOT_BY_ID = Object.fromEntries(LOOT.map((l) => [l.id, l]));
/** 大鱼反拉（恶搞事件）：不是战利品，没有分值 */
export const PRANK = { id: 'bigfish', name: '大鱼', rarity: 'prank', line: '大鱼把小柴拽下水了！' };
/** 战利品表允许出现的全部 id（测试用：不允许出现人的生活用品） */
export const LOOT_IDS = LOOT.map((l) => l.id);

const NORMAL = LOOT.filter((l) => l.rarity !== 'special');

export function lootStats(def) {
  const r = RARITY[def.rarity] || RARITY.common;
  return {
    window: def.window || r.window, calm: def.calm || r.calm, thrash: def.thrash || r.thrash,
    pain: def.pain || r.pain, need: def.need || r.need,
  };
}

export function createFishSim({ rng = Math.random, casts = FISH.CASTS, forceBottle = false, allowPrank = true, date, seen, pickMessage = defaultPick, test = {} } = {}) {
  const rand = (a, b) => a + (b - a) * rng();
  const sim = {
    casts, cast: -1, phase: 'cast', t: 0,
    // 当前一钩
    loot: null, prank: false, wait: 0, fakeCount: 0, fake: false, real: false,
    window: 0, windowDur: 0, progress: 0, pain: 0, struggle: false, warn: false, fightT: 0, need: 1,
    // 一局的累计
    caught: [], score: 0, landed: 0, missed: 0, scared: 0, pranks: 0, bottle: null, bottles: 0, finished: false,
    log: [], events: [], forceBottle: !!forceBottle,
    update, result, clearEvents, forceNext, forceNow, startCast,
    /** 调试：下一钩（及以后依次）钓到什么：战利品 id 或 'prank' */
    queue: [],
    holding: false,
  };

  let pranksLeft = allowPrank ? 1 : 0;
  let bottleDone = false;
  const bottleIdx = forceBottle && casts > 1 ? Math.floor(rng() * (casts - 1)) : forceBottle ? 0 : -1; // 不放在最后一钩
  let rec = null;                       // 当前一钩的记录
  let fakes = [];                       // 假咬的开始时间
  let fakeI = 0;
  let mode = 'calm', modeT = 0, modeDur = 1; // fight 内部：calm / tele / thrash
  let prankAt = 1.3;
  let endDur = 1;                       // land / miss / prank 的停留时间

  function ev(type, extra) { const e = { type }; if (extra) Object.assign(e, extra); sim.events.push(e); }
  function clearEvents() { sim.events.length = 0; }
  function forceNext(id) { sim.queue.push(id); }
  /** 调试：把“当前这一钩”改成指定的战利品（只在还没提竿时有效：cast / wait / bite）；已经在拉扯 / 结算时改为排到下一钩 */
  function forceNow(id) {
    if (sim.finished || !rec || !(sim.phase === 'cast' || sim.phase === 'wait' || sim.phase === 'bite')) { sim.queue.push(id); return false; }
    const isPrank = id === 'prank';
    const def = isPrank ? PRANK : LOOT_BY_ID[id];
    if (!def) return false;
    sim.prank = isPrank; sim.loot = def;
    const st = isPrank ? lootStats({ rarity: 'rare' }) : lootStats(def);
    sim.windowDur = isPrank ? 0.7 : st.window; sim.need = st.need;
    if (sim.phase === 'bite') sim.window = Math.min(sim.window + 0.0, sim.windowDur);
    rec.id = def.id; rec.rarity = def.rarity; rec.prank = isPrank; rec.windowDur = sim.windowDur;
    return true;
  }

  // ------------------------------------------------------------ 每一钩的抽取
  function pickLoot() {
    const forced = sim.queue.shift();
    if (forced === 'prank') return { prank: true, def: PRANK };
    if (forced && LOOT_BY_ID[forced]) return { def: LOOT_BY_ID[forced] };
    const i = sim.cast;
    if (!bottleDone && ((i === bottleIdx) || (bottleIdx < 0 && rng() < FISH.BOTTLE_CHANCE))) { bottleDone = true; return { def: LOOT_BY_ID.bottle }; }
    if (pranksLeft > 0 && rng() < FISH.PRANK_CHANCE) { pranksLeft--; return { prank: true, def: PRANK }; }
    // 稀有度按权重抽，再在该档里等概率
    let r = rng(), rar = 'rare';
    for (const k of ['common', 'uncommon', 'rare']) { r -= RARITY[k].weight; if (r < 0) { rar = k; break; } }
    const pool = NORMAL.filter((l) => l.rarity === rar);
    return { def: pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))] };
  }

  function startCast() {
    sim.cast++;
    if (sim.cast >= casts) { sim.phase = 'done'; sim.finished = true; ev('finished'); return; }
    const pk = pickLoot();
    sim.prank = !!pk.prank;
    sim.loot = pk.def;
    sim.phase = 'cast'; sim.t = 0;
    sim.fake = false; sim.real = false; sim.warn = false; sim.struggle = false;
    sim.progress = 0; sim.pain = 0; sim.fightT = 0; sim.window = 0; sim.holding = false;
    const st = pk.prank ? { window: 0.7, ...lootStats({ rarity: 'rare' }) } : lootStats(pk.def);
    sim.windowDur = pk.prank ? 0.7 : st.window;
    sim.need = st.need;
    // 等鱼时间与假咬（特殊的漂流瓶不假咬）
    sim.wait = rand(FISH.WAIT[0], FISH.WAIT[1]);
    fakes = []; fakeI = 0;
    const r = rng();
    let n = r < FISH.FAKE_COUNT[0] ? 0 : r < FISH.FAKE_COUNT[1] ? 1 : 2;
    if (pk.def.id === 'bottle') n = 0;
    if (test.noFake) n = 0;
    if (test.fakes !== undefined) n = test.fakes;
    // 在 [0.6, wait - 0.9] 里放 n 个假咬，彼此相隔至少 FAKE_DUR + FAKE_GAP
    const lo = 0.6, hi = sim.wait - FISH.FAKE_DUR - FISH.FAKE_GAP;
    for (let k = 0; k < n; k++) {
      const a = lo + k * (FISH.FAKE_DUR + FISH.FAKE_GAP), b = hi - (n - 1 - k) * (FISH.FAKE_DUR + FISH.FAKE_GAP);
      if (b < a) break;
      fakes.push(rand(a, Math.max(a, Math.min(b, a + 1.8))));
    }
    sim.fakeCount = fakes.length;
    rec = { i: sim.cast, id: pk.def.id, rarity: pk.def.rarity, prank: !!pk.prank, wait: sim.wait, fakes: fakes.length, windowDur: sim.windowDur, hooked: false, windowUsed: 0, fight: 0, outcome: '', reason: '' };
    sim.log.push(rec);
    ev('cast', { index: sim.cast });
  }

  // ------------------------------------------------------------ 拉扯
  function startFight() {
    sim.phase = 'fight'; sim.t = 0; sim.fightT = 0; sim.progress = 0; sim.pain = 0;
    sim.real = false; sim.fake = false;
    rec.hooked = true; rec.windowUsed = sim.windowDur - sim.window;
    mode = 'calm'; modeT = 0;
    const st = sim.prank ? lootStats({ rarity: 'rare' }) : lootStats(sim.loot);
    modeDur = rand(FISH.FIRST_CALM[0], FISH.FIRST_CALM[1]);
    prankAt = rand(FISH.PRANK_AT[0], FISH.PRANK_AT[1]);
    sim.warn = false; sim.struggle = false;
    fightSt = st;
    ev('hook');
  }
  let fightSt = lootStats(LOOT[0]);

  function nextMode() {
    if (mode === 'calm') { mode = 'tele'; modeDur = FISH.TELEGRAPH; sim.warn = true; ev('warn'); }
    else if (mode === 'tele') { mode = 'thrash'; modeDur = rand(fightSt.thrash[0], fightSt.thrash[1]); sim.warn = false; sim.struggle = true; ev('struggle'); }
    else { mode = 'calm'; modeDur = rand(fightSt.calm[0], fightSt.calm[1]); sim.struggle = false; ev('calm'); }
    modeT = 0;
  }

  function fightStep(h, hold) {
    sim.fightT += h; sim.t = sim.fightT;
    modeT += h;
    while (modeT >= modeDur) { modeT -= modeDur; nextMode(); }
    sim.holding = hold;
    if (sim.prank) {
      // 大鱼：一上来就猛拽，按什么都躲不掉（不会尾巴疼，也拉不上来）
      sim.struggle = sim.fightT > prankAt - 0.5; sim.warn = false;
      sim.progress = clamp(sim.fightT / prankAt * 0.5, 0, 0.5);
      if (sim.fightT >= prankAt) {
        sim.phase = 'prank'; sim.t = 0; sim.struggle = false; sim.pranks++;
        rec.fight = sim.fightT; rec.outcome = 'missed'; rec.reason = 'prank';
        sim.missed++; endDur = FISH.PRANK_DUR;
        ev('prank');
      }
      return;
    }
    if (mode === 'thrash') {
      if (hold) sim.pain += fightSt.pain * h;
      else { sim.pain -= FISH.PAIN_REST * h; sim.progress -= FISH.PROGRESS_LOSS * 0.5 * h; }
    } else if (hold) {
      sim.progress += h / fightSt.need;
      sim.pain -= FISH.PAIN_PULL_CALM * h;
    } else {
      sim.pain -= FISH.PAIN_REST * h;
      sim.progress -= FISH.PROGRESS_LOSS * h;
    }
    sim.pain = clamp(sim.pain, 0, 1.0001);
    if (sim.fightT < FISH.FIGHT_MIN) sim.progress = Math.min(sim.progress, 0.99);
    sim.progress = clamp(sim.progress, 0, 1);
    if (sim.pain >= 1) return endMiss('pain');
    if (sim.progress >= 1) {
      sim.progress = 1;
      const def = sim.loot;
      const pts = (RARITY[def.rarity] || RARITY.common).points;
      let note = null;
      if (def.id === 'bottle') {
        note = pickMessage({ rng, date, seen });
        sim.bottle = note; sim.bottles++;
      }
      const entry = { id: def.id, name: def.name, rarity: def.rarity, points: pts };
      sim.caught.push(entry);
      sim.score += pts; sim.landed++;
      rec.fight = sim.fightT; rec.outcome = 'landed';
      sim.phase = 'land'; sim.t = 0; sim.struggle = false; sim.warn = false;
      endDur = (def.landDur || FISH.LAND_DUR) + FISH.LIFT;
      ev('land', { loot: entry, note });
      return;
    }
    if (sim.fightT >= FISH.FIGHT_MAX) endMiss('timeout');
  }

  function endMiss(reason) {
    sim.phase = 'miss'; sim.t = 0; sim.missed++;
    sim.fake = false; sim.real = false; sim.warn = false; sim.struggle = false;
    if (rec) { rec.outcome = 'missed'; rec.reason = reason; if (rec.hooked) rec.fight = sim.fightT; }
    if (reason === 'scared') sim.scared++;
    endDur = FISH.MISS_DUR[reason] || 1.4;
    ev(reason);
  }

  // ------------------------------------------------------------ 主更新
  function step(h, click, hold) {
    sim.t += sim.phase === 'fight' ? 0 : h;
    switch (sim.phase) {
      case 'cast':
        if (sim.t >= FISH.CAST_INTRO) { sim.phase = 'wait'; sim.t = 0; }
        break;
      case 'wait': {
        if (click) { endMiss('scared'); break; }
        // 假咬：到点就抖一下，持续 FAKE_DUR
        if (fakeI < fakes.length && sim.t >= fakes[fakeI] && !sim.fake) { sim.fake = true; ev('fake'); }
        if (sim.fake && sim.t >= fakes[fakeI] + FISH.FAKE_DUR) { sim.fake = false; fakeI++; }
        if (sim.t >= sim.wait) {
          sim.fake = false;
          sim.phase = 'bite'; sim.t = 0; sim.real = true; sim.window = sim.windowDur;
          ev('bite');
        }
        break;
      }
      case 'bite':
        sim.window -= h;
        if (click) { startFight(); break; }
        if (sim.window <= 0) { sim.window = 0; endMiss('late'); }
        break;
      case 'fight':
        fightStep(h, hold);
        break;
      case 'land': case 'miss': case 'prank':
        if (sim.t >= endDur) {
          ev('castEnd', { outcome: sim.phase === 'land' ? 'landed' : 'missed' });
          startCast();
        }
        break;
      default:
        break;
    }
  }

  function update(dt, input = {}) {
    if (sim.finished) return;
    if (sim.cast < 0) startCast();
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
    let click = !!input.click;
    const hold = !!input.hold || (click && sim.phase !== 'wait' && sim.phase !== 'cast');
    const n = Math.max(1, Math.ceil(dt / 0.034));
    const h = dt / n;
    for (let i = 0; i < n && !sim.finished; i++) { step(h, click, hold); click = false; }
  }

  function result(aborted = false) {
    const landed = sim.landed;
    const completion = Math.round(100 * (0.7 * (landed / casts) + 0.3 * Math.min(1, sim.score / FISH.SCORE_FULL)));
    const stars = completion >= FISH.STAR3 ? 3 : completion >= FISH.STAR2 ? 2 : 1;
    return {
      game: 'fishing', completion, stars, tier: stars === 3 ? 'gold' : stars === 2 ? 'silver' : 'bronze',
      score: sim.score, casts, landed, missed: casts - landed,
      catches: sim.caught.map((c) => ({ ...c })), bottle: sim.bottle || null, prank: sim.pranks > 0, aborted: !!aborted,
    };
  }

  startCast();
  return sim;
}

export default createFishSim;
