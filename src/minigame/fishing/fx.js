// 钓鱼的小特效：水面涟漪圈、水花飞沫、头顶的“!”、鱼线 + 小浮漂、玩具架上的红白浮漂（入口）。
import * as THREE from 'three';
import { paintMaterial } from '../../core/paint.js';
import { damp } from '../../core/util.js';
import { part, mergeParts, G, tube } from '../walk/geo.js';
import { WATER_Y } from '../../world/island/water.js';

// ------------------------------------------------------------------ 玩具架上的浮漂
/** 红白浮漂：上红下白的圆身 + 黄色细杆 + 一小段线和钩。本地：X 向右、Y 向上、Z 朝外（离开墙面）。 */
export function buildShelfBobber() {
  const P = [];
  const RED = 0xe23b2e, WHITE = 0xfff4e0, DARK = 0x3a2a22;
  // 圆身：上半红、下半白（两个半球拼起来，中间一圈深色细边）
  P.push(part(new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), RED, { p: [0, 0.02, 0.1], ao: 0 }));
  P.push(part(new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), WHITE, { p: [0, 0.02, 0.1], ao: 0 }));
  P.push(part(G.torus(0.17, 0.012, 5, 18), DARK, { p: [0, 0.02, 0.1], r: [Math.PI / 2, 0, 0], ao: 0 }));
  // 红色那一半上的白点（手绘感）
  for (const [x, z] of [[0.07, 0.1], [-0.07, 0.04], [0.0, 0.16]]) P.push(part(G.sphere(0.028, 6, 5), WHITE, { p: [x, 0.17, 0.1 + z - 0.1 + 0.0], s: [1, 0.5, 1], ao: 0 }));
  // 顶杆（黄 / 黑相间）+ 顶帽
  P.push(part(G.cyl(0.018, 0.022, 0.14, 8), 0xf5c542, { p: [0, 0.27, 0.1], ao: 0 }));
  P.push(part(G.cyl(0.021, 0.021, 0.04, 8), DARK, { p: [0, 0.33, 0.1], ao: 0 }));
  P.push(part(G.sphere(0.03, 8, 6), RED, { p: [0, 0.365, 0.1], ao: 0 }));
  // 下面的杆、线、钩
  P.push(part(G.cyl(0.012, 0.012, 0.1, 6), 0xf5c542, { p: [0, -0.2, 0.1], ao: 0 }));
  P.push(tube([0, -0.25, 0.1], [0.02, -0.34, 0.1], 0.006, 0xe8e0d0, 4));
  P.push(part(G.torus(0.032, 0.007, 5, 12, Math.PI * 1.4), 0xaab4be, { p: [0.034, -0.37, 0.1], r: [0, 0, Math.PI * 0.8], ao: 0 }));
  // 挂钉
  P.push(part(G.sphere(0.03, 6, 5), 0x6b5a4a, { p: [0, 0.43, 0.07], ao: 0 }));
  return mergeParts(P, { aoH: 0 });
}

/** 架子上的浮漂物品：占用架子的下一个空格子；悬停放大轻晃，点击 → onClick。（和树枝、遛狗绳同一套机制） */
export function createShelfBobber(ctx, onClick) {
  const shelf = ctx.island && ctx.island.shelf;
  if (!shelf) return null;
  let hoverWant = 0, hover = 0, time = 0, shake = 0;
  const slot = shelf.claim('fishing', { onClick, onHover: (on) => { hoverWant = on ? 1 : 0; } });
  if (!slot) return null;
  const mat = paintMaterial({ vertexColors: true }, { scale: 9, strength: 0.2, hue: 0.4, bands: 0.3, levels: 3, space: 'local' });
  const mesh = new THREE.Mesh(buildShelfBobber(), mat);
  mesh.name = 'shelfBobber';
  mesh.castShadow = true;
  const ax = shelf.right.clone(), az = shelf.normal.clone();
  const ay = new THREE.Vector3().crossVectors(az, ax);
  const restQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, az));
  const restPos = slot.position.clone().addScaledVector(shelf.up, 0.015);
  const K = 0.7;       // 在架子上的大小系数（按格子比例缩小，整体约占格子的七八成）
  const _q = new THREE.Quaternion();
  mesh.position.copy(restPos);
  mesh.quaternion.copy(restQuat);
  mesh.scale.setScalar(K);
  ctx.scene.add(mesh);
  let sizeK = K;
  return {
    slot, mesh, restPos,
    get hover() { return hover; },
    /** 拒绝开始时（下雨 / 夜里）：浮漂抖一下 */
    wiggle() { shake = 1; },
    update(dt, enabled = true) {
      time += dt;
      if (!enabled) hoverWant = 0;
      hover = damp(hover, hoverWant, 10, dt);
      shake = Math.max(0, shake - dt * 1.4);
      const idle = Math.max(0, Math.sin(time * 0.7 + 2.6)) > 0.985 ? 1 : 0; // 隔一阵自己晃一下，提示“可以点我”
      const wig = (0.1 * hover + 0.06 * idle) * Math.sin(time * 9) + 0.28 * shake * Math.sin(time * 34);
      const bob = 0.012 * Math.sin(time * 1.9) * (1 - hover) + 0.012 * hover * Math.sin(time * 3.4); // 像浮在水面上轻轻起伏
      mesh.position.copy(restPos).addScaledVector(shelf.normal, 0.05 * hover).addScaledVector(shelf.up, bob);
      _q.setFromAxisAngle(shelf.normal, wig);
      mesh.quaternion.copy(_q).multiply(restQuat);
      sizeK = damp(sizeK, K * (1 + 0.16 * hover), 12, dt);
      mesh.scale.setScalar(sizeK);
    },
  };
}

// ------------------------------------------------------------------ 水面特效
export function createFishFx(scene) {
  const group = new THREE.Group();
  group.name = 'fishFx';
  scene.add(group);

  // 涟漪圈
  const ringGeo = new THREE.RingGeometry(0.8, 1, 28);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; m.renderOrder = 5;
    group.add(m);
    rings.push({ m, t: 1, delay: 0, max: 0.3, life: 1.3, op: 0.6 });
  }
  let ringN = 0;
  function ripple(x, z, max = 0.3, delay = 0, op = 0.6, life = 1.3) {
    const r = rings[ringN];
    ringN = (ringN + 1) % rings.length;
    r.m.position.set(x, WATER_Y + 0.008, z);
    r.t = 0; r.delay = delay; r.max = max; r.op = op; r.life = life;
  }

  // 飞沫
  const NP = 48;
  const pos = new Float32Array(NP * 3).fill(-100);
  const vel = new Float32Array(NP * 3);
  const life = new Float32Array(NP);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pmat = new THREE.PointsMaterial({ color: 0xeaf7ff, size: 0.085, sizeAttenuation: true, transparent: true, opacity: 0.92, depthWrite: false });
  if (typeof document !== 'undefined') { // 圆形的小水珠（默认的点是方的）
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    if (g) {
      const grd = g.createRadialGradient(16, 16, 2, 16, 16, 15);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.95)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
      pmat.map = new THREE.CanvasTexture(c);
    }
  }
  const points = new THREE.Points(geo, pmat);
  points.frustumCulled = false; points.renderOrder = 6;
  group.add(points);
  let pn = 0;
  function splash(x, y, z, n = 14, power = 1.6, spread = 1, color = 0xeaf7ff) {
    pmat.color.setHex(color);
    for (let k = 0; k < n; k++) {
      const i = pn; pn = (pn + 1) % NP;
      const a = Math.random() * Math.PI * 2, s = (0.3 + Math.random() * 0.7) * power * 0.5 * spread;
      pos[i * 3] = x + Math.cos(a) * 0.04; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z + Math.sin(a) * 0.04;
      vel[i * 3] = Math.cos(a) * s; vel[i * 3 + 1] = power * (0.6 + Math.random() * 0.7); vel[i * 3 + 2] = Math.sin(a) * s;
      life[i] = 0.55 + Math.random() * 0.4;
    }
  }

  // 头顶的“!”
  let bang = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    if (g) {
      g.lineJoin = 'round';
      g.fillStyle = '#fff3c4'; g.strokeStyle = '#5a3a26'; g.lineWidth = 7;
      g.beginPath();
      g.moveTo(64, 120); g.lineTo(46, 96);
      g.arc(64, 54, 46, Math.PI * 0.72, Math.PI * 0.28, false);
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ff4a2a'; g.strokeStyle = '#5a3a26'; g.lineWidth = 5;
      g.font = '900 64px "Microsoft YaHei", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeText('!', 64, 56); g.fillText('!', 64, 56);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    bang.visible = false; bang.renderOrder = 40; bang.scale.setScalar(0.6);
    group.add(bang);
  }

  // 鱼线 + 小浮漂（尾巴末端够不着水面时的视觉延伸；也让“钓鱼”一眼就懂）
  const lineGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 1, 4);
  lineGeo.translate(0, 0.5, 0);
  const line = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: 0xf6f1e4 }));
  line.visible = false;
  group.add(line);
  const floatMat = paintMaterial({ vertexColors: true }, { scale: 9, strength: 0.15, hue: 0.3, bands: 0.2, levels: 3, space: 'local' });
  const floaty = new THREE.Mesh(mergeParts([
    part(new THREE.SphereGeometry(0.05, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), 0xe23b2e, { ao: 0 }),
    part(new THREE.SphereGeometry(0.05, 10, 7, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xfff4e0, { ao: 0 }),
    part(G.cyl(0.008, 0.01, 0.06, 5), 0xf5c542, { p: [0, 0.07, 0], ao: 0 }),
  ], { aoH: 0 }), floatMat);
  floaty.visible = false;
  group.add(floaty);
  const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
  function setLine(on, a, b) {
    line.visible = on;
    if (!on) return;
    _d.copy(b).sub(a);
    const len = _d.length();
    line.position.copy(a);
    line.scale.set(1, Math.max(0.001, len), 1);
    if (len > 1e-5) line.quaternion.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
  }
  function setFloat(on, x, y, z, bobT = 0, tilt = 0) {
    floaty.visible = on;
    if (!on) return;
    floaty.position.set(x, y + 0.01 * Math.sin(bobT * 2.6), z);
    floaty.rotation.set(0.08 * Math.sin(bobT * 1.7) + tilt, 0, 0.08 * Math.cos(bobT * 2.1));
  }

  function update(dt) {
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (r.t >= 1) { if (r.m.visible) r.m.visible = false; continue; }
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.t = Math.min(1, r.t + dt / r.life);
      const s = 0.03 + r.max * (1 - (1 - r.t) * (1 - r.t));
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = r.op * (1 - r.t);
      r.m.visible = true;
    }
    let any = false;
    for (let i = 0; i < NP; i++) {
      if (life[i] <= 0) continue;
      any = true;
      life[i] -= dt;
      if (life[i] <= 0) { pos[i * 3 + 1] = -100; continue; }
      vel[i * 3 + 1] -= 6.5 * dt;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < WATER_Y - 0.02 && vel[i * 3 + 1] < 0) { life[i] = 0; pos[i * 3 + 1] = -100; }
    }
    if (any) geo.attributes.position.needsUpdate = true;
  }
  function clear() {
    life.fill(0); pos.fill(-100); geo.attributes.position.needsUpdate = true;
    for (const r of rings) { r.t = 1; r.m.visible = false; }
    setLine(false); setFloat(false);
    if (bang) bang.visible = false;
  }
  return { group, ripple, splash, update, clear, bang, setLine, setFloat, line, floaty, points, rings };
}
