// 自主行为 lookout：走到瞭望台坡道底端 → 沿坡道中线（脚本化路段，忽略障碍/walkable）走上平台 → 转向眺望方向 →
// 坐着 / 站着交替眺望，目光缓慢扫视 → 转身沿原路走下坡道 → 回到 base 后恢复正常寻路。
// 任何时候被打断（避雨、木棍召唤……）都由 mover.onRamp 机制先沿坡道走回 base，再继续。
import { angleDiff } from '../../core/util.js';

const CLIMB_SPEED = 0.85, DESCEND_SPEED = 0.8;
const GRACE = 20; // 启动后先自由活动一小会儿（原先是 185 秒，用户要等 3 分钟才看得到新行为，太久）

export function createLookout(S) {
  const { mover, dog, island, rand } = S;
  const LK = island.anchors.lookout;
  const st = {
    phase: 'goto', t: 0, travelT: 0, dur: 0, total: 0, view: 0, viewFace: 0,
    sitting: true, segT: 0, lookT: 0, lookStep: 0, sunset: false,
  };
  function setPhase(p) { st.phase = p; st.t = 0; }

  function pickView() {
    const faces = LK.viewFacings;
    st.sunset = S.env.sunsetFactor > 0.4;
    let best = 0;
    if (st.sunset) { // 晚霞：优先朝西（-π/2）
      let bd = 1e9;
      for (let i = 0; i < faces.length; i++) {
        const d = Math.abs(angleDiff(faces[i], -Math.PI / 2));
        if (d < bd) { bd = d; best = i; }
      }
    } else {
      best = Math.min(faces.length - 1, Math.floor(rand(0, faces.length)));
    }
    st.view = best;
    st.viewFace = faces[best];
  }

  // 目光缓慢扫视：左 → 右 → 远方（略仰），每隔几秒换一处
  function sweep(dt) {
    st.lookT -= dt;
    if (st.lookT > 0) return;
    st.lookT = rand(2.4, 4.2);
    const k = st.lookStep++ % 3;
    const a = mover.heading + (k === 0 ? rand(0.5, 1.0) : k === 1 ? -rand(0.5, 1.0) : rand(-0.2, 0.2));
    const far = k === 2 ? 14 : 8;
    S.lookV.set(mover.x + Math.sin(a) * far, dog.group.position.y + (k === 2 ? 1.6 : rand(0.4, 1.0)), mover.z + Math.cos(a) * far);
    dog.lookAt(S.lookV);
  }

  return {
    name: 'lookout',
    phase: () => st.phase,
    weight() {
      const e = S.env;
      if (S.rainHold || S.sleepTime || e.isRaining || e.rain > 0.05) return 0;
      let w = e.weather === 'clear' ? 3 : e.weather === 'cloudy' ? 2 : 0;
      if (S.age < GRACE) return 0; // 启动后头 3 分钟先自由活动（长时间行为不抢在短行为前面）
      if (S.age - (this.endedAt === undefined ? -1e9 : this.endedAt) < 90) w *= 0.4; // 刚下来不久，少选
      return w;
    },
    enter() {
      st.total = 0; st.dur = rand(12, 24); st.travelT = 0; st.lookT = 0; st.lookStep = 0;
      S.look(null);
      pickView();
      setPhase('goto');
      mover.goTo(LK.base.x, LK.base.z, { arriveR: 0.12 });
    },
    update(dt) {
      st.t += dt;
      switch (st.phase) {
        case 'goto':
          st.travelT += dt;
          dog.setAction(mover.gait() || 'idle');
          if (mover.settled || st.travelT > 30) { setPhase('align'); mover.face(LK.rampFacing); }
          break;
        case 'align':
          dog.setAction(mover.gait() || 'idle');
          if ((mover.headingError(LK.rampFacing) < 0.12 && st.t > 0.3) || st.t > 2.5) {
            setPhase('climb');
            mover.goStraight(LK.top.x, LK.top.z, { speed: CLIMB_SPEED, arriveR: 0.08, ramp: true });
            st.travelT = 0;
          }
          break;
        case 'climb':
          st.travelT += dt;
          dog.setAction(mover.gait() || 'idle');
          if (mover.settled || st.travelT > 14) { setPhase('turn'); mover.face(st.viewFace); }
          break;
        case 'turn':
          dog.setAction(mover.gait() || 'idle');
          if ((mover.headingError(st.viewFace) < 0.1 && mover.settled && st.t > 0.4) || st.t > 3) {
            setPhase('watch');
            st.sitting = true; st.segT = rand(3, 5);
          }
          break;
        case 'watch': {
          st.total += dt;
          st.segT -= dt;
          mover.face(st.viewFace);
          dog.setAction(st.sitting ? 'sit' : 'idle');
          sweep(dt);
          if (st.segT <= 0) { // 坐 / 站交替（晚霞时多半坐着）
            st.sitting = !st.sitting;
            st.segT = st.sitting ? rand(4, 8) : rand(2, 4);
            if (st.sunset && !st.sitting && rand(0, 1) < 0.6) { st.sitting = true; st.segT = rand(4, 7); }
          }
          if (st.total > st.dur) { setPhase('stand'); S.look(null); }
          break;
        }
        case 'stand': // 站起来，再转身下坡
          dog.setAction('idle');
          if (st.t > 0.7) {
            setPhase('descend');
            mover.goStraight(LK.base.x, LK.base.z, { speed: DESCEND_SPEED, arriveR: 0.1, ramp: false });
            st.travelT = 0;
          }
          break;
        case 'descend':
          st.travelT += dt;
          dog.setAction(mover.gait() || 'idle');
          if ((mover.settled && !mover.onRamp) || st.travelT > 20) { mover.onRamp = false; return true; }
          break;
        default:
          return true;
      }
      return false;
    },
    exit() { mover.face(NaN); S.look(null); },
  };
}
