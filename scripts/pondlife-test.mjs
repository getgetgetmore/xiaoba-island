// 池塘常驻小动物（青蛙 / 螃蟹）的 Node 无头测试。用法：node scripts/pondlife-test.mjs [--verbose]
// 覆盖：10 分钟位置合法 / 不瞬移、小狗靠近的反应与恢复、傍晚 / 雨天更活跃、深夜安静、setHidden、模型各状态与独立实例、island 接入。
import * as THREE from 'three';
import { mulberry32 } from '../src/core/util.js';
import { L, pondR, heightAt, outlineR } from '../src/world/island/shape.js';
import { WATER_Y } from '../src/world/island/water.js';
import { createFrog, createCrab, createPondLife, FROG_MAX_SPEED, CRAB_MAX_SPEED, FROG_STATES, CRAB_STATES, crabBandInner, BAND_W } from '../src/world/island/pondlife.js';

const VERBOSE = process.argv.includes('--verbose');
const DT = 1 / 30;
let fails = 0;
function report(name, ok, detail) {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`);
}
const fin = (n) => Number.isFinite(n);
const drink = new THREE.Vector3(L.pond.x + (L.pond.r + 0.3) * 0.97, 0, L.pond.z - (L.pond.r + 0.3) * 0.24);
const anchors = { pondDrink: drink, pond: { x: L.pond.x, z: L.pond.z, r: L.pond.r } };

function makeLife(seed) { return createPondLife({ heightAt, anchors, rng: mulberry32(seed) }); }
const ENV = {
  noon: { hour: 12, dayFactor: 1, sunsetFactor: 0, rain: 0, wetness: 0 },
  dusk: { hour: 19, dayFactor: 0.6, sunsetFactor: 0.8, rain: 0, wetness: 0 },
  rain: { hour: 14, dayFactor: 0.8, sunsetFactor: 0, rain: 0.6, wetness: 0.6 },
  night: { hour: 2, dayFactor: 0, sunsetFactor: 0, rain: 0, wetness: 0 },
  dawn: { hour: 6.5, dayFactor: 0.8, sunsetFactor: 0.2, rain: 0, wetness: 0 },
};
function run(life, seconds, env, dog = null) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) life.update(DT, env, dog);
}

// ------------------------------------------------------------------ 1. 十分钟模拟
{
  const life = makeLife(7);
  const segs = [['noon', 150], ['dusk', 150], ['rain', 150], ['night', 150]];
  const problems = [];
  const bad = (m) => { if (problems.length < 6) problems.push(m); };
  const prevF = life.frogs.map((f) => f.group.position.clone());
  const prevC = life.crabs.map((c) => c.group.position.clone());
  let frames = 0, maxFrogStep = 0, maxCrabStep = 0, minCrabD = 1e9, hopSeen = 0, inFlightSeen = 0, nightCrabMove = 0, nightFrogHops = 0;
  const cat = { pad: 0, hidden: 0, flight: 0, water: 0 };
  for (const [name, secs] of segs) {
    const env = ENV[name];
    const hops0 = life.frogs.reduce((a, f) => a + f.hops, 0);
    const n = Math.round(secs / DT);
    let nightStart = null, nightHops0 = 0;
    for (let i = 0; i < n; i++) {
      life.update(DT, env, null);
      frames++;
      if (name === 'night' && i === Math.round(10 / DT)) { nightStart = life.crabs.map((c) => c.group.position.clone()); nightHops0 = life.frogs.reduce((a, f) => a + f.hops, 0); }
      life.frogs.forEach((f, k) => {
        const p = f.group.position;
        if (!(fin(p.x) && fin(p.y) && fin(p.z) && fin(f.group.scale.x) && fin(f.group.rotation.y))) bad(`青蛙 ${k} 出现 NaN`);
        for (const v of f.body.morphTargetInfluences) if (!fin(v)) bad(`青蛙 ${k} 形变 NaN`);
        const step = p.distanceTo(prevF[k]);
        maxFrogStep = Math.max(maxFrogStep, step / DT);
        if (step > FROG_MAX_SPEED * DT * 1.5) bad(`青蛙 ${k} 瞬移 ${step.toFixed(3)} @${name}`);
        prevF[k].copy(p);
        // 位置分类（只看位置，不看内部状态）
        const hidden = !f.group.visible || f.group.scale.x < 0.02;
        const onPad = life.pads.some((pd) => pd.usable && Math.hypot(p.x - pd.x, p.z - pd.z) <= pd.r && Math.abs(p.y - pd.y) < 0.03);
        const inPond = Math.hypot(p.x - L.pond.x, p.z - L.pond.z) < pondR(Math.atan2(p.z - L.pond.z, p.x - L.pond.x)) * 0.95;
        if (hidden) cat.hidden++;
        else if (onPad) cat.pad++;
        else if (p.y > WATER_Y + 0.005 && inPond && f.phase === 'hop') cat.flight++; // 两片荷叶之间（或荷叶与水面之间）腾空
        else if (p.y <= WATER_Y + 0.01 && inPond) cat.water++; // 入水 / 浮出的过渡（可见、在水面上）
        else bad(`青蛙 ${k} 位置不合法 (${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) phase=${f.phase}`);
        // 腾空的青蛙：水平位置必须落在池塘内、高度不超过 0.5
        if (!hidden && p.y > WATER_Y + 0.005 && p.y > 0.4) bad(`青蛙 ${k} 跳得太高 ${p.y}`);
        if (f.phase === 'hop') inFlightSeen++;
      });
      life.crabs.forEach((c, k) => {
        const p = c.group.position;
        if (!(fin(p.x) && fin(p.y) && fin(p.z) && fin(c.group.scale.x))) bad(`螃蟹 ${k} 出现 NaN`);
        for (const v of c.body.morphTargetInfluences) if (!fin(v)) bad(`螃蟹 ${k} 形变 NaN`);
        const dx = p.x - L.pond.x, dz = p.z - L.pond.z, th = Math.atan2(dz, dx), r = Math.hypot(dx, dz);
        const inner = crabBandInner(th);
        if (r < inner - 0.02 || r > inner + BAND_W + 0.02) bad(`螃蟹 ${k} 出环带 r=${r.toFixed(3)} 带=[${inner.toFixed(2)},${(inner + BAND_W).toFixed(2)}]`);
        if (Math.abs(r - L.pond.r) > 0.5) bad(`螃蟹 ${k} 离池塘太远 ${r.toFixed(2)}`);
        const dd = Math.hypot(p.x - drink.x, p.z - drink.z);
        minCrabD = Math.min(minCrabD, dd);
        if (dd < 0.5) bad(`螃蟹 ${k} 走进喝水落脚点 ${dd.toFixed(2)}`);
        if (Math.hypot(p.x, p.z) > outlineR(Math.atan2(p.z, p.x)) - 0.6) bad(`螃蟹 ${k} 靠近岛沿`);
        if (Math.abs(p.y - heightAt(p.x, p.z)) > 0.07) bad(`螃蟹 ${k} 没贴地 y=${p.y.toFixed(3)} 地面=${heightAt(p.x, p.z).toFixed(3)}`);
        const step = p.distanceTo(prevC[k]);
        maxCrabStep = Math.max(maxCrabStep, step / DT);
        if (step > CRAB_MAX_SPEED * DT * 1.5) bad(`螃蟹 ${k} 瞬移 ${step.toFixed(3)} @${name}`);
        prevC[k].copy(p);
      });
    }
    if (name === 'night') {
      nightCrabMove = life.crabs.reduce((a, c, k) => Math.max(a, c.group.position.distanceTo(nightStart[k])), 0);
      nightFrogHops = life.frogs.reduce((a, f) => a + f.hops, 0) - nightHops0;
    }
    hopSeen += life.frogs.reduce((a, f) => a + f.hops, 0) - hops0;
  }
  report('1. 10 分钟（正午/傍晚/雨天/深夜各 2.5 分钟）位置无 NaN、青蛙位置合法、螃蟹始终在环带内且避开喝水点、不瞬移',
    problems.length === 0,
    problems.length ? problems.join(' | ') : `${frames} 帧；青蛙位置分类 ${JSON.stringify(cat)}；青蛙最高速 ${maxFrogStep.toFixed(2)}（上限 ${FROG_MAX_SPEED}），螃蟹最高速 ${maxCrabStep.toFixed(2)}（上限 ${CRAB_MAX_SPEED}）；总跳跃 ${hopSeen}；螃蟹离喝水点最近 ${minCrabD.toFixed(2)}`);
  report('1b. 深夜（前 10 秒后）螃蟹不动、青蛙不跳', nightCrabMove < 1e-6 && nightFrogHops === 0, `螃蟹位移 ${nightCrabMove.toExponential(1)}，夜间新增跳跃 ${nightFrogHops}`);
}

// ------------------------------------------------------------------ 2. 小狗靠近
{
  let worstFrog = 0, worstRecover = 0, ok = true, notes = [];
  const trials = 10;
  for (let tr = 0; tr < trials; tr++) {
    const life = makeLife(100 + tr);
    run(life, 5 + tr * 7.3, ENV.noon); // 不同的预热时长：覆盖蹲着 / 起跳准备 / 跳跃中 / 叫的时候
    const f0 = life.frogs[tr % life.frogs.length];
    const dog = { x: f0.group.position.x + 1.0, z: f0.group.position.z + 0.2 };
    let t = 0, hiddenAt = -1;
    while (t < 2.0) { life.update(DT, ENV.noon, dog); t += DT; if (f0.hidden && hiddenAt < 0) hiddenAt = t; }
    // 距小狗 1.7 以内的青蛙都应该入水
    const allT = life.frogs.every((f) => f === f0 || Math.hypot(f.group.position.x - dog.x, f.group.position.z - dog.z) >= 1.7 || f.hidden || f.phase === 'sink' || f.phase === 'under');
    if (hiddenAt < 0 || !allT) { ok = false; notes.push(`试验 ${tr}: 2 秒内未入水（phase=${f0.phase}）`); }
    worstFrog = Math.max(worstFrog, hiddenAt);
    // 小狗离开：20 秒内重新出现在荷叶上
    let rt = 0, backAt = -1;
    while (rt < 20) {
      life.update(DT, ENV.noon, null); rt += DT;
      if (backAt < 0 && life.frogs.every((f) => f.phase === 'pad' && f.group.visible && f.group.scale.x > 0.95)) backAt = rt;
    }
    // 判据：小狗走后 20 秒内，所有青蛙至少曾经重新出现过且最终都在荷叶上
    const onPadNow = life.frogs.every((f) => f.phase === 'pad' || f.phase === 'hop' || f.phase === 'prep' || f.phase === 'surface');
    const reappeared = life.frogs.every((f) => f.group.visible);
    if (!reappeared || !onPadNow) { ok = false; notes.push(`试验 ${tr}: 20 秒后未恢复（${life.frogs.map((f) => f.phase).join(',')}）`); }
    if (backAt < 0 && !(reappeared && onPadNow)) notes.push('未全部坐回荷叶');
    worstRecover = Math.max(worstRecover, backAt < 0 ? 20 : backAt);
  }
  report('2a. 小狗（距离 1.0）靠近青蛙：2 秒内入水隐藏（10 组不同时机）；离开后 20 秒内重新出现', ok, ok ? `入水最慢 ${worstFrog.toFixed(2)}s；离开后全部恢复最慢约 ${worstRecover.toFixed(1)}s` : notes.join(' | '));
}
{
  // 更严格的恢复判据：小狗走后 20 秒内“所有青蛙都出现过在荷叶上”——逐只记录首次回到 phase==='pad' 的时间
  let ok = true, worst = 0, notes = [];
  for (let tr = 0; tr < 10; tr++) {
    const life = makeLife(300 + tr);
    run(life, 3 + tr * 5.1, ENV.noon);
    const dog = { x: life.frogs[0].group.position.x + 0.9, z: life.frogs[0].group.position.z };
    run(life, 2.5, ENV.noon, dog);
    const back = life.frogs.map(() => -1);
    let t = 0;
    while (t < 20) {
      life.update(DT, ENV.noon, null); t += DT;
      life.frogs.forEach((f, k) => { if (back[k] < 0 && f.phase === 'pad' && f.group.visible) back[k] = t; });
    }
    if (back.some((b) => b < 0)) { ok = false; notes.push(`试验 ${tr}: ${back.join(',')}`); }
    worst = Math.max(worst, ...back.map((b) => (b < 0 ? 20 : b)));
  }
  report('2b. 小狗离开后 20 秒内每只青蛙都重新蹲回荷叶（10 组）', ok, ok ? `最慢 ${worst.toFixed(1)}s` : notes.join(' | '));
}
{
  // 小狗正在池塘边喝水（落脚点）也会让青蛙入水：只传喝水点位置
  const life = makeLife(55);
  run(life, 6, ENV.noon);
  run(life, 2.0, ENV.noon, { x: drink.x, z: drink.z });
  report('2c. 小狗在喝水落脚点：2 秒内青蛙入水', life.frogs.every((f) => f.hidden), life.frogs.map((f) => f.phase).join(','));
}
{
  // 螃蟹
  let ok = true, notes = [];
  const lines = [];
  for (let tr = 0; tr < 12; tr++) {
    const life = makeLife(500 + tr);
    const env = tr % 2 ? ENV.dusk : ENV.dawn; // 傍晚/清晨螃蟹比较活跃：覆盖 walk / pinch / idle
    run(life, 4 + tr * 9.1, env);
    const c = life.crabs[0];
    // 小狗站在螃蟹外侧（远离池塘一侧）1.0 处
    const ox = c.x - L.pond.x, oz = c.z - L.pond.z, ol = Math.hypot(ox, oz);
    const dog = { x: c.x + (ox / ol) * 1.0, z: c.z + (oz / ol) * 1.0 };
    const d0 = Math.hypot(c.x - dog.x, c.z - dog.z);
    const prevState = c.state;
    let t = 0, hideAt = -1, growAt = -1;
    while (t < 1.0) {
      life.update(DT, env, dog); t += DT;
      if (hideAt < 0 && c.state === 'hide') hideAt = t;
      if (growAt < 0 && Math.hypot(c.x - dog.x, c.z - dog.z) > d0 + 0.03) growAt = t;
    }
    const good = hideAt >= 0 || growAt >= 0;
    if (!good) { ok = false; notes.push(`试验 ${tr}: 1 秒内既没 hide 也没拉开距离（起始 ${prevState}，现在 ${c.state}）`); }
    lines.push(`${prevState}->${hideAt >= 0 ? 'hide@' + hideAt.toFixed(2) : 'away@' + growAt.toFixed(2)}`);
  }
  report('2d. 小狗（距离 1.0）靠近螃蟹：1 秒内进入 hide 或与小狗距离开始增大（12 组）', ok, ok ? lines.join(' ') : notes.join(' | '));
}

// ------------------------------------------------------------------ 3. 傍晚 / 雨天更活跃，深夜安静
{
  const seeds = [11, 12, 13];
  const stat = {};
  for (const name of ['noon', 'dusk', 'rain', 'night']) {
    let croaks = 0, hops = 0, walks = 0;
    for (const sd of seeds) {
      const life = makeLife(sd);
      run(life, 20, ENV.noon); // 统一的预热
      const c0 = life.frogs.reduce((a, f) => a + f.croaks, 0), h0 = life.frogs.reduce((a, f) => a + f.hops, 0), w0 = life.crabs[0].walks;
      run(life, 180, ENV[name]);
      croaks += life.frogs.reduce((a, f) => a + f.croaks, 0) - c0;
      hops += life.frogs.reduce((a, f) => a + f.hops, 0) - h0;
      walks += life.crabs[0].walks - w0;
    }
    stat[name] = { croaks, hops, walks };
  }
  const s = stat;
  const ok = s.dusk.croaks > s.noon.croaks * 1.5 && s.dusk.hops > s.noon.hops * 1.5 && s.rain.croaks > s.noon.croaks * 1.5 && s.rain.hops > s.noon.hops * 1.5 && s.night.hops === 0 && s.night.croaks === 0 && s.dusk.walks >= s.noon.walks && s.rain.walks >= s.noon.walks;
  report('3. 3 分钟统计（3 个种子合计）：傍晚、雨天的叫声与跳跃明显多于正午；深夜不跳不叫；螃蟹傍晚/雨天出来走得更多', ok, JSON.stringify(stat));
}

// ------------------------------------------------------------------ 4. setHidden
{
  let ok = true, notes = [], worstHide = 0, worstShow = 0;
  for (let tr = 0; tr < 10; tr++) {
    const life = makeLife(700 + tr);
    const env = tr % 3 === 0 ? ENV.dusk : tr % 3 === 1 ? ENV.noon : ENV.rain;
    run(life, 3 + tr * 6.7, env);
    life.setHidden(true);
    let t = 0, hideAt = -1;
    const allHid = () => life.frogs.every((f) => f.hidden) && life.crabs.every((c) => c.hidden);
    while (t < 3.0) { life.update(DT, env, null); t += DT; if (hideAt < 0 && allHid()) hideAt = t; }
    if (!allHid()) { ok = false; notes.push(`试验 ${tr}: 3 秒内没全部隐藏（${life.frogs.map((f) => f.phase)} / crab ${life.crabs[0].vis.toFixed(2)}）`); }
    worstHide = Math.max(worstHide, hideAt < 0 ? 3 : hideAt);
    // 保持隐藏 30 秒（含小狗不在）
    let held = true;
    for (let i = 0; i < 30 / DT; i++) { life.update(DT, env, null); if (!allHid()) held = false; }
    if (!held || !life.hidden) { ok = false; notes.push(`试验 ${tr}: 隐藏期间又出现了`); }
    life.setHidden(false);
    let rt = 0, backAt = -1;
    while (rt < 20) {
      life.update(DT, env, null); rt += DT;
      if (backAt < 0 && life.frogs.every((f) => f.phase === 'pad' && f.group.visible && f.group.scale.x > 0.95) && life.crabs.every((c) => !c.hidden && c.group.scale.x > 0.95)) backAt = rt;
    }
    if (backAt < 0) { ok = false; notes.push(`试验 ${tr}: 20 秒内没恢复（${life.frogs.map((f) => f.phase)}）`); }
    worstShow = Math.max(worstShow, backAt < 0 ? 20 : backAt);
  }
  report('4. setHidden(true) 后 3 秒内青蛙与螃蟹全部隐藏并保持 30 秒；setHidden(false) 后 20 秒内恢复（10 组）', ok, ok ? `隐藏最慢 ${worstHide.toFixed(2)}s，恢复最慢 ${worstShow.toFixed(1)}s` : notes.join(' | '));
}

// ------------------------------------------------------------------ 5. 模型
{
  let ok = true, notes = [];
  const bad = (m) => { ok = false; if (notes.length < 6) notes.push(m); };
  const frog = createFrog(), crab = createCrab();
  const triOf = (m) => m.body.geometry.attributes.position.count / 3;
  const checkFinite = (m, tag) => {
    for (const v of m.body.morphTargetInfluences) if (!fin(v)) bad(`${tag} 形变 NaN`);
    for (const o of [m.group, m.body]) if (![o.position.x, o.position.y, o.position.z, o.scale.x, o.scale.y, o.scale.z, o.rotation.x, o.rotation.y, o.rotation.z].every(fin)) bad(`${tag} 变换 NaN`);
  };
  for (const s of FROG_STATES) {
    frog.setState(s);
    if (frog.state !== s) bad(`青蛙切换 ${s} 失败`);
    for (let i = 0; i < 600; i++) { try { frog.update(1 / 60); } catch (e) { bad(`青蛙 ${s} update 抛错 ${e.message}`); break; } }
    checkFinite(frog, 'frog ' + s);
  }
  for (const s of CRAB_STATES) {
    crab.setState(s);
    if (crab.state !== s) bad(`螃蟹切换 ${s} 失败`);
    for (const d of [1, -1]) { crab.dir = d; for (let i = 0; i < 300; i++) { try { crab.update(1 / 60); } catch (e) { bad(`螃蟹 ${s} update 抛错 ${e.message}`); break; } } }
    checkFinite(crab, 'crab ' + s);
  }
  frog.setState('nonsense'); crab.setState('nonsense');
  if (!FROG_STATES.includes(frog.state) || !CRAB_STATES.includes(crab.state)) bad('非法状态名应被忽略');
  // 独立实例
  const f2 = createFrog(), c2 = createCrab();
  f2.setState('croak'); c2.setState('walk'); frog.setState('sit'); crab.setState('idle');
  for (let i = 0; i < 30; i++) { f2.update(1 / 30); frog.update(1 / 30); c2.update(1 / 30); crab.update(1 / 30); }
  if (f2.group === frog.group || c2.group === crab.group || f2.body.morphTargetInfluences === frog.body.morphTargetInfluences) bad('实例不独立');
  if (frog.state !== 'sit' || f2.state !== 'croak' || crab.state !== 'idle' || c2.state !== 'walk') bad('实例状态互相影响');
  if (Math.abs(f2.body.morphTargetInfluences[1] - frog.body.morphTargetInfluences[1]) < 0.05) bad('croak 与 sit 喉囊没有区别');
  group: {
    const g = f2.group.position;
    g.set(5, 1, 5);
    if (frog.group.position.x === 5) bad('位置共享');
  }
  const tf = triOf(frog), tc = triOf(crab);
  if (tf > 2500 || tc > 2500) bad(`三角形超限 frog ${tf} crab ${tc}`);
  let meshes = 0; frog.group.traverse((o) => { if (o.isMesh) meshes++; });
  let meshes2 = 0; crab.group.traverse((o) => { if (o.isMesh) meshes2++; });
  if (meshes > 3 || meshes2 > 3) bad(`draw call 超限 ${meshes}/${meshes2}`);
  // 尺寸（基准姿态的顶点包围盒）
  const ext = (m) => {
    const p = m.body.geometry.attributes.position, b = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) b.expandByPoint(v.fromBufferAttribute(p, i));
    return b.getSize(new THREE.Vector3());
  };
  const sf = ext(frog), sc = ext(crab);
  report('5. 模型：各状态可切换、各 600 帧 update 无异常、实例独立、每只 ≤3 draw call 且 ≤2500 三角形', ok,
    ok ? `青蛙 ${tf} 三角形/${meshes} mesh，基准姿态包围盒 ${sf.x.toFixed(2)}×${sf.y.toFixed(2)}×${sf.z.toFixed(2)}；螃蟹 ${tc} 三角形/${meshes2} mesh，${sc.x.toFixed(2)}×${sc.y.toFixed(2)}×${sc.z.toFixed(2)}` : notes.join(' | '));
}

// ------------------------------------------------------------------ 6. 性能预算与 island 接入
{
  const life = makeLife(3);
  let meshes = 0, tris = 0;
  life.group.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  report('6a. 新增 draw call ≤ 8、三角形 ≤ 8000（最坏情况：所有涟漪同时可见）', meshes <= 8 && tris <= 8000, `${meshes} 个 mesh，${tris} 三角形`);
}
{
  const { createIsland } = await import('../src/world/island.js');
  const ctx = { scene: new THREE.Scene(), rng: mulberry32(1), dog: null, palette: null, env: null };
  let island = null, err = null;
  try { island = createIsland(ctx); } catch (e) { err = e; }
  if (!island) report('6b. island 接入', false, String(err && err.stack));
  else {
    const pl = island.pondLife;
    let ok = !!pl && Array.isArray(pl.frogs) && Array.isArray(pl.crabs) && typeof pl.setHidden === 'function' && pl.frogs.length >= 1 && pl.crabs.length >= 1;
    let detail = ok ? `frogs ${pl.frogs.length} crabs ${pl.crabs.length}` : '缺少 island.pondLife';
    if (ok) {
      let inScene = false; island.group.traverse((o) => { if (o === pl.group) inScene = true; });
      if (!inScene) { ok = false; detail = 'pondLife.group 不在 island.group 内'; }
      const env = { ...ENV.noon, wind: 0.2 };
      for (let i = 0; i < 200; i++) island.update(DT, env);
      // 小狗在喝水点喝水：island 把狗的位置传给 pondLife
      ctx.dog = { group: { position: new THREE.Vector3(drink.x, 0, drink.z), scale: { x: 1 } }, action: 'drink' };
      for (let i = 0; i < 90; i++) island.update(DT, env);
      if (!pl.frogs.every((f) => f.hidden)) { ok = false; detail += ' | 小狗喝水时青蛙没有入水'; }
      ctx.dog = null;
      for (let i = 0; i < 30 * 20; i++) island.update(DT, env);
      if (!pl.frogs.every((f) => f.phase === 'pad')) { ok = false; detail += ' | 小狗走后青蛙没有回来'; }
    }
    report('6b. island.pondLife 已接入（在场景内、随 island.update 更新、读取 ctx.dog 位置）', ok, detail);
  }
}

console.log(fails === 0 ? '\n全部通过' : `\n有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
