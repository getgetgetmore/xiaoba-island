// 互动（mode = fetch）：跑到 front → 兴奋转圈 → 追木棍 → 叼回 → 放下 → 继续兴奋等待。
// 每帧都根据 stick.state 校正阶段，因此任何时刻的点击都不会让流程卡死。
import { clamp } from '../../core/util.js';

const TWO_PI = Math.PI * 2;
const SPIN_RATE = 10.5; // rad/s ≈ 1.67 圈/秒

export function createFetch(S) {
  const { mover, dog, island, stick, rand, rint } = S;
  const A = island.anchors;
  const st = {
    phase: 'react', t: 0, travelT: 0,
    sub: 'face', subT: 0, spinTotal: 0, spinDone: 0, spinCur: 0, bounceDur: 0, bounceFlip: 0, bounceAct: 'playbow',
    attached: false, retry: 0, reactDur: 0.35,
  };
  const _tp = { x: 0, z: 0 };

  function setPhase(p) { st.phase = p; st.t = 0; }

  function startRush() {
    setPhase('rush');
    st.travelT = 0;
    mover.spinRate = 0;
    mover.driveSpeed = -1;
    mover.goTo(A.front.x, A.front.z, { run: true, arriveR: 0.12 });
  }

  function startReturn() {
    setPhase('return');
    st.travelT = 0;
    st.subT = 0;
    dog.setCarrying(true);
    mover.spinRate = 0;
    mover.goTo(A.front.x, A.front.z, { run: true, arriveR: 0.12 });
  }

  function enterWait() {
    setPhase('wait');
    st.sub = 'face';
    st.subT = 0;
    mover.spinRate = 0;
    mover.face(A.frontFacing);
  }

  function startSpin() {
    st.sub = 'spin';
    st.subT = 0;
    st.spinTotal = rint(1, 2) * TWO_PI;
    st.spinDone = 0;
    st.spinCur = 0;
    S.look(null);
  }

  function startChaseReact() {
    setPhase('chasereact');
    st.reactDur = rand(0.2, 0.3);
    mover.spinRate = 0;
    mover.clearGoal();
    st.retry = 0;
    st.attached = false;
  }

  function beginApproach() {
    const t = stick.target;
    if (!t) { startRush(); return; }
    const dx = t.x - mover.x, dz = t.z - mover.z;
    const d = Math.hypot(dx, dz) || 1;
    let gx = t.x - (dx / d) * 0.5, gz = t.z - (dz / d) * 0.5;
    if (!island.isWalkable(gx, gz)) { const c = island.clampWalkable(gx, gz); gx = c.x; gz = c.z; }
    setPhase('chase');
    st.travelT = 0;
    mover.goTo(gx, gz, { run: true, arriveR: 0.1 });
  }

  /** 进入 fetch 时调用 */
  function enter() {
    S.look(stick.position);
    mover.spinRate = 0;
    mover.driveSpeed = -1;
    mover.hold = false;
    dog.setCarrying(false);
    st.attached = false;
    const sState = stick.state;
    if (sState === 'flying' || sState === 'landed') startChaseReact();
    else if (sState === 'carried') startReturn();
    else { setPhase('react'); st.reactDur = rand(0.3, 0.45); mover.clearGoal(); }
  }

  function exit() {
    mover.spinRate = 0;
    mover.driveSpeed = -1;
    mover.face(NaN);
    dog.setCarrying(false);
    S.look(null);
  }

  /** 返回 false 表示 fetch 结束（木棍已收起） */
  function update(dt) {
    const ss = stick.state;
    if (ss === 'hidden') return false;
    st.t += dt;

    // ---- 根据木棍状态校正阶段 ----
    const p = st.phase;
    if ((ss === 'flying' || ss === 'landed') && p !== 'chasereact' && p !== 'chase' && p !== 'waitland' && p !== 'pickup') {
      if (p === 'return') dog.setCarrying(false);
      startChaseReact();
    } else if (ss === 'carried' && p !== 'pickup' && p !== 'return') {
      startReturn();
    } else if (ss === 'returning' && p !== 'drop') {
      dog.setCarrying(false);
      mover.spinRate = 0;
      setPhase('drop');
    } else if (ss === 'held' && (p === 'chasereact' || p === 'chase' || p === 'waitland' || p === 'pickup' || p === 'return' || p === 'drop')) {
      dog.setCarrying(false);
      if (p === 'drop') enterWait();
      else startRush();
    }

    switch (st.phase) {
      case 'react': { // 听到召唤：转头看木棍，随后起身冲向 front
        S.look(stick.position);
        mover.clearGoal();
        const a = Math.atan2(A.front.x - mover.x, A.front.z - mover.z);
        if (!mover.inKennel && Math.hypot(A.front.x - mover.x, A.front.z - mover.z) > 0.5) mover.face(a);
        dog.setAction(st.t < 0.15 && (dog.action === 'sleep' || dog.action === 'lie' || dog.action === 'sit' || dog.action === 'roll') ? dog.action : 'idle');
        if (st.t >= st.reactDur) startRush();
        break;
      }
      case 'rush': {
        st.travelT += dt;
        S.look(stick.position);
        dog.setAction(mover.gait() || 'idle');
        if ((mover.settled && !mover.hasGoal) || st.travelT > 25) enterWait();
        break;
      }
      case 'wait': {
        st.subT += dt;
        if (st.sub === 'face') {
          dog.setAction(mover.gait() || 'idle');
          S.look(stick.position);
          mover.face(A.frontFacing);
          if ((mover.headingError(A.frontFacing) < 0.12 && st.subT > 0.2) || st.subT > 1.5) startSpin();
        } else if (st.sub === 'spin') {
          dog.setAction('spin');
          const remaining = st.spinTotal - st.spinDone;
          const tgtRate = remaining > 1.4 ? SPIN_RATE : Math.max(2.5, (SPIN_RATE * remaining) / 1.4);
          const d = tgtRate - st.spinCur;
          const maxD = 45 * dt;
          st.spinCur += clamp(d, -maxD, maxD);
          const stepA = Math.min(st.spinCur * dt, remaining);
          st.spinDone += stepA;
          if (remaining - stepA <= 0.02) {
            mover.spinRate = 0;
            mover.heading += stepA; // 最后一小段
            st.sub = 'bounce';
            st.subT = 0;
            st.bounceDur = rand(4, 7);
            st.bounceFlip = 0;
            st.bounceAct = 'playbow';
            mover.face(A.frontFacing);
          } else {
            mover.spinRate = stepA / dt;
          }
        } else { // bounce：面向镜头 playbow / spin 小跳交替，目光盯着木棍
          mover.spinRate = 0;
          mover.face(A.frontFacing);
          S.look(stick.position);
          st.bounceFlip -= dt;
          if (st.bounceFlip <= 0) {
            st.bounceAct = st.bounceAct === 'playbow' ? 'spin' : 'playbow';
            st.bounceFlip = rand(0.9, 1.6);
          }
          dog.setAction(st.bounceAct);
          if (st.subT > st.bounceDur) startSpin();
        }
        break;
      }
      case 'chasereact': { // 先转头看，再转身冲出去
        S.look(stick.position);
        dog.setAction('idle');
        const t = stick.target || stick.position;
        mover.face(Math.atan2(t.x - mover.x, t.z - mover.z));
        if (st.t >= st.reactDur) beginApproach();
        break;
      }
      case 'chase': {
        st.travelT += dt;
        S.look(stick.position);
        dog.setAction(mover.gait() || 'idle');
        if (mover.settled || st.travelT > 20) {
          if (stick.state === 'landed') {
            _tp.x = stick.position.x - mover.x; _tp.z = stick.position.z - mover.z;
            const d = Math.hypot(_tp.x, _tp.z);
            if (d > 1.1 && st.retry < 3) { st.retry++; beginApproach(); break; }
            setPhase('pickup');
            st.sub = 'turn';
            st.attached = false;
          } else if (stick.state === 'flying') {
            setPhase('waitland');
          }
        }
        break;
      }
      case 'waitland': {
        S.look(stick.position);
        dog.setAction('idle');
        if (stick.state === 'landed') { st.retry = 0; beginApproach(); }
        break;
      }
      case 'pickup': {
        S.look(stick.position);
        const fa = Math.atan2(stick.position.x - mover.x, stick.position.z - mover.z);
        if (st.sub === 'turn') {
          dog.setAction('idle');
          mover.face(fa);
          if (mover.headingError(fa) < 0.35 || st.t > 1.2) { st.sub = 'act'; st.subT = 0; }
          break;
        }
        st.subT += dt;
        dog.setAction('pickup');
        if (!st.attached && st.subT >= 0.25) {
          if (stick.state === 'landed') stick.attachTo(dog);
          st.attached = true;
          dog.setCarrying(true);
        }
        if (st.attached && st.subT >= 0.3 && (dog.actionDone || st.subT > 2)) {
          if (stick.state === 'landed') stick.attachTo(dog);
          if (stick.state === 'carried') startReturn();
          else startRush();
        }
        break;
      }
      case 'return': {
        st.travelT += dt;
        S.look(null);
        dog.setCarrying(true);
        if (mover.hasGoal || !mover.settled) {
          dog.setAction(mover.gait() || 'idle');
          if (st.travelT > 25) mover.clearGoal();
        } else {
          dog.setAction('idle');
          mover.face(A.frontFacing);
          st.subT += dt;
          if ((mover.headingError(A.frontFacing) < 0.25 && st.subT > 0.1) || st.subT > 2) {
            stick.release();
            dog.setCarrying(false);
            S.stats.drops++;
            setPhase('drop');
          }
        }
        break;
      }
      case 'drop': {
        S.look(stick.position);
        dog.setAction('playbow');
        mover.face(A.frontFacing);
        if (stick.state === 'held' || st.t > 3) enterWait();
        break;
      }
      default:
        startRush();
    }
    return true;
  }

  return { enter, update, exit, get phase() { return st.phase; }, get sub() { return st.sub; } };
}
