// 农场捣乱小游戏的角色模型（第二版：圆润的 3D 造型 + 卡通分档明暗，描边由 pixel.js 的后处理负责）。
//
// 每个角色由若干刚性部件组成（≤ 10 个网格，共用同一个 MeshToonMaterial）；部件是用球 / 椭球 / 圆柱 / 圆锥 / 圆环
// 拼出来、合并成带顶点色的一个网格；动作靠逐帧设置部件的位置 / 旋转 / 缩放（程序动画），切动作时平滑过渡。
//
// 用法：
//   const m = createFarmModel('hen');          // kind 见 FARM_MODELS
//   scene.add(m.group);                         // 原点在脚下地面中心，头朝本地 +Z
//   m.setAction('run'); m.speed = 2.0;          // run 的步频跟着 speed（世界单位 / 秒）变，脚基本不打滑
//   每帧 m.update(dt);                          // update 内不分配对象
//   管理员：m.setAngry(true)（或 opts.angry）→ 皱眉、脸颊变红、头顶冒“怒”符号和蒸汽团。
//   管理员 carry 动作：左手拎东西走，m.parts.holdPoint（Object3D）是手的挂点，把小狗 add 到它下面即可。
//
// 返回：{ group, parts, update(dt), setAction(name), action, size:{w,h,l}, speed, phase, setAngry, evaluate, tris, partCount }
//   size 是世界单位的包围盒尺寸；evaluate(t, action) 把动作直接摆到时间 t（不平滑，出图 / 测试用）；
//   几何按 kind+opts 缓存，同种角色的多个实例共用几何。
import * as THREE from 'three';

// ------------------------------------------------------------------ 材质：3 档卡通明暗，全部角色共用
const gradData = new Uint8Array([120, 120, 120, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
const gradMap = new THREE.DataTexture(gradData, 3, 1, THREE.RGBAFormat);
gradMap.minFilter = gradMap.magFilter = THREE.NearestFilter;
gradMap.needsUpdate = true;
export const farmToonMaterial = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradMap });

// ------------------------------------------------------------------ 造型小工具：一堆上了色的基本体合并成一个几何
const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _n = new THREE.Matrix3();
const _p3 = new THREE.Vector3(), _s3 = new THREE.Vector3();
const nonIdx = (g) => g.toNonIndexed();
const TMPL = {
  sphHi: nonIdx(new THREE.SphereGeometry(1, 12, 8)),
  sphMid: nonIdx(new THREE.SphereGeometry(1, 8, 6)),
  sphLo: nonIdx(new THREE.SphereGeometry(1, 6, 4)),
  sphTiny: nonIdx(new THREE.SphereGeometry(1, 5, 3)),
  cyl: nonIdx(new THREE.CylinderGeometry(1, 1, 1, 8)),
  cyl16: nonIdx(new THREE.CylinderGeometry(1, 1, 1, 16)),
  cone: nonIdx(new THREE.ConeGeometry(1, 1, 8)),
  tor: nonIdx(new THREE.TorusGeometry(1, 0.35, 5, 10)),
};

function builder(sc = 1) {
  const pos = [], nor = [], col = [];
  const add = (g, color, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0]) => {
    if (typeof s === 'number') s = [s, s, s];
    _p3.set(p[0] * sc, p[1] * sc, p[2] * sc);
    _s3.set(s[0] * sc, s[1] * sc, s[2] * sc);
    _m.compose(_p3, _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s3);
    _n.getNormalMatrix(_m);
    const P = g.attributes.position, N = g.attributes.normal;
    _c.set(color);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(_m); pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(N, i).applyMatrix3(_n).normalize(); nor.push(_v.x, _v.y, _v.z);
      col.push(_c.r, _c.g, _c.b);
    }
    return api;
  };
  const sph = (s) => {
    const m = typeof s === 'number' ? s : Math.max(s[0], s[1], s[2]);
    return m >= 0.15 ? TMPL.sphHi : m >= 0.095 ? TMPL.sphMid : m >= 0.025 ? TMPL.sphLo : TMPL.sphTiny;
  };
  const api = {
    ball: (color, p, s, r) => add(sph(s), color, p, s, r),
    cyl: (color, p, s, r) => add(TMPL.cyl, color, p, s, r),
    disc: (color, p, s, r) => add(TMPL.cyl16, color, p, s, r),
    cone: (color, p, s, r) => add(TMPL.cone, color, p, s, r),
    ring: (color, p, s, r) => add(TMPL.tor, color, p, s, r),
    /** 在椭球 (中心 c，半径 rad) 的表面 dir 方向上贴一块色斑（半嵌入的小球，露出来的是一个圆片）。 */
    patch(color, c, rad, dir, r) {
      const l = Math.hypot(dir[0], dir[1], dir[2]);
      const dx = dir[0] / l, dy = dir[1] / l, dz = dir[2] / l;
      const k = 1 / Math.sqrt((dx / rad[0]) ** 2 + (dy / rad[1]) ** 2 + (dz / rad[2]) ** 2);
      return add(sph(r), color, [c[0] + dx * k - dx * 0.72 * r, c[1] + dy * k - dy * 0.72 * r, c[2] + dz * k - dz * 0.72 * r], [r, r, r]);
    },
    /** 一对左右对称的东西：fn(sx) 里按 sx = ±1 画。 */
    pair(fn) { fn(1); fn(-1); return api; },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      return g;
    },
  };
  return api;
}

// ------------------------------------------------------------------ 颜色
const mix = (a, b, t) => _c.set(a).lerp(new THREE.Color(b), t).getHex();
const INK = 0x2a1c14, WHITE = 0xffffff;

// ------------------------------------------------------------------ 部件 / 姿势基础设施
const TAU = Math.PI * 2, PI = Math.PI;
const sin = Math.sin, cos = Math.cos, abs = Math.abs, max = Math.max, min = Math.min;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };

const newPose = () => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 });
function resetPose(p) { p.x = 0; p.y = 0; p.z = 0; p.rx = 0; p.ry = 0; p.rz = 0; p.sx = 1; p.sy = 1; p.sz = 1; }
function blendAng(c, t, a) { let d = t - c; d -= TAU * Math.round(d / TAU); return c + d * a; }
function blendPose(c, t, a) {
  c.x += (t.x - c.x) * a; c.y += (t.y - c.y) * a; c.z += (t.z - c.z) * a;
  c.rx = blendAng(c.rx, t.rx, a); c.ry = blendAng(c.ry, t.ry, a); c.rz = blendAng(c.rz, t.rz, a);
  c.sx += (t.sx - c.sx) * a; c.sy += (t.sy - c.sy) * a; c.sz += (t.sz - c.sz) * a;
}
function copyPose(c, t) {
  c.x = t.x; c.y = t.y; c.z = t.z; c.rx = t.rx; c.ry = t.ry; c.rz = t.rz; c.sx = t.sx; c.sy = t.sy; c.sz = t.sz;
}

/** 部件：pivot 是转轴（设计坐标，脚下地面中心为原点）；build(b) 在同一坐标里画；parent 默认挂在 root 下。 */
function part(name, pivot, build, o = {}) { return { name, pivot, build, parent: o.parent || null, alt: o.alt || null, flag: o.flag || null }; }

const specCache = new Map();
function getSpec(kind, opts) {
  const key = kind + '|' + JSON.stringify(opts || {});
  let s = specCache.get(key);
  if (!s) {
    const def = KINDS[kind];
    if (!def) throw new Error('未知的农场角色: ' + kind);
    const d = def(opts || {});
    const sc = d.sc || 1;
    const geoOf = (fn, pivot) => {
      const b = builder(sc);
      fn(b);
      const g = b.geometry();
      g.translate(-pivot[0] * sc, -pivot[1] * sc, -pivot[2] * sc);
      g.computeBoundingBox(); g.computeBoundingSphere();
      return g;
    };
    s = {
      kind, sc, actions: d.actions, defaultAction: d.defaultAction || 'idle', runSpeed: d.runSpeed || 2, stride: d.stride || 0.6, attach: d.attach || [],
      size: null,
      parts: d.parts.map((p) => ({
        name: p.name, pivot: p.pivot, parent: p.parent, flag: p.flag,
        geo: geoOf(p.build, p.pivot),
        altGeo: p.alt ? geoOf(p.alt, p.pivot) : null,
      })),
    };
    specCache.set(key, s);
  }
  return s;
}

const MAX_PHASE_RATE = 36; // 步频上限（弧度 / 秒）：再快就是一团模糊

export function createFarmModel(kind, opts = {}) {
  if (kind === 'farmer') kind = 'keeper';
  const spec = getSpec(kind, opts);
  const sc = spec.sc;
  const group = new THREE.Group();
  group.name = 'farm-' + kind;
  const rig = new THREE.Group();
  group.add(rig);

  const parts = {};
  const objs = { root: rig };
  const restW = { root: [0, 0, 0] }; // 各部件转轴的世界坐标（设计坐标 × sc）
  const tgt = { root: newPose() }, cur = { root: newPose() };
  const names = ['root'];
  const restPos = { root: [0, 0, 0] };
  const flagged = [];
  for (const d of spec.parts) {
    const mesh = new THREE.Mesh(d.geo, farmToonMaterial);
    mesh.name = d.name;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    const par = d.parent || 'root';
    const pp = restW[par];
    const w = [d.pivot[0] * sc, d.pivot[1] * sc, d.pivot[2] * sc];
    mesh.position.set(w[0] - pp[0], w[1] - pp[1], w[2] - pp[2]);
    objs[par].add(mesh);
    objs[d.name] = mesh; restW[d.name] = w; parts[d.name] = mesh;
    restPos[d.name] = [mesh.position.x, mesh.position.y, mesh.position.z];
    tgt[d.name] = newPose(); cur[d.name] = newPose();
    names.push(d.name);
    if (d.flag) { mesh.visible = false; flagged.push([mesh, d.flag]); }
  }
  for (const a of spec.attach) { // 挂点（空物体）
    const o = new THREE.Object3D();
    o.name = a.name;
    const pp = restW[a.parent];
    o.position.set(a.at[0] * sc - pp[0], a.at[1] * sc - pp[1], a.at[2] * sc - pp[2]);
    objs[a.parent].add(o);
    parts[a.name] = o;
  }
  const nameList = names, nNames = names.length;

  const model = {
    group, parts, kind, opts, t: 0, phase: 0, speed: spec.runSpeed, action: spec.defaultAction, angry: false,
    size: { w: 0, h: 0, l: 0 }, pose: cur, tris: 0, partCount: spec.parts.length,
    setAction(name) { if (spec.actions[name] && name !== model.action) model.action = name; },
    setAngry(v) {
      model.angry = !!v;
      const hd = spec.parts.find((p) => p.name === 'head');
      if (hd && hd.altGeo) parts.head.geometry = model.angry ? hd.altGeo : hd.geo;
      for (const [mesh, f] of flagged) if (f === 'angry') mesh.visible = model.angry;
    },
    /** 直接摆到时间 t 的姿势（不平滑，不推进 phase），出图 / 测试用。 */
    evaluate(t, action) {
      if (action && spec.actions[action]) model.action = action;
      model.t = t;
      run(0, true);
    },
    update(dt) {
      model.t += dt;
      if (model.action === 'run' || model.action === 'carry') {
        const rate = min(TAU * model.speed / spec.stride, MAX_PHASE_RATE);
        model.phase = (model.phase + rate * dt) % (TAU * 64);
      }
      run(dt, false);
    },
    dispose() { /* 几何是缓存共用的，不在这里释放 */ },
  };
  let tris = 0;
  for (const d of spec.parts) tris += d.geo.attributes.position.count / 3;
  model.tris = tris;

  function run(dt, instant) {
    for (let i = 0; i < nNames; i++) resetPose(tgt[nameList[i]]);
    spec.actions[model.action](tgt, model.t, model);
    const a = instant ? 1 : 1 - Math.exp(-dt * 14);
    for (let i = 0; i < nNames; i++) {
      const n = nameList[i];
      const c = cur[n];
      if (instant) copyPose(c, tgt[n]); else blendPose(c, tgt[n], a);
      const o = objs[n], r = restPos[n];
      o.position.set(r[0] + c.x * sc, r[1] + c.y * sc, r[2] + c.z * sc);
      o.rotation.set(c.rx, c.ry, c.rz);
      o.scale.set(c.sx, c.sy, c.sz);
    }
  }
  if (opts.angry) model.setAngry(true);
  model.evaluate(0);
  if (!spec.size) {
    group.updateMatrixWorld(true);
    const bb = new THREE.Box3(), tb = new THREE.Box3();
    for (const k in parts) {
      const o = parts[k];
      if (!o.isMesh || !o.visible) continue;
      tb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      bb.union(tb);
    }
    spec.size = { w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y, l: bb.max.z - bb.min.z };
  }
  model.size = { w: spec.size.w, h: spec.size.h, l: spec.size.l };
  return model;
}

// ------------------------------------------------------------------ 动作小工具（幅度单位：设计坐标，位置会乘 sc）
/** 四足小跑：对角腿同相。 */
function trot(p, ph, amp, lift) {
  const a = sin(ph) * amp, b = sin(ph + PI) * amp;
  p.legFL.rx = a; p.legBR.rx = a; p.legFR.rx = b; p.legBL.rx = b;
  const la = max(0, -cos(ph)) * lift, lb = max(0, cos(ph)) * lift;
  p.legFL.y = la; p.legBR.y = la; p.legFR.y = lb; p.legBL.y = lb;
}
function biped(p, ph, amp, lift) {
  p.legL.rx = sin(ph) * amp; p.legR.rx = sin(ph + PI) * amp;
  p.legL.y = max(0, -cos(ph)) * lift; p.legR.y = max(0, cos(ph)) * lift;
}

/** 四足动物通用动作（idle / run / scared / sleep），各动物用参数微调。 */
function quadActs(o) {
  const legs = ['legFL', 'legFR', 'legBL', 'legBR'];
  return {
    idle(p, t) {
      p.root.y = sin(t * 2) * 0.004;
      p.body.sy = 1 + sin(t * 2) * 0.012;
      p.head.rx = (o.headIdle || 0) + sin(t * 1.1) * 0.06 + max(0, sin(t * 0.37)) * (o.graze || 0);
      p.head.ry = sin(t * 0.6) * 0.25;
      p.tail.rz = sin(t * 3) * (o.tailWag || 0.3);
    },
    run(p, t, m) {
      const ph = m.phase;
      trot(p, ph, o.amp, o.lift);
      p.root.y = abs(cos(ph)) * o.bob;
      p.body.rx = o.pitch || 0; p.body.rz = sin(ph) * 0.03;
      p.head.rx = (o.headRun || 0) + sin(ph * 2) * 0.05;
      p.tail.rx = 0.4; p.tail.rz = sin(ph) * 0.35;
      if (o.headY) { p.head.y = o.headY; p.head.z = o.headZ || 0; }
    },
    scared(p, t) {
      const ph = t * 16;
      p.root.y = abs(sin(t * 8)) * o.hop;
      p.legFL.rx = -0.8 + sin(ph) * 0.35; p.legFR.rx = -0.8 + sin(ph + 1) * 0.35;
      p.legBL.rx = 0.5 + sin(ph + 2) * 0.35; p.legBR.rx = 0.5 + sin(ph + 3) * 0.35;
      p.body.rx = -0.2; p.body.rz = sin(t * 40) * 0.035;
      p.body.sx = 1.08; p.body.sy = 1.08; p.body.sz = 1.08; // 炸毛：整个鼓起来
      p.head.rx = -0.35 + (o.scaredHead || 0); p.head.rz = sin(t * 30) * 0.06;
      p.tail.rx = 0.9; p.tail.rz = sin(t * 28) * 0.3;
    },
    sleep(p, t) {
      p.root.y = -o.L * 0.9;
      for (const l of legs) { p[l].sy = 0.1; p[l].rx = 0; }
      p.body.sy = 1 + sin(t * 1.6) * 0.025; p.body.sx = 1 + sin(t * 1.6) * 0.012;
      p.head.rx = o.sleepHead; p.head.ry = 0.55; p.head.y = o.sleepHeadY || 0; p.head.z = o.sleepHeadZ || 0;
      p.tail.rz = 0.2;
    },
    jump: o.jump ? (p, t) => {
      const c = (t * 1.4) % 1, air = sin(c * PI);
      p.root.y = air * o.jump;
      p.body.sy = 1 + (c < 0.15 ? -0.1 * (1 - c / 0.15) : 0);
      p.legFL.rx = -0.9 * air; p.legFR.rx = -0.9 * air; p.legBL.rx = 0.8 * air; p.legBR.rx = 0.8 * air;
      p.head.rx = -0.25 * air; p.body.rx = -0.12 * air;
    } : undefined,
  };
}

/** 双足鸟通用动作（idle / run / scared / sleep）。 */
function birdActs(o) {
  return {
    idle(p, t) {
      p.root.y = sin(t * 2.4) * 0.004;
      p.head.rx = sin(t * 1.4) * 0.07 + (o.headIdle || 0); p.head.ry = sin(t * 0.7) * 0.3;
      p.head.z = max(0, sin(t * 3.2)) * (o.bobZ || 0.005);
      p.wingL.rz = sin(t * 1.5) * 0.04; p.wingR.rz = -sin(t * 1.5) * 0.04;
    },
    run(p, t, m) {
      const ph = m.phase;
      biped(p, ph, o.amp, o.lift);
      p.root.y = abs(cos(ph)) * o.bob; p.body.rx = o.pitch;
      p.head.rx = o.headRun + sin(ph * 2) * 0.06; p.head.z = sin(ph * 2) * (o.headBob || 0.01);
      p.root.rz = sin(ph) * (o.roll || 0.05);
      const f = o.wingRun + sin(ph * 2) * 0.3;
      p.wingL.rz = f; p.wingR.rz = -f;
      if (o.headRunY) p.head.y = o.headRunY;
      if (o.headRunZ) p.head.z += o.headRunZ;
      if (o.wingRunRy) { p.wingL.ry = -o.wingRunRy; p.wingR.ry = o.wingRunRy; }
    },
    scared(p, t) {
      const f = 1.15 + sin(t * 46) * 0.55;
      p.wingL.rz = f; p.wingR.rz = -f; p.wingL.ry = -0.3; p.wingR.ry = 0.3;
      p.root.y = abs(sin(t * 7)) * o.hop;
      p.body.rx = -0.2; p.head.rx = -0.4 + (o.scaredHead || 0); p.head.z = o.scaredZ || 0; p.head.rz = sin(t * 33) * 0.08;
      p.legL.rx = 0.5 + sin(t * 20) * 0.5; p.legR.rx = 0.5 + sin(t * 20 + PI) * 0.5;
      p.body.sx = 1.06; p.body.sy = 1.06; p.body.sz = 1.06;
    },
    sleep(p, t) {
      p.root.y = -o.L * 0.88;
      p.legL.sy = 0.1; p.legR.sy = 0.1;
      p.body.sy = 1 + sin(t * 1.8) * 0.03; p.body.sz = 1 + sin(t * 1.8) * 0.015;
      p.head.rx = 0.5; p.head.ry = o.sleepTurn || 2.3; p.head.y = -(o.sleepDrop || 0.04); p.head.z = -(o.sleepBack || 0.03);
      p.wingL.rz = 0.12; p.wingR.rz = -0.12;
    },
  };
}

// ================================================================== 小鸡（目标高 0.3）
function chickDef() {
  const Y = 0xffd84a, YD = 0xf0b030, YL = 0xffe98a, O = 0xf28a1c;
  const body = (b) => {
    b.ball(Y, [0, 0.15, -0.01], [0.135, 0.125, 0.145]);
    b.ball(YL, [0, 0.115, 0.05], [0.1, 0.085, 0.1]);        // 浅色肚皮
    b.ball(YD, [0, 0.2, -0.15], 0.05);                      // 尾巴尖
    b.ball(YD, [0, 0.235, -0.13], [0.025, 0.04, 0.03]);
  };
  const head = (b) => {
    b.ball(Y, [0, 0.29, 0.07], [0.125, 0.12, 0.12]);        // 大脑袋
    for (const [x, z, r] of [[0, 0.04, 0.026], [0.025, 0.03, 0.02], [-0.025, 0.03, 0.02]]) b.ball(YD, [x, 0.405, z], r); // 头顶一撮毛
    b.cone(O, [0, 0.272, 0.195], [0.036, 0.062, 0.036], [PI / 2, 0, 0]);  // 橙色小尖喙
    b.pair((s) => {
      b.ball(INK, [0.062 * s, 0.315, 0.152], [0.021, 0.025, 0.018]);       // 眼睛
      b.ball(WHITE, [0.056 * s, 0.326, 0.168], 0.008);
      b.ball(0xff9f8a, [0.098 * s, 0.268, 0.118], [0.024, 0.019, 0.02]);   // 腮红
    });
  };
  const wing = (s) => (b) => b.ball(YD, [0.128 * s, 0.158, -0.02], [0.032, 0.068, 0.088], [0, 0, 0.35 * s]);
  const leg = (s) => (b) => {
    b.cyl(O, [0.048 * s, 0.035, 0], [0.013, 0.07, 0.013]);
    b.ball(O, [0.048 * s, 0.012, 0.026], [0.032, 0.012, 0.048]);
    b.ball(O, [0.048 * s + 0.018 * s, 0.01, 0.045], [0.012, 0.01, 0.025]);
    b.ball(O, [0.048 * s - 0.018 * s, 0.01, 0.045], [0.012, 0.01, 0.025]);
  };
  const acts = birdActs({ amp: 1.1, lift: 0.015, bob: 0.02, pitch: 0.18, headRun: -0.05, wingRun: 0.7, hop: 0.12, L: 0.07, roll: 0.07, bobZ: 0.004, sleepDrop: 0.03, sleepBack: 0.02 });
  acts.flap = (p, t) => {
    const c = (t * 1.6) % 1, air = sin(c * PI);
    p.root.y = air * 0.18;
    const f = 1.1 + sin(t * 40) * 0.45;
    p.wingL.rz = f; p.wingR.rz = -f; p.wingL.ry = 0.2; p.wingR.ry = -0.2;
    p.body.rx = -0.2 * air; p.legL.rx = 0.5 * air; p.legR.rx = 0.5 * air; p.head.rx = -0.15 * air;
  };
  return {
    sc: 0.78, runSpeed: 1.5, stride: 0.2,
    parts: [
      part('body', [0, 0.15, 0], body),
      part('head', [0, 0.25, 0.04], head, { parent: 'body' }),
      part('wingL', [0.115, 0.2, -0.02], wing(1), { parent: 'body' }),
      part('wingR', [-0.115, 0.2, -0.02], wing(-1), { parent: 'body' }),
      part('legL', [0.048, 0.07, 0], leg(1)),
      part('legR', [-0.048, 0.07, 0], leg(-1)),
    ],
    actions: acts,
  };
}

// ================================================================== 母鸡（目标高 0.55）
function henDef() {
  const W = 0xfdf8ee, WS = 0xe6dccb, WL = 0xcfc6dc, R = 0xe0362c, O = 0xf5a623;
  const body = (b) => {
    b.ball(W, [0, 0.27, -0.03], [0.19, 0.18, 0.24]);
    b.ball(WS, [0, 0.2, 0.03], [0.15, 0.1, 0.19]);              // 肚子暗一档
    b.ball(W, [0, 0.36, 0.14], [0.13, 0.15, 0.13]);             // 胸脯到脖子
    for (const [dx, a] of [[0, 0], [0.07, 0.35], [-0.07, -0.35]]) b.ball(dx ? W : WS, [dx, 0.42, -0.24], [0.04, 0.15, 0.07], [-0.6, 0, a]); // 翘起的尾羽
  };
  const head = (b) => {
    b.ball(W, [0, 0.51, 0.19], [0.105, 0.105, 0.105]);
    for (const [dz, r] of [[0.25, 0.035], [0.19, 0.047], [0.13, 0.035]]) b.ball(R, [0, 0.615 - Math.abs(dz - 0.19) * 0.4, dz], [0.026, r, r]); // 鸡冠
    b.ball(R, [0, 0.43, 0.275], [0.026, 0.047, 0.03]);          // 肉垂
    b.cone(O, [0, 0.5, 0.3], [0.036, 0.07, 0.036], [PI / 2, 0, 0]);
    b.pair((s) => { b.ball(INK, [0.07 * s, 0.535, 0.24], [0.02, 0.024, 0.018]); b.ball(WHITE, [0.066 * s, 0.545, 0.252], 0.007); });
  };
  const wing = (s) => (b) => {
    b.ball(WS, [0.175 * s, 0.27, -0.04], [0.05, 0.11, 0.16], [0, 0, 0.3 * s]);
    b.ball(WL, [0.185 * s, 0.2, -0.06], [0.04, 0.05, 0.12], [0, 0, 0.3 * s]);
  };
  const leg = (s) => (b) => {
    b.cyl(O, [0.07 * s, 0.06, 0], [0.018, 0.12, 0.018]);
    b.ball(O, [0.07 * s, 0.014, 0.04], [0.05, 0.014, 0.07]);
  };
  const acts = birdActs({ amp: 1.0, lift: 0.03, bob: 0.03, pitch: 0.12, headRun: -0.1, wingRun: 0.5, hop: 0.2, L: 0.12, headBob: 0.025, headIdle: 0.05, sleepDrop: 0.05, sleepBack: 0.03 });
  acts.peck = (p, t) => {
    const c = (t * 2.6) % 1;
    const k = c < 0.5 ? sin(c / 0.5 * PI) : 0;
    p.body.rx = 0.5 * k; p.head.rx = 0.7 * k + 0.1; p.head.z = 0.05 * k; p.head.y = -0.03 * k;
    p.root.z = 0.02 * k; p.root.y = -0.01 * k;
    p.wingL.rz = 0.12; p.wingR.rz = -0.12; p.legL.rx = -0.2 * k; p.legR.rx = -0.2 * k;
  };
  return {
    sc: 0.85, runSpeed: 1.8, stride: 0.34,
    parts: [
      part('body', [0, 0.3, 0], body),
      part('head', [0, 0.45, 0.16], head, { parent: 'body' }),
      part('wingL', [0.15, 0.34, -0.04], wing(1), { parent: 'body' }),
      part('wingR', [-0.15, 0.34, -0.04], wing(-1), { parent: 'body' }),
      part('legL', [0.07, 0.12, 0], leg(1)),
      part('legR', [-0.07, 0.12, 0], leg(-1)),
    ],
    actions: acts,
  };
}

// ================================================================== 绿头鸭（目标高 0.5）
function duckDef() {
  const B = 0x8b5a34, BD = 0x6a4126, BL = 0xa8723e, G = 0x2e9a5c, GL = 0x44b872, CH = 0x7a4228, CREAM = 0xdcd2b8, BILL = 0xf0b020, O = 0xf08c22;
  const body = (b) => {
    b.ball(B, [0, 0.2, -0.03], [0.17, 0.14, 0.25]);
    b.ball(CREAM, [0, 0.14, 0.0], [0.13, 0.08, 0.2]);            // 浅色肚皮
    b.ball(CH, [0, 0.24, 0.12], [0.14, 0.12, 0.12]);             // 栗色胸
    b.ball(BL, [0, 0.27, -0.08], [0.12, 0.07, 0.17]);            // 背上亮一档
    b.cone(BD, [0, 0.27, -0.27], [0.06, 0.13, 0.05], [-1.1, 0, 0]); // 翘起的尾
    b.ball(INK, [0, 0.3, -0.31], [0.04, 0.05, 0.035]);
  };
  const head = (b) => {
    b.ball(G, [0, 0.335, 0.125], [0.075, 0.08, 0.075]);          // 脖子
    b.ring(0xf6f1e4, [0, 0.285, 0.115], [0.075, 0.075, 0.075], [PI / 2 + 0.25, 0, 0]); // 白颈环
    b.ball(G, [0, 0.4, 0.155], [0.105, 0.1, 0.105]);
    b.ball(GL, [0, 0.44, 0.14], [0.07, 0.04, 0.07]);
    b.ball(BILL, [0, 0.378, 0.27], [0.05, 0.022, 0.07]);          // 扁嘴
    b.ball(mix(BILL, 0xc88010, 0.5), [0, 0.365, 0.265], [0.046, 0.012, 0.062]);
    b.pair((s) => { b.ball(INK, [0.075 * s, 0.415, 0.2], [0.018, 0.022, 0.016]); b.ball(WHITE, [0.072 * s, 0.424, 0.211], 0.006); });
  };
  const wing = (s) => (b) => {
    b.ball(BD, [0.155 * s, 0.22, -0.03], [0.045, 0.1, 0.17], [0, 0, 0.25 * s]);
    b.ball(0x3d63a8, [0.178 * s, 0.2, -0.1], [0.012, 0.03, 0.06], [0, 0, 0.25 * s]);
    b.ball(0xffffff, [0.18 * s, 0.2, -0.04], [0.012, 0.012, 0.03], [0, 0, 0.25 * s]);
  };
  const leg = (s) => (b) => {
    b.cyl(O, [0.065 * s, 0.045, -0.01], [0.016, 0.09, 0.016]);
    b.ball(O, [0.065 * s, 0.01, 0.025], [0.05, 0.011, 0.07]);
  };
  const acts = birdActs({ amp: 0.85, lift: 0.025, bob: 0.015, pitch: 0.08, headRun: -0.05, wingRun: 0.25, hop: 0.2, L: 0.09, roll: 0.14, scaredHead: -0.1, sleepDrop: 0.05, sleepBack: 0.04 });
  acts.quack = (p, t) => {
    const k = max(0, sin(t * 11)) * (sin(t * 2.2) > -0.3 ? 1 : 0);
    p.head.rx = -0.5 * k + 0.1; p.head.y = 0.02 * k;
    p.body.rx = -0.12 * k; p.wingL.rz = 0.12 * k; p.wingR.rz = -0.12 * k;
  };
  return {
    sc: 1, runSpeed: 1.2, stride: 0.22,
    parts: [
      part('body', [0, 0.2, 0], body),
      part('head', [0, 0.3, 0.12], head, { parent: 'body' }),
      part('wingL', [0.15, 0.27, -0.03], wing(1), { parent: 'body' }),
      part('wingR', [-0.15, 0.27, -0.03], wing(-1), { parent: 'body' }),
      part('legL', [0.065, 0.09, 0], leg(1)),
      part('legR', [-0.065, 0.09, 0], leg(-1)),
    ],
    actions: acts,
  };
}

// ================================================================== 大鹅（目标高 0.85）
function gooseDef() {
  const W = 0xfbf7ee, WS = 0xe4dccb, WL = 0xc9c6de, BILL = 0xf29a2e, O = 0xf08c22;
  const body = (b) => {
    b.ball(W, [0, 0.38, -0.05], [0.2, 0.19, 0.3]);
    b.ball(WS, [0, 0.3, -0.02], [0.16, 0.1, 0.25]);
    b.ball(W, [0, 0.43, 0.2], [0.14, 0.15, 0.13]);              // 胸
    b.cone(WS, [0, 0.46, -0.37], [0.09, 0.2, 0.06], [-1.15, 0, 0]);   // 翘尾
  };
  const head = (b) => {
    b.ball(W, [0, 0.52, 0.24], [0.075, 0.09, 0.075]);           // 脖子，S 形向前上方
    b.ball(W, [0, 0.62, 0.27], [0.062, 0.1, 0.062]);
    b.ball(W, [0, 0.72, 0.29], [0.06, 0.1, 0.06]);
    b.ball(WS, [0, 0.55, 0.2], [0.04, 0.09, 0.04]);
    b.ball(W, [0, 0.8, 0.31], [0.08, 0.075, 0.1]);              // 头
    b.cone(BILL, [0, 0.785, 0.425], [0.042, 0.1, 0.042], [PI / 2, 0, 0]);
    b.ball(mix(BILL, 0xc06010, 0.4), [0, 0.835, 0.385], [0.03, 0.02, 0.04]);  // 喙根的隆起
    b.pair((s) => { b.ball(INK, [0.062 * s, 0.82, 0.36], [0.016, 0.02, 0.014]); b.ball(WHITE, [0.059 * s, 0.828, 0.37], 0.005); });
  };
  const wing = (s) => (b) => {
    b.ball(W, [0.2 * s, 0.4, -0.05], [0.055, 0.14, 0.24], [0, 0, 0.18 * s]);
    b.ball(WL, [0.215 * s, 0.33, -0.12], [0.045, 0.07, 0.17], [0, 0, 0.18 * s]);
  };
  const leg = (s) => (b) => {
    b.cyl(O, [0.08 * s, 0.1, 0.0], [0.02, 0.2, 0.02]);
    b.ball(O, [0.08 * s, 0.012, 0.04], [0.05, 0.013, 0.085]);
  };
  const acts = birdActs({ amp: 0.9, lift: 0.04, bob: 0.03, pitch: 0.12, headRun: 1.25, headRunY: -0.12, headRunZ: 0.08, wingRun: 0.95, wingRunRy: 0.25, hop: 0.25, L: 0.2, roll: 0.06, headIdle: 0, scaredHead: -0.2, sleepDrop: 0.15, sleepBack: 0.1 });
  acts.honk = (p, t) => {
    const c = (t * 1.4) % 1;
    const k = smooth(min(c / 0.15, 1)) * (1 - smooth((c - 0.55) / 0.2));
    p.head.rx = -0.65 * k; p.head.y = 0.05 * k; p.head.z = -0.03 * k; p.head.rz = sin(t * 30) * 0.06 * k;
    p.body.rx = -0.12 * k;
    const f = 0.55 * k + sin(t * 24) * 0.12 * k;
    p.wingL.rz = f; p.wingR.rz = -f;
  };
  // 受惊：脖子竖起来、翅膀张开
  const sc0 = acts.scared;
  acts.scared = (p, t) => { sc0(p, t); p.head.rx = -0.5; p.head.y = 0.06; p.head.z = -0.02; };
  return {
    sc: 1, runSpeed: 2.4, stride: 0.5,
    parts: [
      part('body', [0, 0.38, 0], body),
      part('head', [0, 0.46, 0.2], head, { parent: 'body' }),
      part('wingL', [0.2, 0.52, -0.05], wing(1), { parent: 'body' }),
      part('wingR', [-0.2, 0.52, -0.05], wing(-1), { parent: 'body' }),
      part('legL', [0.08, 0.2, 0], leg(1)),
      part('legR', [-0.08, 0.2, 0], leg(-1)),
    ],
    actions: acts,
  };
}

// ================================================================== 猪（目标高 0.7，长 1.1）
function pigDef() {
  const P = 0xf7a8b8, PD = 0xe57f96, PL = 0xfcc6d0, PB = 0xeb8fa4;
  const body = (b) => {
    b.ball(P, [0, 0.36, -0.05], [0.3, 0.27, 0.4]);
    b.ball(PB, [0, 0.27, -0.04], [0.25, 0.14, 0.34]);           // 肚子暗一档
    b.ball(PL, [0, 0.5, -0.1], [0.2, 0.1, 0.26]);               // 背上亮一档
    b.ball(P, [0, 0.38, 0.22], [0.26, 0.24, 0.2]);              // 颈肩，和头连起来
  };
  const head = (b) => {
    b.ball(P, [0, 0.4, 0.38], [0.245, 0.23, 0.22]);
    b.cyl(PD, [0, 0.36, 0.585], [0.11, 0.08, 0.1], [PI / 2, 0, 0]); // 鼻子
    b.cyl(PL, [0, 0.36, 0.63], [0.095, 0.01, 0.085], [PI / 2, 0, 0]);
    b.pair((s) => {
      b.ball(0x7a3346, [0.04 * s, 0.37, 0.64], [0.02, 0.03, 0.012]);                 // 鼻孔
      b.ball(INK, [0.125 * s, 0.47, 0.545], [0.026, 0.032, 0.02]);                    // 眼
      b.ball(WHITE, [0.12 * s, 0.482, 0.558], 0.008);
      b.cone(PD, [0.17 * s, 0.62, 0.36], [0.075, 0.13, 0.045], [0.5, 0, -0.5 * s]);  // 耳朵
      b.cone(PL, [0.165 * s, 0.6, 0.375], [0.045, 0.08, 0.03], [0.5, 0, -0.5 * s]);
      b.ball(PL, [0.2 * s, 0.38, 0.5], [0.045, 0.036, 0.04]);                         // 腮红
    });
  };
  const leg = (x, z) => (b) => {
    b.cyl(P, [x, 0.09, z], [0.065, 0.18, 0.065]);
    b.cyl(0x8d5360, [x, 0.02, z], [0.068, 0.04, 0.068]);
  };
  const acts = quadActs({ amp: 0.85, lift: 0.04, bob: 0.03, pitch: -0.04, headRun: 0.05, hop: 0.12, L: 0.18, sleepHead: 0.45, sleepHeadY: -0.05, tailWag: 0.4, graze: 0.35 });
  return {
    sc: 1, runSpeed: 2.0, stride: 0.45,
    parts: [
      part('body', [0, 0.36, 0], body),
      part('head', [0, 0.4, 0.2], head, { parent: 'body' }),
      part('legFL', [0.16, 0.18, 0.2], leg(0.16, 0.2)),
      part('legFR', [-0.16, 0.18, 0.2], leg(-0.16, 0.2)),
      part('legBL', [0.16, 0.18, -0.26], leg(0.16, -0.26)),
      part('legBR', [-0.16, 0.18, -0.26], leg(-0.16, -0.26)),
      part('tail', [0, 0.45, -0.42], (b) => b.ring(PD, [0, 0.45, -0.45], [0.045, 0.045, 0.045], [0, PI / 2, 0]), { parent: 'body' }),
    ],
    actions: acts,
  };
}

// ================================================================== 绵羊（目标高 0.8）
function sheepDef() {
  const W = 0xfbf7ee, WS = 0xe9e1d2, WB = 0xd9d3e4, F = 0xe2c6a0, FD = 0xc9a67c, K = 0x3a2d28;
  const body = (b) => {
    const puffs = [[0, 0.42, 0, 0.3], [0.17, 0.46, 0.14, 0.2], [-0.17, 0.46, 0.14, 0.2], [0.18, 0.44, -0.16, 0.21], [-0.18, 0.44, -0.16, 0.21], [0, 0.58, 0.05, 0.2], [0, 0.56, -0.18, 0.19], [0, 0.42, -0.3, 0.19], [0.1, 0.3, 0.05, 0.2], [-0.1, 0.3, 0.05, 0.2], [0, 0.34, -0.2, 0.2]];
    puffs.forEach(([x, y, z, r], i) => b.ball(y < 0.36 ? WB : i % 3 === 2 ? WS : W, [x, y, z], r));
  };
  const head = (b) => {
    b.ball(F, [0, 0.47, 0.36], [0.14, 0.155, 0.155]);
    b.ball(FD, [0, 0.42, 0.44], [0.1, 0.08, 0.1]);
    b.ball(W, [0, 0.61, 0.3], [0.14, 0.085, 0.11]);             // 头顶的毛
    b.ball(WS, [0, 0.57, 0.4], [0.1, 0.05, 0.05]);              // 刘海
    b.pair((s) => {
      b.ball(F, [0.16 * s, 0.5, 0.31], [0.075, 0.037, 0.045], [0, 0, -0.3 * s]);        // 耳朵
      b.ball(FD, [0.16 * s, 0.495, 0.325], [0.05, 0.02, 0.03], [0, 0, -0.3 * s]);
      b.ball(K, [0.07 * s, 0.5, 0.49], [0.022, 0.028, 0.02]);
      b.ball(WHITE, [0.066 * s, 0.51, 0.503], 0.007);
    });
    b.ball(0xd08a7a, [0, 0.43, 0.505], [0.032, 0.022, 0.022]);  // 鼻子
  };
  const leg = (x, z) => (b) => {
    b.cyl(K, [x, 0.09, z], [0.04, 0.18, 0.04]);
    b.cyl(0x241a17, [x, 0.015, z], [0.044, 0.03, 0.044]);
  };
  const acts = quadActs({ amp: 0.9, lift: 0.04, bob: 0.035, pitch: -0.03, headRun: 0.0, hop: 0.2, L: 0.18, jump: 0.28, sleepHead: 0.35, sleepHeadY: -0.03, tailWag: 0, graze: 0.4 });
  return {
    sc: 1.1, runSpeed: 2.2, stride: 0.42,
    parts: [
      part('body', [0, 0.42, 0], body),
      part('head', [0, 0.47, 0.3], head, { parent: 'body' }),
      part('legFL', [0.13, 0.18, 0.16], leg(0.13, 0.16)),
      part('legFR', [-0.13, 0.18, 0.16], leg(-0.13, 0.16)),
      part('legBL', [0.13, 0.18, -0.18], leg(0.13, -0.18)),
      part('legBR', [-0.13, 0.18, -0.18], leg(-0.13, -0.18)),
      part('tail', [0, 0.45, -0.3], (b) => b.ball(W, [0, 0.43, -0.37], [0.07, 0.07, 0.06]), { parent: 'body' }),
    ],
    actions: acts,
  };
}

// ================================================================== 奶牛 / 公牛（奶牛目标高 1.3 长 1.9；公牛 1.4）
function cowDef(isBull) {
  const k = isBull ? 1 : 0;
  const Wh = isBull ? 0x8f4e2c : 0xf6f3ee, WhS = isBull ? 0x6f3a20 : 0xe3dde2, WhL = isBull ? 0xa8643a : 0xffffff;
  const Bk = isBull ? 0x6f3a20 : 0x38322f;
  const PINK = isBull ? 0xd9a6a0 : 0xf2a0b4, HORN = 0xefe0b8, HOOF = 0x4a3c38;
  const bc = isBull ? [0, 0.95, -0.05] : [0, 0.8, -0.05], br = isBull ? [0.4, 0.36, 0.68] : [0.36, 0.32, 0.64];
  const legLen = isBull ? 0.6 : 0.5;
  const hz = isBull ? 0.7 : 0.62, hy = isBull ? 1.07 : 0.93;
  const hc = [0, hy - 0.02, hz + 0.2], hr = isBull ? [0.24, 0.23, 0.26] : [0.21, 0.2, 0.23];
  const body = (b) => {
    b.ball(Wh, bc, br);
    b.ball(WhS, [bc[0], bc[1] - 0.12, bc[2] + 0.02], [br[0] * 0.9, br[1] * 0.6, br[2] * 0.9]); // 肚子暗一档
    b.ball(WhL, [bc[0], bc[1] + 0.14, bc[2] - 0.05], [br[0] * 0.75, br[1] * 0.55, br[2] * 0.8]);  // 背上亮一档
    b.ball(Wh, [0, hy - 0.05, hz - 0.02], [br[0] * 0.8, br[1] * 0.85, 0.28]);                    // 颈肩
    if (isBull) {
      b.ball(Wh, [0, 1.2, 0.3], [0.3, 0.2, 0.27]); b.ball(WhL, [0, 1.27, 0.28], [0.22, 0.12, 0.2]); // 肩峰
    } else {
      b.ball(PINK, [0, 0.55, -0.37], [0.12, 0.08, 0.14]);        // 乳房
      for (const [dir, r] of [[[0.8, 0.5, 0.2], 0.14], [[-0.7, 0.55, -0.5], 0.16], [[0.6, 0.6, -0.7], 0.13], [[-0.9, 0.1, 0.3], 0.11], [[0.2, 1, 0.3], 0.1], [[-0.2, 1, -0.5], 0.09], [[0.95, -0.1, -0.35], 0.1]]) b.patch(Bk, bc, br, dir, r);
    }
  };
  const head = (b) => {
    b.ball(Wh, hc, hr);
    b.ball(isBull ? 0xc9a07a : PINK, [0, hc[1] - 0.09, hc[2] + 0.2], [0.16 + k * 0.01, 0.12, 0.11]);   // 嘴鼻
    b.ball(isBull ? 0xb98a68 : 0xe88aa0, [0, hc[1] - 0.12, hc[2] + 0.22], [0.15, 0.07, 0.1]);
    b.pair((s) => {
      b.ball(isBull ? 0x3a2418 : 0xb86478, [0.05 * s, hc[1] - 0.06, hc[2] + 0.3], [0.018, 0.026, 0.014]); // 鼻孔
      b.ball(INK, [0.12 * s, hc[1] + 0.06, hc[2] + 0.1], [0.03, 0.038, 0.024]);     // 眼
      b.ball(WHITE, [0.116 * s, hc[1] + 0.075, hc[2] + 0.12], 0.011);
      b.ball(isBull ? WhS : (s > 0 ? PINK : Bk), [0.28 * s, hc[1] + 0.08, hc[2] - 0.05], [0.11, 0.04, 0.065], [0, 0, -0.3 * s]); // 耳朵
    });
    if (isBull) {
      b.ball(0xf2e8d8, [0, hc[1] + 0.07, hc[2] + 0.2], [0.07, 0.09, 0.07]); b.ball(0xf2e8d8, [0, hc[1] - 0.02, hc[2] + 0.27], [0.05, 0.1, 0.05]); // 白斑
      b.ring(0xf3c63a, [0, hc[1] - 0.2, hc[2] + 0.31], [0.05, 0.05, 0.05], [0, 0, 0]);      // 鼻环
      b.pair((s) => {                                                   // 弯角
        b.cone(HORN, [0.22 * s, hc[1] + 0.2, hc[2] - 0.02], [0.045, 0.14, 0.045], [0, 0, -1.25 * s]);
        b.cone(HORN, [0.34 * s, hc[1] + 0.26, hc[2] - 0.02], [0.04, 0.16, 0.04], [0, 0, -0.15 * s]);
      });
    } else {
      b.patch(Bk, hc, hr, [1, 0.4, 0.5], 0.1);                          // 一只眼睛上的色斑
      b.patch(Bk, hc, hr, [-0.2, 1, -0.1], 0.07);
      b.pair((s) => b.cone(HORN, [0.14 * s, hc[1] + 0.2, hc[2] - 0.02], [0.03, 0.09, 0.03], [0, 0, -0.5 * s]));
    }
  };
  const leg = (x, z) => (b) => {
    b.cyl(isBull ? Wh : (hash2(x, z) ? Bk : Wh), [x, legLen / 2 + 0.02, z], [0.09 + k * 0.01, legLen - 0.04, 0.09 + k * 0.01]);
    b.cyl(isBull ? WhS : WhS, [x, 0.12, z], [0.093 + k * 0.01, 0.2, 0.093 + k * 0.01]);
    b.cyl(HOOF, [x, 0.03, z], [0.097 + k * 0.01, 0.06, 0.097 + k * 0.01]);
  };
  const tail = (b) => {
    const z = bc[2] - br[2] - 0.02, y0 = bc[1] + 0.15;
    b.cyl(Wh, [0, y0 - 0.28, z], [0.016, 0.56, 0.016]);
    b.ball(Bk, [0, y0 - 0.6, z], [0.05, 0.09, 0.05]);
  };
  const lx = br[0] * 0.56, zf = br[2] * 0.62, zb = -br[2] * 0.6;
  const acts = quadActs({ amp: 0.7, lift: 0.05, bob: 0.035, pitch: isBull ? 0.08 : -0.03, headRun: isBull ? 0.75 : 0.1, headY: isBull ? -0.1 : 0, headZ: isBull ? 0.06 : 0, hop: 0.12, L: legLen, sleepHead: 0.5, sleepHeadY: -0.05, sleepHeadZ: 0.05, tailWag: 0.35, graze: 0.2, headIdle: -0.12, scaredHead: isBull ? 0.2 : 0 });
  return {
    sc: 1, runSpeed: isBull ? 3.0 : 1.7, stride: isBull ? 0.9 : 0.8,
    parts: [
      part('body', [0, bc[1], 0], body),
      part('head', [0, hy - 0.05, hz - 0.02], head, { parent: 'body' }),
      part('legFL', [lx, legLen, zf], leg(lx, zf)),
      part('legFR', [-lx, legLen, zf], leg(-lx, zf)),
      part('legBL', [lx, legLen, zb], leg(lx, zb)),
      part('legBR', [-lx, legLen, zb], leg(-lx, zb)),
      part('tail', [0, bc[1] + 0.15, bc[2] - br[2] - 0.02], tail, { parent: 'body' }),
    ],
    actions: acts,
  };
}
const hash2 = (x, z) => ((Math.round(x * 10) * 7 + Math.round(z * 10) * 3) & 3) === 0; // 奶牛腿上的黑白分布

// ================================================================== 羊驼（目标高 1.5）
function alpacaDef() {
  const A = 0x9b6238, AD = 0x754526, AL = 0xb97a48, C = 0xf3e6c9, CD = 0xd9cbe0, CH = 0xfff6dd, NOSE = 0x6b4a34;
  const body = (b) => {
    b.ball(A, [0, 0.8, -0.02], [0.27, 0.26, 0.42]);
    b.ball(AD, [0, 0.68, 0.0], [0.23, 0.14, 0.36]);              // 肚子暗一档
    b.ball(AL, [0, 0.95, -0.06], [0.2, 0.1, 0.32]);              // 背上亮一档
    for (const [x, y, z, r] of [[0.16, 0.9, 0.12, 0.1], [-0.16, 0.9, 0.12, 0.1], [0.12, 0.92, -0.2, 0.1], [-0.12, 0.92, -0.2, 0.1]]) b.ball(AL, [x, y, z], r); // 蓬松的毛团
    b.ball(A, [0, 0.9, 0.28], [0.2, 0.2, 0.15]);                 // 胸
    b.ball(C, [0, 0.82, -0.4], [0.1, 0.12, 0.1]);                // 毛绒绒的小尾巴
    b.ball(CH, [0, 0.86, -0.42], 0.06);
  };
  const head = (b) => {
    b.ball(A, [0, 0.98, 0.26], [0.15, 0.13, 0.12]);              // 脖根（棕色）
    b.ball(C, [0, 1.1, 0.29], [0.1, 0.13, 0.09]);                // 米白长脖子
    b.ball(C, [0, 1.22, 0.31], [0.088, 0.12, 0.085]);
    b.ball(CD, [0, 1.12, 0.24], [0.06, 0.12, 0.05]);
    b.ball(C, [0, 1.34, 0.33], [0.088, 0.12, 0.085]);
    b.ball(C, [0, 1.5, 0.38], [0.12, 0.12, 0.145]);              // 头
    b.ball(CH, [0, 1.47, 0.49], [0.085, 0.075, 0.08]);           // 吻
    b.ball(NOSE, [0, 1.48, 0.555], [0.042, 0.032, 0.026]);       // 鼻子
    b.ball(A, [0, 1.585, 0.38], [0.105, 0.075, 0.115]);          // 刘海
    b.pair((s) => {
      b.ball(INK, [0.08 * s, 1.52, 0.465], [0.024, 0.032, 0.02]);
      b.ball(WHITE, [0.076 * s, 1.533, 0.48], 0.009);
      b.cone(mix(C, A, 0.3), [0.075 * s, 1.65, 0.33], [0.042, 0.14, 0.032], [0, 0, -0.2 * s]);   // 尖耳
      b.cone(0xe9a89a, [0.075 * s, 1.63, 0.345], [0.024, 0.085, 0.016], [0, 0, -0.2 * s]);
    });
  };
  const leg = (x, z) => (b) => {
    b.cyl(A, [x, 0.33, z], [0.052, 0.66, 0.052]);
    b.cyl(AD, [x, 0.12, z], [0.056, 0.24, 0.056]);
    b.cyl(0x3d2a20, [x, 0.02, z], [0.06, 0.04, 0.06]);
  };
  const acts = quadActs({ amp: 0.5, lift: 0.05, bob: 0.04, pitch: 0.05, headRun: 0.15, hop: 0.2, L: 0.66, sleepHead: 0.75, sleepHeadY: -0.25, sleepHeadZ: 0.05, tailWag: 0.2, graze: 0.2, headIdle: -0.05, scaredHead: -0.1 });
  return {
    sc: 0.93, runSpeed: 2.4, stride: 0.85,
    parts: [
      part('body', [0, 0.8, 0], body),
      part('head', [0, 0.98, 0.26], head, { parent: 'body' }),
      part('legFL', [0.14, 0.66, 0.22], leg(0.14, 0.22)),
      part('legFR', [-0.14, 0.66, 0.22], leg(-0.14, 0.22)),
      part('legBL', [0.14, 0.66, -0.24], leg(0.14, -0.24)),
      part('legBR', [-0.14, 0.66, -0.24], leg(-0.14, -0.24)),
      part('tail', [0, 0.85, -0.38], (b) => b.ball(CH, [0, 0.86, -0.46], 0.01), { parent: 'body' }),
    ],
    actions: acts,
  };
}

// ================================================================== 管理员（戴宽檐草帽的女孩，目标高 1.75）
function keeperDef() {
  const SKIN = 0xf8d3b2, SKIN_D = 0xe6b393, BLUSH = 0xf4958a, HAIR = 0x7b4a2d, HAIR_L = 0x9a6238, HAIR_D = 0x573320;
  const SHIRT = 0xfaf5e8, SHIRT_D = 0xd9d2e4, DENIM = 0x4a7bbf, DENIM_D = 0x395f9a, DENIM_L = 0x6a98d6;
  const SCARF = 0xc4a468, SCARF_D = 0x9e8450, BOOT = 0x70492f, BOOT_D = 0x4e3220;
  const STRAW = 0xe8c35c, STRAW_L = 0xf5dc88, STRAW_D = 0xc4a048, RIBBON = 0xb5483a, EYE = 0x3a2418, HAY = 0xe8c040;
  const body = (b) => {
    b.ball(SHIRT, [0, 0.92, 0], [0.175, 0.2, 0.14]);                   // 白上衣
    b.ball(SHIRT_D, [0, 0.82, -0.03], [0.17, 0.12, 0.13]);
    b.ball(DENIM, [0, 0.7, 0], [0.19, 0.15, 0.155]);                   // 背带裤的裤腰
    b.ball(DENIM_D, [0, 0.64, -0.02], [0.185, 0.1, 0.15]);
    b.ball(DENIM, [0, 0.9, 0.095], [0.12, 0.13, 0.06]);                // 前胸兜
    b.ball(DENIM_L, [0, 0.95, 0.12], [0.09, 0.06, 0.04]);
    b.pair((s) => {
      b.cyl(DENIM, [0.085 * s, 1.0, 0.085], [0.02, 0.2, 0.02], [0.1 * s, 0, 0.1 * s]); // 背带
      b.ball(0xf3c63a, [0.095 * s, 0.93, 0.15], 0.018);                // 金纽扣
    });
    b.ring(SCARF, [0, 1.09, 0.0], [0.135, 0.135, 0.135], [PI / 2, 0, 0]);   // 围巾
    b.ball(SCARF, [0.08, 1.07, 0.1], [0.06, 0.05, 0.05]);
    b.ball(SCARF_D, [0.09, 0.98, 0.13], [0.04, 0.09, 0.025]);          // 围巾垂尾
  };
  const faceBuilder = (angry) => (b) => {
    b.ball(SKIN, [0, 1.28, 0.02], [0.235, 0.225, 0.225]);              // 圆脸大头
    b.ball(SKIN_D, [0, 1.17, 0.04], [0.15, 0.06, 0.15]);
    // 头发：后脑 + 头顶 + 刘海 + 两侧 + 垂到肩后的卷发
    b.ball(HAIR, [0, 1.27, -0.07], [0.27, 0.26, 0.2]);
    b.ball(HAIR_L, [0, 1.38, -0.02], [0.25, 0.17, 0.235]);
    for (const [x, z, y] of [[-0.14, 0.17, 1.41], [-0.07, 0.19, 1.43], [0, 0.2, 1.43], [0.07, 0.19, 1.43], [0.14, 0.17, 1.41], [0.2, 0.1, 1.38], [-0.2, 0.1, 1.38]]) b.ball(HAIR, [x, y, z], 0.075);
    b.pair((s) => { b.ball(HAIR, [0.215 * s, 1.2, 0.0], [0.05, 0.14, 0.09]); b.ball(HAIR_D, [0.22 * s, 1.1, -0.01], [0.055, 0.07, 0.07]); });
    b.ball(HAIR, [0, 1.0, -0.17], [0.26, 0.26, 0.12]);
    for (const [x, y, z, r] of [[-0.16, 0.8, -0.17, 0.085], [0, 0.76, -0.2, 0.09], [0.16, 0.8, -0.17, 0.085], [-0.08, 0.86, -0.19, 0.08], [0.08, 0.85, -0.19, 0.08], [-0.22, 0.9, -0.1, 0.07], [0.22, 0.9, -0.1, 0.07]]) b.ball(HAIR_D, [x, y, z], r);
    for (const [x, y, z, r] of [[-0.12, 0.74, -0.2, 0.06], [0.12, 0.74, -0.2, 0.06]]) b.ball(HAIR_L, [x, y, z], r);
    // 脸
    b.pair((s) => {
      b.ball(EYE, [0.085 * s, 1.265, 0.216], [0.034, angry ? 0.036 : 0.047, 0.025]);
      b.ball(0x6a4430, [0.085 * s, 1.245, 0.226], [0.022, 0.02, 0.012]);
      b.ball(WHITE, [0.094 * s, 1.282, 0.236], 0.011);
      b.ball(WHITE, [0.075 * s, 1.245, 0.236], 0.006);
      b.ball(angry ? 0xe5372f : BLUSH, [0.145 * s, 1.2, 0.17], angry ? [0.058, 0.04, 0.025] : [0.042, 0.026, 0.016]);   // 腮红（生气时更红更大）
      if (angry) b.ball(INK, [0.085 * s, 1.335, 0.21], [0.058, 0.014, 0.02], [0, 0, 0.5 * s]);  // 压低的眉毛
    });
    b.ball(SKIN_D, [0, 1.225, 0.235], [0.018, 0.014, 0.014]);          // 小鼻子
    if (angry) b.ball(0x8a2f26, [0, 1.165, 0.215], [0.04, 0.012, 0.015], [0, 0, 0]);   // 抿紧的嘴
    else { b.ball(0xa84a3a, [0, 1.17, 0.215], [0.025, 0.012, 0.014]); b.ball(0xe88070, [0, 1.162, 0.218], [0.014, 0.006, 0.01]); }
  };
  const hat = (b) => {
    b.disc(STRAW_D, [0, 1.435, 0], [0.36, 0.012, 0.36]);             // 宽檐（下面暗、上面亮、边缘卷一圈）
    b.disc(STRAW, [0, 1.447, 0], [0.345, 0.016, 0.345]);
    b.disc(STRAW_L, [0, 1.46, 0], [0.28, 0.012, 0.28]);
    b.cyl(STRAW, [0, 1.53, 0], [0.205, 0.13, 0.205]);                  // 帽冠
    b.ball(STRAW_L, [0, 1.6, 0], [0.205, 0.075, 0.205]);
    b.cyl(RIBBON, [0, 1.485, 0], [0.212, 0.032, 0.212]);               // 帽带
    for (let i = 0; i < 4; i++) b.ball(i % 2 ? 0xffe15a : WHITE, [0.2 * cos(0.35 + i * 0.35 - 0.5), 1.49, 0.2 * sin(0.35 + i * 0.35 - 0.5) + 0.0], 0.026); // 帽带上的小花
  };
  const arm = (s) => (b) => {
    b.cyl(SHIRT, [0.205 * s, 0.93, 0], [0.052, 0.27, 0.052]);
    b.ball(SHIRT, [0.205 * s, 1.06, 0], [0.062, 0.06, 0.062]);          // 肩
    b.ball(SHIRT_D, [0.205 * s, 0.8, 0], [0.058, 0.04, 0.058]);        // 袖口
    b.ball(SKIN, [0.205 * s, 0.76, 0.0], 0.052);                       // 手
  };
  const broom = (b) => {
    b.cyl(0xa8743c, [-0.205, 0.78, 0.0], [0.016, 1.2, 0.016]);
    b.cone(HAY, [-0.205, 0.17, 0.0], [0.115, 0.26, 0.115]);
    b.cone(0xc79a2c, [-0.205, 0.12, 0.0], [0.105, 0.14, 0.105]);
    b.cyl(0x7a4f28, [-0.205, 0.285, 0.0], [0.04, 0.035, 0.04]);        // 绑带
  };
  const leg = (s) => (b) => {
    b.cyl(DENIM, [0.08 * s, 0.4, 0], [0.065, 0.46, 0.065]);
    b.cyl(DENIM_D, [0.08 * s, 0.25, 0], [0.067, 0.12, 0.067]);
    b.cyl(BOOT, [0.08 * s, 0.1, 0], [0.075, 0.2, 0.075]);              // 雨靴
    b.ball(BOOT, [0.08 * s, 0.05, 0.05], [0.078, 0.05, 0.11]);
    b.cyl(BOOT_D, [0.08 * s, 0.015, 0.02], [0.08, 0.03, 0.095]);
    b.ball(0xa0684a, [0.08 * s, 0.2, 0.0], [0.08, 0.025, 0.08]);       // 靴口
  };
  const anger = (b) => { // 头顶的“怒”符号（4 条红色弧）+ 两团蒸汽
    for (let i = 0; i < 4; i++) {
      const a = i * PI / 2 + PI / 4;
      b.ball(0xe5372f, [cos(a) * 0.05, 1.83 + sin(a) * 0.05, 0.1], [0.032, 0.012, 0.014], [0, 0, a]);
    }
    b.ball(0xffffff, [-0.2, 1.72, -0.05], 0.045); b.ball(0xeeeaf6, [-0.26, 1.8, -0.06], 0.036);
    b.ball(0xffffff, [0.22, 1.72, -0.05], 0.045); b.ball(0xeeeaf6, [0.27, 1.8, -0.06], 0.036);
  };
  const acts = {
    idle(p, t) {
      p.root.y = sin(t * 2) * 0.004;
      p.body.rx = sin(t * 1.5) * 0.015; p.body.sy = 1 + sin(t * 2) * 0.01;
      p.head.rx = sin(t * 1.1) * 0.04; p.head.rz = sin(t * 0.8) * 0.05; p.head.ry = sin(t * 0.6) * 0.1;
      p.hat.rx = -0.42 + sin(t * 1.1) * 0.015;
      p.armL.rz = 0.07 + sin(t * 1.6) * 0.03; p.armR.rz = -0.07 - sin(t * 1.6) * 0.03;
      p.armR.rx = -0.1; p.broom.rx = 0.05;
      keeperAnger(p, t, 0);
    },
    run(p, t, m) {
      const ph = m.phase;
      biped(p, ph, 0.95, 0.04);
      p.root.y = abs(cos(ph)) * 0.035;
      p.body.rx = 0.2; p.body.ry = sin(ph) * 0.1;
      p.head.rx = -0.12 + sin(ph * 2) * 0.04;
      p.hat.rx = -0.45 + sin(ph * 2 + 0.8) * 0.12;
      p.armL.rx = sin(ph + PI) * 1.0; p.armL.rz = 0.1;
      p.armR.rx = -2.6 + sin(ph) * 0.12; p.armR.rz = -0.1;
      p.broom.rx = 0.1 + sin(ph * 2) * 0.08;
      keeperAnger(p, t, 1);
    },
    carry(p, t, m) { // 左手拎着东西（小狗）走，身体微微向另一侧倾
      const ph = m.phase;
      biped(p, ph, 0.7, 0.03);
      p.root.y = abs(cos(ph)) * 0.025;
      p.body.rx = 0.06; p.body.rz = -0.07; p.body.ry = sin(ph) * 0.08;
      p.head.rx = -0.05; p.head.rz = 0.05;
      p.hat.rx = -0.42 + sin(ph * 2) * 0.05;
      p.armL.rx = -0.55 + sin(ph * 2) * 0.04; p.armL.rz = 0.32;   // 手臂向前向外平伸，拎着东西
      p.armR.rx = sin(ph) * 0.5 - 0.1; p.armR.rz = -0.08;
      p.broom.rx = 0.1;
      keeperAnger(p, t, 1);
    },
    grab(p, t) {
      const c = (t * 0.9) % 1;
      const down = smooth(min(c / 0.35, 1)) * (1 - smooth((c - 0.8) / 0.2));
      p.body.rx = 0.95 * down; p.root.y = -0.03 * down; p.root.z = 0.04 * down;
      p.head.rx = -0.55 * down; p.hat.rx = -0.42 - 0.1 * down;
      p.armL.rx = -1.7 * down + 0.05; p.armR.rx = -1.5 * down - 0.05 * (1 - down);
      p.armL.rz = 0.15 * down; p.armR.rz = -0.15 * down;
      p.legL.rx = -0.2 * down; p.legR.rx = 0.25 * down;
      p.broom.rx = 0.4 * down;
      keeperAnger(p, t, 1);
    },
    stumble(p, t) {
      const c = t % 1;
      const f = smooth(min(c / 0.4, 1)) * (1 - smooth((c - 0.85) / 0.15));
      p.root.rx = (0.85 + sin(t * 9) * 0.05) * f; p.root.y = -0.02 * f;
      p.legL.rx = 0.9 * f; p.legR.rx = -0.5 * f; p.legL.y = 0.06 * f;
      p.armL.rz = (1.6 + sin(t * 14) * 0.25) * f; p.armL.rx = -0.6 * f;
      p.armR.rz = -(1.5 + sin(t * 14 + 1) * 0.25) * f; p.armR.rx = -0.6 * f;
      p.head.rx = -0.4 * f; p.body.rx = 0.15 * f;
      p.hat.rx = -0.42 - 0.85 * f; p.hat.y = 0.08 * f; p.hat.z = -0.05 * f;
      p.broom.rx = -0.6 * f;
      keeperAnger(p, t, 1);
    },
  };
  function keeperAnger(p, t, a) { // 怒符号一跳一跳、蒸汽上下飘（部件只在 angry 时可见）
    const k = 1 + sin(t * 9) * 0.12;
    p.anger.sx = k; p.anger.sy = k; p.anger.sz = k;
    p.anger.y = sin(t * 5) * 0.012;
    p.anger.rz = sin(t * 7) * 0.08;
  }
  return {
    sc: 1, runSpeed: 3.2, stride: 0.95,
    parts: [
      part('body', [0, 0.66, 0], body),
      part('head', [0, 1.1, 0.0], faceBuilder(false), { parent: 'body', alt: faceBuilder(true) }),
      part('hat', [0, 1.43, -0.1], hat, { parent: 'head' }),
      part('armL', [0.205, 1.05, 0], arm(1), { parent: 'body' }),
      part('armR', [-0.205, 1.05, 0], arm(-1), { parent: 'body' }),
      part('broom', [-0.205, 0.76, 0], broom, { parent: 'armR' }),
      part('legL', [0.08, 0.64, 0], leg(1)),
      part('legR', [-0.08, 0.64, 0], leg(-1)),
      part('anger', [0, 1.8, 0], anger, { parent: 'head', flag: 'angry' }),
    ],
    attach: [{ name: 'holdPoint', parent: 'armL', at: [0.205, 0.72, 0] }],
    actions: acts,
  };
}

const KINDS = {
  keeper: keeperDef, hen: henDef, chick: chickDef, duck: duckDef, goose: gooseDef,
  pig: pigDef, cow: () => cowDef(false), bull: () => cowDef(true), sheep: sheepDef, alpaca: alpacaDef,
};

/** 全部角色种类及各自的动作列表（第一个动作是默认动作）。 */
export const FARM_MODELS = {
  keeper: { label: '管理员', actions: ['idle', 'run', 'carry', 'grab', 'stumble'], opts: ['angry'], note: 'parts.holdPoint 是左手拎东西的挂点；setAngry(true) 皱眉 + 脸颊变红 + 头顶冒怒符号和蒸汽' },
  hen: { label: '母鸡', actions: ['idle', 'run', 'peck', 'scared', 'sleep'], opts: [] },
  chick: { label: '小鸡', actions: ['idle', 'run', 'flap', 'scared', 'sleep'], opts: [] },
  duck: { label: '绿头鸭', actions: ['idle', 'run', 'quack', 'scared', 'sleep'], opts: [] },
  goose: { label: '大鹅', actions: ['idle', 'run', 'honk', 'scared', 'sleep'], opts: [] },
  pig: { label: '猪', actions: ['idle', 'run', 'scared', 'sleep'], opts: [] },
  cow: { label: '奶牛', actions: ['idle', 'run', 'scared', 'sleep'], opts: [] },
  bull: { label: '公牛', actions: ['idle', 'run', 'scared', 'sleep'], opts: [] },
  sheep: { label: '绵羊', actions: ['idle', 'run', 'jump', 'scared', 'sleep'], opts: [] },
  alpaca: { label: '羊驼', actions: ['idle', 'run', 'scared', 'sleep'], opts: [] },
};
