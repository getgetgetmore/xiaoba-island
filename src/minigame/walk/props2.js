// 遛狗小游戏（第二批）的物件：害怕的东西、会动的障碍、前冲的小动物、减速带、嗅桩。约定同 props.js。
import { part, mergeParts, tube, G } from './geo.js';

// ------------------------------------------------------------------ 害怕的东西
/** 洒水器：绿色底座 + 喷头 + 两道弧形水柱 */
export function buildSprinkler() {
  const parts = [
    part(G.cyl(0.3, 0.34, 0.14, 10), 0x4a8a3a, { p: [0, 0.07, 0] }),
    part(G.cyl(0.07, 0.09, 0.55, 8), 0x2f7fb8, { p: [0, 0.4, 0] }),
    part(G.sphere(0.13, 7, 5), 0xf2c230, { p: [0, 0.72, 0], ao: 0 }),
    part(G.cyl(0.04, 0.04, 0.5, 6), 0x2f7fb8, { p: [0.22, 0.78, 0], r: [0, 0, Math.PI / 2 - 0.5], ao: 0 }),
    part(G.cyl(0.04, 0.04, 0.5, 6), 0x2f7fb8, { p: [-0.22, 0.78, 0], r: [0, 0, -Math.PI / 2 + 0.5], ao: 0 }),
  ];
  for (const sg of [-1, 1]) {
    parts.push(part(G.torus(0.55, 0.035, 4, 12, Math.PI * 0.62), 0x9fdcf5, { p: [sg * 0.52, 0.76, 0], r: [0, 0, sg > 0 ? 0.35 : Math.PI - 0.35 - Math.PI * 0.62], ao: 0 }));
    for (let i = 0; i < 3; i++) parts.push(part(G.sphere(0.07, 5, 4), 0xcdeefb, { p: [sg * (0.95 + i * 0.12), 0.35 - i * 0.1, (i - 1) * 0.12], ao: 0 }));
  }
  parts.push(part(G.cyl(0.8, 0.8, 0.02, 14), 0x6fb7da, { p: [0, 0.015, 0.05], s: [1, 1, 0.7], ao: 0 }));
  return mergeParts(parts, { aoH: 0.5 });
}

/** 扫地车（黄色小车 + 旋转圆刷） */
export function buildSweeper() {
  const wheel = (x, z) => part(G.cyl(0.32, 0.32, 0.1, 10), 0x2b2b30, { p: [x, 0.32, z], r: [0, 0, Math.PI / 2] });
  return mergeParts([
    part(G.box(1.2, 0.5, 1.5), 0xf2a81d, { p: [0, 0.5, 0] }),
    part(G.box(1.0, 0.4, 0.7), 0xffd36a, { p: [0, 0.95, -0.2] }),
    part(G.box(0.9, 0.3, 0.05), 0x9fd2e6, { p: [0, 0.98, 0.17], ao: 0 }),
    part(G.box(0.3, 0.08, 0.2), 0xff5a2a, { p: [0, 1.2, -0.3], ao: 0 }),
    wheel(0.6, 0.5), wheel(-0.6, 0.5), wheel(0.6, -0.5), wheel(-0.6, -0.5),
    part(G.cyl(0.28, 0.28, 0.12, 9), 0xe84a2a, { p: [0.3, 0.14, 0.95], ao: 0 }),
    part(G.cyl(0.28, 0.28, 0.12, 9), 0xe84a2a, { p: [-0.3, 0.14, 0.95], ao: 0 }),
  ], { aoH: 0.6 });
}

/** 一束气球（系在小底座上，会啪地爆） */
export function buildBalloons() {
  const cols = [0xff5a6a, 0xffd23f, 0x5ac8fa, 0x7ddf64, 0xc77dff];
  const parts = [part(G.cyl(0.2, 0.24, 0.12, 8), 0x7a7f88, { p: [0, 0.06, 0] })];
  const pos = [[0, 1.75, 0], [0.3, 1.55, 0.1], [-0.3, 1.6, -0.05], [0.1, 1.38, 0.28], [-0.12, 1.3, -0.25]];
  pos.forEach((p, i) => {
    parts.push(part(G.sphere(0.24, 8, 6), cols[i], { p, s: [1, 1.2, 1], ao: 0 }));
    parts.push(tube([0, 0.12, 0], [p[0] * 0.8, p[1] - 0.28, p[2] * 0.8], 0.008, 0xeeeeee, 3));
  });
  return mergeParts(parts, { aoH: 0.3 });
}

// ------------------------------------------------------------------ 会动的障碍
export function buildRoomba() {
  return mergeParts([
    part(G.cyl(0.45, 0.47, 0.16, 14), 0x4a4f5a, { p: [0, 0.1, 0] }),
    part(G.cyl(0.36, 0.36, 0.04, 12), 0x8fa0b8, { p: [0, 0.2, 0], ao: 0 }),
    part(G.sphere(0.07, 6, 5), 0x3ad07c, { p: [0.12, 0.23, 0.1], ao: 0 }),
    part(G.sphere(0.16, 7, 5), 0xdfe5ee, { p: [0, 0.18, 0.28], s: [1, 0.4, 1], ao: 0 }),
  ], { aoH: 0.3 });
}
export function buildRcCar() {
  const wheel = (x, z) => part(G.cyl(0.14, 0.14, 0.1, 8), 0x2b2b30, { p: [x, 0.14, z], r: [Math.PI / 2, 0, 0] });
  return mergeParts([
    part(G.box(0.8, 0.18, 0.5), 0xe23d2d, { p: [0, 0.2, 0] }),
    part(G.box(0.42, 0.16, 0.38), 0xff7d6a, { p: [-0.05, 0.37, 0] }),
    part(G.box(0.34, 0.1, 0.3), 0x9fd2e6, { p: [-0.05, 0.42, 0], ao: 0 }),
    wheel(0.28, 0.28), wheel(-0.28, 0.28), wheel(0.28, -0.28), wheel(-0.28, -0.28),
    tube([-0.35, 0.3, 0.1], [-0.55, 0.85, 0.1], 0.012, 0x2b2b30, 3),
    part(G.sphere(0.03, 4, 3), 0xffd23f, { p: [-0.55, 0.87, 0.1], ao: 0 }),
  ], { aoH: 0.3 });
}
function person(shirt, pants, hat) {
  const skin = 0xf2c4a0;
  const p = [
    tube([-0.11, 0.05, 0], [-0.1, 0.8, 0], 0.075, pants, 7),
    tube([0.11, 0.05, 0], [0.1, 0.8, 0], 0.075, pants, 7),
    part(G.box(0.14, 0.08, 0.26), 0x3a3a42, { p: [-0.11, 0.04, 0.05], ao: 0 }),
    part(G.box(0.14, 0.08, 0.26), 0x3a3a42, { p: [0.11, 0.04, 0.05], ao: 0 }),
    part(G.capsule(0.19, 0.42), shirt, { p: [0, 1.15, 0], ao: 0 }),
    part(G.sphere(0.16, 8, 6), skin, { p: [0, 1.7, 0], ao: 0 }),
    tube([-0.22, 1.3, 0], [-0.3, 0.95, 0.12], 0.05, shirt, 6),
    tube([0.22, 1.3, 0], [0.3, 0.95, 0.12], 0.05, shirt, 6),
    part(G.sphere(0.03, 4, 3), 0x111111, { p: [-0.06, 1.72, 0.14], ao: 0 }),
    part(G.sphere(0.03, 4, 3), 0x111111, { p: [0.06, 1.72, 0.14], ao: 0 }),
    part(G.sphere(0.18, 8, 6), hat, { p: [0, 1.78, -0.02], s: [1, 0.7, 1], ao: 0 }),
  ];
  return p;
}
/** 迎面走来的行人（正面朝向玩家，背着书包） */
export function buildWalker() {
  return mergeParts([...person(0x7a5ad8, 0x394a6b, 0x3a2a22), part(G.box(0.3, 0.4, 0.14), 0xffa24a, { p: [0.0, 1.15, -0.28], ao: 0 })], { aoH: 0.4 });
}
/** 推婴儿车的人：车在前（靠近玩家） */
export function buildStroller() {
  const parts = person(0xe8607a, 0x4a4f6b, 0xf4d9a0).map((q) => ({ ...q, p: [q.p[0], q.p[1], q.p[2] - 0.45] }));
  parts.push(part(G.box(0.62, 0.3, 0.7), 0x5ab0e6, { p: [0, 0.62, 0.35] }));
  parts.push(part(G.sphere(0.34, 8, 6), 0x7cc4f0, { p: [0, 0.82, 0.25], s: [1, 0.8, 1.1], ao: 0 }));
  parts.push(part(G.sphere(0.12, 6, 5), 0xf2c4a0, { p: [0, 0.88, 0.42], ao: 0 }));
  parts.push(tube([-0.3, 0.9, -0.1], [-0.3, 0.95, -0.35], 0.025, 0x4a4f5a, 4));
  parts.push(tube([0.3, 0.9, -0.1], [0.3, 0.95, -0.35], 0.025, 0x4a4f5a, 4));
  for (const sx of [-0.3, 0.3]) for (const sz of [0.1, 0.6]) parts.push(part(G.cyl(0.13, 0.13, 0.06, 8), 0x2b2b30, { p: [sx, 0.13, sz], r: [0, 0, Math.PI / 2], ao: 0 }));
  return mergeParts(parts, { aoH: 0.4 });
}

// ------------------------------------------------------------------ 前冲的小动物 / 软障碍 / 嗅桩
/** 松鼠（朝 +x 跑） */
export function buildSquirrel() {
  return mergeParts([
    part(G.sphere(0.16, 8, 6), 0xb5683a, { p: [0, 0.2, 0], s: [1.4, 1, 0.9] }),
    part(G.sphere(0.1, 7, 5), 0xc98050, { p: [0.22, 0.3, 0] }),
    part(G.cone(0.03, 0.08, 4), 0xb5683a, { p: [0.22, 0.43, 0.05], ao: 0 }),
    part(G.cone(0.03, 0.08, 4), 0xb5683a, { p: [0.22, 0.43, -0.05], ao: 0 }),
    part(G.sphere(0.02, 4, 3), 0x111111, { p: [0.31, 0.32, 0.06], ao: 0 }),
    part(G.sphere(0.2, 8, 6), 0xd89560, { p: [-0.25, 0.4, 0], s: [0.8, 1.5, 0.7], ao: 0 }),
    part(G.sphere(0.12, 7, 5), 0xf4e0c4, { p: [0.08, 0.15, 0], ao: 0 }),
  ], { aoH: 0.3 });
}
export function buildCat() {
  return mergeParts([
    part(G.capsule(0.12, 0.34), 0xf29a3a, { p: [0, 0.28, 0], r: [0, 0, Math.PI / 2] }),
    part(G.sphere(0.13, 8, 6), 0xf5ae55, { p: [0.28, 0.36, 0] }),
    part(G.cone(0.05, 0.12, 4), 0xf29a3a, { p: [0.28, 0.5, 0.07], ao: 0 }),
    part(G.cone(0.05, 0.12, 4), 0xf29a3a, { p: [0.28, 0.5, -0.07], ao: 0 }),
    part(G.sphere(0.025, 4, 3), 0x1a1a1a, { p: [0.39, 0.39, 0.06], ao: 0 }),
    part(G.sphere(0.025, 4, 3), 0x1a1a1a, { p: [0.39, 0.39, -0.06], ao: 0 }),
    tube([-0.25, 0.3, 0], [-0.5, 0.55, 0], 0.035, 0xf29a3a, 5),
    tube([0.15, 0.2, 0.07], [0.15, 0.0, 0.07], 0.04, 0xf5ae55, 5),
    tube([0.15, 0.2, -0.07], [0.15, 0.0, -0.07], 0.04, 0xf5ae55, 5),
    tube([-0.15, 0.2, 0.07], [-0.15, 0.0, 0.07], 0.04, 0xf5ae55, 5),
    tube([-0.15, 0.2, -0.07], [-0.15, 0.0, -0.07], 0.04, 0xf5ae55, 5),
  ], { aoH: 0.3 });
}
/** 减速带：横跨整条步道的黄黑条纹 */
export function buildBump() {
  const parts = [part(G.box(6, 0.04, 0.9), 0x6a6a72, { p: [0, 0.02, 0], ao: 0 })];
  for (let i = 0; i < 12; i++) parts.push(part(G.box(0.5, 0.1, 0.7), i % 2 ? 0x2a2a30 : 0xffcc2e, { p: [-2.75 + i * 0.5, 0.06, 0], ao: 0 }));
  return mergeParts(parts, { aoH: 0 });
}
/** 嗅桩：一截带苔藓的树桩，冒出气味波纹 */
export function buildStump() {
  return mergeParts([
    part(G.cyl(0.32, 0.4, 0.5, 9), 0x8a5e3a, { p: [0, 0.25, 0] }),
    part(G.cyl(0.3, 0.3, 0.03, 9), 0xd8b080, { p: [0, 0.52, 0], ao: 0 }),
    part(G.sphere(0.2, 7, 5), 0x5a9a44, { p: [0.15, 0.48, 0.2], s: [1, 0.5, 1], ao: 0 }),
    part(G.sphere(0.06, 5, 4), 0xff5a5a, { p: [-0.1, 0.12, 0.38], ao: 0 }),
    part(G.torus(0.14, 0.018, 4, 10, Math.PI), 0xcfe9a8, { p: [0.0, 0.85, 0], ao: 0 }),
    part(G.torus(0.2, 0.018, 4, 10, Math.PI), 0xcfe9a8, { p: [0.0, 1.0, 0], ao: 0 }),
  ], { aoH: 0.4 });
}

export const FEAR_BUILDERS = { sprinkler: buildSprinkler, sweeper: buildSweeper, balloons: buildBalloons };
export const MOVER_BUILDERS = { roomba: buildRoomba, rccar: buildRcCar, walker: buildWalker, stroller: buildStroller };
export const CRITTER_BUILDERS = { squirrel: buildSquirrel, cat: buildCat };
