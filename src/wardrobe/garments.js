// 服饰系统：24 件服饰（4 个分区 × 6 件）的目录、建模（陈列用静态模型 + 穿在小狗身上的蒙皮网格）。
//
// 穿在身上的做法：
//  - 贴身的（衣服、鞋袜）：从小狗毛皮几何里按部位挑出三角形（按静止姿态的位置选躯干 / 颈 / 腿 / 爪子），
//    沿法线外扩一小段，换上新的顶点色，带着原来的 skinIndex / skinWeight 做成第二个 SkinnedMesh，绑定同一副骨架，
//    所以任何动作下都和身体严丝合缝。
//  - 贴在衣服上的小部件（雨衣兜帽 / 扣子 / 口袋、背带裤的背带 / 胸兜 / 铜扣、背包）：在静止姿态的毛皮上做射线求交，
//    取命中三角形的蒙皮权重（重心插值），跟着那块皮肤走。
//  - 帽子 / 墨镜挂在头骨，围巾 / 领结挂在颈骨（围巾垂下来的一头渐变到胸骨），头花挂在右耳骨。
//    帽子按耳朵的活动范围自动“让开”：在一组耳朵姿态下统计耳朵占据的方位，帽子在那里收进去。
//  每件服饰（不管有几个部件）都合成 1 个 SkinnedMesh = 1 个 draw call；几何按 id 缓存，多只狗共用。
//
// 材质：复用毛皮的手绘平涂着色（rig.js 的 celShade），再加一层“双色条纹”（顶点属性 color2 / stripe：
// 片元里按 stripe 的小数部分在 color 和 color2 之间切换，抗锯齿），条纹衫、袜子、罗纹这类图案不受网格密度限制。
import * as THREE from 'three';
import { buildDog, celShade, DIM, headSurf } from '../dog/model/rig.js';
import { blob, ellipsoid, ss, weldNormals } from '../dog/model/geometry.js';

// ================================================================ 目录
export const ZONES = ['head', 'eyes', 'neck', 'body', 'back', 'feet'];
export const ZONE_NAMES = { head: '头上', eyes: '眼睛', neck: '脖子', body: '身上', back: '背上', feet: '脚上' };
// 目录顺序 = 默认陈列顺序（按分区，每个分区里最有代表性的在前）。id 是存档用的，不能改。
export const GARMENTS = [
  { id: 'hat_straw', zone: 'head', name: '草帽', desc: '草编的宽檐小帽，系一圈红丝带，晒太阳正合适。' },
  { id: 'hat_cap', zone: 'head', name: '棒球帽', desc: '红白配色的棒球帽，帽檐朝前，精神十足。' },
  { id: 'hat_beanie', zone: 'head', name: '毛线帽', desc: '暖乎乎的针织帽，顶上一颗圆滚滚的绒球。' },
  { id: 'hat_party', zone: 'head', name: '生日尖帽', desc: '彩色螺旋条纹的尖顶帽，帽尖缀着小绒球。' },
  { id: 'hat_beret', zone: 'head', name: '贝雷帽', desc: '墨绿色的软贝雷帽，歪歪地扣在头顶，像个小画家。' },
  { id: 'hat_cowboy', zone: 'head', name: '牛仔帽', desc: '棕色牛仔帽，两边帽檐向上卷，系一圈深色皮带。' },
  { id: 'acc_hairbow', zone: 'head', name: '蝴蝶结', desc: '粉白条纹的蝴蝶结头花，别在右耳根上。' },
  { id: 'acc_sunglasses', zone: 'eyes', name: '墨镜', desc: '粉色圆框墨镜，戴上就是最酷的小狗。' },
  { id: 'eyes_round', zone: 'eyes', name: '圆框眼镜', desc: '细细的金色圆框眼镜，看起来很有学问。' },
  { id: 'eyes_heart', zone: 'eyes', name: '爱心墨镜', desc: '红色爱心形状的墨镜，白色镜框，满眼都是爱。' },
  { id: 'eyes_patch', zone: 'eyes', name: '独眼眼罩', desc: '海盗的黑眼罩，一根细带绕到脑后。' },
  { id: 'acc_scarf', zone: 'neck', name: '红围巾', desc: '毛茸茸的红围巾，一头垂在胸前，末端是白条纹和流苏。' },
  { id: 'acc_bowtie', zone: 'neck', name: '领结', desc: '蓝白条纹的小领结，正式场合必备。' },
  { id: 'neck_bandana', zone: 'neck', name: '小方巾', desc: '蓝底白条的三角巾，系在脖子上，尖角垂在胸前。' },
  { id: 'acc_garland', zone: 'neck', name: '花环', desc: '粉黄白三色小花编成的花环，挂在脖子上。' },
  { id: 'top_stripe', zone: 'body', name: '条纹衫', desc: '藏青和白色相间的海魂衫，清清爽爽。' },
  { id: 'top_raincoat', zone: 'body', name: '黄雨衣', desc: '亮黄色小雨衣，兜帽垂在背后，下雨天也能出门踩水。' },
  { id: 'top_sweater', zone: 'body', name: '红毛衣', desc: '红色粗针毛衣，高领、袖口和下摆是奶白色罗纹。' },
  { id: 'top_overalls', zone: 'body', name: '背带裤', desc: '牛仔背带裤，两颗铜扣，胸前还有个小口袋。' },
  { id: 'top_hoodie', zone: 'body', name: '蓝卫衣', desc: '天蓝色连帽卫衣，兜帽搭在背上，胸前垂两根白抽绳。' },
  { id: 'top_cape', zone: 'body', name: '小披风', desc: '紫色小披风，金色滚边，领口一颗金扣，威风凛凛。' },
  { id: 'acc_backpack', zone: 'back', name: '小背包', desc: '绿色小背包，黄色袋盖，出门郊游背上它。' },
  { id: 'back_wings', zone: 'back', name: '小翅膀', desc: '一对洁白的天使小翅膀，长在肩膀后面。' },
  { id: 'back_butterfly', zone: 'back', name: '蝴蝶翅膀', desc: '橙蓝相间的蝴蝶翅膀，翅尖带黑边和白点。' },
  { id: 'back_shell', zone: 'back', name: '小龟壳', desc: '圆鼓鼓的绿色龟壳，一块一块的花纹，边上一圈黄。' },
  { id: 'shoes_redboots', zone: 'feet', name: '小红靴', desc: '红色小短靴，靴口一圈白绒毛。' },
  { id: 'shoes_rainboots', zone: 'feet', name: '黄雨靴', desc: '高筒黄雨靴，深色橡胶底，踩水坑专用。' },
  { id: 'shoes_socks', zone: 'feet', name: '条纹袜', desc: '红白条纹的长筒袜，软软的，在家里穿。' },
  { id: 'shoes_sneakers', zone: 'feet', name: '运动鞋', desc: '蓝白运动鞋，白色厚鞋底，跑起来更带劲。' },
  { id: 'shoes_snowboots', zone: 'feet', name: '雪地靴', desc: '浅棕色雪地靴，靴口翻出一圈厚厚的奶白绒毛。' },
  { id: 'shoes_rainbow', zone: 'feet', name: '彩虹袜', desc: '七彩渐变的长筒袜，一圈一圈的彩虹。' },
];
const BY_ID = new Map(GARMENTS.map((g) => [g.id, g]));

export function getGarment(id) { return BY_ID.get(id) || null; }
/** neck 区 = 占脖子：穿着时隐藏默认的红项圈和铃铛 */
export function garmentUsesNeck(id) { const g = BY_ID.get(id); return !!g && g.zone === 'neck'; }

/** 带兜帽的衣服：背上有东西时兜帽压扁收到领口后面 */
const HOODED = new Set(['top_raincoat', 'top_hoodie']);
/**
 * 组合穿戴的变体：同一件服饰在不同搭配下几何略有不同（缓存键 = id + 变体）。
 *   body 区带兜帽的 + 背上有东西 → 'flat'（兜帽压扁、靠前）
 *   back / neck 区 + 身上穿了衣服 → 'lift'（整体再往外垫一层，不被衣服吞掉）
 */
export function garmentVariant(id, outfit) {
  const g = BY_ID.get(id);
  if (!g || !outfit) return '';
  if (g.zone === 'body') return HOODED.has(id) && outfit.back ? 'flat' : '';
  if (g.zone === 'back' || g.zone === 'neck') return outfit.body ? 'lift' : '';
  return '';
}

// ================================================================ 颜色
const C = (h) => new THREE.Color(h);
const K = {
  white: C(0xfbf6ea), cream: C(0xf3e8cf), navy: C(0x2c3d6e), navyDeep: C(0x22305a),
  red: C(0xd9433a), redDeep: C(0xb8342e), redKnit: C(0xd23a35), redKnitDark: C(0xae2c2a),
  yellow: C(0xf6c431), yellowDeep: C(0xdca623), yellowLining: C(0xfbe6a0),
  straw: C(0xe9c878), strawDark: C(0xc9a056), ribbon: C(0xd8453c),
  denim: C(0x4d76b8), denimDark: C(0x3a5d98), brass: C(0xe0b44a), brassDark: C(0xa77a2c),
  pink: C(0xf28fae), pinkDeep: C(0xe06b92), lens: C(0x27243a), glint: C(0x8c87b6),
  teal: C(0x3c9c9a), tealDark: C(0x2f8280), mustard: C(0xf0b73a),
  sole: C(0x4a3a33), soleLight: C(0xf4f1ea), sky: C(0x5aa3e0), skyDeep: C(0x3d82c2),
  partyPink: C(0xf37aa6), partyYellow: C(0xffd84d), partyBlue: C(0x63b6f0),
  wood: C(0xb07a45), woodDark: C(0x8a5a30), metal: C(0xb9b4aa), toggle: C(0x6b4a33),
  capRed: C(0xd8403a), capWhite: C(0xf7f3ea), capNavy: C(0x2d3f70),
  bootRed: C(0xd23b36), bootRedDeep: C(0xa92c2c),
  beret: C(0x3f7a55), beretDark: C(0x2f6143),
  cowboy: C(0xb07842), cowboyDark: C(0x8a5a2e), leather: C(0x5a3a25),
  hoodie: C(0x5d9ee0), hoodieDark: C(0x4683c4), hoodieLining: C(0xdfe6ee),
  cape: C(0x7350b8), capeDark: C(0x5c3e9a), capeLining: C(0xe26d8a), gold: C(0xf2c74a), goldDark: C(0xc99a2e),
  leaf: C(0x5aa94e), leafDark: C(0x3f8a3a), flowerPink: C(0xf39ab8), flowerYellow: C(0xffd65a), flowerWhite: C(0xfdf8ee), flowerCore: C(0xf0a43a),
  pack: C(0x52b07e), packDark: C(0x3e9165), packFlap: C(0xf2c03e),
  snowTan: C(0xc99a68), snowTanDark: C(0xae8050), snowFur: C(0xf7efe0),
};

// ================================================================ 材质：毛皮的平涂着色 + 双色条纹
let MAT = null;
export function garmentMaterial() {
  if (MAT) return MAT;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    celShade(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 color2;\nattribute float stripe;\nvarying vec3 vColor2;\nvarying float vStripe;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vColor2 = color2; vStripe = stripe;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vColor2;\nvarying float vStripe;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // 双色条纹：stripe 的小数部分 < 0.5 取 color2（带一点抗锯齿）
          float sw = clamp(fwidth(vStripe) * 1.2, 1e-4, 0.45);
          float tw = abs(fract(vStripe) - 0.5) * 2.0;
          diffuseColor.rgb = mix(diffuseColor.rgb, vColor2, smoothstep(0.5 + sw, 0.5 - sw, tw));
        }`,
      );
  };
  m.customProgramCacheKey = () => 'garmentCel';
  MAT = m;
  return m;
}

// ================================================================ 小狗静止姿态数据（从毛皮几何取）
let REST = null;
const PART_BONE = { torso: 'body', butt: 'body', neck: 'neck', head: 'head', earL: 'earL', earR: 'earR', jaw: 'jaw', tail: 'tail0' };
function getRest(rig) {
  if (REST) return REST;
  if (!rig || !rig.parts) rig = buildDog();
  const g = rig.mesh.geometry;
  const count = g.attributes.position.count;
  const inv = rig.skeleton.boneInverses.map((m) => m.clone());
  const rest = inv.map((m) => m.clone().invert());
  const B = { ...rig.B };
  const partNames = Object.keys(rig.parts);
  const partOf = new Uint8Array(count).fill(255);
  const bodyP = new Float32Array(count * 3), localP = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const P = g.attributes.position;
  partNames.forEach((name, k) => {
    const bn = PART_BONE[name] || name.slice(3) + 'u';
    const bi = B[bn];
    for (const [s, e] of rig.parts[name]) {
      for (let i = s; i < e; i++) {
        partOf[i] = k;
        v.fromBufferAttribute(P, i).applyMatrix4(inv[B.body]);
        bodyP[i * 3] = v.x; bodyP[i * 3 + 1] = v.y; bodyP[i * 3 + 2] = v.z;
        v.fromBufferAttribute(P, i).applyMatrix4(inv[bi]);
        localP[i * 3] = v.x; localP[i * 3 + 1] = v.y; localP[i * 3 + 2] = v.z;
      }
    }
  });
  REST = {
    count, geo: g, pos: P.array, nor: g.attributes.normal.array, si: g.attributes.skinIndex.array, sw: g.attributes.skinWeight.array,
    index: g.index.array, partNames, partOf, bodyP, localP, B, inv, rest, rayMeshes: new Map(), partRanges: rig.parts,
  };
  return REST;
}

// ================================================================ 几何收集器
const P = { a: new THREE.Color(), b: new THREE.Color(), s: 0, hasB: false };
/** 着色函数里用：单色 / 双色条纹（s 是条纹坐标，整数步长一个周期） */
function paint(out, a, b = null, s = 0) {
  out.a.copy(a);
  if (b) out.b.copy(b); else out.b.copy(a);
  out.s = s;
}

class Build {
  constructor() {
    this.pos = []; this.nor = []; this.col = []; this.col2 = []; this.str = []; this.si = []; this.sw = []; this.idx = []; this.tag = [];
    this.curTag = 0;
  }
  get n() { return this.pos.length / 3; }
  vert(p, n, si, sw) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(P.a.r, P.a.g, P.a.b);
    this.col2.push(P.b.r, P.b.g, P.b.b);
    this.str.push(P.s);
    this.si.push(si[0], si[1], si[2], si[3]);
    this.sw.push(sw[0], sw[1], sw[2], sw[3]);
    this.tag.push(this.curTag);
    return this.n - 1;
  }
  geometry(skinned) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('color2', new THREE.Float32BufferAttribute(this.col2, 3));
    g.setAttribute('stripe', new THREE.Float32BufferAttribute(this.str, 1));
    if (skinned) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    }
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

/**
 * 贴身壳：从毛皮里按部位挑三角形外扩。
 *   parts  部位名数组
 *   mask(info) → bool    顶点是否在范围内（三角形三个顶点都在才要）
 *   off(info) → number   外扩距离（网格单位）
 *   color(info, P)       着色
 *   wrap   条纹坐标的周期性跳变（绕一圈的条纹数）：跨接缝的三角形单独复制顶点修正
 * info: { part, b: 身体骨骼空间坐标, l: 部位骨骼空间坐标, i }
 */
function addShell(W, R, { parts, mask, off, color, wrap = 0, fine = false }) {
  const want = new Set(parts.map((n) => R.partNames.indexOf(n)).filter((k) => k >= 0));
  const map = new Int32Array(R.count).fill(-1);
  const info = { part: '', b: new THREE.Vector3(), l: new THREE.Vector3(), i: 0 };
  const sOf = new Float32Array(R.count);
  const keep = new Uint8Array(R.count);
  const offs = new Float32Array(R.count);
  const cA = [], cB = [];
  for (let i = 0; i < R.count; i++) {
    const k = R.partOf[i];
    if (!want.has(k)) continue;
    info.part = R.partNames[k]; info.i = i;
    info.b.fromArray(R.bodyP, i * 3); info.l.fromArray(R.localP, i * 3);
    if (!mask(info)) continue;
    keep[i] = 1;
    offs[i] = off(info);
  }
  const emit = (i, sAdd) => {
    const info2 = info;
    info2.part = R.partNames[R.partOf[i]]; info2.i = i;
    info2.b.fromArray(R.bodyP, i * 3); info2.l.fromArray(R.localP, i * 3);
    color(info2, P);
    P.s += sAdd;
    _n.fromArray(R.nor, i * 3);
    _p.fromArray(R.pos, i * 3).addScaledVector(_n, offs[i]);
    return W.vert(_p, _n, R.si.subarray(i * 4, i * 4 + 4), R.sw.subarray(i * 4, i * 4 + 4));
  };
  // 降采样：在毛皮的球面网格上隔行 / 隔列取点（低多边形，三角形少到 1/2~1/4），
  // 被跳过的细网格顶点如果鼓出粗网格（毛簇），把粗网格顶点再往外推，保证仍然包住毛皮。
  const idx = coarseIndex(R, want, offs, keep, fine);
  const sv = [0, 0, 0];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!keep[a] || !keep[b] || !keep[c]) continue;
    if (wrap) {
      // 条纹坐标跨接缝：看三个顶点的 s，跨度超过半圈就把小的那几个 +wrap（单独复制顶点）
      for (let j = 0; j < 3; j++) {
        const i = idx[t + j];
        info.part = R.partNames[R.partOf[i]]; info.b.fromArray(R.bodyP, i * 3); info.l.fromArray(R.localP, i * 3);
        color(info, P); sv[j] = P.s;
      }
      const lo = Math.min(sv[0], sv[1], sv[2]), hi = Math.max(sv[0], sv[1], sv[2]);
      if (hi - lo > wrap / 2) {
        const mid = (lo + hi) / 2;
        for (let j = 0; j < 3; j++) W.idx.push(emit(idx[t + j], sv[j] < mid ? wrap : 0));
        continue;
      }
    }
    for (let j = 0; j < 3; j++) {
      const i = idx[t + j];
      if (map[i] < 0) map[i] = emit(i, 0);
      W.idx.push(map[i]);
    }
  }
}

// 毛皮各部位的球面网格分段（rig.js 里 blob / ellipsoid 的 widthSegments × heightSegments）与降采样步长
const SPHERE = { torso: [56, 36, 2, 2], butt: [24, 18, 2, 2], neck: [30, 18, 2, 2], leg: [16, 18, 1, 2], paw: [16, 12, 1, 2] };
function coarseIndex(R, want, offs, keep, fine) {
  const out = [];
  const pc = new THREE.Vector3(), nc = new THREE.Vector3(), pf = new THREE.Vector3();
  for (const k of want) {
    const name = R.partNames[k];
    const spec = SPHERE[name] || SPHERE[name.slice(0, 3)];
    if (!spec) continue;
    const [ws, hs] = spec;
    const su = fine ? 1 : spec[2], sv = fine ? 1 : spec[3];
    const per = (ws + 1) * (hs + 1);
    for (const [s0, e0] of R.partRanges[name]) {
      for (let base = s0; base + per <= e0; base += per) {
        const at = (iy, ix) => base + iy * (ws + 1) + ix;
        // 外推：粗网格顶点覆盖它周围细网格顶点
        for (let iy = 0; iy <= hs; iy += sv) {
          for (let ix = 0; ix <= ws; ix += su) {
            const i = at(iy, ix);
            if (!keep[i]) continue;
            pc.fromArray(R.pos, i * 3); nc.fromArray(R.nor, i * 3);
            let ext = 0;
            for (let dy = -sv + 1; dy <= sv - 1; dy++) {
              for (let dx = -su + 1; dx <= su - 1; dx++) {
                const y2 = iy + dy, x2 = ((ix + dx) % ws + ws) % ws;
                if (y2 < 0 || y2 > hs) continue;
                pf.fromArray(R.pos, at(y2, x2) * 3);
                ext = Math.max(ext, pf.sub(pc).dot(nc));
              }
            }
            offs[i] += Math.min(ext, 0.02);
          }
        }
        const NY = hs / sv, NX = ws / su;
        for (let jy = 0; jy < NY; jy++) {
          for (let jx = 0; jx < NX; jx++) {
            const a = at(jy * sv, (jx + 1) * su), b = at(jy * sv, jx * su), c = at((jy + 1) * sv, jx * su), d = at((jy + 1) * sv, (jx + 1) * su);
            if (jy !== 0) out.push(a, b, d);
            if (jy !== NY - 1) out.push(b, c, d);
          }
        }
      }
    }
  }
  return out;
}

/** 射线求交用的静止姿态毛皮（按部位子集缓存） */
function rayMesh(R, parts) {
  const key = parts.join(',');
  let m = R.rayMeshes.get(key);
  if (m) return m;
  const want = new Set(parts.map((n) => R.partNames.indexOf(n)));
  const ids = [];
  for (let t = 0; t < R.index.length; t += 3) {
    if (want.has(R.partOf[R.index[t]])) ids.push(R.index[t], R.index[t + 1], R.index[t + 2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', R.geo.attributes.position);
  g.setIndex(ids);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.updateMatrixWorld(true);
  R.rayMeshes.set(key, m);
  return m;
}

const _ray = new THREE.Raycaster();
const _tri = new THREE.Triangle();
const _bc = new THREE.Vector3();
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3();
/** 合并蒙皮权重（取最大的 4 个并归一化） */
function blendSkin(R, ids, ws) {
  const acc = new Map();
  for (let j = 0; j < ids.length; j++) {
    for (let k = 0; k < 4; k++) {
      const w = R.sw[ids[j] * 4 + k] * ws[j];
      if (w <= 0) continue;
      const b = R.si[ids[j] * 4 + k];
      acc.set(b, (acc.get(b) || 0) + w);
    }
  }
  const arr = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
  const tot = arr.reduce((s, e) => s + e[1], 0) || 1;
  const si = [0, 0, 0, 0], sw = [0, 0, 0, 0];
  arr.forEach(([b, w], k) => { si[k] = b; sw[k] = w / tot; });
  return { si, sw };
}

/**
 * 在静止姿态的毛皮上打一条射线（origin / dir 在身体骨骼空间），返回命中点（网格空间）、法线、插值后的蒙皮权重。
 */
function hitBody(R, parts, ox, oy, oz, dx, dy, dz) {
  const m = rayMesh(R, parts);
  const M = R.rest[R.B.body];
  const o = _q.set(ox, oy, oz).applyMatrix4(M);
  const d = new THREE.Vector3(dx, dy, dz).transformDirection(M);
  _ray.set(o, d);
  _ray.far = 3;
  const h = _ray.intersectObject(m, false)[0];
  if (!h) return null;
  const { a, b, c } = h.face;
  _va.fromArray(R.pos, a * 3); _vb.fromArray(R.pos, b * 3); _vc.fromArray(R.pos, c * 3);
  _tri.set(_va, _vb, _vc).getBarycoord(h.point, _bc);
  const ws = [_bc.x, _bc.y, _bc.z];
  const n = new THREE.Vector3();
  for (let j = 0; j < 3; j++) n.addScaledVector(_va.fromArray(R.nor, [a, b, c][j] * 3), ws[j]);
  n.normalize();
  return { p: h.point.clone(), n, ...blendSkin(R, [a, b, c], ws) };
}

/**
 * 贴花网格：nu×nv 条射线打在毛皮上，命中点沿法线外扩 off，连成一片（跟着命中处的皮肤走）。
 * ray(u, v) → [ox, oy, oz, dx, dy, dz]（身体空间）；color(u, v, P)
 */
function addDecal(W, R, { parts, nu, nv, ray, off, color }) {
  const ids = new Int32Array((nu + 1) * (nv + 1)).fill(-1);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      const r = ray(u, v);
      const h = hitBody(R, parts, ...r);
      if (!h) continue;
      color(u, v, P);
      const o = typeof off === 'function' ? off(u, v) : off;
      ids[j * (nu + 1) + i] = W.vert(h.p.addScaledVector(h.n, o), h.n, h.si, h.sw);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = ids[j * (nu + 1) + i], b = ids[j * (nu + 1) + i + 1], c = ids[(j + 1) * (nu + 1) + i], d = ids[(j + 1) * (nu + 1) + i + 1];
      if (a >= 0 && b >= 0 && d >= 0) W.idx.push(a, b, d);
      if (a >= 0 && d >= 0 && c >= 0) W.idx.push(a, d, c);
    }
  }
}

/**
 * 刚体部件：geo（部件本地坐标）经 matrix（本地 → 网格静止空间）放好；
 * skin = { bone } 整块跟一根骨骼；或 skin = { si, sw } 用给定权重；或 skin = (pLocal) → { si, sw }。
 * color(pLocal, P) 或 [a, b?, s?]（常量）
 */
const _sk = { si: [0, 0, 0, 0], sw: [1, 0, 0, 0] };
function addPiece(W, geo, { matrix, color, skin }) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  _m3.getNormalMatrix(matrix);
  const base = W.n;
  const pl = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    pl.fromBufferAttribute(pos, i);
    if (typeof color === 'function') color(pl, P); else paint(P, color[0], color[1] || null, color[2] || 0);
    let s = _sk;
    if (typeof skin === 'function') s = skin(pl);
    else if (skin.si) s = skin;
    else { _sk.si[0] = skin.bone; _sk.sw[0] = 1; }
    _p.copy(pl).applyMatrix4(matrix);
    _n.fromBufferAttribute(nor, i).applyMatrix3(_m3).normalize();
    W.vert(_p, _n, s.si, s.sw);
  }
  if (geo.index) for (let i = 0; i < geo.index.count; i++) W.idx.push(base + geo.index.getX(i));
  else for (let i = 0; i < pos.count; i++) W.idx.push(base + i);
}

// ================================================================ 造型小工具
/** 绕 Y 轴旋转的轮廓体。profile: [[r, y], ...]；warp(v 本地点, theta) 可改写顶点 */
function revolve(profile, segs, warp = null) {
  const pos = [], idx = [];
  const nP = profile.length;
  const v = new THREE.Vector3();
  for (let j = 0; j <= segs; j++) {
    const th = (j / segs) * Math.PI * 2;
    const sx = Math.sin(th), cz = Math.cos(th);
    for (let i = 0; i < nP; i++) {
      const [r, y] = profile[i];
      v.set(r * sx, y, r * cz);
      if (warp) warp(v, th, i);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < nP - 1; i++) {
      const a = j * nP + i, b = (j + 1) * nP + i;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  weldNormals(g);
  return g;
}
const noUV = (g) => { g.deleteAttribute('uv'); return g; };
const M4 = () => new THREE.Matrix4();
const TR = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const ROT = (x, y, z, order = 'XYZ') => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, order));
const SC = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
const mul = (...ms) => ms.reduce((a, b) => a.multiply(b), new THREE.Matrix4());
/** 圆角“饼”：一个压扁的椭球 */
const pillow = (rx, ry, rz, ws = 14, hs = 10) => ellipsoid(0, 0, 0, rx, ry, rz, { ws, hs });

// ================================================================ 帽子：让开耳朵
// 帽子在头骨空间的安放：头顶偏前，向前倾 0.26（贴着头顶曲面）
const HAT_MOUNT = mul(TR(0, 0.222, 0.07), ROT(0.26, 0, 0), SC(1.3, 1.3, 1.3));
let EAR_CLEAR = null;
/** 在一组耳朵姿态下，统计耳朵（含一点余量）在“帽子本地空间”各方位 / 高度上离帽轴最近的距离 */
function earClearance(R) {
  if (EAR_CLEAR) return EAR_CLEAR;
  const NT = 72, Y0 = -0.04, DY = 0.01, NY = 30;
  const tab = new Float32Array(NT * NY).fill(1);
  const inv = HAT_MOUNT.clone().invert();
  const e = new THREE.Euler(0, 0, 0, 'ZXY');
  const rot = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (const side of ['earL', 'earR']) {
    const k = R.partNames.indexOf(side);
    const s = side === 'earL' ? 1 : -1;
    const base = new THREE.Vector3(DIM.EAR[0] * s, DIM.EAR[1], DIM.EAR[2]);
    const pts = [];
    for (let i = 0; i < R.count; i++) if (R.partOf[i] === k) pts.push(new THREE.Vector3().fromArray(R.localP, i * 3));
    for (const eb of [-0.85, -0.6, -0.35, -0.1, 0.15, 0.4, 0.7, 1.0, 1.35]) {
      for (const eo of [-0.12, 0.05, 0.25, 0.5, 0.8]) {
        e.set(-eb, 0, -eo * s);
        rot.makeRotationFromEuler(e);
        for (const p of pts) {
          v.copy(p).applyMatrix4(rot).add(base).applyMatrix4(inv);
          const yi = Math.floor((v.y - Y0) / DY);
          if (yi < 0 || yi >= NY) continue;
          const th = Math.atan2(v.x, v.z);
          const ti = ((Math.floor(((th / (Math.PI * 2)) + 1) * NT) % NT) + NT) % NT;
          const r = Math.hypot(v.x, v.z);
          if (r < tab[yi * NT + ti]) tab[yi * NT + ti] = r;
        }
      }
    }
  }
  // 邻域取最小（方位 ±2 格、高度 ±1 格），得到平滑保守的可用半径
  const out = new Float32Array(NT * NY);
  for (let yi = 0; yi < NY; yi++) {
    for (let ti = 0; ti < NT; ti++) {
      let m = 1;
      for (let dy = -1; dy <= 1; dy++) {
        const y2 = yi + dy;
        if (y2 < 0 || y2 >= NY) continue;
        for (let dt = -2; dt <= 2; dt++) m = Math.min(m, tab[y2 * NT + ((ti + dt + NT) % NT)]);
      }
      out[yi * NT + ti] = m;
    }
  }
  EAR_CLEAR = { NT, Y0, DY, NY, tab: out };
  return EAR_CLEAR;
}
/** 帽子本地点 v：如果会碰到耳朵，沿径向收进去（留 margin） */
function dodgeEars(v, margin = 0.014, minR = 0.0) {
  const E = EAR_CLEAR;
  const yi = Math.floor((v.y - E.Y0) / E.DY);
  if (yi < 0 || yi >= E.NY) return v;
  const th = Math.atan2(v.x, v.z);
  const ti = ((Math.floor(((th / (Math.PI * 2)) + 1) * E.NT) % E.NT) + E.NT) % E.NT;
  const lim = Math.max(minR, E.tab[yi * E.NT + ti] - margin);
  const r = Math.hypot(v.x, v.z);
  if (r > lim && r > 1e-6) { v.x *= lim / r; v.z *= lim / r; }
  return v;
}

function hatPieces(W, R, id) {
  earClearance(R);
  const head = R.B.head;
  const M = R.rest[head].clone().multiply(HAT_MOUNT);
  const sk = { bone: head };
  const put = (geo, color, local = M4()) => addPiece(W, geo, { matrix: M.clone().multiply(local), color, skin: sk });
  const TAU = Math.PI * 2;
  if (id === 'hat_straw') {
    // 帽冠（下沿埋进头顶的毛里）+ 宽檐（檐边微微上翘），系一圈红丝带
    const prof = [[0.0, 0.07], [0.03, 0.069], [0.05, 0.064], [0.06, 0.05], [0.064, 0.03], [0.066, 0.012], [0.07, 0.006], [0.1, 0.004], [0.13, 0.008], [0.145, 0.016], [0.148, 0.02], [0.142, 0.012], [0.12, 0.0], [0.09, -0.004], [0.066, -0.006], [0.062, -0.03]];
    const g = revolve(prof, 32, (v, th, i) => { if (i >= 6) dodgeEars(v, 0.016, 0.075); });
    put(g, (p, o) => {
      const r = Math.hypot(p.x, p.z);
      // 草编：同心圈纹（帽檐）+ 横纹（帽冠）
      const band = p.y > 0.012 && p.y < 0.03 && r < 0.072;
      if (band) paint(o, K.ribbon, K.redDeep, Math.atan2(p.x, p.z) / TAU * 0);
      else paint(o, K.straw, K.strawDark, r > 0.07 ? r / 0.012 : p.y / 0.011);
    });
    // 丝带在侧后方打个小结
    const bow = mergeList([
      [pillow(0.016, 0.01, 0.006), TR(-0.012, 0, 0)],
      [pillow(0.016, 0.01, 0.006), TR(0.012, 0, 0)],
      [pillow(0.006, 0.008, 0.007), M4()],
    ]);
    put(bow, [K.ribbon], mul(ROT(0, -2.2, 0), TR(0, 0.022, 0.068)));
  } else if (id === 'hat_cap') {
    // 六片瓜皮帽冠（红 / 白前片）+ 顶扣 + 向前的帽檐
    const prof = [];
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * (Math.PI / 2); prof.push([Math.sin(a) * 0.068, -0.026 + Math.cos(a) * 0.082]); }
    prof.push([0.068, -0.03]);
    const g = revolve(prof.map(([r, y]) => [r, Math.max(y, -0.03)]), 36, (v) => dodgeEars(v, 0.014, 0.045));
    put(g, (p, o) => {
      const th = Math.atan2(p.x, p.z);
      const front = Math.abs(th) < 0.75 && p.y > -0.005;
      const seam = th / TAU * 6 + 0.5; // 6 片的接缝线
      if (front) paint(o, K.capWhite, K.capWhite);
      else paint(o, K.capRed, K.capRed);
      o.s = seam;
      if (p.y < 0.0 && !front) paint(o, K.capRed, K.capRed, seam);
    });
    put(pillow(0.011, 0.007, 0.011, 10, 6), [K.capNavy], TR(0, 0.056, 0));
    // 帽檐：前方半圆、略下弯
    const visor = new THREE.BufferGeometry();
    {
      const pos = [], idx = [];
      const NA = 16, NR = 4;
      for (let a = 0; a <= NA; a++) {
        const th = -1.05 + (a / NA) * 2.1;
        for (let r = 0; r <= NR; r++) {
          const t = r / NR;
          const rad = 0.062 + t * 0.07 * Math.cos(th * 0.75);
          for (const side of [1, -1]) {
            const y = -0.004 - 0.022 * t * t + side * 0.004 * (1 - 0.5 * t);
            pos.push(Math.sin(th) * rad, y, Math.cos(th) * rad);
          }
        }
      }
      const W2 = (NR + 1) * 2;
      for (let a = 0; a < NA; a++) for (let r = 0; r < NR; r++) for (const s of [0, 1]) {
        const i0 = a * W2 + r * 2 + s, i1 = i0 + 2, j0 = i0 + W2, j1 = j0 + 2;
        idx.push(i0, i1, j0, j0, i1, j1);
      }
      // 外沿封口
      for (let a = 0; a < NA; a++) { const i0 = a * W2 + NR * 2, j0 = i0 + W2; idx.push(i0, i0 + 1, j0, j0, i0 + 1, j0 + 1); }
      visor.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      visor.setIndex(idx);
      visor.computeVertexNormals();
    }
    put(visor, [K.capNavy]);
    // 前片上的小徽标（红圆点）
    put(pillow(0.016, 0.016, 0.004, 12, 6), [K.capRed], mul(ROT(-0.55, 0, 0), TR(0, 0.03, 0.06)));
  } else if (id === 'hat_beanie') {
    // 针织帽身（竖罗纹 + 两道横条）+ 翻边 + 绒球
    const prof = [];
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * (Math.PI / 2); prof.push([Math.sin(a) * 0.07, 0.0 + Math.cos(a) * 0.085]); }
    prof.push([0.071, -0.028]);
    const g = revolve(prof, 30, (v) => dodgeEars(v, 0.014, 0.045));
    put(g, (p, o) => {
      const th = Math.atan2(p.x, p.z);
      const s = (th / TAU) * 28;
      const band = (p.y > 0.03 && p.y < 0.042) || (p.y > 0.055 && p.y < 0.064);
      paint(o, band ? K.cream : K.teal, band ? K.cream : K.tealDark, s);
    });
    const cuff = revolve([[0.074, -0.03], [0.081, -0.024], [0.083, -0.004], [0.08, 0.016], [0.071, 0.02], [0.068, 0.0]], 30, (v) => dodgeEars(v, 0.012, 0.05));
    put(cuff, (p, o) => paint(o, K.mustard, K.yellowDeep, (Math.atan2(p.x, p.z) / TAU) * 28));
    const pom = blob(12, 9, (v, o) => {
      const f = 1 + 0.16 * Math.max(0, Math.sin(v.x * 9.1 + v.y * 7.3) * Math.sin(v.z * 8.7 - v.y * 5.1));
      o.set(v.x * 0.036 * f, v.y * 0.034 * f, v.z * 0.036 * f);
    });
    put(pom, [K.cream], TR(0, 0.112, -0.004));
  } else if (id === 'hat_party') {
    // 尖顶锥（螺旋条纹）+ 底边褶边 + 帽尖绒球
    const prof = [[0.0, 0.17], [0.012, 0.15], [0.03, 0.1], [0.048, 0.05], [0.06, 0.012], [0.063, -0.026]];
    const g = revolve(prof, 36, (v) => dodgeEars(v, 0.014, 0.04));
    put(g, (p, o) => {
      const th = Math.atan2(p.x, p.z);
      paint(o, K.partyPink, K.partyYellow, (th / TAU) * 5 + p.y / 0.028);
    }, M4());
    const ruff = revolve([[0.062, -0.006], [0.075, -0.002], [0.079, 0.006], [0.072, 0.012], [0.06, 0.012]], 30, (v, th) => {
      const k = 1 + 0.08 * Math.sin(th * 16);
      v.x *= k; v.z *= k;
      dodgeEars(v, 0.012, 0.055);
    });
    put(ruff, [K.partyBlue]);
    const pom = blob(14, 10, (v, o) => {
      const f = 1 + 0.18 * Math.max(0, Math.sin(v.x * 9.1 + v.y * 7.3) * Math.sin(v.z * 8.7 - v.y * 5.1));
      o.set(v.x * 0.024 * f, v.y * 0.022 * f, v.z * 0.024 * f);
    });
    put(pom, [K.partyYellow], TR(0, 0.178, 0));
  } else if (id === 'hat_beret') {
    // 扁圆软帽，向右歪；顶上一根小揪揪
    const prof = [[0.0, 0.05], [0.04, 0.049], [0.075, 0.042], [0.1, 0.028], [0.108, 0.014], [0.1, 0.004], [0.08, 0.0], [0.066, -0.004], [0.062, -0.028]];
    const tilt = mul(ROT(0, 0, -0.2), TR(0.0, 0.0, 0.0));
    const g = revolve(prof, 30, (v, th, i) => { v.applyMatrix4(tilt); if (i >= 2) dodgeEars(v, 0.014, 0.05); });
    put(g, (p, o) => paint(o, K.beret, K.beretDark, Math.hypot(p.x, p.z) / 0.03));
    const stem = noUV(new THREE.CylinderGeometry(0.004, 0.006, 0.02, 6, 1));
    put(stem, [K.beretDark], mul(tilt.clone(), TR(0, 0.058, 0)));
  } else if (id === 'hat_cowboy') {
    // 帽冠顶上一道凹槽，宽檐左右上卷，一圈深色皮带
    const prof = [[0.0, 0.058], [0.02, 0.062], [0.045, 0.072], [0.058, 0.068], [0.062, 0.04], [0.064, 0.012], [0.068, 0.004], [0.1, 0.002], [0.13, 0.006], [0.142, 0.014], [0.138, 0.006], [0.11, -0.004], [0.08, -0.006], [0.066, -0.008], [0.062, -0.03]];
    const g = revolve(prof, 36, (v, th, i) => {
      const r = Math.hypot(v.x, v.z);
      if (i <= 2) v.x *= 1 - 0.25 * (1 - i / 3); // 顶上的捏痕：两边捏扁
      if (r > 0.07) v.y += 0.035 * Math.pow(Math.abs(Math.sin(th)), 2) * ss(0.07, 0.14, r) - 0.008 * ss(0.07, 0.14, r) * Math.cos(th) ** 2;
      if (i >= 6) dodgeEars(v, 0.016, 0.075);
    });
    put(g, (p, o) => {
      const r = Math.hypot(p.x, p.z);
      if (r < 0.068 && p.y > 0.008 && p.y < 0.024) paint(o, K.leather, K.gold, Math.atan2(p.x, p.z) / (Math.PI * 2) * 0);
      else paint(o, K.cowboy, K.cowboyDark, r > 0.07 ? r / 0.025 : 0);
    });
    // 皮带扣
    put(pillow(0.009, 0.008, 0.004, 8, 6), [K.gold], TR(0, 0.016, 0.066));
  }
}

/** 静态合并（带变换）→ 只有 position / normal 的几何 */
function mergeList(list) {
  const pos = [], nor = [], idx = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), m3 = new THREE.Matrix3();
  for (const [g, m] of list) {
    m3.getNormalMatrix(m);
    const base = pos.length / 3;
    const P2 = g.attributes.position, N2 = g.attributes.normal;
    for (let i = 0; i < P2.count; i++) {
      v.fromBufferAttribute(P2, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
      n.fromBufferAttribute(N2, i).applyMatrix3(m3).normalize(); nor.push(n.x, n.y, n.z);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < P2.count; i++) idx.push(base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** 蝴蝶结（本地：中心在原点，正面朝 +Z，左右两片 + 中间的结 + 两根飘带） */
function bowGeo(w = 0.05, h = 0.034, d = 0.016, tails = true) {
  const lobe = (s) => blob(14, 10, (v, o) => {
    // 一端收窄（靠中间的结），另一端圆鼓
    const t = (v.x + 1) / 2; // 0 内 .. 1 外
    const k = 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.12));
    o.set(s * (0.006 + t * w), v.y * h * k, v.z * d * k);
  });
  const list = [[lobe(1), M4()], [lobe(-1), M4()], [pillow(0.011, 0.012, 0.011, 10, 8), M4()]];
  if (tails) {
    const tail = (s) => blob(8, 8, (v, o) => {
      const t = (v.y + 1) / 2; // 0 下 .. 1 上
      o.set(v.x * 0.009 * (0.7 + 0.3 * t) + s * (1 - t) * 0.018, -0.006 - (1 - t) * h * 1.25, v.z * 0.004 + 0.001);
    });
    list.push([tail(1), M4()], [tail(-1), M4()]);
  }
  return mergeList(list);
}

// ================================================================ 各件服饰（穿在身上的几何，网格静止空间）
const legNames = ['FL', 'FR', 'RL', 'RR'];
const legTot = (n) => (n[0] === 'F' ? DIM.FRONT.L1 + DIM.FRONT.L2 : DIM.REAR.L1 + DIM.REAR.L2);
const ang = (x, y) => Math.atan2(x, y) / (Math.PI * 2); // -0.5..0.5

/** 兜帽：垂在背上靠近脖子的地方，开口朝后上方。外壳 + 卷边 + 内衬 */
function addHood(W, R, outerC, liningC, rimC) {
  // 背上有东西（变体 flat）：兜帽压扁、往前收到领口后面，给背包 / 翅膀 / 龟壳让位
  const flat = VAR === 'flat';
  const hb = hitBody(R, ['torso', 'neck'], 0, 0.5, flat ? 0.19 : 0.15, 0, -1, 0);
  if (!hb) return;
  const outer = [], inner = [];
  for (let i = 0; i <= 5; i++) { const a = (i / 5) * (Math.PI / 2); outer.push([Math.sin(a), -Math.cos(a)]); }
  for (let i = 5; i >= 0; i--) { const a = (i / 5) * (Math.PI / 2); inner.push([Math.sin(a) * 0.86, -Math.cos(a) * 0.84 + 0.02]); }
  const lip = [[1.0, 0.0], [1.04, 0.07], [0.95, 0.1], [0.86, 0.04], [0.86, 0.02]];
  const up = new THREE.Vector3(0, 1, 0.55).normalize().transformDirection(R.rest[R.B.body]);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  const m = new THREE.Matrix4().compose(hb.p.clone().addScaledVector(hb.n, flat ? 0.026 : 0.05), q, flat ? new THREE.Vector3(0.1, 0.016, 0.05) : new THREE.Vector3(0.12, 0.045, 0.1));
  const skin = { si: hb.si, sw: hb.sw };
  addPiece(W, revolve(outer, 16), { matrix: m, color: [outerC], skin });
  addPiece(W, revolve(lip, 16), { matrix: m, color: [rimC], skin });
  addPiece(W, revolve(inner, 16), { matrix: m, color: [liningC], skin });
}

/** 贴在衣服表面的小圆件（扣子等）：射线命中处，朝法线方向 */
function addStud(W, R, parts, ray, geo, color, lift) {
  const h = hitBody(R, parts, ...ray);
  if (!h) return null;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), h.n);
  const m = new THREE.Matrix4().compose(h.p.clone().addScaledVector(h.n, lift), q, new THREE.Vector3(1, 1, 1));
  addPiece(W, geo, { matrix: m, color, skin: h });
  return h;
}

function buildTop(W, R, id) {
  if (id === 'top_stripe') {
    addShell(W, R, {
      parts: ['torso', 'neck', 'legFL', 'legFR'],
      mask: (f) => (f.part === 'torso' ? f.b.z > -0.13 : f.part === 'neck' ? f.l.y < 0.045 : f.l.y > -0.056),
      off: (f) => (f.part === 'neck' ? 0.015 : f.part === 'torso' ? 0.011 : 0.012),
      color: (f, o) => {
        if (f.part === 'torso') {
          if (f.b.z < -0.105) paint(o, K.navy, K.navy, f.b.z / 0.05);
          else paint(o, K.white, K.navy, f.b.z / 0.05 + 0.25);
        } else if (f.part === 'neck') {
          if (f.l.y > 0.022) paint(o, K.red, K.redDeep, ang(f.l.x, f.l.z) * 30); // 红色罗纹领口
          else paint(o, K.white, K.navy, ang(f.l.x, f.l.z) * 30 * 0 - f.l.y / 0.05);
        } else paint(o, f.l.y < -0.038 ? K.navy : K.white, K.navy, -f.l.y / 0.05);
      },
      wrap: 30,
    });
  } else if (id === 'top_sweater' || id === 'top_hoodie') {
    const hood = id === 'top_hoodie';
    const body = hood ? K.hoodie : K.redKnit, bodyD = hood ? K.hoodieDark : K.redKnitDark;
    const rib = hood ? K.hoodieDark : K.cream, ribD = hood ? K.hoodieDark.clone().multiplyScalar(0.88) : K.cream.clone().multiplyScalar(0.88);
    addShell(W, R, {
      parts: ['torso', 'neck', 'legFL', 'legFR'],
      mask: (f) => (f.part === 'torso' ? f.b.z > -0.17 : f.part === 'neck' ? f.l.y < (hood ? 0.05 : 0.1) : f.l.y > -0.1),
      off: (f) => (f.part === 'neck' ? (hood ? 0.016 : 0.02 + 0.008 * ss(-0.02, 0.08, f.l.y)) : 0.013),
      color: (f, o) => {
        if (f.part === 'torso') {
          const s = ang(f.b.x, f.b.y) * 56;
          if (f.b.z < -0.14) paint(o, rib, ribD, s); // 下摆罗纹
          else if (hood) paint(o, body, body, s);
          else if (Math.abs(f.b.z) < 0.03) paint(o, K.cream, K.redKnit, s * 0.5); // 提花带
          else if (Math.abs(Math.abs(f.b.z) - 0.065) < 0.011) paint(o, K.cream, K.cream, s);
          else paint(o, body, bodyD, s);
        } else if (f.part === 'neck') paint(o, hood ? body : rib, hood ? body : ribD, ang(f.l.x, f.l.z) * 36);
        else {
          const s = ang(f.l.x, f.l.z) * 20;
          if (f.l.y < -0.075) paint(o, rib, ribD, s);
          else paint(o, body, hood ? body : bodyD, s);
        }
      },
      wrap: 1,
    });
    if (hood) {
      addHood(W, R, K.hoodie, K.hoodieLining, K.hoodieDark);
      // 两根白抽绳：从领口前面垂下（跟着胸口走）
      for (const s of [1, -1]) {
        const h = hitBody(R, ['torso', 'neck'], 0.03 * s, 0.07, 0.8, 0, 0, -1);
        if (!h) continue;
        const g = noUV(new THREE.CylinderGeometry(0.0045, 0.0045, 0.075, 6, 1));
        g.translate(0, -0.0375, 0);
        const tip = noUV(new THREE.CylinderGeometry(0.006, 0.006, 0.012, 6, 1));
        tip.translate(0, -0.08, 0);
        const dn = new THREE.Vector3(0, -1, 0.25).normalize().transformDirection(R.rest[R.B.body]);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dn);
        const m = new THREE.Matrix4().compose(h.p.clone().addScaledVector(h.n, 0.02), q, new THREE.Vector3(1, 1, 1));
        addPiece(W, mergeList([[g, M4()], [tip, M4()]]), { matrix: m, color: [K.white], skin: h });
      }
    }
  } else if (id === 'top_raincoat') {
    addShell(W, R, {
      parts: ['torso', 'butt', 'neck', 'legFL', 'legFR'],
      mask: (f) => (f.part === 'torso' ? f.b.z > -0.3 : f.part === 'butt' ? f.b.y > -0.045 : f.part === 'neck' ? f.l.y < 0.06 : f.l.y > -0.075),
      off: (f) => (f.part === 'butt' ? 0.017 : f.part === 'neck' ? 0.018 : 0.015),
      color: (f, o) => {
        if (f.part === 'neck') paint(o, f.l.y > 0.035 ? K.navy : K.yellow);
        else if (f.part === 'torso' || f.part === 'butt') {
          const hem = f.part === 'butt' ? f.b.y < -0.022 : f.b.z < -0.28;
          paint(o, hem ? K.navy : K.yellow); // 下摆藏青滚边
        } else paint(o, f.l.y < -0.06 ? K.navy : K.yellow);
      },
    });
    addHood(W, R, K.yellow, K.yellowLining, K.yellowDeep);
    // 胸前三颗牛角扣
    for (let k = 0; k < 3; k++) addStud(W, R, ['torso', 'neck'], [0, 0.03 - k * 0.055, 0.8, 0, 0, -1], mergeList([[pillow(0.018, 0.007, 0.006, 10, 6), M4()]]), [K.toggle], 0.019);
    // 两侧口袋（袋盖深一点）
    for (const s of [1, -1]) {
      addDecal(W, R, {
        parts: ['torso'], nu: 4, nv: 3,
        ray: (u, v) => [s * 0.5, -0.07 + v * 0.06, 0.02 + u * 0.08, -s, 0, 0],
        off: (u, v) => 0.019 + (v > 0.7 ? 0.004 : 0),
        color: (u, v, o) => paint(o, v > 0.66 ? K.yellowDeep : K.yellow),
      });
    }
  } else if (id === 'top_cape') {
    // 披风：盖住后背和两侧上半，边缘往外飘一点；领口一圈金边 + 一颗金扣
    const flare = (y) => 0.016 + 0.022 * ss(0.03, -0.04, y);
    addShell(W, R, {
      parts: ['torso', 'butt', 'neck'],
      mask: (f) => (f.part === 'neck' ? f.l.y < 0.04 : f.part === 'butt' ? f.b.y > -0.03 : f.b.y > -0.05 + 0.04 * ss(0.22, 0.3, f.b.z) && f.b.z > -0.3),
      off: (f) => (f.part === 'neck' ? 0.017 : f.part === 'butt' ? flare(f.b.y) + 0.003 : flare(f.b.y)),
      color: (f, o) => {
        if (f.part === 'neck') paint(o, f.l.y > 0.015 ? K.gold : K.cape, K.goldDark, 0);
        else {
          const edge = f.part === 'butt' ? f.b.y < -0.012 : f.b.y < -0.032 + 0.04 * ss(0.22, 0.3, f.b.z);
          paint(o, edge ? K.gold : K.cape, edge ? K.goldDark : K.capeDark, f.b.z / 0.05);
          if (!edge) o.b.copy(o.a);
        }
      },
    });
    addStud(W, R, ['neck', 'torso'], [0, 0.11, 0.8, 0, 0, -1], mergeList([[pillow(0.02, 0.02, 0.008, 12, 8), M4()]]), (p, o) => paint(o, Math.hypot(p.x, p.y) < 0.009 ? K.goldDark : K.gold), 0.024);
  } else if (id === 'top_overalls') {
    // 裤子：躯干后半 + 屁股 + 大腿（短裤腿）
    addShell(W, R, {
      parts: ['torso', 'butt', 'legRL', 'legRR'],
      mask: (f) => (f.part === 'torso' ? f.b.z < 0.0 : f.part === 'butt' ? true : f.l.y > -0.085),
      off: (f) => (f.part === 'butt' ? 0.015 : f.part === 'torso' ? 0.013 : 0.014),
      color: (f, o) => {
        if (f.part === 'torso' || f.part === 'butt') paint(o, f.part === 'torso' && f.b.z > -0.02 ? K.denimDark : K.denim);
        else paint(o, f.l.y < -0.07 ? K.denimDark : K.denim);
      },
    });
    // 胸兜（胸前一块，射线从前往后打）
    addDecal(W, R, {
      parts: ['torso', 'neck'], nu: 6, nv: 6,
      ray: (u, v) => [(u - 0.5) * 0.17, -0.13 + v * 0.16, 0.8, 0, 0, -1],
      off: 0.016,
      color: (u, v, o) => paint(o, u > 0.25 && u < 0.75 && v > 0.25 && v < 0.65 ? K.denimDark : K.denim),
    });
    // 两条背带：从后背裤腰沿背往前，绕过肩头落到胸兜上沿
    for (const s of [1, -1]) {
      const x0 = 0.07 * s;
      addDecal(W, R, {
        parts: ['torso', 'neck'], nu: 2, nv: 18,
        ray: (u, v) => {
          const x = x0 + (u - 0.5) * 0.04 - s * 0.012 * v;
          if (v < 0.6) return [x, 0.6, -0.02 + (v / 0.6) * 0.21, 0, -1, 0];
          const a = ((v - 0.6) / 0.4) * (Math.PI / 2) * 0.92;
          return [x, Math.cos(a) * 0.6, 0.19 + Math.sin(a) * 0.6, 0, -Math.cos(a), -Math.sin(a)];
        },
        off: 0.017,
        color: (u, v, o) => paint(o, K.denimDark),
      });
      addStud(W, R, ['torso', 'neck'], [x0 * 0.85, 0.02, 0.8, 0, 0, -1], mergeList([[pillow(0.013, 0.013, 0.006, 12, 6), M4()]]), [K.brass], 0.022);
    }
  }
}

function buildShoes(W, R, id) {
  for (let li = 0; li < 4; li++) {
    const L = legNames[li];
    const tot = legTot(L);
    W.curTag = li;
    let top, off, color, fine = false;
    if (id === 'shoes_redboots') {
      top = -tot + 0.085;
      off = (f) => (f.l.y > top - 0.03 ? 0.022 : 0.012);
      color = (f, o) => {
        if (f.l.y > top - 0.03) paint(o, K.white, K.cream, 0); // 靴口白绒毛
        else if (f.l.y < -tot - 0.02) paint(o, K.sole);
        else paint(o, K.bootRed, K.bootRedDeep, 0);
      };
    } else if (id === 'shoes_rainboots') {
      top = -tot + 0.11;
      off = (f) => (f.l.y > top - 0.022 ? 0.017 : 0.013);
      color = (f, o) => {
        if (f.l.y < -tot - 0.019) paint(o, K.sole);
        else if (f.l.y > top - 0.022) paint(o, K.navy); // 靴口一圈藏青
        else paint(o, K.mustard);
      };
    } else if (id === 'shoes_snowboots') {
      top = -tot + 0.1;
      fine = true;
      off = (f) => {
        const cuff = ss(top - 0.04, top - 0.03, f.l.y);
        // 翻毛靴口：厚，带一点毛簇起伏
        return 0.013 + cuff * (0.022 + 0.008 * Math.sin(Math.atan2(f.l.x, f.l.z) * 7 + f.l.y * 90));
      };
      color = (f, o) => {
        if (f.l.y > top - 0.035) paint(o, K.snowFur);
        else if (f.l.y < -tot - 0.02) paint(o, K.sole);
        else paint(o, K.snowTan, K.snowTanDark, (f.l.y + tot) / 0.02);
      };
    } else if (id === 'shoes_socks' || id === 'shoes_rainbow') {
      const rb = id === 'shoes_rainbow';
      top = -tot + (rb ? 0.115 : 0.098);
      fine = rb;
      off = (f) => (f.l.y > top - 0.012 ? 0.011 : 0.008);
      color = (f, o) => {
        if (rb) {
          if (f.l.y > top - 0.014) { paint(o, K.white, K.flowerPink, ang(f.l.x, f.l.z) * 24); return; }
          const h = THREE.MathUtils.clamp((f.l.y + tot + 0.03) / 0.13, 0, 1);
          const c = new THREE.Color().setHSL(0.83 * (1 - h) * 0.98, 0.78, 0.62);
          paint(o, c, c.clone().multiplyScalar(0.86), (f.l.y + tot) / 0.02);
          return;
        }
        if (f.l.y > top - 0.012) paint(o, K.red, K.redDeep, ang(f.l.x, f.l.z) * 24); // 罗纹袜口
        else if (f.part.startsWith('paw') && (f.l.z > 0.035 || f.l.z < -0.02)) paint(o, K.red); // 袜尖 / 袜跟
        else paint(o, K.white, K.red, (f.l.y + tot) / 0.026);
      };
    } else {
      // 运动鞋：低帮
      top = -tot + 0.03;
      off = (f) => (f.l.y < -tot - 0.012 ? 0.015 : 0.012);
      color = (f, o) => {
        const y = f.l.y + tot;
        if (y < -0.012) paint(o, K.soleLight);
        else if (f.l.z > 0.045) paint(o, K.soleLight); // 鞋头
        else if (f.l.z < -0.02 && y > 0.0) paint(o, K.red); // 后跟提带
        else if (f.l.z > 0.0 && y > 0.005 && Math.abs(f.l.x) < 0.02) paint(o, K.sky, K.soleLight, f.l.z / 0.012); // 鞋带
        else paint(o, K.sky, K.skyDeep, 0);
      };
    }
    addShell(W, R, { parts: ['leg' + L, 'paw' + L], mask: (f) => f.l.y < top, off, color, fine });
  }
  W.curTag = 0;
}

function buildAcc(W, R, id) {
  const B = R.B;
  const neckM = R.rest[B.neck];
  // 颈部装饰的本地框架：圆环在 XZ 平面，和项圈同样的位置 / 倾角
  // 身上穿了衣服（变体 lift）：整圈放大一点，套在衣服领口外面
  const NECK_MOUNT = mul(TR(0, 0.02, 0.01), ROT(0.38, 0, 0), VAR === 'lift' ? SC(1.1, 1.1, 1.1) : M4());
  if (id === 'acc_scarf') {
    const M = neckM.clone().multiply(NECK_MOUNT);
    const ring = noUV(new THREE.TorusGeometry(0.14, 0.036, 12, 40));
    // 毛线团：一点点起伏
    const P2 = ring.attributes.position;
    for (let i = 0; i < P2.count; i++) {
      const x = P2.getX(i), y = P2.getY(i), z = P2.getZ(i);
      const a = Math.atan2(y, x);
      const k = 1 + 0.035 * Math.sin(a * 9) * Math.sin(a * 4 + 1);
      P2.setXYZ(i, x * k, y * k * 1.07, z * 1.3);
    }
    ring.computeVertexNormals();
    addPiece(W, ring, {
      matrix: M.clone().multiply(ROT(Math.PI / 2, 0, 0)),
      color: (p, o) => paint(o, K.red, K.redDeep, Math.atan2(p.y, p.x) / (Math.PI * 2) * 48),
      skin: { bone: B.neck },
    });
    // 结（左前方）+ 垂在胸前的一头（上半跟脖子，下半渐变到胸骨）
    const knotPos = new THREE.Vector3(0.07, -0.01, 0.135);
    addPiece(W, pillow(0.04, 0.034, 0.03, 14, 10), {
      matrix: M.clone().multiply(TR(knotPos.x, knotPos.y, knotPos.z)),
      color: (p, o) => paint(o, K.red, K.redDeep, p.x / 0.012),
      skin: { bone: B.neck },
    });
    const tail = blob(10, 16, (v, o) => {
      const t = (v.y + 1) / 2; // 0 底 .. 1 顶
      o.set(v.x * 0.032, -0.15 * (1 - t), v.z * 0.012 + 0.025 * (1 - t) * (1 - t));
    });
    const tailM = M.clone().multiply(mul(TR(knotPos.x + 0.005, knotPos.y - 0.01, knotPos.z + 0.012), ROT(-0.42, 0, 0.12)));
    const iC = B.chest, iN = B.neck;
    const tailSkin = (p) => {
      const w = ss(-0.02, -0.09, p.y);
      return { si: [iN, iC, 0, 0], sw: [1 - w, w, 0, 0] };
    };
    addPiece(W, tail, {
      matrix: tailM,
      color: (p, o) => {
        const end = p.y < -0.11;
        paint(o, end ? K.white : K.red, end ? K.red : K.redDeep, end ? p.y / 0.016 : p.x / 0.012);
      },
      skin: tailSkin,
    });
    // 流苏
    for (let k = 0; k < 5; k++) {
      const x = -0.024 + k * 0.012;
      const g = noUV(new THREE.CylinderGeometry(0.0035, 0.003, 0.026, 5, 1));
      addPiece(W, g, { matrix: tailM.clone().multiply(TR(x, -0.161, 0.0)), color: [K.white], skin: { si: [iC, 0, 0, 0], sw: [1, 0, 0, 0] } });
    }
  } else if (id === 'acc_bowtie') {
    const M = neckM.clone().multiply(NECK_MOUNT);
    const band = noUV(new THREE.TorusGeometry(0.126, 0.011, 8, 36));
    band.scale(1, 1.06, 1.6);
    addPiece(W, band, { matrix: M.clone().multiply(ROT(Math.PI / 2, 0, 0)), color: [K.navy], skin: { bone: B.neck } });
    // 领结：在原来铃铛的位置（项圈正前方偏下）
    const bow = bowGeo(0.068, 0.044, 0.021, false);
    addPiece(W, bow, {
      matrix: M.clone().multiply(mul(TR(0, -0.006, 0.126 * 1.06 + 0.026), ROT(-0.1, 0, 0))),
      color: (p, o) => (Math.abs(p.x) < 0.012 ? paint(o, K.navyDeep) : paint(o, K.sky, K.white, (p.x + p.y) / 0.022)),
      skin: { bone: B.neck },
    });
  } else if (id === 'acc_sunglasses') {
    const iHd = B.head;
    const M = R.rest[iHd];
    const n = new THREE.Vector3();
    for (const s of [1, -1]) {
      const x = 0.084 * s, y = 0.034;
      const z = headSurf(x, y, n);
      n.lerp(new THREE.Vector3(0, 0, 1), 0.45).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const c = new THREE.Vector3(x, y, z).addScaledVector(n, 0.026);
      const L = new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1));
      const lens = noUV(new THREE.CylinderGeometry(0.041, 0.041, 0.006, 22, 1));
      lens.rotateX(Math.PI / 2);
      addPiece(W, lens, { matrix: M.clone().multiply(L), color: (p, o) => paint(o, K.lens, K.glint, (p.x * s * 0.6 + p.y) / 0.05 + 0.15), skin: { bone: iHd } });
      const rim = noUV(new THREE.TorusGeometry(0.042, 0.0075, 6, 26));
      addPiece(W, rim, { matrix: M.clone().multiply(L), color: [K.pink], skin: { bone: iHd } });
      // 镜腿：从外沿往后伸，没进脸侧的毛里
      const arm = noUV(new THREE.CylinderGeometry(0.005, 0.005, 0.09, 6, 1));
      arm.rotateX(Math.PI / 2);
      const armM = new THREE.Matrix4().compose(new THREE.Vector3(0.128 * s, 0.05, 0.12), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.42 * s, 0)), new THREE.Vector3(1, 1, 1));
      addPiece(W, arm, { matrix: M.clone().multiply(armM), color: [K.pinkDeep], skin: { bone: iHd } });
    }
    // 鼻梁架
    const zc = headSurf(0, 0.06) + 0.022;
    const bridge = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.045, 0.05, zc - 0.012), new THREE.Vector3(0, 0.062, zc + 0.002), new THREE.Vector3(0.045, 0.05, zc - 0.012),
    ]), 8, 0.006, 6, false);
    noUV(bridge);
    addPiece(W, bridge, { matrix: M.clone(), color: [K.pink], skin: { bone: iHd } });
  } else if (id === 'acc_hairbow') {
    // 挂在右耳骨上：耳朵根前面（默认取景看得到的那一侧）
    const iE = B.earR;
    const M = R.rest[iE].clone().multiply(mul(TR(0.004, 0.046, 0.044), ROT(0.0, 0.0, 0.25)));
    addPiece(W, bowGeo(0.056, 0.038, 0.018, true), {
      matrix: M,
      color: (p, o) => (Math.abs(p.x) < 0.013 && p.y > -0.014 ? paint(o, K.pinkDeep) : paint(o, K.pink, K.white, (p.x - p.y) / 0.022)),
      skin: { bone: iE },
    });
  } else if (id === 'neck_bandana') {
    // 小方巾：一圈布带 + 前面垂下的三角（上沿跟着脖子，尖角跟着胸口）
    const M = neckM.clone().multiply(NECK_MOUNT);
    const band = noUV(new THREE.TorusGeometry(0.132, 0.014, 6, 36));
    band.scale(1, 1.07, 1.9);
    const bandPaint = (s) => (o) => paint(o, K.sky, K.white, s);
    addPiece(W, band, { matrix: M.clone().multiply(ROT(Math.PI / 2, 0, 0)), color: (p, o) => bandPaint(Math.atan2(p.y, p.x) / (Math.PI * 2) * 40)(o), skin: { bone: B.neck } });
    // 三角：在颈骨空间里直接定点（上沿取圈上的点，尖角在胸前）
    const lift = VAR === 'lift' ? 1.1 : 1;
    const NU = 14, NV = 7;
    const top = (u) => new THREE.Vector3(Math.sin(u * 1.15) * 0.145, 0.006, Math.cos(u * 1.15) * 0.145 * 1.07).applyMatrix4(NECK_MOUNT);
    const apex = new THREE.Vector3(0, -0.105, 0.19 * lift);
    const pos = [], idx = [];
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      for (let i = 0; i <= NU; i++) {
        const u = (i / NU) * 2 - 1;
        const p = top(u * (1 - v)).lerp(apex, v);
        p.z += 0.012 * Math.sin(Math.PI * v) * (1 - Math.abs(u)); // 中间微微鼓出来
        pos.push(p.x, p.y, p.z);
      }
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tri.setIndex(idx);
    tri.computeVertexNormals();
    const iC = B.chest, iN = B.neck;
    addPiece(W, tri, {
      matrix: neckM,
      color: (p, o) => paint(o, K.sky, K.white, (p.x * 0.7 - p.y) / 0.022),
      skin: (p) => { const w = ss(-0.01, -0.09, p.y); return { si: [iN, iC, 0, 0], sw: [1 - w, w, 0, 0] }; },
    });
    // 结（右侧）
    addPiece(W, pillow(0.022, 0.018, 0.016, 10, 8), { matrix: M.clone().multiply(TR(-0.1, 0.0, 0.11)), color: [K.skyDeep], skin: { bone: B.neck } });
  } else if (id === 'acc_garland') {
    // 花环：一圈绿藤 + 十朵五瓣小花（粉 / 黄 / 白），挂在颈骨上（和项圈同样的位置）
    const M = neckM.clone().multiply(NECK_MOUNT);
    const sk = { bone: B.neck };
    const vine = noUV(new THREE.TorusGeometry(0.142, 0.016, 6, 36));
    vine.scale(1, 1.07, 1.4);
    addPiece(W, vine, { matrix: M.clone().multiply(ROT(Math.PI / 2, 0, 0)), color: (p, o) => paint(o, K.leaf, K.leafDark, Math.atan2(p.y, p.x) / (Math.PI * 2) * 40), skin: sk });
    const petals = blob(10, 5, (v, o) => {
      const phi = Math.atan2(v.z, v.x);
      const r = 0.036 * (0.62 + 0.38 * Math.abs(Math.cos(2.5 * phi)));
      const k = Math.hypot(v.x, v.z);
      o.set(v.x / (k || 1) * r * k, v.y * 0.01 * (1 - 0.4 * k), v.z / (k || 1) * r * k);
    });
    const core = ellipsoid(0, 0.008, 0, 0.012, 0.007, 0.012, { ws: 6, hs: 4 });
    const leaf = ellipsoid(0, 0, 0, 0.007, 0.004, 0.016, { ws: 6, hs: 4 });
    const cols = [K.flowerPink, K.flowerYellow, K.flowerWhite];
    const NF = 10;
    for (let k = 0; k < NF; k++) {
      const a = (k / NF) * Math.PI * 2 + 0.2;
      const rx = 0.142 * Math.sin(a), rz = 0.142 * 1.07 * Math.cos(a);
      // 花朵朝外偏上
      const out = new THREE.Vector3(Math.sin(a), 0.9, Math.cos(a)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
      const pos = new THREE.Vector3(rx, 0.014, rz).addScaledVector(out, 0.012);
      const L = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
      addPiece(W, petals, { matrix: M.clone().multiply(L), color: [cols[k % 3]], skin: sk });
      addPiece(W, core, { matrix: M.clone().multiply(L), color: [k % 3 === 1 ? K.flowerCore : K.flowerYellow], skin: sk });
      const a2 = a + Math.PI / NF;
      const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, a2 + Math.PI / 2, 0));
      const Lp = new THREE.Matrix4().compose(new THREE.Vector3(0.152 * Math.sin(a2), 0.01, 0.152 * 1.07 * Math.cos(a2)), lq, new THREE.Vector3(1, 1, 1));
      addPiece(W, leaf, { matrix: M.clone().multiply(Lp), color: [K.leaf], skin: sk });
    }
  } else if (id === 'acc_backpack') {
    // 小背包：背在背中间（跟着那块皮肤走），两根肩带绕过肩头落到胸前
    const h = hitBody(R, ['torso'], 0, 0.6, -0.07, 0, -1, 0);
    if (h) {
      const zAxis = h.n.clone();
      const fwd = new THREE.Vector3(0, 0, 1).transformDirection(R.rest[B.body]);
      const yAxis = fwd.addScaledVector(zAxis, -fwd.dot(zAxis)).normalize();
      const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
      const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      basis.setPosition(h.p.clone().addScaledVector(zAxis, 0.064 + LIFT()));
      const box = (sx, sy, sz, e = 0.55) => blob(12, 8, (v, o) => {
        const f = (t) => Math.sign(t) * Math.pow(Math.abs(t), e);
        o.set(f(v.x) * sx, f(v.y) * sy, f(v.z) * sz);
      });
      const skin = { si: h.si, sw: h.sw };
      addPiece(W, box(0.08, 0.092, 0.042), { matrix: basis, color: (p, o) => paint(o, K.pack, K.packDark, 0), skin });
      // 袋盖（盖住上半，前缘垂下来）
      addPiece(W, box(0.084, 0.048, 0.022), { matrix: basis.clone().multiply(TR(0, 0.054, 0.028)), color: [K.packFlap], skin });
      // 前面的小口袋 + 扣
      addPiece(W, box(0.052, 0.032, 0.013), { matrix: basis.clone().multiply(TR(0, -0.04, 0.042)), color: [K.packDark], skin });
      addPiece(W, pillow(0.008, 0.01, 0.005, 8, 6), { matrix: basis.clone().multiply(TR(0, 0.012, 0.052)), color: [K.leather], skin });
      // 顶上的提手
      const handle = noUV(new THREE.TorusGeometry(0.016, 0.004, 5, 10, Math.PI));
      addPiece(W, handle, { matrix: basis.clone().multiply(mul(TR(0, 0.092, 0.0), ROT(0, Math.PI / 2, 0))), color: [K.packDark], skin });
    }
    for (const s of [1, -1]) {
      addDecal(W, R, {
        parts: ['torso', 'neck'], nu: 2, nv: 14,
        ray: (u, v) => {
          const x = 0.055 * s + (u - 0.5) * 0.032 + s * 0.04 * v;
          if (v < 0.45) return [x, 0.6, -0.01 + (v / 0.45) * 0.19, 0, -1, 0];
          const a = ((v - 0.45) / 0.55) * (Math.PI / 2) * 0.95;
          return [x, Math.cos(a) * 0.6, 0.16 + Math.sin(a) * 0.6, 0, -Math.cos(a), -Math.sin(a)];
        },
        off: 0.026 + LIFT(),
        color: (u, v, o) => paint(o, K.packDark),
      });
    }
  }
}

// ---------------------------------------------------------------- 眼睛区
/** 两只眼睛前的镜框位置（头骨空间）：中心 + 朝向 */
function eyeFrame(s) {
  const n = new THREE.Vector3();
  const x = 0.084 * s, y = 0.034;
  const z = headSurf(x, y, n);
  n.lerp(new THREE.Vector3(0, 0, 1), 0.45).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z).addScaledVector(n, 0.026), q, new THREE.Vector3(1, 1, 1));
}
function heartShape() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(-0.15, -0.32, -0.62, -0.05, -0.56, 0.26);
  s.bezierCurveTo(-0.5, 0.58, -0.1, 0.62, 0, 0.3);
  s.bezierCurveTo(0.1, 0.62, 0.5, 0.58, 0.56, 0.26);
  s.bezierCurveTo(0.62, -0.05, 0.15, -0.32, 0, -0.5);
  return s;
}
function buildEyes(W, R, id) {
  const iHd = R.B.head;
  const M = R.rest[iHd];
  const sk = { bone: iHd };
  const put = (geo, color, L = M4()) => addPiece(W, geo, { matrix: M.clone().multiply(L), color, skin: sk });
  const bridge = (col, r = 0.006) => {
    const zc = headSurf(0, 0.06) + 0.022;
    put(noUV(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.045, 0.05, zc - 0.012), new THREE.Vector3(0, 0.062, zc + 0.002), new THREE.Vector3(0.045, 0.05, zc - 0.012),
    ]), 8, r, 5, false)), [col]);
  };
  const arms = (col, r = 0.005) => {
    for (const s of [1, -1]) {
      const arm = noUV(new THREE.CylinderGeometry(r, r, 0.09, 5, 1));
      arm.rotateX(Math.PI / 2);
      put(arm, [col], new THREE.Matrix4().compose(new THREE.Vector3(0.128 * s, 0.05, 0.12), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.42 * s, 0)), new THREE.Vector3(1, 1, 1)));
    }
  };
  if (id === 'eyes_round') {
    // 只有细金框（没有镜片，眼睛看得见）
    for (const s of [1, -1]) put(noUV(new THREE.TorusGeometry(0.041, 0.0068, 6, 26)), [K.leather], eyeFrame(s));
    bridge(K.leather, 0.0055);
    arms(K.leather, 0.0045);
  } else if (id === 'eyes_heart') {
    const ext = (k, depth) => {
      const g = new THREE.ExtrudeGeometry(heartShape(), { depth: 1, bevelEnabled: false, curveSegments: 5 });
      noUV(g);
      g.translate(0, 0, -0.5);
      g.scale(k, k, depth);
      g.computeVertexNormals();
      return g;
    };
    for (const s of [1, -1]) {
      const L = eyeFrame(s);
      put(ext(0.092, 0.006), (p, o) => paint(o, K.red, K.capRed.clone().lerp(K.white, 0.45), (p.x * s * 0.6 + p.y) / 0.05 + 0.2), L.clone().multiply(TR(0, 0.004, 0.003)));
      put(ext(0.108, 0.005), [K.white], L.clone().multiply(TR(0, 0.004, -0.002)));
    }
    bridge(K.white);
    arms(K.white);
  } else if (id === 'eyes_patch') {
    // 黑眼罩盖住右眼（默认取景看得到的一侧）+ 一根绕过脑后的细带（在耳朵下面）
    const L = eyeFrame(-1);
    const patch = noUV(new THREE.CylinderGeometry(0.042, 0.042, 0.008, 18, 1));
    patch.rotateX(Math.PI / 2);
    patch.scale(1.05, 0.9, 1);
    put(patch, (p, o) => paint(o, K.lens, K.lens), L.clone().multiply(TR(0, 0, -0.008)));
    const SK = { cy: 0.05, cz: 0.02, rx: 0.205, ry: 0.178, rz: 0.185 };
    const pts = [];
    const th0 = Math.atan2(-0.084, 0.2); // 右眼方向
    for (let k = 0; k <= 28; k++) {
      const th = th0 + 0.36 + (k / 28) * (Math.PI * 2 - 0.72);
      const y = 0.095 + 0.035 * Math.sin(th);
      const q = 1 - ((y - SK.cy) / SK.ry) ** 2;
      const t = Math.sqrt(Math.max(0, q)) / Math.hypot(Math.sin(th) / SK.rx, Math.cos(th) / SK.rz) * 1.045;
      pts.push(new THREE.Vector3(Math.sin(th) * t, y, SK.cz + Math.cos(th) * t));
    }
    put(noUV(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0038, 4, false)), [K.lens]);
  }
}

// ---------------------------------------------------------------- 背上
/** 静止姿态里离点 p（网格空间）最近的毛皮顶点的蒙皮权重 */
const NEAR_CACHE = new Map();
function nearestSkin(R, parts, p) {
  const key = parts.join(',');
  let list = NEAR_CACHE.get(key);
  if (!list) {
    const want = new Set(parts.map((n) => R.partNames.indexOf(n)));
    list = [];
    for (let i = 0; i < R.count; i++) if (want.has(R.partOf[i])) list.push(i);
    NEAR_CACHE.set(key, list);
  }
  let best = -1, bd = 1e9;
  for (const i of list) {
    const dx = R.pos[i * 3] - p.x, dy = R.pos[i * 3 + 1] - p.y, dz = R.pos[i * 3 + 2] - p.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return { si: Array.from(R.si.subarray(best * 4, best * 4 + 4)), sw: Array.from(R.sw.subarray(best * 4, best * 4 + 4)) };
}
/** 背上一点的局部框架：原点 = 毛皮命中点沿法线外推 lift，z = 法线，y = 身体前方（切向） */
function backFrame(R, x, z, lift) {
  const h = hitBody(R, ['torso', 'neck'], x, 0.6, z, 0, -1, 0);
  const zA = h.n.clone();
  const fwd = new THREE.Vector3(0, 0, 1).transformDirection(R.rest[R.B.body]);
  const yA = fwd.addScaledVector(zA, -fwd.dot(zA)).normalize();
  const xA = new THREE.Vector3().crossVectors(yA, zA);
  const m = new THREE.Matrix4().makeBasis(xA, yA, zA);
  m.setPosition(h.p.clone().addScaledVector(zA, lift));
  return { m, h };
}
/** 平板翅膀：outline(u ∈ 0..1 沿翼展) → [上缘, 下缘]；本地 x = 翼展、y = 高、z = 厚 */
function wingGeo(span, outline, thick = 0.008, ws = 16, hs = 10) {
  return blob(ws, hs, (v, o) => {
    const u = (v.x + 1) / 2;
    const [top, bot] = outline(u);
    const y = v.y > 0 ? v.y * top : v.y * bot;
    o.set(u * span, y, v.z * thick * (1 - 0.6 * u));
  });
}
function buildBack(W, R, id) {
  const B = R.B;
  const body = R.rest[B.body];
  const lift = LIFT();
  if (id === 'back_wings') {
    // 一对白色天使小翅膀：长在肩胛后面，向外上方张开、略向后掠；羽毛一排排（条纹）
    // 上缘是一条拱起的弧；下缘是三片分明的羽毛（越往翼尖越长），这样一眼看得出是翅膀而不是一团白
    const g = wingGeo(0.29, (u) => [0.03 + 0.07 * Math.sin(Math.PI * Math.min(1, u * 1.05)) * (1 - 0.3 * u), 0.02 + (0.05 + 0.07 * u) * Math.sin(Math.PI * Math.min(1, u * 1.02)) ** 0.6 * (0.42 + 0.58 * Math.abs(Math.sin(u * Math.PI * 3)))], 0.014, 30, 10);
    for (const s of [1, -1]) {
      const { m, h } = backFrame(R, 0.06 * s, 0.07, 0.035 + lift);
      // 本地：x 翼展（往外上、后掠），y 朝上
      const span = new THREE.Vector3(s * 0.62, 0.72, -0.32).normalize().transformDirection(body);
      const up0 = new THREE.Vector3(0, 1, 0.25).transformDirection(body);
      const upA = up0.addScaledVector(span, -up0.dot(span)).normalize();
      const thA = new THREE.Vector3().crossVectors(span, upA);
      const L = new THREE.Matrix4().makeBasis(span, upA, thA);
      L.setPosition(new THREE.Vector3().setFromMatrixPosition(m));
      addPiece(W, g, {
        matrix: L,
        color: (p, o) => paint(o, K.flowerWhite, K.hoodieLining, p.x / 0.04 + (p.y < 0 ? 0.5 : 0)),
        skin: { si: h.si, sw: h.sw },
      });
    }
  } else if (id === 'back_butterfly') {
    // 蝴蝶翅膀：每边一大一小两片，竖在背上呈 V 形；橙 / 蓝，翅缘黑，翅尖白点
    const fore = wingGeo(0.24, (u) => [0.045 + 0.075 * Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.018 + 0.045 * Math.sin(Math.PI * u)], 0.005, 14, 8);
    const hind = wingGeo(0.17, (u) => [0.03 + 0.05 * Math.sin(Math.PI * u), 0.03 + 0.06 * Math.sin(Math.PI * Math.min(1, u * 1.15))], 0.004, 12, 8);
    const { m, h } = backFrame(R, 0, -0.01, 0.03 + lift);
    const base = new THREE.Vector3().setFromMatrixPosition(m);
    for (const s of [1, -1]) {
      for (const [geo, dir, col] of [[fore, new THREE.Vector3(s * 0.42, 0.85, 0.32), K.mustard], [hind, new THREE.Vector3(s * 0.5, 0.6, -0.55), K.sky]]) {
        const span = dir.clone().normalize().transformDirection(body);
        const side = new THREE.Vector3(s, 0, 0).transformDirection(body);
        const thA = side.addScaledVector(span, -side.dot(span)).normalize();
        const upA = new THREE.Vector3().crossVectors(thA, span);
        const L = new THREE.Matrix4().makeBasis(span, upA, thA);
        L.setPosition(base);
        const len = geo === fore ? 0.24 : 0.17;
        addPiece(W, geo, {
          matrix: L,
          color: (p, o) => {
            const u = p.x / len;
            const edge = u > 0.82 || Math.abs(p.y) > (geo === fore ? 0.068 : 0.058) * Math.sin(Math.PI * Math.min(1, u * 1.05)) + 0.006;
            if (u > 0.8 && Math.abs(Math.sin(p.y * 110)) < 0.35) paint(o, K.white);
            else paint(o, edge ? K.lens : col, edge ? K.lens : K.lens, u * 0 + 0);
          },
          skin: { si: h.si, sw: h.sw },
        });
      }
    }
    // 中间的小身体
    addPiece(W, ellipsoid(0, 0, 0, 0.012, 0.012, 0.05, { ws: 8, hs: 6 }), { matrix: m.clone().multiply(TR(0, 0, 0.01)), color: [K.lens], skin: { si: h.si, sw: h.sw } });
  } else if (id === 'back_shell') {
    // 小龟壳：盖在背上的扁穹顶（避开尾巴），一块块六边形甲片（顶点色），边上一圈黄；每个顶点取最近一块皮肤的蒙皮，跟着身体弯
    const RX = 0.235 + lift, RZ = 0.19 + lift, RY = 0.19 + lift, CY = 0.04, CZ = -0.02;
    const dome = blob(28, 14, (v, o) => {
      const y = Math.max(v.y, -0.08);
      const k = Math.sqrt(Math.max(0, 1 - y * y)) / Math.max(1e-6, Math.hypot(v.x, v.z));
      const bulge = 1 + 0.03 * Math.sin(v.x * 7) * Math.sin(v.z * 6);
      o.set(v.x * k * RX * bulge, CY + y * RY, CZ + v.z * k * RZ * bulge);
    });
    const centers = [[0, 0.03]];
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; centers.push([Math.sin(a) * 0.12, CZ + Math.cos(a) * 0.12]); }
    const pal = [K.leaf, K.leafDark.clone().lerp(K.leaf, 0.35)];
    const pp = new THREE.Vector3();
    addPiece(W, dome, {
      matrix: body,
      color: (p, o) => {
        if (p.y < CY + 0.02) { paint(o, K.mustard); return; }
        let d1 = 1e9, d2 = 1e9, bi = 0;
        centers.forEach(([cx, cz], i) => { const d = Math.hypot(p.x - cx, p.z - cz); if (d < d1) { d2 = d1; d1 = d; bi = i; } else if (d < d2) d2 = d; });
        if (d2 - d1 < 0.016) paint(o, K.leafDark.clone().multiplyScalar(0.7));
        else paint(o, pal[bi === 0 ? 1 : bi % 2]);
      },
      skin: (p) => nearestSkin(R, ['torso', 'butt', 'neck'], pp.copy(p).applyMatrix4(body)),
    });
  }
}

// ================================================================ 缓存：穿着用（蒙皮）/ 陈列用（静态）
const WORN = new Map();
const DISPLAY = new Map();

/** 当前正在建的变体（'' | 'flat' | 'lift'），各 build 函数读取 */
let VAR = '';
/** 背上的东西在 lift 变体下再往外垫的距离 */
const LIFT = () => (VAR === 'lift' ? 0.014 : 0);
function buildWorn(id, rig, variant) {
  const R = getRest(rig);
  const W = new Build();
  VAR = variant || '';
  try {
    if (id.startsWith('hat_')) hatPieces(W, R, id);
    else if (id.startsWith('top_')) buildTop(W, R, id);
    else if (id.startsWith('shoes_')) buildShoes(W, R, id);
    else if (id.startsWith('eyes_')) buildEyes(W, R, id);
    else if (id.startsWith('back_')) buildBack(W, R, id);
    else buildAcc(W, R, id);
  } finally { VAR = ''; }
  return W;
}

function wornBuild(id, rig, variant = '') {
  const key = id + '|' + variant;
  let e = WORN.get(key);
  if (!e) { const W = buildWorn(id, rig, variant); e = { W, geo: W.geometry(true) }; WORN.set(key, e); }
  return e;
}

/** 穿在身上的网格（SkinnedMesh，绑定 rig 的骨架）。由 dogModel 的 wear 调用；variant 见 garmentVariant。 */
export function createWornGarment(id, rig, variant = '') {
  const g = BY_ID.get(id);
  if (!g) return null;
  const { geo } = wornBuild(id, rig, variant);
  const m = new THREE.SkinnedMesh(geo, garmentMaterial());
  m.name = 'garment:' + id;
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  m.bind(rig.skeleton, rig.mesh.bindMatrix);
  return m;
}

// ---------------------------------------------------------------- 陈列模型
// 朝向约定：都按“穿 / 戴在站立小狗身上”的朝向摆。
//   衣服、小背包：身体长轴沿 X，领口（小狗前方）朝 +X，背朝 +Y，从 +Z 看是侧面（小狗的右侧）；
//                 衣服背上两个小木夹 + 两根细绳吊着（绳顶 = 模型最高处，便于挂在杆子下）。
//   小翅膀例外：从小狗背后看（一对翅膀左右展开），侧面看它只剩一条边。
//   帽子：帽口朝下、帽檐正前方朝 +Z；墨镜、蝴蝶结：正面朝 +Z；
//   围巾 / 领结 / 花环：按戴在脖子上的倾角，小狗前方朝 +Z 再往 +X 偏 0.6（从侧前方看最好认）；
//   鞋袜：鞋底朝下、鞋尖朝 +Z，四只排一排。
const SIDE_VIEW = new THREE.Matrix4().makeRotationY(Math.PI / 2); // 身体 +Z（前）→ +X

/** 两个小木夹 + 两根细绳，把横放的衣服从背上吊起来 */
function addClips(H, geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const P = geo.attributes.position;
  const len = bb.max.x - bb.min.x, cx = (bb.min.x + bb.max.x) / 2;
  const topY = bb.max.y + 0.045;
  for (const k of [-0.27, 0.27]) {
    const x = cx + k * len;
    // 这一处背的最高点（z 靠中线）
    let y = -1e9, z = 0;
    for (let i = 0; i < P.count; i++) {
      if (Math.abs(P.getX(i) - x) < 0.02 && Math.abs(P.getZ(i)) < 0.04 && P.getY(i) > y) { y = P.getY(i); z = P.getZ(i); }
    }
    if (y < -1e8) continue;
    const clip = noUV(new THREE.BoxGeometry(0.012, 0.026, 0.016, 1, 1, 1));
    addPiece(H, clip, { matrix: TR(x, y + 0.006, z), color: (p, o) => paint(o, p.y < -0.002 ? K.woodDark : K.wood), skin: { bone: 0 } });
    const spring = noUV(new THREE.TorusGeometry(0.005, 0.0016, 4, 8));
    addPiece(H, spring, { matrix: mul(TR(x, y + 0.008, z), ROT(0, Math.PI / 2, 0)), color: [K.metal], skin: { bone: 0 } });
    const h = topY - (y + 0.019);
    const cord = noUV(new THREE.CylinderGeometry(0.0018, 0.0018, h, 4, 1));
    addPiece(H, cord, { matrix: TR(x, y + 0.019 + h / 2, z), color: [K.cream], skin: { bone: 0 } });
  }
}

function buildDisplay(id) {
  const g = BY_ID.get(id);
  const R = getRest(null);
  const { W } = wornBuild(id, null);
  const N = W.n;
  const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3);
  const mats = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), m3 = new THREE.Matrix3();
  // 每个顶点按 tag 选陈列变换（静止网格空间 → 陈列空间）
  if (id === 'back_wings') {
    // 小翅膀是往两边张开的薄片，从侧面看只剩一条边：按“从小狗背后看”摆，一对翅膀左右展开
    mats[0] = new THREE.Matrix4().makeRotationX(-0.3).multiply(new THREE.Matrix4().makeRotationY(Math.PI)).multiply(R.inv[R.B.body]);
  } else if (g.zone === 'body' || g.zone === 'back') {
    mats[0] = SIDE_VIEW.clone().multiply(R.inv[R.B.body]);
  } else if (g.zone === 'feet') {
    // 四只排成一排：左右成对，前脚一对在前排、后脚一对在后排稍错开
    const place = [[0.07, 0.06], [-0.07, 0.06], [0.07, -0.08], [-0.07, -0.08]];
    for (let li = 0; li < 4; li++) {
      const L = legNames[li];
      const tot = legTot(L);
      const off = li < 2 ? 0.105 : -0.105;
      mats[li] = mul(TR(place[li][0] * 1.0 + off, tot + 0.03, place[li][1] * 0.25), ROT(0, (li % 2 ? 1 : -1) * 0.12, 0)).multiply(R.inv[R.B[L + 'u']]);
    }
  } else if (id.startsWith('hat_')) {
    mats[0] = HAT_MOUNT.clone().invert().multiply(R.inv[R.B.head]);
  } else if (id === 'acc_hairbow') {
    mats[0] = R.inv[R.B.earR].clone();
  } else if (g.zone === 'eyes') {
    mats[0] = R.inv[R.B.head].clone();
  } else {
    // 颈部饰品：保持戴在脖子上的倾角，侧前方朝 +Z
    mats[0] = new THREE.Matrix4().makeRotationY(0.6).multiply(R.inv[R.B.neck]);
  }
  for (let i = 0; i < N; i++) {
    const M = mats[W.tag[i]] || mats[0];
    m3.getNormalMatrix(M);
    v.fromArray(W.pos, i * 3).applyMatrix4(M);
    n.fromArray(W.nor, i * 3).applyMatrix3(m3).normalize();
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    nor[i * 3] = n.x; nor[i * 3 + 1] = n.y; nor[i * 3 + 2] = n.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(W.col, 3));
  geo.setAttribute('color2', new THREE.Float32BufferAttribute(W.col2, 3));
  geo.setAttribute('stripe', new THREE.Float32BufferAttribute(W.str, 1));
  geo.setIndex(W.idx.slice());
  let out = geo;
  if (g.zone === 'body') {
    const H = new Build();
    addClips(H, geo);
    out = mergeGeos([geo, H.geometry(false)]);
  }
  // 归一化：最长边 0.5，原点在底部中心
  out.computeBoundingBox();
  const bb = out.boundingBox;
  const size = new THREE.Vector3(); bb.getSize(size);
  const k = 0.5 / Math.max(size.x, size.y, size.z);
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  out.applyMatrix4(new THREE.Matrix4().makeScale(k, k, k).multiply(TR(-cx, -bb.min.y, -cz)));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function mergeGeos(list) {
  const names = ['position', 'normal', 'color', 'color2', 'stripe'];
  const arrs = Object.fromEntries(names.map((k) => [k, []]));
  const idx = [];
  for (const g of list) {
    const base = arrs.position.length / 3;
    for (const k of names) arrs[k].push(...g.attributes[k].array);
    for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
  }
  const g = new THREE.BufferGeometry();
  for (const k of names) g.setAttribute(k, new THREE.Float32BufferAttribute(arrs[k], k === 'stripe' ? 1 : 3));
  g.setIndex(idx);
  return g;
}

/**
 * 陈列用静态模型：原点在底部中心，正面朝 +Z，包围盒最长边 0.5。每次返回新的 Object3D（几何和材质缓存复用）。
 */
export function createGarmentDisplay(id) {
  const g = BY_ID.get(id);
  if (!g) throw new Error('未知服饰：' + id);
  let geo = DISPLAY.get(id);
  if (!geo) { geo = buildDisplay(id); DISPLAY.set(id, geo); }
  const mesh = new THREE.Mesh(geo, garmentMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const root = new THREE.Group();
  root.name = 'garment-display:' + id;
  root.userData.garment = id;
  root.add(mesh);
  return root;
}
