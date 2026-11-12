// 白鹭来访与乘鹭出门（默认机制，见 docs/DESIGN.md “白鹭来访与乘鹭出门”）。
//   来访：白天 8:00–18:00 白鹭按当天的时刻表飞来，落在岛边，走一走、啄啄地，最多 1 分钟后飞走。晴天 5 次、阴天 3 次、雨天不来。
//   出门：白鹭在岛上时，小狗有一定概率跑过去趴到它背上被驮走（每天最多一次）；出门期间岛上没有小狗、白鹭不再来，
//         画面上有提示条和“叫它回来”按钮；18:00（或被叫回）白鹭驮着它飞回来。出门状态记在本地存储里。
// createEgretVisits(ctx) → travel = { group, update(dt), phase, away, busy, visitNow(opts), recall(), blockPlay(), info() }
//   白鹭模型来自 ./egret.js（createEgret）；文件不存在或加载失败时用这里的简易占位鸟，机制照常运行。
import * as THREE from 'three';
import { clamp, mulberry32 } from '../core/util.js';
import { paintMaterial } from '../core/paint.js';
import { outlineR } from './island/shape.js';
import { createAwayHint } from '../ui/awayHint.js';

export const EGRET = {
  DAY_FROM: 8, DAY_TO: 18,                 // 来访 / 出门的时间段；DAY_TO 也是出门后回来的时间
  SLOTS: [8.5, 10.3, 12.2, 14.2, 16.3],    // 一天 5 次来访的大致时刻（每天各自随机前后挪一点）
  SLOT_JITTER: 0.35,
  CLOUDY_SLOTS: [0, 2, 4],                 // 阴天只来这几次
  SLOT_WAIT: 0.34,                         // 到点了但不方便来（在玩小游戏等）：最多等这么久（小时），过了就不来了
  STAY: [34, 54],                          // 在岛上停留的秒数（含走动，不超过 60）
  RIDE_BASE: 0.12, RIDE_BORED: 0.35,       // 出门概率 = 基础 + 无聊加成
  BORED_FROM: 1200, BORED_FULL: 7200,      // 多久没人跟它玩（秒）开始 / 完全觉得无聊
  RIDE_LATEST: 16.6,                       // 这之后白鹭再来也不出门了（马上要吃晚饭）
  MIN_ENERGY: 0.7,
  STORE_KEY: 'shiba-island.travel',
};

const TAU = Math.PI * 2;
const BIRD_SCALE = 1.15;
const ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const dayKey = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

// ---------------------------------------------------------------- 占位鸟（egret.js 不可用时）
function stubEgret() {
  const group = new THREE.Group();
  const mat = paintMaterial({ color: 0xfbfaf4, roughness: 1 }, { space: 'local', scale: 10, strength: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1b18, roughness: 1 });
  const body = new THREE.Group(); body.position.y = 1.0; group.add(body);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), mat); torso.scale.set(0.3, 0.3, 0.66); body.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.8, 6), mat); neck.position.set(0, 0.45, 0.5); neck.rotation.x = 0.35; body.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat); head.position.set(0, 0.86, 0.68); body.add(head);
  const bill = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.42, 5), dark); bill.position.set(0, 0.84, 0.98); bill.rotation.x = Math.PI / 2; body.add(bill);
  const wings = [1, -1].map((s) => { const w = new THREE.Group(); w.position.set(0.22 * s, 0.12, 0.05); const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.6), mat); m.position.x = 0.75 * s; w.add(m); body.add(w); return w; });
  const legs = [1, -1].map((s) => { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.85, 5), dark); l.position.set(0.1 * s, 0.42, -0.05); group.add(l); return l; });
  const seat = new THREE.Object3D(); seat.position.set(0, 0.28, -0.08); body.add(seat);
  let t = 0, flap = 0, fold = 1;
  const egret = {
    group, seat, state: 'stand', walkSpeed: 0.45, carry: false, dims: { height: 2.0, length: 1.35, wingspan: 3.4, stride: 0.5 },
    setState(n) { egret.state = n; },
    update(dt) {
      t += dt;
      const st = egret.state, air = st === 'fly' || st === 'glide' || st === 'land' || st === 'takeoff';
      flap += dt * (st === 'takeoff' ? 22 : egret.carry ? 11 : 13);
      fold += ((air ? 0 : 1) - fold) * (1 - Math.exp(-dt * 8));
      const amp = st === 'fly' || st === 'takeoff' ? 0.75 : 0.08;
      for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; wings[i].rotation.z = s * (Math.sin(flap) * amp * (1 - fold) + 0.1) - s * fold * 1.35; wings[i].scale.x = 1 - 0.55 * fold; }
      for (let i = 0; i < 2; i++) { legs[i].rotation.x = air ? 1.2 : st === 'walk' ? Math.sin(t * 5 + i * Math.PI) * 0.45 : 0; legs[i].position.y = air ? 0.85 : 0.42; legs[i].position.z = air ? -0.45 : -0.05; }
      body.position.y = 1.0 + (st === 'walk' ? Math.abs(Math.sin(t * 5)) * 0.03 : 0);
      neck.rotation.x = st === 'peck' ? 1.5 : 0.35;
      if (st === 'peck' && (egret._pk = (egret._pk || 0) + dt) > 1.2) { egret._pk = 0; egret.state = 'stand'; }
    },
  };
  return egret;
}
let _load = null;
function loadEgretModule() {
  if (_load) return _load;
  let loaders = {};
  try { loaders = import.meta.glob('./egret.js') || {}; } catch (_) { loaders = {}; }
  const fn = loaders['./egret.js'];
  _load = fn
    ? fn().then((m) => {
      if (!m || typeof m.createEgret !== 'function') return null;
      // 先把导入的白鹭模型加载好（失败也没关系，egret.js 会退回程序化造型）
      return (typeof m.preloadEgret === 'function' ? m.preloadEgret() : Promise.resolve(false)).then(() => m.createEgret, () => m.createEgret);
    }).catch(() => null)
    : Promise.resolve(null);
  return _load;
}

// ---------------------------------------------------------------- 主体
export function createEgretVisits(ctx) {
  const { island, dog, brain, env } = ctx;
  const mover = brain.mover;
  const group = new THREE.Group();
  group.name = 'egretVisit';
  const rng = mulberry32(((ctx.params && ctx.params.seed) || 1) * 977 + 31);
  const rand = (a, b) => a + (b - a) * rng();

  let makeBird = null, birdIsStub = true, bird = null, loaded = false;
  loadEgretModule().then((f) => { makeBird = f; loaded = true; });
  function ensureBird() {
    if (bird && (!birdIsStub || !makeBird)) return bird;
    if (bird) { group.remove(bird.group); bird = null; }
    try { bird = makeBird ? makeBird() : stubEgret(); birdIsStub = !makeBird; } catch (e) { bird = stubEgret(); birdIsStub = true; if (typeof console !== 'undefined') console.error('[egret] 模型创建失败，使用占位鸟', e); }
    bird.group.rotation.order = 'YXZ';
    bird.group.scale.setScalar(BIRD_SCALE); // 比模型本身再大一点：驮着小狗时不显得吃力
    bird.group.visible = false;
    group.add(bird.group);
    return bird;
  }

  // ---- 岛边的落脚点：沿着岛沿每 10° 一个，避开障碍、狗窝门口、池塘、瞭望台，只取从正面看得见的那一圈
  const A = island.anchors;
  const edge = [];
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * TAU, r = outlineR(a) - 0.62, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < -3.2) continue;
    let ok = true;
    for (const o of island.obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + 0.45) { ok = false; break; }
    if (ok && Math.hypot(x - A.kennelDoor.x, z - A.kennelDoor.z) < 2.4) ok = false;
    if (ok && A.lookout && Math.hypot(x - A.lookout.base.x, z - A.lookout.base.z) < 1.6) ok = false;
    if (ok) edge.push({ x, z, a, k });
  }
  const FAR = [[-21, 8.5, -9], [21, 8, -8], [-19, 9.5, 5], [20, 9, 5]].map((p) => new THREE.Vector3(p[0], p[1], p[2]));

  // ---- 提示条
  const hint = typeof document !== 'undefined' && ctx.renderer
    ? createAwayHint({ parent: ctx.renderer.domElement.parentElement || document.body, onRecall: () => travel.recall() })
    : { show() {}, hide() {}, toast() {}, visible: false, text: '', lastToast: '' };

  // ---- 本地存储：今天出过门没有、现在是不是还在外面
  const store = {
    read() { try { return JSON.parse(localStorage.getItem(EGRET.STORE_KEY) || 'null') || {}; } catch (_) { return {}; } },
    write(o) { try { localStorage.setItem(EGRET.STORE_KEY, JSON.stringify(o)); } catch (_) { /* 隐私模式等：不记也没关系 */ } },
  };
  let today = dayKey();
  let wentToday = false;
  { const s = store.read(); if (s.day === today && s.went) wentToday = true; }
  let bootAway = (() => { const s = store.read(); return !!(s.day === today && s.away); })();
  let bootT = 0;

  // ---- 当天的时刻表
  let slots = [], slotDone = [];
  function makeSlots() {
    const r = mulberry32((today.split('-').reduce((a, v) => a * 31 + +v, 7)) >>> 0);
    slots = EGRET.SLOTS.map((h) => h + (r() * 2 - 1) * EGRET.SLOT_JITTER);
    slotDone = slots.map(() => false);
  }
  makeSlots();

  // ---- 状态
  const travel = {
    group, hint, config: EGRET,
    phase: 'idle',      // idle | arrive | stay | leave | board | mount | depart | away | return | dismount
    get away() { return travel.phase === 'away' || travel.phase === 'return' || travel.phase === 'depart'; },
    get busy() { return travel.phase === 'board' || travel.phase === 'mount' || travel.phase === 'depart' || travel.phase === 'away' || travel.phase === 'return' || travel.phase === 'dismount'; },
    visits: 0, rides: 0, idle: 0, forceRide: false, noRide: false,
    visitNow, recall, blockPlay, info, debugStart,
    /** 白鹭模型加载完成（或确定用占位造型）后 resolve */
    whenReady: () => loadEgretModule().then(() => { loaded = true; }),
    /** 调试 / 测试：当作新的一天（时刻表重新来、今天还没出过门） */
    resetDay() { slotDone.fill(false); wentToday = false; saveAway(false); },
    update,
  };
  let phT = 0;
  const setPhase = (p) => { travel.phase = p; phT = 0; };

  // 飞行：二次贝塞尔 p0 → p2（控制点 p1），u 按 shape 推进
  const fl = { on: false, t: 0, dur: 1, p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), arrive: true, lift: 0 };
  const pos = new THREE.Vector3(), tan = new THREE.Vector3(), tmp = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const seatP = new THREE.Vector3(), seatQ = new THREE.Quaternion(), hopFrom = new THREE.Vector3(), hopTo = new THREE.Vector3(), hopQ = new THREE.Quaternion();
  let spot = null;        // 当前落脚点
  let stayLeft = 0, sub = 'stand', subT = 0, walkTo = null, decideAt = 0, decided = false, wantRide = false, hopT = 0;
  let recallAsked = false;

  function bez(u, out) {
    const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
    out.set(fl.p0.x * a + fl.p1.x * b + fl.p2.x * c, fl.p0.y * a + fl.p1.y * b + fl.p2.y * c, fl.p0.z * a + fl.p1.z * b + fl.p2.z * c);
    return out;
  }
  function bezTan(u, out) {
    out.set(2 * (1 - u) * (fl.p1.x - fl.p0.x) + 2 * u * (fl.p2.x - fl.p1.x), 2 * (1 - u) * (fl.p1.y - fl.p0.y) + 2 * u * (fl.p2.y - fl.p1.y), 2 * (1 - u) * (fl.p1.z - fl.p0.z) + 2 * u * (fl.p2.z - fl.p1.z));
    return out;
  }
  const groundY = (x, z) => island.heightAt(x, z);
  function pickSpot(avoidDog = true) {
    let best = null, bs = -1e9;
    for (const e of edge) {
      const dd = Math.hypot(e.x - mover.x, e.z - mover.z);
      let s = rng() * 3 + (e.z > 0 ? 1.2 : 0); // 偏爱靠前（离镜头近）的位置
      if (avoidDog && dd < 2.6) s -= 6;
      if (s > bs) { bs = s; best = e; }
    }
    return best || { x: 4.6, z: 3.6, a: 0.66, k: -1 };
  }
  function startArrive(carry) {
    const b = ensureBird();
    spot = pickSpot(!carry);
    const far = FAR[(rng() * FAR.length) | 0];
    fl.p0.copy(far);
    fl.p2.set(spot.x, groundY(spot.x, spot.z), spot.z);
    // 从岛外沿着“远处 → 落脚点”的方向压低进场
    tmp.set(spot.x, 0, spot.z).normalize();
    fl.p1.set(spot.x + tmp.x * 5.5 + (far.x - spot.x) * 0.12, fl.p2.y + 3.4, spot.z + tmp.z * 5.5 + (far.z - spot.z) * 0.12);
    fl.arrive = true; fl.t = 0; fl.dur = carry ? 7.5 : 6.5; fl.on = true;
    b.carry = !!carry;
    b.group.visible = true;
    b.setState('fly');
    b.group.position.copy(fl.p0);
  }
  function startLeave(carry) {
    const b = ensureBird();
    const far = FAR[(rng() * FAR.length) | 0];
    fl.p0.copy(b.group.position);
    fl.p2.copy(far);
    tmp.set(b.group.position.x, 0, b.group.position.z).normalize(); // 先朝岛外飞
    fl.p1.set(fl.p0.x + tmp.x * 4 + (far.x - fl.p0.x) * 0.2, fl.p0.y + 3.2, fl.p0.z + tmp.z * 4 + (far.z - fl.p0.z) * 0.2);
    fl.arrive = false; fl.t = 0; fl.dur = carry ? 8 : 6.5; fl.on = true; fl.lift = 0;
    b.carry = !!carry;
    b.setState('takeoff');
    // 起飞前先转向要飞去的方向
    faceTo(Math.atan2(fl.p1.x - fl.p0.x, fl.p1.z - fl.p0.z));
  }
  let yaw = 0, yawT = 0;
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  function faceTo(a, snap) { yawT = a; if (snap) yaw = a; }
  /** 推进飞行；返回 true = 飞完了 */
  function flyStep(dt) {
    const b = bird;
    fl.t += dt;
    const T = 0.8; // 起飞原地蓄力、腾空的时间
    let u;
    if (fl.arrive) u = 1 - Math.pow(1 - clamp(fl.t / fl.dur, 0, 1), 1.7); // 进场：越来越慢
    else u = fl.t < T ? 0 : Math.pow(clamp((fl.t - T) / (fl.dur - T), 0, 1), 1.6); // 离场：越来越快
    bez(u, pos); bezTan(Math.min(0.999, Math.max(0.001, u)), tan);
    b.group.position.copy(pos);
    const h = Math.hypot(tan.x, tan.z);
    if (h > 1e-4) { yawT = Math.atan2(tan.x, tan.z); }
    yaw += angDiff(yaw, yawT) * (1 - Math.exp(-dt * 6));
    const pitch = Math.atan2(tan.y, Math.max(1e-4, h));
    const k = fl.arrive ? clamp((1 - u) * 6, 0, 1) : clamp(u * 8, 0, 1); // 贴地时身体放平
    b.group.rotation.set(-pitch * 0.55 * k, yaw, 0);
    if (fl.arrive) b.setState(u < 0.55 ? 'fly' : u < 0.88 ? 'glide' : 'land');
    else if (fl.t >= T && b.state !== 'fly') b.setState('fly');
    return fl.t >= fl.dur;
  }
  function settleOnGround() {
    const b = bird;
    b.group.position.set(spot.x, groundY(spot.x, spot.z), spot.z);
    b.group.rotation.set(0, yaw, 0);
    b.setState('stand');
  }

  // ---- 小狗被接管期间的控制器（brain 的 game 模式）
  const controller = {
    get state() { return 'travel:' + travel.phase; },
    update(dt, S) {
      if (travel.phase === 'board') {
        S.dog.setAction(mover.gait() || 'idle');
        if (bird) S.look(bird.group.position);
      } else S.look(null);
    },
    onNeedKennel() { if (travel.phase === 'board') cancelBoard(); }, // 路上下雨了：不去了
    exit() { dog.group.visible = true; },
  };
  function cancelBoard() {
    if (brain.mode === 'game') brain.exitGame();
    setPhase('stay'); stayLeft = Math.min(stayLeft, 3); sub = 'stand'; subT = 0;
  }

  /** 现在为什么不能跟白鹭走（能走则返回空串） */
  function rideBlock() {
    if (wentToday) return '今天出过门了';
    if (travel.noRide) return '这次来访不带狗';
    const h = env.hour;
    if (h < EGRET.DAY_FROM || h > EGRET.RIDE_LATEST) return '时间不对';
    if (env.isRaining || env.rain > 0.05) return '在下雨';
    if (mover.inKennel) return '在窝里';
    if (mover.onRamp) return '在瞭望台上';
    if (!brain.canGame()) return '正忙着（' + brain.mode + ' / ' + brain.state + '）';
    const r = typeof brain.routine === 'function' ? brain.routine() : null;
    if (r && r.mealDue) return '饭点';
    if (r && (r.sleepTime || r.evening)) return '该歇着了';
    if (r && r.energy < EGRET.MIN_ENERGY) return '没精神（' + r.energy.toFixed(2) + '）';
    if ((ctx.game && ctx.game.active) || (ctx.fishing && ctx.fishing.active)) return '在玩小游戏';
    return '';
  }
  const canRide = () => rideBlock() === '';
  function rideChance() {
    if (travel.idle < EGRET.BORED_FROM) return 0;
    return EGRET.RIDE_BASE + EGRET.RIDE_BORED * clamp((travel.idle - EGRET.BORED_FROM) / (EGRET.BORED_FULL - EGRET.BORED_FROM), 0, 1);
  }

  /** 白鹭现在来一趟（时刻表到点时调用；调试也可以直接调）。opts.ride：true 一定带小狗走 / false 一定不带 */
  function visitNow(opts = {}) {
    if (travel.phase !== 'idle') return false;
    if (env.isRaining || env.rain > 0.05 || env.weather === 'storm') return false;
    if (!loaded) { loadEgretModule().then(() => { loaded = true; visitNow(opts); }); return true; } // 刚启动、模型还没加载完：等它加载好再来
    travel.forceRide = opts.ride === true; travel.noRide = opts.ride === false;
    travel.visits++;
    startArrive(false);
    setPhase('arrive');
    return true;
  }
  /** 把出门的小狗叫回来 */
  function recall() {
    if (travel.phase !== 'away') return false;
    recallAsked = true;
    beginReturn();
    return true;
  }
  /** 小狗不在 / 正要走：玩具架上的东西先别玩。返回 true = 已拦下并给了提示 */
  function blockPlay() {
    if (!travel.busy) return false;
    hint.toast(travel.phase === 'dismount' || travel.phase === 'return' ? '小柴马上就到家啦' : travel.phase === 'board' || travel.phase === 'mount' ? '小柴正要跟白鹭出门呢' : '小柴出门了，还没回来');
    return true;
  }
  function saveAway(away) { store.write({ day: today, went: wentToday, away: !!away }); }

  function beginAway() {
    setPhase('away');
    dog.group.visible = false;
    if (bird) bird.group.visible = false;
    wentToday = true; travel.rides++;
    saveAway(true);
    hint.show('小柴乘着白鹭出门了，18:00 回来', { recall: true });
  }
  function beginReturn() {
    startArrive(true);
    setPhase('return');
    dog.group.visible = true;
    saveAway(false);
    hint.show('白鹭正送小柴回来…', { recall: false });
  }
  /** 小狗趴在背上的位置：比座位再靠后一点（别挡住白鹭的脖子） */
  function seatPose() {
    bird.seat.getWorldPosition(seatP); bird.seat.getWorldQuaternion(seatQ);
    seatP.add(tmp.set(0, -0.13, -0.3).applyQuaternion(seatQ)); // 肚皮贴着背、整体靠后（别挡住白鹭的脖子）
  }
  function attachDog() {
    bird.group.updateMatrixWorld(true);
    seatPose();
    dog.group.position.copy(seatP); dog.group.quaternion.copy(seatQ);
    dog.setAction('lie', { fade: 0.2 });
    dog.speed = 0;
  }

  function update(dt) {
    dt = clamp(dt, 0, 0.1);
    phT += dt;
    // 多久没人跟小狗玩了
    const playing = (ctx.stick && ctx.stick.state !== 'hidden') || (ctx.petInput && ctx.petInput.active) || (ctx.game && ctx.game.active) || (ctx.fishing && ctx.fishing.active);
    travel.idle = playing ? 0 : travel.idle + dt;
    const h = env.hour, raining = env.isRaining || env.rain > 0.05;
    // 过了一天：时刻表和“今天出过门”清零
    const dk = dayKey();
    if (dk !== today) { today = dk; wentToday = false; makeSlots(); if (travel.phase !== 'away') saveAway(false); }

    // 上次关掉桌宠时小狗还在外面：一启动就是“出门中”
    if (bootAway) {
      bootT += dt;
      if (h >= EGRET.DAY_FROM && h < EGRET.DAY_TO && travel.phase === 'idle' && brain.canGame() && brain.enterGame(controller)) {
        bootAway = false; ensureBird(); const e = pickSpot(false); mover.place(e.x, e.z, 0);
        beginAway(); travel.rides--; // 不算新的一次出门
      } else if (bootT > 4 || h < EGRET.DAY_FROM || h >= EGRET.DAY_TO) { bootAway = false; saveAway(false); }
    }

    if (bird && bird.group.visible) bird.update(dt);

    switch (travel.phase) {
      case 'idle': {
        // 时刻表：到点、天气合适、没在玩小游戏就来
        if (h >= EGRET.DAY_FROM && h < EGRET.DAY_TO && !bootAway) {
          for (let i = 0; i < slots.length; i++) {
            if (slotDone[i] || h < slots[i]) continue;
            if (h > slots[i] + EGRET.SLOT_WAIT) { slotDone[i] = true; continue; } // 错过了（启动得晚 / 一直不方便）
            if (raining || env.weather === 'storm' || (env.weather === 'cloudy' && !EGRET.CLOUDY_SLOTS.includes(i))) { slotDone[i] = true; continue; }
            if ((ctx.game && ctx.game.active) || (ctx.fishing && ctx.fishing.active)) break; // 等小游戏结束
            slotDone[i] = true;
            visitNow();
            break;
          }
        }
        break;
      }
      case 'arrive': {
        if (flyStep(dt)) {
          settleOnGround();
          setPhase('stay');
          stayLeft = rand(EGRET.STAY[0], EGRET.STAY[1]); sub = 'stand'; subT = rand(1.6, 3); walkTo = null;
          decideAt = rand(7, 14); decided = false; wantRide = false;
        }
        break;
      }
      case 'stay': {
        stayLeft -= dt; subT -= dt;
        const b = bird;
        yaw += angDiff(yaw, yawT) * (1 - Math.exp(-dt * 4));
        b.group.rotation.set(0, yaw, 0);
        if (sub === 'walk' && walkTo) {
          const dx = walkTo.x - b.group.position.x, dz = walkTo.z - b.group.position.z, d = Math.hypot(dx, dz);
          faceTo(Math.atan2(dx, dz));
          const turned = Math.abs(angDiff(yaw, yawT)) < 0.5;
          if (b.state !== (turned ? 'walk' : 'stand')) b.setState(turned ? 'walk' : 'stand');
          if (turned) {
            const stepLen = Math.min(d, (b.walkSpeed || 0.45) * BIRD_SCALE * dt);
            b.group.position.x += (dx / Math.max(1e-5, d)) * stepLen; b.group.position.z += (dz / Math.max(1e-5, d)) * stepLen;
            b.group.position.y = groundY(b.group.position.x, b.group.position.z);
          }
          if (d < 0.06) { spot = walkTo; walkTo = null; sub = rng() < 0.6 ? 'peck' : 'stand'; subT = sub === 'peck' ? 1.3 : rand(1.5, 3.5); b.setState(sub); }
        } else if (subT <= 0) {
          // 站够了：沿着岛边挪到相邻的落脚点，或者低头啄一下
          const near = edge.filter((e) => e !== spot && Math.hypot(e.x - b.group.position.x, e.z - b.group.position.z) < 2.6 && Math.hypot(e.x - mover.x, e.z - mover.z) > 1.6);
          if (near.length && rng() < 0.75) { walkTo = near[(rng() * near.length) | 0]; sub = 'walk'; subT = 99; }
          else { sub = 'peck'; subT = 1.3; b.setState('peck'); }
        } else if (sub !== 'walk' && b.state !== 'peck' && b.state !== 'stand') b.setState('stand');

        // 要不要带小狗走：落地一会儿后决定一次
        // 想不想走只掷一次骰子；想走但小狗这会儿腾不出手（叼着垫子、在窝里…）就等等，白鹭走之前有机会再走
        if (!decided && phT > decideAt) { decided = true; wantRide = travel.forceRide || rng() < rideChance(); }
        if (decided && wantRide && sub !== 'walk' && stayLeft > 3) {
          travel.lastBlock = rideBlock();
          if (travel.lastBlock === '今天出过门了' || travel.lastBlock === '这次来访不带狗' || travel.lastBlock === '时间不对') wantRide = false;
          else if (canRide() && brain.enterGame(controller)) {
            wantRide = false;
            const c = island.clampWalkable(b.group.position.x * 0.86, b.group.position.z * 0.86); // 白鹭靠岛心一侧
            mover.goTo(c.x, c.z, { run: true, arriveR: 0.2 });
            b.setState('stand'); sub = 'stand';
            setPhase('board');
            hint.toast('小柴想跟白鹭出去玩！');
            break;
          }
        }
        // 该走了：停够了、下雨了、被跑近的小狗惊到
        const scared = brain.mode !== 'game' && mover.speed > 1.6 && Math.hypot(mover.x - b.group.position.x, mover.z - b.group.position.z) < 1.5;
        if ((stayLeft <= 0 && sub !== 'walk') || raining || scared || phT > 59) { startLeave(false); setPhase('leave'); }
        break;
      }
      case 'leave': {
        if (flyStep(dt)) { bird.group.visible = false; fl.on = false; setPhase('idle'); travel.forceRide = false; travel.noRide = false; }
        break;
      }
      case 'board': {
        // 白鹭站着等，扭头看跑过来的小狗
        faceTo(Math.atan2(mover.x - bird.group.position.x, mover.z - bird.group.position.z) + Math.PI * 0.5);
        yaw += angDiff(yaw, yawT) * (1 - Math.exp(-dt * 3));
        bird.group.rotation.set(0, yaw, 0);
        if (raining || brain.mode !== 'game') { cancelBoard(); break; }
        if (mover.settled || phT > 9) {
          hopFrom.copy(dog.group.position); hopQ.copy(dog.group.quaternion); hopT = 0;
          mover.clearGoal();
          setPhase('mount');
        }
        break;
      }
      case 'mount': {
        // 跳到白鹭背上趴好
        hopT += dt;
        const u = clamp(hopT / 0.55, 0, 1);
        bird.group.updateMatrixWorld(true);
        seatPose();
        dog.group.position.lerpVectors(hopFrom, seatP, u); dog.group.position.y += 0.7 * 4 * u * (1 - u);
        dog.group.quaternion.slerpQuaternions(hopQ, seatQ, ease(u));
        dog.setAction(u < 0.8 ? 'pounce' : 'lie', { fade: 0.12 });
        if (hopT > 1.25) { startLeave(true); setPhase('depart'); hint.toast('小柴乘着白鹭出门啦'); }
        else if (u >= 1) attachDog();
        break;
      }
      case 'depart': {
        const done = flyStep(dt);
        attachDog();
        if (done) { fl.on = false; beginAway(); }
        break;
      }
      case 'away': {
        // 岛上没有小狗；到点了（或时间被拨到了晚上 / 清晨）就回来
        dog.group.visible = false;
        dog.group.position.set(mover.x, -60, mover.z);
        if (h >= EGRET.DAY_TO || h < EGRET.DAY_FROM) beginReturn();
        break;
      }
      case 'return': {
        const done = flyStep(dt);
        attachDog();
        if (done) {
          settleOnGround(); attachDog();
          const c = island.clampWalkable(spot.x * 0.84, spot.z * 0.84);
          hopFrom.copy(dog.group.position); hopQ.copy(dog.group.quaternion);
          hopTo.set(c.x, groundY(c.x, c.z), c.z); hopT = 0;
          setPhase('dismount');
        }
        break;
      }
      case 'dismount': {
        hopT += dt;
        const u = clamp((hopT - 0.5) / 0.5, 0, 1); // 落稳半秒再跳下来
        if (hopT < 0.5) attachDog();
        else {
          const face = Math.atan2(hopTo.x - hopFrom.x, hopTo.z - hopFrom.z);
          dog.group.position.lerpVectors(hopFrom, hopTo, u); dog.group.position.y += 0.5 * 4 * u * (1 - u);
          dog.group.quaternion.slerpQuaternions(hopQ, tmpQ.setFromAxisAngle(tmp.set(0, 1, 0), face), ease(u));
          dog.setAction(u < 0.85 ? 'pounce' : 'idle', { fade: 0.12 });
          if (u >= 1) {
            mover.place(hopTo.x, hopTo.z, face);
            if (brain.mode === 'game') brain.exitGame();
            recallAsked = false;
            hint.hide(); hint.toast('小柴回来啦');
            bird.carry = false;
            startLeave(false); setPhase('leave');
          }
        }
        break;
      }
      default: break;
    }
  }

  /** 调试：'visit' 白鹭现在来（不带狗走）；'ride' 来了一定带狗走；'away' 直接进入出门状态 */
  function debugStart(what) {
    if (what === 'visit') return visitNow({ ride: false });
    if (what === 'ride') { wentToday = false; return visitNow({ ride: true }); }
    if (what === 'away') {
      if (travel.phase !== 'idle' || !brain.enterGame(controller)) return false;
      ensureBird(); const e = pickSpot(false); mover.place(e.x, e.z, 0);
      beginAway();
      return true;
    }
    return false;
  }
  function info() {
    return {
      phase: travel.phase, away: travel.away, busy: travel.busy, visits: travel.visits, rides: travel.rides, wentToday,
      block: travel.lastBlock || '', idle: +travel.idle.toFixed(1), chance: +rideChance().toFixed(3), stub: birdIsStub, slots: slots.map((s) => +s.toFixed(2)), slotDone: slotDone.slice(),
      bird: bird && bird.group.visible ? { state: bird.state, pos: bird.group.position.toArray().map((v) => +v.toFixed(2)) } : null,
      hint: hint.visible ? hint.text : '', toast: hint.lastToast, dogVisible: dog.group.visible, edge: edge.length,
    };
  }
  return travel;
}

export default createEgretVisits;
