// 离线工具：把静态的白鹭模型（已减面的 GLB）处理成游戏里能用的资源 src/assets/egret.glb。
//   1. 坐标换算：站立头顶高 2.0、脚踩 y = 0、头朝 +Z、髋关节在原点正上方；把节点变换和贴图坐标变换都烘进顶点。
//   2. 绑骨：按位置给每个顶点算出它跟随哪几根骨头（身体 / 脖子 4 节 / 头 / 左右腿各 3 节），写成 JOINTS_0 / WEIGHTS_0。
//      骨骼的编号与 src/world/egret.js 里创建骨骼的顺序一致；骨骼的静止位置（关节坐标）写在节点的 extras.rig 里，运行时照着建骨架。
//   3. 只保留底色贴图（法线、金属度贴图在手绘风格里用不上）。
// 依赖 @gltf-transform/core、@gltf-transform/extensions（不在本项目的依赖里，单独装在别处，用 NODE_PATH 或在那个目录里运行）：
//   减面：gltf-transform dequantize in.glb a.glb && gltf-transform weld a.glb b.glb && gltf-transform simplify b.glb c.glb --ratio 0.018 --error 0.003
//         && gltf-transform resize c.glb d.glb --width 1024 --height 1024
//   绑骨：node egret-rig.mjs d.glb <项目>/src/assets/egret.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [, , IN = 'd.glb', OUT = 'egret.glb'] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
const root = doc.getRoot();
const node = root.listNodes().find((n) => n.getMesh());
const prim = node.getMesh().listPrimitives()[0];
const M = node.getWorldMatrix();
const posA = prim.getAttribute('POSITION'), uvA = prim.getAttribute('TEXCOORD_0'), nrmA = prim.getAttribute('NORMAL');
const n = posA.getCount();

// ---------------------------------------------------------------- 1. 坐标换算
const P = new Float32Array(n * 3);
let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
const v = [0, 0, 0];
for (let i = 0; i < n; i++) {
  posA.getElement(i, v);
  P[i * 3] = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12];
  P[i * 3 + 1] = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13];
  P[i * 3 + 2] = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
  for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i * 3 + k]); max[k] = Math.max(max[k], P[i * 3 + k]); }
}
const K = 2.0 / (max[1] - min[1]);
const X_MID = -0.02, Z_HIP = -0.135; // 量出来的：身体中线、髋关节的前后位置（包围盒居中坐标系里）
const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
for (let i = 0; i < n; i++) {
  P[i * 3] = (P[i * 3] - cx) * K - X_MID;
  P[i * 3 + 1] = (P[i * 3 + 1] - min[1]) * K;
  P[i * 3 + 2] = (P[i * 3 + 2] - cz) * K - Z_HIP;
}
const zs = (z) => z - Z_HIP; // 把量到的 z 换到新坐标

// ---------------------------------------------------------------- 2. 关节（[x, y, z]，都是换算后的坐标）
const RIG = {
  bodyPivot: [0, 1.1, 0],
  // 脖子 4 节 + 头的关节 [y, z]：从胸前往上，略成 S 形
  neck: [[1.3, zs(0.36)], [1.44, zs(0.46)], [1.55, zs(0.47)], [1.64, zs(0.39)], [1.73, zs(0.38)]],
  headRest: 1.97, // 喙的指向（自 +Y 向 +Z 量的角）：水平偏下约 23°
  // 腿：R = x>0（后面那条，直立），L = x<0（前面那条，向前迈着、脚跟抬起）
  legs: {
    R: { hip: [0.13, 0.98, 0], ankle: [0.13, 0.5, zs(-0.33)], foot: [0.13, 0.045, zs(-0.3)], toe: 0 },
    L: { hip: [-0.13, 0.98, 0], ankle: [-0.13, 0.41, zs(0.1)], foot: [-0.14, 0.19, zs(0.46)], toe: 0.54 },
  },
  wing: { sx: 0.2, sy: 1.34, sz: zs(0.1) }, // 飞行时程序生成的翅膀装在这里（模型本身的翅膀是收着的）
  seat: [0, 1.47, zs(-0.2)],
  dims: { height: 2.0, length: +((max[2] - min[2]) * K).toFixed(3) },
};

// ---------------------------------------------------------------- 3. 权重
// 骨骼编号（与 egret.js 里 mk() 的顺序一致）
const BONE = { root: 0, body: 1, neck0: 2, neck1: 3, neck2: 4, neck3: 5, head: 6, hipR: 17, ankleR: 18, footR: 19, hipL: 20, ankleL: 21, footL: 22 };
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const J = new Uint16Array(n * 4), Wt = new Float32Array(n * 4);
const set = (i, pairs) => { // pairs: [[bone, w], …]，归一化后写入
  let s = 0; for (const p of pairs) s += p[1];
  pairs.sort((a, b) => b[1] - a[1]);
  for (let k = 0; k < 4; k++) { J[i * 4 + k] = k < pairs.length ? pairs[k][0] : 0; Wt[i * 4 + k] = k < pairs.length ? pairs[k][1] / s : 0; }
};
const neckZ = (y) => { // 脖子中线在高度 y 处的 z
  const N = RIG.neck;
  if (y <= N[0][0]) return N[0][1];
  for (let k = 1; k < N.length; k++) if (y <= N[k][0]) { const t = (y - N[k - 1][0]) / (N[k][0] - N[k - 1][0]); return N[k - 1][1] + (N[k][1] - N[k - 1][1]) * t; }
  return N[N.length - 1][1];
};
/** 点到线段 a→b 的投影参数（0..1 之外表示在两端之外）和距离 */
function proj(p, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2, tc = Math.min(1, Math.max(0, t));
  return { t, dist: Math.hypot(p[0] - a[0] - d[0] * tc, p[1] - a[1] - d[1] * tc, p[2] - a[2] - d[2] * tc), len: Math.sqrt(l2) };
}
const count = {};
const tag = (k) => { count[k] = (count[k] || 0) + 1; };
const HEAD_Y = 1.675, PLUME_Y = 1.47;
for (let i = 0; i < n; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], p = [x, y, z];
  // ---- 腿：髋部以下
  if (y < 0.97) {
    // 哪条腿：脚的高度上两只脚一前一后，用 z 分；往上用 x 分
    const side = y < 0.3 ? (z > zs(0.18) ? 'L' : 'R') : (x < 0 ? 'L' : 'R');
    const Lg = RIG.legs[side], hip = BONE['hip' + side], ank = BONE['ankle' + side], ft = BONE['foot' + side];
    const up = proj(p, Lg.hip, Lg.ankle), lo = proj(p, Lg.ankle, Lg.foot);
    // 大腿根的羽毛：越往上越跟着身体（只有靠近腿轴的才算腿）
    const legW = ss(0.97, 0.8, y) * (y > 0.78 ? ss(0.2, 0.1, up.dist) : 1);
    if (legW < 0.001) { set(i, [[BONE.body, 1]]); tag('body'); continue; }
    let wHip = 0, wAnk = 0, wFt = 0;
    const jw = 0.05; // 关节两侧各 0.05 的范围内过渡
    if (y < 0.3 && (lo.t > 1 || side === 'R' && y < 0.03 || side === 'L' && lo.dist > 0.07)) { // 脚趾
      const k = ss(-jw, jw, (lo.t - 1) * lo.len); wFt = Math.max(0.5, k); wAnk = 1 - wFt;
    } else if (up.t < 1 && (lo.t < 0 || up.dist < lo.dist)) { // 上段
      const k = ss(-jw, jw, (up.t - 1) * up.len + jw); wAnk = k * 0.5; wHip = 1 - wAnk;
    } else { // 下段
      const k = ss(-jw, jw, lo.t * lo.len - jw); wHip = (1 - k) * 0.5; wAnk = 1 - wHip;
      const kf = ss(-jw, jw, (lo.t - 1) * lo.len + jw); wFt = kf * 0.5; wAnk -= wFt;
    }
    const pairs = [[hip, wHip * legW], [ank, wAnk * legW], [ft, wFt * legW], [BONE.body, 1 - legW]].filter((q) => q[1] > 0.001);
    set(i, pairs); tag('leg' + side);
    continue;
  }
  // ---- 头：头、喙，以及从后脑向后飘的两根饰羽
  const nz = neckZ(y);
  const isHead = (y >= HEAD_Y && z > nz - 0.14) || (y >= PLUME_Y && z < nz - 0.12 && Math.abs(x) < 0.14) || y >= 1.8;
  if (isHead) {
    // 头和脖子最上一节的交界处稍微过渡一下
    const k = y < 1.75 && z > nz - 0.14 && z < nz + 0.14 ? ss(HEAD_Y, 1.75, y) : 1;
    set(i, k >= 0.999 ? [[BONE.head, 1]] : [[BONE.head, k], [BONE.neck3, 1 - k]]); tag('head');
    continue;
  }
  // ---- 脖子：胸前往上那根细管
  if (y >= 1.26 && Math.abs(z - nz) < 0.15 + 0.12 * ss(1.42, 1.26, y) && Math.abs(x) < 0.12 + 0.1 * ss(1.42, 1.26, y) && z > zs(0.2)) {
    const N = RIG.neck;
    let k = 0; while (k < 3 && y > N[k + 1][0]) k++;
    const t = Math.min(1, Math.max(0, (y - N[k][0]) / (N[k + 1][0] - N[k][0])));
    // 每节：下半截和下面一节混一点，上半截和上面一节混一点（弯起来圆滑）
    const pairs = [[BONE['neck' + k], 1]];
    if (t < 0.5 && k > 0) { const w = 0.5 - t; pairs[0][1] = 1 - w; pairs.push([BONE['neck' + (k - 1)], w]); }
    else if (t >= 0.5 && k < 3) { const w = t - 0.5; pairs[0][1] = 1 - w; pairs.push([BONE['neck' + (k + 1)], w]); }
    // 脖根：和身体过渡
    const wb = ss(1.4, 1.26, y);
    if (wb > 0.001) { for (const q of pairs) q[1] *= 1 - wb; pairs.push([BONE.body, wb]); }
    set(i, pairs); tag('neck');
    continue;
  }
  set(i, [[BONE.body, 1]]); tag('body');
}
console.log('顶点分配', count);

// ---------------------------------------------------------------- 4. 写回
const buffer = root.listBuffers()[0];
posA.setArray(P);
// 贴图坐标：把 KHR_texture_transform 的缩放 / 平移烘进去
const mat = prim.getMaterial();
const info = mat.getBaseColorTextureInfo();
const tt = info.getExtension('KHR_texture_transform');
if (tt) {
  const off = tt.getOffset(), sc = tt.getScale(), uv = new Float32Array(n * 2), t = [0, 0];
  for (let i = 0; i < n; i++) { uvA.getElement(i, t); uv[i * 2] = t[0] * sc[0] + off[0]; uv[i * 2 + 1] = t[1] * sc[1] + off[1]; }
  uvA.setArray(uv).setNormalized(false);
  info.setExtension('KHR_texture_transform', null);
}
// 法线原样保留（节点变换只有平移和等比缩放）
if (nrmA && nrmA.getNormalized()) { const a = new Float32Array(n * 3), t = [0, 0, 0]; for (let i = 0; i < n; i++) { nrmA.getElement(i, t); const l = Math.hypot(t[0], t[1], t[2]) || 1; a[i * 3] = t[0] / l; a[i * 3 + 1] = t[1] / l; a[i * 3 + 2] = t[2] / l; } nrmA.setArray(a).setNormalized(false); }
prim.setAttribute('JOINTS_0', doc.createAccessor('joints').setType('VEC4').setArray(J).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor('weights').setType('VEC4').setArray(Wt).setBuffer(buffer));
// 只留底色贴图
mat.setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null).setMetallicFactor(0).setRoughnessFactor(1);
for (const tex of root.listTextures()) if (tex !== mat.getBaseColorTexture()) tex.dispose();
node.setTranslation([0, 0, 0]).setScale([1, 1, 1]).setRotation([0, 0, 0, 1]);
node.setName('egret').setExtras({ rig: RIG });
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_texture_transform') ext.dispose();
await io.write(OUT, doc);
let bmin = [1e9, 1e9, 1e9], bmax = [-1e9, -1e9, -1e9];
for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { bmin[k] = Math.min(bmin[k], P[i * 3 + k]); bmax[k] = Math.max(bmax[k], P[i * 3 + k]); }
console.log('写出', OUT, '顶点', n, '包围盒', bmin.map((a) => +a.toFixed(2)), bmax.map((a) => +a.toFixed(2)));
