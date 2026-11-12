// 通用工具函数（纯函数，Node/浏览器均可用）

export const TAU = Math.PI * 2;

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (a === b ? 0 : (x - a) / (b - a));
export const remap = (x, a, b, c, d) => lerp(c, d, invLerp(a, b, x));
export const saturate = (x) => clamp(x, 0, 1);

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 与帧率无关的指数阻尼：lambda 越大越快（约 3/lambda 秒到 95%） */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** 朝目标匀速移动，不越过 */
export function moveTowards(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** 角度归一化到 (-π, π] */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** 两角之间最短差值 b - a，范围 (-π, π] */
export function angleDiff(a, b) {
  return wrapAngle(b - a);
}

/** 角度版阻尼（走最短路径） */
export function dampAngle(current, target, lambda, dt) {
  return current + angleDiff(current, target) * (1 - Math.exp(-lambda * dt));
}

/** 可复现随机数 mulberry32，返回 () => [0,1) */
export function mulberry32(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (rng, a = 0, b = 1) => a + (b - a) * rng();
export const randInt = (rng, a, b) => Math.min(b, Math.floor(a + (b - a + 1) * rng()));
export const pick = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

/** 按权重表 [[value, weight], ...] 抽取 */
export function weightedPick(rng, table) {
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i][1];
  let r = rng() * sum;
  for (let i = 0; i < table.length; i++) {
    r -= table[i][1];
    if (r <= 0) return table[i][0];
  }
  return table[table.length - 1][0];
}

/** 简易 2D 值噪声（确定性，无分配），输入任意浮点，输出 [0,1) */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);
