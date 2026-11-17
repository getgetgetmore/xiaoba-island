// 农场角色出图脚本（配合 scripts/shot.cjs）：圆润 3D 造型 + 3 档卡通明暗 + 深色描边 + 像素化。用 --query 里的参数选画面：
//   view=lineup（默认）：全部角色站两排，斜俯视正交镜头（俯角约 42°），角色略转一点，1600x900
//        （为了小动物看得清，阵容里小鸡 / 母鸡 / 鸭会放大，大小不是真实比例；真实尺寸见 size）
//   view=side：同样的阵容，纯侧面（角色都朝右，俯角放低）
//   view=actions&kind=hen：这个角色的每个动作各一帧拼成一张（run 取两帧，腿一前一后）
//   view=test：不出图，跑 600 帧 × 全部动作检查 NaN，并返回每个角色的三角形数 / 尺寸
//   可选：ph=内部像素高度（默认 300，1600x900 下正好 3 倍放大）；yaw=角色朝向（弧度）；pitch=俯角（度）；
//         zoom=镜头缩放倍数；ppu=每世界单位多少内部像素；cx / cz=镜头平移；t=统一的动作时间；label=0 不画名字；
//         angry=1（actions 里管理员用生气脸）
// 例：
//   node scripts/shot.cjs --out shots/farm/lineup.png --query "hour=11&weather=clear&seed=5&brain=off&view=lineup" --size 1600x900 --wait 300 --eval-file scripts/farm-chars-shot.eval.js
//   node scripts/shot.cjs --out shots/farm/lineup-side.png --query "...&view=side" ...
//   node scripts/shot.cjs --out shots/farm/actions-hen.png --query "...&view=actions&kind=hen" ...
window.requestAnimationFrame = () => 0; // 冻结页面自己的主循环
const PET = __pet;
const THREE = PET.THREE;
const renderer = PET.ctx.renderer;
const q = new URLSearchParams(location.search);
const view = q.get('view') || 'lineup';

const { createPixelPass } = await import('/src/minigame/farm/pixel.js');
const { createFarmModel, FARM_MODELS, farmToonMaterial } = await import('/src/minigame/farm/models.js');

renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.setPixelRatio(1);
renderer.info.autoReset = false;

// ---- 测试：全部角色 × 全部动作各跑 600 帧（含不同的 speed）
if (view === 'test') {
  const rows = [];
  let bad = 0;
  const cases = [['keeper', {}], ['keeper', { angry: true }]].concat(Object.keys(FARM_MODELS).filter((k) => k !== 'keeper').map((k) => [k, {}]));
  for (const [kind, opts] of cases) {
    const m = createFarmModel(kind, opts);
    let nan = 0;
    for (const act of FARM_MODELS[kind].actions) {
      m.setAction(act);
      for (let i = 0; i < 600; i++) {
        m.speed = 0.5 + (i % 200) / 40; // 速度在 0.5–5.5 之间变化
        m.update(1 / 60);
        for (const k in m.parts) {
          const o = m.parts[k];
          const v = [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, o.scale.x, o.scale.y, o.scale.z];
          for (const n of v) if (!Number.isFinite(n)) nan++;
        }
      }
    }
    bad += nan;
    rows.push({ kind, opts, parts: m.partCount, tris: m.tris, size: [m.size.w, m.size.h, m.size.l].map((v) => +v.toFixed(2)), nan });
  }
  return { rows, nanTotal: bad, errors: PET.info().errors.length };
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f4a4e);

// ---- 站的草地：一块块深浅不一的草色（顶点色 + 同一个卡通材质）
function makeGround(x0, z0, x1, z1) {
  const cell = 0.22;
  const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);
  const pos = [], nor = [], col = [];
  const hs = (x, z, s) => { let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const C = new THREE.Color();
  const greens = [0x5fb24a, 0x4fa23f, 0x72c455, 0x449836];
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    // 2x2 的小块一起变色，边缘不规则
    const n = hs(i >> 1, k >> 1, 3), m = hs(i, k, 7);
    let c = greens[n < 0.25 ? 3 : n < 0.55 ? 1 : n < 0.85 ? 0 : 2];
    if (m > 0.992) c = 0xfff0a0; else if (m < 0.01) c = 0xf5a0c0;
    C.set(c);
    const xa = x0 + i * cell, za = z0 + k * cell, xb = xa + cell, zb = za + cell;
    for (const [px, pz] of [[xa, za], [xa, zb], [xb, zb], [xa, za], [xb, zb], [xb, za]]) { pos.push(px, 0, pz); nor.push(0, 1, 0); col.push(C.r, C.g, C.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(g, farmToonMaterial);
  mesh.receiveShadow = true;
  return mesh;
}

// ---- 灯光（和 farm-style-test 同一套）
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0xb8a888, 1.7));
const sun = new THREE.DirectionalLight(0xfff0cc, 2.6);
sun.position.set(-14, 22, 12);
sun.target.position.set(0, 0, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -15; sc.right = 15; sc.top = 15; sc.bottom = -15; sc.near = 1; sc.far = 80;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const W = renderer.domElement.width, H = renderer.domElement.height, aspect = W / H;
const ph = Number(q.get('ph')) || 300;
const zoom = Number(q.get('zoom')) || 1;
const models = [];
const labels = []; // { text, world: Vector3, lift }

// 各动作拍照用的时间点（秒）：挑最能看出动作特征的瞬间
const SNAP_T = {
  keeper: { idle: 0.4, carry: 0.3, grab: 0.6, stumble: 0.6 },
  hen: { idle: 0.4, peck: 0.1, scared: 0.12, sleep: 0.5 },
  chick: { idle: 0.4, flap: 0.31, scared: 0.12, sleep: 0.5 },
  duck: { idle: 0.4, quack: 0.14, scared: 0.12, sleep: 0.5 },
  goose: { idle: 0.4, honk: 0.21, scared: 0.12, sleep: 0.5 },
  sheep: { idle: 0.4, jump: 0.36, scared: 0.12, sleep: 0.5 },
};
const forceT = q.get('t') !== null ? Number(q.get('t')) : null;

function place(kind, opts, x, z, yaw, label, action, t, scale = 1, phase = 0) {
  const m = createFarmModel(kind, opts);
  m.group.position.set(x, 0, z);
  m.group.rotation.y = yaw;
  m.group.scale.setScalar(scale);
  m.phase = phase;
  m.evaluate(forceT !== null ? forceT : (t !== undefined ? t : 0.4), action || 'idle');
  scene.add(m.group);
  models.push(m);
  if (label) labels.push({ text: label, world: new THREE.Vector3(x, 0, z) });
  return m;
}

let camera, groundSize;
const pitchDeg = Number(q.get('pitch')) || (view === 'side' ? 24 : view === 'actions' ? 36 : 42);
const pitch = pitchDeg * Math.PI / 180;
const ortho = (gw, gh) => new THREE.OrthographicCamera(-gw / 2, gw / 2, gh / 2, -gh / 2, 1, 400);
const aim = (cam, cx, ty, cz) => {
  cam.position.set(cx, ty + Math.sin(pitch) * 150, cz + Math.cos(pitch) * 150);
  cam.lookAt(cx, ty, cz);
};

if (view === 'lineup' || view === 'side') {
  const side = view === 'side';
  const yaw = q.get('yaw') !== null ? Number(q.get('yaw')) : (side ? Math.PI / 2 : 0.6);
  // 阵容里小动物放大一些，免得看不清（大小不是真实比例）
  const SHOW = { chick: 2.3, hen: 1.7, duck: 1.8, goose: 1.25, pig: 1.2, sheep: 1.2, cow: 1.0, bull: 1.0, alpaca: 1.0, keeper: 1.0 };
  const back = [['alpaca', {}, '羊驼'], ['cow', {}, '奶牛'], ['bull', {}, '公牛'], ['keeper', {}, '管理员'], ['keeper', { angry: true }, '管理员（生气）']];
  const front = [['chick', {}, '小鸡'], ['hen', {}, '母鸡'], ['duck', {}, '绿头鸭'], ['goose', {}, '大鹅'], ['pig', {}, '猪'], ['sheep', {}, '绵羊']];
  const rows = side ? [back.concat(front.slice(0, 2)), front.slice(2)] : [back, front];
  const adv = side ? 2.0 : [2.35, 1.95];
  const zs = side ? [-2.6, 2.4] : [-2.0, 1.55];
  const YAWJ = { goose: 0.5, alpaca: 0.2, duck: 0.2 };
  rows.forEach((row, ri) => {
    const a = Array.isArray(adv) ? adv[ri] : adv;
    row.forEach(([k, o, l], i) => {
      const x = (i - (row.length - 1) / 2) * a;
      const jit = side ? 0 : ((i + ri) % 2 ? -0.12 : 0.12) + (YAWJ[k] || 0);
      place(k, o, x, zs[ri], yaw + jit, l, FARM_MODELS[k].actions[0], 0.4 + i * 0.37, SHOW[k] || 1);
    });
  });
  groundSize = [-13, -13, 13, 11];
  const ppu = Number(q.get('ppu')) || (side ? 36 : 44);
  const gh = (ph / ppu) / zoom, gw = gh * aspect;
  camera = ortho(gw, gh);
  const cx = Number(q.get('cx')) || 0, cz = Number(q.get('cz')) || 0;
  aim(camera, cx, side ? 0.7 : 0.45, (side ? 0.0 : -0.25) + cz);
} else if (view === 'actions') {
  const kind = q.get('kind') || 'hen';
  const opts = q.get('angry') ? { angry: true } : {};
  const run0 = createFarmModel(kind, opts);
  const frames = [];
  for (const act of FARM_MODELS[kind].actions) {
    if (act === 'run') {
      frames.push([act, 0.3, 'run 1', Math.PI / 2]);
      frames.push([act, 0.3, 'run 2', 3 * Math.PI / 2]);
    } else if (act === 'carry') {
      frames.push([act, 0.3, 'carry 1', Math.PI / 2]);
      frames.push([act, 0.3, 'carry 2', 3 * Math.PI / 2]);
    } else frames.push([act, (SNAP_T[kind] && SNAP_T[kind][act]) !== undefined ? SNAP_T[kind][act] : (act === 'scared' ? 0.12 : act === 'sleep' ? 0.5 : 0.4), act, 0]);
  }
  const n = frames.length;
  const sz = run0.size;
  const R = n > 5 ? 2 : 1, cols = Math.ceil(n / R);
  const unitW = Math.max(sz.l, sz.w) * 1.3 + 0.1;
  const rowH = sz.h * Math.cos(pitch) + sz.l * Math.sin(pitch) * 0.8 + 0.5;
  let ppu = Math.min((ph * aspect) / (cols * unitW), ph / (R * rowH * 1.15), 150);
  ppu = Number(q.get('ppu')) || Math.max(24, Math.floor(ppu / 4) * 4);
  const yaw = q.get('yaw') !== null ? Number(q.get('yaw')) : (kind === 'keeper' ? 0.8 : 1.15);
  const gh = (ph / ppu) / zoom, gw = gh * aspect;
  const adv = gw / cols, dz = rowH / Math.sin(pitch);
  frames.forEach(([act, t, label, phase], i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const inRow = Math.min(cols, n - r * cols);
    place(kind, opts, (c - (inRow - 1) / 2) * adv, (r - (R - 1) / 2) * dz, yaw, label, act, t, 1, phase);
  });
  groundSize = [-gw / 2 - 4, -(R * dz) / 2 - 10, gw / 2 + 4, (R * dz) / 2 + 10];
  camera = ortho(gw, gh);
  aim(camera, 0, sz.h * 0.4, 0);
}
scene.add(makeGround(...groundSize));
camera.updateMatrixWorld(true);
camera.updateProjectionMatrix();

// ---- 名字标签：像素渲染之后再叠一层清晰的文字（屏幕空间）
const labelScene = new THREE.Scene();
const labelCam = new THREE.OrthographicCamera(0, W, H, 0, -1, 1);
if (q.get('label') !== '0') {
  const v = new THREE.Vector3();
  for (const l of labels) {
    const cv = document.createElement('canvas');
    const fs = 26;
    const ctx = cv.getContext('2d');
    ctx.font = `bold ${fs}px "Microsoft YaHei", sans-serif`;
    const tw = Math.ceil(ctx.measureText(l.text).width) + 20;
    cv.width = tw; cv.height = fs + 14;
    ctx.font = `bold ${fs}px "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = 'rgba(30,38,40,0.8)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#fff6dc';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.text, 10, cv.height / 2 + 1);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    const spr = new THREE.Mesh(new THREE.PlaneGeometry(cv.width, cv.height), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthTest: false }));
    v.copy(l.world).project(camera);
    spr.position.set(Math.round((v.x * 0.5 + 0.5) * W), Math.round((v.y * 0.5 + 0.5) * H - 46), 0);
    labelScene.add(spr);
  }
}

const px = createPixelPass(renderer, { height: ph, outline: { depth: 0.03, dark: 0.1, tint: 0.75, crease: 0 } });
function draw() {
  px.render(scene, camera);
  if (labelScene.children.length) {
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(labelScene, labelCam);
    renderer.autoClear = ac;
  }
}
PET.step = draw; // shot.cjs 保存前会调用它
window.__chars = { scene, camera, px, models, THREE, renderer };

renderer.info.reset();
draw();
return {
  view, canvas: [W, H], internal: [px.width, px.height],
  chars: models.map((m) => m.kind + ':' + m.tris),
  errors: PET.info().errors.length,
};
