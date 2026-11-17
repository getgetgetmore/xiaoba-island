// 农场场景物件（静态，每个物件 1 个网格，原点在底面中心，正面朝本地 +Z）。
// 第三版画风：圆润的 3D 造型（球 / 椭球 / 圆柱 / 圆锥 / 圆环拼成，合并成一个带顶点色的网格）
// + 卡通分档明暗（MeshToonMaterial + 3 档渐变贴图）+ 像素化时描深色实线边（见 pixel.js）。
// 用法：const m = createFarmProp('barn'); scene.add(m);  可用种类见 FARM_PROPS。单位：世界单位（小狗约 1 单位长）。
// 窗玻璃、路灯的灯泡放在 geometry.userData.glow（另一个几何，夜里发暖光），map.js 会单独合并。
import * as THREE from 'three';
import { PAL as P, TIER as T } from './palette.js';
import { VOX } from './voxel.js';
import { farmGlowMaterial } from './lighting.js';

// ---------------------------------------------------------------- 小工具
/** 可复现的随机数（mulberry32）。 */
export function rng(seed) {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 整数坐标哈希 → [0,1)。 */
export function hash3(a, b, c = 0, s = 0) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483629) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const clamp01 = (v) => Math.max(0, Math.min(0.999, v));
const tier = (arr, v) => arr[Math.floor(clamp01(v) * arr.length)];

// ---------------------------------------------------------------- 卡通材质：明暗分 3 档
const grad = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 190, 190, 190, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter;
grad.needsUpdate = true;
/** 所有农场场景物件和地面共用的卡通材质（顶点色 + 3 档渐变）。 */
export const farmToonMaterial = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad });

// ---------------------------------------------------------------- 挡住小狗的树变半透明
// 树都合并在地块网格里，没法单独改材质，所以每棵树的顶点上带一个 aOcc = (树的 x, z, 半径, 高度)（map.js 合并时写入，别的东西是 0）。
// 顶点着色器按“这棵树”算：树根比小狗离镜头近、而且在画面上盖住了小狗 → vSee 趋近 1（整棵树同一个值，所以是整棵一起变）；
// 片元着色器按 2×2 的抖动格子丢掉一部分像素（像素画里的半透明），留下的像素把 alpha 写成 0.5 做记号，
// pixel.js 描边时看到这个记号就不把后面透出来的东西描黑。抖动格子跟着世界走（uSeeGrid），镜头平移时不会在树上爬。
// farm.js 每帧更新下面这些值。
export const farmSeeThrough = {
  uSeeOn: { value: 0 },
  uSeeDog: { value: new THREE.Vector3(0, 0, 0) },  // 小狗身体中心（世界坐标）
  uSeeR: { value: new THREE.Vector3(1, 0, 0) },    // 相机的右 / 上 / 后（朝镜头）方向
  uSeeU: { value: new THREE.Vector3(0, 1, 0) },
  uSeeB: { value: new THREE.Vector3(0, 0, 1) },
  uSeeGrid: { value: new THREE.Vector2(0, 0) },   // 镜头对齐像素格后的格子序号（pixel.js 的 onSnap 给）
  uSeeMax: { value: 0.7 },                        // 最透的时候丢掉多少像素：0.5 = 棋盘格一半
};
farmToonMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, farmSeeThrough);
  shader.vertexShader = 'attribute vec4 aOcc;\nvarying float vSee;\nuniform float uSeeOn;\nuniform vec3 uSeeDog, uSeeR, uSeeU, uSeeB;\n' +
    shader.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>
  vSee = 0.0;
  if (uSeeOn > 0.5 && aOcc.z > 0.0) {
    vec3 dd = uSeeDog - vec3(aOcc.x, uSeeDog.y - 0.35 + aOcc.w * 0.55, aOcc.y); // 小狗相对树冠中心
    float sx = abs(dot(dd, uSeeR)), sy = abs(dot(dd, uSeeU));
    float hv = 0.5 * aOcc.w * uSeeU.y + 0.5 * aOcc.z;                              // 树在画面上的半高
    float front = dot(vec3(aOcc.x - uSeeDog.x, 0.0, aOcc.y - uSeeDog.z), uSeeB);   // > 0：树根比小狗离镜头近
    vSee = (1.0 - smoothstep(aOcc.z + 0.1, aOcc.z + 0.5, sx)) * (1.0 - smoothstep(hv + 0.1, hv + 0.5, sy)) * smoothstep(0.1, 0.5, front);
  }`);
  shader.fragmentShader = 'varying float vSee;\nuniform vec2 uSeeGrid;\nuniform float uSeeMax;\n' +
    shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
  if (vSee > 0.02) {
    vec2 q = mod(floor(gl_FragCoord.xy) + uSeeGrid, 2.0);
    float thr = q.x < 0.5 ? (q.y < 0.5 ? 0.2 : 0.8) : (q.y < 0.5 ? 0.6 : 0.4);
    if (vSee * uSeeMax > thr - 0.1) discard; // uSeeMax = 0.5 时最多丢 0.2 和 0.4 这两格：正好是棋盘格
    gl_FragColor.a = 0.5;
  }`);
};

// ---------------------------------------------------------------- 圆润造型的小工具：一堆上了色的基本体合并成一个几何
const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _n = new THREE.Matrix3();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
const GEO = new Map();
function prim(type, a = 8, b = 6, c = 0) {
  const key = type + a + '_' + b + '_' + c;
  let g = GEO.get(key);
  if (!g) {
    let base;
    if (type === 'ball') base = new THREE.SphereGeometry(1, a, b);
    else if (type === 'cyl') base = new THREE.CylinderGeometry(1, 1, 1, a, 1);
    else if (type === 'cylT') base = new THREE.CylinderGeometry(c, 1, 1, a, 1); // 上半径 = c，下半径 = 1
    else if (type === 'cone') base = new THREE.ConeGeometry(1, 1, a, 1);
    else if (type === 'box') base = new THREE.BoxGeometry(1, 1, 1);
    else if (type === 'ring') base = new THREE.TorusGeometry(1, c || 0.35, 6, a);
    g = base.index ? base.toNonIndexed() : base;
    GEO.set(key, g);
  }
  return g;
}
function builder() {
  const pos = [], nor = [], col = [], gpos = [], gnor = [], gcol = [];
  const add = (geo, color, p, s, r, glow = false) => {
    p = p || [0, 0, 0]; s = s === undefined || s === null ? 1 : s; r = r || [0, 0, 0];
    const g = geo.index ? geo.toNonIndexed() : geo;
    _p.set(p[0], p[1], p[2]);
    if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
    _m.compose(_p, _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s);
    _n.getNormalMatrix(_m);
    const PP = g.attributes.position, NN = g.attributes.normal;
    const own = color === null && g.attributes.color;
    if (!own) _c.set(color);
    const pa = glow ? gpos : pos, na = glow ? gnor : nor, ca = glow ? gcol : col;
    for (let i = 0; i < PP.count; i++) {
      _v.fromBufferAttribute(PP, i).applyMatrix4(_m); pa.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(NN, i).applyMatrix3(_n).normalize(); na.push(_v.x, _v.y, _v.z);
      if (own) ca.push(g.attributes.color.getX(i), g.attributes.color.getY(i), g.attributes.color.getZ(i)); else ca.push(_c.r, _c.g, _c.b);
    }
    return api;
  };
  const api = {
    ball: (color, p, s, r, seg = [8, 6]) => add(prim('ball', seg[0], seg[1]), color, p, s, r),
    cyl: (color, p, s, r, seg = 8) => add(prim('cyl', seg), color, p, s, r),            // s = [半径x, 高, 半径z]
    cylT: (color, p, rt, rb, h, r, seg = 8) => add(prim('cylT', seg, 1, rt / rb), color, p, [rb, h, rb], r),
    cone: (color, p, s, r, seg = 8) => add(prim('cone', seg), color, p, s, r),
    box: (color, p, s, r) => add(prim('box'), color, p, s, r),                          // s = 整体尺寸
    ring: (color, p, s, r, tube = 0.35) => add(prim('ring', 12, 1, tube), color, p, s, r),
    glowBox: (color, p, s, r) => add(prim('box'), color, p, s, r, true),
    glowBall: (color, p, s, r) => add(prim('ball', 8, 6), color, p, s, r, true),
    geo: (geo, color, p, s, r) => add(geo, color, p, s, r),
    arc: (color, p, R, tube, arcLen, r) => add(new THREE.TorusGeometry(R, tube, 6, 14, arcLen), color, p, 1, r),
    build() {
      const mk = (pa, na, ca) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pa, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(na, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(ca, 3));
        g.computeBoundingBox(); g.computeBoundingSphere();
        return g;
      };
      const g = mk(pos, nor, col);
      if (gpos.length) g.userData.glow = mk(gpos, gnor, gcol);
      const bb = g.boundingBox;
      g.userData.size = { w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y, d: bb.max.z - bb.min.z };
      return g;
    },
  };
  return api;
}
const PI = Math.PI, H = PI / 2;

// 一个三角形 / 多边形的薄板（沿 x 方向挤出）：pts 是 (z, y) 平面里的点
function plateX(b, color, pts, x, thick) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
  g.rotateY(H);
  return b.geo(g, color, [x, 0, 0]);
}
// 沿 z 方向挤出：pts 是 (x, y) 平面里的点
function plateZ(b, color, pts, z, thick) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
  return b.geo(g, color, [0, 0, z]);
}
/** 屋顶面（脊线沿 x）：斜面 (z1,y1)→(z2,y2)，分成若干排“瓦”，每排颜色不同、略微错开，像一片片瓦。 */
function roofRowsX(b, x, w, z1, y1, z2, y2, tiers, rows = 5, seed = 1, th = 0.05) {
  const L = Math.hypot(z2 - z1, y2 - y1), ang = Math.atan2(y2 - y1, z2 - z1);
  for (let i = 0; i < rows; i++) {
    const t0 = i / rows, t1 = (i + 1) / rows;
    const zc = z1 + (z2 - z1) * (t0 + t1) / 2, yc = y1 + (y2 - y1) * (t0 + t1) / 2;
    const out = (i % 2) * 0.012;
    const col = tiers[(i % 2 === 0 ? 2 : 1)];
    b.box(col, [x, yc + out, zc], [w, th, L / rows + 0.02], [-ang, 0, 0]);
    // 每排上沿一条亮边
    b.box(tiers[3], [x, yc + out + 0.014, zc + (z2 > z1 ? 1 : -1) * (L / rows) * 0.42 * Math.cos(ang)], [w, th * 0.6, 0.025], [-ang, 0, 0]);
    // 零星的亮 / 暗瓦
    const r = rng(seed * 31 + i);
    for (let k = 0; k < 3; k++) b.box(r() > 0.5 ? tiers[3] : tiers[0], [x + (r() - 0.5) * w * 0.9, yc + out + 0.012, zc], [0.2, th * 0.7, L / rows * 0.8], [-ang, 0, 0]);
  }
}
/** 屋顶面（脊线沿 z）：斜面 (x1,y1)→(x2,y2)。 */
function roofRowsZ(b, z, len, x1, y1, x2, y2, tiers, rows = 4, seed = 1, th = 0.05) {
  const L = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
  for (let i = 0; i < rows; i++) {
    const t0 = i / rows, t1 = (i + 1) / rows;
    const xc = x1 + (x2 - x1) * (t0 + t1) / 2, yc = y1 + (y2 - y1) * (t0 + t1) / 2;
    const out = (i % 2) * 0.012;
    b.box(tiers[i % 2 === 0 ? 2 : 1], [xc, yc + out, z], [L / rows + 0.02, th, len], [0, 0, ang]);
    b.box(tiers[3], [xc + (x2 > x1 ? 1 : -1) * (L / rows) * 0.42 * Math.cos(ang), yc + out + 0.014, z], [0.025, th * 0.6, len], [0, 0, ang]);
  }
}

// ---------------------------------------------------------------- 树
function leafBlob(b, C, cx, cy, cz, R, rnd, n = 7, spread = 0.62) {
  b.ball(C[1], [cx, cy, cz], [R, R * 0.82, R], null, [10, 7]);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2 + rnd(), r = R * (spread + rnd() * 0.25), y = cy + (rnd() - 0.45) * R * 0.9;
    b.ball(C[i % 3 === 0 ? 2 : i % 3 === 1 ? 0 : 3], [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r], R * (0.4 + rnd() * 0.17), null, [7, 5]);
  }
  b.ball(C[2], [cx - R * 0.2, cy + R * 0.72, cz + R * 0.14], R * 0.44, null, [7, 5]);
}
function oakBuilder(o, { fruit = false, pink = false } = {}) {
  const b = builder();
  const C = pink ? T.blossom : fruit ? T.orchard : T.oak;
  const rnd = rng((o.seed || 1) * 7919);
  b.cylT(pink ? 0x8a4a3a : 0x7a4e2c, [0, 0.5, 0], 0.11, 0.17, 1.0, null, 7);
  b.cone(0x6a4226, [0, 0.1, 0], [0.27, 0.22, 0.27], null, 7);
  b.cylT(0x7a4e2c, [0.18, 0.95, 0.04], 0.03, 0.06, 0.35, [0, 0, -0.9], 5);
  leafBlob(b, C, 0, 1.55, 0, 0.82, rnd, 8);
  if (fruit) for (let i = 0; i < 7; i++) { const a = rnd() * 6.28, y = 1.2 + rnd() * 0.7; b.ball(0xe23b2e, [Math.cos(a) * 0.86, y, Math.sin(a) * 0.86], 0.075, null, [6, 4]); }
  if (pink) for (let i = 0; i < 5; i++) { const a = rnd() * 6.28; b.ball(0xfbd3e4, [Math.cos(a) * 0.9, 1.3 + rnd() * 0.6, Math.sin(a) * 0.9], 0.07, null, [6, 4]); }
  return b;
}
const appleTree = (o) => oakBuilder(o, { fruit: true });
const plainTree = (o) => { const b = oakBuilder(o); return b; };
const pinkTree = (o) => oakBuilder(o, { pink: true });

function pine(o = {}) {
  const b = builder();
  const rnd = rng((o.seed || 1) * 131);
  const Tc = T.teal;
  b.cylT(0x6a4226, [0, 0.25, 0], 0.05, 0.09, 0.5, null, 6);
  const nT = o.lo ? 3 : o.tall ? 5 : 4;
  for (let t = 0; t < nT; t++) {
    const y = 0.28 + t * (o.lo ? 0.5 : 0.42), r = (o.lo ? 0.7 : 0.62) - t * (o.lo ? 0.18 : 0.1), h = o.lo ? 0.8 : 0.66;
    b.cone(Tc[t % 2 === 0 ? 1 : 0], [0, y + h / 2, 0], [r, h, r], [0, rnd() * 3, 0], o.lo ? 6 : 8);
    if (!o.lo) b.cone(Tc[2], [-r * 0.12, y + h * 0.55, r * 0.1], [r * 0.7, h * 0.7, r * 0.7], [0, rnd() * 3, 0], 7);
  }
  const ty = 0.28 + nT * (o.lo ? 0.5 : 0.42);
  b.cone(Tc[3], [0, ty + 0.1, 0], [0.12, 0.3, 0.12], null, 6);
  return b;
}

function bush(o = {}) {
  const b = builder();
  const rnd = rng((o.seed || 3) * 733);
  const C = o.pink ? T.blossom : T.oak;
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28, r = i ? 0.28 : 0; b.ball(C[[1, 2, 0][i % 3]], [Math.cos(a) * r, 0.26 + rnd() * 0.12, Math.sin(a) * r], 0.26 + rnd() * 0.08, null, [8, 6]); }
  b.ball(C[3], [-0.05, 0.5, 0.05], 0.18, null, [7, 5]);
  if (o.berries) for (let i = 0; i < 5; i++) { const a = rnd() * 6.28; b.ball(0xe23b2e, [Math.cos(a) * 0.4, 0.3 + rnd() * 0.2, Math.sin(a) * 0.4], 0.04, null, [5, 4]); }
  if (o.flower) for (let i = 0; i < 5; i++) { const a = rnd() * 6.28; b.ball(pick(rnd, [0xf06aa0, 0xfff4f0, 0xffe040]), [Math.cos(a) * 0.38, 0.38 + rnd() * 0.15, Math.sin(a) * 0.38], 0.045, null, [5, 4]); }
  return b;
}

function hedge(o = {}) {
  const b = builder();
  const L = (o.length || 32) / 16, rnd = rng((o.seed || 1) * 17);
  const n = Math.max(2, Math.round(L / 0.3));
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    b.ball(T.oak[(i + (rnd() > 0.7 ? 1 : 0)) % 3 + 1 > 3 ? 3 : (i % 3) + 1], [x, 0.26 + rnd() * 0.04, 0], [0.24, 0.26, 0.26], null, [7, 5]);
  }
  b.cyl(T.oak[0], [0, 0.1, 0], [0.2, L + 0.1, 0.2], [0, 0, H]);
  return b;
}

function stump() {
  const b = builder();
  b.cylT(0x8a5e34, [0, 0.17, 0], 0.26, 0.31, 0.35, null, 9);
  b.cyl(0xe6c58a, [0, 0.355, 0], [0.26, 0.02, 0.26], null, 9);
  b.ring(0xc9a56a, [0, 0.37, 0], 0.13, [H, 0, 0], 0.06);
  for (let i = 0; i < 3; i++) b.ball(0x7a4e2c, [Math.cos(i * 2.1) * 0.3, 0.04, Math.sin(i * 2.1) * 0.3], [0.1, 0.07, 0.1], null, [6, 4]);
  return b;
}
function rock(o = {}) {
  const b = builder();
  const rnd = rng((o.seed || 1) * 53);
  b.ball(T.stone[2], [0, 0.2, 0], [0.5, 0.3, 0.4], [0, rnd() * 3, 0], [8, 6]);
  b.ball(T.stone[1], [0.4, 0.13, 0.12], [0.25, 0.18, 0.22], null, [7, 5]);
  b.ball(T.stone[3], [-0.1, 0.3, -0.05], [0.3, 0.16, 0.26], null, [7, 5]);
  b.ball(0x5cae3c, [0.0, 0.4, 0.0], [0.18, 0.06, 0.16], null, [6, 4]);
  return b;
}
function mushroom() {
  const b = builder();
  b.cyl(P.sack, [0, 0.07, 0], [0.04, 0.14, 0.04], null, 6);
  b.ball(P.mushroomRed, [0, 0.16, 0], [0.12, 0.08, 0.12], null, [8, 5]);
  b.ball(P.white, [0.05, 0.22, 0.04], 0.018, null, [4, 3]); b.ball(P.white, [-0.05, 0.2, -0.02], 0.015, null, [4, 3]);
  b.cyl(P.sack, [0.17, 0.04, 0.05], [0.025, 0.08, 0.025], null, 5);
  b.ball(P.mushroomRed, [0.17, 0.09, 0.05], [0.07, 0.045, 0.07], null, [6, 4]);
  return b;
}
function barrel() {
  const b = builder();
  b.cylT(T.wood[2], [0, 0.25, 0], 0.2, 0.2, 0.5, null, 10);
  b.ball(T.wood[2], [0, 0.25, 0], [0.24, 0.27, 0.24], null, [10, 6]);
  b.cyl(T.wood[0], [0, 0.505, 0], [0.19, 0.02, 0.19], null, 10);
  for (const y of [0.1, 0.4]) b.ring(T.stone[1], [0, y, 0], 0.215, [H, 0, 0], 0.05);
  return b;
}
function crate() {
  const b = builder();
  b.box(T.wood[2], [0, 0.17, 0], [0.34, 0.34, 0.34]);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(T.wood[3], [x * 0.16, 0.17, z * 0.16], [0.045, 0.36, 0.045]);
  b.box(T.wood[3], [0, 0.35, 0], [0.37, 0.03, 0.37]);
  b.box(T.wood[1], [0, 0.17, 0.172], [0.3, 0.04, 0.012], [0, 0, 0.7]); b.box(T.wood[1], [0, 0.17, 0.172], [0.3, 0.04, 0.012], [0, 0, -0.7]);
  return b;
}
function reeds(o = {}) {
  const b = builder();
  const r = rng((o.seed || 2) * 19);
  for (let i = 0; i < 7; i++) {
    const x = (r() - 0.5) * 0.7, z = (r() - 0.5) * 0.4, h = 0.45 + r() * 0.45, lean = (r() - 0.5) * 0.25;
    b.cylT(pick(r, [T.grass[1], T.grass[2], T.oak[1]]), [x, h / 2, z], 0.008, 0.02, h, [0, 0, lean], 4);
    if (r() > 0.5) b.cyl(0x7a4e2c, [x + lean * -0.5 * h * 0.9, h * 0.85, z], [0.028, 0.14, 0.028], [0, 0, lean], 5);
  }
  return b;
}
function lily(o = {}) {
  const b = builder();
  const r = rng((o.seed || 5) * 29);
  for (let i = 0; i < 4; i++) {
    const x = (r() - 0.5) * 0.7, z = (r() - 0.5) * 0.5;
    b.cyl(pick(r, [T.grass[1], T.grass[2]]), [x, 0.012, z], [0.14, 0.02, 0.14], null, 8);
    b.ball(T.grass[3], [x + 0.03, 0.025, z + 0.02], [0.03, 0.01, 0.03], null, [4, 3]);
    if (i % 2 === 0) { b.ball(P.flowerPink, [x, 0.05, z], 0.05, null, [6, 4]); b.ball(P.flowerWhite, [x, 0.08, z], 0.03, null, [5, 3]); }
  }
  return b;
}
function flowers(o = {}) {
  const b = builder();
  const r = rng((o.seed || 2) * 41);
  for (let i = 0; i < 6; i++) {
    const x = (r() - 0.5) * 0.9, z = (r() - 0.5) * 0.9;
    const c = pick(r, [P.flowerPink, P.flowerWhite, P.flowerYellow, P.flowerBlue, P.flowerPurple, P.flowerRed]);
    b.cylT(T.grass[1], [x, 0.07, z], 0.006, 0.01, 0.14, null, 3);
    b.ball(c, [x, 0.16, z], 0.05, null, [6, 4]);
    b.ball(P.flowerYellow, [x, 0.19, z + 0.02], 0.018, null, [4, 3]);
    b.ball(T.grass[2], [x + 0.04, 0.05, z], [0.05, 0.015, 0.025], [0, 0, 0.4], [5, 3]);
  }
  return b;
}
function flowerBedLayout(o = {}) {
  const r = rng((o.seed || 4) * 23);
  const W = (o.w || 28) / 16, D = (o.d || 14) / 16;
  const nx = Math.round(W / 0.22), nz = Math.round(D / 0.22), items = [];
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const x = -W / 2 + (i + 0.5) * (W / nx) + (r() - 0.5) * 0.06, z = -D / 2 + (k + 0.5) * (D / nz) + (r() - 0.5) * 0.06;
    const c = pick(r, [P.flowerPink, P.flowerWhite, P.flowerYellow, P.flowerBlue, P.flowerPurple, P.flowerRed]);
    items.push({ x, z, c, h: 0.26 + r() * 0.06 });
  }
  return { W, D, items };
}
function flowerBedBase(b, W, D) {
  b.box(T.soil[1], [0, 0.08, 0], [W, 0.16, D]);
  for (const s of [-1, 1]) {
    b.cyl(T.wood[2], [0, 0.07, s * (D / 2)], [0.065, W + 0.1, 0.065], [0, 0, H], 6);
    b.cyl(T.wood[2], [s * (W / 2), 0.07, 0], [0.065, D, 0.065], [H, 0, 0], 6);
  }
}
function flowerBed(o = {}) {
  const b = builder();
  const { W, D, items } = flowerBedLayout(o);
  flowerBedBase(b, W, D);
  for (const f of items) {
    b.ball(T.grass[1], [f.x, 0.2, f.z], [0.05, 0.05, 0.05], null, [5, 3]);
    b.ball(f.c, [f.x, f.h, f.z], 0.055, null, [6, 4]);
  }
  return b;
}

// ---------------------------------------------------------------- 栅栏（圆木桩 + 圆横杆）
function logPost(b, x, z, h, c = T.wood) {
  b.cylT(c[2], [x, h / 2, z], 0.05, 0.065, h, null, 7);
  b.ball(c[3], [x, h, z], [0.06, 0.05, 0.06], null, [7, 4]);
  b.cyl(c[1], [x + 0.03, h / 2, z + 0.02], [0.02, h * 0.9, 0.02], null, 4);
}
function fence(o = {}) {
  const b = builder();
  const L = (o.length || 32) / 16;
  const style = o.style || 'rail';
  const gapL = o.hole ? L * 0.5 : 0; // 狗洞：中间缺一段
  if (style === 'picket') {
    const rnd = rng(L * 100);
    b.cyl(T.wood[1], [0, 0.28, -0.08], [0.04, L, 0.04], [0, 0, H], 6);
    b.cyl(T.wood[1], [0, 0.68, -0.08], [0.04, L, 0.04], [0, 0, H], 6);
    const n = Math.max(2, Math.round(L / 0.19));
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + (i + 0.5) * (L / n);
      if (o.hole && Math.abs(x) < L * 0.25) continue;
      const h = 1.0 + rnd() * 0.15;
      b.cylT(i % 2 ? T.wood[2] : T.wood[3], [x, h / 2, 0], 0.07, 0.1, h, null, 6);
      b.cone(T.wood[3], [x, h + 0.05, 0], [0.09, 0.14, 0.09], null, 6);
    }
    return b;
  }
  for (const y of [0.22, 0.52]) {
    if (o.hole) {
      for (const s of [-1, 1]) b.cyl(T.wood[2], [s * (L / 2 - (L - gapL) / 4), y, 0.05], [0.035, (L - gapL) / 2, 0.035], [0, 0, H], 6);
    } else b.cyl(T.wood[2], [0, y, 0.05], [0.035, L, 0.035], [0, 0, H], 6);
  }
  const n = Math.max(2, Math.round(L / 0.55) + 1);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + 0.06 + (i / (n - 1)) * (L - 0.12);
    if (o.hole && Math.abs(x) < gapL / 2) continue;
    logPost(b, x, 0, 0.72);
  }
  if (o.hole) { b.ball(T.soil[1], [0, 0.03, 0.18], [0.3, 0.05, 0.14], null, [7, 4]); b.ball(T.soil[2], [0.05, 0.05, 0.2], [0.18, 0.05, 0.09], null, [6, 4]); }
  return b;
}
function gate(o = {}) {
  const b = builder();
  const L = (o.length || 32) / 16;
  logPost(b, -L / 2 + 0.06, 0, 0.95); logPost(b, L / 2 - 0.06, 0, 0.95);
  for (const y of [0.2, 0.5, 0.8]) b.cyl(T.wood[3], [0, y, 0.05], [0.03, L - 0.2, 0.03], [0, 0, H], 6);
  const dg = Math.hypot(L - 0.3, 0.6);
  b.cyl(T.wood[2], [0, 0.5, 0.06], [0.03, dg, 0.03], [0, 0, Math.atan2(0.6, L - 0.3) - H], 6);
  b.box(T.stone[1], [L / 2 - 0.22, 0.5, 0.09], [0.06, 0.1, 0.03]);
  return b;
}

// ---------------------------------------------------------------- 草垛
function roundBale(b, x, y, z, r, len, col, rot = 0) {
  // 圆草垛：圆柱的轴沿 z（朝向 rot 时在水平面里转 rot），所以正面（+z）能看到圆形的端面
  const ax = -Math.sin(rot), az = Math.cos(rot);
  b.cyl(col[2], [x, y, z], [r, len, r], [H, 0, rot]);
  for (const sg of [-1, 1]) {
    b.cyl(col[3], [x + sg * ax * len * 0.5, y, z + sg * az * len * 0.5], [r * 0.72, 0.02, r * 0.72], [H, 0, rot]);
    b.ring(col[1], [x + sg * ax * (len * 0.5 + 0.005), y, z + sg * az * (len * 0.5 + 0.005)], r * 0.4, [0, -rot, 0], 0.07);
    b.ring(col[1], [x + sg * ax * (len * 0.5 + 0.005), y, z + sg * az * (len * 0.5 + 0.005)], r * 0.7, [0, -rot, 0], 0.04);
  }
  b.cyl(col[1], [x, y, z], [r * 1.015, 0.05, r * 1.015], [H, 0, rot]);
}
function hayBale(o = {}) {
  const b = builder();
  const n = o.count || 1;
  const HY = [0xc99a3a, 0xe8c25a, 0xf5d97a, 0xfbe9a0];
  if (n === 1) roundBale(b, 0, 0.25, 0, 0.25, 0.6, HY);
  else if (n === 2) { roundBale(b, -0.3, 0.25, 0, 0.25, 0.6, HY); roundBale(b, 0.3, 0.25, 0, 0.25, 0.6, HY); }
  else { roundBale(b, -0.3, 0.25, 0, 0.25, 0.6, HY); roundBale(b, 0.3, 0.25, 0, 0.25, 0.6, HY); roundBale(b, 0, 0.7, 0, 0.25, 0.6, HY); }
  return b;
}
function hayRound(o = {}) {
  const b = builder();
  const col = o.wrap ? [0xcfd8e0, 0xeef3f7, 0xffffff, 0xffffff] : [0xc99a3a, 0xe8c25a, 0xf5d97a, 0xfbe9a0];
  roundBale(b, 0, 0.45, 0, 0.45, 0.72, col);
  return b;
}

// ---------------------------------------------------------------- 菜畦
function cropLayout(crop) {
  const out = [];
  if (crop === 'radish') { for (const z of [-0.38, 0, 0.38]) for (let i = 0; i < 6; i++) out.push({ x: -0.8 + i * 0.32, z, s: 1 }); }
  else if (crop === 'cabbage') { for (const z of [-0.28, 0.3]) for (let i = 0; i < 4; i++) out.push({ x: -0.75 + i * 0.5, z, s: 1 }); }
  else for (const [x, z, s] of [[-0.6, -0.2, 1], [0.1, 0.2, 1.1], [0.65, -0.25, 0.95]]) out.push({ x, z, s });
  return out;
}
function cropBedBase(b, crop) {
  const W = 2, D = 1.25;
  b.box(T.soil[1], [0, 0.07, 0], [W, 0.14, D]);
  for (const s of [-1, 1]) {
    b.cyl(T.wood[2], [0, 0.06, s * (D / 2)], [0.055, W + 0.08, 0.055], [0, 0, H], 6);
    b.cyl(T.wood[2], [s * (W / 2), 0.06, 0], [0.055, D, 0.055], [H, 0, 0], 6);
  }
  if (crop !== 'pumpkin') for (const z of [-0.38, 0, 0.38]) b.box(T.soil[2], [0, 0.15, z], [W - 0.1, 0.05, 0.16]);
  else for (const z of [-0.38, 0, 0.38]) b.box(T.soil[2], [0, 0.15, z], [W - 0.1, 0.05, 0.16]);
}
/** 单棵作物（以 (x, z) 为中心，s 是大小倍数）。 */
function cropPlant(b, crop, x, z, s = 1) {
  if (crop === 'radish') {
    b.ball(P.radish, [x, 0.2, z], [0.075, 0.08, 0.075], null, [6, 5]);
    b.ball(0xff7a8a, [x - 0.02, 0.23, z + 0.02], 0.025, null, [4, 3]);
    b.cone(T.grass[1], [x, 0.36, z], [0.035, 0.22, 0.035], [0.2, 0, 0.15], 4);
    b.cone(T.grass[2], [x, 0.35, z], [0.035, 0.2, 0.035], [-0.2, 0, -0.2], 4);
  } else if (crop === 'cabbage') {
    b.ball(T.oak[1], [x, 0.26, z], [0.19, 0.14, 0.19], null, [7, 5]);
    b.ball(P.cabbage, [x, 0.3, z], [0.14, 0.12, 0.14], null, [7, 5]);
    b.ball(P.cabbageLight, [x - 0.02, 0.36, z], 0.07, null, [6, 4]);
  } else {
    b.ball(P.pumpkinDark, [x, 0.3, z], [0.26 * s, 0.2 * s, 0.26 * s], null, [8, 6]);
    b.ball(P.pumpkin, [x - 0.04, 0.32, z], [0.22 * s, 0.2 * s, 0.24 * s], null, [8, 6]);
    b.ball(P.pumpkin, [x + 0.08, 0.31, z], [0.12 * s, 0.19 * s, 0.22 * s], null, [7, 5]);
    b.cyl(T.oak[1], [x, 0.5 * s, z], [0.03, 0.1, 0.03], [0.2, 0, 0.2], 5);
    b.ball(T.grass[2], [x + 0.28, 0.17, z + 0.1], [0.13, 0.025, 0.1], [0, 1.2, 0], [6, 3]);
    b.cyl(T.oak[0], [x + 0.2, 0.16, z + 0.05], [0.012, 0.3, 0.012], [H, 0, 0.8], 3);
  }
}
function cropBed(o = {}) {
  const b = builder();
  const crop = o.crop || 'radish';
  cropBedBase(b, crop);
  for (const p of cropLayout(crop)) cropPlant(b, crop, p.x, p.z, p.s);
  return b;
}
const cropRadish = () => cropBed({ crop: 'radish' });
const cropCabbage = () => cropBed({ crop: 'cabbage' });
const cropPumpkin = () => cropBed({ crop: 'pumpkin' });
function radishBig() {
  const b = builder();
  b.cone(P.sheetShade, [0, 0.1, 0], [0.12, 0.3, 0.12], [PI, 0, 0], 8);
  b.ball(P.radish, [0, 0.3, 0], [0.2, 0.22, 0.2], null, [8, 6]);
  b.ball(0xff7a8a, [-0.06, 0.36, 0.08], 0.05, null, [5, 4]);
  for (const a of [0, 2.1, 4.2]) b.cone(T.grass[1 + (a > 2 ? 1 : 0)], [Math.sin(a) * 0.08, 0.6, Math.cos(a) * 0.08], [0.06, 0.34, 0.06], [Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5], 5);
  return b;
}

// ---------------------------------------------------------------- 晾衣绳
function clothesline() {
  const b = builder();
  const L = 3.25;
  for (const s of [-1, 1]) logPost(b, s * (L / 2 - 0.06), 0, 1.5);
  b.cyl(P.rope, [0, 1.38, 0], [0.012, L - 0.1, 0.012], [0, 0, H], 4);
  const sheets = [[-1.0, 0.85, P.sheet, P.sheetShade], [0.05, 0.85, P.sheet, P.sheetShade], [1.1, 0.6, P.towel, P.denim]];
  sheets.forEach(([x, w, c, sh], i) => {
    const h = i === 2 ? 0.62 : 0.9, n = 4;
    for (let k = 0; k < n; k++) b.box(k % 2 ? sh : c, [x - w / 2 + (k + 0.5) * (w / n), 1.36 - h / 2, (k % 2 - 0.5) * 0.04], [w / n + 0.01, h, 0.025]);
    b.box(sh, [x, 1.36 - h + 0.02, 0], [w, 0.04, 0.04]);
    for (const dx of [-0.3, 0.3]) b.box(T.wood[3], [x + dx * w, 1.38, 0], [0.025, 0.07, 0.03]);
  });
  return b;
}

// ---------------------------------------------------------------- 蜂箱（蜂群取消了，留着当小摆设）
function beehive() {
  const b = builder();
  for (const x of [-0.25, 0.25]) for (const z of [-0.25, 0.25]) b.cyl(T.wood[1], [x, 0.15, z], [0.03, 0.3, 0.03], null, 5);
  for (let i = 0; i < 3; i++) { b.box(i % 2 ? P.hiveDark : P.hive, [0, 0.4 + i * 0.22, 0], [0.62, 0.2, 0.62]); b.box(P.white, [0, 0.5 + i * 0.22, 0], [0.66, 0.03, 0.66]); }
  b.box(P.white, [0, 1.1, 0], [0.7, 0.05, 0.7]); b.ball(P.sheetShade, [0, 1.15, 0], [0.35, 0.1, 0.35], null, [8, 4]);
  b.box(P.ink, [0, 0.33, 0.32], [0.3, 0.04, 0.02]);
  return b;
}

// ---------------------------------------------------------------- 泥塘 / 水塘（物件拼图用；地图里的水是地形网格）
function blobPlate(b, rx, rz, seed, y, colorAt) {
  const N = 28, ringsN = 3;
  const lim = (a) => 1 + 0.14 * Math.sin(3 * a + seed) + 0.1 * Math.sin(5 * a + seed * 1.7) + 0.05 * Math.sin(8 * a + seed * 2.3);
  const pt = (i, k) => { const a = (i / N) * PI * 2, f = ((k + 1) / ringsN) * lim(a); return [Math.cos(a) * rx * f, y, Math.sin(a) * rz * f]; };
  const pos = [], nor = [], col = [];
  const _cc = new THREE.Color();
  const push = (p, t) => { pos.push(...p); nor.push(0, 1, 0); _cc.set(colorAt(t)); col.push(_cc.r, _cc.g, _cc.b); };
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    push([0, y, 0], 0); push(pt(j, 0), 1 / 3); push(pt(i, 0), 1 / 3);
    for (let k = 0; k < ringsN - 1; k++) {
      const t0 = (k + 1) / ringsN, t1 = (k + 2) / ringsN;
      push(pt(i, k), t0); push(pt(j, k), t0); push(pt(j, k + 1), t1);
      push(pt(i, k), t0); push(pt(j, k + 1), t1); push(pt(i, k + 1), t1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  b.geo(g, null);
  return lim;
}
function pond(o, kind) {
  const b = builder();
  const w = (o.w || 40) / 16, d = (o.d || 32) / 16, seed = o.seed || 1;
  const rx = w / 2, rz = d / 2, r = rng(seed * 7);
  const lim = blobPlate(b, rx, rz, seed, 0.03, kind === 'mud' ? (t) => T.mud[Math.min(3, Math.floor(t * 3.2))] : (t) => T.water[Math.max(0, 3 - Math.floor(t * 3.4))]);
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2, f = lim(a) * 1.04;
    const x = Math.cos(a) * rx * f, z = Math.sin(a) * rz * f;
    if (kind === 'mud') b.ball(T.mud[1 + (i % 2)], [x, 0.04, z], [0.17, 0.08, 0.17], null, [6, 4]);
    else b.ball(T.stone[1 + (i % 3)], [x, 0.08, z], [0.16 + r() * 0.05, 0.1, 0.15], null, [6, 4]);
  }
  if (kind === 'water') {
    for (const [dx, dz] of [[-0.3, -0.1], [0.4, 0.2]]) { b.cyl(T.grass[1], [dx, 0.04, dz], [0.13, 0.02, 0.13], null, 8); b.ball(P.flowerPink, [dx, 0.09, dz], 0.05, null, [6, 4]); }
    b.cylT(T.grass[1], [-rx * 0.7, 0.3, 0.1], 0.01, 0.02, 0.5, null, 4); b.cyl(0x7a4e2c, [-rx * 0.7, 0.55, 0.1], [0.03, 0.14, 0.03], null, 5);
  }
  return b;
}
const mudPit = (o) => pond(o, 'mud');
const waterPond = (o) => pond(o, 'water');

// ---------------------------------------------------------------- 水井 / 奶桶 / 手推车 / 稻草人 / 食槽
function well() {
  const b = builder();
  b.cylT(T.stone[2], [0, 0.22, 0], 0.44, 0.46, 0.44, null, 12);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2; b.ball(T.stone[1 + (i % 3)], [Math.cos(a) * 0.45, 0.2 + (i % 2) * 0.12, Math.sin(a) * 0.45], [0.1, 0.1, 0.1], null, [5, 4]); }
  b.ring(T.stone[3], [0, 0.45, 0], 0.4, [H, 0, 0], 0.1);
  b.cyl(T.water[1], [0, 0.4, 0], [0.34, 0.02, 0.34], null, 12);
  for (const s of [-1, 1]) b.cyl(T.wood[2], [s * 0.4, 0.75, 0], [0.04, 0.8, 0.04], null, 6);
  b.cyl(T.wood[3], [0, 1.1, 0], [0.035, 0.9, 0.035], [0, 0, H], 6);
  roofRowsX(b, 0, 1.15, -0.1, 1.1, -0.42, 1.0, T.roofRed, 3, 2);
  roofRowsX(b, 0, 1.15, 0.1, 1.1, 0.42, 1.0, T.roofRed, 3, 3);
  b.cylT(T.roofRed[1], [0, 1.2, 0], 0.03, 0.04, 1.15, [0, 0, H], 6);
  b.cyl(P.rope, [0, 0.9, 0], [0.01, 0.35, 0.01], null, 3);
  b.cyl(T.wood[2], [0, 0.68, 0], [0.09, 0.14, 0.09], null, 8);
  return b;
}
function milkCan() {
  const b = builder();
  b.cylT(T.stone[2], [0, 0.17, 0], 0.15, 0.17, 0.34, null, 10);
  b.cylT(T.stone[2], [0, 0.4, 0], 0.07, 0.15, 0.12, null, 10);
  b.cyl(T.stone[2], [0, 0.5, 0], [0.07, 0.1, 0.07], null, 8);
  b.ball(T.stone[1], [0, 0.57, 0], [0.1, 0.05, 0.1], null, [8, 4]);
  b.ring(P.barnRed, [0, 0.2, 0], 0.17, [H, 0, 0], 0.09);
  for (const s of [-1, 1]) b.ring(T.stone[0], [s * 0.15, 0.42, 0], 0.045, [0, H, 0], 0.3);
  return b;
}
function wheelbarrow(o = {}) {
  const b = builder();
  b.ball(P.denim, [0, 0.36, 0], [0.32, 0.2, 0.45], null, [10, 6]);
  b.ball(T.water[0], [0, 0.3, 0], [0.33, 0.12, 0.46], null, [10, 5]);
  if (o.load === 'pumpkin') { b.ball(P.pumpkin, [-0.1, 0.5, 0.05], 0.16, null, [7, 5]); b.ball(P.pumpkin, [0.12, 0.5, -0.1], 0.14, null, [7, 5]); }
  else if (o.load !== 'empty') { b.ball(0xe8c25a, [0, 0.52, 0], [0.28, 0.16, 0.38], null, [8, 5]); b.ball(0xf5d97a, [0.05, 0.62, 0.05], [0.12, 0.06, 0.16], null, [6, 4]); }
  b.cyl(P.ink, [0, 0.17, 0.55], [0.17, 0.07, 0.17], [0, 0, H], 10);
  b.cyl(T.stone[2], [0, 0.17, 0.55], [0.05, 0.1, 0.05], [0, 0, H], 6);
  for (const s of [-1, 1]) {
    b.cyl(T.wood[2], [s * 0.2, 0.42, -0.55], [0.025, 0.7, 0.025], [H + 0.1, 0, 0], 5);
    b.cyl(T.wood[1], [s * 0.2, 0.17, -0.24], [0.02, 0.3, 0.02], [0.2, 0, 0], 5);
    b.cyl(T.wood[2], [s * 0.2, 0.17, 0.5], [0.02, 0.2, 0.02], null, 4);
  }
  return b;
}
function scarecrow() {
  const b = builder();
  b.cyl(T.wood[2], [0, 0.65, 0], [0.04, 1.3, 0.04], null, 6);
  b.cyl(T.wood[3], [0, 0.95, 0], [0.035, 1.2, 0.035], [0, 0, H], 6);
  b.ball(P.denim, [0, 0.82, 0], [0.19, 0.3, 0.15], null, [8, 6]);
  b.ball(P.barnRed, [0.02, 0.84, 0.13], [0.07, 0.07, 0.03], null, [5, 4]);
  b.cone(T.hay[2], [0, 0.5, 0], [0.16, 0.2, 0.12], [PI, 0, 0], 7);
  for (const s of [-1, 1]) { b.ball(P.denim, [s * 0.4, 0.95, 0], [0.12, 0.08, 0.08], null, [6, 4]); b.cone(T.hay[3], [s * 0.62, 0.95, 0], [0.05, 0.14, 0.05], [0, 0, -s * H], 5); }
  b.ball(P.sack, [0, 1.23, 0], 0.15, null, [9, 7]);
  b.ball(P.ink, [-0.05, 1.26, 0.13], 0.015, null, [4, 3]); b.ball(P.ink, [0.05, 1.26, 0.13], 0.015, null, [4, 3]);
  b.ball(P.pumpkin, [0, 1.22, 0.15], [0.03, 0.02, 0.03], null, [4, 3]);
  b.cyl(T.hay[1], [0, 1.37, 0], [0.26, 0.025, 0.26], null, 12);
  b.cylT(T.hay[2], [0, 1.45, 0], 0.1, 0.14, 0.14, null, 10);
  b.ring(P.barnRed, [0, 1.39, 0], 0.14, [H, 0, 0], 0.12);
  return b;
}
function trough(o = {}) {
  const b = builder();
  b.box(T.wood[1], [0, 0.22, 0], [1.5, 0.22, 0.5]);
  b.box(T.wood[2], [0, 0.34, 0.22], [1.5, 0.08, 0.06]); b.box(T.wood[2], [0, 0.34, -0.22], [1.5, 0.08, 0.06]);
  b.box(T.wood[2], [0.72, 0.34, 0], [0.06, 0.08, 0.5]); b.box(T.wood[2], [-0.72, 0.34, 0], [0.06, 0.08, 0.5]);
  if (o.fill === 'water') b.box(T.water[2], [0, 0.33, 0], [1.38, 0.05, 0.38]);
  else if (o.fill !== 'empty') { b.ball(0xe8c25a, [0, 0.33, 0], [0.68, 0.08, 0.17], null, [8, 4]); b.ball(0xf5d97a, [0.2, 0.39, 0], [0.3, 0.04, 0.1], null, [6, 3]); }
  for (const s of [-1, 1]) { b.cyl(T.wood[2], [s * 0.6, 0.06, 0.18], [0.04, 0.12, 0.04], null, 5); b.cyl(T.wood[2], [s * 0.6, 0.06, -0.18], [0.04, 0.12, 0.04], null, 5); }
  return b;
}
function bench() {
  const b = builder();
  for (const y of [0.4]) for (const z of [-0.09, 0, 0.09]) b.cyl(T.wood[2 + (z > 0 ? 1 : 0)], [0, y, z], [0.035, 1.25, 0.035], [0, 0, H], 6);
  for (const y of [0.62, 0.78]) b.cyl(T.wood[2], [0, y, -0.12], [0.035, 1.25, 0.035], [0, 0, H], 6);
  for (const s of [-1, 1]) { b.cyl(T.wood[1], [s * 0.5, 0.2, 0], [0.04, 0.4, 0.04], null, 6); b.cyl(T.wood[1], [s * 0.5, 0.6, -0.12], [0.03, 0.5, 0.03], null, 5); }
  return b;
}
function trellis() {
  const b = builder();
  const rnd = rng(3);
  for (const s of [-1, 1]) { b.cyl(T.wood[2], [s * 0.62, 0.65, 0], [0.05, 1.3, 0.05], null, 6); b.ball(T.stone[2], [s * 0.62, 0.03, 0], [0.12, 0.05, 0.12], null, [6, 4]); }
  b.arc(T.wood[3], [0, 1.28, 0], 0.62, 0.045, PI);
  for (let i = 0; i < 26; i++) {
    const t = rnd();
    let x, y;
    if (t < 0.3) { x = -0.62; y = 0.1 + rnd() * 1.1; } else if (t < 0.6) { x = 0.62; y = 0.1 + rnd() * 1.1; } else { const a = rnd() * PI; x = Math.cos(a) * 0.62; y = 1.28 + Math.sin(a) * 0.62; }
    b.ball(rnd() > 0.55 ? pick(rnd, [P.pink, P.pinkLight, P.flowerWhite]) : pick(rnd, T.oak), [x + (rnd() - 0.5) * 0.08, y, (rnd() - 0.5) * 0.1], 0.06 + rnd() * 0.03, null, [6, 4]);
  }
  return b;
}
function fountain() {
  const b = builder();
  b.cylT(T.stone[2], [0, 0.17, 0], 0.88, 0.9, 0.34, null, 20);
  b.ring(T.stone[3], [0, 0.34, 0], 0.82, [H, 0, 0], 0.09);
  b.cyl(T.water[1], [0, 0.3, 0], [0.74, 0.04, 0.74], null, 20);
  b.cyl(T.water[2], [0, 0.32, 0], [0.5, 0.02, 0.5], null, 16);
  b.cylT(T.stone[2], [0, 0.55, 0], 0.1, 0.14, 0.5, null, 10);
  b.cylT(T.stone[3], [0, 0.82, 0], 0.34, 0.12, 0.14, null, 14);
  b.cyl(T.water[1], [0, 0.87, 0], [0.3, 0.03, 0.3], null, 14);
  b.ball(T.stone[3], [0, 0.95, 0], [0.1, 0.1, 0.1], null, [7, 5]);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; b.ball(T.water[3], [Math.cos(a) * 0.14, 0.98 + (i % 2) * 0.05, Math.sin(a) * 0.14], 0.03, null, [4, 3]); }
  b.ball(T.water[3], [0, 1.1, 0], 0.05, null, [5, 4]);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; b.ball(T.water[3], [Math.cos(a) * 0.42, 0.34, Math.sin(a) * 0.42], 0.025, null, [4, 3]); }
  return b;
}
function bridge(o = {}) {
  const b = builder();
  const L = o.w || o.d ? Math.max(o.w || 0, o.d || 0) : 2.75, Wd = 1.1;
  const n = Math.round(L / 0.18);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n), arch = Math.sin(((i + 0.5) / n) * PI) * 0.07;
    b.box(i % 2 ? T.wood[2] : T.wood[3], [x, 0.1 + arch, 0], [L / n - 0.012, 0.06, Wd]);
  }
  for (const s of [-1, 1]) {
    b.cyl(T.wood[1], [0, 0.05, s * 0.5], [0.04, L, 0.04], [0, 0, H], 6);
    b.cyl(T.wood[3], [0, 0.55, s * 0.55], [0.035, L, 0.035], [0, 0, H], 6);
    for (let i = 0; i <= 4; i++) logPost(b, -L / 2 + 0.1 + (i / 4) * (L - 0.2), s * 0.55, 0.5);
  }
  return b;
}
function signpost() {
  const b = builder();
  b.cylT(T.wood[2], [0, 0.6, 0], 0.04, 0.06, 1.2, null, 6);
  b.box(T.wood[3], [0.3, 1.0, 0.05], [0.62, 0.16, 0.04]); b.cone(T.wood[3], [0.66, 1.0, 0.05], [0.09, 0.14, 0.04], [0, 0, -H], 3);
  b.box(T.wood[2], [-0.28, 0.76, 0.05], [0.56, 0.16, 0.04]); b.cone(T.wood[2], [-0.61, 0.76, 0.05], [0.09, 0.14, 0.04], [0, 0, H], 3);
  b.box(T.wood[0], [0.25, 1.0, 0.075], [0.3, 0.025, 0.01]); b.box(T.wood[0], [-0.25, 0.76, 0.075], [0.28, 0.025, 0.01]);
  b.ball(T.stone[2], [0, 0.03, 0], [0.12, 0.05, 0.12], null, [6, 4]);
  return b;
}
function mailbox() {
  const b = builder();
  b.cylT(T.wood[2], [0, 0.35, 0], 0.03, 0.04, 0.7, null, 6);
  b.box(P.denim, [0, 0.8, 0], [0.26, 0.14, 0.34]);
  b.cyl(P.denim, [0, 0.87, 0], [0.13, 0.34, 0.13], [H, 0, 0], 8);
  b.box(P.ink, [0, 0.8, 0.18], [0.18, 0.1, 0.01]);
  b.box(P.barnRed, [0.15, 0.95, 0.06], [0.02, 0.2, 0.04]); b.box(P.barnRed, [0.15, 1.04, 0.11], [0.02, 0.05, 0.1]);
  return b;
}
function firewood() {
  const b = builder();
  const rows = [5, 4, 3, 2];
  rows.forEach((n, ri) => {
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.28, y = 0.15 + ri * 0.25;
      b.cyl(T.wood[2 + ((i + ri) % 2)], [x, y, 0], [0.13, 0.5, 0.13], [H, 0, 0], 8);
      b.cyl(T.lumber[3], [x, y, 0.255], [0.1, 0.012, 0.1], [H, 0, 0], 8);
      b.ring(T.lumber[1], [x, y, 0.262], 0.05, null, 0.12);
    }
  });
  for (const s of [-1, 1]) b.cyl(T.wood[1], [s * 0.78, 0.45, 0], [0.04, 0.9, 0.04], null, 5);
  return b;
}
function lamp() {
  const b = builder();
  b.cylT(P.ink, [0, 0.55, 0], 0.025, 0.04, 1.1, null, 6);
  b.cyl(P.ink, [0.07, 1.1, 0], [0.015, 0.16, 0.015], [0, 0, H], 4);
  b.box(P.ink, [0.14, 1.07, 0], [0.12, 0.03, 0.12]);
  b.glowBox(0xffd27a, [0.14, 1.15, 0], [0.13, 0.17, 0.13]);
  b.cone(P.ink, [0.14, 1.24, 0], [0.09, 0.08, 0.09], null, 4);
  b.ball(P.ink, [0, 0.03, 0], [0.07, 0.04, 0.07], null, [5, 3]);
  return b;
}

// ---------------------------------------------------------------- 建筑
function wallBoards(b, w, h, y, z, tiers, step = 0.14, flip = 1) {
  const n = Math.round(w / step);
  for (let i = 0; i < n; i++) b.box(tiers[i % 2 ? 3 : 2], [-w / 2 + (i + 0.5) * (w / n), y, z * flip], [w / n - 0.012, h, 0.012]);
}
function barn() {
  const b = builder();
  const W = 2.5, D = 2.25, WH = 1.0;
  b.box(T.stone[1], [0, 0.07, 0], [W + 0.06, 0.14, D + 0.06]);
  b.box(T.barn[2], [0, 0.14 + WH / 2, 0], [W, WH, D]);
  wallBoards(b, W, WH, 0.14 + WH / 2, D / 2 + 0.006, T.barn);
  for (const s of [-1, 1]) b.box(T.barn[3], [s * (W / 2 + 0.006), 0.14 + WH / 2, 0], [0.012, WH, D]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(P.white, [sx * (W / 2), 0.14 + WH / 2, sz * (D / 2)], [0.08, WH + 0.02, 0.08]);
  // 大门
  const dz = D / 2 + 0.02;
  b.box(P.white, [0, 0.14 + 0.5, dz], [1.04, 1.0, 0.03]);
  b.box(T.barn[0], [-0.24, 0.14 + 0.46, dz + 0.012], [0.46, 0.9, 0.03]); b.box(T.barn[0], [0.24, 0.14 + 0.46, dz + 0.012], [0.46, 0.9, 0.03]);
  for (const s of [-1, 1]) { b.box(P.white, [s * 0.24, 0.6, dz + 0.03], [0.04, 1.0, 0.012], [0, 0, 0.5 * s]); b.box(P.white, [s * 0.24, 0.6, dz + 0.03], [0.04, 1.0, 0.012], [0, 0, -0.5 * s]); }
  // 屋顶：复折式，脊线沿 z
  const eave = [W / 2, 0.14 + WH], knee = [W * 0.34, 0.14 + WH + 0.5], ridge = [0, 0.14 + WH + 0.95];
  for (const s of [-1, 1]) {
    roofRowsZ(b, 0, D + 0.3, s * eave[0] * 1.06, eave[1] - 0.02, s * knee[0], knee[1], T.roofGray, 4, 1, 0.07);
    roofRowsZ(b, 0, D + 0.3, s * knee[0], knee[1], s * ridge[0] + s * 0.05, ridge[1], T.roofGray, 3, 2, 0.07);
  }
  b.cyl(T.roofGray[3], [0, ridge[1] + 0.03, 0], [0.05, D + 0.34, 0.05], [H, 0, 0], 6);
  for (const sz of [-1, 1]) {
    plateZ(b, T.barn[2], [[-W / 2, eave[1]], [W / 2, eave[1]], [knee[0], knee[1] - 0.02], [0, ridge[1] - 0.04], [-knee[0], knee[1] - 0.02]], sz * (D / 2) - (sz < 0 ? 0.02 : 0), 0.02);
  }
  // 阁楼窗（圆）
  b.ball(P.white, [0, ridge[1] - 0.38, D / 2 + 0.03], [0.2, 0.2, 0.03], null, [10, 6]);
  b.ball(P.ink, [0, ridge[1] - 0.38, D / 2 + 0.05], [0.14, 0.14, 0.02], null, [10, 6]);
  b.ball(0xf5d97a, [0, ridge[1] - 0.44, D / 2 + 0.065], [0.1, 0.05, 0.01], null, [6, 4]);
  for (const sx of [-1, 1]) for (const z of [-0.55, 0.45]) { b.box(P.white, [sx * (W / 2 + 0.01), 0.72, z], [0.02, 0.32, 0.32]); b.glowBox(P.glass, [sx * (W / 2 + 0.02), 0.72, z], [0.012, 0.24, 0.24]); }
  return b;
}
function silo() {
  const b = builder();
  const r = 0.6;
  b.cylT(T.stone[2], [0, 0.1, 0], r + 0.04, r + 0.08, 0.2, null, 16);
  b.cylT(T.barn[2], [0, 1.0, 0], r, r, 1.6, null, 16);
  b.cyl(T.barn[3], [-0.09, 1.0, 0.05], [0.12, 1.6, 0.5], null, 8);
  for (const y of [0.55, 1.0, 1.45, 1.8]) b.ring(T.barn[0], [0, y, 0], r + 0.005, [H, 0, 0], 0.03);
  b.ball(T.roofGray[2], [0, 1.82, 0], [r * 1.02, 0.55, r * 1.02], null, [14, 7]);
  b.ball(T.roofGray[3], [-0.12, 1.95, 0.08], [0.3, 0.2, 0.3], null, [8, 5]);
  b.cyl(T.stone[1], [0, 2.45, 0], [0.025, 0.2, 0.025], null, 4);
  for (const s of [-1, 1]) b.cyl(T.stone[0], [s * 0.1, 0.9, r + 0.02], [0.012, 1.5, 0.012], null, 4);
  for (let y = 0.3; y < 1.6; y += 0.18) b.cyl(T.stone[0], [0, y, r + 0.02], [0.01, 0.2, 0.01], [0, 0, H], 4);
  return b;
}
function henhouse(o = {}) {
  const b = builder();
  for (const x of [-0.45, 0.45]) for (const z of [-0.3, 0.3]) b.cyl(T.wood[1], [x, 0.1, z], [0.04, 0.2, 0.04], null, 5);
  b.box(T.wood[2], [0, 0.5, 0], [1.25, 0.6, 0.95]);
  for (let i = 0; i < 5; i++) b.box(i % 2 ? T.wood[3] : T.wood[1], [0, 0.26 + i * 0.12, 0.482], [1.25, 0.06, 0.012]);
  if (o.open) b.box(P.ink, [0, 0.4, 0.49], [0.3, 0.34, 0.012]);
  else { b.box(T.wood[1], [0, 0.4, 0.492], [0.3, 0.34, 0.012]); for (let i = 0; i < 3; i++) b.box(T.wood[3], [-0.1 + i * 0.1, 0.4, 0.5], [0.025, 0.32, 0.01]); b.ball(T.hay[2], [0.1, 0.4, 0.51], 0.02, null, [4, 3]); }
  b.box(P.white, [0, 0.58, 0.488], [0.4, 0.04, 0.012]);
  for (const s of [-1, 1]) b.box(P.white, [s * 0.18, 0.4, 0.489], [0.04, 0.34, 0.012]);
  b.glowBox(P.glass, [0.52, 0.55, 0.49], [0.18, 0.18, 0.012]); b.box(P.white, [0.52, 0.55, 0.484], [0.23, 0.23, 0.012]);
  // 屋顶（脊线沿 x）
  roofRowsX(b, 0, 1.45, -0.6, 0.78, 0, 1.22, T.roofRed, 4, 3);
  roofRowsX(b, 0, 1.45, 0.6, 0.78, 0, 1.22, T.roofRed, 4, 4);
  b.cyl(T.roofRed[3], [0, 1.23, 0], [0.04, 1.5, 0.04], [0, 0, H], 6);
  plateX(b, T.wood[2], [[-0.5, 0.8], [0.5, 0.8], [0, 1.2]], -0.62, 0.02); plateX(b, T.wood[2], [[-0.5, 0.8], [0.5, 0.8], [0, 1.2]], 0.6, 0.02);
  // 小坡道
  b.box(T.wood[2], [0, 0.17, 0.74], [0.3, 0.04, 0.5], [0.6, 0, 0]);
  for (let i = 0; i < 4; i++) b.box(T.wood[0], [0, 0.12 + i * 0.07, 0.6 + i * 0.12], [0.3, 0.015, 0.02]);
  // 一侧的产蛋箱
  b.box(T.wood[3], [-0.8, 0.45, 0], [0.36, 0.3, 0.5]);
  roofRowsX(b, -0.8, 0.5, -0.3, 0.6, 0.0, 0.7, T.roofRed, 2, 5); roofRowsX(b, -0.8, 0.5, 0.3, 0.6, 0.0, 0.7, T.roofRed, 2, 6);
  b.ball(P.ink, [-0.8, 0.45, 0.255], [0.09, 0.1, 0.02], null, [6, 4]);
  return b;
}
function cowshed() {
  const b = builder();
  const W = 2.75, D = 1.62;
  b.box(T.hay[1], [0, 0.03, 0], [W, 0.06, D]);
  b.box(T.wood[2], [0, 0.6, -D / 2 + 0.05], [W, 1.2, 0.1]);
  for (let i = 0; i < 13; i++) b.box(i % 2 ? T.wood[1] : T.wood[3], [-W / 2 + 0.1 + i * (W - 0.2) / 12, 0.6, -D / 2 + 0.11], [0.018, 1.2, 0.012]);
  for (const s of [-1, 1]) b.box(T.wood[2], [s * (W / 2 - 0.05), 0.55, 0], [0.1, 1.1, D]);
  for (const x of [-W / 2 + 0.07, 0, W / 2 - 0.07]) logPost(b, x, D / 2 - 0.05, 1.05);
  // 单坡屋顶：后高前低
  const rows = 6;
  for (let i = 0; i < rows; i++) {
    const t = (i + 0.5) / rows, z = -D / 2 - 0.25 + t * (D + 0.5), y = 1.38 - t * 0.38;
    b.box(T.roofRed[i % 2 ? 1 : 2], [0, y, z], [W + 0.4, 0.06, (D + 0.5) / rows + 0.02], [Math.atan2(0.38, D + 0.5) * -1 + 0, 0, 0]);
    b.box(T.roofRed[3], [0, y + 0.015, z + 0.1], [W + 0.4, 0.035, 0.025], [-Math.atan2(0.38, D + 0.5), 0, 0]);
  }
  b.box(T.roofRed[0], [0, 0.99, D / 2 + 0.27], [W + 0.4, 0.05, 0.04]);
  b.box(T.wood[1], [0, 0.17, 0.32], [2.0, 0.32, 0.36]);
  b.ball(0xe8c25a, [0, 0.34, 0.32], [0.95, 0.07, 0.14], null, [8, 4]);
  roundBale(b, -0.8, 0.28, -0.35, 0.28, 0.7, [0xc99a3a, 0xe8c25a, 0xf5d97a, 0xfbe9a0]);
  return b;
}
function windmill() {
  const b = builder();
  b.cylT(T.stone[2], [0, 0.3, 0], 0.78, 0.86, 0.6, null, 14);
  b.cylT(T.lumber[3], [0, 1.35, 0], 0.5, 0.74, 1.9, null, 14);
  b.cyl(T.lumber[1], [0.18, 1.35, 0.1], [0.12, 1.9, 0.5], null, 6);
  b.ring(T.barn[2], [0, 1.4, 0], 0.62, [H, 0, 0], 0.07);
  b.cone(T.barn[2], [0, 2.7, 0], [0.64, 0.8, 0.64], null, 14);
  b.cone(T.barn[3], [-0.1, 2.72, 0.1], [0.4, 0.62, 0.4], null, 10);
  b.ball(T.barn[0], [0, 3.12, 0], 0.07, null, [6, 4]);
  b.cylT(T.wood[1], [0, 0.35, 0.82], 0.11, 0.12, 0.7, null, 8); b.ball(T.wood[1], [0, 0.7, 0.82], [0.12, 0.08, 0.04], null, [8, 5]);
  b.glowBall(P.glass, [0, 1.3, 0.62], [0.1, 0.13, 0.03]);
  b.cylT(T.wood[1], [0, 2.15, 0.62], 0.05, 0.06, 0.4, [H, 0, 0], 6);
  const hub = [0, 2.15, 0.85];
  b.ball(T.barn[1], hub, 0.12, null, [8, 6]);
  for (let k = 0; k < 4; k++) {
    const a = PI / 4 + (k * PI) / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    b.box(T.wood[1], [hub[0] + ca * 0.55, hub[1] + sa * 0.55, hub[2] + 0.02], [1.1, 0.06, 0.05], [0, 0, a]);
    b.box(P.sheet, [hub[0] + ca * 0.62 - sa * 0.16, hub[1] + sa * 0.62 + ca * 0.16, hub[2] + 0.03], [0.76, 0.28, 0.025], [0, 0, a]);
    b.box(P.sheetShade, [hub[0] + ca * 0.62 - sa * 0.16, hub[1] + sa * 0.62 + ca * 0.16, hub[2] + 0.015], [0.78, 0.3, 0.012], [0, 0, a]);
    for (let j = 0; j < 3; j++) b.box(T.wood[2], [hub[0] + ca * (0.34 + j * 0.2) - sa * 0.16, hub[1] + sa * (0.34 + j * 0.2) + ca * 0.16, hub[2] + 0.045], [0.02, 0.28, 0.012], [0, 0, a]);
  }
  return b;
}

// ---- 木屋 / 农舍：圆木墙 + 瓦片斜屋顶 + 烟囱 + 窗框 + 门廊
function cabinBuilder(o = {}) {
  const b = builder();
  const big = !!o.big;
  const W = big ? 3.25 : 2.5, D = big ? 2.25 : 1.9;
  const roof = o.roof === 'red' ? T.roofRed : T.roofGreen;
  const rnd = rng((o.seed || 1) * 97);
  b.box(T.stone[1], [0, 0.07, 0], [W + 0.1, 0.14, D + 0.1]);
  for (let i = 0; i < 12; i++) b.ball(T.stone[2 + (i % 2)], [-W / 2 + (i + 0.5) * (W / 12), 0.08, D / 2 + 0.05], [0.12, 0.07, 0.04], null, [5, 4]);
  // 圆木墙：每一层 4 根圆木，转角处圆木头伸出来
  const R = 0.075, courses = big ? 8 : 7;
  for (let i = 0; i < courses; i++) {
    const y = 0.14 + R + i * R * 1.85, c = T.wood[2 + (i % 2)], odd = i % 2;
    const ext = 0.09;
    for (const sz of [-1, 1]) b.cyl(c, [0, y, sz * (D / 2 - R * 0.4)], [R, W + (odd ? ext * 2 : 0), R], [0, 0, H], 7);
    for (const sx of [-1, 1]) b.cyl(T.wood[1 + (i % 2) * 2 - (i % 2)], [sx * (W / 2 - R * 0.4), y + R * 0.15, 0], [R, D + (odd ? 0 : ext * 2), R], [H, 0, 0], 7);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(T.lumber[2], [sx * (W / 2 + (odd ? ext : 0)), y, sz * (D / 2 - R * 0.4)], [R * 0.8, 0.012, R * 0.8], [0, 0, H], 7);
  }
  const WH = 0.14 + courses * R * 1.85 + 0.02;
  // 瓦片屋顶，脊线沿 x，南面朝镜头
  const rise = big ? 0.85 : 0.72, ovh = 0.17, ovx = 0.18;
  roofRowsX(b, 0, W + ovx * 2, D / 2 + ovh, WH - 0.02, 0, WH + rise, roof, big ? 7 : 6, o.seed || 1);
  roofRowsX(b, 0, W + ovx * 2, -D / 2 - ovh, WH - 0.02, 0, WH + rise, roof, big ? 7 : 6, (o.seed || 1) + 3);
  b.cyl(roof[3], [0, WH + rise + 0.015, 0], [0.05, W + ovx * 2 + 0.02, 0.05], [0, 0, H], 6);
  for (const sx of [-1, 1]) plateX(b, T.wood[2], [[-D / 2 - 0.02, WH], [D / 2 + 0.02, WH], [0, WH + rise - 0.02]], sx * (W / 2) - (sx > 0 ? 0 : 0.02), 0.02);
  // 烟囱（石头）
  const cx = W / 2 - 0.4, cz = -D * 0.18;
  b.box(T.stone[2], [cx, WH + rise * 0.55, cz], [0.3, rise * 1.05 + 0.5, 0.3]);
  for (let i = 0; i < 6; i++) b.box(i % 2 ? T.stone[3] : T.stone[1], [cx, WH + 0.25 + i * 0.22, cz + 0.152], [0.28, 0.05, 0.01]);
  b.box(T.stone[0], [cx, WH + rise * 1.1 + 0.26, cz], [0.38, 0.06, 0.38]);
  b.cyl(P.ink, [cx, WH + rise * 1.1 + 0.3, cz], [0.1, 0.03, 0.1], null, 6);
  // 门
  const dz = D / 2 + R * 0.65;
  b.box(P.white, [0, 0.14 + 0.46, dz], [0.66, 0.92, 0.03]);
  b.box(T.wood[1], [0, 0.14 + 0.43, dz + 0.015], [0.52, 0.84, 0.03]);
  b.ball(P.white, [0, 0.14 + 0.88, dz], [0.33, 0.14, 0.03], null, [10, 5]);
  b.ball(T.wood[1], [0, 0.14 + 0.86, dz + 0.016], [0.26, 0.11, 0.03], null, [10, 5]);
  b.box(T.wood[0], [0, 0.14 + 0.43, dz + 0.034], [0.02, 0.8, 0.012]);
  for (const s2 of [-1, 1]) b.box(T.wood[2], [s2 * 0.13, 0.14 + 0.43, dz + 0.036], [0.2, 0.7, 0.01]);
  b.ball(T.hay[2], [0.16, 0.14 + 0.42, dz + 0.045], 0.03, null, [5, 4]);
  // 窗（带窗框、十字格和花盆箱）
  const wins = big ? [-1.15, -0.62, 0.62, 1.15] : [-0.82, 0.82];
  for (const wx of wins) {
    if (Math.abs(wx) < 0.5) continue;
    b.box(P.white, [wx, 0.72, dz - 0.005], [0.5, 0.5, 0.03]);
    b.glowBox(P.glass, [wx, 0.72, dz + 0.012], [0.4, 0.4, 0.012]);
    b.box(P.white, [wx, 0.72, dz + 0.02], [0.035, 0.42, 0.012]); b.box(P.white, [wx, 0.72, dz + 0.02], [0.42, 0.035, 0.012]);
    b.box(T.wood[1], [wx, 0.44, dz + 0.055], [0.54, 0.08, 0.11]);
    for (let f = 0; f < 5; f++) b.ball(pick(rnd, [P.flowerPink, P.flowerYellow, P.flowerRed, P.flowerWhite]), [wx - 0.2 + f * 0.1, 0.52, dz + 0.065], 0.045, null, [5, 4]);
  }
  for (const sx of [-1, 1]) { b.box(P.white, [sx * (W / 2 + 0.01), 0.7, 0.1], [0.03, 0.44, 0.36]); b.glowBox(P.glass, [sx * (W / 2 + 0.025), 0.7, 0.1], [0.012, 0.34, 0.28]); }
  // 门廊
  const pw = big ? 1.5 : 1.05, pd = 0.5;
  b.box(T.wood[2], [0, 0.07, D / 2 + pd / 2 + 0.05], [pw, 0.1, pd]);
  for (let i = 0; i < 6; i++) b.box(T.wood[1], [-pw / 2 + 0.1 + i * (pw - 0.2) / 5, 0.125, D / 2 + pd / 2 + 0.05], [0.012, 0.01, pd]);
  for (const s of [-1, 1]) { b.cylT(T.wood[3], [s * (pw / 2 - 0.06), 0.55, D / 2 + pd], 0.04, 0.05, 0.95, null, 7); b.cyl(T.wood[2], [s * (pw / 2 - 0.06), 0.35, D / 2 + pd * 0.5 + 0.05], [0.02, pd, 0.02], [H, 0, 0], 5); }
  b.cyl(T.wood[2], [0, 0.28, D / 2 + pd + 0.02], [0.02, pw - 0.2, 0.02], [0, 0, H], 5);
  b.cyl(T.wood[3], [0, 1.0, D / 2 + pd], [0.035, pw + 0.1, 0.035], [0, 0, H], 6);
  if (big) {
    roofRowsX(b, 0, pw + 0.2, D / 2 + pd + 0.15, 0.96, D / 2 - 0.05, WH - 0.02 + 0.0, roof, 2, 9);
    b.ball(T.stone[2], [0.85, 0.08, D / 2 + 0.45], [0.2, 0.1, 0.16], null, [6, 4]);
  }
  return b;
}
const cabin = (o) => cabinBuilder(o);
const farmhouse = (o) => cabinBuilder({ big: true, roof: 'red', ...o });

/** 盖到一半的木屋框架（方料）。 */
function cabinFrame() {
  const b = builder();
  const W = 2.5, D = 1.9, H1 = 1.0, wd = T.lumber;
  b.box(T.stone[2], [0, 0.07, 0], [W + 0.1, 0.14, D + 0.1]);
  for (let i = 0; i < 14; i++) b.box(i % 2 ? wd[3] : wd[2], [0, 0.155, -D / 2 + 0.07 + i * (D - 0.14) / 13], [W, 0.03, (D - 0.14) / 13 - 0.012]);
  const px = [-W / 2, -W / 4, 0, W / 4, W / 2];
  for (const x of px) for (const z of [-D / 2, D / 2]) b.box(wd[2], [x, 0.14 + H1 / 2, z], [0.1, H1, 0.1]);
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 6, D / 6]) b.box(wd[2], [x, 0.14 + H1 / 2, z], [0.1, H1, 0.1]);
  b.box(wd[3], [0, 0.14 + H1, -D / 2], [W + 0.1, 0.1, 0.12]); b.box(wd[3], [0, 0.14 + H1, D / 2], [W + 0.1, 0.1, 0.12]);
  for (const x of [-W / 2, W / 2]) b.box(wd[3], [x, 0.14 + H1, 0], [0.12, 0.1, D]);
  for (let i = 0; i < 5; i++) b.box(i % 2 ? wd[3] : wd[1], [0, 0.22 + i * 0.12, -D / 2 + 0.07], [W - 0.1, 0.1, 0.03]);
  for (let i = 0; i < 4; i++) b.box(i % 2 ? wd[3] : wd[1], [-W / 2 + 0.07, 0.22 + i * 0.12, 0.1], [0.03, 0.1, D - 0.3]);
  const rise = 0.8;
  for (const x of px.slice(0, 4)) {
    const a = Math.atan2(rise, D / 2);
    for (const s of [-1, 1]) b.box(wd[2], [x, 0.14 + H1 + rise / 2 + 0.05, s * D / 4], [0.08, Math.hypot(rise, D / 2), 0.08], [s * a, 0, 0]);
  }
  b.box(wd[3], [-W / 4, 0.14 + H1 + rise + 0.05, 0], [W * 0.75, 0.08, 0.1]);
  for (let i = 0; i < 3; i++) b.box(wd[2 + (i % 2)], [-W / 4 - 0.1, 0.14 + H1 + 0.2 + i * 0.2, -D / 4 + 0.15 - i * 0.04], [W * 0.5, 0.03, 0.2], [-0.8, 0, 0]);
  b.box(wd[3], [W / 2 + 0.55, 0.05, 0.1], [0.8, 0.04, 0.2], [0, 0.3, 0]); b.box(wd[2], [W / 2 + 0.55, 0.1, 0.12], [0.7, 0.04, 0.2], [0, 0.35, 0]);
  for (let i = 0; i < 8; i++) b.ball(wd[0], [-W / 2 + (i % 4) * 0.5 + 0.2, 0.02, D / 2 + 0.2 + (i % 3) * 0.1], [0.07, 0.015, 0.07], null, [4, 3]);
  return b;
}
function scaffold() {
  const b = builder();
  const L = 2.75, D = 0.6, wd = T.lumber;
  for (const x of [-L / 2, 0, L / 2]) for (const z of [-D / 2, D / 2]) b.cyl(wd[2], [x, 0.95, z], [0.045, 1.9, 0.045], null, 6);
  for (const y of [0.6, 1.2]) {
    b.box(wd[3], [0, y, 0], [L + 0.1, 0.05, D + 0.05]);
    for (let i = 0; i < 12; i++) b.box(wd[1], [-L / 2 + 0.1 + i * 0.23, y + 0.026, 0], [0.012, 0.005, D]);
    for (const z of [-D / 2, D / 2]) b.cyl(wd[2], [0, y + 0.3, z], [0.02, L, 0.02], [0, 0, H], 5);
  }
  for (const s of [-1, 1]) { b.cyl(wd[1], [s * L / 4, 0.6, D / 2 + 0.01], [0.015, 1.4, 0.015], [0, 0, s * 0.8], 4); b.cyl(wd[1], [s * L / 4, 1.2, D / 2 + 0.01], [0.015, 1.4, 0.015], [0, 0, -s * 0.8], 4); }
  for (const x of [L / 2 + 0.25, L / 2 + 0.55]) b.cyl(wd[1], [x, 0.6, 0.1], [0.02, 1.35, 0.02], [0, 0, -0.18], 4);
  for (let y = 0.15; y < 1.15; y += 0.2) b.cyl(wd[2], [L / 2 + 0.4 - y * 0.18, y, 0.1], [0.012, 0.32, 0.012], [0, 0, H], 4);
  return b;
}
function lumberPile() {
  const b = builder();
  const wd = T.lumber;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    const len = 1.5 - ((r + c) % 3) * 0.1;
    b.box(wd[2 + ((r + c) % 2)], [0, 0.07 + r * 0.15, (c - 1) * 0.25], [len, 0.13, 0.22]);
    b.box(wd[3], [len / 2 + 0.003, 0.07 + r * 0.15, (c - 1) * 0.25], [0.01, 0.12, 0.2]);
    b.box(wd[0], [0, 0.005 + r * 0.15, (c - 1) * 0.25], [len, 0.01, 0.22]);
  }
  b.box(wd[3], [0.1, 0.66, 0], [1.3, 0.1, 0.4], [0, 0.1, 0]);
  b.box(wd[2], [0.3, 0.16, 0.5], [1.1, 0.07, 0.2], [0, -0.3, 0.0]);
  return b;
}
function sawhorse() {
  const b = builder();
  const wd = T.wood;
  for (const x of [-0.4, 0.4]) for (const s of [-1, 1]) b.cyl(wd[2], [x, 0.26, s * 0.12], [0.03, 0.56, 0.03], [s * 0.35, 0, 0], 5);
  b.box(wd[3], [0, 0.5, 0], [1.0, 0.07, 0.1]);
  b.cyl(T.lumber[2], [0.0, 0.64, 0], [0.09, 1.0, 0.09], [0, 0, H], 8);
  b.cyl(T.lumber[3], [0.5, 0.64, 0], [0.075, 0.01, 0.075], [0, 0, H], 8);
  b.box(T.stone[2], [-0.05, 0.75, 0], [0.34, 0.07, 0.01]); b.box(wd[1], [-0.22, 0.78, 0], [0.04, 0.12, 0.02]);
  for (let i = 0; i < 7; i++) b.ball(T.lumber[3], [(hash3(i, 1, 2) - 0.5) * 1.2, 0.02, 0.2 + hash3(i, 3, 4) * 0.2], [0.05, 0.015, 0.05], null, [4, 3]);
  return b;
}
function cloud(o = {}) {
  const b = builder();
  const r = rng((o.seed || 1) * 3);
  for (let i = 0; i < 6; i++) b.ball(i % 2 ? 0xffffff : 0xeef6ff, [(i - 2.5) * 0.45, 0.3 + r() * 0.2, (r() - 0.5) * 0.3], 0.35 + r() * 0.2, null, [8, 6]);
  return b;
}
function farmGate() {
  const b = builder();
  const L = 3.0;
  for (const s of [-1, 1]) {
    b.cylT(T.wood[2], [s * (L / 2), 0.95, 0], 0.09, 0.12, 1.9, null, 8);
    b.ball(T.stone[2], [s * (L / 2), 0.05, 0], [0.22, 0.1, 0.22], null, [7, 4]);
    b.ball(T.wood[3], [s * (L / 2), 1.92, 0], [0.14, 0.1, 0.14], null, [7, 4]);
    roundBale(b, s * (L / 2), 2.12, 0, 0.1, 0.18, [0xc99a3a, 0xe8c25a, 0xf5d97a, 0xfbe9a0]);
  }
  b.cyl(T.wood[3], [0, 1.85, 0], [0.08, L, 0.08], [0, 0, H], 8);
  b.box(P.sack, [0, 1.35, 0.03], [2.2, 0.8, 0.07]);
  b.box(T.wood[1], [0, 1.78, 0.03], [2.3, 0.05, 0.09]); b.box(T.wood[1], [0, 0.93, 0.03], [2.3, 0.05, 0.09]);
  for (const s of [-1, 1]) b.cyl(P.rope, [s * 1.0, 1.77, 0.05], [0.012, 0.4, 0.012], null, 3);
  const G = { F: ['###', '#..', '##.', '#..', '#..'], A: ['.#.', '#.#', '###', '#.#', '#.#'], R: ['##.', '#.#', '##.', '#.#', '#.#'], M: ['#.#', '###', '###', '#.#', '#.#'] };
  let x0 = -0.76;
  for (const ch of 'FARM') {
    G[ch].forEach((row, j) => { for (let i = 0; i < 3; i++) if (row[i] === '#') b.box(T.barn[1], [x0 + i * 0.1, 1.15 + (4 - j) * 0.1, 0.075], [0.1, 0.1, 0.03]); });
    x0 += 0.42;
  }
  return b;
}

// ---------------------------------------------------------------- 旧的地面块（只用于物件拼图；地图里的地面是 map.js 的地形网格）
function groundBlock(o, road) {
  const b = builder();
  const w = (o.w || 32) / 16, d = (o.d || 32) / 16, r = rng(o.seed || 3);
  b.box(road ? T.road[1] : T.grass[1], [0, 0.1, 0], [w, 0.2, d]);
  for (let i = 0; i < 10; i++) b.ball(road ? T.road[2 + (i % 2)] : T.grass[2 + (i % 2)], [(r() - 0.5) * w * 0.8, 0.2, (r() - 0.5) * d * 0.8], [0.25, 0.01, 0.2], null, [6, 3]);
  return b;
}
const groundGrass = (o) => groundBlock(o, false);
const groundRoad = (o) => groundBlock(o, true);

// ---------------------------------------------------------------- 注册表
const BUILDERS = {
  barn, silo, henhouse, cowshed, windmill,
  cabin, farmhouse, cabin_frame: cabinFrame, scaffold, lumber_pile: lumberPile, sawhorse, well, mailbox, firewood, bench,
  flower_bed: flowerBed, trellis, fountain, bridge, signpost, lamp,
  fence, gate, fence_hole: (o) => fence({ ...o, style: 'picket', hole: true }), farm_gate: farmGate, hedge,
  hay_square: hayBale, hay_round: hayRound,
  crop_bed: cropBed, crop_radish: cropRadish, crop_cabbage: cropCabbage, crop_pumpkin: cropPumpkin, radish_big: radishBig,
  clothesline, apple_tree: appleTree, tree: plainTree, pink_tree: pinkTree, pine, bush, flowers, beehive,
  stump, rock, mushroom, barrel, crate, reeds, lily,
  mud_pit: mudPit, water_pond: waterPond,
  milk_can: milkCan, wheelbarrow, scarecrow, trough,
  ground_grass: groundGrass, ground_road: groundRoad,
  cloud,
};

/** 全部物件种类。 */
export const FARM_PROPS = Object.keys(BUILDERS);

const geoCache = new Map();

/** 只造几何（带缓存）。geometry.userData.size = { w, h, d }；userData.glow = 夜里发光的部件（窗玻璃、灯泡）的几何，没有则 undefined。 */
export function createFarmPropGeometry(kind, opts = {}) {
  const fn = BUILDERS[kind];
  if (!fn) throw new Error('未知的农场物件：' + kind + '（可用：' + FARM_PROPS.join(', ') + '）');
  const key = kind + ':' + JSON.stringify(opts);
  let geo = geoCache.get(key);
  if (!geo) { geo = fn(opts).build(); geoCache.set(key, geo); }
  return geo;
}

/** 创建一个物件（静态，1 个网格，原点在底面中心，正面朝 +Z）。几何按 种类+参数 缓存共享；发光部件不包含在内（见 createFarmPropGeometry）。 */
export function createFarmProp(kind, opts = {}) {
  const geo = createFarmPropGeometry(kind, opts);
  const mesh = new THREE.Mesh(geo, farmToonMaterial);
  mesh.name = 'farm_' + kind;
  const sky = kind === 'cloud';
  mesh.castShadow = !sky;
  mesh.receiveShadow = !sky;
  mesh.userData.kind = kind;
  mesh.userData.size = geo.userData.size;
  if (geo.userData.glow) {
    const gm = new THREE.Mesh(geo.userData.glow, new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xb8d4f0 }));
    mesh.add(gm);
  }
  return mesh;
}

export { VOX };

export { builder as createShapeBuilder };

// =====================================================================================================
// 可互动物件：捣乱前 / 后的两种样子，以及切换时的小动画
// createInteractiveProp(inter, entry) → { id, kind, object, setState({ state, progress, done, muddy }), tick(dt) }
//  - inter：mapData 里 interactables 的一项（kind / crop / id）；entry：mapData 里 props 的一项（kind / opts / x / z / rot / s）。
//  - object 是一个 Group（位置、朝向、缩放已按 entry 设好；y 由调用者设）。没被捣乱时只显示 1 个静态网格（和以前一样 1 个 draw call），
//    第一次被捣乱才懒加载“动态部件”（实例化网格 / 活动的零件）并切过去；setState 可以每帧调用，状态没变就什么都不做。
//  - tick(dt) 推进过渡动画：只用预先分配好的临时对象，不分配内存；空闲时直接返回。
// =====================================================================================================
const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _Q2 = new THREE.Quaternion(), _E = new THREE.Euler();
const _P = new THREE.Vector3(), _S = new THREE.Vector3(), _CC = new THREE.Color();
const ICACHE = new Map();
const cached = (key, fn) => { let v = ICACHE.get(key); if (!v) { v = fn(); ICACHE.set(key, v); } return v; };
const damp = (c, t, dt, k = 12) => c + (t - c) * (1 - Math.exp(-k * dt));
const mkMesh = (geo) => { const m = new THREE.Mesh(geo, farmToonMaterial); m.castShadow = true; m.receiveShadow = true; return m; };
const mkInst = (geo, n) => { const m = new THREE.InstancedMesh(geo, farmToonMaterial, n); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; return m; };
const whiteGeo = (g) => cached('white:' + g.uuid, () => { const c = g.clone(); const a = c.attributes.color; for (let i = 0; i < a.array.length; i++) a.array[i] = 1; return c; });
const ballGeo = (seg = [7, 5]) => cached('ball' + seg, () => { const b = builder(); b.ball(0xffffff, [0, 0, 0], 1, null, seg); return b.build(); });
const pose = (m, x, y, z, rx, ry, rz, sx, sy, sz) => { _P.set(x, y, z); _Q.setFromEuler(_E.set(rx, ry, rz)); _S.set(sx, sy, sz); return m.compose(_P, _Q, _S); };
const hashf = (a, b, c = 0) => hash3(a, b, c, 77);
/** 弹簧：把 [pos, vel] 往目标拉，带一点过冲（用在甩开的门上）。 */
function spring(st, tgt, dt, k = 70, c = 8) {
  const n = Math.max(1, Math.ceil(dt / 0.012)), h = dt / n;
  for (let i = 0; i < n; i++) { st[1] += (k * (tgt - st[0]) - c * st[1]) * h; st[0] += st[1] * h; }
}

// ---- 作物畦：随 progress 一棵棵被拔掉，原位留土坑，拔出来的歪倒在畦边；done 时多一个大的
function makeCrop(c) {
  const crop = c.inter.crop || (c.entry.opts && c.entry.opts.crop) || 'radish';
  const lay = cropLayout(crop), N = lay.length;
  const sc = new Float32Array(N).fill(1), tg = new Float32Array(N).fill(1), fl = new Float32Array(N), ft = new Float32Array(N);
  let dyn = null, plants, pits, fallen, big, bigS = 0, bigT = 0, anim = false, pristine = true;
  const plantGeo = cached('cropPlant' + crop, () => { const b = builder(); cropPlant(b, crop, 0, 0, 1); return b.build(); });
  const bigScale = crop === 'radish' ? 1.7 : 1.9;
  function build() {
    dyn = new THREE.Group();
    dyn.add(mkMesh(cached('cropBase' + crop, () => { const b = builder(); cropBedBase(b, crop); return b.build(); })));
    plants = mkInst(plantGeo, N);
    pits = mkInst(cached('cropPit', () => { const b = builder(); b.ball(T.soil[0], [0, 0.152, 0], [0.1, 0.025, 0.1], null, [7, 3]); b.ball(T.soil[3], [0, 0.158, 0], [0.13, 0.012, 0.13], null, [7, 3]); return b.build(); }), N);
    fallen = mkInst(plantGeo, N);
    big = mkMesh(crop === 'radish' ? createFarmPropGeometry('radish_big') : plantGeo);
    big.visible = false;
    dyn.add(plants, pits, fallen, big);
    c.root.add(dyn);
    refresh();
  }
  function refresh() {
    for (let i = 0; i < N; i++) {
      const p = lay[i], k = Math.max(0.0001, sc[i] * p.s), sg = p.z < 0 ? -1 : 1;
      plants.setMatrixAt(i, pose(_M, p.x, (1 - sc[i]) * 0.1, p.z, 0, 0, 0, k, k, k));
      const ps = Math.max(0.0001, 1 - sc[i]);
      pits.setMatrixAt(i, pose(_M, p.x, 0, p.z, 0, 0, 0, ps, ps, ps));
      const f = Math.max(0.0001, fl[i] * p.s), ez = sg * (0.625 + 0.1 + 0.07 * hashf(i, 1));
      fallen.setMatrixAt(i, pose(_M, p.x + 0.12 * (hashf(i, 2) - 0.5), 0.1 * f, ez, sg * (1.25 + 0.2 * hashf(i, 3)), hashf(i, 4) * 6.28, 0.1, f, f, f));
    }
    plants.instanceMatrix.needsUpdate = pits.instanceMatrix.needsUpdate = fallen.instanceMatrix.needsUpdate = true;
    const bs = bigS * (1 + 0.22 * Math.sin(bigS * Math.PI)) * bigScale;
    big.visible = bigS > 0.01;
    big.position.set(1.0 + 0.34, 0, 0.18); big.scale.setScalar(Math.max(0.001, bs)); big.rotation.y = 0.5;
  }
  return {
    set(p, d) {
      const n = d ? N : Math.min(N, Math.floor(p * N + 1e-3));
      for (let i = 0; i < N; i++) { tg[i] = i < n ? 0 : 1; ft[i] = i < n ? 1 : 0; }
      bigT = d ? 1 : 0;
      pristine = n === 0 && !d;
      if (!pristine) { if (!dyn) build(); c.stat.visible = false; dyn.visible = true; }
      anim = true;
    },
    tick(dt) {
      if (!anim) return;
      let moving = false;
      for (let i = 0; i < N; i++) {
        sc[i] = damp(sc[i], tg[i], dt, 16); fl[i] = damp(fl[i], ft[i], dt, 11);
        if (Math.abs(sc[i] - tg[i]) > 0.004 || Math.abs(fl[i] - ft[i]) > 0.004) moving = true; else { sc[i] = tg[i]; fl[i] = ft[i]; }
      }
      bigS = damp(bigS, bigT, dt, 9); if (Math.abs(bigS - bigT) > 0.004) moving = true; else bigS = bigT;
      if (dyn) refresh();
      if (!moving) { anim = false; if (pristine) { c.stat.visible = true; if (dyn) dyn.visible = false; } }
    },
  };
}

// ---- 花坛：随 progress 花被踩扁，花瓣撒在周围
function makeFlowerBed(c) {
  const { W, D, items } = flowerBedLayout(c.entry.opts || {});
  const N = items.length;
  const order = items.map((_, i) => i).sort((a, b) => hashf(a, 9) - hashf(b, 9));
  const rank = new Int16Array(N); order.forEach((idx, r) => { rank[idx] = r; });
  const cu = new Float32Array(N), tg = new Float32Array(N);
  let dyn = null, heads, stems, petals, anim = false, pristine = true;
  function build() {
    dyn = new THREE.Group();
    dyn.add(mkMesh(cached('fbBase' + W + D, () => { const b = builder(); flowerBedBase(b, W, D); return b.build(); })));
    heads = mkInst(ballGeo([6, 4]), N);
    stems = mkInst(cached('fbStem', () => { const b = builder(); b.ball(T.grass[1], [0, 0, 0], 1, null, [5, 3]); return b.build(); }), N);
    petals = mkInst(ballGeo([5, 3]), N * 2);
    for (let i = 0; i < N; i++) { _CC.set(items[i].c); heads.setColorAt(i, _CC); petals.setColorAt(i * 2, _CC); petals.setColorAt(i * 2 + 1, _CC); }
    dyn.add(stems, heads, petals);
    c.root.add(dyn);
    refresh();
  }
  function refresh() {
    for (let i = 0; i < N; i++) {
      const f = items[i], u = cu[i];
      heads.setMatrixAt(i, pose(_M, f.x, f.h - u * (f.h - 0.17), f.z, 0, 0, 0, 0.055 * (1 + 0.45 * u), 0.055 * (1 - 0.8 * u), 0.055 * (1 + 0.45 * u)));
      stems.setMatrixAt(i, pose(_M, f.x, 0.2 - 0.05 * u, f.z, 0, 0, 0, 0.05 * (1 + 0.5 * u), 0.05 * (1 - 0.7 * u), 0.05 * (1 + 0.5 * u)));
      for (let j = 0; j < 2; j++) {
        const a = hashf(i, 20 + j) * 6.28, r = 0.1 + hashf(i, 30 + j) * 0.32, ps = Math.max(0.0001, 0.04 * u);
        petals.setMatrixAt(i * 2 + j, pose(_M, f.x + Math.cos(a) * r * u, 0.17, f.z + Math.sin(a) * r * u, 0, a, 0, ps * 1.4, ps * 0.3, ps));
      }
    }
    heads.instanceMatrix.needsUpdate = stems.instanceMatrix.needsUpdate = petals.instanceMatrix.needsUpdate = true;
    if (heads.instanceColor) { heads.instanceColor.needsUpdate = true; petals.instanceColor.needsUpdate = true; }
  }
  return {
    set(p, d) {
      const n = d ? N : Math.min(N, Math.floor(p * N + 1e-3));
      for (let i = 0; i < N; i++) tg[i] = rank[i] < n ? 1 : 0;
      pristine = n === 0;
      if (!pristine) { if (!dyn) build(); c.stat.visible = false; dyn.visible = true; }
      anim = true;
    },
    tick(dt) {
      if (!anim) return;
      let moving = false;
      for (let i = 0; i < N; i++) { cu[i] = damp(cu[i], tg[i], dt, 12); if (Math.abs(cu[i] - tg[i]) > 0.004) moving = true; else cu[i] = tg[i]; }
      if (dyn) refresh();
      if (!moving) { anim = false; if (pristine) { c.stat.visible = true; if (dyn) dyn.visible = false; } }
    },
  };
}

// ---- 晾衣绳：床单掉在地上堆成一团（muddy 时带泥爪印）
const SHEETS = [[-1.0, 0.85, P.sheet, P.sheetShade, 0.9], [0.05, 0.85, P.sheet, P.sheetShade, 0.9], [1.1, 0.6, P.towel, P.denim, 0.62]];
function makeClothesline(c) {
  let dyn = null; const sheets = [], prints = [];
  let u = 0, tgt = 0, anim = false, muddy = false;
  function build() {
    dyn = new THREE.Group();
    dyn.add(mkMesh(cached('clBase', () => {
      const b = builder(); const L = 3.25;
      for (const s of [-1, 1]) logPost(b, s * (L / 2 - 0.06), 0, 1.5);
      b.cyl(P.rope, [0, 1.38, 0], [0.012, L - 0.1, 0.012], [0, 0, H], 4);
      return b.build();
    })));
    SHEETS.forEach(([x, w, col, sh, h], i) => {
      const g = cached('clSheet' + i, () => {
        const b = builder(), n = 4;
        for (let k = 0; k < n; k++) b.box(k % 2 ? sh : col, [-w / 2 + (k + 0.5) * (w / n), -h / 2, (k % 2 - 0.5) * 0.04], [w / n + 0.01, h, 0.025]);
        b.box(sh, [0, -h + 0.02, 0], [w, 0.04, 0.04]);
        for (const dx of [-0.3, 0.3]) b.box(T.wood[3], [dx * w, 0.02, 0], [0.025, 0.07, 0.03]);
        return b.build();
      });
      const m = mkMesh(g); m.position.set(x, 1.36, 0); dyn.add(m); sheets.push(m);
      const pg = cached('clPrints', () => {
        const b = builder();
        for (const [px, py] of [[-0.12, -0.2], [0.1, -0.32], [-0.05, -0.5], [0.14, -0.6]]) {
          b.ball(T.soil[1], [px, py, 0.02], [0.06, 0.045, 0.01], null, [5, 3]);
          for (const t of [-1, 0, 1]) b.ball(T.soil[1], [px + t * 0.035, py + 0.06, 0.02], [0.016, 0.016, 0.01], null, [4, 3]);
        }
        return b.build();
      });
      const pm = new THREE.Mesh(pg, farmToonMaterial); pm.visible = false; m.add(pm); prints.push(pm);
    });
    c.root.add(dyn);
    refresh();
  }
  function refresh() {
    const e = u * u * (3 - 2 * u);
    for (let i = 0; i < 3; i++) {
      const m = sheets[i], x = SHEETS[i][0], k = i - 1;
      m.position.set(x * (1 - 0.65 * e) + k * 0.1 * e, 1.36 + (0.04 + i * 0.012 - 1.36) * e + Math.sin(e * Math.PI) * 0.18, e * (0.22 + 0.14 * i));
      m.rotation.set(-e * (H - 0.05 * i), e * (0.7 * k + 0.3), e * 0.15 * k);
      m.scale.set(1 - 0.05 * e, 1 - 0.12 * e, 1);
    }
  }
  return {
    set(p, d, m) {
      tgt = d ? 1 : 0; muddy = !!m;
      if (!dyn && (tgt || u > 0)) build();
      if (dyn) { c.stat.visible = false; dyn.visible = true; for (let i = 0; i < 3; i++) prints[i].visible = muddy; }
      anim = true;
    },
    tick(dt) {
      if (!anim) return;
      u = damp(u, tgt, dt, 7);
      const moving = Math.abs(u - tgt) > 0.004; if (!moving) u = tgt;
      if (dyn) refresh();
      if (!moving) { anim = false; if (tgt === 0) { c.stat.visible = true; if (dyn) dyn.visible = false; } }
    },
  };
}

// ---- 翻倒的桶 / 箱 / 食槽 / 信箱：翻倒、洒出东西
const SPILLS = {
  milk: () => { const b = builder(); b.ball(0xf4f4ee, [0, 0.012, 0], [0.34, 0.012, 0.22], null, [9, 3]); b.ball(0xffffff, [0.05, 0.02, -0.03], [0.2, 0.008, 0.12], null, [7, 3]); for (let i = 0; i < 4; i++) b.ball(0xf4f4ee, [(i - 1.5) * 0.17, 0.02, 0.2 + (i % 2) * 0.05], 0.03, null, [4, 3]); return b.build(); },
  water: () => { const b = builder(); b.ball(T.water[2], [0, 0.012, 0], [0.4, 0.012, 0.28], null, [9, 3]); b.ball(T.water[3], [0.05, 0.02, -0.03], [0.24, 0.008, 0.14], null, [7, 3]); for (let i = 0; i < 4; i++) b.ball(T.water[2], [(i - 1.5) * 0.19, 0.02, 0.25 + (i % 2) * 0.05], 0.03, null, [4, 3]); return b.build(); },
  feed: () => { const b = builder(); b.ball(0xe8c25a, [0, 0.05, 0], [0.5, 0.07, 0.3], null, [8, 4]); b.ball(0xf5d97a, [0.05, 0.1, 0.02], [0.3, 0.06, 0.18], null, [7, 4]); for (let i = 0; i < 7; i++) b.ball(0xe8c25a, [(hashf(i, 1) - 0.5) * 1.0, 0.02, (hashf(i, 2) - 0.5) * 0.7], 0.03, null, [4, 3]); return b.build(); },
  straw: () => { const b = builder(); for (let i = 0; i < 14; i++) b.cyl(i % 2 ? 0xe8c25a : 0xf5d97a, [(hashf(i, 1) - 0.5) * 0.7, 0.02, (hashf(i, 2) - 0.5) * 0.6], [0.008, 0.28, 0.008], [H, 0, hashf(i, 3) * 3.14], 4); b.ball(0xe8c25a, [0, 0.03, 0], [0.2, 0.04, 0.15], null, [6, 3]); return b.build(); },
  letters: () => { const b = builder(); for (let i = 0; i < 5; i++) { b.box(i % 2 ? 0xffffff : 0xf4efe0, [(hashf(i, 1) - 0.5) * 0.7, 0.012 + i * 0.003, (hashf(i, 2) - 0.5) * 0.5], [0.14, 0.006, 0.1], [0, hashf(i, 3) * 3, 0]); b.box(P.barnRed, [(hashf(i, 1) - 0.5) * 0.7 + 0.03, 0.02 + i * 0.003, (hashf(i, 2) - 0.5) * 0.5], [0.02, 0.004, 0.02]); } return b.build(); },
};
const TIPS = {
  milk_can: { spill: 'milk', mode: 'roll', dist: 0.34 },
  barrel: { spill: 'water', mode: 'roll', dist: 0.38 },
  crate: { spill: 'straw', mode: 'roll', dist: 0.36 },
  feed_trough: { spill: 'feed', mode: 'flip', dist: 0.0 },
  mailbox: { spill: 'letters', mode: 'roll', dist: 0.4 },
};
function makeTip(c) {
  const spec = TIPS[c.inter.kind];
  const sz = c.geo.userData.size, rad = Math.min(sz.w, sz.d) / 2;
  const mail = c.inter.kind === 'mailbox';
  let spill = null, u = 0, tgt = 0, anim = false;
  const m = c.stat;
  function apply() {
    const hop = Math.sin(Math.min(1, u) * Math.PI) * 0.16;
    if (spec.mode === 'flip') { m.rotation.set(u * Math.PI, 0, 0); m.position.set(0, u * sz.h * 0.5 + hop, u * 0.12); }
    else { m.rotation.set(0, 0, -u * (H - (mail ? 0.35 : 0))); m.position.set(u * sz.h * 0.22, u * (mail ? 0.06 : rad) + hop, 0); }
    if (spill) { spill.visible = u > 0.05; const k = Math.max(0.001, Math.min(1, (u - 0.2) / 0.8)); spill.scale.setScalar(k * (1 + 0.2 * Math.sin(k * Math.PI))); }
  }
  return {
    set(p, d) {
      tgt = d ? 1 : 0;
      if (tgt && !spill) {
        spill = mkMesh(cached('spill' + spec.spill, SPILLS[spec.spill])); spill.castShadow = false;
        spill.position.set(spec.dist, 0.01, spec.mode === 'flip' ? 0.5 : 0.08); spill.rotation.y = 0.3; spill.scale.setScalar(0.001); spill.visible = false;
        c.root.add(spill);
      }
      anim = true;
    },
    tick(dt) { if (!anim) return; u = damp(u, tgt, dt, 8); if (Math.abs(u - tgt) < 0.003) { u = tgt; anim = false; } apply(); },
  };
}

// ---- 草垛：被撞散成一摊干草
function makeHay(c) {
  const sz = c.geo.userData.size, k = Math.max(sz.w, sz.d) * 0.8;
  let pile = null, u = 0, tgt = 0, anim = false;
  const m = c.stat;
  function apply() {
    m.scale.set(1 + 0.35 * u, Math.max(0.001, 1 - u * 1.05), 1 + 0.35 * u);
    m.visible = u < 0.98;
    if (pile) { pile.visible = u > 0.15; const kk = Math.max(0.001, (u - 0.15) / 0.85); pile.scale.setScalar(k * kk * (1 + 0.18 * Math.sin(kk * Math.PI))); }
  }
  return {
    set(p, d) {
      tgt = d ? 1 : 0;
      if (tgt && !pile) {
        pile = mkMesh(cached('hayPile', () => {
          const b = builder(), HY = [0xc99a3a, 0xe8c25a, 0xf5d97a, 0xfbe9a0];
          for (let i = 0; i < 7; i++) { const a = i * 2.4; b.ball(HY[i % 4], [Math.cos(a) * 0.32 * (i ? 1 : 0), 0.05 + (i % 3) * 0.02, Math.sin(a) * 0.26 * (i ? 1 : 0)], [0.3, 0.07, 0.24], [0, a, 0], [7, 4]); }
          for (let i = 0; i < 18; i++) { const a = hashf(i, 1) * 6.28, r = 0.2 + hashf(i, 2) * 0.5; b.cyl(HY[i % 4], [Math.cos(a) * r, 0.04 + hashf(i, 3) * 0.05, Math.sin(a) * r], [0.01, 0.34, 0.01], [H, 0, hashf(i, 4) * 3.14], 4); }
          return b.build();
        }));
        pile.visible = false; pile.scale.setScalar(0.001); c.root.add(pile);
      }
      anim = true;
    },
    tick(dt) { if (!anim) return; u = damp(u, tgt, dt, 9); if (Math.abs(u - tgt) < 0.003) { u = tgt; anim = false; } apply(); },
  };
}

// ---- 木料堆：0.5 歪了一半，1 散落一地（14 块木板用 1 个实例化网格）
const LUMBER = (() => {
  const boards = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) boards.push({ x: 0, y: 0.07 + r * 0.15, z: (c - 1) * 0.25, len: 1.5 - ((r + c) % 3) * 0.1, h: 0.13, w: 0.22, ry: 0, row: r, ci: 2 + ((r + c) % 2) });
  boards.push({ x: 0.1, y: 0.66, z: 0, len: 1.3, h: 0.1, w: 0.4, ry: 0.1, row: 4, ci: 3 });
  boards.push({ x: 0.3, y: 0.16, z: 0.5, len: 1.1, h: 0.07, w: 0.2, ry: -0.3, row: 4, ci: 2 });
  const N = boards.length, A = [], Bp = [], C = [];
  const qz = new THREE.Quaternion(), e = new THREE.Euler();
  boards.forEach((b, i) => {
    A.push({ p: [b.x, b.y, b.z], q: new THREE.Quaternion().setFromEuler(e.set(0, b.ry, 0)).toArray() });
    const rot = 0.22, cs = Math.cos(rot), sn = Math.sin(rot), px = b.x - 0.75, py = b.y;
    const slide = b.row >= 2 ? 0.1 * (b.row - 1) : 0;
    const qq = new THREE.Quaternion().setFromEuler(e.set(0, b.ry, 0));
    qz.setFromEuler(e.set(0, 0, rot)); qq.premultiply(qz);
    Bp.push({ p: [0.75 + px * cs - py * sn + slide, px * sn + py * cs, b.z + (b.row >= 2 ? (hashf(i, 5) - 0.5) * 0.15 : 0)], q: qq.toArray() });
    const lean = hashf(i, 8) > 0.7 ? 0.25 : 0;
    const qc = new THREE.Quaternion().setFromEuler(e.set(0, hashf(i, 6) * 3.14, lean));
    C.push({ p: [(hashf(i, 3) - 0.5) * 2.6, 0.04 + (i % 3) * 0.045 + lean * 0.3, (hashf(i, 4) - 0.5) * 1.8], q: qc.toArray() });
  });
  return { boards, N, sets: [A, Bp, C] };
})();
function makeLumber(c) {
  const { boards, N, sets } = LUMBER;
  let dyn = null, inst, u = 0, tgt = 0, anim = false;
  function build() {
    dyn = new THREE.Group();
    inst = mkInst(cached('lumberBoard', () => { const b = builder(); b.box(0xffffff, [0, 0, 0], [1, 1, 1]); return b.build(); }), N);
    boards.forEach((b, i) => { _CC.set(T.lumber[b.ci]); inst.setColorAt(i, _CC); });
    dyn.add(inst); c.root.add(dyn); refresh();
  }
  function refresh() {
    const i0 = Math.min(1, Math.floor(u)), f = u - i0, A = sets[i0], B = sets[Math.min(2, i0 + 1)];
    for (let i = 0; i < N; i++) {
      const a = A[i], b = B[i], bd = boards[i];
      _P.set(a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f, a.p[2] + (b.p[2] - a.p[2]) * f);
      _Q.set(a.q[0], a.q[1], a.q[2], a.q[3]); _Q2.set(b.q[0], b.q[1], b.q[2], b.q[3]); _Q.slerp(_Q2, f);
      _S.set(bd.len, bd.h, bd.w);
      inst.setMatrixAt(i, _M.compose(_P, _Q, _S));
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  }
  return {
    set(p, d) {
      tgt = d || p >= 0.95 ? 2 : p >= 0.45 ? 1 : 0;
      if (tgt && !dyn) build();
      if (dyn) { c.stat.visible = false; dyn.visible = true; }
      anim = true;
    },
    tick(dt) {
      if (!anim) return;
      u = damp(u, tgt, dt, 6);
      const moving = Math.abs(u - tgt) > 0.006; if (!moving) u = tgt;
      if (dyn) refresh();
      if (!moving) { anim = false; if (tgt === 0) { c.stat.visible = true; if (dyn) dyn.visible = false; } }
    },
  };
}

// ---- 圈门：0.5 晃开一条缝，done 整扇甩开（绕门轴转约 100°）
function makeGate(c) {
  const L = ((c.entry.opts && c.entry.opts.length) || 32) / 16;
  const pivot = new THREE.Group(); pivot.position.set(-L / 2, 0, 0);
  c.stat.position.set(L / 2, 0, 0);
  c.root.add(pivot); pivot.add(c.stat);
  const st = [0, 0]; let tgt = 0, anim = false;
  return {
    set(p, d) { tgt = d ? 1.75 : p >= 0.45 ? 0.28 : 0; anim = true; },
    tick(dt) {
      if (!anim) return;
      spring(st, tgt, dt, 55, 7.5);
      pivot.rotation.y = st[0];
      if (Math.abs(st[0] - tgt) < 0.003 && Math.abs(st[1]) < 0.01) { st[0] = tgt; st[1] = 0; pivot.rotation.y = tgt; anim = false; }
    },
  };
}

// ---- 鸡舍：小门敞开，门口飘着几根羽毛
function makeHenhouse(c) {
  let dyn = null, pivot; const feathers = [];
  let op = false, t = 0, tgt = 0, anim = false;
  const st = [0, 0];
  function build() {
    dyn = new THREE.Group();
    dyn.add(mkMesh(createFarmPropGeometry('henhouse', { ...(c.entry.opts || {}), open: true })));
    pivot = new THREE.Group(); pivot.position.set(-0.15, 0.4, 0.5);
    pivot.add(mkMesh(cached('henLeaf', () => { const b = builder(); b.box(T.wood[1], [0.15, 0, 0], [0.3, 0.34, 0.02]); for (let i = 0; i < 3; i++) b.box(T.wood[3], [0.05 + i * 0.1, 0, 0.012], [0.025, 0.32, 0.01]); b.ball(T.hay[2], [0.26, 0, 0.022], 0.02, null, [4, 3]); return b.build(); })));
    dyn.add(pivot);
    const fg = cached('feather', () => { const b = builder(); b.ball(0xffffff, [0, 0, 0], [0.045, 0.02, 0.12], null, [5, 3]); b.ball(0xe6dccb, [0, 0, -0.07], [0.03, 0.015, 0.09], null, [4, 3]); return b.build(); });
    for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(fg, farmToonMaterial); feathers.push(f); dyn.add(f); }
    if (c.root.userData.glowMesh) { const g2 = new THREE.Mesh(c.root.userData.glowMesh.geometry, farmGlowMaterial); dyn.add(g2); }
    c.root.add(dyn);
  }
  return {
    set(p, d) {
      op = !!d; tgt = op ? -1.75 : 0;
      if (op && !dyn) build();
      if (dyn) dyn.visible = true;
      if (op) { c.stat.visible = false; if (c.root.userData.glowMesh) c.root.userData.glowMesh.visible = false; }
      anim = true;
    },
    tick(dt) {
      if (!dyn || (!anim && !op)) return;
      t += dt;
      if (anim) { spring(st, tgt, dt, 50, 7); pivot.rotation.y = st[0]; if (Math.abs(st[0] - tgt) < 0.003 && Math.abs(st[1]) < 0.01) { st[0] = tgt; st[1] = 0; anim = false; } }
      for (let i = 0; i < 5; i++) {
        const ph = (t * 0.28 + i * 0.2) % 1, f = feathers[i];
        f.visible = op;
        f.position.set(Math.sin(t * 1.3 + i * 2.1) * 0.14 + (i - 2) * 0.06, 0.4 + ph * 0.7, 0.62 + Math.cos(t + i) * 0.08 + ph * 0.1);
        f.rotation.set(ph * 3, i + t * 0.8, ph * 2);
        f.scale.setScalar(Math.max(0.001, Math.sin(ph * Math.PI)));
      }
      if (!op && !anim) { dyn.visible = false; c.stat.visible = true; if (c.root.userData.glowMesh) c.root.userData.glowMesh.visible = true; }
    },
  };
}

export function createInteractiveProp(inter, entry) {
  const geo = createFarmPropGeometry(entry.kind, entry.opts || {});
  const root = new THREE.Group();
  root.position.set(entry.x, 0, entry.z); root.rotation.y = entry.rot || 0; root.scale.setScalar(entry.s || 1);
  root.name = 'inter_' + inter.id;
  const stat = mkMesh(geo);
  root.add(stat);
  if (geo.userData.glow) {
    const gm = new THREE.Mesh(whiteGeo(geo.userData.glow), farmGlowMaterial);
    root.userData.glowMesh = gm; root.add(gm);
  }
  const c = { inter, entry, geo, root, stat };
  const k = inter.kind;
  let impl = null;
  if (k === 'radish_bed' || k === 'cabbage_bed' || k === 'pumpkin_bed') impl = makeCrop(c);
  else if (k === 'flower_bed') impl = makeFlowerBed(c);
  else if (k === 'clothesline') impl = makeClothesline(c);
  else if (TIPS[k]) impl = makeTip(c);
  else if (k === 'hay_bale') impl = makeHay(c);
  else if (k === 'lumber_pile') impl = makeLumber(c);
  else if (k === 'pen_gate') impl = makeGate(c);
  else if (k === 'henhouse') impl = makeHenhouse(c);
  let lp = -1, ld = false, lm = false;
  return {
    id: inter.id, kind: k, object: root,
    setState(st) {
      if (!impl || !st) return;
      const p = Math.round((st.progress || 0) * 1000) / 1000, d = !!st.done, m = !!st.muddy;
      if (p === lp && d === ld && m === lm) return;
      lp = p; ld = d; lm = m;
      impl.set(p, d, m);
    },
    tick(dt) { if (impl) impl.tick(dt); },
  };
}
