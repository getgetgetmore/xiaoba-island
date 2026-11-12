// 被摸摸时的小狗：停下手头的事，凑过来享受；每隔几秒随机换一种反应。鼠标离开后回到自主行为。
// 输入来自 ctx.petInput（interaction/petting.js；无头测试里可以直接构造这个对象）。
//
// 反应：
//   wait   小手刚搭上来、还没开始摸：停住等着（不算一种“反应”）
//   enjoy  坐下，仰起头眯着眼享受
//   wag    站着摇尾巴，兴奋地小碎步蹦两下，盯着手看
//   belly  翻肚皮，四脚朝天扭来扭去
//   shift  挪一挪身子，换个角度趴下来让你摸
//   lean   坐着把头歪向手的方向蹭
import * as THREE from 'three';

export function createPetMode(S) {
  const { mover, dog, rand } = S;
  const REACTIONS = ['enjoy', 'wag', 'belly', 'shift', 'lean'];
  const st = { name: 'greet', t: 0, dur: 1, last: '', face: 0, camFace: 0, turned: false, count: 0 };
  const up = new THREE.Vector3();

  /** 从小狗指向镜头的朝向 */
  function camHeading() {
    const cam = S.ctx.camera;
    return cam ? Math.atan2(cam.position.x - mover.x, cam.position.z - mover.z) : mover.heading;
  }

  function pick() {
    let n = st.name;
    for (let i = 0; i < 6 && (n === st.name || n === st.last); i++) n = REACTIONS[Math.floor(rand(0, REACTIONS.length - 0.001))];
    start(n);
  }
  function start(n) {
    st.last = st.name;
    st.name = n; st.t = 0; st.turned = false; st.count++;
    st.dur = n === 'belly' ? rand(3.5, 5.5) : n === 'wag' ? rand(2.5, 4) : rand(3.2, 5.6);
    if (n === 'shift') st.face = camHeading() + (rand(0, 1) < 0.5 ? 1 : -1) * rand(0.9, 1.5); // 侧过身来
    else if (n === 'enjoy' || n === 'lean' || n === 'wag') { st.camFace = camHeading() + rand(-0.5, 0.5); mover.face(st.camFace); }
  }

  /** 看向手：point 为 null 时看正前方 */
  function lookHand(lift) {
    const pi = S.ctx.petInput;
    if (!pi || !pi.point) { S.look(null); return; }
    up.copy(pi.point); up.y += lift;
    S.look(up);
  }

  return {
    get reaction() { return st.name; },
    get count() { return st.count; },
    enter() {
      mover.clearGoal();
      mover.driveSpeed = -1;
      mover.hold = false;
      st.name = 'wait'; st.last = ''; st.t = 0; st.dur = rand(0.7, 1.1); st.count = 0;
      // 转过来面向镜头（略偏一点），这样能看到它享受的表情
      st.camFace = camHeading() + rand(-0.45, 0.45);
      mover.face(st.camFace);
    },
    update(dt) {
      st.t += dt;
      // 小手搭上来了但还没开始摸：停住，站着（等久了就坐下），看着手，尾巴轻轻摇，等着被摸
      const pi0 = S.ctx.petInput;
      if (!(pi0 && pi0.active)) {
        if (st.name !== 'wait') { st.name = 'wait'; st.t = 0; }
        dog.bliss = 0.3;
        dog.setAction(mover.gait() || (st.t > 2.2 ? 'sit' : 'idle'));
        lookHand(0.1);
        return;
      }
      if (st.name === 'wait') { st.name = 'greet'; st.t = 0; st.dur = rand(0.4, 0.8); }
      dog.bliss = 1;
      switch (st.name) {
        case 'greet': // 先停下来，扭头看看是谁在摸
          dog.setAction(mover.gait() || 'idle');
          lookHand(0.1);
          break;
        case 'enjoy':
          dog.setAction(mover.headingError(st.camFace) > 0.35 && st.t < 1.5 ? mover.gait() || 'idle' : 'sit');
          lookHand(0.9); // 仰起头
          break;
        case 'wag':
          dog.setAction(st.t < 1.1 ? 'spin' : 'idle'); // 先兴奋地蹦两下，再站着猛摇尾巴
          lookHand(0.15);
          break;
        case 'belly':
          dog.setAction('roll');
          S.look(null);
          break;
        case 'shift':
          if (!st.turned) {
            mover.face(st.face);
            dog.setAction(mover.gait() || 'idle');
            if ((mover.headingError(st.face) < 0.2 && st.t > 0.3) || st.t > 1.8) st.turned = true;
          } else {
            dog.setAction('lie');
          }
          lookHand(0.2);
          break;
        default: // lean：坐着把头歪向手
          dog.setAction(mover.headingError(st.camFace) > 0.35 && st.t < 1.5 ? mover.gait() || 'idle' : 'sit');
          lookHand(-0.05);
      }
      const turning = st.name === 'greet' && mover.headingError(st.camFace) > 0.3 && st.t < 2;
      if (st.t >= st.dur && !turning && (st.name !== 'shift' || st.turned)) pick();
    },
    exit() {
      dog.bliss = 0;
      S.look(null);
      mover.face(NaN);
    },
  };
}
