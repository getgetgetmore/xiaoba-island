// 遛狗小游戏（对外入口）：createWalkGame(ctx) → { active, scene, camera, start(), stop(aborted), update(dt), resize(w, h), sim }
// 结构：
//   walkSim.js        纯逻辑（难度、赛道、手→绳→狗的操控模型、握力、碰撞、计分）
//   walkBot.js        机器人（测试 / 调试自动驾驶）
//   walk/world.js     场景：小区公园步道（地面滚动 + 循环复用的路边景物 + 实体对象池 + 特效）
//   walk/leash.js     玩具架上的遛狗绳（入口）、第一人称的手和牵引绳、项圈
//   walk/hud.js       DOM 界面
//   本文件            借还小狗、输入（鼠标 = 手）、相机 / 小狗 / 手 / 绳子的驱动、阶段（倒计时 → 跑 → 结算）、奖励口子
//
// 操控因果链：鼠标 → 手（handX，世界横向位置，±3.4 米）→ 绳子（有松紧）→ 小狗。小狗不再直接跟着鼠标走。
// 奖励口子：结算时构造 result = { game:'walk', completion, stars, tier, avoided, hits, bones, bonesTotal, distance, duration, aborted, maxCombo, slips, tugs }，
//   (a) 调用 ctx.rewards.grant(result)（main.js 里是空实现，预留给奖励机制）；(b) window 上派发 CustomEvent('pet:minigame-finished', { detail: result })。
//   中途退出：只派发事件（aborted: true），不调用 grant。
import * as THREE from 'three';
import { clamp, damp, mulberry32 } from '../core/util.js';
import { createWalkSim, WALK } from './walkSim.js';
import { createAutopilot } from './walkBot.js';
import { createWalkWorld, DOG_Z } from './walk/world.js';
import { createShelfLeash, createLeashRig, createCollar } from './walk/leash.js';
import { createHud } from './walk/hud.js';

const DOG_SCALE = 1.25;
const CD_STEP = 0.9;           // 倒计时每一格的时长
const CD_TOTAL = CD_STEP * 3 + 0.55;
const HINT_MAIN = '<b>移动鼠标</b>=移动手　·　按住<b>左键</b>=收紧绳子　·　<b>快速甩</b>=拽一下　·　<b>Esc</b> 退出';
const HAND_GAIN = 1.18;        // 鼠标在窗口里的横向位置 → 手的位置（让手容易到达 ±HAND_MAX）

export function createWalkGame(ctx) {
  const dog = ctx.dog;
  const hooks = ctx.gameHooks || {};
  const game = {
    active: false, scene: null, camera: null, sim: null, phase: 'idle', result: null,
    /** 调试用：自动驾驶（URL 参数 gameT 时打开；一旦有真实输入就关掉） */
    autopilot: false,
    start, stop, update, resize,
    again: () => restart(),
    shelfItem: null,
    /** 调试：自动驾驶（高手档）对给定 sim 给出的命令 */
    pilotCmd: (sim) => pilot(sim),
  };

  let built = false, world = null, camera = null, rig = null, collar = null, hud = null;
  let viewW = 400, viewH = 300;
  let pilot = null;
  let touched = false;
  let hintT = 0, tipT = 0, tips = {};
  let cdT = 0, cdShown = -1;
  let endT = 0, resultShown = false;
  let camX = 0, shake = 0, shakeT = 0, flinchT = 0, dustT = 0, bobPhase = 0, tugVis = 0, bow = 0, bowV = 0;
  const view = { dist: 0, speed: 0 };
  let saved = null;
  let cursorSaved = '';
  // 输入：hand = 手的目标位置（米）；grip = 收紧
  const inp = { hand: 0, grip: false, mouseHand: 0, keyHand: 0, keyL: false, keyR: false, keyGrip: false, mouseGrip: false, src: 'mouse' };
  const tmp = new THREE.Vector3(), look = new THREE.Vector3(), lureLook = new THREE.Vector3(), pullLook = new THREE.Vector3();

  // 玩具架上的遛狗绳（入口）
  game.shelfItem = createShelfLeash(ctx, () => start());

  function build() {
    if (built) return;
    built = true;
    world = createWalkWorld();
    camera = new THREE.PerspectiveCamera(62, viewW / viewH, 0.3, 260);
    world.scene.add(camera);
    rig = createLeashRig(camera, world.scene);
    collar = createCollar();
    hud = createHud(document.body);
    if (hud) hud.onExit = () => stop();
    game.scene = world.scene;
    game.camera = camera;
    game.world = world;
  }

  function canvas() { return ctx.renderer && ctx.renderer.domElement; }
  function measure() {
    const el = canvas();
    viewW = Math.max(1, (el && el.clientWidth) || (typeof window !== 'undefined' ? window.innerWidth : 400));
    viewH = Math.max(1, (el && el.clientHeight) || (typeof window !== 'undefined' ? window.innerHeight : 300));
  }
  function resize(w, h) {
    if (w && h) { viewW = w; viewH = h; } else measure();
    if (camera) { camera.aspect = viewW / viewH; applyFov(0); }
    if (hud) hud.resize(viewW, viewH);
  }
  function applyFov(speedKick) {
    const aspect = viewW / viewH;
    // 窄窗口：保证水平视野不小于 ~74°，否则小狗一横移就出画面
    const need = (2 * Math.atan(Math.tan((74 * Math.PI) / 360) / aspect) * 180) / Math.PI;
    camera.fov = clamp(Math.max(62, need), 62, 96) + speedKick;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ 输入：鼠标移动的是“手”
  const onHud = (e) => !!(e.target && e.target.closest && e.target.closest('.wk-btn, .wk-card'));
  function onMove(e) {
    if (!game.active) return;
    const el = canvas();
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = clamp(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1, 1);
    inp.mouseHand = clamp(nx * HAND_GAIN, -1, 1) * WALK.HAND_MAX;
    inp.src = 'mouse'; touched = true;
  }
  function onDown(e) {
    if (!game.active || (e.button !== undefined && e.button !== 0) || onHud(e)) return;
    inp.mouseGrip = true; touched = true;
    const el = canvas(); if (el) el.style.cursor = 'grabbing';
  }
  function onUp() {
    if (!game.active) return;
    inp.mouseGrip = false;
    const el = canvas(); if (el) el.style.cursor = 'ew-resize';
  }
  function keyDir(e, down) {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { if (down && !inp.keyL && inp.src !== 'key') inp.keyHand = inp.hand; inp.keyL = down; inp.src = 'key'; return true; }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { if (down && !inp.keyR && inp.src !== 'key') inp.keyHand = inp.hand; inp.keyR = down; inp.src = 'key'; return true; }
    if (k === 'ArrowDown' || k === 's' || k === 'S' || k === ' ') { inp.keyGrip = down; return true; }
    return false;
  }
  function onKeyDown(e) {
    if (!game.active) return;
    if (e.key === 'Escape') { e.preventDefault(); stop(); return; }
    if (keyDir(e, true)) { touched = true; e.preventDefault(); }
  }
  function onKeyUp(e) { if (game.active && keyDir(e, false)) e.preventDefault(); }
  function onBlur() { inp.mouseGrip = false; inp.keyGrip = false; inp.keyL = false; inp.keyR = false; }
  function listen(on) {
    if (typeof document === 'undefined') return;
    const f = on ? 'addEventListener' : 'removeEventListener';
    document[f]('pointermove', onMove, true);
    document[f]('pointerdown', onDown, true);
    document[f]('pointerup', onUp, true);
    document[f]('pointercancel', onUp, true);
    document[f]('keydown', onKeyDown, true);
    document[f]('keyup', onKeyUp, true);
    window[f]('blur', onBlur);
  }
  function readInput(dt) {
    if (inp.src === 'key') {
      const d = (inp.keyR ? 1 : 0) - (inp.keyL ? 1 : 0);
      inp.keyHand = clamp(inp.keyHand + d * 6 * dt, -WALK.HAND_MAX, WALK.HAND_MAX);
      inp.hand = inp.keyHand;
    } else inp.hand = inp.mouseHand;
    inp.grip = inp.mouseGrip || inp.keyGrip;
  }

  // ------------------------------------------------------------------ 开始 / 结束
  function start(opts = {}) {
    if (game.active || !dog || !ctx.renderer || typeof document === 'undefined') return false;
    measure();
    build();
    resize(viewW, viewH);
    // 借用小狗
    const g = dog.group;
    saved = { parent: g.parent, pos: g.position.clone(), order: g.rotation.order, rx: g.rotation.x, ry: g.rotation.y, rz: g.rotation.z, scale: g.scale.clone() };
    world.scene.add(g);
    g.rotation.order = 'YXZ';
    g.scale.setScalar(DOG_SCALE);
    if (dog.rig && dog.rig.neck) dog.rig.neck.add(collar);
    dog.setAction('idle', { fade: 0.15 });
    dog.speed = 0;
    const seed = opts.seed !== undefined ? opts.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    game.seed = seed;
    newRun(seed, opts.test);
    game.active = true;
    game.autopilot = !!opts.autopilot;
    touched = false;
    inp.mouseHand = 0; inp.keyHand = 0; inp.keyL = inp.keyR = inp.keyGrip = inp.mouseGrip = false; inp.src = 'mouse'; inp.hand = 0; inp.grip = false;
    const el = canvas();
    if (el) { cursorSaved = el.style.cursor; el.style.cursor = 'ew-resize'; }
    document.documentElement.dataset.petNoDrag = '1';
    listen(true);
    hud.show(true);
    hud.resize(viewW, viewH);
    hud.setTime(WALK.DURATION, WALK.DURATION); hud.setBones(0); hud.setHits(0); hud.setGrip(0, false); hud.setRope(false); hud.setCombo(0);
    hud.hint(HINT_MAIN, true);
    if (hooks.onStart) hooks.onStart();
    if (opts.skipCountdown || opts.ff) {
      beginRun();
      if (opts.ff) {
        game.sim.fastForward(opts.ff, pilot);
        game.sim.clearEvents();
        view.dist = game.sim.dist; view.speed = game.sim.speed;
        camX = 0.5 * (game.sim.hand + game.sim.x) * 0.8;
        hud.setBones(game.sim.bones); hud.setHits(game.sim.hits);
        hintT = 99; tips = { lure: 1, cross: 1, dash: 1, slip: 1, fear: 1, sniff: 1 };
        hud.hint(null, false);
      }
    }
    update(0);
    return true;
  }

  function newRun(seed, test) {
    game.sim = createWalkSim({ rng: mulberry32(seed), test: test || {} }); // test：调试 / 验证用的开关（见 walkSim.js）
    game.result = null;
    game.phase = 'countdown';
    pilot = createAutopilot({ delay: 0.12, seed });
    cdT = 0; cdShown = -1; endT = 0; resultShown = false;
    hintT = 0; tipT = 0; tips = {};
    view.dist = 0; view.speed = 0;
    camX = 0; shake = 0; shakeT = 0; flinchT = 0; dustT = 0; bobPhase = 0; tugVis = 0; bow = 0; bowV = 0;
    if (world) world.view = view;
  }

  function restart() {
    if (!game.active) return;
    hud.hideResult();
    newRun((Math.random() * 4294967296) >>> 0);
    hud.setTime(WALK.DURATION, WALK.DURATION); hud.setBones(0); hud.setHits(0); hud.setGrip(0, false); hud.setCombo(0);
    hud.hint(HINT_MAIN, true);
    dog.setAction('idle', { fade: 0.2 });
  }

  function beginRun() {
    game.phase = 'run';
    cdT = CD_TOTAL;
    game.sim.brakeF = 0.3; // 出发时从慢到快
    dog.setAction('run', { fade: 0.15 });
    hud.countdown('');
  }

  function finishResult(aborted) {
    const res = game.sim.result(aborted);
    game.result = res;
    if (!aborted && ctx.rewards && typeof ctx.rewards.grant === 'function') {
      try { ctx.rewards.grant(res); } catch (e) { if (typeof console !== 'undefined') console.error('[walk] rewards.grant 出错', e); }
    }
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('pet:minigame-finished', { detail: res }));
    return res;
  }

  /** 退出小游戏。aborted 缺省：还没跑完就退出 = true */
  function stop(aborted) {
    if (!game.active) return;
    const done = game.phase === 'ending' || game.phase === 'result';
    if (aborted === undefined) aborted = !done;
    if (aborted && !done) finishResult(true);
    game.active = false;
    listen(false);
    // 归还小狗：挂回岛的场景、缩放 / 旋转复原（位置由 brain 的 mover 下一帧写回）
    const g = dog.group;
    if (collar) collar.removeFromParent();
    g.removeFromParent();
    (saved.parent || ctx.scene).add(g);
    g.rotation.order = saved.order;
    g.rotation.set(saved.rx, saved.ry, saved.rz);
    g.scale.copy(saved.scale);
    g.position.copy(saved.pos);
    dog.lookAt(null);
    dog.pant = 0; dog.bliss = 0;
    dog.speed = 0;
    dog.setAction('idle', { fade: 0.2 });
    hud.show(false);
    const el = canvas();
    if (el) el.style.cursor = cursorSaved;
    document.documentElement.dataset.petNoDrag = '';
    if (game.shelfItem) game.shelfItem.update(0.5, true);
    game.phase = 'idle';
    if (hooks.onStop) hooks.onStop(aborted);
  }

  // ------------------------------------------------------------------ 每帧
  function update(dt) {
    if (game.shelfItem) game.shelfItem.update(dt, !game.active);
    if (!game.active) return;
    dt = clamp(dt, 0, 0.1);
    const sim = game.sim;

    if (game.phase === 'countdown') {
      cdT += dt;
      readInput(dt);
      // 倒计时里就能动手（热身）：手跟着鼠标，小狗站着不动
      sim.hand += (inp.hand - sim.hand) * (1 - Math.exp(-WALK.HAND_SMOOTH * dt));
      const n = Math.min(3, Math.floor(cdT / CD_STEP));
      if (n !== cdShown && cdT < CD_TOTAL) { cdShown = n; hud.countdown(n < 3 ? String(3 - n) : '出发！'); }
      if (cdT >= CD_TOTAL) beginRun();
    } else if (game.phase === 'run') {
      readInput(dt);
      let cmd = inp;
      if (game.autopilot && !touched) cmd = pilot(sim);
      sim.update(dt, cmd);
      view.dist = sim.dist; view.speed = sim.speed;
      handleEvents(sim);
      if (sim.finished) beginEnding();
    } else if (game.phase === 'ending' || game.phase === 'result') {
      endT += dt;
      view.speed = damp(view.speed, 0, 2.6, dt);
      view.dist += view.speed * dt;
      if (!resultShown && endT > 2.0) { resultShown = true; game.phase = 'result'; hud.showResult(game.result, { onAgain: restart, onExit: () => stop(false) }); }
    }

    drive(dt, sim);
    updateHud(dt, sim);
    world.update(sim, dt, camera);
  }

  function beginEnding() {
    game.phase = 'ending';
    endT = 0;
    const res = finishResult(false);
    dog.setAction(res.stars >= 2 ? 'playbow' : 'sit', { fade: 0.3 });
    hud.hint(null, false);
    hud.countdown('');
  }

  function handleEvents(sim) {
    for (let i = 0; i < sim.eventCount; i++) {
      const ev = sim.events[i];
      const ahead = ev.s - sim.dist;
      if (ev.type === 'bone') world.burst('bone', ev.x, ahead);
      else if (ev.type === 'hit') {
        world.burst('hit', ev.x, ahead);
        flinchT = 0.6; shake = 0.55; shakeT = 0;
        dog.setAction('flinch', { fade: 0.05 });
        hud.flashHit();
        if (ev.kind === 'pigeons') world.burst('feather', ev.x, ahead);
        if (ev.kind === 'balloons') world.burst('hit', ev.x, ahead);
      } else if (ev.type === 'tug') {
        tugVis = 1;
        world.burst('dust', sim.x, 0);
      } else if (ev.type === 'slip') {
        flinchT = 0.5; shake = 0.7; shakeT = 0;
        hud.flashHit(); hud.banner('脱手了！');
      } else if (ev.type === 'regrip') {
        hud.banner('重新握住');
      } else if (ev.type === 'dash') {
        shake = Math.max(shake, 0.2);
        if (!tips.dash) { tips.dash = 1; tip('小动物！小狗要<b>冲</b>了，按住<b>左键</b>收紧绳子拉住它'); }
      } else if (ev.type === 'bump') {
        world.burst('dust', sim.x, 0); world.burst('dust', sim.x, 0);
      } else if (ev.type === 'sniff') {
        if (!tips.sniff) { tips.sniff = 1; tip('小狗停下来嗅了！<b>快速甩一下手</b>拽它继续走'); }
      }
    }
    sim.clearEvents();
  }

  function updateHud(dt, sim) {
    hud.setTime(WALK.DURATION - sim.time, WALK.DURATION);
    hud.setBones(sim.bones);
    hud.setHits(sim.hits);
    hud.setGrip(sim.gripMeter, sim.slipT > 0);
    hud.setRope(sim.gripAmt > 0.5);
    hud.setCombo(sim.combo);
    const w = game.phase === 'run' ? sim.warn : null;
    hud.warn(w ? -w.dir : 0, w ? w.kind : '');
    if (game.phase === 'run') {
      hintT += dt;
      if (hintT > 6 && hintT < 90) { hintT = 99; if (tipT <= 0) hud.hint(null, false); }
      if (tipT > 0) { tipT -= dt; if (tipT <= 0) hud.hint(null, false); }
      if (!tips.lure && sim.lure && sim.lure.s - sim.dist < 17) { tips.lure = 1; tip('小狗被吸引啦！把手移到<b>反方向</b>，必要时按住<b>左键</b>收紧绳子'); }
      if (!tips.fear && sim.fear && sim.fear.s - sim.dist < 17) { tips.fear = 1; tip('小狗<b>害怕</b>那个东西，会往反方向躲，把它拉回来'); }
      if (!tips.cross && w && w.cls === 'crosser') { tips.cross = 1; tip('有东西要过路！按住<b>左键</b>收紧绳子减速，让它先过'); }
      if (!tips.slip && sim.gripMeter > 0.7) { tips.slip = 1; tip('握力快用完了！<b>松开左键</b>歇一歇，别一直死按'); }
    }
  }
  function tip(html) { hud.hint(html, true); tipT = 4.2; }

  /** 手 → 绳子 → 小狗；相机；表现 */
  function drive(dt, sim) {
    const running = game.phase === 'run';
    const diff = clamp(sim.time / sim.duration, 0, 1);
    const gripAmt = running ? sim.gripAmt : 0;
    const brakeAmt = running ? clamp((1 - sim.brakeF) / (1 - WALK.GRIP_SPEED), 0, 1) : 0;
    flinchT = Math.max(0, flinchT - dt);
    tugVis = Math.max(0, tugVis - dt * 2.5);
    // ---- 小狗 ----
    const g = dog.group;
    let back = 0.35 * gripAmt;
    if (flinchT > 0) back += Math.sin((flinchT / 0.6) * Math.PI) * 0.35;
    const dx = running || game.phase !== 'countdown' ? sim.x : 0;
    const hop = running ? Math.sin(clamp(sim.tugT / 0.4, 0, 1) * Math.PI) * 0.22 + (sim.bumpT > 0 ? Math.sin((sim.bumpT / 0.8) * Math.PI) * 0.12 : 0) : 0;
    g.position.set(dx, hop, -DOG_Z + back);
    const vx = running ? sim.vx : 0;
    const v = Math.max(3.5, view.speed);
    const ropeF = running && sim.slipT <= 0 ? sim.ropeF : 0;
    const will = running ? sim.will : 0;
    // 朝向：跟着横向速度；被绳子横拉时身体朝被拉的方向偏；使劲挣（意愿与拉力反向）时身体朝它想去的方向倾斜（与绳子反向）、前倾
    const yaw = Math.PI - Math.atan2(vx, v) * 0.85 - clamp(ropeF * 0.025, -0.4, 0.4) - clamp(will * 0.012, -0.15, 0.15) * (ropeF === 0 ? 1 : 0);
    const fight = ropeF !== 0 && will !== 0 && Math.sign(ropeF) !== Math.sign(will) ? Math.min(1, Math.min(Math.abs(ropeF), Math.abs(will)) / 8) : 0;
    g.rotation.set(0.06 + 0.2 * brakeAmt + 0.18 * fight + (running && sim.dashT > 0 ? 0.15 : 0), yaw, clamp(-vx * 0.02 + will * 0.012, -0.2, 0.2));
    if (running) {
      if (flinchT <= 0) {
        if (sim.sniffT > 0.25) dog.setAction('sniff', { fade: 0.15 });
        else dog.setAction(gripAmt > 0.5 ? 'walk' : 'run', { fade: 0.18 });
      }
      dog.speed = sim.sniffT > 0.25 ? 0 : gripAmt > 0.5 ? 1.15 * DOG_SCALE : (3.1 + clamp((view.speed - 6.5) * 0.4, 0, 2.6)) * DOG_SCALE;
      dog.pant = 0.25 + 0.7 * diff;
      dog.bliss = sim.exciteT > 0 ? 0.8 : 0;
      // 头：被绳子横拉时头被带歪；否则看向诱惑物 / 害怕的东西
      if (Math.abs(ropeF) > 3) { pullLook.set(sim.x + Math.sign(ropeF) * 2, 0.5, -DOG_Z); dog.lookAt(pullLook); }
      else if (sim.lure && sim.lure.s - sim.dist < WALK.LURE_RANGE) { lureLook.set(sim.lure.x, 0.35, -(DOG_Z + sim.lure.s - sim.dist)); dog.lookAt(lureLook); }
      else if (sim.fear && sim.fear.s - sim.dist < 20) { lureLook.set(sim.fear.x, 0.8, -(DOG_Z + sim.fear.s - sim.dist)); dog.lookAt(lureLook); }
      else dog.lookAt(null);
      dustT -= dt;
      if (dustT <= 0 && view.speed > 2) { dustT = 0.09; world.burst('dust', dx, -back - 0.5); }
    } else if (game.phase === 'ending' || game.phase === 'result') {
      dog.speed = 0; dog.pant = 0.8; dog.bliss = 0; dog.lookAt(null);
    } else {
      dog.speed = 0; dog.pant = 0; dog.bliss = 0; dog.lookAt(null);
    }
    dog.update(dt, ctx.env);
    g.updateMatrixWorld(true);
    world.dogShadow = { x: dx, z: -DOG_Z + back };

    // ---- 相机：身体缓慢跟随“手与小狗的中间位置”，轻微的跑步起伏、速度感（FOV）、撞到时震动 ----
    const handNow = sim.hand;
    camX = damp(camX, 0.5 * (handNow + dx) * 0.8, 4, dt);
    bobPhase += view.speed * dt * 1.25;
    shakeT += dt;
    shake = Math.max(0, shake - dt * 1.8);
    const bob = Math.sin(bobPhase) * 0.035 * Math.min(1, view.speed / 6) + Math.sin(bobPhase * 0.5) * 0.012;
    const sx = (Math.sin(shakeT * 47) + Math.sin(shakeT * 31)) * 0.04 * shake, sy = Math.sin(shakeT * 53) * 0.05 * shake;
    camera.position.set(camX + sx, 1.45 + bob + sy, 0);
    look.set(camX + (dx - camX) * 0.5, 0.78, -10);
    camera.lookAt(look);
    camera.rotateZ(-vx * 0.0045 + Math.sin(bobPhase * 0.5) * 0.004);
    applyFov((view.speed - 6.5) * 0.45);
    camera.updateMatrixWorld(true);

    // ---- 手：世界横向位置 → 画面里的位置（手在狗所在深度的那一列的正下方）----
    const handLocal = clamp((handNow - camX) * 0.15, -0.5, 0.5);
    rig.updateHand(handLocal, gripAmt, bob, tugVis);
    // ---- 绳子：松 = 明显下垂并随手的移动荡开；紧 = 变直并颤；脱手 = 软塌塌地垂下 ----
    const slipping = running && sim.slipT > 0;
    const slackN = running ? clamp((sim.slack - WALK.SLACK_TIGHT) / (WALK.SLACK_LOOSE - WALK.SLACK_TIGHT), 0, 1) : 1;
    const tens = running && !slipping ? clamp(sim.tension / 14, 0, 1) : 0;
    bowV += (-(running ? sim.handV : 0) * 0.02 - bow * 26 - bowV * 5) * dt;
    bow += bowV * dt;
    // 手和狗横向差（相对狗所在深度）也让绳子带一点弧度
    const sag = slipping ? 1.0 : 0.1 + 0.62 * slackN * (1 - 0.7 * tens);
    collar.updateWorldMatrix(true, false);
    tmp.set(0, 0.1, 0).applyMatrix4(collar.matrixWorld);
    rig.updateRope(tmp, { sag, bow: clamp(bow, -0.5, 0.5) * slackN + Math.sin(world.time * 2.1) * 0.03 * slackN, trem: running && !slipping ? clamp(Math.abs(sim.ropeF) / 25, 0, 1) * 0.02 * (1 - slackN) : 0 }, world.time);
  }

  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (game.active) stop(true); });
  return game;
}

export default createWalkGame;
