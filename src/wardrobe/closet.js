// 衣帽间里面的玩法：控制小狗走动、右键 360° 转视角、换装、照镜子、自拍、拍照区（换背景墙、摆固定姿势、保存照片）。
// 房间本身（墙、柜体、站台、帘子、镜子、拍照区）在 room.js；服饰（目录、穿在身上、陈列模型）在 garments.js；怎么进出衣帽间在 wardrobe.js。
//
// 都是“走到位置就触发”：跳上衣柜前的换装站台 / 走到镜子前的小地垫 / 跳上拍照区的圆台，镜头和界面自动切过去；走开就回到自由走动。
//
// 换装（mode = 'dress'）：
//   挑衣服（stage 'browse'）：小狗坐在站台上面朝衣柜，镜头在它身后对着一排排衣服，鼠标左右移动镜头跟着在两个柜体之间平移。
//     衣服按身体部位分 6 个区（头上 / 眼睛 / 脖子 / 身上 / 背上 / 脚上），每个部位各穿一件；每排常穿的排前面，滚轮 / 拖动 / 箭头左右翻看；
//     鼠标移到一件上它往上取出一截并显示名字。
//   点一件：直接给小狗穿上（点的是正穿着的那件 = 脱下）——镜头转到帘子外面，帘子拉上（'closing'）→ 换好（'hold'）→ 帘子拉开（'opening'）→
//     小狗面朝镜头站着（'show'）。这时鼠标移到它身上的哪件服饰，那个位置就出现“脱下”按钮。点“接着选”回去挑。
// 姿势不列按钮：一个“换个姿势”，或者直接点小狗，轮着换（照镜子 / 自拍 / 拍照区）。
//
// createCloset(ctx, { room, ui, onExit }) → closet = {
//   mode,                 // free 自由走动 | dress 换装 | mirror 照镜子 | selfie 自拍 | photo 拍照区
//   stage,                // 换装里的阶段：browse | closing | hold | opening | show
//   enter(), exit(),      // 进 / 出衣帽间（wardrobe.js 调用）
//   drive(dt, mover),     // 每帧在 brain 里调用（小狗模型更新之前）：算小狗的位置、朝向、动作，写进 mover.ext
//   update(dt),           // 每帧在 brain 之后调用：相机、藏墙、帘子、柜子里的动画、界面
//   back(),               // Esc / 返回键：一级一级往回退；已经在自由走动返回 false（由 wardrobe.js 退出衣帽间）
//   setMode(m), choose(id), wear(id), takeOff(zone), walkTo(x, z), snap(), info(),   // 也给测试 / 调试用
// }
import * as THREE from 'three';
import { GARMENTS, ZONES, ZONE_NAMES, createGarmentDisplay } from './garments.js';

const FONT = '"Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif';
const STORE_KEY = 'shiba.wardrobe.v1';
const WALK_SPEED = 2.0, TURN_RATE = 7.5, DOG_R = 0.42;
const T_CLOSE = 0.45, T_HOLD = 0.25, T_OPEN = 0.55; // 帘子拉上 / 停一下 / 拉开
const SHOW_HEADING = 0.55; // 换好亮相时的朝向：朝着镜头（南）稍微侧一点，身上、背上的也看得见
const css = (el, o) => { Object.assign(el.style, o); return el; };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); return (a < 0 ? a + Math.PI * 2 : a) - Math.PI; };
const kOf = (rate, dt) => 1 - Math.exp(-rate * dt);
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// 固定的拍照姿势（照镜子、自拍、拍照区共用）
export const POSES = [
  { id: 'stand', name: '站好', action: 'idle' },
  { id: 'sit', name: '坐好', action: 'sit' },
  { id: 'smile', name: '眯眼笑', action: 'sit', bliss: 1 },
  { id: 'lie', name: '趴下', action: 'lie' },
  { id: 'bow', name: '撅屁股', action: 'playbow' },
  { id: 'belly', name: '露肚皮', action: 'roll' },
];

// ---- 存档：身上穿着什么、每件穿过几次（常穿的排在柜子前面）
export function loadWardrobe() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s && typeof s === 'object') {
      // 身上穿的按服饰 id 认：老存档里的分区名（hat / top / acc / shoes）和现在的不一样，这里按目录里这件现在属于哪个分区重新归位
      const outfit = {};
      for (const id of Object.values(s.outfit || {})) { const g = GARMENTS.find((x) => x.id === id); if (g) outfit[g.zone] = id; }
      return { outfit, counts: s.counts || {}, backdrop: s.backdrop | 0 };
    }
  } catch (_) { /* 没有存档 / 读不了 */ }
  return { outfit: {}, counts: {}, backdrop: 0 };
}
export function saveWardrobe(state) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* 存不了就算了 */ }
}
/** 启动时把存档里的那身衣服给小狗穿上（岛上、小游戏里也穿着） */
export function applySavedOutfit(dog) {
  if (!dog || typeof dog.wear !== 'function') return;
  const s = loadWardrobe();
  for (const z of ZONES) if (s.outfit[z]) dog.wear(z, s.outfit[z]);
}

export function createCloset(ctx, { room, ui, onExit }) {
  const dog = ctx.dog, canvas = ctx.renderer.domElement, cam = room.camera;
  const store = loadWardrobe();
  const C = {
    mode: 'free', stage: 'browse', on: false,
    enter, exit, drive, update, back, setMode, choose, wear, takeOff, walkTo, snap, info,
  };

  // 房间给的几何：换装站台、帘子、柜体
  const cab = room.cabinet, north = room.walls.find((w) => w.name === cab.wall) || room.walls[0];
  const SECS = cab.sections || [{ id: 'all', clip: cab.clip, slotX: cab.slotX, viewSpot: cab.viewSpot, lookAt: cab.lookAt }];
  const DR = room.dress || { standSpot: new THREE.Vector3(0, 0, cab.rows[0].z + 1.7), radius: 0.8, browse: null };
  const BR = DR.browse || { y: 1.7, z: DR.standSpot.z + 1.2, lookY: 1.15, lookZ: cab.rows[0].z, panMin: (SECS[0].clip.x0 + SECS[0].clip.x1) / 2, panMax: (SECS[SECS.length - 1].clip.x0 + SECS[SECS.length - 1].clip.x1) / 2 };
  const CUR = room.curtain || null;
  const curtainZ = CUR ? CUR.z : DR.standSpot.z + 1.05;

  // ------------------------------------------------------------------ 小狗
  const D = { x: 0, y: 0, z: 0, heading: Math.PI, speed: 0, tx: null, tz: null, face: null, onArrive: null, stuckT: 0, idleT: 0, pose: null, poseT: 0, celebrate: 0, stageAt: null, hop: 0, y0: 0 };
  let latch = null; // 刚从哪个区退出来（人还站在里面）：走出去之前不再触发这个区
  const keys = new Set();
  const ext = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
  const camVec = new THREE.Vector3();

  function walkTo(x, z, face = null, onArrive = null) {
    D.tx = clamp(x, room.walk.x0, room.walk.x1); D.tz = clamp(z, room.walk.z0, room.walk.z1);
    D.face = face; D.onArrive = onArrive; D.stuckT = 0; D.pose = null;
  }
  function stopWalk() { D.tx = null; D.tz = null; D.onArrive = null; }
  function setPose(id) { D.pose = POSES.find((p) => p.id === id) || null; D.poseT = 0; ui_sync(); }
  /** 换个姿势：按固定顺序轮着来 */
  function nextPose() { const i = D.pose ? POSES.indexOf(D.pose) : -1; setPose(POSES[(i + 1) % POSES.length].id); }

  // ---- 三个区：走到位置就触发。[进入半径, 离开半径]（留了回差）
  const SPOT = { dress: DR.standSpot, mirror: room.mirror.standSpot, photo: room.photo.standSpot };
  const FACE = { dress: Math.PI, mirror: room.mirror.facing, photo: room.photo.facing }; // 换装时面朝衣柜（北）
  const ZONE_R = { dress: [DR.radius * 0.95, DR.radius + 0.32], mirror: [0.6, 1.2], photo: [0.78, 1.08] };
  const dist2 = (p) => Math.hypot(D.x - p.x, D.z - p.z);
  /** (x, z) 这个位置属于哪个区（没有则 null） */
  function zoneOf(x, z) {
    for (const k of ['dress', 'photo', 'mirror']) if (Math.hypot(x - SPOT[k].x, z - SPOT[k].z) < ZONE_R[k][0]) return k;
    return null;
  }
  /** 小狗现在站在哪个区里 */
  const zoneAt = () => zoneOf(D.x, D.z);
  /** 小狗现在踩在哪个台子上（拍照区的圆台 / 换装站台），没有则 null */
  function stageOf() {
    if (Math.hypot(D.x - SPOT.photo.x, D.z - SPOT.photo.z) < 0.9) return 'photo';
    if (Math.hypot(D.x - SPOT.dress.x, D.z - SPOT.dress.z) < DR.radius) return 'dress';
    return null;
  }

  /** 小狗这一帧往哪儿走（在 brain 里、小狗模型更新之前调用） */
  function drive(dt, mover) {
    if (!C.on) return;
    let mvx = 0, mvz = 0, want = 0;
    const busy = C.mode === 'dress' && C.stage !== 'browse' && C.stage !== 'show'; // 帘子正在开合：不让动
    if (!busy) {
      // 键盘：方向相对镜头（W = 往画面里走）。自拍时一动就是“走开”，回到自由走动
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      if (f || r) {
        if (C.mode === 'selfie') leaveZone();
        stopWalk(); D.pose = null;
        // 换装时镜头是固定朝北的机位（在小狗南边）：方向键按“画面的上下左右”算
        const az = C.mode === 'dress' ? 0 : orbit.az;
        const fx = -Math.sin(az), fz = -Math.cos(az), rx = Math.cos(az), rz = -Math.sin(az);
        mvx = fx * f + rx * r; mvz = fz * f + rz * r;
        const l = Math.hypot(mvx, mvz) || 1; mvx /= l; mvz /= l; want = WALK_SPEED;
      }
    }
    if (!want && D.tx !== null) {
      const dx = D.tx - D.x, dz = D.tz - D.z, d = Math.hypot(dx, dz);
      if (d < 0.08) { arrive(); }
      else { mvx = dx / d; mvz = dz / d; want = Math.min(WALK_SPEED, 0.4 + d * 3); }
    }
    // 速度、朝向
    D.speed += (want - D.speed) * kOf(9, dt);
    if (want > 0) {
      const h = Math.atan2(mvx, mvz), e = wrap(h - D.heading);
      D.heading = wrap(D.heading + clamp(e, -TURN_RATE * dt, TURN_RATE * dt));
      const gate = Math.max(0.25, 1 - Math.abs(e) / 1.6); // 先转身再迈步
      const ox = D.x, oz = D.z;
      D.x += Math.sin(D.heading) * D.speed * gate * dt; D.z += Math.cos(D.heading) * D.speed * gate * dt;
      collide();
      const moved = Math.hypot(D.x - ox, D.z - oz);
      if (D.tx !== null) { D.stuckT = moved < D.speed * dt * 0.25 ? D.stuckT + dt : 0; if (D.stuckT > 0.7) arrive(); } // 被家具挡住走不到：就停在这儿
      D.idleT = 0;
    } else {
      D.speed = D.speed < 0.05 ? 0 : D.speed;
      if (D.face !== null) { const e = wrap(D.face - D.heading); D.heading = wrap(D.heading + clamp(e, -TURN_RATE * dt, TURN_RATE * dt)); if (Math.abs(e) < 0.02) D.face = null; }
      D.idleT += dt;
    }
    // 区：自由走动时走进哪个区就触发哪个；在区里走出去就退出；人站在区里但没站正，自己挪到位
    if (C.mode === 'free') {
      const z = zoneAt();
      // 点地面走去别处、只是路过这个区：不触发（目的地就在这个区里，或者是用键盘走进来的，才触发）
      const passing = z && D.tx !== null && zoneOf(D.tx, D.tz) !== z;
      if (!z) latch = null; else if (z !== latch && !passing) enterZone(z);
    } else if (SPOT[C.mode]) {
      const spot = SPOT[C.mode], d = dist2(spot);
      const face = C.mode === 'dress' && C.stage !== 'browse' && C.stage !== 'closing' ? SHOW_HEADING : FACE[C.mode]; // 换好以后朝着镜头（南，稍微侧一点）
      if (d > ZONE_R[C.mode][1] && !busy) leaveZone();
      else if (!want && D.tx === null && D.face === null && (d > 0.1 || Math.abs(wrap(face - D.heading)) > 0.08)) {
        walkTo(spot.x, spot.z, face, () => { if (!D.pose && (C.mode !== 'dress' || C.stage === 'browse')) setPose('sit'); });
      }
    }
    // 台子（拍照区的圆台、换装站台）比地面高一点：上去、下来都是跳一下
    const st = stageOf(), base = st ? SPOT[st].y : 0;
    if (st !== D.stageAt) { D.stageAt = st; D.hop = 0.34; D.y0 = D.y; }
    if (D.hop > 0) { D.hop = Math.max(0, D.hop - dt); const u = 1 - D.hop / 0.34; D.y = D.y0 + (base - D.y0) * u + Math.sin(Math.PI * u) * 0.26; }
    else D.y = base;
    // 动作
    D.celebrate = Math.max(0, D.celebrate - dt);
    D.poseT += dt;
    let action = 'idle';
    if (D.speed > 0.15) action = D.speed > 2.3 ? 'run' : 'walk';
    else if (D.celebrate > 0) action = 'spin';
    else if (D.pose) action = D.pose.action;
    else if (C.mode === 'free' && D.idleT > 7) action = 'sit';
    dog.setAction(action);
    dog.bliss = D.pose && D.pose.bliss && D.speed < 0.15 ? 1 : 0;
    // 看哪儿：自拍 / 拍照 / 换好衣服亮相时看镜头，别的时候不特意看
    const lookCam = (C.mode === 'selfie' || C.mode === 'photo' || (C.mode === 'dress' && C.stage === 'show')) && D.speed < 0.15;
    if (lookCam) { camVec.copy(cam.position); dog.lookAt(camVec); } else dog.lookAt(null);
    ext.x = D.x; ext.y = D.y; ext.z = D.z; ext.heading = D.heading + (D.celebrate > 0 ? (1.2 - D.celebrate) * 5.2 : 0); ext.speed = D.speed;
    mover.ext = ext;
  }
  function arrive() {
    const cb = D.onArrive;
    D.tx = null; D.tz = null; D.onArrive = null; D.stuckT = 0;
    if (cb) cb();
  }
  function collide() {
    for (const o of room.obstacles) {
      const dx = D.x - o.x, dz = D.z - o.z, d = Math.hypot(dx, dz), min = o.r + DOG_R;
      if (d < min) { const k = d > 1e-4 ? min / d : 1; D.x = o.x + (d > 1e-4 ? dx * k : min); D.z = o.z + dz * k; }
    }
    D.x = clamp(D.x, room.walk.x0, room.walk.x1); D.z = clamp(D.z, room.walk.z0, room.walk.z1);
  }

  // ------------------------------------------------------------------ 相机：右键拖动绕房间 360° 转、滚轮缩放；各个区有自己的机位
  const orbit = { az: 0, pitch: 0.5, dist: 13, azT: 0, pitchT: 0.5, distT: 13 };
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  const mouse = { x: 0, y: 0, cx: 0, cy: 0, inside: false };
  let camSnap = true, pan = 0;
  function desiredCamera(dt) {
    switch (C.mode) {
      case 'dress':
        if (C.stage === 'browse') {
          // 挑衣服：在小狗身后上方对着一排排衣服；鼠标左右移动，镜头跟着在两个柜体之间平移
          const want = mouse.inside ? BR.panMin + (BR.panMax - BR.panMin) * (mouse.x * 0.5 + 0.5) : 0;
          pan += (clamp(want, BR.panMin, BR.panMax) - pan) * kOf(4, dt);
          wantPos.set(pan, BR.y, BR.z); wantLook.set(pan, BR.lookY, BR.lookZ);
        } else if (C.stage === 'show' && DR.front) {
          // 帘子拉开了：镜头穿过帘子推到小狗面前
          wantPos.copy(DR.front.viewSpot); wantLook.copy(DR.front.lookAt);
        } else {
          // 换衣服的时候：镜头在帘子外面正对站台，看着帘子拉上、再拉开
          const s = SPOT.dress;
          wantPos.set(s.x, s.y + 1.0, curtainZ + 1.6); wantLook.set(s.x, s.y + 0.8, s.z);
        }
        break;
      case 'mirror': wantPos.copy(room.mirror.viewSpot); wantLook.copy(room.mirror.lookAt); break;
      case 'photo': wantPos.copy(room.photo.viewSpot); wantLook.copy(room.photo.lookAt); break;
      case 'selfie': {
        // 像举着手机自拍：在小狗正前方偏一侧、略高的地方往下看它的脸
        const fx = Math.sin(D.heading), fz = Math.cos(D.heading);
        wantPos.set(D.x + fx * 2.3 + fz * 0.55, D.y + 1.5, D.z + fz * 2.3 - fx * 0.55);
        wantLook.set(D.x + fx * 0.25, D.y + 0.85, D.z + fz * 0.25);
        break;
      }
      default: { // free：绕着房间中心转，注视点稍微偏向小狗
        const cp = Math.cos(orbit.pitch);
        wantLook.set(D.x * 0.3, 0.9, D.z * 0.3);
        wantPos.set(wantLook.x + Math.sin(orbit.az) * cp * orbit.dist, wantLook.y + Math.sin(orbit.pitch) * orbit.dist, wantLook.z + Math.cos(orbit.az) * cp * orbit.dist);
      }
    }
  }
  function updateCamera(dt) {
    orbit.az += (orbit.azT - orbit.az) * kOf(10, dt);
    orbit.pitch += (orbit.pitchT - orbit.pitch) * kOf(10, dt);
    orbit.dist += (orbit.distT - orbit.dist) * kOf(10, dt);
    desiredCamera(dt);
    if (camSnap) { camPos.copy(wantPos); camLook.copy(wantLook); camSnap = false; }
    else { const k = kOf(C.mode === 'free' ? 14 : C.mode === 'dress' ? 6 : 4.5, dt); camPos.lerp(wantPos, k); camLook.lerp(wantLook, k); }
    cam.position.copy(camPos); cam.lookAt(camLook); cam.updateMatrixWorld(true);
    // 相机转到哪面墙的背后，就把那面墙（连同靠墙的家具）藏起来
    for (const w of room.walls) {
      const half = Math.abs(w.normal.x) > 0.5 ? room.size.w / 2 : room.size.d / 2;
      w.group.visible = w.normal.x * camPos.x + w.normal.z * camPos.z > -half + 0.05;
    }
  }

  // ------------------------------------------------------------------ 帘子、换装的阶段
  let curtK = 1, stageT = 0, pending = null; // pending = { zone, id | null }：帘子拉上以后要换上（或脱下）的
  function setStage(s) { C.stage = s; stageT = 0; hoverZone = null; ui_sync(); }
  function updateDress(dt) {
    let target = 1;
    if (C.mode === 'dress') {
      stageT += dt;
      if (C.stage === 'closing') { target = 0; if (stageT >= T_CLOSE) { applyPending(); setStage('hold'); } }
      else if (C.stage === 'hold') { target = 0; if (stageT >= T_HOLD) setStage('opening'); }
      else if (C.stage === 'opening') { if (stageT >= T_OPEN) setStage('show'); }
    }
    // 帘子按固定速度开合（拉上 T_CLOSE 秒、拉开 T_OPEN 秒）
    const sp = target < curtK ? 1 / T_CLOSE : 1 / T_OPEN;
    curtK = target < curtK ? Math.max(target, curtK - sp * dt) : Math.min(target, curtK + sp * dt);
    if (CUR) CUR.setOpen(ease(curtK));
  }
  /** 帘子拉上了：换上 / 脱下，小狗转过来面朝镜头站好 */
  function applyPending() {
    const p = pending; pending = null;
    if (p && typeof dog.wear === 'function') {
      if (p.id) { if (dog.wear(p.zone, p.id)) store.counts[p.id] = (store.counts[p.id] || 0) + 1; } else dog.wear(p.zone, null);
      persist();
    }
    stopWalk(); D.x = SPOT.dress.x; D.z = SPOT.dress.z; D.heading = SHOW_HEADING; D.face = null; D.pose = null; D.idleT = 0;
  }
  /** 点了柜子里的一件：没穿着就换上，正穿着就脱下（都走一遍“帘子拉上 → 换 → 拉开”） */
  function choose(id) {
    const g = GARMENTS.find((x) => x.id === id);
    if (!g || !C.on || C.mode !== 'dress' || (C.stage !== 'browse' && C.stage !== 'show')) return false;
    pending = { zone: g.zone, id: worn(id) ? null : id };
    hoverItem = null;
    if (C.stage === 'browse') camSnap = true; // 从挑衣服直接切到帘子外面（不让镜头从帘子中间穿过去）
    setStage('closing');
    return true;
  }
  /** 脱下某个部位的：换装亮相时走帘子，别的时候直接脱 */
  function takeOff(zone) {
    if (typeof dog.wear !== 'function' || !dog.outfit || !dog.outfit[zone]) return false;
    if (C.on && C.mode === 'dress' && (C.stage === 'show' || C.stage === 'browse')) { pending = { zone, id: null }; if (C.stage === 'browse') camSnap = true; setStage('closing'); return true; }
    dog.wear(zone, null); persist(); ui_sync();
    return true;
  }
  /** 直接穿上（不走帘子；测试 / 调试用） */
  function wear(id) {
    const g = GARMENTS.find((x) => x.id === id);
    if (!g || typeof dog.wear !== 'function' || !dog.wear(g.zone, id)) return false;
    store.counts[id] = (store.counts[id] || 0) + 1;
    persist(); ui_sync();
    return true;
  }
  function persist() { store.outfit = { ...(dog.outfit || {}) }; saveWardrobe(store); }
  const worn = (id) => !!(dog.outfit && ZONES.some((z) => dog.outfit[z] === id));

  // ------------------------------------------------------------------ 柜子里的陈列
  const rows = []; // { zone, row, sec, items: [{ g, holder, hit, lift, x, dy }], scroll, scrollT }
  const itemById = new Map(), hits = [];
  let hoverItem = null;
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  function buildCabinet() {
    if (rows.length) return;
    for (const row of cab.rows) {
      const list = GARMENTS.filter((g) => g.zone === row.zone);
      const R = { zone: row.zone, row, sec: SECS[row.section || 0], secI: row.section || 0, items: [], scroll: 0, scrollT: 0 };
      for (const g of list) {
        const holder = new THREE.Group();
        const model = createGarmentDisplay(g.id);
        holder.add(model);
        const hit = new THREE.Mesh(new THREE.BoxGeometry(row.pitch * 0.92, 0.62, 0.55), hitMat);
        hit.position.y = 0.3; holder.add(hit);
        north.group.add(holder);
        // 衣服是吊在挂衣杆下面的：按这件的高度往上提，让细绳的顶端正好够到杆子（row.rail = 杆子的高度）
        const top = new THREE.Box3().setFromObject(model).max.y;
        const dy = row.rail !== undefined ? Math.max(0, row.rail - row.y - top) : 0;
        const it = { g, holder, model, hit, lift: 0, x: 0, R, dy, top };
        hit.userData.item = it;
        R.items.push(it); itemById.set(g.id, it); hits.push(hit);
      }
      rows.push(R);
    }
    sortRows();
  }
  /** 常穿的排前面（穿的次数多的在左边；次数一样按目录顺序） */
  function sortRows() {
    for (const R of rows) {
      const order = GARMENTS.filter((g) => g.zone === R.zone).map((g) => g.id);
      R.items.sort((a, b) => (store.counts[b.g.id] || 0) - (store.counts[a.g.id] || 0) || order.indexOf(a.g.id) - order.indexOf(b.g.id));
      R.scroll = R.scrollT = 0;
    }
  }
  const maxScroll = (R) => Math.max(0, R.items.length - cab.visible);
  function updateCabinet(dt) {
    const t = performance.now() / 1000;
    for (const R of rows) {
      R.scrollT = clamp(R.scrollT, 0, maxScroll(R));
      R.scroll += (R.scrollT - R.scroll) * kOf(10, dt);
      R.items.forEach((it, i) => {
        const x = R.sec.slotX(0) + (i - R.scroll) * R.row.pitch;
        it.x = x;
        const inside = x > R.sec.clip.x0 + R.row.pitch * 0.3 && x < R.sec.clip.x1 - R.row.pitch * 0.3;
        it.lift += ((hoverItem === it ? 1 : 0) - it.lift) * kOf(12, dt);
        it.holder.visible = inside;
        it.hit.visible = inside; // 看不见的不参与点选（hit 的材质本身不可见，这里只是让射线跳过它）
        // 平时在格子里；鼠标移上去往上取出一截、轻轻晃（吊着的衣服上面就是杆子：主要是往外拿）
        it.holder.position.set(x, R.row.y + it.dy + (it.dy > 0 ? 0.1 : 0.22) * it.lift, R.row.z + (it.dy > 0 ? 0.32 : 0.12) * it.lift);
        it.holder.rotation.set(0, Math.sin(t * 3) * 0.12 * it.lift, 0);
        it.holder.scale.setScalar(1 + 0.12 * it.lift);
      });
    }
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
  function setRay(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1);
    ray.setFromCamera(ndc, cam);
  }
  function pickItem(e) {
    setRay(e);
    const r = ray.intersectObjects(hits, false).filter((h) => h.object.visible && h.object.userData.item.holder.visible);
    return r.length ? r[0].object.userData.item : null;
  }
  /** 鼠标在柜子的哪一排上（哪个柜体按 x、哪一排按高度），没有则 null */
  function pickRow(e) {
    setRay(e);
    const z = cab.rows[0].z, t = (z - ray.ray.origin.z) / (ray.ray.direction.z || -1e-6);
    if (t <= 0) return null;
    const x = ray.ray.origin.x + ray.ray.direction.x * t, y = ray.ray.origin.y + ray.ray.direction.y * t;
    let best = null, bd = 1e9;
    for (const R of rows) {
      if (x < R.sec.clip.x0 - 0.2 || x > R.sec.clip.x1 + 0.2) continue;
      const d = Math.abs(y - (R.row.y + R.items[0].dy + 0.3));
      if (d < bd) { bd = d; best = R; }
    }
    return bd < 0.6 ? best : null;
  }

  // ------------------------------------------------------------------ 身上各个部位在哪儿（换好亮相时，鼠标移到哪件上就在那儿出“脱下”按钮）
  const rig = dog.rig || null, anchors = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  /** 把这个部位的参考点写进 anchors，返回点数（没有骨架信息返回 0） */
  function zoneAnchors(zone) {
    if (!rig || !rig.head) return 0;
    const a = anchors[0];
    switch (zone) {
      case 'head': rig.head.localToWorld(a.set(0, 0.17, 0.02)); return 1;
      case 'eyes': rig.head.localToWorld(a.set(0, 0.045, 0.15)); return 1;
      case 'neck': rig.neck.localToWorld(a.set(0, 0.0, 0.07)); return 1;
      case 'body': rig.chest.getWorldPosition(a); rig.hips.getWorldPosition(tmp); a.lerp(tmp, 0.45); return 1;
      case 'back': rig.chest.getWorldPosition(a); rig.hips.getWorldPosition(tmp); a.lerp(tmp, 0.5); a.y += 0.3; return 1;
      case 'feet': { let n = 0; for (const L of rig.legs || []) { if (n < 4) L.paw.getWorldPosition(anchors[n++]); } return n; }
      default: return 0;
    }
  }
  let hoverZone = null, hoverKeep = 0;
  const offBtnPos = new THREE.Vector3();
  /** 鼠标现在指着身上哪个部位的服饰（只算正穿着的），没有则 null */
  function pickWorn() {
    if (!dog.outfit) return null;
    const r = canvas.getBoundingClientRect();
    // 以小狗在画面上的大小定“指中”的范围
    const p0 = project(D.x, D.y, D.z), p1 = project(D.x, D.y + 0.3, D.z), R = Math.max(16, Math.abs(p1.y - p0.y) * 0.75);
    let best = null, bd = 1e9;
    for (const z of ZONES) {
      if (!dog.outfit[z]) continue;
      const n = zoneAnchors(z);
      for (let i = 0; i < n; i++) {
        const p = project(anchors[i].x, anchors[i].y, anchors[i].z);
        const d = Math.hypot(p.x - (mouse.cx - r.left), p.y - (mouse.cy - r.top));
        if (d < R && d < bd) { bd = d; best = z; offBtnPos.copy(anchors[i]); }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ 界面
  const pill = { borderRadius: '999px', boxShadow: '0 3px 10px rgba(40,20,5,0.25)', font: `600 13px/1.3 ${FONT}`, whiteSpace: 'nowrap' };
  const btnStyle = { ...pill, border: 'none', padding: '6px 13px', cursor: 'pointer', pointerEvents: 'auto', background: '#fff8e8', color: '#4a2a14', webkitAppRegion: 'no-drag' };
  const mkBtn = (text, onClick, extra) => { const b = css(document.createElement('button'), { ...btnStyle, ...(extra || {}) }); b.type = 'button'; b.textContent = text; b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); b.addEventListener('pointerdown', (e) => e.stopPropagation()); return b; };
  const mkDiv = (style, text) => { const d = css(document.createElement('div'), style); if (text !== undefined) d.textContent = text; return d; };
  const title = mkDiv({ ...pill, position: 'absolute', left: '50%', top: '10px', transform: 'translateX(-50%)', padding: '5px 18px', background: 'rgba(255,248,232,0.94)', color: '#4a2a14', fontWeight: '700', fontSize: '15px', letterSpacing: '2px' }, '衣帽间');
  const backBtn = mkBtn('← 返回小岛', () => { if (!back()) onExit(); }, { position: 'absolute', left: '10px', top: '10px', background: '#c9783a', color: '#fff8e8' });
  const hint = mkDiv({ ...pill, position: 'absolute', left: '50%', top: '44px', transform: 'translateX(-50%)', padding: '3px 12px', background: 'rgba(74,42,20,0.72)', color: '#fff8e8', fontWeight: '400', fontSize: '12px', maxWidth: 'calc(100% - 20px)', overflow: 'hidden', textOverflow: 'ellipsis', boxSizing: 'border-box' });
  const bar = mkDiv({ position: 'absolute', left: '50%', bottom: '12px', transform: 'translateX(-50%)', display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: 'calc(100% - 16px)' });
  // 跟着 3D 位置走的小东西：每排两头的翻页箭头、“穿着中”的标签、悬停那件的名字、身上的“脱下”按钮
  const overlay = mkDiv({ position: 'absolute', inset: '0', pointerEvents: 'none' });
  const arrows = [], badges = [];
  const nameTag = mkDiv({ ...pill, position: 'absolute', padding: '3px 10px', transform: 'translate(-50%, -100%)', background: 'rgba(74,42,20,0.86)', color: '#fff8e8', display: 'none' });
  const offBtn = mkBtn('脱下', () => { if (hoverZone) takeOff(hoverZone); }, { position: 'absolute', transform: 'translate(-50%, -50%)', background: '#c9783a', color: '#fff8e8', padding: '5px 12px', display: 'none' });
  let overOff = false;
  offBtn.addEventListener('pointerenter', () => { overOff = true; });
  offBtn.addEventListener('pointerleave', () => { overOff = false; });
  overlay.append(nameTag, offBtn);
  const flash = mkDiv({ position: 'absolute', inset: '0', background: '#fff', opacity: '0', pointerEvents: 'none', transition: 'opacity 0.25s ease' });
  ui.append(title, backBtn, hint, bar, overlay, flash);

  const hintOf = () => {
    if (C.mode === 'dress') return C.stage === 'browse' ? '鼠标左右移动看两边的柜子 · 点一件直接穿上 · 滚轮翻看更多' : C.stage === 'show' ? '鼠标移到它身上的哪件，就能在那儿脱下' : '换衣服中……';
    return { free: 'WASD 或点地面走动 · 右键转视角 · 跳上衣柜前的站台、走到镜子前、跳上圆台试试', mirror: '照照镜子——点小狗换个姿势，走开就离开', selfie: '看镜头——点小狗换个姿势，咔嚓！', photo: '换个背景，点小狗换个姿势，咔嚓！走下圆台就离开' }[C.mode];
  };
  let lastUi = '';
  function ui_sync() {
    const key = [C.mode, C.stage, D.pose ? D.pose.id : '', room.photo.index, JSON.stringify(dog.outfit || {})].join('|');
    if (key === lastUi) return;
    lastUi = key;
    backBtn.textContent = C.mode === 'free' ? '← 返回小岛' : '← 返回';
    title.textContent = { free: '衣帽间', dress: '换装', mirror: '照镜子', selfie: '自拍', photo: '拍照区' }[C.mode];
    hint.textContent = hintOf();
    bar.textContent = '';
    const poseBtn = () => mkBtn('🐾 换个姿势' + (D.pose ? '（' + D.pose.name + '）' : ''), () => nextPose());
    const shoot = () => mkBtn('📷 咔嚓', () => snap(), { background: '#c9783a', color: '#fff8e8' });
    if (C.mode === 'free') bar.append(mkBtn('🤳 自拍', () => setMode('selfie')));
    else if (C.mode === 'dress') { if (C.stage === 'show') bar.append(mkBtn('👕 接着选', () => backToBrowse())); }
    else if (C.mode === 'mirror') bar.append(poseBtn());
    else if (C.mode === 'selfie') bar.append(poseBtn(), shoot());
    else if (C.mode === 'photo') {
      const bd = room.photo.backdrops, n = bd.length, i = room.photo.index;
      const setBd = (k) => { room.photo.setBackdrop((k + n) % n); store.backdrop = room.photo.index; saveWardrobe(store); ui_sync(); };
      const name = mkDiv({ ...pill, padding: '6px 12px', background: 'rgba(74,42,20,0.82)', color: '#fff8e8', minWidth: '64px', textAlign: 'center' }, bd[i] ? bd[i].name : '');
      const line = mkDiv({ display: 'flex', gap: '6px', flexBasis: '100%', justifyContent: 'center' });
      line.append(mkBtn('◀', () => setBd(i - 1)), name, mkBtn('▶', () => setBd(i + 1)));
      bar.append(line, poseBtn(), shoot());
    }
  }
  const scr = new THREE.Vector3();
  function project(x, y, z) { scr.set(x, y, z).project(cam); const r = canvas.getBoundingClientRect(); return { x: (scr.x * 0.5 + 0.5) * r.width, y: (-scr.y * 0.5 + 0.5) * r.height, ok: scr.z < 1 }; }
  function updateOverlay(dt) {
    const browsing = C.mode === 'dress' && C.stage === 'browse' && rows.length > 0;
    // 翻页箭头：这一排还有没露出来的才显示
    let ai = 0, bi = 0;
    if (browsing) {
      for (const R of rows) {
        for (const dir of [-1, 1]) {
          const can = dir < 0 ? R.scrollT > 0.01 : R.scrollT < maxScroll(R) - 0.01;
          let a = arrows[ai];
          if (!a) { a = mkBtn('', () => {}, { position: 'absolute', padding: '4px 8px', transform: 'translate(-50%, -50%)', background: 'rgba(255,248,232,0.94)' }); overlay.appendChild(a); arrows[ai] = a; a.addEventListener('click', () => { const r = a._row; if (r) r.scrollT = clamp(Math.round(r.scrollT) + a._dir, 0, maxScroll(r)); }); }
          ai++;
          a._row = R; a._dir = dir; a.textContent = dir < 0 ? '◀' : '▶';
          const p = project(dir < 0 ? R.sec.clip.x0 - 0.02 : R.sec.clip.x1 + 0.02, R.row.y + R.items[0].dy + 0.3, R.row.z + 0.25);
          a.style.display = can && p.ok ? '' : 'none'; a.style.left = p.x + 'px'; a.style.top = p.y + 'px';
        }
      }
      // “穿着中”的小标签
      for (const z of ZONES) {
        const id = dog.outfit && dog.outfit[z], it = id ? itemById.get(id) : null;
        if (!it || !it.holder.visible) continue;
        let b = badges[bi];
        if (!b) { b = mkDiv({ ...pill, position: 'absolute', padding: '1px 7px', transform: 'translate(-50%, -50%)', background: '#5fae5a', color: '#fff', fontSize: '11px' }, '穿着中'); overlay.appendChild(b); badges[bi] = b; }
        bi++;
        const p = project(it.holder.position.x, it.holder.position.y - 0.04, it.holder.position.z + 0.3);
        b.style.display = p.ok ? '' : 'none'; b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
      }
    }
    for (; ai < arrows.length; ai++) arrows[ai].style.display = 'none';
    for (; bi < badges.length; bi++) badges[bi].style.display = 'none';
    // 悬停那件的名字
    if (browsing && hoverItem && hoverItem.holder.visible) {
      const p = project(hoverItem.holder.position.x, hoverItem.holder.position.y + hoverItem.top * 1.12 + 0.07, hoverItem.holder.position.z + 0.2);
      nameTag.textContent = hoverItem.g.name + (worn(hoverItem.g.id) ? '（穿着中，点一下脱下）' : '');
      nameTag.style.display = p.ok ? '' : 'none'; nameTag.style.left = p.x + 'px'; nameTag.style.top = p.y + 'px';
    } else nameTag.style.display = 'none';
    // 身上的“脱下”按钮：鼠标移到哪件上就在那儿出现；鼠标挪到按钮上的这段路上不消失
    if (C.mode === 'dress' && C.stage === 'show') {
      const z = mouse.inside && !overOff ? pickWorn() : null;
      if (z) { hoverZone = z; hoverKeep = 0.45; offBtn._pos = offBtnPos.clone ? (offBtn._pos || new THREE.Vector3()).copy(offBtnPos) : null; }
      else if (!overOff) { hoverKeep -= dt; if (hoverKeep <= 0) hoverZone = null; }
      if (hoverZone && dog.outfit && dog.outfit[hoverZone] && offBtn._pos) {
        const g = GARMENTS.find((x) => x.id === dog.outfit[hoverZone]);
        const p = project(offBtn._pos.x, offBtn._pos.y, offBtn._pos.z);
        offBtn.textContent = '脱下' + (g ? g.name : '');
        offBtn.style.display = ''; offBtn.style.left = p.x + 'px'; offBtn.style.top = (p.y - 6) + 'px';
      } else { offBtn.style.display = 'none'; if (!overOff) hoverZone = null; }
    } else { offBtn.style.display = 'none'; overOff = false; }
  }

  // ------------------------------------------------------------------ 模式
  /** 走进了某个区：切到对应的模式 */
  function enterZone(z) { latch = null; setMode(z); }
  /** 离开当前的区，回到自由走动（人要是还站在区里，走出去之前不再触发） */
  function leaveZone() { if (C.mode === 'free') return; setMode('free'); latch = zoneAt(); }
  /** 换好亮相以后回去接着挑：小狗转回去面朝衣柜坐下 */
  function backToBrowse() { if (C.mode !== 'dress') return; D.pose = null; D.face = null; setStage('browse'); }

  function setMode(m) {
    if (!C.on || m === C.mode) return;
    hoverItem = null; hoverZone = null; D.pose = null; pending = null;
    if (m === 'selfie') keys.clear(); // 走进镜子 / 站台 / 圆台时手还按着方向键：让它接着走
    C.mode = m; C.stage = 'browse'; stageT = 0;
    if (m === 'dress') { sortRows(); pan = 0; } // 每次上站台按“常穿”重排一次（挑的过程中不重排，免得衣服在眼前换位置）
    if (SPOT[m]) { if (!keys.size) walkTo(SPOT[m].x, SPOT[m].z, FACE[m], () => { if (C.mode === m && !D.pose) setPose('sit'); }); }
    else if (m === 'selfie') { stopWalk(); D.pose = POSES[2]; } // 自拍：就地坐下眯眼笑
    // 回到自由走动：不打断正在走的路（走出某个区的范围时会到这儿，它要接着走到点的地方）
    ui_sync();
  }
  function back() {
    if (!C.on) return false;
    if (C.mode === 'dress' && C.stage !== 'browse') { if (C.stage === 'show') backToBrowse(); return true; } // 帘子开合途中按返回：等它演完
    if (C.mode !== 'free') { stopWalk(); leaveZone(); return true; } // 按返回 / Esc 离开：小狗原地不动
    return false;
  }

  /** 拍一张：把当前画面存成图片（不带界面） */
  function snap() {
    let url = null;
    try { url = ctx.capture ? ctx.capture() : null; } catch (_) { url = null; }
    flash.style.transition = 'none'; flash.style.opacity = '0.85';
    setTimeout(() => { flash.style.transition = 'opacity 0.35s ease'; flash.style.opacity = '0'; }, 60); // 闪一下白光
    C.lastPhoto = url ? url.length : 0;
    if (!url) return false;
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    const a = document.createElement('a');
    a.href = url; a.download = `小柴-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    return true;
  }

  // ------------------------------------------------------------------ 进出
  function enter() {
    buildCabinet(); sortRows();
    C.on = true; C.mode = 'free'; C.stage = 'browse'; hoverItem = null; hoverZone = null; pending = null; lastUi = '';
    const s = room.dogSpot.position;
    D.x = s.x; D.y = 0; D.z = s.z; D.heading = Math.PI; D.speed = 0; D.pose = null; D.idleT = 0; D.celebrate = 0; D.stageAt = null; D.hop = 0; latch = null; stopWalk();
    orbit.az = orbit.azT = 0; orbit.pitch = orbit.pitchT = 0.5; orbit.dist = orbit.distT = 13; camSnap = true; pan = 0;
    curtK = 1; if (CUR) CUR.setOpen(1);
    if (room.photo.backdrops.length) room.photo.setBackdrop(clamp(store.backdrop | 0, 0, room.photo.backdrops.length - 1));
    room.scene.add(dog.group);
    dog.group.position.set(D.x, 0, D.z); dog.group.rotation.set(0, D.heading, 0);
    keys.clear(); mouse.inside = false;
    ui_sync();
    updateCamera(0);
  }
  function exit() {
    C.on = false; hoverItem = null; hoverZone = null; pending = null; keys.clear();
    dog.bliss = 0; dog.lookAt(null);
    if (ctx.brain && ctx.brain.mover) ctx.brain.mover.ext = null;
    document.documentElement.dataset.petNoDrag = '';
    offBtn.style.display = 'none'; nameTag.style.display = 'none';
  }
  function update(dt) {
    if (!C.on) return;
    updateDress(dt);
    updateCamera(dt);
    updateCabinet(dt);
    updateOverlay(dt);
    room.update(dt);
  }

  // ------------------------------------------------------------------ 输入
  let rot = null, down = null;
  const browsing = () => C.mode === 'dress' && C.stage === 'browse';
  canvas.addEventListener('pointerdown', (e) => {
    if (!C.on) return;
    if (e.button === 2 && C.mode === 'free') { rot = { id: e.pointerId, x: e.clientX, y: e.clientY, az: orbit.azT, pitch: orbit.pitchT }; try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } return; }
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, far: 0, row: browsing() ? pickRow(e) : null, scroll0: 0 };
    if (down.row) down.scroll0 = down.row.scrollT;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!C.on) return;
    const r = canvas.getBoundingClientRect();
    mouse.inside = true; mouse.cx = e.clientX; mouse.cy = e.clientY;
    mouse.x = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1; mouse.y = -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1;
    if (rot && e.pointerId === rot.id) {
      if (!(e.buttons & 2)) { rot = null; return; }
      orbit.azT = rot.az - (e.clientX - rot.x) * 0.009;
      orbit.pitchT = clamp(rot.pitch + (e.clientY - rot.y) * 0.005, 0.14, 1.25);
      return;
    }
    if (down) down.far = Math.max(down.far, Math.hypot(e.clientX - down.x, e.clientY - down.y));
    if (browsing()) {
      // 按住左右拖：翻这一排（拖一格的宽度 = 滚一件）
      if (down && down.row && (e.buttons & 1)) {
        const a = project(down.row.sec.clip.x0, 1, cab.rows[0].z), b = project(down.row.sec.clip.x0 + down.row.row.pitch, 1, cab.rows[0].z);
        const px = Math.max(8, Math.abs(b.x - a.x));
        down.row.scrollT = clamp(down.scroll0 - (e.clientX - down.x) / px, 0, maxScroll(down.row));
      }
      hoverItem = down && down.far > 6 ? null : pickItem(e);
      // 鼠标在柜子上时按住拖动是翻衣服，不是拖窗口
      document.documentElement.dataset.petNoDrag = pickRow(e) ? '1' : '';
      canvas.style.cursor = hoverItem ? 'pointer' : 'default';
    } else { hoverItem = null; document.documentElement.dataset.petNoDrag = ''; }
  });
  const endDown = (e) => {
    if (rot && (!e || e.pointerId === rot.id)) rot = null;
    if (!C.on || !down || (e && e.button !== 0)) { down = null; return; }
    const moved = down.far, wasRow = down.row;
    down = null;
    if (wasRow) wasRow.scrollT = Math.round(wasRow.scrollT); // 松手对齐到整格
    if (moved > 6 || !e) return;
    if (C.mode === 'dress') { if (C.stage === 'browse') { const it = pickItem(e); if (it) choose(it.g.id); } return; }
    setRay(e);
    // 点小狗：换个姿势（照镜子 / 自拍 / 拍照时）
    if (C.mode === 'mirror' || C.mode === 'selfie' || C.mode === 'photo') {
      tmp.set(D.x, D.y + 0.6, D.z);
      if (ray.ray.distanceToPoint(tmp) < 0.62) { nextPose(); return; }
    }
    if (C.mode === 'free' || C.mode === 'mirror' || C.mode === 'photo') { if (ray.ray.intersectPlane(floor, hitP)) { D.pose = null; walkTo(hitP.x, hitP.z); } }
  };
  canvas.addEventListener('pointerup', endDown);
  canvas.addEventListener('pointercancel', () => endDown(null));
  canvas.addEventListener('pointerleave', () => { hoverItem = null; mouse.inside = false; });
  canvas.addEventListener('wheel', (e) => {
    if (!C.on) return;
    e.preventDefault();
    if (C.mode === 'free') orbit.distT = clamp(orbit.distT * Math.exp(e.deltaY * 0.0012), 6.5, 17);
    else if (browsing()) { const R = pickRow(e); if (R) R.scrollT = clamp(Math.round(R.scrollT) + (e.deltaY > 0 ? 1 : -1), 0, maxScroll(R)); }
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => { if (C.on) e.preventDefault(); });
  document.addEventListener('keydown', (e) => {
    if (!C.on) return;
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code)) { e.preventDefault(); keys.add(e.code); }
  });
  document.addEventListener('keyup', (e) => { keys.delete(e.code); });
  window.addEventListener('blur', () => { keys.clear(); rot = null; down = null; });

  function info() {
    return {
      on: C.on, mode: C.mode, stage: C.stage, curtain: +curtK.toFixed(2), pan: +pan.toFixed(2),
      dog: { x: +D.x.toFixed(2), y: +D.y.toFixed(2), z: +D.z.toFixed(2), heading: +D.heading.toFixed(2), speed: +D.speed.toFixed(2), pose: D.pose ? D.pose.id : null, walking: D.tx !== null, hop: D.hop > 0 }, zone: zoneAt(), latch,
      orbit: { az: +orbit.az.toFixed(2), pitch: +orbit.pitch.toFixed(2), dist: +orbit.dist.toFixed(2) },
      cam: camPos.toArray().map((v) => +v.toFixed(2)),
      walls: Object.fromEntries(room.walls.map((w) => [w.name, w.group.visible])),
      rows: rows.map((R) => ({ zone: R.zone, sec: R.secI, scroll: +R.scroll.toFixed(2), max: maxScroll(R), order: R.items.map((it) => it.g.id), shown: R.items.filter((it) => it.holder.visible).map((it) => it.g.id) })),
      hover: hoverItem ? hoverItem.g.id : null, lift: hoverItem ? +hoverItem.lift.toFixed(2) : 0, nameTag: nameTag.style.display !== 'none' ? nameTag.textContent : null,
      hoverZone, offBtn: offBtn.style.display !== 'none' ? offBtn.textContent : null,
      outfit: { ...(dog.outfit || {}) }, counts: { ...store.counts }, backdrop: room.photo.index, lastPhoto: C.lastPhoto || 0,
      bar: [...bar.querySelectorAll('button')].map((b) => b.textContent), title: title.textContent, back: backBtn.textContent, hint: hint.textContent,
    };
  }
  const toClient = (x, y, z) => { const p = project(x, y, z); const r = canvas.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; };
  C.itemScreen = (id) => { const it = itemById.get(id); return it ? toClient(it.holder.position.x, it.holder.position.y + 0.3, it.holder.position.z + 0.2) : null; };
  C.floorScreen = (x, z) => toClient(x, 0, z);
  C.dogScreen = () => toClient(D.x, D.y + 0.6, D.z);
  C.zoneScreen = (zone) => (zoneAnchors(zone) ? toClient(anchors[0].x, anchors[0].y, anchors[0].z) : null);
  C.nextPose = nextPose; C.zoneAt = zoneAt; C.backToBrowse = backToBrowse;
  C.orbit = orbit;
  return C;
}

export default createCloset;
