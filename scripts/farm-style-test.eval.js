// 画风对比样张：圆润的 3D 造型（不是方块）+ 卡通分档明暗 + 深色描边 + 低分辨率像素化。
// 用来验证“去积木感”的方向：岛上的小柴直接放进农场，另外用圆球 / 椭球 / 圆柱拼几只小鸡、母鸡、猪、绵羊，和几棵圆团树、灌木、草垛。
// 用法：node scripts/shot.cjs --out shots/farm/style-round.png --query "hour=11&weather=clear&seed=5&brain=off&fh=7" --size 1440x810 --wait 300 --eval-file scripts/farm-style-test.eval.js
//   fh = 画面高度对应的世界单位（越小越近）；pitch = 俯角（度）；at = 目标 x,z
window.requestAnimationFrame = () => 0;
const PET = __pet, THREE = PET.THREE, renderer = PET.ctx.renderer;
const q = new URLSearchParams(location.search);
const { createPixelPass } = await import('/src/minigame/farm/pixel.js');
const { buildFarmMap } = await import('/src/minigame/farm/map.js');

renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.setPixelRatio(1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f4a4e);
const map = buildFarmMap();
scene.add(map.group);
const groundY = (x, z) => (map.heightAt ? map.heightAt(x, z) : 0);

// ---------------------------------------------------------------- 卡通材质：明暗分 3 档
const grad = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 190, 190, 190, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
const toon = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad });

// ---------------------------------------------------------------- 圆润造型的小工具：一堆上了色的基本体合并成一个网格
const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _n = new THREE.Matrix3();
function builder() {
  const pos = [], nor = [], col = [];
  const add = (geo, color, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0]) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    _m.compose(new THREE.Vector3(...p), _q.setFromEuler(_e.set(...r)), new THREE.Vector3(...(typeof s === 'number' ? [s, s, s] : s)));
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
  const SPH = new THREE.SphereGeometry(1, 14, 10), CYL = new THREE.CylinderGeometry(1, 1, 1, 10), CONE = new THREE.ConeGeometry(1, 1, 8), TOR = new THREE.TorusGeometry(1, 0.35, 6, 12);
  const api = {
    ball: (color, p, s, r) => add(SPH, color, p, s, r),
    cyl: (color, p, s, r) => add(CYL, color, p, s, r),
    cone: (color, p, s, r) => add(CONE, color, p, s, r),
    ring: (color, p, s, r) => add(TOR, color, p, s, r),
    mesh() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const m = new THREE.Mesh(g, toon); m.castShadow = true; m.receiveShadow = true;
      return m;
    },
  };
  return api;
}
const place = (obj, x, z, yaw = 0, s = 1) => { obj.position.set(x, groundY(x, z), z); obj.rotation.y = yaw; obj.scale.setScalar(s); scene.add(obj); return obj; };

// ---------------------------------------------------------------- 角色（头朝 +Z，原点在脚下）
function chick() {
  const b = builder(), Y = 0xffd84a, YD = 0xf2b632, O = 0xf28a1c;
  b.ball(Y, [0, 0.15, -0.01], [0.13, 0.12, 0.14]);                       // 圆身子
  b.ball(Y, [0, 0.29, 0.07], [0.105, 0.1, 0.1]);                          // 大脑袋
  b.ball(YD, [0.12, 0.16, -0.02], [0.035, 0.07, 0.09], [0, 0, 0.35]);     // 小翅膀
  b.ball(YD, [-0.12, 0.16, -0.02], [0.035, 0.07, 0.09], [0, 0, -0.35]);
  b.ball(YD, [0, 0.2, -0.15], [0.05, 0.05, 0.05]);                        // 尾巴尖
  b.cone(O, [0, 0.275, 0.185], [0.04, 0.07, 0.04], [Math.PI / 2, 0, 0]);  // 喙
  for (const s of [1, -1]) {
    b.ball(0x2a1c14, [0.06 * s, 0.315, 0.145], 0.02);                     // 眼睛
    b.ball(0xff9f8a, [0.085 * s, 0.265, 0.11], [0.02, 0.018, 0.02]);      // 腮红
    b.cyl(O, [0.045 * s, 0.035, 0], [0.014, 0.07, 0.014]);                // 腿
    b.ball(O, [0.045 * s, 0.012, 0.03], [0.035, 0.012, 0.05]);            // 脚
  }
  return b.mesh();
}
function hen() {
  const b = builder(), W = 0xfdf8ee, WS = 0xe6dccb, R = 0xe0362c, O = 0xf5a623;
  b.ball(W, [0, 0.27, -0.03], [0.19, 0.18, 0.24]);                        // 身子
  b.ball(W, [0, 0.36, 0.14], [0.13, 0.15, 0.13]);                         // 胸脯到脖子
  b.ball(W, [0, 0.51, 0.19], [0.1, 0.1, 0.1]);                            // 头
  b.ball(WS, [0.17, 0.27, -0.04], [0.05, 0.11, 0.16], [0, 0, 0.3]);       // 翅膀
  b.ball(WS, [-0.17, 0.27, -0.04], [0.05, 0.11, 0.16], [0, 0, -0.3]);
  for (const [dx, a] of [[0, 0], [0.07, 0.35], [-0.07, -0.35]]) b.ball(W, [dx, 0.42, -0.24], [0.04, 0.15, 0.07], [-0.6, 0, a]); // 翘起的尾羽
  for (const [dz, r] of [[0.24, 0.035], [0.19, 0.045], [0.14, 0.035]]) b.ball(R, [0, 0.615 - Math.abs(dz - 0.19) * 0.4, dz], [0.025, r, r]); // 鸡冠
  b.ball(R, [0, 0.43, 0.275], [0.025, 0.045, 0.03]);                      // 肉垂
  b.cone(O, [0, 0.5, 0.3], [0.035, 0.07, 0.035], [Math.PI / 2, 0, 0]);
  for (const s of [1, -1]) {
    b.ball(0x2a1c14, [0.07 * s, 0.535, 0.24], 0.02);
    b.cyl(O, [0.07 * s, 0.06, 0], [0.018, 0.12, 0.018]);
    b.ball(O, [0.07 * s, 0.014, 0.04], [0.05, 0.014, 0.07]);
  }
  return b.mesh();
}
function pig() {
  const b = builder(), P = 0xf7a8b8, PD = 0xe57f96, PL = 0xfcc6d0;
  b.ball(P, [0, 0.36, -0.05], [0.3, 0.27, 0.4]);                          // 圆滚滚的身子
  b.ball(P, [0, 0.4, 0.36], [0.24, 0.23, 0.22]);                          // 头
  b.cyl(PD, [0, 0.36, 0.58], [0.11, 0.08, 0.09], [Math.PI / 2, 0, 0]);    // 鼻子
  for (const s of [1, -1]) {
    b.ball(0x7a3346, [0.04 * s, 0.37, 0.625], [0.02, 0.03, 0.01]);        // 鼻孔
    b.ball(0x2a1c14, [0.13 * s, 0.47, 0.52], 0.025);
    b.cone(PD, [0.17 * s, 0.62, 0.36], [0.07, 0.13, 0.04], [0.5, 0, -0.5 * s]); // 耳朵
    b.ball(PL, [0.2 * s, 0.38, 0.48], [0.04, 0.035, 0.04]);               // 腮红
    for (const z of [0.2, -0.26]) { b.cyl(P, [0.16 * s, 0.09, z], [0.065, 0.18, 0.065]); b.cyl(0x8d5360, [0.16 * s, 0.02, z], [0.068, 0.04, 0.068]); }
  }
  b.ring(PD, [0, 0.46, -0.46], 0.045, [0, Math.PI / 2, 0]);               // 卷尾巴
  return b.mesh();
}
function sheep() {
  const b = builder(), W = 0xfbf7ee, WS = 0xe9e1d2, F = 0xe2c6a0, K = 0x3a2d28;
  const puffs = [[0, 0.42, 0, 0.3], [0.17, 0.46, 0.14, 0.2], [-0.17, 0.46, 0.14, 0.2], [0.18, 0.44, -0.16, 0.21], [-0.18, 0.44, -0.16, 0.21], [0, 0.58, 0.05, 0.2], [0, 0.56, -0.18, 0.19], [0, 0.42, -0.3, 0.19], [0.1, 0.3, 0.05, 0.2], [-0.1, 0.3, 0.05, 0.2]];
  puffs.forEach(([x, y, z, r], i) => b.ball(i % 3 === 2 ? WS : W, [x, y, z], r));   // 一团团的羊毛
  b.ball(F, [0, 0.47, 0.36], [0.14, 0.15, 0.15]);                         // 脸
  b.ball(W, [0, 0.61, 0.3], [0.13, 0.08, 0.1]);                           // 头顶的毛
  for (const s of [1, -1]) {
    b.ball(F, [0.16 * s, 0.5, 0.31], [0.07, 0.035, 0.04], [0, 0, -0.3 * s]); // 耳朵
    b.ball(K, [0.07 * s, 0.5, 0.49], 0.022);
    for (const z of [0.16, -0.18]) b.cyl(K, [0.13 * s, 0.08, z], [0.04, 0.18, 0.04]);
  }
  b.ball(0xd08a7a, [0, 0.42, 0.5], [0.03, 0.02, 0.02]);                   // 鼻子
  return b.mesh();
}
// ---------------------------------------------------------------- 圆团树、灌木、草垛
function tree(kind = 'oak', seed = 1) {
  const b = builder();
  const C = kind === 'pink' ? [0xf7b6d2, 0xf093bd, 0xfbd3e4, 0xd96fa6] : kind === 'apple' ? [0x4fae3c, 0x3a9433, 0x73c94a, 0x2c7a2e] : [0x3f9d3a, 0x2f8431, 0x63bd45, 0x236b2c];
  let s = seed * 9301 + 49297; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  b.cyl(0x7a4e2c, [0, 0.55, 0], [0.16, 1.1, 0.16]);                       // 树干
  b.cone(0x6a4226, [0, 0.12, 0], [0.26, 0.26, 0.26]);                     // 树根
  b.ball(C[1], [0, 1.75, 0], [0.95, 0.8, 0.95]);                          // 树冠的大团
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd(), r = 0.55 + rnd() * 0.25, y = 1.45 + rnd() * 0.75;
    b.ball(C[i % 3 === 0 ? 2 : i % 3 === 1 ? 0 : 3], [Math.cos(a) * r, y, Math.sin(a) * r], 0.38 + rnd() * 0.16); // 一团团的叶丛
  }
  b.ball(C[2], [-0.2, 2.35, 0.15], 0.42);                                 // 顶上的亮团
  if (kind === 'apple') for (let i = 0; i < 7; i++) { const a = rnd() * 6.28, y = 1.3 + rnd() * 0.9; b.ball(0xe23b2e, [Math.cos(a) * 0.98, y, Math.sin(a) * 0.98], 0.08); }
  return b.mesh();
}
function bush(seed = 1) {
  const b = builder(); let s = seed * 733 + 11; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28, r = i ? 0.28 : 0; b.ball([0x3f9d3a, 0x63bd45, 0x2f8431][i % 3], [Math.cos(a) * r, 0.26 + rnd() * 0.12, Math.sin(a) * r], 0.26 + rnd() * 0.08); }
  for (let i = 0; i < 5; i++) { const a = rnd() * 6.28; b.ball(0xf06aa0, [Math.cos(a) * 0.38, 0.38 + rnd() * 0.15, Math.sin(a) * 0.38], 0.05); }
  return b.mesh();
}
function hay() {
  const b = builder();
  b.cyl(0xe8c25a, [0, 0.42, 0], [0.42, 0.7, 0.42], [0, 0, Math.PI / 2]);
  b.cyl(0xf5d97a, [0.355, 0.42, 0], [0.3, 0.02, 0.3], [0, 0, Math.PI / 2]);
  b.cyl(0xf5d97a, [-0.355, 0.42, 0], [0.3, 0.02, 0.3], [0, 0, Math.PI / 2]);
  b.cyl(0xc99a3a, [0, 0.42, 0], [0.43, 0.06, 0.43], [0, 0, Math.PI / 2]);
  return b.mesh();
}

// ---------------------------------------------------------------- 摆场景：一片草地上，小柴追着一群小鸡，母鸡在旁边，猪和羊在后面
const at = (q.get('at') || '-1,7.5').split(',').map(Number);
const [cx, cz] = at;
// 岛上的小柴（圆润的原模型）直接搬过来
const dog = PET.dog;
dog.group.removeFromParent();
dog.setAction('run'); dog.speed = 3.4;
for (let i = 0; i < 23; i++) dog.update(1 / 30, PET.env);
dog.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
dog.group.rotation.set(0, 1.25, 0);
place(dog.group, cx - 1.6, cz + 0.6, 1.25, 1.0);
[[0.3, 0.5, 1.9], [0.95, 1.05, 1.1], [1.3, 0.15, 2.4], [0.7, -0.35, 0.4], [1.9, 0.7, 1.7]].forEach(([dx, dz, yaw]) => place(chick(), cx + dx, cz + dz, yaw, 1.15));
place(hen(), cx + 2.6, cz - 0.2, -2.2, 1.15);
place(hen(), cx - 0.4, cz - 1.3, 0.7, 1.15);
place(pig(), cx + 3.6, cz - 1.9, -0.9, 1.0);
place(sheep(), cx - 3.3, cz - 1.6, 0.9, 1.1);
place(tree('oak', 3), cx - 4.6, cz - 2.6, 0, 1.15);
place(tree('pink', 5), cx + 4.9, cz - 3.0, 0, 1.05);
place(tree('apple', 7), cx + 1.2, cz - 3.4, 0, 1.0);
place(bush(2), cx - 2.3, cz - 3.0); place(bush(4), cx + 3.2, cz + 1.8); place(bush(6), cx - 4.4, cz + 1.6);
place(hay(), cx - 3.4, cz + 2.0, 0.5);

// ---------------------------------------------------------------- 灯光、相机、像素化
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0xb8a888, 1.7));
const sun = new THREE.DirectionalLight(0xfff0cc, 2.6);
sun.position.set(cx - 22, 36, cz + 18); sun.target.position.set(cx, 0, cz);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera; sc.left = sc.bottom = -16; sc.right = sc.top = 16; sc.near = 1; sc.far = 140;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const W = renderer.domElement.width, H = renderer.domElement.height, aspect = W / H;
const fh = Number(q.get('fh')) || 7, pitch = ((Number(q.get('pitch')) || 42) * Math.PI) / 180;
const camera = new THREE.OrthographicCamera((-fh * aspect) / 2, (fh * aspect) / 2, fh / 2, -fh / 2, 1, 400);
camera.position.set(cx, Math.sin(pitch) * 150, cz + Math.cos(pitch) * 150);
camera.lookAt(cx, 0.4, cz);
camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
const px = createPixelPass(renderer, { height: Number(q.get('ph')) || 270, outline: { depth: 0.03, dark: 0.1, tint: 0.75, crease: 0 } });
PET.step = () => px.render(scene, camera);
px.render(scene, camera);
return { internal: [px.width, px.height], errors: PET.info().errors.length };
