// 瞭望台：四根歪原木立柱 + 斜撑 + 木板平台 + 一条带防滑横条的木板坡道 + 矮栏杆 + 角上一面小三角旗。
// 只返回一个带顶点色的几何（合并进 props.wood，不增加 draw call）。局部坐标 (u, v)：u 沿坡道下坡方向，v 垂直于它。
import * as THREE from 'three';
import { mulberry32 } from '../../core/util.js';
import { C } from './colors.js';
import { GeoBuilder, cylBetween, mixHex, hash3 } from './geo.js';
import { LOOKOUT, rampHeightAtU } from './shape.js';

export const LOOKOUT_COLLIDERS = (() => {
  const o = LOOKOUT;
  const at = (u) => [o.x + o.dx * u, o.z + o.dz * u];
  const list = [{ x: o.x, z: o.z, r: 1.42, name: 'lookout' }]; // 平台半宽 0.75（角到中心 1.06）+ 小狗半身宽
  for (const [u, r] of [[1.2, 0.68], [1.65, 0.68], [2.1, 0.68], [2.5, 0.68]]) { /* 坡道半宽 0.375 + 小狗半身宽 */ const [x, z] = at(u); list.push({ x, z, r, name: 'lookoutRamp' }); }
  return list;
})();

/** 草/花避让圈 [x, z, r] */
export const LOOKOUT_BLOCKERS = (() => {
  const o = LOOKOUT;
  const list = [[o.x, o.z, 1.2]];
  for (const u of [1.1, 1.75, 2.4, 3.0]) list.push([o.x + o.dx * u, o.z + o.dz * u, 0.58]);
  return list;
})();

export function buildLookout(gy) {
  const o = LOOKOUT;
  const b = new GeoBuilder({ seed: 31, jitter: 0.07, aoH: 0.45, aoK: 0.26 });
  const rng = mulberry32(777);
  const H = o.H;
  const W = (u, y, v) => [o.x + u * o.dx + v * o.px, y, o.z + u * o.dz + v * o.pz];
  const G = (u, v) => { const p = W(u, 0, v); return gy(p[0], p[2]); };
  // 盒子局部 x 对准 d（下坡方向），局部 z 对准 -p
  const yaw = Math.atan2(-o.dz, o.dx);
  const woodC = () => { const r = rng(); return r < 0.3 ? C.woodGrey : r < 0.55 ? C.woodGreyDark : r < 0.8 ? C.woodGreyLight : C.woodWarm; };
  const logC = (base) => (nx, ny, nz, cx, cy) => mixHex(base, C.woodDeep, 0.15 + 0.35 * hash3(cx * 5, cy * 3, nz));
  const jr = (a) => (rng() - 0.5) * 2 * a;

  // ---------- 四根立柱（下宽上窄，各自微歪） ----------
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const PT = H + 0.44; // 立柱顶（栏杆高度）
  const cinfo = corners.map(([su, sv], i) => {
    const y0 = G(su * 0.74, sv * 0.74) - 0.22;
    return { su, sv, y0, lean: [jr(0.02), jr(0.02)], col: [C.trunk, C.woodGreyDark, C.woodWarm, C.trunkDark][i] };
  });
  // 立柱上高度 y 处的点
  const pt = (c, y) => {
    const t = (y - c.y0) / (PT - c.y0);
    const k = 0.74 - 0.13 * t;
    return W(c.su * k + c.lean[0] * t, y, c.sv * k + c.lean[1] * t);
  };
  for (const c of cinfo) {
    cylBetween(b, pt(c, c.y0), pt(c, PT), 0.092, 0.066, 6, { color: logC(c.col), ao: true });
    // 柱头：一小截锯断面
    const top = pt(c, PT);
    b.add(new THREE.CylinderGeometry(0.058, 0.058, 0.025, 6), { pos: [top[0], top[1] + 0.008, top[2]], color: C.woodGreyLight, ao: false });
  }
  const cb = (su, sv) => cinfo.find((c) => c.su === su && c.sv === sv);

  // ---------- 平台下的横梁与斜撑 ----------
  const YB = H - 0.13;
  const beam = (c1, c2, y, r = 0.045) => cylBetween(b, pt(c1, y), pt(c2, y), r, r * 0.9, 5, { color: logC(C.woodGreyDark), ao: false });
  beam(cb(1, 1), cb(1, -1), YB); beam(cb(-1, 1), cb(-1, -1), YB); beam(cb(1, 1), cb(-1, 1), YB); beam(cb(1, -1), cb(-1, -1), YB);
  beam(cb(1, 1), cb(-1, 1), H - 0.5, 0.032); beam(cb(1, -1), cb(-1, -1), H - 0.5, 0.032); beam(cb(-1, 1), cb(-1, -1), H - 0.5, 0.032);
  const brace = (c1, c2, y1, y2) => cylBetween(b, pt(c1, y1), pt(c2, y2), 0.03, 0.03, 4, { color: C.woodWarm, ao: false });
  const yLow = Math.max(cinfo[0].y0, cinfo[1].y0) + 0.38;
  brace(cb(1, 1), cb(-1, 1), yLow, H - 0.2); brace(cb(-1, 1), cb(1, 1), yLow + 0.05, H - 0.22); // 面向镜头的一侧：X 形
  brace(cb(1, -1), cb(-1, -1), yLow, H - 0.2);
  brace(cb(-1, 1), cb(-1, -1), yLow, H - 0.2);

  // ---------- 平台板（沿 v 方向横铺，7 块） ----------
  const nDeck = 7, dw = (2 * o.half) / nDeck;
  for (let i = 0; i < nDeck; i++) {
    const u = -o.half + dw * (i + 0.5);
    const len = 1.56 + jr(0.03);
    const g = new THREE.BoxGeometry(dw - 0.018, 0.07, len);
    b.add(g, { pos: W(u, H - 0.035 + jr(0.006), jr(0.02)), rot: [jr(0.01), yaw + jr(0.014), jr(0.012)], color: woodC() });
  }

  // ---------- 坡道 ----------
  const u0 = o.half, u1 = o.half + o.rampLen;
  const slope = Math.atan2(H - rampHeightAtU(u1), o.rampLen); // 下坡角
  const surf = (u) => rampHeightAtU(u);
  const nR = 11, rw = o.rampLen / nR;
  for (let i = 0; i < nR; i++) {
    const u = u0 + rw * (i + 0.5);
    const len = rw / Math.cos(slope) - 0.02;
    const g = new THREE.BoxGeometry(len, 0.07, 0.8 + jr(0.02));
    g.rotateZ(-slope + jr(0.012));
    b.add(g, { pos: W(u, surf(u) - 0.035 * Math.cos(slope) + jr(0.004), jr(0.012)), rot: [0, yaw + jr(0.012), 0], color: woodC() });
  }
  // 两侧纵梁
  for (const sv of [-1, 1]) {
    const um = (u0 + u1) / 2, len = (u1 - u0) / Math.cos(slope) + 0.1;
    const g = new THREE.BoxGeometry(len, 0.11, 0.07);
    g.rotateZ(-slope);
    b.add(g, { pos: W(um, surf(um) - 0.12, sv * 0.385), rot: [0, yaw, 0], color: C.woodGreyDark });
  }
  // 防滑横条
  for (let i = 0; i < 6; i++) {
    const u = u0 + 0.3 + i * 0.37 + jr(0.015);
    const g = new THREE.BoxGeometry(0.055, 0.03, 0.66 + jr(0.03));
    g.rotateZ(-slope);
    b.add(g, { pos: W(u, surf(u) + 0.008, 0), rot: [0, yaw + jr(0.03), 0], color: C.woodWarm, ao: false });
  }
  // 坡道中段的两根小撑腿
  for (const sv of [-1, 1]) {
    const u = 1.95;
    const yt = surf(u) - 0.16, yb = G(u, sv * 0.385) - 0.1;
    cylBetween(b, W(u, yb, sv * 0.4), W(u, yt, sv * 0.385), 0.05, 0.04, 5, { color: logC(C.woodGreyDark), ao: true });
  }
  // 坡道落地处：一块垫脚的扁石
  {
    const [x, , z] = W(u1 + 0.02, 0, 0);
    const g = new THREE.CylinderGeometry(0.3, 0.34, 0.07, 7);
    b.add(g, { pos: [x, gy(x, z) + 0.0, z], rot: [0, rng() * 6, 0], scale: [1, 1, 0.85], color: (nx, ny) => (ny > 0.5 ? C.stoneLight : C.stone) });
  }

  // ---------- 栏杆：后侧（-u）与外侧（-v）全封，+v（朝镜头）一侧只做一小段；坡道口敞开 ----------
  const rail = (p, q, r = 0.027) => cylBetween(b, [p[0], p[1] + jr(0.012), p[2]], [q[0], q[1] + jr(0.012), q[2]], r, r, 5, { color: logC(C.woodWarm), ao: false });
  const railSide = (c1, c2) => {
    rail(pt(c1, H + 0.38), pt(c2, H + 0.38));
    rail(pt(c1, H + 0.18), pt(c2, H + 0.18), 0.022);
  };
  railSide(cb(-1, 1), cb(-1, -1));
  railSide(cb(-1, -1), cb(1, -1));
  // +v 一侧：只在后半段有扶手，中间补一根短柱
  {
    const c = cb(-1, 1);
    const mid = W(-0.02, 0, 0.66);
    const y0 = gy(mid[0], mid[2]) - 0.1;
    const pm = (y) => W(-0.02, y, 0.67 - 0.05 * Math.max(0, (y - y0) / (PT - y0)));
    cylBetween(b, pm(y0), pm(PT - 0.02), 0.06, 0.045, 5, { color: logC(C.woodGrey), ao: true });
    rail(pt(c, H + 0.38), pm(H + 0.38));
    rail(pt(c, H + 0.18), pm(H + 0.18), 0.022);
  }
  // 几根竖直小栏条
  for (let i = 0; i < 3; i++) {
    const v = -0.3 + i * 0.3;
    cylBetween(b, W(-0.64, H - 0.02, v + jr(0.02)), W(-0.64 + jr(0.015), H + 0.38, v), 0.017, 0.015, 4, { color: C.woodWarm, ao: false });
  }

  // ---------- 旗杆与三角旗（在后侧外角） ----------
  {
    const c = cb(-1, -1);
    const base = pt(c, PT);
    const top = [base[0] + 0.03, base[1] + 1.0, base[2] - 0.02];
    cylBetween(b, base, top, 0.024, 0.016, 5, { color: C.woodGreyDark, ao: false });
    b.add(new THREE.IcosahedronGeometry(0.028, 0), { pos: [top[0], top[1] + 0.02, top[2]], color: C.cream, ao: false });
    // 旗面：一片略带燕尾的小三角（正反两面），朝 +x 飘
    const flag = new THREE.BufferGeometry();
    const fl = 0.52, fh = 0.15;
    const verts = [
      0, fh, 0, 0, -fh, 0, fl, -fh * 0.15, 0.035, // 正面
      0, fh, 0, fl, -fh * 0.15, 0.035, 0, -fh, 0, // 背面
    ];
    flag.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    flag.computeVertexNormals();
    b.add(flag, {
      pos: [top[0] + 0.015, top[1] - 0.12, top[2]], rot: [0, 0.18, 0],
      color: (nx, ny, nz, cx) => mixHex(C.roof, C.roofLight, Math.min(1, Math.max(0, (cx - top[0]) / 0.5) * 0.7)), ao: false, jitter: 0.05,
    });
    // 旗面下角的一小条米色
    const stripe = new THREE.BufferGeometry();
    stripe.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.01, 0.001, 0, -fh, 0.001, fl * 0.9, -fh * 0.16, 0.0365, 0, -0.01, -0.001, fl * 0.9, -fh * 0.16, 0.0345, 0, -fh, -0.001], 3));
    stripe.computeVertexNormals();
    b.add(stripe, { pos: [top[0] + 0.015, top[1] - 0.12, top[2]], rot: [0, 0.18, 0], color: C.cream, ao: false, jitter: 0.03 });
  }

  // ---------- 平台上的小摆设：一捆旧绳 ----------
  {
    const rp = W(-0.5, H + 0.03, -0.45);
    b.add(new THREE.TorusGeometry(0.1, 0.028, 5, 10), { pos: rp, rot: [Math.PI / 2 + 0.05, 0, 0], color: C.rope, ao: false });
  }

  return b.build();
}
