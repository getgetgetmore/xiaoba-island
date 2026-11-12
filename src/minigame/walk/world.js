// 遛狗小游戏的场景：小区公园步道。相机不动、世界向后滚动：
//  - 地面（步道铺砖 / 草地）是静止的大平面，靠贴图偏移滚动；
//  - 路边的树、路灯、长椅、灌木、花坛、栅栏、房子都是 InstancedMesh，按“槽位”循环复用（槽位 k 的位置 = k × 间距，超出视野就换成下一个槽位）；
//  - 赛道上的实体（障碍 / 诱惑物 / 横穿物 / 骨头 / 提示牌）按种类各一个 InstancedMesh，每帧只写可见窗口内的实例；
//  - 特效（火花、灰尘、羽毛）和飘落的花瓣是对象池。
// 所有实体材质都走 paintMaterial（手绘质感；会动的都用 local 空间的笔触，色斑跟着物体走）。
import * as THREE from 'three';
import { paintMaterial } from '../../core/paint.js';
import { WALK, FIXED_KINDS, LURE_KINDS, CROSS_KINDS, FEAR_KINDS, MOVER_KINDS, CRITTER_KINDS } from '../walkSim.js';
import { makePaveTexture, makeGrassTexture, makeSoftDisc, mergeParts, part, hash1, G } from './geo.js';
import * as P from './props.js';
import * as P2 from './props2.js';

export const DOG_Z = 3.0; // 小狗离相机的距离（米）
const zOf = (ahead) => -(DOG_Z + ahead);
const RANGE = 140;       // 可见距离
const BEHIND = DOG_Z + 1.5;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** 一个 InstancedMesh + 逐帧写入 */
class Inst {
  constructor(geo, mat, cap, name) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.cap = cap;
    this.n = 0;
  }
  begin() { this.n = 0; }
  /** 位置、绕 y 的朝向、缩放（sx 为统一缩放，可单独给 sy/sz）、再绕 x / z 的倾斜 */
  add(x, y, z, yaw = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
    if (this.n >= this.cap) return -1;
    _e.set(rx, yaw, rz, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.mesh.setMatrixAt(this.n, _m);
    return this.n++;
  }
  color(i, c) { if (i >= 0) this.mesh.setColorAt(i, c); }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** 路边景物的“槽位流”：槽位 k 在赛道上的位置 k×spacing（带抖动），始终覆盖 [dist-BEHIND, dist+RANGE] */
class Stream {
  constructor(inst, o) {
    this.inst = inst;
    this.o = { sides: [-1, 1], salt: 1, jitter: 0.5, ...o };
  }
  update(dist) {
    const { spacing, sides, salt, jitter, accept, xFn, scaleFn, yawFn, tint } = this.o;
    const k0 = Math.floor((dist - BEHIND - 6) / spacing);
    const n = Math.ceil(((this.o.range || RANGE) + BEHIND + 12) / spacing) + 1;
    this.inst.begin();
    for (let i = 0; i < n; i++) {
      const k = k0 + i;
      for (let si = 0; si < sides.length; si++) {
        const side = sides[si];
        const key = k * 4 + si;
        if (accept && !accept(hash1(key, salt + 9), key)) continue;
        const s = k * spacing + (hash1(key, salt) - 0.5) * spacing * jitter;
        const ahead = s - dist;
        const x = xFn(side, hash1(key, salt + 2), key);
        const sc = scaleFn ? scaleFn(hash1(key, salt + 3), key) : 1;
        const yaw = yawFn ? yawFn(side, hash1(key, salt + 4), key) : 0;
        const idx = this.inst.add(x, 0, zOf(ahead), yaw, sc);
        if (tint && idx >= 0) this.inst.color(idx, tint(hash1(key, salt + 5), key));
      }
    }
    this.inst.end();
  }
}

// ------------------------------------------------------------------ 天空
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop, uMid, uHor, uSun, uSunDir, uHill1, uHill2;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.2, h));
  col = mix(col, uTop, smoothstep(0.16, 0.8, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSun * (pow(sd, 5.0) * 0.32 + pow(sd, 40.0) * 0.55);
  col = mix(col, vec3(1.0, 0.93, 0.72), smoothstep(0.9988, 0.9994, sd));
  float ang = atan(d.x, -d.z);
  float hillA = 0.045 + 0.028 * sin(ang * 2.3 + 0.7) + 0.016 * sin(ang * 5.1 + 2.0) + 0.008 * sin(ang * 11.0 + 1.0);
  float hillB = 0.018 + 0.016 * sin(ang * 3.7 + 3.0) + 0.008 * sin(ang * 8.3 + 1.0);
  float fa = smoothstep(hillA + 0.004, hillA - 0.004, h) * step(-0.2, h);
  col = mix(col, uHill1, fa * 0.85);
  float fb = smoothstep(hillB + 0.004, hillB - 0.004, h) * step(-0.2, h);
  col = mix(col, uHill2, fb * 0.9);
  col = mix(col, uHor, smoothstep(0.0, -0.05, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FOG_COLOR = 0xf3d3ae;

// 蓝紫色的小花瓣 / 树叶（飘过的速度感）
const PETAL_N = 46;
const SPARK_N = 90;

export function createWalkWorld() {
  const scene = new THREE.Scene();
  scene.name = 'walkScene';
  scene.fog = new THREE.Fog(FOG_COLOR, 38, 178);
  const world = { scene, time: 0, DOG_Z, view: { dist: 0, speed: 0 }, dogShadow: null };

  // ---- 光 ----
  const hemi = new THREE.HemisphereLight(0xc4d8ff, 0x9c8a66, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe7c2, 2.5);
  sun.position.set(-14, 18, 12);
  sun.target.position.set(0, 0, -8);
  scene.add(sun, sun.target);
  world.sun = sun; world.hemi = hemi;

  // ---- 天空 ----
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(0x4a86d8) },
      uMid: { value: new THREE.Color(0x9cc4ee) },
      uHor: { value: new THREE.Color(FOG_COLOR) },
      uSun: { value: new THREE.Color(0xff9c4a) },
      uSunDir: { value: new THREE.Vector3(0.38, 0.17, -0.9).normalize() },
      uHill1: { value: new THREE.Color(0xc2b8bd) },
      uHill2: { value: new THREE.Color(0xa7b79a) },
    },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(230, 32, 16), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -20;
  scene.add(sky);

  // 云：几朵软边的大圆叠在一起
  const discTex = makeSoftDisc(64, 0.3);
  const cloudMat = new THREE.MeshBasicMaterial({ map: discTex, color: 0xfff1e2, transparent: true, depthWrite: false, fog: false, opacity: 0.92 });
  const cloudGeo = new THREE.PlaneGeometry(1, 1);
  const clouds = new Inst(cloudGeo, cloudMat, 36, 'clouds');
  clouds.mesh.renderOrder = -15;
  scene.add(clouds.mesh);
  const cloudData = [];
  for (let i = 0; i < 11; i++) {
    const cx = (hash1(i, 31) - 0.5) * 280, cy = 46 + hash1(i, 32) * 46, sz = 22 + hash1(i, 33) * 22;
    for (let j = 0; j < 3; j++) cloudData.push({ x: cx + (j - 1) * sz * 0.5, y: cy + (j === 1 ? sz * 0.12 : 0), sx: sz * (j === 1 ? 1.3 : 0.9), sy: sz * 0.42 * (j === 1 ? 1.3 : 0.9) });
  }

  // ---- 地面 ----
  const paveTex = makePaveTexture(256);
  paveTex.repeat.set(3, 220 / 1.2);
  const grassTex = makeGrassTexture(256);
  grassTex.repeat.set(170 / 6, 220 / 6);
  const matPave = paintMaterial({ map: paveTex, color: 0xffffff }, { scale: 0.7, strength: 0.07, hue: 0.4, bands: 0.25, levels: 5, space: 'local' });
  matPave.polygonOffset = true; matPave.polygonOffsetFactor = -2; matPave.polygonOffsetUnits = -2;
  const matGrass = paintMaterial({ map: grassTex, color: 0xffffff }, { scale: 0.35, strength: 0.08, hue: 0.4, bands: 0.2, levels: 5, space: 'local' });
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(170, 230), matGrass);
  grass.rotation.x = -Math.PI / 2; grass.position.set(0, 0, -105);
  const pave = new THREE.Mesh(new THREE.PlaneGeometry(6, 230), matPave);
  pave.rotation.x = -Math.PI / 2; pave.position.set(0, 0.012, -105);
  grass.frustumCulled = false; pave.frustumCulled = false;
  scene.add(grass, pave);
  const matCurb = paintMaterial({ vertexColors: true }, { scale: 2, strength: 0.1, hue: 0.3, bands: 0.3, space: 'world' });
  const curbGeo = mergeParts([
    part(G.box(0.26, 0.1, 230), 0xe4dccb, { p: [-3.13, 0.05, -105], ao: 0 }),
    part(G.box(0.26, 0.1, 230), 0xe4dccb, { p: [3.13, 0.05, -105], ao: 0 }),
  ], { aoH: 0 });
  const curb = new THREE.Mesh(curbGeo, matCurb);
  curb.frustumCulled = false;
  scene.add(curb);

  // ---- 路边景物 ----
  const matProp = paintMaterial({ vertexColors: true }, { scale: 2.4, strength: 0.17, hue: 0.5, bands: 0.4, levels: 4, space: 'local' });
  const mk = (geo, cap, name) => { const i = new Inst(geo, matProp, cap, name); scene.add(i.mesh); return i; };
  const treeGeo = P.buildTree('round'), blossomGeo = P.buildTree('blossom');
  const farTreeInst = mk(P.buildTree('round', 0), 80, 'farTrees');
  const treeInst = mk(treeGeo, 40, 'trees');
  const blossomInst = mk(blossomGeo, 40, 'blossoms');
  const lampInst = mk(P.buildLamp(), 24, 'lamps');
  const benchInst = mk(P.buildBench(), 12, 'benches');
  const bushInst = mk(P.buildBush(), 60, 'bushes');
  const bedInst = mk(P.buildFlowerbed(), 20, 'flowerbeds');
  const fenceInst = mk(P.buildFence(), 150, 'fence');
  const houseInst = mk(P.buildHouse(), 20, 'houses');
  houseInst.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(20 * 3).fill(1), 3);
  const housePal = [0xfff0d8, 0xffd8bc, 0xd9e8f6, 0xdff0dc, 0xf9d9de, 0xfdecb0].map((h) => new THREE.Color(h));
  const blossomTint = [new THREE.Color(0xffffff), new THREE.Color(0xfff0f4)];
  void blossomTint;
  const streams = [
    // 近处的树（圆树 / 樱花树按槽位哈希二选一）
    new Stream(treeInst, { spacing: 9.5, salt: 1, xFn: (sd, h) => sd * (6.4 + h * 2.4), scaleFn: (h) => 0.85 + h * 0.5, accept: (h) => h < 0.58, yawFn: (sd, h) => h * 6 }),
    new Stream(blossomInst, { spacing: 9.5, salt: 1, xFn: (sd, h) => sd * (6.4 + h * 2.4), scaleFn: (h) => 0.85 + h * 0.5, accept: (h) => h >= 0.58 && h < 0.9, yawFn: (sd, h) => h * 6 }),
    // 远一点的树林
    new Stream(farTreeInst, { spacing: 7.2, salt: 7, xFn: (sd, h) => sd * (11 + h * 9), scaleFn: (h) => 1.0 + h * 0.9, yawFn: (sd, h) => h * 6, jitter: 0.9 }),
    new Stream(lampInst, { spacing: 17, salt: 3, jitter: 0.1, xFn: (sd) => sd * 5.5, yawFn: (sd) => (sd > 0 ? Math.PI : 0) }),
    new Stream(benchInst, { spacing: 38, salt: 4, xFn: (sd) => sd * 5.7, yawFn: (sd) => (sd > 0 ? -Math.PI / 2 : Math.PI / 2), accept: (h) => h < 0.8 }),
    new Stream(bushInst, { spacing: 5.4, salt: 5, xFn: (sd, h) => sd * (5.9 + h * 1.8), scaleFn: (h) => 0.8 + h * 0.7, accept: (h) => h < 0.55, yawFn: (sd, h) => h * 6 }),
    new Stream(bedInst, { spacing: 26, salt: 6, xFn: (sd, h) => sd * (6.6 + h * 0.6), yawFn: (sd) => (sd > 0 ? -Math.PI / 2 : Math.PI / 2) + 0, accept: (h) => h < 0.85 }),
    new Stream(fenceInst, { spacing: 2, salt: 8, jitter: 0, range: 100, xFn: (sd) => sd * 12.2, yawFn: () => Math.PI / 2 }),
    new Stream(houseInst, { spacing: 30, salt: 9, jitter: 0.6, xFn: (sd, h) => sd * (23 + h * 12), scaleFn: (h) => 0.9 + h * 0.7, yawFn: (sd) => (sd > 0 ? -Math.PI / 2 : Math.PI / 2), tint: (h) => housePal[Math.floor(h * housePal.length) % housePal.length] }),
  ];
  // 房子要在 Stream 里按顺序写颜色（InstancedMesh 的 instanceColor 需要先存在）
  void streams;

  // ---- 赛道实体 ----
  const entMat = matProp;
  const mkE = (geo, cap, name) => { const i = new Inst(geo, entMat, cap, name); scene.add(i.mesh); return i; };
  const fixedInst = {}, lureInst = {}, crossInst = {}, fearInst = {}, moverInst = {}, critterInst = {};
  for (const k of Object.keys(FIXED_KINDS)) fixedInst[k] = mkE(P.FIXED_BUILDERS[k](), k === 'barrier' ? 12 : 22, 'fx_' + k);
  for (const k of Object.keys(LURE_KINDS)) lureInst[k] = mkE(P.LURE_BUILDERS[k](), 8, 'lu_' + k);
  for (const k of Object.keys(CROSS_KINDS)) crossInst[k] = mkE(P.CROSS_BUILDERS[k](), 6, 'cr_' + k);
  fixedInst.gate = mkE(P.buildBarrier(), 14, 'fx_gate');
  for (const k of Object.keys(FEAR_KINDS)) fearInst[k] = mkE(P2.FEAR_BUILDERS[k](), 6, 'fe_' + k);
  for (const k of Object.keys(MOVER_KINDS)) moverInst[k] = mkE(P2.MOVER_BUILDERS[k](), 6, 'mv_' + k);
  for (const k of Object.keys(CRITTER_KINDS)) critterInst[k] = mkE(P2.CRITTER_BUILDERS[k](), 4, 'ct_' + k);
  const bumpInst = mkE(P2.buildBump(), 4, 'bumps');
  const stumpInst = mkE(P2.buildStump(), 6, 'stumps');
  const boneInst = mkE(P.buildBone(), 90, 'bones');
  const warnInst = mkE(P.buildWarnSign(), 6, 'warnSigns');

  // 贴地软影子
  const shadowMat = new THREE.MeshBasicMaterial({ map: discTex, color: 0x2e3a26, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const shGeo = new THREE.PlaneGeometry(2, 2); shGeo.rotateX(-Math.PI / 2);
  const shadows = new Inst(shGeo, shadowMat, 72, 'blobShadows');
  shadows.mesh.renderOrder = 1;
  scene.add(shadows.mesh);
  const SH = {
    cone: [0.36, 0.36], hydrant: [0.38, 0.38], bin: [0.5, 0.5], box: [0.7, 0.58], barrier: [1.1, 0.4],
    sprinkler: [0.5, 0.5], sweeper: [0.95, 0.95], balloons: [0.35, 0.35], roomba: [0.55, 0.55], rccar: [0.5, 0.35], walker: [0.35, 0.3], stroller: [0.55, 0.7], squirrel: [0.3, 0.2], cat: [0.4, 0.2], stump: [0.45, 0.45],
    pigeons: [0.85, 0.65], dog: [0.62, 0.78], sausage: [0.5, 0.28], icecream: [0.42, 0.3],
    ball: [0.4, 0.4], bike: [0.95, 0.3], skate: [0.6, 0.3], bone: [0.28, 0.28],
  };
  world.shadows = shadows;

  // ---- 特效：火花 / 灰尘（朝向镜头的四角星） ----
  const starGeo = P.buildStar();
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: false });
  const sparks = new Inst(starGeo, sparkMat, SPARK_N, 'sparks');
  sparks.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SPARK_N * 3).fill(1), 3);
  sparks.mesh.renderOrder = 5;
  scene.add(sparks.mesh);
  const sp = Array.from({ length: SPARK_N }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.2, spin: 0, g: 0, c: new THREE.Color(), scroll: true }));
  let spNext = 0;
  function spawn(x, y, z, vx, vy, vz, life, size, color, g = 0, scroll = true) {
    const s = sp[spNext]; spNext = (spNext + 1) % SPARK_N;
    s.on = true; s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz; s.life = life; s.max = life; s.size = size; s.g = g; s.spin = Math.random() * 6.28; s.scroll = scroll;
    s.c.set(color);
  }
  /** type: 'bone' 金色星星 | 'hit' 撞击星星 + 灰尘 | 'feather' 羽毛 | 'dust' 跑步扬起的小灰尘 */
  world.burst = (type, x, ahead, speed = 6) => {
    const z = zOf(ahead);
    if (type === 'bone') {
      for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.28 + Math.random() * 0.5; spawn(x, 0.7, z, Math.cos(a) * 1.4, 1.8 + Math.random() * 1.4, Math.sin(a) * 0.9, 0.7 + Math.random() * 0.3, 0.2 + Math.random() * 0.1, i % 2 ? 0xffd24a : 0xfff3b0, -4, false); }
    } else if (type === 'hit') {
      for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.28 + Math.random() * 0.4; spawn(x, 0.5, z, Math.cos(a) * 2.4, 1.2 + Math.random() * 2.0, Math.sin(a) * 1.6, 0.6 + Math.random() * 0.3, 0.2 + Math.random() * 0.16, i % 3 === 0 ? 0xff8a5c : i % 3 === 1 ? 0xffe98a : 0xffffff, -5, false); }
      for (let i = 0; i < 6; i++) spawn(x + (Math.random() - 0.5) * 0.8, 0.15, z, (Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 1.5, 0.7, 0.42, 0xd8c8a4, -0.5, true);
    } else if (type === 'feather') {
      for (let i = 0; i < 10; i++) spawn(x + (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.4, z, (Math.random() - 0.5) * 3, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 2, 1.1, 0.13, 0xffffff, -1.2, false);
    } else if (type === 'dust') {
      spawn(x + (Math.random() - 0.5) * 0.3, 0.1, z, (Math.random() - 0.5) * 0.7, 0.35 + Math.random() * 0.3, 0, 0.55, 0.22 + Math.random() * 0.14, 0xe2cfa6, -0.2, true);
    }
  };

  // ---- 飘过的花瓣（速度感） ----
  const petalMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const petals = new Inst(starGeo, petalMat, PETAL_N, 'petals');
  petals.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PETAL_N * 3).fill(1), 3);
  scene.add(petals.mesh);
  const pet = Array.from({ length: PETAL_N }, (_, i) => ({ x: (hash1(i, 71) - 0.5) * 20, y: 0.4 + hash1(i, 72) * 4, ahead: hash1(i, 73) * 60 - 4, ph: hash1(i, 74) * 6.28, sc: 0.08 + hash1(i, 75) * 0.07 }));
  const petalCols = [0xffc0d4, 0xffffff, 0xffe39a].map((h) => new THREE.Color(h));

  // ------------------------------------------------------------------ 每帧
  const col = new THREE.Color();
  /** state: sim；t: 世界时间；dt */
  world.update = (sim, dt, camera) => {
    world.time += dt;
    const t = world.time;
    const dist = world.view.dist;
    // 地面滚动
    paveTex.offset.y = (dist / 1.2) % 1;
    grassTex.offset.y = (dist / 6) % 1;
    // 天空跟着相机
    sky.position.copy(camera.position);
    // 云：缓慢飘动，位置贴着天空
    clouds.begin();
    for (let i = 0; i < cloudData.length; i++) {
      const c = cloudData[i];
      const x = ((c.x + t * 0.8 + 150) % 300) - 150;
      clouds.add(x, c.y, -200, 0, c.sx, c.sy, 1);
    }
    clouds.end();
    // 路边景物
    for (const s of streams) s.update(dist);
    // 实体
    drawEntities(sim, t, dt);
    updateSparks(sim, dt, camera);
    updatePetals(sim, dt, t);
  };

  function drawEntities(sim, t) {
    const dist = world.view.dist;
    for (const k in fixedInst) fixedInst[k].begin();
    for (const k in lureInst) lureInst[k].begin();
    for (const k in crossInst) crossInst[k].begin();
    for (const k in fearInst) fearInst[k].begin();
    for (const k in moverInst) moverInst[k].begin();
    for (const k in critterInst) critterInst[k].begin();
    bumpInst.begin(); stumpInst.begin();
    boneInst.begin(); warnInst.begin(); shadows.begin();
    const ents = sim.entities;
    for (let i = sim.iLo; i <= sim.iHi && i < ents.length; i++) {
      const e = ents[i];
      const ahead = e.s + e.off - dist;
      if (ahead < -BEHIND + 0.3 || ahead > RANGE) continue;
      const z = zOf(ahead);
      const sh = SH[e.kind];
      switch (e.cls) {
        case 'obstacle': {
          let yaw = (e.seed - 0.5) * 0.7, y = 0, rz = 0, rx = 0, zz = z, xx = e.x;
          if (e.state === 'hit') { // 被撞到：晃一下、被撞歪
            const k = Math.min(1, (sim.time - e.hitT) / 0.3);
            const ease = 1 - (1 - k) * (1 - k);
            rz = ease * (e.seed < 0.5 ? 1.15 : -1.15) * (e.kind === 'puddle' ? 0 : 1); rx = -ease * 0.5 * (e.kind === 'puddle' ? 0 : 1);
            y = ease * 0.12; zz -= ease * 1.1; xx += ease * (e.seed < 0.5 ? 0.6 : -0.6);
            yaw += ease * 0.8;
          }
          if (e.kind === 'gate') {
            fixedInst.gate.add(xx, y, zz, 0, e.hw, 1, 1, rx, rz);
            if (e.state !== 'hit') shadows.add(xx + 0.1, 0.03, zz - 0.08, 0, e.hw * 1.05, 1, 0.4);
          } else {
            fixedInst[e.kind].add(xx, y, zz, yaw, 1, 1, 1, rx, rz);
            if (sh && e.state !== 'hit') shadows.add(xx + 0.1, 0.03, zz - 0.08, 0, sh[0], 1, sh[1]);
          }
          break;
        }
        case 'lure': {
          let y = 0, yaw = 0, sc = 1, rz = 0;
          const near = e.state === 'hit' ? 1 : 0;
          if (e.kind === 'pigeons') {
            const f = Math.min(1, Math.max(0, (2.8 - ahead) / 3.0));
            if (f > 0.02 && Math.abs(e.x - sim.x) < 2.2) {
              const ef = f * f;
              y = ef * 3.2 + Math.sin(t * 30 + e.seed * 9) * 0.06 * f;
              yaw = ef * 1.2 * (e.seed < 0.5 ? 1 : -1);
              sc = 1 - 0.25 * ef; rz = Math.sin(t * 34) * 0.18 * f;
              if (!e.fled) { e.fled = true; world.burst('feather', e.x, ahead); }
            }
            lureInst.pigeons.add(e.x + (y > 0 ? ahead * 0 : 0), y, z - (y > 0.1 ? f * 1.4 : 0), yaw, sc, sc, sc, 0, rz);
            if (y < 0.3) shadows.add(e.x + 0.1, 0.03, z - 0.05, 0, sh[0], 1, sh[1]);
          } else if (e.kind === 'dog') {
            const bounce = Math.abs(Math.sin(t * 5 + e.seed * 9)) * 0.1;
            const face = Math.atan2(sim.x - e.x, Math.max(2, ahead + DOG_Z)) * 0.6;
            lureInst.dog.add(e.x, bounce, z, face, 1.15, 1.15, 1.15, 0, Math.sin(t * 8 + e.seed * 5) * 0.03);
            shadows.add(e.x + 0.1, 0.03, z - 0.05, 0, sh[0], 1, sh[1]);
          } else {
            const bob = 0.03 + Math.sin(t * 3 + e.seed * 9) * 0.03;
            lureInst[e.kind].add(e.x, bob * (near ? 0 : 1), z, e.seed * 6.28 + (e.kind === 'icecream' ? 0 : 0), 1.4, 1.4, 1.4);
            shadows.add(e.x + 0.1, 0.03, z - 0.05, 0, sh[0] * 1.3, 1, sh[1] * 1.3);
          }
          void y; void yaw; void sc; void rz;
          break;
        }
        case 'crosser': {
          if (e.state === 'done') break;
          const dirYaw = e.dir > 0 ? 0 : Math.PI;
          const moving = e.active;
          if (e.kind === 'ball') {
            const bounce = moving ? Math.abs(Math.sin(t * 9 + e.seed * 6)) * 0.3 : 0;
            crossInst.ball.add(e.x, 0.34 + bounce, z, 0, 1, 1, 1, 0, -(e.x / 0.34) * (moving ? 1 : 0) - e.seed * 6);
            shadows.add(e.x + 0.1, 0.03, z - 0.05, 0, sh[0] * (1 - bounce * 0.8), 1, sh[1] * (1 - bounce * 0.8));
          } else if (e.kind === 'bike') {
            const sway = moving ? Math.sin(t * 14) * 0.03 : 0;
            crossInst.bike.add(e.x, moving ? Math.abs(Math.sin(t * 14)) * 0.02 : 0, z, dirYaw, 1.1, 1.1, 1.1, 0, sway);
            shadows.add(e.x + 0.1, 0.03, z - 0.05, 0, sh[0] * 1.1, 1, sh[1]);
          } else {
            crossInst.skate.add(e.x, 0, z, dirYaw, 1.1, 1.1, 1.1, 0, moving ? Math.sin(t * 6) * 0.06 : 0);
            shadows.add(e.x + 0.1, 0.03, z - 0.05, 0, sh[0], 1, sh[1]);
          }
          // 提示牌：立在它出发那一侧的路边，进入提示距离后一闪一闪
          const sd = -e.dir; // 出发侧
          const pulse = e.warn ? 1 + Math.sin(t * 9) * 0.08 : 1;
          warnInst.add(sd * 3.7, 0, zOf(ahead + 2.2), sd > 0 ? -0.35 : 0.35, pulse, pulse, pulse);
          break;
        }
        case 'fear': {
          const k = e.kind;
          let y = 0, sc = 1;
          if (k === 'balloons') {
            if (e.state === 'hit') break; // 被撞到：气球啪地爆了
            y = Math.sin(t * 2 + e.seed * 9) * 0.08;
          } else if (k === 'sprinkler') sc = 1 + Math.sin(t * 12 + e.seed * 6) * 0.03;
          fearInst[k].add(e.x, y, z, k === 'sweeper' ? 0 : t * (k === 'sprinkler' ? 2.5 : 0) + e.seed * 6, sc, sc, sc);
          if (SH[k]) shadows.add(e.x + 0.1, 0.03, z - 0.05, 0, SH[k][0], 1, SH[k][1]);
          break;
        }
        case 'mover': {
          const k = e.kind;
          const lateral = MOVER_KINDS[k].mode === 'lateral';
          if (lateral) {
            const dirv = Math.cos((t * 6.2832) / e.period + e.tAct); // 左右移动的方向
            moverInst[k].add(e.x, 0, z, dirv > 0 ? 0.2 : -0.2, 1.1, 1.1, 1.1, 0, 0);
          } else {
            const wob = e.active ? Math.abs(Math.sin(t * 7 + e.seed * 5)) * 0.05 : 0;
            moverInst[k].add(e.x, wob, z, 0, 1.15, 1.15, 1.15, 0, e.active ? Math.sin(t * 7 + e.seed * 5) * 0.04 : 0);
          }
          if (SH[k]) shadows.add(e.x + 0.1, 0.03, z - 0.05, 0, SH[k][0], 1, SH[k][1]);
          break;
        }
        case 'critter': {
          if (e.state === 'done') break;
          const moving = e.active;
          critterInst[e.kind].add(e.x, moving ? Math.abs(Math.sin(t * 16)) * 0.12 : 0, z, e.dir > 0 ? 0 : Math.PI, 1.6, 1.6, 1.6, 0, 0);
          if (SH[e.kind]) shadows.add(e.x + 0.1, 0.03, z - 0.05, 0, SH[e.kind][0] * 1.6, 1, SH[e.kind][1] * 1.6);
          const sd = -e.dir;
          const pulse = e.warn ? 1 + Math.sin(t * 9) * 0.08 : 1;
          warnInst.add(sd * 3.7, 0, zOf(ahead + 2.2), sd > 0 ? -0.35 : 0.35, pulse, pulse, pulse);
          break;
        }
        case 'soft': {
          if (e.state === 'done' && ahead < -2) break;
          bumpInst.add(0, 0, z, 0, 1, 1, 1);
          break;
        }
        case 'sniff': {
          stumpInst.add(e.x, 0, z, e.seed * 6, 1.1, 1.1 + (e.state === 'active' ? Math.sin(t * 6) * 0.03 : 0), 1.1);
          shadows.add(e.x + 0.1, 0.03, z - 0.05, 0, SH.stump[0], 1, SH.stump[1]);
          break;
        }
        case 'bone': {
          if (e.state !== 'idle') break;
          const y = 0.62 + Math.sin(t * 3.2 + e.seed * 12) * 0.07;
          boneInst.add(e.x, y, z, t * 2.2 + e.seed * 6.28, 1.15);
          shadows.add(e.x, 0.03, z, 0, sh[0], 1, sh[1]);
          break;
        }
        default: break;
      }
    }
    for (const k in fixedInst) fixedInst[k].end();
    for (const k in lureInst) lureInst[k].end();
    for (const k in crossInst) crossInst[k].end();
    for (const k in fearInst) fearInst[k].end();
    for (const k in moverInst) moverInst[k].end();
    for (const k in critterInst) critterInst[k].end();
    bumpInst.end(); stumpInst.end();
    boneInst.end(); warnInst.end();
    // 小狗自己的影子由外面加（world.dogShadow）
    if (world.dogShadow) shadows.add(world.dogShadow.x + 0.12, 0.03, world.dogShadow.z - 0.1, 0, SH.dog[0] * 1.2, 1, SH.dog[1] * 1.2);
    shadows.end();
  }

  const _cq = new THREE.Quaternion();
  function updateSparks(sim, dt, camera) {
    _cq.copy(camera.quaternion);
    sparks.begin();
    const sc = world.view.speed;
    for (let i = 0; i < SPARK_N; i++) {
      const s = sp[i];
      if (!s.on) continue;
      s.life -= dt;
      if (s.life <= 0) { s.on = false; continue; }
      s.vy += s.g * dt;
      s.x += s.vx * dt; s.y = Math.max(0.02, s.y + s.vy * dt); s.z += (s.vz + (s.scroll ? sc : 0)) * dt;
      const k = s.life / s.max;
      const size = s.size * (0.4 + 0.6 * k);
      _e.set(0, 0, s.spin + (1 - k) * 3);
      _q.setFromEuler(_e);
      _q.premultiply(_cq);
      _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(size, size, size));
      const idx = sparks.n++;
      sparks.mesh.setMatrixAt(idx, _m);
      sparks.mesh.setColorAt(idx, s.c);
    }
    sparks.end();
  }

  function updatePetals(sim, dt, t) {
    petals.begin();
    for (let i = 0; i < PETAL_N; i++) {
      const p = pet[i];
      p.ahead -= world.view.speed * dt;
      if (p.ahead < -BEHIND) { p.ahead += 62; p.x = (hash1(i * 7 + Math.floor(t), 76) - 0.5) * 22; p.y = 0.5 + hash1(i * 7 + Math.floor(t), 77) * 4; }
      const x = p.x + Math.sin(t * 1.3 + p.ph) * 0.6, y = p.y + Math.sin(t * 0.9 + p.ph * 2) * 0.35;
      _e.set(t * 1.7 + p.ph, t * 1.1 + p.ph * 3, 0.5 + p.ph);
      _q.setFromEuler(_e);
      _m.compose(_p.set(x, y, zOf(p.ahead)), _q, _s.set(p.sc, p.sc, p.sc));
      const idx = petals.n++;
      petals.mesh.setMatrixAt(idx, _m);
      col.copy(petalCols[i % 3]);
      petals.mesh.setColorAt(idx, col);
    }
    petals.end();
  }

  world.dispose = () => {
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  };
  world.stats = () => {
    let n = 0;
    scene.traverse((o) => { if (o.isMesh && o.visible && (!o.isInstancedMesh || o.count > 0)) n++; });
    return n;
  };
  void _c;
  return world;
}
