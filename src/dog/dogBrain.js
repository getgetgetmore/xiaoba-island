// 狗狗行为状态机（WP5）。接口对应 DESIGN.md 3.8。
// 结构：mover（移动手感）+ behaviors（自主行为）+ fetch（木棍互动）+ 这里的调度（优先级 / 权重 / 行为间隔 / 受惊）。
// brain 只控制 dog.group.position / rotation.y；其它一律走 dog 契约。
import * as THREE from 'three';
import { clamp } from '../core/util.js';
import { createMover } from './brain/mover.js';
import { createBehaviors } from './brain/behaviors.js';
import { createFetch } from './brain/fetch.js';
import { createPetMode } from './brain/petMode.js';
import { createLookout } from './brain/lookout.js';
import { createMatCtl } from './brain/matCtl.js';
import { createMatBehaviors } from './brain/matBehaviors.js';

const RAIN_ON = 0.15; // 与 env.isRaining 一致
const RAIN_OFF = 0.05;
const RAIN_CALM_SECONDS = 8; // 雨停后再等这么久才出窝

export function createBrain(ctx) {
  const { dog, island } = ctx;
  const brain = { mode: 'auto', state: 'auto:idle', // mode：auto / fetch / pet / game（被小游戏接管）
    update() {}, stats: { startles: 0, drops: 0, behaviors: {} } };
  if (!dog || !island) return brain;

  const A = island.anchors;
  const rng = ctx.rng || Math.random;
  const rand = (a, b) => a + (b - a) * rng();
  const rint = (a, b) => Math.min(b, Math.floor(a + (b - a + 1) * rng()));
  const mover = createMover(ctx, dog);
  const lookV = new THREE.Vector3();

  // ---------------- 共享上下文 S ----------------
  const S = {
    ctx, dog, island, mover, rand, rint, lookV,
    env: ctx.env,
    critters: ctx.critters || null,
    stick: ctx.stick || null,
    rainHold: false,
    sleepTime: false,
    evening: false,
    stats: brain.stats,
    look(target) { dog.lookAt(target || null); },
    lookT: 0,
    lookAround(dt) { // 偶尔换个方向张望
      S.lookT -= dt;
      if (S.lookT > 0) return;
      S.lookT = rand(1.4, 3.2);
      if (rng() < 0.3) { dog.lookAt(null); return; }
      const a = mover.heading + rand(-1.1, 1.1);
      lookV.set(mover.x + Math.sin(a) * 3, dog.group.position.y + rand(0.35, 1.1), mover.z + Math.cos(a) * 3);
      dog.lookAt(lookV);
    },
    nearestCritter(kind) {
      const list = S.critters ? S.critters.targets : null;
      if (!list) return null;
      let best = null, bd = 1e9;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t.kind !== kind || !t.active) continue;
        const d = Math.hypot(t.position.x - mover.x, t.position.z - mover.z);
        if (d < bd) { bd = d; best = t; }
      }
      return best;
    },
    pickChaseTarget() {
      const list = S.critters ? S.critters.targets : null;
      if (!list) return null;
      let best = null, bd = 1e9;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t.kind !== 'butterfly' || !t.active || !t.chaseable) continue;
        // 蝴蝶多在岛沿的花丛上空：只要离可行走区域不到 1 个身位就可以追（狗从旁边扑过去）
        if (!island.isWalkable(t.position.x, t.position.z)) {
          const c = island.clampWalkable(t.position.x, t.position.z);
          if (Math.hypot(c.x - t.position.x, c.z - t.position.z) > 1.1) continue;
        }
        const d = Math.hypot(t.position.x - mover.x, t.position.z - mover.z);
        if (d < bd) { bd = d; best = t; }
      }
      return best;
    },
    needKennel: () => S.rainHold || S.sleepTime,
    matCtl: null,
    age: 0, // brain 已运行的秒数
    exertion: 0, // 0..1 疲劳度：快跑时上升（约 20 秒跑满），停下来后慢慢恢复（约 50 秒）
    // 适合晒太阳：白天 9–16 点、晴/少云、没下雨
    sunOK() {
      const e = S.env;
      return e.hour >= 9 && e.hour < 16 && e.cloudiness < 0.5 && !S.rainHold && !e.isRaining && e.rain < 0.05;
    },
  };
  // 狗垫 / 瞭望台只在小岛提供了 island.mat / anchors.lookout 时才有（stub 小岛没有，对应行为自动跳过）
  if (island.mat && island.mat.object) S.matCtl = createMatCtl(S);

  const B = createBehaviors(S);
  const fetch = S.stick ? createFetch(S) : null;
  const pet = createPetMode(S);
  const lookout = A.lookout ? createLookout(S) : null;
  const matB = S.matCtl ? createMatBehaviors(S) : null;
  const pool = [B.zoomies, B.roll, B.chase, B.sniff, B.wander, B.sit, B.nap, B.drink, B.sunset, B.evening];
  if (lookout) pool.push(lookout);
  if (matB) pool.push(matB.sunbathe, matB.fetchMat);
  let forced = null; // 调试：下一次选择行为时强制选它
  // 距离上次被选中过了几轮（越久越想做）；后加的长时间行为从 0 起，刚启动时不会抢在短行为前面
  const since = new Map(pool.map((b) => [b, b === lookout || (matB && (b === matB.sunbathe || b === matB.fetchMat)) ? 0 : 3]));

  let cur = null;       // 当前行为
  let lastPicked = null;
  let gapT = rand(1, 2);
  let lastSeq = ctx.env ? ctx.env.lightningSeq : 0;
  let calmT = 0;
  let flinch = 0; // 0 无 / 1 等停稳 / 2 播放中
  let flinchT = 0, flinchCool = 0;

  // ---------------- 初始摆放（非瞬移：只在创建时） ----------------
  updateConditions(0);
  if (S.needKennel()) {
    const k = A.kennelInside;
    mover.place(k.x, k.z, A.kennelFacing);
    mover.inKennel = true;
    dog.setAction(S.sleepTime ? 'sleep' : 'lie');
    startBehavior(B.kennel);
    brain.state = 'auto:kennel';
  } else {
    const c = island.clampWalkable(A.lawn.x - 0.4, A.lawn.z + 0.2);
    mover.place(c.x, c.z, 0.6);
    dog.setAction('idle');
  }

  function updateConditions(dt) {
    const env = ctx.env;
    if (env.rain > RAIN_ON) { S.rainHold = true; calmT = 0; }
    else if (S.rainHold) {
      if (env.rain < RAIN_OFF) { calmT += dt; if (calmT >= RAIN_CALM_SECONDS) S.rainHold = false; }
      else calmT = 0;
    }
    const h = env.hour;
    S.sleepTime = h >= 22 || h < 6;
    S.evening = h >= 19 && h < 22;
  }

  function startBehavior(b) {
    cur = b;
    S.look(null);
    S.lookT = 0;
    b.enter();
    brain.state = 'auto:' + b.name;
    brain.stats.behaviors[b.name] = (brain.stats.behaviors[b.name] || 0) + 1;
  }

  function endBehavior(natural = false) {
    if (cur && cur.exit) cur.exit();
    mover.driveSpeed = -1;
    lastPicked = cur;
    if (cur && natural) cur.endedAt = S.age; // 自然结束才记：供各行为做“刚做完不久就少选”的冷却
    cur = null;
  }

  function pickNext() {
    if (forced) {
      const fb = pool.find((b) => b.name === forced);
      forced = null;
      if (fb) {
        for (const b of pool) since.set(b, since.get(b) + 1);
        since.set(fb, 0);
        return fb;
      }
    }
    let sum = 0;
    const w = pickWeights;
    for (let i = 0; i < pool.length; i++) {
      const b = pool[i];
      let x = b.weight();
      if (x > 0) {
        if (b === lastPicked && !b.repeatable) x = 0;
        else x *= 1 + 0.8 * Math.min(5, since.get(b));
      }
      w[i] = x;
      sum += x;
    }
    if (sum <= 0) return null;
    let r = rng() * sum;
    let chosen = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      r -= w[i];
      if (w[i] > 0 && r <= 0) { chosen = pool[i]; break; }
    }
    for (const b of pool) since.set(b, since.get(b) + 1);
    since.set(chosen, 0);
    return chosen;
  }
  const pickWeights = new Array(pool.length).fill(0);

  // ---------------- 受惊（打雷） ----------------
  function updateFlinch(dt) {
    const env = ctx.env;
    flinchCool -= dt;
    if (env.lightningSeq !== lastSeq) {
      lastSeq = env.lightningSeq;
      if (flinch === 0 && flinchCool <= 0) { flinch = 1; flinchT = 0; }
    }
    if (flinch === 0) return false;
    flinchT += dt;
    if (flinch === 1) {
      mover.hold = true;
      if (mover.speed < 0.4 || flinchT > 0.8) { flinch = 2; flinchT = 0; dog.setAction('flinch'); }
      else dog.setAction(mover.gait() || 'idle');
    } else {
      dog.setAction('flinch');
      if ((flinchT >= 0.25 && dog.actionDone) || flinchT > 1.6) {
        flinch = 0;
        mover.hold = false;
        flinchCool = 2.5;
        if (dog.action === 'flinch') dog.setAction('idle', { fade: 0.15 });
        return false;
      }
    }
    return true;
  }

  // ---------------- 主更新 ----------------
  brain.update = function update(dt, env) {
    update0(dt);
    // 狗踩在/趴在放平的垫子上时，身体抬到垫面高度（否则会陷进垫子里）
    {
      let want = 0;
      const M = S.matCtl, mt = island.mat;
      if (M && M.resting && mt) {
        const dx = mover.x - M.x, dz = mover.z - M.z;
        const sy = Math.sin(M.yaw), cy = Math.cos(M.yaw);
        const along = dx * sy + dz * cy, across = dx * cy - dz * sy;
        const e = Math.hypot(along / (mt.halfZ || 0.7), across / (mt.halfX || 0.55));
        want = (mt.top === undefined ? 0.05 : mt.top) * (1 - clamp((e - 0.7) / 0.35, 0, 1));
      }
      mover.extraY += (want - mover.extraY) * (1 - Math.exp(-10 * clamp(dt, 0, 0.1)));
    }
    if (!(S.matCtl && S.matCtl.carried)) mover.reverse = false; // 安全网：没叼着垫子就不倒退
    if (S.matCtl) S.matCtl.update(clamp(dt, 0, 0.1)); // 垫子跟随狗嘴（在狗位置更新之后）
  };
  brain.force = (name) => { forced = name || null; };
  /**
   * 现在能不能摸小狗。其他互动正在进行时不能：扔树枝（树枝不在架子上）、叼着垫子、在狗窝里、在瞭望台坡道/平台上、
   * 需要回窝（下雨避雨、深夜睡觉）、被雷吓到的瞬间。
   */
  brain.canPet = () => brain.mode !== 'fetch' && brain.mode !== 'game' && !(S.stick && S.stick.state !== 'hidden') && !mover.inKennel && !mover.onRamp
    && !(S.matCtl && S.matCtl.carried) && !S.needKennel() && flinch === 0;
  /**
   * 小游戏接管（mode = 'game'，钓鱼小游戏用）：接管期间 brain 每帧只调用 controller.update(dt, S) 和 mover.update(dt)，
   * 不响应 fetch / pet / 自主行为；canPet() 为 false。下雨 / 深夜需要回窝时调用 controller.onNeedKennel(原因)（由 controller 决定怎么收尾，然后调用 exitGame）。
   * controller：{ update(dt, S), enter?(S), exit?(S), onNeedKennel?(why), state? }。S 里有 mover / dog / island / env / look() 等。
   */
  let gameCtl = null, gameNotified = false;
  brain.needKennel = () => S.needKennel();
  brain.canGame = () => (brain.mode === 'auto' || brain.mode === 'pet') && !(S.stick && S.stick.state !== 'hidden')
    && !(S.matCtl && S.matCtl.carried) && !S.needKennel() && flinch === 0;
  brain.enterGame = (controller) => {
    if (!controller || typeof controller.update !== 'function' || !brain.canGame()) return false;
    if (brain.mode === 'pet') pet.exit();
    if (cur) endBehavior();
    flinch = 0;
    mover.hold = false; mover.spinRate = 0; mover.driveSpeed = -1; mover.reverse = false;
    mover.clearGoal();
    S.look(null);
    brain.mode = 'game';
    brain.state = 'game:enter';
    gameCtl = controller;
    gameNotified = false;
    if (controller.enter) controller.enter(S);
    return true;
  };
  brain.exitGame = () => {
    if (brain.mode !== 'game') return;
    const c = gameCtl;
    gameCtl = null;
    if (c && c.exit) c.exit(S);
    brain.mode = 'auto';
    mover.clearGoal(); mover.hold = false; mover.spinRate = 0; mover.driveSpeed = -1; mover.face(NaN);
    S.look(null);
    dog.setAction('idle', { fade: 0.2 });
    gapT = rand(1.2, 2.4);
    cur = null;
    brain.state = 'auto:idle';
  };
  brain.pet = pet; // 调试/测试用：当前的摸摸反应
  brain.mover = mover; // 调试/测试用：只读观察
  brain.weights = () => pool.map((b) => [b.name, +b.weight().toFixed(2)]); // 调试：当前各行为权重

  function update0(dt) {
    dt = clamp(dt, 0, 0.1);
    S.age += dt;
    S.exertion = clamp(S.exertion + (mover.speed > 2 ? dt / 20 : -dt / 50), 0, 1);
    dog.pant = clamp((S.exertion - 0.3) / 0.5, 0, 1); // 累到一定程度开始吐舌头喘气
    updateConditions(dt);
    const stick = S.stick;

    // ---- 小游戏接管：只跑 controller 和 mover ----
    if (brain.mode === 'game') {
      const c = gameCtl;
      if (c) {
        if (!gameNotified && S.needKennel()) { gameNotified = true; if (c.onNeedKennel) c.onNeedKennel(S.rainHold ? 'rain' : 'sleep'); }
        if (gameCtl === c) { c.update(dt, S); if (brain.mode === 'game') brain.state = 'game:' + (c.state || 'play'); }
      }
      mover.update(dt);
      return;
    }
    const wantFetch = !!(fetch && stick && stick.state !== 'hidden');

    if (wantFetch && brain.mode !== 'fetch') {
      if (brain.mode === 'pet') pet.exit();
      if (cur) endBehavior();
      flinch = 0;
      mover.hold = false;
      brain.mode = 'fetch';
      fetch.enter();
    } else if (!wantFetch && brain.mode === 'fetch') {
      fetch.exit();
      brain.mode = 'auto';
      mover.hold = false;
      gapT = rand(1, 2);
      cur = null;
    }

    // ---- 摸摸：只在没有其他互动时响应；一旦不满足条件（比如开始扔树枝、下雨了）立刻结束 ----
    {
      const pi = ctx.petInput;
      const wantPet = !!(pi && (pi.active || pi.hold)) && (brain.mode === 'pet' ? !wantFetch && !mover.inKennel && !mover.onRamp && !S.needKennel() : brain.canPet());
      if (wantPet && brain.mode !== 'pet') {
        if (cur) endBehavior();
        brain.mode = 'pet';
        pet.enter();
      } else if (!wantPet && brain.mode === 'pet') {
        pet.exit();
        brain.mode = 'auto';
        gapT = rand(1.2, 2.4);
        cur = null;
      }
      if (brain.mode === 'pet') {
        pet.update(dt);
        brain.state = 'pet:' + pet.reaction;
        mover.update(dt);
        return;
      }
    }

    if (brain.mode === 'fetch') {
      fetch.update(dt);
      brain.state = 'fetch:' + fetch.phase + (fetch.phase === 'wait' ? ':' + fetch.sub : '');
      mover.update(dt);
      return;
    }

    // ---- auto ----
    const flinching = updateFlinch(dt);
    if (flinching) {
      mover.update(dt);
      return;
    }

    if (S.needKennel() && (!cur || cur !== B.kennel)) {
      if (cur) endBehavior();
      startBehavior(B.kennel);
    }

    if (cur) {
      const done = cur.update(dt);
      brain.state = 'auto:' + cur.name + (cur.phase ? ':' + cur.phase() : '');
      if (done) {
        endBehavior(true);
        gapT = rand(1, 3);
      }
    } else {
      brain.state = 'auto:idle';
      dog.setAction(mover.gait() || 'idle');
      S.lookAround(dt);
      gapT -= dt;
      if (gapT <= 0 && mover.settled) {
        const b = pickNext();
        if (b) startBehavior(b);
        else gapT = 1;
      }
    }
    mover.update(dt);
  }

  // 调试：当前行为名
  Object.defineProperty(brain, 'current', { get: () => (cur ? cur.name : null) });
  return brain;
}
