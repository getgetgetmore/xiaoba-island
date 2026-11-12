// 摸摸小狗：鼠标移到小狗身上变成小手，在它身上来回滑动就开始“摸摸”；鼠标离开后结束。
// 这里只负责“输入”和小特效：命中判定、滑动量累计、光标、冒爱心。小狗怎么反应由行为模块（dog/brain/petMode.js）决定。
//
// 与行为模块的约定（ctx.petInput）：
//   over    鼠标当前是否在小狗身上（且此刻允许摸）
//   active  摸摸进行中（滑动量够了之后为 true；鼠标离开小狗约 0.9 秒后变回 false）
//   point   鼠标在小狗附近的世界坐标（小狗会看向/凑向这里）
//   cursor  小手光标的 CSS 值（over 时由指针模块设置到画布上）
// 其他互动正在进行时（扔树枝、叼垫子、在窝里、在瞭望台上、要回窝避雨/睡觉）不允许摸：由 brain.canPet() 判定。
import * as THREE from 'three';

// 抚摸的小手：侧面看的一只手从右边伸过来，掌心朝下、四指并拢伸直向左、拇指在下方，指尖轻搭在小狗身上（顺着毛抚摸的手势）。
// 颜色用狗屋屋顶的锈橙色系，水粉质感（SVG 滤镜），只露出手腕和一小截小臂，在最右端淡出。系统光标的大小是固定的，没法跟着画面缩放，
// 所以这里隐藏系统光标，自己画一张跟着鼠标走的图：大小按小狗在屏幕上的大小来算（画面放大它也放大）。
const HAND_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='60' height='44' viewBox='12 0 60 44'><defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%23e09a58'/><stop offset='0.5' stop-color='%23c9783a'/><stop offset='1' stop-color='%23a65f2c'/></linearGradient><linearGradient id='f' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='%23000'/><stop offset='0.1' stop-color='%23fff'/><stop offset='1' stop-color='%23fff'/></linearGradient><mask id='m'><rect x='12' y='-4' width='60' height='52' fill='url(%23f)'/></mask><filter id='p' x='-6' y='-6' width='84' height='56' filterUnits='userSpaceOnUse' color-interpolation-filters='sRGB'><feTurbulence type='fractalNoise' baseFrequency='0.09' numOctaves='2' seed='4' result='n'/><feDisplacementMap in='SourceGraphic' in2='n' scale='1.1' xChannelSelector='R' yChannelSelector='G' result='d'/><feTurbulence type='fractalNoise' baseFrequency='0.13' numOctaves='2' seed='9' result='b'/><feColorMatrix in='b' type='matrix' values='0 0 0 0 0.5  0 0 0 0 0.26  0 0 0 0 0.1  0 0 0 0.9 -0.43' result='blot'/><feComposite in='blot' in2='d' operator='in' result='blotIn'/><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='1' seed='2' result='g'/><feColorMatrix in='g' type='matrix' values='0 0 0 0 1  0 0 0 0 0.95  0 0 0 0 0.85  0 0 0 0.5 -0.24' result='grain'/><feComposite in='grain' in2='d' operator='in' result='grainIn'/><feMerge result='paint'><feMergeNode in='d'/><feMergeNode in='blotIn'/><feMergeNode in='grainIn'/></feMerge><feDropShadow in='paint' dx='0.6' dy='1.6' stdDeviation='1' flood-color='%231c2a1a' flood-opacity='0.42'/></filter></defs><g transform='translate(84 0) scale(-1 1)'><g mask='url(%23m)'><g filter='url(%23p)' stroke-linecap='round' stroke-linejoin='round'><path d='M-6 14.6C4 15.8 13 17.6 21.5 17.2C27.5 16.4 32.5 12.2 38.6 10.6C41.6 9.9 44 10.5 46.4 11.6C53.4 13.6 61 15.8 67.2 17.8C69.8 18.7 69.9 21.3 67.6 21.6C61.2 21.9 54.4 21.4 48.4 21.3C46.2 21.4 44.6 22 44.4 22.8C47.6 23 50.6 23.5 53.2 24.5C55.8 25.5 55.6 28.5 53.2 28.9C47 29.9 40.2 30.3 34 29.6C29.4 29.1 25.2 28.5 21 28.7C13.6 29.5 4 30.8 -6 31.6Z' fill='url(%23s)' stroke='%235e3418' stroke-opacity='0.86' stroke-width='1.15'/><path d='M45.6 14.2C52.4 15.8 60 17.8 66.2 19.6' fill='none' stroke='%238a4b22' stroke-width='0.8' stroke-opacity='0.75'/><path d='M40.4 12.6C41.8 13.4 42.4 14.8 42.2 16.2' fill='none' stroke='%238a4b22' stroke-width='0.75' stroke-opacity='0.7'/><path d='M44.4 22.8C41.6 22.8 39.2 23.4 37.4 24.6' fill='none' stroke='%238a4b22' stroke-width='0.8' stroke-opacity='0.7'/><path d='M2 16.6C9 17.6 15.4 18.6 21.2 18.4C26.6 17.8 31.4 14.4 36.6 12.4' fill='none' stroke='%23f0b77e' stroke-width='1.3' opacity='0.55'/><path d='M47.4 12.9C52.6 14.3 58 15.9 63 17.5' fill='none' stroke='%23f0b77e' stroke-width='1' opacity='0.5'/><ellipse cx='52.2' cy='26.4' rx='1.9' ry='1.2' fill='%23eeb47c' opacity='0.6'/><ellipse cx='66.6' cy='19.4' rx='1.5' ry='1' fill='%23eeb47c' opacity='0.5'/></g></g></g></svg>";
const HAND_W = 60, HAND_H = 44;       // 图像的设计尺寸
const HAND_HOT = [0.3, 0.5];          // 热点（指腹中段）在图像里的相对位置
export const HAND_CURSOR = 'none';    // 鼠标在小狗身上时隐藏系统光标

const START_STROKE = 1;      // 开始摸摸所需的滑动量（约 70 像素的来回滑动）
const STROKE_PX = 70;
const OFF_GRACE = 0.9;       // 鼠标离开小狗多久算结束

export function createPetting(ctx) {
  const input = { over: false, active: false, hold: false, point: new THREE.Vector3(), stroke: 0, cursor: HAND_CURSOR, time: 0 };
  ctx.petInput = input;
  const group = new THREE.Group();
  group.name = 'petting';

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), pr = new THREE.Vector3(), ps = new THREE.Vector3();
  const mouse = { inside: false, has: false, lastX: 0, lastY: 0, pressedOnDog: false, buttons: 0 };
  let offT = 0, overT = 0, leaveT = 0;

  // 跟随鼠标的小手图像（只在浏览器里）
  let handEl = null, handSize = 40, handShown = false;
  if (typeof document !== 'undefined' && ctx.renderer && ctx.renderer.domElement) {
    handEl = document.createElement('img');
    handEl.src = 'data:image/svg+xml,' + HAND_SVG.replace(/%23/g, '%2523').replace(/#/g, '%23').replace(/%2523/g, '%23');
    handEl.alt = '';
    handEl.draggable = false;
    handEl.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;user-select:none;z-index:40;display:none;will-change:transform;transform-origin:0 0;';
    (ctx.renderer.domElement.parentElement || document.body).appendChild(handEl);
  }
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
  /** 小狗所在位置每 1 个世界单位对应屏幕上多少像素（随相机距离、缩放、窗口大小变化） */
  function pxPerUnit() {
    const cam = ctx.camera, el = ctx.renderer.domElement;
    _pa.copy(ctx.dog.group.position);
    _pb.copy(_pa).addScaledVector(_pb.set(0, 1, 0).applyQuaternion(cam.quaternion), 1);
    _pa.project(cam); _pb.project(cam);
    return Math.hypot((_pb.x - _pa.x) * 0.5 * el.clientWidth, (_pb.y - _pa.y) * 0.5 * el.clientHeight);
  }
  function updateHand(dt) {
    if (!handEl) return;
    const show = (input.over || input.active) && mouse.inside && mouse.has;
    if (show !== handShown) { handShown = show; handEl.style.display = show ? 'block' : 'none'; }
    if (!show) return;
    // 整张图（含小臂）宽约 0.52 个世界单位，其中手掌到指尖约占一半；全景时不小于 36 像素
    const want = Math.min(110, Math.max(16, 0.22 * pxPerUnit())); // 约为小狗身长的四成；小窗口里小狗只有二十来像素，手也要跟着小
    handSize += (want - handSize) * (1 - Math.exp(-14 * dt));
    const k = handSize / HAND_W;
    // 抚摸时手轻轻来回摆
    const rot = input.active ? Math.sin(input.time * 7) * 4 : 0;
    const hx = HAND_HOT[0] * HAND_W, hy = HAND_HOT[1] * HAND_H;
    handEl.style.transform = `translate(${mouse.lastX}px, ${mouse.lastY}px) rotate(${rot.toFixed(1)}deg) scale(${k.toFixed(3)}) translate(${-hx}px, ${-hy}px)`;
  }

  const allowed = () => !!(ctx.dog && ctx.brain && typeof ctx.brain.canPet === 'function' && ctx.brain.canPet());

  /** 射线是否扫到小狗：把小狗近似成一根从屁股到头的胶囊（放大后的体型），留一点余量好瞄准 */
  function hitDog() {
    const g = ctx.dog.group, sc = g.scale.x || 1, h = g.rotation.y;
    const fx = Math.sin(h), fz = Math.cos(h);
    const low = ctx.dog.action === 'lie' || ctx.dog.action === 'sleep' || ctx.dog.action === 'roll';
    const y = g.position.y + (low ? 0.2 : 0.36) * sc;
    a.set(g.position.x - fx * 0.36 * sc, y, g.position.z - fz * 0.36 * sc);
    b.set(g.position.x + fx * 0.46 * sc, y + (low ? 0.02 : 0.12) * sc, g.position.z + fz * 0.46 * sc);
    const d2 = ray.ray.distanceSqToSegment(a, b, pr, ps);
    const r = 0.34 * sc;
    if (d2 > r * r) return false;
    input.point.copy(pr);
    return true;
  }

  function refreshOver() {
    if (!mouse.has || !mouse.inside || !ctx.camera || !allowed()) { input.over = false; return; }
    ray.setFromCamera(ndc, ctx.camera);
    input.over = hitDog();
  }

  // ---- 爱心：摸摸时从小狗头顶冒出来，飘起、放大、淡出 ----
  const hearts = [];
  {
    const s = new THREE.Shape();
    s.moveTo(0, -0.5);
    s.bezierCurveTo(-0.9, 0.05, -0.55, 0.75, 0, 0.3);
    s.bezierCurveTo(0.55, 0.75, 0.9, 0.05, 0, -0.5);
    const geo = new THREE.ShapeGeometry(s, 8);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff8fa3 : 0xff6f8f, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      m.renderOrder = 30;
      group.add(m);
      hearts.push({ m, t: 1, vx: 0, sway: 0 });
    }
  }
  let heartNext = 0, heartT = 0;
  function spawnHeart() {
    const hp = hearts[heartNext];
    heartNext = (heartNext + 1) % hearts.length;
    const g = ctx.dog.group, sc = g.scale.x || 1;
    hp.m.position.set(g.position.x + (Math.random() - 0.5) * 0.5 * sc, g.position.y + 0.75 * sc, g.position.z + (Math.random() - 0.5) * 0.3 * sc);
    hp.t = 0; hp.vx = (Math.random() - 0.5) * 0.25; hp.sway = Math.random() * 6;
  }

  function update(dt) {
    input.time += dt;
    refreshOver(); // 鼠标不动、小狗在动时也要重新判定
    const ok = allowed();
    // hold：小手出现在小狗身上并停留了一小会儿（0.15 秒，鼠标只是路过不算）→ 小狗停下来等着被摸；
    // 鼠标离开后保持 0.5 秒（小狗转身时身体会从鼠标下挪开一下）
    if (input.over && ok) { overT += dt; leaveT = 0; if (overT > 0.15) input.hold = true; }
    else { overT = 0; leaveT += dt; if (leaveT > 0.5 || !ok || !mouse.inside) input.hold = false; }
    input.stroke *= Math.exp(-dt * 0.9);
    if (!ok) { input.active = false; input.stroke = 0; offT = 0; }
    else if (!input.active) {
      if (input.over && input.stroke >= START_STROKE) { input.active = true; offT = 0; }
    } else {
      offT = input.over ? 0 : offT + dt;
      if (offT > OFF_GRACE || !mouse.inside) { input.active = false; input.stroke = 0; }
    }
    // 告诉外壳：鼠标在小狗身上时，按住左键拖动不要移动窗口（按住来回搓也算摸）
    if (typeof document !== 'undefined') {
      const want = input.over || input.active || input.hold ? '1' : '';
      if (document.documentElement.dataset.petNoDrag !== want) document.documentElement.dataset.petNoDrag = want;
    }
    updateHand(dt);
    // 爱心
    if (input.active && ctx.dog) {
      heartT -= dt;
      if (heartT <= 0) { spawnHeart(); heartT = 0.45 + Math.random() * 0.5; }
    }
    for (let i = 0; i < hearts.length; i++) {
      const hp = hearts[i];
      if (hp.t >= 1) { if (hp.m.visible) hp.m.visible = false; continue; }
      hp.t = Math.min(1, hp.t + dt / 1.5);
      const sc = (ctx.dog.group.scale.x || 1) * (0.07 + 0.09 * Math.sin(Math.min(1, hp.t * 2.2) * Math.PI / 2));
      hp.m.position.y += dt * 0.55;
      hp.m.position.x += (hp.vx + Math.sin(input.time * 3 + hp.sway) * 0.12) * dt;
      hp.m.scale.setScalar(sc);
      if (ctx.camera) hp.m.quaternion.copy(ctx.camera.quaternion); // 始终正对镜头
      hp.m.material.opacity = 0.95 * (1 - hp.t * hp.t);
      hp.m.visible = true;
    }
  }

  // ---- 指针事件（只在浏览器里）----
  if (typeof document !== 'undefined' && ctx.renderer && ctx.renderer.domElement) {
    const el = ctx.renderer.domElement;
    const setNdc = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1);
    };
    el.addEventListener('pointermove', (e) => {
      setNdc(e);
      const wasOver = input.over;
      mouse.inside = true; mouse.has = true; mouse.buttons = e.buttons;
      refreshOver();
      // 在小狗身上滑动：没按键，或者是从小狗身上按下左键开始的拖动，才累计滑动量
      const strokeOk = e.buttons === 0 || (mouse.pressedOnDog && (e.buttons & 1));
      if (input.over && wasOver && strokeOk) {
        input.stroke = Math.min(3, input.stroke + Math.hypot(e.clientX - mouse.lastX, e.clientY - mouse.lastY) / STROKE_PX);
      }
      mouse.lastX = e.clientX; mouse.lastY = e.clientY;
    });
    el.addEventListener('pointerdown', (e) => { if (e.button === 0) mouse.pressedOnDog = input.over || input.active; });
    el.addEventListener('pointerup', () => { mouse.pressedOnDog = false; });
    el.addEventListener('pointerleave', () => { mouse.inside = false; input.over = false; mouse.pressedOnDog = false; });
    el.addEventListener('pointerenter', () => { mouse.inside = true; });
    document.documentElement.addEventListener('mouseleave', () => { mouse.inside = false; input.over = false; });
  }

  return { group, update, input };
}
