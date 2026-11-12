// 遛狗小游戏里的所有“物件”的几何（程序化建模，圆润可爱，每个物件一个带顶点色的合并几何）。
// 约定：单位米；物件正面朝 +z（朝向镜头）；原点在地面中心。横穿物沿本地 +x 方向前进。
import * as THREE from 'three';
import { part, mergeParts, tube, G } from './geo.js';
import { mulberry32 } from '../../core/util.js';

const SHADOW = 0x4d7b3a; // 草地上的“假影子”色块

function shadow(rx, rz, ox = 0.5, oz = -0.4) {
  return part(G.cyl(1, 1, 0.02, 16), SHADOW, { p: [ox, 0.012, oz], s: [rx, 1, rz], ao: 0 });
}

// ------------------------------------------------------------------ 路边景物
export function buildTree(kind = 'round', detail = 1) {
  const pink = kind === 'blossom';
  const c1 = pink ? 0xf0a0ba : 0x5c9a3e, c2 = pink ? 0xe58aa8 : 0x4f8c37, c3 = pink ? 0xf7b8cc : 0x6aa845, c4 = pink ? 0xfad0dc : 0x82b950;
  const parts = [
    shadow(1.9, 1.3, 1.3, -0.9),
    part(G.cyl(0.13, 0.22, 2.4, 6), pink ? 0x80594a : 0x7a5238, { p: [0, 1.2, 0] }),
    part(G.ico(1.45, detail), c1, { p: [0, 3.2, 0], s: [1, 0.9, 1] }),
    part(G.ico(1.1, detail), c2, { p: [0.95, 2.7, 0.3] }),
    part(G.ico(1.05, detail), c3, { p: [-0.9, 2.95, -0.3] }),
    part(G.ico(0.95, detail), c4, { p: [0.1, 4.05, 0.1] }),
    part(G.ico(0.8, detail), c2, { p: [-0.3, 2.5, 0.9] }),
  ];
  return mergeParts(parts, { aoH: 4.6 });
}

export function buildLamp() {
  const iron = 0x3b4640;
  const parts = [
    part(G.cyl(0.17, 0.22, 0.4, 6), iron, { p: [0, 0.2, 0] }),
    part(G.cyl(0.055, 0.08, 3.5, 6), iron, { p: [0, 1.95, 0] }),
    part(G.box(0.8, 0.07, 0.07), iron, { p: [0.4, 3.62, 0] }),
    part(G.cone(0.3, 0.22, 6), iron, { p: [0.78, 3.95, 0] }),
    part(G.sphere(0.24, 8, 6), 0xfff1b8, { p: [0.78, 3.66, 0], ao: 0 }),
    part(G.cyl(0.12, 0.12, 0.05, 8), iron, { p: [0.78, 3.4, 0], ao: 0 }),
    shadow(0.5, 0.35, 0.6, -0.2),
  ];
  return mergeParts(parts, { aoH: 0.8 });
}

export function buildBench() {
  const wood = 0xb97a3e, iron = 0x3a3d45;
  const parts = [shadow(1.1, 0.55, 0.45, -0.3)];
  for (let i = 0; i < 3; i++) parts.push(part(G.box(1.8, 0.05, 0.14), wood, { p: [0, 0.46, 0.2 - i * 0.16], ao: 0 }));
  for (let i = 0; i < 3; i++) parts.push(part(G.box(1.8, 0.14, 0.04), wood, { p: [0, 0.74 + i * 0.17, -0.2], r: [-0.12, 0, 0], ao: 0 }));
  for (const sx of [-0.8, 0.8]) {
    parts.push(part(G.box(0.07, 0.46, 0.07), iron, { p: [sx, 0.23, 0.25] }));
    parts.push(part(G.box(0.07, 0.95, 0.07), iron, { p: [sx, 0.47, -0.22], r: [-0.12, 0, 0] }));
    parts.push(part(G.box(0.07, 0.05, 0.5), iron, { p: [sx, 0.62, 0.0] }));
  }
  return mergeParts(parts, { aoH: 0.5 });
}

export function buildBush() {
  const rng = mulberry32(5);
  const parts = [
    shadow(1.2, 0.8, 0.6, -0.3),
    part(G.ico(0.75, 1), 0x4a8a3a, { p: [0, 0.5, 0], s: [1.1, 0.85, 1] }),
    part(G.ico(0.6, 1), 0x5c9d44, { p: [0.65, 0.4, 0.2] }),
    part(G.ico(0.55, 1), 0x3f7d34, { p: [-0.62, 0.38, -0.1] }),
    part(G.ico(0.45, 1), 0x6aaa4a, { p: [0.1, 0.8, 0.3] }),
  ];
  const fl = [0xff8fb0, 0xffffff, 0xffd84a];
  for (let i = 0; i < 6; i++) {
    const a = rng() * 6.28, h = 0.35 + rng() * 0.55, rr = 0.5 + rng() * 0.45;
    parts.push(part(G.sphere(0.075, 5, 4), fl[i % 3], { p: [Math.cos(a) * rr, h, Math.sin(a) * rr * 0.8 + 0.2], ao: 0 }));
  }
  return mergeParts(parts, { aoH: 1.0 });
}

export function buildFlowerbed() {
  const rng = mulberry32(9);
  const parts = [
    shadow(1.5, 0.8, 0.4, -0.3),
    part(G.box(2.4, 0.26, 0.9), 0x8c6242, { p: [0, 0.13, 0] }),
    part(G.box(2.2, 0.14, 0.7), 0x5a3f2c, { p: [0, 0.27, 0], ao: 0 }),
    part(G.ico(0.55, 1), 0x4f9440, { p: [-0.7, 0.36, 0], s: [1.3, 0.6, 1] }),
    part(G.ico(0.55, 1), 0x58a046, { p: [0.55, 0.36, 0], s: [1.3, 0.6, 1] }),
  ];
  const fl = [0xff6f9a, 0xffd23f, 0xffffff, 0xb67bff, 0xff8a3d, 0xff5252];
  for (let i = 0; i < 13; i++) {
    const x = (rng() - 0.5) * 2.0, z = (rng() - 0.5) * 0.55, h = 0.42 + rng() * 0.28;
    parts.push(part(G.sphere(0.1, 5, 4), fl[i % fl.length], { p: [x, h, z], ao: 0 }));
  }
  return mergeParts(parts, { aoH: 0.4 });
}

export function buildFence() {
  const cream = 0xf3e8d0;
  const parts = [];
  parts.push(part(G.box(2.0, 0.06, 0.05), cream, { p: [0, 0.3, -0.03], ao: 0 }));
  parts.push(part(G.box(2.0, 0.06, 0.05), cream, { p: [0, 0.62, -0.03], ao: 0 }));
  for (let i = 0; i < 6; i++) {
    const x = -0.83 + i * 0.332;
    parts.push(part(G.box(0.2, 0.8, 0.035), cream, { p: [x, 0.4, 0.0] }));
  }
  return mergeParts(parts, { aoH: 0.4 });
}

export function buildHouse() {
  const parts = [
    part(G.box(6.4, 3.6, 5.2), 0xffffff, { p: [0, 1.8, 0] }),
    part(G.cone(4.9, 2.5, 4), 0xc65a3c, { p: [0, 4.85, 0], r: [0, Math.PI / 4, 0], s: [1.04, 1, 0.84], ao: 0 }),
    part(G.box(1.0, 1.95, 0.12), 0x7b4a2d, { p: [0.4, 0.98, 2.62] }),
    part(G.box(1.2, 1.0, 0.1), 0x9fd2e6, { p: [-1.9, 2.1, 2.62], ao: 0 }),
    part(G.box(1.2, 1.0, 0.1), 0x9fd2e6, { p: [2.3, 2.1, 2.62], ao: 0 }),
    part(G.box(1.35, 0.1, 0.16), 0xf6f1e6, { p: [-1.9, 1.55, 2.66], ao: 0 }),
    part(G.box(1.35, 0.1, 0.16), 0xf6f1e6, { p: [2.3, 1.55, 2.66], ao: 0 }),
    part(G.box(0.7, 1.7, 0.7), 0xa8705e, { p: [1.9, 5.1, -0.6], ao: 0 }),
    shadow(3.9, 2.8, 2.6, -1.0),
  ];
  return mergeParts(parts, { aoH: 1.6 });
}

// ------------------------------------------------------------------ 固定障碍
export function buildCone() {
  return mergeParts([
    part(G.box(0.62, 0.05, 0.62), 0x34343a, { p: [0, 0.025, 0], ao: 0 }),
    part(G.cyl(0.05, 0.25, 0.72, 12), 0xff7a1e, { p: [0, 0.41, 0] }),
    part(G.cyl(0.152, 0.192, 0.17, 12), 0xfaf6ee, { p: [0, 0.33, 0], ao: 0 }),
    part(G.sphere(0.055, 8, 6), 0xff7a1e, { p: [0, 0.78, 0], ao: 0 }),
  ], { aoH: 0.5 });
}

export function buildPuddle() {
  return mergeParts([
    part(G.cyl(0.9, 0.9, 0.03, 20), 0x7fb8dc, { p: [0, 0.016, 0], s: [1, 1, 0.74], ao: 0 }),
    part(G.cyl(0.6, 0.6, 0.034, 18), 0xaed9ef, { p: [-0.12, 0.02, 0.04], s: [1, 1, 0.7], ao: 0 }),
    part(G.cyl(0.26, 0.26, 0.038, 14), 0xe3f4fb, { p: [-0.3, 0.024, 0.05], s: [1, 1, 0.6], ao: 0 }),
    part(G.sphere(0.08, 6, 5), 0x9a9aa0, { p: [0.95, 0.04, 0.2], s: [1, 0.6, 1], ao: 0 }),
    part(G.sphere(0.06, 6, 5), 0x8d8d95, { p: [-1.0, 0.03, -0.1], s: [1, 0.6, 1], ao: 0 }),
  ], { aoH: 0 });
}

export function buildHydrant() {
  const red = 0xe0382b, silver = 0xcfd4da;
  return mergeParts([
    part(G.cyl(0.21, 0.25, 0.12, 10), 0xb3241a, { p: [0, 0.06, 0] }),
    part(G.cyl(0.165, 0.19, 0.5, 10), red, { p: [0, 0.36, 0] }),
    part(G.cyl(0.16, 0.16, 0.06, 10), 0xf2c230, { p: [0, 0.2, 0], ao: 0 }),
    part(G.sphere(0.175, 10, 8), red, { p: [0, 0.62, 0], s: [1, 0.8, 1] }),
    part(G.cyl(0.05, 0.07, 0.1, 8), silver, { p: [0, 0.8, 0], ao: 0 }),
    part(G.cyl(0.075, 0.075, 0.56, 8), red, { p: [0, 0.46, 0], r: [0, 0, Math.PI / 2] }),
    part(G.cyl(0.09, 0.09, 0.05, 8), silver, { p: [0.29, 0.46, 0], r: [0, 0, Math.PI / 2], ao: 0 }),
    part(G.cyl(0.09, 0.09, 0.05, 8), silver, { p: [-0.29, 0.46, 0], r: [0, 0, Math.PI / 2], ao: 0 }),
    part(G.cyl(0.085, 0.085, 0.2, 8), red, { p: [0, 0.4, 0.17], r: [Math.PI / 2, 0, 0] }),
    part(G.cyl(0.1, 0.1, 0.05, 8), silver, { p: [0, 0.4, 0.28], r: [Math.PI / 2, 0, 0], ao: 0 }),
  ], { aoH: 0.5 });
}

export function buildBin() {
  return mergeParts([
    part(G.cyl(0.37, 0.3, 0.82, 14), 0x3f9a5a, { p: [0, 0.41, 0] }),
    part(G.cyl(0.36, 0.33, 0.12, 14), 0xeef2e4, { p: [0, 0.46, 0], ao: 0 }),
    part(G.cyl(0.4, 0.4, 0.08, 14), 0x2c6d42, { p: [0, 0.86, 0], ao: 0 }),
    part(G.sphere(0.07, 8, 6), 0x2c6d42, { p: [0, 0.94, 0], ao: 0 }),
    part(G.sphere(0.12, 7, 6), 0xf4f1e8, { p: [0.28, 0.98, 0.12], s: [1, 0.8, 1], ao: 0 }), // 溢出来的废纸团
    part(G.sphere(0.1, 7, 6), 0xe9d9b8, { p: [-0.2, 1.0, -0.14], ao: 0 }),
  ], { aoH: 0.6 });
}

export function buildBox() {
  return mergeParts([
    part(G.box(0.84, 0.56, 0.64), 0xc89256, { p: [0, 0.28, 0] }),
    part(G.box(0.88, 0.02, 0.14), 0xe8d3a2, { p: [0, 0.565, 0], ao: 0 }),
    part(G.box(0.58, 0.4, 0.5), 0xd8a766, { p: [0.04, 0.76, 0], r: [0, 0.3, 0] }),
    part(G.box(0.1, 0.02, 0.52), 0xe8d3a2, { p: [0.04, 0.965, 0], r: [0, 0.3, 0], ao: 0 }),
    part(G.box(0.2, 0.14, 0.01), 0xf4efe4, { p: [-0.2, 0.3, 0.33], ao: 0 }),
  ], { aoH: 0.5 });
}

export function buildBarrier() {
  const parts = [];
  for (const sx of [-0.85, 0.85]) {
    parts.push(part(G.box(0.09, 1.0, 0.09), 0x4b4e57, { p: [sx, 0.5, 0] }));
    parts.push(part(G.box(0.12, 0.06, 0.62), 0x34363e, { p: [sx, 0.03, 0], ao: 0 }));
  }
  const red = 0xe63b2b, white = 0xfaf5ec;
  for (let b = 0; b < 2; b++) {
    for (let i = 0; i < 5; i++) {
      parts.push(part(G.box(0.4, 0.22, 0.06), (i + b) % 2 ? white : red, { p: [-0.8 + i * 0.4, 0.58 + b * 0.27, 0.06], ao: 0 }));
    }
  }
  parts.push(part(G.sphere(0.1, 8, 6), 0xffcc2e, { p: [-0.85, 1.08, 0], ao: 0 }));
  parts.push(part(G.cyl(0.08, 0.08, 0.06, 8), 0x4b4e57, { p: [-0.85, 1.0, 0], ao: 0 }));
  return mergeParts(parts, { aoH: 0.5 });
}

// ------------------------------------------------------------------ 诱惑物
function pigeon(x, z, yaw) {
  // 先在小鸟自己的坐标系里搭，再整体平移/转向（用一个变换矩阵展开成 part）
  const local = [
    part(G.sphere(0.14, 8, 6), 0x9aa3ad, { p: [0, 0.18, 0], s: [1, 0.85, 1.4] }),
    part(G.sphere(0.075, 7, 6), 0x7a828d, { p: [0, 0.3, 0.17], ao: 0 }),
    part(G.sphere(0.06, 6, 5), 0x69b0a0, { p: [0, 0.25, 0.11], ao: 0 }),
    part(G.cone(0.022, 0.07, 5), 0xf0b040, { p: [0, 0.29, 0.26], r: [Math.PI / 2, 0, 0], ao: 0 }),
    part(G.box(0.1, 0.02, 0.16), 0x68707a, { p: [0, 0.19, -0.2], r: [0.25, 0, 0], ao: 0 }),
    part(G.sphere(0.09, 6, 5), 0x848d97, { p: [0.12, 0.2, -0.02], s: [0.4, 0.55, 1.3], ao: 0 }),
    part(G.sphere(0.09, 6, 5), 0x848d97, { p: [-0.12, 0.2, -0.02], s: [0.4, 0.55, 1.3], ao: 0 }),
    part(G.sphere(0.014, 5, 4), 0x111111, { p: [0.04, 0.32, 0.22], ao: 0 }),
    part(G.sphere(0.014, 5, 4), 0x111111, { p: [-0.04, 0.32, 0.22], ao: 0 }),
    tube([0.04, 0.06, 0], [0.04, 0.0, 0.02], 0.012, 0xe08a7a, 4),
    tube([-0.04, 0.06, 0], [-0.04, 0.0, 0.02], 0.012, 0xe08a7a, 4),
  ];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return local.map((pt) => {
    const ql = pt.q ? pt.q.clone() : new THREE.Quaternion().setFromEuler(new THREE.Euler(pt.r[0], pt.r[1], pt.r[2]));
    return { ...pt, p: [pt.p[0] * c + pt.p[2] * s + x, pt.p[1], -pt.p[0] * s + pt.p[2] * c + z], q: qy.clone().multiply(ql) };
  });
}

export function buildPigeons() {
  const rng = mulberry32(21);
  const parts = [];
  const pos = [[0.0, 0.1], [0.45, -0.2], [-0.5, 0.0], [0.2, 0.42], [-0.15, -0.4]];
  pos.forEach(([x, z], i) => parts.push(...pigeon(x, z, rng() * 6.28)));
  // 地上撒着几粒面包屑
  for (let i = 0; i < 5; i++) parts.push(part(G.sphere(0.03, 5, 4), 0xe6c98a, { p: [(rng() - 0.5) * 1.1, 0.03, (rng() - 0.5) * 0.9], ao: 0 }));
  return mergeParts(parts, { aoH: 0.4 });
}

/** 另一只小狗（奶白色，红领圈，正对着镜头坐着摇尾巴） */
export function buildOtherDog() {
  const cream = 0xf2e0bd, tan = 0xc98a4b, white = 0xfaf4e8;
  return mergeParts([
    part(G.sphere(0.3, 10, 8), cream, { p: [0, 0.38, -0.05], s: [0.85, 0.8, 1.25] }),
    part(G.sphere(0.2, 8, 6), white, { p: [0, 0.34, 0.14], s: [1, 1.2, 0.8], ao: 0 }),
    part(G.sphere(0.21, 10, 8), cream, { p: [0, 0.72, 0.2] }),
    part(G.sphere(0.11, 8, 6), white, { p: [0, 0.65, 0.38], s: [1.1, 0.8, 0.9], ao: 0 }),
    part(G.sphere(0.035, 6, 5), 0x1a1a1a, { p: [0, 0.69, 0.47], ao: 0 }),
    part(G.sphere(0.03, 6, 5), 0x1a1a1a, { p: [0.08, 0.78, 0.38], ao: 0 }),
    part(G.sphere(0.03, 6, 5), 0x1a1a1a, { p: [-0.08, 0.78, 0.38], ao: 0 }),
    part(G.sphere(0.04, 6, 5), 0xf08ca0, { p: [0, 0.58, 0.42], s: [1, 0.5, 1], ao: 0 }),
    part(G.cone(0.085, 0.2, 5), tan, { p: [0.14, 0.93, 0.18], r: [0.2, 0, -0.35], ao: 0 }),
    part(G.cone(0.085, 0.2, 5), tan, { p: [-0.14, 0.93, 0.18], r: [0.2, 0, 0.35], ao: 0 }),
    part(G.torus(0.19, 0.035, 6, 14), 0xd8342a, { p: [0, 0.56, 0.14], r: [Math.PI / 2 - 0.3, 0, 0], ao: 0 }),
    part(G.sphere(0.035, 6, 5), 0xf2c230, { p: [0, 0.49, 0.3], ao: 0 }),
    tube([0.12, 0.3, 0.2], [0.12, 0.02, 0.26], 0.055, white, 6),
    tube([-0.12, 0.3, 0.2], [-0.12, 0.02, 0.26], 0.055, white, 6),
    part(G.sphere(0.07, 6, 5), cream, { p: [0.18, 0.06, -0.12], s: [0.8, 0.8, 1.4] }),
    part(G.sphere(0.07, 6, 5), cream, { p: [-0.18, 0.06, -0.12], s: [0.8, 0.8, 1.4] }),
    part(G.torus(0.12, 0.05, 6, 12, Math.PI * 1.5), tan, { p: [0.08, 0.5, -0.4], r: [0, 0.3, 0.6], ao: 0 }),
  ], { aoH: 0.5 });
}

/** 掉在地上的热狗（面包 + 香肠 + 芥末） */
export function buildSausage() {
  const parts = [
    part(G.capsule(0.13, 0.5), 0xefbf72, { p: [0, 0.14, 0], r: [0, 0, Math.PI / 2], s: [1, 1, 1.15] }),
    part(G.capsule(0.095, 0.66), 0xc4432b, { p: [0, 0.23, 0.0], r: [0, 0, Math.PI / 2], ao: 0 }),
  ];
  for (let i = 0; i < 6; i++) parts.push(part(G.sphere(0.034, 5, 4), 0xffd23a, { p: [-0.3 + i * 0.12, 0.33, 0.01 + (i % 2 ? 0.03 : -0.03)], ao: 0 }));
  for (let i = 0; i < 3; i++) parts.push(part(G.sphere(0.03, 5, 4), 0xf4ede0, { p: [-0.2 + i * 0.2, 0.1, 0.17], ao: 0 })); // 面包屑
  return mergeParts(parts, { aoH: 0.3 });
}

export function buildIceCream() {
  return mergeParts([
    part(G.cyl(0.3, 0.3, 0.02, 14), 0xf8b9d2, { p: [0, 0.012, 0.04], s: [1.1, 1, 0.8], ao: 0 }),
    part(G.sphere(0.17, 10, 8), 0xf49ac1, { p: [0, 0.12, 0.02], s: [1.05, 0.75, 1] }),
    part(G.sphere(0.14, 10, 8), 0xfff1cc, { p: [0.12, 0.25, -0.02] }),
    part(G.sphere(0.04, 6, 5), 0xd62839, { p: [0.13, 0.4, -0.02], ao: 0 }),
    part(G.cone(0.115, 0.4, 10), 0xe6b068, { p: [-0.3, 0.2, 0.04], r: [0, 0, 1.05], ao: 0 }),
    part(G.cyl(0.118, 0.118, 0.025, 10), 0xc98d4a, { p: [-0.14, 0.27, 0.03], r: [0, 0, 1.05], ao: 0 }),
  ], { aoH: 0.3 });
}

// ------------------------------------------------------------------ 横穿物
export function buildBall() {
  return mergeParts([
    part(G.sphere(0.34, 14, 10), 0xfbf8f0, { ao: 0 }),
    part(G.torus(0.342, 0.05, 6, 20), 0xe83a3a, { r: [Math.PI / 2, 0, 0], ao: 0 }),
    part(G.torus(0.342, 0.05, 6, 20), 0x3a7de8, { r: [0, 0, 0], ao: 0 }),
    part(G.torus(0.342, 0.05, 6, 20), 0xf5c542, { r: [0, Math.PI / 2, 0], ao: 0 }),
    part(G.sphere(0.07, 6, 5), 0xe83a3a, { p: [0, 0.34, 0], ao: 0 }),
  ], { aoH: 0 });
}

export function buildBike() {
  const frame = 0xd8402e, dark = 0x2b2b30, skin = 0xf2c4a0, shirt = 0x2a8fd6, pants = 0x39466b;
  const parts = [];
  for (const sx of [-0.62, 0.62]) {
    parts.push(part(G.torus(0.34, 0.035, 6, 20), dark, { p: [sx, 0.38, 0], ao: 0 }));
    parts.push(part(G.torus(0.3, 0.008, 4, 20), 0xcfd3d8, { p: [sx, 0.38, 0], ao: 0 }));
    parts.push(part(G.sphere(0.05, 6, 5), 0xcfd3d8, { p: [sx, 0.38, 0], ao: 0 }));
  }
  parts.push(tube([-0.62, 0.38, 0], [-0.1, 0.4, 0], 0.025, frame, 6));
  parts.push(tube([-0.1, 0.4, 0], [-0.25, 0.85, 0], 0.025, frame, 6));
  parts.push(tube([-0.25, 0.85, 0], [0.42, 0.88, 0], 0.025, frame, 6));
  parts.push(tube([-0.1, 0.4, 0], [0.42, 0.88, 0], 0.025, frame, 6));
  parts.push(tube([0.42, 0.88, 0], [0.62, 0.38, 0], 0.025, frame, 6));
  parts.push(tube([0.42, 0.88, 0], [0.5, 1.0, 0], 0.025, dark, 6));
  parts.push(tube([0.5, 1.0, -0.2], [0.5, 1.0, 0.2], 0.022, dark, 6));
  parts.push(part(G.box(0.26, 0.05, 0.1), dark, { p: [-0.28, 0.9, 0], ao: 0 }));
  // 骑车的人
  parts.push(part(G.capsule(0.13, 0.34), shirt, { p: [-0.12, 1.3, 0], r: [0, 0, -0.35], ao: 0 }));
  parts.push(part(G.sphere(0.14, 8, 6), skin, { p: [0.05, 1.72, 0], ao: 0 }));
  parts.push(part(G.sphere(0.16, 8, 6), 0xffc20e, { p: [0.03, 1.77, 0], s: [1.05, 0.8, 1.05], ao: 0 }));
  parts.push(tube([-0.25, 1.02, 0.07], [0.02, 0.58, 0.12], 0.06, pants, 6));
  parts.push(tube([-0.25, 1.02, -0.07], [-0.1, 0.5, -0.12], 0.06, pants, 6));
  parts.push(tube([0.0, 1.5, 0.08], [0.48, 1.0, 0.12], 0.045, skin, 6));
  parts.push(tube([0.0, 1.5, -0.08], [0.48, 1.0, -0.12], 0.045, skin, 6));
  parts.push(part(G.sphere(0.06, 6, 5), 0x333333, { p: [0.03, 0.55, 0.12], s: [1.6, 0.8, 1], ao: 0 }));
  return mergeParts(parts, { aoH: 0 });
}

export function buildSkate() {
  const skin = 0xf2c4a0, pants = 0x4a5a8c, shirt = 0xf3c63c;
  const parts = [
    part(G.box(0.86, 0.05, 0.24), 0x2fc1a0, { p: [0, 0.13, 0], ao: 0 }),
    part(G.box(0.18, 0.045, 0.24), 0x2fc1a0, { p: [0.47, 0.17, 0], r: [0, 0, 0.35], ao: 0 }),
    part(G.box(0.18, 0.045, 0.24), 0x2fc1a0, { p: [-0.47, 0.17, 0], r: [0, 0, -0.35], ao: 0 }),
  ];
  for (const sx of [-0.28, 0.28]) for (const sz of [-0.1, 0.1]) parts.push(part(G.cyl(0.05, 0.05, 0.035, 8), 0xf7e7c6, { p: [sx, 0.06, sz], r: [Math.PI / 2, 0, 0], ao: 0 }));
  // 滑板少年（侧身站在板上，双臂张开）
  parts.push(tube([-0.2, 0.16, 0], [-0.17, 0.72, 0], 0.075, pants, 7));
  parts.push(tube([0.2, 0.16, 0], [0.16, 0.72, 0], 0.075, pants, 7));
  parts.push(part(G.box(0.16, 0.07, 0.12), 0xffffff, { p: [-0.2, 0.19, 0.02], ao: 0 }));
  parts.push(part(G.box(0.16, 0.07, 0.12), 0xffffff, { p: [0.2, 0.19, 0.02], ao: 0 }));
  parts.push(part(G.capsule(0.15, 0.32), shirt, { p: [0, 1.0, 0], ao: 0 }));
  parts.push(part(G.sphere(0.15, 8, 6), skin, { p: [0.02, 1.43, 0], ao: 0 }));
  parts.push(part(G.sphere(0.165, 8, 6), 0xe84a3a, { p: [-0.01, 1.48, 0], s: [1.05, 0.7, 1.05], ao: 0 }));
  parts.push(part(G.box(0.2, 0.03, 0.16), 0xe84a3a, { p: [0.17, 1.46, 0], ao: 0 }));
  parts.push(tube([0.1, 1.2, 0], [0.62, 1.34, 0], 0.045, skin, 6));
  parts.push(tube([-0.1, 1.2, 0], [-0.62, 1.34, 0], 0.045, skin, 6));
  parts.push(part(G.sphere(0.012, 4, 3), 0x111111, { p: [0.12, 1.45, 0.14], ao: 0 }));
  return mergeParts(parts, { aoH: 0 });
}

// ------------------------------------------------------------------ 收集物 / 提示牌
export function buildBone() {
  const c = 0xfff1d2;
  return mergeParts([
    part(G.cyl(0.05, 0.05, 0.34, 6), c, { r: [0, 0, Math.PI / 2], ao: 0 }),
    part(G.sphere(0.08, 6, 4), c, { p: [0.18, 0.045, 0], ao: 0 }),
    part(G.sphere(0.08, 6, 4), c, { p: [0.18, -0.045, 0], ao: 0 }),
    part(G.sphere(0.08, 6, 4), c, { p: [-0.18, 0.045, 0], ao: 0 }),
    part(G.sphere(0.08, 6, 4), c, { p: [-0.18, -0.045, 0], ao: 0 }),
    // 脚下的金色光圈
    part(G.torus(0.27, 0.03, 4, 14), 0xffd24a, { p: [0, -0.5, 0], r: [Math.PI / 2, 0, 0], ao: 0 }),
  ], { aoH: 0 });
}

export function buildWarnSign() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.6); shape.lineTo(-0.56, -0.34); shape.lineTo(0.56, -0.34); shape.closePath();
  const ext = (sc, depth) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    g.scale(sc, sc, 1);
    return g;
  };
  return mergeParts([
    part(G.cyl(0.04, 0.05, 2.0, 6), 0x6b6f77, { p: [0, 1.0, 0] }),
    part(ext(1.22, 0.05), 0x2a2a30, { p: [0, 2.15, -0.02], ao: 0 }),
    part(ext(1.0, 0.05), 0xffc926, { p: [0, 2.15, 0.02], ao: 0 }),
    part(G.box(0.1, 0.34, 0.04), 0x24242a, { p: [0, 2.2, 0.07], ao: 0 }),
    part(G.sphere(0.058, 8, 6), 0x24242a, { p: [0, 1.93, 0.07], s: [1, 1, 0.5], ao: 0 }),
    part(G.cyl(0.1, 0.13, 0.1, 8), 0x555a62, { p: [0, 0.05, 0] }),
  ], { aoH: 0.4 });
}

/** 四角星（火花 / 星星）：朝 +z 的平面 */
export function buildStar() {
  const s = new THREE.Shape();
  const n = 4, R = 0.5, r = 0.16;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2;
    const rad = i % 2 ? r : R;
    if (i === 0) s.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); else s.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

export const FIXED_BUILDERS = { cone: buildCone, puddle: buildPuddle, hydrant: buildHydrant, bin: buildBin, box: buildBox, barrier: buildBarrier };
export const LURE_BUILDERS = { pigeons: buildPigeons, dog: buildOtherDog, sausage: buildSausage, icecream: buildIceCream };
export const CROSS_BUILDERS = { ball: buildBall, bike: buildBike, skate: buildSkate };
