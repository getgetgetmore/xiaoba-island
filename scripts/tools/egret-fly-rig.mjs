// 离线工具：把“飞行姿态的白鹭”模型（STL，无贴图、无骨骼）处理成游戏里空中状态用的资源 src/assets/egretFly.glb。
//   1. STL → GLB 并减面（在装了 @gltf-transform/cli 的目录里运行）：
//        node stl2glb.mjs flying_egret_model.stl f0.glb
//        gltf-transform simplify f0.glb f1.glb --ratio 0.03 --error 0.002
//   2. 本脚本：node egret-fly-rig.mjs f1.glb <项目>/src/assets/egretFly.glb
//      - 坐标换算到站立模型的骨架坐标系里（头朝 +Z，背部最高点对准小狗趴的位置），放大到和站立模型的身体一样粗；
//      - 按部位上顶点色：喙、腿黑色，脚黄色，其余白色（朝下的面略带灰蓝）；
//      - 绑骨：身体 / 左右翅各 3 节（按离身体的远近）/ 脖子 / 头 / 双腿，写成 JOINTS_0 / WEIGHTS_0；
//        骨骼的静止位置和翅膀上扬的角度写在节点的 extras.rig 里，运行时（src/world/egret.js）照着建骨架。
import { NodeIO } from '@gltf-transform/core';

const [, , IN = 'f1.glb', OUT = 'egretFly.glb'] = process.argv;
const io = new NodeIO();
const doc = await io.read(IN);
const root = doc.getRoot();
const node = root.listNodes().find((n) => n.getMesh());
const prim = node.getMesh().listPrimitives()[0];
const src = prim.getAttribute('POSITION').getArray(), idx = prim.getIndices().getArray(), n = src.length / 3;

// ---------------------------------------------------------------- 量出来的部位（模型原始坐标：头 +Z、上 +Y、翅膀沿 ±X）
const K = 1.8;                               // 放大倍数：身体的粗细和站立模型对上
const BACK = [0, -0.10, -0.12];              // 背部最高点（两翅之间）
const SEAT = [0, 1.45, -0.065];              // 它要对准的位置（站立模型骨架坐标系里小狗趴的地方）
const BODY_PIVOT = [0, 1.1, 0];              // 站立模型的身体枢轴：飞行模型的骨头都挂在它下面
const RAW = {
  shoulder: [0.13, -0.15, -0.1], elbow: [0.44, 0.04, -0.1], wrist: [0.69, 0.17, -0.1], tip: [0.94, 0.37, -0.1],
  neck: [0, -0.25, 0.19], head: [0, -0.24, 0.37], legs: [0, -0.33, -0.44],
  beakFrom: 0.515, legsFrom: -0.47, feetFrom: -0.655,
};
const toRig = (p) => [p[0] * K, (p[1] - BACK[1]) * K + SEAT[1], (p[2] - BACK[2]) * K + SEAT[2]];

// ---------------------------------------------------------------- 顶点：位置、法线、颜色、权重
const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
for (let i = 0; i < n; i++) { const q = toRig([src[i * 3], src[i * 3 + 1], src[i * 3 + 2]]); P[i * 3] = q[0]; P[i * 3 + 1] = q[1]; P[i * 3 + 2] = q[2]; }
for (let t = 0; t < idx.length; t += 3) { // 面积加权的顶点法线
  const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
}
const lin = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => Math.pow(v / 255, 2.2));
const WHITE = lin(0xfaf8f0), SHADE = lin(0xdbe0ea), BLACK = lin(0x23201f), YELLOW = lin(0xe8c53c);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// 骨骼编号（运行时按同样的顺序建）
const BONE = { body: 0, shR: 1, elR: 2, wrR: 3, shL: 4, elL: 5, wrL: 6, neck: 7, head: 8, legs: 9 };
const J = new Uint16Array(n * 4), W = new Float32Array(n * 4);
const set = (i, pairs) => {
  pairs = pairs.filter((q) => q[1] > 0.002).sort((a, b) => b[1] - a[1]).slice(0, 4);
  let s = 0; for (const q of pairs) s += q[1];
  for (let k = 0; k < 4; k++) { J[i * 4 + k] = k < pairs.length ? pairs[k][0] : 0; W[i * 4 + k] = k < pairs.length ? pairs[k][1] / s : 0; }
};
const count = {};
for (let i = 0; i < n; i++) {
  const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2], ax = Math.abs(x);
  const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
  N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l;
  // ---- 颜色
  let col = mix(SHADE, WHITE, Math.min(1, Math.max(0, 0.6 + 0.5 * N[i * 3 + 1])));
  const axial = ax < 0.09;
  if (axial && z > RAW.beakFrom) col = BLACK;
  else if (axial && z < RAW.feetFrom) col = YELLOW;
  else if (axial && z < RAW.legsFrom) col = BLACK;
  C[i * 3] = col[0]; C[i * 3 + 1] = col[1]; C[i * 3 + 2] = col[2];
  // ---- 权重
  let tag = 'body';
  if (ax > 0.09) { // 翅膀：按离身体的远近分三节
    const s = x > 0 ? 'R' : 'L';
    const wS = ss(0.09, 0.2, ax), wE = ss(RAW.elbow[0] - 0.07, RAW.elbow[0] + 0.07, ax), wW = ss(RAW.wrist[0] - 0.07, RAW.wrist[0] + 0.07, ax);
    set(i, [[BONE.body, 1 - wS], [BONE['sh' + s], wS * (1 - wE)], [BONE['el' + s], wE * (1 - wW)], [BONE['wr' + s], wW]]);
    tag = 'wing';
  } else if (z > RAW.neck[2] - 0.05) { // 脖子、头、喙
    const wN = ss(RAW.neck[2] - 0.05, RAW.neck[2] + 0.05, z), wH = ss(RAW.head[2] - 0.04, RAW.head[2] + 0.04, z);
    set(i, [[BONE.body, 1 - wN], [BONE.neck, wN * (1 - wH)], [BONE.head, wH]]);
    tag = 'neck';
  } else if (z < RAW.legs[2] + 0.05) { // 向后拖着的双腿
    const wL = ss(RAW.legs[2] + 0.05, RAW.legs[2] - 0.05, z);
    set(i, [[BONE.body, 1 - wL], [BONE.legs, wL]]);
    tag = 'legs';
  } else set(i, [[BONE.body, 1]]);
  count[tag] = (count[tag] || 0) + 1;
}
console.log('顶点分配', count);

// ---------------------------------------------------------------- 写出
const buffer = root.listBuffers()[0];
prim.getAttribute('POSITION').setArray(P);
prim.setAttribute('NORMAL', doc.createAccessor('normal').setType('VEC3').setArray(N).setBuffer(buffer));
prim.setAttribute('COLOR_0', doc.createAccessor('color').setType('VEC3').setArray(C).setBuffer(buffer));
prim.setAttribute('JOINTS_0', doc.createAccessor('joints').setType('VEC4').setArray(J).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor('weights').setType('VEC4').setArray(W).setBuffer(buffer));
const mirror = (p) => [-p[0], p[1], p[2]];
const bones = {
  body: BODY_PIVOT,
  shR: toRig(RAW.shoulder), elR: toRig(RAW.elbow), wrR: toRig(RAW.wrist),
  shL: toRig(mirror(RAW.shoulder)), elL: toRig(mirror(RAW.elbow)), wrL: toRig(mirror(RAW.wrist)),
  neck: toRig(RAW.neck), head: toRig(RAW.head), legs: toRig(RAW.legs),
};
const dihedral = Math.atan2(RAW.tip[1] - RAW.shoulder[1], RAW.tip[0] - RAW.shoulder[0]); // 模型里翅膀上扬的角度
const wingLen = Math.hypot(RAW.tip[0] - RAW.shoulder[0], RAW.tip[1] - RAW.shoulder[1]) * K;
node.setName('egretFly').setExtras({ rig: { order: Object.keys(BONE), bones, dihedral: +dihedral.toFixed(3), wingspan: +(2 * (wingLen + RAW.shoulder[0] * K)).toFixed(2) } });
await io.write(OUT, doc);
let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i * 3 + k]); max[k] = Math.max(max[k], P[i * 3 + k]); }
console.log('写出', OUT, '顶点', n, '三角形', idx.length / 3, '包围盒', min.map((a) => +a.toFixed(2)), max.map((a) => +a.toFixed(2)), '上扬角', dihedral.toFixed(2), '翼展', (2 * (wingLen + RAW.shoulder[0] * K)).toFixed(2));
