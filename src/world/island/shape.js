// 小岛布局常量、轮廓、高度场（几何与行为共用，保持纯函数）。
import { smoothstep, valueNoise2 } from '../../core/util.js';

export const RADIUS = 8;
const KD = Math.SQRT1_2;
export const L = {
  // s：狗窝整体缩放。狗在画面里被放大了 1.5 倍（站立时耳尖高约 1.25），原尺寸的门洞（高 1.05）会被头和耳朵穿过去
  kennel: { x: -3.6, z: -2.6, dx: KD, dz: KD, facing: Math.atan2(KD, KD), s: 1.25 },
  lawn: { x: 1.6, z: 0.8, r: 3.6 },
  front: { x: 0, z: 5.8 },
  pond: { x: -3.85, z: 2.7, r: 1.75 }, // 扩大（原 r 1.2），里面有小金鱼
  tree: { x: 4.4, z: -3.4 },
  veggie: { x: 0.7, z: -4.5, yaw: 0.08 },
  lanternLocal: { x: 1.4, z: 1.5 },
};

// 瞭望台：平台中心、坡道朝向 d（从平台向下坡的方向）、垂直方向 p；局部坐标 u 沿 d（离开平台中心的距离）、v 沿 p
const LK_DX = -0.8, LK_DZ = 0.6;
export const LOOKOUT = {
  x: 5.8, z: -0.7, dx: LK_DX, dz: LK_DZ, px: LK_DZ, pz: -LK_DX, // p = (0.6, 0.8)
  H: 1.15,          // 平台顶面高度
  half: 0.75,       // 平台半边长（1.5 x 1.5）
  rampLen: 2.3, rampHalfW: 0.375,
  baseGap: 0.95, // 放大后的狗身长约 1.3：落脚点离坡道底端远一点，在这里转身时身体才不会压进坡道木板里（原 0.3）
  //     // 坡道底端外的落脚点
};

export function outlineR(a) {
  const r = 7.5 + 0.28 * Math.sin(2 * a + 0.6) + 0.18 * Math.sin(3 * a + 2.1) + 0.1 * Math.sin(5 * a + 0.3);
  return Math.min(r, 8.0);
}

export function pondR(t) {
  return L.pond.r * (1 + 0.08 * Math.sin(3 * t + 1.0) + 0.05 * Math.sin(5 * t + 0.4));
}
export function pondU(x, z) {
  const dx = x - L.pond.x, dz = z - L.pond.z;
  return Math.hypot(dx, dz) / pondR(Math.atan2(dz, dx));
}

export const zone = (x, z, cx, cz, r0, r1) => 1 - smoothstep(r0, r1, Math.hypot(x - cx, z - cz));

export function kennelToWorld(lx, lz) {
  const k = L.kennel;
  const c = Math.cos(k.facing), s = Math.sin(k.facing);
  lx *= k.s; lz *= k.s; // 狗窝局部坐标 → 世界坐标（含整体缩放）
  return [k.x + lx * c + lz * s, k.z - lx * s + lz * c];
}

export function heightAt(x, z) {
  const k = L.kennel, lw = L.lawn, fr = L.front;
  const e = Math.max(outlineR(Math.atan2(z, x)) - Math.hypot(x, z), 0);
  let h = (valueNoise2(x * 0.27 + 3.1, z * 0.27 - 1.7, 7) - 0.5) * 0.26 + (valueNoise2(x * 0.65 + 9.2, z * 0.65 + 4.4, 11) - 0.5) * 0.12;
  const f = Math.max(zone(x, z, lw.x, lw.z, lw.r + 0.2, lw.r + 1.5), zone(x, z, k.x, k.z, 2.1 * k.s, 3.4 * k.s), zone(x, z, fr.x, fr.z, 1.7, 3.0));
  h *= 1 - f;
  const pb = 1 - smoothstep(0.55, 1.25, pondU(x, z));
  h += (-0.34 - h) * pb;
  const lip = 1 - smoothstep(0, 0.7, e);
  h -= 0.34 * lip;
  return h;
}

// 坡道底端（u = half + rampLen）处的地面高度：坡道表面在这里与地面连续
const LK_END_U = LOOKOUT.half + LOOKOUT.rampLen;
const LK_END_G = heightAt(LOOKOUT.x + LOOKOUT.dx * LK_END_U, LOOKOUT.z + LOOKOUT.dz * LK_END_U);

/** 点 (x,z) 相对瞭望台的局部坐标 [u, v] */
export function lookoutLocal(x, z) {
  const o = LOOKOUT, rx = x - o.x, rz = z - o.z;
  return [rx * o.dx + rz * o.dz, rx * o.px + rz * o.pz];
}
/** 坡道表面高度（u ∈ [half, half+rampLen]） */
export function rampHeightAtU(u) {
  const t = (u - LOOKOUT.half) / LOOKOUT.rampLen;
  return LOOKOUT.H + (LK_END_G - LOOKOUT.H) * t;
}
/** 点在平台或坡道范围内时返回该处表面高度，否则返回 null（纯函数） */
export function lookoutSurface(x, z) {
  const o = LOOKOUT;
  const [u, v] = lookoutLocal(x, z);
  if (u > -o.half && u <= o.half && Math.abs(v) <= o.half) return o.H;
  if (u > o.half && u <= LK_END_U && Math.abs(v) <= o.rampHalfW) {
    // 坡道两侧边缘 0.2 内平滑收到地面高度，避免从侧面踏入时高度突变（正常情况下侧面被障碍圆挡住）
    const f = 1 - smoothstep(o.rampHalfW - 0.2, o.rampHalfW, Math.abs(v));
    const g = heightAt(x, z);
    return g + (rampHeightAtU(u) - g) * f;
  }
  return null;
}
