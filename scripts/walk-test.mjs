// 遛狗小游戏逻辑的无头测试（只测 src/minigame/walkSim.js + walkBot.js，不依赖 three 渲染 / DOM）。
// 用法：node scripts/walk-test.mjs [--seed 1] [--verbose] [--table]    失败时退出码非 0。
// 1) 操控模型的数值实验（手 → 绳子 → 小狗，无障碍、小狗意志关闭的阶跃实验）；
// 2) 固定 seed + 另外 5 个 seed 上：结构 / 公平性 / 机器人分档（高手、普通玩家、只移手不收紧、全程收紧、什么都不做）。
import { createWalkSim, generateTrack, emptyTrack, customTrack, makeEntity, WALK, speedAt, distAt, maxLaneShift, FIXED_KINDS, LURE_KINDS, FEAR_KINDS, CROSS_KINDS, MOVER_KINDS } from '../src/minigame/walkSim.js';
import { createAutopilot } from '../src/minigame/walkBot.js';
import { mulberry32 } from '../src/core/util.js';

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const TABLE = argv.includes('--table') || VERBOSE;
const seedArg = argv.indexOf('--seed');
const BASE_SEED = seedArg >= 0 ? parseInt(argv[seedArg + 1], 10) : 20240601;
const SEEDS = [BASE_SEED, 11, 222, 3333, 44444, 555555];
const H = 1 / 30;
const R = WALK.RADIUS;

let fails = 0, total = 0;
function check(tag, name, ok, detail = '') {
  total++;
  if (!ok) { fails++; console.log(`FAIL  [${tag}] ${name}${detail ? '  —  ' + detail : ''}`); }
  else if (VERBOSE || TABLE) console.log(`PASS  [${tag}] ${name}${detail ? '  —  ' + detail : ''}`);
}

// ------------------------------------------------------------------ 1) 操控模型的数值实验
// 无障碍、小狗意志关闭。dt = 1/240 的细步长，脚本 fn(t) → { hand, grip }
function lab(fn, T, { pre = 0, tug = false } = {}) {
  const sim = createWalkSim({ rng: mulberry32(1), test: { noWill: true, noTug: !tug, track: emptyTrack() } });
  const dt = 1 / 240;
  const log = [];
  // 预备阶段：手在 0，按 pre.grip 先握一会儿
  for (let t = 0; t < pre.settle; t += dt) sim.update(dt, { hand: 0, grip: !!pre.grip });
  const t0 = sim.time;
  for (let t = 0; t < T; t += dt) {
    const cmd = fn(t);
    sim.update(dt, cmd);
    log.push({ t: t + dt, x: sim.x, v: sim.speed, hand: sim.hand, tugs: sim.tugs, base: speedAt(sim.time) });
  }
  void t0;
  return { sim, log };
}
const at = (log, t) => { let b = log[0]; for (const r of log) { if (r.t <= t + 1e-9) b = r; else break; } return b; };
const tReach = (log, target) => { for (const r of log) if (r.x >= target) return r.t; return Infinity; };
const rows = [];

{
  const tag = '操控';
  // 1. 松：手阶跃到 +0.6（小于松弛量）→ 2 秒内狗横向位移 < 0.1
  const e1 = lab(() => ({ hand: 0.6, grip: false }), 2, { pre: { settle: 0.5 } });
  const m1 = Math.max(...e1.log.map((r) => Math.abs(r.x)));
  check(tag, '1 松：手 +0.6 米（< 松弛量）→ 2 秒内狗位移 < 0.1 米', m1 < 0.1, `最大位移 ${m1.toFixed(3)} m`);
  rows.push(['1 松/手+0.6', `2秒内最大位移 ${m1.toFixed(3)} m`, '< 0.1']);
  // 2. 松：手阶跃到 +2.5
  const e2 = lab(() => ({ hand: 2.5, grip: false }), 8, { pre: { settle: 0.5 } });
  const tgt2 = 2.5 - WALK.SLACK_LOOSE;
  const x25 = at(e2.log, 0.25).x, t60 = tReach(e2.log, 0.6 * tgt2), xf = e2.log[e2.log.length - 1].x;
  check(tag, '2a 松：手 +2.5 → 最初 0.25 秒位移 < 0.15 米', x25 < 0.15, `x(0.25s)=${x25.toFixed(3)}`);
  check(tag, '2b 松：到达目标位移 60% 用时 ≥ 0.9 秒', t60 >= 0.9, `t60=${t60.toFixed(3)} s（目标位移 ${tgt2.toFixed(2)} m）`);
  check(tag, '2c 松：最终停在距手约一个松弛量处（不是手正下方）', Math.abs(2.5 - xf - WALK.SLACK_LOOSE) < 0.1, `最终 x=${xf.toFixed(3)}，距手 ${(2.5 - xf).toFixed(3)} m`);
  rows.push(['2 松/手+2.5', `x(0.25s)=${x25.toFixed(3)}  t60=${t60.toFixed(3)}s  距手 ${(2.5 - xf).toFixed(3)}m`, 'x<0.15, t60≥0.9, 距手≈0.9']);
  // 3. 紧：先握紧 1.5 秒，再阶跃到 +2.5
  const e3 = lab(() => ({ hand: 2.5, grip: true }), 6, { pre: { settle: 1.5, grip: true } });
  const tgt3 = 2.5 - WALK.SLACK_TIGHT;
  const t60b = tReach(e3.log, 0.6 * tgt3), xf3 = e3.log[e3.log.length - 1].x;
  const ratio = at(e3.log, 2).v / at(e3.log, 2).base;
  check(tag, '3a 紧：手 +2.5 → 到达目标位移 60% 用时 ≤ 0.6 秒', t60b <= 0.6, `t60=${t60b.toFixed(3)} s`);
  check(tag, '3b 紧：最终停在距手 ≤ 0.3 米', Math.abs(2.5 - xf3) <= 0.3, `距手 ${(2.5 - xf3).toFixed(3)} m`);
  check(tag, '3c 紧：前进速度降到约 55%', Math.abs(ratio - 0.55) < 0.03, `速度比 ${ratio.toFixed(3)}`);
  rows.push(['3 紧/手+2.5', `t60=${t60b.toFixed(3)}s  距手 ${(2.5 - xf3).toFixed(3)}m  速度比 ${ratio.toFixed(3)}`, 't60≤0.6, 距手≤0.3, 速度≈55%']);
  // 4. 拽：松，手 0.12 秒内横移 1.5 米再保持
  const flick = (dur) => (t) => ({ hand: 1.5 * Math.min(1, t / dur), grip: false });
  const e4 = lab(flick(0.12), 1.2, { pre: { settle: 0.5 }, tug: true });
  const e4s = lab(flick(1.0), 1.2, { pre: { settle: 0.5 }, tug: true });
  const xt = at(e4.log, 0.4).x, xs = at(e4s.log, 0.4).x;
  check(tag, '4a 拽：0.4 秒内侧向位移 ≥ 0.35 米', xt >= 0.35, `x(0.4s)=${xt.toFixed(3)}，tugs=${e4.sim.tugs}`);
  check(tag, '4b 拽：比慢速移动手（同终点）同一时刻的位移大至少 2 倍', xt >= 2 * Math.max(xs, 0.01), `拽 ${xt.toFixed(3)} vs 慢 ${xs.toFixed(3)}`);
  // 冷却：0.3 秒后甩回去（冷却 0.6 秒）→ 不再触发
  const e4c = lab((t) => ({ hand: t < 0.3 ? 1.5 * Math.min(1, t / 0.12) : 1.5 - 1.5 * Math.min(1, (t - 0.3) / 0.12), grip: false }), 0.55, { pre: { settle: 0.5 }, tug: true });
  check(tag, '4c 拽：冷却期内再甩无效', e4c.sim.tugs === 1, `tugs=${e4c.sim.tugs}`);
  rows.push(['4 拽', `x(0.4s)=${xt.toFixed(3)} (慢速 ${xs.toFixed(3)})  冷却内 tugs=${e4c.sim.tugs}`, '≥0.35, ≥2×慢速, tugs=1']);

  // 5. 握力：强诱惑物（x=+2）旁，手在 -2.5
  const lureTrack = () => customTrack([makeEntity('lure', 'dog', 22, 2, { hw: 0.5, hd: 0.6, pull: 1.1 })]);
  const run5 = (fn, T = 14) => {
    const sim = createWalkSim({ rng: mulberry32(1), test: { noWill: true, track: lureTrack() } });
    let xAtPass = null;
    for (let t = 0; t < T; t += 1 / 60) { sim.update(1 / 60, fn(t)); if (xAtPass === null && sim.dist > 22) xAtPass = sim.x; }
    return { sim, xAtPass };
  };
  const a = run5(() => ({ hand: -2.5, grip: true }));
  check(tag, '5a 全程收紧并反向横拉强诱惑物 → 握力涨满、脱手 ≥ 1 次', a.sim.slips >= 1, `slips=${a.sim.slips}，hits=${a.sim.hits}`);
  const b = run5((t) => ({ hand: -2.5, grip: (t % 1.4) < 0.8 }));
  check(tag, '5b 间歇收紧（收 0.8 秒放 0.6 秒）能把小狗带离且不脱手', b.sim.slips === 0 && b.sim.hits === 0 && b.xAtPass < 0.5, `slips=${b.sim.slips} hits=${b.sim.hits} 经过诱惑物时 x=${b.xAtPass.toFixed(2)} 握力峰值见下`);
  rows.push(['5 握力', `全程收紧 slips=${a.sim.slips}；间歇收紧 slips=${b.sim.slips} hits=${b.sim.hits} x=${b.xAtPass.toFixed(2)}`, '≥1 / 0']);
  // 6. 小狗意志：不操作时被诱惑物带偏并撞上；害怕的东西让它往反方向偏
  const sim6 = createWalkSim({ rng: mulberry32(1), test: { noWill: true, track: customTrack([makeEntity('lure', 'sausage', 40, 2, { hw: 0.3, hd: 0.3, pull: 1 })]) } });
  for (let t = 0; t < 14; t += 1 / 60) sim6.update(1 / 60, { hand: 0, grip: false });
  check(tag, '6a 不操作：小狗被诱惑物带偏并撞上', sim6.hits >= 1, `hits=${sim6.hits}`);
  const sim6b = createWalkSim({ rng: mulberry32(1), test: { noWill: true, track: customTrack([makeEntity('fear', 'sprinkler', 40, 0.6, { hw: 0.5, hd: 0.5, push: 1 })]) } });
  let minX = 0;
  for (let t = 0; t < 12; t += 1 / 60) { sim6b.update(1 / 60, { hand: 0, grip: false }); minX = Math.min(minX, sim6b.x); }
  check(tag, '6b 不操作：害怕的东西让小狗往反方向偏（物体在右，狗往左）', minX < -0.4, `最远偏到 x=${minX.toFixed(2)}`);
  rows.push(['6 意志', `诱惑 hits=${sim6.hits}；害怕偏到 x=${minX.toFixed(2)}`, 'hits≥1 / x<-0.4']);
}

// 机器人分档的阈值说明（主控验收时调整过）：操控是连续的物理过程，参数或步长稍有变化，同一机器人的失误数会在几次的范围内浮动，
// 所以这里卡的是“各档之间有清楚的差距”，而不是某个精确的失误数：高手 ≥85；普通玩家 45–80；只移手 ≤68 且比高手低 ≥20；全程收紧 ≤65；不操作 ≤46。
// ------------------------------------------------------------------ 2) 赛道结构 / 公平性 / 机器人分档
function run(seed, bot, dt = H) {
  const sim = createWalkSim({ rng: mulberry32(seed) });
  let steps = 0;
  while (!sim.finished && steps++ < 200000) sim.update(dt, bot(sim));
  return sim;
}
const BOTS = {
  expert: (s) => createAutopilot({ delay: 0.12, seed: s }),
  typical: (s) => createAutopilot({ delay: 0.35, noise: 0.35, tug: false, comp: false, gripNear: 4.5, crosser: true, seed: s }),
  handOnly: (s) => createAutopilot({ delay: 0.35, tug: false, comp: false, gripNear: 0, crosser: false, seed: s }),
  always: (s) => createAutopilot({ delay: 0.12, always: true, tug: false, comp: false, seed: s }),
  idle: (s) => createAutopilot({ idle: true, seed: s }),
};
const table = {};

for (const seed of SEEDS) {
  const tag = 'seed ' + seed;
  const sim0 = createWalkSim({ rng: mulberry32(seed) });
  const { rows: trows, ents } = sim0.track;

  // 结构
  {
    const sim = run(seed, BOTS.idle(seed));
    check(tag, '1a 恰好 180 秒后 finished', sim.finished && sim.time === 180, `time=${sim.time}`);
    const vs = []; for (let b = 0; b < 6; b++) vs.push(speedAt(b * 30 + 15));
    check(tag, '1c 速度单调不减且 6.5→12.5', vs.every((v, i) => i === 0 || v >= vs[i - 1]) && Math.abs(speedAt(0) - 6.5) < 1e-9 && Math.abs(speedAt(180) - 12.5) < 1e-9, vs.map((v) => v.toFixed(2)).join(','));
    const cnt = [0, 0, 0, 0, 0, 0], len = [0, 0, 0, 0, 0, 0];
    for (let b = 0; b < 6; b++) len[b] = distAt((b + 1) * 30) - distAt(b * 30);
    for (const r of trows) cnt[Math.min(5, Math.floor(r.t / 30))]++;
    const dens = cnt.map((c, i) => (c / len[i]) * 100), perSec = cnt.map((c) => c / 30);
    check(tag, '1e 障碍密度（排/100m、排/秒）按 30 秒分段单调不减', dens.every((v, i) => i === 0 || v >= dens[i - 1]) && perSec.every((v, i) => i === 0 || v >= perSec[i - 1]), `排/100m=${dens.map((v) => v.toFixed(2))} 排/秒=${perSec.map((v) => v.toFixed(2))}`);
    const g0 = trows.slice(1, 6).reduce((a, r) => a + r.gap, 0) / 5, gN = trows.slice(-6, -1).reduce((a, r) => a + r.gap, 0) / 5;
    check(tag, '1f 排间距约 14 → 5.8 米（最小 ≥ 5.5，末段均值 ≤ 8.3）', trows.slice(1).every((r) => r.gap >= 5.5) && g0 >= 11.5 && g0 <= 18.5 && gN >= 5.5 && gN <= 8.3, `开局均值 ${g0.toFixed(1)} 结尾均值 ${gN.toFixed(1)}`);
    const firstT = (pred) => { let m = Infinity; for (const e of ents) if (pred(e)) m = Math.min(m, e.tSched); return m; };
    const F = WALK.FIRST;
    const t = {
      bump: firstT((e) => e.kind === 'bump'), lure: firstT((e) => e.cls === 'lure'), mover: firstT((e) => e.cls === 'mover' && MOVER_KINDS[e.kind].mode === 'lateral'),
      cross: firstT((e) => e.cls === 'crosser'), fear: firstT((e) => e.cls === 'fear'), walker: firstT((e) => e.cls === 'mover' && MOVER_KINDS[e.kind].mode === 'approach'),
      sniff: firstT((e) => e.cls === 'sniff'), dash: firstT((e) => e.cls === 'critter'), dbl: trows.filter((r) => r.dbl).reduce((m, r) => Math.min(m, r.t), Infinity),
    };
    const early = t.lure >= F.lure && t.mover >= F.mover && t.cross >= F.cross && t.fear >= F.fear && t.walker >= F.walker && t.sniff >= F.sniff && t.dash >= F.dash && t.dbl >= F.dbl && t.bump >= F.bump;
    check(tag, '1g 各类实体首次出现时间不早于时间表（诱惑15/移动障碍25/横穿40/害怕40/行人50/嗅60/前冲75/堵两条75/减速带20）', early, Object.entries(t).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' '));
    const late = t.lure < F.lure + 14 && t.cross < F.cross + 14 && t.fear < F.fear + 20 && t.dash < F.dash + 16 && t.dbl < F.dbl + 16 && t.walker < F.walker + 24 && t.mover < F.mover + 24;
    check(tag, '1h 各类实体首次出现也不会拖得太晚', late, '');
    const fixedK = Object.keys(FIXED_KINDS).concat(['gate']);
    const kinds = new Set(ents.map((e) => e.kind));
    const need = [...fixedK, ...Object.keys(LURE_KINDS), ...Object.keys(FEAR_KINDS), ...Object.keys(CROSS_KINDS), ...Object.keys(MOVER_KINDS), 'bump', 'stump', 'bone'];
    const missing = need.filter((k) => !kinds.has(k));
    check(tag, '1i 全部障碍 / 诱惑 / 害怕 / 横穿 / 移动障碍 / 减速带 / 嗅桩 / 骨头种类都出现过', missing.length === 0, missing.join(','));
    check(tag, '1j 小动物（前冲）松鼠和小猫都出现过', kinds.has('squirrel') && kinds.has('cat'), '');
  }
  // 公平性
  {
    let ok = true, why = '';
    let prevS = -1e9, prevSafe = 1, prevKind = '', afterDash = false;
    for (const r of trows) {
      if (r.hazard) {
        if (r.free.length < 1 || !r.free.includes(r.safe)) { ok = false; why = `row ${r.index} 没有可通行的道`; break; }
        if (r.kind !== 'crosser') {
          for (const f of r.free) for (const e of r.ents) {
            const clear = Math.abs(WALK.LANES[f] - e.x) - e.hw - (e.amp || 0) - R;
            if (clear < 0.4) { ok = false; why = `row ${r.index} 空道 ${f} 被 ${e.kind} 挤占（净空 ${clear.toFixed(2)}）`; }
          }
          if (r.blocked.length >= 3) { ok = false; why = `row ${r.index} 堵了 3 条`; }
        }
      }
      if (r.index > 0) {
        if (r.s - prevS < 5.5) { ok = false; why = `row ${r.index} 与上一排间距 ${(r.s - prevS).toFixed(2)} < 5.5`; }
        const margin = prevKind === 'walker' ? 3 : 0;
        const need = Math.abs(r.safe - prevSafe), lim = maxLaneShift(r.s - prevS - margin, r.t, 180, afterDash ? 1.7 : 1);
        if (need > lim) { ok = false; why = `row ${r.index}（${r.kind}）换道 ${need} 超过允许的 ${lim}`; }
      }
      if (r.dbl && r.t < WALK.FIRST.dbl) { ok = false; why = `row ${r.index} 双堵出现在 ${r.t.toFixed(1)} 秒`; }
      prevS = r.s; prevSafe = r.safe; prevKind = r.kind; afterDash = r.kind === 'dash';
    }
    check(tag, '6 每排至少一条可通行的道，空道有足够净空；安全路线的换道距离、排间距都满足约束', ok, why);
    let okc = true, whyc = '';
    for (const e of ents) {
      if (e.cls !== 'crosser') continue;
      const tArr = e.trig / (WALK.GRIP_SPEED * speedAt(e.tSched));
      const tCross = (Math.abs(e.x0) + WALK.X_MAX + e.hw + R) / Math.abs(e.vx);
      if (tArr < tCross + 0.1) { okc = false; whyc = `${e.kind}@${e.s.toFixed(0)}：收紧后到达 ${tArr.toFixed(2)}s < 横穿 ${tCross.toFixed(2)}s`; break; }
    }
    check(tag, '6b 每个横穿物都能靠收紧绳子（速度 55%）让它先过', okc, whyc);
  }
  // 机器人分档
  const res = {};
  for (const name of Object.keys(BOTS)) {
    const sim = run(seed, BOTS[name](seed));
    res[name] = sim.result();
    res[name]._passed = sim.passed;
    if (name === 'expert') res._sim = sim;
  }
  table[seed] = res;
  const x = res.expert, ty = res.typical, ho = res.handOnly, al = res.always, id = res.idle;
  check(tag, '7 高手机器人（反应 120 ms）：失误 ≤ 9、脱手 ≤ 1、完成度 ≥ 85', x.hits <= 9 && x.slips <= 1 && x.completion >= 85, `completion=${x.completion} hits=${x.hits} slips=${x.slips} tugs=${x.tugs} combo=${x.maxCombo} bones=${x.bones}/${x.bonesTotal} dist=${x.distance}`);
  check(tag, '8 普通玩家机器人（350 ms、±0.35 米噪声、不拽、近了才收紧）：完成度 45–80 且失误 ≥ 6', ty.completion >= 45 && ty.completion <= 80 && ty.hits >= 6, `completion=${ty.completion} hits=${ty.hits} slips=${ty.slips}`);
  check(tag, '9a 只移手到安全道、从不收紧：完成度 ≤ 68 且比高手低至少 20', ho.completion <= 68 && x.completion - ho.completion >= 20, `completion=${ho.completion} hits=${ho.hits}`);
  check(tag, '9b 全程收紧：完成度 ≤ 65 且脱手 ≥ 1', al.completion <= 65 && al.slips >= 1, `completion=${al.completion} slips=${al.slips} hits=${al.hits}`);
  check(tag, '9c 什么都不做：完成度 ≤ 46', id.completion <= 46, `completion=${id.completion} hits=${id.hits}`);
  // result 字段
  {
    const sim = res._sim; const r = sim.result();
    const keys = ['game', 'completion', 'stars', 'tier', 'avoided', 'hits', 'bones', 'bonesTotal', 'distance', 'duration', 'aborted', 'maxCombo', 'slips', 'tugs'];
    const sane = keys.every((k) => k in r) && r.game === 'walk' && r.completion >= 0 && r.completion <= 100 && Number.isInteger(r.completion) && [1, 2, 3].includes(r.stars)
      && ['gold', 'silver', 'bronze'].includes(r.tier) && r.bones <= r.bonesTotal && r.aborted === false && r.duration === 180
      && r.avoided + (r.hits - r.slips) === sim.passed + sim.rows.filter((q) => q.hazard && q.hit && !q.resolved).length && sim.passed === sim.rows.filter((q) => q.hazard && q.resolved).length && r.maxCombo >= 0;
    check(tag, '10a result() 字段齐全（含 maxCombo / slips / tugs）、范围合理、avoided + 失误(不含脱手) = 经过的障碍排数', sane, JSON.stringify(r));
    let seen = 0; for (const en of sim.entities) if (en.cls === 'bone' && en.s - 0.4 <= sim.dist) seen++;
    const calc = Math.round(100 * (0.4 * (r.avoided / (r.avoided + r.hits)) + 0.25 * Math.min(1, r.bones / (0.5 * (seen + r.bonesTotal))) + 0.2 * (sim.dist / sim.maxDistance) + 0.15 * Math.min(1, r.maxCombo / 40)));
    check(tag, '10b completion 与新公式一致，星级阈值 85 / 65', calc === r.completion && r.stars === (r.completion >= 85 ? 3 : r.completion >= 65 ? 2 : 1), `${calc} vs ${r.completion}`);
    const mid = createWalkSim({ rng: mulberry32(seed) });
    for (let i = 0; i < 900; i++) mid.update(H, { hand: 0, grip: false });
    const rm = mid.result(true);
    check(tag, '10c 中途 result(true) 标记 aborted', rm.aborted === true && rm.duration > 29 && rm.duration < 31 && !mid.finished, '');
    const a = run(seed, BOTS.expert(seed)).result(), b = run(seed, BOTS.expert(seed)).result();
    check(tag, '10d 同 seed 同操作结果一致（确定性）', JSON.stringify(a) === JSON.stringify(b), '');
    const s2 = createWalkSim({ rng: mulberry32(seed) }); const bot = BOTS.expert(seed); let nan = false;
    while (!s2.finished) { s2.update(1 / 45, bot(s2)); if (![s2.x, s2.dist, s2.speed, s2.vx, s2.hand, s2.will, s2.gripMeter].every(Number.isFinite)) { nan = true; break; } }
    check(tag, '10e 全程无 NaN', !nan, '');
  }
}

if (TABLE) {
  console.log('\n=== 操控模型数值实验 ===');
  for (const r of rows) console.log(`  ${r[0].padEnd(12)} ${r[1].padEnd(70)} 要求: ${r[2]}`);
  console.log('\n=== 机器人分档（完成度 / 失误 / 脱手 / 拽 / 最大连击 / 骨头）===');
  for (const name of Object.keys(BOTS)) {
    console.log(`  ${name}`);
    for (const seed of SEEDS) { const r = table[seed][name]; console.log(`    seed ${String(seed).padEnd(8)} 完成度 ${String(r.completion).padStart(3)}  失误 ${String(r.hits).padStart(3)}  脱手 ${r.slips}  拽 ${String(r.tugs).padStart(3)}  连击 ${String(r.maxCombo).padStart(3)}  骨头 ${r.bones}/${r.bonesTotal}  路程 ${r.distance}`); }
  }
}
console.log(`\n${total - fails}/${total} 通过（${SEEDS.length} 个 seed：${SEEDS.join(', ')}）`);
if (fails) { console.log(`${fails} 项失败`); process.exit(1); }
console.log('walk-test 全部通过');
