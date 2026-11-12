// 柴犬造型 + 骨架。整只狗的毛皮是 1 个 SkinnedMesh（躯干/颈/头/耳/下颌/四腿/卷尾都在里面，接缝由蒙皮权重平滑过渡），
// 眼睛、鼻子、舌头、项圈、铃铛是挂在骨骼上的小刚体网格。
// 坐标：狗本地 +Z 朝前，+X 为狗的左侧，y=0 为地面。
import * as THREE from 'three';
import { applyPaint, PAINT_NOISE_GLSL } from '../../core/paint.js';
import { blob, ellipsoid, fluff, ss, SkinBuilder, mergeColored, fixWinding } from './geometry.js';

// ---------------------------------------------------------------- 尺寸
export const DIM = {
  SCALE: 0.94,          // 整体缩放（root 骨骼）
  // 小短腿：腿长约为原来的 2/3，躯干相应放低（原 BODY_Y 0.355、腿 0.158+0.088 / 0.158+0.098）
  BODY_Y: 0.272,        // 躯干中心高度（站立）
  ANK: 0.046,           // 脚踝（paw 骨）离地高度
  FRONT: { joint: [0.092, -0.07, 0.06], L1: 0.105, L2: 0.062 },   // 相对 chest
  REAR: { joint: [0.112, -0.065, -0.05], L1: 0.105, L2: 0.066 },     // 相对 hips（大屁股：后腿分得更开）
  CHEST: [0, 0, 0.115],
  HIPS: [0, 0, -0.12],
  NECK: [0, 0.09, 0.12],      // 相对 chest
  HEAD: [0, 0.13, 0.05],      // 相对 neck
  JAW: [0, -0.062, 0.07],     // 相对 head
  EAR: [0.098, 0.165, -0.015], // 相对 head
  TAIL: [0, 0.095, -0.145],   // 相对 hips
  TAIL_SEG: 0.05,
  TAIL_N: 6,
};

// ---------------------------------------------------------------- 颜色（比 palette 略降饱和、偏暖）
const C = (h) => new THREE.Color(h);
export const COL = {
  orange: C(0xd98a3c),
  orangeDeep: C(0xc0702f),
  orangeLight: C(0xe4a35c),
  cream: C(0xf3e6cc),
  creamWarm: C(0xf0dcbc),
  brow: C(0xf8eedb),
  innerEar: C(0xf0d2bf),
  black: C(0x1d1714),
  nose: C(0x241b17),
  mouthDark: C(0x5a2427),
  mouthPink: C(0xb4565c),
  tongue: C(0xe9848e),
  collar: C(0xc8413a),
  bell: C(0xe8b84a),
  bellDark: C(0x8a5a22),
  white: C(0xffffff),
};

const tmpC = new THREE.Color();
function mix3(out, a, b, t) {
  out.r = a.r + (b.r - a.r) * t; out.g = a.g + (b.g - a.g) * t; out.b = a.b + (b.b - a.b) * t;
  return out;
}
const gauss = (t, c, w) => Math.exp(-((t - c) / w) * ((t - c) / w));

// ---------------------------------------------------------------- 头部形体（头骨骼空间）
const SKULL = { c: [0, 0.05, 0.02], r: [0.205, 0.178, 0.185] };
const CHEEK = { c: [0.088, -0.036, 0.083], r: [0.116, 0.094, 0.102] };
const MUZZLE = { c: [0, -0.022, 0.148], r: [0.088, 0.057, 0.092] };
const HEAD_ELLS = [SKULL, CHEEK, { c: [-CHEEK.c[0], CHEEK.c[1], CHEEK.c[2]], r: CHEEK.r }, MUZZLE];

/** 头部表面前向 z（取各椭球最大值） */
function headSurf(x, y, outN) {
  let best = -1e9, bi = -1;
  for (let i = 0; i < HEAD_ELLS.length; i++) {
    const e = HEAD_ELLS[i];
    const nx = (x - e.c[0]) / e.r[0], ny = (y - e.c[1]) / e.r[1];
    const q = 1 - nx * nx - ny * ny;
    if (q <= 0) continue;
    const z = e.c[2] + e.r[2] * Math.sqrt(q);
    if (z > best) { best = z; bi = i; }
  }
  if (outN && bi >= 0) {
    const e = HEAD_ELLS[bi];
    outN.set((x - e.c[0]) / (e.r[0] * e.r[0]), (y - e.c[1]) / (e.r[1] * e.r[1]), (best - e.c[2]) / (e.r[2] * e.r[2])).normalize();
  }
  return best;
}

/** 头部毛色场：里白（脸颊、嘴套、下巴）与橘色 */
function headColor(p, out) {
  const ax = Math.abs(p.x);
  // 嘴套/脸颊的里白边界：中线（鼻梁）略高，眼下方偏低，到脸侧又上扬
  const yb = 0.012 + 0.016 * (1 - ss(0.015, 0.055, ax)) + 0.42 * Math.max(0, ax - 0.115) * (1 + 2.5 * Math.max(0, ax - 0.16));
  let w = ss(yb + 0.014, yb - 0.014, p.y) * ss(-0.07, 0.03, p.z);
  w = Math.max(w, ss(-0.07, -0.11, p.y)); // 下巴/喉部
  mix3(out, COL.orange, COL.cream, w);
  // 头顶略深
  const top = ss(0.13, 0.22, p.y) * 0.35;
  if (top > 0 && w < 0.5) mix3(out, out, COL.orangeDeep, top);
  return out;
}

/** 躯干毛色场（body 空间）：背部橘、腹部与胸前“围兜”奶白 */
function torsoColor(p, out) {
  const ax = Math.abs(p.x);
  const rise = ss(0.05, 0.30, p.z) * 0.30 * (1 - ss(0.05, 0.135, ax));
  const yl = -0.07 - 0.075 * ss(0.04, 0.13, ax) + rise;
  let w = ss(yl + 0.012, yl - 0.012, p.y); // 色块边界收紧：像画上去的两块颜色，而不是渐变
  // 柴犬标志性的“屁屁毛”：臀部后方一大片桃形奶白
  w = Math.max(w, ss(-0.22, -0.275, p.z) * ss(0.075, 0.04, p.y) * (1 - ss(0.1, 0.13, ax + 0.35 * Math.max(0, p.y + 0.02))));
  mix3(out, COL.orange, COL.cream, w);
  const top = ss(0.07, 0.15, p.y) * 0.25 * (1 - w);
  if (top > 0) mix3(out, out, COL.orangeDeep, top);
  return out;
}
const tmpC2 = new THREE.Color();
const tmpP = new THREE.Vector3();

// ---------------------------------------------------------------- 构建
export function buildDog() {
  const bones = [];
  const B = {};
  const mk = (name, parent, x, y, z) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    b.rotation.order = 'YXZ';
    if (parent) parent.add(b);
    B[name] = bones.length;
    bones.push(b);
    return b;
  };
  const root = mk('root', null, 0, 0, 0);
  root.scale.setScalar(DIM.SCALE);
  const body = mk('body', root, 0, DIM.BODY_Y, 0);
  const hips = mk('hips', body, ...DIM.HIPS);
  const chest = mk('chest', body, ...DIM.CHEST);
  const belly = mk('belly', body, 0, -0.03, 0.0);
  const neck = mk('neck', chest, ...DIM.NECK);
  const head = mk('head', neck, ...DIM.HEAD);
  const jaw = mk('jaw', head, ...DIM.JAW);
  const earL = mk('earL', head, DIM.EAR[0], DIM.EAR[1], DIM.EAR[2]);
  const earR = mk('earR', head, -DIM.EAR[0], DIM.EAR[1], DIM.EAR[2]);
  earL.rotation.order = earR.rotation.order = 'ZXY';
  const legs = [];
  const legDefs = [
    { name: 'FL', parent: chest, d: DIM.FRONT, side: 1, front: true },
    { name: 'FR', parent: chest, d: DIM.FRONT, side: -1, front: true },
    { name: 'RL', parent: hips, d: DIM.REAR, side: 1, front: false },
    { name: 'RR', parent: hips, d: DIM.REAR, side: -1, front: false },
  ];
  for (const L of legDefs) {
    const j = L.d.joint;
    const up = mk(L.name + 'u', L.parent, j[0] * L.side, j[1], j[2]);
    up.rotation.order = 'ZXY';
    const lo = mk(L.name + 'l', up, 0, -L.d.L1, 0);
    const paw = mk(L.name + 'p', lo, 0, -L.d.L2, 0);
    legs.push({ ...L, up, lo, paw, jointPos: new THREE.Vector3(j[0] * L.side, j[1], j[2]), L1: L.d.L1, L2: L.d.L2 });
  }
  const tail = [];
  let tp = hips;
  for (let i = 0; i < DIM.TAIL_N; i++) {
    const b = i === 0 ? mk('tail0', hips, ...DIM.TAIL) : mk('tail' + i, tp, 0, DIM.TAIL_SEG, 0);
    b.rotation.order = i === 0 ? 'ZXY' : 'XYZ';
    tail.push(b);
    tp = b;
  }

  root.updateMatrixWorld(true);
  const rest = bones.map((b) => b.matrixWorld.clone());
  const sb = new SkinBuilder(rest);

  // ---------------- 躯干（定义在 body 空间，蒙皮到 hips/chest/belly）
  const torso = blob(56, 36, (v, o) => {
    const t = v.y; // -1 臀 .. +1 胸
    const r0 = Math.sqrt(Math.max(1e-9, 1 - t * t));
    const e = 2.6;
    const sf = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), e)), 1 / e);
    const k = sf / r0;
    const a = v.x * k, b = v.z * k;
    // 梨形身体：胸略收，屁股又宽又圆
    const hw = 0.172 * (0.94 + 0.03 * gauss(t, 0.45, 0.35) - 0.05 * gauss(t, -0.05, 0.3) + 0.4 * gauss(t, -0.6, 0.38));
    const hh = 0.150 * (0.97 + 0.05 * gauss(t, 0.5, 0.35) - 0.03 * gauss(t, 0, 0.3) + 0.27 * gauss(t, -0.6, 0.4)) * (b < 0 ? 0.96 : 1);
    const yc = 0.035 * ss(0.1, 1, t) - 0.004;
    // 毛簇：胸前（围兜）和屁股更蓬
    const bib = ss(0.35, 0.95, t) * ss(0.3, -0.5, b);
    const rump = ss(-0.55, -0.95, t);
    const f = fluff({ x: a, y: b, z: t }, { amp: 0.035, tuft: 0.03 + 0.13 * bib + 0.06 * rump, freq: 3.2, seed: 3 });
    o.set(a * hw * f, yc + b * hh * f, -0.015 + t * 0.305 * (1 + (f - 1) * ss(0.4, 0.9, Math.abs(t))));
  });
  const iH = B.hips, iC = B.chest, iBe = B.belly;
  sb.add(torso, {
    bone: B.body,
    color: torsoColor,
    skinFn: (p, bi, bw) => {
      const wc = ss(-0.13, 0.14, p.z);
      const wb = 0.55 * ss(0.03, -0.1, p.y) * (1 - ss(0.1, 0.24, Math.abs(p.z)));
      bi[0] = iH; bw[0] = (1 - wc) * (1 - wb);
      bi[1] = iC; bw[1] = wc * (1 - wb);
      bi[2] = iBe; bw[2] = wb;
    },
  });

  // ---------------- 屁股：左右两瓣圆鼓鼓的屁股蛋，中间一道沟（挂在 hips 上，跟着扭）
  for (const s of [1, -1]) {
    const bg = ellipsoid(s * 0.096, -0.04, -0.142, 0.118, 0.128, 0.112, { ws: 24, hs: 18, fur: { amp: 0.02, tuft: 0.02, freq: 3, seed: s > 0 ? 51 : 52 } });
    sb.add(bg, {
      bone: iH,
      // 颜色沿用躯干的毛色场（换算到 body 空间）：两瓣的内侧后方是奶白色，合起来是一个桃心形的“屁屁毛”
      color: (p, out) => torsoColor(tmpP.set(p.x + DIM.HIPS[0], p.y + DIM.HIPS[1], p.z + DIM.HIPS[2]), out),
    });
  }

  // ---------------- 颈（neck 空间），带一圈毛领
  const neckGeo = blob(30, 18, (v, o) => {
    const f = fluff(v, { amp: 0.04, tuft: 0.09 * ss(-0.2, 0.6, v.z) + 0.03, freq: 3, seed: 5 });
    o.set(v.x * 0.122 * f, 0.035 + v.y * 0.13, -0.005 + v.z * 0.12 * f);
  });
  const iN = B.neck, iHd = B.head;
  sb.add(neckGeo, {
    bone: B.neck,
    color: (p, out) => {
      const w = Math.max(ss(-0.02, 0.06, p.z) * (1 - ss(0.07, 0.12, Math.abs(p.x))), ss(0.0, -0.08, p.y) * ss(-0.06, 0.02, p.z));
      return mix3(out, COL.orange, COL.cream, w);
    },
    skinFn: (p, bi, bw) => {
      const wn = ss(-0.03, 0.08, p.y);
      const wh = 0.45 * ss(0.1, 0.16, p.y);
      bi[0] = iC; bw[0] = 1 - wn;
      bi[1] = iN; bw[1] = wn * (1 - wh);
      bi[2] = iHd; bw[2] = wn * wh;
    },
  });

  // ---------------- 头（head 空间，刚性）
  const hs = (geo) => sb.add(geo, { bone: iHd, color: headColor });
  hs(ellipsoid(...SKULL.c, ...SKULL.r, { ws: 34, hs: 24, fur: { amp: 0.03, tuft: 0.03, freq: 3.2, seed: 11 } }));
  for (const s of [1, -1]) {
    // 鼓鼓的脸颊：外下缘有明显的毛簇
    const cg = blob(40, 26, (v, o) => {
      const outward = ss(0.1, 0.8, v.x) * ss(0.5, -0.4, v.y);
      const f = fluff(v, { amp: 0.035, tuft: 0.05 + 0.22 * outward, freq: 3.4, seed: s > 0 ? 21 : 22 });
      o.set(CHEEK.c[0] + v.x * CHEEK.r[0] * f, CHEEK.c[1] + v.y * CHEEK.r[1] * f, CHEEK.c[2] + v.z * CHEEK.r[2] * f);
    });
    if (s < 0) { cg.scale(-1, 1, 1); fixWinding(cg); } // 镜像会把面的朝向翻过去，要翻回来
    hs(cg);
  }
  hs(ellipsoid(...MUZZLE.c, ...MUZZLE.r, { ws: 24, hs: 16 }));
  // 嘴里（深色），张嘴时可见
  sb.add(ellipsoid(0, -0.066, 0.140, 0.058, 0.026, 0.07, { ws: 16, hs: 10 }), { bone: iHd, color: COL.mouthDark });
  // 眉点
  for (const s of [1, -1]) {
    const x = 0.066 * s, y = 0.122;
    const n = new THREE.Vector3();
    const z = headSurf(x, y, n);
    const g = ellipsoid(0, 0, 0, 0.031, 0.02, 0.014, { ws: 14, hs: 10 });
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z - 0.004),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3 * s)),
      new THREE.Vector3(1, 1, 1),
    );
    sb.add(g, { bone: iHd, matrix: m, color: COL.brow });
  }
  // 微笑嘴线 ω + 人中
  {
    const surfPt = (x, y, lift = 0.003) => new THREE.Vector3(x, y, headSurf(x, y) + lift);
    const curves = [];
    const L = [[-0.062, -0.034], [-0.05, -0.055], [-0.03, -0.066], [-0.01, -0.06], [0, -0.048]];
    curves.push(L.map(([x, y]) => surfPt(x, y)));
    curves.push(L.map(([x, y]) => surfPt(-x, y)).reverse());
    curves.push([surfPt(0, -0.048), surfPt(0, -0.034), surfPt(0, -0.02)]);
    for (const pts of curves) {
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.0062, 6, false);
      tube.deleteAttribute('uv');
      sb.add(tube, { bone: iHd, color: COL.mouthDark });
    }
  }

  // ---------------- 耳朵（ear 空间，刚性）：圆润三角、内耳奶白、前面微凹
  for (const [s, iE] of [[1, B.earL], [-1, B.earR]]) {
    const eg = blob(20, 16, (v, o) => {
      const h = (v.y + 1) / 2;
      const r0 = Math.sqrt(Math.max(1e-9, 1 - v.y * v.y));
      const xn = v.x / r0;
      const A = 0.084 * (1 - h * 0.86) * (h < 0.12 ? 0.9 + h : 1);
      const Bz = 0.044 * (1 - h * 0.6);
      let z = v.z * Bz;
      if (v.z > 0) z -= 0.014 * (1 - xn * xn) * Math.sin(Math.PI * Math.min(1, h * 1.15)) * r0;
      o.set(v.x * A * (1 + 0.04 * Math.sin(h * 9 + s)), -0.02 + h * 0.165, z);
    });
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.12, 0, -0.32 * s, 'XYZ'));
    sb.add(eg, {
      bone: iE,
      matrix: m,
      color: (p, out) => {
        // p 已在耳骨空间（带外倾）；用未倾斜的近似：转回去
        const q = tmpV.copy(p).applyMatrix4(mInvTilt[s > 0 ? 0 : 1]);
        const h = (q.y + 0.02) / 0.165;
        const wIn = ss(-0.004, 0.006, q.z) * ss(0.8, 0.45, Math.abs(q.x) / Math.max(0.01, 0.084 * (1 - h * 0.86))) * ss(0.02, 0.12, h) * ss(0.92, 0.7, h);
        return mix3(out, h > 0.8 ? COL.orangeDeep : COL.orange, COL.innerEar, wIn);
      },
    });
  }

  // ---------------- 下颌（jaw 空间）
  sb.add(ellipsoid(0, -0.014, 0.066, 0.062, 0.03, 0.084, { ws: 20, hs: 12, fur: { amp: 0.02, tuft: 0.05, freq: 3, seed: 31 } }), {
    bone: B.jaw,
    color: (p, out) => (p.y > 0.002 && p.z > -0.005 ? mix3(out, COL.mouthPink, COL.mouthDark, ss(0.11, 0.0, p.z) * 0.6) : out.copy(COL.cream)),
  });

  // ---------------- 四条腿
  for (const L of legs) {
    const iU = B[L.name + 'u'], iL = B[L.name + 'l'], iP = B[L.name + 'p'], iPar = L.front ? iC : iH;
    const tot = L.L1 + L.L2;
    const top = L.front ? 0.06 : 0.06;
    const yc = (top - tot) / 2, half = (top + tot) / 2;
    const legGeo = blob(16, 18, (v, o) => {
      const t = v.y;
      const r0 = Math.sqrt(Math.max(1e-9, 1 - t * t));
      const sf = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 3)), 1 / 3);
      const k = sf / r0;
      const y = yc + t * half;
      // 粗短的腿：前腿像小圆柱墩子，后腿是鼓鼓的“鸡腿”，上粗下细，和身体连成一体（不要一节一节的关节感）
      // 粗细比例：大腿（上段）粗、小腿（下段）细。前腿是上略粗下细的直柱；后腿大腿鼓、到跗关节迅速收细。
      const r = L.front ? 0.031 + 0.021 * ss(-L.L1 - 0.01, 0.02, y) : 0.029 + 0.05 * Math.pow(ss(-L.L1 - 0.005, -0.005, y), 1.3);
      const f = fluff(v, { amp: 0.03, tuft: L.front ? 0.03 : 0.05 * ss(-0.1, 0.0, y), freq: 2.6, seed: iU });
      // 后腿大腿向后鼓
      const bz = L.front ? 0 : 0.03 * ss(-L.L1, 0.0, y) * (v.z < 0 ? 1 : 0.3);
      o.set(v.x * k * r * f, y, v.z * k * r * f - bz * (v.z < 0 ? 1 : -1) * 0.5);
    });
    const par = L.front ? DIM.CHEST : DIM.HIPS;
    const colorFn = (p, out) => {
      // 只留“白袜子”和后腿后侧的奶白裤子，边界干脆（原先内侧的大片渐变奶白在受光下像一块块灰斑）
      const sock = ss(-tot + 0.075, -tot + 0.06, p.y);
      const pants = L.front ? 0 : ss(-0.012, -0.03, p.z) * ss(-tot + 0.06, -tot + 0.085, p.y);
      const w = Math.max(sock, pants);
      mix3(out, COL.orange, COL.cream, w);
      // 腿根与躯干同色过渡（避免“贴上去的圆片”）
      const tb = ss(-0.08, 0.0, p.y);
      if (tb > 0) {
        tmpP.set(p.x + L.jointPos.x + par[0], p.y + L.jointPos.y + par[1], p.z + L.jointPos.z + par[2]);
        mix3(out, out, torsoColor(tmpP, tmpC2), tb);
      }
      return out;
    };
    sb.add(legGeo, {
      bone: iU,
      color: colorFn,
      skinFn: (p, bi, bw) => {
        const wpar = 0.55 * ss(-0.03, top, p.y);
        const wl = ss(-L.L1 + 0.035, -L.L1 - 0.035, p.y);
        const wp = ss(-tot + 0.03, -tot - 0.01, p.y);
        bi[0] = iPar; bw[0] = wpar;
        bi[1] = iU; bw[1] = (1 - wpar) * (1 - wl);
        bi[2] = iL; bw[2] = (1 - wpar) * wl * (1 - wp);
        bi[3] = iP; bw[3] = (1 - wpar) * wl * wp;
      },
    });
    // 爪子：扁圆，前端有两道趾缝凸起
    const pawGeo = blob(16, 12, (v, o) => {
      const toes = 1 + 0.06 * Math.pow(Math.max(0, Math.cos(Math.atan2(v.x, 0.0001 + Math.max(0, v.z)) * 4)), 4) * ss(0.2, 0.8, v.z);
      const f = fluff(v, { amp: 0.02, tuft: 0.0, freq: 3, seed: iP });
      o.set(v.x * 0.045 * f * toes, -0.006 + v.y * 0.034 * (v.y < 0 ? 0.72 : 1), 0.014 + v.z * 0.054 * f * toes);
    });
    pawGeo.translate(0, -tot, 0);
    sb.add(pawGeo, {
      bone: iU,
      color: COL.cream,
      skinFn: (p, bi, bw) => {
        const wp = ss(-tot + 0.04, -tot + 0.0, p.y);
        bi[0] = iL; bw[0] = 1 - wp;
        bi[1] = iP; bw[1] = wp;
      },
    });
  }

  // ---------------- 卷尾（tail0 空间，沿 +Y；卷向 +Z，内侧奶白）
  {
    const len = DIM.TAIL_SEG * (DIM.TAIL_N - 1) + 0.075;
    const y0 = -0.035;
    const tg = blob(30, 40, (v, o) => {
      const t = v.y;
      const h = (t + 1) / 2;
      const r0 = Math.sqrt(Math.max(1e-9, 1 - t * t));
      const sf = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.4)), 1 / 2.4);
      const k = sf / r0;
      const r = 0.05 + 0.03 * Math.sin(Math.PI * Math.min(1, h * 1.25 + 0.05));
      const f = fluff(v, { amp: 0.05, tuft: 0.18 * ss(-0.5, 0.3, -v.z * k) + 0.06, freq: 3.2, seed: 41 });
      o.set(v.x * k * r * f, y0 + h * len, v.z * k * r * f * 0.92);
    });
    const tIdx = tail.map((b) => B[b.name]);
    sb.add(tg, {
      bone: tIdx[0],
      color: (p, out) => {
        // 整条尾巴和背部同色，只有尾巴尖是白的（原先尾巴内侧整片奶白，坐下时看起来像一块白斑）
        const h = (p.y - y0) / len; // 0 尾根 → 1 尾尖
        return mix3(out, COL.orange, COL.cream, ss(0.8, 0.9, h));
      },
      skinFn: (p, bi, bw) => {
        const u = Math.min(DIM.TAIL_N - 1, Math.max(0, p.y / DIM.TAIL_SEG));
        const i0 = Math.min(DIM.TAIL_N - 2, Math.floor(u));
        const f = Math.min(1, u - i0);
        const wh = ss(0.02, -0.03, p.y) * 0.5;
        bi[0] = tIdx[i0]; bw[0] = (1 - f) * (1 - wh);
        bi[1] = tIdx[i0 + 1]; bw[1] = f * (1 - wh);
        bi[2] = iH; bw[2] = wh;
      },
    });
  }

  // ---------------- 材质
  // 毛皮：手绘平涂。不要连续的受光渐变和高光（那是“黏土/塑料材质”的观感来源），
  // 而是“亮面一块色、暗面一块色”，交界是带一点笔触抖动的硬边；暗面偏冷，亮面保持固有色。
  // 光色仍来自场景（昼夜、晚霞、雨天会跟着变），只是把明暗压成两个色阶。
  const furMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  furMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('void main() {', `varying vec3 vRestPos;
void main() {
  vRestPos = position;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `varying vec3 vRestPos;
${PAINT_NOISE_GLSL}
void main() {
  float dabN = 0.5;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // 颜料块：把静止姿态坐标量化成小格再取噪声，得到一小块一小块深浅不一的色块（钉在身上，不随动画游动）
          vec3 cell = floor(vRestPos * 24.0) / 24.0;
          dabN = pNoise(cell * 8.0) * 0.6 + pNoise(vRestPos * 6.0 + 3.1) * 0.4;
          diffuseColor.rgb *= 1.0 + (smoothstep(0.3, 0.7, dabN) - 0.5) * 0.13;
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 alb = diffuseColor.rgb;
          const vec3 LW = vec3(0.3, 0.5, 0.2);
          #if NUM_DIR_LIGHTS > 0
            vec3 lc = directionalLights[0].color;
          #else
            vec3 lc = vec3(1.0);
          #endif
          float full = max(dot(alb * lc, LW) * RECIPROCAL_PI, 1e-4);
          float nl = clamp(dot(reflectedLight.directDiffuse, LW) / full, 0.0, 1.5); // ≈ N·L × 阴影
          float jit = (dabN - 0.5) * 0.07;
          float lit = smoothstep(0.1 + jit, 0.15 + jit, nl);
          // 亮面 = 环境光 + 固定比例的主光；暗面 = 亮面乘一个偏紫的暗部色（像水粉里叠一层阴影色），明暗比固定，不会出现死灰的暗部
          vec3 litCol = reflectedLight.indirectDiffuse + alb * lc * RECIPROCAL_PI * 0.55;
          outgoingLight = litCol * mix(vec3(0.7, 0.64, 0.74), vec3(1.0), lit) + totalEmissiveRadiance;
        }
        #include <opaque_fragment>`,
      );
  };
  furMat.customProgramCacheKey = () => 'dogFurCel';

  const geo = sb.build();
  const mesh = new THREE.SkinnedMesh(geo, furMat);
  mesh.name = 'shiba-fur';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  // ---------------- 刚体小件
  const meshes = [mesh];
  const add = (m, parent) => { m.castShadow = true; m.receiveShadow = true; parent.add(m); meshes.push(m); return m; };

  // 眼睛：黑亮 + 大高光（顶点色白色部分自发光）
  // 眼睛、鼻子：画上去的小黑豆，哑光、不受光（原先带大高光的玻璃球眼睛是“3D 材质感”的主要来源之一）
  const eyeMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const eyes = [];
  for (const s of [1, -1]) {
    const x = 0.082 * s, y = 0.03;
    const n = new THREE.Vector3();
    const z = headSurf(x, y, n);
    const eg = mergeColored([
      { geo: ellipsoid(0, 0, 0, 0.027, 0.031, 0.015, { ws: 16, hs: 12 }), color: COL.black },
      { geo: ellipsoid(0, 0, 0, 0.0075, 0.0075, 0.004, { ws: 8, hs: 6 }), matrix: new THREE.Matrix4().makeTranslation(0.008 * s, 0.011, 0.012), color: C(0xbdb3a6) },
    ]);
    const pivot = new THREE.Object3D();
    pivot.position.set(x, y, z - 0.006);
    pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.lerp(new THREE.Vector3(0, 0, 1), 0.35).normalize());
    bones[iHd].add(pivot);
    const em = add(new THREE.Mesh(eg, eyeMat), pivot);
    em.name = 'eye';
    eyes.push(em);
  }

  // 鼻子：大而圆的倒三角黑鼻头 + 一点高光
  {
    const ng = mergeColored([
      {
        geo: blob(18, 12, (v, o) => {
          const w = 1 + 0.28 * v.y;
          o.set(v.x * 0.036 * w, v.y * 0.025, v.z * 0.024);
        }),
        color: COL.nose,
      },
      { geo: ellipsoid(0, 0, 0, 0.007, 0.004, 0.003, { ws: 8, hs: 6 }), matrix: new THREE.Matrix4().makeTranslation(-0.008, 0.012, 0.02), color: C(0x5a4f48) },
    ]);
    const nm = add(new THREE.Mesh(ng, eyeMat), bones[iHd]);
    nm.position.set(0, 0.006, headSurf(0, 0.006) - 0.006);
    nm.rotation.x = -0.25;
    nm.name = 'nose';
  }

  // 舌头（jaw 子节点）
  const tongueMat = new THREE.MeshStandardMaterial({ color: COL.tongue, roughness: 0.6 });
  paintLocalRest(tongueMat, { scale: 30, strength: 0.06, hue: 0.3, bands: 0.25 }, 'dogTongue');
  const tongueGeo = blob(16, 10, (v, o) => {
    const groove = v.y > 0 ? 1 - 0.5 * Math.exp(-(v.x * v.x) / 0.04) : 1;
    o.set(v.x * 0.034 * (1 + 0.15 * v.z), v.y * 0.011 * groove, 0.05 + v.z * 0.056);
  });
  const tongue = add(new THREE.Mesh(tongueGeo, tongueMat), bones[B.jaw]);
  tongue.position.set(0, 0.004, 0.0);
  tongue.name = 'tongue';

  // 项圈 + 金铃
  const collarMat = new THREE.MeshStandardMaterial({ color: COL.collar, roughness: 0.7 });
  paintLocalRest(collarMat, { scale: 25, strength: 0.08, hue: 0.4, bands: 0.3 }, 'dogCollar');
  const collarGeo = new THREE.TorusGeometry(0.122, 0.024, 10, 32);
  collarGeo.deleteAttribute('uv');
  collarGeo.scale(1, 1.06, 1.25);
  const collar = add(new THREE.Mesh(collarGeo, collarMat), bones[iN]);
  collar.position.set(0, 0.02, 0.01);
  collar.rotation.x = Math.PI / 2 + 0.38;
  collar.name = 'collar';
  const bellMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  paintLocalRest(bellMat, { scale: 25, strength: 0.05, hue: 0.2, bands: 0.3 }, 'dogBell');
  const bellGeo = mergeColored([
    { geo: ellipsoid(0, -0.036, 0, 0.036, 0.034, 0.034, { ws: 16, hs: 12 }), color: COL.bell },
    { geo: new THREE.TorusGeometry(0.013, 0.005, 6, 12), matrix: new THREE.Matrix4().makeTranslation(0, 0.0, 0), color: COL.bell },
    { geo: ellipsoid(0, 0, 0, 0.022, 0.004, 0.004, { ws: 8, hs: 6 }), matrix: new THREE.Matrix4().makeTranslation(0, -0.046, 0.032), color: COL.bellDark },
    { geo: ellipsoid(0, 0, 0, 0.007, 0.007, 0.004, { ws: 8, hs: 6 }), matrix: new THREE.Matrix4().makeTranslation(0, -0.054, 0.031), color: COL.bellDark },
  ]);
  const bellPivot = new THREE.Object3D();
  bones[iN].add(bellPivot);
  // 项圈前下方
  const ca = Math.PI / 2 + 0.38;
  bellPivot.position.set(0, 0.02 - Math.sin(ca - Math.PI / 2) * 0.122 * 1.06 - 0.008, 0.01 + Math.cos(ca - Math.PI / 2) * 0.122 * 1.25 + 0.012);
  const bell = add(new THREE.Mesh(bellGeo, bellMat), bellPivot);
  bell.name = 'bell';

  // 叼木棍锚点：嘴前端牙齿处，本地 X = 狗的左右
  const mouthAnchor = new THREE.Object3D();
  mouthAnchor.name = 'mouthAnchor';
  mouthAnchor.position.set(0, -0.064, 0.175);
  bones[iHd].add(mouthAnchor);

  const skeleton = new THREE.Skeleton(bones);
  mesh.updateMatrixWorld(true);
  mesh.bind(skeleton, mesh.matrixWorld);

  return {
    root, mesh, meshes, bones, B, skeleton,
    body, hips, chest, belly, neck, head, jaw, earL, earR, legs, tail,
    eyes, tongue, bellPivot, mouthAnchor,
    materials: [furMat, eyeMat, tongueMat, collarMat, bellMat],
  };
}

const tmpV = new THREE.Vector3();
const mInvTilt = [1, -1].map((s) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.12, 0, -0.32 * s, 'XYZ')).invert());

/**
 * 手绘质感（core/paint.js）+ 让笔触色斑钉在“静止姿态”的本地坐标上（蒙皮变形时不游动）。
 */
function paintLocalRest(mat, opts, key) {
  applyPaint(mat, { ...opts, space: 'local' });
  const inner = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    inner.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader.replace('vPaintPos = paintP.xyz;', 'vPaintPos = position;');
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
}
