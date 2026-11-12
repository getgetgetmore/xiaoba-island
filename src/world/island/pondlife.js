// 池塘的常驻小动物：青蛙（蹲在荷叶上、鼓着喉囊叫、荷叶间跳来跳去、见到狗“扑通”跳进水里）和螃蟹（在岸边石头间横着走、举钳、见到狗缩起来）。
//
// 模型（钓鱼小游戏可直接复用，约定见下）：
//   createFrog() → { group, body, update(dt), setState(name), state, squash }
//       状态 'sit' | 'croak' | 'jump' | 'held'；group 原点在脚底中心，+Z 为正面；不带位移，位置由调用者控制。
//       squash：-1..1，正数 = 蹲扁（起跳前 / 落地），负数 = 拉长（腾空），调用者可直接赋值。
//   createCrab() → { group, body, update(dt), setState(name), state, dir, walkRate, lurk }
//       状态 'idle' | 'walk' | 'pinch' | 'hide'；group 原点在脚底中心，+Z 为正面，横着走沿本地 ±X（dir = ±1 决定步态方向，walkRate 步频倍数）；
//       lurk：0..1，半藏在石头边的程度（只影响姿态与下沉，状态不变）。
//   每次调用返回独立实例（几何体、材质共享）。每只动物 1 个 draw call：身体用形变目标（morph targets）做肢体动画。
//
// 常驻行为：createPondLife({ heightAt, anchors, rng }) → { group, update(dt, env, dogPos|null), frogs, crabs, setHidden(bool), hidden }
import * as THREE from 'three';
import { paintMaterial } from '../../core/paint.js';
import { clamp, damp, dampAngle, mulberry32, smoothstep } from '../../core/util.js';
import { L, pondR, outlineR } from './shape.js';
import { GeoBuilder } from './geo.js';
import { WATER_Y } from './water.js';

const TAU = Math.PI * 2;
export const FROG_MAX_SPEED = 3.0; // 青蛙（含跳跃、浮出、下沉）的最高速度，世界单位/秒
export const CRAB_MAX_SPEED = 1.0; // 螃蟹的最高速度

// ---------------------------------------------------------------------------------------------------------------------
// 建模工具
// ---------------------------------------------------------------------------------------------------------------------
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _a = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lerp = (a, b, t) => a + (b - a) * t;

/** 从 p 到 q 拉长的椭球（z 方向为长轴；rx 宽、ry 高），端点各多出 pad */
function seg(b, p, q, rx, ry, color, o = {}) {
  _a.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  const len = _a.length() || 1e-4;
  _a.multiplyScalar(1 / len);
  _q.setFromUnitVectors(_z, _a);
  _e.setFromQuaternion(_q, 'XYZ');
  b.add(new THREE.IcosahedronGeometry(1, o.detail === undefined ? 1 : o.detail), {
    pos: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], rot: [_e.x, _e.y, _e.z],
    scale: [rx, ry, len / 2 + (o.pad === undefined ? Math.min(rx, ry) * 0.6 : o.pad)], color, ao: o.ao === undefined ? false : o.ao,
  });
}
const ball = (b, pos, sc, color, detail = 1, rot, ao = false) => b.add(new THREE.IcosahedronGeometry(1, detail), { pos, scale: sc, color, rot, ao });

/** 把若干“姿态几何体”（顶点数、顺序完全一致）合成：以 base 为基础，其余作为相对形变目标 */
function withMorphs(base, targets) {
  const bp = base.attributes.position;
  base.morphAttributes.position = targets.map((g) => {
    const tp = g.attributes.position;
    const d = new Float32Array(bp.count * 3);
    for (let i = 0; i < d.length; i++) d[i] = tp.array[i] - bp.array[i];
    return new THREE.BufferAttribute(d, 3);
  });
  base.morphTargetsRelative = true;
  base.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.1, 0), 0.45);
  return base;
}

let _mat = null;
function sharedMaterial() {
  if (!_mat) _mat = paintMaterial({ vertexColors: true }, { space: 'local', scale: 22, strength: 0.1, hue: 0.4, bands: 0.22 });
  return _mat;
}

// ---------------------------------------------------------------------------------------------------------------------
// 青蛙
// ---------------------------------------------------------------------------------------------------------------------
const FC = { back: 0x78a63e, backDark: 0x58862f, belly: 0xece3b4, sac: 0xf0d2a0, cheek: 0xeaa08c, mouth: 0x3b4a22, eye: 0xf0dc8a, pupil: 0x1c1a14, lid: 0x6a9a38, leg: 0x6c9a38, legDark: 0x58862f };

// 后腿：折叠（蹲姿）/ 伸直（跳跃）/ 下垂（被拎着）三种姿态的 [膝, 踝, 趾尖]（右腿，x 取正）
const HIND = {
  folded: [[0.10, 0.055, 0.0], [0.09, 0.015, -0.085], [0.10, 0.008, 0.02]],
  ext: [[0.07, 0.058, -0.135], [0.062, 0.045, -0.21], [0.058, 0.03, -0.295]],
  hang: [[0.085, 0.0, -0.075], [0.078, -0.06, -0.1], [0.075, -0.105, -0.085]],
};

/** P：{ ext:[左,右], hang:[左,右], front:[左,右], throat, blink }（均 0..1），逐项构建一个姿态的青蛙 */
function frogParts(b, P) {
  const back = (nx, ny) => (ny < -0.22 ? FC.belly : FC.back);
  // 躯干与头
  ball(b, [0, 0.066, -0.02], [0.075, 0.062, 0.092], back, 2, [-0.2, 0, 0], true);
  ball(b, [0, 0.092, 0.066], [0.068, 0.045, 0.06], (nx, ny) => (ny < -0.45 ? FC.belly : FC.back), 2, [-0.1, 0, 0], true);
  // 背上的深色斑点
  for (const [x, y, z, r] of [[0.034, 0.118, -0.03, 0.016], [-0.032, 0.12, -0.048, 0.014], [0.0, 0.127, -0.07, 0.013], [0.048, 0.1, -0.075, 0.012], [-0.05, 0.098, -0.02, 0.011]]) {
    ball(b, [x, y, z], [r, r * 0.38, r * 0.9], FC.backDark, 0, [-0.15, 0, x * 6]);
  }
  // 鼓鼓的大眼睛：眼球 + 瞳孔 + 高光；眨眼时一块绿色的“眼皮”从小球长成包住眼球的大球
  for (const s of [1, -1]) {
    const cx = 0.042 * s, cy = 0.13, cz = 0.062;
    ball(b, [cx, cy, cz], [0.033, 0.033, 0.033], FC.eye, 1);
    ball(b, [cx + 0.004 * s, cy + 0.003, cz + 0.026], [0.0165, 0.02, 0.011], FC.pupil, 1);
    ball(b, [cx + 0.0, cy + 0.011, cz + 0.032], [0.0055, 0.0055, 0.0055], 0xffffff, 0);
    const lr = lerp(0.02, 0.0355, P.blink);
    ball(b, [cx, cy, cz], [lr, lerp(0.02, 0.0355, P.blink), lr], FC.lid, 1);
  }
  // 腮红、嘴线、鼻孔
  for (const s of [1, -1]) ball(b, [0.05 * s, 0.083, 0.104], [0.012, 0.008, 0.006], FC.cheek, 0, [0, 0.5 * s, 0]);
  ball(b, [0, 0.081, 0.1235], [0.034, 0.0028, 0.004], FC.mouth, 0);
  for (const s of [1, -1]) {
    ball(b, [0.036 * s, 0.085, 0.119], [0.012, 0.0028, 0.004], FC.mouth, 0, [0, 0, 0.5 * s]);
    ball(b, [0.011 * s, 0.108, 0.1255], [0.0042, 0.0042, 0.0042], FC.mouth, 0);
  }
  // 喉囊（下巴下面）：平时是一小团下巴，叫的时候鼓成大气球
  {
    const t = P.throat;
    ball(b, lerp3([0, 0.062, 0.1], [0, 0.056, 0.122], t), lerp3([0.03, 0.022, 0.03], [0.054, 0.05, 0.052], t), FC.sac, 2);
  }
  // 前腿 + 小手
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1, f = P.front[i];
    const w = lerp3([0.058, 0.012, 0.088], [0.052, 0.062, 0.15], f);
    seg(b, [0.05 * s, 0.062, 0.035], [w[0] * s, w[1], w[2]], 0.012, 0.011, FC.leg);
    ball(b, [(w[0] + 0.002) * s, w[1] - 0.004, w[2] + 0.012], [0.017, 0.008, 0.02], FC.legDark, 1);
  }
  // 后腿：大腿 → 小腿 → 扁平的脚
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const e = P.ext[i], d = P.hang[i];
    const pt = (k) => { const v = lerp3(lerp3(HIND.folded[k], HIND.ext[k], e), HIND.hang[k], d); return [v[0] * s, v[1], v[2]]; };
    const hip = [0.058 * s, 0.062, -0.052], knee = pt(0), ank = pt(1), toe = pt(2);
    seg(b, hip, knee, 0.03, 0.027, FC.back, { pad: 0.02, ao: true });
    seg(b, knee, ank, 0.016, 0.015, FC.leg, { pad: 0.012 });
    seg(b, ank, toe, 0.017, 0.0075, FC.legDark, { pad: 0.012 });
  }
}

const FROG_POSES = {
  base: { ext: [0, 0], hang: [0, 0], front: [0, 0], throat: 0, blink: 0 },
  jump: { ext: [1, 1], hang: [0, 0], front: [1, 1], throat: 0, blink: 0 },
  throat: { ext: [0, 0], hang: [0, 0], front: [0, 0], throat: 1, blink: 0 },
  blink: { ext: [0, 0], hang: [0, 0], front: [0, 0], throat: 0, blink: 1 },
  flailA: { ext: [0.2, 0.7], hang: [1, 0], front: [1, 0], throat: 0, blink: 0 },
  flailB: { ext: [0.7, 0.2], hang: [0, 1], front: [0, 1], throat: 0, blink: 0 },
};
const FROG_TARGETS = ['jump', 'throat', 'blink', 'flailA', 'flailB'];

let _frogGeo = null;
function frogGeometry() {
  if (_frogGeo) return _frogGeo;
  const make = (name) => { const b = new GeoBuilder({ seed: 11, jitter: 0.03, aoH: 0.06, aoK: 0.2 }); frogParts(b, FROG_POSES[name]); return b.build(); };
  _frogGeo = withMorphs(make('base'), FROG_TARGETS.map(make));
  return _frogGeo;
}

export const FROG_STATES = ['sit', 'croak', 'jump', 'held'];
let _frogId = 0;

export function createFrog() {
  const rng = mulberry32(101 + _frogId++ * 7);
  const group = new THREE.Group();
  group.name = 'frog';
  group.rotation.order = 'YXZ';
  const body = new THREE.Mesh(frogGeometry(), sharedMaterial());
  body.frustumCulled = false;
  group.add(body);

  const inf = body.morphTargetInfluences; // [jump, throat, blink, flailA, flailB]
  let t = rng() * 10, ck = 0, blinkT = 0, blinkIn = 1 + rng() * 3, pitch = 0;
  const frog = {
    group, body, state: 'sit', squash: 0,
    setState(name) {
      if (!FROG_STATES.includes(name) || name === frog.state) return;
      frog.state = name;
      if (name === 'croak') ck = 0;
    },
    update(dt) {
      if (!(dt > 0)) return;
      t += dt;
      const st = frog.state;
      const breath = 0.5 + 0.5 * Math.sin(t * (st === 'held' ? 9 : 3.4));
      let jump = 0, fa = 0, fb = 0, th = 0.1 + 0.16 * breath, pitchT = 0, roll = 0;
      if (st === 'croak') {
        ck += dt;
        // 两三声“呱”：喉囊一鼓一缩
        const pulse = Math.pow(0.5 + 0.5 * Math.sin(ck * 13 - 1.2), 0.8);
        th = 0.3 + 0.7 * pulse;
      } else if (st === 'jump') { jump = 1; th = 0.04; }
      else if (st === 'held') {
        jump = 0.4; fa = 0.5 + 0.5 * Math.sin(t * 11); fb = 1 - fa; th = 0.1 + 0.3 * breath;
        pitchT = 0.5; roll = 0.14 * Math.sin(t * 7.3);
      }
      inf[0] = damp(inf[0], jump, 16, dt);
      inf[1] = damp(inf[1], th, 18, dt);
      inf[3] = damp(inf[3], fa, 22, dt);
      inf[4] = damp(inf[4], fb, 22, dt);
      // 眨眼
      blinkIn -= dt;
      if (blinkIn <= 0 && blinkT <= 0 && st !== 'jump') { blinkT = 0.17; blinkIn = 2 + rng() * 3.5; }
      if (blinkT > 0) { blinkT = Math.max(0, blinkT - dt); inf[2] = Math.sin(Math.PI * (1 - blinkT / 0.17)); } else inf[2] = 0;
      // 整体姿态
      pitch = damp(pitch, pitchT, 12, dt);
      const sq = frog.squash;
      const bob = st === 'sit' ? 0.012 * (breath - 0.5) : 0;
      body.scale.set(1 + 0.1 * sq, 1 - 0.18 * sq + bob, 1 + 0.1 * sq);
      body.rotation.set(-pitch, 0, roll);
    },
  };
  return frog;
}

// ---------------------------------------------------------------------------------------------------------------------
// 螃蟹
// ---------------------------------------------------------------------------------------------------------------------
const CC = { top: 0xdc4f2c, side: 0xe8683a, belly: 0xf2a060, spot: 0xf4a678, leg: 0xe0552e, legTip: 0xb94422, claw: 0xe45d33, clawTip: 0xf6d3a0, eye: 0xfaf3df, pupil: 0x1c1a14 };
const LEG_Z0 = [0.05, 0.017, -0.017, -0.05], LEG_ZK = [0.02, 0.01, -0.006, -0.02], LEG_ZF = [0.05, 0.02, -0.02, -0.05];

/** P：{ shiftA, liftA, shiftB, liftB, up:[左,右], open:[左,右], sway, tuck }（均 0..1，shift/sway 可正负） */
function crabParts(b, P) {
  // 壳：扁扁的圆壳，背上橘红、边缘偏浅
  ball(b, [0, 0.06, 0], [0.13, 0.048, 0.098], (nx, ny) => (ny > 0.5 ? CC.top : ny > 0.05 ? CC.side : CC.belly), 2, undefined, true);
  for (const [x, z, r] of [[-0.05, 0.03, 0.013], [0.045, -0.02, 0.011], [0.075, 0.04, 0.009], [-0.035, -0.05, 0.01], [0.0, 0.05, 0.009], [-0.08, -0.01, 0.008]]) {
    const y = 0.06 + 0.048 * Math.sqrt(Math.max(0.02, 1 - (x / 0.13) ** 2 - (z / 0.098) ** 2));
    ball(b, [x, y - 0.002, z], [r, r * 0.4, r], CC.spot, 0, [z * 4, 0, -x * 4]);
  }
  // 眼柄：两根细柄 + 大眼珠
  for (const s of [1, -1]) {
    const base = [0.04 * s, 0.09, 0.07];
    const tip = lerp3([0.045 * s + 0.012 * P.sway, 0.136, 0.082], [0.05 * s, 0.098, 0.1], P.tuck);
    seg(b, base, tip, 0.0065, 0.0065, CC.belly, { pad: 0.004, detail: 0 });
    ball(b, [tip[0], tip[1] + 0.006, tip[2]], [0.0185, 0.0185, 0.0185], CC.eye, 1);
    ball(b, [tip[0], tip[1] + 0.008, tip[2] + 0.014], [0.0085, 0.0095, 0.006], CC.pupil, 0);
  }
  // 腿：每侧四条，两节；A 组（右 0、2，左 1、3）与 B 组交替迈步，shift 沿 +X，lift 抬脚；tuck 时全部收到壳下
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    for (let j = 0; j < 4; j++) {
      const inA = (i + j) % 2 === 0;
      const sh = inA ? P.shiftA : P.shiftB, li = inA ? P.liftA : P.liftB;
      let knee = [0.165 * s, 0.075, LEG_Z0[j] + LEG_ZK[j]];
      let foot = [0.2 * s, 0.0, LEG_Z0[j] + LEG_ZF[j]];
      knee = [knee[0] + 0.03 * sh, knee[1] + 0.02 * li, knee[2]];
      foot = [foot[0] + 0.03 * sh, foot[1] + 0.034 * li, foot[2]];
      knee = lerp3(knee, [0.13 * s, 0.045, LEG_Z0[j]], P.tuck);
      foot = lerp3(foot, [0.135 * s, 0.006, LEG_Z0[j] + LEG_ZF[j] * 0.3], P.tuck);
      const at = [0.098 * s, 0.05, LEG_Z0[j]];
      seg(b, at, knee, 0.0115, 0.0115, CC.leg, { pad: 0.004, detail: 0 });
      seg(b, knee, foot, 0.01, 0.01, CC.legTip, { pad: 0.004, detail: 0 });
    }
  }
  // 大钳：臂 → 钳掌 → 两根指（外侧不动，内侧可开合）；up 举高，tuck 收到嘴前
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1, up = P.up[i], op = P.open[i];
    const lift = [0, 0.092 * up, -0.012 * up];
    const palm = lerp3([0.11 * s + lift[0], 0.07 + lift[1], 0.19 + lift[2]], [0.07 * s, 0.056, 0.15], P.tuck);
    seg(b, [0.095 * s, 0.062, 0.07], [palm[0] - 0.0 * s, palm[1], palm[2] - 0.024], 0.0125, 0.0125, CC.claw, { pad: 0.006 });
    ball(b, palm, [0.04, 0.028, 0.034], CC.claw, 1);
    const f1b = [palm[0] + 0.013 * s, palm[1], palm[2] + 0.012], f1t = [palm[0] + 0.01 * s, palm[1] + 0.05 * up, palm[2] + 0.066];
    seg(b, f1b, f1t, 0.0125, 0.0125, CC.clawTip, { pad: 0.006 });
    const f2b = [palm[0] - 0.013 * s, palm[1], palm[2] + 0.012];
    const f2t = [palm[0] - (0.012 + 0.04 * op) * s, palm[1] + 0.05 * up + 0.01 * op, palm[2] + 0.062 - 0.012 * op];
    seg(b, f2b, f2t, 0.0125, 0.0125, CC.clawTip, { pad: 0.006 });
  }
}

const CRAB_POSES = {
  base: { shiftA: 0, liftA: 0, shiftB: 0, liftB: 0, up: [0, 0], open: [0, 0], sway: 0, tuck: 0 },
  shiftA: { shiftA: 1, liftA: 0, shiftB: 0, liftB: 0, up: [0, 0], open: [0, 0], sway: 0, tuck: 0 },
  liftA: { shiftA: 0, liftA: 1, shiftB: 0, liftB: 0, up: [0, 0], open: [0, 0], sway: 0, tuck: 0 },
  shiftB: { shiftA: 0, liftA: 0, shiftB: 1, liftB: 0, up: [0, 0], open: [0, 0], sway: 0, tuck: 0 },
  liftB: { shiftA: 0, liftA: 0, shiftB: 0, liftB: 1, up: [0, 0], open: [0, 0], sway: 0, tuck: 0 },
  upL: { shiftA: 0, liftA: 0, shiftB: 0, liftB: 0, up: [1, 0], open: [0, 0], sway: 0, tuck: 0 },
  upR: { shiftA: 0, liftA: 0, shiftB: 0, liftB: 0, up: [0, 1], open: [0, 0], sway: 0, tuck: 0 },
  openL: { shiftA: 0, liftA: 0, shiftB: 0, liftB: 0, up: [0, 0], open: [1, 0], sway: 0, tuck: 0 },
  openR: { shiftA: 0, liftA: 0, shiftB: 0, liftB: 0, up: [0, 0], open: [0, 1], sway: 0, tuck: 0 },
  sway: { shiftA: 0, liftA: 0, shiftB: 0, liftB: 0, up: [0, 0], open: [0, 0], sway: 1, tuck: 0 },
  tuck: { shiftA: 0, liftA: 0, shiftB: 0, liftB: 0, up: [0, 0], open: [0, 0], sway: 0, tuck: 1 },
};
const CRAB_TARGETS = ['shiftA', 'liftA', 'shiftB', 'liftB', 'upL', 'upR', 'openL', 'openR', 'sway', 'tuck'];

let _crabGeo = null;
function crabGeometry() {
  if (_crabGeo) return _crabGeo;
  const make = (name) => { const b = new GeoBuilder({ seed: 23, jitter: 0.03, aoH: 0.06, aoK: 0.18 }); crabParts(b, CRAB_POSES[name]); return b.build(); };
  _crabGeo = withMorphs(make('base'), CRAB_TARGETS.map(make));
  return _crabGeo;
}

export const CRAB_STATES = ['idle', 'walk', 'pinch', 'hide', 'grip']; // grip：+X 那只大钳举起夹紧（钓鱼时夹住小狗尾巴吊着）
let _crabId = 0;

export function createCrab() {
  const rng = mulberry32(303 + _crabId++ * 5);
  const group = new THREE.Group();
  group.name = 'crab';
  const body = new THREE.Mesh(crabGeometry(), sharedMaterial());
  body.frustumCulled = false;
  group.add(body);
  const inf = body.morphTargetInfluences; // [shiftA, liftA, shiftB, liftB, upL, upR, openL, openR, sway, tuck]
  let t = rng() * 10, phase = rng() * TAU, amp = 0, tuck = 0, upL = 0, upR = 0, opL = 0, opR = 0, lurkS = 0;
  const crab = {
    group, body, state: 'idle', dir: 1, walkRate: 1, lurk: 0,
    setState(name) { if (CRAB_STATES.includes(name)) crab.state = name; },
    update(dt) {
      if (!(dt > 0)) return;
      t += dt;
      const st = crab.state;
      amp = damp(amp, st === 'walk' ? 1 : st === 'grip' ? 0.7 : 0, 10, dt);
      phase += dt * 8.5 * crab.walkRate * amp;
      const c = Math.cos(phase), s = Math.sin(phase), d = crab.dir >= 0 ? 1 : -1;
      // A 组与 B 组反相；抬脚发生在“向前摆”的那半周期（随方向而变）
      inf[0] = amp * c; inf[1] = amp * Math.max(0, -d * s);
      inf[2] = -amp * c; inf[3] = amp * Math.max(0, d * s);
      let uL = 0, uR = 0, oL = 0, oR = 0;
      if (st === 'pinch') { uL = 1; uR = 1; oL = 0.5 + 0.5 * Math.sin(t * 8.5); oR = 0.5 + 0.5 * Math.sin(t * 8.5 + 1.6); }
      else if (st === 'grip') { uL = 1; oL = 0.14 + 0.06 * Math.sin(t * 15); uR = 0.55; oR = 0.5 + 0.5 * Math.sin(t * 9); }
      else if (st === 'idle') { oL = 0.12 * (0.5 + 0.5 * Math.sin(t * 1.3)); oR = 0.12 * (0.5 + 0.5 * Math.sin(t * 1.1 + 2)); }
      else if (st === 'walk') { uL = 0.25; uR = 0.25; }
      upL = damp(upL, uL, 12, dt); upR = damp(upR, uR, 12, dt); opL = damp(opL, oL, 20, dt); opR = damp(opR, oR, 20, dt);
      inf[4] = upL; inf[5] = upR; inf[6] = opL; inf[7] = opR;
      inf[8] = (st === 'hide' ? 0.2 : 1) * Math.sin(t * (st === 'pinch' || st === 'grip' ? 4 : 1.9)) * 0.8;
      tuck = damp(tuck, st === 'hide' ? 1 : clamp(crab.lurk * 0.6), 9, dt);
      inf[9] = tuck;
      lurkS = damp(lurkS, st === 'hide' ? 1 : crab.lurk, 8, dt);
      // 横着走时身体一颠一颠、微微晃
      const bob = 0.007 * amp * Math.abs(Math.sin(phase * 2));
      body.position.y = bob - 0.028 * lurkS;
      body.rotation.z = 0.05 * amp * Math.sin(phase) * d;
      body.scale.y = 1 - 0.12 * lurkS;
    },
  };
  return crab;
}

// ---------------------------------------------------------------------------------------------------------------------
// 池塘常驻行为
// ---------------------------------------------------------------------------------------------------------------------
// 荷叶位置与 props.js 里的一致（荷叶中心相对池心的偏移 × 池塘大小比例；顶面高度 = -0.088 + 0.006）
const PAD_DEFS = [[-0.3, 0.25, 0.2, true], [0.35, -0.3, 0.17, false], [-0.15, -0.55, 0.15, true], [-0.55, -0.1, 0.16, true], [0.5, 0.42, 0.18, true]];
const PAD_TOP = -0.088 + 0.006;
// 螃蟹岸边环带：内缘 = pondR(θ)*0.96，向外 0.14（约 u = 0.96–1.04，即水边的浅滩）。
// 不能再往外：pondU >= 1.04 的地方长着齐腰高的草（plants.js），螃蟹（高约 0.15）会整只藏在草里看不见。
export const BAND_W = 0.14;
const BAND_IN_K = 0.96, BAND_IN_ADD = 0;
export function crabBandInner(th) { return pondR(th) * BAND_IN_K + BAND_IN_ADD; }

const NSEC = 360;
const hourOf = (env) => (env && Number.isFinite(env.hour) ? env.hour : 12);

export function createPondLife({ heightAt = () => 0, anchors = null, rng = mulberry32(2024), frogCount = 2 } = {}) {
  const group = new THREE.Group();
  group.name = 'pondLife';
  const px = L.pond.x, pz = L.pond.z;

  // ---- 荷叶 ----
  const PK = L.pond.r / 1.2;
  const pads = PAD_DEFS.map(([dx, dz, r, usable]) => ({ x: px + dx * PK, z: pz + dz * PK, y: PAD_TOP, r, usable, owner: -1 }));
  const usable = [];
  pads.forEach((p, i) => { if (p.usable) usable.push(i); });

  // ---- 水面涟漪 ----
  const ringGeo = new THREE.RingGeometry(0.78, 1, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; m.renderOrder = 4;
    group.add(m);
    rings.push({ m, t: 1, delay: 0, max: 0.2, life: 1.2 });
  }
  let ringNext = 0;
  function spawnRing(x, z, delay, max, life = 1.2) {
    const r = rings[ringNext];
    ringNext = (ringNext + 1) % rings.length;
    r.m.position.set(x, WATER_Y + 0.007, z);
    r.t = 0; r.delay = delay; r.max = max; r.life = life;
    r.m.visible = false;
  }

  // ---- 螃蟹的活动域：逐度预计算（环带宽度；避开岛沿和小狗喝水的落脚点）----
  const bandW = new Float32Array(NSEC);
  const drink = anchors && anchors.pondDrink ? anchors.pondDrink : null;
  for (let i = 0; i < NSEC; i++) {
    const th = (i / NSEC) * TAU;
    const inner = crabBandInner(th);
    let w = BAND_W;
    for (; w > 0; w -= 0.01) {
      const r = inner + w, x = px + Math.cos(th) * r, z = pz + Math.sin(th) * r;
      if (Math.hypot(x, z) <= outlineR(Math.atan2(z, x)) - 0.95 && heightAt(x, z) > -0.25) break;
    }
    if (drink) {
      for (const o of [0, 0.07, 0.14]) {
        const r = inner + o, x = px + Math.cos(th) * r, z = pz + Math.sin(th) * r;
        if (Math.hypot(x - drink.x, z - drink.z) < 0.62) w = 0;
      }
    }
    if (Math.sin(th) > 0.25) w = 0; // 只在池塘的远岸 / 两侧活动：镜头在南面（+Z），近岸前景的草会把螃蟹整只挡住
    bandW[i] = w;
  }
  const bandMin = new Float32Array(NSEC);
  for (let i = 0; i < NSEC; i++) {
    let m = bandW[i];
    for (let k = -3; k <= 3; k++) m = Math.min(m, bandW[(i + k + NSEC) % NSEC]);
    bandMin[i] = m < 0.1 ? 0 : m;
  }
  const secOf = (th) => ((Math.round(((th % TAU) + TAU) % TAU / TAU * NSEC)) % NSEC);
  const widthAt = (th) => bandMin[secOf(th)];

  // ---- 全局状态 ----
  let hiddenReq = false;
  const dog = { on: false, x: 0, z: 0 };

  // ---- 青蛙 ----
  const frogs = [];
  const nFrogs = Math.min(frogCount, usable.length - 1);
  for (let i = 0; i < nFrogs; i++) {
    const f = createFrog();
    const pi = usable[(i * 2) % usable.length];
    pads[pi].owner = i;
    Object.assign(f, {
      idx: i, phase: 'pad', pad: pi, tpad: -1, hidden: false, vis: 1, hops: 0, croaks: 0,
      pt: 0, u: 0, dur: 1, h: 0.15, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, kind: 'pad', st: 0,
      tHop: 4 + rng() * 14, tCroak: 3 + rng() * 10, croakT: 0, tUnder: 0, ex: 0, ez: 0, yawT: rng() * TAU, tYaw: 3 + rng() * 6,
      heading: rng() * TAU, dip: 0, sqT: 0,
    });
    f.group.position.set(pads[pi].x, pads[pi].y, pads[pi].z);
    f.group.rotation.y = f.heading;
    group.add(f.group);
    frogs.push(f);
  }

  function frogAct(env) {
    const h = hourOf(env);
    if (h >= 22 || h < 5) return 0;
    const sun = env && Number.isFinite(env.sunsetFactor) ? env.sunsetFactor : 0;
    const rain = env && Number.isFinite(env.rain) ? env.rain : 0;
    let a = 1;
    if ((h >= 18 && h < 22) || sun > 0.45) a *= 2.4;
    if (rain > 0.15) a *= 2;
    return Math.min(a, 4);
  }

  function pickFreePad(f) {
    let n = 0;
    for (let k = 0; k < usable.length; k++) { const p = pads[usable[k]]; if (p.owner < 0 && usable[k] !== f.pad) n++; }
    if (n === 0) return -1;
    let r = Math.floor(rng() * n);
    for (let k = 0; k < usable.length; k++) {
      const p = pads[usable[k]];
      if (p.owner < 0 && usable[k] !== f.pad) { if (r-- === 0) return usable[k]; }
    }
    return -1;
  }

  function frogWantsPrep(f, kind, tx, ty, tz, prep, dur, h) {
    const p = f.group.position;
    f.fx = p.x; f.fy = p.y; f.fz = p.z;
    f.tx = tx; f.ty = ty; f.tz = tz; f.kind = kind;
    f.dur = dur; f.h = h; f.pt = prep; f.phase = 'prep';
    f.heading = Math.atan2(tx - p.x, tz - p.z);
  }

  function startPadHop(f, toPad) {
    const p = pads[toPad];
    p.owner = f.idx; f.tpad = toPad;
    const g = f.group.position;
    const d = Math.hypot(p.x - g.x, p.z - g.z);
    frogWantsPrep(f, 'pad', p.x, p.y, p.z, 0.3, 0.42 + 0.28 * d, 0.1 + 0.1 * d);
  }

  function startDive(f, prep) {
    const g = f.group.position;
    const pd = f.pad >= 0 ? pads[f.pad] : null;
    let ax = g.x - (dog.on ? dog.x : px - 0.3 + rng() * 0.6), az = g.z - (dog.on ? dog.z : pz + (rng() - 0.5));
    let l = Math.hypot(ax, az);
    if (l < 1e-4) { ax = Math.cos(rng() * TAU); az = Math.sin(rng() * TAU); l = 1; }
    ax /= l; az /= l;
    const reach = (pd ? pd.r : 0.12) + 0.28;
    let tx = g.x + ax * reach, tz = g.z + az * reach;
    const ang = Math.atan2(tz - pz, tx - px);
    if (Math.hypot(tx - px, tz - pz) > pondR(ang) * 0.78) { tx = g.x - ax * reach; tz = g.z - az * reach; }
    frogWantsPrep(f, 'water', tx, WATER_Y - 0.03, tz, prep, 0.36, 0.09);
  }

  function frogSink(f) {
    f.phase = 'sink'; f.st = 0;
    f.fy = f.group.position.y;
    if (f.pad >= 0) { pads[f.pad].owner = -1; f.pad = -1; }
    f.setState('sit');
  }

  function goUnder(f) {
    f.phase = 'under'; f.hidden = true; f.vis = 0;
    f.group.visible = false;
    f.tUnder = 8 + rng() * 7;
    if (f.tpad >= 0 && pads[f.tpad].owner === f.idx) pads[f.tpad].owner = -1;
    f.tpad = pickFreePad(f);
    if (f.tpad < 0) f.tpad = usable[0];
    pads[f.tpad].owner = f.idx;
    // 浮出点：目标荷叶外侧一点的水面
    const p = pads[f.tpad];
    const a = Math.atan2(p.z - pz, p.x - px) + (rng() - 0.5) * 1.0;
    f.ex = p.x + Math.cos(a) * (p.r + 0.14); f.ez = p.z + Math.sin(a) * (p.r + 0.14);
  }

  function updateFrog(f, dt, act, night) {
    const g = f.group.position;
    const wy = WATER_Y - 0.045;
    const dd = dog.on ? Math.hypot(g.x - dog.x, g.z - dog.z) : 1e9;
    const dogNearDrink = dog.on && drink && Math.hypot(dog.x - drink.x, dog.z - drink.z) < 0.9;
    const threat = dd < 1.7 || dogNearDrink;
    let sqT = 0;
    f.dip = damp(f.dip, 0, 9, dt);
    switch (f.phase) {
      case 'pad': {
        const p = pads[f.pad];
        g.set(p.x, p.y - f.dip, p.z);
        if (hiddenReq || threat) { startDive(f, 0.08); break; }
        // 偶尔转转头
        f.tYaw -= dt;
        if (f.tYaw <= 0) { f.yawT = f.heading + (rng() - 0.5) * 1.6; f.tYaw = 4 + rng() * 8; }
        f.heading = dampAngle(f.heading, f.yawT, 2.5, dt);
        if (f.croakT > 0) {
          f.croakT -= dt;
          if (f.croakT <= 0) { f.setState('sit'); f.tCroak = 9 + rng() * 18; }
          sqT = 0.12;
        } else {
          f.tCroak -= dt * act; f.tHop -= dt * act;
          if (f.tCroak <= 0 && act > 0) { f.setState('croak'); f.croakT = 1.2 + rng() * 0.8; f.croaks++; }
          else if (f.tHop <= 0 && act > 0) {
            const to = pickFreePad(f);
            if (to < 0) f.tHop = 3; else { startPadHop(f, to); f.tHop = 10 + rng() * 15; }
          }
        }
        break;
      }
      case 'prep': {
        f.pt -= dt;
        f.heading = dampAngle(f.heading, Math.atan2(f.tx - f.fx, f.tz - f.fz), 14, dt);
        sqT = 0.8;
        // 起跳前被吓到 / 要求隐藏：改成跳进水里（还没离开荷叶或水面）
        if (f.kind === 'pad' && (hiddenReq || threat)) {
          if (f.tpad >= 0 && pads[f.tpad].owner === f.idx) pads[f.tpad].owner = -1;
          f.tpad = -1;
          if (f.pad >= 0) startDive(f, 0.08); else { frogSink(f); }
          break;
        }
        if (f.pt <= 0) { f.phase = 'hop'; f.u = 0; f.setState('jump'); f.hops++; if (f.pad >= 0) { pads[f.pad].owner = -1; f.pad = -1; } }
        break;
      }
      case 'hop': {
        f.u = Math.min(1, f.u + dt / f.dur);
        const u = f.u;
        g.x = lerp(f.fx, f.tx, u); g.z = lerp(f.fz, f.tz, u);
        g.y = lerp(f.fy, f.ty, u) + f.h * 4 * u * (1 - u);
        const vy = (f.h * 4 * (1 - 2 * u)) / f.dur, hs = Math.hypot(f.tx - f.fx, f.tz - f.fz) / f.dur + 1e-3;
        f.group.rotation.x = -clamp(Math.atan(vy / hs) * 0.8, -0.8, 0.8);
        sqT = -0.5 * (1 - Math.abs(2 * u - 1));
        if (u >= 1) {
          f.group.rotation.x = 0;
          f.setState('sit');
          if (f.kind === 'pad') {
            f.phase = 'pad'; f.pad = f.tpad; f.tpad = -1; f.dip = 0.006; f.sqT = 1;
            spawnRing(f.tx, f.tz, 0, 0.1, 0.8);
            f.tCroak = Math.max(f.tCroak, 2 + rng() * 4);
          } else {
            spawnRing(f.tx, f.tz, 0, 0.17);
            spawnRing(f.tx, f.tz, 0.22, 0.27);
            frogSink(f);
          }
        }
        break;
      }
      case 'sink': {
        f.st = Math.min(1, f.st + dt / 0.3);
        const e = f.st * f.st;
        g.y = lerp(f.fy, WATER_Y - 0.14, e);
        f.vis = 1 - smoothstep(0.35, 1, f.st);
        sqT = 0.5;
        if (f.st >= 1) goUnder(f);
        break;
      }
      case 'under': {
        // 在水下悄悄游向浮出点
        const dx = f.ex - g.x, dz = f.ez - g.z, d = Math.hypot(dx, dz);
        const step = Math.min(d, 0.7 * dt);
        if (d > 1e-5) { g.x += (dx / d) * step; g.z += (dz / d) * step; }
        g.y = WATER_Y - 0.14;
        if (!hiddenReq) f.tUnder -= dt;
        if (f.tUnder <= 0 && !hiddenReq && !threat && d < 0.02 && !(dog.on && Math.hypot(g.x - dog.x, g.z - dog.z) < 1.9)) {
          f.phase = 'surface'; f.st = 0; f.hidden = false;
          f.group.visible = true; f.vis = 0.01;
          f.heading = Math.atan2(pads[f.tpad].x - g.x, pads[f.tpad].z - g.z);
          spawnRing(g.x, g.z, 0, 0.12, 1.0);
        }
        break;
      }
      case 'surface': {
        f.st += dt / 0.7;
        const u = Math.min(1, f.st);
        f.vis = smoothstep(0, 0.5, u);
        g.y = lerp(WATER_Y - 0.14, wy, smoothstep(0, 0.8, u));
        if (hiddenReq || threat) { f.fy = g.y; f.phase = 'sink'; f.st = 0; break; }
        if (f.st >= 1.4) startPadHop(f, f.tpad);
        break;
      }
      default: break;
    }
    f.sqT = damp(f.sqT, 0, 3, dt);
    f.squash = damp(f.squash, f.phase === 'pad' ? Math.max(sqT, f.sqT * 0.9) : sqT, 14, dt);
    if (f.phase !== 'hop') f.group.rotation.x = 0;
    f.group.rotation.y = f.heading;
    f.hidden = f.phase === 'under' || (f.phase === 'sink' && f.vis < 0.02);
    const v = clamp(f.vis, 0.001, 1);
    f.group.scale.setScalar(v);
    f.group.visible = f.phase !== 'under' && v > 0.015;
    f.update(dt);
  }

  // ---- 螃蟹 ----
  const crabs = [];
  {
    const c = createCrab();
    // 起点：第一段可用的岸边
    let th0 = 1.9;
    for (let k = 0; k < NSEC; k++) { const t = 1.9 + (k / NSEC) * TAU; if (widthAt(t) > 0.1) { th0 = t; break; } }
    Object.assign(c, {
      phase: 'idle', th: th0, off: 0.06, offT: 0.06, spd: 0, hidden: false, vis: 1, expo: 0.5, tDec: 1 + rng() * 3, timer: 0, hideT: 0, yaw: 0,
      x: 0, z: 0, walks: 0, pinches: 0, fleeD: 1,
    });
    group.add(c.group);
    crabs.push(c);
  }

  function crabPlace(c) {
    const r = crabBandInner(c.th) + c.off;
    c.x = px + Math.cos(c.th) * r; c.z = pz + Math.sin(c.th) * r;
  }
  for (const c of crabs) { crabPlace(c); c.yaw = Math.atan2(-Math.cos(c.th), -Math.sin(c.th)); c.group.position.set(c.x, heightAt(c.x, c.z), c.z); c.group.rotation.y = c.yaw; }

  /** 沿岸迈一步（speed：世界单位/秒）；撞到禁区返回 false */
  function crabStep(c, dt, speed) {
    const r = crabBandInner(c.th) + c.off;
    const nth = c.th + (c.dir * speed * dt) / r;
    if (widthAt(nth) <= 0) return false;
    c.th = nth;
    return true;
  }

  function crabAct(env) {
    const h = hourOf(env);
    if (h >= 22 || h < 5) return 0;
    const rain = env && Number.isFinite(env.rain) ? env.rain : 0;
    const wet = env && Number.isFinite(env.wetness) ? env.wetness : 0;
    const sun = env && Number.isFinite(env.sunsetFactor) ? env.sunsetFactor : 0;
    if (rain > 0.1 || wet > 0.1) return 1.4;
    if ((h >= 5 && h < 8) || (h >= 17 && h < 22) || sun > 0.35) return 1.2;
    return 0.45;
  }

  function updateCrab(c, dt, act) {
    const dd = dog.on ? Math.hypot(c.x - dog.x, c.z - dog.z) : 1e9;
    const night = act === 0;
    let speed = 0, expoT = clamp(0.3 + 0.7 * act);
    const tangent = c.dir; // 保持 c.dir 为当前行进方向
    if (hiddenReq) {
      if (c.phase !== 'gone') { c.phase = 'gone'; c.timer = 0; }
    } else if (c.phase === 'gone') { c.phase = 'idle'; c.tDec = 0.8 + rng() * 2; }

    switch (c.phase) {
      case 'gone':
        c.setState('hide'); expoT = 0; c.timer += dt;
        break;
      case 'night':
        c.setState('hide'); expoT = 0;
        if (!night) { c.phase = 'idle'; c.tDec = 1 + rng() * 3; }
        break;
      case 'idle':
        c.setState('idle');
        if (night) { c.phase = 'night'; break; }
        if (dd < 1.4) { crabScare(c, dd); break; }
        c.tDec -= dt * act;
        if (c.tDec <= 0) {
          const r = rng();
          if (r < 0.5 * Math.min(act, 1.4)) {
            // 沿岸横着走一小段
            c.dir = rng() < 0.5 ? 1 : -1;
            if (widthAt(c.th + c.dir * 0.12) <= 0) c.dir = -c.dir;
            c.phase = 'walk'; c.timer = 1.5 + rng() * 2.5; c.walks++;
            c.offT = rng() * 0.12;
          } else if (r < 0.5 * Math.min(act, 1.4) + 0.25 * act) {
            c.phase = 'pinch'; c.timer = 1.8 + rng() * 1.6; c.pinches++;
          } else c.tDec = 4 + rng() * 6;
          if (c.phase === 'idle') c.tDec = 4 + rng() * 8;
        }
        break;
      case 'walk':
        c.setState('walk'); expoT = 1;
        if (night) { c.phase = 'night'; break; }
        if (dd < 1.4) { crabScare(c, dd); break; }
        c.timer -= dt; speed = 0.26;
        if (!crabStep(c, dt, speed)) { c.dir = -c.dir; c.phase = 'idle'; c.tDec = 2 + rng() * 3; speed = 0; }
        else if (c.timer <= 0) { c.phase = 'idle'; c.tDec = 3 + rng() * 6; }
        break;
      case 'pinch':
        c.setState('pinch'); expoT = 1; c.timer -= dt;
        if (night) { c.phase = 'night'; break; }
        if (dd < 1.4) { crabScare(c, dd); break; }
        if (c.timer <= 0) { c.phase = 'idle'; c.tDec = 4 + rng() * 6; }
        break;
      case 'flee':
        c.setState('walk'); expoT = 1; c.timer -= dt; speed = 0.8;
        if (!crabStep(c, dt, speed) || c.timer <= 0) { c.phase = 'hide'; c.hideT = 0; speed = 0; }
        break;
      case 'hide':
        c.setState('hide'); expoT = 0; c.hideT += dt;
        if (c.hideT > 1.5 && dd > 1.9) { c.phase = 'idle'; c.tDec = 1 + rng() * 2; }
        break;
      default: c.phase = 'idle';
    }
    void tangent;

    // 平滑量：露出程度（半藏 ↔ 完全露出）、整体可见度（躲进石缝）
    c.expo = damp(c.expo, expoT, 3, dt);
    c.lurk = 1 - c.expo;
    c.vis = damp(c.vis, c.phase === 'gone' && c.timer > 0.5 ? 0 : 1, 6, dt);
    if (c.phase !== 'gone' && c.vis < 0.999) c.vis = Math.min(1, c.vis + dt * 0.1);
    // 径向位置缓慢靠向目标，并限制在该处环带宽度内
    c.off += (Math.min(c.offT, Math.max(0, widthAt(c.th) - 0.02)) - c.off) * Math.min(1, dt * 4);
    crabPlace(c);
    const gy = heightAt(c.x, c.z);
    c.group.position.set(c.x, gy + 0.003 - 0.05 * (1 - c.vis), c.z);
    c.yaw = dampAngle(c.yaw, Math.atan2(-Math.cos(c.th), -Math.sin(c.th)), 8, dt);
    c.group.rotation.y = c.yaw;
    c.walkRate = speed > 0.5 ? 1.8 : 1;
    const v = clamp(c.vis, 0.001, 1);
    c.group.scale.setScalar(v);
    c.group.visible = v > 0.02;
    c.hidden = c.vis < 0.05;
    c.update(dt);
  }

  function crabScare(c, dd) {
    // 离得很近：直接缩起来；否则快速横着躲到远离狗的一侧
    const tx = -Math.sin(c.th), tz = Math.cos(c.th);
    const dirAway = ((c.x - dog.x) * tx + (c.z - dog.z) * tz) >= 0 ? 1 : -1;
    if (dd < 0.8 || widthAt(c.th + dirAway * 0.1) <= 0) { c.phase = 'hide'; c.hideT = 0; c.setState('hide'); return; }
    c.dir = dirAway; c.phase = 'flee'; c.timer = 1.1; c.offT = rng() * 0.12;
  }

  // ---- 总更新 ----
  function update(dt, env, dogPos) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    dog.on = !!(dogPos && Number.isFinite(dogPos.x) && Number.isFinite(dogPos.z));
    if (dog.on) { dog.x = dogPos.x; dog.z = dogPos.z; }
    const fa = frogAct(env);
    const ca = crabAct(env);
    for (let i = 0; i < frogs.length; i++) updateFrog(frogs[i], dt, fa, fa === 0);
    for (let i = 0; i < crabs.length; i++) updateCrab(crabs[i], dt, ca);
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (r.t >= 1) { if (r.m.visible) r.m.visible = false; continue; }
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.t = Math.min(1, r.t + dt / r.life);
      const s = 0.03 + r.max * (1 - (1 - r.t) * (1 - r.t));
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = 0.6 * (1 - r.t);
      r.m.visible = true;
    }
  }

  function setHidden(b) {
    b = !!b;
    if (b === hiddenReq) return;
    hiddenReq = b;
    if (!b) for (const f of frogs) if (f.phase === 'under') f.tUnder = Math.min(f.tUnder, 0.8 + rng() * 4);
  }

  return {
    group, update, frogs, crabs, setHidden,
    get hidden() { return hiddenReq; },
    pads, // 荷叶（{x,z,y,r,usable,owner}），调试 / 测试用
  };
}
