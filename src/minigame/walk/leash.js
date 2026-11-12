// 遛狗绳：玩具架上的那一卷（入口），以及小游戏里的第一人称“手 + 牵引绳”。
import * as THREE from 'three';
import { paintMaterial } from '../../core/paint.js';
import { damp, clamp } from '../../core/util.js';
import { part, mergeParts, tube, G } from './geo.js';

const RED = 0xd9382f, DARK_RED = 0xa6241d, SILVER = 0x9fa8b4;

/** 架子上的遛狗绳：一卷红绳（几圈叠在一起）+ 红色手柄 + 金属扣。本地坐标：X 向右、Y 向上、Z 朝外（离开墙面）。 */
export function buildShelfLeash() {
  const parts = [];
  // 卷起来的绳圈：几层略有错位的环，像一卷盘好的绳
  const radii = [0.235, 0.205, 0.175, 0.145];
  radii.forEach((r, i) => {
    parts.push(part(G.torus(r, 0.034, 7, 28), i % 2 ? DARK_RED : RED, { p: [0, -0.05, 0.035 + i * 0.012], r: [0, 0, i * 0.7], ao: 0 }));
  });
  // 绑带（把绳圈捆在一起）
  parts.push(part(G.box(0.1, 0.5, 0.05), 0xf4ead3, { p: [0, -0.05, 0.1], r: [0, 0, 0.4], s: [0.5, 0.5, 1], ao: 0 }));
  parts.push(part(G.box(0.07, 0.07, 0.06), 0xf4ead3, { p: [0.0, 0.17, 0.095], ao: 0 }));
  // 手柄：红色握把（带防滑环）+ 绳套
  parts.push(part(G.capsule(0.05, 0.2), RED, { p: [0, 0.31, 0.09], r: [0, 0, Math.PI / 2] }));
  for (const sx of [-0.06, 0, 0.06]) parts.push(part(G.cyl(0.056, 0.056, 0.022, 10), DARK_RED, { p: [sx, 0.31, 0.09], r: [0, 0, Math.PI / 2], ao: 0 }));
  parts.push(part(G.torus(0.075, 0.018, 6, 14, Math.PI), RED, { p: [0, 0.335, 0.09], r: [0, 0, 0], ao: 0 }));
  parts.push(tube([0, 0.27, 0.09], [0, 0.17, 0.1], 0.026, RED, 6));
  // 金属扣（挂钩）
  parts.push(tube([0.0, -0.27, 0.1], [0.0, -0.33, 0.11], 0.02, RED, 6));
  parts.push(part(G.torus(0.04, 0.012, 6, 14), SILVER, { p: [0, -0.36, 0.11], ao: 0 }));
  parts.push(part(G.box(0.022, 0.06, 0.02), SILVER, { p: [0.035, -0.4, 0.11], r: [0, 0, 0.3], ao: 0 }));
  parts.push(part(G.sphere(0.022, 6, 5), SILVER, { p: [0.0, -0.31, 0.11], ao: 0 }));
  // 挂钩钉
  parts.push(part(G.sphere(0.03, 6, 5), 0x6b5a4a, { p: [0, 0.4, 0.07], ao: 0 }));
  return mergeParts(parts, { aoH: 0 });
}

/**
 * 玩具架上的遛狗绳物品：占用架子的下一个空格子，悬停时放大轻晃，点击 → onClick。
 * 指针的悬停 / 点击判定由 stick.js 统一做（shelf.pick → slot.onClick / setHover → onHover）。
 */
export function createShelfLeash(ctx, onClick) {
  const shelf = ctx.island && ctx.island.shelf;
  if (!shelf) return null;
  let hoverWant = 0, hover = 0, time = 0;
  const slot = shelf.claim('leash', { onClick, onHover: (on) => { hoverWant = on ? 1 : 0; } });
  if (!slot) return null;
  const mat = paintMaterial({ vertexColors: true }, { scale: 9, strength: 0.2, hue: 0.4, bands: 0.3, levels: 3, space: 'local' });
  const mesh = new THREE.Mesh(buildShelfLeash(), mat);
  mesh.name = 'shelfLeash';
  mesh.castShadow = true;
  const ax = shelf.right.clone(), az = shelf.normal.clone();
  const ay = new THREE.Vector3().crossVectors(az, ax);
  const restQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, az));
  const restPos = slot.position.clone().addScaledVector(shelf.up, -0.01);
  const K = 0.85;      // 在架子上的大小系数（整体约占格子的八成）
  const _q = new THREE.Quaternion();
  mesh.position.copy(restPos);
  mesh.quaternion.copy(restQuat);
  mesh.scale.setScalar(K);
  ctx.scene.add(mesh);
  let sizeK = K;
  return {
    slot, mesh, restPos,
    get hover() { return hover; },
    update(dt, enabled = true) {
      time += dt;
      if (!enabled) { hoverWant = 0; }
      hover = damp(hover, hoverWant, 10, dt);
      const idle = Math.max(0, Math.sin(time * 0.7 + 1.3)) > 0.985 ? 1 : 0; // 隔一阵自己晃一下，提示“可以点我”
      const wig = (0.1 * hover + 0.06 * idle) * Math.sin(time * 9);
      mesh.position.copy(restPos).addScaledVector(shelf.normal, 0.05 * hover);
      _q.setFromAxisAngle(shelf.normal, wig);
      mesh.quaternion.copy(_q).multiply(restQuat);
      sizeK = damp(sizeK, K * (1 + 0.16 * hover), 12, dt);
      mesh.scale.setScalar(sizeK);
    },
  };
}

// ------------------------------------------------------------------ 第一人称：手 + 牵引绳
const ROPE_N = 20;

/** 手握红色握把，挂在相机下面；绳子是一条朝向镜头的带状网格，每帧按“手 → 项圈”重算（不分配对象） */
export function createLeashRig(camera, scene) {
  const handMat = paintMaterial({ vertexColors: true }, { scale: 5, strength: 0.14, hue: 0.4, bands: 0.35, levels: 4, space: 'local' });
  const skin = 0xf0bf9a, cuff = 0x3b6fb6;
  const hp = [];
  // 握把（竖直，绳子从顶端出来）
  hp.push(part(G.capsule(0.03, 0.16), RED, { p: [0, 0.0, 0], ao: 0 }));
  hp.push(part(G.cyl(0.038, 0.038, 0.016, 10), DARK_RED, { p: [0, 0.085, 0], ao: 0 }));
  hp.push(part(G.cyl(0.038, 0.038, 0.016, 10), DARK_RED, { p: [0, -0.085, 0], ao: 0 }));
  hp.push(part(G.torus(0.036, 0.011, 6, 12), SILVER, { p: [0, 0.135, 0], r: [Math.PI / 2, 0, 0], ao: 0 }));
  hp.push(part(G.torus(0.05, 0.007, 5, 14, Math.PI * 1.6), RED, { p: [0, -0.115, 0], r: [Math.PI / 2, 0, 0.6], ao: 0 })); // 腕带
  // 手：手背 + 四指环绕握把（从后面看是四道指节）+ 拇指压在握把侧面
  hp.push(part(G.sphere(0.06, 10, 8), skin, { p: [0, 0.0, 0.052], s: [1.15, 1.45, 0.75], ao: 0 }));
  for (let i = 0; i < 4; i++) {
    const y = 0.052 - i * 0.034;
    hp.push(part(G.torus(0.04, 0.0175, 6, 12), skin, { p: [0, y, 0.0], r: [Math.PI / 2, 0, 0], ao: 0 }));
    hp.push(part(G.sphere(0.021, 6, 5), 0xe8ae88, { p: [0.0, y, 0.062], ao: 0 })); // 指节
  }
  hp.push(tube([0.045, 0.02, 0.03], [0.012, 0.085, 0.045], 0.019, skin, 7, 0.016)); // 拇指
  hp.push(part(G.sphere(0.02, 6, 5), 0xf6c8a8, { p: [0.012, 0.088, 0.05], ao: 0 }));
  // 手腕 + 袖口（向画面下方、靠近镜头的方向延伸）
  hp.push(tube([0.0, -0.03, 0.07], [0.01, -0.1, 0.17], 0.04, skin, 8, 0.046));
  hp.push(tube([0.01, -0.075, 0.15], [0.016, -0.2, 0.42], 0.066, cuff, 10, 0.058));
  hp.push(tube([0.012, -0.085, 0.16], [0.012, -0.096, 0.17], 0.07, 0xeef2f8, 10, 0.07)); // 袖口的白边
  const hand = new THREE.Group();
  hand.name = 'leashHand';
  const handMesh = new THREE.Mesh(mergeParts(hp, { aoH: 0 }), handMat);
  handMesh.frustumCulled = false;
  hand.add(handMesh);
  hand.position.set(0.13, -0.38, -0.78);
  hand.rotation.set(0.55, -0.15, 0.1);
  camera.add(hand);
  const anchor = new THREE.Object3D(); // 绳子从握把顶端出来
  anchor.position.set(0, 0.13, 0);
  handMesh.add(anchor);

  // 绳子：带状网格，宽度固定（世界单位），朝向镜头
  const ropeGeo = new THREE.BufferGeometry();
  const pos = new Float32Array((ROPE_N + 1) * 2 * 3);
  const nor = new Float32Array((ROPE_N + 1) * 2 * 3);
  const idx = [];
  for (let i = 0; i < ROPE_N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  ropeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  ropeGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  ropeGeo.setIndex(idx);
  const ropeMat = paintMaterial({ color: RED, side: THREE.DoubleSide, roughness: 1 }, { scale: 6, strength: 0.14, hue: 0.4, bands: 0.3, levels: 4, space: 'world' });
  const rope = new THREE.Mesh(ropeGeo, ropeMat);
  rope.name = 'leashRope';
  rope.frustumCulled = false;
  scene.add(rope);

  const A = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3(), Pn = new THREE.Vector3(), T = new THREE.Vector3(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Vector3();
  const rig = {
    hand, anchor, rope, ropeMat,
    /** 手：x = 相机局部横向位置（米，由手的世界位置换算），grip 0..1 收紧程度（手往回收、手柄立起），tug 0..1 拽的瞬间 */
    updateHand(x, grip, bob, tug = 0) {
      hand.position.set(x, -0.38 - 0.03 * grip + bob * 0.4, -0.78 + 0.12 * grip + 0.05 * tug);
      hand.rotation.set(0.55 - 0.3 * grip - 0.25 * tug, -0.15 - x * 0.35, 0.1 - x * 0.3);
    },
    /** 绳子：collar = 项圈位置；shape = { sag 下垂米数, bow 横向荡开米数, trem 绷紧时的颤动米数 } */
    updateRope(collar, shape, t, width = 0.034) {
      camera.updateMatrixWorld(true);
      anchor.getWorldPosition(A);
      B.copy(collar);
      const { sag = 0.3, bow = 0, trem = 0 } = shape;
      C.setFromMatrixPosition(camera.matrixWorld);
      const pt = (u, out) => {
        const sh = 4 * u * (1 - u);
        out.lerpVectors(A, B, u);
        out.y -= sag * sh;
        out.x += bow * Math.sin(Math.PI * u) + Math.sin(t * 58 + u * 9) * trem * sh;
        out.y += Math.cos(t * 51 + u * 7) * trem * 0.6 * sh;
        return out;
      };
      for (let i = 0; i <= ROPE_N; i++) {
        const u = i / ROPE_N;
        pt(u, P);
        pt(Math.min(1, u + 1 / ROPE_N), Pn);
        pt(Math.max(0, u - 1 / ROPE_N), T);
        T.subVectors(Pn, T).normalize();
        V.subVectors(P, C).normalize();
        S.crossVectors(T, V).normalize().multiplyScalar(width * 0.5 * (1 - 0.25 * u));
        const k = i * 6;
        pos[k] = P.x - S.x; pos[k + 1] = P.y - S.y; pos[k + 2] = P.z - S.z;
        pos[k + 3] = P.x + S.x; pos[k + 4] = P.y + S.y; pos[k + 5] = P.z + S.z;
        nor[k] = nor[k + 3] = -V.x; nor[k + 1] = nor[k + 4] = -V.y; nor[k + 2] = nor[k + 5] = -V.z;
      }
      ropeGeo.attributes.position.needsUpdate = true;
      ropeGeo.attributes.normal.needsUpdate = true;
    },
    dispose() { camera.remove(hand); scene.remove(rope); ropeGeo.dispose(); },
  };
  void clamp;
  return rig;
}

/** 项圈：红色的环，套在小狗脖子的骨骼上（结束时摘掉） */
export function createCollar() {
  const mat = paintMaterial({ vertexColors: true }, { scale: 8, strength: 0.12, hue: 0.4, bands: 0.3, levels: 4, space: 'local' });
  const geo = mergeParts([
    part(G.torus(0.1, 0.026, 6, 16), 0xd9382f, { ao: 0 }),
    part(G.sphere(0.03, 6, 5), 0xf2c230, { p: [0, -0.1, 0.0], ao: 0 }),
    part(G.torus(0.02, 0.008, 5, 10), 0xd3d8de, { p: [0, 0.1, 0.0], ao: 0 }),
  ], { aoH: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'walkCollar';
  mesh.rotation.x = -1.19;
  mesh.position.set(0, 0.02, 0.012);
  mesh.frustumCulled = false;
  return mesh;
}
