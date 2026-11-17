// 农场捣乱小游戏逻辑层的无头测试（只测 src/minigame/farmSim.js + farmBot.js，不依赖 three / DOM / 浏览器）。
// 用法：node scripts/farm-test.mjs [--verbose]     有未通过时退出码非 0。
// 对应 docs/DESIGN.md“逻辑层的验收”7 条：
//   1 确定性与快照  2 时长与阶段  3 机器人分档  4 管理员  5 小狗移动  6 捣乱点与区域  7 多宠物与性能
// 主要在测试地图 scripts/fixtures/farm-map-fixture.mjs 上跑；如果 src/minigame/farm/mapData.js 已经存在，
// 再在真实地图上跑一遍（只要求不报错、不卡死、不穿墙、分档趋势成立）。
import { createFarmSim, buildFarmWorld, FARM, DEFAULT_RULES } from '../src/minigame/farmSim.js';
import { createFarmBot } from '../src/minigame/farmBot.js';
import { FARM_MAP as FIX } from './fixtures/farm-map-fixture.mjs';
import { mulberry32 } from '../src/core/util.js';

const VERBOSE = process.argv.includes('--verbose');
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const H = 1 / 30;

let fails = 0, total = 0;
function check(tag, name, ok, detail = '') {
  total++;
  if (!ok) fails++;
  console.log(`${ok ? '通过  ' : '未通过'} [${tag}] ${name}${detail ? '  —  ' + detail : ''}`);
}
const info = (s) => console.log(`        ${s}`);
let warns = 0;
/** 只提示、不计入通过 / 未通过（真实地图的数据问题由做地图的一方处理） */
function warn(name, ok, detail = '') {
  if (!ok) warns++;
  console.log(`${ok ? '正常  ' : '提示  '} [真实地图·数据] ${name}${detail ? '  —  ' + detail : ''}`);
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : String(n));
const copyCmd = (c) => ({ moveTo: c.moveTo ? { x: c.moveTo.x, z: c.moveTo.z } : null, pounce: !!c.pounce, dig: !!c.dig });

/** 用机器人玩完一局；顺带全程采样“管理员 / 小狗是否在可走区域” */
function play(map, kind, seed, { remotes = 0, dt = H, timeUpdate = false, record = false, snapAt = -1 } = {}) {
  const sim = createFarmSim({ map, seed });
  const world = sim.world;
  const id = sim.addPet({ name: '小柴' });
  const bot = createFarmBot({ kind, seed: seed * 13 + 1 });
  const rem = [];
  for (let i = 0; i < remotes; i++) rem.push({ id: sim.addPet({ name: `远端${i}` }, { owner: 'remote' }), bot: createFarmBot({ kind: 'random', seed: seed * 31 + i * 7 + 3 }) });
  const evs = [], cmds = [];
  let snap = null, snapIdx = -1, evAfterSnap = [];
  let n = 0, upMs = 0, ups = 0;
  const bad = { keeper: 0, keeperWorst: '', pet: 0, petWorst: '', out: 0 };
  const gateOpen = (oi) => sim.objects[oi].done;
  while (!sim.finished && n++ < 400 / dt) {
    if (snapAt >= 0 && !snap && sim.time >= snapAt) { snap = sim.snapshot(); snapIdx = cmds.length; }
    const c = copyCmd(bot(sim, id, dt));
    if (record) cmds.push(c);
    sim.command(id, c);
    for (const r of rem) sim.command(r.id, bot === null ? null : r.bot(sim, r.id, dt));
    if (timeUpdate) { const t0 = performance.now(); sim.update(dt); upMs += performance.now() - t0; ups++; } else sim.update(dt);
    for (const e of sim.events) { evs.push(e); if (snap) evAfterSnap.push(e); }
    sim.clearEvents();
    // 采样
    const K = sim.keeper;
    if (K.active) {
      const pen = world.maxPenetration(K.x, K.z, FARM.KEEPER_R, 'npc', gateOpen);
      const deep = world.deepAt(K.x, K.z);
      const ob = K.x < world.minX || K.x > world.maxX || K.z < world.minZ || K.z > world.maxZ;
      if (pen > 0.02 || deep || ob) { bad.keeper++; if (!bad.keeperWorst) bad.keeperWorst = `t=${f2(sim.time)} (${f2(K.x)}, ${f2(K.z)}) 穿透 ${f2(pen)} 深水 ${deep} 出界 ${ob} 状态 ${K.state}`; }
    }
    for (const p of sim.pets) {
      if (p.held || p.escaped || p.tossT > 0) continue; // 被扔在空中：从东西上面飞过去，不算穿墙
      const pen = world.maxPenetration(p.x, p.z, FARM.PET_R, 'pet', gateOpen);
      const ob = p.x < world.minX + FARM.PET_R - 1e-6 || p.x > world.maxX - FARM.PET_R + 1e-6 || p.z < world.minZ + FARM.PET_R - 1e-6 || p.z > world.maxZ - FARM.PET_R + 1e-6;
      if (pen > 0.02 || ob) { bad.pet++; if (!bad.petWorst) bad.petWorst = `${p.id} t=${f2(sim.time)} (${f2(p.x)}, ${f2(p.z)}) 穿透 ${f2(pen)} 出界 ${ob}`; }
    }
  }
  return { sim, id, res: sim.result(), evs, cmds, snap, snapIdx, evAfterSnap, bad, msPerUpdate: ups ? upMs / ups : 0, rem };
}

// ====================================================================== 1) 确定性与快照
{
  const tag = '1 确定性';
  for (const [kind, seed] of [['skilled', 3], ['random', 4]]) {
    const a = play(FIX, kind, seed), b = play(FIX, kind, seed);
    check(tag, `${kind}/${seed}：同种子跑两遍，结果完全一致`, JSON.stringify(a.res) === JSON.stringify(b.res), `${a.res.score} vs ${b.res.score}`);
    check(tag, `${kind}/${seed}：同种子跑两遍，事件序列完全一致（${a.evs.length} 个事件）`, JSON.stringify(a.evs) === JSON.stringify(b.evs));
  }
  {
    const a = play(FIX, 'skilled', 9), c = play(FIX, 'skilled', 10);
    check(tag, '不同种子结果不同（随机数确实在起作用）', JSON.stringify(a.evs) !== JSON.stringify(c.evs));
  }
  for (const [kind, seed, at] of [['skilled', 5, 120.0], ['random', 6, 70.0], ['skilled', 7, 239.0], ['random', 8, 30.0]]) {
    const a = play(FIX, kind, seed, { record: true, snapAt: at });
    const json = JSON.stringify(a.snap);
    const sim2 = createFarmSim({ map: FIX, seed: 12345 });
    sim2.applySnapshot(JSON.parse(json));
    const ev2 = [];
    for (let i = a.snapIdx; i < a.cmds.length && !sim2.finished; i++) { sim2.command(a.id, a.cmds[i]); sim2.update(H); ev2.push(...sim2.events); sim2.clearEvents(); }
    check(tag, `${kind}/${seed}：t=${at} 时 snapshot（${(json.length / 1024).toFixed(1)} KB，可 JSON 序列化）→ 新 sim applySnapshot 后继续，结果与不中断的一致`,
      JSON.stringify(sim2.result()) === JSON.stringify(a.res), `${sim2.result().score} vs ${a.res.score}`);
    check(tag, `${kind}/${seed}：快照之后的事件序列一致（${a.evAfterSnap.length} 个）`, JSON.stringify(ev2) === JSON.stringify(a.evAfterSnap));
  }
}

// ====================================================================== 2) 时长与阶段
{
  const tag = '2 时长';
  // 没被抓满 3 次时：正好 300 秒结束（这里关掉管理员；idle 小狗在通缉阶段会被抓满 3 次提前结束，见 3 分档）
  const a = { evs: [] };
  a.sim = createFarmSim({ map: FIX, seed: 1, test: { noKeeper: true } });
  { const id = a.sim.addPet({}); let n = 0; while (!a.sim.finished && n++ < 400 * 60) { a.sim.command(id, { moveTo: null }); a.sim.update(1 / 60); a.evs.push(...a.sim.events); a.sim.clearEvents(); } }
  a.res = a.sim.result();
  const wanted = a.evs.find((e) => e.type === 'wanted'), goose = a.evs.find((e) => e.type === 'goose');
  check(tag, '一局正好 300 秒结束（finished，time = 300，原因 = 时间到）', a.sim.finished && a.sim.time === FARM.DURATION && a.sim.endReason === 'time' && a.res.duration === 300, `time=${a.sim.time} reason=${a.sim.endReason}`);
  check(tag, '240 秒进入全场通缉（wanted 事件 t = 240，大鹅出现）', wanted && Math.abs(wanted.t - 240) < 1e-6 && goose && Math.abs(goose.t - 240) < 1e-6 && a.sim.goose.active, `wanted t=${wanted && wanted.t}`);
  const ph = a.evs.filter((e) => e.type === 'finished');
  check(tag, 'finished 事件恰好一次', ph.length === 1);
  // 出口：通缉前到出口不算，通缉后钻出去提前结算
  {
    const sim = createFarmSim({ map: FIX, seed: 2, test: { skipIntro: true, noKeeper: true } });
    const id = sim.addPet({});
    const ex = FIX.spawns.exit;
    sim.debug.placePet(id, ex.x, ex.z);
    for (let i = 0; i < 120; i++) { sim.command(id, { moveTo: { x: ex.x, z: ex.z } }); sim.update(1 / 60); }
    const before = sim.escaped;
    sim.debug.skipTo(FARM.WANTED_AT + 0.5);
    const evs = sim.events.slice();
    check(tag, '出口通缉前关着（站在出口不算钻出去），通缉一开始就能钻出去并提前结算', !before && sim.escaped && sim.finished && sim.endReason === 'escaped' && evs.some((e) => e.type === 'escaped'), `before=${before} escaped=${sim.escaped} t=${f2(sim.time)}`);
    const r = sim.result();
    check(tag, '钻出口有额外加分', r.escaped && r.score >= FARM.ESCAPE_BONUS, `score=${r.score}`);
  }
  // 被抓 3 次提前结束：小狗原地不动，火气一直满
  {
    const sim = createFarmSim({ map: FIX, seed: 3, test: { skipIntro: true, keeperPatrol: [[-6, -6]] } });
    const id = sim.addPet({});
    sim.debug.placePet(id, -6, -4);
    sim.debug.setKeeper({ x: -6, z: -6, heading: 0 });
    let n = 0;
    while (!sim.finished && n++ < 60 * 120) {
      const K = sim.keeper, p = sim.pets[0];
      if (K.state !== 'chase' && K.state !== 'carry') {
        // 放下之后把小狗摆回她眼前，火气拉满
        sim.debug.setKeeper({ anger: 1 });
        if (!p.held && Math.hypot(p.x - K.x - Math.sin(K.heading) * 2, p.z - K.z - Math.cos(K.heading) * 2) > 0.5) sim.debug.placePet(id, K.x + Math.sin(K.heading) * 2, K.z + Math.cos(K.heading) * 2);
      }
      sim.command(id, { moveTo: null }); sim.update(1 / 60);
    }
    check(tag, '被抓 3 次提前结束', sim.finished && sim.caught === 3 && sim.endReason === 'caught' && sim.time < 120, `caught=${sim.caught} t=${f2(sim.time)} reason=${sim.endReason}`);
  }
  // 被抓以后：管理员把小狗拎到路上，再扔出去
  {
    const sim = createFarmSim({ map: FIX, seed: 3, test: { skipIntro: true, keeperPatrol: [[-6, -6]] } });
    const id = sim.addPet({});
    sim.debug.placePet(id, -6, -4);
    sim.debug.setKeeper({ x: -6, z: -6, heading: 0, anger: 1 });
    const roadDist = (x, z) => { let b = 1e9; for (const pa of FIX.paths) for (let i = 0; i + 1 < pa.points.length; i++) { const [ax, az] = pa.points[i], [bx, bz] = pa.points[i + 1], ux = bx - ax, uz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / (ux * ux + uz * uz))); b = Math.min(b, Math.hypot(x - ax - ux * t, z - az - uz * t) - pa.width / 2); } return b; };
    let caught = null, rel = null, land = null, maxAir = 0, carried = 0, n = 0, heldMoved = 0, px = 0, pz = 0;
    while (!land && n++ < 60 * 40) {
      if (!caught) sim.debug.setKeeper({ anger: 1 });
      sim.command(id, { moveTo: null }); sim.update(1 / 60);
      const p = sim.pets[0];
      maxAir = Math.max(maxAir, p.air || 0);
      if (p.held) { if (carried > 0) heldMoved += Math.hypot(p.x - px, p.z - pz); carried += 1 / 60; px = p.x; pz = p.z; }
      for (const e of sim.events) { if (e.type === 'caught') caught = { t: sim.time, x: e.x, z: e.z }; if (e.type === 'released') rel = e; if (e.type === 'landed') land = { t: sim.time, x: e.x, z: e.z }; }
      sim.clearEvents();
    }
    const p = sim.pets[0];
    check(tag, '被抓后管理员拎着小狗走一段（至少 ROAD_MIN 那么远），不是就地放下', !!caught && heldMoved >= FARM.ROAD_MIN - 0.6 && carried >= FARM.CARRY_T - 0.05, `拎着走了 ${f2(heldMoved)}，拎了 ${f2(carried)} 秒`);
    check(tag, '走到路上以后把小狗扔出去：飞起来、落在路面上', !!rel && rel.toss === true && !!land && maxAir > 0.8 && roadDist(land.x, land.z) <= 0.05, land ? `落点离路边 ${f2(roadDist(land.x, land.z))}，最高 ${f2(maxAir)}` : '没落地');
    check(tag, '落地后晕一下，并且有一段时间不会被再次抓住', !!land && p.stunT > 0 && p.immuneT > FARM.IMMUNE_T - 1 && !p.held, `stun=${f2(p.stunT)} immune=${f2(p.immuneT)}`);
  }
  // intro
  {
    const sim = createFarmSim({ map: FIX, seed: 1 });
    const id = sim.addPet({});
    const p0 = { ...sim.pets[0] };
    check(tag, '开场 intro 阶段：不计时、不能移动', sim.phase === 'intro');
    sim.command(id, { moveTo: { x: 0, z: 0 } });
    sim.update(0.5);
    const still = sim.time === 0 && Math.hypot(sim.pets[0].x - p0.x, sim.pets[0].z - p0.z) < 1e-9;
    for (let i = 0; i < Math.round(FARM.INTRO * 60); i++) sim.update(1 / 60);
    check(tag, `开场 ${FARM.INTRO} 秒后进入 play，开始计时`, still && sim.phase === 'play' && sim.time > 0, `phase=${sim.phase} time=${f2(sim.time)}`);
  }
}

// ====================================================================== 3) 机器人分档
const games = {};
{
  const tag = '3 分档';
  for (const kind of ['idle', 'random', 'skilled']) games[kind] = SEEDS.map((s) => play(FIX, kind, s));
  const comp = (k) => median(games[k].map((g) => g.res.completion)), caught = (k) => median(games[k].map((g) => g.res.caught));
  for (const k of ['idle', 'random', 'skilled']) info(`${k}: 完成度 ${games[k].map((g) => g.res.completion).join(' ')}；被抓 ${games[k].map((g) => g.res.caught).join(' ')}；钻出口 ${games[k].filter((g) => g.res.escaped).length}/8`);
  check(tag, 'idle 完成度中位数 ≤ 5', comp('idle') <= 5, `中位数 ${comp('idle')}`);
  check(tag, 'random 完成度中位数在 15–55', comp('random') >= 15 && comp('random') <= 55, `中位数 ${comp('random')}`);
  check(tag, 'skilled 完成度中位数 ≥ 70', comp('skilled') >= 70, `中位数 ${comp('skilled')}`);
  check(tag, 'skilled 被抓次数中位数 ≤ 1', caught('skilled') <= 1, `中位数 ${caught('skilled')}`);
  const esc = games.skilled.filter((g) => g.res.escaped).length / SEEDS.length;
  check(tag, 'skilled 钻出口的比例 ≥ 60%', esc >= 0.6, `${(esc * 100).toFixed(0)}%`);
  check(tag, '结算字段齐全（game / mode / completion / stars / score / caught / escaped / mischief / zonesCleared / duration / aborted）',
    ['game', 'mode', 'completion', 'stars', 'score', 'caught', 'escaped', 'mischief', 'zonesCleared', 'duration', 'aborted'].every((k) => k in games.skilled[0].res) && games.skilled[0].res.game === 'farm');
  check(tag, 'result(true) 标记中途退出', games.idle[0].sim.result(true).aborted === true);
  // 通缉阶段：大鹅追上了会啄（减速）并报警，管理员随即开追
  const gp = games.idle.filter((g) => g.evs.some((e) => e.type === 'peck' && e.by === 'goose'));
  const alerted = games.idle.some((g) => { const pk = g.evs.find((e) => e.type === 'peck' && e.by === 'goose'); return pk && g.evs.some((e) => e.type === 'honk' && e.t === pk.t); });
  check(tag, '通缉阶段大鹅出现、追上了会啄小狗并报警（idle 8 局里有啄到）', gp.length > 0 && alerted, `${gp.length}/8 局被大鹅啄过`);
}
// 管理员对捣乱的反应：不管她在哪儿，先赶到现场 → 小狗还在就驱赶 → 驱赶无效才抓（拎到路上）→ 小狗不在就回去巡逻
{
  const tag = '4 管理员';
  const roadDist = (x, z) => { let b = 1e9; for (const pa of FIX.paths) for (let k = 0; k + 1 < pa.points.length; k++) { const [ax, az] = pa.points[k], [bx, bz] = pa.points[k + 1], ux = bx - ax, uz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / (ux * ux + uz * uz))); b = Math.min(b, Math.hypot(x - ax - ux * t, z - az - uz * t) - pa.width / 2); } return b; };
  // 她在西边巡逻，小狗跑到东边（隔着小溪，26 个单位以外，远超任何响动半径）撞一下某个东西
  const setup = (objId) => {
    const sim = createFarmSim({ map: FIX, seed: 2, test: { skipIntro: true, noAnimals: true, noGoose: true, keeperPatrol: [[-18, -10]] } });
    const id = sim.addPet({});
    sim.debug.setKeeper({ x: -18, z: -10, heading: 3.14, anger: 0 });
    const K = sim.keeper, p = sim.pets[0], o = sim.objects.find((q) => q.id === objId), evs = [];
    const pump = (sec, cmd) => { for (let n = 0; n < sec * 60; n++) { sim.command(id, cmd || { moveTo: null }); sim.update(1 / 60); evs.push(...sim.events); sim.clearEvents(); } };
    const until = (pred, maxSec) => { let n = 0; while (!pred() && n++ < maxSec * 2) pump(0.5); return pred(); };
    const hit = () => { sim.debug.placePet(id, o.x, o.z + o.r + 0.6, Math.PI); pump(0.1, { moveTo: { x: o.x, z: o.z }, pounce: true }); pump(0.6, { moveTo: { x: o.x, z: o.z } }); };
    const has = (type, from = 0) => evs.slice(from).find((e) => e.type === type);
    return { sim, id, K, p, o, evs, pump, until, hit, has };
  };
  // ① 远处捣乱一下：她就动身赶去现场
  {
    const t = setup('hay1'); const d0 = Math.hypot(t.K.x - t.o.x, t.K.z - t.o.z);
    t.hit();
    const al = t.has('alert');
    t.pump(4);
    const d1 = Math.hypot(t.K.x - t.o.x, t.K.z - t.o.z);
    check(tag, '不管她在哪儿：小狗在很远的地方捣乱一下，她就动身赶去现场', t.o.done && !!al && d0 > 20 && t.K.state === 'suspicious' && d1 < d0 - 5 && !t.has('chaseStart'), `出事时离现场 ${f2(d0)}，4 秒后 ${f2(d1)}，状态 ${t.K.state}`);
  }
  // ② 小狗一直赖在现场：先驱赶（这期间不抓）→ 驱赶无效 → 抓 → 拎到路上扔下
  {
    const t = setup('hay1'); t.hit();
    const gotShoo = t.until(() => !!t.has('chaseStart'), 40);
    const cs = t.has('chaseStart'), tShoo = t.sim.time;
    check(tag, '赶到现场看见小狗还在：先驱赶（chaseStart 带 shoo），不是直接抓', gotShoo && cs.shoo === true && t.sim.caught === 0, `第 ${f2(tShoo)} 秒开始驱赶`);
    t.until(() => !!t.has('shooFail'), 30);
    const sf = t.has('shooFail'), caughtBeforeFail = t.evs.slice(0, t.evs.indexOf(sf)).some((e) => e.type === 'caught');
    check(tag, '驱赶期间不抓；她到了跟前小狗还赖着不走 → 驱赶无效（shooFail）', !!sf && sf.reason === 'stay' && !caughtBeforeFail, `第 ${f2(t.sim.time)} 秒判定无效`);
    t.until(() => !!t.has('landed'), 30);
    const ld = t.has('landed');
    check(tag, '驱赶无效以后才抓，拎到最近的路上扔下', t.sim.caught === 1 && !!ld && roadDist(ld.x, ld.z) <= 0.05 && t.evs.findIndex((e) => e.type === 'caught') > t.evs.indexOf(sf), ld ? `落点离路边 ${f2(roadDist(ld.x, ld.z))}` : '没落地');
  }
  // ③ 被驱赶时小狗走开：驱赶有效，她不追、不抓，回去巡逻
  {
    const t = setup('hay1'); t.hit();
    t.until(() => !!t.has('chaseStart'), 40);
    t.sim.debug.placePet(t.id, t.o.x + 6, t.o.z + 13, 0); t.sim.debug.setKeeper({ knowsT: 3 }); // 跑出现场一大截（她知道小狗往哪儿跑了）
    t.pump(1.5);
    const sh = t.has('shooed');
    t.until(() => t.K.state === 'patrol', 60);
    check(tag, '被驱赶时小狗离开现场：驱赶有效，她不追不抓，回去巡逻', !!sh && t.sim.caught === 0 && !t.has('shooFail') && t.K.state === 'patrol', `状态 ${t.K.state}，被抓 ${t.sim.caught}`);
  }
  // ④ 她赶到的时候小狗已经不在现场：张望一下，回去巡逻
  {
    const t = setup('hay1'); t.hit();
    t.sim.debug.placePet(t.id, 20, 14, 0); // 捣乱完马上溜到老远
    const arrived = t.until(() => t.K.state === 'suspicious' && t.K.looking, 40), tArr = t.sim.time, dArr = Math.hypot(t.K.x - t.o.x, t.K.z - t.o.z);
    const back = t.until(() => t.K.state === 'patrol', 60);
    check(tag, '她赶到时小狗已经不在现场：张望一下就回去巡逻，不追不搜', arrived && dArr < 2.5 && back && !t.has('chaseStart') && !t.evs.some((e) => e.type === 'lost') && t.sim.caught === 0, `第 ${f2(tArr)} 秒到现场（离出事点 ${f2(dArr)}），第 ${f2(t.sim.time)} 秒回到巡逻`);
  }
  // ⑤ 刚被赶走又回原地接着捣乱：驱赶无效，她回来直接抓（不再先驱赶）
  {
    const t = setup('lumber1'); t.hit(); // 木料堆要撞两下：第一下就会把她引来
    t.until(() => !!t.has('chaseStart'), 40);
    t.sim.debug.placePet(t.id, t.o.x + 6, t.o.z + 13, 0); t.sim.debug.setKeeper({ knowsT: 3 });
    t.pump(1.5);
    const sh = t.has('shooed'), n0 = t.evs.length;
    t.pump(1.5); t.hit(); // 她刚转身，小狗回来撞第二下
    t.until(() => !!t.has('chaseStart', n0), 30);
    const cs2 = t.has('chaseStart', n0), sf = t.has('shooFail', n0);
    check(tag, '刚被赶走又回原地捣乱：她回来直接抓，不再先驱赶', !!sh && t.o.done && !!cs2 && cs2.shoo === false && !!sf && sf.reason === 'back', `第二次开追 shoo=${cs2 ? cs2.shoo : '-'}，原因 ${sf ? sf.reason : '-'}`);
  }
  // ⑦ 小狗赖在圈里捣乱：圈门被撞开了 → 她能走进圈里赶 / 抓；圈门关着 → 她进不去（只能隔着篱笆赶）
  for (const open of [true, false]) {
    const sim = createFarmSim({ map: FIX, seed: 3, test: { skipIntro: true, noAnimals: true, noGoose: true } });
    const id = sim.addPet({});
    const K = sim.keeper, p = sim.pets[0], g = sim.objects.find((q) => q.id === 'gate_pen1');
    if (open) { g.done = true; g.state = 'open'; g.progress = 1; }
    sim.debug.placePet(id, g.x, g.z - 2.5, 0); // 圈里（门的北边）
    let minD = 1e9, nt = 0, shooOutside = false;
    for (let n = 0; n < 60 * 70 && !sim.caught; n++) {
      nt -= 1 / 60; if (nt <= 0 && K.state !== 'chase' && K.state !== 'carry') { sim.debug.notice(id, p.x, p.z, 6, 0.08); nt = 6; }
      sim.command(id, { moveTo: null }); sim.update(1 / 60); sim.clearEvents();
      const d = Math.hypot(K.x - p.x, K.z - p.z); minD = Math.min(minD, d);
      if (K.state === 'chase' && K.shoo && K.action === 'shoo' && d > 1.5) shooOutside = true;
    }
    if (open) check(tag, '圈门被撞开以后她能走进圈里：小狗赖在圈里捣乱 → 进去赶、赶不走就抓', sim.caught === 1 && minD < 1.2, `离小狗最近 ${f2(minD)}，被抓 ${sim.caught}，第 ${f2(sim.time)} 秒`);
    else check(tag, '圈门关着她进不去：站在能到的最近处隔着篱笆赶，抓不到', sim.caught === 0 && minD > 1.5 && shooOutside, `离小狗最近 ${f2(minD)}，隔着赶 ${shooOutside}`);
  }
  // ⑥ 当着她的面又捣乱：驱赶立刻变成抓
  {
    const t = setup('hay1'); t.hit();
    t.until(() => !!t.has('chaseStart'), 40);
    const o2 = t.sim.objects.find((q) => q.id === 'milk2');
    t.sim.debug.placePet(t.id, t.K.x + Math.sin(t.K.heading) * 2, t.K.z + Math.cos(t.K.heading) * 2, 0); // 就在她眼前
    t.pump(0.2);
    const seen = t.sim.canKeeperSee(t.p), n0 = t.evs.length;
    t.sim.debug.notice ? t.sim.debug.notice(t.id, t.p.x, t.p.z, 6, 0.08) : null;
    t.pump(0.2);
    const sf = t.has('shooFail', n0);
    check(tag, '正被驱赶时当着她的面又捣乱：驱赶无效，改成抓', seen && !!sf && sf.reason === 'again' && t.K.shoo === false && (t.K.state === 'chase' || t.K.state === 'carry'), `看得见 ${seen}，原因 ${sf ? sf.reason : '-'}`);
  }
}
// 火气随时间慢慢消
{
  const sim = createFarmSim({ map: FIX, seed: 1, test: { skipIntro: true, noAnimals: true } });
  sim.addPet({});
  sim.debug.setKeeper({ anger: 0.6 });
  for (let i = 0; i < 60 * 20; i++) sim.update(1 / 60);
  check('4 管理员', `火气随时间慢慢消（20 秒 0.6 → ${f2(sim.keeper.anger)}）`, sim.keeper.anger < 0.6 - FARM.ANGER_DECAY * 20 * 0.8 && sim.keeper.anger > 0.6 - FARM.ANGER_DECAY * 20 * 1.2);
}

// ====================================================================== 4) 管理员
{
  const tag = '4 管理员';
  let badK = 0, worst = '';
  for (const k in games) for (const g of games[k]) { badK += g.bad.keeper; if (!worst && g.bad.keeperWorst) worst = g.bad.keeperWorst; }
  check(tag, '24 局全程每帧采样：管理员不穿墙、不过狗洞、不穿关着的圈门、不涉深水、不出界', badK === 0, worst || `${24} 局`);
  // 过溪走桥：管理员巡逻跨小溪时，x 落在溪里的帧 z 都在桥面范围内
  {
    let onStream = 0, offBridge = 0;
    const sim = createFarmSim({ map: FIX, seed: 1, test: { skipIntro: true } });
    sim.addPet({});
    sim.debug.placePet('pet1', -22, 16);
    for (let i = 0; i < 60 * 120; i++) { sim.update(1 / 60); const K = sim.keeper; if (K.x > 3 && K.x < 5) { onStream++; if (Math.abs(K.z) > 1.5) offBridge++; } }
    check(tag, '巡逻路线跨小溪时走桥（经过溪面的帧都在桥上）', onStream > 0 && offBridge === 0, `溪面帧 ${onStream}，不在桥上 ${offBridge}`);
  }
  const kp = (x, z) => ({ skipIntro: true, keeperPatrol: [[x, z]], noAnimals: true });
  function standoff(kx, kz, heading, px, pz, secs = 4) {
    const sim = createFarmSim({ map: FIX, seed: 1, test: kp(kx, kz) });
    const id = sim.addPet({});
    sim.debug.placePet(id, px, pz);
    sim.debug.setKeeper({ x: kx, z: kz, heading, anger: 1 });
    let chased = false, saw = false;
    for (let i = 0; i < secs * 60; i++) {
      sim.command(id, { moveTo: null }); sim.update(1 / 60);
      if (sim.canKeeperSee(id)) saw = true;
      if (sim.keeper.state === 'chase') chased = true;
    }
    return { chased, saw, sim };
  }
  {
    const a = standoff(-17, -8, Math.PI, -17, -16.8);
    check(tag, '视线被房子挡住：火气满、正对着、8.8 单位内，也不会发现房子后面的小狗', !a.chased && !a.saw);
    const b = standoff(0, 10, 0, 0.1, 17.4);
    check(tag, '视线被树林挡住：同样不会发现', !b.chased && !b.saw);
    const c = standoff(-17, -8, 0, -17, -1);
    check(tag, '对照：同样距离、没有遮挡时，火气满了会看见并开始追', c.chased && c.saw);
    const d = standoff(-17, -8, Math.PI, -17, -1);
    check(tag, '对照：在她背后（视野扇形外、不贴身）看不见', !d.chased && !d.saw);
  }
  // 躲藏：没看着进去 → 丢失目标；看着进去 → 找出来
  function hideCase(kx, kz, heading, firstX, firstZ, secs) {
    const sim = createFarmSim({ map: FIX, seed: 2, test: { skipIntro: true, noAnimals: true } });
    const id = sim.addPet({});
    sim.debug.placePet(id, firstX, firstZ);
    sim.debug.setKeeper({ x: kx, z: kz, heading, anger: 1, state: 'chase', lastX: firstX, lastZ: firstZ, unseenT: 0 });
    const bush = FIX.hides.find((h) => h.id === 'bush1');
    sim.update(1 / 60);
    sim.debug.placePet(id, bush.x, bush.z);
    const states = new Set();
    let hideEv = null;
    for (let i = 0; i < secs * 60 && !sim.finished; i++) {
      sim.command(id, { moveTo: null }); sim.update(1 / 60);
      states.add(sim.keeper.state);
      for (const e of sim.events) if (e.type === 'hide') hideEv = e;
      sim.clearEvents();
    }
    return { sim, states, hideEv };
  }
  {
    const a = hideCase(-6, 8.5, Math.PI, -6, 13.2, 15);
    check(tag, '躲进灌木且她没看着进去：丢失目标转搜索，15 秒内没被抓', a.hideEv && !a.hideEv.seen && a.states.has('search') && a.sim.caught === 0, `hide=${JSON.stringify(a.hideEv)} 状态=${[...a.states].join(',')} caught=${a.sim.caught}`);
    const b = hideCase(-6, 11, 0, -6, 13.2, 10);
    check(tag, '对照：她看着小狗钻进灌木 → 会被找出来抓住', b.hideEv && b.hideEv.seen && b.sim.caught === 1, `hide=${JSON.stringify(b.hideEv)} caught=${b.sim.caught}`);
  }
  // 钻她过不去的篱笆洞
  function gapChase(px, pz, kx, kz, tx, tz, secs) {
    const sim = createFarmSim({ map: FIX, seed: 2, test: { skipIntro: true, noAnimals: true } });
    const id = sim.addPet({});
    sim.debug.placePet(id, px, pz);
    sim.debug.setKeeper({ x: kx, z: kz, heading: Math.atan2(px - kx, pz - kz), anger: 1, state: 'chase', lastX: px, lastZ: pz, unseenT: 0 });
    const states = new Set(), kTrack = [];
    let dogT = -1;
    for (let i = 0; i < 60 * secs && !sim.finished; i++) {
      sim.command(id, { moveTo: { x: tx, z: tz } }); sim.update(1 / 60);
      states.add(sim.keeper.state); kTrack.push([sim.keeper.x, sim.keeper.z, sim.keeper.state]);
      if (dogT < 0 && Math.hypot(sim.pets[0].x - tx, sim.pets[0].z - tz) < 0.5) dogT = sim.time;
    }
    return { sim, states, kTrack, dogT };
  }
  {
    // 菜地西边的洞：她只能绕一大圈，小狗钻过去就拉开了距离
    const a = gapChase(-18, 9.1, -16, 9.1, -23.3, 9.1, 3);
    const kIn = a.kTrack.filter(([x, z]) => x < -19.5 && x > -20.5 && Math.abs(z - 9.1) < 1).length;
    const kd = Math.hypot(a.sim.pets[0].x - a.sim.keeper.x, a.sim.pets[0].z - a.sim.keeper.z);
    check(tag, '小狗钻过菜地篱笆洞，管理员不能跟着钻、只能绕路（3 秒后还差得远）', a.dogT > 0 && kIn === 0 && a.sim.caught === 0 && kd > 4, `小狗到达 t=${f2(a.dogT)}，3 秒后相距 ${f2(kd)}`);
    // 公牛围场：只有狗洞能进，她够不着 → 放弃追逐
    const b = gapChase(13.6, 10, 11.6, 10, 17.5, 11.5, 12);
    const kInside = b.kTrack.filter(([x, z]) => x > 15.2 && x < 21.8 && z > 7.2 && z < 12.8).length;
    check(tag, '小狗钻进她进不去的围场：她够不着，等一会儿就放弃追逐转搜索', b.dogT > 0 && kInside === 0 && b.sim.caught === 0 && b.states.has('search'), `状态 ${[...b.states].join(',')} 被抓 ${b.sim.caught}`);
  }
  // 速度：空旷地图上直线逃跑追不上；刨地 / 顶着墙时追得上
  const OPEN = {
    size: { w: 80, d: 20 }, zones: [], paths: [], water: [], interactables: [], hides: [],
    colliders: [{ id: 'wall', kind: 'wall', shape: 'box', x: 20, z: 0, w: 0.6, d: 20, rot: 0 }],
    spawns: { gate: { x: -30, z: 0, heading: Math.PI / 2 }, exit: { x: 38, z: 9, r: 1 }, keeper: { home: { x: -36, z: 0 }, patrol: [[-36, 0]] }, goose: { x: 0, z: 8 }, animals: [] },
  };
  function race(petX, keeperX, cmdFn, secs, rules) {
    const sim = createFarmSim({ map: OPEN, seed: 1, rules, test: { skipIntro: true } });
    const id = sim.addPet({});
    sim.debug.placePet(id, petX, 0, Math.PI / 2);
    sim.pets[0].spd = FARM.DOG_SPEED;
    sim.debug.setKeeper({ x: keeperX, z: 0, heading: Math.PI / 2, anger: 1, state: 'chase', lastX: petX, lastZ: 0, unseenT: 0 });
    let kMax = 0, gapMin = 1e9, caughtAt = -1;
    for (let i = 0; i < secs * 60 && !sim.finished; i++) {
      sim.command(id, cmdFn(sim, i)); sim.update(1 / 60);
      if (sim.keeper.state === 'chase') kMax = Math.max(kMax, sim.keeper.speed);
      if (sim.caught && caughtAt < 0) caughtAt = sim.time;
      gapMin = Math.min(gapMin, Math.hypot(sim.pets[0].x - sim.keeper.x, sim.pets[0].z - sim.keeper.z));
    }
    return { sim, kMax, gapMin, caughtAt, gap: Math.hypot(sim.pets[0].x - sim.keeper.x, sim.pets[0].z - sim.keeper.z) };
  }
  {
    const r = race(-30, -33, () => ({ moveTo: { x: 18, z: 0 } }), 8);
    check(tag, `追逐速度略低于小狗全速（${DEFAULT_RULES.keeper.speed}，通缉 ×${FARM.WANTED_SPEED} = ${f2(DEFAULT_RULES.keeper.speed * FARM.WANTED_SPEED)} < ${FARM.DOG_SPEED}）：直线逃跑 8 秒没被追上、距离拉大`,
      DEFAULT_RULES.keeper.speed * FARM.WANTED_SPEED < FARM.DOG_SPEED && DEFAULT_RULES.keeper.speed > FARM.DOG_SPEED * 0.8 && r.sim.caught === 0 && r.gap > 3 && r.kMax <= DEFAULT_RULES.keeper.speed * 1.001,
      `实测最高 ${f2(r.kMax)}，最后距离 ${f2(r.gap)}`);
    const d = race(-30, -33, () => ({ moveTo: null, dig: true }), 4);
    check(tag, '小狗原地刨地时会被追上', d.sim.caught === 1, `被抓时间 ${f2(d.caughtAt)}`);
    const w = race(17, 13, () => ({ moveTo: { x: 30, z: 0 } }), 4);
    check(tag, '小狗一头顶着墙跑不动时会被追上', w.sim.caught === 1, `被抓时间 ${f2(w.caughtAt)}`);
    const b = race(17, 13, (sim, i) => ({ moveTo: { x: 30, z: 0 }, pounce: i === 1 }), 4);
    check(tag, '扑的时候撞上墙会眩晕（bonk）并被追上', b.sim.caught === 1, `被抓时间 ${f2(b.caughtAt)}`);
  }
  // 起疑：听见响动会过去看
  {
    const sim = createFarmSim({ map: FIX, seed: 3, test: { skipIntro: true, noAnimals: true, keeperPatrol: [[-6, -9]] } });
    const id = sim.addPet({});
    sim.debug.setKeeper({ x: -6, z: -9, heading: 0 });   // 面朝南，奶桶在她背后（北边）2.5 单位外
    const milk = FIX.interactables.find((o) => o.id === 'milk1');
    sim.debug.placePet(id, milk.x, milk.z + 1.6, Math.PI);
    sim.update(1 / 60);
    sim.debug.placePet(id, -6, -14.5, 0);
    for (let i = 0; i < 20; i++) { sim.command(id, { moveTo: { x: milk.x, z: milk.z }, pounce: i === 2 }); sim.update(1 / 60); }
    const alert = sim.events.find((e) => e.type === 'alert');
    check(tag, '没看见、但听见响动 → 起疑（suspicious）并过去查看', !!alert && sim.keeper.state === 'suspicious', `状态 ${sim.keeper.state}，事件 ${sim.events.map((e) => e.type).join(',')}`);
  }
}

// ====================================================================== 5) 小狗移动
{
  const tag = '5 小狗';
  let badP = 0, worst = '';
  for (const k in games) for (const g of games[k]) { badP += g.bad.pet; if (!worst && g.bad.petWorst) worst = g.bad.petWorst; }
  check(tag, '24 局全程每帧采样：小狗不出地图、不进碰撞体（含关着的圈门）', badP === 0, worst);
  // 4 面围住的小屋（转了个角度），里面随机点对点跑 2000 次
  const ROT = 0.4, HW = 3, HD = 2, T = 0.4;
  const co = Math.cos(ROT), si = Math.sin(ROT);
  const toW = (lx, lz) => [lx * co + lz * si, -lx * si + lz * co];
  const wall = (id, lx, lz, w, d) => { const [x, z] = toW(lx, lz); return { id, kind: 'wall', shape: 'box', x, z, w, d, rot: ROT }; };
  const ROOM = {
    size: { w: 20, d: 20 }, zones: [], paths: [], water: [], interactables: [], hides: [],
    colliders: [wall('n', 0, -HD - T / 2, 2 * HW + 2 * T, T), wall('s', 0, HD + T / 2, 2 * HW + 2 * T, T), wall('w', -HW - T / 2, 0, T, 2 * HD + 2 * T), wall('e', HW + T / 2, 0, T, 2 * HD + 2 * T),
      { id: 'post', kind: 'rock', shape: 'circle', ...Object.fromEntries([['x', toW(1.2, 0.6)[0]], ['z', toW(1.2, 0.6)[1]]]), r: 0.45 }],
    spawns: { gate: { x: 0, z: 0, heading: 0 }, exit: { x: 9, z: 9, r: 1 }, keeper: { home: { x: 8, z: 8 }, patrol: [[8, 8]] }, goose: { x: -8, z: 8 }, animals: [] },
  };
  const sim = createFarmSim({ map: ROOM, seed: 1, test: { skipIntro: true, noKeeper: true, noAnimals: true, endless: true } });
  const id = sim.addPet({});
  const rng = mulberry32(99);
  const R = FARM.PET_R, IHW = HW - R, IHD = HD - R;
  let reached = 0, nearest = 0, failed = 0, escaped = 0, steps = 0, worstMsg = '';
  const post = ROOM.colliders[4];
  for (let k = 0; k < 2000; k++) {
    // 起点：屋里随机（避开柱子）
    let lx, lz, sx, sz;
    do { lx = (rng() * 2 - 1) * IHW; lz = (rng() * 2 - 1) * IHD; [sx, sz] = toW(lx, lz); } while (Math.hypot(sx - post.x, sz - post.z) < post.r + R + 0.05);
    const tx = (rng() * 2 - 1) * 9, tz = (rng() * 2 - 1) * 9;
    sim.debug.placePet(id, sx, sz, rng() * Math.PI * 2);
    // 目标在屋里的“最近处”（局部坐标夹到屋内）
    const tlx = tx * co - tz * si, tlz = tx * si + tz * co;
    const inside = Math.abs(tlx) <= IHW && Math.abs(tlz) <= IHD && Math.hypot(tx - post.x, tz - post.z) > post.r + R;
    let [nx, nz] = toW(clampN(tlx, -IHW, IHW), clampN(tlz, -IHD, IHD));
    const pd = Math.hypot(nx - post.x, nz - post.z);
    if (pd < post.r + R) { nx = post.x + ((nx - post.x) / (pd || 1)) * (post.r + R); nz = post.z + ((nz - post.z) / (pd || 1)) * (post.r + R); } // 最近处被柱子占了：柱子表面
    let still = 0, i = 0;
    for (; i < 60 * 6; i++) {
      sim.command(id, { moveTo: { x: tx, z: tz }, pounce: rng() < 0.01 });
      sim.update(1 / 60); steps++;
      const p = sim.pets[0];
      const plx = p.x * co - p.z * si, plz = p.x * si + p.z * co;
      if (Math.abs(plx) > HW + 0.02 || Math.abs(plz) > HD + 0.02) { escaped++; break; }
      if (Math.hypot(p.x - tx, p.z - tz) < 0.3) break;
      still = p.speed < 0.05 && p.stunT <= 0 ? still + 1 : 0;
      if (still > 30) break;
    }
    const p = sim.pets[0];
    const d = Math.hypot(p.x - tx, p.z - tz);
    if (d < 0.3) reached++;
    else if (!inside && Math.hypot(p.x - nx, p.z - nz) < 0.5) nearest++;
    else { failed++; if (!worstMsg) worstMsg = `#${k} 起点 (${f2(sx)}, ${f2(sz)}) 目标 (${f2(tx)}, ${f2(tz)}) 停在 (${f2(p.x)}, ${f2(p.z)})，最近处 (${f2(nx)}, ${f2(nz)})`; }
  }
  info(`2000 次：到达 ${reached}，停在最近处 ${nearest}，失败 ${failed}，穿墙 ${escaped}（共 ${steps} 步）`);
  check(tag, '4 面围住的小屋里随机点对点跑 2000 次：都能到达或停在最近处（不卡死、不穿墙）', failed === 0 && escaped === 0, worstMsg);
  // 速度：离得越远越快、全速 = DOG_SPEED；扑 = 短冲刺带冷却；浅水减速、深水游泳
  {
    const s2 = createFarmSim({ map: FIX, seed: 1, test: { skipIntro: true, noKeeper: true, noAnimals: true } });
    const pid = s2.addPet({});
    const speedAt = (dist) => { s2.debug.placePet(pid, -22, -16, Math.PI / 2); let v = 0; for (let i = 0; i < 30; i++) { s2.command(pid, { moveTo: { x: s2.pets[0].x + dist, z: -16 } }); s2.update(1 / 60); v = Math.max(v, s2.pets[0].speed); } return v; };
    const v1 = speedAt(1), v2 = speedAt(2), v9 = speedAt(9);
    check(tag, '离 moveTo 越远跑得越快，最高不超过 DOG_SPEED', v1 < v2 && v2 < v9 && v9 <= FARM.DOG_SPEED + 1e-6 && v9 > FARM.DOG_SPEED * 0.95, `1→${f2(v1)} 2→${f2(v2)} 9→${f2(v9)}`);
    s2.debug.placePet(pid, -22, -16, Math.PI / 2);
    let vp = 0, n1 = 0;
    s2.clearEvents();
    for (let i = 0; i < 90; i++) { s2.command(pid, { moveTo: { x: 0, z: -16 }, pounce: true }); s2.update(1 / 60); vp = Math.max(vp, s2.pets[0].speed); }
    n1 = s2.events.filter((e) => e.type === 'pounce').length;
    check(tag, `扑 = 短冲刺（峰值 ${f2(vp)} > 全速），有冷却（按住扑 1.5 秒只扑了 ${n1} 次）`, vp > FARM.DOG_SPEED * 1.3 && n1 === 2);
    const swim = (x, z, tx) => { s2.debug.placePet(pid, x, z, Math.PI / 2); let v = 0; for (let i = 0; i < 40; i++) { s2.command(pid, { moveTo: { x: tx, z } }); s2.update(1 / 60); v = Math.max(v, s2.pets[0].speed); } return v; };
    const vDeep = swim(3.2, 8, 9), vShallow = swim(8.3, 9, 15);
    check(tag, `深水游泳（${f2(vDeep)}）、浅水减速（${f2(vShallow)}）都比全速慢，游泳更慢`, vDeep < vShallow && vShallow < FARM.DOG_SPEED * 0.75 && vDeep <= FARM.DOG_SPEED * FARM.SWIM_MULT + 1e-6);
  }
}

function clampN(x, a, b) { return x < a ? a : x > b ? b : x; }

// ====================================================================== 6) 捣乱点与区域
{
  const tag = '6 捣乱点';
  function lab(rules) {
    const sim = createFarmSim({ map: FIX, seed: 5, rules, test: { skipIntro: true, noKeeper: true } });
    const id = sim.addPet({});
    const all = [];
    const run = (secs, cmd) => { for (let i = 0; i < Math.round(secs * 60); i++) { sim.command(id, typeof cmd === 'function' ? cmd(i) : cmd); sim.update(1 / 60); all.push(...sim.events); sim.clearEvents(); } };
    const obj = (oid) => sim.objects.find((o) => o.id === oid);
    const free = (x, z) => !sim.world.blocked(x, z, FARM.PET_R + 0.05, 'pet', (oi) => sim.objects[oi].done) && !sim.world.waterAt(x, z);
    function spotNear(x, z, r, prefer) {
      let best = null, bs = -1e9;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, sx = x + Math.sin(a) * r, sz = z + Math.cos(a) * r;
        if (!free(sx, sz)) continue;
        const s = prefer ? -Math.hypot(sx - prefer[0], sz - prefer[1]) : 0;
        if (s > bs) { bs = s; best = [sx, sz]; }
      }
      return best;
    }
    function pounceAt(oid, times = 1, prefer = null) {
      const o = obj(oid);
      for (let t = 0; t < times; t++) {
        const s = spotNear(o.x, o.z, o.r + 1.0, prefer);
        sim.debug.placePet(id, s[0], s[1], Math.atan2(o.x - s[0], o.z - s[1]));
        run(0.05, { moveTo: { x: o.x, z: o.z } });
        run(0.5, (i) => ({ moveTo: { x: o.x, z: o.z }, pounce: i === 0 }));
        run(FARM.POUNCE_CD, { moveTo: null });
      }
    }
    function goTo(x, z, secs = 1.5) { run(secs, { moveTo: { x, z } }); }
    function place(x, z) { sim.debug.placePet(id, x, z); run(0.05, { moveTo: null }); }
    return { sim, id, all, run, obj, pounceAt, goTo, place, spotNear };
  }
  const L = lab();
  const { sim, all, obj } = L;
  const mis = (kind, oid) => all.filter((e) => e.type === 'mischief' && e.kind === kind && (!oid || e.objectId === oid));
  const score0 = () => sim.score;
  // ---- 农舍前院：泥塘 → 泥狗扑床单 → 喷泉石板地 → 跳喷泉洗掉 → 另一条床单 → 奶桶 → 木箱 → 花坛
  const mud = obj('mud1');
  L.place(mud.x, mud.z); L.run(1.0, { moveTo: null });
  check(tag, '泥塘：待一会儿 → 变泥狗并计分', sim.pets[0].muddy && mis('mud_pit').length === 1 && all.some((e) => e.type === 'muddy'));
  let s0 = score0();
  L.pounceAt('sheet1');
  check(tag, '床单：扑 → 扯下来计分；泥狗扯床单有连带加分（mud_print）', obj('sheet1').done && mis('clothesline', 'sheet1').length === 1 && mis('mud_print', 'sheet1').length === 1,
    `得分 +${sim.score - s0}（床单 ${FARM.KINDS.clothesline.points} + 泥爪印 ${FARM.EXTRA.mud_print.points}）`);
  const fo = obj('fountain1');
  check(tag, '扑床单不会洗掉泥', sim.pets[0].muddy);
  const ring = (fo.r + fo.plaza) / 2;
  L.place(fo.x + ring, fo.z);
  L.run(2.5, (i) => { const a = Math.PI / 2 + i * 0.03; return { moveTo: { x: fo.x + Math.sin(a) * ring, z: fo.z + Math.cos(a) * ring } }; });
  check(tag, '泥狗走过喷泉石板地 → 泥爪印加分', mis('mud_print', 'fountain1').length === 1);
  L.goTo(fo.x, fo.z, 1.5);
  check(tag, '跳进喷泉 → 计分并洗掉泥', obj('fountain1').done && mis('fountain').length === 1 && !sim.pets[0].muddy && all.some((e) => e.type === 'wash'));
  s0 = score0();
  L.pounceAt('sheet2');
  check(tag, '干净的小狗扯床单：只有床单分，没有泥爪印', obj('sheet2').done && mis('mud_print', 'sheet2').length === 0 && sim.score - s0 === FARM.KINDS.clothesline.points);
  L.pounceAt('milk1');
  check(tag, '奶桶：扑 → 撞翻计分', obj('milk1').done && mis('milk_can', 'milk1').length === 1);
  L.pounceAt('crate1');
  check(tag, '木箱：扑 → 撞翻计分', obj('crate1').done && mis('crate').length === 1);
  const fl = obj('flower2');
  L.place(fl.x - 2.4, fl.z);
  L.goTo(fl.x + 2.4, fl.z, 1.4); L.goTo(fl.x - 2.4, fl.z, 1.4); L.goTo(fl.x + 2.4, fl.z, 1.4);
  check(tag, '花坛：来回踩过去 → 踩坏计分', obj('flower2').done && mis('flower_bed', 'flower2').length === 1, `progress=${f2(obj('flower2').progress)}`);
  const zc = all.find((e) => e.type === 'zoneCleared' && e.zone === 'yard');
  check(tag, '清完“农舍前院”的清单 → zoneCleared，加区域奖励', !!zc && sim.zones.yard.cleared && sim.zones.yard.done === sim.zones.yard.total && zc.bonus === FARM.ZONE_BONUS, JSON.stringify(sim.zones.yard));
  // ---- 菜地：刨萝卜（按住久了出大萝卜）
  const rb = obj('radish1');
  L.place(rb.x, rb.z);
  L.run(FARM.KINDS.radish_bed.bigTime + 0.1, { dig: true });
  check(tag, '萝卜地：按住刨够久 → 大萝卜', mis('big_radish', 'radish1').length === 1 && obj('radish1').dug === 1);
  L.run(FARM.KINDS.radish_bed.digTime + 0.1, { dig: true }); L.run(0.1, { dig: false });
  check(tag, '萝卜地：刨一会儿就松开 → 普通萝卜', mis('radish_bed', 'radish1').length === 1 && obj('radish1').dug === 2);
  L.run(0.5, { dig: true }); L.run(0.2, { dig: false });
  check(tag, '萝卜地：刨得太短不出萝卜（进度保留）', obj('radish1').dug === 2 && obj('radish1').progress > 2 / 3);
  L.run(FARM.KINDS.radish_bed.bigTime, { dig: true }); L.run(0.1, { dig: false });
  check(tag, '一块萝卜地刨完（3 个）→ 算完成', obj('radish1').done);
  // ---- 鸡群：冲散 + 扑中
  const grpCenter = (gid) => { let x = 0, z = 0, n = 0; for (const a of sim.animals) if (sim.groups[a.group].id === gid) { x += a.x; z += a.z; n++; } return [x / n, z / n]; };
  {
    const [cx, cz] = grpCenter('chicks');
    L.place(cx - 4, cz + 0.2);
    L.goTo(cx + 4, cz, 1.6);
    const sc = mis('scatter', 'chicks');
    const fled = sim.animals.filter((a) => sim.groups[a.group].id === 'chicks' && a.action === 'flee').length;
    check(tag, '小鸡群：冲过去 → 四散逃跑（群体分散）并计“冲散鸡群”', sc.length === 1 && sim.groups.find((g) => g.id === 'chicks').done, `逃跑中 ${fled} 只`);
    let got = false;
    for (let k = 0; k < 6 && !got; k++) {
      let near = null, nd = 1e9;
      for (const a of sim.animals) if (a.kind === 'chick') { const d = Math.hypot(a.x - sim.pets[0].x, a.z - sim.pets[0].z); if (d < nd) { nd = d; near = a; } }
      const s = L.spotNear(near.x, near.z, 0.9);
      if (!s) continue;
      sim.debug.placePet(L.id, s[0], s[1], Math.atan2(near.x - s[0], near.z - s[1]));
      L.run(0.4, (i) => ({ moveTo: { x: near.x, z: near.z }, pounce: i === 0 }));
      got = mis('pounce_bird').length > 0;
      L.run(FARM.POUNCE_CD, { moveTo: null });
    }
    check(tag, '扑中小鸡 → 计分', got);
  }
  // 母鸡啄回来
  {
    let pecked = false;
    for (let k = 0; k < 12 && !pecked; k++) {
      const hen = sim.animals.find((a) => a.kind === 'hen' && !a.scoredHit) || sim.animals.find((a) => a.kind === 'hen');
      const s = L.spotNear(hen.x, hen.z, 0.8);
      if (!s) { L.run(0.5, { moveTo: null }); continue; }
      sim.debug.placePet(L.id, s[0], s[1], Math.atan2(hen.x - s[0], hen.z - s[1]));
      L.run(0.3, (i) => ({ moveTo: { x: hen.x, z: hen.z }, pounce: i === 0 }));
      L.run(3, { moveTo: null });
      pecked = all.some((e) => e.type === 'peck' && e.by.startsWith('hens'));
    }
    check(tag, '母鸡被扑后会追啄小狗一小段（peck，小狗短暂减速）', pecked);
  }
  // ---- 猪羊圈：圈门撞两下打开 → 动物 loose 跑出来
  {
    const gate = obj('gate_pen1');
    L.pounceAt('gate_pen1', 2, [15, 0]);
    const loose = sim.animals.filter((a) => sim.groups[a.group].pen === 'pen1' && a.loose).length;
    check(tag, '圈门：扑两下 → 撞开计分，圈里的动物全部 loose', gate.done && gate.state === 'open' && mis('pen_gate').length === 1 && loose === 5 && all.some((e) => e.type === 'loose'), `loose=${loose}`);
    L.place(15, 4);
    L.run(10, { moveTo: null });
    const out = sim.animals.filter((a) => sim.groups[a.group].pen === 'pen1' && a.z > -4.5).length;
    check(tag, '圈门开后动物从门里跑出圈（并计分）', out >= 3 && mis('loose').length >= 3, `出圈 ${out} 只，计分 ${mis('loose').length}`);
  }
  L.pounceAt('lumber1', 1);
  check(tag, '木料堆：扑一下不够（进度 1/2），不计分', !obj('lumber1').done && obj('lumber1').progress === 0.5 && mis('lumber_pile').length === 0);
  L.pounceAt('lumber1', 1);
  check(tag, '木料堆：扑第二下 → 塌了计分', obj('lumber1').done && mis('lumber_pile').length === 1);
  L.pounceAt('hay1');
  check(tag, '草垛：扑 → 撞翻计分', obj('hay1').done && mis('hay_bale').length === 1);
  // 公牛
  {
    const bull = sim.animals.find((a) => a.kind === 'bull');
    L.place(13.8, 10);            // 围场西边的狗洞外
    L.goTo(bull.x - 1.6, bull.z, 2.5);
    L.run(0.5, (i) => ({ moveTo: { x: bull.x, z: bull.z }, pounce: i === 0 }));
    L.run(3, { moveTo: null });
    check(tag, '公牛被撞到会冲撞：撞飞小狗、短暂眩晕', all.some((e) => e.type === 'charge') && all.some((e) => e.type === 'knocked'), all.filter((e) => ['charge', 'knocked', 'bump'].includes(e.type)).map((e) => e.type).join(','));
  }
  // 每种捣乱点都触发过
  const kinds = [...new Set(FIX.interactables.map((o) => o.kind))];
  const seen = new Set(all.filter((e) => e.type === 'mischief').map((e) => e.kind));
  for (const g of games.skilled) for (const k in g.res.mischief) seen.add(k);
  const missing = kinds.filter((k) => !seen.has(k));
  check(tag, `每种捣乱点（${kinds.length} 种）都能被触发并计分`, missing.length === 0, missing.length ? `缺 ${missing.join(',')}` : '');
  check(tag, '分数 = 所有捣乱事件分值 + 区域奖励', sim.score === all.filter((e) => e.type === 'mischief').reduce((s, e) => s + e.points, 0) + all.filter((e) => e.type === 'zoneCleared').reduce((s, e) => s + e.bonus, 0));
  // 规则表：分值倍率 / 不可用的种类 / 管理员睡着 / 动物回窝，setRules 局中切换
  {
    const rules = { ...DEFAULT_RULES, mischief: { ...DEFAULT_RULES.mischief, milk_can: 2 } };
    delete rules.mischief.crate; delete rules.mischief['*'];
    const M = lab(rules);
    M.pounceAt('milk1');
    M.pounceAt('crate1');
    const mm = M.all.filter((e) => e.type === 'mischief');
    check(tag, '规则表的分值倍率生效（奶桶 ×2），规则表里没有的种类不能触发', mm.length === 1 && mm[0].kind === 'milk_can' && mm[0].points === FARM.KINDS.milk_can.points * 2 && !M.obj('crate1').done);
  }
  {
    const s3 = createFarmSim({ map: FIX, seed: 2, test: { skipIntro: true, keeperPatrol: [[-6, -6]] } });
    const id = s3.addPet({});
    s3.debug.placePet(id, -6, -3);
    s3.debug.setKeeper({ x: -6, z: -6, heading: 0, anger: 1 });
    s3.setRules({ ...DEFAULT_RULES, keeper: { ...DEFAULT_RULES.keeper, awake: false }, animals: { ...DEFAULT_RULES.animals, chickens: 'roost' } });
    for (let i = 0; i < 180; i++) { s3.command(id, { moveTo: null }); s3.update(1 / 60); }
    const sleepK = s3.keeper.action === 'sleep' && s3.keeper.state !== 'chase';
    const roost = s3.animals.filter((a) => a.kind === 'chick' || a.kind === 'hen').every((a) => a.action === 'sleep');
    s3.setRules(DEFAULT_RULES);
    for (let i = 0; i < 60; i++) { s3.command(id, { moveTo: null }); s3.update(1 / 60); }
    check(tag, 'setRules 局中切换：管理员睡着不追、鸡回窝；换回白天规则后照常（看见火气满的小狗就追）', sleepK && roost && (s3.keeper.state === 'chase' || s3.caught > 0), `sleep=${sleepK} roost=${roost} 之后=${s3.keeper.state}`);
  }
}

// ====================================================================== 7) 多宠物与性能
{
  const tag = '7 多宠物';
  const runs = [1, 2, 3].map((s) => play(FIX, 'skilled', s, { remotes: 3 }));
  let remoteMis = 0, remoteCaught = 0, wrongTarget = 0, scoreOk = true;
  for (const g of runs) {
    const ids = new Set(g.rem.map((r) => r.id));
    for (const e of g.evs) {
      if (e.type === 'mischief' && ids.has(e.petId)) remoteMis++;
      if (e.type === 'caught' && ids.has(e.petId)) remoteCaught++;
    }
    const sum = g.evs.filter((e) => e.type === 'mischief').reduce((s, e) => s + e.points, 0) + g.evs.filter((e) => e.type === 'zoneCleared').reduce((s, e) => s + e.bonus, 0)
      + g.evs.filter((e) => e.type === 'escaped').reduce((s, e) => s + e.points, 0) - g.evs.filter((e) => e.type === 'caught').reduce((s, e) => s + e.penalty, 0);
    if (sum !== g.res.score) scoreOk = false;
    const moved = g.rem.every((r) => { const p = g.sim.petById(r.id); return Math.hypot(p.x - FIX.spawns.gate.x, p.z - FIX.spawns.gate.z) > 3; });
    if (!moved) wrongTarget++;
  }
  check(tag, '加 3 只 remote 宠物各自发指令：它们会动、不产生计分事件、不会被抓', remoteMis === 0 && remoteCaught === 0 && wrongTarget === 0, `remote 计分 ${remoteMis}，remote 被抓 ${remoteCaught}`);
  check(tag, '有 remote 宠物时 local 的分数仍然只由 local 的事件构成', scoreOk);
  const cmp = median(runs.map((g) => g.res.completion));
  check(tag, '有 remote 宠物时 skilled 完成度中位数仍 ≥ 70', cmp >= 70, `${runs.map((g) => g.res.completion).join(' ')}`);
  // remote 能吓跑动物，但不计分
  {
    const sim = createFarmSim({ map: FIX, seed: 4, test: { skipIntro: true, noKeeper: true } });
    sim.addPet({});
    const rid = sim.addPet({ name: '远端' }, { owner: 'remote' });
    let cx = 0, cz = 0, n = 0;
    for (const a of sim.animals) if (a.kind === 'chick') { cx += a.x; cz += a.z; n++; }
    cx /= n; cz /= n;
    sim.debug.placePet(rid, cx + 4, cz);
    let fled = 0;
    for (let i = 0; i < 90; i++) { sim.command(rid, { moveTo: { x: cx - 3.2, z: cz }, pounce: i === 40 }); sim.update(1 / 60); fled = Math.max(fled, sim.animals.filter((a) => a.kind === 'chick' && a.action === 'flee').length); }
    check(tag, 'remote 宠物能把动物吓跑，但不计分', fled >= 2 && sim.score === 0 && !sim.events.some((e) => e.type === 'mischief'), `逃跑 ${fled} 只，分数 ${sim.score}`);
  }
  const tag2 = '7 性能';
  const perf = play(FIX, 'skilled', 11, { remotes: 3, dt: 1 / 60, timeUpdate: true });
  const perf1 = play(FIX, 'skilled', 12, { dt: 1 / 60, timeUpdate: true });
  check(tag2, `一次 update(1/60) 平均 ≤ 0.3 毫秒（1 local + 3 remote：${perf.msPerUpdate.toFixed(4)} ms；单只：${perf1.msPerUpdate.toFixed(4)} ms）`, perf.msPerUpdate <= 0.3 && perf1.msPerUpdate <= 0.3);
}

// ====================================================================== 真实地图（如果已经有了）
{
  const tag = '真实地图';
  let REAL = null, err = null;
  try { REAL = (await import('../src/minigame/farm/mapData.js')).FARM_MAP; } catch (e) { err = e; }
  if (!REAL) {
    info(`src/minigame/farm/mapData.js 不存在或无法加载（${err && err.code ? err.code : err && err.message}），跳过真实地图测试`);
  } else {
    let world = null;
    try { world = buildFarmWorld(REAL); } catch (e) { check(tag, '地图数据能被逻辑层读入', false, e.message); }
    if (world) {
      const kn = world.nav('keeper'), pn = world.nav('pet');
      const sp = REAL.spawns;
      const gateI = pn.nearestFree(sp.gate.x, sp.gate.z, 4);
      const exitF = pn.field(sp.gate.x, sp.gate.z);
      const exitLen = pn.fieldDist(exitF, sp.exit.x, sp.exit.z);
      warn('小狗从大门能走到出口（圈门都关着）', gateI >= 0 && Number.isFinite(exitLen), `路程 ${f2(exitLen)}`);
      const openF = pn.field(sp.gate.x, sp.gate.z, () => true);
      const unreach = (REAL.interactables || []).filter((o) => !Number.isFinite(pn.fieldDist(openF, o.x, o.z))).map((o) => o.id);
      warn('小狗从大门能走到每个可互动物（圈门撞开之后）', unreach.length === 0, unreach.join(','));
      const kinds = [...new Set((REAL.interactables || []).map((o) => o.kind))];
      const unknown = kinds.filter((k) => !FARM.KINDS[k]);
      warn('地图里的可互动物种类逻辑层都认识', unknown.length === 0, unknown.length ? `不认识（按“扑一下就倒”处理）：${unknown.join(',')}` : kinds.join(','));
      const holes = world.gapColliders.map((c) => {
        const len = c.shape === 'box' ? 2 * Math.max(c.hw, c.hd) : 2 * c.r;
        const ok = pn.freeAt(c.x, c.z) || [[0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]].some(([dx, dz]) => pn.freeAt(c.x + dx, c.z + dz));
        return { id: c.id, len, ok };
      });
      const narrow = holes.filter((h) => !h.ok);
      warn(`篱笆洞够小狗钻（小狗直径 ${2 * FARM.PET_R}）`, narrow.length === 0, narrow.map((h) => `${h.id} 宽 ${f2(h.len)}`).join('，'));
      const home = sp.keeper.home;
      const hI = kn.nearestFree(home.x, home.z, 4);
      const badPatrol = (sp.keeper.patrol || []).filter(([x, z]) => { const i = kn.nearestFree(x, z, 4); return i < 0 || kn.comp[i] !== kn.comp[hI]; });
      warn('管理员的家和巡逻路线在同一片可走区域里', hI >= 0 && badPatrol.length === 0, badPatrol.length ? `走不到的路点 ${JSON.stringify(badPatrol)}` : '');
      const rs = {};
      let crashed = null;
      for (const kind of ['idle', 'random', 'skilled']) {
        rs[kind] = [];
        for (const s of [1, 2, 3, 4]) { try { rs[kind].push(play(REAL, kind, s)); } catch (e) { crashed = crashed || `${kind}/${s}: ${e.stack}`; } }
      }
      check(tag, '三档机器人各跑 4 局不报错', !crashed, crashed || '');
      if (!crashed) {
        const all = [...rs.idle, ...rs.random, ...rs.skilled];
        check(tag, '每局都能结束（不卡死）', all.every((g) => g.sim.finished));
        const bk = all.reduce((s, g) => s + g.bad.keeper, 0), bp = all.reduce((s, g) => s + g.bad.pet, 0);
        check(tag, '管理员 / 小狗全程不穿墙、不过洞、不涉深水、不出界', bk === 0 && bp === 0, (all.find((g) => g.bad.keeperWorst) || {}).bad?.keeperWorst || (all.find((g) => g.bad.petWorst) || {}).bad?.petWorst || '');
        const c = (k) => median(rs[k].map((g) => g.res.completion));
        for (const k of ['idle', 'random', 'skilled']) info(`${k}: 完成度 ${rs[k].map((g) => g.res.completion).join(' ')}；被抓 ${rs[k].map((g) => g.res.caught).join(' ')}；钻出口 ${rs[k].filter((g) => g.res.escaped).length}/4`);
        check(tag, '分档趋势成立：idle < random < skilled（完成度中位数）', c('idle') < c('random') && c('random') < c('skilled'), `${c('idle')} / ${c('random')} / ${c('skilled')}`);
        const perf = play(REAL, 'skilled', 5, { remotes: 3, dt: 1 / 60, timeUpdate: true });
        info(`真实地图性能：update(1/60) 平均 ${perf.msPerUpdate.toFixed(4)} ms（1 local + 3 remote）`);
      }
    }
  }
}

console.log(`\n共 ${total} 项，通过 ${total - fails} 项，未通过 ${fails} 项${warns ? `（另有真实地图数据提示 ${warns} 条，不计入）` : ''}`);
process.exit(fails ? 1 : 0);
