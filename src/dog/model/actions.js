// 动作库：每个动作是 (out 姿态数组, s 状态) → 写入一组“姿态参数”。
// 姿态参数全部是数值，可直接线性插值（crossfade），最终由 dogModel 解算到骨骼（含腿部两段 IK）。
import { DIM } from './rig.js';
import { ss } from './geometry.js';

const NAMES = [
  'bodyX', 'bodyY', 'bodyZ', 'bodyPitch', 'bodyYaw', 'bodyRoll',
  'hipsPitch', 'hipsYaw', 'hipsRoll', 'hipsZ',
  'chestPitch', 'chestYaw', 'chestRoll', 'chestZ',
  'neckPitch', 'neckYaw', 'neckRoll',
  'headPitch', 'headYaw', 'headRoll',
  'jaw', 'tongue', 'earBack', 'earOut', 'eyeOpen',
  'tailBase', 'tailCurl', 'tailSide', 'wagAmp', 'wagFreq',
  'lookW', 'breath', 'breathRate', 'squash', 'reach',
];
export const I = {};
NAMES.forEach((n, i) => { I[n] = i; });
export const LEG = NAMES.length;
// 每条腿 8 个参数：地面空间目标(gx,gy,gz)、关节局部目标(lx,ly,lz)、地面权重 gw、爪子弯曲 curl
export const GX = 0, GY = 1, GZ = 2, LX = 3, LY = 4, LZ = 5, GW = 6, CURL = 7;
export const N = LEG + 4 * 8;

const ANK = DIM.ANK;
const TAU = Math.PI * 2;
// 站立时脚的位置（狗本地/root 空间，未乘整体缩放）
export const FEET = [
  [0.092, 0.18], [-0.092, 0.18], [0.138, -0.17], [-0.138, -0.17],
];

const sin = Math.sin, cos = Math.cos, abs = Math.abs;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const pulse = (x, a, b) => (x <= a || x >= b ? 0 : sin(Math.PI * (x - a) / (b - a)));
/** 平滑“鼓包”：a→b 升，c→d 降 */
const hump = (x, a, b, c, d) => ss(a, b, x) * (1 - ss(c, d, x));
// 两个不同频率正弦相加的“缓慢游移”
const wander = (t, s) => 0.6 * sin(t * 1.0 + s) + 0.4 * sin(t * 2.31 + s * 1.7);

export function setFoot(o, i, x, y, z) {
  const b = LEG + i * 8;
  o[b + GX] = x; o[b + GY] = y; o[b + GZ] = z; o[b + GW] = 1;
}
export function setLocal(o, i, x, y, z, curl = 0) {
  const b = LEG + i * 8;
  o[b + LX] = x; o[b + LY] = y; o[b + LZ] = z; o[b + GW] = 0; o[b + CURL] = curl;
}

/** 站立基础姿态 */
export function stand(o) {
  o.fill(0);
  o[I.bodyY] = DIM.BODY_Y;
  o[I.eyeOpen] = 1;
  o[I.tailBase] = -0.12;
  o[I.tailCurl] = 0.74;
  o[I.tailSide] = 0.28;
  o[I.wagAmp] = 0.12;
  o[I.wagFreq] = 1.3;
  o[I.lookW] = 1;
  o[I.breath] = 1;
  o[I.breathRate] = 0.33;
  o[I.neckPitch] = 0.02;
  for (let i = 0; i < 4; i++) {
    setFoot(o, i, FEET[i][0], ANK, FEET[i][1]);
    const b = LEG + i * 8;
    o[b + LX] = 0; o[b + LY] = -0.27; o[b + LZ] = 0.02;
  }
}

/** 步态里单只脚：支撑相向后匀速划，摆动相抬脚前送。返回摆动进度（支撑相为 -1） */
function foot(o, i, p, beta, stride, zc, lift, xOff = 0) {
  p -= Math.floor(p);
  const b = LEG + i * 8;
  o[b + GX] = FEET[i][0] + xOff;
  o[b + GW] = 1;
  if (p < beta) {
    const u = p / beta;
    o[b + GZ] = zc + stride * (0.5 - u);
    o[b + GY] = ANK;
    return -1;
  }
  const u = (p - beta) / (1 - beta);
  const e = u * u * (3 - 2 * u);
  o[b + GZ] = zc + stride * (e - 0.5);
  o[b + GY] = ANK + lift * Math.pow(sin(Math.PI * u), 0.8);
  return u;
}

// ---------------------------------------------------------------- 循环动作
const A = {};

A.idle = (o, s) => {
  stand(o);
  const T = s.time;
  o[I.bodyY] += 0.003 * sin(T * 1.1);
  o[I.bodyX] = 0.008 * sin(T * 0.37);
  o[I.bodyRoll] = -0.025 * sin(T * 0.37);
  o[I.hipsRoll] = 0.02 * sin(T * 0.37);
  o[I.headYaw] = 0.16 * wander(T * 0.23, 1.3);
  o[I.headRoll] = 0.06 * wander(T * 0.19, 4.1);
  o[I.neckPitch] = 0.04 * sin(T * 0.5);
  o[I.wagAmp] = 0.16;
  o[I.wagFreq] = 1.5;
};

A.walk = (o, s) => {
  stand(o);
  const v = s.speed, p = s.walkPhase, mv = ss(0.03, 0.3, v);
  const beta = 0.62, S = s.walkStride;
  const lift = 0.055 * mv;
  // 横向步序：RL 0, FL .25, RR .5, FR .75
  const offs = [0.25, 0.75, 0, 0.5];
  for (let i = 0; i < 4; i++) {
    const u = foot(o, i, p + offs[i], beta, S, FEET[i][1], lift);
    if (u >= 0) o[LEG + i * 8 + CURL] = (i < 2 ? 0.9 : -0.5) * sin(Math.PI * u) * mv;
    // 后腿外八：迈步时脚向外画一道弧再落下
    if (i >= 2 && u >= 0) o[LEG + i * 8 + GX] += (i === 2 ? 1 : -1) * 0.034 * sin(Math.PI * u) * mv;
  }
  const ph = TAU * p;
  o[I.bodyY] = DIM.BODY_Y - 0.008 * mv + 0.009 * mv * cos(2 * ph);
  o[I.bodyRoll] = 0.04 * mv * sin(ph);
  o[I.chestYaw] = 0.06 * mv * sin(ph + 0.4);
  o[I.hipsYaw] = -0.12 * mv * sin(ph + 0.4); // 屁股左右扭得更明显
  o[I.hipsRoll] = -0.05 * mv * sin(ph);
  o[I.neckPitch] = 0.04 + 0.035 * mv * cos(2 * ph + 0.6);
  o[I.headRoll] = -0.04 * mv * sin(ph);
  o[I.wagAmp] = 0.3;
  o[I.wagFreq] = Math.max(1.6, s.walkFreq);
  o[I.squash] = 0.02 * mv * cos(2 * ph + 0.5);
};

A.run = (o, s) => {
  stand(o);
  const v = s.speed, p = s.runPhase, mv = ss(0.3, 1.6, v);
  const beta = 0.3, S = s.runStride;
  // 转式奔跑（rotary gallop）：前腿 0 / .08，后腿 .5 / .58；之间两次腾空
  const offs = [0, -0.08, -0.5, -0.58];
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const u = foot(o, i, p + offs[i], beta, S, FEET[i][1] + (front ? 0.02 : -0.01), (front ? 0.11 : 0.10) * mv);
    if (u >= 0) o[LEG + i * 8 + CURL] = (front ? 1.4 : -0.8) * sin(Math.PI * u) * mv;
  }
  const flex = cos(TAU * (p - 0.42));     // +1 收拢腾空，-1 伸展腾空
  const air = 0.5 + 0.5 * cos(2 * TAU * (p - 0.43));
  o[I.chestPitch] = 0.12 * flex * mv;
  o[I.hipsPitch] = -0.17 * flex * mv;
  o[I.chestZ] = -0.022 * flex * mv;
  o[I.hipsZ] = 0.022 * flex * mv;
  o[I.bodyY] = DIM.BODY_Y - 0.02 + 0.05 * air * mv;
  o[I.bodyPitch] = 0.07 * cos(TAU * (p - 0.18)) * mv;
  o[I.bodyRoll] = 0.03 * sin(TAU * p) * mv;
  o[I.neckPitch] = -0.12 * mv - 0.6 * o[I.bodyPitch] - 0.3 * o[I.chestPitch];
  o[I.headPitch] = -0.05 - 0.3 * o[I.bodyPitch];
  o[I.earBack] = 0.55 * mv;
  o[I.earOut] = 0.12 * mv;
  o[I.jaw] = (0.26 + 0.05 * sin(TAU * p)) * mv;
  o[I.tongue] = 0.75 * mv;
  o[I.tailBase] = -0.32 - 0.35 * mv;
  o[I.tailCurl] = 0.78 - 0.25 * mv;
  o[I.wagAmp] = 0.2;
  o[I.wagFreq] = 3;
  o[I.squash] = -0.05 * flex * mv; // 收拢时压扁、伸展时拉长
  o[I.lookW] = 0.5;
};

A.sit = (o, s) => {
  stand(o);
  const t = s.t, T = s.time;
  o[I.bodyY] = 0.25; // 小短腿版（原 0.315）
  o[I.bodyZ] = -0.07;
  o[I.bodyPitch] = -0.62;
  o[I.hipsPitch] = -0.2;
  o[I.chestPitch] = 0.04;
  o[I.neckPitch] = 0.28;
  o[I.headPitch] = 0.30;
  setFoot(o, 0, 0.085, ANK, 0.15);
  setFoot(o, 1, -0.085, ANK, 0.15);
  setFoot(o, 2, 0.15, ANK, -0.02);
  setFoot(o, 3, -0.15, ANK, -0.02);
  o[LEG + 2 * 8 + CURL] = 0; o[LEG + 3 * 8 + CURL] = 0;
  // 偶尔歪头（左右交替）
  const cyc = Math.floor(t / 5.5), u = t - cyc * 5.5;
  const tilt = 0.32 * hump(u, 2.6, 3.0, 4.2, 4.7) * (cyc % 2 ? -1 : 1);
  o[I.headRoll] = tilt + 0.04 * wander(T * 0.3, 2);
  o[I.headYaw] = 0.12 * wander(T * 0.2, 5);
  o[I.earBack] = -0.05 - 0.2 * abs(tilt);
  o[I.tailBase] = -1.65;
  o[I.tailCurl] = 0.22;
  o[I.tailSide] = 0.2;
  o[I.wagAmp] = 0.45;
  o[I.wagFreq] = 0.8;
  o[I.breathRate] = 0.3;
};

/** 趴卧抬头（狮身人面式），整体低矮：适合窝里看雨 */
function lieBase(o) {
  stand(o);
  o[I.bodyY] = 0.158;
  o[I.bodyPitch] = -0.03;
  o[I.bodyZ] = -0.03;
  setFoot(o, 0, 0.075, 0.034, 0.41);
  setFoot(o, 1, -0.085, 0.034, 0.40);
  // 后腿收在身体两侧
  setFoot(o, 2, 0.16, 0.034, -0.03);
  setFoot(o, 3, -0.16, 0.034, -0.03);
  o[LEG + 2 * 8 + CURL] = -0.2; o[LEG + 3 * 8 + CURL] = -0.2;
  o[I.hipsRoll] = 0.0;
  o[I.neckPitch] = 0.68;
  o[I.headPitch] = -0.66;
  o[I.reach] = 0.05;
  o[I.earBack] = 0.78;
  o[I.earOut] = 0.12;
  o[I.tailBase] = -1.45;
  o[I.tailCurl] = 0.5;
  o[I.tailSide] = 1.55;
  o[I.wagAmp] = 0.06;
  o[I.wagFreq] = 0.7;
  o[I.breathRate] = 0.25;
}

A.lie = (o, s) => {
  lieBase(o);
  const T = s.time;
  o[I.headYaw] = 0.12 * wander(T * 0.15, 3);
  o[I.headRoll] = 0.05 * wander(T * 0.13, 1);
};

A.sleep = (o, s) => {
  lieBase(o);
  const T = s.time;
  o[I.bodyY] = 0.15;
  o[I.bodyRoll] = 0.16;
  o[I.hipsRoll] = 0.3;
  o[I.hipsYaw] = 0.12;
  o[I.chestYaw] = -0.08;
  setFoot(o, 0, 0.06, 0.034, 0.40);
  setFoot(o, 1, -0.07, 0.034, 0.41);
  setFoot(o, 2, 0.2, 0.034, 0.0);
  setFoot(o, 3, 0.06, 0.04, 0.05);
  o[I.neckPitch] = 0.62;
  o[I.neckYaw] = 0.14;
  o[I.headPitch] = -0.42;
  o[I.headRoll] = 0.2;
  o[I.headYaw] = 0.1;
  o[I.eyeOpen] = 0;
  o[I.earBack] = 0.95;
  o[I.earOut] = 0.3;
  o[I.tailBase] = -1.6;
  o[I.tailCurl] = 0.48;
  o[I.tailSide] = 1.5;
  o[I.wagAmp] = 0;
  o[I.lookW] = 0;
  o[I.breath] = 2.4;
  o[I.breathRate] = 0.19;
  o[I.bodyY] += 0.004 * sin(T * TAU * 0.19);
};

/** 仰面打滚：背着地左右扭，偶尔翻回去再翻过来。周期 6.4s */
A.roll = (o, s) => {
  stand(o);
  const t = s.t;
  const P = 6.4;
  const u = t - Math.floor(t / P) * P;
  const w = TAU / 1.15;
  const back = Math.pow(sin(Math.PI * clamp((u - 4.5) / 1.9, 0, 1)), 2); // 0..1..0：翻回趴姿再翻回去
  const wig = sin(w * t);
  const roll = Math.PI + 0.36 * wig * (1 - back) - back * 2.3;
  o[I.bodyRoll] = roll;
  o[I.bodyY] = 0.175 + 0.05 * back + 0.012 * abs(wig);
  o[I.bodyX] = -0.05 * sin(roll - Math.PI);
  o[I.chestYaw] = 0.22 * sin(w * t + 0.7) * (1 - back);
  o[I.hipsYaw] = -0.22 * sin(w * t + 0.7) * (1 - back);
  o[I.hipsRoll] = 0.12 * wig * (1 - back);
  // 腿在空中蹬
  const k = 1 - back;
  for (let i = 0; i < 4; i++) {
    const ph = w * 2 * t + i * 1.6;
    const front = i < 2;
    const side = i % 2 ? -1 : 1;
    if (front) setLocal(o, i, 0.02 * side, -0.16 + 0.05 * cos(ph) * k, 0.07 + 0.05 * sin(ph) * k, 1.2);
    else setLocal(o, i, 0.04 * side, -0.2 + 0.06 * cos(ph) * k, 0.05 + 0.07 * sin(ph) * k, -0.3);
  }
  // 头侧着搁在草地上、脸朝外，随扭动左右蹭
  const hs = sin(w * 0.5 * t + 0.5);
  o[I.neckPitch] = RP.NP * k + 0.1;
  o[I.neckYaw] = (RP.NY + 0.15 * hs) * k;
  o[I.neckRoll] = RP.NR * k;
  o[I.headPitch] = RP.HP * k;
  o[I.headRoll] = (RP.HR + 0.25 * hs) * k;
  o[I.reach] = 0.03 * k;
  o[I.jaw] = 0.32;
  o[I.tongue] = 0.85;
  o[I.eyeOpen] = 0.55;
  o[I.earBack] = 0.45 * k;
  o[I.earOut] = 0.3;
  o[I.tailBase] = -1.35;
  o[I.tailCurl] = 0.3 - 0.5 * k;
  o[I.tailSide] = 0.1;
  o[I.wagAmp] = 0.55;
  o[I.wagFreq] = 3.2;
  o[I.lookW] = 0;
};

/** 兴奋：原地小碎步弹跳，尾巴狂摇，张嘴吐舌 */
A.spin = (o, s) => {
  stand(o);
  const t = s.t;
  const f = 2.7;
  const hop = Math.pow(abs(sin(Math.PI * f * t)), 0.75);
  o[I.bodyY] = DIM.BODY_Y + 0.075 * hop - 0.015;
  o[I.bodyPitch] = -0.1 - 0.07 * sin(TAU * f * t * 0.5);
  o[I.squash] = 0.07 * (hop - 0.5);
  // 小碎步：前脚交替点地，后脚轻颠
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const ph = TAU * f * t * 0.5 + (i % 2 ? Math.PI : 0) + (front ? 0 : 0.8);
    const up = Math.max(0, sin(ph));
    setFoot(o, i, FEET[i][0] * 1.08, ANK + (front ? 0.09 : 0.04) * up, FEET[i][1] + (front ? 0.03 : 0) + 0.03 * up);
    o[LEG + i * 8 + CURL] = (front ? 0.8 : -0.3) * up;
  }
  o[I.chestYaw] = 0.06 * sin(TAU * f * t * 0.5);
  o[I.hipsYaw] = -0.1 * sin(TAU * f * t * 0.5);
  o[I.neckPitch] = -0.15;
  o[I.headPitch] = -0.08 + 0.05 * sin(TAU * f * t);
  o[I.headRoll] = 0.1 * sin(TAU * f * t * 0.5);
  o[I.jaw] = 0.34 + 0.08 * sin(TAU * f * t);
  o[I.tongue] = 0.8;
  o[I.eyeOpen] = 0.78;
  o[I.earBack] = 0.25 + 0.15 * sin(TAU * f * t);
  o[I.earOut] = 0.1 + 0.1 * sin(TAU * f * t + 1);
  o[I.tailBase] = -0.2;
  o[I.tailCurl] = 0.72;
  o[I.wagAmp] = 0.85;
  o[I.wagFreq] = 7;
};

/** 邀玩：前身压低、屁股翘起、尾巴狂摇 */
A.playbow = (o, s) => {
  stand(o);
  const t = s.t;
  const b = sin(TAU * 1.5 * t);
  o[I.bodyPitch] = 0.5 + 0.03 * b;
  o[I.bodyY] = 0.2 + 0.012 * b; // 小短腿版（原 0.27）
  o[I.bodyZ] = 0.0 + 0.012 * b;
  o[I.chestPitch] = 0.08;
  setFoot(o, 0, 0.11, ANK - 0.008, 0.42);
  setFoot(o, 1, -0.11, ANK - 0.008, 0.42);
  setFoot(o, 2, 0.1, ANK, -0.17);
  setFoot(o, 3, -0.1, ANK, -0.17);
  o[I.hipsYaw] = 0.08 * sin(TAU * 3 * t);
  o[I.neckPitch] = -0.5;
  o[I.headPitch] = -0.3;
  o[I.headRoll] = 0.12 * sin(TAU * 0.4 * t);
  o[I.jaw] = 0.22;
  o[I.tongue] = 0.5;
  o[I.earBack] = 0.1;
  o[I.tailBase] = 0.1;
  o[I.tailCurl] = 0.62;
  o[I.wagAmp] = 0.8;
  o[I.wagFreq] = 5.5;
  o[I.squash] = 0.02 * b;
};

A.sniff = (o, s) => {
  stand(o);
  const t = s.t;
  // 要和吃饭 / 喝水（drink：站定、头一点一点、张嘴伸舌头）一眼分得开：
  // 一轮约 5 秒——前一大半鼻子贴着地面往前探、左右大幅度扫着闻，前脚跟着挪小碎步；
  // 然后抬起头、鼻尖朝上冲着空气嗅两下、歪歪头，再低下去。全程闭着嘴、耳朵朝前竖着、尾巴摇得欢。
  const c = (t / 4.6) % 1;
  const up = hump(c, 0.52, 0.62, 0.9, 0.99); // 抬头嗅空气的程度（约占一轮的三分之一）
  const dn = 1 - up;
  const w = TAU * 0.42 * t, sw = sin(w); // 左右扫
  o[I.bodyPitch] = 0.15 * dn + 0.02 * up; // 比吃饭压得浅：鼻子在草尖上扫，脸露在外面，不是整个头埋下去
  o[I.bodyY] = DIM.BODY_Y - 0.035 * dn;
  o[I.bodyZ] = 0.04 * dn;
  o[I.bodyX] = 0.018 * sw * dn;
  o[I.chestYaw] = 0.12 * sw * dn;
  o[I.chestPitch] = 0.08 * dn;
  o[I.neckPitch] = 0.4 * dn - 0.22 * up;
  o[I.headPitch] = 0.04 * dn - 0.34 * up; // 低头时鼻子朝前下方探出去（不是垂直扎下去）；抬头时鼻尖朝上
  o[I.reach] = 0.16 * dn + 0.04 * up;
  o[I.neckYaw] = 0.36 * sw * dn + 0.1 * sin(1.7 * t) * up;
  o[I.headYaw] = 0.28 * sin(w + 0.5) * dn;
  o[I.headRoll] = 0.2 * up;
  // 鼻子抽动：贴地时又细又快，抬头时慢一些、幅度大
  o[I.headPitch] += 0.03 * sin(TAU * 8 * t) * dn + 0.055 * sin(TAU * 4.5 * t) * up;
  o[I.earBack] = -0.14 - 0.2 * up;
  o[I.wagAmp] = 0.5;
  o[I.wagFreq] = 3;
  o[I.lookW] = 0;
  // 前脚跟着左右扫的节奏轮流抬一下、往两边挪
  const lf = Math.max(0, sin(w + 0.3)), rf = Math.max(0, -sin(w + 0.3));
  setFoot(o, 0, 0.1 + 0.02 * sw * dn, ANK + 0.03 * dn * lf * lf * lf, 0.22 + 0.025 * sw * dn);
  setFoot(o, 1, -0.1 + 0.02 * sw * dn, ANK + 0.03 * dn * rf * rf * rf, 0.2 - 0.025 * sw * dn);
};

A.drink = (o, s) => {
  stand(o);
  const t = s.t;
  const lap = TAU * 2.4 * t;
  o[I.bodyPitch] = 0.28;
  o[I.bodyY] = DIM.BODY_Y - 0.07;
  o[I.bodyZ] = 0.02;
  o[I.chestPitch] = 0.12;
  setFoot(o, 0, 0.13, ANK, 0.23);
  setFoot(o, 1, -0.13, ANK, 0.23);
  o[I.neckPitch] = 0.55 + 0.04 * sin(lap);
  o[I.headPitch] = 0.2;
  o[I.reach] = 0.14;
  o[I.jaw] = 0.16 + 0.14 * Math.max(0, sin(lap));
  o[I.tongue] = 0.75 * Math.max(0, sin(lap - 0.5));
  o[I.earBack] = 0.1;
  o[I.wagAmp] = 0.1;
  o[I.lookW] = 0;
};

// ---------------------------------------------------------------- 一次性动作
export const RP = { NP: 1.2, NY: -0.4, NR: -0.5, HP: 0.0, HR: -0.9 };
export const ONE_SHOT = { pounce: 0.7, pickup: 0.5, shake: 1.2, flinch: 0.6 };

A.pounce = (o, s) => {
  stand(o);
  const t = Math.min(s.t, ONE_SHOT.pounce);
  const crouch = hump(t, 0.0, 0.13, 0.15, 0.22);
  const a = clamp((t - 0.17) / 0.33, 0, 1);
  const air = sin(Math.PI * a) * (t > 0.17 && t < 0.5 ? 1 : 0);
  const land = ss(0.44, 0.56, t);
  // 纵向弧线 + 姿态
  o[I.bodyY] = DIM.BODY_Y - 0.08 * crouch + 0.24 * air - 0.1 * land;
  o[I.bodyPitch] = -0.06 * crouch + (a > 0 && a < 1 ? lerp(-0.3, 0.3, a) * air : 0) + 0.32 * land;
  o[I.hipsYaw] = 0.1 * sin(TAU * 9 * t) * crouch;
  o[I.chestPitch] = 0.06 * land;
  o[I.squash] = -0.09 * crouch + 0.08 * air - 0.05 * hump(t, 0.48, 0.53, 0.56, 0.68);
  const inAir = hump(t, 0.15, 0.2, 0.45, 0.52);
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const side = i % 2 ? -1 : 1;
    const b = LEG + i * 8;
    // 起跳前/落地后：地面；空中：前腿前伸、后腿后蹬
    const gz = front ? lerp(FEET[i][1], 0.36, land) : lerp(FEET[i][1], -0.17, land);
    setFoot(o, i, front ? lerp(FEET[i][0], 0.055 * side, land) : FEET[i][0], ANK, gz);
    o[b + LX] = 0.01 * side;
    o[b + LY] = front ? -0.2 : -0.21;
    o[b + LZ] = front ? 0.17 : -0.17;
    o[b + GW] = 1 - inAir;
    o[b + CURL] = front ? -0.3 * inAir : 0.5 * inAir;
  }
  o[I.neckPitch] = -0.2 * air + 0.22 * land;
  o[I.headPitch] = 0.12 * land;
  o[I.reach] = 0.07 * land;
  o[I.earBack] = 0.4 * air - 0.1 * land;
  o[I.jaw] = 0.18 * air + 0.1 * land;
  o[I.eyeOpen] = 1;
  o[I.tailBase] = -0.32 - 0.3 * air;
  o[I.tailCurl] = 0.78 - 0.3 * air;
  o[I.wagAmp] = 0.15 + 0.6 * land;
  o[I.wagFreq] = 5;
  o[I.lookW] = 0.4;
};

A.pickup = (o, s) => {
  stand(o);
  const t = Math.min(s.t, ONE_SHOT.pickup);
  const down = hump(t, 0.0, 0.2, 0.27, 0.48);
  const open = hump(t, 0.06, 0.16, 0.22, 0.3);
  o[I.bodyPitch] = 0.24 * down;
  o[I.bodyY] = DIM.BODY_Y - 0.085 * down;
  o[I.chestPitch] = 0.1 * down;
  o[I.neckPitch] = 0.5 * down - 0.12 * hump(t, 0.36, 0.42, 0.45, 0.5);
  o[I.headPitch] = 0.3 * down;
  o[I.reach] = 0.15 * down;
  o[I.jaw] = 0.45 * open;
  o[I.earBack] = -0.1 * down;
  o[I.wagAmp] = 0.3;
  o[I.wagFreq] = 3;
  o[I.lookW] = 1 - down;
};

A.shake = (o, s) => {
  stand(o);
  const t = Math.min(s.t, ONE_SHOT.shake);
  const w = TAU * 6.2;
  const eh = hump(t, 0.0, 0.12, 0.72, 0.95);
  const eb = hump(t, 0.12, 0.3, 0.92, 1.15);
  for (let i = 0; i < 4; i++) setFoot(o, i, FEET[i][0] * 1.3, ANK, FEET[i][1]);
  o[I.bodyY] = DIM.BODY_Y - 0.025 * eb + 0.006 * sin(2 * w * t) * eb;
  o[I.headRoll] = 0.55 * sin(w * t) * eh;
  o[I.neckRoll] = 0.25 * sin(w * t - 0.4) * eh;
  o[I.neckYaw] = 0.12 * sin(w * t - 0.2) * eh;
  o[I.chestRoll] = 0.42 * sin(w * t - 1.0) * eb;
  o[I.hipsRoll] = 0.38 * sin(w * t - 1.9) * eb;
  o[I.bodyRoll] = 0.06 * sin(w * t - 1.4) * eb;
  o[I.earOut] = 0.5 * sin(w * t - 1.3) * eh + 0.15 * eh;
  o[I.earBack] = 0.25 * eh;
  o[I.eyeOpen] = 1 - 0.85 * Math.max(eh, eb * 0.8);
  o[I.jaw] = 0.08 * eh;
  o[I.tailSide] = 0.28 + 0.6 * sin(w * t - 2.5) * eb;
  o[I.wagAmp] = 0.1;
  o[I.squash] = 0.03 * sin(2 * w * t) * eb;
  o[I.lookW] = 0;
};

/** 受惊一缩：叠加在进入前的姿态上（趴着时也能缩） */
A.flinch = (o, s) => {
  o.set(s.base);
  const t = Math.min(s.t, ONE_SHOT.flinch);
  const k = ss(0, 0.07, t) * (1 - 0.6 * ss(0.22, 0.6, t));
  const low = s.base[I.bodyY] < 0.25;
  o[I.bodyY] -= (low ? 0.025 : 0.07) * k;
  o[I.bodyZ] -= 0.04 * k;
  o[I.bodyPitch] -= 0.06 * k;
  o[I.bodyX] += 0.004 * sin(70 * t) * k;
  o[I.neckPitch] += 0.3 * k;
  o[I.headPitch] -= 0.18 * k;
  o[I.earBack] += 0.9 * k;
  o[I.earOut] += 0.3 * k;
  o[I.eyeOpen] = Math.min(o[I.eyeOpen], 1 - 0.9 * hump(t, 0.0, 0.03, 0.14, 0.24));
  o[I.tailBase] -= 1.7 * k;
  o[I.tailCurl] -= 0.45 * k;
  o[I.wagAmp] *= 1 - k;
  o[I.squash] -= 0.06 * k;
  o[I.lookW] *= 1 - 0.6 * k;
};

export const ACTIONS = A;
export const DOG_ACTIONS = ['idle', 'walk', 'run', 'sit', 'lie', 'sleep', 'roll', 'spin', 'playbow', 'sniff', 'drink', 'pounce', 'pickup', 'shake', 'flinch'];
