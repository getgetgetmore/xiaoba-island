// WP3 柴犬模型与程序化动画（DESIGN 3.6）。
// 结构：动作函数 → 姿态参数（可插值）→ crossfade → 次级动画（呼吸/眨眼/抖耳/尾巴惯性/挤压拉伸/lookAt）→ 骨骼解算（腿部两段 IK）。
// root group 的 position / rotation.y 归 brain，模型只动内部骨骼。
import * as THREE from 'three';
import { buildDog, DIM } from './model/rig.js';
import { ACTIONS, ONE_SHOT, DOG_ACTIONS, I, LEG, GX, GY, GZ, LX, LY, LZ, GW, CURL, N } from './model/actions.js';
import { ZONES, getGarment, garmentUsesNeck, createWornGarment } from '../wardrobe/garments.js';

export { DOG_ACTIONS };

// 进入/离开某些大姿态时的最短过渡（秒），避免“瞬间翻身/瞬间躺下”
const MIN_FADE_IN = { roll: 0.6, lie: 0.5, sleep: 0.75, sit: 0.35, playbow: 0.3, drink: 0.3, sniff: 0.3 };
const MIN_FADE_OUT = { roll: 0.55, lie: 0.45, sleep: 0.65, sit: 0.3 };

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ss01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const dampK = (lambda, dt) => 1 - Math.exp(-lambda * dt);
const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

// 预分配临时对象（update 内不分配）
const _m = new THREE.Matrix4();
const _mi = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _g = new THREE.Vector3();

/** 一个阻尼弹簧（次级动画惯性） */
function spring(k, zeta) {
  return { x: 0, v: 0, k, c: 2 * Math.sqrt(k) * zeta };
}
function stepSpring(s, force, dt) {
  // 半隐式欧拉，子步保证稳定
  const n = dt > 0.02 ? Math.ceil(dt / 0.02) : 1;
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (force - s.k * s.x - s.c * s.v) * h;
    s.x += s.v * h;
  }
  if (!Number.isFinite(s.x) || Math.abs(s.x) > 3) { s.x = 0; s.v = 0; }
  return s.x;
}

export function createDog(ctx) {
  const rig = buildDog();
  const group = new THREE.Group();
  group.name = 'dog';
  group.add(rig.root);
  group.add(rig.mesh);

  // 简易可复现随机
  let seed = 0x9e3779b9 ^ Math.floor((ctx && ctx.rng ? ctx.rng() : 0.5) * 1e9);
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const from = new Float32Array(N);
  const tgt = new Float32Array(N);
  const out = new Float32Array(N);
  const fin2 = new Float32Array(N);
  ACTIONS.idle(out, { t: 0, time: 0, speed: 0, walkPhase: 0, runPhase: 0, walkStride: 0, runStride: 0, walkFreq: 2 });
  from.set(out);

  const st = {
    t: 0, time: 0, speed: 0,
    walkPhase: 0, walkFreq: 2, walkStride: 0,
    runPhase: 0, runFreq: 3.5, runStride: 0,
    base: from,
  };
  let fade = 0.0001, fadeT = 1;

  const dog = {
    group,
    mouthAnchor: rig.mouthAnchor,
    actions: DOG_ACTIONS.slice(),
    action: 'idle',
    actionTime: 0,
    actionDone: false,
    speed: 0,
    /** 外部钩子（钓鱼小游戏写入，默认 0 = 与没有这个钩子时完全一致）：
     *  tailDrop 0..1：把尾巴从背上放下来，笔直地向身后下方垂下（坐着时垂进水里）；
     *  tailTug -1..1：尾巴被拽动——正值 = 绷直并抖动（越大越猛），负值 = 松垮垮地晃；
     *  tailLift 0..1：把尾巴绷直了向后上方扬起来（1 = 接近竖直；钓鱼时把挂在尾巴梢上的东西吊出水面）。优先于 tailDrop。 */
    tailDrop: 0,
    tailTug: 0,
    tailLift: 0,
    /** 耳朵竖起 0..1（钓鱼：鱼咬钩了）。默认 0 = 不影响。 */
    earPerk: 0,
    /** 边走边闻 0..1（嗅探行为挪步时写入）：叠在走路动作上——头压低、鼻子贴着地面左右扫、尾巴摇。默认 0 = 不影响。 */
    noseDown: 0,
    size: { length: 0.85, height: 0.83, radius: 0.45 }, // 实测：站立体长（鼻尖→臀）≈0.83、耳尖高≈0.83
    setAction,
    lookAt,
    setCarrying,
    update,
    wear,
    /** 调试：内部结构 */
    rig,
  };

  // ---------------------------------------------------------------- 换装（服饰按需创建；不穿时和原来完全一样）
  const worn = { hat: null, top: null, acc: null, shoes: null }; // 每个分区：{ id, mesh } | null
  /** 只读：当前穿着 { hat, top, acc, shoes }（id 或 null） */
  Object.defineProperty(dog, 'outfit', {
    enumerable: true,
    get: () => Object.freeze({
      hat: worn.hat ? worn.hat.id : null, top: worn.top ? worn.top.id : null,
      acc: worn.acc ? worn.acc.id : null, shoes: worn.shoes ? worn.shoes.id : null,
    }),
  });
  /** 换上 / 脱下（id 传 null）某个分区的服饰；同一分区同时只穿一件。id 不存在或不属于这个分区返回 false */
  function wear(zone, id) {
    if (!ZONES.includes(zone)) return false;
    if (id !== null && id !== undefined) {
      const g = getGarment(id);
      if (!g || g.zone !== zone) return false;
      if (worn[zone] && worn[zone].id === id) return true;
      const mesh = createWornGarment(id, rig);
      if (!mesh) return false;
      takeOff(zone);
      group.add(mesh);
      worn[zone] = { id, mesh };
    } else takeOff(zone);
    // 占脖子的装饰品（围巾、领结…）穿着时，默认的红项圈和铃铛收起来
    const neck = ZONES.some((z) => worn[z] && garmentUsesNeck(worn[z].id));
    rig.collar.visible = !neck;
    rig.bell.visible = !neck;
    return true;
  }
  function takeOff(zone) {
    const w = worn[zone];
    if (!w) return;
    group.remove(w.mesh); // 几何、材质是缓存共用的，不释放
    worn[zone] = null;
  }

  // ---------------------------------------------------------------- 契约方法
  function setAction(name, { fade: f = 0.25 } = {}) {
    if (!ACTIONS[name] || name === dog.action) return;
    const prev = dog.action;
    from.set(out);
    let fd = Math.max(fin(f, 0.25), MIN_FADE_IN[name] || 0, MIN_FADE_OUT[prev] || 0);
    if (name === 'flinch') fd = Math.min(fd, 0.06);
    if (name === 'pounce') fd = Math.min(fd, 0.15);
    fade = Math.max(0.0001, fd);
    fadeT = 0;
    dog.action = name;
    dog.actionTime = 0;
    dog.actionDone = false;
  }

  let lookTarget = null;
  function lookAt(worldPos) {
    lookTarget = worldPos && Number.isFinite(worldPos.x) ? worldPos : null;
  }

  let carrying = false;
  function setCarrying(b) { carrying = !!b; }

  // ---------------------------------------------------------------- 次级动画状态
  let blinkNext = 1.5 + rnd() * 3, blinkT = -1, blinkDouble = false;
  let flickNext = 2 + rnd() * 4, flickT = -1, flickSide = 0;
  let wagPhase = 0, wagAmpS = 0.1, wagFreqS = 1.3;
  let breathPhase = 0;
  let lookYaw = 0, lookPitch = 0, lookAmt = 0;
  let carryS = 0;
  let pantS = 0; // 喘气程度（平滑后）
  let blissS = 0; // 被摸摸时的享受程度（平滑后）
  let tailDropS = 0, tugS = 0, tugPhase = 0, perkS = 0, tailLiftS = 0; // 尾巴 / 耳朵钩子（平滑后）
  let noseS = 0; // 边走边闻（平滑后）
  let prevY = DIM.BODY_Y, prevVy = 0, accY = 0;
  let prevHeading = 0, yawRate = 0, headingInit = false;
  let rainS = 0, brV = 0, cheekV = 0, flickV = 0;
  const sEar = spring(160, 0.22), sTail = spring(90, 0.3), sTailSide = spring(60, 0.35), sCheek = spring(220, 0.25), sHead = spring(120, 0.45);

  // ---------------------------------------------------------------- 更新
  function update(dt, env) {
    dt = clamp(fin(dt, 0), 0, 0.1);
    st.time += dt;
    dog.actionTime += dt;
    st.t = dog.actionTime;
    const vSigned = fin(dog.speed, 0) / (group.scale.x || 1);
    const gaitDir = vSigned < 0 ? -1 : 1; // 倒退行走：相位反向推进
    const v = clamp(Math.abs(vSigned), 0, 8); // 根节点被整体放大时，步频按“体长当量速度”计算，避免滑步
    st.speed = v;

    // 步态相位（步频随速度，步幅 = 速度×支撑占比/步频，保证不滑步）
    st.walkFreq = clamp(1.7 + v * 1.4, 1.7, 4.4); // 小短腿：步幅小、步频快的小碎步
    st.walkStride = (v * 0.62) / st.walkFreq;
    st.walkPhase = (((st.walkPhase + gaitDir * st.walkFreq * dt) % 1) + 1) % 1;
    st.runFreq = clamp(2.9 + v * 0.5, 3.1, 5.6);
    st.runStride = (v * 0.3) / st.runFreq;
    st.runPhase = (((st.runPhase + gaitDir * st.runFreq * dt) % 1) + 1) % 1;

    const dur = ONE_SHOT[dog.action];
    if (dur !== undefined && dog.actionTime >= dur) dog.actionDone = true;

    ACTIONS[dog.action](tgt, st);
    fadeT += dt;
    const w = ss01(fadeT / fade);
    for (let i = 0; i < N; i++) out[i] = from[i] + (tgt[i] - from[i]) * w;

    secondary(dt, env);
    apply();
  }

  function secondary(dt, env) {
    const o = fin2;
    o.set(out);
    const T = st.time;

    // 竖直加速度 / 转向角速度（驱动耳朵、尾巴、脸颊的惯性）
    if (dt > 0) {
      const vy = (o[I.bodyY] - prevY) / dt;
      const a = (vy - prevVy) / dt;
      accY += (clamp(a, -40, 40) - accY) * dampK(30, dt);
      prevVy = vy;
      prevY = o[I.bodyY];
      const h = group.rotation.y;
      if (headingInit) {
        let d = h - prevHeading;
        d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
        yawRate += (clamp(d / dt, -8, 8) - yawRate) * dampK(10, dt);
      }
      prevHeading = h; headingInit = true;
    }
    const earLag = stepSpring(sEar, -accY * 0.012 - yawRate * 0.0, dt);
    const tailLag = stepSpring(sTail, -accY * 0.01, dt);
    const tailSideLag = stepSpring(sTailSide, -yawRate * 0.9, dt);
    const cheek = stepSpring(sCheek, -accY * 0.004, dt);
    const headLag = stepSpring(sHead, -accY * 0.004, dt);

    // 呼吸
    breathPhase = (breathPhase + o[I.breathRate] * dt) % 1;
    const br = Math.sin(TAU * breathPhase);
    brV = br;

    // 眨眼（偶尔双眨）
    let blink = 1;
    blinkNext -= dt;
    if (blinkNext <= 0 && blinkT < 0) { blinkT = 0; blinkDouble = rnd() < 0.25; }
    if (blinkT >= 0) {
      blinkT += dt;
      const len = blinkDouble ? 0.42 : 0.17;
      const u = blinkT / 0.17;
      blink = 1 - Math.sin(Math.PI * clamp(u - Math.floor(u), 0, 1));
      if (blinkT >= len) { blinkT = -1; blinkNext = 2 + rnd() * 4.5; blink = 1; }
    }
    o[I.eyeOpen] *= blink;
    // 被摸摸：眯起眼睛、尾巴猛摇、耳朵向后贴、头轻轻左右晃（蹭手）
    blissS += (clamp(fin(dog.bliss, 0), 0, 1) - blissS) * dampK(4, dt);
    if (blissS > 0.02) {
      o[I.eyeOpen] = Math.min(o[I.eyeOpen], 1 - (0.8 - 0.12 * Math.sin(st.time * 2.1)) * blissS);
      o[I.wagAmp] = Math.max(o[I.wagAmp], 0.8 * blissS);
      o[I.wagFreq] = Math.max(o[I.wagFreq], 4.4 * blissS);
      o[I.earBack] += 0.4 * blissS;
      o[I.headRoll] += 0.11 * Math.sin(st.time * 1.9) * blissS;
    }

    // 边走边闻：头压低、鼻子贴着地面左右扫，鼻子细碎地抽动，尾巴摇
    noseS += (clamp(fin(dog.noseDown, 0), 0, 1) - noseS) * dampK(6, dt);
    if (noseS < 0.001) noseS = 0;
    if (noseS > 0) {
      const k = ss01(noseS);
      o[I.bodyPitch] += 0.12 * k;
      o[I.chestPitch] += 0.08 * k;
      o[I.neckPitch] += 0.58 * k;
      o[I.headPitch] += (0.08 + 0.025 * Math.sin(TAU * 8 * T)) * k;
      o[I.reach] += 0.1 * k;
      o[I.neckYaw] += 0.3 * Math.sin(T * 2.6) * k;
      o[I.headYaw] += 0.2 * Math.sin(T * 2.6 + 0.5) * k;
      o[I.lookW] *= 1 - k;
      o[I.earBack] -= 0.12 * k;
      o[I.wagAmp] = Math.max(o[I.wagAmp], 0.45 * k);
      o[I.wagFreq] = Math.max(o[I.wagFreq], 2.8 * k);
    }

    // 抖耳
    flickNext -= dt;
    if (flickNext <= 0 && flickT < 0) { flickT = 0; flickSide = rnd() < 0.5 ? 0 : 1; }
    let flick = 0;
    if (flickT >= 0) {
      flickT += dt;
      flick = Math.sin(Math.PI * clamp(flickT / 0.22, 0, 1)) + 0.5 * Math.sin(Math.PI * clamp((flickT - 0.22) / 0.16, 0, 1));
      if (flickT > 0.4) { flickT = -1; flickNext = 2.5 + rnd() * 6; }
    }

    // 尾巴摇：相位积分，幅度/频率平滑
    wagAmpS += (o[I.wagAmp] - wagAmpS) * dampK(5, dt);
    wagFreqS += (o[I.wagFreq] - wagFreqS) * dampK(4, dt);
    wagPhase = (wagPhase + wagFreqS * dt) % 1;

    // 雨天耳朵略压低
    const rain = env && Number.isFinite(env.rain) ? env.rain : 0;
    rainS += (rain - rainS) * dampK(1, dt);
    const wind = env && Number.isFinite(env.wind) ? env.wind : 0;
    o[I.earBack] += 0.28 * rainS + earLag + 0.04 * wind * Math.sin(T * 9.1);
    o[I.earOut] += 0.14 * rainS + Math.abs(earLag) * 0.3;
    perkS += (clamp(fin(dog.earPerk, 0), 0, 1) - perkS) * dampK(14, dt);
    if (perkS < 0.001) perkS = 0;
    if (perkS > 0) { o[I.earBack] -= 0.6 * perkS; o[I.earOut] -= 0.05 * perkS; }
    o[I.tailCurl] += tailLag;
    o[I.tailSide] += tailSideLag;

    // 尾巴钩子：tailDrop 把尾巴放下来垂向身后下方；tailTug 给被拽动的抖动 / 绷直
    tailDropS += (clamp(fin(dog.tailDrop, 0), 0, 1) - tailDropS) * dampK(5, dt);
    tugS += (clamp(fin(dog.tailTug, 0), -1, 1) - tugS) * dampK(18, dt);
    if (tailDropS < 0.001) tailDropS = 0;
    if (Math.abs(tugS) < 0.001) tugS = 0;
    if (tailDropS > 0 || tugS !== 0) {
      const k = ss01(tailDropS);
      // 尾巴方向角 = tailBase + 身体俯仰 + 臀部俯仰 + 整体坡度；0 = 竖直向上，-π/2 = 水平向后，-π = 竖直向下。
      // 放下的尾巴向身后下方伸出，与水平向后的夹角约 49°（坐在水边时，尾巴梢正好够进水面以下）
      const pitch = o[I.bodyPitch] + o[I.hipsPitch] + (group.rotation.x || 0);
      const down = -(Math.PI / 2 + 0.85) - pitch;
      tugPhase += dt * (22 + 10 * Math.abs(tugS));
      const tg = tugS * k;
      o[I.tailBase] += (down - o[I.tailBase]) * k - 0.16 * Math.max(0, tg) + 0.1 * Math.max(0, tg) * Math.sin(tugPhase);
      o[I.tailCurl] += (0.0 - o[I.tailCurl]) * k + 0.14 * Math.max(0, -tg);
      o[I.tailSide] += (0.0 - o[I.tailSide]) * k + 0.26 * tg * Math.sin(tugPhase * 0.83);
      o[I.wagAmp] *= 1 - k;
    }
    // 尾巴钩子：tailLift 把尾巴绷直了向后上方扬起（吊着东西，带一点吃力的抖）
    tailLiftS += (clamp(fin(dog.tailLift, 0), 0, 1) - tailLiftS) * dampK(11, dt);
    if (tailLiftS < 0.001) tailLiftS = 0;
    if (tailLiftS > 0) {
      const k = ss01(tailLiftS);
      const pitch = o[I.bodyPitch] + o[I.hipsPitch] + (group.rotation.x || 0);
      const upAng = -0.42 - pitch; // 方向角：0 = 竖直向上，-π/2 = 水平向后
      tugPhase += dt * 16;
      o[I.tailBase] += (upAng - o[I.tailBase]) * k + 0.05 * k * Math.sin(tugPhase);
      o[I.tailCurl] += (0.0 - o[I.tailCurl]) * k;
      o[I.tailSide] += (0.0 - o[I.tailSide]) * k + 0.1 * k * Math.sin(tugPhase * 0.7);
      o[I.wagAmp] *= 1 - k;
    }
    o[I.headPitch] += headLag;
    cheekV = cheek;
    flickV = flick;

    // lookAt：转到狗本地 → 相对颈根的偏航/俯仰，限幅后由颈+头分摊
    let wantAmt = 0;
    if (lookTarget) {
      group.updateWorldMatrix(true, false);
      _v.copy(lookTarget);
      group.worldToLocal(_v);
      _v.multiplyScalar(1 / DIM.SCALE);
      const dx = _v.x, dy = _v.y - 0.62, dz = _v.z - 0.28;
      const hd = Math.hypot(dx, dz);
      if (hd + Math.abs(dy) > 0.05) {
        let yaw = Math.atan2(dx, dz);
        const behind = Math.abs(yaw) > 2.2;
        yaw = clamp(yaw, -1.22, 1.22);
        const pitch = clamp(-Math.atan2(dy, Math.max(hd, 0.05)), -0.7, 0.7);
        const k = dampK(5, dt);
        lookYaw += (yaw - lookYaw) * k;
        lookPitch += (pitch - lookPitch) * k;
        wantAmt = behind ? 0.5 : 1;
      }
    }
    lookAmt += (wantAmt * o[I.lookW] - lookAmt) * dampK(4, dt);
    const lw = lookAmt;
    o[I.neckYaw] += lookYaw * 0.42 * lw;
    o[I.headYaw] += lookYaw * 0.58 * lw - o[I.headYaw] * 0.6 * lw;
    o[I.neckPitch] += lookPitch * 0.35 * lw;
    o[I.headPitch] += lookPitch * 0.65 * lw;
    o[I.headRoll] += -lookYaw * 0.12 * lw;

    // 跑累了喘气：张嘴、吐舌头、呼吸又快又浅（睡觉、喝水、嗅闻、叼东西时不喘）
    {
      const a = dog.action;
      const ok = a === 'idle' || a === 'sit' || a === 'walk' || a === 'run' || a === 'lie' || a === 'spin' || a === 'playbow';
      pantS += ((ok && !carrying ? clamp(fin(dog.pant, 0), 0, 1) : 0) - pantS) * dampK(2.5, dt);
      if (pantS > 0.02) {
        const ph = Math.sin(st.time * 17);
        o[I.jaw] = Math.max(o[I.jaw], (0.2 + 0.05 * ph) * pantS);
        o[I.tongue] = Math.max(o[I.tongue], 0.9 * pantS);
        o[I.breath] += 1.6 * pantS * (0.6 + 0.4 * ph);
        o[I.headPitch] += 0.02 * ph * pantS;
      }
    }

    // 叼木棍：嘴微张、不吐舌
    carryS += ((carrying ? 1 : 0) - carryS) * dampK(10, dt);
    if (carryS > 0.001) {
      o[I.jaw] = o[I.jaw] + (0.14 - o[I.jaw]) * carryS;
      o[I.tongue] *= 1 - carryS;
    }
  }

  function apply() {
    const o = fin2;
    const R = rig;
    const br = brV;

    // 躯干
    R.body.position.set(o[I.bodyX], o[I.bodyY], o[I.bodyZ]);
    R.body.rotation.set(o[I.bodyPitch], o[I.bodyYaw], o[I.bodyRoll]);
    const sq = clamp(o[I.squash], -0.2, 0.2);
    R.body.scale.set(1 - sq * 0.45, 1 + sq, 1 - sq * 0.35);
    R.hips.position.set(0, 0, DIM.HIPS[2] + o[I.hipsZ]);
    R.hips.rotation.set(o[I.hipsPitch], o[I.hipsYaw], o[I.hipsRoll]);
    R.chest.position.set(0, 0.002 * br * o[I.breath], DIM.CHEST[2] + o[I.chestZ]);
    R.chest.rotation.set(o[I.chestPitch], o[I.chestYaw], o[I.chestRoll]);
    const bs = 0.016 * o[I.breath] * br;
    R.belly.scale.set(1 + bs, 1 + bs * 1.3, 1 + bs * 0.4);

    // 颈/头（颈部反向缩放，头不被挤压变形；脸颊有一点惯性弹动）
    R.neck.rotation.set(o[I.neckPitch], o[I.neckYaw], o[I.neckRoll]);
    R.neck.scale.set(1 / (1 - sq * 0.45), 1 / (1 + sq), 1 / (1 - sq * 0.35));
    const rc = clamp(o[I.reach], -0.05, 0.16);
    R.head.position.set(0, DIM.HEAD[1] + rc * 0.25, DIM.HEAD[2] + rc);
    R.head.rotation.set(o[I.headPitch], o[I.headYaw], o[I.headRoll]);
    const ck = clamp(cheekV, -0.1, 0.1);
    R.head.scale.set(1 + ck * 0.4, 1 - ck, 1 + ck * 0.3);
    R.jaw.rotation.x = clamp(o[I.jaw], 0, 0.6);
    const tg = clamp(o[I.tongue], 0, 1);
    R.tongue.position.set(0, 0.004 - 0.004 * tg, 0.0 + 0.055 * tg);
    R.tongue.rotation.x = 0.55 * tg;
    R.tongue.scale.set(1, 1, 1 + 0.25 * tg);

    // 耳朵
    const fl = flickV;
    const eb = o[I.earBack], eo = o[I.earOut];
    R.earL.rotation.set(-eb - (flickSide === 0 ? fl * 0.35 : 0), 0, -eo - (flickSide === 0 ? fl * 0.25 : 0));
    R.earR.rotation.set(-eb - (flickSide === 1 ? fl * 0.35 : 0), 0, eo + (flickSide === 1 ? fl * 0.25 : 0));

    // 眼睛
    const eye = clamp(o[I.eyeOpen], 0.07, 1);
    R.eyes[0].scale.set(1, eye, 1);
    R.eyes[1].scale.set(1, eye, 1);

    // 尾巴：根部（侧倒 → 俯仰 → 绕自身摇）、每节卷曲
    const wa = wagAmpS, wp = TAU * wagPhase;
    const t0 = R.tail[0];
    t0.rotation.set(o[I.tailBase], wa * Math.sin(wp) * 1.1, o[I.tailSide] + wa * 0.35 * Math.sin(wp - 0.6));
    for (let i = 1; i < R.tail.length; i++) {
      R.tail[i].rotation.set(o[I.tailCurl], 0, wa * 0.28 * Math.sin(wp - i * 0.7));
    }

    // 铃铛随动摆一下
    R.bellPivot.rotation.z = 0.25 * Math.sin(wp * 0.5) * wa + 0.1 * clamp(accY * 0.01, -1, 1);

    // 腿：先算好父骨骼（chest/hips）在 root 空间的矩阵，再把地面目标转进去做两段 IK
    R.body.updateMatrix();
    R.chest.updateMatrix();
    R.hips.updateMatrix();
    for (let i = 0; i < 4; i++) {
      const L = R.legs[i];
      const parent = L.front ? R.chest : R.hips;
      _m.multiplyMatrices(R.body.matrix, parent.matrix);
      _mi.copy(_m).invert();
      const b = LEG + i * 8;
      const gw = clamp(o[b + GW], 0, 1);
      _g.set(o[b + GX], o[b + GY], o[b + GZ]).applyMatrix4(_mi).sub(L.jointPos);
      _v.set(o[b + LX], o[b + LY], o[b + LZ]);
      _v.lerp(_g, gw);
      solveLeg(L, _v.x, _v.y, _v.z);
      // 后腿外八：脚落地时整条后腿绕自身轴向外拧一点（跗关节朝里、脚尖朝外），爪子再向外撇
      if (!L.front) {
        L.up.rotation.y = L.side * 0.34 * gw;
        L.paw.rotation.y = L.side * 0.3 * gw;
      }
      // 爪子：落地时保持水平，抬起时按 curl 弯曲
      const pitchSum = o[I.bodyPitch] + (L.front ? o[I.chestPitch] : o[I.hipsPitch]) + L.up.rotation.x + L.lo.rotation.x;
      L.paw.rotation.x = -pitchSum * gw + o[b + CURL];
    }
  }

  /** 两段 IK（关节父空间，目标为关节→脚踝向量）。前腿关节（腕）朝前弯，后腿关节（跗）朝后弯。 */
  function solveLeg(L, tx, ty, tz) {
    const L1 = L.L1, L2 = L.L2;
    let ab = Math.atan2(tx, -ty);
    ab = clamp(ab, -0.7, 0.7);
    const down = tx * Math.sin(ab) - ty * Math.cos(ab);
    let d = Math.hypot(down, tz);
    const dMax = L1 + L2 - 0.0005, dMin = Math.abs(L1 - L2) + 0.01;
    d = clamp(d, dMin, dMax);
    const s = Math.atan2(tz, down);
    const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const kb = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    let s1, kr;
    if (L.front) { s1 = s + a; kr = kb; } else { s1 = s - a; kr = -kb; }
    L.up.rotation.set(-s1, 0, ab);
    L.lo.rotation.set(kr, 0, 0);
  }

  // 初始化一次姿态
  update(0, null);
  return dog;
}
