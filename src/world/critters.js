// 昆虫系统（WP4）：蝴蝶 / 蜜蜂 / 蜻蜓 / 萤火虫。接口见 DESIGN.md 3.5。
// 全部用 InstancedMesh（共 8 次 draw call）；update 中不分配对象；不访问 document/window；无 PointLight。
import * as THREE from 'three';
import { palette } from '../core/palette.js';
import { mulberry32, rand, clamp, damp, dampAngle, angleDiff, TAU, smoothstep } from '../core/util.js';

const RMAX = 7.2; // 水平活动半径（岛半径 8）
const RMAX_FF = 6.6;
const RAIN_WAIT = 20; // 雨停后约 20 秒才回来（另加每只 0~4 秒的错开）

// 临时对象（模块级复用，update 中不 new）
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _eu = new THREE.Euler(0, 0, 0, 'YXZ');
const _qf = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const AXIS_Z = new THREE.Vector3(0, 0, 1);

// 枢轴（身体局部坐标，米）
const PIV_BUTTERFLY = new THREE.Vector3(0, 0.01, 0);
const PIV_BEE = new THREE.Vector3(0, 0.026, 0.04);
const PIV_DF_FORE = new THREE.Vector3(0, 0.014, 0.066);
const PIV_DF_HIND = new THREE.Vector3(0, 0.014, 0.034);

// 翅膀轮廓（x 为展开方向，z 为弦向、+z 朝头；在 XZ 平面，即静止时水平展开）
// 蝴蝶：一侧 = 前翅（高而尖、外缘微波浪）+ 后翅（圆、带波浪边和小尾突）
const BFLY_FORE = { root: [0, 0.012], pts: [[0.012, 0.045], [0.05, 0.1], [0.1, 0.14], [0.142, 0.152], [0.165, 0.132], [0.158, 0.1], [0.166, 0.072], [0.15, 0.045], [0.152, 0.02], [0.1, 0.0], [0.04, 0.0]] };
const BFLY_HIND = { root: [0, -0.005], pts: [[0.04, 0.0], [0.1, 0.0], [0.138, -0.018], [0.15, -0.05], [0.134, -0.074], [0.14, -0.102], [0.112, -0.112], [0.098, -0.142], [0.072, -0.122], [0.04, -0.118], [0.012, -0.07]] };
const BEE_WING = [[0, 0], [0.028, 0.014], [0.072, 0.006], [0.102, -0.026], [0.096, -0.056], [0.06, -0.066], [0.026, -0.044], [0.008, -0.016]]; // 向后斜张的水滴形

/**
 * 蝴蝶翅膀：从翅根向轮廓放射的多圈三角网，带 aK（0 翅根 → 1 外缘），着色器据此做“翅根金黄 → 外缘品种色 → 深色镶边”的渐变。
 */
function butterflyWingGeometry(parts, rings = 4) {
  const pos = [], nrm = [], ks = [];
  const push = (x, z, k) => { pos.push(x, 0, z); nrm.push(0, 1, 0); ks.push(k); };
  for (const { root, pts } of parts) {
    const at = (p, k) => [root[0] + (p[0] - root[0]) * k, root[1] + (p[1] - root[1]) * k];
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = 0; j < rings; j++) {
        const k0 = j / rings, k1 = (j + 1) / rings;
        const a0 = at(pts[i], k0), b0 = at(pts[i + 1], k0), a1 = at(pts[i], k1), b1 = at(pts[i + 1], k1);
        if (j > 0) { push(a0[0], a0[1], k0); push(a1[0], a1[1], k1); push(b0[0], b0[1], k0); }
        push(b0[0], b0[1], k0); push(a1[0], a1[1], k1); push(b1[0], b1[1], k1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aK', new THREE.Float32BufferAttribute(ks, 1));
  return g;
}

/** 蜻蜓翅膀：细长条带；顶点色 RGBA —— 翅基一抹橙、中段近乎透明、近翅尖前缘有深色翅痣 */
function dragonflyWingGeometry() {
  // 站位：[x, 前缘 z, 后缘 z]
  const st = [[0, 0.007, -0.007], [0.03, 0.013, -0.014], [0.07, 0.016, -0.02], [0.12, 0.017, -0.023], [0.165, 0.016, -0.022], [0.185, 0.015, -0.019], [0.205, 0.012, -0.013], [0.22, 0.003, -0.003]];
  const colAt = (x, lead) => {
    if (x < 0.035) return [0.93, 0.5, 0.14, 0.8];
    if (x < 0.075) return [0.95, 0.72, 0.4, 0.45];
    if (lead && x > 0.16 && x < 0.2) return [0.3, 0.17, 0.1, 0.9];
    return [0.86, 0.93, 0.97, 0.42];
  };
  const pos = [], nrm = [], col = [];
  const push = (x, z, c) => { pos.push(x, 0, z); nrm.push(0, 1, 0); col.push(c[0], c[1], c[2], c[3]); };
  for (let i = 0; i < st.length - 1; i++) {
    const [x0, f0, b0] = st[i], [x1, f1, b1] = st[i + 1];
    const cf0 = colAt(x0, true), cb0 = colAt(x0, false), cf1 = colAt(x1, true), cb1 = colAt(x1, false);
    push(x0, f0, cf0); push(x1, f1, cf1); push(x0, b0, cb0);
    push(x0, b0, cb0); push(x1, f1, cf1); push(x1, b1, cb1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  return g;
}

/** 把若干几何体合并成一个带顶点色的非索引几何体 */
function mergeTinted(list) {
  const pos = [], nrm = [], col = [];
  for (const { geo, color, matrix } of list) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (matrix) g.applyMatrix4(matrix);
    const p = g.attributes.position, n = g.attributes.normal;
    const own = color === undefined ? g.attributes.color : null; // 没给 color 时沿用几何体自带的顶点色
    const c = new THREE.Color(own ? 0xffffff : color);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      if (own) col.push(own.getX(i), own.getY(i), own.getZ(i));
      else col.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** 蜻蜓身体（头朝 +Z）：深色大复眼的头 + 粗一点的胸 + 细长、一节一节的红褐色腹部 */
function dragonflyBodyGeometry() {
  const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  const parts = [];
  const thorax = new THREE.SphereGeometry(0.02, 10, 8);
  thorax.scale(1, 1, 1.9);
  parts.push({ geo: thorax, color: 0x8a3220, matrix: T(0, 0, 0.05) });
  parts.push({ geo: new THREE.SphereGeometry(0.014, 8, 6), color: 0x6e2a1c, matrix: T(0, 0.002, 0.094) });
  for (const s of [1, -1]) parts.push({ geo: new THREE.SphereGeometry(0.0125, 8, 6), color: 0x2a2422, matrix: T(0.011 * s, 0.006, 0.1) });
  // 腹部 7 节：逐节变细，深浅交替，节间略收
  const N = 7, z0 = 0.018, len = 0.24;
  for (let i = 0; i < N; i++) {
    const seg = len / N;
    const r0 = 0.0105 - 0.0045 * (i / N), r1 = 0.0105 - 0.0045 * ((i + 1) / N);
    const g = new THREE.CylinderGeometry(r0, r1 * 0.9, seg * 0.94, 6);
    g.rotateX(-Math.PI / 2); // 顶面(r0) 朝 +Z
    parts.push({ geo: g, color: i % 2 === 0 ? 0xa6402a : 0x86301e, matrix: T(0, 0, z0 - seg * (i + 0.5)) });
  }
  return mergeTinted(parts);
}

/** 蝴蝶身体（头朝 +Z）：深色的小梭形身体 + 头 */
function butterflyBodyGeometry() {
  const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  const body = new THREE.SphereGeometry(0.01, 8, 6);
  body.scale(1, 1, 5.4);
  return mergeTinted([
    { geo: body, color: 0x3a2a22, matrix: T(0, 0, 0.0) },
    { geo: new THREE.SphereGeometry(0.011, 8, 6), color: 0x2e211b, matrix: T(0, 0.002, 0.058) },
  ]);
}

// 蝴蝶品种（外缘色）；翅根统一是暖金色
const BUTTERFLY_COLORS = [0x6b3fc4, 0x3d7fd6, 0xe0562c, 0xd2478f, 0x8a3fb0, 0x2f9a8a, 0xf0e9d2];

const KIND_LIMITS = {
  butterfly: { minH: 0.3, maxH: 1.6, rmax: RMAX },
  bee: { minH: 0.35, maxH: 1.2, rmax: RMAX },
  dragonfly: { minH: 0.28, maxH: 1.8, rmax: RMAX },
  firefly: { minH: 0.3, maxH: 1.9, rmax: RMAX_FF },
};

/** 平面扇形几何（点为 [x, z]，首点为枢轴，法线朝上，DoubleSide 使用） */
function fanGeometry(pts) {
  const pos = [];
  const nrm = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[0], b = pts[i], c = pts[i + 1];
    pos.push(a[0], 0, a[1], b[0], 0, b[1], c[0], 0, c[1]);
    nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/** 沿 +Z 的圆柱（rTop 在 +Z 端，即头部） */
function bodyCylinder(rTop, rBot, len, seg) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg);
  g.rotateX(Math.PI / 2); // +Y -> +Z
  return g;
}

/** 蜜蜂身体：黄色椭球 + 两道黑色环带（顶点色） */
function beeBodyGeometry() {
  // 熊蜂造型（头朝 +Z）：黑色小头 + 毛茸茸的黄色胸部（背上一块深色）+ 圆鼓鼓的黄黑条纹腹部（尾尖深色）+ 两条垂着的后腿
  // 顶点色按线性空间给值
  const YEL = [0.86, 0.5, 0.05], BLK = [0.035, 0.026, 0.02], OCH = [0.62, 0.33, 0.04];
  const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  const tint = (g, fn) => {
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) col.set(fn(pos.getX(i), pos.getY(i), pos.getZ(i)), i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  // 腹部：z 从 +0.045（接胸）到 -0.058（尾尖）
  const abd = new THREE.SphereGeometry(0.034, 14, 10);
  abd.scale(1, 0.92, 1.5);
  tint(abd, (x, y, z) => {
    const t = z / 0.051; // -1 尾 .. 1 头
    if (t < -0.72) return BLK;
    if (t < -0.42) return YEL;
    if (t < -0.12) return BLK;
    if (t < 0.22) return YEL;
    if (t < 0.5) return BLK;
    return OCH;
  });
  // 胸部：毛茸茸的黄色，背部中央一块深色
  const tho = new THREE.SphereGeometry(0.03, 12, 10);
  tho.scale(1.05, 1, 1.1);
  tint(tho, (x, y, z) => (y > 0.012 && Math.abs(x) < 0.016 && Math.abs(z) < 0.02 ? BLK : YEL));
  const leg = () => {
    const g = new THREE.CylinderGeometry(0.0045, 0.003, 0.04, 5);
    g.rotateX(0.5);
    return g;
  };
  return mergeTinted([
    { geo: abd, matrix: T(0, 0, -0.03) },
    { geo: tho, matrix: T(0, 0.004, 0.042) },
    { geo: new THREE.SphereGeometry(0.02, 10, 8), color: 0x231a15, matrix: T(0, 0, 0.082) },
    { geo: leg(), color: 0x231a15, matrix: T(0.02, -0.035, -0.012) },
    { geo: leg(), color: 0x231a15, matrix: T(-0.02, -0.035, -0.012) },
  ]);
}

export function createCritters(ctx) {
  const rng = typeof ctx.rng === 'function' ? ctx.rng : mulberry32(20240607);
  const island = ctx.island || null;
  const anchors = (island && island.anchors) || {};

  // 花丛与池塘（只读 anchors，不硬编码）
  // 真实的花头位置（小岛模块提供；没有时退回到“花丛中心 + 固定高度”）
  const heads = island && Array.isArray(island.flowerHeads) ? island.flowerHeads : [];
  const _cand = [];
  /** 在 (x,z) 周围 maxR 内随机挑一朵花，返回花头 {x,z,top} 或 null */
  function pickHead(x, z, maxR) {
    _cand.length = 0;
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const dx = h.x - x, dz = h.z - z;
      if (dx * dx + dz * dz <= maxR * maxR) _cand.push(h);
    }
    return _cand.length ? _cand[Math.floor(rng() * _cand.length)] : null;
  }
  const flowers = [];
  if (Array.isArray(anchors.flowerSpots)) for (const v of anchors.flowerSpots) flowers.push({ x: v.x, z: v.z });
  if (flowers.length === 0) {
    for (let i = 0; i < 6; i++) flowers.push({ x: Math.cos((i / 6) * TAU) * 4, z: Math.sin((i / 6) * TAU) * 4 });
  }
  let cx = 0, cz = 0;
  for (const f of flowers) { cx += f.x; cz += f.z; }
  cx /= flowers.length; cz /= flowers.length;
  const pa = anchors.pond;
  const pond = pa && Number.isFinite(pa.r)
    ? { x: pa.x, z: pa.z, r: Math.max(0.5, pa.r) }
    : { x: cx, z: cz, r: 1.0 };

  const group = new THREE.Group();
  group.name = 'critters';

  const groundY = (x, z) => {
    if (!island || typeof island.heightAt !== 'function') return 0;
    const h = island.heightAt(x, z);
    return Number.isFinite(h) ? h : 0;
  };

  // 数量
  const NB = 3 + Math.floor(rng() * 3); // 蝴蝶 3..5
  const NBEE = 2 + Math.floor(rng() * 2); // 蜜蜂 2..3
  const ND = 1 + Math.floor(rng() * 2); // 蜻蜓 1..2
  const NF = 10 + Math.floor(rng() * 7); // 萤火虫 10..16

  // ---- 网格（每类 1–2 个 draw call）----
  const mk = (geo, mat, count) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.frustumCulled = false; // 实例分布在全岛，包围球不可靠
    m.castShadow = false;
    m.receiveShadow = false;
    group.add(m);
    return m;
  };
  const M = {};
  // 蝴蝶翅膀：翅根金黄 → 外缘品种色（instanceColor）→ 深色镶边
  // 翅膀用不受光的材质：薄片在受光下一面亮一面死黑，很难看；亮度改由 update 里按昼夜/阴晴整体调节
  const bflyWingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  bflyWingMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', `attribute float aK;
void main() {`)
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz = mix(vec3(1.0, 0.56, 0.07), instanceColor.xyz, smoothstep(0.22, 0.72, aK)) * (1.0 - 0.55 * smoothstep(0.84, 1.0, aK));
        #endif`,
      );
  };
  bflyWingMat.customProgramCacheKey = () => 'bflyWing';
  M.bflyWing = mk(butterflyWingGeometry([BFLY_FORE, BFLY_HIND]), bflyWingMat, 2 * NB);
  M.bflyBody = mk(butterflyBodyGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 }), NB);
  M.bee = mk(beeBodyGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 }), NBEE);
  // 琥珀色半透明的翅膀，向后斜张；不受光（薄片受光会一面发黑）
  M.beeWing = mk(fanGeometry(BEE_WING), new THREE.MeshBasicMaterial({ color: 0xe9c88f, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }), 2 * NBEE);
  M.dfBody = mk(dragonflyBodyGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 }), ND);
  M.dfWing = mk(dragonflyWingGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }), 4 * ND);
  M.ffCore = mk(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), NF);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  // 光晕做成中心亮、边缘渐隐的柔光球（否则近看是一个个有硬边的绿球）
  haloMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', `varying float vHalo;
void main() {`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 hn = vec4(position, 0.0);
          #ifdef USE_INSTANCING
            hn = instanceMatrix * hn;
          #endif
          vec3 hN = normalize((modelViewMatrix * hn).xyz);
          vHalo = pow(max(dot(hN, normalize(-mvPosition.xyz)), 0.0), 2.6);
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `varying float vHalo;
void main() {`)
      .replace('#include <opaque_fragment>', `outgoingLight *= vHalo;
#include <opaque_fragment>`);
  };
  M.ffHalo = mk(new THREE.SphereGeometry(0.16, 16, 12), haloMat, NF);

  // ---- 状态 ----
  const targets = [];
  let time = 0;
  let wasRainy = false;
  let rainEndedAt = -1e9;

  function randFlowerIndex(avoid) {
    const n = flowers.length;
    let i = Math.floor(rng() * n);
    if (i === avoid && n > 1) i = (i + 1) % n;
    return i;
  }

  function clampRadius(v, rmax) {
    const r = Math.sqrt(v.x * v.x + v.z * v.z);
    if (r > rmax) {
      const f = rmax / r;
      v.x *= f;
      v.z *= f;
    }
  }

  function pickButterflyTarget(ins) {
    const i = randFlowerIndex(ins.spot);
    ins.spot = i;
    const s = flowers[i];
    const a = rng() * TAU;
    ins.willPerch = rng() < 0.72;
    // 歇脚点：多数落在花上，有时落在花丛旁边的草叶上（低一些）
    ins.onGrass = ins.willPerch && rng() < 0.3;
    const r = ins.onGrass ? 0.6 + rng() * 1.0 : rng() * 0.5;
    ins.target.set(s.x + Math.cos(a) * r, 0, s.z + Math.sin(a) * r);
    clampRadius(ins.target, RMAX - 0.4);
    ins.target.y = groundY(ins.target.x, ins.target.z) + (ins.willPerch ? (ins.onGrass ? 0.3 : 0.42) : rand(rng, 0.6, 1.3));
    if (ins.willPerch && !ins.onGrass) {
      const h = pickHead(s.x, s.z, 1.4);
      if (h) ins.target.set(h.x, h.top + 0.025, h.z);
    }
    ins.refX = s.x;
    ins.refZ = s.z;
    ins.timer = 12; // 超时保护
  }

  // 蜜蜂只在“自家”花丛和它附近的花丛之间活动，不横跨整个画面
  const BEE_HOP = 3.6; // 相邻花丛的最大距离
  function beePatch(ins) {
    if (ins.patch) return ins.patch;
    // 每只蜜蜂分到不同的家（尽量错开）
    const taken = bees.map((b) => b.home).filter((h) => h !== undefined);
    let home = Math.floor(rng() * flowers.length);
    for (let t = 0; t < flowers.length && taken.includes(home); t++) home = (home + 1) % flowers.length;
    ins.home = home;
    ins.patch = [];
    for (let i = 0; i < flowers.length; i++) {
      if (Math.hypot(flowers[i].x - flowers[home].x, flowers[i].z - flowers[home].z) <= BEE_HOP) ins.patch.push(i);
    }
    return ins.patch;
  }
  function pickBeeSpot(ins) {
    const patch = beePatch(ins);
    let i = patch[Math.floor(rng() * patch.length)];
    if (i === ins.spot && patch.length > 1) i = patch[(patch.indexOf(i) + 1) % patch.length];
    ins.spot = i;
    // 在这丛花的范围内换一朵（小幅偏移），停得久一点
    const h = pickHead(flowers[i].x, flowers[i].z, 1.4);
    if (h) { ins.refX = h.x; ins.refZ = h.z; ins.refY = h.top; }
    else {
      ins.refX = flowers[i].x + rand(rng, -0.45, 0.45);
      ins.refZ = flowers[i].z + rand(rng, -0.45, 0.45);
      ins.refY = groundY(ins.refX, ins.refZ) + 0.4;
    }
    ins.timer = rand(rng, 4, 9);
  }

  function pickFireflyTarget(ins) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * (RMAX_FF - 0.6);
    ins.target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    ins.target.y = groundY(ins.target.x, ins.target.z) + rand(rng, 0.5, 1.5);
    ins.timer = rand(rng, 4, 8);
  }

  function pondPoint(out, rFactor) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * pond.r * rFactor;
    out.x = pond.x + Math.cos(a) * r;
    out.z = pond.z + Math.sin(a) * r;
    out.y = groundY(out.x, out.z) + rand(rng, 0.7, 1.3) * (1 - 0.55 * lowFly); // 天阴气压低：贴着水面飞
  }

  let lowFly = 0; // 0..1：天越阴，蜻蜓飞得越低

  /** 重新出现时的位置（仅在 presence < 0.05，即不可见时调用） */
  function respawn(ins) {
    switch (ins.kind) {
      case 'butterfly': {
        const i = randFlowerIndex(-1);
        const s = flowers[i];
        ins.spot = i;
        ins.position.set(s.x, groundY(s.x, s.z) + rand(rng, 0.6, 1.2), s.z);
        ins.vel.set(0, 0, 0);
        ins.heading = rng() * TAU;
        ins.state = 'fly';
        pickButterflyTarget(ins);
        break;
      }
      case 'bee': {
        pickBeeSpot(ins);
        ins.position.set(ins.refX, groundY(ins.refX, ins.refZ) + 0.55, ins.refZ);
        ins.vel.set(0, 0, 0);
        ins.state = 'hover';
        break;
      }
      case 'dragonfly': {
        pondPoint(ins.position, 1.0);
        ins.target.copy(ins.position);
        ins.vel.set(0, 0, 0);
        ins.state = 'hover';
        ins.timer = rand(rng, 1, 2.5);
        break;
      }
      case 'firefly': {
        const a = rng() * TAU;
        const r = Math.sqrt(rng()) * (RMAX_FF - 0.6);
        ins.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        ins.position.y = groundY(ins.position.x, ins.position.z) + rand(rng, 0.5, 1.5);
        ins.vel.set(0, 0, 0);
        ins.state = 'drift';
        pickFireflyTarget(ins);
        break;
      }
    }
  }

  function makeInsect(kind, k) {
    const ins = {
      id: targets.length,
      kind,
      k, // 该类内部序号（InstancedMesh 下标）
      lim: KIND_LIMITS[kind],
      position: new THREE.Vector3(),
      active: false,
      chaseable: kind === 'butterfly',
      size: kind === 'butterfly' ? 1.0 : kind === 'dragonfly' ? 0.95 : kind === 'bee' ? 0.9 : 1, // 视觉尺寸系数（造型本身已按“小而精致”的比例设计）
      vel: new THREE.Vector3(),
      target: new THREE.Vector3(),
      qb: new THREE.Quaternion(),
      heading: rng() * TAU,
      pitch: 0,
      roll: 0,
      presence: 0,
      hidden: true,
      delay: rng() * 4,
      state: 'fly',
      timer: 0,
      spot: -1,
      willPerch: false,
      refX: 0,
      refZ: 0,
      ph: rng() * TAU,
      ph2: rng() * TAU,
      cruise: kind === 'butterfly' ? rand(rng, 0.75, 1.0) : rand(rng, 0.9, 1.1),
      color: BUTTERFLY_COLORS[(k + Math.floor(rng() * BUTTERFLY_COLORS.length)) % BUTTERFLY_COLORS.length],
      // 翅膀运动（当前值向目标值阻尼）
      flapPhase: rng() * TAU,
      wRate: 0, wAmp: 0, wBias: 0,
      tRate: 0, tAmp: 0, tBias: 0,
      startleEnd: 0,
      freq: rand(rng, 1.1, 1.9),
    };
    if (kind === 'butterfly') { ins.tRate = TAU * 3.2; ins.tAmp = 0.85; ins.tBias = 0.1; }
    if (kind === 'bee') { ins.tRate = 50; ins.tAmp = 0.6; ins.tBias = 0.15; }
    if (kind === 'dragonfly') { ins.tRate = 60; ins.tAmp = 0.03; ins.tBias = 0.08; }
    ins.wRate = ins.tRate; ins.wAmp = ins.tAmp; ins.wBias = ins.tBias;
    targets.push(ins);
    return ins;
  }

  const butterflies = [];
  const bees = [];
  const dragonflies = [];
  const fireflies = [];
  for (let i = 0; i < NB; i++) butterflies.push(makeInsect('butterfly', i));
  for (let i = 0; i < NBEE; i++) bees.push(makeInsect('bee', i));
  for (let i = 0; i < ND; i++) dragonflies.push(makeInsect('dragonfly', i));
  for (let i = 0; i < NF; i++) fireflies.push(makeInsect('firefly', i));

  // 蝴蝶翅膀颜色（每只两片同色）与蜻蜓翅膀色调（一次性写入）
  for (const b of butterflies) {
    _c1.setHex(b.color);
    M.bflyWing.setColorAt(2 * b.k, _c1);
    M.bflyWing.setColorAt(2 * b.k + 1, _c1);
  }
  M.bflyWing.instanceColor.needsUpdate = true;

  // ---- 行为 ----
  /** 朝 tg 加速（带侧向游走）；返回到目标的距离 */
  function seek(ins, tg, maxSpeed, accel, wander, dt) {
    const P = ins.position, V = ins.vel;
    const dx = tg.x - P.x, dy = tg.y - P.y, dz = tg.z - P.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const sp = Math.min(maxSpeed, d * 1.5);
    const k = d > 1e-5 ? sp / d : 0;
    const t = time;
    const wx = wander * (Math.sin(t * 1.1 + ins.ph) + 0.5 * Math.sin(t * 2.3 + ins.ph2));
    const wz = wander * (Math.cos(t * 0.9 + ins.ph2) + 0.5 * Math.sin(t * 1.9 + ins.ph));
    const wy = wander * 0.5 * Math.sin(t * 2.6 + ins.ph);
    const kk = 1 - Math.exp(-accel * dt);
    V.x += (dx * k + wx - V.x) * kk;
    V.y += (dy * k + wy - V.y) * kk;
    V.z += (dz * k + wz - V.z) * kk;
    const cap = maxSpeed * 1.4 + wander;
    const sv = Math.sqrt(V.x * V.x + V.y * V.y + V.z * V.z);
    if (sv > cap) {
      const f = cap / sv;
      V.x *= f; V.y *= f; V.z *= f;
    }
    P.x += V.x * dt;
    P.y += V.y * dt;
    P.z += V.z * dt;
    return d;
  }

  /** 限制水平半径与高度（不钻地、不飞出岛） */
  function confine(ins) {
    const P = ins.position, V = ins.vel, lim = ins.lim;
    const r = Math.sqrt(P.x * P.x + P.z * P.z);
    if (r > lim.rmax) {
      const f = lim.rmax / r;
      P.x *= f;
      P.z *= f;
      const dot = (V.x * P.x + V.z * P.z) / (lim.rmax * lim.rmax);
      if (dot > 0) {
        V.x -= dot * P.x;
        V.z -= dot * P.z;
      }
    }
    const g = groundY(P.x, P.z);
    const maxH = ins.state === 'flee' ? lim.maxH + 0.8 : lim.maxH;
    const lo = g + lim.minH, hi = g + maxH;
    if (P.y < lo) {
      P.y = lo;
      if (V.y < 0) V.y = 0;
    } else if (P.y > hi) {
      P.y = hi;
      if (V.y > 0) V.y = 0;
    }
  }

  function afterFlee(ins) {
    switch (ins.kind) {
      case 'butterfly': ins.state = 'fly'; pickButterflyTarget(ins); break;
      case 'bee': ins.state = 'hover'; pickBeeSpot(ins); break;
      case 'dragonfly': ins.state = 'hover'; ins.target.copy(ins.position); ins.timer = rand(rng, 1, 2); ins.dartsLeft = 2; ins.tRate = 60; ins.tAmp = 0.03; ins.tBias = 0.08; break;
      case 'firefly': ins.state = 'drift'; pickFireflyTarget(ins); break;
    }
  }

  function stepButterfly(ins, dt) {
    if (ins.state === 'fly') {
      ins.tRate = TAU * 3.2; ins.tAmp = 0.85; ins.tBias = 0.1;
      // 该歇了：改飞向一个落脚点
      if (ins.retire && !ins.willPerch) { for (let t = 0; t < 8 && !ins.willPerch; t++) pickButterflyTarget(ins); ins.willPerch = true; }
      const d = seek(ins, ins.target, ins.cruise, 1.6, 0.22, dt);
      const dy = Math.abs(ins.target.y - ins.position.y);
      ins.timer -= dt;
      if (d < 0.45 && dy < 0.4) {
        if (ins.willPerch) { ins.state = 'perch'; ins.timer = rand(rng, 5, 13); ins.bask = rng() < 0.55; ins.baskT = rand(rng, 2, 5); }
        else pickButterflyTarget(ins);
      } else if (ins.timer <= 0) pickButterflyTarget(ins);
    } else if (ins.state === 'perch') {
      // 歇息：要么摊开翅膀晒太阳（缓缓开合），要么把翅膀合拢竖在背上；隔几秒换一种姿态
      ins.baskT -= dt;
      if (ins.baskT <= 0) { ins.bask = !ins.bask; ins.baskT = rand(rng, 2.5, 6); }
      if (ins.retire) ins.bask = false; // 要休息了：翅膀合拢
      if (ins.bask) { ins.tRate = TAU * 0.3; ins.tAmp = 0.22; ins.tBias = 0.28; }
      else { ins.tRate = TAU * 0.2; ins.tAmp = 0.05; ins.tBias = 1.32; }
      const P = ins.position, V = ins.vel, T = ins.target;
      const k = 1 - Math.exp(-4 * dt);
      P.x += (T.x - P.x) * k;
      P.z += (T.z - P.z) * k;
      P.y += (T.y - P.y) * k;
      V.multiplyScalar(Math.exp(-6 * dt));
      ins.timer -= dt;
      if (ins.timer <= 0 && !ins.retire) {
        ins.state = 'fly';
        pickButterflyTarget(ins);
        V.y = 0.3;
      }
    } else { // flee
      ins.tRate = TAU * 5.5; ins.tAmp = 0.95; ins.tBias = 0.2;
      seek(ins, ins.target, 1.8, 4, 0.1, dt);
      ins.timer -= dt;
      if (ins.timer <= 0) afterFlee(ins);
    }
  }

  function stepBee(ins, dt) {
    if (ins.state === 'hover') {
      const th = time * 2.4 + ins.ph;
      const R = 0.24;
      const hgt = (ins.refY === undefined ? groundY(ins.refX, ins.refZ) + 0.4 : ins.refY) + 0.17 + Math.sin(time * 3 + ins.ph) * 0.04;
      ins.target.set(ins.refX + Math.cos(th) * R, hgt, ins.refZ + Math.sin(th) * R);
      ins.tRate = 50; ins.tAmp = 0.6; ins.tBias = 0.15;
      seek(ins, ins.target, 1.2, 8, 0.02, dt);
      ins.timer -= dt;
      if (ins.timer <= 0 || ins.retire) { ins.state = 'feed'; ins.timer = rand(rng, 3.5, 8); }
    } else if (ins.state === 'feed') {
      // 落在花上采蜜：翅膀收拢不扇，身体在花心上小幅爬动
      ins.tRate = 4; ins.tAmp = 0.02; ins.tBias = -0.05;
      const th = time * 0.9 + ins.ph;
      const P = ins.position, V = ins.vel;
      const k = 1 - Math.exp(-5 * dt);
      const fy = (ins.refY === undefined ? groundY(ins.refX, ins.refZ) + 0.4 : ins.refY) + 0.03; // 趴在花头上
      P.x += (ins.refX + Math.cos(th) * 0.02 - P.x) * k;
      P.z += (ins.refZ + Math.sin(th) * 0.02 - P.z) * k;
      P.y += (fy - P.y) * k;
      V.multiplyScalar(Math.exp(-8 * dt));
      ins.heading += dt * 0.9; // 边爬边慢慢转身
      ins.timer -= dt;
      if (ins.timer <= 0 && !ins.retire) { pickBeeSpot(ins); ins.state = 'hover'; ins.timer = rand(rng, 1.4, 3); V.y = 0.35; }
    } else { // flee
      seek(ins, ins.target, 1.8, 4, 0.1, dt);
      ins.timer -= dt;
      if (ins.timer <= 0) afterFlee(ins);
    }
  }

  function stepDragonfly(ins, dt) {
    if (ins.retire && (ins.state === 'hover' || ins.state === 'dart')) { ins.dartsLeft = 0; ins.timer = 0; if (ins.state === 'hover') { ins.state = 'dart'; ins.target.copy(ins.position); } }
    if (ins.state === 'hover') {
      seek(ins, ins.target, 0.25, 3, 0.05, dt);
      ins.timer -= dt;
      if (ins.timer <= 0) {
        // 急冲到池塘上方另一点
        pondPoint(ins.target, 1.5);
        ins.state = 'dart';
        ins.timer = 2;
      }
    } else if (ins.state === 'dart') {
      const d = seek(ins, ins.target, 3.0, 9, 0.08, dt);
      ins.timer -= dt;
      if (d < 0.15 || ins.timer <= 0) {
        ins.dartsLeft = (ins.dartsLeft === undefined ? 2 : ins.dartsLeft) - 1;
        if (ins.dartsLeft <= 0) {
          // 飞累了：落到池边的香蒲上
          const ang = ((195 + 40 * Math.floor(rng() * 3)) * Math.PI) / 180 + (rng() - 0.5) * 0.25;
          const pr = pond.r + 0.1;
          ins.target.set(pond.x + Math.cos(ang) * pr, 0, pond.z + Math.sin(ang) * pr);
          ins.target.y = groundY(ins.target.x, ins.target.z) + 0.92;
          ins.state = 'toPerch';
          ins.timer = 4;
        } else {
          ins.state = 'hover';
          ins.target.copy(ins.position);
          ins.timer = rand(rng, 0.8, 2.2);
        }
      }
    } else if (ins.state === 'toPerch') {
      const d = seek(ins, ins.target, 1.6, 6, 0.03, dt);
      ins.timer -= dt;
      if (d < 0.12 || ins.timer <= 0) { ins.state = 'perch'; ins.timer = rand(rng, 6, 15); }
    } else if (ins.state === 'perch') {
      // 停在香蒲上：翅膀平展不动，偶尔轻轻抖一下
      ins.tRate = 30; ins.tAmp = Math.sin(time * 0.7 + ins.ph) > 0.96 ? 0.03 : 0.0; ins.tBias = 0.02;
      const P = ins.position, V = ins.vel, T = ins.target;
      const k = 1 - Math.exp(-5 * dt);
      P.x += (T.x - P.x) * k; P.y += (T.y - P.y) * k; P.z += (T.z - P.z) * k;
      V.multiplyScalar(Math.exp(-8 * dt));
      ins.timer -= dt;
      if (ins.timer <= 0 && !ins.retire) {
        ins.tRate = 60; ins.tAmp = 0.03; ins.tBias = 0.08;
        ins.dartsLeft = 2 + Math.floor(rng() * 3);
        pondPoint(ins.target, 1.5);
        ins.state = 'dart';
        ins.timer = 2;
        V.y = 0.5;
      }
    } else { // flee
      seek(ins, ins.target, 3.0, 6, 0.1, dt);
      ins.timer -= dt;
      if (ins.timer <= 0) afterFlee(ins);
    }
  }

  function stepFirefly(ins, dt) {
    if (ins.state === 'drift') {
      const d = seek(ins, ins.target, 0.35, 1.2, 0.05, dt);
      ins.timer -= dt;
      if (d < 0.2 || ins.timer <= 0) {
        if (rng() < 0.4) {
          ins.state = 'rest';
          ins.target.set(ins.position.x, groundY(ins.position.x, ins.position.z) + 0.22 + rng() * 0.12, ins.position.z);
          ins.timer = rand(rng, 5, 12);
        } else pickFireflyTarget(ins);
      }
    } else if (ins.state === 'rest') {
      const P = ins.position, V = ins.vel, T = ins.target;
      const k = 1 - Math.exp(-1.6 * dt);
      P.x += (T.x - P.x) * k; P.y += (T.y - P.y) * k; P.z += (T.z - P.z) * k;
      V.multiplyScalar(Math.exp(-5 * dt));
      ins.timer -= dt;
      if (ins.timer <= 0) { ins.state = 'drift'; pickFireflyTarget(ins); }
    } else { // flee
      seek(ins, ins.target, 1.2, 3, 0.1, dt);
      ins.timer -= dt;
      if (ins.timer <= 0) afterFlee(ins);
    }
  }

  /** 身体朝向：偏航朝速度方向，俯仰随爬升/下降，转弯时侧倾 */
  function orient(ins, dt) {
    const V = ins.vel;
    const hs = Math.sqrt(V.x * V.x + V.z * V.z);
    if (hs > 0.03) {
      const th = Math.atan2(V.x, V.z);
      const delta = angleDiff(ins.heading, th);
      ins.heading = dampAngle(ins.heading, th, 6, dt);
      ins.roll = damp(ins.roll, clamp(-delta * 0.8, -0.45, 0.45), 3, dt);
    } else {
      ins.roll = damp(ins.roll, 0, 3, dt);
    }
    const pitch = clamp(-Math.atan2(V.y, Math.max(hs, 1e-3)) * 0.8, -0.6, 0.6);
    ins.pitch = damp(ins.pitch, pitch, 4, dt);
    _eu.set(ins.pitch, ins.heading, ins.roll, 'YXZ');
    ins.qb.setFromEuler(_eu);
  }

  // ---- 矩阵写入（T * R * S，不分配对象）----
  function writeBody(mesh, idx, ins, scale) {
    _s.set(scale, scale, scale);
    _m.compose(ins.position, ins.qb, _s);
    mesh.setMatrixAt(idx, _m);
  }

  /** 翅膀：枢轴跟随身体，绕身体前后轴(Z)拍动；mirror 为左翅（镜像，角度取反，保证左右对称） */
  function writeWing(mesh, idx, ins, piv, flap, mirror) {
    const p = ins.presence * ins.size;
    _p.set(piv.x * p, piv.y * p, piv.z * p).applyQuaternion(ins.qb).add(ins.position);
    _qf.setFromAxisAngle(AXIS_Z, mirror ? -flap : flap);
    _qw.copy(ins.qb).multiply(_qf);
    _s.set(mirror ? -p : p, p, p);
    _m.compose(_p, _qw, _s);
    mesh.setMatrixAt(idx, _m);
  }

  function dayOk(kind, env, ins) {
    const h = env.hour;
    switch (kind) {
      case 'butterfly': return h >= 6.5 && h <= 17.5;
      case 'bee': return (env.weather === 'clear' || env.weather === 'cloudy') && h >= 7 && h <= 18 && (env.cloudiness < 0.55 || (ins && ins.k === 0)); // 天阴下来蜜蜂大多回巢，只留一只还在忙
      case 'dragonfly': return h >= 15.5 && h <= 19;
      case 'firefly': return h >= 19 || h < 4.5;
    }
    return false;
  }

  function update(dt, env) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    time += dt;

    lowFly = smoothstep(0.4, 0.75, env.cloudiness);
    // 狗的位置（受惊检测用）；狗在睡觉/趴着时不吓虫
    const dg = ctx.dog;
    const dogPos = dg && dg.group && dg.action !== 'sleep' && dg.action !== 'lie' && dg.action !== 'sit' ? dg.group.position : null;
    const scareR = 0.75 + 0.22 * Math.min(Math.abs((dg && dg.speed) || 0), 3.6);

    // 翅膀亮度跟随环境（白天正常，清晨黄昏偏暗偏暖，阴天略暗）
    const wingLum = (0.5 + 0.5 * clamp(env.dayFactor, 0, 1)) * (1 - 0.18 * clamp(env.cloudiness, 0, 1));
    const warm = clamp(env.sunsetFactor, 0, 1);
    M.bflyWing.material.color.setRGB(wingLum, wingLum * (1 - 0.1 * warm), wingLum * (1 - 0.25 * warm));
    M.dfWing.material.color.copy(M.bflyWing.material.color);

    const rainy =!!(env.isRaining || env.weather === 'rain' || env.weather === 'storm');
    if (rainy !== wasRainy) {
      if (!rainy) rainEndedAt = time;
      wasRainy = rainy;
    }

    for (let n = 0; n < targets.length; n++) {
      const ins = targets[n];
      const want = !rainy && dayOk(ins.kind, env, ins) && time - rainEndedAt >= RAIN_WAIT + ins.delay;

      // 出现 / 消失的平滑过渡
      let goal = want ? 1 : 0;
      // 到点该走了（不是因为下雨）：先飞到花/草/香蒲上落脚歇好，再慢慢隐去；最多等 10 秒
      ins.retire = false;
      if (!want && !rainy && !ins.hidden && ins.kind !== 'firefly') {
        ins.retire = true;
        ins.retireT = (ins.retireT || 0) + dt;
        const settled = ins.state === 'perch' || ins.state === 'feed';
        if (!settled && ins.retireT < 10) goal = 1;
      } else ins.retireT = 0;
      ins.presence = clamp(damp(ins.presence, goal, want ? 0.9 : ins.retire ? 0.7 : 1.3, dt), 0, 1);
      if (Math.abs(ins.presence - goal) < 1e-3) ins.presence = goal;
      if (ins.presence < 0.05) {
        if (want) {
          if (ins.hidden) { respawn(ins); ins.hidden = false; }
        } else ins.hidden = true;
      }
      ins.active = ins.presence >= 0.05;

      if (ins.startleEnd > 0 && time >= ins.startleEnd) {
        ins.startleEnd = 0;
        ins.chaseable = ins.kind === 'butterfly';
      }

      // 狗走近时惊飞：停着或飞得很低的昆虫，狗跑得越快越早被吓到
      const stalked = ins.stalked === true; ins.stalked = false;
      if (dogPos && !stalked && ins.state !== 'flee' && time > ins.startleEnd && ins.kind !== 'firefly') {
        const ddx = ins.position.x - dogPos.x, ddz = ins.position.z - dogPos.z;
        const low = ins.position.y - dogPos.y < 1.3;
        if (low && ddx * ddx + ddz * ddz < scareR * scareR) scareFrom(ins, dogPos);
      }
      switch (ins.kind) {
        case 'butterfly': stepButterfly(ins, dt); break;
        case 'bee': stepBee(ins, dt); break;
        case 'dragonfly': stepDragonfly(ins, dt); break;
        case 'firefly': stepFirefly(ins, dt); break;
      }
      confine(ins);
      orient(ins, dt);

      // 翅膀运动参数平滑 + 相位推进
      ins.wRate = damp(ins.wRate, ins.tRate, 4, dt);
      ins.wAmp = damp(ins.wAmp, ins.tAmp, 4, dt);
      ins.wBias = damp(ins.wBias, ins.tBias, 4, dt);
      ins.flapPhase += ins.wRate * dt;
      const flap = ins.wBias + ins.wAmp * Math.sin(ins.flapPhase);
      const p = ins.presence * ins.size;

      switch (ins.kind) {
        case 'butterfly':
          writeBody(M.bflyBody, ins.k, ins, p);
          writeWing(M.bflyWing, 2 * ins.k, ins, PIV_BUTTERFLY, flap, false);
          writeWing(M.bflyWing, 2 * ins.k + 1, ins, PIV_BUTTERFLY, flap, true);
          break;
        case 'bee':
          writeBody(M.bee, ins.k, ins, p);
          writeWing(M.beeWing, 2 * ins.k, ins, PIV_BEE, flap, false);
          writeWing(M.beeWing, 2 * ins.k + 1, ins, PIV_BEE, flap, true);
          break;
        case 'dragonfly':
          writeBody(M.dfBody, ins.k, ins, p);
          writeWing(M.dfWing, 4 * ins.k, ins, PIV_DF_FORE, flap, false);
          writeWing(M.dfWing, 4 * ins.k + 1, ins, PIV_DF_FORE, flap, true);
          writeWing(M.dfWing, 4 * ins.k + 2, ins, PIV_DF_HIND, flap, false);
          writeWing(M.dfWing, 4 * ins.k + 3, ins, PIV_DF_HIND, flap, true);
          break;
        case 'firefly': {
          // 呼吸明暗（按各自相位）；加色混合，颜色即亮度
          const b0 = 0.5 + 0.5 * Math.sin(time * ins.freq + ins.ph);
          const b = b0 * b0 * b0;
          const inten = (0.15 + 0.85 * b) * p;
          _c1.setHex(palette.firefly).multiplyScalar(inten);
          _c2.setHex(palette.fireflyGlow).multiplyScalar(0.6 * inten);
          writeBody(M.ffCore, ins.k, ins, p);
          writeBody(M.ffHalo, ins.k, ins, p * 2.8);
          M.ffCore.setColorAt(ins.k, _c1);
          M.ffHalo.setColorAt(ins.k, _c2);
          break;
        }
      }
    }

    M.bflyWing.instanceMatrix.needsUpdate = true;
    M.bflyBody.instanceMatrix.needsUpdate = true;
    M.bee.instanceMatrix.needsUpdate = true;
    M.beeWing.instanceMatrix.needsUpdate = true;
    M.dfBody.instanceMatrix.needsUpdate = true;
    M.dfWing.instanceMatrix.needsUpdate = true;
    M.ffCore.instanceMatrix.needsUpdate = true;
    M.ffHalo.instanceMatrix.needsUpdate = true;
    if (M.ffCore.instanceColor) M.ffCore.instanceColor.needsUpdate = true;
    if (M.ffHalo.instanceColor) M.ffHalo.instanceColor.needsUpdate = true;
  }

  /** 被狗扑到：向上 + 远离参照点的速度冲量，4–6 秒内不可追（蝴蝶恢复；其它本就不可追） */
  /** 被走近的狗吓到：朝背离狗的方向向上飞走 */
  function scareFrom(ins, from) {
    let dx = ins.position.x - from.x, dz = ins.position.z - from.z;
    let l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1e-3) { const a = rng() * TAU; dx = Math.cos(a); dz = Math.sin(a); l = 1; }
    dx /= l; dz /= l;
    if (ins.kind === 'butterfly') ins.chaseable = false;
    ins.startleEnd = time + rand(rng, 3, 5);
    ins.state = 'flee';
    ins.timer = rand(rng, 1.8, 2.8);
    ins.vel.set(dx * 1.4, 1.5, dz * 1.4);
    ins.target.set(ins.position.x + dx * 2.2, ins.position.y + 1.2, ins.position.z + dz * 2.2);
    clampRadius(ins.target, ins.lim.rmax);
    ins.target.y = Math.max(ins.target.y, groundY(ins.target.x, ins.target.z) + 1.1);
  }

  function startle(id) {
    let ins = null;
    for (let i = 0; i < targets.length; i++) if (targets[i].id === id) { ins = targets[i]; break; }
    if (!ins || !ins.active) return;
    let dx = ins.position.x - ins.refX;
    let dz = ins.position.z - ins.refZ;
    let l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1e-3) {
      const a = rng() * TAU;
      dx = Math.cos(a); dz = Math.sin(a); l = 1;
    }
    dx /= l; dz /= l;
    ins.chaseable = false;
    ins.startleEnd = time + rand(rng, 4, 6);
    ins.state = 'flee';
    ins.timer = rand(rng, 2.2, 3.2);
    ins.vel.set(dx * 1.6, 1.8, dz * 1.6);
    ins.target.set(ins.position.x + dx * 2.5, ins.position.y + 1.4, ins.position.z + dz * 2.5);
    clampRadius(ins.target, ins.lim.rmax);
    ins.target.y = Math.max(ins.target.y, groundY(ins.target.x, ins.target.z) + 1.2);
  }

  return {
    group,
    update,
    targets,
    startle,
  };
}
