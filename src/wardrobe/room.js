// 衣帽间：小屋里一扇小门后面的童话小房间（里面比外面大）。旧木板拼的墙和地板、穿衣镜、挂衣杆 + 空衣架、
// 后墙搁板上盖着的帽盒、一串小灯泡。纯布景：自带灯光和背景，不依赖小岛的天空 / 太阳。
// 坐标：原点 = 小狗两脚之间的地面；+z 朝相机（小狗面朝的方向），+x 向右，+y 向上。
import * as THREE from 'three';
import { mulberry32 } from '../core/util.js';
import { paintMaterial } from '../core/paint.js';
import { C } from '../world/island/colors.js';
import { GeoBuilder, cylBetween, mixHex } from '../world/island/geo.js';

const BACK_Z = -2.4; // 后墙内表面
const HALF_W = 6.6; // 房间半宽（墙够宽，窄/宽窗口都看不到墙外）
const WALL_H = 6.5;
const FRONT_Z = 7.5; // 地板向相机后方延伸

const PALETTE = {
  plankA: 0x9a7650, plankB: 0x8a6a48, plankC: 0x7c5f42, plankD: 0xa88660,
  floorA: 0x7a5a3c, floorB: 0x6a4e34, floorC: 0x866444,
  rugRed: 0xb5532a, rugCream: 0xe8dcc0, rugTeal: 0x46683d, rugGold: 0xc9a85a,
  glass: 0x8fa8a6,
};

export function createWardrobeRoom() {
  const rng = mulberry32(777);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2c2018);
  scene.fog = null;

  // ---------- 材质（全项目统一的手绘质感） ----------
  const matWood = paintMaterial({ vertexColors: true, roughness: 1, flatShading: true }, { scale: 1.5, strength: 0.2, hue: 0.6, bands: 0.3, levels: 4, stretch: [4, 1, 4] });
  const matSmooth = paintMaterial({ vertexColors: true, roughness: 1 }, { scale: 1.3, strength: 0.22, hue: 0.8, bands: 0.3, levels: 4 });
  const matGlass = paintMaterial({ color: PALETTE.glass, emissive: 0x7f9a98, emissiveIntensity: 0.1, roughness: 0.4 }, { scale: 2.5, strength: 0.06, bands: 0 });
  const matGlow = paintMaterial({ color: 0xb8a67a, emissive: 0xffa940, emissiveIntensity: 1.6, roughness: 0.6 }, { scale: 3, strength: 0.08, bands: 0 });
  const matHang = paintMaterial({ vertexColors: true, roughness: 1, flatShading: true }, { scale: 1.5, strength: 0.2, hue: 0.6, bands: 0.3, levels: 4, space: 'local' });

  // 房间整体压暗一点：靠主聚光在小狗一带形成亮区，四周更暗（狗毛的亮度由平行光决定，不受影响）
  matWood.color.setScalar(0.72); matHang.color.setScalar(0.8); matSmooth.color.setScalar(0.85);

  const b = new GeoBuilder({ seed: 31, jitter: 0.07, aoH: 0.5, aoK: 0.3 });
  const smooth = new GeoBuilder({ seed: 32, jitter: 0.04, aoK: 0 });
  const glow = new GeoBuilder({ seed: 33, jitter: 0, aoK: 0 });

  const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  const tone = (base, amt) => mixHex(base, rng() < 0.5 ? 0xffffff : 0x000000, Math.abs((rng() - 0.5) * amt));

  // ---------- 地板：横铺的旧木板，略歪、有色差 ----------
  {
    const bw = 0.34, n = Math.ceil((FRONT_Z - BACK_Z) / bw);
    for (let i = 0; i < n; i++) {
      const z = BACK_Z + bw / 2 + i * bw;
      b.add(new THREE.BoxGeometry(HALF_W * 2, 0.06, bw - 0.014), {
        pos: [0, -0.07, z], rot: [0, (rng() - 0.5) * 0.006, (rng() - 0.5) * 0.004],
        color: tone(pick([PALETTE.floorA, PALETTE.floorB, PALETTE.floorC, PALETTE.floorA]), 0.18), ao: false,
      });
    }
    // 板缝下的暗底
    b.add(new THREE.BoxGeometry(HALF_W * 2, 0.04, FRONT_Z - BACK_Z), { pos: [0, -0.12, (BACK_Z + FRONT_Z) / 2], color: C.innerDark, ao: false });
  }

  // ---------- 后墙：竖板（长短不一，顶端略参差）+ 踢脚板 ----------
  {
    const pw = 0.4, n = Math.ceil((HALF_W * 2) / pw);
    for (let i = 0; i < n; i++) {
      const x = -HALF_W + pw / 2 + i * pw;
      const h = WALL_H + (rng() - 0.5) * 0.1;
      const col = tone(pick([PALETTE.plankA, PALETTE.plankB, PALETTE.plankC, PALETTE.plankD, PALETTE.plankB]), 0.2);
      b.add(new THREE.BoxGeometry(pw - 0.016, h, 0.08), {
        pos: [x, h / 2 - 0.05, BACK_Z - 0.04], rot: [0, 0, (rng() - 0.5) * 0.012], color: col, ao: true,
      });
    }
    b.add(new THREE.BoxGeometry(HALF_W * 2, 0.16, 0.05), { pos: [0, 0.08, BACK_Z + 0.02], color: C.woodDeep, ao: false });
    // 横向的两根托梁（把竖板钉在一起）
    for (const y of [0.9, 3.4]) b.add(new THREE.BoxGeometry(HALF_W * 2, 0.12, 0.05), { pos: [0, y, BACK_Z + 0.02], rot: [0, 0, (rng() - 0.5) * 0.01], color: 0x6a4e34, ao: false });
  }

  // ---------- 两侧墙 ----------
  for (const sx of [-1, 1]) {
    const pw = 0.4, zLen = FRONT_Z - BACK_Z, n = Math.ceil(zLen / pw);
    for (let i = 0; i < n; i++) {
      const z = BACK_Z + pw / 2 + i * pw;
      const h = WALL_H + (rng() - 0.5) * 0.1;
      b.add(new THREE.BoxGeometry(0.08, h, pw - 0.016), {
        pos: [sx * (HALF_W + 0.04), h / 2 - 0.05, z], rot: [0, 0, (rng() - 0.5) * 0.01],
        color: tone(pick([PALETTE.plankA, PALETTE.plankB, PALETTE.plankC, PALETTE.plankD]), 0.2), ao: true,
      });
    }
  }

  // ---------- 搁板 + 帽盒 / 小箱子（后墙，避开小狗正后方） ----------
  const SHELF_Y = 1.62;
  b.add(new THREE.BoxGeometry(HALF_W * 1.6, 0.06, 0.4), { pos: [0, SHELF_Y, BACK_Z + 0.2], rot: [0, 0, 0.004], color: C.woodWarm, ao: false });
  for (const x of [-3.9, -1.3, 1.3, 3.9]) {
    cylBetween(b, [x, SHELF_Y - 0.03, BACK_Z + 0.03], [x + (x > 0 ? -0.2 : 0.2), SHELF_Y - 0.42, BACK_Z + 0.36], 0.022, 0.022, 4, { color: C.woodGreyDark, ao: false });
    b.add(new THREE.BoxGeometry(0.05, 0.4, 0.05), { pos: [x, SHELF_Y - 0.2, BACK_Z + 0.03], color: C.woodGreyDark, ao: false });
  }
  const hatbox = (x, base, r, h, col, lidCol) => {
    smooth.add(new THREE.CylinderGeometry(r, r * 1.02, h, 14), { pos: [x, base + h / 2, BACK_Z + 0.22], color: col, ao: false });
    smooth.add(new THREE.CylinderGeometry(r * 1.07, r * 1.07, 0.07, 14), { pos: [x, base + h + 0.02, BACK_Z + 0.22], color: lidCol, ao: false });
    smooth.add(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.03, 8), { pos: [x, base + h + 0.07, BACK_Z + 0.22], color: C.woodDeep, ao: false });
  };
  const SB = SHELF_Y + 0.03;
  hatbox(-3.9, SB, 0.34, 0.3, 0xd7b98a, C.rust);
  hatbox(-3.9, SB + 0.4, 0.26, 0.22, C.cream, C.rugTeal);
  hatbox(-3.15, SB, 0.28, 0.24, C.rugTeal, C.cream);
  hatbox(-2.4, SB, 0.3, 0.28, C.rust, 0xd9a860);
  hatbox(2.0, SB, 0.3, 0.28, C.cream, C.rust);
  hatbox(2.0, SB + 0.37, 0.22, 0.2, 0xb08a5a, C.woodDeep);
  hatbox(2.75, SB, 0.34, 0.32, 0x7a6a50, C.cream);
  // 小木箱（盖着的）
  const crate = (x, base, w, h, d, rz, col, cz = BACK_Z + 0.22) => {
    b.add(new THREE.BoxGeometry(w, h, d), { pos: [x, base + h / 2, cz], rot: [0, rz, 0], color: col, ao: false });
    b.add(new THREE.BoxGeometry(w + 0.04, 0.04, d + 0.04), { pos: [x, base + h + 0.02, cz], rot: [0, rz, 0], color: C.woodDeep, ao: false });
    b.add(new THREE.BoxGeometry(0.06, h * 0.9, d + 0.02), { pos: [x - w * 0.3, base + h / 2, cz], rot: [0, rz, 0], color: C.woodGreyDark, ao: false });
    b.add(new THREE.BoxGeometry(0.06, h * 0.9, d + 0.02), { pos: [x + w * 0.3, base + h / 2, cz], rot: [0, rz, 0], color: C.woodGreyDark, ao: false });
  };
  crate(3.65, SB, 0.55, 0.36, 0.34, 0.08, C.woodWarm);
  crate(-1.6, SB, 0.45, 0.26, 0.3, -0.06, C.woodGrey);

  // ---------- 一排挂钩（后墙更高处，空的） ----------
  for (let i = 0; i < 14; i++) {
    const x = -5.2 + i * 0.8 + (rng() - 0.5) * 0.08;
    if (Math.abs(x) < 1.0) continue;
    b.add(new THREE.BoxGeometry(0.1, 0.1, 0.02), { pos: [x, 2.55, BACK_Z + 0.02], color: C.woodDeep, ao: false });
    cylBetween(b, [x, 2.55, BACK_Z + 0.03], [x, 2.55, BACK_Z + 0.2], 0.018, 0.018, 4, { color: C.woodDeep, ao: false });
    cylBetween(b, [x, 2.55, BACK_Z + 0.2], [x, 2.67, BACK_Z + 0.2], 0.018, 0.026, 4, { color: C.woodDeep, ao: false });
  }

  // ---------- 圆形编织地垫（顶面 = 地面 y=0，小狗站在它中心） ----------
  {
    const rings = [[1.2, PALETTE.rugRed], [1.0, PALETTE.rugCream], [0.82, PALETTE.rugTeal], [0.62, PALETTE.rugGold], [0.42, PALETTE.rugRed], [0.22, PALETTE.rugCream]];
    rings.forEach(([r, col], i) => {
      const top = i * 0.0015;
      smooth.add(new THREE.CylinderGeometry(r, r, 0.07, 28), { pos: [0, top - 0.035, 0], color: col, ao: false, jitter: 0.06 });
    });
    // 边缘的编织绳圈
    const rope = new THREE.TorusGeometry(1.2, 0.04, 6, 40);
    rope.rotateX(Math.PI / 2);
    smooth.add(rope, { pos: [0, -0.005, 0], color: 0xa98840, ao: false, jitter: 0.1 });
  }

  // ---------- 穿衣镜（左，立式椭圆，略向内转、向后仰） ----------
  {
    const mx = -2.3, mz = -1.65, a = 0.5, bb = 0.95, cy = 1.1;
    const mat4 = new THREE.Matrix4().compose(
      new THREE.Vector3(mx, 0, mz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.28, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    const frame = new GeoBuilder({ seed: 41, jitter: 0.07, aoK: 0 });
    const seg = 30;
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const px = Math.cos(th) * a, py = Math.sin(th) * bb;
      const ang = Math.atan2(bb * Math.cos(th), -a * Math.sin(th));
      const len = Math.hypot(a * Math.sin(th), bb * Math.cos(th)) * (Math.PI * 2 / seg) * 1.18;
      frame.add(new THREE.BoxGeometry(len, 0.09, 0.07), { pos: [px, cy + py, 0], rot: [0, 0, ang], color: i % 2 ? C.woodWarm : 0x7a5a3c, ao: false });
    }
    // 两条后撑腿 + 底部横木
    for (const sx of [-1, 1]) {
      cylBetween(frame, [sx * 0.28, 0.35, 0], [sx * 0.44, 0.0, -0.5], 0.03, 0.026, 5, { color: C.woodGreyDark, ao: false });
      frame.add(new THREE.BoxGeometry(0.1, 0.08, 0.06), { pos: [sx * 0.34, 0.2, -0.28], rot: [0, 0, 0], color: C.woodGreyDark, ao: false });
    }
    cylBetween(frame, [0, cy - bb - 0.02, 0.0], [0, 0.0, -0.5], 0.026, 0.026, 5, { color: C.woodGreyDark, ao: false });
    const fg = frame.build();
    fg.applyMatrix4(mat4);
    b.parts.push(fg);
    // 镜面（浅色椭圆，略凹进框里）
    const gg = new THREE.CircleGeometry(1, 32);
    gg.scale(a * 0.95, bb * 0.95, 1);
    gg.translate(0, cy, -0.01);
    gg.applyMatrix4(mat4);
    scene.userData.glassGeo = gg;
  }
  const glassGeo = scene.userData.glassGeo;
  delete scene.userData.glassGeo;

  // ---------- 一串小灯泡（后墙前方，低垂的弧线）+ 灯座 ----------
  const BULBS = 11, bulbPos = [];
  {
    const zc = -1.55, xL = -5.6, xR = 5.6, yEnd = 2.55, sag = 0.5;
    for (let i = 0; i <= 40; i++) {
      const t0 = i / 40, t1 = (i + 1) / 40;
      if (i === 40) break;
      const p = (t) => [xL + (xR - xL) * t, yEnd - sag * 4 * t * (1 - t), zc + Math.sin(t * 6.0) * 0.05];
      cylBetween(b, p(t0), p(t1), 0.01, 0.01, 3, { color: C.woodDeep, ao: false, jitter: 0 });
    }
    for (let i = 0; i < BULBS; i++) {
      const t = (i + 0.5) / BULBS;
      const x = xL + (xR - xL) * t, y = yEnd - sag * 4 * t * (1 - t) - 0.08, z = zc + Math.sin(t * 6.0) * 0.05;
      b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 6), { pos: [x, y + 0.06, z], color: C.woodDeep, ao: false, jitter: 0 });
      glow.add(new THREE.IcosahedronGeometry(0.075, 1), { pos: [x, y - 0.03, z] });
      bulbPos.push([x, y - 0.03, z]);
    }
    // 两端挂在钉子上
    for (const x of [xL, xR]) b.add(new THREE.BoxGeometry(0.06, 0.06, 0.1), { pos: [x, yEnd, BACK_Z + 0.07], color: C.woodDeep, ao: false });
    cylBetween(b, [xL, yEnd, BACK_Z + 0.07], [xL, yEnd, zc], 0.008, 0.008, 3, { color: C.woodDeep, ao: false, jitter: 0 });
    cylBetween(b, [xR, yEnd, BACK_Z + 0.07], [xR, yEnd, zc], 0.008, 0.008, 3, { color: C.woodDeep, ao: false, jitter: 0 });
  }

  // ---------- 挂衣杆（右）：两根立柱 + 横杆 ----------
  const RAIL_Y = 1.72, RAIL_Z = -1.3, RAIL_X0 = 1.4, RAIL_X1 = 3.1;
  {
    for (const x of [RAIL_X0 - 0.12, RAIL_X1 + 0.12]) {
      cylBetween(b, [x, 0, RAIL_Z], [x + (x < 2.3 ? 0.02 : -0.02), RAIL_Y + 0.12, RAIL_Z], 0.045, 0.035, 6, { color: C.woodWarm });
      b.add(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 8), { pos: [x, 0.03, RAIL_Z], color: C.woodGreyDark, ao: false });
    }
    cylBetween(b, [RAIL_X0 - 0.12, RAIL_Y, RAIL_Z], [RAIL_X1 + 0.12, RAIL_Y + 0.01, RAIL_Z], 0.028, 0.028, 6, { color: 0x7a5a3c, ao: false });
    // 横杆头上的小圆球
    for (const x of [RAIL_X0 - 0.12, RAIL_X1 + 0.12]) b.add(new THREE.IcosahedronGeometry(0.06, 1), { pos: [x + (x < 2.3 ? 0.02 : -0.02), RAIL_Y + 0.15, RAIL_Z], color: C.woodDeep, ao: false });
  }

  // ---------- 小物件：矮凳（镜子旁）+ 地上的小箱子（右前） ----------
  {
    const sx = -1.3, sz = -0.9;
    b.add(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 10), { pos: [sx, 0.46, sz], color: C.woodWarm, ao: false });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      cylBetween(b, [sx + Math.cos(a) * 0.17, 0.44, sz + Math.sin(a) * 0.17], [sx + Math.cos(a) * 0.27, 0, sz + Math.sin(a) * 0.27], 0.03, 0.026, 5, { color: C.woodGreyDark, ao: false });
    }
    crate(4.3, 0, 0.7, 0.42, 0.45, -0.18, C.woodGrey, -0.7);
  }

  // ---------- 挂在杆上的空木衣架（三组，各自绕横杆轻轻晃） ----------
  const hangerGroups = [];
  {
    const sets = [[1.7, 2.05], [2.4, 2.75], [3.0]];
    sets.forEach((xs, k) => {
      const hb = new GeoBuilder({ seed: 60 + k, jitter: 0.07, aoK: 0 });
      for (const x of xs) {
        const lx = x - xs[0]; // 相对枢轴（枢轴在横杆上）
        const col = k === 1 ? C.woodGreyLight : C.woodWarm;
        // 挂钩：竖杆 + 弯钩
        hb.add(new THREE.TorusGeometry(0.055, 0.012, 4, 8, Math.PI * 1.5), { pos: [lx, 0.065, 0], rot: [0, 0, Math.PI * 0.2], color: C.woodDeep, ao: false, jitter: 0 });
        hb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 4), { pos: [lx, -0.09, 0], color: C.woodDeep, ao: false, jitter: 0 });
        // 左右两条斜臂 + 底横条
        for (const s of [-1, 1]) cylBetween(hb, [lx, -0.17, 0], [lx + s * 0.22, -0.34, 0], 0.016, 0.016, 5, { color: col, ao: false });
        hb.add(new THREE.BoxGeometry(0.46, 0.028, 0.03), { pos: [lx, -0.34, 0], rot: [0, 0, (rng() - 0.5) * 0.04], color: col, ao: false });
      }
      const grp = new THREE.Group();
      grp.position.set(xs[0], RAIL_Y - 0.0, RAIL_Z);
      const m = new THREE.Mesh(hb.build(), matHang);
      m.castShadow = true; m.receiveShadow = false;
      grp.add(m);
      scene.add(grp);
      hangerGroups.push({ grp, ph: k * 2.1 + 0.7, amp: 0.035 + k * 0.008, fr: 0.9 + k * 0.17, mesh: m });
      // 衣架可以略为朝向不同角度
      grp.rotation.y = (k - 1) * 0.35;
    });
  }

  // ---------- 合并出的网格 ----------
  const mainGeo = b.build();
  const smoothGeo = smooth.build();
  const glowGeo = glow.build();
  const mainMesh = new THREE.Mesh(mainGeo, matWood);
  mainMesh.castShadow = true; mainMesh.receiveShadow = true;
  const smoothMesh = new THREE.Mesh(smoothGeo, matSmooth);
  smoothMesh.castShadow = true; smoothMesh.receiveShadow = true;
  const glowMesh = new THREE.Mesh(glowGeo, matGlow);
  glowMesh.castShadow = false; glowMesh.receiveShadow = false;
  const glassMesh = new THREE.Mesh(glassGeo, matGlass);
  glassMesh.castShadow = false; glassMesh.receiveShadow = false;
  scene.add(mainMesh, smoothMesh, glowMesh, glassMesh);

  // ---------- 小狗站位 ----------
  const dogSpot = new THREE.Object3D();
  dogSpot.name = 'dogSpot';
  scene.add(dogSpot);

  // ---------- 灯光：暖色；主体亮、四周略暗；只有一盏投射阴影 ----------
  const hemi = new THREE.HemisphereLight(0xffe2bc, 0x5a4030, 0.3);
  scene.add(hemi);
  const key = new THREE.SpotLight(0xffe8cc, 9, 0, 0.5, 1.0, 0);
  key.position.set(2.3, 4.4, 5.2);
  key.target.position.set(0, 0.4, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  // 灯泡串的暖光（不投影），会微微闪
  const bulbLight = new THREE.PointLight(0xffa850, 5.0, 9, 1.6);
  bulbLight.position.set(0, 2.2, -1.2);
  scene.add(bulbLight);
  // 小狗正面的主补光。注意：狗毛材质的亮面颜色取自“第一盏平行光”的颜色×强度（rig.js furMat），所以这盏必须够亮，毛色才准
  const fill = new THREE.DirectionalLight(0xffffff, 4.2);
  fill.position.set(-1.0, 5.5, 3.0);
  fill.target.position.set(0, 0.6, 0);
  scene.add(fill, fill.target);

  // ---------- 相机 ----------
  const camera = new THREE.PerspectiveCamera(36, 1.2, 0.1, 40);
  const CAM_Y = 1.68, CAM_Z = 5.0, LOOK_Y = 0.62;
  camera.position.set(0, CAM_Y, CAM_Z);
  camera.lookAt(0, LOOK_Y, 0);
  camera.updateMatrixWorld(true);
  const VFOV_MIN = 36;
  function resize(w, h) {
    const aspect = Math.max(0.2, w) / Math.max(1, h);
    camera.aspect = aspect;
    // 竖直视角固定（小狗占高度的比例稳定）；窄窗口时略拉大竖直视角，保证小狗全身（含两侧）不被裁
    camera.fov = aspect < 0.85 ? VFOV_MIN * Math.min(1.28, 1 + (0.85 - aspect) * 1.1) : VFOV_MIN;
    camera.updateProjectionMatrix();
  }
  resize(1.2, 1);

  // ---------- 动效（不分配对象） ----------
  let t = 0;
  function update(dt) {
    if (!(dt > 0) || !isFinite(dt)) dt = 0;
    t += dt;
    for (let i = 0; i < hangerGroups.length; i++) {
      const h = hangerGroups[i];
      h.grp.rotation.z = Math.sin(t * h.fr + h.ph) * h.amp * (0.7 + 0.3 * Math.sin(t * 0.37 + h.ph));
    }
    const fl = 1 + Math.sin(t * 2.3) * 0.04 + Math.sin(t * 5.7 + 1.3) * 0.035 + Math.sin(t * 13.1) * 0.015;
    bulbLight.intensity = 5.0 * fl;
    matGlow.emissiveIntensity = 1.6 * fl;
  }

  function dispose() {
    mainGeo.dispose(); smoothGeo.dispose(); glowGeo.dispose(); glassGeo.dispose();
    for (const h of hangerGroups) h.mesh.geometry.dispose();
    matWood.dispose(); matSmooth.dispose(); matGlass.dispose(); matGlow.dispose(); matHang.dispose();
    key.shadow.map?.dispose();
  }

  return { scene, camera, dogSpot, resize, update, dispose };
}
