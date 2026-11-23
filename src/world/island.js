// WP1 小岛与田园场景：手绘水粉风悬浮岛（厚实岩土、密草、旧木板狗窝、歪栅栏、大树、池塘……）。
import * as THREE from 'three';
import { smoothstep, damp } from '../core/util.js';
import { paintMaterial, applyPaint } from '../core/paint.js';
import { C } from './island/colors.js';
import { L, RADIUS, outlineR, heightAt, kennelToWorld, LOOKOUT, lookoutSurface, lookoutLocal } from './island/shape.js';
import { buildTopGeometry, buildBodyGeometry, buildBodyDecor, buildFloaters } from './island/terrain.js';
import { buildKennel, LANTERN_LOCAL, SHELF, K as KENNEL_DIM } from './island/kennel.js';
import { buildProps } from './island/props.js';
import { makeGrassField, buildGrass, buildFlowers, swayUniforms } from './island/plants.js';
import { buildWater } from './island/water.js';
import { createFish } from './island/fish.js';
import { createPondLife } from './island/pondlife.js';
import { buildLookout, LOOKOUT_COLLIDERS, LOOKOUT_BLOCKERS } from './island/lookout.js';
import { createMatObject, MAT_LIFT, MAT_HALF_X, MAT_HALF_Z } from './island/mat.js';
import { mulberry32, clamp } from '../core/util.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const LIGHT_MAX = 7;
const KENNEL_CLEAR = 0.86; // 小狗的中心离狗窝墙体的最小距离（放大后的小狗：半身长约 0.65、半身宽约 0.3）

export function createIsland(ctx) {
  const group = new THREE.Group();
  group.name = 'island';

  // ---------- 材质 ----------
  const matTop = paintMaterial({ vertexColors: true, roughness: 1 }, { scale: 1.1, strength: 0.22, hue: 0.8, bands: 0.2, levels: 5 });
  const matBody = paintMaterial({ vertexColors: true, roughness: 1, flatShading: true }, { scale: 1.3, strength: 0.22, hue: 0.9, bands: 0.4, levels: 4, stretch: [1, 0.7, 1] });
  const matWood = paintMaterial({ vertexColors: true, roughness: 1, flatShading: true }, { scale: 1.5, strength: 0.2, hue: 0.6, bands: 0.3, levels: 4, stretch: [4, 1, 4] });
  const matSmooth = paintMaterial({ vertexColors: true, roughness: 1 }, { scale: 1.3, strength: 0.22, hue: 0.8, bands: 0.3, levels: 4 });
  const matGlow = paintMaterial({ color: 0xb8a67a, emissive: 0xffa940, emissiveIntensity: 0, roughness: 0.6 }, { scale: 3, strength: 0.08, bands: 0 });
  const wetMats = [matTop, matBody, matWood, matSmooth];

  const mk = (geo, mat, name, cast, recv = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = recv;
    group.add(m);
    return m;
  };

  // ---------- 地形 ----------
  const topMesh = mk(buildTopGeometry(), matTop, 'islandTop', false);
  const bodyGeo = mergeGeometries([buildBodyGeometry(), buildBodyDecor()], false);
  mk(bodyGeo, matBody, 'islandBody', false);
  const floaters = buildFloaters().map((f, i) => {
    const m = new THREE.Mesh(f.geo, paintMaterial({ vertexColors: true, roughness: 1, flatShading: true }, { scale: 2, space: 'local', bands: 0.35 }));
    m.position.set(...f.pos);
    m.name = 'floater' + i;
    m.castShadow = false;
    group.add(m);
    return { m, y0: f.pos[1], ph: i * 1.7 };
  });

  // ---------- 狗窝 ----------
  const kg = new THREE.Group();
  kg.name = 'kennel';
  kg.position.set(L.kennel.x, 0, L.kennel.z);
  kg.rotation.y = L.kennel.facing;
  kg.scale.setScalar(L.kennel.s);
  group.add(kg);
  const kennel = buildKennel();
  const kMain = new THREE.Mesh(kennel.main, matWood);
  kMain.castShadow = true; kMain.receiveShadow = true;
  const kGlow = new THREE.Mesh(kennel.glow, matGlow);
  kGlow.receiveShadow = false;
  const kFood = new THREE.Mesh(kennel.food, matWood);
  kFood.castShadow = false; kFood.visible = false;
  kg.add(kMain, kGlow, kFood);
  // 狗碗：level 0..1 = 碗里还剩多少狗粮（0 = 空碗）
  const bowl = { level: 0, setLevel(v) { bowl.level = Math.min(1, Math.max(0, v)); kFood.visible = bowl.level > 0.04; kFood.position.y = -0.045 * (1 - bowl.level); } };
  kg.updateMatrixWorld(true);

  // ---------- 玩具架（狗窝左侧外墙上的一排格子）----------
  // 每个格子：一个看不见的点击盒（整格都能点，格与格之间不重叠）+ 物品摆放用的位置和朝向。
  // 物品模块用 shelf.claim(id, { onClick, onHover }) 占一个格子；指针的悬停/点击判定由交互模块统一做（shelf.pick）。
  const shelf = (() => {
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const xMid = -(KENNEL_DIM.W + SHELF.depth / 2);
    const slots = SHELF.zs.map((z, index) => {
      const hit = new THREE.Mesh(new THREE.BoxGeometry(SHELF.depth + 0.14, SHELF.h + 0.1, SHELF.w + 0.03), hitMat);
      hit.position.set(xMid - 0.05, SHELF.y0 + SHELF.h / 2, z);
      hit.name = 'shelfSlot' + index;
      kg.add(hit);
      // 物品的摆放基准：格子正中、贴着背板
      const position = new THREE.Vector3(-(KENNEL_DIM.W + SHELF.back + 0.065), SHELF.y0 + SHELF.h / 2, z);
      kg.localToWorld(position);
      return { index, id: null, onClick: null, onHover: null, hit, position, width: SHELF.w * L.kennel.s, height: SHELF.h * L.kennel.s };
    });
    kg.updateMatrixWorld(true);
    const q = new THREE.Quaternion().setFromEuler(kg.rotation);
    const normal = new THREE.Vector3(-1, 0, 0).applyQuaternion(q); // 墙面朝外的方向
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(q);   // 沿墙面水平方向（朝门口一侧）
    const up = new THREE.Vector3(0, 1, 0);
    const hits = slots.map((s) => s.hit);
    let hovered = null;
    return {
      slots, normal, right, up,
      /** 占用第一个空格子，返回格子对象；没有空位返回 null */
      claim(id, handlers = {}) {
        const s = slots.find((x) => x.id === null);
        if (!s) return null;
        s.id = id; s.onClick = handlers.onClick || null; s.onHover = handlers.onHover || null;
        return s;
      },
      /** 射线命中的格子（取最近的一个），没有则为 null */
      pick(raycaster) {
        const r = raycaster.intersectObjects(hits, false);
        if (!r.length) return null;
        // 斜着看时，前面格子的点击盒会遮住后面的格子：在命中的格子里取“物品中心离射线最近”的那个，而不是最先命中的
        let best = null, bd = Infinity;
        for (const h of r) {
          const s = slots[hits.indexOf(h.object)];
          const d = raycaster.ray.distanceToPoint(s.position);
          if (d < bd) { bd = d; best = s; }
        }
        return best;
      },
      /** 设置当前悬停的格子（null = 没有），会通知相应物品 */
      setHover(slot) {
        if (slot === hovered) return;
        if (hovered && hovered.onHover) hovered.onHover(false);
        hovered = slot;
        if (hovered && hovered.onHover) hovered.onHover(true);
      },
      get hovered() { return hovered; },
    };
  })();
  const lanternPos = new THREE.Vector3(...LANTERN_LOCAL);
  kg.localToWorld(lanternPos);
  const lantern = new THREE.PointLight(C.lanternGlow, 0, 8, 2);
  lantern.name = 'lanternLight';
  lantern.position.copy(lanternPos);
  group.add(lantern);

  // ---------- 道具 ----------
  const props = buildProps(heightAt);
  // 瞭望台的木头并进 propsWood（不增加 draw call）
  const woodGeo = mergeGeometries([props.wood, buildLookout(heightAt)], false);
  mk(woodGeo, matWood, 'propsWood', true);
  mk(props.smooth, matSmooth, 'propsSmooth', true);

  // ---------- 水 ----------
  const water = buildWater();
  group.add(water.mesh);
  // 池塘里的小金鱼（在半透明的水面下游动）
  const fish = createFish(5, mulberry32(4242));
  group.add(fish.group);

  // ---------- 阻挡（草/花避让） ----------
  const [lpx, lpz] = kennelToWorld(L.lanternLocal.x, L.lanternLocal.z);
  const [bwx, bwz] = kennelToWorld(-0.8, 1.65);
  const shelfClear = [-0.75, 0, 0.75].map((z) => { const [x, zz] = kennelToWorld(-(KENNEL_DIM.W + 0.5), z); return [x, zz, 0.62]; });
  const blockers = [
    ...shelfClear,
    [L.tree.x, L.tree.z, 0.6], [L.veggie.x, L.veggie.z, 1.05],
    [lpx, lpz, 0.25], [bwx, bwz, 0.3], ...props.pumpkins.map((p) => [p[0], p[1], p[2] + 0.1]), ...LOOKOUT_BLOCKERS,
    ...props.rocks.map((r) => [r.x, r.z, r.r + 0.1]),
    [-6.05, -1.0, 0.8], [-5.6, -0.4, 0.4], [4.8, 4.4, 0.6], [5.25, 4.0, 0.35],
  ];
  const field = makeGrassField(blockers, props.stones);
  const grass = buildGrass(heightAt, field, 16000);
  group.add(grass);
  const patches = [
    { x: -1.7, z: -4.6, r: 0.9, n: 26, colors: [C.flowers[1], C.flowers[2]] },
    { x: 3.2, z: -5.1, r: 0.8, n: 22, colors: [C.flowers[4], C.flowers[2]] },
    { x: -5.4, z: 0.7, r: 0.8, n: 22, colors: [C.flowers[3], C.flowers[4]] },
    { x: -2.3, z: 4.7, r: 0.8, n: 22, colors: [C.flowers[0], C.flowers[1]] },
    { x: 3.4, z: 5.2, r: 0.8, n: 20, colors: [C.flowers[2], C.flowers[3]] },
    { x: 5.9, z: 1.7, r: 0.8, n: 22, colors: [C.flowers[4], C.flowers[0], C.flowers[1]] },
    { x: 6.0, z: 3.0, r: 0.5, n: 12, colors: [C.flowers[3], C.flowers[2]] },
    { x: -0.5, z: -3.3, r: 0.5, n: 10, colors: [C.flowers[0], C.flowers[2]] },
  ];
  const flowers = buildFlowers(heightAt, field, patches, blockers);
  for (const m of flowers.meshes) group.add(m);

  // ---------- 障碍与可行走 ----------
  const obstacles = [
    { x: L.kennel.x, z: L.kennel.z, r: 1.86 * L.kennel.s, name: 'kennel' }, // 盖住四个墙角；门外落脚点在圆外
    { x: L.tree.x, z: L.tree.z, r: 0.9, name: 'tree' },
    { x: L.pond.x, z: L.pond.z, r: L.pond.r + 0.28, name: 'pond' }, // 喝水点在 r + 0.3
    { x: L.veggie.x, z: L.veggie.z, r: 1.2, name: 'veggie' },
    { x: lpx, z: lpz, r: 0.4, name: 'lantern' },
    { x: -5.4, z: -0.1, r: 1.5, name: 'thicket' }, // 狗窝西侧的高草丛死角（进得去出不来）
    ...props.rocks,
    ...LOOKOUT_COLLIDERS,
  ];

  // 收口：解析式的 rawWalkable 会留下一些“能站但没用”的地方——小屋后墙和岛沿之间不到半个身位宽的窄带、被障碍围住的小口袋。
  // 小狗能沿直线走进去，寻路却规划不出离开的路线（追木棍时卡在屋后原地转圈、木棍隔空回到手上）。
  // 这里铺一张 0.125 的细栅格：只有“容得下狗身子”（四周 ROOM 以内都能站）并且从草坪一路走得到的格子才算数，
  // 再向外补回 KEEP 的一圈（贴着障碍 / 岛沿的边仍然能站）。其余的 rawWalkable 区域一律不可行走。
  // KEEP 要比 ROOM 多出栅格的斜向误差（0.125 × √2 ≈ 0.18）：否则紧贴障碍圆的那一线会时有时无，小狗贴着障碍滑行时被卡住。
  const WG = 0.125, WR = 9.5, WN = Math.round((2 * WR) / WG) + 1, ROOM = 0.25, KEEP = 0.45;
  let walkMask = null;
  function buildWalkMask() {
    const roomy = new Uint8Array(WN * WN), reach = new Uint8Array(WN * WN);
    const mask = new Uint8Array(WN * WN);
    for (let iz = 0; iz < WN; iz++) for (let ix = 0; ix < WN; ix++) {
      const x = -WR + ix * WG, z = -WR + iz * WG;
      let ok = rawWalkable(x, z);
      for (let k = 0; k < 8 && ok; k++) ok = rawWalkable(x + Math.cos(k * Math.PI / 4) * ROOM, z + Math.sin(k * Math.PI / 4) * ROOM);
      roomy[iz * WN + ix] = ok ? 1 : 0;
    }
    const start = Math.round((L.lawn.z + WR) / WG) * WN + Math.round((L.lawn.x + WR) / WG);
    if (!roomy[start]) { walkMask = mask.fill(1); return; } // 草坪中心都站不下（不该发生）：不收口，退回解析式
    const stack = [start]; reach[start] = 1;
    while (stack.length) {
      const c = stack.pop(), cx = c % WN, cz = (c / WN) | 0;
      if (cx > 0 && roomy[c - 1] && !reach[c - 1]) { reach[c - 1] = 1; stack.push(c - 1); }
      if (cx < WN - 1 && roomy[c + 1] && !reach[c + 1]) { reach[c + 1] = 1; stack.push(c + 1); }
      if (cz > 0 && roomy[c - WN] && !reach[c - WN]) { reach[c - WN] = 1; stack.push(c - WN); }
      if (cz < WN - 1 && roomy[c + WN] && !reach[c + WN]) { reach[c + WN] = 1; stack.push(c + WN); }
    }
    const kr = Math.ceil(KEEP / WG);
    for (let iz = 0; iz < WN; iz++) for (let ix = 0; ix < WN; ix++) {
      if (!reach[iz * WN + ix]) continue;
      for (let dz = -kr; dz <= kr; dz++) for (let dx = -kr; dx <= kr; dx++) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= WN || jz >= WN || Math.hypot(dx, dz) * WG > KEEP + 1e-6) continue;
        mask[jz * WN + jx] = 1;
      }
    }
    walkMask = mask;
  }
  function isWalkable(x, z) {
    if (!rawWalkable(x, z)) return false;
    if (!walkMask) buildWalkMask();
    const ix = Math.round((x + WR) / WG), iz = Math.round((z + WR) / WG);
    return ix >= 0 && iz >= 0 && ix < WN && iz < WN && walkMask[iz * WN + ix] === 1;
  }

  function rawWalkable(x, z) {
    if (!(Number.isFinite(x) && Number.isFinite(z))) return false;
    if (Math.hypot(x, z) > outlineR(Math.atan2(z, x)) - 0.85) return false; // 岛沿余量（栅栏在边缘内 0.3，狗身半长约 0.65）
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (Math.hypot(x - o.x, z - o.z) < o.r) return false;
    }
    // 狗窝是方的：圆形障碍盖不住四个墙角，也没给狗的身长留余量（狗面朝墙站在圆的边上时，头会伸进墙里）。
    // 这里按墙体的实际矩形再留出一个身位：离墙不到 KENNEL_CLEAR 的地方都不能站。进出狗窝走的是脚本化的直线段，不受此限制。
    {
      const kk = L.kennel, dx = x - kk.x, dz = z - kk.z;
      const c = Math.cos(kk.facing), s = Math.sin(kk.facing);
      const lx = Math.abs(dx * c - dz * s) - 1.0 * kk.s, lz = Math.abs(dx * s + dz * c) - 1.1 * kk.s;
      const d = lx <= 0 && lz <= 0 ? Math.max(lx, lz) : Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
      if (d < KENNEL_CLEAR) return false;
    }
    return true;
  }

  function clampWalkable(x, z, margin = 0.5) {
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(z)) z = 0;
    const mg = Math.max(0.5, margin) + 0.01;
    for (let iter = 0; iter < 8; iter++) {
      const d = Math.hypot(x, z);
      const maxR = outlineR(Math.atan2(z, x)) - mg;
      if (d > maxR) { const k = maxR / d; x *= k; z *= k; }
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        let dx = x - o.x, dz = z - o.z, dd = Math.hypot(dx, dz);
        const minD = o.r + 0.02;
        if (dd < minD) {
          if (dd < 1e-6) { dx = 1; dz = 0; dd = 1; }
          x = o.x + (dx / dd) * minD; z = o.z + (dz / dd) * minD;
        }
      }
      if (isWalkable(x, z)) return { x, z };
    }
    // 兜底：由近及远螺旋搜索可行走点
    const ox = x, oz = z;
    let best = { x: L.lawn.x, z: L.lawn.z }, bd = Infinity;
    for (let r = 0; r < 7; r += 0.25) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const px = ox + Math.cos(a) * r, pz = oz + Math.sin(a) * r;
        if (isWalkable(px, pz)) { const d = Math.hypot(px - ox, pz - oz); if (d < bd) { bd = d; best = { x: px, z: pz }; } }
      }
      if (bd < Infinity) break;
    }
    return best;
  }

  const v = (x, z) => new THREE.Vector3(x, heightAt(x, z), z);
  const k = L.kennel;
  // 树下的午睡点：树干朝草坪一侧 1.55 处（树冠底下、离树干一个身位），脸朝草坪
  const napTree = (() => {
    const dx = L.lawn.x - L.tree.x, dz = L.lawn.z - L.tree.z, d = Math.hypot(dx, dz) || 1;
    let x = L.tree.x + (dx / d) * 1.55, z = L.tree.z + (dz / d) * 1.55;
    if (!isWalkable(x, z)) { const c = clampWalkable(x, z); x = c.x; z = c.z; }
    return { x, z, facing: Math.atan2(dx, dz) };
  })();
  const anchors = {
    // 门外落脚点：离前墙 1.2（要比墙体余量 KENNEL_CLEAR 多出“到达半径 0.2”以上，否则出窝后一步就踩进禁区被卡住）
    kennelDoor: v(k.x + k.dx * (1.1 * k.s + 1.2), k.z + k.dz * (1.1 * k.s + 1.2)),
    // 趴卧点：让（放大后的）狗趴下时头正好从门洞探出一点
    kennelInside: v(k.x + k.dx * (1.1 * k.s - 0.8), k.z + k.dz * (1.1 * k.s - 0.8)),
    kennelFacing: k.facing,
    lawn: { x: L.lawn.x, z: L.lawn.z, r: L.lawn.r },
    front: v(L.front.x, L.front.z),
    frontFacing: 0,
    flowerSpots: [v(-1.7, -4.6), v(3.2, -5.1), v(-5.4, 0.7), v(-2.3, 4.7), v(3.4, 5.2), v(5.9, 1.7), v(6.0, 3.0)],
    sniffSpots: [v(3.35, -2.35), v(-0.9, -5.05), v(-1.75, 1.6), v(-1.2, -3.5), v(4.2, -1.75), v(-2.3, 4.2)],
    napSpot: v(napTree.x, napTree.z), // 老接口：现在等于树下那个午睡点（原来的 (3.6, 1.8) 紧挨着后来加的瞭望台坡道底端，小狗趴下去头搭在坡道上）
    sunsetSpot: v(2.4, 3.1),
    sunsetFacing: -Math.PI / 2,
    pond: { x: L.pond.x, z: L.pond.z, r: L.pond.r },
    pondDrink: v(L.pond.x + (L.pond.r + 0.3) * 0.97, L.pond.z - (L.pond.r + 0.3) * 0.24),
    bowl: v(bwx, bwz), // 狗碗（窝门口左前）
    // 吃饭时站的位置：碗的右侧（靠门那边、顺着墙的方向）、略靠外，脸朝着碗——从正面看过去能看到它埋头吃的脸，碗在它嘴前不被身子挡住
    bowlStand: (() => { let x = bwx + k.dz * 0.66 + k.dx * 0.3, z = bwz - k.dx * 0.66 + k.dz * 0.3; if (!isWalkable(x, z)) { const c = clampWalkable(x, z); x = c.x; z = c.z; } return v(x, z); })(),
  };
  // 午睡的地方（垫子在窝里时）：窝门口（门外落脚点，脸朝外）或者树下。垫子在外面时睡在垫子上（见 brain/matBehaviors.js）。
  anchors.napSpots = [
    { name: 'door', x: anchors.kennelDoor.x, z: anchors.kennelDoor.z, facing: k.facing },
    { name: 'tree', x: napTree.x, z: napTree.z, facing: napTree.facing },
  ];

  // 池塘里的常驻小动物：青蛙（荷叶）与螃蟹（岸边石头）
  const pondLife = createPondLife({ heightAt, anchors, rng: mulberry32(9090) });
  group.add(pondLife.group);

  // ---------- 瞭望台 anchors ----------
  {
    const o = LOOKOUT;
    // 坡道底端 u = half + rampLen，落脚点再向外 baseGap
    const ub = o.half + o.rampLen + o.baseGap;
    const bx = o.x + o.dx * ub, bz = o.z + o.dz * ub;
    anchors.lookout = {
      base: new THREE.Vector3(bx, heightAt(bx, bz), bz),
      top: new THREE.Vector3(o.x, o.H, o.z),
      rampFacing: Math.atan2(-o.dx, -o.dz), // 从 base 上坡的朝向
      viewFacings: [0.45, -Math.PI / 2, 1.5], // 朝镜头偏右 / 朝西（看夕阳） / 朝东远眺
      height: o.H,
    };
  }

  // ---------- 狗垫（位置、朝向、倾斜由行为模块每帧控制） ----------
  const matObj = createMatObject();
  group.add(matObj);
  const matHome = new THREE.Vector3();
  {
    matHome.set(k.x + k.dx * (1.1 * k.s - 0.1 - MAT_HALF_Z - 0.04), 0, k.z + k.dz * (1.1 * k.s - 0.1 - MAT_HALF_Z - 0.04));
    matHome.y = heightAt(matHome.x, matHome.z);
    matObj.position.set(matHome.x, matHome.y + MAT_LIFT, matHome.z);
    matObj.rotation.y = anchors.kennelFacing;
  }
  const mat = {
    object: matObj,
    home: matHome,
    homeYaw: anchors.kennelFacing,
    top: 0.05, // 垫面比地面高出多少（狗趴在垫子上时要抬高这么多，否则身体陷进垫子里）
    lift: MAT_LIFT, halfX: MAT_HALF_X, halfZ: MAT_HALF_Z,
  };

  // 对外高度：地面与瞭望台表面取较大者（草、花、岩石等内部放置仍用纯地面 heightAt）
  function worldHeightAt(x, z) {
    const g = heightAt(x, z);
    const s = lookoutSurface(x, z);
    return s === null ? g : Math.max(g, s);
  }

  // ---------- 动画 ----------
  const _c1 = new THREE.Color(), _dayGlass = new THREE.Color(0xb8a67a), _nightGlass = new THREE.Color(C.lantern);
  let time = 0, lit = 0, rainSm = 0;
  function update(dt, env) {
    time += dt;
    const wind = env && Number.isFinite(env.wind) ? env.wind : 0.1;
    const wet = env && Number.isFinite(env.wetness) ? env.wetness : 0;
    const df = env && Number.isFinite(env.dayFactor) ? env.dayFactor : 1;
    const rain = env && Number.isFinite(env.rain) ? env.rain : 0;
    swayUniforms.uSwayTime.value += dt * (0.8 + 1.2 * wind);
    swayUniforms.uWind.value = wind;
    // 狗身下的草：站着/走着时把身下的草拨开压低，趴下、睡觉、打滚时压平更大一圈
    {
      const d = ctx.dog;
      if (d && d.group) {
        const sc = d.group.scale.x || 1, a = d.action;
        const low = a === 'lie' || a === 'sleep' || a === 'roll';
        const u = swayUniforms.uDogPress.value;
        u.x = d.group.position.x; u.y = d.group.position.z;
        u.z = damp(u.z, (low ? 0.6 : 0.42) * sc, 5, dt);
        u.w = damp(u.w, low ? 0.97 : a === 'sit' ? 0.9 : 0.8, 5, dt);
      }
    }
    // 狗垫压住的草（垫子被狗拖到哪里，那一块草就被压平）
    {
      const mp = matObj.position, yw = matObj.rotation.y;
      swayUniforms.uMatPose.value.set(mp.x, mp.z, Math.sin(yw), Math.cos(yw));
    }
    const dark = 1 - 0.16 * wet; // 雨后地面潮湿只略微变深（原先 0.3，叠上阴天后整块草地发黑）
    for (let i = 0; i < wetMats.length; i++) wetMats[i].color.setScalar(dark);
    rainSm = damp(rainSm, rain, 3, dt);
    water.uniforms.uWTime.value = time;
    water.uniforms.uRain.value = rainSm;
    // 狗在池塘边喝水时，小鱼受惊游开
    {
      const d = ctx.dog;
      const drinking = !!(d && d.action === 'drink' && Math.hypot(d.group.position.x - L.pond.x, d.group.position.z - L.pond.z) < L.pond.r + 1.8);
      fish.update(dt, env, drinking ? d.group.position : null);
      pondLife.update(dt, env, d && d.group ? d.group.position : null);
    }
    // 灯笼：dayFactor < 0.3 渐亮
    const target = 1 - smoothstep(0.05, 0.32, df);
    lit = damp(lit, target, 2.5, dt);
    lantern.intensity = lit * LIGHT_MAX;
    matGlow.emissiveIntensity = lit * 1.7;
    matGlow.color.copy(_dayGlass).lerp(_nightGlass, lit);
    // 浮石
    for (let i = 0; i < floaters.length; i++) {
      const f = floaters[i];
      f.m.position.y = f.y0 + Math.sin(time * 0.5 + f.ph) * 0.12;
      f.m.rotation.y += dt * 0.05;
    }
  }

  return {
    group, update,
    radius: RADIUS,
    heightAt: worldHeightAt,
    groundHeightAt: heightAt,
    isWalkable,
    isWalkableRaw: rawWalkable, // 调试 / 测试用：收口之前的解析式判断
    clampWalkable,
    obstacles,
    groundMeshes: [topMesh],
    shelf, // 狗窝外墙上的玩具架
    flowerHeads: flowers.heads, // [{x, z, top}] 每朵花的花头顶面（昆虫落脚点）
    anchors,
    bowl, // 狗碗里的狗粮（{ level, setLevel(0..1) }）
    pondLife, // 池塘常驻的青蛙 / 螃蟹（{ group, update, frogs, crabs, setHidden(bool) }）
    mat,
  };
}
