// 木棍与点击交互（WP5）。接口对应 DESIGN.md 3.7。
// 状态：hidden → held → flying → landed → carried → returning → held ...
// 浏览器里监听 renderer.domElement 的 pointer 事件；Node 无头下完全不碰 document/window。
import * as THREE from 'three';
import { paintMaterial } from '../core/paint.js';
import { clamp, damp, wrapAngle } from '../core/util.js';

const IDLE_TIMEOUT = 10;
const APPEAR_RATE = 9; // 缩放/淡入阻尼系数
const RETURN_TIME = 0.5;
const ATTACH_BLEND = 0.18; // 落地木棍被叼进嘴里的过渡时间
const MIN_FRONT_DIST = 1.5;
const STICK_LEN = 0.48; // 短粗的树枝（原 0.7 偏长）
const _ray = new THREE.Vector3();
const STICK_SCALE = 1.55; // 视觉放大（与放大后的狗匹配）；叼在嘴里时按狗的缩放反算，保证大小前后一致

function buildStickMesh(material, endMaterial) {
  const g = new THREE.Group();
  const H = STICK_LEN / 2;
  // 略弯的粗树枝：沿本地 X 轴
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-H, 0.012, 0),
    new THREE.Vector3(-H * 0.4, 0.03, 0.006),
    new THREE.Vector3(H * 0.3, 0.004, -0.006),
    new THREE.Vector3(H, -0.03, 0),
  ]);
  const tube = new THREE.TubeGeometry(curve, 14, 0.035, 7, false);
  { // 树皮凹凸：半径沿长度起伏，再加一点逐顶点的不规则
    const pa = tube.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      const x = pa.getX(k);
      const t = (x + H) / STICK_LEN;
      const c = curve.getPoint(Math.min(1, Math.max(0, t)));
      const f = 1 + 0.16 * Math.sin(t * 7.1 + 0.6) + 0.1 * Math.sin(t * 17.0 + k * 0.7) + 0.12 * (1 - t);
      pa.setY(k, c.y + (pa.getY(k) - c.y) * f);
      pa.setZ(k, c.z + (pa.getZ(k) - c.z) * f);
    }
    tube.computeVertexNormals();
  }
  const body = new THREE.Mesh(tube, material);
  body.castShadow = true;
  g.add(body);
  // 两端：折断露出的浅色木头（略参差）
  for (const sgn of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.033, 0), endMaterial);
    const p = curve.getPoint(sgn < 0 ? 0 : 1);
    cap.position.set(p.x + sgn * 0.004, p.y, p.z);
    cap.scale.set(0.42, sgn < 0 ? 1.12 : 0.96, 1.05);
    cap.rotation.set(0.4 * sgn, 0, 0.25 * sgn);
    cap.castShadow = true;
    g.add(cap);
  }
  // 一个小断杈（树皮色，顶端浅色断面）
  const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.021, 0.07, 6), material);
  nub.position.set(-H * 0.42, 0.064, 0.006);
  nub.rotation.set(0.1, 0, 0.5);
  nub.castShadow = true;
  g.add(nub);
  const nubTop = new THREE.Mesh(new THREE.IcosahedronGeometry(0.015, 0), endMaterial);
  nubTop.position.set(-H * 0.42 - 0.017, 0.095, 0.006);
  nubTop.scale.set(1, 0.5, 1);
  nubTop.rotation.z = 0.5;
  g.add(nubTop);
  return g;
}

export function createStick(ctx) {
  const group = new THREE.Group();
  group.name = 'stick';
  group.rotation.order = 'YXZ'; // 先绕本地 Z 翻滚，再绕 Y 指向，翻滚平面始终在飞行方向上

  // 偏暖的浅木色（在青绿色草地上醒目），沿长度方向的木纹笔触；会动的物体用 local 空间
  const material = paintMaterial(
    { color: 0x7d5f48, roughness: 1, flatShading: true, transparent: true, opacity: 0 },
    { scale: 7, strength: 0.34, hue: 0.5, bands: 0.3, levels: 3, stretch: [1, 3, 3], space: 'local' },
  );
  // 折断处露出的浅色木头
  const endMaterial = paintMaterial(
    { color: 0xd9b88c, roughness: 1, flatShading: true, transparent: true, opacity: 0 },
    { scale: 9, strength: 0.2, hue: 0.4, bands: 0.2, space: 'local' },
  );
  const mesh = buildStickMesh(material, endMaterial);
  group.add(mesh);
  group.visible = false;

  const front = ctx.island && ctx.island.anchors ? ctx.island.anchors.front : null;
  const handPos = front ? new THREE.Vector3(front.x + 1.8, front.y + 0.95, front.z + 2.9) /* “手”在岛沿外侧、狗的斜前方近镜头处：不挡住狗，狗会扭头盯着它 */ : new THREE.Vector3(0, 1.5, 7.2);
  const position = new THREE.Vector3().copy(handPos);
  const targetVec = new THREE.Vector3();

  // ---- 玩具架上的位置：树枝不玩的时候斜靠在狗窝外墙玩具架的格子里；点它才开始“扔树枝”，玩完自己飞回架子 ----
  // 对其他模块来说，state 'hidden' 的含义不变（树枝不在场上）；有架子时只是把它画在架子上，而不是隐藏。
  const shelf = ctx.island && ctx.island.shelf ? ctx.island.shelf : null;
  const restPos = new THREE.Vector3();
  const restQuat = new THREE.Quaternion();
  let slot = null;
  let hover = 0, hoverWant = 0; // 鼠标悬停在格子上的程度（平滑）
  let homeT = 1;                // 飞回架子的进度（1 = 已在架子上）
  // 在架子上时按格子的大小缩小摆放（约占格子的七成）；被拿起来互动时才变回正常大小
  const SHELF_K = 0.66;
  let sizeK = 1;                // 当前的大小系数（1 = 正常大小）
  const homeFrom = new THREE.Vector3();
  const homeFromQuat = new THREE.Quaternion();
  if (shelf) {
    slot = shelf.claim('stick', { onClick: () => click(null), onHover: (on) => { hoverWant = on ? 1 : 0; } });
    if (slot) {
      // 斜靠：树枝的长轴（本地 X）在墙面内，从左下指向右上
      const LEAN = 0.98;
      const ax = new THREE.Vector3().copy(shelf.right).multiplyScalar(Math.cos(LEAN)).addScaledVector(shelf.up, Math.sin(LEAN));
      const az = new THREE.Vector3().copy(shelf.normal);
      const ay = new THREE.Vector3().crossVectors(az, ax);
      restQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, az));
      restPos.copy(slot.position).addScaledVector(shelf.up, -0.02);
      position.copy(restPos);
      group.position.copy(restPos);
      group.quaternion.copy(restQuat);
      group.visible = true;
      sizeK = SHELF_K;
    }
  }

  const stick = {
    group,
    state: 'hidden',
    position,
    handPos,
    target: null,
    idleTimeout: IDLE_TIMEOUT,
    click,
    attachTo,
    release,
    recall,
    dismiss,
    update,
  };

  // ---- 内部状态 ----
  let heldTime = 0;
  let time = 0;
  let appear = 0; // 0..1 出现程度（缩放+透明度）
  let flightT = 0, flightDur = 1, flightPeak = 2, flightSpin = 0, flightYaw = 0;
  const from = new THREE.Vector3();
  let zStart = 0, zEnd = 0;
  let landT = 0; // 落地后的弹跳计时
  let landYaw = 0;
  let carrier = null;
  let homeParent = null;
  let blendT = 0;
  const blendPos = new THREE.Vector3();
  const blendQuat = new THREE.Quaternion();
  const _q = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  // 鼠标跟随（NDC -1..1），手持时给出小幅偏移
  const mouse = { x: 0, y: 0, sx: 0, sy: 0, inside: false, seen: false, outT: 0, lastX: -1e9, lastY: -1e9 };
  let cursorCache = '';

  const lawnPoint = () => {
    const a = ctx.island && ctx.island.anchors;
    return a && a.lawn ? { x: a.lawn.x, z: a.lawn.z } : { x: 0, z: 0 };
  };

  function enterHeld() {
    stick.state = 'held';
    heldTime = 0;
    stick.target = null;
  }

  function reparentToWorld() {
    if (group.parent && group.parent !== homeParent && homeParent) {
      group.removeFromParent();
      homeParent.add(group);
    }
    group.scale.setScalar(1);
  }

  function click(worldPoint) {
    // 小游戏（遛狗 / 钓鱼）进行中不能拿出树枝：指针事件那边已经拦了，这里把接口本身也拦住
    if (stick.state === 'hidden' && ((ctx.game && ctx.game.active) || (ctx.fishing && ctx.fishing.active))) return;
    if (stick.state === 'hidden' && ctx.travel && ctx.travel.blockPlay()) return; // 小狗乘白鹭出门了 / 正要走：给个提示，不拿树枝
    heldTime = 0; // 任何点击都刷新交互时间
    switch (stick.state) {
      case 'hidden':
        if (slot) {
          // 从架子上（或飞回架子的半路上）拿起来：位置、朝向从当前值平滑过渡到手上
          position.copy(group.position);
          homeT = 1;
          hoverWant = 0;
        } else {
          position.copy(handPos);
          appear = Math.min(appear, 0.02);
          group.rotation.set(0, 0, 0);
        }
        enterHeld();
        break;
      case 'held':
        throwTo(worldPoint);
        break;
      default:
        break;
    }
  }

  function throwTo(worldPoint) {
    const isl = ctx.island;
    let px, pz;
    if (worldPoint && Number.isFinite(worldPoint.x) && Number.isFinite(worldPoint.z)) {
      px = worldPoint.x;
      pz = worldPoint.z;
    } else {
      const l = lawnPoint();
      px = l.x;
      pz = l.z;
    }
    let tx = px, tz = pz;
    if (isl) {
      let c = isl.clampWalkable(px, pz);
      tx = c.x;
      tz = c.z;
      // 别扔到离 front 太近的地方：沿 front→落点 的方向推远
      const f = isl.anchors.front;
      let dx = tx - f.x, dz = tz - f.z;
      let d = Math.hypot(dx, dz);
      if (d < MIN_FRONT_DIST) {
        if (d < 1e-4) { dx = 0; dz = -1; d = 1; }
        c = isl.clampWalkable(f.x + (dx / d) * MIN_FRONT_DIST * 1.05, f.z + (dz / d) * MIN_FRONT_DIST * 1.05);
        tx = c.x;
        tz = c.z;
        if (Math.hypot(tx - f.x, tz - f.z) < MIN_FRONT_DIST * 0.95) {
          // 被障碍挡住：改扔向草坪
          const l = lawnPoint();
          c = isl.clampWalkable(l.x, l.z);
          tx = c.x;
          tz = c.z;
        }
      }
    }
    const ty = isl ? isl.heightAt(tx, tz) : 0;
    targetVec.set(tx, ty, tz);
    stick.target = targetVec;
    from.copy(position);
    const dist = Math.hypot(tx - from.x, tz - from.z);
    flightDur = clamp(0.8 + dist * 0.045, 0.8, 1.4);
    flightPeak = 1.1 + dist * 0.12;
    flightT = 0;
    flightYaw = Math.atan2(-(tz - from.z), tx - from.x); // 木棍本地 X 指向飞行方向
    group.rotation.y = flightYaw;
    zStart = group.rotation.z;
    zEnd = Math.round((zStart + Math.PI * 5) / Math.PI) * Math.PI; // 约 2.5 圈，终点平躺
    landYaw = flightYaw + (Math.sin(tx * 12.9 + tz * 78.2) * 0.7);
    stick.state = 'flying';
  }

  function attachTo(dog) {
    if (stick.state !== 'landed' || !dog || !dog.mouthAnchor) return;
    carrier = dog;
    homeParent = group.parent || homeParent;
    // 记录当前相对嘴部的偏移，之后平滑过渡到嘴上
    const anchor = dog.mouthAnchor;
    anchor.updateWorldMatrix(true, false);
    group.updateWorldMatrix(true, false);
    blendPos.copy(position);
    anchor.worldToLocal(blendPos);
    group.getWorldQuaternion(_q);
    anchor.getWorldQuaternion(_q2).invert();
    blendQuat.copy(_q2).multiply(_q);
    group.removeFromParent();
    anchor.add(group);
    group.rotation.set(0, 0, 0);
    group.scale.setScalar(1);
    blendT = 0;
    stick.state = 'carried';
  }

  function release() {
    if (stick.state !== 'carried') return;
    syncWorldPosition();
    reparentToWorld();
    group.position.copy(position);
    carrier = null;
    from.copy(position);
    group.rotation.set(0, group.rotation.y, 0);
    flightT = 0;
    stick.state = 'returning';
  }

  /** 落在地上的木棍自己飞回手上（小狗够不着它时用）：landed → returning → held */
  function recall() {
    if (stick.state !== 'landed') return;
    from.copy(position);
    group.rotation.set(0, group.rotation.y, 0);
    flightT = 0;
    stick.state = 'returning';
  }

  function dismiss() {
    if (stick.state === 'carried') {
      syncWorldPosition();
      reparentToWorld();
      group.position.copy(position);
    }
    carrier = null;
    stick.target = null;
    if (stick.state !== 'hidden') {
      stick.state = 'hidden';
      if (slot) {
        // 飞回架子：从当前的位置和朝向出发
        homeFrom.copy(group.position);
        homeFromQuat.copy(group.quaternion);
        homeT = 0;
      }
    }
    heldTime = 0;
  }

  function syncWorldPosition() {
    group.updateWorldMatrix(true, false);
    position.setFromMatrixPosition(group.matrixWorld);
  }

  function setCursor(el, value) {
    if (cursorCache === value) return;
    cursorCache = value;
    try { el.style.cursor = value; } catch (e) { /* ignore */ }
  }

  function update(dt, env) {
    time += dt;
    const bob = Math.sin(time * 2.6);
    switch (stick.state) {
      case 'held': {
        heldTime += dt;
        // 木棍“拿在手里”：跟着鼠标上下左右晃（鼠标在画面中央时回到手的基准位置），狗的视线会一直追着它
        mouse.sx = damp(mouse.sx, mouse.inside ? mouse.x : 0, 9, dt);
        mouse.sy = damp(mouse.sy, mouse.inside ? mouse.y : 0, 9, dt);
        let tx = handPos.x + mouse.sx * 2.6;
        let ty = handPos.y + mouse.sy * 1.35;
        // 有相机时精确跟手：把鼠标射线投到“手”所在的竖直平面（z = handPos.z）上，木棍就在光标处
        const cam = ctx.camera;
        if (mouse.inside && cam && cam.position.lengthSq() > 1) {
          _ray.set(mouse.sx, mouse.sy, 0.5).unproject(cam).sub(cam.position);
          if (_ray.z < -1e-4) {
            const t = (handPos.z - cam.position.z) / _ray.z;
            tx = clamp(cam.position.x + _ray.x * t, -7.5, 7.5);
            ty = clamp(cam.position.y + _ray.y * t, -3.5, 5);
          }
        }
        tx += Math.sin(time * 1.7) * 0.03;
        ty += bob * 0.05;
        const tz = handPos.z;
        // 出现时从略低处升到手上
        const k = 1 - Math.exp(-14 * dt);
        position.x += (tx - position.x) * k;
        position.y += (ty - position.y) * k;
        position.z += (tz - position.z) * k;
        group.position.copy(position);
        group.rotation.x = damp(group.rotation.x, 0, 10, dt); // 从架子上拿下来时带着斜靠的姿态，过渡到手持姿态
        group.rotation.y = damp(group.rotation.y, wrapAngle(0.25 + mouse.sx * 0.5 + Math.sin(time * 1.3) * 0.1), 8, dt);
        // 晃动时木棍顺着移动方向甩一下
        const swing = clamp((tx - position.x) * 0.9, -0.8, 0.8);
        group.rotation.z = damp(group.rotation.z, 0.5 + mouse.sx * 0.25 + bob * 0.06 + swing, 8, dt);
        // 收起木棍的条件：鼠标停着不动（也没点击）满 idleTimeout 秒，或鼠标离开了画面（留 0.6 秒宽限，免得擦过边缘就收）。
        // 没有指针设备的环境（无头测试）里只按“距上次交互的时间”计。
        if (mouse.seen && !mouse.inside) mouse.outT += dt; else mouse.outT = 0;
        if (heldTime >= stick.idleTimeout || mouse.outT > 0.6) dismiss();
        break;
      }
      case 'flying': {
        flightT += dt / flightDur;
        const k = Math.min(flightT, 1);
        position.x = from.x + (targetVec.x - from.x) * k;
        position.z = from.z + (targetVec.z - from.z) * k;
        position.y = from.y + (targetVec.y + 0.05 - from.y) * k + flightPeak * 4 * k * (1 - k);
        group.rotation.y = flightYaw;
        group.rotation.z = zStart + (zEnd - zStart) * k;
        group.position.copy(position);
        if (flightT >= 1) {
          landT = 0;
          group.rotation.z = zEnd % (Math.PI * 2) > 1 ? Math.PI : 0;
          stick.state = 'landed';
        }
        break;
      }
      case 'landed': {
        landT += dt;
        // 1–2 次小弹跳：0.32s/0.5 高度衰减
        let h = 0;
        if (landT < 0.34) h = 0.3 * Math.sin((landT / 0.34) * Math.PI);
        else if (landT < 0.54) h = 0.09 * Math.sin(((landT - 0.34) / 0.2) * Math.PI);
        position.set(targetVec.x, targetVec.y + 0.05 + h, targetVec.z);
        group.rotation.y = damp(group.rotation.y, landYaw, 10, dt);
        group.rotation.z = damp(group.rotation.z, 0, 12, dt);
        group.position.copy(position);
        break;
      }
      case 'carried': {
        if (carrier) {
          blendT = Math.min(ATTACH_BLEND, blendT + dt);
          const w = 1 - blendT / ATTACH_BLEND;
          const e = w * w * (3 - 2 * w);
          group.position.copy(blendPos).multiplyScalar(e);
          _q.identity().slerp(blendQuat, e);
          group.quaternion.copy(_q);
          syncWorldPosition();
        } else {
          dismiss();
        }
        break;
      }
      case 'returning': {
        flightT += dt / RETURN_TIME;
        const k = Math.min(flightT, 1);
        const e = k * k * (3 - 2 * k);
        // 手的位置可能被鼠标偏移：飞向未偏移的 handPos，到位后在 held 里平滑过渡
        position.x = from.x + (handPos.x - from.x) * e;
        position.z = from.z + (handPos.z - from.z) * e;
        position.y = from.y + (handPos.y - from.y) * e + Math.sin(k * Math.PI) * 0.5;
        group.position.copy(position);
        group.rotation.y += wrapAngle(0.25 - group.rotation.y) * Math.min(1, dt * 8);
        group.rotation.z += (0.5 - group.rotation.z) * Math.min(1, dt * 8);
        if (flightT >= 1) {
          mouse.sx = 0;
          mouse.sy = 0;
          enterHeld();
        }
        break;
      }
      default:
        break;
    }

    // 在架子上：飞回 → 斜靠着；鼠标悬停时放大一点并轻轻晃，隔一阵自己晃一下提示“可以点我”
    if (stick.state === 'hidden' && slot) {
      hover = damp(hover, hoverWant, 10, dt);
      if (homeT < 1) {
        homeT = Math.min(1, homeT + dt / 0.55);
        const e = homeT * homeT * (3 - 2 * homeT);
        group.position.lerpVectors(homeFrom, restPos, e);
        group.position.y += Math.sin(homeT * Math.PI) * 0.6;
        group.quaternion.copy(homeFromQuat).slerp(restQuat, e);
        sizeK = 1 + (SHELF_K - 1) * e; // 边飞回去边缩小
      } else {
        const idle = Math.max(0, Math.sin(time * 0.7)) > 0.985 ? 1 : 0; // 约每 9 秒晃一下
        const wig = (0.09 * hover + 0.05 * idle) * Math.sin(time * 9);
        group.position.copy(restPos).addScaledVector(shelf.normal, 0.05 * hover);
        _q.setFromAxisAngle(shelf.normal, wig);
        group.quaternion.copy(_q).multiply(restQuat);
        sizeK = damp(sizeK, SHELF_K, 12, dt);
      }
      position.copy(group.position);
    }

    if (!(stick.state === 'hidden' && slot)) sizeK = damp(sizeK, 1, 9, dt); // 离开架子：长回正常大小
    // 出现/消失：缩放 + 淡入淡出（携带时保持完全可见）
    const want = stick.state === 'hidden' && !slot ? 0 : 1;
    appear = damp(appear, want, APPEAR_RATE, dt);
    if (want === 0 && appear < 0.01) appear = 0;
    if (want === 1 && appear > 0.995) appear = 1;
    const carrierScale = carrier && carrier.group ? carrier.group.scale.x || 1 : 1;
    const sc = stick.state === 'carried' ? STICK_SCALE / carrierScale : STICK_SCALE * Math.max(0.0001, appear * (0.7 + 0.3 * appear)) * sizeK * (1 + 0.16 * (stick.state === 'hidden' ? hover : 0));
    group.scale.setScalar(sc);
    material.opacity = stick.state === 'carried' ? 1 : appear;
    endMaterial.opacity = material.opacity;
    group.visible = appear > 0.01 || stick.state === 'carried';
    if (stick.state === 'hidden' && !slot) {
      // 位置保持有效（隐藏时放在手上）
      position.copy(handPos);
      if (appear === 0) group.position.copy(position);
    }

    // 指针样式（钓鱼小游戏进行中由它自己管光标）
    if (ctx.renderer && ctx.renderer.domElement && ctx.renderer.domElement.style && !(ctx.fishing && ctx.fishing.active)) {
      // 树枝在架子上时：悬停在有物品的格子上是“手指”，其他地方是普通箭头（左键拖动是移动窗口）
      const pi = ctx.petInput;
      const want = pi && (pi.over || pi.active) && stick.state === 'hidden' ? pi.cursor
        : stick.state === 'held' ? (mouse.down ? 'grabbing' : 'grab')
        : stick.state === 'hidden' && shelf ? (shelf.hovered && shelf.hovered.id ? 'pointer' : 'default')
        : 'pointer';
      if (mouse.inside || cursorCache === '') setCursor(ctx.renderer.domElement, want);
    }
  }

  // ---- 浏览器指针交互 ----
  if (typeof document !== 'undefined' && ctx.renderer && ctx.renderer.domElement) {
    const el = ctx.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    let down = null;
    mouse.down = false;

    const toNdc = (e) => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, r.width), h = Math.max(1, r.height);
      ndc.set(((e.clientX - r.left) / w) * 2 - 1, -((e.clientY - r.top) / h) * 2 + 1);
    };

    const gameOn = () => !!((ctx.game && ctx.game.active) || (ctx.fishing && ctx.fishing.active)); // 小游戏（遛狗 / 钓鱼）进行中：岛上的指针交互全部暂停
    el.addEventListener('pointerdown', (e) => {
      if (gameOn()) return;
      if (e.button !== undefined && e.button !== 0) return;
      down = { x: e.screenX, y: e.screenY, far: 0 };
      mouse.down = true;
    });
    el.addEventListener('pointermove', (e) => {
      if (gameOn()) return;
      toNdc(e);
      mouse.x = ndc.x;
      mouse.y = ndc.y;
      mouse.inside = true;
      mouse.seen = true;
      if (down) down.far = Math.max(down.far, Math.hypot(e.screenX - down.x, e.screenY - down.y));
      // 鼠标确实动了（超过 2 像素）才算一次交互：晃着木棍逗狗的时候不会超时
      if (Math.hypot(e.clientX - mouse.lastX, e.clientY - mouse.lastY) > 2) {
        mouse.lastX = e.clientX; mouse.lastY = e.clientY;
        heldTime = 0;
      }
      // 玩具架的悬停：只在场上没有玩具时判定
      if (shelf) {
        if (stick.state === 'hidden') { ray.setFromCamera(ndc, ctx.camera); shelf.setHover(shelf.pick(ray)); }
        else shelf.setHover(null);
      }
    });
    el.addEventListener('pointerleave', () => {
      mouse.inside = false;
      mouse.down = false;
      down = null;
      if (shelf) shelf.setHover(null);
    });
    el.addEventListener('pointerenter', () => { mouse.inside = true; mouse.seen = true; });
    // 鼠标移出整个窗口时有的环境不给画布发 pointerleave，这里再兜一层
    if (typeof document !== 'undefined') document.documentElement.addEventListener('mouseleave', () => { mouse.inside = false; mouse.down = false; });
    el.addEventListener('pointercancel', () => { down = null; mouse.down = false; });
    el.addEventListener('pointerup', (e) => {
      mouse.down = false;
      if (gameOn()) { down = null; return; }
      if (!down) return;
      const moved = Math.max(down.far, Math.hypot(e.screenX - down.x, e.screenY - down.y));
      down = null;
      if (moved > 6) return; // 拖拽不算点击
      toNdc(e);
      ray.setFromCamera(ndc, ctx.camera);
      // 场上没有玩具时：只有点中玩具架上的物品才有反应（点树枝 → 开始扔树枝）；点别处什么都不发生
      if (stick.state === 'hidden' && shelf) {
        const s = shelf.pick(ray);
        if (s && s.onClick) { shelf.setHover(null); s.onClick(); }
        return;
      }
      let p = null;
      const meshes = ctx.island && ctx.island.groundMeshes ? ctx.island.groundMeshes : [];
      const hits = meshes.length ? ray.intersectObjects(meshes, false) : [];
      if (hits.length) p = hits[0].point.clone();
      else if (ray.ray.intersectPlane(plane, hit)) p = hit.clone();
      click(p);
    });
  }

  return stick;
}
