// 钓上来的鱼（小金鱼 / 金色锦鲤 / 泥鳅）：一条完整的、会动的鱼。
//   造型：沿脊柱放样的流线型鱼身（头圆、背高、向尾柄收细），竖着的分叉尾鳍、背鳍、臀鳍、成对的胸鳍和腹鳍，眼睛、嘴、胡须；
//         颜色全部是顶点色（背深腹浅、锦鲤的红白花斑、泥鳅的深色斑点）。
//   动作：不是整条鱼硬邦邦地晃，而是让脊柱弯曲——
//         swim  在水里：从头到尾传下去的摆动，尾巴幅度最大；
//         flop  在岸上：侧躺着，头尾一起向上卷、再啪地拍平，带着整条鱼弹起来（真鱼离水的扑腾）；
//         wriggle / slide  泥鳅：贴着地面像蛇一样扭。
// createFishModel(kind, material) → { mesh, update(dt, state), length }
//   约定同 loot.js：原点在鱼的底部中心，头朝本地 +Z。
import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const col = (hex) => new THREE.Color(hex);
const mix = (a, b, t) => a.clone().lerp(b, clamp(t));

/** 等距控制点的平滑插值（Catmull-Rom），u ∈ 0..1 */
function prof(arr, u) {
  const n = arr.length - 1, x = clamp(u, 0, 0.99999) * n, i = Math.floor(x), t = x - i;
  const p0 = arr[Math.max(0, i - 1)], p1 = arr[i], p2 = arr[i + 1], p3 = arr[Math.min(n, i + 2)];
  return Math.max(0, 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - 3 * p2 + p3 - p0) * t * t * t));
}

// 各种鱼的外形：L 身长（吻端到尾柄）、W 半宽、T 背高、B 腹深；w / t / b 是从吻端到尾柄的轮廓（0..1 等距）
const SPECS = {
  goldfish: {
    L: 0.36, W: 0.078, T: 0.102, B: 0.096,
    w: [0, 0.6, 0.86, 0.98, 1, 0.95, 0.84, 0.66, 0.46, 0.3, 0.2],
    t: [0, 0.5, 0.8, 0.95, 1, 0.97, 0.86, 0.68, 0.48, 0.32, 0.24],
    b: [0, 0.55, 0.84, 0.97, 1, 0.96, 0.82, 0.6, 0.4, 0.28, 0.24],
    tail: 0.25, tailH: 0.2, fork: 0.5, dorsal: [0.3, 0.74, 0.085], pect: 0.11, eye: 0.019, barbel: false,
    swim: 0.6, flop: 1.0,
  },
  koi: {
    L: 0.66, W: 0.082, T: 0.098, B: 0.086,
    w: [0, 0.5, 0.78, 0.93, 1, 0.98, 0.9, 0.76, 0.58, 0.4, 0.25],
    t: [0, 0.42, 0.72, 0.9, 1, 1, 0.92, 0.78, 0.6, 0.42, 0.3],
    b: [0, 0.48, 0.76, 0.93, 1, 0.98, 0.88, 0.7, 0.5, 0.36, 0.3],
    tail: 0.24, tailH: 0.165, fork: 0.62, dorsal: [0.34, 0.72, 0.062], pect: 0.12, eye: 0.017, barbel: true,
    swim: 0.5, flop: 0.9,
  },
  loach: {
    L: 0.6, W: 0.031, T: 0.031, B: 0.028,
    w: [0, 0.72, 0.94, 1, 1, 1, 0.97, 0.9, 0.8, 0.66, 0.5],
    t: [0, 0.7, 0.92, 1, 1, 1, 0.97, 0.9, 0.8, 0.68, 0.56],
    b: [0, 0.7, 0.92, 1, 1, 1, 0.97, 0.9, 0.8, 0.68, 0.56],
    tail: 0.075, tailH: 0.045, fork: 0, dorsal: [0.5, 0.64, 0.022], pect: 0.04, eye: 0.0075, barbel: true,
    swim: 0.55, flop: 0.8,
  },
};

// ---------------------------------------------------------------- 配色
const PAL = {
  goldfish: { back: col(0xf2541d), belly: col(0xfba04a), fin: col(0xf88a36), tip: col(0xfdc890) },
  koi: { back: col(0xf2a51c), side: col(0xf9cf55), belly: col(0xfff1c8), red: col(0xe4501c), white: col(0xfff6e2), fin: col(0xf8cf66), tip: col(0xfff0c4) },
  loach: { back: col(0x8f7550), belly: col(0xf1e4bf), spot: col(0x5b4832), fin: col(0xb39a70), tip: col(0xd9c8a0) },
};
/** 鱼身上一点的颜色：u 吻端→尾柄，ny 上下（1 背、-1 腹），side 左右（±1） */
function bodyColor(kind, u, ny, side) {
  const P = PAL[kind];
  let c;
  if (kind === 'koi') {
    c = mix(P.belly, mix(P.side, P.back, sm(0.0, 0.6, ny)), sm(-0.85, -0.4, ny));
    // 背上的三块红斑（左右不完全对称），头顶一块白
    for (const [cu, hl, k] of [[0.3, 0.085, 1.0], [0.56, 0.1, 2.3], [0.83, 0.06, 3.7]]) {
      const reach = 0.12 - 0.34 * Math.sin(k * 2.1 + side * 0.9);           // 红斑向体侧延伸多远
      const edge = hl * (1 + 0.35 * Math.sin(ny * 4 + k * 3 + side));
      const a = sm(edge, edge * 0.72, Math.abs(u - cu)) * sm(reach - 0.14, reach + 0.1, ny);
      c = mix(c, P.red, a);
    }
    c = mix(c, P.white, sm(0.17, 0.09, u) * sm(0.2, 0.6, ny) * 0.85);
  } else if (kind === 'goldfish') {
    c = mix(P.belly, P.back, sm(-0.5, 0.25, ny));
  } else {
    c = mix(P.belly, P.back, sm(-0.45, 0.05, ny));
    const s = hash(Math.round(u * 26), Math.round(ny * 3) + side * 7);
    if (ny > -0.2 && s > 0.62) c = mix(c, P.spot, 0.75);
  }
  // 鳃盖后面一道略深的弧线、每隔一圈略有深浅（鳞片的感觉）
  const gill = sm(0.035, 0.0, Math.abs(u - 0.215)) * sm(0.85, 0.5, Math.abs(ny));
  return c.multiplyScalar(1 - 0.16 * gill);
}

// ---------------------------------------------------------------- 几何
function buildGeometry(kind) {
  const S = SPECS[kind], P = PAL[kind];
  const pos = [], colr = [], idx = [];
  const v = (x, y, z, c) => { pos.push(x, y, z); colr.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
  const zNose = (S.L + S.tail * 0.7) / 2, zPed = zNose - S.L, zTip = zPed - S.tail;
  const zAt = (u) => zNose - u * S.L;
  const halfW = (u) => S.W * prof(S.w, u), top = (u) => S.T * prof(S.t, u), bot = (u) => S.B * prof(S.b, u);

  // ---- 鱼身：N 圈 × M 点
  const N = 22, M = 14, ring = [];
  for (let i = 0; i < N; i++) {
    const u = Math.pow(i / (N - 1), 1.35), z = zAt(u), w = halfW(u), t = top(u), b = bot(u);
    const row = [];
    for (let j = 0; j < M; j++) {
      const th = (j / M) * TAU, cx = Math.cos(th), sy = Math.sin(th);
      // 截面：上半是背、下半是腹；体侧略收，像真鱼那样侧扁
      const x = w * cx * (0.86 + 0.14 * Math.abs(cx)), y = sy >= 0 ? t * sy : b * sy;
      const c = bodyColor(kind, u, sy, cx >= 0 ? 1 : -1);
      if (i % 2 && kind !== 'loach') c.multiplyScalar(0.965);
      row.push(v(x, y, z, c));
    }
    ring.push(row);
  }
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < M; j++) {
    const a = ring[i][j], b = ring[i][(j + 1) % M], c = ring[i + 1][j], d = ring[i + 1][(j + 1) % M];
    idx.push(a, c, b, b, c, d);
  }
  { // 尾柄封口
    const c = v(0, 0, zPed - 0.004, bodyColor(kind, 1, 0, 1));
    for (let j = 0; j < M; j++) idx.push(ring[N - 1][(j + 1) % M], ring[N - 1][j], c);
  }

  // ---- 鳍：平面多边形，正反两面各一份（材质是单面的）
  const finPoly = (pts, cols, tris) => {
    for (const flip of [0, 1]) {
      const base = pts.map((p, k) => v(p[0], p[1], p[2], cols[k]));
      for (const t of tris) idx.push(base[t[0]], base[flip ? t[2] : t[1]], base[flip ? t[1] : t[2]]);
    }
  };
  const fan = (n) => { const t = []; for (let k = 1; k < n - 1; k++) t.push([0, k, k + 1]); return t; };

  // 尾鳍：竖着的扇面，后缘分叉（fork = 0 时是圆桨形）
  {
    const pedH = Math.min(top(1), bot(1)) * 0.95, f = S.fork;
    const o = f > 0
      ? [[0, 1], [0.22, 0.34], [0.55, 0.72], [0.86, 0.98], [1, 0.96], [0.96, 0.7], [0.82, 0.36], [1 - f * 0.55, 0]]
      : [[0, 1], [0.3, 0.75], [0.62, 0.96], [0.86, 0.86], [0.98, 0.5], [1, 0]];
    const up = o.map(([d, y], k) => [d, k === 0 ? pedH / S.tailH : y]);
    const outline = up.concat(up.slice(0, -1).reverse().map(([d, y]) => [d, -y]));
    const pts = outline.map(([d, y]) => [0, y * S.tailH, zPed + 0.006 - d * S.tail]);
    const cols = outline.map(([d]) => mix(P.fin, P.tip, sm(0.35, 1, d)));
    const tri = THREE.ShapeUtils.triangulateShape(outline.map(([d, y]) => new THREE.Vector2(d, y)), []);
    finPoly(pts, cols, tri);
  }
  // 背鳍：沿着背脊的一条帆，前高后低
  {
    const [uA, uB, hF] = S.dorsal, K = 7, shape = [0.3, 1, 0.96, 0.84, 0.7, 0.54, 0.36, 0.12];
    const pts = [], cols = [], tris = [];
    for (let k = 0; k <= K; k++) {
      const u = uA + ((uB - uA) * k) / K, h = hF * shape[k];
      pts.push([0, top(u) * 0.9, zAt(u)], [0, top(u) * 0.9 + h, zAt(u) - h * 0.55]);
      cols.push(P.fin.clone(), mix(P.fin, P.tip, 0.8));
      if (k < K) tris.push([2 * k, 2 * k + 2, 2 * k + 1], [2 * k + 1, 2 * k + 2, 2 * k + 3]);
    }
    finPoly(pts, cols, tris);
  }
  // 臀鳍
  {
    const u0 = 0.74, u1 = 0.86, h = S.T * 0.5;
    const pts = [[0, -bot(u0) * 0.9, zAt(u0)], [0, -bot(u1) * 0.9, zAt(u1)], [0, -bot(u1) * 0.9 - h, zAt(u1) - h * 0.5], [0, -bot(u0) * 0.9 - h * 0.6, zAt(u0) - h * 0.55]];
    finPoly(pts, [P.fin.clone(), P.fin.clone(), mix(P.fin, P.tip, 0.8), mix(P.fin, P.tip, 0.6)], fan(4));
  }
  // 成对的胸鳍和腹鳍：向后下方张开的小扇子
  const pairFin = (u, yK, len, dir, wide) => {
    for (const s of [1, -1]) {
      const d = new THREE.Vector3(dir[0] * s, dir[1], dir[2]).normalize();
      const a = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(s); // 扇面的展开方向
      const p0 = new THREE.Vector3(halfW(u) * (yK > -0.8 ? 0.82 : 0.3) * s, bot(u) * yK, zAt(u));
      const at = (l, w) => { const p = p0.clone().addScaledVector(d, l * len).addScaledVector(a, w * len * wide); return [p.x, p.y, p.z]; };
      const pts = [at(0, 0), at(0.45, 0.42), at(0.85, 0.36), at(1, 0.05), at(0.82, -0.3), at(0.4, -0.26)];
      finPoly(pts, [P.fin.clone(), ...[0.4, 0.75, 0.9, 0.75, 0.4].map((t) => mix(P.fin, P.tip, t))], fan(6));
    }
  };
  pairFin(0.25, -0.4, S.pect, [0.78, -0.42, -0.6], 1);
  pairFin(0.52, -0.93, S.pect * 0.72, [0.35, -0.75, -0.62], 0.85);

  // ---- 眼睛、嘴、胡须
  const blob = (cx, cy, cz, rx, ry, rz, c) => {
    const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, base = pos.length / 3;
    for (let k = 0; k < p.count; k++) v(cx + p.getX(k) * rx, cy + p.getY(k) * ry, cz + p.getZ(k) * rz, c);
    for (let k = 0; k < p.count; k += 3) idx.push(base + k, base + k + 1, base + k + 2);
    g.dispose();
  };
  {
    const u = kind === 'loach' ? 0.07 : 0.115, r = S.eye;
    for (const s of [1, -1]) {
      const ex = halfW(u) * 0.9 * s, ey = top(u) * 0.3, ez = zAt(u);
      blob(ex, ey, ez, r * 0.6, r, r, col(0xf4c654));                        // 金色眼圈
      blob(ex + r * 0.42 * s, ey, ez + r * 0.1, r * 0.4, r * 0.62, r * 0.62, col(0x1c1612)); // 黑眼珠
      blob(ex + r * 0.72 * s, ey + r * 0.26, ez + r * 0.24, r * 0.14, r * 0.2, r * 0.2, col(0xffffff)); // 高光
    }
    blob(0, -bot(0.03) * 0.3, zNose - S.L * 0.012, S.W * 0.3, S.W * 0.12, S.W * 0.12, col(kind === 'loach' ? 0x6d5238 : 0xc4502c)); // 嘴
    if (S.barbel) for (const s of [1, -1]) {
      const a = [S.W * 0.26 * s, -bot(0.04) * 0.5, zNose - S.L * 0.025], b = [S.W * 0.62 * s, -bot(0.04) * 0.5 - S.W * 0.55, zNose + S.W * 0.12], w = S.W * 0.07;
      finPoly([[a[0], a[1] + w, a[2]], [a[0], a[1] - w, a[2]], b], [P.tip.clone(), P.tip.clone(), P.tip.clone()], [[0, 1, 2]]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colr), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), (zNose - zTip) * 0.75);
  return { geo, base: new Float32Array(pos), zNose, zTip };
}

// ---------------------------------------------------------------- 会动的鱼
export function createFishModel(kind, material) {
  const S = SPECS[kind] || SPECS.goldfish;
  if (!SPECS[kind]) kind = 'goldfish';
  const { geo, base, zNose, zTip } = buildGeometry(kind);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.frustumCulled = false; // 身体会弯：不依赖静态的包围球做剔除
  const P = geo.attributes.position, n = P.count;
  const K = 40, h = (zNose - zTip) / K;
  const X = new Float32Array(K + 1), Z = new Float32Array(K + 1), PH = new Float32Array(K + 1);
  const k0 = Math.round(-zTip / h); // 脊柱上 z = 0 的那一格：弯曲时它保持不动
  const tailW = (s) => Math.pow(clamp((zNose - s) / (zNose - zTip)), 1.4); // 越靠尾巴摆得越大
  let curl = 0; // 扑腾时这一拍卷起的程度
  let rollSign = 1, wasFlop = false; // 侧躺时倒向哪一边（让背和花斑朝着镜头）
  const _x = new THREE.Vector3(), _p = new THREE.Vector3();
  let t = 0, roll = 0, lift = 0, yaw = 0, lastBeat = -1, flopK = 0, swimK = 0, wrigK = 0;

  /** 脊柱的朝向角 φ(s)：s 是沿身体的位置（头为正） */
  function phiAt(s) {
    let a = 0.1 * Math.sin(t * 2.4 + s * 6) * tailW(s);                                    // 平时：尾巴轻轻摆
    if (swimK > 0.001) a += swimK * S.swim * Math.sin(t * 15 + (s * 7.5) / (zNose - zTip)) * (0.1 + 0.9 * tailW(s));
    if (wrigK > 0.001) a += wrigK * 0.75 * Math.sin(t * 13 + s * 17);                       // 泥鳅：整条身体扭
    if (flopK > 0.001) a += rollSign * flopK * curl * (s < 0 ? 1.45 : 0.8) * (s / (zNose - zTip)) * 2.2; // 扑腾：头尾向同一侧卷
    return a;
  }

  function deform() {
    for (let k = 0; k <= K; k++) PH[k] = phiAt(zTip + k * h);
    X[k0] = 0; Z[k0] = zTip + k0 * h;
    for (let k = k0 + 1; k <= K; k++) { const a = 0.5 * (PH[k] + PH[k - 1]); X[k] = X[k - 1] + Math.sin(a) * h; Z[k] = Z[k - 1] + Math.cos(a) * h; }
    for (let k = k0 - 1; k >= 0; k--) { const a = 0.5 * (PH[k] + PH[k + 1]); X[k] = X[k + 1] - Math.sin(a) * h; Z[k] = Z[k + 1] - Math.cos(a) * h; }
    const arr = P.array;
    for (let i = 0; i < n; i++) {
      const x0 = base[i * 3], z0 = base[i * 3 + 2];
      const f = clamp((z0 - zTip) / h, 0, K - 0.0001), k = Math.floor(f), u = f - k;
      const ph = PH[k] + (PH[k + 1] - PH[k]) * u;
      arr[i * 3] = X[k] + (X[k + 1] - X[k]) * u + x0 * Math.cos(ph);
      arr[i * 3 + 2] = Z[k] + (Z[k + 1] - Z[k]) * u - x0 * Math.sin(ph);
    }
    P.needsUpdate = true;
    geo.computeVertexNormals();
  }

  function update(dt, state) { // eslint-disable-line no-use-before-define
    dt = clamp(dt, 0, 0.1);
    t += dt;
    const eel = kind === 'loach';
    const wantFlop = state === 'flop' && !eel ? 1 : 0;
    const wantSwim = state === 'swim' ? 1 : 0;
    const wantWrig = eel && (state === 'flop' || state === 'slide') ? (state === 'slide' ? 1.25 : 1) : 0;
    if (wantFlop && !wasFlop && api.viewer && mesh.parent) {
      mesh.parent.updateWorldMatrix(true, false);
      _x.set(1, 0, 0).transformDirection(mesh.parent.matrixWorld); _p.setFromMatrixPosition(mesh.parent.matrixWorld);
      rollSign = _x.x * (api.viewer.x - _p.x) + _x.z * (api.viewer.z - _p.z) > 0 ? -1 : 1;
    }
    wasFlop = !!wantFlop;
    const k = 1 - Math.exp(-dt * 9);
    flopK += (wantFlop - flopK) * k; swimK += (wantSwim - swimK) * k; wrigK += (wantWrig - wrigK) * k;
    // 扑腾的节奏：一下一下地卷起、拍平，偶尔歇一拍；每拍幅度不同
    const T = 0.36, beat = Math.floor(t / T), ph = t / T - beat;
    const on = hash(beat, 1.7) > 0.22;
    curl = on ? Math.pow(Math.sin(Math.PI * ph), 1.15) * (0.62 + 0.38 * hash(beat, 4.1)) * S.flop : 0;
    if (beat !== lastBeat) { lastBeat = beat; if (on && flopK > 0.5) yaw += (hash(beat, 9.3) - 0.5) * 0.9; } // 每拍身子甩偏一点
    const hop = on ? Math.pow(Math.sin(Math.PI * clamp((ph - 0.3) / 0.7)), 1.5) * 0.085 : 0;
    // 在岸上扑腾时侧躺（背鳍倒向一边），在水里 / 飞行中是立着的
    roll += (wantFlop * rollSign * (Math.PI / 2) * 0.96 - roll) * (1 - Math.exp(-dt * 12));
    lift += (hop * flopK - lift) * (1 - Math.exp(-dt * 30));
    const side = Math.abs(roll) / (Math.PI / 2);
    mesh.rotation.set(0, wantFlop ? yaw : (yaw *= Math.exp(-dt * 4)), roll, 'YXZ');
    mesh.position.y = S.B * (1 - side) + S.W * 0.9 * side + lift + (eel ? 0 : 0.004);
    deform();
  }
  // mouth / center：嘴和身体中心在“鱼这一组”里的位置（钓鱼时嘴咬着尾巴梢、身体垂下来）；viewer：观察者的世界位置（可选）
  const api = { mesh, update, length: zNose - zTip, kind, viewer: null, mouth: new THREE.Vector3(0, S.B * 0.85, zNose), center: new THREE.Vector3(0, S.B, 0) };
  update(0, '');
  return api;
}

export default createFishModel;
