// Node 无头行为测试（WP5，DESIGN 4.WP5 第 11 条 a–f，外加鲁棒性 g/h）。
// 用法：node scripts/behavior-test.mjs [--only stick,brain,...] [--seed 12345] [--verbose]
//   --only 含义同 smoke：只有列出的模块用真实实现，其余用 stub；不带则全部真实。
// 所有位置都从 ctx.island.anchors 读取，对具体数值不敏感；stub 昆虫为空时测试自行注入假蝴蝶。
import * as THREE from 'three';
import { palette } from '../src/core/palette.js';
import { createEnvironment } from '../src/core/env.js';
import { mulberry32, wrapAngle } from '../src/core/util.js';
import { SPECS, loadWorld, createStepper } from '../src/core/world.js';

const argv = process.argv.slice(2);
const getArg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const VERBOSE = argv.includes('--verbose');
const SEED = parseInt(getArg('--seed') || '12345', 10);
const ALIAS = { dogModel: 'dog', dogBrain: 'brain', dogmodel: 'dog', dogbrain: 'brain' };
let only = null;
const onlyArg = getArg('--only');
if (onlyArg !== undefined) {
  only = new Set(onlyArg.split(',').map((s) => s.trim()).filter(Boolean).map((s) => ALIAS[s] || s));
  const valid = new Set(SPECS.map((s) => s.key));
  for (const k of only) if (!valid.has(k)) { console.error(`未知模块 "${k}"，可选：${[...valid].join(', ')}`); process.exit(2); }
}

const DT = 1 / 30;
const MAX_SPEED = 3.6;
const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`);
}
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : String(n));

// ---------------------------------------------------------------- 世界
// restScale：长时间行为（晒太阳 10–18 分钟、午睡 10–20 分钟……）的时长倍率。默认调到 0.1，一轮能在一两分钟内跑完；R 组用 1 按真实时长跑。
async function makeWorld({ hour = 12, weather = 'clear', seed = SEED, restScale = 0.1 } = {}) {
  const errors = [];
  const ctx = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(32, 1.4, 1, 400),
    renderer: null, env: null, palette,
    rng: mulberry32(seed),
    island: null, sky: null, critters: null, dog: null, stick: null, brain: null,
  };
  ctx.camera.position.set(0, 18, 34);
  ctx.camera.lookAt(0, 0, 0);
  ctx.env = createEnvironment({ rng: mulberry32(777), hour, weather });
  if (weather === 'rain' || weather === 'storm') ctx.env.setWeather(weather, { instant: true });
  const used = await loadWorld(ctx, { errors, real: only });
  const baseStep = createStepper(ctx, errors);
  if (ctx.brain && 'restScale' in ctx.brain) ctx.brain.restScale = restScale;

  // 昆虫：真实实现里没有蝴蝶时注入假蝴蝶（stub 的 targets 为空数组）
  const startles = [];
  const fakes = [];
  const c = ctx.critters;
  const origStartle = c.startle.bind(c);
  c.startle = (id) => { startles.push(id); return origStartle(id); };
  if (c.targets.length === 0) {
    const spots = ctx.island.anchors.flowerSpots;
    for (let i = 0; i < 4; i++) {
      const s = spots[i % spots.length];
      const t = { id: `fake-bf-${i}`, kind: 'butterfly', position: new THREE.Vector3(s.x, 0.8, s.z), active: true, chaseable: true };
      c.targets.push(t);
      fakes.push({ t, cx: s.x, cz: s.z, ph: i * 1.7, until: 0, lift: 0 });
    }
    const origStartle2 = c.startle;
    c.startle = (id) => {
      const f = fakes.find((q) => q.t.id === id);
      if (f) { f.until = ctx.env.elapsed + 5; }
      return origStartle2(id);
    };
  }
  const fakeUpdate = (dt) => {
    for (const f of fakes) {
      const now = ctx.env.elapsed;
      const startled = now < f.until;
      f.lift += ((startled ? 3 : 0) - f.lift) * Math.min(1, dt * 2);
      f.t.chaseable = !startled && f.lift < 0.2;
      f.t.position.set(f.cx + Math.sin(now * 0.7 + f.ph) * 0.4, 0.8 + f.lift + Math.sin(now * 1.3 + f.ph) * 0.15, f.cz + Math.cos(now * 0.6 + f.ph) * 0.4);
    }
  };
  const step = (dt) => { fakeUpdate(dt); baseStep(dt); };
  return { ctx, errors, step, used, startles, fakes };
}

// 狗窝内直线段（kennelDoor ↔ kennelInside）豁免 walkable 检查
function onKennelSegment(a, x, z) {
  const d = a.kennelDoor, k = a.kennelInside;
  const sx = k.x - d.x, sz = k.z - d.z;
  const L2 = sx * sx + sz * sz || 1;
  const t = Math.max(0, Math.min(1, ((x - d.x) * sx + (z - d.z) * sz) / L2));
  return Math.hypot(x - (d.x + sx * t), z - (d.z + sz * t)) < 0.35;
}

// 瞭望台 base↔top 直线段（脚本化的上下坡路段）同样豁免 walkable 检查
function onRampSegment(a, x, z) {
  const lk = a.lookout;
  if (!lk) return false;
  const sx = lk.top.x - lk.base.x, sz = lk.top.z - lk.base.z;
  const L2 = sx * sx + sz * sz || 1;
  const t = Math.max(0, Math.min(1, ((x - lk.base.x) * sx + (z - lk.base.z) * sz) / L2));
  return Math.hypot(x - (lk.base.x + sx * t), z - (lk.base.z + sz * t)) < 0.45;
}

/** 推进 seconds 秒，逐帧检查不变量；返回记录 */
function run(world, seconds, { until = null, onFrame = null } = {}) {
  const { ctx, step } = world;
  const dog = ctx.dog, island = ctx.island, a = island.anchors;
  const rec = world.rec || (world.rec = { actions: new Set(), states: [], violations: [], maxStep: 0, frames: 0, t: 0 });
  const n = Math.round(seconds / DT);
  let px = dog.group.position.x, pz = dog.group.position.z, py = dog.group.position.y;
  const mo = island.mat ? island.mat.object : null;
  if (mo && world.mpx === undefined) { world.mpx = mo.position.x; world.mpz = mo.position.z; }
  if (rec.maxDy === undefined) { rec.maxDy = 0; rec.matMax = 0; }
  for (let i = 0; i < n; i++) {
    step(DT);
    rec.t += DT;
    rec.frames++;
    const p = dog.group.position;
    const x = p.x, z = p.z;
    const viol = (m) => { if (rec.violations.length < 8) rec.violations.push(`t=${f2(rec.t)} ${m}`); };
    if (![x, p.y, z, dog.group.rotation.y, dog.speed].every(Number.isFinite)) viol('NaN');
    else {
      const d = Math.hypot(x - px, z - pz);
      if (d > rec.maxStep) rec.maxStep = d;
      if (d > MAX_SPEED * DT * 1.5) viol(`单帧位移 ${f2(d)} > ${f2(MAX_SPEED * DT * 1.5)} (state=${ctx.brain.state})`);
      const dy = Math.abs(p.y - py);
      if (dy > rec.maxDy) rec.maxDy = dy;
      if (dy > 0.08) viol(`单帧 |Δy| ${f2(dy)} > 0.08 at (${f2(x)}, ${f2(z)}) y=${f2(p.y)} prev=${f2(py)} (state=${ctx.brain.state})`);
      if (!island.isWalkable(x, z) && !onKennelSegment(a, x, z) && !onRampSegment(a, x, z)) viol(`不可行走 (${f2(x)}, ${f2(z)}) state=${ctx.brain.state}`);
      { const lift = p.y - island.heightAt(x, z); if (lift < -1e-6 || lift > 0.07) viol('y != heightAt（允许趴在垫子上时抬高到垫面，≤0.07）'); }
      if (dog.speed > MAX_SPEED * 1.05) viol(`speed ${f2(dog.speed)} 过大`);
    }
    px = x; pz = z; py = p.y;
    if (mo) {
      const md = Math.hypot(mo.position.x - world.mpx, mo.position.z - world.mpz);
      if (md > rec.matMax) rec.matMax = md;
      world.mpx = mo.position.x; world.mpz = mo.position.z;
    }
    rec.actions.add(dog.action);
    const base = ctx.brain.state;
    if (rec.states[rec.states.length - 1] !== base) rec.states.push(base);
    if (onFrame) onFrame(rec);
    if (until && until(rec)) return { hit: true, t: (i + 1) * DT };
  }
  return { hit: false, t: seconds };
}

const distTo = (ctx, v) => Math.hypot(ctx.dog.group.position.x - v.x, ctx.dog.group.position.z - v.z);
const summarize = (arr, max = 14) => (arr.length > max ? arr.slice(0, max).join(' > ') + ` > ...(共${arr.length})` : arr.join(' > '));
const baseState = (s) => s.split(':').slice(0, 2).join(':');

// ---------------------------------------------------------------- a) 正午晴天 180 秒
async function testA() {
  // 从 11:00 开始：最长要观察 22 分钟，从 12:00 开始会跑进午睡时段（12:15 起），那时精力低、基本不追蝴蝶
  const w = await makeWorld({ hour: 11, weather: 'clear' });
  const { ctx } = w;
  const seen = new Set();
  const r = run(w, 420, { onFrame: () => seen.add(baseState(ctx.brain.state)) });
  const rec = w.rec;
  const hasRun = rec.actions.has('run'), hasRoll = rec.actions.has('roll');
  // 行为是按权重随机选的：新增了瞭望台、晒太阳等长时间行为后，420 秒里约有 8% 的概率一次都没轮到追蝴蝶。
  // 没轮到就继续观察，最多再等 900 秒（连续性等检查照常进行）。
  for (let k = 0; k < 9 && w.startles.length < 1; k++) run(w, 100);
  const chased = w.startles.length >= 1;
  report('a1 晴天上午 420s 出现过 run', hasRun, `actions=[${[...rec.actions].join(',')}]`);
  report('a2 出现过 roll', hasRoll);
  report('a3 至少一次追蝴蝶 (critters.startle 被调用)', chased, `startle 调用 ${w.startles.length} 次`);
  report('a4 全程 walkable / 无 NaN / 单帧位移 ≤ 最高速度×dt×1.5', rec.violations.length === 0 && w.errors.length === 0,
    `最大单帧位移 ${f2(rec.maxStep)} (上限 ${f2(MAX_SPEED * DT * 1.5)}); ${rec.violations.join(' | ')}${w.errors.map((e) => ' ERR ' + e.module + ':' + e.message).join('')}`);
  console.log(`      行为序列: ${summarize([...rec.states].filter((s) => /^auto:[a-z]+$/.test(s) && s !== 'auto:idle'), 30)}`);
  console.log(`      出现的行为: ${[...seen].join(', ')}`);
  console.log(`      行为次数: ${JSON.stringify(ctx.brain.stats && ctx.brain.stats.behaviors)}`);
  if (VERBOSE) console.log('      behaviors:', JSON.stringify(ctx.brain.stats));
}

// ---------------------------------------------------------------- b) 下雨回窝 / 雨停出窝
async function testB() {
  const w = await makeWorld({ hour: 12, weather: 'clear' });
  const { ctx } = w;
  const a = ctx.island.anchors;
  run(w, 10);
  const startPos = `(${f2(ctx.dog.group.position.x)}, ${f2(ctx.dog.group.position.z)})`;
  ctx.env.setWeather('rain');
  const seqStart = w.rec.states.length;
  const r = run(w, 25, { until: () => distTo(ctx, a.kennelInside) < 0.4 && ctx.dog.action === 'lie' });
  report('b1 切到 rain：25s 内到达 kennelInside(<0.4) 且动作为 lie', r.hit,
    `耗时 ${f2(r.t)}s, 起点 ${startPos}, 距离 ${f2(distTo(ctx, a.kennelInside))}, 动作 ${ctx.dog.action}, 状态 ${summarize(w.rec.states.slice(seqStart))}`);
  run(w, 6);
  const stayOk = distTo(ctx, a.kennelInside) < 0.4 && ctx.dog.action === 'lie';
  report('b2 雨中保持在窝里 lie', stayOk, `6s 后动作 ${ctx.dog.action}`);
  ctx.env.setWeather('clear');
  const r2 = run(w, 40, { until: () => distTo(ctx, a.kennelInside) > 1.2 && !ctx.env.isRaining });
  report('b3 切回 clear：40s 内离开狗窝', r2.hit, `耗时 ${f2(r2.t)}s, 当前 rain=${f2(ctx.env.rain)}, 距窝内 ${f2(distTo(ctx, a.kennelInside))}`);
  report('b4 过程无违规', w.rec.violations.length === 0, w.rec.violations.join(' | '));
}

// ---------------------------------------------------------------- c) 深夜睡觉
async function testC() {
  const w = await makeWorld({ hour: 12, weather: 'clear' });
  const { ctx } = w;
  const a = ctx.island.anchors;
  run(w, 8);
  ctx.env.setHour(2);
  const r = run(w, 60, { until: () => distTo(ctx, a.kennelInside) < 0.4 && ctx.dog.action === 'sleep' });
  report('c1 中途切到 hour=2：60s 内在窝里 sleep', r.hit, `耗时 ${f2(r.t)}s, 动作 ${ctx.dog.action}, 距离 ${f2(distTo(ctx, a.kennelInside))}`);
  run(w, 10);
  report('c2 持续睡眠', ctx.dog.action === 'sleep' && distTo(ctx, a.kennelInside) < 0.4, `动作 ${ctx.dog.action}`);
  report('c3 过程无违规', w.rec.violations.length === 0, w.rec.violations.join(' | '));
  // 直接以 hour=2 启动
  const w2 = await makeWorld({ hour: 2, weather: 'clear' });
  const r2 = run(w2, 60, { until: () => distTo(w2.ctx, a.kennelInside) < 0.4 && w2.ctx.dog.action === 'sleep' });
  report('c4 以 hour=2 启动：60s 内 sleep', r2.hit, `耗时 ${f2(r2.t)}s`);
  // 清晨出窝
  w2.ctx.env.setHour(6.7);
  const r3 = run(w2, 30, { until: () => distTo(w2.ctx, a.kennelInside) > 1.2 });
  report('c5 hour=6.7（6:30 起床）：30s 内出窝', r3.hit, `耗时 ${f2(r3.t)}s, 经历动作 [${[...w2.rec.actions].join(',')}]`);
}

// ---------------------------------------------------------------- d) 点击互动
async function fetchRounds(w, label, nRounds) {
  const { ctx } = w;
  const a = ctx.island.anchors, stick = ctx.stick;
  const pts = [
    { x: a.lawn.x, z: a.lawn.z },
    { x: a.napSpot.x, z: a.napSpot.z },
    { x: a.sniffSpots[0].x, z: a.sniffSpots[0].z },
    { x: a.lawn.x - 1.5, z: a.lawn.z - 1.5 },
  ];
  let allOk = true;
  const lines = [];
  stick.click(null);
  const r0 = run(w, 8, { until: () => distTo(ctx, a.front) < 1.0 && (ctx.dog.action === 'spin' || ctx.dog.action === 'playbow') });
  report(`${label}1 click() → 8s 内狗距 front<1.0 且动作 spin/playbow`, r0.hit && stick.state === 'held',
    `耗时 ${f2(r0.t)}s, 距离 ${f2(distTo(ctx, a.front))}, 动作 ${ctx.dog.action}, stick=${stick.state}, 状态 ${summarize(w.rec.states.slice(-8))}`);
  for (let k = 0; k < nRounds; k++) {
    run(w, 2.5); // 让狗转几圈
    const seen = new Set();
    const p = pts[k % pts.length];
    const before = w.rec.states.length;
    stick.click(new THREE.Vector3(p.x, 0, p.z));
    let tHeld = null, tFly = null;
    const r = run(w, 15, {
      onFrame: (rec) => { seen.add(stick.state); if (stick.state === 'flying' && tFly === null) tFly = rec.t; },
      until: () => seen.has('carried') && stick.state === 'held',
    });
    const ok = r.hit && seen.has('flying') && seen.has('carried');
    allOk = allOk && ok;
    lines.push(`第${k + 1}轮 ${ok ? 'OK' : 'FAIL'} 耗时 ${f2(r.t)}s 经历 [${[...seen].join(',')}] target=(${f2(p.x)},${f2(p.z)}) 状态: ${summarize(w.rec.states.slice(before), 16)}`);
    if (!ok) break;
  }
  report(`${label}2 click(草坪点) → 15s 内回到 held，经历 flying、carried；连续 ${nRounds} 轮`, allOk, '\n      ' + lines.join('\n      '));
}

async function testD() {
  const w = await makeWorld({ hour: 12, weather: 'clear' });
  run(w, 5);
  await fetchRounds(w, 'd', 3);
  report('d3 过程无违规（walkable/NaN/位移）', w.rec.violations.length === 0 && w.errors.length === 0,
    `最大单帧位移 ${f2(w.rec.maxStep)}; ${w.rec.violations.join(' | ')}${w.errors.map((e) => ' ERR ' + e.message).join('')}`);
  // e) 10 秒超时
  const { ctx } = w, stick = ctx.stick;
  run(w, 3);
  report('e0 held 状态', stick.state === 'held', stick.state);
  let heldAt = null, hiddenAt = null;
  const r = run(w, 14, {
    onFrame: (rec) => {
      if (stick.state === 'held' && heldAt === null) heldAt = rec.t;
      if (stick.state === 'hidden' && hiddenAt === null && heldAt !== null) hiddenAt = rec.t;
    },
    until: () => hiddenAt !== null,
  });
  // heldAt 是进入 held 后首次被观察到的时间；这里已经在 held 里待了 3s，所以用 stick 内部计时对照：总 held 时长 = 3 + (hiddenAt - 本段起点)
  const total = 3 + (hiddenAt === null ? NaN : r.t);
  report('e1 held 后 10–11s 变为 hidden', hiddenAt !== null && total >= 9.9 && total <= 11.1, `held 总时长 ≈ ${f2(total)}s`);
  run(w, 2);
  report('e2 brain.mode 变回 auto', ctx.brain.mode === 'auto', `mode=${ctx.brain.mode}, state=${ctx.brain.state}`);
  // 中途点击会重置计时
  stick.click(null);
  run(w, 8);
  const st1 = stick.state;
  stick.click(null); // 在 held 中点击 = 扔出去；之后飞回再进入 held 会重新计时，这里只验证不卡死
  const r4 = run(w, 25, { until: () => stick.state === 'held' });
  report('e3 召唤后过 8s 再扔，飞回后重新计时并保持 held', st1 === 'held' && r4.hit, `扔前 ${st1}, 回到 held 耗时 ${f2(r4.t)}s`);
  run(w, 14);
  report('e4 最终回到 hidden + auto', stick.state === 'hidden' && ctx.brain.mode === 'auto', `${stick.state}/${ctx.brain.mode}`);
}

// ---------------------------------------------------------------- f) 下雨时点击
async function testF() {
  const w = await makeWorld({ hour: 12, weather: 'rain' });
  const { ctx } = w;
  const a = ctx.island.anchors, stick = ctx.stick;
  run(w, 20, { until: () => distTo(ctx, a.kennelInside) < 0.4 && ctx.dog.action === 'lie' });
  report('f0 雨中先在窝里 lie', distTo(ctx, a.kennelInside) < 0.4 && ctx.dog.action === 'lie', `动作 ${ctx.dog.action}`);
  run(w, 3);
  stick.click(null);
  const r = run(w, 14, { until: () => distTo(ctx, a.front) < 1.0 && (ctx.dog.action === 'spin' || ctx.dog.action === 'playbow') });
  report('f1 下雨时 click：狗出窝来到 front 兴奋转圈', r.hit, `耗时 ${f2(r.t)}s, 动作 ${ctx.dog.action}, 状态 ${summarize(w.rec.states.slice(-8))}`);
  // 玩一轮
  run(w, 2);
  const seen = new Set();
  stick.click(new THREE.Vector3(a.lawn.x, 0, a.lawn.z));
  const r2 = run(w, 18, { onFrame: () => seen.add(stick.state), until: () => seen.has('carried') && stick.state === 'held' });
  report('f2 雨中完成一轮 fetch', r2.hit, `耗时 ${f2(r2.t)}s`);
  // 超时 → 回窝
  const r3 = run(w, 12, { until: () => stick.state === 'hidden' });
  report('f3 超时后木棍收起', r3.hit, `${f2(r3.t)}s`);
  const r4 = run(w, 30, { until: () => distTo(ctx, a.kennelInside) < 0.4 && ctx.dog.action === 'lie' });
  report('f4 超时后回窝（到达 kennelInside 且 lie）', r4.hit, `耗时 ${f2(r4.t)}s, 状态 ${summarize(w.rec.states.slice(-8))}`);
  report('f5 过程无违规', w.rec.violations.length === 0 && w.errors.length === 0, w.rec.violations.join(' | '));
}

// ---------------------------------------------------------------- g/h) 鲁棒性
async function testG() {
  // g：还没跑到 front 就扔
  const w = await makeWorld({ hour: 12, weather: 'clear' });
  const { ctx } = w, a = ctx.island.anchors, stick = ctx.stick;
  run(w, 6);
  stick.click(null);
  run(w, 0.8); // 狗还在路上
  const farFromFront = distTo(ctx, a.front) > 1.0;
  stick.click(new THREE.Vector3(a.lawn.x, 0, a.lawn.z));
  const seen = new Set();
  const r = run(w, 25, { onFrame: () => seen.add(stick.state), until: () => seen.has('carried') && stick.state === 'held' });
  report('g1 狗没到 front 就被扔出木棍：仍能去追并叼回', r.hit, `扔出时离 front ${farFromFront ? '>1.0' : '<=1.0(未能构造)'}，耗时 ${f2(r.t)}s`);
  // h：乱点（连点）不会卡死
  const w2 = await makeWorld({ hour: 12, weather: 'clear', seed: SEED + 1 });
  const c2 = w2.ctx;
  const rng = mulberry32(99);
  run(w2, 4);
  let frames = 0;
  for (let i = 0; i < 160; i++) { // 约 40 秒，每 0.25s 一次随机点击
    const x = (rng() - 0.5) * 16, z = (rng() - 0.5) * 16;
    c2.stick.click(rng() < 0.1 ? null : new THREE.Vector3(x, 0, z));
    run(w2, 0.25);
    frames++;
  }
  const seen2 = new Set();
  // 停止点击后：最终应能 hidden + auto（不超过 10s 计时 + 回程时间）
  const r2 = run(w2, 60, { onFrame: () => seen2.add(c2.stick.state), until: () => c2.stick.state === 'hidden' && c2.brain.mode === 'auto' });
  report('h1 狂点 40s 后停手：60s 内回到 hidden + auto（未卡死）', r2.hit, `耗时 ${f2(r2.t)}s, stick=${c2.stick.state}, mode=${c2.brain.mode}, state=${c2.brain.state}`);
  report('h2 狂点过程无违规', w2.rec.violations.length === 0 && w2.errors.length === 0, `${w2.rec.violations.join(' | ')}${w2.errors.map((e) => ' ERR ' + e.message).join('')}`);
  // 打雷受惊
  const w3 = await makeWorld({ hour: 12, weather: 'storm' });
  const acts = new Set();
  run(w3, 90, { onFrame: () => acts.add(w3.ctx.dog.action) });
  report('h3 雷雨 90s：出现 flinch 且无违规', acts.has('flinch') && w3.rec.violations.length === 0, `actions=[${[...acts].join(',')}], 雷击 ${w3.ctx.env.lightningSeq} 次; ${w3.rec.violations.join(' | ')}`);
}

// ---------------------------------------------------------------- 傍晚 / 黄昏（附加）
async function testExtra() {
  const w = await makeWorld({ hour: 18.2, weather: 'clear' });
  const a = w.ctx.island.anchors;
  const states = new Set();
  run(w, 120, { onFrame: () => states.add(baseState(w.ctx.brain.state)) });
  report('x1 晚霞时段 120s 内去看夕阳 (auto:sunset)', states.has('auto:sunset'), `sunsetFactor=${f2(w.ctx.env.sunsetFactor)}, 出现 [${[...states].join(',')}]`);
  const w2 = await makeWorld({ hour: 20, weather: 'clear' });
  const st2 = new Set();
  run(w2, 120, { onFrame: () => st2.add(baseState(w2.ctx.brain.state)) });
  report('x2 傍晚 20:00 120s 内去窝门口 (auto:evening)', st2.has('auto:evening'), `[${[...st2].join(',')}]`);
  const w3 = await makeWorld({ hour: 13.2, weather: 'clear' });
  const st3 = new Set();
  run(w3, 420, { onFrame: () => st3.add(w3.ctx.dog.action) });
  report('x3 午后 13:12 出现打盹 sleep', st3.has('sleep'), `[${[...st3].join(',')}]`);
  const w4 = await makeWorld({ hour: 12, weather: 'cloudy' });
  const st4 = new Set();
  run(w4, 120, { onFrame: () => st4.add(w4.ctx.dog.action) });
  report('x4 阴天 120s 无违规', w4.rec.violations.length === 0, `[${[...st4].join(',')}] ${w4.rec.violations.join(' | ')}`);
}

// ---------------------------------------------------------------- L) 瞭望台
const topY = (ctx) => ctx.island.anchors.lookout.height;
const onTop = (ctx) => ctx.dog.group.position.y >= topY(ctx) - 0.05;
const matDog = (ctx) => { const m = ctx.island.mat.object.position; return Math.hypot(ctx.dog.group.position.x - m.x, ctx.dog.group.position.z - m.z); };
const matHome = (ctx) => { const m = ctx.island.mat.object.position, h = ctx.island.mat.home; return Math.hypot(m.x - h.x, m.z - h.z); };
const hasLookout = (w) => !!(w.ctx.island.anchors.lookout && w.ctx.brain && w.ctx.brain.force);
const hasMat = (w) => !!(w.ctx.island.mat && w.ctx.brain && w.ctx.brain.force);

/** 强制 lookout 并跑到狗在平台上“眺望”阶段 */
function climbToTop(w, limit = 60) {
  const { ctx } = w;
  ctx.brain.force('lookout');
  return run(w, limit, { until: () => onTop(ctx) && ctx.brain.state === 'auto:lookout:watch' });
}

async function testL() {
  const w0 = await makeWorld({ hour: 12, weather: 'clear', restScale: 0.2 }); // 眺望 1–2 分钟 × 0.2 = 12–24 秒
  if (!hasLookout(w0)) { console.log('SKIP  L1–L3：当前小岛/brain 没有 lookout（stub）'); return; }
  // L1
  {
    const w = w0, { ctx } = w;
    const lk = ctx.island.anchors.lookout;
    run(w, 1);
    ctx.brain.force('lookout');
    let topT = null, acc = 0, maxY = 0;
    const t0 = w.rec.t;
    const r = run(w, 120, {
      onFrame: (rec) => {
        const y = ctx.dog.group.position.y;
        if (y > maxY) maxY = y;
        if (onTop(ctx)) {
          if (topT === null) topT = rec.t;
          if (ctx.dog.action === 'sit' || ctx.dog.action === 'idle') acc += DT;
        }
      },
      until: () => acc >= 8 && ctx.dog.group.position.y < 0.3 && ctx.island.isWalkable(ctx.dog.group.position.x, ctx.dog.group.position.z) && !ctx.brain.state.startsWith('auto:lookout'),
    });
    const reach = topT !== null && topT - t0 <= 60;
    report('L1 force(lookout)：60s 内到达平台（y≥height-0.05），sit/idle 累计 ≥ 8s，之后回到地面且 walkable', reach && acc >= 8 && r.hit,
      `到达平台 ${topT === null ? '未到达' : f2(topT - t0) + 's'}, 平台上 sit/idle ${f2(acc)}s, 最高 y=${f2(maxY)}(平台 ${f2(lk.height)}), 回地面 ${r.hit}, 耗时 ${f2(r.t)}s`);
    report('L1b 全程连续（单帧位移 ≤ 3.6×dt×1.5，|Δy| ≤ 0.08，无 NaN）', w.rec.violations.length === 0 && w.errors.length === 0,
      `maxStep ${f2(w.rec.maxStep)}, maxDy ${f2(w.rec.maxDy)}; ${w.rec.violations.join(' | ')}`);
    console.log(`      行为状态: ${summarize([...w.rec.states].filter((s) => s.startsWith('auto:lookout')), 12)}`);
  }
  // L2
  {
    const w = await makeWorld({ hour: 12, weather: 'clear', seed: SEED + 7 });
    const { ctx } = w, a = ctx.island.anchors, stick = ctx.stick;
    run(w, 1);
    const r0 = climbToTop(w, 80);
    run(w, 1);
    const wasTop = onTop(ctx);
    stick.click(null);
    const r = run(w, 20, { until: () => distTo(ctx, a.front) < 1.0 });
    report('L2 狗在平台上 click(null)：20s 内到 front(<1.0)，沿坡道下来，全程连续', r0.hit && wasTop && r.hit && w.rec.violations.length === 0,
      `上平台 ${r0.hit}, 点击时在平台 ${wasTop}, 耗时 ${f2(r.t)}s, 距 front ${f2(distTo(ctx, a.front))}; 状态 ${summarize(w.rec.states.slice(-8))}; ${w.rec.violations.join(' | ')}`);
    // 随后一整轮 扔-捡-还
    run(w, 2.5);
    const seen = new Set();
    stick.click(new THREE.Vector3(a.lawn.x, 0, a.lawn.z));
    const r2 = run(w, 15, { onFrame: () => seen.add(stick.state), until: () => seen.has('carried') && stick.state === 'held' });
    report('L2b 随后完整一轮 扔-捡-还', r2.hit && seen.has('flying') && seen.has('carried') && w.rec.violations.length === 0,
      `耗时 ${f2(r2.t)}s 经历 [${[...seen].join(',')}]; ${w.rec.violations.join(' | ')}`);
  }
  // L3
  {
    const w = await makeWorld({ hour: 12, weather: 'clear', seed: SEED + 11 });
    const { ctx } = w, a = ctx.island.anchors;
    run(w, 1);
    const r0 = climbToTop(w, 80);
    run(w, 1);
    const wasTop = onTop(ctx);
    ctx.env.setWeather('rain');
    const r = run(w, 30, { until: () => distTo(ctx, a.kennelInside) < 0.4 && ctx.dog.action === 'lie' });
    report('L3 狗在平台上切到 rain：30s 内到达 kennelInside 且 lie，全程连续', r0.hit && wasTop && r.hit && w.rec.violations.length === 0,
      `上平台 ${r0.hit}, 切雨时在平台 ${wasTop}, 耗时 ${f2(r.t)}s, 状态 ${summarize(w.rec.states.slice(-8), 12)}; ${w.rec.violations.join(' | ')}`);
  }
}

// ---------------------------------------------------------------- M) 拖垫子晒太阳
const MAT_STEP_MAX = 0.2;
async function testM() {
  const w0 = await makeWorld({ hour: 12, weather: 'clear' });
  if (!hasMat(w0)) { console.log('SKIP  M1–M3：当前小岛/brain 没有 island.mat（stub）'); return; }
  const lyingOnMat = (ctx) => (ctx.dog.action === 'lie' || ctx.dog.action === 'sleep' || ctx.dog.action === 'roll') && matDog(ctx) < 0.4;
  // M1
  {
    const w = w0, { ctx } = w;
    run(w, 1);
    ctx.brain.force('sunbathe');
    let maxAway = 0, acc = 0, sawRoll = false;
    const r = run(w, 420, {
      onFrame: () => {
        maxAway = Math.max(maxAway, matHome(ctx));
        if (lyingOnMat(ctx)) { acc += DT; if (ctx.dog.action === 'roll') sawRoll = true; }
      },
      until: () => acc >= 12 && matHome(ctx) < 0.3 && !ctx.brain.state.startsWith('auto:sunbathe'),
    });
    report('M1 force(sunbathe)：垫子离开 home(>2.5) → 狗在垫子上 lie/sleep/roll 累计 ≥ 12s → 垫子回到 home(<0.3) 且 brain 回到其他行为', r.hit && maxAway > 2.5,
      `耗时 ${f2(r.t)}s, 垫子最远离 home ${f2(maxAway)}, 垫上累计 ${f2(acc)}s(翻身 ${sawRoll}), 垫子距 home ${f2(matHome(ctx))}, state=${ctx.brain.state}`);
    report('M1b 垫子单帧位移 ≤ 0.2；狗全程连续（位移/|Δy|/walkable）', w.rec.matMax <= MAT_STEP_MAX && w.rec.violations.length === 0 && w.errors.length === 0,
      `垫子最大单帧位移 ${f2(w.rec.matMax)}, 狗 maxStep ${f2(w.rec.maxStep)} maxDy ${f2(w.rec.maxDy)}; ${w.rec.violations.join(' | ')}`);
    console.log(`      行为状态: ${summarize([...w.rec.states].filter((s) => s.startsWith('auto:sunbathe')), 24)}`);
  }
  // M2：(a) 睡着时下雨  (b) 拖行途中下雨
  for (const [tag, phase] of [['a', 'auto:sunbathe:sleep'], ['b', 'auto:sunbathe:drag']]) {
    const w = await makeWorld({ hour: 12, weather: 'clear', seed: SEED + 3 });
    const { ctx } = w, a = ctx.island.anchors;
    run(w, 1);
    ctx.brain.force('sunbathe');
    const r0 = run(w, 200, { until: () => ctx.brain.state === phase });
    if (tag === 'b') run(w, 5); // 拖行一段再下雨
    const outAt = `(${f2(ctx.island.mat.object.position.x)}, ${f2(ctx.island.mat.object.position.z)})`;
    ctx.env.setWeather('rain');
    const r = run(w, 40, { until: () => distTo(ctx, a.kennelInside) < 0.4 && ctx.dog.action === 'lie' });
    const matAtRain = matHome(ctx);
    ctx.env.setWeather('clear');
    let done = false;
    const r2 = run(w, 240, {
      until: () => {
        if ((matHome(ctx) < 0.3 && !ctx.brain.state.startsWith('auto:kennel')) || (lyingOnMat(ctx) && matHome(ctx) > 0.3)) { done = true; return true; }
        return false;
      },
    });
    report(`M2${tag} 晒太阳途中（${phase.split(':')[2]}）切 rain：狗回窝 lie；垫子无瞬移；切回 clear 后 240s 内垫子回 home 或狗重新在垫子上`,
      r0.hit && r.hit && w.rec.matMax <= MAT_STEP_MAX && done && w.rec.violations.length === 0,
      `下雨时垫子在 ${outAt}, 回窝耗时 ${f2(r.t)}s (此时垫子距 home ${f2(matAtRain)}), 恢复耗时 ${f2(r2.t)}s, 垫子最大单帧位移 ${f2(w.rec.matMax)}; ${w.rec.violations.join(' | ')}`);
    if (!done) console.log(`      最近状态: ${summarize(w.rec.states.slice(-24), 24)} mover=${JSON.stringify(ctx.brain.mover && { x: +ctx.brain.mover.x.toFixed(2), z: +ctx.brain.mover.z.toFixed(2), hasGoal: ctx.brain.mover.hasGoal, speed: +ctx.brain.mover.speed.toFixed(2), inKennel: ctx.brain.mover.inKennel })} mat=(${f2(ctx.island.mat.object.position.x)},${f2(ctx.island.mat.object.position.z)})`);
  }
  // M3
  {
    const w = await makeWorld({ hour: 12, weather: 'clear', seed: SEED + 5 });
    const { ctx } = w, a = ctx.island.anchors, stick = ctx.stick;
    run(w, 1);
    ctx.brain.force('sunbathe');
    const r0 = run(w, 200, { until: () => ctx.brain.state === 'auto:sunbathe:sleep' });
    run(w, 2);
    stick.click(null);
    const r1 = run(w, 15, { until: () => distTo(ctx, a.front) < 1.0 && (ctx.dog.action === 'spin' || ctx.dog.action === 'playbow') });
    run(w, 2.5);
    const seen = new Set();
    stick.click(new THREE.Vector3(a.lawn.x, 0, a.lawn.z));
    const r2 = run(w, 15, { onFrame: () => seen.add(stick.state), until: () => seen.has('carried') && stick.state === 'held' });
    report('M3 晒太阳途中 click(null)：fetch 正常完成一轮；垫子无瞬移', r0.hit && r1.hit && r2.hit && w.rec.matMax <= MAT_STEP_MAX && w.rec.violations.length === 0,
      `到 front ${f2(r1.t)}s, 一轮 ${f2(r2.t)}s [${[...seen].join(',')}], 垫子最大单帧位移 ${f2(w.rec.matMax)}; ${w.rec.violations.join(' | ')}`);
    // 之后让它自己恢复：10s 超时收起木棍后，垫子最终要回窝（状态机不卡死）
    run(w, 12);
    const r3 = run(w, 420, { until: () => matHome(ctx) < 0.3 && ctx.brain.mode === 'auto' });
    report('M3b fetch 结束后状态机不卡死（垫子最终回到 home）', r3.hit, `耗时 ${f2(r3.t)}s, 垫子距 home ${f2(matHome(ctx))}, state=${ctx.brain.state}`);
    if (!r3.hit) console.log('      最近状态: ' + summarize(w.rec.states.slice(-30), 30) + ' mover=' + JSON.stringify(ctx.brain.mover && { x: ctx.brain.mover.x, z: ctx.brain.mover.z, hasGoal: ctx.brain.mover.hasGoal, speed: ctx.brain.mover.speed, blocked: ctx.brain.mover.blocked, inKennel: ctx.brain.mover.inKennel, onRamp: ctx.brain.mover.onRamp }));
  }
}

// ---------------------------------------------------------------- P) 摸摸小狗
// 输入用一个假的 ctx.petInput（真实环境里由 interaction/petting.js 根据鼠标生成）
async function testP() {
  const w = await makeWorld({ hour: 12, weather: 'clear' });
  const { ctx } = w;
  if (!ctx.brain || typeof ctx.brain.canPet !== 'function') { console.log('SKIP  P1–P5：当前 brain 不支持摸摸（stub）'); return; }
  const dog = ctx.dog, brain = ctx.brain, stick = ctx.stick;
  const pi = { over: false, active: false, point: new THREE.Vector3(), cursor: '' };
  ctx.petInput = pi;
  const aim = () => { pi.point.copy(dog.group.position); pi.point.y += 0.5; };
  run(w, 6);
  // P1：开始摸 → 很快进入 pet 模式并停下；40 秒里出现多种反应
  pi.over = true; pi.active = true;
  const r1 = run(w, 3, { onFrame: aim, until: () => brain.mode === 'pet' && dog.speed === 0 });
  const reactions = new Set(), actions = new Set();
  const p0 = dog.group.position.clone();
  let maxDrift = 0, blissAll = true;
  run(w, 40, { onFrame: () => { aim(); if (brain.mode === 'pet') { reactions.add(brain.pet.reaction); actions.add(dog.action); } else blissAll = false; if (dog.bliss !== 1) blissAll = false; maxDrift = Math.max(maxDrift, Math.hypot(dog.group.position.x - p0.x, dog.group.position.z - p0.z)); } });
  report('P1 开始摸：3s 内进入 pet 模式并停下；40s 内出现 ≥3 种反应，含坐下和翻肚皮；全程原地不乱跑', r1.hit && reactions.size >= 3 && actions.has('sit') && actions.has('roll') && maxDrift < 0.6 && blissAll,
    `进入耗时 ${f2(r1.t)}s, 反应=[${[...reactions].join(',')}], 动作=[${[...actions].join(',')}], 最大位移 ${f2(maxDrift)}`);
  // P2：鼠标离开 → 回到自主行为
  pi.over = false; pi.active = false;
  const r2 = run(w, 4, { until: () => brain.mode === 'auto' });
  const r2b = run(w, 30, { until: () => /^auto:[a-z]+/.test(brain.state) && brain.state !== 'auto:idle' });
  report('P2 鼠标离开：回到 auto，享受表情结束，之后继续做自己的事', r2.hit && dog.bliss === 0 && r2b.hit, `回到 auto ${f2(r2.t)}s, 之后 ${f2(r2b.t)}s 开始 ${brain.state}`);
  // P3：扔树枝进行中不能摸
  stick.click(null);
  run(w, 8, { until: () => brain.mode === 'fetch' && brain.state.startsWith('fetch:wait') });
  pi.over = true; pi.active = true;
  let petDuringFetch = false;
  run(w, 4, { onFrame: () => { aim(); if (brain.mode === 'pet') petDuringFetch = true; } });
  report('P3 扔树枝进行中：不触发摸摸', !petDuringFetch && brain.mode === 'fetch' && brain.canPet() === false, `mode=${brain.mode}, state=${brain.state}`);
  stick.dismiss(); pi.over = false; pi.active = false;
  run(w, 3);
  // P4：摸到一半开始扔树枝 → 立刻让位给扔树枝
  pi.over = true; pi.active = true;
  run(w, 3, { onFrame: aim, until: () => brain.mode === 'pet' });
  const wasPet = brain.mode === 'pet';
  stick.click(null);
  const r4 = run(w, 2, { onFrame: aim, until: () => brain.mode === 'fetch' });
  report('P4 摸到一半点了树枝：立刻让位给扔树枝', wasPet && r4.hit && dog.bliss === 0, `之前 pet=${wasPet}, 切到 fetch ${f2(r4.t)}s`);
  stick.dismiss(); pi.over = false; pi.active = false;
  run(w, 3);
  // P5：下雨回窝、在窝里时不能摸；摸到一半下雨也会结束
  pi.over = true; pi.active = true;
  run(w, 3, { onFrame: aim, until: () => brain.mode === 'pet' });
  ctx.env.setWeather('rain', { instant: true });
  const r5 = run(w, 3, { onFrame: aim, until: () => brain.mode !== 'pet' });
  let petInRain = false;
  const r5b = run(w, 30, { onFrame: () => { aim(); if (brain.mode === 'pet') petInRain = true; }, until: () => dog.action === 'lie' && brain.state.startsWith('auto:kennel') });
  report('P5 摸到一半下雨：结束摸摸回窝避雨；回窝途中和窝里都不能摸', r5.hit && r5b.hit && !petInRain && brain.canPet() === false, `结束 ${f2(r5.t)}s, 回窝 ${f2(r5b.t)}s`);
  // P7：小手只是搭在小狗身上（还没滑动）→ 小狗停下来等着，不再乱跑；手拿开后恢复
  {
    const w7 = await makeWorld({ hour: 12, weather: 'clear' });
    const c7 = w7.ctx, d7 = c7.dog, b7 = c7.brain;
    const pi7 = { over: false, active: false, hold: false, point: new THREE.Vector3(), cursor: '' };
    c7.petInput = pi7;
    run(w7, 3); b7.force('zoomies');
    run(w7, 90, { until: () => d7.speed > 2 }); // 等它跑起来（撒欢跑圈）
    const wasRunning = d7.speed > 2;
    pi7.over = true; pi7.hold = true;
    const aim7 = () => { pi7.point.copy(d7.group.position); pi7.point.y += 0.5; };
    const r7 = run(w7, 3, { onFrame: aim7, until: () => b7.mode === 'pet' && d7.speed === 0 });
    const p7 = d7.group.position.clone(); let drift7 = 0, allWait = true;
    run(w7, 12, { onFrame: () => { aim7(); drift7 = Math.max(drift7, Math.hypot(d7.group.position.x - p7.x, d7.group.position.z - p7.z)); if (b7.state !== 'pet:wait') allWait = false; } });
    pi7.over = false; pi7.hold = false;
    const r7b = run(w7, 3, { until: () => b7.mode === 'auto' });
    report('P7 小手搭上来（未滑动）：跑动中的小狗 3s 内停住并原地等 12s；手拿开后恢复', wasRunning && r7.hit && drift7 < 0.05 && allWait && r7b.hit && w7.rec.violations.length === 0,
      `跑动中=${wasRunning}, 停住耗时 ${f2(r7.t)}s, 等待期间位移 ${f2(drift7)}, 全程 pet:wait=${allWait}, 恢复 ${f2(r7b.t)}s; ${w7.rec.violations.slice(0, 3).join(' | ')}`);
  }
  report('P6 摸摸全过程无违规', w.rec.violations.length === 0 && w.errors.length === 0, w.rec.violations.slice(0, 4).join(' | ') + w.errors.map((e) => ' ERR ' + e.module + ':' + e.message).join(''));
}

// ---------------------------------------------------------------- Q) 小游戏接管模式（brain.mode === 'game'，钓鱼小游戏用）
async function testGame() {
  const w = await makeWorld({ hour: 12, weather: 'clear' });
  const { ctx, step } = w;
  const brain = ctx.brain, dog = ctx.dog, stick = ctx.stick, A = ctx.island.anchors, isl = ctx.island;
  if (typeof brain.enterGame !== 'function') { console.log('SKIP  Q1–Q5：当前 brain 不支持小游戏接管（stub）'); return; }
  const P = A.pond;
  const dx = A.pondDrink.x - P.x, dz = A.pondDrink.z - P.z, dl = Math.hypot(dx, dz);
  const spot = { x: P.x + (dx / dl) * (P.r * 0.98), z: P.z + (dz / dl) * (P.r * 0.98) };  // 水边（在池塘的障碍圆里面）
  const outp = { x: P.x + (dx / dl) * (P.r + 0.28 + 0.5), z: P.z + (dz / dl) * (P.r + 0.28 + 0.5) };
  let calls = 0, need = 0, need1 = '', exited = 0, ph = 0, t = 0, maxD = 0;
  const ctl = {
    state: 'test',
    update(dt, S) {
      calls++; t += dt;
      const m = S.mover;
      if (ph === 1 && !m.hasGoal) { m.goStraight(spot.x, spot.z, { free: true, speed: 0.85, arriveR: 0.06 }); ph = 2; t = 0; }
      else if (ph === 2 && !m.hasGoal) { ph = 3; t = 0; }
      else if (ph === 4 && !m.hasGoal) { ph = 5; }
    },
    onNeedKennel(why) { need++; need1 = why; },
    exit() { exited++; },
  };
  run(w, 6);
  const can0 = brain.canGame();
  const ok = brain.enterGame(ctl);
  report('Q1 enterGame：canGame 为真时接管成功，mode=game、state 以 game: 开头、canPet 为假；controller.update 每帧都调用', can0 && ok && brain.mode === 'game' && brain.state.startsWith('game:') && brain.canPet() === false,
    `can=${can0}, ok=${ok}, mode=${brain.mode}, state=${brain.state}`);
  let c0 = calls; for (let i = 0; i < 60; i++) step(DT);
  report('Q1b 接管期间 controller.update 每帧调用，brain 不再自己选行为', calls - c0 === 60 && brain.mode === 'game' && brain.state.startsWith('game:'), `${calls - c0}/60 帧`);
  stick.click(null); // 接管期间 fetch 不响应
  for (let i = 0; i < 90; i++) step(DT);
  const stayed = brain.mode === 'game';
  stick.dismiss(); for (let i = 0; i < 30; i++) step(DT);
  report('Q2 接管期间扔树枝（stick 非 hidden）不会切到 fetch，brain 一直是 game', stayed && brain.mode === 'game', `mode=${brain.mode}`);
  // Q3：脚本化直线段：寻路到池塘障碍圆外，再沿直线走到水边（在障碍圆里面），再走回来
  ph = 1; dog.setAction('walk');
  brain.mover.goTo(outp.x, outp.z, { arriveR: 0.22 });
  let n = 0; let bad = '';
  while (ph < 3 && n++ < 30 * 40) { step(DT); const p = dog.group.position; if (![p.x, p.y, p.z].every(Number.isFinite)) { bad = 'NaN'; break; } }
  const dSpot = Math.hypot(brain.mover.x - spot.x, brain.mover.z - spot.z);
  report('Q3 脚本化直线段（free）：能走进池塘障碍圆内的水边（该点本身不可行走）并到达', ph >= 3 && dSpot < 0.12 && !isl.isWalkable(spot.x, spot.z) && !bad, `到达=${ph >= 3}, 距离 ${f2(dSpot)}, walkable=${isl.isWalkable(spot.x, spot.z)}, 用时 ${f2(n * DT)}s ${bad}`);
  ph = 4; brain.mover.goStraight(outp.x, outp.z, { free: true, speed: 1.05, arriveR: 0.15 });
  n = 0; while (ph < 5 && n++ < 30 * 15) step(DT);
  const dOut = Math.hypot(brain.mover.x - outp.x, brain.mover.z - outp.z);
  report('Q3b 脚本化直线段走回障碍圆外后 isWalkable', ph >= 5 && dOut < 0.2 && isl.isWalkable(brain.mover.x, brain.mover.z), `回到外圈 ${ph >= 5}, 距离 ${f2(dOut)}, walkable=${isl.isWalkable(brain.mover.x, brain.mover.z)}`);
  // Q4：exitGame → 回到 auto，自主行为继续，之后 25 秒无违规
  brain.exitGame();
  report('Q4 exitGame：mode 回到 auto，controller.exit 调用 1 次', brain.mode === 'auto' && exited === 1, `mode=${brain.mode}, exited=${exited}`);
  w.rec = null;
  const r4 = run(w, 25, { until: () => false });
  report('Q4b 退出后 25 秒：自主行为正常进行（出现 auto 行为）、无违规（walkable / 单帧位移 / 贴地）', w.rec.violations.length === 0 && w.rec.states.length > 0 && w.errors.length === 0 && /^auto:/.test(brain.state), `state=${brain.state}; ${w.rec.violations.slice(0, 3).join(' | ')}`);
  // Q5：下雨 → 通知 controller（一次）；雨天 canGame 为假、enterGame 被拒；exitGame 后回窝
  need = 0; ph = 0;
  run(w, 90, { until: () => brain.canGame() }); // 刚好叼着垫子时不能接管：等它放下
  const ok2 = brain.enterGame(ctl);
  for (let i = 0; i < 30; i++) step(DT);
  ctx.env.setWeather('rain', { instant: true });
  for (let i = 0; i < 60; i++) step(DT);
  report('Q5 接管中下雨：controller.onNeedKennel(rain) 恰好调用 1 次', ok2 && need === 1 && need1 === 'rain' && brain.mode === 'game', `need=${need}, why=${need1}, mode=${brain.mode}`);
  brain.exitGame();
  report('Q5b 雨天 canGame 为假，enterGame 被拒绝', brain.canGame() === false && brain.enterGame(ctl) === false && brain.mode === 'auto', `can=${brain.canGame()}, mode=${brain.mode}`);
  const r5 = run(w, 40, { until: () => dog.action === 'lie' && brain.state.startsWith('auto:kennel') });
  report('Q5c 退出后小狗回窝避雨', r5.hit, `回窝 ${f2(r5.t)}s, state=${brain.state}`);
  report('Q6 小游戏接管全过程无报错', w.errors.length === 0, w.errors.map((e) => e.module + ':' + e.message).join(' | '));
}

// ---------------------------------------------------------------- R) 长时间行为：按真实时长（restScale = 1）跑
async function testRest() {
  const min = (s) => (s / 60).toFixed(1) + ' 分钟';
  const probe = await makeWorld({ hour: 10.5, weather: 'clear', restScale: 1 });
  if (!probe.ctx.brain || !('restScale' in probe.ctx.brain)) { console.log('SKIP  R1–R5：当前 brain 没有长时间行为（stub）'); return; }
  const onMat = (ctx) => (ctx.dog.action === 'lie' || ctx.dog.action === 'sleep' || ctx.dog.action === 'roll') && matDog(ctx) < 0.4;
  // R1：晒太阳
  if (hasMat(probe)) {
    const w = probe, { ctx } = w;
    run(w, 1);
    ctx.brain.force('sunbathe');
    let acc = 0, rolls = 0, last = '';
    const r = run(w, 1800, {
      onFrame: () => { if (onMat(ctx)) acc += DT; if (ctx.dog.action === 'roll' && last !== 'roll') rolls++; last = ctx.dog.action; },
      until: () => acc > 5 && matHome(ctx) < 0.3 && !ctx.brain.state.startsWith('auto:sunbathe'),
    });
    report('R1 晒太阳：在垫子上连续待 ≥ 10 分钟，之后把垫子叼回窝；全程无违规', r.hit && acc >= 600 && w.rec.violations.length === 0 && w.errors.length === 0,
      `垫子上 ${min(acc)}（翻身 ${rolls} 次），整轮 ${min(r.t)}, state=${ctx.brain.state}; ${w.rec.violations.join(' | ')}`);
  } else console.log('SKIP  R1 / R4：当前小岛没有垫子（stub）');
  // R2：午睡
  {
    const w = await makeWorld({ hour: 12.4, weather: 'cloudy', restScale: 1, seed: SEED + 21 });
    const { ctx } = w;
    run(w, 1);
    ctx.brain.force('nap');
    let acc = 0, stirs = 0, last = '';
    const r = run(w, 1500, {
      onFrame: () => { const nap = ctx.brain.state.startsWith('auto:nap'); if (nap && (ctx.dog.action === 'sleep' || ctx.dog.action === 'lie')) acc += DT; if (nap && ctx.dog.action === 'lie' && last === 'sleep') stirs++; last = ctx.dog.action; },
      until: () => acc > 5 && !ctx.brain.state.startsWith('auto:nap'),
    });
    report('R2 午睡：一觉 ≥ 10 分钟，睡完自己起来；全程无违规', r.hit && acc >= 600 && w.rec.violations.length === 0, `睡了 ${min(acc)}（中途抬头 ${Math.max(0, stirs - 1)} 次）, state=${ctx.brain.state}; ${w.rec.violations.join(' | ')}`);
  }
  // R3：晚间在窝门口歇着
  {
    const w = await makeWorld({ hour: 20, weather: 'clear', restScale: 1, seed: SEED + 22 });
    const { ctx } = w;
    run(w, 1);
    ctx.brain.force('evening');
    let acc = 0; const poses = new Set();
    const r = run(w, 900, {
      onFrame: () => { if (ctx.brain.state.startsWith('auto:evening') && (ctx.dog.action === 'lie' || ctx.dog.action === 'sit')) { acc += DT; poses.add(ctx.dog.action); } },
      until: () => acc > 5 && !ctx.brain.state.startsWith('auto:evening'),
    });
    report('R3 晚间歇息：一次 ≥ 6 分钟，中间会换姿势', r.hit && acc >= 355 && poses.size === 2, `歇了 ${min(acc)}, 姿势 [${[...poses].join(',')}], state=${ctx.brain.state}`);
  }
  // R4：晒着太阳时过了下午四点 → 起来把垫子叼回去
  if (hasMat(probe)) {
    const w = await makeWorld({ hour: 10.5, weather: 'clear', restScale: 1, seed: SEED + 23 });
    const { ctx } = w;
    run(w, 1);
    ctx.brain.force('sunbathe');
    const r0 = run(w, 200, { until: () => ctx.brain.state === 'auto:sunbathe:sleep' });
    run(w, 30);
    ctx.env.setHour(16.2);
    const r1 = run(w, 10, { until: () => /sunbathe:(wake|haul)/.test(ctx.brain.state) });
    const r2 = run(w, 200, { until: () => matHome(ctx) < 0.3 && !ctx.brain.state.startsWith('auto:sunbathe') });
    report('R4 晒太阳途中太阳没了（拨到 16:12）：10 秒内起来，垫子叼回窝', r0.hit && r1.hit && r2.hit && w.rec.violations.length === 0, `起来 ${f2(r1.t)}s, 收垫子 ${f2(r2.t)}s; ${w.rec.violations.join(' | ')}`);
  }
  // R5：午睡的时段过了（拨到 15:12）→ 起来
  {
    const w = await makeWorld({ hour: 12.4, weather: 'cloudy', restScale: 1, seed: SEED + 24 });
    const { ctx } = w;
    run(w, 1);
    ctx.brain.force('nap');
    const r0 = run(w, 120, { until: () => ctx.brain.state.startsWith('auto:nap') && ctx.dog.action === 'sleep' });
    run(w, 30);
    ctx.env.setHour(15.2);
    const r1 = run(w, 10, { until: () => !ctx.brain.state.startsWith('auto:nap') });
    report('R5 午睡途中时段过了（拨到 15:12）：10 秒内起来', r0.hit && r1.hit, `入睡 ${r0.hit}, 起来 ${f2(r1.t)}s, state=${ctx.brain.state}`);
  }
}

// ---------------------------------------------------------------- S) 扔木棍：落点在小屋后面 / 障碍夹缝里也不会卡住
// 以前小屋后墙和岛沿之间有一条 0.4 宽的死胡同：小狗能沿直线走进去，寻路却规划不出离开的路线，
// 于是在屋后把木棍“交”了、原地转圈，收起木棍再拿出来也回不来。
async function testStuck() {
  const w = await makeWorld({ hour: 10.5, weather: 'clear' });
  const { ctx } = w, a = ctx.island.anchors, stick = ctx.stick, brain = ctx.brain, isl = ctx.island;
  if (!brain.mover || !stick.recall) { console.log('SKIP  S1–S3：当前 brain / stick 是 stub'); return; }
  const M = brain.mover;
  // S1：以前的死胡同现在不能站；木棍的落点也不会落进去
  const old = [[-5.25, -4.54], [-5.0, -4.75], [-5.5, -4.25], [-5.8, -3.8]];
  const stillOpen = old.filter(([x, z]) => isl.isWalkable(x, z));
  report('S1 小屋后面的死胡同已经封掉（不可行走）', stillOpen.length === 0, stillOpen.map((p) => p.join(',')).join(' ; '));
  // S2：往小屋后面、左后方、菜地南侧各扔一次：小狗走到木棍跟前才叼（或够不着就放弃），最后都回到 front
  const bad = [];
  for (const [x, z] of [[-5.2, -4.4], [-8, -7.6], [-4.8, -4.8], [-6.4, -3.2], [-8, -1.6], [-4.4, -2.4], [0.4, -5.6], [2.0, -4.8], [-2.8, -4.8]]) {
    stick.dismiss(); run(w, 1.2);
    M.place(a.lawn.x, a.lawn.z, 0); M.inKennel = false; M.onRamp = false;
    stick.click(null); run(w, 5, { until: () => brain.state.startsWith('fetch:wait') });
    stick.click(new THREE.Vector3(x, 0, z));
    let picked = false, gave = false, pickDist = 0;
    const r = run(w, 45, {
      onFrame: () => {
        if (stick.state === 'carried' && !picked) { picked = true; pickDist = Math.hypot(M.x - stick.target.x, M.z - stick.target.z); }
        if (brain.state === 'fetch:giveup') gave = true;
      },
      until: () => stick.state === 'held' && (picked || gave),
    });
    run(w, 6);
    const d = distTo(ctx, a.front);
    if (!r.hit || d > 1.2 || pickDist > 1.3) bad.push(`(${x},${z}) 回手上 ${r.hit ? f2(r.t) + 's' : '超时'}, 叼起时距木棍 ${f2(pickDist)}, 距 front ${f2(d)}, ${brain.state}`);
  }
  report('S2 木棍扔到小屋后面 / 夹缝里：到跟前才叼，最后回到 front(<1.2)', bad.length === 0, bad.join(' | '));
  // S3：就算小狗被放到了寻路栅格之外的地方（以前卡住的那个点），拿出木棍它也能自己走回来
  stick.dismiss(); run(w, 1.2);
  M.place(-5.25, -4.54, 0); M.inKennel = false; M.onRamp = false;
  stick.click(null);
  const r3 = run(w, 9, { until: () => distTo(ctx, a.front) < 1.2 });
  report('S3 从以前卡住的位置出发：拿出木棍 9 秒内跑回 front', r3.hit, `耗时 ${f2(r3.t)}s, 距 front ${f2(distTo(ctx, a.front))}, ${brain.state}`);
}

async function main() {
  console.log(`行为测试：seed=${SEED}；真实模块：${only ? [...only].join(',') || '(无)' : '全部'}`);
  const probe = await makeWorld({});
  console.log('  装载情况：' + Object.entries(probe.used).map(([k, v]) => `${k}=${v}`).join(' ') + (probe.errors.length ? `  装载错误: ${probe.errors.map((e) => e.module + ':' + e.message).join('; ')}` : ''));
  if (probe.used.brain !== 'real' || probe.used.stick !== 'real') {
    console.log('  注意：brain 或 stick 回退到了 stub，下面的结果不代表 WP5 实现');
  }
  const t0 = Date.now();
  for (const [name, fn] of [['a', testA], ['b', testB], ['c', testC], ['d/e', testD], ['f', testF], ['g/h', testG], ['extra', testExtra], ['L', testL], ['M', testM], ['R', testRest], ['S', testStuck], ['P', testP], ['Q', testGame]]) {
    console.log(`--- ${name}`);
    try { await fn(); } catch (e) { report(`${name} 测试异常`, false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)); }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n共 ${results.length} 项，失败 ${failed.length} 项，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (failed.length) { console.log('失败项：' + failed.map((f) => f.name).join('；')); process.exit(1); }
  console.log('行为测试通过');
}

main().catch((e) => { console.error('行为测试脚本自身异常：', e); process.exit(1); });
