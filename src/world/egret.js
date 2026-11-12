// 小白鹭（Little Egret）：程序化建模 + 程序动画。
//  - 整只鸟是一个 SkinnedMesh（1 个 draw call）：身体 / 4 节脖子 / 头 / 双翅各 3 节 / 双腿各 3 节 / 尾 / 蓑羽 / 饰羽
//    都是刚性绑定到对应骨骼的低面数部件，逐帧只改骨骼的 position / rotation。
//  - 约定：group 原点 = 站立时两脚之间的地面，头朝本地 +Z，+Y 向上。
//  - 腿用解析的两节 IK（在身体的侧面平面内）：行走时脚落地后在地面上不动，不打滑。
//  - 状态靠一组连续参数（目标值 + 指数逼近）平滑过渡，约 0.4 秒；update 内不分配对象。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, cylBetween, blob, mixHex } from './island/geo.js';
import { paintMaterial } from '../core/paint.js';

export const EGRET_STATES = ['fly', 'glide', 'land', 'stand', 'walk', 'peck', 'takeoff'];

// ------------------------------------------------------------------ 颜色
const WHITE = 0xfaf8f0, SHADE = 0xdfe3ec, BLACK = 0x23201f, YELLOW = 0xe8c53c, LORES = 0xbfc65a, IRIS = 0xefdc7c;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const whiteFn = (nx, ny) => mixHex(SHADE, WHITE, clamp(0.55 + 0.5 * ny, 0, 1));

// ------------------------------------------------------------------ 几何常量（站立姿势 = 绑定姿势，翅膀张开）
const BODY_PIVOT = [0, 1.1, 0];
// 脖子各关节（y, z），S 形：下段向前凸、中段向后收、上段又向前
const NECK = [[1.2, 0.5], [1.42, 0.8], [1.62, 0.52], [1.79, 0.62], [1.9, 0.74]];
const HEAD_REST = 1.75;
const WING = { sx: 0.27, sy: 1.26, sz: 0.12, l1: 0.4, l2: 0.43, l3: 0.38 };
const HIP = [0.11, 1.0, 0.02], ANKLE = [0.11, 0.5, -0.07], FOOT = [0.11, 0.04, 0.0];
const STAND_FOOT_Y = 0.04;

// 一张平面多边形（扇形三角化），点序 → BufferGeometry（非索引）
function polyGeo(pts) {
  const pos = [];
  for (let i = 1; i < pts.length - 1; i++) pos.push(...pts[0], ...pts[i], ...pts[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** 一片叶形羽毛（在 XZ 平面内）：根部 base，朝向与 -Z 夹角 a（向外为正），长 len，宽 w。sgn=-1 为左翅（x 镜像） */
function leaf(b, base, a, len, w, sgn, color = whiteFn) {
  const dx = sgn * Math.sin(a), dz = -Math.cos(a);
  const px = sgn * Math.cos(a), pz = Math.sin(a);
  const [x, y, z] = base, h = w / 2;
  const mx = x + dx * len * 0.72, mz = z + dz * len * 0.72;
  let pts = [
    [x - px * h, y, z - pz * h], [x + px * h, y, z + pz * h],
    [mx + px * h * 0.9, y, mz + pz * h * 0.9], [x + dx * len, y, z + dz * len], [mx - px * h * 0.9, y, mz - pz * h * 0.9],
  ];
  if (sgn < 0) pts = pts.reverse();
  b.add(polyGeo(pts), { color, jitter: 0.04, ao: false });
}

/** 细长的垂坠羽丝：沿折线（点列）做逐段渐细的圆柱 */
function strand(b, pts, r0, r1, color = WHITE) {
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const t0 = r0 + (r1 - r0) * (i / n), t1 = r0 + (r1 - r0) * ((i + 1) / n);
    cylBetween(b, pts[i], pts[i + 1], t0, t1, 4, { color, jitter: 0.03, ao: false });
  }
}

export function createEgret() {
  // ================================================================== 骨骼
  const bones = [], boneIndex = {}, boneAbs = {};
  const B = {}; // 每根骨骼一个 GeoBuilder
  function mk(name, parentName, abs) {
    const bone = new THREE.Bone();
    bone.name = name;
    const pa = parentName ? boneAbs[parentName] : [0, 0, 0];
    bone.position.set(abs[0] - pa[0], abs[1] - pa[1], abs[2] - pa[2]);
    if (parentName) bones[boneIndex[parentName]].add(bone);
    boneIndex[name] = bones.length; boneAbs[name] = abs; bones.push(bone);
    B[name] = new GeoBuilder({ seed: 11 + bones.length * 7, jitter: 0.04, aoH: 0.4, aoK: 0.2 });
    return bone;
  }
  const root = mk('root', null, [0, 0, 0]);
  const body = mk('body', 'root', BODY_PIVOT);
  const neck = [];
  neck.push(mk('neck0', 'body', [0, NECK[0][0], NECK[0][1]]));
  for (let i = 1; i < 4; i++) neck.push(mk('neck' + i, 'neck' + (i - 1), [0, NECK[i][0], NECK[i][1]]));
  const head = mk('head', 'neck3', [0, NECK[4][0], NECK[4][1]]);
  const crestA = mk('crestA', 'head', [-0.02, 1.95, 0.64]);
  const crestB = mk('crestB', 'head', [0.02, 1.94, 0.64]);
  const tail = mk('tail', 'body', [0, 1.14, -0.52]);
  const back = mk('back', 'body', [0, 1.3, 0.12]);
  const wing = { R: {}, L: {} };
  for (const [side, sgn] of [['R', 1], ['L', -1]]) {
    const W = WING, x0 = sgn * W.sx, x1 = sgn * (W.sx + W.l1), x2 = sgn * (W.sx + W.l1 + W.l2);
    wing[side] = {
      sgn,
      sh: mk('shoulder' + side, 'body', [x0, W.sy, W.sz]),
      el: mk('elbow' + side, 'shoulder' + side, [x1, W.sy, W.sz - 0.02]),
      wr: mk('wrist' + side, 'elbow' + side, [x2, W.sy, W.sz - 0.04]),
    };
    wing[side].sh.rotation.order = wing[side].el.rotation.order = wing[side].wr.rotation.order = 'ZYX';
  }
  const leg = { R: {}, L: {} };
  for (const [side, sgn] of [['R', 1], ['L', -1]]) {
    leg[side] = {
      sgn,
      th: mk('hip' + side, 'body', [sgn * HIP[0], HIP[1], HIP[2]]),
      an: mk('ankle' + side, 'hip' + side, [sgn * ANKLE[0], ANKLE[1], ANKLE[2]]),
      ft: mk('foot' + side, 'ankle' + side, [sgn * FOOT[0], FOOT[1], FOOT[2]]),
    };
  }

  // ================================================================== 几何
  // —— 身体：前窄后宽的水滴形
  blob(B.body, [0, 1.15, 0.3], 1, 1, { color: whiteFn, scale: [0.22, 0.26, 0.3] });
  blob(B.body, [0, 1.08, -0.08], 1, 1, { color: whiteFn, scale: [0.27, 0.27, 0.42] });
  blob(B.body, [0, 1.13, -0.38], 1, 1, { color: whiteFn, scale: [0.2, 0.18, 0.26] });
  blob(B.body, [0, 1.25, 0.04], 1, 1, { color: whiteFn, scale: [0.27, 0.14, 0.4] });
  // —— 脖子：逐段锥形 + 关节球
  const nr = [0.075, 0.062, 0.05, 0.043];
  for (let i = 0; i < 4; i++) {
    const p = [0, NECK[i][0], NECK[i][1]], q = [0, NECK[i + 1][0], NECK[i + 1][1]];
    cylBetween(B['neck' + i], p, q, nr[i], i < 3 ? nr[i + 1] : 0.038, 7, { color: whiteFn, ao: false });
    blob(B['neck' + i], p, nr[i] * 1.02, 1, { color: whiteFn, ao: false });
  }
  // 颈基部的胸饰羽（垂在胸前的丝状羽）
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.034, z = 0.52 + (i % 2) * 0.04;
    strand(B.neck0, [[x, 1.3, z + 0.02], [x * 1.3, 1.16, z + 0.09], [x * 1.5, 1.0 - (i % 3) * 0.04, z + 0.06]], 0.018, 0.004);
  }
  // —— 头：小而圆；长直尖的黑喙；黄绿色眼先；浅色虹膜小眼睛
  blob(B.head, [0, 1.915, 0.73], 1, 1, { color: whiteFn, ao: false, scale: [0.078, 0.085, 0.115] });
  cylBetween(B.head, [0, 1.915, 0.8], [0, 1.835, 1.26], 0.034, 0.004, 6, { color: BLACK, ao: false, jitter: 0.02 });
  for (const s of [-1, 1]) {
    blob(B.head, [s * 0.04, 1.915, 0.84], 1, 1, { color: LORES, ao: false, scale: [0.03, 0.03, 0.06] });
    blob(B.head, [s * 0.064, 1.935, 0.77], 1, 1, { color: IRIS, ao: false, scale: [0.022, 0.028, 0.028] });
    blob(B.head, [s * 0.073, 1.935, 0.775], 1, 0, { color: BLACK, ao: false, scale: [0.013, 0.016, 0.016] });
  }
  // —— 后脑的两根细长饰羽
  for (const [bn, sx] of [['crestA', -0.02], ['crestB', 0.02]]) {
    strand(B[bn], [[sx, 1.95, 0.64], [sx * 1.5, 1.91, 0.45], [sx * 2, 1.83, 0.24], [sx * 2.5, 1.74, 0.05]], 0.014, 0.002);
  }
  // —— 背上蓬松的蓑羽：几束细长的丝状羽，从肩背垂到尾上
  for (let i = 0; i < 9; i++) {
    const x = (i - 4) * 0.032, k = i % 3;
    strand(B.back, [[x, 1.36, 0.2 - k * 0.05], [x * 1.4, 1.37, -0.12], [x * 1.8, 1.31 - k * 0.04, -0.46], [x * 2.0, 1.2 - k * 0.06, -0.8 - k * 0.03]], 0.02, 0.003);
  }
  // —— 尾：短扇
  for (let i = 0; i < 5; i++) leaf(B.tail, [0, 1.12 + i * 0.004, -0.52], (i - 2) * 0.13, 0.26, 0.1, 1);
  // —— 翅膀（张开姿势）：前缘细管 + 一排排叶形飞羽；初级飞羽在手部扇形展开
  for (const side of ['R', 'L']) {
    const sgn = wing[side].sgn, W = WING;
    const X = (v) => sgn * v, y0 = W.sy, z0 = W.sz;
    const e1 = W.sx + W.l1, e2 = e1 + W.l2, e3 = e2 + W.l3;
    // 前缘
    cylBetween(B['shoulder' + side], [X(W.sx - 0.03), y0, z0], [X(e1), y0, z0 - 0.02], 0.055, 0.045, 6, { color: whiteFn, ao: false });
    cylBetween(B['elbow' + side], [X(e1), y0, z0 - 0.02], [X(e2), y0, z0 - 0.04], 0.045, 0.036, 6, { color: whiteFn, ao: false });
    cylBetween(B['wrist' + side], [X(e2), y0, z0 - 0.04], [X(e3), y0 - 0.01, z0 - 0.06], 0.036, 0.016, 6, { color: whiteFn, ao: false });
    // 上臂：覆羽
    for (let i = 0; i < 5; i++) leaf(B['shoulder' + side], [X(W.sx + 0.02 + i * 0.1), y0 + 0.004 * (i % 2), z0 - 0.02], 0.04 + i * 0.02, 0.46 - i * 0.01, 0.15, sgn);
    // 前臂：次级飞羽
    for (let i = 0; i < 7; i++) leaf(B['elbow' + side], [X(e1 + i * 0.065), y0 - 0.004 * (i % 2) - 0.002, z0 - 0.035 - i * 0.002], 0.05 + i * 0.03, 0.5 - i * 0.012, 0.13, sgn);
    // 手：初级飞羽，扇形
    for (let i = 0; i < 6; i++) leaf(B['wrist' + side], [X(e2 + 0.02 + i * 0.045), y0 + 0.003 * (i % 2) - 0.004, z0 - 0.06 - i * 0.004], 0.2 + i * 0.16, 0.5, 0.11, sgn);
  }
  // —— 腿：羽毛腿（白，短）+ 黑色细长的胫、跗，黑色“膝”（踝）向后凸，黄色长趾
  for (const side of ['R', 'L']) {
    const s = leg[side].sgn, h = [s * HIP[0], HIP[1], HIP[2]], a = [s * ANKLE[0], ANKLE[1], ANKLE[2]], f = [s * FOOT[0], FOOT[1], FOOT[2]];
    const m = [h[0], h[1] + (a[1] - h[1]) * 0.3, h[2] + (a[2] - h[2]) * 0.3];
    cylBetween(B['hip' + side], h, m, 0.085, 0.05, 7, { color: whiteFn, ao: false });
    cylBetween(B['hip' + side], m, a, 0.032, 0.03, 6, { color: BLACK, ao: false, jitter: 0.02 });
    blob(B['ankle' + side], a, 0.038, 1, { color: BLACK, ao: false, jitter: 0.02 });
    cylBetween(B['ankle' + side], a, f, 0.03, 0.022, 6, { color: BLACK, ao: false, jitter: 0.02 });
    blob(B['foot' + side], f, 0.03, 0, { color: YELLOW, ao: false });
    for (const [ang, len] of [[-0.3, 0.3], [0, 0.34], [0.3, 0.3], [Math.PI, 0.14]]) {
      const tip = [f[0] + Math.sin(ang) * len, 0.022, f[2] + Math.cos(ang) * len];
      cylBetween(B['foot' + side], [f[0], 0.03, f[2]], tip, 0.017, 0.009, 4, { color: YELLOW, ao: false, jitter: 0.03 });
    }
  }

  // —— 合并：按骨骼分别烘成几何，再带上 skinIndex / skinWeight 合成一个
  const geos = [];
  for (const name of Object.keys(B)) {
    if (!B[name].parts.length) continue;
    const g = B[name].build();
    const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = boneIndex[name]; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geos.push(g);
  }
  const geometry = mergeGeometries(geos, false);
  geometry.computeBoundingBox();
  for (const g of geos) g.dispose();
  const triangles = geometry.attributes.position.count / 3;

  const material = paintMaterial(
    { vertexColors: true, roughness: 1, side: THREE.DoubleSide },
    { space: 'local', scale: 14, strength: 0.16, hue: 0.4, bands: 0.3, levels: 4 },
  );
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'egret';
  group.add(mesh);
  mesh.add(root);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton, mesh.matrixWorld);

  // 背上小狗趴的位置：挂在 body 骨骼下，随身体起伏
  const seat = new THREE.Object3D();
  seat.name = 'egretSeat';
  seat.position.set(0, 1.34 - BODY_PIVOT[1], -0.1);
  body.add(seat);

  // ================================================================== 动画参数
  // 站立（绑定）姿势下各脖节的绝对角（自 +Y 向 +Z 量），用来求相对旋转
  const restA = new Float32Array(5);
  for (let i = 0; i < 4; i++) restA[i] = Math.atan2(NECK[i + 1][1] - NECK[i][1], NECK[i + 1][0] - NECK[i][0]);
  restA[4] = HEAD_REST;

  const PN = ['bodyY', 'pitch', 'n0', 'n1', 'n2', 'n3', 'nh', 'spread', 'flapAmp', 'flapBase', 'sweep', 'freq', 'ground', 'legTY', 'legTZ', 'toe', 'walk', 'tail', 'lag', 'tuck'];
  const IX = {}; PN.forEach((n, i) => { IX[n] = i; });
  const NP = PN.length;
  const P = new Float32Array(NP), T = new Float32Array(NP);

  // 每个状态的目标（数组按 PN 顺序）；peck / takeoff 有时间线，下面单独改 T
  const pose = (o) => {
    const a = new Float32Array(NP);
    const d = {
      bodyY: 0, pitch: 0, n0: restA[0], n1: restA[1], n2: restA[2], n3: restA[3], nh: restA[4],
      spread: 0, flapAmp: 0, flapBase: 0, sweep: 0, freq: 2, ground: 1, legTY: -0.9, legTZ: -0.9, toe: 0, walk: 0, tail: 0, lag: 0, tuck: 0,
    };
    Object.assign(d, o);
    PN.forEach((n, i) => { a[i] = d[n]; });
    return a;
  };
  const NECK_FLY = { n0: 1.3, n1: -2.2, n2: 0.9, n3: 1.5, nh: 1.7 };
  const POSES = {
    stand: pose({}),
    walk: pose({ walk: 1 }),
    fly: pose({ ...NECK_FLY, pitch: -0.12, spread: 1, flapAmp: 0.75, flapBase: 0.08, sweep: 0.12, freq: 2, ground: 0, legTY: -0.2, legTZ: -0.9, toe: 2.2, tail: -0.1, lag: 0.5 }),
    glide: pose({ ...NECK_FLY, pitch: -0.1, spread: 1, flapAmp: 0.04, flapBase: 0.3, sweep: 0.06, freq: 0.9, ground: 0, legTY: -0.25, legTZ: -0.9, toe: 2.2, tail: -0.05, lag: 0.15 }),
    land: pose({ n0: 1.75, n1: 0.9, n2: 1.5, n3: 1.7, nh: 2.4, pitch: -0.6, bodyY: 0, spread: 1, flapAmp: 0.65, flapBase: 0.15, sweep: -0.45, freq: 2.6, ground: 0, legTY: -0.85, legTZ: 0.35, toe: 0.2, tail: 0.5, lag: 0.3 }),
  };
  // 啄 / 起飞 时间线用到的片段
  const PECK_WIND = { n0: 0.5, n1: -1.0, n2: 0.6, n3: 0.9, nh: 1.7, pitch: -0.05 };
  const PECK_STRIKE = { n0: 1.55, n1: 1.9, n2: 2.1, n3: 2.15, nh: 2.2, pitch: 0.38, bodyY: -0.14 };

  const eg = {
    group, seat,
    state: 'stand',
    walkSpeed: 0.45,
    carry: false,
    triangles,
    dims: { height: 0, length: 0, wingspan: 0, stride: 0 },
  };
  const WALK_TC = 2.2, STANCE = 0.6; // 一个完整步周期（两条腿各迈一步）与支撑相占比
  eg.dims.height = 2.0;
  eg.dims.length = 1.35;
  eg.dims.wingspan = geometry.boundingBox.max.x - geometry.boundingBox.min.x;
  eg.dims.stride = eg.walkSpeed * WALK_TC * 0.5;

  let tState = 0, tAll = Math.random() * 50, walkPhase = 0, flapPhase = 0, rate = 8;
  let lastState = 'stand';
  T.set(POSES.stand); P.set(POSES.stand);

  eg.setState = (name) => {
    if (EGRET_STATES.indexOf(name) < 0) return;
    if (name === eg.state && name !== 'peck' && name !== 'takeoff') return;
    eg.state = name; tState = 0;
    if (name !== 'peck' && name !== 'takeoff') T.set(POSES[name]);
  };

  function applyTimeline() {
    const s = eg.state;
    if (s === 'peck') {
      // 0–0.35 蓄力后缩；0.35–0.65 前刺啄地；0.65–0.85 停；之后抬起回站姿
      if (tState < 0.35) { T.set(POSES.stand); Object.keys(PECK_WIND).forEach((k) => { T[IX[k]] = PECK_WIND[k]; }); rate = 9; }
      else if (tState < 0.85) { T.set(POSES.stand); Object.keys(PECK_STRIKE).forEach((k) => { T[IX[k]] = PECK_STRIKE[k]; }); rate = 16; }
      else { T.set(POSES.stand); rate = 8; }
      if (tState >= 1.2) { eg.state = 'stand'; tState = 0; T.set(POSES.stand); rate = 8; }
    } else if (s === 'takeoff') {
      T.set(POSES.fly);
      if (tState < 0.3) { // 下蹲，翅膀半张上举
        T[IX.bodyY] = -0.3; T[IX.pitch] = 0.2; T[IX.ground] = 1; T[IX.spread] = 0.85; T[IX.flapBase] = 0.7; T[IX.flapAmp] = 0.3; T[IX.freq] = 3;
        T[IX.n0] = 0.6; T[IX.n1] = -0.9; T[IX.n2] = 0.5; T[IX.n3] = 0.8; rate = 10;
      } else { // 蹬地跃起 + 大幅快扇
        T[IX.bodyY] = 0.12; T[IX.pitch] = -0.45; T[IX.flapAmp] = 1.0; T[IX.flapBase] = 0.05; T[IX.freq] = 4.2;
        T[IX.ground] = tState < 0.42 ? 1 : 0; T[IX.toe] = 1.4; T[IX.tail] = 0.3; rate = 9;
      }
    } else if (s === 'fly' || s === 'glide') {
      if (eg.carry && s === 'fly') { T[IX.flapAmp] = 0.95; T[IX.freq] = 1.7; T[IX.flapBase] = 0.12; }
    }
  }

  // ---- 腿 IK 所需常量
  const L1 = Math.hypot(ANKLE[1] - HIP[1], ANKLE[2] - HIP[2]);
  const L2 = Math.hypot(FOOT[1] - ANKLE[1], FOOT[2] - ANKLE[2]);
  const a1r = Math.atan2(-(ANKLE[2] - HIP[2]), -(ANKLE[1] - HIP[1]));
  const a2r = Math.atan2(-(FOOT[2] - ANKLE[2]), -(FOOT[1] - ANKLE[1]));
  const hipY = HIP[1] - BODY_PIVOT[1], hipZ = HIP[2];

  /** ty,tz：脚尖目标，相对身体枢轴、与世界（root）同向的坐标系；pitch：身体俯仰；tp：趾的世界俯仰 */
  function legIK(lg, ty, tz, pitch, tp) {
    const c = Math.cos(pitch), s = Math.sin(pitch);
    const by = ty * c + tz * s, bz = -ty * s + tz * c; // 转到身体坐标系
    let dy = by - hipY, dz = bz - hipZ;
    let D = Math.sqrt(dy * dy + dz * dz);
    const dmax = L1 + L2 - 0.004, dmin = Math.abs(L1 - L2) + 0.02;
    if (D > dmax) { dy *= dmax / D; dz *= dmax / D; D = dmax; } else if (D < dmin) D = dmin;
    const af = Math.atan2(-dz, -dy);
    const A = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    const a1 = af + A;
    const ay = hipY - L1 * Math.cos(a1), az = hipZ - L1 * Math.sin(a1);
    const a2 = Math.atan2(-(bz - az), -(by - ay));
    lg.th.rotation.x = a1 - a1r;
    lg.an.rotation.x = (a2 - a1) - (a2r - a1r);
    lg.ft.rotation.x = tp - pitch - (a2 - a2r);
  }

  const smooth = (x) => x * x * (3 - 2 * x);
  const TAU = Math.PI * 2;

  eg.update = (dt) => {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    tState += dt; tAll += dt;
    applyTimeline();
    const k = 1 - Math.exp(-dt * rate);
    for (let i = 0; i < NP; i++) P[i] += (T[i] - P[i]) * k;

    const carry = eg.carry;
    const flapF = P[IX.freq] * (carry ? 1 : 1);
    flapPhase += flapF * TAU * dt;
    if (flapPhase > 1e4) flapPhase -= 1e4 * 0 + Math.floor(flapPhase / TAU) * TAU;
    const walkAmt = P[IX.walk];
    walkPhase += (dt / WALK_TC) * walkAmt;
    if (walkPhase > 1e4) walkPhase -= Math.floor(walkPhase);
    const standAmt = (1 - walkAmt) * P[IX.ground];
    const sp = P[IX.spread], fo = 1 - sp;
    const fly = 1 - P[IX.ground];

    // —— 身体
    let bodyY = P[IX.bodyY], pitch = P[IX.pitch];
    const sinF = Math.sin(flapPhase), cosF = Math.cos(flapPhase);
    bodyY += sp * P[IX.flapAmp] * 0.05 * -sinF * fly;
    bodyY += walkAmt * 0.02 * Math.sin(walkPhase * TAU * 4);
    body.position.set(
      BODY_PIVOT[0] + 0.012 * Math.sin(tAll * 0.5) * standAmt + 0.025 * Math.sin(walkPhase * TAU * 2) * walkAmt,
      BODY_PIVOT[1] + bodyY, BODY_PIVOT[2]);
    body.rotation.set(pitch, 0, 0.02 * Math.sin(walkPhase * TAU * 2) * walkAmt + 0.012 * Math.sin(tAll * 0.5) * standAmt);

    // —— 脖子 + 头（abs 目标角 → 逐节相对旋转）
    const bob = walkAmt * 0.16 * Math.sin(walkPhase * TAU * 2 + 0.4);
    const idle = standAmt * 0.04 * Math.sin(tAll * 1.3);
    const wingFlow = sp * 0.12 * sinF * fly; // 飞行时脖子随扇翅轻轻起伏
    const a0 = P[IX.n0] + bob + idle + wingFlow, a1 = P[IX.n1] - bob * 0.6, a2 = P[IX.n2] + bob * 0.5, a3 = P[IX.n3], ah = P[IX.nh] - bob * 0.3 + idle * 0.5;
    neck[0].rotation.x = (a0 - restA[0]);
    neck[1].rotation.x = (a1 - restA[1]) - (a0 - restA[0]);
    neck[2].rotation.x = (a2 - restA[2]) - (a1 - restA[1]);
    neck[3].rotation.x = (a3 - restA[3]) - (a2 - restA[2]);
    head.rotation.x = (ah - restA[4]) - (a3 - restA[3]);
    // 偶尔转头
    const look = standAmt * (0.6 * Math.sin(tAll * 0.37) * Math.sin(tAll * 0.23 + 1.0));
    neck[2].rotation.y = look * 0.4; neck[3].rotation.y = look * 0.3; head.rotation.y = look * 0.5;
    neck[1].rotation.y = look * 0.1;
    // 饰羽、蓑羽、尾随风飘
    crestA.rotation.set(0.35 + 0.25 * Math.sin(tAll * 2.1) + fly * 0.5, 0.08 * Math.sin(tAll * 1.7), 0.1 * Math.sin(tAll * 1.3));
    crestB.rotation.set(0.35 + 0.25 * Math.sin(tAll * 2.4 + 1) + fly * 0.5, -0.08 * Math.sin(tAll * 1.9), -0.1 * Math.sin(tAll * 1.1));
    back.rotation.set(0.06 * Math.sin(tAll * 1.5) + fly * (0.12 + 0.05 * sinF), 0, 0.04 * Math.sin(tAll * 1.1));
    tail.rotation.set(P[IX.tail] + 0.04 * Math.sin(tAll * 1.2), 0, 0);

    // —— 翅膀
    const base = P[IX.flapBase], amp = P[IX.flapAmp];
    let flap = base + amp * sinF;
    if (carry) flap = Math.min(flap, 1.15); // 驮着时上举不过高，翅根不压到背上
    const lag = P[IX.lag];
    const up = Math.max(0, cosF);              // 上举过程（>0）翼尖收
    const twist = 0.14 * cosF * sp * (amp > 0.1 ? 1 : 0);
    for (const side of ['R', 'L']) {
      const w = wing[side], g = w.sgn;
      // 收翅：整条翅沿翼展方向压缩（飞羽并排向后），再绕前后轴垂下贴在身侧
      w.sh.rotation.set(twist, g * (P[IX.sweep] * sp), g * (flap * sp - 1.5 * fo));
      w.sh.scale.set(0.3 + 0.7 * sp, 1, 1);
      w.sh.position.x = g * (WING.sx + 0.09 * fo);
      w.el.rotation.set(0, 0, g * (-lag * cosF * sp * 0.9 + 0.12 * sp));
      w.wr.rotation.set(0, g * (sp * (0.45 * up * (amp > 0.1 ? 1 : 0))), g * (-lag * cosF * sp * 0.9 - 0.1 * sp + 0.04 * sp * Math.sin(tAll * 9)));
    }

    // —— 腿（IK）
    const g = P[IX.ground], hipAbs = BODY_PIVOT[1] + bodyY;
    let tyR = STAND_FOOT_Y, tzR = 0, tyL = STAND_FOOT_Y, tzL = 0, tpR = 0, tpL = 0;
    if (walkAmt > 0.001) {
      const h = eg.walkSpeed * WALK_TC * STANCE * 0.5;
      for (let i = 0; i < 2; i++) {
        let u = walkPhase + i * 0.5; u -= Math.floor(u);
        let z, y, tp;
        if (u < STANCE) { z = h * (1 - 2 * (u / STANCE)); y = STAND_FOOT_Y; tp = 0; }
        else {
          const w = (u - STANCE) / (1 - STANCE), e = smooth(w);
          z = -h + 2 * h * e; y = STAND_FOOT_Y + 0.3 * Math.pow(Math.sin(Math.PI * w), 0.7);
          tp = 0.9 * Math.sin(Math.PI * w);
        }
        z = (z - 0.0) * walkAmt; y = STAND_FOOT_Y + (y - STAND_FOOT_Y) * walkAmt; tp *= walkAmt;
        if (i === 0) { tzR = z; tyR = y; tpR = tp; } else { tzL = z; tyL = y; tpL = tp; }
      }
    }
    const air = 1 - g;
    const gy = -hipAbs;
    const aTY = P[IX.legTY], aTZ = P[IX.legTZ], aToe = P[IX.toe];
    legIK(leg.R, (tyR + gy) * g + aTY * air, tzR * g + aTZ * air, pitch, tpR * g + aToe * air);
    legIK(leg.L, (tyL + gy) * g + aTY * air, tzL * g + aTZ * air, pitch, tpL * g + aToe * air);
  };

  eg.setState('stand');
  eg.update(0.0001);
  return eg;
}
