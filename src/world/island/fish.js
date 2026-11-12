// 池塘里的小金鱼：橘红色的身体、飘逸的扇形尾巴，在水面下悠闲地慢慢游；狗过来喝水时会受惊，飞快地游开躲到池塘另一边。
import * as THREE from 'three';
import { paintMaterial } from '../../core/paint.js';
import { clamp, damp, dampAngle } from '../../core/util.js';
import { L, pondR } from './shape.js';
import { GeoBuilder } from './geo.js';
import { WATER_Y } from './water.js';

const TAU = Math.PI * 2;

// 小金鱼（参考：鲜橘红色的草金鱼——圆头大眼、身体前圆后收、高背鳍、分叉的大尾巴）。
// 三条深浅略有差别：[背部, 腹部与头下, 鳍与尾, 鳍梢]
const VARIANTS = [
  [0xf2541d, 0xf98a2e, 0xf88a36, 0xfcb878], // 鲜橘红
  [0xe8421a, 0xf57a28, 0xf47a30, 0xfaa868], // 偏红
  [0xf66a1e, 0xfba23a, 0xfa9a40, 0xfdc888], // 偏金
];

/** 鱼身（头朝 +Z，鱼身中心在原点） */
function bodyGeometry([back, belly, fin, tip], seed) {
  const b = new GeoBuilder({ seed, jitter: 0.0, aoK: 0 });
  // 水滴形身体：前段圆鼓，向尾柄收细
  const body = new THREE.IcosahedronGeometry(1, 2);
  {
    const p = body.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      const f = z < 0 ? 1 + 0.42 * z : 1 + 0.06 * z;
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, z);
    }
  }
  // 背深腹浅
  b.add(body, { pos: [0, 0, -0.005], scale: [0.054, 0.058, 0.13], color: (nx, ny) => (ny > -0.2 ? back : belly), ao: false });
  // 圆圆的头
  b.add(new THREE.IcosahedronGeometry(1, 1), { pos: [0, -0.002, 0.088], scale: [0.047, 0.049, 0.056], color: (nx, ny) => (ny > -0.35 ? back : belly), ao: false });
  // 背鳍：高高的三角帆（不露出水面）
  b.add(new THREE.ConeGeometry(0.052, 0.07, 4), { pos: [0, 0.066, -0.004], rot: [-0.55, 0, 0], scale: [0.16, 1, 1], color: (nx, ny, nz, cx, cy) => (cy > 0.075 ? tip : fin), ao: false });
  // 胸鳍：向两侧张开的小扇子
  for (const s of [1, -1]) b.add(new THREE.ConeGeometry(0.034, 0.085, 4), { pos: [0.058 * s, -0.026, 0.04], rot: [1.25, 0, -1.2 * s], scale: [1, 1, 0.24], color: (nx, ny, nz, cx) => (Math.abs(cx) > 0.075 ? tip : fin), ao: false });
  // 腹鳍（小）
  for (const s of [1, -1]) b.add(new THREE.ConeGeometry(0.02, 0.05, 3), { pos: [0.03 * s, -0.045, -0.03], rot: [1.9, 0, -0.5 * s], scale: [1, 1, 0.3], color: fin, ao: false });
  // 大眼睛：金色眼圈 + 黑眼珠
  for (const s of [1, -1]) {
    b.add(new THREE.IcosahedronGeometry(0.0165, 1), { pos: [0.036 * s, 0.012, 0.108], color: 0xf2c14e, ao: false });
    b.add(new THREE.IcosahedronGeometry(0.0105, 1), { pos: [0.045 * s, 0.014, 0.112], color: 0x1f1a17, ao: false });
  }
  return b.build();
}

/** 尾巴（枢轴在原点，向 -Z 展开）：一片柔和的扇形尾鳍，末端浅浅分叉成两个圆叶；比身体短，水平的薄片，整条都在水面下 */
function tailGeometry([, , fin, tip], seed) {
  const b = new GeoBuilder({ seed: seed + 50, jitter: 0.0, aoK: 0 });
  // 尾柄
  b.add(new THREE.IcosahedronGeometry(1, 1), { pos: [0, 0, -0.01], scale: [0.018, 0.024, 0.026], color: fin, ao: false });
  // 轮廓（x 横向，y = 向后的距离）：从尾柄收窄处展开，外缘圆滑，中间一个浅缺口
  const half = [[0.008, 0.0], [0.02, 0.03], [0.04, 0.062], [0.054, 0.09], [0.056, 0.108], [0.046, 0.118], [0.03, 0.112], [0.014, 0.098], [0, 0.088]];
  const sh = new THREE.Shape();
  sh.moveTo(half[0][0], half[0][1]);
  for (let i = 1; i < half.length; i++) sh.lineTo(half[i][0], half[i][1]);
  for (let i = half.length - 2; i >= 0; i--) sh.lineTo(-half[i][0], half[i][1]);
  sh.closePath();
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2); // 放平：轮廓的 y → -Z（向后），法线朝上
  // 末端略微下垂，像在水里飘着
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const d = -p.getZ(i); p.setY(i, -0.9 * d * d); }
  b.add(g, { pos: [0, 0.004, -0.012], color: (nx, ny, nz, cx, cy, cz) => (cz < -0.085 ? tip : fin), ao: false });
  return b.build();
}

export function createFish(count, rng) {
  const group = new THREE.Group();
  group.name = 'pondFish';
  // 会游动的物体：笔触用 local 空间
  // 鱼在半透明的水面之后绘制（renderOrder 更大），颜色不被水色盖灰，保持鲜亮的橘红；略带一点透明，仍有“在水下”的感觉
  const mat = paintMaterial({ vertexColors: true, transparent: true, opacity: 0.9, side: THREE.DoubleSide }, { space: 'local', scale: 16, strength: 0.1, hue: 0.4, bands: 0.2 });
  const geos = VARIANTS.map((v, i) => ({ body: bodyGeometry(v, 31 + i), tail: tailGeometry(v, 31 + i) }));

  const fish = [];
  for (let i = 0; i < count; i++) {
    const g = geos[i % geos.length];
    const root = new THREE.Group();
    const body = new THREE.Mesh(g.body, mat);
    const tail = new THREE.Mesh(g.tail, mat);
    tail.position.set(0, 0, -0.118);
    body.renderOrder = 3; tail.renderOrder = 3;
    root.add(body, tail);
    const size = 0.68 + rng() * 0.24; // 小鱼（体长约 0.27–0.37）
    root.scale.setScalar(size);
    group.add(root);
    const a = rng() * TAU, r = Math.sqrt(rng()) * L.pond.r * 0.5;
    fish.push({
      root, tail, size,
      x: L.pond.x + Math.cos(a) * r, z: L.pond.z + Math.sin(a) * r,
      heading: rng() * TAU, want: rng() * TAU,
      speed: 0.08, cruise: 0.06 + rng() * 0.06, // 悠闲的慢游
      burst: 0, flee: 0,
      timer: rng() * 4, phase: rng() * TAU,
      gulpIn: 8 + rng() * 30, gulp: 0, // 距下次浮头的秒数；浮头动画进度（0 = 没在浮头）
      depth: 0.1 + rng() * 0.03, // 整条鱼（含背鳍、尾巴）都在水面以下
      orbit: i * 1.7, orbitDir: i % 2 ? -1 : 1, // 被引诱时绕着引诱点打转（不调用 rng，保证没有引诱点时随机序列与原来完全一致）
    });
  }

  let wasThreat = false;

  // ---- 引诱点（可选，钓鱼小游戏用）：setLure({x,z}, 强度 0..1) 让小鱼慢慢聚过来绕圈；strike() 让最近的一条冲上去咬；
  //      scatter(秒) 让它们受惊散开。不设引诱点（lure.on = false）时行为与原来完全一致。
  const lure = { on: false, x: 0, z: 0, s: 1, bite: false, biter: -1, scatter: 0 };
  function setLure(p, strength = 1) {
    if (!p) { lure.on = false; lure.bite = false; lure.biter = -1; return; }
    lure.on = true; lure.x = p.x; lure.z = p.z; lure.s = clamp(strength, 0, 1);
  }
  function strike() {
    if (!lure.on) return;
    let best = -1, bd = 1e9;
    for (let i = 0; i < fish.length; i++) { const d = Math.hypot(fish[i].x - lure.x, fish[i].z - lure.z); if (d < bd) { bd = d; best = i; } }
    lure.bite = best >= 0; lure.biter = best;
  }
  function release() { lure.bite = false; lure.biter = -1; }
  function scatter(sec = 2.2) { lure.scatter = Math.max(lure.scatter, sec); lure.bite = false; lure.biter = -1; }

  // 水面的小涟漪圈（鱼浮头吐泡泡时出现）：一小池可复用的圆环
  const ringGeo = new THREE.RingGeometry(0.78, 1, 20);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    m.renderOrder = 4;
    group.add(m);
    rings.push({ m, t: 1, delay: 0, max: 0.2 });
  }
  let ringNext = 0;
  function spawnRing(x, z, delay, max) {
    const r = rings[ringNext];
    ringNext = (ringNext + 1) % rings.length;
    r.m.position.set(x, WATER_Y + 0.006, z);
    r.t = 0; r.delay = delay; r.max = max;
  }

  /**
   * @param threat  null，或狗喝水时的位置 {x, z}：鱼受惊，飞快游开并躲在池塘远离狗的一侧
   */
  function update(dt, env, threat) {
    const night = env && Number.isFinite(env.dayFactor) ? 1 - env.dayFactor : 0;
    if (lure.scatter > 0) { lure.scatter -= dt; if (!threat) threat = lure; } // 引诱点处出了事（鱼被吓跑）：把引诱点当作“威胁”
    const scared = !!threat;
    const lured = lure.on && !scared;
    const nLured = lured ? Math.round(lure.s * fish.length) : 0;
    // 清晨和傍晚鱼更活跃（借用霞光强度：朝霞、晚霞时段最高）
    const twilight = env && Number.isFinite(env.sunsetFactor) ? clamp(env.sunsetFactor) : 0;
    // 远离狗的方向（从狗指向池心）
    let ax = 0, az = 0;
    if (scared) {
      ax = L.pond.x - threat.x; az = L.pond.z - threat.z;
      const l = Math.hypot(ax, az) || 1;
      ax /= l; az /= l;
    }
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      const dx = f.x - L.pond.x, dz = f.z - L.pond.z;
      const ang = Math.atan2(dz, dx);
      const isLured = i < nLured;
      const lim = pondR(ang) * (isLured ? 0.9 : 0.64) - 0.15 * f.size;
      const dist = Math.hypot(dx, dz);
      f.timer -= dt;

      if (scared && !wasThreat) {
        // 受惊的一瞬间：各自朝远离狗的方向窜出去（带一点散开）
        f.flee = 1;
        f.want = Math.atan2(ax, az) + (rng() - 0.5) * 1.5;
        f.timer = 0.9 + rng() * 0.6;
      }
      if (isLured) {
        // 被引诱：在引诱点周围慢慢打转；咬钩的那一条直奔引诱点
        const biting = lure.bite && i === lure.biter;
        f.orbit += f.orbitDir * (biting ? 0 : 0.8) * dt;
        const R = biting ? 0.06 : 0.3 + 0.06 * i;
        let tx = lure.x + Math.cos(f.orbit) * R, tz = lure.z + Math.sin(f.orbit) * R;
        const tr = Math.hypot(tx - L.pond.x, tz - L.pond.z), tl = pondR(Math.atan2(tz - L.pond.z, tx - L.pond.x)) * 0.93;
        if (tr > tl) { tx = L.pond.x + (tx - L.pond.x) * (tl / tr); tz = L.pond.z + (tz - L.pond.z) * (tl / tr); }
        f.want = Math.atan2(tx - f.x, tz - f.z);
        f.timer = 0.4;
        f.lureSpeed = Math.min(biting ? 1.0 : 0.34, 0.06 + 1.6 * Math.hypot(tx - f.x, tz - f.z));
      } else if (dist > lim) {
        // 离岸太近：掉头回池心（world heading：+Z 为 0，即 atan2(dx, dz)）
        f.want = Math.atan2(-dx, -dz) + (i % 2 ? 0.5 : -0.5);
        f.timer = Math.max(f.timer, 0.8);
      } else if (f.timer <= 0) {
        if (scared) {
          // 狗还在喝水：在远离狗的那半边小范围游动
          const far = L.pond.r * 0.34;
          const tx = L.pond.x + ax * far + (rng() - 0.5) * 0.6, tz = L.pond.z + az * far + (rng() - 0.5) * 0.6;
          f.want = Math.atan2(tx - f.x, tz - f.z);
          f.timer = 0.8 + rng() * 1.2;
        } else {
          f.want = f.heading + (rng() - 0.5) * 2.2;
          f.timer = 2.5 + rng() * 4.5;
          if (rng() < 0.07 + 0.12 * twilight) f.burst = 1; // 偶尔轻轻加速一下（晨昏更频繁）
        }
      }
      f.burst = damp(f.burst, 0, 1.4, dt);
      f.flee = damp(f.flee, 0, 1.1, dt);
      let target = f.cruise * (1 - 0.4 * night) * (1 + 0.7 * twilight) * (1 + 1.4 * f.burst) + 1.15 * f.flee;
      if (isLured) target = Math.max(target, f.lureSpeed || 0.1);
      f.speed = damp(f.speed, target, f.flee > 0.3 ? 9 : 2.2, dt);
      const before = f.heading;
      f.heading = dampAngle(f.heading, f.want, 1.2 + 1.8 * f.burst + 9 * f.flee + (isLured ? 3 : 0), dt);
      const turn = clamp((f.heading - before) / Math.max(dt, 1e-4), -3, 3);
      f.x += Math.sin(f.heading) * f.speed * dt;
      f.z += Math.cos(f.heading) * f.speed * dt;
      // 摆尾：游得越快摆得越勤；身体跟着轻轻扭
      f.phase += dt * (2.2 + 30 * f.speed);
      const wag = Math.sin(f.phase);
      // 浮头吐泡泡：慢慢升到水面下一点点，嘴边冒出两圈小涟漪，再沉回去
      f.gulpIn -= dt * (1 + 0.8 * twilight);
      if (f.gulp <= 0 && f.gulpIn <= 0 && !scared && f.flee < 0.05) { f.gulp = 1e-3; f.spawned = false; }
      let rise = 0;
      if (f.gulp > 0) {
        f.gulp += dt / 2.2;
        rise = Math.sin(Math.min(f.gulp, 1) * Math.PI);
        if (!f.spawned && f.gulp > 0.45) {
          f.spawned = true;
          const hx = f.x + Math.sin(f.heading) * 0.12 * f.size, hz = f.z + Math.cos(f.heading) * 0.12 * f.size;
          spawnRing(hx, hz, 0, 0.16);
          spawnRing(hx, hz, 0.28, 0.24);
        }
        if (f.gulp >= 1 || scared) { f.gulp = 0; f.gulpIn = 14 + rng() * 30; }
      }
      const depth = f.depth + (0.045 * f.size - f.depth) * rise * 0.9;
      f.root.position.set(f.x, WATER_Y - depth + Math.sin(f.phase * 0.21 + i) * 0.006, f.z);
      f.root.rotation.set(0, f.heading + wag * 0.09, clamp(-turn * 0.1, -0.25, 0.25));
      f.tail.rotation.y = -wag * (0.3 + 0.45 * Math.min(f.speed, 1)) - turn * 0.14;
    }
    wasThreat = scared;
    // 涟漪圈：扩散并淡出
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (r.t >= 1) { if (r.m.visible) r.m.visible = false; continue; }
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.t = Math.min(1, r.t + dt / 1.4);
      const s = 0.03 + r.max * (1 - (1 - r.t) * (1 - r.t));
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = 0.6 * (1 - r.t);
      r.m.visible = true;
    }
  }

  const api = { group, update, fish, lure, setLure, strike, release, scatter, ripple: spawnRing };
  group.userData.pond = api; // island.js 没有对外暴露 fish：钓鱼小游戏从 group.userData.pond 取
  return api;
}
