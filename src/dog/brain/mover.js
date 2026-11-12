// 狗狗移动控制器：加减速、转向速率上限、先转身再加速、绕开障碍圆、进出狗窝直线段。
// 只通过 island 契约（heightAt / isWalkable / clampWalkable / obstacles / anchors）读取世界信息。
import { clamp, damp, moveTowards, wrapAngle, angleDiff, smoothstep } from '../../core/util.js';

export const WALK_SPEED = 0.9;
export const RUN_SPEED = 3.6;
const DOG_MARGIN = 0.4; // 狗身体半径 + 余量（绕开障碍时加在障碍半径上；狗在画面里放大了 1.5 倍，按放大后的体型留）

export function createMover(ctx, dog) {
  const island = ctx.island;
  const anchors = island.anchors;

  const mover = {
    x: 0, z: 0, heading: 0, speed: 0,
    angVel: 0,
    inKennel: false,    // 狗在窝内（kennelDoor↔kennelInside 这一段），此时忽略 walkable/障碍
    onRamp: false,      // 狗在瞭望台坡道/平台上（lookout.base↔lookout.top 这一段），同样是脚本化路段：忽略 walkable/障碍；goal 为普通 nav 时先沿坡道中线走回 base
    hasGoal: false,
    arrived: false,     // 最近一个目标是正常到达
    blocked: false,     // 最近一个目标因卡住被放弃
    hold: false,        // true：速度降到 0（受惊时）
    spinRate: 0,        // ≠0：heading 被直接旋转（兴奋转圈）
    driveSpeed: -1,     // ≥0：直接按该速度沿 heading 前进（扑跃）
    extraY: 0,          // 额外抬高（站/趴在垫子上时 = 垫面高度），由 brain 每帧给出
    reverse: false,     // true：倒退着走——身体朝向与行进方向相反（叼着垫子边缘往后拖时用）
    get settled() { return !mover.hasGoal && mover.speed < 0.08 && mover.driveSpeed < 0; },
    goTo, goStraight, clearGoal, face, update, place, gait, headingError,
  };

  const kennelObs = island.obstacles.find((o) => o.name === 'kennel') || null;
  const goal = { kind: 'nav', x: 0, z: 0, vmax: WALK_SPEED, arriveR: 0.12, through: false, ramp: 0, rampTop: false, free: false };
  let facing = NaN;
  let avoidIdx = -1, avoidSide = 1;
  let stuckT = 0;
  let progBest = 1e9, progT = 0; // 进展看门狗：长时间离目标没有明显更近就放弃（防止在障碍圆的凹口里来回蹭）
  let curGait = null;
  let slopePitch = 0, lastDt = 1 / 30;

  function place(x, z, heading) {
    mover.x = x; mover.z = z;
    mover.heading = heading;
    mover.speed = 0; mover.angVel = 0;
    mover.hasGoal = false;
    apply();
  }

  // 待执行的脚本直线段：goStraight 被调用时如果狗离入口（窝门 / 坡道底）还远，先正常寻路走到入口，再走直线段。
  // 这样即使上一步寻路没走到（被障碍挡住而放弃），也不会从远处沿直线穿过池塘、狗窝墙等障碍。
  let pending = null; // { x, z, opts }
  // 绕道：寻路走不通（被障碍和岛沿夹住等）时，先去草坪中心这个“枢纽”，到了再回头去原目标；每个目标只绕一次
  let detoured = false, onDetour = false, resume = null;
  function goTo(x, z, opts) {
    pending = null;
    detoured = false; onDetour = false; resume = null;
    setNav(x, z, opts);
  }
  function setNav(x, z, { run = false, speed = 0, arriveR = 0.12, through = false } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    goal.kind = 'nav';
    goal.x = x; goal.z = z;
    goal.vmax = speed > 0 ? Math.min(speed, RUN_SPEED) : run ? RUN_SPEED : WALK_SPEED;
    goal.arriveR = arriveR;
    goal.ramp = 0;
    goal.through = through;
    goal.free = false;
    mover.hasGoal = true;
    mover.arrived = false;
    mover.blocked = false;
    facing = NaN;
    stuckT = 0;
    progBest = 1e9; progT = 0;
  }

  /** 直线走向目标，忽略障碍与 walkable（进出狗窝用）。 */
  /** ramp：undefined = 普通脚本直线（狗窝）；true = 走向平台（到达后 onRamp 保持）；false = 走回坡道底端（到达后 onRamp 清除）。 */
  /** opts.free：小游戏用的脚本化直线段（钓鱼走到池塘水边）——不走窝门 / 坡道入口，直接从当前位置沿直线走过去，到达后不改变 inKennel / onRamp。 */
  function goStraight(x, z, opts = {}) {
    if (opts.free) {
      pending = null; detoured = false; onDetour = false; resume = null;
      startStraight(x, z, opts);
      goal.free = true;
      return;
    }
    const isRamp = opts.ramp !== undefined;
    const inZone = isRamp ? mover.onRamp : mover.inKennel;
    const entry = isRamp ? (anchors.lookout ? anchors.lookout.base : null) : anchors.kennelDoor;
    detoured = false; onDetour = false; resume = null;
    if (!inZone && entry && Math.hypot(mover.x - entry.x, mover.z - entry.z) > 0.9) {
      pending = { x, z, opts };
      setNav(entry.x, entry.z, { run: opts.run, speed: opts.speed, arriveR: 0.2 });
      return;
    }
    pending = null;
    startStraight(x, z, opts);
  }
  function startStraight(x, z, { run = false, speed = 0, arriveR = 0.1, ramp } = {}) {
    setNav(x, z, { run, speed, arriveR });
    goal.kind = 'straight';
    if (ramp !== undefined) {
      goal.ramp = 1;
      goal.rampTop = !!ramp;
      mover.onRamp = true;
    }
  }

  function clearGoal() {
    mover.hasGoal = false;
  }

  function face(angle) {
    facing = Number.isFinite(angle) ? angle : NaN;
  }

  function headingError(angle) {
    return Math.abs(angleDiff(mover.heading, angle));
  }

  function gait() {
    const sp = mover.speed;
    if (sp > 2.3 || (curGait === 'run' && sp > 1.8)) curGait = 'run';
    else if (sp > 0.15 || (curGait === 'walk' && sp > 0.07)) curGait = 'walk';
    else curGait = null;
    return curGait;
  }

  /** 寻路走不通时：若正要去某个入口，先绕道草坪中心再试一次；否则放弃该目标 */
  function giveUp() {
    const lw = anchors.lawn;
    if (!detoured && lw && goal.kind === 'nav' && !mover.inKennel && !mover.onRamp && Math.hypot(mover.x - lw.x, mover.z - lw.z) > 1.2) {
      detoured = true; onDetour = true;
      resume = { x: goal.x, z: goal.z, arriveR: goal.arriveR, through: goal.through, vmax: goal.vmax };
      goal.x = lw.x; goal.z = lw.z; goal.arriveR = 0.8; goal.through = false;
      stuckT = 0; progBest = 1e9; progT = 0; avoidIdx = -1;
      return;
    }
    pending = null; onDetour = false; resume = null;
    mover.hasGoal = false;
    mover.blocked = true;
  }

  // 返回绕开障碍后的期望朝向
  function steer(dirHeading, distGoal) {
    const obs = island.obstacles;
    const sx = Math.sin(dirHeading), cz = Math.cos(dirHeading);
    const L = Math.min(distGoal, 1.4 + mover.speed * 0.7);
    let best = -1, bestD = 1e9, bestLat = 0;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const ox = o.x - mover.x, oz = o.z - mover.z;
      const D = Math.hypot(ox, oz);
      const rI = o.r + DOG_MARGIN;
      // 目标就在该障碍外缘附近且已经很近：不再绕它
      if (distGoal < 1.3 && Math.hypot(goal.x - o.x, goal.z - o.z) < rI) continue;
      const along = ox * sx + oz * cz;
      if (along < -0.1 && D > rI) continue;
      if (D > L + rI) continue;
      const lat = ox * cz - oz * sx;
      if (Math.abs(lat) >= rI && D > rI) continue;
      if (D < bestD) { bestD = D; best = i; bestLat = lat; }
    }
    if (best < 0) { avoidIdx = -1; return dirHeading; }
    const o = obs[best];
    const ox = o.x - mover.x, oz = o.z - mover.z;
    const rI = o.r + DOG_MARGIN;
    if (avoidIdx !== best) {
      avoidIdx = best;
      avoidSide = bestLat > 0 ? -1 : 1;
    }
    const a0 = Math.atan2(ox, oz);
    const alpha = bestD > rI ? Math.asin(Math.min(1, rI / bestD)) : Math.PI / 2 + 0.3;
    return a0 + avoidSide * (alpha + 0.12);
  }

  function update(dt) {
    if (!(dt > 0)) return;
    lastDt = Math.min(dt, 0.1);
    let vdes = 0;
    let desiredHeading = NaN;
    if (mover.inKennel && kennelObs && Math.hypot(mover.x - kennelObs.x, mover.z - kennelObs.z) > kennelObs.r + 1.3) mover.inKennel = false;
    if (mover.onRamp && anchors.lookout) {
      const lkA = anchors.lookout, bx = lkA.base.x - lkA.top.x, bz = lkA.base.z - lkA.top.z;
      const tt = clamp(((mover.x - lkA.top.x) * bx + (mover.z - lkA.top.z) * bz) / (bx * bx + bz * bz), 0, 1);
      if (Math.hypot(mover.x - (lkA.top.x + bx * tt), mover.z - (lkA.top.z + bz * tt)) > 1.2) mover.onRamp = false;
    }
    let freePass = mover.inKennel || mover.onRamp;
    const door = anchors.kennelDoor;
    const lk = anchors.lookout;

    if (mover.driveSpeed >= 0) {
      mover.speed = Math.min(RUN_SPEED, mover.driveSpeed);
      freePass = freePass || false;
    } else {
      if (mover.hasGoal) {
        let tx = goal.x, tz = goal.z;
        let exiting = false, exitRamp = false;
        if (mover.inKennel && goal.kind === 'nav') { tx = door.x; tz = door.z; exiting = true; }
        else if (mover.onRamp && goal.kind === 'nav' && lk) { tx = lk.base.x; tz = lk.base.z; exiting = true; exitRamp = true; }
        const straight = exiting || goal.kind === 'straight';
        if (straight) freePass = true;
        const dx = tx - mover.x, dz = tz - mover.z;
        const dist = Math.hypot(dx, dz);
        const arriveR = exiting ? 0.2 : goal.arriveR;
        if (dist < arriveR) {
          if (exiting) {
            if (exitRamp) mover.onRamp = false; else mover.inKennel = false;
          } else if (onDetour && resume) {
            // 绕道到了草坪中心：回头去原来的目标
            goal.x = resume.x; goal.z = resume.z; goal.arriveR = resume.arriveR; goal.through = resume.through; goal.vmax = resume.vmax;
            onDetour = false; resume = null;
            stuckT = 0; progBest = 1e9; progT = 0; avoidIdx = -1;
          } else if (pending && goal.kind === 'nav') {
            const p = pending;
            pending = null;
            startStraight(p.x, p.z, p.opts);
          } else {
            mover.hasGoal = false;
            mover.arrived = true;
            if (goal.kind === 'straight') {
              if (goal.ramp) mover.onRamp = goal.rampTop;
              else if (!goal.free) mover.inKennel = !island.isWalkable(goal.x, goal.z);
            }
          }
        } else {
          const dirH = Math.atan2(dx, dz);
          const steerH = straight ? dirH : steer(dirH, dist);
          // 倒退时：行进方向不变，身体朝向取反方向
          const faceH = mover.reverse ? steerH + Math.PI : steerH;
          const err = Math.abs(angleDiff(mover.heading, faceH));
          const vmax = exiting ? Math.min(goal.vmax, exitRamp ? 1.7 : 1.6) : goal.vmax;
          vdes = goal.through && !straight ? vmax : Math.min(vmax, 0.15 + 2.4 * dist);
          const gate = goal.through && !straight ? clamp(1 - err / 1.6, 0.55, 1) : smoothstep(1.5, 0.4, err);
          vdes *= gate;
          desiredHeading = faceH;
          // 卡住检测：想走但长时间没速度
          if (mover.speed < 0.12 && err < 0.5) stuckT += dt; else stuckT = 0;
          if (stuckT > 1.5) { stuckT = 0; giveUp(); }
          if (!straight) {
            if (dist < progBest - 0.08) { progBest = dist; progT = 0; } else progT += dt;
            if (progT > 4) { progT = 0; giveUp(); }
          }
        }
      } else if (Number.isFinite(facing)) {
        desiredHeading = facing;
      }
      if (mover.hold) vdes = 0;
      const rate = vdes > mover.speed ? (vdes > 1.5 ? 4.5 : 2.6) : 6.0;
      mover.speed = moveTowards(mover.speed, vdes, rate * dt);
    }

    // 朝向
    if (mover.spinRate !== 0) {
      mover.heading += mover.spinRate * dt;
      mover.angVel = 0;
    } else if (mover.driveSpeed < 0 && Number.isFinite(desiredHeading)) {
      const err = angleDiff(mover.heading, desiredHeading);
      const maxTurn = 5.0 - 2.2 * clamp(mover.speed / RUN_SPEED);
      const tgt = clamp(err * 7, -maxTurn, maxTurn);
      mover.angVel = damp(mover.angVel, tgt, 16, dt);
      let d = mover.angVel * dt;
      if (Math.abs(d) > Math.abs(err)) d = err;
      mover.heading += d;
    } else {
      mover.angVel = damp(mover.angVel, 0, 16, dt);
      mover.heading += mover.angVel * dt;
    }
    mover.heading = wrapAngle(mover.heading);

    // 位移
    const step = mover.speed * dt;
    if (step > 1e-6) {
      const sgn = mover.reverse && mover.driveSpeed < 0 ? -1 : 1;
      let nx = mover.x + Math.sin(mover.heading) * step * sgn;
      let nz = mover.z + Math.cos(mover.heading) * step * sgn;
      if (!freePass && !island.isWalkable(nx, nz)) {
        const c = island.clampWalkable(nx, nz);
        const moved = Math.hypot(c.x - mover.x, c.z - mover.z);
        if (moved <= step * 1.35 + 0.01 && island.isWalkable(c.x, c.z)) { nx = c.x; nz = c.z; }
        else { nx = mover.x; nz = mover.z; mover.speed *= 0.5; }
      }
      mover.x = nx;
      mover.z = nz;
    }
    apply();
  }

  function apply() {
    const g = dog.group;
    g.position.set(mover.x, island.heightAt(mover.x, mover.z) + mover.extraY, mover.z);
    // 身体顺着地面坡度前后倾斜（上下瞭望台坡道时最明显；否则身体是水平的，后半截会陷进木板里）
    {
      const sc = g.scale.x || 1, d = 0.3 * sc;
      const fx = Math.sin(mover.heading) * d, fz = Math.cos(mover.heading) * d;
      const hf = island.heightAt(mover.x + fx, mover.z + fz), hb = island.heightAt(mover.x - fx, mover.z - fz);
      const want = clamp(-Math.atan2(hf - hb, 2 * d), -0.55, 0.55);
      slopePitch += (want - slopePitch) * (1 - Math.exp(-9 * lastDt));
      if (g.rotation.order !== 'YXZ') g.rotation.order = 'YXZ'; // 先偏航，再绕身体自己的横轴俯仰
      g.rotation.x = slopePitch;
    }
    g.rotation.y = mover.heading;
    dog.speed = mover.reverse ? -mover.speed : mover.speed; // 负值 = 倒退（模型据此倒着迈步）
  }

  return mover;
}
