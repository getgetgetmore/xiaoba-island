// 尾巴钓鱼小游戏（对外入口）：createFishing(ctx) → { active, start(opts), stop(aborted), abort(), update(dt), sim, view, ... }
// 在岛上的池塘边进行，不换场景、不换相机对象：岛的模拟（天气 / 昆虫 / 小鱼）照常运行，钓鱼模块只接管
//   - 小狗：通过 brain 的“小游戏接管”模式（brain.enterGame(controller)）走到水边、背对水面坐下、尾巴垂进水里；
//   - 镜头取景：fishing.view（main.js 的 updateCamera 读取，平滑推近到“池塘 + 小狗”）；
//   - 指针交互：钓鱼期间扔树枝 / 摸摸 / 遛狗 / 架子放大镜 / 滚轮缩放 / 右键旋转 / 点穿全部暂停（main.js 与 stick.js 判断 fishing.active）。
// 结构：
//   fishSim.js            纯逻辑（战利品表、稀有度、阶段、挣扎、尾巴疼、计分、结算）
//   fishBot.js            机器人（测试 / 调试自动驾驶）
//   fishing/hud.js        DOM 界面；fishing/icons.js 图标；fishing/fx.js 涟漪 / 飞沫 / “!” / 鱼线 / 架子上的浮漂；
//   fishing/loot.js       战利品模型；fishing/store.js 本地存储（图鉴 / 每天第一局必出漂流瓶 / 看过的寄语）
//   本文件                 流程：就位 → 一局 6 钩（下钩 / 等鱼 / 真咬 / 拉扯 / 出水与小狗的反应）→ 结算 → 收尾；输入；奖励口子
//
// 奖励口子（与遛狗一致）：正常结束 → ctx.rewards.grant(result) + window 事件 'pet:minigame-finished'；
//   中途退出（Esc / ✕ / 下雨）→ 只派发事件（aborted: true），不调用 grant。
//   result = { game:'fishing', completion, stars, tier, score, casts:6, landed, missed, catches:[{id,name,rarity,points}], bottle, prank, aborted }
import * as THREE from 'three';
import { clamp, damp, mulberry32, smoothstep } from '../core/util.js';
import { createFishSim, RARITY, LOOT_BY_ID, FISH } from './fishSim.js';
import { createFishBot } from './fishBot.js';
import { L, pondR } from '../world/island/shape.js';
import { WATER_Y } from '../world/island/water.js';
import { createFishHud } from './fishing/hud.js';
import { createLootKit } from './fishing/loot.js';
import { createFishFx, createShelfBobber } from './fishing/fx.js';
import * as store from './fishing/store.js';

// ------------------------------------------------------------------ 布局
const SPOT_ANGLE = -0.3;   // 钓鱼点相对池心的方位角（朝草坪一侧，从默认镜头能看清小狗侧面和尾巴入水的位置）
const SPOT_K = 1.17;       // 小狗中心离池心的距离 = pondR(angle) × SPOT_K（水边）
const LAND_ANGLE = 0.4;    // 出水后东西落在岸边：相对钓鱼点再转过去的角度（朝镜头一侧）
const LAND_K = 1.08;
const SIT_WAIT = 1.2;      // 坐下后多久开始第一钩
const SIZE = { goldfish: 1.3, koi: 1.1, weed: 1.15, lotusLeaf: 1.15, lotusPod: 1.1, pebble: 1.2, crab: 1.75, frog: 1.6, loach: 2.5, clam: 1.5, pearlClam: 1.55, twig: 2.3, bottle: 1.1 };

const LIFT_T = FISH.LIFT; // 出水的第一段：东西挂在尾巴上被提出水面的时间
// 各样东西挂在尾巴上时“被夹 / 被钩住”的部位（缺省 = 顶部）
const GRIP = { weed: 'base', lotusPod: 'base', lotusLeaf: 'side', twig: 'end', clam: 'front', pearlClam: 'front', frog: 'front', pebble: 'top', bottle: 'top' };
const DOWN = new THREE.Vector3(0, -1, 0), XAX = new THREE.Vector3(1, 0, 0), YAX = new THREE.Vector3(0, 1, 0), ZAX = new THREE.Vector3(0, 0, 1), QID = new THREE.Quaternion();

const ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

export function createFishing(ctx) {
  const dog = ctx.dog, brain = ctx.brain, island = ctx.island;
  const hooks = ctx.gameHooks || {};
  const fishing = {
    active: false,       // 进行中（含收尾走回去的那几秒）
    ending: false,       // 已经请求结束（正在收尾）
    phase: 'idle',       // 'approach' | 'face' | 'sit' | 'play' | 'over' | 'leave' | 'idle'
    sim: null, result: null, view: null, hud: null, shelfItem: null,
    /** 调试：自动驾驶（机器人函数）。一旦有真实输入就让位。setBot('skilled'|'holder'|'spam'|'idle'|null) */
    autoplay: null,
    setBot(kind) { fishing.autoplay = kind ? createFishBot({ kind, seed: 7 }) : null; },
    start, stop, abort, update,
    again: () => restart(),
    debugNext: (id) => (fishing.sim ? fishing.sim.forceNow(id) : false),
    get paused() { return paused; },
  };
  const hud = createFishHud(typeof document !== 'undefined' ? document.body : null);
  fishing.hud = hud;
  if (hud) hud.onExit = () => stop();
  const kit = createLootKit();
  fishing.kit = kit;
  let fx = null;
  let pondCtl = null;           // 池塘里的小金鱼（fish.js 的引诱点接口）
  let built = false;

  // ------------------------------------------------------------------ 几何
  const P = L.pond;
  const spot = new THREE.Vector3(), out = new THREE.Vector3(), landPt = new THREE.Vector3(), toCam = new THREE.Vector3();
  let heading = 0, dirX = 1, dirZ = 0, perpX = 0, perpZ = 1;
  function computeSpot() {
    const a = SPOT_ANGLE, re = pondR(a);
    dirX = Math.cos(a); dirZ = Math.sin(a);
    spot.set(P.x + dirX * re * SPOT_K, 0, P.z + dirZ * re * SPOT_K);
    spot.y = island.heightAt(spot.x, spot.z);
    out.set(P.x + dirX * (P.r + 0.28 + 0.5), 0, P.z + dirZ * (P.r + 0.28 + 0.5));
    out.y = island.heightAt(out.x, out.z);
    heading = Math.atan2(dirX, dirZ); // 小狗朝向 = 远离池心
    // 出水后东西落在岸边草地上：小狗身前、靠镜头一侧
    perpX = -dirZ; perpZ = dirX;
    if (perpZ < 0) { perpX = -perpX; perpZ = -perpZ; }
    // 池塘岸边没有长草的那圈泥土 / 浅草（落在高草里东西会被草挡住）
    const lb = SPOT_ANGLE + LAND_ANGLE, lr = pondR(lb) * LAND_K;
    const gx = P.x + Math.cos(lb) * lr, gz = P.z + Math.sin(lb) * lr;
    landPt.set(gx, island.heightAt(gx, gz) + 0.02, gz);
    // 取景：池塘 + 小狗
    const cx = P.x + dirX * re * 0.5, cz = P.z + dirZ * re * 0.5;
    fishing.viewGoal = { tx: cx + 0.15, ty: 0.42, tz: cz + 0.1, R: 1.95, vy: 1.45, pitch: (27 * Math.PI) / 180, az: 0 };
  }

  // ------------------------------------------------------------------ 输入（鼠标按下 = 点击 / 用力拉；松开 = 放松）
  const inp = { click: false, hold: false };
  let cursorSaved = '';
  const canvas = () => ctx.renderer && ctx.renderer.domElement;
  const onHud = (e) => !!(e.target && e.target.closest && e.target.closest('.fs-btn, .fs-rcard, .fs-note, .fs-noteWrap'));
  function onDown(e) {
    if (!fishing.active || fishing.ending || (e.button !== undefined && e.button !== 0)) return;
    if (hud && hud.noteOpen) { if (!onHud(e) && hud._noteClose) hud._noteClose(); return; }
    if (onHud(e) || (hud && hud.resultVisible)) return;
    inp.click = true; inp.hold = true;
    const el = canvas(); if (el) el.style.cursor = 'grabbing';
  }
  function onUp() {
    if (!fishing.active) return;
    inp.hold = false;
    const el = canvas(); if (el) el.style.cursor = 'pointer';
  }
  function onKeyDown(e) {
    if (!fishing.active) return;
    if (e.key === 'Escape') { e.preventDefault(); stop(); return; }
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (e.repeat) return;
      if (hud && hud.noteOpen) { if (hud._noteClose) hud._noteClose(); return; }
      if (hud && hud.resultVisible) return;
      inp.click = true; inp.hold = true;
    }
  }
  function onKeyUp(e) { if (fishing.active && (e.key === ' ' || e.key === 'Spacebar')) { inp.hold = false; e.preventDefault(); } }
  function onBlur() { inp.hold = false; }
  function listen(on) {
    if (typeof document === 'undefined') return;
    const f = on ? 'addEventListener' : 'removeEventListener';
    document[f]('pointerdown', onDown, true);
    document[f]('pointerup', onUp, true);
    document[f]('pointercancel', onUp, true);
    document[f]('keydown', onKeyDown, true);
    document[f]('keyup', onKeyUp, true);
    window[f]('blur', onBlur);
  }

  // ------------------------------------------------------------------ 状态
  let ph = 'idle', T = 0, phT = 0;
  let paused = false;                        // 漂流瓶纸条打开时暂停一局的计时
  let seed0 = 1, gameNo = 0;
  let today = new Date();
  let resultDone = false, resultT = 0;
  let sitT = 0;
  let dogState = { tug: 0, perk: 0 };
  let lootCur = null;                        // 当前钩上 / 飞出来的东西 { o, id }
  let land = null;                           // 出水后的反应脚本状态
  let missT = 0, missReason = '';
  let prank = null;                          // 大鱼反拉
  let biteT = 0, fakeT = 0, tugPulse = 0;
  let lastCast = -1;
  let startOpts = {};
  const caughtRes = [];                      // 每一钩的结果（给 HUD 小圆点）
  const tail = [];                           // 尾巴各节的世界位置（0..5 + 末端）
  for (let i = 0; i < 7; i++) tail.push(new THREE.Vector3());
  const contact = new THREE.Vector3();       // 尾巴穿过水面的位置
  const hookPt = new THREE.Vector3();        // 钩住的东西在水下的位置（尾巴旁边、略靠池心）
  const headPt = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), a3 = new THREE.Vector3(), b3 = new THREE.Vector3();
  let tailInWater = false;
  const lookV = new THREE.Vector3();
  const _hd = new THREE.Vector3(), _hf = new THREE.Vector3(), _hp = new THREE.Vector3(), _hq = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
  const hangP = new THREE.Vector3(), hangQ = new THREE.Quaternion();
  const fishInfo = {};

  function build() {
    if (built) return;
    built = true;
    fx = createFishFx(ctx.scene);
    fishing.fx = fx;
    const pond = island.group && island.group.getObjectByName ? island.group.getObjectByName('pondFish') : null;
    pondCtl = pond && pond.userData ? pond.userData.pond || null : null;
  }

  // 入口：架子上的浮漂
  fishing.shelfItem = createShelfBobber(ctx, () => onShelfClick());
  function refuseReason() {
    const env = ctx.env;
    if (brain.needKennel && brain.needKennel()) {
      if (env && (env.rain > 0.15 || env.isRaining)) return '下雨天不能钓鱼，等雨停了再来吧';
      return '夜深了，小柴要睡觉啦，明天再钓吧';
    }
    if (ctx.stick && ctx.stick.state !== 'hidden') return '先把树枝收好，再来钓鱼吧';
    return '小柴现在有点忙，等一下再来钓吧';
  }
  function onShelfClick() {
    if (fishing.active) return;
    if (!brain || !brain.canGame || !brain.canGame()) {
      if (fishing.shelfItem) fishing.shelfItem.wiggle();
      if (hud) hud.toast(refuseReason());
      return;
    }
    start();
  }

  // ------------------------------------------------------------------ 开始 / 结束
  function start(opts = {}) {
    if (fishing.active || !dog || !brain || !brain.enterGame || !ctx.renderer || typeof document === 'undefined') return false;
    if (ctx.game && ctx.game.active) return false;
    if (ctx.travel && ctx.travel.blockPlay()) return false; // 小狗出门了
    if (!brain.canGame()) { if (hud) hud.toast(refuseReason()); return false; }
    build();
    computeSpot();
    startOpts = opts;
    seed0 = opts.seed !== undefined ? opts.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    gameNo = 0;
    if (!brain.enterGame(controller)) return false;
    fishing.active = true; fishing.ending = false; fishing.result = null;
    if (island.pondLife && island.pondLife.setHidden) { try { island.pondLife.setHidden(true); } catch (_) { /* ignore */ } } // 常驻的青蛙 / 螃蟹先躲起来
    fishing.view = fishing.viewGoal;
    resetRound();
    if (hooks.onFishStart) hooks.onFishStart();
    if (ctx.island.shelf) ctx.island.shelf.setHover(null);
    const el = canvas();
    if (el) { cursorSaved = el.style.cursor; el.style.cursor = 'pointer'; }
    document.documentElement.dataset.petNoDrag = '1';
    listen(true);
    inp.click = false; inp.hold = false;
    if (hud) { hud.show(true); measure(); hud.hint('小柴正在走向池塘边…'); hud.setCasts(new Array(FISH.CASTS).fill(''), -1); hud.setScore(0); }
    setPhase('approach');
    if (opts.instant) {
      brain.mover.place(spot.x, spot.z, heading);
      dog.setAction('sit', { fade: 0.01 });
      dog.tailDrop = 1;
      setPhase('sit'); sitT = SIT_WAIT;
    } else {
      brain.mover.goTo(out.x, out.z, { arriveR: 0.22 });
    }
    return true;
  }

  function measure() {
    const el = canvas();
    const w = Math.max(1, (el && el.clientWidth) || window.innerWidth), h = Math.max(1, (el && el.clientHeight) || window.innerHeight);
    fishing.size = { w, h };
    if (hud) hud.resize(w, h);
  }
  fishing.resize = () => { if (fishing.active) measure(); };
  if (typeof window !== 'undefined') window.addEventListener('resize', () => fishing.resize());

  function resetRound() {
    clearLoot();
    if (fx) fx.clear();
    land = null; prank = null; paused = false; resultDone = false; resultT = 0;
    caughtRes.length = 0;
    for (let i = 0; i < FISH.CASTS; i++) caughtRes.push('');
    lastCast = -1; biteT = 0; fakeT = 0; missT = 0;
    if (hud) { hud.hideResult(); hud.hideNote(); hud.hideCard(true); hud.fight(null); hud.bang(false); }
  }

  function newSim() {
    today = new Date();
    const rng = mulberry32((seed0 + gameNo * 7919) >>> 0);
    gameNo++;
    const forceBottle = startOpts.forceBottle !== undefined ? !!startOpts.forceBottle : store.bottleDue(today);
    fishing.sim = createFishSim({ rng, forceBottle, allowPrank: startOpts.allowPrank !== false, date: today, seen: store.seenMessages(), test: startOpts.test || {} });
    fishing.sim.clearEvents();
    if (startOpts.queue) for (const id of startOpts.queue) fishing.sim.forceNext(id);
    lastCast = -1;
    paused = false;
    resetRound();
  }

  function restart() {
    if (!fishing.active || fishing.ending || ph !== 'over') return;
    if (hud) { hud.hideResult(); }
    resultDone = false;
    clearLoot();
    dog.setAction('sit', { fade: 0.3 });
    setPhase('sit'); sitT = SIT_WAIT - 0.6;
    fishing.sim = null;
  }

  /** 退出：aborted 缺省 = 还没正常结束就退出 = true。收尾（站起来、走回岸上）要几秒，期间 active 仍为 true，其他互动保持暂停。 */
  function stop(aborted) {
    if (!fishing.active) return;
    if (fishing.ending) { finishLeave(true); return; } // 收尾中再次请求：立即结束
    if (aborted === undefined) aborted = !resultDone;
    if (aborted && !resultDone) {
      const sim = fishing.sim || createFishSim({ rng: mulberry32(seed0), allowPrank: false });
      dispatchResult(sim.result(true), false);
    }
    fishing.ending = true;
    listen(false);
    const el = canvas(); if (el) el.style.cursor = cursorSaved;
    if (hud) { hud.show(false); }
    fishing.view = null;
    setPhase('leave');
    paused = false;
    clearLoot();
    if (fx) fx.clear();
    if (pondCtl) pondCtl.setLure(null);
  }
  function abort() { stop(true); }

  function dispatchResult(res, grant) {
    fishing.result = res;
    if (grant && ctx.rewards && typeof ctx.rewards.grant === 'function') {
      try { ctx.rewards.grant(res); } catch (e) { if (typeof console !== 'undefined') console.error('[fishing] rewards.grant 出错', e); }
    }
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('pet:minigame-finished', { detail: res }));
  }

  function finishLeave(force) {
    if (!fishing.active) return;
    const mover = brain.mover;
    if (force && mover) { mover.clearGoal(); mover.place(out.x, out.z, heading + Math.PI); }
    dog.tailDrop = 0; dog.tailTug = 0; dog.tailLift = 0; dog.earPerk = 0; dog.lookAt(null);
    if (brain.mode === 'game') brain.exitGame();
    fishing.active = false; fishing.ending = false; fishing.view = null;
    if (island.pondLife && island.pondLife.setHidden) { try { island.pondLife.setHidden(false); } catch (_) { /* ignore */ } }
    setPhase('idle');
    clearLoot();
    if (fx) fx.clear();
    if (pondCtl) pondCtl.setLure(null);
    document.documentElement.dataset.petNoDrag = '';
    const el = canvas(); if (el) el.style.cursor = cursorSaved;
    if (fishing.shelfItem) fishing.shelfItem.update(0.5, true);
    if (hooks.onFishStop) hooks.onFishStop();
  }

  let leaveGo = false;
  function setPhase(p) { ph = p; fishing.phase = p; phT = 0; if (p === 'leave') leaveGo = false; }

  // ------------------------------------------------------------------ 小狗的控制器（brain.enterGame 接管期间每帧调用）
  const controller = {
    get state() { return ph + (ph === 'play' && fishing.sim ? ':' + fishing.sim.phase : ''); },
    enter() {},
    exit() { dog.tailDrop = 0; dog.tailTug = 0; dog.tailLift = 0; dog.earPerk = 0; dog.lookAt(null); },
    onNeedKennel(why) {
      if (!fishing.active || fishing.ending) return;
      if (hud) hud.toast(why === 'rain' ? '下雨啦，先回去躲雨吧' : '夜深了，小柴困啦');
      stop(true);
    },
    update(dt, S) { ctlUpdate(dt, S); },
  };

  function lookCamera() { dog.lookAt(ctx.camera.position); }

  function ctlUpdate(dt, S) {
    T += dt; phT += dt;
    const mover = S.mover;
    switch (ph) {
      case 'approach': {
        dog.setAction(mover.gait() || 'idle');
        S.look(null);
        // 先正常寻路到障碍圆外，再用脚本化直线段走到水边（水边在池塘的障碍圆内）
        if (!mover.hasGoal) {
          if (Math.hypot(mover.x - out.x, mover.z - out.z) > 0.9 && phT < 40 && !mover.blocked) mover.goTo(out.x, out.z, { arriveR: 0.22 });
          else {
            if (Math.hypot(mover.x - out.x, mover.z - out.z) > 1.6) mover.place(out.x, out.z, Math.atan2(-dirX, -dirZ)); // 路上被挡住太久：直接站到外圈
            mover.goStraight(spot.x, spot.z, { free: true, speed: 0.85, arriveR: 0.06 });
            setPhase('walkin');
          }
        }
        break;
      }
      case 'walkin': {
        dog.setAction(mover.gait() || 'idle');
        if (!mover.hasGoal || phT > 8) {
          if (phT > 8) mover.place(spot.x, spot.z, heading + Math.PI);
          mover.face(heading);
          setPhase('face');
          if (hud) hud.hint('小柴转过身，背对池塘坐下…');
        }
        break;
      }
      case 'face': {
        dog.setAction(mover.gait() || 'idle');
        if (mover.headingError(heading) < 0.12 || phT > 4) { dog.setAction('sit', { fade: 0.35 }); setPhase('sit'); sitT = 0; }
        break;
      }
      case 'sit': {
        mover.face(heading);
        dog.setAction('sit', { fade: 0.3 });
        sitT += dt;
        if (sitT > 0.35) dog.tailDrop = 1;
        lookCamera();
        if (sitT >= SIT_WAIT) {
          setPhase('play');
          newSim();
        }
        break;
      }
      case 'play': playUpdate(dt, S); break;
      case 'over': {
        mover.face(heading);
        resultT += dt;
        break;
      }
      case 'leave': {
        dog.tailDrop = 0; dog.tailTug = 0; dog.tailLift = 0; dog.earPerk = 0;
        dog.lookAt(null);
        mover.spinRate = 0;
        // 还没走到水边（比如刚开始走就退出）：小狗在正常的可行走位置上，直接交还给自主行为
        if (!leaveGo && Math.hypot(mover.x - spot.x, mover.z - spot.z) > 1.8) { finishLeave(false); break; }
        if (!leaveGo) {
          dog.setAction('idle', { fade: 0.25 });
          if (phT < 0.8) break;
          leaveGo = true;
          mover.clearGoal();
          mover.goStraight(out.x, out.z, { free: true, speed: 1.05, arriveR: 0.15 });
        }
        dog.setAction(mover.gait() || 'idle');
        if (!mover.hasGoal || phT > 7) finishLeave(phT > 7);
        break;
      }
      default: break;
    }
  }

  // ------------------------------------------------------------------ 一局进行中
  function readInput(sim, dt) {
    let click = inp.click, hold = inp.hold;
    inp.click = false;
    if (fishing.autoplay && !click && !hold) { // 自动驾驶（调试）：没有真实输入时由机器人操控
      const c = fishing.autoplay(sim, dt);
      click = c.click; hold = c.hold;
    }
    if (paused || resultDone) { click = false; }
    return { click, hold };
  }
  const simIn = { click: false, hold: false };

  function playUpdate(dt, S) {
    const sim = fishing.sim;
    if (!sim) return;
    const mover = S.mover;
    if (!paused) {
      const i = readInput(sim, dt);
      simIn.click = i.click; simIn.hold = i.hold;
      if (!sim.finished) sim.update(dt, simIn);
    } else inp.click = false;
    // ---- 事件
    for (let i = 0; i < sim.events.length; i++) onEvent(sim.events[i], sim);
    sim.clearEvents();
    // ---- 小狗
    dogFrame(dt, sim, mover);
    if (sim.finished && !resultDone && !land && !prank) finishGame(sim);
    if (resultDone) { mover.face(heading); }
  }

  function finishGame(sim) {
    resultDone = true;
    const res = sim.result(false);
    dispatchResult(res, true);
    setPhase('over');
    resultT = 0;
    dog.tailDrop = 0; dog.tailTug = 0; dog.tailLift = 0; dog.earPerk = 0;
    dog.setAction(res.stars >= 2 ? 'spin' : 'idle', { fade: 0.25 });
    if (pondCtl) pondCtl.setLure(null);
    clearLoot();
    if (hud) hud.hint(null);
    fishing.result = res;
    // 结算面板由 update() 里按 resultT 弹出（让小狗先站起来高兴一下）
  }

  // ------------------------------------------------------------------ sim 事件 → 表现
  function onEvent(e, sim) {
    switch (e.type) {
      case 'cast': {
        clearLoot();
        land = null;
        if (hud) { hud.hideCard(true); }
        if (pondCtl) pondCtl.setLure(null);
        break;
      }
      case 'fake': fakeT = 0.5; if (pondCtl && tailInWater) { pondCtl.strike(); } if (fx && tailInWater) { fx.ripple(contact.x, contact.z, 0.14, 0, 0.5, 0.9); } break;
      case 'bite': {
        biteT = 0;
        if (pondCtl) pondCtl.strike();
        if (fx) { fx.ripple(contact.x, contact.z, 0.42, 0, 0.8, 1.2); fx.ripple(contact.x, contact.z, 0.3, 0.12, 0.6, 1.1); fx.splash(contact.x, WATER_Y, contact.z, 12, 1.7); }
        break;
      }
      case 'hook': {
        hookPt.copy(contact).addScaledVector(tmp.set(P.x - contact.x, 0, P.z - contact.z).normalize(), 0.28);
        spawnLoot(sim.prank ? 'goldfish' : sim.loot.id, sim.prank);
        if (pondCtl) { pondCtl.release(); pondCtl.scatter(3); }
        if (fx) { fx.ripple(contact.x, contact.z, 0.5, 0, 0.8, 1.1); fx.splash(contact.x, WATER_Y, contact.z, 14, 1.9); }
        if (hud) { hud.bang(false); hud.hint(null); }
        break;
      }
      case 'struggle': if (fx) { fx.ripple(hookPt.x, hookPt.z, 0.36, 0, 0.7, 0.9); fx.splash(hookPt.x, WATER_Y, hookPt.z, 7, 1.3); } break;
      case 'scared': missReason = 'scared'; if (pondCtl) pondCtl.scatter(2.5); if (fx) fx.splash(contact.x, WATER_Y, contact.z, 8, 1.2); markCast(sim, false); break;
      case 'late': missReason = 'late'; if (pondCtl) { pondCtl.release(); pondCtl.scatter(2.5); } markCast(sim, false); break;
      case 'timeout': missReason = 'timeout'; escapeLoot(); markCast(sim, false); break;
      case 'pain': {
        missReason = 'pain';
        escapeLoot();
        dog.setAction('flinch');
        if (hud) { hud.banner('嗷！'); hud.flashRed(); }
        markCast(sim, false);
        break;
      }
      case 'land': startLand(e, sim); markCast(sim, true); break;
      case 'prank': startPrank(sim); markCast(sim, false); break;
      case 'castEnd': break;
      default: break;
    }
  }
  function markCast(sim, ok) { caughtRes[sim.cast] = ok ? 'ok' : 'no'; }

  // ------------------------------------------------------------------ 战利品对象
  function spawnLoot(id, big) {
    clearLoot();
    const o = kit.make(id);
    const hang = hangSpec(o, id); // 要在缩放 / 摆放之前量
    if (o.extra && o.extra.fish) o.extra.fish.viewer = ctx.camera.position;
    if (big) { // 大鱼：一团巨大的深色影子
      o.group.traverse((m) => { if (m.isMesh) m.material = bigMat(); });
      o.group.scale.setScalar(3.2);
    } else o.group.scale.setScalar(SIZE[id] || 1);
    o.group.position.set(hookPt.x, WATER_Y - 0.11, hookPt.z);
    o.group.rotation.set(0, Math.atan2(contact.x - hookPt.x, contact.z - hookPt.z) + 1.2, 0);
    ctx.scene.add(o.group);
    lootCur = { o, id, big: !!big, base: o.group.scale.x, hid: false, hang };
    if (id === 'goldfish' || id === 'koi' || id === 'loach') o.setState('swim');
  }
  /** 这样东西挂在尾巴上时：grip = 被夹 / 咬住的那一点，center = 重心（都在它自己的坐标里），face = 朝向镜头的那一面，back = 夹在离尾巴梢多远的地方 */
  function hangSpec(o, id) {
    const H = { grip: new THREE.Vector3(), center: new THREE.Vector3(), face: new THREE.Vector3(0, 0, 1), back: 0 };
    const f = o.extra && o.extra.fish;
    if (f) { H.grip.copy(f.mouth); H.center.copy(f.center); H.face.set(1, 0, 0); H.back = 0.2; return H; } // 鱼：嘴咬着尾巴梢，身子垂下来
    if (id === 'crab' && kit.usingPondlife.crab) { H.grip.set(0.106, 0.192, 0.218); H.center.set(0, 0.06, 0); H.face.set(0, 1, 0); H.back = 0.32; return H; } // 螃蟹：举起的那只大钳的两指之间
    const box = new THREE.Box3().setFromObject(o.group), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    H.center.copy(c); H.grip.copy(c);
    switch (GRIP[id] || 'top') {
      case 'base': H.grip.y = box.min.y; break;
      case 'side': H.grip.x = box.max.x; H.face.set(0, 1, 0); break;
      case 'front': H.grip.z = box.max.z; H.face.set(0, 1, 0); H.back = 0.25; break;
      case 'end': if (sz.x >= sz.y && sz.x >= sz.z) H.grip.x = box.max.x; else if (sz.z >= sz.y) H.grip.z = box.max.z; else H.grip.y = box.max.y; break;
      default: H.grip.y = box.max.y; break;
    }
    return H;
  }
  /** 挂在尾巴梢上的位置和朝向：重心垂在夹住的那一点正下方，像钟摆一样晃（amp = 晃动幅度，弧度） */
  function hangPose(H, sc, time, amp, outPos, outQ) {
    _hd.copy(H.center).sub(H.grip);
    if (_hd.lengthSq() < 1e-8) outQ.identity(); else outQ.setFromUnitVectors(_hd.normalize(), DOWN);
    _hf.copy(H.face).applyQuaternion(outQ);
    const yaw = Math.hypot(_hf.x, _hf.z) > 0.2 ? Math.atan2(ctx.camera.position.x - tail[6].x, ctx.camera.position.z - tail[6].z) - Math.atan2(_hf.x, _hf.z) : 0;
    outQ.premultiply(_hq.setFromAxisAngle(YAX, yaw + 0.3 * Math.sin(time * 2.7)));
    outQ.premultiply(_hq.setFromAxisAngle(ZAX, amp * Math.sin(time * 8.5)));
    outQ.premultiply(_hq.setFromAxisAngle(XAX, amp * 0.6 * Math.sin(time * 6.3 + 1)));
    _hp.copy(tail[6]).lerp(tail[5], H.back);
    _hd.copy(H.grip).multiplyScalar(sc).applyQuaternion(outQ);
    outPos.copy(_hp).sub(_hd);
  }
  let _bigMat = null;
  function bigMat() { return _bigMat || (_bigMat = new THREE.MeshBasicMaterial({ color: 0x2c4a63, transparent: true, opacity: 0.7, depthWrite: false })); }
  function clearLoot() {
    if (lootCur) { lootCur.o.group.removeFromParent(); lootCur = null; }
  }
  function escapeLoot() {
    // 东西挣脱跑了：水花 + 影子沉下去
    if (fx && lootCur) { fx.splash(hookPt.x, WATER_Y, hookPt.z, 12, 1.8); fx.ripple(hookPt.x, hookPt.z, 0.5, 0, 0.8, 1.2); }
    clearLoot();
    if (pondCtl) pondCtl.scatter(2.5);
  }

  // ------------------------------------------------------------------ 出水：飞出来 + 小卡片 + 小狗的反应
  function startLand(e, sim) {
    const def = LOOT_BY_ID[e.loot.id];
    const o = lootCur && lootCur.id === e.loot.id ? lootCur.o : (spawnLoot(e.loot.id, false), lootCur.o);
    const kind = def.react;
    land = { id: e.loot.id, def, o, kind, t: 0, note: e.note || null, stage: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), flown: false, vanish: 0, noteShown: false, noteClosed: false, noteClosedAt: 0, squash: 0, spun: 0, w: 0 };
    // 存档：图鉴、今天的漂流瓶、看过的寄语
    try {
      store.recordCatch(e.loot.id, today);
      if (e.loot.id === 'bottle') { store.markBottle(today); if (e.note) store.markSeen(e.note.id); }
    } catch (_) { /* ignore */ }
    land.a.copy(lootCur.o.group.position);
    land.a0 = lootCur.o.group.position.clone(); land.q0 = lootCur.o.group.quaternion.clone(); land.hang = lootCur.hang;
    if (fx) { fx.ripple(hookPt.x, hookPt.z, 0.55, 0, 0.85, 1.2); fx.ripple(hookPt.x, hookPt.z, 0.35, 0.15, 0.6, 1.1); fx.splash(hookPt.x, WATER_Y, hookPt.z, 16, 2.2); }
    if (pondCtl) pondCtl.scatter(2.8);
    if (hud) { hud.setScore(sim.score); }
    land.cardAt = kind === 'shake' || kind === 'crab' ? 0.35 : kind === 'frog' ? 0.9 : 0.85;
    land.cardOn = false;
  }

  function arc(o, a, b, u, peak) { o.lerpVectors(a, b, u); o.y += peak * 4 * u * (1 - u); }

  function groundAt(v) { v.y = island.heightAt(v.x, v.z); return v; }

  /** 出水反应脚本：t = 出水后的时间。返回时小狗 / 东西的状态已写好。 */
  function landUpdate(dt, sim, mover) {
    const R = land;
    R.t += dt;
    const g = R.o.group, sc = SIZE[R.id] || 1;
    // 第一段（钓到什么都一样）：东西挂在尾巴梢上，尾巴抬起来把它提出水面；之后尾巴一甩，才轮到各自的反应。
    const t = R.t - LIFT_T; // 下面各脚本的时间都从“甩出去”那一刻算起
    if (t < 0) { liftUpdate(R, g, sc, mover); R.o.update(dt); return; }
    if (!R.rel) {
      R.rel = true; R.a.copy(g.position); R.qa = g.quaternion.clone();
      if (R.kind !== 'shake' && R.kind !== 'crab') { dog.tailDrop = 0; dog.tailLift = 0; if (fx) fx.splash(g.position.x, g.position.y, g.position.z, 7, 1.3); } // 水草 / 螃蟹还赖在尾巴上，要站起来甩
    }
    const sit = () => { dog.setAction('sit', { fade: 0.3 }); mover.face(heading); };
    const stand = () => { dog.tailDrop = 0; };
    dogLook(landPt, 0.25);
    // 卡片
    if (!R.cardOn && t >= R.cardAt) {
      R.cardOn = true;
      const r = RARITY[R.def.rarity];
      if (hud) hud.card(R.def, r.label, R.def.line, r.points);
    }
    const endAt = (R.def.landDur || FISH.LAND_DUR);
    if (hud && R.cardOn && !R.cardOut && t > endAt - 0.45 && !(R.kind === 'bottle')) { R.cardOut = true; hud.hideCard(); }
    // 通用：离水飞行
    const flight = (to, t0, dur, peak, spin) => {
      const u = clamp((t - t0) / dur, 0, 1);
      if (u <= 0) return 0;
      arc(g.position, R.a, to, u, peak);
      g.quaternion.slerpQuaternions(R.qa, QID, u).multiply(qTmp.setFromAxisAngle(XAX, spin * u)); // 从挂着的姿态翻着跟头转正
      if (u >= 1 && !R.landed) { R.landed = true; R.squash = 1; fxLand(to); }
      return u;
    };
    const fxLand = () => {};
    switch (R.kind) {
      case 'look': case 'sniff': case 'pearl': case 'happy': case 'bottle': {
        const dur = 0.85;
        if (R.stage === 0) {
          R.b.copy(landPt);
          if (R.kind === 'sniff' && R.id === 'loach') { R.b.x += perpX * 0.15; R.b.z += perpZ * 0.15; groundAt(R.b); }
          const u = flight(R.b, 0, dur, 0.95, Math.PI * 2);
          g.visible = true;
          if (u >= 1) {
            R.stage = 1; g.position.copy(R.b);
            // 珍珠河蚌：壳口朝向镜头，打开时才看得见里面的珍珠
            const yaw = R.kind === 'pearl' ? Math.atan2(ctx.camera.position.x - R.b.x, ctx.camera.position.z - R.b.z) : (R.id.charCodeAt(0) % 7) * 0.8 + heading;
            g.rotation.set(0, yaw, 0);
          }
        }
        if (R.stage >= 1) {
          R.squash = Math.max(0, R.squash - dt * 3);
          const bounce = t < 1.25 ? 0.12 * Math.max(0, Math.sin((t - 0.85) / 0.25 * Math.PI)) : 0;
          g.position.set(R.b.x, R.b.y + bounce, R.b.z);
          g.scale.set(sc * (1 + 0.18 * R.squash), sc * (1 - 0.2 * R.squash), sc * (1 + 0.18 * R.squash));
          if (R.o.state !== 'flop' && (R.def.live || R.id === 'loach') && R.stage === 1) R.o.setState('flop');
        }
        // 小狗：坐着看它
        if (R.kind === 'happy') {
          if (t > 0.5 && t < 2.6) {
            stand(); mover.spinRate = t > 0.95 && t < 2.2 ? 10.5 : 0; dog.setAction(t > 0.95 && t < 2.2 ? 'spin' : 'idle', { fade: 0.15 });
            dog.bliss = 1; dog.lookAt(null);
          } else if (t >= 2.6) { mover.spinRate = 0; dog.bliss = 0; mover.face(heading); if (mover.headingError(heading) < 0.3) { dog.setAction('sit', { fade: 0.3 }); } else dog.setAction(mover.gait() || 'idle'); if (t > 3.0) dog.tailDrop = 1; }
          else sit();
        } else if (R.kind === 'sniff') {
          sit();
          dog.bliss = 0;
        } else sit();
        if (R.kind === 'pearl') {
          const open = ease((t - 1.15) / 0.5);
          if (R.o.setOpen) R.o.setOpen(open);
          if (!R.sparked && t > 1.2) { R.sparked = true; if (fx) fx.splash(R.b.x, R.b.y + 0.1, R.b.z, 18, 1.6, 0.6, 0xfff0a8); }
          if (t > 2.4 && !R.sparked2) { R.sparked2 = true; if (fx) fx.splash(R.b.x, R.b.y + 0.1, R.b.z, 12, 1.3, 0.6, 0xfff0a8); }
        }
        // 活物（金鱼、锦鲤）：扑腾一阵，跳回水里
        if (R.def.live && R.id !== 'loach') {
          const back = R.id === 'koi' ? 2.9 : 2.5;
          if (t >= back) {
            R.w = R.w || 1;
            if (!R.back) { R.back = true; R.a.copy(g.position); R.b2 = hookPt.clone().setY(WATER_Y - 0.05); R.o.setState('swim'); }
            const u = clamp((t - back) / 0.8, 0, 1);
            arc(g.position, R.a, R.b2, u, 0.7);
            g.rotation.z = Math.sin(u * Math.PI) * 0.6;
            if (u >= 1 && !R.gone) { R.gone = true; g.visible = false; if (fx) { fx.ripple(R.b2.x, R.b2.z, 0.45, 0, 0.8, 1.2); fx.splash(R.b2.x, WATER_Y, R.b2.z, 12, 1.8); } }
          }
        } else if (R.id === 'loach') {
          // 泥鳅：从爪子下滑溜地溜回水里
          const t0 = 2.0, d = 1.2;
          if (t >= t0 && !R.gone) {
            if (!R.back) { R.back = true; R.a.copy(g.position); R.b2 = hookPt.clone(); R.b2.y = WATER_Y - 0.05; R.o.setState('slide'); }
            const u = clamp((t - t0) / d, 0, 1);
            g.position.lerpVectors(R.a, R.b2, u * u * 0.4 + u * 0.6); // 先慢后快
            g.position.y = Math.max(island.heightAt(g.position.x, g.position.z), WATER_Y - 0.06) + 0.0;
            g.rotation.y = Math.atan2(R.b2.x - R.a.x, R.b2.z - R.a.z) + Math.PI;
            if (u >= 1) { R.gone = true; g.visible = false; if (fx) { fx.ripple(R.b2.x, R.b2.z, 0.4, 0, 0.8, 1.2); fx.splash(R.b2.x, WATER_Y, R.b2.z, 10, 1.6); } }
          }
        } else if (R.kind !== 'bottle') {
          // 死物：最后缩小消失
          const tv = endAt - 0.4;
          if (t > tv) { const k = clamp(1 - (t - tv) / 0.35, 0, 1); g.scale.multiplyScalar(k); if (k <= 0) g.visible = false; }
        }
        if (R.kind === 'bottle') bottleUpdate(dt, R, sim, mover, g, sc);
        break;
      }
      case 'shake': { // 水草：缠在尾巴上，小狗站起来甩
        if (R.stage === 0) { R.stage = 1; g.visible = true; }
        if (!R.flown) {
          hangPose(R.hang, sc, R.t, 0.32, g.position, g.quaternion);
          g.scale.setScalar(sc * (1.0 + 0.02 * Math.sin(t * 9)));
          dog.tailDrop = 0.55; dog.tailLift = t < 0.35 ? 0.7 : 0; // 站起来之前尾巴先举着（别让东西又掉回水里），之后尾巴向后伸着，水草挂在梢上甩来甩去
          if (t > 0.3 && t < 1.55) dog.setAction('shake', { fade: 0.1 });
          else if (t >= 1.55 && t < 1.62) dog.setAction('idle', { fade: 0.05 });
          else if (t >= 1.62 && t < 2.5) dog.setAction('shake', { fade: 0.05 });
          if (t >= 2.15) { R.flown = true; R.a.copy(g.position); R.fly = 0; dog.tailDrop = 0; }
        } else {
          R.fly += dt;
          const u = clamp(R.fly / 0.6, 0, 1);
          R.b.copy(landPt).addScaledVector(tmp.set(perpX, 0, perpZ), 0.25); groundAt(R.b);
          arc(g.position, R.a, R.b, u, 0.8);
          g.rotation.set(Math.PI * (1 - u) + 0.0, u * 6, 0);
          if (u >= 1 && R.stage === 1) { R.stage = 2; R.squash = 1; g.rotation.set(0, 1.2, 0); }
          if (R.stage === 2) { R.squash = Math.max(0, R.squash - dt * 3); g.scale.set(sc * (1 + 0.15 * R.squash), sc * (1 - 0.2 * R.squash), sc * (1 + 0.15 * R.squash)); }
          if (t > 2.6) { dog.setAction('sit', { fade: 0.3 }); mover.face(heading); if (t > 2.9) dog.tailDrop = 1; }
          const tv = endAt - 0.4;
          if (t > tv) { const k = clamp(1 - (t - tv) / 0.35, 0, 1); g.scale.multiplyScalar(k); }
        }
        break;
      }
      case 'crab': { // 螃蟹：夹住尾巴，小狗蹦起来转圈甩掉，它被甩到岸上，横着溜回水里
        if (R.stage === 0) { R.stage = 1; g.visible = true; R.o.setState('grip'); }
        if (!R.flown) {
          // 一只大钳夹着尾巴梢不放，整只螃蟹吊在尾巴上晃
          hangPose(R.hang, sc, R.t, 0.4, g.position, g.quaternion);
          g.scale.setScalar(sc);
          dog.tailDrop = 0.55; dog.tailLift = t < 0.35 ? 0.7 : 0;
          if (t > 0.2) { dog.setAction('spin', { fade: 0.1 }); dog.bliss = 0.0; mover.spinRate = t > 0.5 ? 9 : 0; }
          if (t >= 2.0) { R.flown = true; R.a.copy(g.position); R.fly = 0; mover.spinRate = 0; R.o.setState('idle'); dog.tailDrop = 0; }
        } else {
          R.fly += dt;
          const u = clamp(R.fly / 0.65, 0, 1);
          R.b.copy(landPt).addScaledVector(tmp.set(perpX, 0, perpZ), 0.2); groundAt(R.b);
          if (u < 1) { arc(g.position, R.a, R.b, u, 0.9); g.rotation.set(0, R.fly * 9, 0); }
          else {
            if (R.stage === 1) { R.stage = 2; R.squash = 1; R.o.setState('walk'); R.walkA = R.b.clone(); }
            R.squash = Math.max(0, R.squash - dt * 3);
            // 横着溜回水里（2.9 秒后开始）
            const tw = clamp((t - 2.95) / 1.1, 0, 1);
            R.b2 = R.b2 || hookPt.clone().setY(WATER_Y - 0.05);
            g.position.lerpVectors(R.walkA, R.b2, tw);
            g.position.y = Math.max(island.heightAt(g.position.x, g.position.z), WATER_Y - 0.05);
            g.rotation.set(0, Math.atan2(R.b2.x - R.walkA.x, R.b2.z - R.walkA.z) + Math.PI / 2, 0);
            g.scale.set(sc * (1 + 0.15 * R.squash), sc * (1 - 0.2 * R.squash), sc * (1 + 0.15 * R.squash));
            if (tw >= 1 && !R.gone) { R.gone = true; g.visible = false; if (fx) { fx.ripple(R.b2.x, R.b2.z, 0.35, 0, 0.8, 1.1); fx.splash(R.b2.x, WATER_Y, R.b2.z, 8, 1.4); } }
          }
          if (t > 2.2) { mover.spinRate = 0; dog.setAction('sit', { fade: 0.3 }); mover.face(heading); if (t > 2.6) dog.tailDrop = 1; }
        }
        break;
      }
      case 'frog': { // 青蛙：跳到小狗头上蹲一会儿，再跳回水里
        sit();
        if (R.stage === 0) { R.stage = 1; g.visible = true; R.o.setState('held'); }
        dog.rig.head.getWorldPosition(headPt);
        const onHead = a3.set(headPt.x, headPt.y + 0.17 * dog.group.scale.x, headPt.z);
        if (t < 0.85) {
          const u = t / 0.85;
          arc(g.position, R.a, onHead, ease(u) * 0 + u, 0.8);
          g.rotation.set(0, Math.atan2(onHead.x - R.a.x, onHead.z - R.a.z), 0);
          if (u > 0.95) R.o.setState('sit');
        } else if (t < 2.9) {
          g.position.copy(onHead);
          g.rotation.y = heading + Math.PI * 0.5 + 0.5;
          R.o.setState(t > 1.2 && t < 2.5 ? 'croak' : 'sit');
          dog.lookAt(null);
          if (!R.frogR) { R.frogR = true; }
        } else {
          if (!R.back) { R.back = true; R.a.copy(onHead); R.b2 = hookPt.clone().setY(WATER_Y - 0.04); R.o.setState('jump'); }
          const u = clamp((t - 2.9) / 0.8, 0, 1);
          arc(g.position, R.a, R.b2, u, 0.9);
          g.rotation.y = Math.atan2(R.b2.x - R.a.x, R.b2.z - R.a.z);
          if (u >= 1 && !R.gone) { R.gone = true; g.visible = false; if (fx) { fx.ripple(R.b2.x, R.b2.z, 0.4, 0, 0.8, 1.2); fx.splash(R.b2.x, WATER_Y, R.b2.z, 12, 1.8); } }
        }
        break;
      }
      default: break;
    }
    R.o.update(dt);
  }

  /** 出水的第一段：东西从水下凑到尾巴梢上挂住，尾巴抬到水平把它提出水面，甩之前往下一沉蓄力 */
  function liftUpdate(R, g, sc, mover) {
    const tl = R.t;
    if (!R.liftInit) { R.liftInit = true; g.visible = true; if (R.id === 'crab') R.o.setState('grip'); else if (R.id === 'frog') R.o.setState('held'); }
    dog.setAction('sit', { fade: 0.3 }); mover.face(heading);
    dog.tailDrop = 1; dog.tailLift = tl < LIFT_T - 0.15 ? 0.7 : 1; // 尾巴绷直了扬起来，把东西吊出水面；最后猛地一扬把它甩出去
    dog.earPerk = 1; dog.lookAt(tail[6]);
    hangPose(R.hang, sc, tl, 0.3, hangP, hangQ);
    const w = ease(tl / 0.18);
    g.position.lerpVectors(R.a0, hangP, w); g.quaternion.slerpQuaternions(R.q0, hangQ, w);
    g.scale.setScalar(sc);
    if (!R.outW && g.position.y > WATER_Y - 0.02 && tl > 0.12) { // 出水的那一下
      R.outW = true;
      if (fx) { fx.splash(g.position.x, WATER_Y, g.position.z, 16, 2.1); fx.ripple(g.position.x, g.position.z, 0.5, 0, 0.85, 1.2); }
    }
    if (R.outW && fx && ((tl * 9) % 1) < 0.34) fx.splash(g.position.x, g.position.y, g.position.z, 1, 0.5); // 往下滴水
  }

  function bottleUpdate(dt, R, sim, mover, g, sc) {
    const t = R.t - LIFT_T;
    dog.lookAt(R.stage >= 1 ? g.position : landPt);
    // 小狗用鼻子把瓶子拱到镜头前（瓶子贴地滑向镜头、越来越近越来越大）
    toCam.set(ctx.camera.position.x - R.b.x, 0, ctx.camera.position.z - R.b.z).normalize();
    if (t > 1.0 && !R.noteShown) {
      const u = ease((t - 1.0) / 1.4);
      g.position.set(R.b.x + toCam.x * 1.35 * u, R.b.y + 0.4 * u + 0.1 * Math.sin(u * Math.PI), R.b.z + toCam.z * 1.35 * u);
      g.rotation.set(0.0, g.rotation.y, 1.2 * (1 - u) + 0.15 * Math.sin(t * 5) * (1 - u));
      const s2 = sc * (1 + 0.9 * u);
      g.scale.setScalar(s2);
      if (u >= 1 && !R.noteShown) {
        R.noteShown = true; R.noteT = 0;
        if (hud) { hud.hideCard(true); R.cardOut = true; }
      }
    }
    if (R.noteShown && !R.noteClosed) {
      R.noteT += dt;
      if (R.o.setCork) R.o.setCork(clamp(R.noteT / 0.4, 0, 2));
      g.position.y += 0.015 * Math.sin(t * 3) * dt * 6;
      if (R.noteT > 0.55 && !R.noteOpened) {
        R.noteOpened = true;
        paused = true;
        if (hud) hud.note(R.note, () => { R.noteClosed = true; R.noteClosedAt = R.t - LIFT_T; paused = false; });
      }
    }
    if (R.noteClosed) {
      const k = clamp(1 - (t - R.noteClosedAt) / 0.4, 0, 1);
      g.scale.setScalar(sc * 1.9 * k);
      if (k <= 0) g.visible = false;
    }
  }

  // ------------------------------------------------------------------ 大鱼反拉：小狗被拽进池塘，爬上岸甩水
  function startPrank(sim) {
    prank = { t: 0, stage: 0, a: new THREE.Vector3() };
    dog.setAction('flinch');
    if (hud) { hud.bang(false); hud.hint(null); hud.fight(null); }
    if (pondCtl) pondCtl.scatter(4);
  }
  function prankUpdate(dt, mover) {
    const R = prank;
    R.t += dt;
    const t = R.t;
    const g = dog.group;
    dog.tailDrop = t < 1.0 ? 1 : 0; dog.tailTug = t < 0.8 ? 1 : 0; dog.earPerk = 0;
    if (t < 1.05) {
      // 被一把拽进水里：沿“远离池心”的反方向滑向池心
      // （位置由 update() 在 brain / mover 写完之后叠加：mover.apply 每帧都会把狗放回 mover.x/z）
      const u = ease(t / 0.55);
      const off = 1.15 * u;
      R.vis = true; R.px = spot.x - dirX * off; R.pz = spot.z - dirZ * off; R.tilt = -0.45 * Math.sin(Math.min(1, t / 0.5) * Math.PI * 0.5);
      g.position.x = R.px; g.position.z = R.pz;
      if (t > 0.5 && R.stage === 0) {
        R.stage = 1;
        if (fx) { fx.ripple(g.position.x, g.position.z, 0.9, 0, 0.9, 1.3); fx.ripple(g.position.x, g.position.z, 0.6, 0.15, 0.7, 1.2); fx.splash(g.position.x, WATER_Y, g.position.z, 30, 2.6, 1.4); }
        if (hud) { hud.banner('扑通！'); }
      }
      if (t > 0.7 && t < 0.85 && fx && R.stage === 1) { R.stage = 2; fx.splash(g.position.x, WATER_Y, g.position.z, 20, 2.2, 1.2); }
    } else if (R.stage < 3) {
      R.vis = false;
      // 站起来、爬回岸上：把 mover 放到池里，走直线回水边
      R.stage = 3;
      mover.clearGoal();
      mover.place(spot.x - dirX * 1.15, spot.z - dirZ * 1.15, heading);
      mover.goStraight(spot.x, spot.z, { free: true, speed: 0.95, arriveR: 0.06 });
      dog.setAction('walk', { fade: 0.2 });
    }
    if (R.stage === 3) {
      dog.setAction(mover.gait() || 'idle');
      if (Math.random() < dt * 8 && fx) { fx.splash(g.position.x, WATER_Y + 0.1, g.position.z, 2, 0.8, 0.8); }
      if (!mover.hasGoal || t > 3.3) { R.stage = 4; R.t4 = t; dog.setAction('shake', { fade: 0.1 }); if (fx) fx.splash(g.position.x, g.position.y + 0.3, g.position.z, 24, 2.0, 2.4); }
    }
    if (R.stage === 4) {
      mover.face(heading);
      if (t - R.t4 > 0.35 && !R.sp2) { R.sp2 = true; if (fx) fx.splash(g.position.x, g.position.y + 0.3, g.position.z, 22, 2.0, 2.4); }
      if (t - R.t4 > 1.3) { R.stage = 5; dog.setAction('sit', { fade: 0.3 }); }
    }
    if (R.stage === 5) { mover.face(heading); if (t - R.t4 > 1.7) dog.tailDrop = 1; }
    if (hud && R.stage === 4 && !R.hinted) { R.hinted = true; hud.hint('小柴一脸委屈地甩着水…'); }
  }

  // ------------------------------------------------------------------ 小狗每帧的表现（按 sim 阶段）
  function dogLook(target, w) { /* 看向某处 */ dog.lookAt(target); }

  function dogFrame(dt, sim, mover) {
    const phz = sim.phase;
    let tug = 0, perk = 0, tailDrop = 1;
    mover.face(heading);
    if (land || prank) {
      // 出水反应 / 大鱼反拉：由各自的脚本控制
      tailDrop = dog.tailDrop; // 脚本里直接写
      dog.earPerk = 0;
      dog.tailTug = 0;
      if (prank) { prankUpdate(dt, mover); if (phz !== 'prank' && prank.stage >= 5) { prank = null; } }
      if (land) {
        if (phz !== 'land') { land = null; } else landUpdate(dt, sim, mover);
      }
      if (phz !== 'land' && phz !== 'prank') { land = null; prank = null; }
      if (!land && !prank) { dog.bliss = 0; mover.spinRate = 0; }
      return;
    }
    dog.bliss = 0; dog.tailLift = 0;
    mover.spinRate = 0;
    switch (phz) {
      case 'cast': tug = -0.5; lookCamera(); dog.setAction('sit', { fade: 0.3 }); break;
      case 'wait': {
        fakeT = Math.max(0, fakeT - dt);
        tug = sim.fake ? 0.45 + 0.25 * Math.sin(T * 40) : 0;
        if (sim.fake) { dog.lookAt(contact); perk = 0.4; } else lookCamera();
        dog.setAction('sit', { fade: 0.3 });
        break;
      }
      case 'bite': tug = 1; perk = 1; dog.lookAt(contact); dog.setAction('sit', { fade: 0.3 }); break;
      case 'fight': {
        tug = sim.struggle ? 0.95 : sim.warn ? 0.55 : 0.3;
        perk = 1 - 0.6 * sim.pain; dog.lookAt(contact);
        dog.setAction('sit', { fade: 0.3 });
        break;
      }
      case 'miss': {
        missT += dt;
        if (missReason === 'pain') { if (dog.action === 'flinch' && dog.actionTime > 0.45) dog.setAction('sit', { fade: 0.25 }); tug = -0.2; perk = 0; }
        else { dog.setAction('sit', { fade: 0.3 }); perk = missReason === 'late' ? 0 : 0.3; }
        if (missReason === 'late') dog.lookAt(contact); else lookCamera();
        break;
      }
      default: break;
    }
    dog.tailDrop = tailDrop;
    dog.tailTug = tug;
    dog.earPerk = perk;
  }

  // ------------------------------------------------------------------ 表现（每帧，在岛的模拟之后）
  const rootScale = () => dog.group.scale.x * (dog.rig && dog.rig.root ? dog.rig.root.scale.x : 1);
  function trackTail() {
    dog.group.updateMatrixWorld(true);
    const tl = dog.rig.tail;
    for (let i = 0; i < 6; i++) tl[i].getWorldPosition(tail[i]);
    tmp.copy(tail[5]).sub(tail[4]);
    const len = tmp.length();
    if (len > 1e-6) tmp.multiplyScalar(1 / len); else tmp.set(0, -1, 0);
    tail[6].copy(tail[5]).addScaledVector(tmp, 0.075 * rootScale());
    // 尾巴穿过水面的位置
    tailInWater = false;
    for (let i = 0; i < 6; i++) {
      const y0 = tail[i].y, y1 = tail[i + 1].y;
      if (y0 >= WATER_Y && y1 < WATER_Y) {
        const u = (y0 - WATER_Y) / Math.max(1e-6, y0 - y1);
        contact.lerpVectors(tail[i], tail[i + 1], u);
        tailInWater = true;
        break;
      }
    }
    if (!tailInWater) {
      // 尾巴够不着水面：假想的鱼线从尾巴末端垂下，落在水面上的位置
      contact.copy(tail[6]); contact.y = WATER_Y;
    }
  }

  function update(dt) {
    if (fishing.shelfItem) fishing.shelfItem.update(dt, !fishing.active);
    if (!fishing.active) return;
    dt = clamp(dt, 0, 0.1);
    // 安全网：小狗不在 game 模式了（被外部重置等）→ 立刻收尾，别让界面卡住
    if (brain.mode !== 'game') { if (!fishing.ending) stop(true); finishLeave(false); return; }
    document.documentElement.dataset.petNoDrag = '1'; // 摸摸模块每帧会清掉它，这里再设回去
    const sim = fishing.sim;
    const mover = brain.mover;
    // 大鱼反拉被拽进池塘的那一小段：mover 已经把狗放在钓鱼点了，这里叠加视觉偏移（滑进水里、向后倒）
    if (prank && prank.vis) {
      const g = dog.group;
      g.position.set(prank.px, island.heightAt(prank.px, prank.pz), prank.pz);
      g.rotation.x = prank.tilt;
    }
    trackTail();
    if (fx) fx.update(dt);
    visuals(dt, sim);
    // 结算面板：整局结束、小狗站起来高兴 1.2 秒后弹出
    if (ph === 'over' && resultDone && hud && !hud.resultVisible && resultT > 1.2 && !fishing.ending) {
      hud.showResult(fishing.result, Object.fromEntries(Object.entries(RARITY).map(([k, v]) => [k, v.label])), { onAgain: () => restart(), onExit: () => stop(false) });
    }
    if (hud && fishing.size && (!fishing._m || fishing._m !== 1)) { fishing._m = 1; measure(); }
  }

  function visuals(dt, sim) {
    // 鱼线 + 小浮漂：尾巴末端在水面以上时才画
    if (fx) {
      const inPlay = ph === 'play' || ph === 'sit' || ph === 'over';
      const showLine = inPlay && !tailInWater && dog.tailDrop > 0.6 && !(land && (land.t < LIFT_T + 0.15 || ((land.kind === 'shake' || land.kind === 'crab') && land.t < 2.3 + LIFT_T)));
      if (showLine) {
        a3.copy(tail[6]); b3.set(tail[6].x, WATER_Y - 0.03, tail[6].z);
        fx.setLine(true, a3, b3);
        fx.setFloat(true, b3.x, WATER_Y, b3.z, T, 0);
      } else { fx.setLine(false, a3, b3); fx.setFloat(false); }
    }
    // 引诱点：小金鱼聚到尾巴周围打转
    if (pondCtl && sim && ph === 'play') {
      if (sim.phase === 'wait' || sim.phase === 'bite' || sim.phase === 'cast') {
        lookV.set(contact.x, 0, contact.z);
        const strength = sim.phase === 'cast' ? 0.2 : clamp(0.35 + (sim.t / Math.max(1, sim.wait)) * 0.65, 0.35, 1);
        pondCtl.setLure(lookV, strength);
        if (sim.phase === 'wait' && sim.fake === false && pondCtl.lure.bite && !fakeT) pondCtl.release();
      }
    }
    // 水面：等鱼时偶尔一圈很小的涟漪；拉扯时水花
    if (fx && sim && ph === 'play') {
      if (sim.phase === 'wait' && sim.fake && tailInWater && ((T * 6) % 1) < dt * 6) fx.ripple(contact.x, contact.z, 0.13, 0, 0.55, 0.8);
      if (sim.phase === 'wait' && tailInWater) { if (((T * 0.9) % 1.8) < dt * 0.9) fx.ripple(contact.x, contact.z, 0.12, 0, 0.35, 1.4); }
      if (sim.phase === 'fight' && lootCur && !sim.prank) {
        const o = lootCur.o, g = o.group;
        const s = sim.struggle ? 1 : sim.warn ? 0.4 : 0.15;
        g.position.set(hookPt.x + 0.07 * s * Math.sin(T * 31), WATER_Y - 0.115 + 0.02 * s * Math.sin(T * 23), hookPt.z + 0.07 * s * Math.cos(T * 27));
        g.rotation.y += dt * (1 + 8 * s);
        o.update(dt);
        if (sim.struggle && Math.random() < dt * 6) fx.ripple(hookPt.x, hookPt.z, 0.3, 0, 0.5, 0.9);
      }
      if (sim.phase === 'fight' && sim.prank && lootCur) {
        const g = lootCur.o.group, s = sim.struggle ? 1 : 0.3;
        g.position.set(hookPt.x + 0.1 * s * Math.sin(T * 17), WATER_Y - 0.13, hookPt.z + 0.1 * s * Math.cos(T * 19));
        g.rotation.y = Math.atan2(contact.x - hookPt.x, contact.z - hookPt.z) + 1.6 + 0.3 * Math.sin(T * 5);
        if (sim.struggle && Math.random() < dt * 8) fx.ripple(hookPt.x, hookPt.z, 0.45, 0, 0.6, 1.0);
      }
    }
    // “!”：真咬时头顶冒出来
    if (fx && fx.bang) {
      const on = !!(sim && ph === 'play' && sim.phase === 'bite');
      fx.bang.visible = on;
      if (on) {
        dog.rig.head.getWorldPosition(headPt);
        const k = 1 + 0.25 * Math.sin(T * 22);
        fx.bang.position.set(headPt.x, headPt.y + 0.42 * dog.group.scale.x, headPt.z);
        fx.bang.scale.setScalar(0.62 * k);
      }
    }
    // HUD
    if (!hud || fishing.ending) return;
    if (sim && ph === 'play') {
      hud.setCasts(caughtRes, sim.finished ? -1 : sim.cast);
      hud.setScore(sim.score);
      const f = sim.phase;
      if (f === 'cast') hud.hint('放下尾巴…等鱼来');
      else if (f === 'wait') hud.hint(sim.fake ? '尾巴抖了一下…<b>先别点</b>，是假咬' : '等鱼咬钩…<b>别急着点</b>');
      else if (f === 'bite') hud.hint('<b>咬钩了！快点击提竿！</b>', 'alert');
      else if (f === 'fight') hud.hint(null);
      else if (f === 'miss') hud.hint(missReason === 'scared' ? '鱼被吓跑了…下次别急着点' : missReason === 'late' ? '慢了一步，鱼跑了' : missReason === 'pain' ? '尾巴太疼，小柴松开了！' : '它挣脱跑了…');
      else if (f === 'prank') hud.hint(null);
      else if (f === 'land') hud.hint(null);
      hud.bang(f === 'bite');
      if (f === 'fight' && !sim.prank) hud.fight({ progress: sim.progress, pain: sim.pain, mode: sim.struggle ? 'hold' : sim.warn ? 'warn' : 'pull' });
      else if (f === 'fight' && sim.prank) hud.fight({ progress: sim.progress, pain: 0, mode: sim.struggle ? 'hold' : 'pull' });
      else hud.fight(null);
    }
  }

  // 调试 / 自动测试用：状态快照
  fishing.info = () => ({
    active: fishing.active, ending: fishing.ending, phase: ph, simPhase: fishing.sim ? fishing.sim.phase : null, cast: fishing.sim ? fishing.sim.cast : -1,
    tailInWater, contact: [+contact.x.toFixed(3), +contact.y.toFixed(3), +contact.z.toFixed(3)], tail6: [+tail[6].x.toFixed(3), +tail[6].y.toFixed(3), +tail[6].z.toFixed(3)],
    loot: lootCur ? { id: lootCur.id, vis: lootCur.o.group.visible, parent: !!lootCur.o.group.parent, pos: lootCur.o.group.position.toArray().map((v) => +v.toFixed(2)), sc: +lootCur.o.group.scale.x.toFixed(2) } : null,
    land: land ? { id: land.id, t: +land.t.toFixed(2), kind: land.kind } : null, prank: prank ? { t: +prank.t.toFixed(2), stage: prank.stage } : null,
    spot: [+spot.x.toFixed(3), +spot.z.toFixed(3)], landPt: [+landPt.x.toFixed(3), +landPt.z.toFixed(3)], usingPondlife: kit.usingPondlife, paused,
  });
  /** 调试：钓鱼模块自己占用的 draw call 数（可见的网格 / 点 / 精灵：涟漪圈、飞沫、“!”、鱼线、小浮漂、战利品、架子上的浮漂） */
  fishing.drawCalls = () => {
    let n = 0;
    const count = (o) => { if (!o.visible) return; if (o.isMesh || o.isPoints || o.isSprite || o.isLine) n++; for (const c of o.children) count(c); };
    if (fx) count(fx.group);
    if (lootCur) count(lootCur.o.group);
    if (fishing.shelfItem) count(fishing.shelfItem.mesh);
    return n;
  };
  fishing.geo = { spot, out, landPt };
  fishing.input = inp;
  return fishing;
}

export default createFishing;
