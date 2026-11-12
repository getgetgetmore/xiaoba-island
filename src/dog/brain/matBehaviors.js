// 狗垫相关的自主行为：
//  sunbathe  走到狗窝 → 进窝叼起垫子 → 拖到草坪 → 放下 → 转圈趴下晒太阳（偶尔翻身）→ 伸懒腰 → 叼回窝里放好。
//  fetchMat  垫子落在外面又不适合晒太阳（阴天/傍晚）时：走过去叼起拖回窝里放好。
// 打断规则：exit() 时若正叼着垫子，就地平滑放下（垫子绝不瞬移，只有被狗叼着才会动）。
import { clamp, angleDiff } from '../../core/util.js';

export function createMatBehaviors(S) {
  const { mover, dog, island, rand } = S;
  const A = island.anchors;
  const M = S.matCtl;
  const home = island.mat.home;
  const kennelObs = island.obstacles.find((o) => o.name === 'kennel') || { x: -3.6, z: -2.6, r: 1.5 };
  const HAUL_SPEED = 0.62;

  const dropHeld = () => { if (M.carried) M.release(); dog.setCarrying(false); mover.reverse = false; };
  const faceTo = (x, z) => Math.atan2(x - mover.x, z - mover.z);
  /** 窝里咬垫子的站位：在门内、垫子靠门一侧，面朝窝里 */
  function kennelGrabPoint() {
    const p = M.standOff(A.kennelDoor.x, A.kennelDoor.z);
    const full = Math.hypot(A.kennelDoor.x - home.x, A.kennelDoor.z - home.z);
    if (p.dist > full - 0.05) { // 不要退到门外面去
      const k = (full - 0.05) / p.dist;
      p.x = M.x + (p.x - M.x) * k; p.z = M.z + (p.z - M.z) * k;
    }
    return p;
  }

  // ---------- 共同的“叼起 → 拖回窝里放好 → 出窝”子流程 ----------
  const H = { phase: 'pick', t: 0, travelT: 0 };
  function hSet(p) { H.phase = p; H.t = 0; H.travelT = 0; }
  function hStart() {
    // 先站到垫子靠狗窝门的一侧（之后倒退着往窝里拖，垫子跟在面前）
    const p = M.standOff(A.kennelDoor.x, A.kennelDoor.z);
    const c = walkableClamp(p.x, p.z);
    mover.goTo(c.x, c.z, { arriveR: 0.1 });
    hSet('approach');
  }
  /** 返回 true = 全部完成（狗已出窝） */
  function hUpdate(dt) {
    H.t += dt;
    switch (H.phase) {
      case 'approach':
        H.travelT += dt;
        dog.setAction(mover.gait() || 'idle');
        if (mover.settled || H.travelT > 12) { hSet('faceMat'); mover.face(faceTo(M.x, M.z)); }
        break;
      case 'faceMat':
        dog.setAction(mover.gait() || 'idle');
        if ((mover.headingError(faceTo(M.x, M.z)) < 0.15 && H.t > 0.2) || H.t > 2.2) hSet('pick');
        break;
      case 'pick':
        dog.setAction('pickup');
        if (H.t >= 0.25 && !M.carried) { mover.reverse = true; M.grab(); dog.setCarrying(true); }
        if (H.t >= 0.6 && (dog.actionDone || H.t > 1.4)) {
          hSet('haul');
          mover.goTo(A.kennelDoor.x, A.kennelDoor.z, { speed: HAUL_SPEED, arriveR: 0.2 });
        }
        break;
      case 'haul':
        H.travelT += dt;
        dog.setAction(mover.gait() || 'idle');
        if (mover.settled || H.travelT > 45) {
          hSet('haulin');
          mover.goStraight(A.kennelInside.x, A.kennelInside.z, { speed: HAUL_SPEED, arriveR: 0.08 });
        }
        break;
      case 'haulin':
        H.travelT += dt;
        dog.setAction(mover.gait() || 'idle');
        if (mover.settled || H.travelT > 10) {
          mover.inKennel = true;
          M.placeHome();
          dog.setCarrying(false);
          mover.reverse = false;
          mover.face(A.kennelFacing);
          hSet('place');
        }
        break;
      case 'place':
        dog.setAction(mover.headingError(A.kennelFacing) > 0.3 ? mover.gait() || 'idle' : 'idle');
        if (H.t > 1.2 && M.resting) {
          hSet('out');
          mover.goStraight(A.kennelDoor.x, A.kennelDoor.z, { arriveR: 0.12 });
        }
        break;
      default: // out
        H.travelT += dt;
        dog.setAction(mover.gait() || 'idle');
        if ((mover.settled && !mover.inKennel) || H.travelT > 10) { mover.inKennel = false; return true; }
    }
    return false;
  }
  function hExit() { dropHeld(); }

  const walkableClamp = (x, z) => (island.isWalkable(x, z) ? { x, z } : island.clampWalkable(x, z));

  // ---------------------------------------------------------------- 晒太阳
  const sunbathe = (() => {
    const st = { phase: 'goto', t: 0, travelT: 0, dur: 0, total: 0, nextRoll: 0, rollT: 0, step: 0, sign: 1, h1: 0, final: 0, spotX: 0, spotZ: 0, spotYaw: 0 };
    function setPhase(p) { st.phase = p; st.t = 0; }

    // 在草坪/草坪边缘挑一个晒太阳的地点：离狗窝 ≥ 3、离 front ≥ 2、离所有障碍（池塘、瞭望台坡道……）够远
    function pickSpot() {
      const l = A.lawn;
      const lk = A.lookout;
      for (let i = 0; i < 40; i++) {
        const a = rand(0, Math.PI * 2), r = Math.sqrt(rand(0.02, 0.9)) * l.r;
        const x = l.x + Math.sin(a) * r, z = l.z + Math.cos(a) * r;
        if (spotOk(x, z, lk)) { st.spotX = x; st.spotZ = z; return; }
      }
      if (spotOk(A.napSpot.x, A.napSpot.z, lk)) { st.spotX = A.napSpot.x; st.spotZ = A.napSpot.z; return; }
      const c = island.clampWalkable(l.x, l.z);
      st.spotX = c.x; st.spotZ = c.z;
    }
    function spotOk(x, z, lk) {
      if (!island.isWalkable(x, z)) return false;
      if (Math.hypot(x - kennelObs.x, z - kennelObs.z) < 4.4) return false; // 倒退拖行时垫子落在狗的身后（靠狗窝一侧），地点要选远一点
      if (Math.hypot(x - A.front.x, z - A.front.z) < 2) return false;
      for (const o of island.obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + 0.95) return false;
      if (lk) { // 不在坡道及其两端附近
        const bx = lk.base.x - lk.top.x, bz = lk.base.z - lk.top.z, L2 = bx * bx + bz * bz;
        const t = clamp(((x - lk.top.x) * bx + (z - lk.top.z) * bz) / L2, 0, 1);
        if (Math.hypot(x - (lk.top.x + bx * t), z - (lk.top.z + bz * t)) < 1.7) return false;
      }
      return true;
    }

    function startToMat() {
      const c = walkableClamp(M.x, M.z);
      mover.goTo(c.x, c.z, { arriveR: 0.08 });
      st.travelT = 0;
      setPhase('toMat');
    }

    return {
      name: 'sunbathe',
      phase: () => st.phase,
      weight() {
        if (!S.sunOK() || !M.resting) return 0;
        const h = S.env.hour;
        let w = h >= 12.5 && h < 14.5 ? 7 : 3.5;
        if (!M.atHome) w *= 2 + Math.min(4, M.outT / 45); // 垫子已经在外面了：直接去垫子上趴下；放得越久越惦记
        else {
          if (S.age < 20) return 0; // 启动后头 3 分钟先自由活动（长时间行为不抢在短行为前面）
          if (S.age - (this.endedAt === undefined ? -1e9 : this.endedAt) < 240) w *= 0.3; // 刚晒完不久，少选
        }
        return w;
      },
      enter() {
        S.look(null);
        st.total = 0; st.travelT = 0;
        H.phase = 'pick';
        if (M.atHome) {
          if (mover.inKennel) { const g = kennelGrabPoint(); setPhase('inside'); mover.goStraight(g.x, g.z, { arriveR: 0.08 }); }
          else { setPhase('goto'); mover.goTo(A.kennelDoor.x, A.kennelDoor.z, { arriveR: 0.15 }); }
        } else {
          startToMat();
        }
      },
      update(dt) {
        st.t += dt;
        switch (st.phase) {
          case 'goto':
            st.travelT += dt;
            dog.setAction(mover.gait() || 'idle');
            if (mover.settled || st.travelT > 30) {
              setPhase('inside');
              st.travelT = 0;
              { const g = kennelGrabPoint(); mover.goStraight(g.x, g.z, { arriveR: 0.08 }); }
            }
            break;
          case 'inside':
            st.travelT += dt;
            dog.setAction(mover.gait() || 'idle');
            if (mover.settled || st.travelT > 10) { mover.inKennel = true; setPhase('turn'); mover.face(faceTo(M.x, M.z)); }
            break;
          case 'turn': // 面朝窝里的垫子
            dog.setAction(mover.gait() || 'idle');
            if ((mover.headingError(faceTo(M.x, M.z)) < 0.15 && st.t > 0.3) || st.t > 2.5) setPhase('pick');
            break;
          case 'pick':
            dog.setAction('pickup');
            if (st.t >= 0.25 && !M.carried) { mover.reverse = true; M.grab(); dog.setCarrying(true); } // 咬住垫沿，接下来倒退着往外拖
            if (st.t >= 0.6 && (dog.actionDone || st.t > 1.4)) {
              pickSpot();
              setPhase('drag');
              st.travelT = 0;
              mover.goTo(st.spotX, st.spotZ, { speed: rand(0.55, 0.7), arriveR: 0.25 });
            }
            break;
          case 'drag':
            st.travelT += dt;
            dog.setAction(mover.gait() || 'idle');
            if (mover.settled || st.travelT > 50) {
              mover.clearGoal();
              M.release();
              dog.setCarrying(false);
              mover.reverse = false;
              setPhase('drop');
            }
            break;
          case 'drop': // 松口，垫子平滑落平
            dog.setAction('idle');
            if (st.t > 0.7 && M.resting) startToMat();
            break;
          case 'toMat':
            st.travelT += dt;
            dog.setAction(mover.gait() || 'idle');
            if (mover.settled || st.travelT > 30) {
              setPhase('circle');
              st.step = 0;
              st.sign = rand(0, 1) < 0.5 ? 1 : -1;
              st.h1 = mover.heading + st.sign * 2.3;
              mover.face(st.h1); // 先原地转小半圈
            }
            break;
          case 'circle': {
            dog.setAction(mover.gait() || 'idle');
            if (st.step === 0) {
              if ((mover.headingError(st.h1) < 0.25 && st.t > 0.3) || st.t > 1.6) {
                st.step = 1; st.t = 0;
                // 最后朝向：沿垫子长轴（正反两个方向里选离当前朝向近的）
                st.final = Math.abs(angleDiff(mover.heading, M.yaw)) < Math.PI / 2 ? M.yaw : M.yaw + Math.PI;
                mover.face(st.final);
              }
            } else if ((mover.headingError(st.final) < 0.12 && st.t > 0.3) || st.t > 2) {
              setPhase('lie');
              st.total = 0; st.dur = rand(20, 40); st.nextRoll = rand(7, 13);
            }
            break;
          }
          case 'lie':
            st.total += dt;
            dog.setAction(st.t < 0.4 ? 'idle' : 'lie');
            if (st.t > 1.8) setPhase('sleep');
            break;
          case 'sleep':
            st.total += dt;
            dog.setAction('sleep');
            if (st.total > st.dur) setPhase('wake');
            else if (st.total > st.nextRoll && st.total < st.dur - 6) { setPhase('roll'); st.rollT = rand(2, 4); }
            break;
          case 'roll':
            st.total += dt;
            dog.setAction('roll');
            if (st.t > st.rollT) { setPhase('lie2'); st.nextRoll = st.total + rand(10, 18); }
            break;
          case 'lie2':
            st.total += dt;
            dog.setAction('lie');
            if (st.t > 1.3) setPhase('sleep');
            break;
          case 'wake':
            dog.setAction(st.t < 0.8 ? 'lie' : 'playbow');
            if (st.t > 2.4) { setPhase('haul'); hStart(); }
            break;
          case 'haul':
            if (hUpdate(dt)) return true;
            break;
          default:
            return true;
        }
        return false;
      },
      exit() { hExit(); },
    };
  })();

  // ---------------------------------------------------------------- 取回垫子
  const fetchMat = (() => {
    const st = { phase: 'goto', t: 0, travelT: 0 };
    function setPhase(p) { st.phase = p; st.t = 0; }
    return {
      name: 'fetchMat',
      phase: () => st.phase,
      weight() {
        if (!M.resting || M.atHome || S.sleepTime || S.rainHold || S.env.isRaining) return 0;
        return (S.sunOK() ? 1 : 14) * (1 + Math.min(3, M.outT / 60));
      },
      enter() {
        S.look(null);
        const c = walkableClamp(M.x, M.z);
        mover.goTo(c.x, c.z, { arriveR: 0.08 });
        st.travelT = 0;
        setPhase('goto');
      },
      update(dt) {
        st.t += dt;
        if (st.phase === 'goto') {
          st.travelT += dt;
          dog.setAction(mover.gait() || 'idle');
          if (mover.settled || st.travelT > 30) {
            if (M.dist(mover.x, mover.z) > 1.3) return true; // 够不着（被障碍挡住）就算了
            setPhase('haul');
            hStart();
          }
          return false;
        }
        return hUpdate(dt);
      },
      exit() { hExit(); },
    };
  })();

  return { sunbathe, fetchMat };
}
