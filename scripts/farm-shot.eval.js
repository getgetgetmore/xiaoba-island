// 农场出图脚本（配合 scripts/shot.cjs）。用 --query 里的 view 选画面：
//   view=panorama（默认）：整张大地图，斜俯视正交相机（1920x1080 内部 960x540，2 倍放大，俯角 50°）
//   view=garden / woods / house / night：游戏视角近景（1440x810，内部 480x270，3 倍放大，俯角 42°）
//        garden = 花园，woods = 树林里的盖房工地和小村，house = 农舍一带，night = 农舍一带的夜晚
//   view=props&part=a|b|c|d：物件特写拼图
//   view=mess&state=before|half|after：一排各类可互动物件“捣乱前 / 一半 / 后”的对比（objects-before / objects-after）
//   view=vegmess：菜地一带，把那里的可互动物件都设成 done 的游戏视角近景（view-mess.png）
//   view=debug：全景上把 mapData 里的碰撞体 / 可互动物 / 躲藏点 / 巡逻路线 / 水域画成彩色线框（不像素化）
//   可选：ph=内部像素高度；cam=目标x,目标z,取景高度,俯角（度）；phase=dawn|day|dusk|night；outline=0 关描边
// 例：node scripts/shot.cjs --out shots/farm/panorama.png --query "hour=11&weather=clear&seed=5&brain=off" --size 1920x1080 --wait 300 --eval-file scripts/farm-shot.eval.js
window.requestAnimationFrame = () => 0; // 冻结页面自己的主循环
const PET = __pet;
const THREE = PET.THREE;
const renderer = PET.ctx.renderer;
const q = new URLSearchParams(location.search);
const view = q.get('view') || 'panorama';
const part = q.get('part') || 'a';

const { createFarmProp, createInteractiveProp } = await import('/src/minigame/farm/props.js');
const { createPixelPass } = await import('/src/minigame/farm/pixel.js');
const { buildFarmMap } = await import('/src/minigame/farm/map.js');
const { createFarmLighting } = await import('/src/minigame/farm/lighting.js');
const { FARM_MAP } = await import('/src/minigame/farm/mapData.js');

// ---- 渲染器（只在这个脚本里改）
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap; // 硬边阴影
renderer.setPixelRatio(1);
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a5a52);
const lighting = createFarmLighting(scene);

const PROP_SHEETS = {
  a: { cols: 4, gx: 6.2, gz: 6.0, hv: 17, items: [['barn'], ['silo'], ['henhouse'], ['cowshed'], ['windmill'], ['cabin', { roof: 'green' }], ['cabin', { roof: 'red', seed: 2 }], ['farmhouse'], ['cabin_frame'], ['scaffold']] },
  b: { cols: 5, gx: 4.4, gz: 3.8, hv: 13, items: [['fence'], ['gate'], ['fence_hole'], ['farm_gate'], ['hedge'], ['hay_square', { count: 3 }], ['hay_round'], ['well'], ['mailbox'], ['firewood'], ['bench'], ['trellis'], ['fountain'], ['bridge'], ['signpost']] },
  c: { cols: 5, gx: 4.0, gz: 4.2, hv: 14, items: [['crop_radish'], ['crop_cabbage'], ['crop_pumpkin'], ['radish_big'], ['clothesline'], ['apple_tree'], ['tree'], ['pink_tree'], ['pine'], ['pine', { tall: true, seed: 3 }], ['bush', { berries: true }], ['flower_bed'], ['beehive'], ['sawhorse'], ['lumber_pile']] },
  d: { cols: 5, gx: 3.3, gz: 3.2, hv: 10.5, items: [['stump'], ['rock'], ['mushroom'], ['barrel'], ['crate'], ['reeds'], ['lily'], ['mud_pit', { w: 40, d: 28 }], ['water_pond', { w: 40, d: 28 }], ['milk_can'], ['wheelbarrow', { load: 'hay' }], ['scarecrow'], ['trough', { fill: 'feed' }], ['flowers'], ['lamp']] },
};

// ---- 场景内容
let viewTarget, frustumH, pitchDeg, mapInfo = null, messLive = [];
const MESS_ITEMS = [
  ['radish_bed', 'crop_bed', { crop: 'radish' }], ['cabbage_bed', 'crop_bed', { crop: 'cabbage' }], ['pumpkin_bed', 'crop_bed', { crop: 'pumpkin' }], ['flower_bed', 'flower_bed', { seed: 1 }], ['clothesline', 'clothesline', {}],
  ['milk_can', 'milk_can', {}], ['barrel', 'barrel', {}], ['crate', 'crate', {}], ['feed_trough', 'trough', { fill: 'feed' }], ['mailbox', 'mailbox', {}],
  ['hay_bale', 'hay_square', { count: 3 }], ['hay_bale', 'hay_round', {}], ['lumber_pile', 'lumber_pile', {}], ['pen_gate', 'gate', { length: 32 }], ['henhouse', 'henhouse', {}],
];
let phase = q.get('phase') || 'day';
if (view === 'mess') {
  const st = q.get('state') || 'before';
  const cols = 5, gx = 4.3, gz = 3.7, rows = 3;
  const g = createFarmProp('ground_grass', { w: Math.round((cols * gx + 4) * 16), d: Math.round((rows * gz + 3) * 16), seed: 5 });
  scene.add(g);
  MESS_ITEMS.forEach(([ik, pk, o], i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const api = createInteractiveProp({ id: 'm' + i, kind: ik, crop: o.crop }, { kind: pk, opts: o, x: (c - (cols - 1) / 2) * gx, z: (r - (rows - 1) / 2) * gz, rot: 0, s: pk === 'henhouse' ? 1 : 1 });
    api.object.position.y = 0.2;
    scene.add(api.object);
    if (st === 'after') api.setState({ progress: 1, done: true, muddy: true });
    else if (st === 'half') api.setState({ progress: 0.5, done: false });
    messLive.push(api);
  });
  for (let i = 0; i < 90; i++) for (const a of messLive) a.tick(1 / 30);
  scene.background = new THREE.Color(0x8fd3f4);
  viewTarget = [0, 0, 0.1]; frustumH = 13.5; pitchDeg = 42;
} else if (view === 'props') {
  const sh = PROP_SHEETS[part];
  const rows = Math.ceil(sh.items.length / sh.cols);
  const g = createFarmProp('ground_grass', { w: Math.round((sh.cols * sh.gx + 4) * 16), d: Math.round((rows * sh.gz + 3) * 16), seed: 5 });
  scene.add(g);
  sh.items.forEach(([k, o], i) => {
    const c = i % sh.cols, r = Math.floor(i / sh.cols);
    const m = createFarmProp(k, o || {});
    m.position.set((c - (sh.cols - 1) / 2) * sh.gx, 0.2, (r - (rows - 1) / 2) * sh.gz);
    m.scale.setScalar({ windmill: 0.8, barn: 0.85, cowshed: 0.8, silo: 0.8, farmhouse: 0.8, cabin: 0.9, cabin_frame: 0.9 }[k] || 1);
    scene.add(m);
  });
  scene.background = new THREE.Color(0x8fd3f4);
  viewTarget = [0, 0, 0.2]; frustumH = sh.hv; pitchDeg = 42;
} else {
  mapInfo = buildFarmMap();
  scene.add(mapInfo.group);
  if (view === 'vegmess') {
    viewTarget = [-9.2, 0, 13.2]; frustumH = 11.5; pitchDeg = 42;
    for (const it of FARM_MAP.interactables) {
      if (Math.hypot(it.x + 9.2, it.z - 13.2) > 9.5) continue;
      const o = mapInfo.objects.get(it.id);
      if (o) o.setState({ progress: 1, done: true, muddy: true });
    }
    for (let i = 0; i < 90; i++) mapInfo.update(1 / 30);
  } else if (view === 'garden') { viewTarget = [-17.5, 0, 1.5]; frustumH = 11; pitchDeg = 42; }
  else if (view === 'woods') { viewTarget = [-12.5, 0, -14.5]; frustumH = 12.5; pitchDeg = 42; }
  else if (view === 'house') { viewTarget = [-8, 0, 2.2]; frustumH = 11; pitchDeg = 42; }
  else if (view === 'night') { viewTarget = [-8, 0, 2.2]; frustumH = 11; pitchDeg = 42; phase = q.get('phase') || 'night'; }
  else { viewTarget = [0, 0, 0.5]; frustumH = 44; pitchDeg = 50; }
}
const camOpt = (q.get('cam') || '').split(',').map(Number);
if (camOpt.length >= 4 && camOpt.every(Number.isFinite)) { viewTarget = [camOpt[0], 0, camOpt[1]]; frustumH = camOpt[2]; pitchDeg = camOpt[3]; }

// ---- 灯光（lighting.js）
lighting.setPhase(phase, 1);
lighting.follow(viewTarget[0], viewTarget[2], view === 'panorama' || view === 'debug' ? 52 : Math.max(16, frustumH * 1.3));

// ---- 正交相机（从南面向下看）
const W = renderer.domElement.width, H = renderer.domElement.height;
const aspect = W / H;
const camera = new THREE.OrthographicCamera(-frustumH * aspect / 2, frustumH * aspect / 2, frustumH / 2, -frustumH / 2, 1, 400);
const pr = (pitchDeg * Math.PI) / 180;
camera.position.set(viewTarget[0], viewTarget[1] + Math.sin(pr) * 150, viewTarget[2] + Math.cos(pr) * 150);
camera.lookAt(viewTarget[0], viewTarget[1], viewTarget[2]);
camera.updateMatrixWorld(true);
camera.updateProjectionMatrix();

// ---- 调试图：把数据画成线框
if (view === 'debug') {
  const mk = (color) => new THREE.LineBasicMaterial({ color, depthTest: false });
  const lines = (pts, color, closed = false) => { const g = new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 1.2, z))); const l = closed ? new THREE.LineLoop(g, mk(color)) : new THREE.Line(g, mk(color)); l.renderOrder = 10; scene.add(l); };
  const circle = (x, z, r, color) => { const p = []; for (let i = 0; i < 24; i++) p.push([x + Math.cos((i / 24) * 6.2832) * r, z + Math.sin((i / 24) * 6.2832) * r]); lines(p, color, true); };
  const dot = (x, z, color, s = 0.18) => { const m = new THREE.Mesh(new THREE.CircleGeometry(s, 10), new THREE.MeshBasicMaterial({ color, depthTest: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 1.3, z); m.renderOrder = 11; scene.add(m); };
  for (const c of FARM_MAP.colliders) {
    const col = c.gap ? 0xff40ff : c.kind === 'gate' ? 0xff9a20 : 0xff3030;
    if (c.shape === 'circle') circle(c.x, c.z, c.r, col);
    else { const cs = Math.cos(c.rot || 0), sn = Math.sin(c.rot || 0); const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const lx = a * c.w / 2, lz = b * c.d / 2; return [c.x + lx * cs + lz * sn, c.z - lx * sn + lz * cs]; }); lines(pts, col, true); }
  }
  for (const i of FARM_MAP.interactables) { circle(i.x, i.z, i.r, 0x30ff60); dot(i.x, i.z, 0x30ff60); }
  for (const h of FARM_MAP.hides) { circle(h.x, h.z, h.r, 0x40a0ff); dot(h.x, h.z, 0x40a0ff, 0.12); }
  for (const w of FARM_MAP.water) lines(w.shape === 'poly' ? w.points : [], 0x20e0ff, w.kind === 'pond');
  for (const b of FARM_MAP.bridges) { const p = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => [b.x + a * b.w / 2, b.z + c * b.d / 2]); lines(p, 0xffffff, true); }
  const pat = FARM_MAP.spawns.keeper.patrol; lines(pat, 0xffe030); pat.forEach(([x, z]) => dot(x, z, 0xffe030, 0.22));
  const sp = FARM_MAP.spawns;
  dot(sp.gate.x, sp.gate.z, 0xffffff, 0.35); dot(sp.exit.x, sp.exit.z, 0xffffff, 0.35); circle(sp.exit.x, sp.exit.z, sp.exit.r, 0xffffff);
  dot(sp.keeper.home.x, sp.keeper.home.z, 0xff8030, 0.35); dot(sp.goose.x, sp.goose.z, 0xffffff, 0.3);
  for (const a of sp.animals) { circle(a.x, a.z, a.roam, 0xc0a0ff); dot(a.x, a.z, 0xc0a0ff, 0.22); }
  for (const z of FARM_MAP.zones) circle(z.x, z.z, z.r, 0x808080);
}

const ph = Number(q.get('ph')) || (view === 'panorama' || view === 'props' || view === 'debug' || view === 'mess' ? 540 : 270);
const px = createPixelPass(renderer, { height: ph, outline: q.get('outline') === '0' ? false : true });
const draw = () => {
  if (view === 'debug') { renderer.setRenderTarget(null); renderer.clear(); renderer.render(scene, camera); } else px.render(scene, camera);
};
PET.step = draw; // shot.cjs 保存前会调用它
window.__farm = { scene, camera, px, THREE, renderer, mapInfo, lighting };

// 渲染一次并统计
renderer.info.reset();
draw();
const info = renderer.info.render;
let viewTris = 0, totalTris = 0, meshesInView = 0;
const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
scene.traverse((o) => {
  if (!o.isMesh || !o.geometry.attributes.position) return;
  const t = o.geometry.attributes.position.count / 3;
  totalTris += t;
  if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
  const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld);
  if (fr.intersectsSphere(s)) { viewTris += t; meshesInView++; }
});
return {
  view, phase, part: view === 'props' ? part : undefined, canvas: [W, H], internal: [px.width, px.height],
  sceneTriangles: totalTris, trianglesInView: viewTris, meshesInView, drawCalls: info.calls, renderedTriangles: info.triangles,
  mapStats: mapInfo ? { objects: mapInfo.stats.objects, ground: mapInfo.stats.groundTris, decor: mapInfo.stats.decorTris, objs: mapInfo.stats.objTris, byKind: mapInfo.stats.kindTris } : null,
  errors: PET.info().errors.length,
};
