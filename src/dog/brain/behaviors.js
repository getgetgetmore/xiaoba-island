// 自主行为集合。每个行为：{ name, weight(), enter(), update(dt) → 结束时返回 true, exit() }。
// 所有位置来自 island 契约；动作名只用 DESIGN 3.6 动作表。update 内不分配对象（除 clampWalkable 返回值）。
import { clamp, angleDiff } from '../../core/util.js';

const TWO_PI = Math.PI * 2;

export function createBehaviors(S) {
  const { mover, dog, island, rand, rint } = S;
  const A = island.anchors;

  /** 一段“走到某处”的通用推进。返回 true = 已到达并停稳（或超时） */
  function travelDone(st, dt) {
    st.travelT += dt;
    if (mover.settled || st.travelT > 30) return true;
    dog.setAction(mover.gait() || 'idle');
    return false;
  }
  function startTravel(st, x, z, opts) {
    st.travelT = 0;
    mover.goTo(x, z, opts);
  }
  const walkable = (x, z) => island.isWalkable(x, z);

  // ---------------------------------------------------------------- 撒欢跑圈
  const zoomies = (() => {
    const st = { t: 0, dur: 0, ending: false };
    function pickWp(first) {
      const l = A.lawn, rr = l.r * 0.85;
      let px = 0, pz = 0, ok = false;
      for (let i = 0; i < 6 && !ok; i++) {
        const ang = first || mover.speed < 1 ? rand(0, TWO_PI) : mover.heading + rand(-1.3, 1.3);
        const d = rand(2.5, 4.2);
        px = mover.x + Math.sin(ang) * d;
        pz = mover.z + Math.cos(ang) * d;
        const dx = px - l.x, dz = pz - l.z, r = Math.hypot(dx, dz);
        if (r > rr) { px = l.x + (dx / r) * rr; pz = l.z + (dz / r) * rr; }
        if (!walkable(px, pz)) continue;
        if (Math.hypot(px - mover.x, pz - mover.z) < 1.5) continue;
        const he = Math.abs(angleDiff(mover.heading, Math.atan2(px - mover.x, pz - mover.z)));
        if (!first && mover.speed > 1 && he > 1.7 && i < 5) continue;
        ok = true;
      }
      if (!ok) {
        const a = rand(0, TWO_PI), r = rand(0.2, 0.7) * l.r;
        px = l.x + Math.sin(a) * r;
        pz = l.z + Math.cos(a) * r;
      }
      mover.goTo(px, pz, { run: true, through: true, arriveR: 0.7 });
    }
    return {
      name: 'zoomies',
      weight: () => (S.env.weather === 'clear' ? 3 : S.env.weather === 'cloudy' ? 0.5 : 0) * (S.evening ? 0.3 : 1) * (1 - 0.85 * S.exertion) * S.energy * S.energy, // 跑累了就不想再疯跑；精力足（清晨、傍晚）才撒欢
      enter() { st.t = 0; st.dur = rand(7, 13); st.ending = false; S.look(null); pickWp(true); },
      update(dt) {
        st.t += dt;
        if (!st.ending && st.t > st.dur) { st.ending = true; mover.clearGoal(); }
        if (st.ending) {
          dog.setAction(mover.gait() || 'idle');
          return mover.settled;
        }
        if (!mover.hasGoal) pickWp(false);
        dog.setAction(mover.gait() || 'idle');
        return false;
      },
    };
  })();

  // ---------------------------------------------------------------- 打滚
  const roll = (() => {
    const st = { phase: 0, t: 0, travelT: 0, rollDur: 0 };
    return {
      name: 'roll',
      weight: () => (S.env.weather === 'clear' ? 4.5 : S.env.weather === 'cloudy' ? 0.5 : 0) * (S.evening ? 0.3 : 1) * (0.25 + 0.75 * S.energy),
      enter() {
        st.phase = 0; st.t = 0; st.rollDur = rand(3.5, 6);
        S.look(null);
        const l = A.lawn;
        const a = rand(0, TWO_PI), r = rand(0.15, 0.6) * l.r;
        let x = l.x + Math.sin(a) * r, z = l.z + Math.cos(a) * r;
        if (!walkable(x, z)) { x = l.x; z = l.z; }
        startTravel(st, x, z, { run: rand(0, 1) < 0.4, arriveR: 0.15 });
      },
      update(dt) {
        if (st.phase === 0) {
          if (travelDone(st, dt)) { st.phase = 1; st.t = 0; }
          return false;
        }
        st.t += dt;
        if (st.phase === 1) { // 停稳后先站一下再躺下
          dog.setAction('idle');
          if (st.t > 0.6) { st.phase = 2; st.t = 0; }
        } else if (st.phase === 2) {
          dog.setAction('roll');
          if (st.t > st.rollDur) { st.phase = 3; st.t = 0; }
        } else {
          dog.setAction('idle');
          if (st.t > 0.9) return true;
        }
        return false;
      },
    };
  })();

  // ---------------------------------------------------------------- 追蝴蝶
  const chase = (() => {
    const st = {
      phase: 'pick', t: 0, count: 0, max: 2, tgt: null, retarget: 0, bowT: 0, bowDur: 0,
      pt: 0, D: 1.2, startled: false, travelT: 0, watchT: 0, restT: 0,
    };
    const valid = (t) => t && t.active && t.chaseable && walkable(t.position.x, t.position.z);
    function setPhase(p) { st.phase = p; st.t = 0; }
    return {
      name: 'chase',
      weight: () => (S.pickChaseTarget() ? (S.env.weather === 'clear' ? 5 : 1.5) : 0) * (1 - 0.5 * S.exertion) * Math.min(1.3, 0.12 + 0.88 * S.energy * S.energy),
      enter() { st.count = 0; st.max = rint(2, 3); st.tgt = null; S.look(null); setPhase('pick'); },
      update(dt) {
        st.t += dt;
        const tgt = st.tgt;
        if (tgt) tgt.stalked = true; // 告诉昆虫模块：这只正被狗盯着追，别在狗冲过来的路上就自己吓跑（要等狗扑上去）
        switch (st.phase) {
          case 'pick': {
            st.tgt = S.pickChaseTarget();
            if (!st.tgt) { setPhase('rest'); st.restT = rand(1.8, 3); break; }
            st.retarget = 0;
            setPhase('approach');
            break;
          }
          case 'approach': {
            if (!valid(tgt) || st.t > 14) { setPhase('lost'); mover.clearGoal(); break; }
            S.look(tgt.position);
            const dx = tgt.position.x - mover.x, dz = tgt.position.z - mover.z;
            const d = Math.hypot(dx, dz);
            st.retarget -= dt;
            if (st.retarget <= 0 && d > 1.5) {
              st.retarget = 0.15;
              const ux = dx / d, uz = dz / d;
              let gx = tgt.position.x - ux * 1.45, gz = tgt.position.z - uz * 1.45;
              if (!walkable(gx, gz)) { const c = island.clampWalkable(gx, gz); gx = c.x; gz = c.z; }
              mover.goTo(gx, gz, { run: true, arriveR: 0.1 });
            }
            dog.setAction(mover.gait() || 'idle');
            if ((!mover.hasGoal && d < 2.6) || (d < 1.9 && mover.speed < 0.6)) {
              mover.clearGoal();
              setPhase('bow');
              st.bowT = 0;
              st.bowDur = rand(0.6, 1.0);
            }
            break;
          }
          case 'bow': {
            if (!valid(tgt) || st.t > 6) { setPhase('lost'); break; }
            S.look(tgt.position);
            const dx = tgt.position.x - mover.x, dz = tgt.position.z - mover.z;
            const d = Math.hypot(dx, dz);
            if (d > 3.4) { setPhase('approach'); st.retarget = 0; break; }
            const ang = Math.atan2(dx, dz);
            mover.face(ang);
            if (!mover.settled) { dog.setAction(mover.gait() || 'idle'); break; }
            dog.setAction('playbow');
            st.bowT += dt;
            if (st.bowT >= st.bowDur && mover.headingError(ang) < 0.3) {
              st.D = clamp(d - 0.3, 1.0, 1.4);
              st.pt = 0;
              st.startled = false;
              setPhase('pounce');
              dog.setAction('pounce');
            }
            break;
          }
          case 'pounce': {
            st.pt += dt;
            S.look(tgt ? tgt.position : null);
            const T = 0.62;
            dog.setAction('pounce');
            mover.driveSpeed = st.pt < T ? ((st.D * Math.PI) / (2 * T)) * Math.sin((Math.PI * st.pt) / T) : 0;
            if (!st.startled && st.pt >= 0.4) {
              st.startled = true;
              if (S.critters && tgt) S.critters.startle(tgt.id);
              S.stats.startles++;
            }
            if (st.pt >= T) mover.driveSpeed = -1;
            if (st.pt >= 0.3 && (dog.actionDone || st.pt > 2) && st.pt >= 0.7) {
              mover.driveSpeed = -1;
              mover.speed = 0;
              st.count++;
              setPhase('watch');
              st.watchT = rand(1.6, 2.4);
            }
            break;
          }
          case 'watch': {
            dog.setAction('idle');
            S.look(tgt ? tgt.position : null);
            if (st.t > st.watchT) setPhase(st.count >= st.max ? 'rest' : 'pick');
            if (st.phase === 'rest') st.restT = rand(2, 3);
            break;
          }
          case 'lost': {
            dog.setAction(mover.gait() || 'idle');
            if (st.t > 1) {
              st.count++;
              setPhase(st.count >= st.max ? 'rest' : 'pick');
              if (st.phase === 'rest') st.restT = rand(2, 3);
            }
            break;
          }
          default: { // rest
            S.look(null);
            dog.setAction(st.t < 0.4 ? 'idle' : 'sit');
            if (st.t > st.restT) return true;
          }
        }
        return false;
      },
      exit() { mover.driveSpeed = -1; S.look(null); },
    };
  })();

  // ---------------------------------------------------------------- 闻花 / 闻树根
  const sniff = (() => {
    const st = { phase: 0, t: 0, total: 0, dur: 0, sd: 0, travelT: 0, last: -1 };
    function nextSpot() {
      const spots = A.sniffSpots;
      for (let i = 0; i < 8; i++) {
        const k = rint(0, spots.length - 1);
        const p = spots[k];
        if (k === st.last || Math.hypot(p.x - mover.x, p.z - mover.z) < 0.8) continue;
        st.last = k;
        startTravel(st, p.x, p.z, { arriveR: 0.12 });
        return;
      }
      const p = spots[0];
      startTravel(st, p.x, p.z, { arriveR: 0.12 });
    }
    return {
      name: 'sniff',
      weight: () => (S.env.weather === 'cloudy' ? 3.5 : 3) * (0.45 + 0.55 * Math.min(1, S.energy)), // 中午犯困、晚上要睡了：少溜达
      enter() { st.phase = 0; st.total = 0; st.dur = rand(8, 16); st.last = -1; S.look(null); nextSpot(); },
      update(dt) {
        st.total += dt;
        st.t += dt;
        if (st.phase === 0) {
          if (travelDone(st, dt)) { st.phase = 1; st.t = 0; st.sd = rand(3, 5.5); }
        } else {
          dog.setAction(st.t < 0.35 ? 'idle' : 'sniff');
          if (st.t > st.sd) {
            if (st.total < st.dur - 3 && rand(0, 1) < 0.6) { st.phase = 0; nextSpot(); }
            else return true;
          }
        }
        return false;
      },
    };
  })();

  // ---------------------------------------------------------------- 闲逛
  const wander = (() => {
    const st = { phase: 0, t: 0, total: 0, dur: 0, pause: 0, travelT: 0 };
    function nextPoint() {
      let x = mover.x, z = mover.z, ok = false;
      for (let i = 0; i < 8 && !ok; i++) {
        const a = rand(0, TWO_PI), d = rand(2.5, 6);
        x = mover.x + Math.sin(a) * d;
        z = mover.z + Math.cos(a) * d;
        ok = walkable(x, z) && Math.hypot(x, z) < island.radius - 1.2;
      }
      if (!ok) { const c = island.clampWalkable(A.lawn.x, A.lawn.z); x = c.x; z = c.z; }
      startTravel(st, x, z, { arriveR: 0.2 });
    }
    return {
      name: 'wander',
      weight: () => 3 * (0.45 + 0.55 * Math.min(1, S.energy)),
      enter() { st.phase = 0; st.total = 0; st.dur = rand(8, 18); S.look(null); nextPoint(); },
      update(dt) {
        st.total += dt;
        if (st.phase === 0) {
          if (travelDone(st, dt)) { st.phase = 1; st.t = 0; st.pause = rand(1, 2.5); }
        } else {
          st.t += dt;
          dog.setAction('idle');
          S.lookAround(dt);
          if (st.t > st.pause) {
            if (st.total > st.dur) return true;
            st.phase = 0; nextPoint();
          }
        }
        return false;
      },
      exit() { S.look(null); },
    };
  })();

  // ---------------------------------------------------------------- 坐着张望
  const sit = (() => {
    const st = { phase: 0, t: 0, dur: 0, face: 0, lookT: 0 };
    return {
      name: 'sit',
      weight: () => (S.env.weather === 'cloudy' ? 3 : 2) * (1 + 2 * S.exertion) * (1.8 - 0.8 * Math.min(1, S.energy)), // 累了、精力低的时段多坐着歇会儿
      enter() {
        st.phase = 0; st.t = 0; st.dur = rand(8, 16);
        st.face = A.frontFacing + rand(-0.9, 0.9);
        mover.face(st.face);
        S.look(null);
      },
      update(dt) {
        st.t += dt;
        if (st.phase === 0) {
          dog.setAction(mover.gait() || 'idle');
          if ((mover.headingError(st.face) < 0.15 && mover.settled && st.t > 0.4) || st.t > 2) { st.phase = 1; st.t = 0; }
        } else {
          dog.setAction('sit');
          const b = S.nearestCritter('butterfly');
          if (b) S.look(b.position);
          else S.lookAround(dt);
          if (st.t > st.dur) return true;
        }
        return false;
      },
      exit() { S.look(null); },
    };
  })();

  // ---------------------------------------------------------------- 午后打盹
  const nap = (() => {
    const st = { phase: 0, t: 0, travelT: 0, dur: 0 };
    return {
      name: 'nap',
      // 垫子在窝里、可以拖出去晒太阳时，由 sunbathe 取代大部分打盹
      weight: () => (S.env.hour >= 12.25 && S.env.hour < 14.75 && S.env.weather !== 'storm' ? (S.matCtl && S.matCtl.atHome && S.sunOK() && S.age >= 20 ? 5 : 10) : 0),
      enter() {
        st.phase = 0; st.t = 0; st.dur = rand(35, 70); // 午觉睡得久一点
        S.look(null);
        startTravel(st, A.napSpot.x, A.napSpot.z, { arriveR: 0.15 });
      },
      update(dt) {
        if (st.phase === 0) {
          if (travelDone(st, dt)) { st.phase = 1; st.t = 0; }
          return false;
        }
        st.t += dt;
        if (st.phase === 1) {
          dog.setAction(st.t < 0.5 ? 'idle' : 'lie');
          if (st.t > 1.6) { st.phase = 2; st.t = 0; }
        } else if (st.phase === 2) {
          dog.setAction('sleep');
          if (st.t > st.dur) { st.phase = 3; st.t = 0; }
        } else {
          dog.setAction('lie');
          if (st.t > 1.0) return true;
        }
        return false;
      },
    };
  })();

  // ---------------------------------------------------------------- 池塘喝水
  const drink = (() => {
    const st = { phase: 0, t: 0, travelT: 0, dd: 0, face: 0 };
    return {
      name: 'drink',
      weight: () => (S.env.weather === 'cloudy' ? 1 : 1.5) * (1 + 6 * S.exertion) + 30 * S.thirst, // 跑累了口渴，去池塘喝水；刚吃完饭 / 刚睡醒也要喝
      enter() {
        S.thirst = 0;
        st.phase = 0; st.t = 0; st.dd = rand(4.5, 8);
        S.look(null);
        startTravel(st, A.pondDrink.x, A.pondDrink.z, { arriveR: 0.12 });
      },
      update(dt) {
        if (st.phase === 0) {
          if (travelDone(st, dt)) {
            st.phase = 1; st.t = 0;
            st.face = Math.atan2(A.pond.x - mover.x, A.pond.z - mover.z);
            mover.face(st.face);
          }
          return false;
        }
        st.t += dt;
        if (st.phase === 1) {
          dog.setAction('idle');
          if ((mover.headingError(st.face) < 0.15 && st.t > 0.4) || st.t > 2) { st.phase = 2; st.t = 0; }
        } else {
          dog.setAction('drink');
          if (st.t > st.dd) return true;
        }
        return false;
      },
    };
  })();

  // ---------------------------------------------------------------- 看晚霞
  const sunset = (() => {
    const st = { phase: 0, t: 0, travelT: 0, dur: 0 };
    return {
      name: 'sunset',
      repeatable: true,
      weight: () => (S.env.sunsetFactor > 0.5 && !S.env.isRaining ? 24 : 0),
      enter() {
        st.phase = 0; st.t = 0; st.dur = rand(18, 30);
        S.look(null);
        startTravel(st, A.sunsetSpot.x, A.sunsetSpot.z, { arriveR: 0.12 });
      },
      update(dt) {
        if (st.phase === 0) {
          if (travelDone(st, dt)) { st.phase = 1; st.t = 0; mover.face(A.sunsetFacing); }
          return false;
        }
        st.t += dt;
        if (st.phase === 1) {
          dog.setAction('idle');
          if ((mover.headingError(A.sunsetFacing) < 0.15 && st.t > 0.4) || st.t > 2.5) { st.phase = 2; st.t = 0; }
        } else {
          dog.setAction('sit');
          if (st.t > st.dur || S.env.sunsetFactor < 0.2) return true;
        }
        return false;
      },
    };
  })();

  // ---------------------------------------------------------------- 傍晚窝门口看萤火虫
  const evening = (() => {
    const st = { phase: 0, t: 0, travelT: 0, dur: 0, pose: 'lie', lookT: 0 };
    return {
      name: 'evening',
      repeatable: true,
      weight: () => (S.evening && !S.env.isRaining ? 16 : 0),
      enter() {
        st.phase = 0; st.t = 0; st.dur = rand(14, 28); st.pose = rand(0, 1) < 0.5 ? 'lie' : 'sit';
        S.look(null);
        startTravel(st, A.kennelDoor.x, A.kennelDoor.z, { arriveR: 0.15 });
      },
      update(dt) {
        if (st.phase === 0) {
          if (travelDone(st, dt)) { st.phase = 1; st.t = 0; mover.face(A.kennelFacing); }
          return false;
        }
        st.t += dt;
        if (st.phase === 1) {
          dog.setAction('idle');
          if ((mover.headingError(A.kennelFacing) < 0.15 && st.t > 0.4) || st.t > 2.5) { st.phase = 2; st.t = 0; }
        } else {
          dog.setAction(st.t < 0.5 ? 'idle' : st.pose);
          const f = S.nearestCritter('firefly');
          if (f) S.look(f.position);
          else S.lookAround(dt);
          if (st.t > st.dur) return true;
        }
        return false;
      },
      exit() { S.look(null); },
    };
  })();

  // ---------------------------------------------------------------- 起床：出窝，伸个懒腰，抖抖毛，四下看看
  const wake = (() => {
    const st = { phase: 0, t: 0, travelT: 0 };
    return {
      name: 'wake',
      weight: () => (S.justWoke ? 600 : 0),
      enter() {
        S.justWoke = false;
        st.phase = 0; st.t = 0;
        S.look(null);
        startTravel(st, A.kennelDoor.x, A.kennelDoor.z, { arriveR: 0.15 });
      },
      update(dt) {
        if (st.phase === 0) {
          if (travelDone(st, dt)) { st.phase = 1; st.t = 0; mover.face(A.kennelFacing); }
          return false;
        }
        st.t += dt;
        if (st.phase === 1) {
          dog.setAction('idle');
          if ((mover.headingError(A.kennelFacing) < 0.2 && st.t > 0.3) || st.t > 2) { st.phase = 2; st.t = 0; }
        } else if (st.phase === 2) {
          dog.setAction('playbow'); // 前腿趴低、屁股撅高：伸懒腰
          if (st.t > 2.0) { st.phase = 3; st.t = 0; }
        } else if (st.phase === 3) {
          dog.setAction('shake');
          if (st.t > 1.3) { st.phase = 4; st.t = 0; }
        } else {
          dog.setAction('sit');
          S.lookAround(dt);
          if (st.t > 2.6) return true;
        }
        return false;
      },
      exit() { S.look(null); },
    };
  })();

  // ---------------------------------------------------------------- 吃饭：饭点到了，小跑到碗边，埋头吃完
  const eat = (() => {
    const st = { phase: 0, t: 0, travelT: 0, dur: 0, face: 0 };
    const stand = A.bowlStand, bowlPos = A.bowl;
    return {
      name: 'eat',
      repeatable: true,
      weight: () => (S.mealDue && stand && !S.rainHold ? 80 : 0),
      enter() {
        st.phase = 0; st.t = 0; st.dur = rand(8.5, 10.5);
        S.look(bowlPos);
        startTravel(st, stand.x, stand.z, { speed: 2.2, arriveR: 0.1 });
      },
      update(dt) {
        if (!S.mealDue && st.phase < 3) return true; // 饭点过了
        if (st.phase === 0) {
          if (travelDone(st, dt)) { st.phase = 1; st.t = 0; st.face = Math.atan2(bowlPos.x - mover.x, bowlPos.z - mover.z); mover.face(st.face); }
          return false;
        }
        st.t += dt;
        if (st.phase === 1) {
          dog.setAction('idle');
          if ((mover.headingError(st.face) < 0.15 && st.t > 0.3) || st.t > 2) { st.phase = 2; st.t = 0; S.look(null); }
        } else if (st.phase === 2) {
          // 埋头吃，中间抬头舔舔嘴歇两次；碗里的狗粮随着减少
          const u = st.t / st.dur, pause = (u > 0.36 && u < 0.43) || (u > 0.7 && u < 0.76);
          dog.setAction(pause ? 'idle' : 'drink');
          if (island.bowl) island.bowl.setLevel(1 - u);
          if (st.t > st.dur) { st.phase = 3; st.t = 0; S.markAte(); S.thirst = 1; if (island.bowl) island.bowl.setLevel(0); }
        } else {
          dog.setAction('sit');
          dog.bliss = st.t < 1.6 ? 0.9 : 0; // 吃饱了，眯眼
          if (st.t > 2.0) return true;
        }
        return false;
      },
      exit() { dog.bliss = 0; S.look(null); },
    };
  })();

  // ---------------------------------------------------------------- 狗窝（避雨 / 睡觉）
  const kennel = (() => {
    const st = { phase: 'goto', t: 0, travelT: 0, wet: false, slept: false, lookT: 0, look: null, rescue: false };
    function setPhase(p) { st.phase = p; st.t = 0; }
    function sleepy() { return S.sleepTime; }
    return {
      name: 'kennel',
      repeatable: true,
      phase: () => st.phase,
      weight: () => 0,
      enter() {
        st.wet = S.rainHold;
        st.slept = false;
        S.look(null);
        mover.hold = false;
        const M = S.matCtl;
        // 抢救垫子：下雨时垫子在外面且离狗不远，先跑去叼上再跑回窝
        st.rescue = !!(M && S.rainHold && !S.sleepTime && M.resting && !M.atHome && M.dist(mover.x, mover.z) < 6 && !mover.inKennel);
        const ki = A.kennelInside;
        if (mover.inKennel && Math.hypot(mover.x - ki.x, mover.z - ki.z) > 0.3) {
          // 还在窝门口的脚本化路段上（比如叼着垫子出窝时被打断）：先走回窝里
          setPhase('inside');
          mover.goStraight(ki.x, ki.z, { arriveR: 0.08, run: S.rainHold });
          st.travelT = 0;
        } else if (mover.inKennel) { setPhase('rest'); st.wet = false; st.t = 0; }
        else if (st.rescue) {
          setPhase('rescueGo');
          const c = island.isWalkable(M.x, M.z) ? { x: M.x, z: M.z } : island.clampWalkable(M.x, M.z);
          startTravel(st, c.x, c.z, { run: true, arriveR: 0.1 });
        } else {
          setPhase('goto');
          startTravel(st, A.kennelDoor.x, A.kennelDoor.z, { run: S.rainHold, arriveR: 0.15 });
        }
      },
      update(dt) {
        st.t += dt;
        switch (st.phase) {
          case 'rescueGo':
            if (!S.needKennel()) { mover.clearGoal(); return true; }
            if (travelDone(st, dt)) setPhase('rescuePick');
            break;
          case 'rescuePick': {
            const M = S.matCtl;
            dog.setAction('pickup');
            if (st.t >= 0.25 && !M.carried) { M.grab(); dog.setCarrying(true); }
            if (st.t >= 0.6 && (dog.actionDone || st.t > 1.4)) {
              setPhase('goto');
              startTravel(st, A.kennelDoor.x, A.kennelDoor.z, { run: true, arriveR: 0.15 });
            }
            break;
          }
          case 'goto':
            if (!S.needKennel()) { mover.clearGoal(); return true; }
            if (travelDone(st, dt)) {
              setPhase('inside');
              mover.goStraight(A.kennelInside.x, A.kennelInside.z, { arriveR: 0.08, speed: S.rainHold ? 2.0 : 0 }); // 下着雨：小跑着钻进窝，不是慢慢踱进去
              st.travelT = 0;
            }
            break;
          case 'inside':
            st.travelT += dt;
            dog.setAction(mover.gait() || 'idle');
            if (mover.settled || st.travelT > 10) {
              mover.inKennel = true; setPhase('turn'); mover.face(A.kennelFacing);
              if (S.matCtl && S.matCtl.carried) { S.matCtl.placeHome(); dog.setCarrying(false); }
            }
            break;
          case 'turn':
            dog.setAction('idle');
            if ((mover.headingError(A.kennelFacing) < 0.12 && st.t > 0.3) || st.t > 2.5) setPhase(st.wet ? 'shake' : 'rest');
            break;
          case 'shake':
            dog.setAction('shake');
            if (st.t >= 0.25 && (dog.actionDone || st.t > 2)) setPhase('rest');
            break;
          case 'rest': {
            mover.face(A.kennelFacing);
            const sl = sleepy();
            if (sl) {
              dog.setAction(st.t < 1.2 ? 'lie' : 'sleep');
              if (st.t >= 1.2) { st.slept = true; S.look(null); }
            } else {
              dog.setAction('lie');
              st.lookT -= dt;
              if (st.lookT <= 0) { // 看雨：目光在窝外随机移动
                st.lookT = rand(2.5, 5.5);
                const a = A.kennelFacing + rand(-0.9, 0.9);
                S.lookV.set(mover.x + Math.sin(a) * 3, dog.group.position.y + rand(0.3, 1.6), mover.z + Math.cos(a) * 3);
                S.look(rand(0, 1) < 0.2 ? null : S.lookV);
              }
            }
            if (!S.needKennel()) { setPhase('wake'); S.look(null); }
            break;
          }
          case 'wake':
            dog.setAction(st.t < 0.2 ? 'lie' : 'idle');
            if (st.t > 0.9) {
              setPhase('out');
              mover.goStraight(A.kennelDoor.x, A.kennelDoor.z, { arriveR: 0.12 });
              st.travelT = 0;
            }
            break;
          case 'out':
            st.travelT += dt;
            dog.setAction(mover.gait() || 'idle');
            if ((mover.settled && !mover.inKennel) || st.travelT > 10) {
              mover.inKennel = false;
              setPhase(st.slept ? 'stretch' : 'done');
              mover.face(A.kennelFacing);
            }
            break;
          case 'stretch': // 清晨出窝先伸个懒腰
            dog.setAction(st.t < 0.3 ? 'idle' : 'playbow');
            if (st.t > 2.0) return true;
            break;
          default:
            return true;
        }
        return false;
      },
      exit() {
        S.look(null);
        if (S.matCtl && S.matCtl.carried) { S.matCtl.release(); dog.setCarrying(false); }
      },
    };
  })();

  return { zoomies, roll, chase, sniff, wander, sit, nap, drink, sunset, evening, kennel, wake, eat };
}
