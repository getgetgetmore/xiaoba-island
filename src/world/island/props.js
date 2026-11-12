// 田园道具：踏脚石、大树、歪木栅栏、菜畦、稻草人、草垛、南瓜、岩石、蘑菇、池塘边石/荷叶/香蒲。
// 返回两个几何：wood（平直着色：木、石）与smooth（平滑着色：树冠、草垛、南瓜）。
import * as THREE from 'three';
import { mulberry32, TAU, smoothstep, clamp } from '../../core/util.js';
import { C } from './colors.js';
import { L, outlineR, pondR, kennelToWorld } from './shape.js';
import { GeoBuilder, cylBetween, jitterGeo, mixHex, blob, hash3 } from './geo.js';

export function buildProps(heightAt) {
  const w = new GeoBuilder({ seed: 5, jitter: 0.07, aoH: 0.45, aoK: 0.28 });
  const s = new GeoBuilder({ seed: 6, jitter: 0.04, aoH: 0.5, aoK: 0.25 });
  const rng = mulberry32(4242);
  const stones = []; // 踏脚石位置（草需要避开）
  const gy = (x, z) => heightAt(x, z);

  // ---------- 踏脚石小路：窝门 → 草坪 ----------
  {
    const ax = -1.85, az = -0.85, bx = -0.1, bz = 0.45;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const nx = -(bz - az), nz = bx - ax;
      const nl = Math.hypot(nx, nz);
      const off = 0.22 * Math.sin(t * Math.PI * 1.5) + (rng() - 0.5) * 0.12;
      const x = px + (nx / nl) * off, z = pz + (nz / nl) * off;
      stones.push([x, z]);
      const g = new THREE.CylinderGeometry(0.27, 0.31, 0.12, 7, 1);
      jitterGeo(g, 0.035, i * 2.3);
      w.add(g, {
        pos: [x, gy(x, z) + 0.01, z], rot: [(rng() - 0.5) * 0.08, rng() * 6, (rng() - 0.5) * 0.08],
        scale: [0.75 + rng() * 0.4, 1, 0.75 + rng() * 0.4],
        color: (nx2, ny) => mixHex(rng() < 0.5 ? C.stone : C.stoneDark, C.stoneLight, ny > 0.5 ? 0.35 : 0),
      });
    }
  }

  // ---------- 大树 ----------
  {
    const tx = L.tree.x, tz = L.tree.z, y0 = gy(tx, tz);
    const pts = [[0, 0, 0, 0.36], [0.07, 0.55, 0.03, 0.3], [-0.05, 1.1, 0.0, 0.26], [0.05, 1.7, -0.04, 0.21], [0.0, 2.3, 0.0, 0.15]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      cylBetween(w, [tx + p[0], y0 + p[1] - 0.05, tz + p[2]], [tx + q[0], y0 + q[1], tz + q[2]], p[3], q[3], 7, {
        color: (nx, ny, nz, cx, cy) => mixHex(C.trunk, C.trunkDark, 0.35 + 0.4 * hash3(cx * 7, cy * 3, nz)), ao: true,
      });
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + rng() * 0.5;
      cylBetween(w, [tx + Math.cos(a) * 0.15, y0 + 0.28, tz + Math.sin(a) * 0.15], [tx + Math.cos(a) * (0.62 + rng() * 0.2), y0 - 0.03, tz + Math.sin(a) * (0.62 + rng() * 0.2)], 0.12, 0.05, 5, { color: C.trunkDark });
    }
    for (const sg of [-1, 1]) cylBetween(w, [tx, y0 + 1.7, tz], [tx + sg * 0.8, y0 + 2.5, tz + sg * 0.1 + 0.2], 0.09, 0.05, 5, { color: C.trunk });
    // 树冠：三层云团
    const layers = [
      { y: 2.5, ring: 1.05, n: 6, r: 1.05, c: 0 },
      { y: 3.2, ring: 0.7, n: 5, r: 0.95, c: 1 },
      { y: 3.85, ring: 0.28, n: 2, r: 0.85, c: 2 },
    ];
    const blobs = [];
    for (const ly of layers) {
      for (let i = 0; i < ly.n; i++) {
        const a = (i / ly.n) * TAU + rng() * 0.6 + ly.c;
        const rr = ly.ring * (0.8 + rng() * 0.4);
        const rad = ly.r * (0.85 + rng() * 0.3);
        const px = tx + Math.cos(a) * rr, pz = tz + Math.sin(a) * rr, py = y0 + ly.y + (rng() - 0.5) * 0.3;
        blobs.push([px, py, pz, rad]);
        const g = new THREE.IcosahedronGeometry(1, 2);
        jitterGeo(g, 0.05, i + ly.c * 9);
        s.add(g, {
          pos: [px, py, pz], scale: [rad, rad * 0.82, rad], rot: [0, rng() * 6, 0],
          color: (nx, ny, nz, cx, cy, cz) => {
            const t = clamp(ny * 0.45 + 0.5 + (cy - y0 - 2.3) / 3.2 * 0.35, 0, 1);
            let c = t < 0.5 ? mixHex(C.leafDark, C.leaf, t * 2) : mixHex(C.leaf, C.leafLight, (t - 0.5) * 2);
            const n = hash3(Math.floor(cx * 1.4), Math.floor(cy * 1.4), Math.floor(cz * 1.4));
            if (n > 0.8) c = mixHex(c, C.leafMid, 0.6); else if (n < 0.15) c = mixHex(c, C.leafDark, 0.5);
            return c;
          }, ao: false, jitter: 0.03,
        });
      }
    }
    for (let i = 0; i < 9; i++) {
      const bl = blobs[Math.floor(rng() * blobs.length)];
      const a = rng() * TAU, ny = -0.5 + rng() * 0.6;
      const k = Math.sqrt(1 - ny * ny);
      s.add(new THREE.IcosahedronGeometry(0.08, 1), { pos: [bl[0] + Math.cos(a) * k * bl[3] * 0.97, bl[1] + ny * bl[3] * 0.8, bl[2] + Math.sin(a) * k * bl[3] * 0.97], color: i % 3 ? C.apple : C.pumpkin, ao: false });
    }
  }

  // ---------- 歪木栅栏：沿岛沿一圈，前方留缺口 ----------
  const fenceObstacles = [];
  {
    const a0 = (118 * Math.PI) / 180, a1 = (360 + 62) * Math.PI / 180;
    const posts = [];
    const total = a1 - a0;
    const nPosts = Math.round((total * 7.2) / 1.05);
    for (let i = 0; i <= nPosts; i++) {
      const a = a0 + (total * i) / nPosts;
      const r = outlineR(a) - 0.32 + (rng() - 0.5) * 0.12;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      posts.push({ a, x, z });
    }
    const hAtZ = (z) => 0.8 - 0.42 * smoothstep(-1, 6, z);
    const woodC = () => { const r = rng(); return r < 0.4 ? C.woodGrey : r < 0.65 ? C.woodGreyDark : r < 0.85 ? C.woodGreyLight : C.woodWarm; };
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const h = hAtZ(p.z) * (0.95 + rng() * 0.2);
      const y = gy(p.x, p.z);
      // 端头的立柱更矮
      const endK = i === 0 || i === posts.length - 1 ? 0.7 : 1;
      w.add(new THREE.BoxGeometry(0.11, (h + 0.2) * endK, 0.11), { pos: [p.x, y + ((h + 0.2) * endK) / 2 - 0.1, p.z], rot: [(rng() - 0.5) * 0.12, rng(), (rng() - 0.5) * 0.14], color: C.woodGreyDark });
      if (i === posts.length - 1) break;
      const q = posts[i + 1];
      const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz);
      const yaw = Math.atan2(-tz, tx);
      const hq = hAtZ(q.z);
      const yq = gy(q.x, q.z);
      // 横梁
      for (const f of [0.32, 0.68]) {
        cylBetween(w, [p.x, y + h * f + (rng() - 0.5) * 0.04, p.z], [q.x, yq + hq * f + (rng() - 0.5) * 0.04, q.z], 0.03, 0.03, 4, { color: C.woodGreyDark });
      }
      // 板子
      const np = Math.max(3, Math.round(tl / 0.2));
      for (let k = 0; k < np; k++) {
        if (rng() < 0.07) continue; // 缺板
        const t = (k + 0.5) / np + (rng() - 0.5) * 0.04;
        const x = p.x + tx * t, z = p.z + tz * t;
        const ph = hAtZ(z) * (0.62 + rng() * 0.5) * (rng() < 0.12 ? 0.55 : 1);
        const yy = gy(x, z);
        w.add(new THREE.BoxGeometry(0.15 + rng() * 0.03, ph, 0.04), {
          pos: [x, yy + ph / 2 - 0.04, z + 0.0], rot: [(rng() - 0.5) * 0.1, yaw + (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.22], color: woodC(),
        });
      }
    }
  }

  // ---------- 花箱（木框 + 土 + 郁金香） ----------
  {
    const { x: ox, z: oz, yaw } = L.veggie;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const T = (lx, ly, lz) => [ox + c * lx + sn * lz, ly + gy(ox, oz), oz - sn * lx + c * lz];
    for (const [lx, lz, len, rot] of [[0, -0.52, 1.74, 0], [0, 0.52, 1.74, 0], [-0.86, 0, 1.04, Math.PI / 2], [0.86, 0, 1.04, Math.PI / 2]]) {
      w.add(new THREE.BoxGeometry(len, 0.2, 0.07), { pos: T(lx, 0.1, lz), rot: [0, yaw + rot + (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.06], color: rng() < 0.5 ? C.woodGrey : C.woodGreyDark });
    }
    s.add(jitterGeo(new THREE.BoxGeometry(1.64, 0.16, 0.98, 6, 1, 4), 0.025), { pos: T(0, 0.1, 0), rot: [0, yaw, 0], color: (nx, ny) => (ny > 0.5 ? C.soilMid : C.soil), ao: false });
    // 花箱里种满郁金香（原先是菜畦：卷心菜和胡萝卜，不好看）
    const TULIP = [0xd9483b, 0xf2b53a, 0xe98aa8, 0xf4ead6, 0x9a6fc0, 0xf08a3c];
    let ti = 0;
    for (let row = 0; row < 3; row++) {
      const n = row === 1 ? 7 : 6;
      for (let i = 0; i < n; i++) {
        const lx = -0.68 + (i + (row === 1 ? 0 : 0.5)) * (1.36 / n) + (rng() - 0.5) * 0.07;
        const lz = -0.3 + row * 0.3 + (rng() - 0.5) * 0.08;
        const h = 0.3 + rng() * 0.2;
        const bx = (rng() - 0.5) * 0.09, bz = (rng() - 0.5) * 0.09; // 花茎微微歪向一边
        const col = TULIP[(ti++ + Math.floor(rng() * 2)) % TULIP.length];
        // 花茎
        cylBetween(s, T(lx, 0.16, lz), T(lx + bx, 0.18 + h, lz + bz), 0.012, 0.009, 4, { color: C.leaf, ao: false });
        // 两片长叶
        for (const sgn of [-1, 1]) {
          s.add(new THREE.ConeGeometry(0.034, 0.24 + rng() * 0.08, 4), { pos: T(lx + sgn * 0.035, 0.29, lz + (rng() - 0.5) * 0.03), rot: [(rng() - 0.5) * 0.3, yaw + rng() * 3, sgn * (0.35 + rng() * 0.2)], scale: [1, 1, 0.35], color: rng() < 0.5 ? C.leaf : C.leafMid, ao: false });
        }
        // 花苞：蛋形的杯 + 略尖的顶
        blob(s, T(lx + bx, 0.2 + h, lz + bz), 0.06, 1, { scale: [1, 1.25, 1], jit: 0.02, seed: ti, color: (nx, ny) => mixHex(col, 0xffffff, Math.max(0, ny) * 0.18), ao: false });
        s.add(new THREE.ConeGeometry(0.048, 0.07, 5), { pos: T(lx + bx, 0.275 + h, lz + bz), rot: [0, rng() * 3, 0], color: col, ao: false });
      }
    }
    // 花箱旁的小洒水壶
    {
      const TIN = 0x6f8f95, TIN_D = 0x57747b;
      const wx = 1.12, wz = 0.5;
      s.add(new THREE.CylinderGeometry(0.11, 0.13, 0.2, 9), { pos: T(wx, 0.11, wz), rot: [0, 0.4, 0.04], color: (nx, ny) => (ny > 0.5 ? TIN_D : TIN), ao: false });
      cylBetween(s, T(wx + 0.1, 0.1, wz + 0.04), T(wx + 0.3, 0.27, wz + 0.11), 0.028, 0.02, 5, { color: TIN, ao: false });
      s.add(new THREE.CylinderGeometry(0.045, 0.03, 0.03, 7), { pos: T(wx + 0.31, 0.28, wz + 0.115), rot: [0, 0, -0.9], color: TIN_D, ao: false });
      const hd = new THREE.TorusGeometry(0.075, 0.014, 5, 10, Math.PI);
      s.add(hd, { pos: T(wx - 0.1, 0.16, wz - 0.03), rot: [0, yaw + 0.35 + Math.PI, Math.PI / 2], color: TIN_D, ao: false });
    }
  }

  // ---------- 南瓜（原来在草垛旁，现在让位给瞭望台，挪到它外侧） ----------
  const PUMPKINS = [[6.55, 1.2, 0.26], [6.92, 1.52, 0.2]];
  {
    for (const [px, pz, pr] of PUMPKINS) {
      if (pr <= 0) continue;
      const g = new THREE.IcosahedronGeometry(1, 2);
      jitterGeo(g, 0.03, px);
      const yy = gy(px, pz);
      s.add(g, { pos: [px, yy + pr * 0.7, pz], scale: [pr, pr * 0.78, pr], rot: [0, rng() * 3, 0], color: (nx, ny, nz, cx, cy, cz) => mixHex(C.pumpkin, C.roofDark, 0.5 * (0.5 + 0.5 * Math.cos(Math.atan2(cz - pz, cx - px) * 8))), ao: false });
      cylBetween(s, [px, yy + pr * 1.3, pz], [px + 0.02, yy + pr * 1.55, pz], 0.025, 0.018, 4, { color: C.leaf, ao: false });
    }
  }

  // ---------- 岩石 ----------
  const rocks = [];
  const rock = (x, z, r, seed) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    jitterGeo(g, 0.2, seed);
    const y = gy(x, z);
    w.add(g, {
      pos: [x, y + r * 0.35, z], rot: [rng() * 0.4, rng() * 6, rng() * 0.4], scale: [r * (1 + rng() * 0.3), r * 0.72, r * (0.9 + rng() * 0.3)],
      color: (nx, ny) => (ny > 0.55 ? mixHex(C.stone, C.moss, 0.55) : mixHex(C.stoneDark, C.stone, 0.5 + ny * 0.5)),
    });
  };
  rock(-6.05, -1.0, 0.55, 1); rock(-5.6, -0.4, 0.3, 2); rock(-6.3, -0.2, 0.22, 3);
  rock(4.8, 4.4, 0.45, 4); rock(5.25, 4.0, 0.25, 5); rock(4.4, 4.8, 0.2, 6);
  rocks.push({ x: -6.05, z: -1.0, r: 0.6, name: 'rock' }, { x: 4.8, z: 4.4, r: 0.5, name: 'rock' });

  // ---------- 池塘：边石、荷叶、香蒲 ----------
  {
    const { x: px, z: pz } = L.pond;
    for (let i = 0; i < 12; i++) {
      const t = (35 + i * 25 + rng() * 14) * Math.PI / 180;
      if (t > 5.4 && t < 6.5 || t < 0.5) continue; // 喝水侧留空
      const rr = pondR(t) * (1.08 + rng() * 0.12);
      const x = px + Math.cos(t) * rr, z = pz + Math.sin(t) * rr;
      if (Math.cos(t) > 0.6 && Math.sin(t) < 0.4 && Math.sin(t) > -0.6) continue;
      rock(x, z, 0.1 + rng() * 0.14, 20 + i);
    }
    const PK = L.pond.r / 1.2; // 荷叶位置随池塘大小
    for (const [dx0, dz0, r, pink] of [[-0.3, 0.25, 0.2, false], [0.35, -0.3, 0.17, true], [-0.15, -0.55, 0.15, false], [-0.55, -0.1, 0.16, false], [0.5, 0.42, 0.18, false]]) {
      const dx = dx0 * PK, dz = dz0 * PK;
      const g = new THREE.CylinderGeometry(r, r, 0.012, 8);
      jitterGeo(g, 0.01, dx * 9);
      s.add(g, { pos: [px + dx, -0.088, pz + dz], rot: [0, rng() * 6, 0], color: mixHex(C.leaf, C.leafMid, rng()), ao: false });
      if (pink) for (let k = 0; k < 5; k++) s.add(new THREE.ConeGeometry(0.04, 0.1, 4), { pos: [px + dx + Math.cos(k * 1.26) * 0.04, -0.04, pz + dz + Math.sin(k * 1.26) * 0.04], rot: [Math.sin(k * 1.26) * 0.7, 0, -Math.cos(k * 1.26) * 0.7], color: 0xe8a8b0, ao: false });
    }
    for (const ang of [195, 235, 275]) {
      const t = (ang * Math.PI) / 180;
      const cx = px + Math.cos(t) * (L.pond.r + 0.1), cz = pz + Math.sin(t) * (L.pond.r + 0.1);
      for (let i = 0; i < 6; i++) {
        const x = cx + (rng() - 0.5) * 0.45, z = cz + (rng() - 0.5) * 0.45, h = 0.8 + rng() * 0.5, y = gy(x, z);
        const bx = (rng() - 0.5) * 0.25, bz = (rng() - 0.5) * 0.25;
        cylBetween(s, [x, y - 0.03, z], [x + bx * 0.5, y + h * 0.55, z + bz * 0.5], 0.016, 0.012, 3, { color: C.leaf, ao: false });
        cylBetween(s, [x + bx * 0.5, y + h * 0.55, z + bz * 0.5], [x + bx, y + h, z + bz], 0.012, 0.01, 3, { color: C.leafMid, ao: false });
        if (i % 2 === 0) cylBetween(s, [x + bx * 0.9, y + h * 0.82, z + bz * 0.9], [x + bx, y + h * 1.02, z + bz], 0.034, 0.03, 5, { color: 0x6a4a36, ao: false });
      }
    }
  }

  // ---------- 蘑菇 ----------
  for (const [mx, mz] of [[3.7, -4.1], [3.95, -4.3], [5.2, -2.45]]) {
    const y = gy(mx, mz), r = 0.07 + rng() * 0.04;
    s.add(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 5), { pos: [mx, y + 0.06, mz], color: C.cream, ao: false });
    blob(s, [mx, y + 0.13, mz], r, 1, { scale: [1, 0.6, 1], jit: 0.01, color: C.apple, ao: false });
    s.add(new THREE.IcosahedronGeometry(0.014, 0), { pos: [mx + 0.03, y + 0.17, mz], color: C.cream, ao: false });
    s.add(new THREE.IcosahedronGeometry(0.012, 0), { pos: [mx - 0.025, y + 0.16, mz + 0.03], color: C.cream, ao: false });
  }

  return { wood: w.build(), smooth: s.build(), stones, rocks, pumpkins: PUMPKINS };
}
