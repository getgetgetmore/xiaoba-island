// 农场小游戏（对外入口）：createFarmGame(ctx) → { active, scene, camera, start(opts), stop(aborted), update(dt), resize(w, h), render(renderer), shelfItem, sim }
// 入口是玩具架上的遛狗绳：牵着绳走到农场门口，小柴挣脱，在一张斜俯视的大地图上自由捣乱，被管理员满场追。
// 结构（设计与预留接口见 docs/DESIGN.md “农场（定稿方向）”一节）：
//   farmSim.js / farmBot.js   纯逻辑、机器人
//   farm/mapData.js           地图数据（画面和逻辑共用）
//   farm/map.js props.js lighting.js pixel.js   场景、灯光、像素化渲染
//   farm/models.js actors.js  角色模型、把逻辑里的角色接到模型上
//   farm/clock.js rules.js    农场时钟、各时段的规则表（本版“捣乱”模式固定用白天的规则）
//   farm/net.js               联机接口（本版只有离线实现和测试用的假对端）
//   farm/hud.js fx.js         界面、小特效
//   本文件                     借还小狗、输入 → 指令、相机、阶段（开场 → 进行 → 结算）、事件 → 界面 / 特效、奖励口子
//
// 操控：WASD / 方向键 = 跑（按屏幕方向）；鼠标左键 = 扑；空格 = 和眼前的东西互动（菜畦旁按住 = 刨，奶桶 / 草垛 / 圈门等旁边按一下 = 撞过去）；
//       移动鼠标 = 转视角；滚轮 = 以小狗为中心缩放；Esc 退出。
// 镜头：始终以小狗为中心；小狗走进某个可以捣乱的区域时自动推近给这个场景特写，离开后恢复。
// 奖励口子（与原来的小游戏一致）：结算时 ctx.rewards.grant(result) + window 事件 'pet:minigame-finished'；中途退出只发事件（aborted: true）。
import * as THREE from 'three';
import { clamp, damp } from '../core/util.js';
import { createDog } from '../dog/dogModel.js';
import { createFarmSim, FARM } from './farmSim.js';
import { createFarmBot } from './farmBot.js';
import { FARM_MAP } from './farm/mapData.js';
import { buildFarmMap } from './farm/map.js';
import { farmSeeThrough } from './farm/props.js';
import { createFarmLighting } from './farm/lighting.js';
import { createPixelPass } from './farm/pixel.js';
import { farmToonMaterial } from './farm/models.js';
import { createFarmActors } from './farm/actors.js';
import { createFarmClock } from './farm/clock.js';
import { rulesFor } from './farm/rules.js';
import { createLocalNet, createMockNet, defaultProfile, sanitizeChat, MSG, NET } from './farm/net.js';
import { createFarmHud } from './farm/hud.js';
import { createFarmFx } from './farm/fx.js';
import { createShelfLeash } from './walk/leash.js';

const VIEW_H = 9;                 // 画面高度对应的世界单位（斜俯视正交相机）
const PITCH = (42 * Math.PI) / 180;  // 俯角
const CAM_DIST = 150;
const DOG_SCALE = 1.2; // 主角比岛上略小，但比同场的动物显眼
const HINT = '<b>WASD / 方向键</b>=跑　·　<b>左键</b>=扑　·　<b>空格</b>=刨 / 撞　·　<b>鼠标</b>=转视角　·　<b>滚轮</b>=缩放　·　<b>Esc</b> 退出';
const ZOOM_MIN = 0.55, ZOOM_MAX = 2.4;  // 滚轮缩放的范围（1 = 默认远近）
const LOOK_YAW = 0.0032;  // 鼠标每横移 1 像素镜头绕小狗转过的弧度（约 0.18°；转半圈大约 1000 像素）
const LOOK_TILT = 0.0035; // 鼠标每纵移 1 像素“抬头 / 低头”的量（-1 = 抬到头，+1 = 低到头）
const PITCH_UP = (20 * Math.PI) / 180;   // 鼠标在窗口最上：俯角放平这么多（42° → 22°），看得远
const PITCH_DOWN = (8 * Math.PI) / 180;  // 鼠标在窗口最下：俯角加大这么多，更接近俯视
// 镜头落点沿视线方向往前挪的量（占“画面一半能看到的地面纵深”的比例）：平时 / 鼠标在最上 / 鼠标在最下
const AHEAD_BASE = 0.12, AHEAD_UP = 0.5, AHEAD_DOWN = -0.2;
const PIXEL_SS = 1; // 像素化渲染的超采样倍数
const LOOK_BAND_YAW = 0.012, LOOK_BAND_TILT = 0.03; // 鼠标视角的回差：这么小的来回晃动（弧度 / 抬头量）不转视角——手抖、点击时的小位移
const ZONE_ZOOM = 1.38;                 // 进入可捣乱的区域时自动推近的倍数
const KEY_DIR = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
const KEY_ACT = { Space: 1, KeyJ: 1, Enter: 1 };       // 互动键：刨 / 撞
const KEY_POUNCE = { KeyK: 1, ShiftLeft: 1, ShiftRight: 1 }; // 键盘上的“扑”（和鼠标左键一样）
// 各种捣乱点怎么触发（逻辑层 FARM.KINDS 的 trigger）→ 提示里的按键说法；以及每种东西的叫法
const TRIGGER_TEXT = { dig: '按住空格 ', pounce: '空格 ', trample: '来回跑 ', roll: '走进去 ', splash: '走进去 ' };
const KIND_TEXT = {
  radish_bed: '刨萝卜', cabbage_bed: '刨卷心菜', pumpkin_bed: '刨南瓜', flower_bed: '踩花坛', clothesline: '扯床单', milk_can: '撞奶桶', hay_bale: '撞草垛',
  crate: '撞箱子', barrel: '撞木桶', lumber_pile: '撞木料', pen_gate: '撞开圈门', mud_pit: '打滚', fountain: '跳喷泉', feed_trough: '掀食槽', mailbox: '撞信箱', henhouse: '撞鸡舍',
};
const MARK_RANGE = 10;   // 这么近以内、还没捣乱过的东西头顶显示小感叹号
const PROMPT_RANGE = 1.5; // 离它的边缘这么近时改成显示操作提示
const triggerOf = (kind) => (FARM.KINDS[kind] || { trigger: 'pounce' }).trigger;
// 会触发特写的区域：区域范围内至少有一个可捣乱的东西
const FOCUS_ZONES = (FARM_MAP.zones || []).filter((z) => z.r && (FARM_MAP.interactables || []).some((it) => Math.hypot(it.x - z.x, it.z - z.z) < z.r));
const EMOJI = { bark: '汪！', wag: '～♪', heart: '♥', sleepy: 'zzz', laugh: '哈哈' };
const ZONE_NAME = Object.fromEntries((FARM_MAP.zones || []).map((z) => [z.id, z.name]));
// 捣乱事件 → 特效种类
const FX_OF = {
  radish_bed: 'dirt', cabbage_bed: 'dirt', pumpkin_bed: 'dirt', flower_bed: 'petal', clothesline: 'feather', milk_can: 'milk', hay_bale: 'hay',
  crate: 'wood', barrel: 'water', lumber_pile: 'wood', pen_gate: 'wood', mud_pit: 'mud', fountain: 'water', feed_trough: 'hay', mailbox: 'feather',
  henhouse: 'feather', mud_print: 'mud', scatter: 'feather', pounce_bird: 'feather', spook: 'dust', loose: 'dust', bull: 'dust',
};

export function createFarmGame(ctx) {
  const dog = ctx.dog;
  const hooks = ctx.gameHooks || {};
  const game = {
    active: false, scene: null, camera: null, sim: null, phase: 'idle', result: null, autopilot: false,
    start, stop, update, resize, render,
    again: () => restart(),
    shelfItem: null,
    /** 调试 / 测试：当前状态摘要 */
    info,
    net: null, clock: null,
  };
  game.shelfItem = createShelfLeash(ctx, () => start());

  let built = false, map = null, lighting = null, pixel = null, pixelH = 0, actors = null, hud = null, fx = null;
  let viewW = 1, viewH = 1;
  let petId = null, bot = null, saved = null, savedR = null, cursorSaved = '';
  let endT = 0, poseAcc = 0, hintT = 0;
  const camT = new THREE.Vector3(), v3 = new THREE.Vector3(), dir = new THREE.Vector3();
  const inp = { keys: new Set(), down: false, click: false, keyAct: false, keyPress: false, touched: false };
  const assist = { t: 0, x: 0, z: 0 }; // 按空格撞东西时，接下来一小段时间小狗自动对准并冲向它
  const view = { user: 1, cur: 1, zone: null, yaw: 0, yawT: 0, pitch: PITCH, pitchT: PITCH, ahead: AHEAD_BASE, aheadT: AHEAD_BASE }; // 缩放：user = 滚轮调的倍数，cur = 当前实际倍数（含区域特写），zone = 正在特写的区域
  const peers = new Map(); // 对端 id → 逻辑层里的宠物 id
  const netOff = [];
  const tips = {};
  const canvas = () => (ctx.renderer ? ctx.renderer.domElement : null);

  // ------------------------------------------------------------------ 搭场景（第一次开始时）
  function build() {
    if (built) return;
    built = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f4a4e);
    map = buildFarmMap();
    scene.add(map.group);
    lighting = createFarmLighting(scene);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
    game.scene = scene; game.camera = cam;
    actors = createFarmActors({
      scene, heightAt: map.heightAt, localDog: dog, env: ctx.env, dogScale: DOG_SCALE,
      makeDog: (p) => createDog({ rng: () => ((p.id || '').length * 0.137 + 0.31) % 1 }),
    });
    fx = createFarmFx(scene, farmToonMaterial.clone());
    fx.group.material.vertexColors = false;
    hud = createFarmHud(canvas().parentElement || document.body);
    game.clock = createFarmClock({ env: ctx.env });
  }
  function measure() {
    const el = canvas();
    viewW = Math.max(1, (el && el.clientWidth) || window.innerWidth); viewH = Math.max(1, (el && el.clientHeight) || window.innerHeight);
  }
  function resize(w, h) {
    if (w && h) { viewW = w; viewH = h; } else measure();
    if (!built) return;
    applyFrustum();
    // 内部分辨率：画面高度的整数分之一，约 270 像素高
    const dbH = canvas() ? canvas().height : viewH;
    const k = Math.max(1, Math.round(dbH / 270)), ph = Math.max(120, Math.round(dbH / k));
    if (!pixel || ph !== pixelH) { if (pixel) pixel.dispose(); pixel = createPixelPass(ctx.renderer, { height: ph, ss: (typeof window !== 'undefined' && window.__farmSS) || PIXEL_SS, onSnap: (ix, iy) => farmSeeThrough.uSeeGrid.value.set(((ix % 2) + 2) % 2, ((iy % 2) + 2) % 2) }); pixelH = ph; }
  }
  /** 按当前缩放倍数设置正交相机的取景范围 */
  function applyFrustum() {
    const cam = game.camera, aspect = viewW / viewH, h = VIEW_H / view.cur;
    cam.left = (-h * aspect) / 2; cam.right = (h * aspect) / 2; cam.top = h / 2; cam.bottom = -h / 2;
    cam.updateProjectionMatrix();
  }
  /** 小狗现在在哪个可捣乱的区域里（带一点回差，免得在边界上来回切） */
  function zoneAt(p) {
    if (view.zone && Math.hypot(p.x - view.zone.x, p.z - view.zone.z) < view.zone.r * 1.08) return view.zone;
    let best = null, bd = 1e9;
    for (const z of FOCUS_ZONES) { const d = Math.hypot(p.x - z.x, p.z - z.z); if (d < z.r * 0.92 && d < bd) { bd = d; best = z; } }
    return best;
  }
  /** 向目标靠拢：远的时候按比例追，快到了改成匀速收住（不拖一条越来越慢的尾巴——镜头一直在微动，画面就一直在抖） */
  const approach = (cur, to, rate, minSpeed, dt) => {
    const d = to - cur, a = Math.abs(d), step = Math.max(a * (1 - Math.exp(-rate * dt)), minSpeed * dt);
    return step >= a ? to : cur + Math.sign(d) * step;
  };
  function placeCamera(snap, dt) {
    const p = game.sim ? game.sim.pets.find((q) => q.id === petId) : null;
    const tx = p ? p.x : 0, tz = p ? p.z : 0;
    // 缩放：滚轮调的倍数 × 区域特写的倍数，平滑过渡
    const zone = p && game.phase === 'play' && !p.held ? zoneAt(p) : null;
    if (zone !== view.zone) { view.zone = zone; if (zone && hud && !snap) hud.toast(zone.name, 1.6); }
    const want = clamp(view.user * (zone ? ZONE_ZOOM : 1), ZOOM_MIN, ZOOM_MAX * ZONE_ZOOM);
    view.cur = snap ? want : approach(view.cur, want, 4.5, 0.25, dt);
    applyFrustum();
    const vh = VIEW_H / view.cur;
    const halfW = (vh * viewW) / viewH / 2, halfD = vh / 2 / Math.sin(PITCH);
    // 镜头转过角度以后画面的长边不再对着东西方向：两个方向都按较大的那个留边
    const turned = Math.abs(view.yaw) > 0.05, hm = Math.max(halfW, halfD);
    const mx = Math.max(0, FARM_MAP.size.w / 2 + 5 - (turned ? hm : halfW)), mz = Math.max(0, FARM_MAP.size.d / 2 + 5 - (turned ? hm : halfD));
    const cam = game.camera;
    view.yaw = snap ? view.yawT : approach(view.yaw, view.yawT, 14, 0.5, dt);
    view.pitch = snap ? view.pitchT : approach(view.pitch, view.pitchT, 10, 0.08, dt);
    view.ahead = snap ? view.aheadT : approach(view.ahead, view.aheadT, 5, 0.05, dt);
    // 落点：小狗沿视线方向（画面的“上”）往前挪一段，小狗在画面里就靠下，前面露得多
    const fwd = view.ahead * (vh / 2 / Math.sin(view.pitch));
    const gx = clamp(tx - Math.sin(view.yaw) * fwd, -mx, mx), gz = clamp(tz - Math.cos(view.yaw) * fwd, -mz, mz);
    if (snap) camT.set(gx, 0, gz); else { camT.x = damp(camT.x, gx, 6, dt); camT.z = damp(camT.z, gz, 6, dt); }
    const cp = Math.cos(view.pitch);
    cam.position.set(camT.x + Math.sin(view.yaw) * cp * CAM_DIST, Math.sin(view.pitch) * CAM_DIST, camT.z + Math.cos(view.yaw) * cp * CAM_DIST);
    cam.lookAt(camT.x, 0.4, camT.z);
    cam.updateMatrixWorld(true);
    // 挡住小狗的树变半透明：把小狗的位置和相机的三个方向告诉卡通材质
    const se = cam.matrixWorld.elements, st = farmSeeThrough;
    st.uSeeOn.value = p && game.phase === 'play' && !p.escaped ? 1 : 0;
    if (p) st.uSeeDog.value.set(p.x, map.heightAt(p.x, p.z) + 0.35, p.z);
    st.uSeeR.value.set(se[0], se[1], se[2]); st.uSeeU.value.set(se[4], se[5], se[6]); st.uSeeB.value.set(se[8], se[9], se[10]);
    if (lighting.follow) lighting.follow(camT.x, camT.z, Math.max(halfW, vh / 2 / Math.sin(view.pitch)) + 6);
  }
  /** 世界坐标 → 画面像素（相对画布左上角） */
  function toScreen(x, y, z, out) {
    v3.set(x, y, z).project(game.camera);
    out.x = (v3.x * 0.5 + 0.5) * viewW; out.y = (-v3.y * 0.5 + 0.5) * viewH;
    return out;
  }
  const scr = { x: 0, y: 0 };
  // ------------------------------------------------------------------ 输入
  // ---- 鼠标：游戏进行中锁定在窗口里并隐藏（Pointer Lock），只用来转镜头；结算 / 退出时放开
  const lock = { on: false, selfExit: false, focus: true };
  // 暂停：切到别的窗口（窗口失去焦点）时自动暂停；回来点一下或按任意键继续
  function setPaused(on) {
    on = !!on && game.active && game.phase === 'play';
    if (!!game.paused === on) return;
    game.paused = on;
    hud.pause(on);
    inp.keys.clear(); inp.down = false; inp.click = false; inp.keyAct = false; inp.keyPress = false; assist.t = 0;
    if (on) { releaseLock(); setCursor(false); } else { setCursor(true); requestLock(); }
  }
  const lockTarget = () => canvas();
  /** 申请锁定鼠标。浏览器要求由用户操作触发：开局时先试一次，不成的话下一次按键 / 点击再试 */
  function requestLock() {
    const el = lockTarget();
    if (!el || typeof el.requestPointerLock !== 'function' || document.pointerLockElement === el) return;
    try { const r = el.requestPointerLock(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch (_) { /* 没有用户操作 / 窗口不在前台：下次再试 */ }
  }
  function releaseLock() {
    if (typeof document === 'undefined' || !document.pointerLockElement || typeof document.exitPointerLock !== 'function') return;
    lock.selfExit = true;
    try { document.exitPointerLock(); } catch (_) { lock.selfExit = false; }
  }
  function onLockChange() {
    const el = lockTarget(), on = !!el && document.pointerLockElement === el;
    if (lock.on && !on) {
      // 锁没了：自己放开的不管；窗口还在前台 = 用户按了 Esc（系统先把 Esc 用来解锁，页面收不到这次按键）→ 退出游戏；
      // 切到别的窗口了 → 不退出，回来以后下一次按键 / 点击重新锁上
      const self = lock.selfExit; lock.selfExit = false;
      lock.on = false;
      if (!self && game.active && game.phase === 'play' && lock.focus && document.hasFocus()) { stop(); return; }
    }
    lock.on = on;
  }
  /** 光标：游戏进行中不显示（没锁上的时候也不显示）；结算时恢复成普通箭头好点按钮 */
  function setCursor(hidden) {
    const el = canvas(), v = hidden ? 'none' : 'default';
    if (el) el.style.cursor = v;
    if (typeof document !== 'undefined') document.documentElement.style.cursor = hidden ? 'none' : '';
  }
  /** 鼠标移动 → 视角（只看位移，不看位置）：左右 = 绕小狗转（不限圈数），上下 = 抬头 / 低头 */
  // 位移取自 mousemove：实测锁定状态下 pointermove 的 movementX / Y 是 0，mousemove 才有值。
  // pointermove 只在 mousemove 没送达时兜底（按下时被别处 preventDefault 过，按住期间不派发 mousemove）。
  const look = { yaw: 0, tilt: 0, tiltF: 0, mouseT: -1e9 };
  function onMove(e) {
    if (game.phase !== 'play' || game.paused) return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (e.type === 'mousemove') look.mouseT = now; else if (now - look.mouseT < 150) return;
    const mx = e.movementX || 0, my = e.movementY || 0;
    if ((!mx && !my) || Math.abs(mx) > 400 || Math.abs(my) > 400) return; // 锁定 / 解锁的瞬间偶尔会报一个很大的跳变
    look.yaw -= mx * LOOK_YAW;                                    // 鼠标往右 → 视线往右转
    look.tilt = clamp(look.tilt + my * LOOK_TILT, -1, 1);
    // 回差：鼠标要挪出一小段才带动视角，手抖 / 点击时的小晃动不转
    const band = (cur, v, b) => (v > cur + b ? v - b : v < cur - b ? v + b : cur);
    view.yawT = band(view.yawT, look.yaw, LOOK_BAND_YAW);
    look.tiltF = band(look.tiltF, look.tilt, LOOK_BAND_TILT);
    // 鼠标往上 → 抬头：视线放平、落点前移，看前面的路；鼠标往下 → 更接近俯视，落点往回收
    const ly = look.tiltF / (1 - LOOK_BAND_TILT), up = clamp(-ly, 0, 1), dn = clamp(ly, 0, 1);
    view.pitchT = PITCH - up * PITCH_UP + dn * PITCH_DOWN;
    view.aheadT = AHEAD_BASE + up * (AHEAD_UP - AHEAD_BASE) + dn * (AHEAD_DOWN - AHEAD_BASE);
  }
  function onDown(e) {
    if (e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('button')) return; // 结算面板的按钮
    if (game.paused) { setPaused(false); return; } // 这一下只用来继续，不算扑
    if (game.phase === 'play' && !lock.on) requestLock();
    inp.down = true; inp.click = true; inp.touched = true; game.autopilot = false;
  }
  function onUp(e) { if (e.button === undefined || e.button === 0) inp.down = false; }
  function onKeyDown(e) {
    if (e.code === 'Escape') { e.preventDefault(); stop(); return; }
    if (game.paused) { if (!e.repeat) { e.preventDefault(); setPaused(false); } return; } // 这一下只用来继续
    if (game.phase === 'play' && !lock.on && !e.repeat) requestLock();
    if (KEY_DIR[e.code]) { e.preventDefault(); inp.keys.add(e.code); inp.touched = true; game.autopilot = false; }
    else if (KEY_ACT[e.code]) { e.preventDefault(); if (!e.repeat) inp.keyPress = true; inp.keyAct = true; inp.touched = true; game.autopilot = false; }
    else if (KEY_POUNCE[e.code]) { e.preventDefault(); if (!e.repeat) inp.click = true; inp.touched = true; game.autopilot = false; }
  }
  function onKeyUp(e) { if (KEY_DIR[e.code]) inp.keys.delete(e.code); else if (KEY_ACT[e.code]) inp.keyAct = false; }
  function onWheel(e) {
    e.preventDefault();
    if (game.paused) return;
    view.user = clamp(view.user * Math.exp(-e.deltaY * 0.0014), ZOOM_MIN, ZOOM_MAX);
  }
  function onLeave() { lock.focus = false; inp.keys.clear(); inp.down = false; inp.keyAct = false; setPaused(true); }
  function onFocus() { lock.focus = true; }
  function listen(on) {
    const f = on ? 'addEventListener' : 'removeEventListener';
    document[f]('pointermove', onMove, true);
    document[f]('mousemove', onMove, true);
    document[f]('pointerdown', onDown, true);
    document[f]('pointerup', onUp, true);
    document[f]('pointercancel', onUp, true);
    document[f]('keydown', onKeyDown, true);
    document[f]('keyup', onKeyUp, true);
    document[f]('wheel', onWheel, { capture: true, passive: false });
    window[f]('blur', onLeave);
    window[f]('focus', onFocus);
    document[f]('pointerlockchange', onLockChange);
  }

  // ------------------------------------------------------------------ 联机（本版：离线 / 假对端）
  function setupNet(kind) {
    const net = kind === 'mock' ? createMockNet() : createLocalNet();
    game.net = net;
    netOff.push(net.on(MSG.PROFILE, (m, from) => { if (!peers.has(from) && game.sim) peers.set(from, game.sim.addPet({ ...m.profile, id: 'peer_' + from }, { owner: 'remote' })); }));
    netOff.push(net.on(MSG.POSE, (m, from) => { const id = peers.get(from); if (id && game.sim) game.sim.command(id, { moveTo: { x: m.x, z: m.z } }); }));
    netOff.push(net.on(MSG.EMOTE, (m, from) => { const id = peers.get(from); if (id) hud.bubble(id, EMOJI[m.id] || '…'); }));
    netOff.push(net.on(MSG.CHAT, (m, from) => { const id = peers.get(from); const t = sanitizeChat(m.text); if (id && t) hud.bubble(id, t, 3.2); }));
    netOff.push(net.on(MSG.LEAVE, (m, from) => { const id = peers.get(from); if (id && game.sim && game.sim.removePet) game.sim.removePet(id); peers.delete(from); }));
    net.join('farm', defaultProfile('local'));
  }
  function teardownNet() {
    for (const off of netOff) off();
    netOff.length = 0;
    if (game.net) game.net.leave();
    peers.clear(); game.net = null;
  }
  /** 社交接口（预留）：表情、说话、跟着某只宠物一起遛 */
  game.social = {
    emote(id) { if (!game.active || !game.sim) return false; game.sim.command(petId, { moveTo: lastMove.on ? lastMove : null, emote: id }); if (game.net) game.net.send(MSG.EMOTE, { id }); hud.bubble(petId, EMOJI[id] || '…'); return true; },
    say(text) { const t = sanitizeChat(text); if (!t || !game.active) return false; if (game.net && !game.net.send(MSG.CHAT, { text: t }) && game.net.kind !== 'local') return false; hud.bubble(petId, t, 3.2); return true; },
    follow(peerId) { game.following = peers.get(peerId) || null; return !!game.following; },
  };
  const lastMove = { x: 0, z: 0, on: false };

  // ------------------------------------------------------------------ 开始 / 结束
  function newRun(opts) {
    const rules = rulesFor(game.clock.phase, { mode: 'caper', force: !!opts.phase });
    game.sim = createFarmSim({ map: FARM_MAP, rules: opts.phase ? rulesFor(opts.phase, { force: true }) : rules, seed: opts.seed !== undefined ? opts.seed >>> 0 : (Math.random() * 4294967296) >>> 0, mode: 'caper', test: opts.test || {} });
    petId = game.sim.addPet(defaultProfile('local'), { owner: 'local' });
    game.result = null; game.phase = 'play'; game.paused = false; endT = 0; poseAcc = 0; hintT = 0;
    for (const k of Object.keys(tips)) delete tips[k];
    actors.reset();
    fx.clear();
    hud.hideResult(); hud.clear();
    hud.setTime(FARM.DURATION); hud.setScore(0); hud.setAnger(0, false); hud.setCaught(0, FARM.CAUGHT_MAX);
    hud.hint(HINT);
    hud.banner('挣脱啦！看到 ! 的地方都能捣乱', 3);
    if (lighting.setPhase) lighting.setPhase(opts.phase || 'day', 1);
    peers.clear();
    if (game.net && game.net.kind === 'mock') for (const [id, pr] of game.net.peers) peers.set(id, game.sim.addPet({ ...pr.profile, id: 'peer_' + id }, { owner: 'remote' }));
    bot = createFarmBot({ kind: opts.bot || 'skilled', seed: 7 });
  }
  function start(opts = {}) {
    if (game.active || !dog || !ctx.renderer || typeof document === 'undefined') return false;
    if (ctx.travel && ctx.travel.blockPlay()) return false;           // 小狗乘白鹭出门了
    if (ctx.fishing && ctx.fishing.active) return false;
    measure(); build(); resize(viewW, viewH);
    // 借用小狗：挂到农场的场景里（位置、朝向、动作之后都由逻辑层驱动）
    const g = dog.group;
    saved = { parent: g.parent, pos: g.position.clone(), order: g.rotation.order, rx: g.rotation.x, ry: g.rotation.y, rz: g.rotation.z, scale: g.scale.clone(), visible: g.visible };
    game.scene.add(g);
    g.scale.setScalar(DOG_SCALE); g.visible = true;
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    dog.lookAt(null); dog.pant = 0; dog.bliss = 0; dog.tailDrop = 0; dog.tailLift = 0;
    // 渲染器：像素风用硬边阴影、不做色调映射（结束时还原）
    const r = ctx.renderer;
    savedR = { tone: r.toneMapping, shadow: r.shadowMap.type };
    r.toneMapping = THREE.NoToneMapping; r.shadowMap.type = THREE.BasicShadowMap; r.shadowMap.needsUpdate = true;
    game.active = true; game.autopilot = !!opts.autopilot; inp.touched = false; inp.down = false; inp.click = false; inp.keyAct = false; inp.keyPress = false; assist.t = 0; inp.keys.clear();
    view.user = 1; view.cur = 1; view.zone = null; view.yaw = view.yawT = 0; view.pitch = view.pitchT = PITCH; view.ahead = view.aheadT = AHEAD_BASE; look.yaw = look.tilt = look.tiltF = 0;
    setupNet(opts.net || (ctx.params && ctx.params.farmNet) || 'local');
    newRun(opts);
    if (opts.ff) { // 调试 / 截图：用机器人快进到第几秒
      const sim = game.sim; let guard = 0;
      while (sim.time < opts.ff && !sim.finished && guard++ < 60 * 400) { sim.command(petId, bot(sim, petId, 1 / 60)); sim.update(1 / 60); sim.clearEvents(); }
      hud.setCaught(sim.caught, FARM.CAUGHT_MAX);
    }
    const el = canvas();
    if (el) cursorSaved = el.style.cursor;
    setCursor(true);
    document.documentElement.dataset.petNoDrag = '1';
    lock.on = false; lock.selfExit = false; lock.focus = true;
    listen(true);
    requestLock();
    hud.show(true);
    if (hooks.onStart) hooks.onStart();
    placeCamera(true, 0);
    update(0);
    return true;
  }
  function restart() {
    if (!game.active) return;
    newRun({});
    view.yaw = view.yawT = 0; view.pitch = view.pitchT = PITCH; view.ahead = view.aheadT = AHEAD_BASE; look.yaw = look.tilt = look.tiltF = 0;
    placeCamera(true, 0);
    setCursor(true); requestLock(); // “再来一局”是点按钮触发的，可以直接重新锁上
  }
  function finishResult(aborted) {
    const res = game.sim.result(aborted);
    game.result = res;
    if (!aborted && ctx.rewards && typeof ctx.rewards.grant === 'function') {
      try { ctx.rewards.grant(res); } catch (e) { if (typeof console !== 'undefined') console.error('[farm] rewards.grant 出错', e); }
    }
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('pet:minigame-finished', { detail: res }));
    return res;
  }
  /** 退出小游戏。aborted 缺省：还没结算就退出 = true */
  function stop(aborted) {
    if (!game.active) return;
    const done = game.phase === 'ending' || game.phase === 'result';
    if (aborted === undefined) aborted = !done;
    if (aborted && !done) finishResult(true);
    game.active = false; game.phase = 'idle'; game.paused = false;
    releaseLock();
    listen(false);
    lock.on = false;
    teardownNet();
    actors.reset();
    // 归还小狗：挂回岛的场景、缩放 / 旋转复原（位置由 brain 的 mover 下一帧写回）
    const g = dog.group;
    g.removeFromParent();
    (saved.parent || ctx.scene).add(g);
    g.rotation.order = saved.order; g.rotation.set(saved.rx, saved.ry, saved.rz);
    g.scale.copy(saved.scale); g.position.copy(saved.pos); g.visible = saved.visible;
    dog.lookAt(null); dog.speed = 0; dog.setAction('idle', { fade: 0.2 });
    const r = ctx.renderer;
    if (savedR) { r.toneMapping = savedR.tone; r.shadowMap.type = savedR.shadow; r.shadowMap.needsUpdate = true; }
    hud.show(false);
    setCursor(false);
    const el = canvas(); if (el) el.style.cursor = cursorSaved;
    document.documentElement.dataset.petNoDrag = '';
    if (game.shelfItem) game.shelfItem.update(0.5, true);
    if (hooks.onStop) hooks.onStop();
  }

  // ------------------------------------------------------------------ 事件 → 界面 / 特效
  function onEvent(e, sim) {
    actors.event(e, sim);
    const mine = e.petId === undefined || e.petId === petId;
    switch (e.type) {
      case 'mischief': {
        const y = map.heightAt(e.x, e.z);
        fx.burst(FX_OF[e.kind] || 'dust', e.x, y, e.z, 12);
        if (mine && e.points) { toScreen(e.x, y + 0.9, e.z, scr); hud.popup(scr.x, scr.y, '+' + e.points, '#ffe36a'); }
        break;
      }
      case 'pounce': fx.burst('dust', e.x, map.heightAt(e.x, e.z), e.z, 5); break;
      case 'bonk': fx.burst('star', e.x, map.heightAt(e.x, e.z) + 0.5, e.z, 7); break;
      case 'splash': if (e.x !== undefined) fx.burst('water', e.x, map.heightAt(e.x, e.z), e.z, 14); break;
      case 'muddy': if (mine) { hud.toast('滚成泥狗啦！去蹭蹭床单？'); } break;
      case 'wash': if (mine) hud.toast('洗干净了'); break;
      case 'hide': if (mine) hud.toast(e.seen ? '被她看见躲进去了…' : '躲好了，嘘——'); break;
      case 'alert': if (!(tips.alertT > sim.time)) { tips.alertT = sim.time + 8; hud.toast('管理员听到动静，正赶过来！', 2); } break;
      case 'chaseStart': hud.banner(e.shoo ? '管理员来赶你了，快走开！' : '管理员追来了！', 1.8, '#ff9d8a'); break;
      case 'shooFail': hud.banner(e.reason === 'back' ? '又回来捣乱？她要抓你了！' : e.reason === 'again' ? '当着她的面还捣乱？她要抓你了！' : '还不走？她要抓你了！', 2, '#ff9d8a'); break;
      case 'shooed': tips.shooedT = sim.time; hud.toast(e.hid ? '她没找到你，回去巡逻了' : '被赶开了，她回去巡逻了', 1.8); break;
      case 'chaseEnd': case 'lost': if (!sim.finished && tips.shooedT !== sim.time) hud.toast('甩掉她了'); break;
      case 'caught': if (mine) { hud.banner(e.count >= FARM.CAUGHT_MAX ? '被牵回家了…' : '被抓住了！', 2, '#ff9d8a'); hud.setCaught(e.count, FARM.CAUGHT_MAX); } break;
      case 'landed': fx.burst('dust', e.x, map.heightAt(e.x, e.z) + 0.1, e.z, 9); if (mine) hud.toast('被扔回路上了，快跑！', 1.6); break;
      case 'loose': hud.toast('圈门开了，动物跑出来啦！'); break;
      case 'peck': if (mine) { const p = sim.pets.find((q) => q.id === petId); if (p) { toScreen(p.x, 1, p.z, scr); hud.popup(scr.x, scr.y, e.by === 'goose' ? '嘎！' : '啄！', '#ff9d8a'); } } break;
      case 'zoneCleared': hud.toast((ZONE_NAME[e.zone] || '这一片') + ' 全搞定！+' + e.bonus, 3); break;
      case 'wanted': hud.banner('全场通缉！出口打开了', 3.2, '#ff9d8a'); break;
      case 'escaped': if (mine) hud.banner('溜之大吉！', 2.5, '#7ee08a'); break;
      case 'emote': if (!mine) hud.bubble(e.petId, EMOJI[e.id] || '…'); break;
      default: break;
    }
  }

  /** 小狗眼前可以互动的那个东西：还没捣乱过、离它边缘最近且不超过 PROMPT_RANGE；没有返回 null */
  function promptTarget(sim, p) {
    if (!p || p.held || p.escaped) return null;
    let best = null, bd = PROMPT_RANGE;
    for (const o of sim.objects) { if (o.done) continue; const e = Math.hypot(p.x - o.x, p.z - o.z) - o.r; if (e < bd) { bd = e; best = o; } }
    return best;
  }
  const SHOO_SAY = ['去！', '走开！', '去去去！'];
  let shooSayT = 0, shooSayN = 0;
  /** 捣乱点的标记：附近没捣乱过的东西头顶一个小感叹号；走到跟前的那一个改成操作提示 */
  const marks = [];
  function updateMarks(sim) {
    marks.length = 0;
    const p = sim.pets.find((q) => q.id === petId);
    if (!p || game.phase !== 'play' || p.held || p.escaped) { hud.setMarks(marks); return; }
    const tgt = promptTarget(sim, p);
    let best = -1;
    for (const o of sim.objects) {
      if (o.done) continue;
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      if (d > MARK_RANGE) continue;
      toScreen(o.x, map.heightAt(o.x, o.z) + 1.05, o.z, scr);
      if (scr.x < 10 || scr.x > viewW - 10 || scr.y < 44 || scr.y > viewH - 30) continue;
      if (o === tgt) best = marks.length;
      marks.push({ id: o.id, x: scr.x, y: scr.y, text: null, kind: o.kind });
    }
    if (best >= 0) { const m = marks[best]; m.text = (TRIGGER_TEXT[triggerOf(m.kind)] || '空格 ') + (KIND_TEXT[m.kind] || '捣乱'); }
    hud.setMarks(marks);
  }

  // ------------------------------------------------------------------ 每帧
  const plates = [];
  function update(dt) {
    if (game.shelfItem) game.shelfItem.update(dt, !game.active);
    if (!game.active) return;
    if (game.paused) return; // 暂停：逻辑、动画、镜头都不动，画面停在最后一帧
    dt = clamp(dt, 0, 0.1);
    const sim = game.sim;
    game.clock.update();
    if (game.net) game.net.update(dt);
    // ---- 输入 → 指令
    if (game.phase === 'play') {
      if (game.autopilot) sim.command(petId, bot(sim, petId, dt));
      else {
        const follow = game.following ? sim.pets.find((q) => q.id === game.following) : null;
        if (follow && !inp.down) { lastMove.x = follow.x - Math.sin(follow.heading) * 1.2; lastMove.z = follow.z - Math.cos(follow.heading) * 1.2; lastMove.on = true; }
        else {
          // 按着的方向键合成一个方向（屏幕上方 = 北）：目标点放在小狗前方足够远，保证全速
          let dx = 0, dz = 0;
          for (const k of inp.keys) { dx += KEY_DIR[k][0]; dz += KEY_DIR[k][1]; }
          const me = sim.pets.find((q) => q.id === petId), l = Math.hypot(dx, dz);
          if (l > 0 && me) {
            // 按键方向是相对画面的：转到世界坐标（镜头转了多少，方向就跟着转多少）
            const c = Math.cos(view.yaw), sn = Math.sin(view.yaw), ux = dx / l, uz = dz / l;
            lastMove.x = me.x + (c * ux + sn * uz) * 4; lastMove.z = me.z + (-sn * ux + c * uz) * 4; lastMove.on = true;
          } else lastMove.on = false;
        }
        // 左键 = 扑。空格 = 和眼前最近的那个东西互动：
        //   菜畦：按住就刨（还差一点没站进去的话，自己走进去再刨）；奶桶 / 草垛 / 圈门等：按一下，小狗自己对准它冲过去撞。
        const me2 = sim.pets.find((q) => q.id === petId);
        const tgt = me2 && (inp.keyAct || inp.keyPress) ? promptTarget(sim, me2) : null;
        let mv = lastMove.on ? lastMove : null, pounce = inp.click, dig = false;
        if (tgt) {
          const trig = triggerOf(tgt.kind), d = Math.hypot(me2.x - tgt.x, me2.z - tgt.z);
          if (trig === 'dig') { if (d < tgt.r + 0.15) dig = inp.keyAct; else if (inp.keyAct && !lastMove.on) mv = tgt; }
          else if (trig === 'pounce' && inp.keyPress) { assist.t = 0.32; assist.x = tgt.x; assist.z = tgt.z; pounce = true; }
          else if (inp.keyAct && !lastMove.on) mv = tgt; // 花坛 / 泥塘 / 喷泉：按住空格就往里走
        }
        if (assist.t > 0) { assist.t -= dt; mv = assist; }
        inp.keyPress = false;
        sim.command(petId, { moveTo: mv, pounce, dig });
      }
      inp.click = false;
      sim.update(dt);
      for (let i = 0; i < sim.events.length; i++) onEvent(sim.events[i], sim);
      sim.clearEvents();
      if (sim.finished) { game.phase = 'ending'; endT = 0; finishResult(false); hud.hint(null); releaseLock(); setCursor(false); }
      // 自己的位置发给对端（约每秒 10 次）
      poseAcc += dt;
      if (game.net && poseAcc >= 1 / NET.POSE_HZ) { poseAcc = 0; const p = sim.pets.find((q) => q.id === petId); if (p) game.net.send(MSG.POSE, { x: p.x, z: p.z, heading: p.heading, speed: p.speed, action: p.action, muddy: p.muddy, t: game.net.now() }); }
    } else if (game.phase === 'ending') {
      endT += dt;
      if (endT > 1.3 && !hud.resultVisible) { game.phase = 'result'; hud.showResult(game.result, { onAgain: () => restart(), onExit: () => stop(false) }); }
    }
    // ---- 画面
    actors.sync(sim, dt);
    if (map.objects) for (const o of sim.objects) { const v = map.objects.get(o.id); if (v) v.setState(o); }
    if (map.update) map.update(dt);
    if (lighting.update) lighting.update(dt);
    fx.update(dt);
    placeCamera(false, dt);
    // ---- 界面
    const K = sim.keeper;
    hud.setTime(FARM.DURATION - sim.time); hud.setScore(sim.score);
    // 顶栏的状态字：赶来中 / 在赶你（驱赶）/ 追来了（抓）
    hud.setAnger(K ? K.anger : 0, !K ? false : K.state === 'chase' && K.shoo ? 'shoo' : K.state === 'chase' || K.state === 'carry' ? true : K.state === 'suspicious' ? 'come' : false);
    hintT += dt; if (hintT > 14 && game.phase === 'play') hud.hint(null);
    plates.length = 0;
    if (sim.pets.length > 1) for (const p of sim.pets) { if (p.hidden || p.escaped) continue; toScreen(p.x, map.heightAt(p.x, p.z) + 1.25, p.z, scr); plates.push({ id: p.id, name: p.name || '小狗', x: scr.x, y: scr.y }); }
    hud.setPlates(plates);
    updateMarks(sim);
    // 驱赶：她站在小狗跟前时头顶隔一会儿冒一句
    const KK = sim.keeper;
    if (KK && KK.active !== false && KK.state === 'chase' && KK.shoo && KK.action === 'shoo') {
      shooSayT -= dt;
      if (shooSayT <= 0) { shooSayT = 0.9; toScreen(KK.x, map.heightAt(KK.x, KK.z) + 2.1, KK.z, scr); hud.popup(scr.x, scr.y, SHOO_SAY[(shooSayN++) % SHOO_SAY.length], '#ffe36a'); }
    } else shooSayT = 0;
    if (sim.phase === 'wanted' && game.phase === 'play' && FARM_MAP.spawns.exit) {
      const ex = FARM_MAP.spawns.exit; toScreen(ex.x, 1.2, ex.z, scr);
      hud.setArrow({ x: clamp(scr.x, 34, viewW - 34), y: clamp(scr.y, 70, viewH - 40) });
    } else hud.setArrow(null);
    hud.update(dt);
  }
  /** 主程序在小游戏进行中调用它来画这一帧（像素化渲染） */
  function render() {
    if (!game.active || !pixel) return false;
    pixel.render(game.scene, game.camera);
    return true;
  }
  function info() {
    const sim = game.sim, p = sim ? sim.pets.find((q) => q.id === petId) : null;
    return {
      active: game.active, phase: game.phase, simPhase: sim ? sim.phase : null, time: sim ? +sim.time.toFixed(1) : 0, score: sim ? sim.score : 0, caught: sim ? sim.caught : 0,
      pet: p ? { x: +p.x.toFixed(2), z: +p.z.toFixed(2), action: p.action, muddy: p.muddy, hidden: p.hidden, held: p.held } : null,
      keeper: sim && sim.keeper ? { state: sim.keeper.state, anger: +sim.keeper.anger.toFixed(2) } : null,
      pets: sim ? sim.pets.length : 0, animals: sim ? sim.animals.length : 0, plates: hud ? hud.plateCount() : 0,
      zoom: +view.cur.toFixed(2), zone: view.zone ? view.zone.id : null, yaw: +view.yaw.toFixed(2), pitch: +view.pitch.toFixed(2), internal: pixel ? [pixel.width, pixel.height] : null, net: game.net ? game.net.kind : null, clock: game.clock ? game.clock.phase : null,
      paused: !!game.paused, locked: lock.on, cursor: canvas() ? canvas().style.cursor : '', marks: hud ? hud.markCount() : 0, prompts: hud ? hud.markTexts() : [], toast: hud ? hud.lastToast : '', banner: hud ? hud.lastBanner : '', result: game.result,
    };
  }
  return game;
}

export default createFarmGame;
