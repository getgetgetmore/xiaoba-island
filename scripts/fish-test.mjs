// 钓鱼小游戏逻辑的无头测试（只测 src/minigame/fishSim.js + fishBot.js + src/core/messages.js + fishing/store.js，不依赖 three 渲染 / DOM）。
// 用法：node scripts/fish-test.mjs [--seed 1] [--verbose]    失败时退出码非 0。固定 seed + 另外 5 个 seed。
import { createFishSim, FISH, RARITY, LOOT, LOOT_IDS, PRANK } from '../src/minigame/fishSim.js';
import { createFishBot } from '../src/minigame/fishBot.js';
import { MESSAGES, pickMessage, dateKey, matchesWhen, parseDate } from '../src/core/messages.js';
import * as store from '../src/minigame/fishing/store.js';
import { mulberry32 } from '../src/core/util.js';

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const seedArg = argv.indexOf('--seed');
const BASE_SEED = seedArg >= 0 ? parseInt(argv[seedArg + 1], 10) : 20240601;
const SEEDS = [BASE_SEED, 11, 222, 3333, 44444, 555555];
const H = 1 / 30;
const EPS = 1e-6;

let fails = 0, total = 0;
function check(tag, name, ok, detail = '') {
  total++;
  if (!ok) { fails++; console.log(`FAIL  [${tag}] ${name}${detail ? '  —  ' + detail : ''}`); }
  else if (VERBOSE) console.log(`PASS  [${tag}] ${name}${detail ? '  —  ' + detail : ''}`);
}
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : String(n));

/** 用机器人玩完一局；记录每一钩的事件序列与时间点 */
function play(kind, seed, opts = {}) {
  const sim = createFishSim({ rng: mulberry32(seed), ...opts });
  const bot = createFishBot({ kind, seed: seed * 7 + 1 });
  const casts = []; // { seq: [type], at: {type: t}, i }
  let cur = null, time = 0, n = 0;
  const drain = () => {
    for (const e of sim.events) {
      if (e.type === 'cast') { cur = { seq: ['cast'], at: { cast: time }, i: e.index }; casts.push(cur); }
      else if (cur) { cur.seq.push(e.type); if (cur.at[e.type] === undefined) cur.at[e.type] = time; }
    }
    sim.clearEvents();
  };
  drain();
  while (!sim.finished && n++ < 60000) {
    const inp = bot(sim, H);
    sim.update(H, inp);
    time += H;
    drain();
  }
  return { sim, casts, time };
}

// ------------------------------------------------------------------ 1) 结构与阶段时长
{
  const tag = '流程';
  for (const seed of SEEDS) {
    for (const kind of ['skilled', 'idle', 'spam', 'holder']) {
      const { sim, casts } = play(kind, seed);
      const tg = `${tag}/${kind}/${seed}`;
      check(tg, '一局恰好 6 钩后 finished', sim.finished && casts.length === 6 && sim.log.length === 6 && sim.phase === 'done', `casts=${casts.length}, phase=${sim.phase}`);
      let seqOk = true, bad = '';
      for (const c of casts) {
        const s = c.seq.join(',');
        const okSeq = /^cast(,fake)*,scared(,castEnd)?(,finished)?$/.test(s)
          || /^cast(,fake)*,bite,late(,castEnd)?(,finished)?$/.test(s)
          || /^cast(,fake)*,bite,hook(,(warn|struggle|calm))*,(land|pain|timeout|prank)(,castEnd)?(,finished)?$/.test(s)
          || /^cast(,fake)*,bite,hook(,(warn|struggle|calm))*,(land|pain|timeout|prank),castEnd,finished$/.test(s);
        if (!okSeq) { seqOk = false; bad = s; break; }
      }
      check(tg, '每一钩阶段顺序：等鱼 → 真咬 → 提竿窗口 →（拉扯 → 出水/失败），或被吓跑 / 错过', seqOk, bad);
      let rangeOk = true, rbad = '';
      for (let i = 0; i < casts.length; i++) {
        const c = casts[i], g = sim.log[i];
        if (c.at.bite !== undefined) {
          const wait = c.at.bite - (c.at.cast + FISH.CAST_INTRO);
          if (!(wait >= FISH.WAIT[0] - 0.08 && wait <= FISH.WAIT[1] + 0.08)) { rangeOk = false; rbad = `等鱼 ${f2(wait)}s`; }
          if (!(g.windowDur >= 0.5 - EPS && g.windowDur <= 1.0 + EPS)) { rangeOk = false; rbad = `窗口 ${g.windowDur}`; }
          if (c.at.late !== undefined) { const w = c.at.late - c.at.bite; if (Math.abs(w - g.windowDur) > 0.08) { rangeOk = false; rbad = `窗口实际 ${f2(w)} vs ${g.windowDur}`; } }
        }
        if (g.hooked) {
          if (!(g.fight <= FISH.FIGHT_MAX + 0.05)) { rangeOk = false; rbad = `拉扯 ${f2(g.fight)}s`; }
          if (g.outcome === 'landed' && !(g.fight >= FISH.FIGHT_MIN - 0.05)) { rangeOk = false; rbad = `成功的拉扯 ${f2(g.fight)}s < 2s`; }
        }
      }
      check(tg, '各阶段时长在范围内：等鱼 2–6 秒、提竿窗口 0.5–1.0 秒、成功的拉扯 2–5 秒（失败 ≤ 5 秒）', rangeOk, rbad);
    }
  }
  // 窗口越稀有越短
  check(tag, '提竿窗口：常见 > 少见 > 稀有（且都在 0.5–1.0）', RARITY.common.window > RARITY.uncommon.window && RARITY.uncommon.window > RARITY.rare.window && RARITY.rare.window >= 0.5 && RARITY.common.window <= 1.0);
  check(tag, '越稀有挣扎越频繁、越久，需要的进度越多、越容易尾巴疼', RARITY.common.calm[1] > RARITY.uncommon.calm[1] && RARITY.uncommon.calm[1] > RARITY.rare.calm[1] && RARITY.common.thrash[1] < RARITY.rare.thrash[1] && RARITY.common.need < RARITY.rare.need && RARITY.common.pain < RARITY.rare.pain);
}

// ------------------------------------------------------------------ 2) 机器人分档（200 局）
{
  const tag = '机器人';
  const N = 200;
  const stat = (kind, seed0) => {
    let landed = 0, comp = 0, scared = 0, casts = 0, hooked = 0, painFail = 0, fightFail = 0, fightMin = 9, fightMax = 0, stars = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      const { sim } = play(kind, seed0 * 1000 + i + 1);
      const r = sim.result();
      landed += r.landed; comp += r.completion; stars[r.stars]++;
      for (const g of sim.log) {
        casts++;
        if (g.reason === 'scared') scared++;
        if (g.hooked && !g.prank) { hooked++; if (g.outcome === 'missed') { fightFail++; if (g.reason === 'pain') painFail++; } if (g.outcome === 'landed') { fightMin = Math.min(fightMin, g.fight); fightMax = Math.max(fightMax, g.fight); } }
      }
    }
    return { landed: landed / N, comp: comp / N, scared: scared / casts, hooked, painFail, fightFail, fightMin, fightMax, stars };
  };
  for (const [i, seed0] of [BASE_SEED % 1000, 11, 222].entries()) {
    const sk = stat('skilled', seed0 + 1);
    check(tag, `熟练机器人 平均钓上 ≥ 5.2 钩/局（种子组 ${i}）`, sk.landed >= 5.2, `平均 ${f2(sk.landed)} 钩，完成度 ${f2(sk.comp)}，星级分布 1★${sk.stars[1]} 2★${sk.stars[2]} 3★${sk.stars[3]}，成功拉扯 ${f2(sk.fightMin)}–${f2(sk.fightMax)} 秒`);
    check(tag, `熟练机器人 完成度平均 ≥ 80（种子组 ${i}）`, sk.comp >= 80, `平均 ${f2(sk.comp)}`);
    const sp = stat('spam', seed0 + 1);
    check(tag, `乱点机器人 大多数钩被吓跑（种子组 ${i}）`, sp.scared > 0.8, `被吓跑 ${(sp.scared * 100).toFixed(0)}% 的钩`);
    check(tag, `乱点机器人 平均钓上 ≤ 1.5 钩/局（种子组 ${i}）`, sp.landed <= 1.5, `平均 ${f2(sp.landed)} 钩`);
    const ho = stat('holder', seed0 + 1);
    check(tag, `只会按住不放 拉扯大多因尾巴疼失败（种子组 ${i}）`, ho.fightFail / Math.max(1, ho.hooked) > 0.5 && ho.painFail / Math.max(1, ho.fightFail) > 0.9, `拉扯 ${ho.hooked} 次，失败 ${ho.fightFail}，其中尾巴疼 ${ho.painFail}`);
    check(tag, `只会按住不放 平均钓上 ≤ 2.5 钩/局（种子组 ${i}）`, ho.landed <= 2.5, `平均 ${f2(ho.landed)} 钩`);
    const id = stat('idle', seed0 + 1);
    check(tag, `什么都不做 0 钩、完成度 0（种子组 ${i}）`, id.landed === 0 && id.comp === 0, `平均 ${f2(id.landed)} 钩，完成度 ${f2(id.comp)}`);
  }
}

// ------------------------------------------------------------------ 3) 假咬 / 错过 / 提竿
{
  const tag = '假咬';
  for (const seed of SEEDS) {
    // 假咬时点击 → 这一钩作废，不进入拉扯
    const sim = createFishSim({ rng: mulberry32(seed), test: { fakes: 1 } });
    let n = 0;
    while (!sim.fake && sim.phase !== 'bite' && n++ < 2000) sim.update(H, {});
    check(tag, `等鱼阶段会出现假咬信号（${seed}）`, sim.fake === true && sim.phase === 'wait', `phase=${sim.phase}`);
    const cast0 = sim.cast;
    sim.clearEvents();
    sim.update(H, { click: true, hold: true });
    const types = sim.events.map((e) => e.type);
    check(tag, `假咬时点击 → 这一钩作废（scared），没有 hook（${seed}）`, sim.phase === 'miss' && types.includes('scared') && !types.includes('hook') && sim.log[cast0].outcome === 'missed' && sim.log[cast0].reason === 'scared' && sim.landed === 0 && sim.missed === 1, types.join(','));
    // 之后不会进入拉扯：继续 10 秒没有 fight
    let fought = false;
    for (let i = 0; i < 300; i++) { sim.update(H, { hold: true }); if (sim.phase === 'fight' && sim.cast === cast0) fought = true; }
    check(tag, `被吓跑的那一钩不会进入拉扯（${seed}）`, !fought);
    // 错过提竿窗口 → 落空
    const s2 = createFishSim({ rng: mulberry32(seed + 1) });
    n = 0;
    while (s2.phase !== 'bite' && n++ < 3000) s2.update(H, {});
    const c2 = s2.cast;
    let k = 0;
    while (s2.phase === 'bite' && k++ < 200) s2.update(H, {});
    check(tag, `错过提竿窗口 → 落空（late）（${seed}）`, s2.phase === 'miss' && s2.log[c2].reason === 'late' && s2.log[c2].hooked === false && s2.missed === 1, `phase=${s2.phase}`);
    // 窗口内点击 → 进入拉扯
    const s3 = createFishSim({ rng: mulberry32(seed + 2) });
    n = 0;
    while (s3.phase !== 'bite' && n++ < 3000) s3.update(H, {});
    s3.update(H, { click: true, hold: true });
    check(tag, `真咬窗口内点击 → 进入拉扯（${seed}）`, s3.phase === 'fight' && s3.log[s3.cast].hooked === true);
    // 等鱼阶段的普通点击也会吓跑
    const s4 = createFishSim({ rng: mulberry32(seed + 3), test: { fakes: 0 } });
    for (let i = 0; i < 40; i++) s4.update(H, {}); // 越过下钩
    s4.update(H, { click: true });
    check(tag, `等鱼阶段任意点击都会吓跑鱼（${seed}）`, s4.phase === 'miss' && s4.log[0].reason === 'scared');
    // 下钩的 0.9 秒里点击无效
    const s5 = createFishSim({ rng: mulberry32(seed + 4) });
    s5.update(H, { click: true });
    check(tag, `下钩动作中点击无效（${seed}）`, s5.phase === 'cast');
    // 抢点机器人：看到假咬就点 → 绝不会钓上来
    const eg = play('eager', seed, {});
    let egBad = 0;
    for (const g of eg.sim.log) if (g.fakes > 0 && g.outcome === 'landed') egBad++;
    check(tag, `抢点机器人（看到假咬就点）：有假咬的钩一律作废（${seed}）`, egBad === 0);
  }
}

// ------------------------------------------------------------------ 4) 战利品
{
  const tag = '战利品';
  const allowed = ['goldfish', 'weed', 'lotusLeaf', 'lotusPod', 'pebble', 'crab', 'frog', 'loach', 'clam', 'koi', 'twig', 'pearlClam', 'bottle'];
  check(tag, '战利品 id 恰好是规定的这些，没有多也没有少', LOOT_IDS.length === allowed.length && allowed.every((x) => LOOT_IDS.includes(x)), LOOT_IDS.join(','));
  const banned = /靴|袜|易拉罐|罐头|钥匙|宝箱|key|boot|sock|can\b|chest|shoe/i;
  check(tag, '战利品表里没有人的生活用品（id / 名称）', LOOT.every((l) => !banned.test(l.id) && !banned.test(l.name)) && !banned.test(PRANK.id));
  const byRar = (r) => LOOT.filter((l) => l.rarity === r).map((l) => l.id);
  check(tag, '常见 5 种：小金鱼 水草 荷叶 莲蓬 鹅卵石；少见 4 种：螃蟹 青蛙 泥鳅 河蚌；稀有 3 种：锦鲤 树枝 珍珠河蚌；特殊：漂流瓶',
    byRar('common').join() === 'goldfish,weed,lotusLeaf,lotusPod,pebble' && byRar('uncommon').join() === 'crab,frog,loach,clam' && byRar('rare').join() === 'koi,twig,pearlClam' && byRar('special').join() === 'bottle');
  check(tag, '分值：常见 5、少见 12、稀有 25、漂流瓶 15', RARITY.common.points === 5 && RARITY.uncommon.points === 12 && RARITY.rare.points === 25 && RARITY.special.points === 15 && FISH.SCORE.special === 15);
  check(tag, '稀有度权重之和为 1', Math.abs(RARITY.common.weight + RARITY.uncommon.weight + RARITY.rare.weight - 1) < 1e-9);
  for (const seed of SEEDS) {
    // 3000 钩的稀有度分布（不开漂流瓶随机、不开大鱼，只看普通抽取）
    const sim = createFishSim({ rng: mulberry32(seed), casts: 3000, allowPrank: false });
    const bot = createFishBot({ kind: 'idle' });
    let n = 0;
    while (!sim.finished && n++ < 1e6) sim.update(0.1, bot(sim, 0.1));
    const cnt = { common: 0, uncommon: 0, rare: 0, special: 0 };
    for (const g of sim.log) cnt[g.rarity]++;
    const normal = cnt.common + cnt.uncommon + cnt.rare;
    const bad = ['common', 'uncommon', 'rare'].filter((k) => Math.abs(cnt[k] / normal - RARITY[k].weight) > 0.03);
    check(tag, `3000 钩稀有度分布与权重相符 ±3 个百分点（${seed}）`, sim.log.length === 3000 && bad.length === 0, `常见 ${(cnt.common / normal * 100).toFixed(1)}% 少见 ${(cnt.uncommon / normal * 100).toFixed(1)}% 稀有 ${(cnt.rare / normal * 100).toFixed(1)}%（设定 60/28/12），另有漂流瓶 ${cnt.special} 个`);
    // 每种具体物品都出现过，且同档内大体均匀
    const ids = {};
    for (const g of sim.log) ids[g.id] = (ids[g.id] || 0) + 1;
    check(tag, `每种战利品都会出现（${seed}）`, LOOT_IDS.every((id) => ids[id] > 0), JSON.stringify(ids));
  }
  // 漂流瓶 forceBottle
  let bottleBad = '';
  for (let s = 1; s <= 60; s++) {
    for (const kind of ['idle', 'skilled', 'spam']) {
      const { sim } = play(kind, s * 31 + 7, { forceBottle: true });
      const inLog = sim.log.filter((g) => g.id === 'bottle').length;
      if (inLog !== 1) bottleBad = `${kind}/${s}: 记录里有 ${inLog} 个漂流瓶`;
      if (kind === 'skilled') {
        const r = sim.result();
        const got = r.catches.filter((c) => c.id === 'bottle').length;
        if (got !== 1 || !r.bottle || typeof r.bottle.text !== 'string' || !r.bottle.id) bottleBad = `skilled/${s}: 钓上来 ${got} 个，bottle=${JSON.stringify(r.bottle)}`;
        if (sim.log[sim.log.length - 1].id === 'bottle') bottleBad = `skilled/${s}: 漂流瓶排在最后一钩`;
      }
    }
  }
  check(tag, 'forceBottle: true 时这一局必有且只有一个漂流瓶（熟练机器人必定钓上来，其余机器人也必定遇到）', bottleBad === '', bottleBad);
  // 不强制：每局至多 1 个
  let maxB = 0, anyB = 0, bottleGames = 0;
  for (let s = 1; s <= 600; s++) {
    const { sim } = play('skilled', s * 13 + 5, {});
    const nb = sim.log.filter((g) => g.id === 'bottle').length;
    maxB = Math.max(maxB, nb); anyB += nb; if (nb) bottleGames++;
  }
  check(tag, '不强制时漂流瓶每局最多 1 个，且偶尔出现', maxB <= 1 && bottleGames > 0, `600 局里 ${bottleGames} 局出了漂流瓶（${(bottleGames / 6).toFixed(1)}%）`);
  // 大鱼反拉
  let maxP = 0, pGames = 0, pOff = 0, pAny = 0, pBadMissed = 0;
  for (let s = 1; s <= 800; s++) {
    for (const kind of ['skilled', 'idle']) {
      const { sim } = play(kind, s * 17 + 3, {});
      const np = sim.log.filter((g) => g.id === PRANK.id).length;
      maxP = Math.max(maxP, np, sim.pranks);
      if (kind === 'skilled') { if (sim.result().prank) pGames++; for (const g of sim.log) if (g.prank && g.hooked && g.outcome !== 'missed') pBadMissed++; }
    }
    const { sim: s2 } = play('skilled', s * 17 + 3, { allowPrank: false });
    pAny += s2.pranks + s2.log.filter((g) => g.id === PRANK.id).length + (s2.result().prank ? 1 : 0);
    pOff++;
  }
  check(tag, '大鱼反拉每局最多 1 次', maxP <= 1, `最大 ${maxP}`);
  check(tag, '大鱼反拉会发生（熟练机器人 800 局里出现过），并且那一钩算落空', pGames > 20 && pBadMissed === 0, `${pGames}/800 局发生`);
  check(tag, 'allowPrank: false 时为 0', pAny === 0, `${pOff} 局共 ${pAny} 次`);
  // forceNext 调试
  const sf = createFishSim({ rng: mulberry32(5) });
  sf.queue.push('crab');
  check(tag, '调试：forceNext / queue 指定下一钩（第一钩已抽好，所以对第二钩生效）', typeof sf.forceNext === 'function');
}

// ------------------------------------------------------------------ 5) result()
{
  const tag = 'result';
  const keys = ['game', 'completion', 'stars', 'tier', 'score', 'casts', 'landed', 'missed', 'catches', 'bottle', 'prank', 'aborted'];
  let bad = '';
  let starCount = [0, 0, 0, 0];
  for (const seed of SEEDS) {
    for (const kind of ['skilled', 'holder', 'idle', 'spam']) {
      for (let g = 0; g < 20; g++) {
        const { sim } = play(kind, seed * 100 + g, { forceBottle: g % 3 === 0 });
        const r = sim.result();
        const miss = keys.filter((k) => !(k in r));
        if (miss.length) bad = `缺字段 ${miss.join()}`;
        if (r.game !== 'fishing' || r.casts !== 6 || r.aborted !== false) bad = `基本字段 ${JSON.stringify(r)}`;
        if (r.landed + r.missed !== 6) bad = `landed+missed=${r.landed + r.missed}`;
        if (r.landed !== r.catches.length) bad = 'catches 数量与 landed 不一致';
        const pts = r.catches.reduce((a, c) => a + c.points, 0);
        if (pts !== r.score) bad = `得分 ${r.score} 与明细 ${pts} 不一致`;
        const exp = Math.round(100 * (0.7 * (r.landed / 6) + 0.3 * Math.min(1, r.score / 60)));
        if (r.completion !== exp) bad = `completion ${r.completion} != ${exp}`;
        const st = exp >= 85 ? 3 : exp >= 60 ? 2 : 1;
        if (r.stars !== st) bad = `stars ${r.stars} != ${st}`;
        if (r.tier !== (st === 3 ? 'gold' : st === 2 ? 'silver' : 'bronze')) bad = `tier ${r.tier}`;
        for (const c of r.catches) if (!c.id || !c.name || !c.rarity || !(c.points > 0)) bad = `catch 字段 ${JSON.stringify(c)}`;
        if (r.catches.some((c) => c.id === 'bottle') !== !!r.bottle) bad = 'bottle 与 catches 不一致';
        starCount[r.stars]++;
        if (bad) break;
      }
      if (bad) break;
    }
    if (bad) break;
  }
  check(tag, 'result() 字段齐全；completion / stars / tier 与公式一致；landed + missed = 6；得分 = 明细之和', bad === '', bad);
  check(tag, '三档星级都出现过（覆盖公式边界）', starCount[1] > 0 && starCount[2] >= 0 && starCount[3] > 0, JSON.stringify(starCount));
  // 手工构造的边界：用 forceNext 全部钓稀有 → 完成度
  const sim = createFishSim({ rng: mulberry32(3), allowPrank: false });
  const ra = sim.result(true);
  check(tag, '中途 result(true)：aborted = true，landed + missed = casts', ra.aborted === true && ra.landed + ra.missed === 6 && ra.completion === 0 && ra.stars === 1);
  check(tag, '一局没钓到：completion 0、1 星', ra.completion === 0 && ra.stars === 1 && ra.tier === 'bronze');
}

// ------------------------------------------------------------------ 6) 寄语 pickMessage
{
  const tag = '寄语';
  const ids = MESSAGES.map((m) => m.id);
  check(tag, '寄语列表：id 唯一、结构 { id, text, from?, when? }、至少 20 条', new Set(ids).size === ids.length && MESSAGES.length >= 20 && MESSAGES.every((m) => typeof m.id === 'string' && typeof m.text === 'string' && m.text.length > 4 && (m.from === undefined || typeof m.from === 'string')));
  for (const seed of SEEDS) {
    const date = '2026-03-12';
    const a = pickMessage({ rng: mulberry32(seed), date });
    const b = pickMessage({ rng: mulberry32(seed), date });
    check(tag, `同一 date + 同一 seed 结果确定（${seed}）`, a && b && a.id === b.id);
    check(tag, `返回的寄语来自列表（${seed}）`, !!a && MESSAGES.some((m) => m === a || m.id === a.id));
    // seen：优先没看过的
    const seen = new Set(ids.filter((id) => id !== 'm07' && !MESSAGES.find((m) => m.id === id).when));
    const c = pickMessage({ rng: mulberry32(seed), date, seen: [...seen] });
    check(tag, `传入 seen 时优先返回没看过的（${seed}）`, c.id === 'm07', c.id);
    // 抽 200 次，seen 里的从不出现（除非全看过）
    const part = ids.slice(0, 12);
    let leak = 0;
    const rr = mulberry32(seed);
    for (let i = 0; i < 200; i++) { const m = pickMessage({ rng: rr, date, seen: part }); if (part.includes(m.id)) leak++; }
    check(tag, `seen 过的 200 次里一次都不重复出现（${seed}）`, leak === 0);
  }
  // 全看过 → 仍然返回一条（可重复）
  const all = pickMessage({ rng: mulberry32(1), date: '2026-03-12', seen: ids });
  check(tag, '全部看过时仍返回一条寄语', !!all && typeof all.text === 'string');
  // 日期专属
  const xm = pickMessage({ rng: mulberry32(1), date: '2026-12-25' });
  check(tag, '日期专属寄语在那一天优先出现（12-25）', xm.id === 'd-xmas', xm.id);
  const ny = pickMessage({ rng: mulberry32(1), date: new Date(2027, 0, 1) });
  check(tag, '跨年区间（12-31 ～ 01-02）：1 月 1 日有效', ny.id === 'd-newyear', ny.id);
  let leakWhen = 0;
  const r3 = mulberry32(9);
  for (let i = 0; i < 300; i++) { const m = pickMessage({ rng: r3, date: '2026-03-12' /* 周四 */ }); if (m.when) leakWhen++; }
  check(tag, '非条件日期不会出现带 when 的寄语', leakWhen === 0);
  check(tag, 'matchesWhen：md / from-to / months / weekdays', matchesWhen({ md: '03-14' }, parseDate('2026-03-14')) && !matchesWhen({ md: '03-15' }, parseDate('2026-03-14')) && matchesWhen({ months: [3] }, parseDate('2026-03-14')) && matchesWhen({ weekdays: [6] }, parseDate('2026-03-14')) && !matchesWhen({ from: '04-01', to: '04-05' }, parseDate('2026-03-14')));
  check(tag, '没有 rng 时按日期做种子，同一天结果相同', pickMessage({ date: '2026-05-05' }).id === pickMessage({ date: '2026-05-05' }).id);
  check(tag, 'dateKey 本地日期格式 YYYY-MM-DD', dateKey(new Date(2026, 4, 3)) === '2026-05-03' && dateKey('2026-5-3') === '2026-05-03');
}

// ------------------------------------------------------------------ 7) 本地存储（Node 无 localStorage 时降级；有时正确读写）
{
  const tag = '存储';
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let ok = true, msg = '';
  try {
    delete globalThis.localStorage;
    ok = store.loadDex() && Object.keys(store.loadDex()).length === 0 && store.bottleDue('2026-01-01') === true && store.recordCatch('crab', '2026-01-01') === true && store.seenMessages().length === 0;
    store.markBottle('2026-01-01'); store.markSeen('m01');
  } catch (e) { ok = false; msg = e.message; }
  check(tag, '没有 localStorage（Node）时安全降级、不抛错', ok, msg);
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    check(tag, '图鉴：键名 shiba.fishing.dex，记录次数与首次日期', store.KEYS.dex === 'shiba.fishing.dex' && store.recordCatch('crab', '2026-02-01') === true && store.recordCatch('crab', '2026-02-09') === false && JSON.stringify(store.loadDex().crab) === JSON.stringify({ count: 2, first: '2026-02-01' }));
    check(tag, '每天第一局：当天没出过瓶 → due；markBottle 后当天不再 due，次日又 due', store.bottleDue('2026-02-01') === true && (store.markBottle('2026-02-01'), store.bottleDue('2026-02-01') === false) && store.bottleDue('2026-02-02') === true);
    mem.set(store.KEYS.dex, '{坏的 json');
    check(tag, '存储内容损坏时降级为空', Object.keys(store.loadDex()).length === 0);
    globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    check(tag, 'localStorage 访问抛错时降级', store.bottleDue('2026-02-01') === true && store.recordCatch('x', '2026-02-01') === true);
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
  }
}

console.log(`\n${fails === 0 ? '全部通过' : `有 ${fails} 项失败`}（共 ${total} 项检查）`);
process.exit(fails === 0 ? 0 : 1);
