// 入口：renderer / scene / camera、模块装载（失败回退 stub）、主循环、相机自适应、调试 API。
import * as THREE from 'three';
import { palette } from './core/palette.js';
import { parseParams } from './core/params.js';
import { createEnvironment } from './core/env.js';
import { mulberry32, clamp, damp, dampAngle } from './core/util.js';
import { loadWorld, createStepper, recordError } from './core/world.js';
import { createPanel } from './ui/panel.js';
import { createPetting } from './interaction/petting.js';
import { createPainterly } from './render/painterly.js';
import { createFarmGame } from './minigame/farm.js';
import { createFishing } from './minigame/fishing.js';
import { createEgretVisits } from './world/egretVisit.js';

const params = parseParams();
const errors = [];

const ctx = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(32, 1, 1, 400),
  renderer: null,
  env: null,
  palette,
  rng: mulberry32(params.seed),
  island: null, sky: null, critters: null, dog: null, stick: null, brain: null,
  game: null,
  // 奖励口子（遛狗小游戏结算时调用 grant(result)；奖励机制暂未实现，这里只记下最近一次结果）
  rewards: { last: null, grant(result) { /* 预留：奖励机制 */ this.last = result; } },
  gameHooks: {}, // 小游戏开始 / 结束时主程序要做的事（见 boot）
};
let game = null; // 遛狗小游戏（boot 里创建）；game.active 时主循环改走小游戏
let fishing = null; // 钓鱼小游戏（boot 里创建）；不换场景、不暂停岛的模拟，只接管镜头取景、小狗和指针交互
let travel = null; // 白鹭来访 / 乘鹭出门（boot 里创建）
const fishingOn = () => !!(fishing && fishing.active);

// ---------------- 调试入口（尽早挂出，装载期间也能读 errors） ----------------
let fps = 60;
const pet = {
  ctx, THREE,
  env: null, island: null, sky: null, critters: null, dog: null, stick: null, brain: null,
  errors,
  ready: false,
  params,
  step: () => {},
  info: () => ({ errors: errors.slice() }),
  setFocus: () => {},
};
window.__pet = pet;
window.addEventListener('error', (e) => recordError(errors, 'window', 'error', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => recordError(errors, 'window', 'promise', e.reason || 'unhandledrejection'));

// ---------------- renderer ----------------
const host = document.getElementById('app');
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  ctx.renderer = renderer;
} catch (e) {
  recordError(errors, 'renderer', 'create', e);
}

// ---------------- 手绘后处理（WP8，fx=0 关闭） ----------------
let fx = null;
if (renderer) {
  try {
    fx = createPainterly(renderer, { width: 1, height: 1, pixelRatio: renderer.getPixelRatio(), enabled: params.fx });
    pet.fx = fx;
  } catch (e) {
    recordError(errors, 'painterly', 'create', e);
    fx = null;
  }
}

// ---------------- 相机自适应 ----------------
// 视图状态：围绕 target 的“包围球”半径 R，俯角 pitch，方位 az。距离由 R 与宽高比决定，
// 保证包围球在任何宽高比下都完整可见。
const CAM_FOV = 32;
const DOG_SCALE = 1.5;
// 画风修订（DESIGN 3.0）：低机位，能看到岛体厚实的侧面/底部与身后的手绘天空、草甸背景。
// 取景按“包围盒”而不是包围球：R = 水平半宽，vy = 垂直半高（缺省 = R）。小岛扁而宽，这样在各种宽高比下都尽量铺满画面。
const DEFAULT_VIEW = { tx: 0, ty: -0.35, tz: 0, R: 8.7, vy: 5.6, pitch: (14 * Math.PI) / 180, az: 0 };
const view = { ...DEFAULT_VIEW };
const goal = { ...DEFAULT_VIEW };
let focusName = params.focus;
let viewW = 1, viewH = 1;

function computeFocusGoal(name) {
  const g = { ...DEFAULT_VIEW, vy: 0 };
  if (name && typeof name === 'object') return { ...g, ...name }; // 调试 / 录制：直接给出取景参数 { tx, ty, tz, R, vy, pitch, az }
  const a = ctx.island && ctx.island.anchors;
  if (name === 'dog' && ctx.dog) {
    const p = ctx.dog.group.position;
    Object.assign(g, { tx: p.x, ty: p.y + 0.5, tz: p.z, R: 1.3, pitch: (16 * Math.PI) / 180, az: 0 });
  } else if (name === 'kennel' && a) {
    const k = a.kennelInside;
    // 狗窝中心约在 kennelInside 往窝内一点；镜头略偏向门的朝向，便于看到门洞
    Object.assign(g, { tx: k.x - Math.sin(a.kennelFacing) * 0.2, ty: 0.75, tz: k.z - Math.cos(a.kennelFacing) * 0.2, R: 3.0, pitch: (22 * Math.PI) / 180, az: a.kennelFacing * 0.5 });
  } else if (typeof name === 'string' && name.startsWith('critter:') && ctx.critters) {
    // 调试用：特写第 N 只昆虫（__pet.setFocus('critter:3')）
    const t = ctx.critters.targets[+name.slice(8)];
    if (t) Object.assign(g, { tx: t.position.x, ty: t.position.y, tz: t.position.z, R: 0.42, pitch: (32 * Math.PI) / 180, az: 0.6 });
  } else if (typeof name === 'string' && /^(frog|crab):\d+$/.test(name) && ctx.island && ctx.island.pondLife) {
    // 调试用：特写池塘里的青蛙 / 螃蟹（__pet.setFocus('frog:0')、'crab:0'）
    const pl = ctx.island.pondLife, t = (name[0] === 'f' ? pl.frogs : pl.crabs)[+name.slice(5)];
    if (t) { const p = t.group.position; Object.assign(g, { tx: p.x, ty: p.y + 0.08, tz: p.z, R: 0.4, pitch: (24 * Math.PI) / 180, az: 0.35 }); }
  } else if (name === 'debug' && ctx.debugTarget) {
    // 调试用：特写任意物体（ctx.debugTarget = Object3D；截图脚本里临时摆放的模型）
    const p = ctx.debugTarget.position;
    Object.assign(g, { tx: p.x, ty: p.y + 0.08, tz: p.z, R: 0.4, pitch: (24 * Math.PI) / 180, az: 0.35 });
  } else if (name === 'pond' && a) {
    Object.assign(g, { tx: a.pond.x, ty: 0.1, tz: a.pond.z, R: a.pond.r + 0.7, pitch: (30 * Math.PI) / 180, az: -0.25 });
  } else if (name === 'lookout' && a && a.lookout) {
    // 调试：瞭望台特写（平台 + 坡道）
    const lk = a.lookout;
    Object.assign(g, { tx: (lk.top.x + lk.base.x) / 2 + 0.2, ty: 0.75, tz: (lk.top.z + lk.base.z) / 2, R: 3.2, pitch: (14 * Math.PI) / 180, az: 0 });
  } else if (name === 'mat' && ctx.island && ctx.island.mat) {
    // 调试：跟拍狗垫（拖行 / 晒太阳）
    const p = ctx.island.mat.object.position;
    Object.assign(g, { tx: p.x, ty: p.y + 0.35, tz: p.z, R: 2.0, pitch: (22 * Math.PI) / 180, az: 0.15 });
  } else if (name === 'lawn' && a) {
    Object.assign(g, { tx: a.lawn.x, ty: 0.3, tz: a.lawn.z, R: a.lawn.r + 0.9, pitch: (28 * Math.PI) / 180, az: 0 });
  }
  return g;
}

// 用户视角：滚轮缩放（以鼠标位置为中心，窗口大小不变，只显示局部）、右键拖动绕岛旋转 / 俯仰。带 T 的是目标值，实际值向它平滑过渡。
const user = { zoom: 1, zoomT: 1, cx: 0.5, cy: 0.5, cxT: 0.5, cyT: 0.5, az: 0, azT: 0, pitch: 0, pitchT: 0 };
const ZOOM_MAX = 6;

/** 以画面上的一点 (mx, my ∈ 0..1) 为中心，把缩放目标设为 z1：该点在屏幕上的位置保持不动 */
function zoomAt(mx, my, z1) {
  const z0 = user.zoomT;
  const fx = user.cxT + (mx - 0.5) / z0, fy = user.cyT + (my - 0.5) / z0;
  const half = 0.5 / z1;
  user.zoomT = z1;
  user.cxT = clamp(fx - (mx - 0.5) / z1, half, 1 - half);
  user.cyT = clamp(fy - (my - 0.5) / z1, half, 1 - half);
}

// 玩具架“放大镜”：小岛全景里架子上的格子只有十几个像素宽，很难点准。
// 鼠标在架子上停留片刻，视图就以鼠标位置为中心自动放大到每格约 46 像素；移开后恢复。
// 用户自己用滚轮缩放过（或正在用滚轮）时不介入；拿起物品开始互动时立刻恢复全景。
const mag = { on: false, dwell: 0, away: 0 };
function updateShelfMagnify(dt) {
  const sh = ctx.island && ctx.island.shelf;
  if (!sh || !renderer) return;
  const idle = (!ctx.stick || ctx.stick.state === 'hidden') && !fishingOn();
  const over = idle && !!sh.hovered;
  if (!mag.on) {
    mag.dwell = over && user.zoomT <= 1.02 ? mag.dwell + dt : 0;
    if (mag.dwell > 0.22) {
      const r = renderer.domElement.getBoundingClientRect();
      const mx = clamp((hit.x - r.left) / Math.max(1, r.width), 0, 1), my = clamp((hit.y - r.top) / Math.max(1, r.height), 0, 1);
      zoomAt(mx, my, clamp(46 / (0.018 * viewW), 2.2, 5));
      mag.on = true; mag.away = 0;
    }
  } else {
    mag.away = over ? 0 : mag.away + dt;
    if (!idle || mag.away > 0.45) { mag.on = false; mag.dwell = 0; user.zoomT = 1; user.cxT = 0.5; user.cyT = 0.5; }
  }
}

function applyView() {
  const cam = ctx.camera;
  const aspect = viewW / viewH;
  const vHalf = (CAM_FOV * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const vy = view.vy > 0 ? view.vy : view.R;
  const dist = Math.max(vy / Math.tan(vHalf), view.R / Math.tan(hHalf)) * 1.1;
  const az = view.az + user.az;
  const pitch = clamp(view.pitch + user.pitch, 0.06, 1.2);
  const cp = Math.cos(pitch);
  cam.position.set(view.tx + Math.sin(az) * cp * dist, view.ty + Math.sin(pitch) * dist, view.tz + Math.cos(az) * cp * dist);
  cam.near = Math.max(0.05, dist - view.R * 2);
  cam.far = dist + 320;
  cam.aspect = aspect;
  cam.fov = CAM_FOV;
  cam.lookAt(view.tx, view.ty, view.tz);
  // 缩放 = 只渲染完整画面里以 (cx, cy) 为中心的一小块（视图裁切），透视关系不变，鼠标下的那一点保持不动
  if (user.zoom > 1.001) {
    const z = user.zoom;
    cam.setViewOffset(viewW, viewH, (user.cx - 0.5 / z) * viewW, (user.cy - 0.5 / z) * viewH, viewW / z, viewH / z);
  } else if (cam.view) cam.clearViewOffset();
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
}

function updateCamera(dt, snap = false) {
  if (focusName) Object.assign(goal, computeFocusGoal(focusName));
  else Object.assign(goal, DEFAULT_VIEW);
  if (fishingOn() && fishing.view) Object.assign(goal, fishing.view); // 钓鱼：取景推近到“池塘 + 小狗”（不强制背景：backdrop 仍按窗口大小自动）
  const k = snap ? 1e9 : 5;
  for (const f of ['tx', 'ty', 'tz', 'R', 'vy', 'pitch']) view[f] = snap ? goal[f] : damp(view[f], goal[f], k, dt);
  view.az = snap ? goal.az : dampAngle(view.az, goal.az, k, dt);
  // 木棍在场时（扔木棍的交互固定在小岛正面）：视角自动转回正面
  if (ctx.stick && ctx.stick.state !== 'hidden') { user.azT = Math.round(user.azT / (Math.PI * 2)) * Math.PI * 2; user.pitchT = 0; }
  updateShelfMagnify(dt);
  const uk = snap ? 1 : 1 - Math.exp(-12 * dt);
  user.zoom += (user.zoomT - user.zoom) * uk;
  user.cx += (user.cxT - user.cx) * uk;
  user.cy += (user.cyT - user.cy) * uk;
  user.az += (user.azT - user.az) * (snap ? 1 : 1 - Math.exp(-9 * dt));
  user.pitch += (user.pitchT - user.pitch) * (snap ? 1 : 1 - Math.exp(-9 * dt));
  // 裁切窗口不能超出完整画面
  const half = 0.5 / Math.max(user.zoom, 1);
  user.cx = clamp(user.cx, half, 1 - half);
  user.cy = clamp(user.cy, half, 1 - half);
  applyView();
  updateBackdrop(dt, snap);
  ctx.view.zoom = user.zoom; ctx.view.cx = user.cx; ctx.view.cy = user.cy;
}

// 背景画面的显示程度：窗口小的时候只有干净的小岛漂浮在桌面上（天空、草甸全透明，只留几朵云和日月），
// 窗口拉大到 BACKDROP_MIN 以上才渐渐浮现完整的背景画面。URL 参数 backdrop=0|1 可强制。
const BACKDROP_MIN = 600;
function updateBackdrop(dt, snap) {
  if (!ctx.view) ctx.view = { backdrop: 1 };
  let want = Math.min(viewW, viewH * 1.2) >= BACKDROP_MIN ? 1 : 0;
  if (params.backdrop !== null && params.backdrop !== undefined) want = params.backdrop;
  else if (focusName) want = 1; // 调试特写保留背景
  ctx.view.backdrop = snap ? want : clamp(damp(ctx.view.backdrop, want, 5, dt), 0, 1);
  if (Math.abs(ctx.view.backdrop - want) < 0.004) ctx.view.backdrop = want;
  if (fx) fx.params.edgeFade = 1 - ctx.view.backdrop;
}

function resize() {
  const w = Math.max(1, host.clientWidth || window.innerWidth);
  const h = Math.max(1, host.clientHeight || window.innerHeight);
  viewW = w;
  viewH = h;
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false); // CSS 尺寸由样式控制（100%），不拉伸
    if (fx) {
      try { fx.setSize(w, h, renderer.getPixelRatio()); } catch (e) { recordError(errors, 'painterly', 'resize', e); fx.setEnabled(false); }
    }
  }
  applyView();
  if (game) game.resize(w, h);
}
// ---------------- 视角操作：滚轮缩放 / 右键旋转 / 中键复位 ----------------
if (renderer) {
  const el = renderer.domElement;
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    if ((game && game.active) || fishingOn()) return; // 小游戏中不缩放岛的视图
    hit.lastInput = performance.now();
    const r = el.getBoundingClientRect();
    const mx = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    const my = clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1);
    mag.on = false; mag.dwell = 0; // 用户自己缩放：放大镜不再介入
    zoomAt(mx, my, clamp(user.zoomT * Math.exp(-e.deltaY * 0.0016), 1, ZOOM_MAX));
  }, { passive: false });
  let rot = null;
  el.addEventListener('pointerdown', (e) => {
    if ((game && game.active) || fishingOn()) return;
    if (e.button === 2) {
      rot = { id: e.pointerId, x: e.clientX, y: e.clientY, az: user.azT, pitch: user.pitchT };
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    } else if (e.button === 1) {
      // 中键：视角复位
      e.preventDefault();
      user.zoomT = 1; user.cxT = 0.5; user.cyT = 0.5;
      user.azT = Math.round(user.az / (Math.PI * 2)) * Math.PI * 2; user.pitchT = 0;
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!rot || e.pointerId !== rot.id || (game && game.active) || fishingOn()) return;
    if (!(e.buttons & 2)) { rot = null; return; }
    // 横向拖动绕岛 360° 旋转；纵向拖动抬高/压低机位
    user.azT = rot.az - (e.clientX - rot.x) * 0.009;
    user.pitchT = clamp(rot.pitch + (e.clientY - rot.y) * 0.005, -0.16, 0.9);
  });
  const endRot = (e) => { if (rot && (!e || e.pointerId === rot.id)) rot = null; };
  el.addEventListener('pointerup', endRot);
  el.addEventListener('pointercancel', endRot);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('auxclick', (e) => e.preventDefault());
}
pet.userView = user;

// ---------------- 点穿：光标下是透明像素时，让鼠标事件穿过桌宠窗口落到下面的程序上 ----------------
// 只在 Electron 外壳里生效（window.petShell.setClickThrough）。判断依据是最终画面里光标附近 5×5 像素的透明度。
// 以下情况始终不点穿：光标在面板/缩放手柄等界面元素上；木棍在场（避免逗狗时点偏了点到下面的程序）；鼠标键按住期间（拖动/旋转中）。
const hit = { lastInput: -1e9, x: -1, y: -1, target: null, pressed: false, dirty: false, through: false, tick: 0, buf: new Uint8Array(5 * 5 * 4) };
/** 光标位置 (clientX, clientY) 处是否“有东西”（不透明）。必须在渲染之后的同一任务里调用。 */
function hitOpaque(cx, cy) {
  if (!renderer) return true;
  const el = renderer.domElement;
  const r = el.getBoundingClientRect();
  const gl = renderer.getContext();
  const sx = gl.drawingBufferWidth / Math.max(1, r.width), sy = gl.drawingBufferHeight / Math.max(1, r.height);
  const px = Math.round((cx - r.left) * sx) - 2, py = Math.round((r.height - (cy - r.top)) * sy) - 2;
  if (px < 0 || py < 0 || px + 5 > gl.drawingBufferWidth || py + 5 > gl.drawingBufferHeight) return false;
  hit.buf.fill(0);
  gl.readPixels(px, py, 5, 5, gl.RGBA, gl.UNSIGNED_BYTE, hit.buf);
  for (let i = 3; i < hit.buf.length; i += 4) if (hit.buf[i] > 24) return true;
  return false;
}
pet.hitTest = (cx, cy) => { render(); return hitOpaque(cx, cy); };
function updateClickThrough() {
  const shell = window.petShell;
  if (!shell || typeof shell.setClickThrough !== 'function' || !renderer) return;
  if ((game && game.active) || fishingOn()) { // 小游戏：整个窗口都要接收鼠标，不点穿
    if (hit.through) { hit.through = false; shell.setClickThrough(false); }
    return;
  }
  // 鼠标动了就重新判断；鼠标不动时每隔几帧也查一次（狗、云会移动到光标下面）
  hit.tick++;
  if (!hit.dirty && hit.tick % 8 !== 0) return;
  hit.dirty = false;
  if (hit.pressed) return;
  let through = false;
  const full = !ctx.view || ctx.view.backdrop >= 0.999;
  const busy = ctx.stick && ctx.stick.state !== 'hidden';
  const petBusy = ctx.petInput && (ctx.petInput.over || ctx.petInput.active);
  if (!full && !busy && !petBusy && hit.x >= 0 && hit.target === renderer.domElement) through = !hitOpaque(hit.x, hit.y);
  if (through !== hit.through) { hit.through = through; shell.setClickThrough(through); }
}
if (typeof document !== 'undefined') {
  const track = (e) => { hit.lastInput = performance.now(); hit.x = e.clientX; hit.y = e.clientY; hit.target = e.target; hit.pressed = e.buttons !== 0; hit.dirty = true; };
  document.addEventListener('pointermove', track, true);
  document.addEventListener('pointerdown', track, true);
  document.addEventListener('pointerup', track, true);
  // 点穿状态下鼠标移动是“转发”过来的 mousemove（没有 pointer 事件时兜底）
  document.addEventListener('mousemove', track, true);
}

window.addEventListener('resize', () => {
  resize();
  render();
});
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => resize()).observe(host);

// ---------------- 渲染 ----------------
let renderFailed = false;
function render() {
  if (!renderer) return;
  // 小游戏进行中画小游戏自己的场景（同样走手绘滤镜），否则画小岛
  const gameOn = !!(game && game.active && game.scene && game.camera);
  const scene = gameOn ? game.scene : ctx.scene, camera = gameOn ? game.camera : ctx.camera;
  try {
    // 农场小游戏自己做像素化渲染（低分辨率 + 描边），不走手绘滤镜
    if (gameOn && typeof game.render === 'function' && game.render(renderer)) return;
    if (fx && fx.enabled) {
      try {
        if (gameOn) fx.params.edgeFade = 0; // 小游戏画面铺满整个窗口，不做边缘渐隐
        fx.render(scene, camera);
        return;
      } catch (e) {
        // 后处理失败：记录并回退到直接渲染，不黑屏
        recordError(errors, 'painterly', 'render', e);
        fx.setEnabled(false);
        renderer.setRenderTarget(null);
      }
    }
    renderer.render(scene, camera);
  } catch (e) {
    if (!renderFailed) recordError(errors, 'renderer', 'render', e);
    renderFailed = true;
  }
}

// ---------------- 启动 ----------------
async function boot() {
  ctx.env = createEnvironment({
    rng: mulberry32((params.seed ^ 0x5bd1e995) >>> 0),
    hour: params.hour ?? undefined,
    weather: params.weather ?? undefined,
    timeScale: params.timescale,
  });
  pet.env = ctx.env;
  // 让相机在装载期间已有合理参数
  resize();
  updateCamera(0, true);

  await loadWorld(ctx, { errors, skip: params.brain ? null : new Set(['brain']) });
  for (const k of ['island', 'sky', 'critters', 'dog', 'stick', 'brain']) pet[k] = ctx[k];
  // 摸摸小狗（输入 + 爱心特效）
  let petting = null;
  try {
    if (ctx.dog && ctx.brain) { petting = createPetting(ctx); ctx.scene.add(petting.group); pet.petting = petting; }
  } catch (e) { recordError(errors, 'petting', 'create', e); }
  // 主角要看得清：狗整体放大（狗窝内部空间按此留了余量）
  if (ctx.dog) ctx.dog.group.scale.setScalar(DOG_SCALE);
  // 遛狗小游戏：玩具架上的遛狗绳是入口（占用架子的下一个空格子）
  ctx.gameHooks.onStart = () => {
    // 架子“放大镜”可能正开着：回来时恢复全景
    mag.on = false; mag.dwell = 0; user.zoomT = 1; user.cxT = 0.5; user.cyT = 0.5; user.zoom = 1; user.cx = 0.5; user.cy = 0.5;
  };
  ctx.gameHooks.onStop = () => { hit.lastInput = performance.now(); hit.dirty = true; };
  // 钓鱼：不换场景，只把用户视角（缩放 / 旋转）复位成全景让取景生效，结束后恢复
  let fishSaved = null;
  ctx.gameHooks.onFishStart = () => {
    fishSaved = mag.on ? null : { az: user.azT, pitch: user.pitchT }; // 放大镜开着时的视角不是用户自己调的，不保存
    mag.on = false; mag.dwell = 0;
    user.zoomT = 1; user.cxT = 0.5; user.cyT = 0.5; user.pitchT = 0;
    user.azT = Math.round(user.azT / (Math.PI * 2)) * Math.PI * 2;
    hit.lastInput = performance.now(); hit.dirty = true;
  };
  ctx.gameHooks.onFishStop = () => {
    if (fishSaved) { user.azT = fishSaved.az; user.pitchT = fishSaved.pitch; }
    fishSaved = null;
    hit.lastInput = performance.now(); hit.dirty = true;
  };
  try {
    if (ctx.dog && ctx.island) { game = createFarmGame(ctx); ctx.game = game; pet.game = game; }
  } catch (e) { recordError(errors, 'minigame', 'create', e); game = null; }
  // 钓鱼小游戏：玩具架上的浮漂是入口（占用架子的下一个空格子）
  try {
    if (ctx.dog && ctx.island && ctx.brain && ctx.brain.enterGame) { fishing = createFishing(ctx); ctx.fishing = fishing; pet.fishing = fishing; }
  } catch (e) { recordError(errors, 'fishing', 'create', e); fishing = null; ctx.fishing = null; }
  // 白鹭来访 / 乘鹭出门（默认机制）
  try {
    if (ctx.dog && ctx.island && ctx.brain && ctx.brain.enterGame) { travel = createEgretVisits(ctx); ctx.travel = travel; pet.travel = travel; ctx.scene.add(travel.group); }
  } catch (e) { recordError(errors, 'travel', 'create', e); travel = null; ctx.travel = null; }

  // brain=off / action=xxx：狗站在草坪中心，朝向镜头偏 35°
  if (!ctx.brain && ctx.dog && ctx.island) {
    const l = ctx.island.anchors.lawn;
    ctx.dog.group.position.set(l.x, ctx.island.heightAt(l.x, l.z), l.z);
    ctx.dog.group.rotation.y = (35 * Math.PI) / 180;
    ctx.dog.setAction('idle');
  }
  let previewTimer = 0;
  if (params.action && ctx.dog) {
    if (!ctx.dog.actions.includes(params.action)) recordError(errors, 'dog', 'action', `未知动作：${params.action}`);
    else {
      ctx.dog.setAction(params.action);
      ctx.dog.speed = params.action === 'walk' ? 0.9 : params.action === 'run' ? 3.6 : 0;
    }
  }

  const stepModules = createStepper(ctx, errors);
  function stepOnce(dt) {
    dt = clamp(dt, 0, 0.1);
    if (typeof syncPanel === 'function') syncPanel();
    // 遛狗小游戏：不进行时只更新架子上的遛狗绳；进行时整个岛的模拟、相机、摸摸都暂停
    if (game) {
      try { game.update(dt); } catch (e) { recordError(errors, 'minigame', 'update', e); if (game.active) { try { game.stop(true); } catch (_) { /* ignore */ } } }
      if (game.active) return;
    }
    if (petting) { try { petting.update(dt); } catch (e) { recordError(errors, 'petting', 'update', e); petting = null; } }
    stepModules(dt);
    // 钓鱼：岛的模拟照常运行（上面的 stepModules）；小狗的行为由 brain 的 game 模式交给钓鱼模块，这里更新表现（浮漂、鱼线、水花、HUD）
    if (fishing) { try { fishing.update(dt); } catch (e) { recordError(errors, 'fishing', 'update', e); if (fishing.active) { try { fishing.abort(); } catch (_) { /* ignore */ } } } }
    // 白鹭：在 brain 之后更新（小狗趴在白鹭背上时，位置由它覆盖）
    if (travel) { try { travel.update(dt); } catch (e) { recordError(errors, 'travel', 'update', e); travel = null; ctx.travel = null; if (ctx.dog) ctx.dog.group.visible = true; if (ctx.brain && ctx.brain.mode === 'game') ctx.brain.exitGame(); } }
    // 动作预览：一次性动作播完后停 0.8 秒再重播
    if (params.action && ctx.dog && ctx.dog.actions.includes(params.action)) {
      const d = ctx.dog;
      if (d.action === params.action && d.actionDone) {
        previewTimer += dt;
        if (previewTimer > 0.8) { d.setAction('idle', { fade: 0.1 }); previewTimer = 0; }
      } else if (d.action === 'idle' && params.action !== 'idle') {
        d.setAction(params.action, { fade: 0.1 });
      }
    }
    updateCamera(dt);
  }

  pet.step = (dt = 1 / 30, n = 1) => {
    for (let i = 0; i < n; i++) stepOnce(dt);
    render();
  };
  pet.setFocus = (name) => { focusName = name || null; };
  pet.info = () => {
    const r = fx && fx.enabled ? fx.stats : renderer ? renderer.info.render : null; // fx 开启时取场景 pass 的快照
    return {
      calls: r ? r.calls : 0,
      triangles: r ? r.triangles : 0,
      fps: Math.round(fps),
      hour: +ctx.env.hour.toFixed(2),
      weather: ctx.env.weather,
      dogAction: ctx.dog ? ctx.dog.action : null,
      brainState: ctx.brain ? ctx.brain.state : 'off',
      stickState: ctx.stick ? ctx.stick.state : null,
      errors: errors.slice(),
    };
  };

  // 控制面板（右上角的时间 / 天气入口）
  const panel = createPanel({
    parent: host,
    env: ctx.env,
    alwaysOn: params.panel,
    getStatus: () => ({ dogAction: ctx.dog && ctx.dog.action, brainState: ctx.brain ? ctx.brain.state : 'off' }),
  });
  pet.panel = panel;
  // 小游戏（农场 / 钓鱼）进行中把这个入口关掉，结束后恢复
  let panelHidden = false;
  const syncPanel = () => { const want = !!((game && game.active) || fishingOn()); if (panel && want !== panelHidden) { panelHidden = want; panel.setHidden(want); } };

  // 预热：跑几帧让灯光/天空/狗到位，并把相机吸附到目标
  for (let i = 0; i < 3; i++) stepOnce(1 / 30);
  updateCamera(0, true);

  // 主循环（标签页不可见时暂停）
  let last = performance.now();
  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    // 自适应帧率：桌宠是常驻的小挂件，没人操作时按 30 帧运行（CPU 和显卡占用减半）；
    // 鼠标最近 2.5 秒内在窗口上活动过、或木棍在场（正在逗狗）时按屏幕刷新率运行。URL 参数 fps=60 / fps=30 可强制。
    const active = (game && game.active) || fishingOn() || params.fps === 60 || (params.fps !== 30 && (now - hit.lastInput < 2500 || (ctx.stick && ctx.stick.state !== 'hidden') || (ctx.petInput && ctx.petInput.active)));
    if (!active && now - last < 1000 / 30 - 3) return;
    const dt = Math.max(0, (now - last) / 1000);
    last = now;
    if (dt > 0) fps = lerpFps(fps, 1 / dt);
    stepOnce(dt);
    render();
    updateClickThrough();
  }
  function start() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !params.nopause) stop();
    else start();
  });
  render();
  pet.ready = true;
  if ((params.game === 'walk' || params.game === 'farm') && game) {
    // 调试 / 截图：game=walk 自动开始（有 gameT 时跳过倒计时并快进到该秒数，自动驾驶）
    game.start({ seed: params.seed, ff: params.gameT || 0, autopilot: params.gameT !== null, net: params.farmNet || undefined });
    render();
  }
  if (params.egret && travel) { travel.debugStart(params.egret); }
  if (params.game === 'fishing' && fishing) {
    // 调试 / 截图：game=fishing 自动开始（小狗直接就位：坐在水边、尾巴入水）
    fishing.start({ seed: params.seed, instant: true });
    stepOnce(1 / 30);
    updateCamera(0, true);
    render();
  }
  if (!document.hidden || params.nopause) start();
}

function lerpFps(cur, inst) {
  return cur + (Math.min(inst, 240) - cur) * 0.05;
}

boot().catch((e) => {
  recordError(errors, 'main', 'boot', e);
});
