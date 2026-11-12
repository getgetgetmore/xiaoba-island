// 狗窝：质朴的旧木板小屋（木板有缝和色差、锈橙色略塌的波纹屋顶、补丁），拱形门洞，门楣骨头牌，灯笼，狗碗。
// 局部坐标：+z 为门外方向，+x 向右；外轮廓 x∈[-1,1]、z∈[-1.1,1.1]。
import * as THREE from 'three';
import { mulberry32, smoothstep, valueNoise2 } from '../../core/util.js';
import { C } from './colors.js';
import { GeoBuilder, cylBetween, jitterGeo, mixHex, hash3 } from './geo.js';

export const K = { W: 1.0, D: 1.1, T: 0.1, WH: 1.15, APEX: 1.95, DOOR_R: 0.5, DOOR_H0: 0.55 };
export const LANTERN_LOCAL = [1.12, 1.0, 1.5];
const ROOF_W = 1.54; // 屋顶单侧坡面的宽度（原 1.7：屋檐太低，把侧墙上的玩具架压在阴影里）
// 玩具架：装在左侧外墙（x = -W，朝向镜头左前方的那面墙）上，一排 4 个格子。全部是狗窝局部坐标。
//   zs      各格子中心的 z（第 0 格最靠近门口/镜头）
//   y0/h    格子底面高度 / 格子净高；w 格子净宽；depth 架子进深
export const SHELF = { zs: [0.72, 0.24, -0.24, -0.72], y0: 0.34, h: 0.5, w: 0.445, depth: 0.26, back: 0.03 };

export function buildKennel() {
  const rng = mulberry32(2025);
  const b = new GeoBuilder({ seed: 21, jitter: 0.07, aoH: 0.5, aoK: 0.3 });
  const glow = new GeoBuilder({ seed: 22, jitter: 0, aoK: 0 });
  const { W, D, T, WH, APEX } = K;

  const woodCol = () => {
    const r = rng();
    return r < 0.35 ? C.woodGrey : r < 0.6 ? C.woodGreyDark : r < 0.85 ? C.woodGreyLight : C.woodWarm;
  };

  // ---- 地板 ----
  for (let i = 0; i < 7; i++) {
    const w = 2.0 / 7;
    b.add(new THREE.BoxGeometry(w - 0.012, 0.07, 2.2), { pos: [-1 + w / 2 + i * w, -0.015, 0], color: i % 2 ? 0x7a5c40 : 0x6c5038, ao: false });
  }

  // ---- 一块木板（外侧风化灰、内侧深暗棕） ----
  // axis 'x'：墙面法线沿 z（前后墙）；axis 'z'：墙面法线沿 x（侧墙）
  const plank = (cx, y0, y1, cz, w, axis, outSign, tilt) => {
    const h = y1 - y0;
    if (h <= 0.05) return;
    const base = woodCol();
    const tone = (rng() - 0.5) * 0.12;
    const col = (nx, ny, nz) => {
      const out = axis === 'x' ? nz * outSign : nx * outSign;
      if (out > 0.5) return mixHex(base, rng() < 0.5 ? 0xffffff : 0x000000, Math.abs(tone));
      if (out < -0.5) return C.inner;
      return C.woodGreyDark;
    };
    const geo = new THREE.BoxGeometry(axis === 'x' ? w : T, h, axis === 'x' ? T : w);
    b.add(geo, { pos: axis === 'x' ? [cx, y0 + h / 2, cz] : [cz, y0 + h / 2, cx], rot: [0, 0, tilt], color: col });
  };
  const PW = 2 / 13;
  // 前墙（含拱形门洞）与后墙
  for (const front of [true, false]) {
    const zc = front ? D - T / 2 : -D + T / 2, sign = front ? 1 : -1;
    for (let n = 0; n < 13; n++) {
      const cx = -1 + PW / 2 + n * PW;
      const top = APEX - 0.8 * Math.abs(cx) - 0.06 + (rng() - 0.5) * 0.07;
      let bottom = 0 + (rng() - 0.5) * 0.02;
      if (front) {
        const inner = Math.abs(cx) - PW / 2;
        if (inner < K.DOOR_R) bottom = K.DOOR_H0 + Math.sqrt(Math.max(0, K.DOOR_R * K.DOOR_R - Math.max(0, inner) ** 2));
        if (Math.abs(cx) < 0.05 + 0.01) bottom = 2; // 中央板在门洞内不存在
      }
      plank(cx, bottom, top, zc, PW - 0.014, 'x', sign, (rng() - 0.5) * 0.02);
    }
  }
  // 侧墙
  for (const sx of [-1, 1]) {
    const xc = sx * (W - T / 2);
    const n = 13, len = 2 * (D - T), pw = len / n;
    for (let i = 0; i < n; i++) {
      const cz = -(D - T) + pw / 2 + i * pw;
      const top = WH + (rng() - 0.5) * 0.09;
      plank(cz, 0, top, xc, pw - 0.014, 'z', sx, (rng() - 0.5) * 0.015);
    }
  }
  // 补丁：侧墙外侧一块不同色的木板 + 钉子
  const patch = (x, y, z, axis, sign) => {
    const g = new THREE.BoxGeometry(axis === 'x' ? 0.42 : 0.03, 0.3, axis === 'x' ? 0.03 : 0.42);
    b.add(g, { pos: [x, y, z], rot: [0, 0, 0.05], color: C.woodWarm, ao: false });
    for (const [dx, dy] of [[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.1], [0.14, 0.1]]) {
      b.add(new THREE.BoxGeometry(0.02, 0.02, 0.02), { pos: axis === 'x' ? [x + dx, y + dy, z + 0.02 * sign] : [x + 0.02 * sign, y + dy, z + dx], color: C.woodDeep, ao: false });
    }
  };
  patch(0.62, 0.42, D + 0.015, 'x', 1);
  // ---- 玩具架（左侧外墙）：背板 + 上下两块搁板 + 5 块隔板，围出 4 个格子；板子略歪、颜色各异 ----
  {
    const SH = SHELF, x0 = -W; // 墙的外表面
    const top = SH.y0 + SH.h;
    b.add(new THREE.BoxGeometry(SH.back, SH.h + 0.1, 2.0), { pos: [x0 - SH.back / 2, SH.y0 + SH.h / 2, 0], rot: [0.012, 0, 0], color: 0xead9b6, ao: false });
    b.add(new THREE.BoxGeometry(SH.depth, 0.04, 2.04), { pos: [x0 - SH.depth / 2, SH.y0 - 0.02, 0], rot: [0.01, 0, -0.03], color: C.woodWarm, ao: false });
    b.add(new THREE.BoxGeometry(SH.depth - 0.05, 0.035, 2.04), { pos: [x0 - (SH.depth - 0.05) / 2, top + 0.018, 0], rot: [-0.012, 0, 0.02], color: C.woodWarm, ao: false });
    for (const z of [-0.96, -0.48, 0, 0.48, 0.96]) {
      b.add(new THREE.BoxGeometry(0.1, SH.h + 0.02, 0.028), { pos: [x0 - SH.back - 0.05, SH.y0 + SH.h / 2, z], rot: [(rng() - 0.5) * 0.05, 0, 0], color: C.woodWarm, ao: false });
    }
    // 搁板下的两个斜撑
    for (const z of [-0.6, 0.6]) cylBetween(b, [x0 - 0.01, SH.y0 - 0.2, z], [x0 - SH.depth + 0.04, SH.y0 - 0.03, z], 0.018, 0.018, 4, { color: C.woodGreyDark, ao: false });
    // 每个格子下面钉一块小木牌（以后可以写玩具的名字）
    for (const z of SH.zs) b.add(new THREE.BoxGeometry(0.02, 0.07, 0.2), { pos: [x0 - SH.depth - 0.005, SH.y0 - 0.025, z], rot: [(rng() - 0.5) * 0.12, 0, 0], color: C.roof, ao: false });
  }

  // 门框：两侧立柱 + 拱形框
  for (const sx of [-1, 1]) b.add(new THREE.BoxGeometry(0.13, 0.78, 0.14), { pos: [sx * 0.565, 0.39, D + 0.01], rot: [0, 0, sx * 0.015], color: C.woodWarm });
  const nArch = 11;
  for (let i = 0; i <= nArch; i++) {
    const ang = (i / nArch) * Math.PI;
    const rr = K.DOOR_R + 0.06;
    b.add(new THREE.BoxGeometry(0.13, 0.12, 0.14), {
      pos: [Math.cos(ang) * rr + (rng() - 0.5) * 0.01, K.DOOR_H0 + Math.sin(ang) * rr, D + 0.01],
      rot: [0, 0, ang - Math.PI / 2 + (rng() - 0.5) * 0.06], color: i % 2 ? C.woodWarm : C.woodGreyLight,
    });
  }
  // 门楣小骨头牌（歪的）
  const sg = [0, 1.4, D + 0.03];
  b.add(new THREE.BoxGeometry(0.66, 0.27, 0.05), { pos: sg, rot: [0, 0, -0.07], color: C.woodWarm, ao: false });
  const bone = (dx, dy) => [sg[0] + dx, sg[1] + dy, sg[2] + 0.05];
  const cosR = Math.cos(-0.07), sinR = Math.sin(-0.07);
  const bp = (dx, dy) => bone(dx * cosR - dy * sinR, dx * sinR + dy * cosR);
  b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 6), { pos: bp(0, 0), rot: [0, 0, Math.PI / 2 - 0.07], color: C.cream, ao: false });
  for (const [dx, dy] of [[-0.18, 0.04], [-0.18, -0.04], [0.18, 0.04], [0.18, -0.04]]) {
    const g = new THREE.IcosahedronGeometry(0.05, 1);
    b.add(g, { pos: bp(dx, dy), color: C.cream, ao: false });
  }
  // 吊牌的两根绳
  for (const sx of [-0.26, 0.26]) cylBetween(b, [sx, 1.6, D + 0.02], [sx * 1.05, 1.52 + (sx > 0 ? -0.02 : 0.02), D + 0.03], 0.008, 0.008, 3, { color: C.rope, ao: false });

  // ---- 屋顶：略塌的锈橙色波纹板 ----
  const phi = Math.atan2(0.8, 1.0);
  const roofGeo = (side) => {
    const g = new THREE.PlaneGeometry(ROOF_W, 2.75, 10, 44);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i), v = p.getZ(i); // u 沿坡面（-0.85..0.85），v 沿 z
      const sag = -0.07 * Math.sin(((v + 1.375) / 2.75) * Math.PI) * (0.4 + 0.6 * smoothstep(-ROOF_W / 2, ROOF_W / 2, u)) + (side > 0 ? 0 : -0.012);
      const corr = 0.02 * Math.sin(v * 25.0);
      const n = (valueNoise2(u * 2 + side * 9, v * 2, 5) - 0.5) * 0.04;
      p.setY(i, sag + corr + n);
    }
    return g;
  };
  const patches = [[0.3, 0.6, 0.5, 0.45, C.roofPatch], [-0.2, -0.7, 0.45, 0.4, C.roofDark], [0.2, 0.3, 0.3, 0.3, C.roofLight]];
  for (const s of [1, -1]) {
    const dirx = s * Math.cos(phi), diry = -Math.sin(phi);
    const nx = s * Math.sin(phi), ny = Math.cos(phi);
    const sc = ROOF_W / 2 + 0.01;
    const cx = dirx * sc, cy = 1.92 + diry * sc + 0.045;
    const g = roofGeo(s);
    b.add(g, {
      pos: [cx + nx * 0.0, cy, 0], rot: [0, 0, -s * phi + (s > 0 ? 0.015 : -0.02)],
      color: (nxx, nyy, nzz, fx, fy, fz) => {
        if (nyy < -0.2) return C.innerDark;
        // 局部坐标近似：沿坡面距离 u、z
        const u = (fx * s) / Math.cos(phi) - 0.0, v = fz;
        const rust = valueNoise2(u * 1.5 + 3, v * 1.2, 9);
        let c = mixHex(C.roof, C.roofDark, smoothstep(0.35, 0.8, rust) * 0.8);
        c = mixHex(c, C.roofLight, smoothstep(0.65, 0.95, valueNoise2(u * 3, v * 3, 4)) * 0.5);
        if (s > 0) for (const [pu, pv, pw, ph, pc] of patches) if (Math.abs(u - pu) < pw / 2 && Math.abs(v - pv) < ph / 2) c = mixHex(pc, c, 0.15);
        return c;
      },
    });
    // 屋顶下沿加一条厚边（板子厚度）
    b.add(new THREE.BoxGeometry(0.06, 0.06, 2.75), { pos: [cx + dirx * (ROOF_W / 2) + nx * 0.02, cy + diry * (ROOF_W / 2) - 0.01, 0], rot: [0, 0, -s * phi], color: C.roofDark, ao: false });
    // 山墙边的破木条
    for (const sz of [-1, 1]) b.add(new THREE.BoxGeometry(ROOF_W + 0.02, 0.08, 0.05), { pos: [cx, cy - 0.06, sz * 1.34], rot: [0, 0, -s * phi + (rng() - 0.5) * 0.03], color: C.woodGreyDark });
  }
  // 屋脊
  b.add(new THREE.CylinderGeometry(0.08, 0.08, 2.8, 6), { pos: [0, 1.97, 0], rot: [Math.PI / 2, 0, 0], color: C.roofDark, ao: false });

  // ---- 内部 ----
  // （原来的静态旧垫子已移除：现在是可以被狗叼出去晒太阳的独立狗垫，见 mat.js）
  b.add(new THREE.IcosahedronGeometry(0.07, 1), { pos: [-0.62, 0.07, -0.7], color: C.rust, ao: false }); // 小球
  b.add(new THREE.IcosahedronGeometry(1, 1), { pos: [0.1, 0.07, -0.75], scale: [0.34, 0.09, 0.2], color: 0x8a7a5a, ao: false }); // 枕头
  // 门口石阶
  b.add(jitterGeo(new THREE.BoxGeometry(1.2, 0.05, 0.38, 3, 1, 2), 0.012), { pos: [0, 0.0, D + 0.2], color: C.stone });

  // （左侧墙上原来的圆窗与花盆已移除：位置让给玩具架）

  // ---- 灯笼 + 立杆 ----
  const [lx, ly, lz] = LANTERN_LOCAL;
  b.add(jitterGeo(new THREE.CylinderGeometry(0.17, 0.2, 0.06, 7), 0.01), { pos: [1.4, 0.03, lz], color: C.stoneDark });
  cylBetween(b, [1.4, 0.04, lz], [1.41, 1.3, lz - 0.01], 0.055, 0.045, 5, { color: C.woodGreyDark });
  b.add(new THREE.BoxGeometry(0.36, 0.05, 0.05), { pos: [1.26, 1.27, lz], rot: [0, 0, 0.03], color: C.woodGreyDark, ao: false });
  b.add(new THREE.ConeGeometry(0.15, 0.12, 4), { pos: [lx, ly + 0.17, lz], rot: [0, Math.PI / 4, 0], color: C.roofDark, ao: false });
  b.add(new THREE.BoxGeometry(0.19, 0.04, 0.19), { pos: [lx, ly - 0.13, lz], color: C.woodDeep, ao: false });
  for (const [dx, dz] of [[-0.085, -0.085], [0.085, -0.085], [-0.085, 0.085], [0.085, 0.085]]) {
    b.add(new THREE.BoxGeometry(0.02, 0.24, 0.02), { pos: [lx + dx, ly, lz + dz], color: C.woodDeep, ao: false });
  }
  glow.add(new THREE.BoxGeometry(0.15, 0.22, 0.15), { pos: [lx, ly, lz] });
  b.add(new THREE.TorusGeometry(0.04, 0.008, 4, 8), { pos: [lx, ly + 0.26, lz], rot: [Math.PI / 2, 0, 0], color: C.woodDeep, ao: false });

  // ---- 狗碗（门口左前） ----
  const bowl = [-0.8, 0, 1.65];
  b.add(jitterGeo(new THREE.CylinderGeometry(0.17, 0.11, 0.1, 9), 0.008), { pos: [bowl[0], 0.05, bowl[2]], color: (nx, ny) => (ny > 0.5 ? 0x7a6a50 : C.rust), ao: false });
  b.add(new THREE.CylinderGeometry(0.14, 0.14, 0.012, 9), { pos: [bowl[0], 0.098, bowl[2]], color: 0x8a6a48, ao: false });
  for (let i = 0; i < 7; i++) b.add(new THREE.IcosahedronGeometry(0.03, 0), { pos: [bowl[0] + (rng() - 0.5) * 0.18, 0.115 + rng() * 0.02, bowl[2] + (rng() - 0.5) * 0.18], color: mixHex(0x8a6a48, 0x5c3a2e, rng()), ao: false });

  return { main: b.build(), glow: glow.build() };
}
