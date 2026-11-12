// 狗垫控制器：垫子只有被狗叼着（carry）或被放回窝里（home 过渡）时才会动；放下（drop）只是原地落平。
// 所有变化都是平滑过渡：叼起 0.3s、放下 0.35s、归位 0.8s，绝不瞬移。
// 被叼时是“拖拽链”：嘴部点 P 是牵引点，垫子中心在离 P 固定距离的地方滞后跟随（转弯时甩一下），被叼的一头略抬起。
import { clamp, angleDiff, wrapAngle, smoothstep } from '../../core/util.js';

const MOUTH_FWD = 0.48;   // 嘴到狗中心的距离（狗本体尺寸 × group 缩放）
const GRAB_T = 0.3, DROP_T = 0.35, HOME_T = 0.8;
const LIFT_H = 0.28;       // 被叼一头比另一头高出多少
const BIAS = 0.95;        // 拖行时垫子偏向狗身体一侧的角度（避免整块垫子正好在狗肚子底下）

export function createMatCtl(S) {
  const { dog, island, mover } = S;
  const mat = island.mat;
  const obj = mat.object;
  const home = mat.home, homeYaw = mat.homeYaw;
  const kd = island.anchors.kennelDoor;
  const lift0 = mat.lift === undefined ? 0.03 : mat.lift;
  const HOLD_LEN = mat.halfZ || 0.69; // 垫子中心到被叼端（外沿）的距离 = 垫子半长

  const c = {
    mode: 'rest',   // rest | carry | drop | home
    x: obj.position.x, z: obj.position.z, yaw: obj.rotation.y,
    lift: 0,        // 0..1：被叼起的程度（影响倾斜与抬高）
    follow: 0,      // 0..1：叼起过渡（位置从原处过渡到拖行位置）
    time: 0,
    outT: 0,        // 垫子已经在窝外静静躺了多少秒（越久，狗越惦记着去处理它）
    get carried() { return c.mode === 'carry'; },
    get atHome() { return c.mode === 'rest' && Math.hypot(c.x - home.x, c.z - home.z) < 0.2; },
    get resting() { return c.mode === 'rest'; },
    dist(x, z) { return Math.hypot(c.x - x, c.z - z); },
    grab, release, placeHome, update,
    /** 倒退拖行时狗该站的位置：从垫子中心朝 (tx,tz) 方向退出“半长 + 嘴到身体中心的距离”，站在那里面朝垫子就能咬住垫沿 */
    standOff(tx, tz) {
      const sc = dog.group.scale ? dog.group.scale.x : 1;
      const d = HOLD_LEN + MOUTH_FWD * sc - 0.12;
      const L = Math.hypot(tx - c.x, tz - c.z) || 1;
      return { x: c.x + ((tx - c.x) / L) * d, z: c.z + ((tz - c.z) / L) * d, dist: d };
    },
  };
  let x0 = 0, z0 = 0, yaw0 = 0, ang = 0, hs = 0, hx = 0, hz = 0, hyaw = 0;

  function mouth() {
    const sc = dog.group.scale ? dog.group.scale.x : 1;
    const f = MOUTH_FWD * sc;
    return [mover.x + Math.sin(mover.heading) * f, mover.z + Math.cos(mover.heading) * f];
  }

  function grab() {
    if (c.mode === 'carry') return;
    const [px, pz] = mouth();
    // 嘴够不着垫子（比如没走到跟前就放弃了寻路）：不能叼起，否则垫子会凭空飞到嘴边
    if (Math.hypot(c.x - px, c.z - pz) > HOLD_LEN + 0.3) return;
    x0 = c.x; z0 = c.z; yaw0 = c.yaw;
    const d = Math.hypot(x0 - px, z0 - pz);
    ang = d > 0.05 ? Math.atan2(x0 - px, z0 - pz) : mover.heading + Math.PI;
    c.follow = 0;
    c.mode = 'carry';
  }

  function release() {
    if (c.mode !== 'carry') return;
    c.mode = 'drop'; // 位置/朝向就地冻结，只是把被叼的一头放下
  }

  function placeHome() {
    if (c.mode === 'home') return;
    hs = 0; hx = c.x; hz = c.z; hyaw = c.yaw;
    // 垫子左右对称：朝向只需对齐到 homeYaw 的 180° 等价类，避免多转半圈
    let d = angleDiff(hyaw, homeYaw);
    if (Math.abs(d) > Math.PI / 2) d -= Math.sign(d) * Math.PI;
    c.homeDelta = d;
    c.mode = 'home';
  }

  function update(dt) {
    c.time += dt;
    if (c.mode === 'rest' && !c.atHome) c.outT += dt; else c.outT = 0;
    if (c.mode === 'carry') {
      c.follow = Math.min(1, c.follow + dt / GRAB_T);
      c.lift = Math.min(1, c.lift + dt / GRAB_T);
      const [px, pz] = mouth();
      // 离开狗窝一段距离后，垫子才偏向一侧拖（窝里空间窄，直直地拖）
      const away = smoothstep(0.5, 1.6, Math.hypot(mover.x - kd.x, mover.z - kd.z));
      // 倒退着拖：垫子在嘴的正前方被拽着走（和身体完全不重叠），转弯时甩一下；
      // 向前叼着跑（下雨抢救垫子）：垫子拖在身侧后方
      const sway = 0.1 * Math.sin(c.time * 3.1) * clamp(mover.speed, 0, 1.5);
      const want = mover.reverse ? mover.heading + sway : mover.heading + Math.PI + BIAS * away + sway;
      const k = 1 - Math.exp(-3.2 * dt);
      ang = wrapAngle(ang + angleDiff(ang, want) * k);
      const dx = px + Math.sin(ang) * HOLD_LEN, dz = pz + Math.cos(ang) * HOLD_LEN;
      let yawd = ang + Math.PI; // +z 端朝向嘴
      // 初始朝向与目标差 180° 时，垫子左右对称，直接翻转看不出来
      let dy = angleDiff(yaw0, yawd);
      if (Math.abs(dy) > Math.PI / 2 && c.follow < 0.05) { yaw0 += Math.PI; dy = angleDiff(yaw0, yawd); }
      const e = smoothstep(0, 1, c.follow);
      c.x = x0 + (dx - x0) * e;
      c.z = z0 + (dz - z0) * e;
      c.yaw = wrapAngle(yaw0 + dy * e);
    } else if (c.mode === 'drop') {
      c.lift = Math.max(0, c.lift - dt / DROP_T);
      if (c.lift <= 0) c.mode = 'rest';
    } else if (c.mode === 'home') {
      hs = Math.min(1, hs + dt / HOME_T);
      const e = smoothstep(0, 1, hs);
      c.x = hx + (home.x - hx) * e;
      c.z = hz + (home.z - hz) * e;
      c.yaw = wrapAngle(hyaw + c.homeDelta * e);
      c.lift = Math.max(0, c.lift - dt / 0.5);
      if (hs >= 1) { c.mode = 'rest'; c.lift = 0; c.yaw = wrapAngle(hyaw + c.homeDelta); }
    }
    apply();
  }

  function apply() {
    const ease = smoothstep(0, 1, c.lift);
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    // 取中心与两端三点的最高地面，保证平放时不穿地
    const g0 = island.heightAt(c.x, c.z);
    const g1 = island.heightAt(c.x + sy * 0.55, c.z + cy * 0.55);
    const g2 = island.heightAt(c.x - sy * 0.55, c.z - cy * 0.55);
    const base = Math.max(g0, g1, g2);
    const tilt = Math.asin(LIFT_H / (2 * HOLD_LEN));
    obj.position.set(c.x, base + lift0 + ease * LIFT_H * 0.5, c.z);
    obj.rotation.y = c.yaw;
    obj.rotation.x = -tilt * ease;
    obj.rotation.z = 0;
  }

  c.homeDelta = 0;
  apply();
  return c;
}
