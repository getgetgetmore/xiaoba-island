// 衣帽间里面的玩法：控制小狗走动、右键 360° 转视角、逛橱柜（分区陈列、常穿的排前面、左右滑动、悬停取出、点开展示面板、穿上 / 脱下）、
// 照镜子、自拍、拍照区（换背景墙、摆固定姿势、保存照片）。
// 橱柜、镜子、拍照区都是“走到位置就触发”：走到橱柜跟前 / 镜子前的小地垫 / 跳上拍照区的圆台，镜头和界面自动切过去；走开就回到自由走动。
// 姿势不列按钮：一个“换个姿势”，或者直接点小狗，轮着换。
// 房间本身（墙、橱柜架子、镜子、拍照区）在 room.js；服饰（目录、穿在身上、陈列模型）在 garments.js；怎么进出衣帽间在 wardrobe.js。
//
// createCloset(ctx, { room, ui, onExit }) → closet = {
//   mode,                 // free 自由走动 | cabinet 逛橱柜 | item 看某一件 | mirror 照镜子 | selfie 自拍 | photo 拍照区
//   enter(), exit(),      // 进 / 出衣帽间（wardrobe.js 调用）
//   drive(dt, mover),     // 每帧在 brain 里调用（小狗模型更新之前）：算小狗的位置、朝向、动作，写进 mover.ext
//   update(dt),           // 每帧在 brain 之后调用：相机、藏墙、橱柜里的动画、界面
//   back(),               // Esc / 返回键：从子模式回到自由走动返回 true；已经在自由走动返回 false（由 wardrobe.js 退出衣帽间）
//   setMode(m), select(id), wear(id), takeOff(zone), walkTo(x, z), snap(), info(),   // 也给测试 / 调试用
// }
import * as THREE from 'three';
import { GARMENTS, ZONES, ZONE_NAMES, createGarmentDisplay } from './garments.js';

const FONT = '"Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif';
const STORE_KEY = 'shiba.wardrobe.v1';
const WALK_SPEED = 2.0, TURN_RATE = 7.5, DOG_R = 0.42;
const css = (el, o) => { Object.assign(el.style, o); return el; };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); return (a < 0 ? a + Math.PI * 2 : a) - Math.PI; };
const kOf = (rate, dt) => 1 - Math.exp(-rate * dt);

// 固定的拍照姿势（照镜子、自拍、拍照区共用）
export const POSES = [
  { id: 'stand', name: '站好', action: 'idle' },
  { id: 'sit', name: '坐好', action: 'sit' },
  { id: 'smile', name: '眯眼笑', action: 'sit', bliss: 1 },
  { id: 'lie', name: '趴下', action: 'lie' },
  { id: 'bow', name: '撅屁股', action: 'playbow' },
  { id: 'belly', name: '露肚皮', action: 'roll' },
];

// ---- 存档：身上穿着什么、每件穿过几次（常穿的排在橱柜前面）
export function loadWardrobe() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); if (s && typeof s === 'object') return { outfit: s.outfit || {}, counts: s.counts || {}, backdrop: s.backdrop | 0 }; } catch (_) { /* 没有存档 / 读不了 */ }
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
    mode: 'free', on: false,
    enter, exit, drive, update, back, setMode, select, wear, takeOff, walkTo, snap, info,
  };

  // ------------------------------------------------------------------ 小狗
  const D = { x: 0, y: 0, z: 0, heading: Math.PI, speed: 0, tx: null, tz: null, face: null, onArrive: null, stuckT: 0, idleT: 0, pose: null, poseT: 0, celebrate: 0, onStage: false, hop: 0, y0: 0 };
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
  // ---- 三个区：走到位置就触发
  const ZONE_R = { mirror: [0.6, 1.2], photo: [0.78, 1.08] }; // [进入半径, 离开半径]
  const dist2 = (p) => Math.hypot(D.x - p.x, D.z - p.z);
  function inCabinetStrip() { return D.z < room.cabinet.rows[0].z + 1.78 && D.x > room.cabinet.clip.x0 - 0.25 && D.x < room.cabinet.clip.x1 + 0.25; }
  /** (x, z) 这个位置属于哪个区（没有则 null） */
  function zoneOf(x, z) {
    if (Math.hypot(x - room.photo.standSpot.x, z - room.photo.standSpot.z) < ZONE_R.photo[0]) return 'photo';
    if (Math.hypot(x - room.mirror.standSpot.x, z - room.mirror.standSpot.z) < ZONE_R.mirror[0]) return 'mirror';
    if (z < room.cabinet.rows[0].z + 1.78 && x > room.cabinet.clip.x0 - 0.25 && x < room.cabinet.clip.x1 + 0.25) return 'cabinet';
    return null;
  }
  /** 小狗现在站在哪个区里 */
  const zoneAt = () => zoneOf(D.x, D.z);

  /** 小狗这一帧往哪儿走（在 brain 里、小狗模型更新之前调用） */
  function drive(dt, mover) {
    if (!C.on) return;
    let mvx = 0, mvz = 0, want = 0;
    if (C.mode !== 'item') {
      // 键盘：方向相对镜头（W = 往画面里走）。在橱柜 / 自拍模式里一动就是“走开”，回到自由走动
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      if (f || r) {
        if (C.mode === 'cabinet' || C.mode === 'selfie') leaveZone();
        stopWalk(); D.pose = null;
        const fx = -Math.sin(orbit.az), fz = -Math.cos(orbit.az), rx = Math.cos(orbit.az), rz = -Math.sin(orbit.az);
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
    // 区：自由走动时走进哪个区就触发哪个；照镜子 / 拍照时走出去就退出；人站在区里但没站正，自己挪到位
    if (C.mode === 'free') {
      const z = zoneAt();
      // 点地面走去别处、只是路过这个区：不触发（目的地就在这个区里，或者是用键盘走进来的，才触发）
      const passing = z && D.tx !== null && zoneOf(D.tx, D.tz) !== z;
      if (!z) latch = null; else if (z !== latch && !passing) enterZone(z);
    } else if (C.mode === 'mirror' || C.mode === 'photo') {
      const spot = room[C.mode].standSpot, d = dist2(spot);
      if (d > ZONE_R[C.mode][1]) leaveZone();
      else if (!want && D.tx === null && (d > 0.1 || Math.abs(wrap(room[C.mode].facing - D.heading)) > 0.08) && D.face === null) walkTo(spot.x, spot.z, room[C.mode].facing, () => { if (!D.pose) setPose('sit'); });
    }
    // 圆台（拍照区）比地面高一点：上去、下来都是跳一下
    const ps = room.photo.standSpot, onStage = Math.hypot(D.x - ps.x, D.z - ps.z) < 0.9;
    if (onStage !== D.onStage) { D.onStage = onStage; D.hop = 0.34; D.y0 = D.y; }
    if (D.hop > 0) { D.hop = Math.max(0, D.hop - dt); const u = 1 - D.hop / 0.34; D.y = D.y0 + ((onStage ? ps.y : 0) - D.y0) * u + Math.sin(Math.PI * u) * 0.26; }
    else D.y = onStage ? ps.y : 0;
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
    // 看哪儿：自拍 / 拍照看镜头，别的时候不特意看
    if ((C.mode === 'selfie' || C.mode === 'photo') && D.speed < 0.15) { camVec.copy(cam.position); dog.lookAt(camVec); } else dog.lookAt(null);
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

  // ------------------------------------------------------------------ 相机：右键拖动绕房间 360° 转、滚轮缩放；各个子模式有自己的机位
  const orbit = { az: 0, pitch: 0.5, dist: 13, azT: 0, pitchT: 0.5, distT: 13 };
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  let camSnap = true, showT = 0; // showT > 0：在橱柜前刚穿上一件，镜头暂时给小狗一个特写
  function desiredCamera() {
    switch (C.mode) {
      case 'cabinet': case 'item':
        if (showT > 0) { // 刚穿上：镜头切到小狗身上看它转一圈，再回橱柜
          wantPos.set(D.x - 1.9, D.y + 1.25, D.z + 2.9); wantLook.set(D.x, D.y + 0.62, D.z);
        } else { wantPos.copy(room.cabinet.viewSpot); wantLook.copy(room.cabinet.lookAt); }
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
    showT = Math.max(0, showT - dt);
    orbit.az += (orbit.azT - orbit.az) * kOf(10, dt);
    orbit.pitch += (orbit.pitchT - orbit.pitch) * kOf(10, dt);
    orbit.dist += (orbit.distT - orbit.dist) * kOf(10, dt);
    desiredCamera();
    if (camSnap) { camPos.copy(wantPos); camLook.copy(wantLook); camSnap = false; }
    else { const k = kOf(C.mode === 'free' ? 14 : 4.5, dt); camPos.lerp(wantPos, k); camLook.lerp(wantLook, k); }
    cam.position.copy(camPos); cam.lookAt(camLook); cam.updateMatrixWorld(true);
    // 相机转到哪面墙的背后，就把那面墙（连同靠墙的家具）藏起来
    for (const w of room.walls) {
      const half = Math.abs(w.normal.x) > 0.5 ? room.size.w / 2 : room.size.d / 2;
      w.group.visible = w.normal.x * camPos.x + w.normal.z * camPos.z > -half + 0.05;
    }
  }

  // ------------------------------------------------------------------ 橱柜里的陈列
  const cab = room.cabinet, north = room.walls.find((w) => w.name === cab.wall) || room.walls[0];
  const rows = []; // { zone, row, items: [{ g, holder, hit, lift, show, x }], scroll, scrollT }
  const itemById = new Map(), hits = [];
  let hoverItem = null, selected = null, dragRow = null;
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const RAIL_H = 0.6; // 挂衣杆比“衣服”那一排的底部高出多少（room.js 里杆子在 y = 2.1，这一排 y = 1.5）
  function buildCabinet() {
    if (rows.length) return;
    for (const row of cab.rows) {
      const list = GARMENTS.filter((g) => g.zone === row.zone);
      const R = { zone: row.zone, row, items: [], scroll: 0, scrollT: 0 };
      for (const g of list) {
        const holder = new THREE.Group();
        const model = createGarmentDisplay(g.id);
        holder.add(model);
        const hit = new THREE.Mesh(new THREE.BoxGeometry(cab.rows[0].pitch * 0.92, 0.62, 0.55), hitMat);
        hit.position.y = 0.3; holder.add(hit);
        north.group.add(holder);
        // 衣服是吊在挂衣杆下面的：按这件的高度往上提，让细绳的顶端正好够到杆子（杆子在这一排底部往上 RAIL_H 处）
        const dy = row.zone === 'top' ? Math.max(0, RAIL_H - new THREE.Box3().setFromObject(model).max.y) : 0;
        const it = { g, holder, model, hit, lift: 0, show: 0, x: 0, R, dy };
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
  const showcase = new THREE.Vector3(), SHOW_YAW = -0.38, SHOW_SCALE = 2.6; // 展示时：稍微侧过来一点、放大到 2.6 倍
  function updateCabinet(dt) {
    const t = performance.now() / 1000;
    for (const R of rows) {
      R.scrollT = clamp(R.scrollT, 0, maxScroll(R));
      R.scroll += (R.scrollT - R.scroll) * kOf(10, dt);
      R.items.forEach((it, i) => {
        const x = cab.slotX(0) + (i - R.scroll) * R.row.pitch;
        it.x = x;
        const inside = x > cab.clip.x0 + R.row.pitch * 0.3 && x < cab.clip.x1 - R.row.pitch * 0.3;
        const isSel = selected === it;
        it.lift += ((hoverItem === it || isSel ? 1 : 0) - it.lift) * kOf(12, dt); // 点开的那件保持“取出”的状态
        it.show += ((isSel ? 1 : 0) - it.show) * kOf(3.4, dt);                        // 再从取出的位置逐渐放大到展示位置（约 1 秒）
        it.holder.visible = inside || it.show > 0.02;
        it.hit.visible = inside; // 看不见的不参与点选（hit 的材质本身不可见，这里只是让射线跳过它）
        // 平时在格子里；鼠标移上去往上取出一截；点开以后从取出的位置逐渐放大到橱柜前面（不转，稍微侧一点角度，像穿在小狗身上那样横着）
        const y = R.row.y + it.dy + (it.dy > 0 ? 0.1 : 0.22) * it.lift, z = R.row.z + (it.dy > 0 ? 0.32 : 0.12) * it.lift; // 吊着的衣服上面就是杆子：取出时主要是往外拿
        showcase.set((cab.clip.x0 + cab.clip.x1) / 2, cab.lookAt.y - 0.15, R.row.z + 1.35);
        const e = it.show * it.show * (3 - 2 * it.show);
        it.holder.position.set(x + (showcase.x - x) * e, y + (showcase.y - y) * e, z + (showcase.z - z) * e);
        it.holder.rotation.set(0, Math.sin(t * 3) * 0.12 * it.lift * (1 - e) + SHOW_YAW * e, 0);
        it.holder.scale.setScalar(1 + 0.1 * it.lift * (1 - e) + (SHOW_SCALE - 1) * e);
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
  /** 鼠标在橱柜的哪一排上（按高度算），没有则 null */
  function pickRow(e) {
    setRay(e);
    const z = cab.rows[0].z, t = (z - ray.ray.origin.z) / (ray.ray.direction.z || -1e-6);
    if (t <= 0) return null;
    const x = ray.ray.origin.x + ray.ray.direction.x * t, y = ray.ray.origin.y + ray.ray.direction.y * t;
    if (x < cab.clip.x0 - 0.2 || x > cab.clip.x1 + 0.2) return null;
    let best = null, bd = 1e9;
    for (const R of rows) { const d = Math.abs(y - (R.row.y + 0.3)); if (d < bd) { bd = d; best = R; } }
    return bd < 0.6 ? best : null;
  }

  function select(id) {
    const it = itemById.get(id);
    if (!it) return false;
    selected = it; C.mode = 'item';
    // 这一件不在可视范围里就把这一排滚过去
    const i = it.R.items.indexOf(it);
    if (i < it.R.scrollT) it.R.scrollT = i; else if (i > it.R.scrollT + cab.visible - 1) it.R.scrollT = i - cab.visible + 1;
    ui_sync();
    return true;
  }
  function step(dir) { // 展示面板里的“上一件 / 下一件”：同一个分区里循环
    if (!selected) return;
    const L = selected.R.items, i = (L.indexOf(selected) + dir + L.length) % L.length;
    select(L[i].g.id);
  }
  function persist() { store.outfit = { ...(dog.outfit || {}) }; saveWardrobe(store); }
  function wear(id) {
    const it = itemById.get(id) || { g: GARMENTS.find((g) => g.id === id) };
    if (!it.g || typeof dog.wear !== 'function' || !dog.wear(it.g.zone, id)) return false;
    store.counts[id] = (store.counts[id] || 0) + 1;
    persist();
    D.celebrate = 1.2; D.pose = null; // 换上新衣服：开心地转一圈
    if (C.mode === 'cabinet' || C.mode === 'item') showT = 2.1; // 在橱柜前穿的：镜头给它一个特写
    ui_sync();
    return true;
  }
  function takeOff(zone) {
    if (typeof dog.wear !== 'function') return false;
    dog.wear(zone, null); persist(); ui_sync();
    return true;
  }
  const worn = (id) => !!(dog.outfit && ZONES.some((z) => dog.outfit[z] === id));

  // ------------------------------------------------------------------ 界面
  const pill = { borderRadius: '999px', boxShadow: '0 3px 10px rgba(40,20,5,0.25)', font: `600 13px/1.3 ${FONT}`, whiteSpace: 'nowrap' };
  const btnStyle = { ...pill, border: 'none', padding: '6px 13px', cursor: 'pointer', pointerEvents: 'auto', background: '#fff8e8', color: '#4a2a14', webkitAppRegion: 'no-drag' };
  const mkBtn = (text, onClick, extra) => { const b = css(document.createElement('button'), { ...btnStyle, ...(extra || {}) }); b.type = 'button'; b.textContent = text; b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); b.addEventListener('pointerdown', (e) => e.stopPropagation()); return b; };
  const mkDiv = (style, text) => { const d = css(document.createElement('div'), style); if (text !== undefined) d.textContent = text; return d; };
  const title = mkDiv({ ...pill, position: 'absolute', left: '50%', top: '10px', transform: 'translateX(-50%)', padding: '5px 18px', background: 'rgba(255,248,232,0.94)', color: '#4a2a14', fontWeight: '700', fontSize: '15px', letterSpacing: '2px' }, '衣帽间');
  const backBtn = mkBtn('← 返回小岛', () => { if (!back()) onExit(); }, { position: 'absolute', left: '10px', top: '10px', background: '#c9783a', color: '#fff8e8' });
  const hint = mkDiv({ ...pill, position: 'absolute', left: '50%', top: '44px', transform: 'translateX(-50%)', padding: '3px 12px', background: 'rgba(74,42,20,0.72)', color: '#fff8e8', fontWeight: '400', fontSize: '12px', maxWidth: 'calc(100% - 20px)', overflow: 'hidden', textOverflow: 'ellipsis', boxSizing: 'border-box' });
  const bar = mkDiv({ position: 'absolute', left: '50%', bottom: '12px', transform: 'translateX(-50%)', display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: 'calc(100% - 16px)' });
  // 展示面板：某一件服饰的名字、介绍，穿上 / 脱下，上一件 / 下一件
  const panel = mkDiv({ position: 'absolute', left: '50%', bottom: '12px', transform: 'translateX(-50%)', display: 'none', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '16px', background: 'rgba(255,248,232,0.96)', boxShadow: '0 4px 16px rgba(40,20,5,0.3)', pointerEvents: 'auto', maxWidth: 'calc(100% - 16px)', boxSizing: 'border-box', color: '#4a2a14', font: `13px/1.4 ${FONT}` });
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  const pPrev = mkBtn('◀', () => step(-1), { padding: '6px 10px', background: '#f0dcb4' });
  const pNext = mkBtn('▶', () => step(1), { padding: '6px 10px', background: '#f0dcb4' });
  const pInfo = mkDiv({ minWidth: '120px', textAlign: 'center', flex: '1 1 auto', overflow: 'hidden' });
  const pZone = mkDiv({ fontSize: '11px', opacity: '0.7' }), pName = mkDiv({ fontWeight: '700', fontSize: '15px' }), pDesc = mkDiv({ fontSize: '12px', opacity: '0.85', whiteSpace: 'normal' });
  pInfo.append(pZone, pName, pDesc);
  const pWear = mkBtn('穿上', () => { if (!selected) return; if (worn(selected.g.id)) takeOff(selected.g.zone); else wear(selected.g.id); }, { background: '#c9783a', color: '#fff8e8', padding: '7px 16px' });
  const pClose = mkBtn('✕', () => { selected = null; C.mode = 'cabinet'; ui_sync(); }, { padding: '6px 9px', background: '#f0dcb4' });
  panel.append(pPrev, pInfo, pNext, pWear, pClose);
  // 橱柜每排两头的翻页箭头、“穿着中”的小标签（跟着 3D 位置走）
  const overlay = mkDiv({ position: 'absolute', inset: '0', pointerEvents: 'none' });
  const arrows = [], badges = [];
  const flash = mkDiv({ position: 'absolute', inset: '0', background: '#fff', opacity: '0', pointerEvents: 'none', transition: 'opacity 0.25s ease' });
  ui.append(title, backBtn, hint, bar, panel, overlay, flash);

  const HINTS = {
    free: 'WASD 或点地面走动 · 右键转视角 · 走到橱柜前、镜子前、圆台上试试',
    cabinet: '滚轮或按住拖动左右翻看 · 点一件看看 · 走开就离开橱柜',
    item: '◀ ▶ 看上一件 / 下一件',
    mirror: '照照镜子——点小狗换个姿势，走开就离开',
    selfie: '看镜头——点小狗换个姿势，咔嚓！',
    photo: '换个背景，点小狗换个姿势，咔嚓！走下圆台就离开',
  };
  let lastUi = '';
  function ui_sync() {
    const key = [C.mode, selected ? selected.g.id + worn(selected.g.id) : '', D.pose ? D.pose.id : '', room.photo.index, JSON.stringify(dog.outfit || {})].join('|');
    if (key === lastUi) return;
    lastUi = key;
    backBtn.textContent = C.mode === 'free' ? '← 返回小岛' : '← 返回';
    title.textContent = { free: '衣帽间', cabinet: '橱柜', item: '橱柜', mirror: '照镜子', selfie: '自拍', photo: '拍照区' }[C.mode];
    hint.textContent = HINTS[C.mode];
    panel.style.display = C.mode === 'item' ? 'flex' : 'none';
    bar.style.display = C.mode === 'item' ? 'none' : 'flex';
    bar.textContent = '';
    const poseBtn = () => mkBtn('🐾 换个姿势' + (D.pose ? '（' + D.pose.name + '）' : ''), () => nextPose());
    const shoot = () => mkBtn('📷 咔嚓', () => snap(), { background: '#c9783a', color: '#fff8e8' });
    if (C.mode === 'free') bar.append(mkBtn('🤳 自拍', () => setMode('selfie')));
    else if (C.mode === 'cabinet') bar.append(...ZONES.filter((z) => dog.outfit && dog.outfit[z]).map((z) => mkBtn('脱下' + ZONE_NAMES[z], () => takeOff(z))));
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
    if (C.mode === 'item' && selected) {
      const g = selected.g;
      pZone.textContent = ZONE_NAMES[g.zone] || g.zone; pName.textContent = g.name; pDesc.textContent = g.desc || '';
      pWear.textContent = worn(g.id) ? '脱下' : '穿上';
    }
  }
  const scr = new THREE.Vector3();
  function project(x, y, z) { scr.set(x, y, z).project(cam); const r = canvas.getBoundingClientRect(); return { x: (scr.x * 0.5 + 0.5) * r.width, y: (-scr.y * 0.5 + 0.5) * r.height, ok: scr.z < 1 }; }
  function updateOverlay() {
    const show = C.mode === 'cabinet' && rows.length > 0;
    overlay.style.display = show ? 'block' : 'none';
    if (!show) return;
    // 翻页箭头：这一排还有没露出来的才显示
    let ai = 0;
    for (const R of rows) {
      for (const dir of [-1, 1]) {
        const can = dir < 0 ? R.scrollT > 0.01 : R.scrollT < maxScroll(R) - 0.01;
        let a = arrows[ai];
        if (!a) { a = mkBtn('', () => {}, { position: 'absolute', padding: '4px 8px', transform: 'translate(-50%, -50%)', background: 'rgba(255,248,232,0.94)' }); overlay.appendChild(a); arrows[ai] = a; a.addEventListener('click', () => { const r = a._row; if (r) r.scrollT = clamp(Math.round(r.scrollT) + a._dir, 0, maxScroll(r)); }); }
        ai++;
        a._row = R; a._dir = dir; a.textContent = dir < 0 ? '◀' : '▶';
        const p = project(dir < 0 ? cab.clip.x0 - 0.02 : cab.clip.x1 + 0.02, R.row.y + 0.3, R.row.z + 0.25);
        a.style.display = can && p.ok ? '' : 'none'; a.style.left = p.x + 'px'; a.style.top = p.y + 'px';
      }
    }
    // “穿着中”的小标签
    let bi = 0;
    for (const z of ZONES) {
      const id = dog.outfit && dog.outfit[z], it = id ? itemById.get(id) : null;
      if (!it || !it.holder.visible || it.show > 0.05) continue;
      let b = badges[bi];
      if (!b) { b = mkDiv({ ...pill, position: 'absolute', padding: '1px 7px', transform: 'translate(-50%, -50%)', background: '#5fae5a', color: '#fff', fontSize: '11px' }, '穿着中'); overlay.appendChild(b); badges[bi] = b; }
      bi++;
      const p = project(it.holder.position.x, it.holder.position.y + 0.6, it.holder.position.z + 0.2);
      b.style.display = p.ok ? '' : 'none'; b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
    }
    for (; bi < badges.length; bi++) badges[bi].style.display = 'none';
  }

  // ------------------------------------------------------------------ 模式
  /** 走进了某个区：切到对应的模式 */
  function enterZone(z) { latch = null; setMode(z); }
  /** 离开当前的区，回到自由走动（人要是还站在区里，走出去之前不再触发） */
  function leaveZone() { if (C.mode === 'free') return; setMode('free'); latch = zoneAt(); }

  function setMode(m) {
    if (!C.on || m === C.mode) return;
    selected = null; hoverItem = null; D.pose = null;
    if (m !== 'free' && m !== 'mirror' && m !== 'photo') keys.clear(); // 走进镜子 / 圆台时手还按着方向键：让它接着走
    C.mode = m;
    if (m === 'cabinet') {
      sortRows(); // 每次打开橱柜按“常穿”重排一次（逛的过程中不重排，免得衣服在眼前换位置）
      // 小狗走到橱柜旁边坐着看
      const z = cab.rows[0].z + 1.55;
      walkTo(Math.min(room.walk.x1, cab.clip.x1 + 0.75), z, Math.atan2(cab.viewSpot.x - (cab.clip.x1 + 0.75), cab.viewSpot.z - z), () => { if (C.mode === 'cabinet' || C.mode === 'item') D.pose = POSES[1]; });
    } else if (m === 'mirror') {
      if (!keys.size) walkTo(room.mirror.standSpot.x, room.mirror.standSpot.z, room.mirror.facing, () => { if (C.mode === 'mirror' && !D.pose) setPose('sit'); });
    } else if (m === 'photo') {
      if (!keys.size) walkTo(room.photo.standSpot.x, room.photo.standSpot.z, room.photo.facing, () => { if (C.mode === 'photo' && !D.pose) setPose('sit'); });
    } else if (m === 'selfie') {
      stopWalk(); D.pose = POSES[2]; // 自拍：就地坐下眯眼笑
    } // 回到自由走动：不打断正在走的路（走出镜子 / 圆台的范围时会到这儿，它要接着走到点的地方）
    ui_sync();
  }
  function back() {
    if (!C.on) return false;
    if (C.mode === 'item') { selected = null; C.mode = 'cabinet'; ui_sync(); return true; }
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
    C.on = true; C.mode = 'free'; selected = null; hoverItem = null; lastUi = '';
    const s = room.dogSpot.position;
    D.x = s.x; D.y = 0; D.z = s.z; D.heading = Math.PI; D.speed = 0; D.pose = null; D.idleT = 0; D.celebrate = 0; D.onStage = false; D.hop = 0; latch = null; stopWalk();
    orbit.az = orbit.azT = 0; orbit.pitch = orbit.pitchT = 0.5; orbit.dist = orbit.distT = 13; camSnap = true;
    if (room.photo.backdrops.length) room.photo.setBackdrop(clamp(store.backdrop | 0, 0, room.photo.backdrops.length - 1));
    room.scene.add(dog.group);
    dog.group.position.set(D.x, 0, D.z); dog.group.rotation.set(0, D.heading, 0);
    keys.clear();
    ui_sync();
    updateCamera(0);
  }
  function exit() {
    C.on = false; selected = null; hoverItem = null; keys.clear();
    dog.bliss = 0; dog.lookAt(null);
    if (ctx.brain && ctx.brain.mover) ctx.brain.mover.ext = null;
    document.documentElement.dataset.petNoDrag = '';
  }
  function update(dt) {
    if (!C.on) return;
    updateCamera(dt);
    updateCabinet(dt);
    updateOverlay();
    room.update(dt);
  }

  // ------------------------------------------------------------------ 输入
  let rot = null, down = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!C.on) return;
    if (e.button === 2 && C.mode === 'free') { rot = { id: e.pointerId, x: e.clientX, y: e.clientY, az: orbit.azT, pitch: orbit.pitchT }; try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } return; }
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, far: 0, row: C.mode === 'cabinet' ? pickRow(e) : null, scroll0: 0 };
    if (down.row) { down.scroll0 = down.row.scrollT; dragRow = down.row; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!C.on) return;
    if (rot && e.pointerId === rot.id) {
      if (!(e.buttons & 2)) { rot = null; return; }
      orbit.azT = rot.az - (e.clientX - rot.x) * 0.009;
      orbit.pitchT = clamp(rot.pitch + (e.clientY - rot.y) * 0.005, 0.14, 1.25);
      return;
    }
    if (down) down.far = Math.max(down.far, Math.hypot(e.clientX - down.x, e.clientY - down.y));
    if (C.mode === 'cabinet') {
      // 按住左右拖：翻这一排（拖一格的宽度 = 滚一件）
      if (down && down.row && (e.buttons & 1)) {
        const r = canvas.getBoundingClientRect(), a = project(0, 1, cab.rows[0].z), b = project(down.row.row.pitch, 1, cab.rows[0].z);
        const px = Math.max(8, Math.abs(b.x - a.x));
        down.row.scrollT = clamp(down.scroll0 - (e.clientX - down.x) / px, 0, maxScroll(down.row));
        void r;
      }
      hoverItem = down && down.far > 6 ? null : pickItem(e);
      // 鼠标在橱柜上时按住拖动是翻衣服，不是拖窗口
      document.documentElement.dataset.petNoDrag = pickRow(e) ? '1' : '';
      canvas.style.cursor = hoverItem ? 'pointer' : 'default';
    } else { hoverItem = null; document.documentElement.dataset.petNoDrag = ''; }
  });
  const endDown = (e) => {
    if (rot && (!e || e.pointerId === rot.id)) rot = null;
    if (!C.on || !down || (e && e.button !== 0)) { down = null; dragRow = null; return; }
    const moved = down.far, wasRow = down.row;
    down = null; dragRow = null;
    if (wasRow) wasRow.scrollT = Math.round(wasRow.scrollT); // 松手对齐到整格
    if (moved > 6 || !e) return;
    if (C.mode === 'cabinet') { const it = pickItem(e); if (it) select(it.g.id); return; }
    if (C.mode === 'item') { const it = pickItem(e); if (it && it !== selected) select(it.g.id); return; }
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
  canvas.addEventListener('pointerleave', () => { hoverItem = null; });
  canvas.addEventListener('wheel', (e) => {
    if (!C.on) return;
    e.preventDefault();
    if (C.mode === 'free') orbit.distT = clamp(orbit.distT * Math.exp(e.deltaY * 0.0012), 6.5, 17);
    else if (C.mode === 'cabinet') { const R = pickRow(e) || rows[0]; if (R) R.scrollT = clamp(Math.round(R.scrollT) + (e.deltaY > 0 ? 1 : -1), 0, maxScroll(R)); }
    else if (C.mode === 'item') step(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => { if (C.on) e.preventDefault(); });
  document.addEventListener('keydown', (e) => {
    if (!C.on) return;
    if (C.mode === 'item' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { e.preventDefault(); step(e.code === 'ArrowLeft' ? -1 : 1); return; }
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code)) { if (C.mode !== 'item') { e.preventDefault(); keys.add(e.code); } }
  });
  document.addEventListener('keyup', (e) => { keys.delete(e.code); });
  window.addEventListener('blur', () => { keys.clear(); rot = null; down = null; });

  function info() {
    return {
      on: C.on, mode: C.mode, dog: { x: +D.x.toFixed(2), y: +D.y.toFixed(2), z: +D.z.toFixed(2), heading: +D.heading.toFixed(2), speed: +D.speed.toFixed(2), pose: D.pose ? D.pose.id : null, walking: D.tx !== null, hop: D.hop > 0 }, zone: zoneAt(), latch,
      orbit: { az: +orbit.az.toFixed(2), pitch: +orbit.pitch.toFixed(2), dist: +orbit.dist.toFixed(2) },
      cam: camPos.toArray().map((v) => +v.toFixed(2)),
      walls: Object.fromEntries(room.walls.map((w) => [w.name, w.group.visible])),
      rows: rows.map((R) => ({ zone: R.zone, scroll: +R.scroll.toFixed(2), max: maxScroll(R), order: R.items.map((it) => it.g.id), shown: R.items.filter((it) => it.holder.visible).map((it) => it.g.id) })),
      hover: hoverItem ? hoverItem.g.id : null, lift: hoverItem ? +hoverItem.lift.toFixed(2) : 0, selected: selected ? selected.g.id : null, showOff: showT > 0,
      outfit: { ...(dog.outfit || {}) }, counts: { ...store.counts }, backdrop: room.photo.index, lastPhoto: C.lastPhoto || 0,
      panel: panel.style.display !== 'none' ? { zone: pZone.textContent, name: pName.textContent, wear: pWear.textContent } : null,
      bar: [...bar.querySelectorAll('button')].map((b) => b.textContent), title: title.textContent, back: backBtn.textContent,
    };
  }
  C.itemScreen = (id) => { const it = itemById.get(id); if (!it) return null; const p = project(it.holder.position.x, it.holder.position.y + 0.3, it.holder.position.z + 0.2); const r = canvas.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; };
  C.floorScreen = (x, z) => { const p = project(x, 0, z); const r = canvas.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; };
  C.dogScreen = () => { const p = project(D.x, D.y + 0.6, D.z); const r = canvas.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; };
  C.nextPose = nextPose; C.zoneAt = zoneAt;
  C.showInfo = (id) => { const it = itemById.get(id); return it ? { scale: +it.holder.scale.x.toFixed(3), yaw: +it.holder.rotation.y.toFixed(3), show: +it.show.toFixed(3), lift: +it.lift.toFixed(3) } : null; };
  C.orbit = orbit;
  return C;
}

export default createCloset;
