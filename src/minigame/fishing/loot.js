// 钓鱼战利品的模型（程序化、带顶点色、一个物体只占 1–3 个 draw call，手绘质感材质）。
// 约定：原点在物体底部中心（放在地上时贴地），本地 +Z 为正面。大小以世界单位计（小狗约 1.2 长）。
// createLootKit() → { make(id) → { id, group, update(dt, t), setState(s), state, extra }, usingPondlife }
//   螃蟹 / 青蛙优先用另一位开发者做的 src/world/island/pondlife.js（createCrab / createFrog；通过 import.meta.glob 懒加载：
//   文件不存在或导出缺失时不会让构建失败，自动用这里的简易占位模型）。
import * as THREE from 'three';
import { paintMaterial } from '../../core/paint.js';
import { part, mergeParts, G, tube } from '../walk/geo.js';
import { createFishModel } from './fishModel.js';

const TAU = Math.PI * 2;
const mat = () => paintMaterial({ vertexColors: true, roughness: 1 }, { space: 'local', scale: 14, strength: 0.16, hue: 0.4, bands: 0.3, levels: 4 });
const ell = (rx, ry, rz, color, p = [0, 0, 0], r = [0, 0, 0]) => part(G.sphere(1, 12, 9), color, { p, r, s: [rx, ry, rz], ao: 0 });

// ---------------------------------------------------------------- 各种造型
function weedParts() {
  const P = [];
  const cols = [0x3f8a3a, 0x5fae4a, 0x2f7a3a, 0x78bf55, 0x4a9a44];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU, bx = Math.cos(a) * 0.04, bz = Math.sin(a) * 0.04, h = 0.34 + 0.1 * ((i * 37) % 5) / 4;
    let px = bx, py = 0, pz = bz;
    for (let j = 1; j <= 4; j++) {
      const t = j / 4;
      const nx = bx + Math.sin(t * 3 + i) * 0.05 * t + Math.cos(a) * 0.07 * t, nz = bz + Math.cos(t * 3 + i * 2) * 0.05 * t + Math.sin(a) * 0.07 * t, ny = h * t;
      P.push(tube([px, py, pz], [nx, ny, nz], 0.022 * (1.1 - t * 0.7), cols[i % cols.length], 5, 0.022 * (1.1 - (t - 0.25) * 0.7)));
      px = nx; py = ny; pz = nz;
    }
  }
  P.push(ell(0.07, 0.04, 0.07, 0x3a5a2a, [0, 0.02, 0]));
  return P;
}
function leafParts() {
  const P = [];
  P.push(part(G.cyl(0.34, 0.3, 0.025, 22), 0x7fc45a, { p: [0, 0.03, 0], ao: 0 }));
  P.push(part(G.torus(0.33, 0.014, 5, 24), 0x62aa44, { p: [0, 0.045, 0], r: [Math.PI / 2, 0, 0], ao: 0 }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    P.push(part(G.box(0.3, 0.008, 0.014), 0xa7d878, { p: [Math.cos(a) * 0.15, 0.047, Math.sin(a) * 0.15], r: [0, -a, 0], ao: 0 }));
  }
  P.push(ell(0.035, 0.02, 0.035, 0x4d8f3c, [0, 0.05, 0]));
  P.push(part(G.cone(0.16, 0.25, 3), 0x4a8a38, { p: [0.0, 0.043, -0.25], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.05], ao: 0 })); // 缺口处的暗影
  return P;
}
function podParts() {
  const P = [];
  P.push(tube([0, 0, 0], [0.04, 0.2, 0.0], 0.026, 0x5a9a40, 6));
  P.push(tube([0.04, 0.2, 0.0], [0.1, 0.42, 0.02], 0.022, 0x4f8f3a, 6));
  P.push(part(G.cyl(0.15, 0.07, 0.11, 14), 0xa8d25a, { p: [0.11, 0.46, 0.02], r: [0.15, 0, -0.2], ao: 0 }));
  P.push(part(G.cyl(0.155, 0.15, 0.02, 14), 0xc8e079, { p: [0.12, 0.52, 0.03], r: [0.15, 0, -0.2], ao: 0 }));
  const seeds = [[0, 0], [0.07, 0], [-0.07, 0.01], [0.03, 0.065], [-0.035, 0.06], [0.035, -0.06], [-0.04, -0.06]];
  for (const [sx, sz] of seeds) P.push(ell(0.022, 0.016, 0.022, 0x5b4a22, [0.12 + sx, 0.535 + sz * 0.25, 0.03 + sz]));
  return P;
}
function pebbleParts() {
  return [
    ell(0.17, 0.1, 0.13, 0x93a0a6, [0, 0.07, 0]),
    ell(0.1, 0.065, 0.085, 0xb3bcbe, [0.17, 0.045, 0.06]),
    ell(0.07, 0.04, 0.05, 0xd2d9da, [-0.03, 0.14, 0.01]),
    ell(0.05, 0.03, 0.04, 0x7c8a90, [-0.16, 0.03, -0.07]),
  ];
}
function shellParts(color, ridge, inner) {
  // 本地：铰链在 z = -0.16、y = 0.0；壳向 +Z 张开
  const bottom = [
    part(G.sphere(1, 14, 8), color, { p: [0, 0.04, 0], s: [0.2, 0.075, 0.17], ao: 0 }),
    part(G.cyl(0.18, 0.18, 0.012, 16), inner, { p: [0, 0.085, 0.0], s: [1, 1, 0.84], ao: 0 }),
  ];
  const top = [
    part(G.sphere(1, 14, 8), color, { p: [0, 0.035, 0.16], s: [0.2, 0.07, 0.17], ao: 0 }),
  ];
  for (const [P, y, dz] of [[bottom, 0.04, 0], [top, 0.035, 0.16]]) {
    for (let i = -2; i <= 2; i++) P.push(part(G.torus(0.1 + 0.025 * Math.abs(i), 0.007, 4, 14, Math.PI), ridge, { p: [i * 0.06, y + 0.045 * (P === top ? 0.5 : 0.55), dz], r: [0, Math.PI / 2, 0], s: [1, 0.7, 0.85], ao: 0 }));
  }
  return { bottom, top };
}
function twigParts() {
  const P = [];
  const pts = [[-0.3, 0.03, 0], [-0.1, 0.05, 0.01], [0.12, 0.03, -0.01], [0.3, 0.0, 0]];
  for (let i = 0; i < 3; i++) P.push(tube(pts[i], pts[i + 1], 0.034 - i * 0.004, i === 1 ? 0x8a6a50 : 0x7d5f48, 7, 0.036 - i * 0.004));
  P.push(ell(0.012, 0.03, 0.03, 0xd9b88c, [-0.305, 0.03, 0]));
  P.push(ell(0.012, 0.028, 0.028, 0xd9b88c, [0.305, 0.0, 0]));
  P.push(tube([-0.12, 0.05, 0.01], [-0.06, 0.15, 0.03], 0.017, 0x7d5f48, 6, 0.022));
  P.push(ell(0.012, 0.012, 0.012, 0xd9b88c, [-0.058, 0.152, 0.03]));
  P.push(tube([0.05, 0.035, 0.0], [0.1, 0.11, -0.04], 0.013, 0x7d5f48, 6, 0.016));
  return P;
}

// ---------------------------------------------------------------- 简易占位：青蛙 / 螃蟹（pondlife.js 不可用时）
function placeholderFrog(mt) {
  const group = new THREE.Group();
  const P = [ell(0.1, 0.075, 0.12, 0x74c24a, [0, 0.07, 0]), ell(0.07, 0.06, 0.07, 0x74c24a, [0, 0.1, 0.1]), ell(0.04, 0.04, 0.04, 0xf4ffd8, [0.05, 0.16, 0.1]), ell(0.04, 0.04, 0.04, 0xf4ffd8, [-0.05, 0.16, 0.1]),
    ell(0.018, 0.018, 0.018, 0x1f1a17, [0.05, 0.165, 0.125]), ell(0.018, 0.018, 0.018, 0x1f1a17, [-0.05, 0.165, 0.125]), ell(0.05, 0.03, 0.06, 0xc8e8a0, [0, 0.04, 0.03]),
    ell(0.03, 0.03, 0.07, 0x5aa83a, [0.09, 0.03, -0.06]), ell(0.03, 0.03, 0.07, 0x5aa83a, [-0.09, 0.03, -0.06])];
  const m = new THREE.Mesh(mergeParts(P, { aoH: 0 }), mt);
  m.castShadow = true;
  group.add(m);
  let state = 'sit', t = 0;
  return {
    group, get state() { return state; }, setState(s) { state = s; },
    update(dt) { t += dt; m.scale.y = 1 + (state === 'croak' ? 0.08 * Math.sin(t * 14) : 0.02 * Math.sin(t * 3)); m.position.y = state === 'jump' ? 0.02 : 0; },
  };
}
function placeholderCrab(mt) {
  const group = new THREE.Group();
  const P = [ell(0.13, 0.06, 0.1, 0xee5a3a, [0, 0.07, 0]), ell(0.04, 0.035, 0.04, 0xff7a52, [0.16, 0.08, 0.1]), ell(0.04, 0.035, 0.04, 0xff7a52, [-0.16, 0.08, 0.1]),
    ell(0.025, 0.04, 0.025, 0xfff0e0, [0.05, 0.14, 0.08]), ell(0.025, 0.04, 0.025, 0xfff0e0, [-0.05, 0.14, 0.08]), ell(0.012, 0.012, 0.012, 0x1f1a17, [0.05, 0.16, 0.1]), ell(0.012, 0.012, 0.012, 0x1f1a17, [-0.05, 0.16, 0.1])];
  for (const s of [1, -1]) for (let i = 0; i < 3; i++) P.push(tube([0.1 * s, 0.06, 0.05 - i * 0.05], [0.2 * s, 0.025, 0.07 - i * 0.07], 0.008, 0xd94a2a, 4));
  const m = new THREE.Mesh(mergeParts(P, { aoH: 0 }), mt);
  m.castShadow = true;
  group.add(m);
  let state = 'idle', t = 0;
  return {
    group, get state() { return state; }, setState(s) { state = s; },
    update(dt) { t += dt; m.rotation.z = state === 'pinch' ? 0.1 * Math.sin(t * 16) : state === 'walk' ? 0.06 * Math.sin(t * 12) : 0; m.scale.setScalar(state === 'hide' ? 0.5 : 1); },
  };
}

// pondlife.js：懒加载（Vite 的 import.meta.glob 在文件不存在时得到空对象，不会让构建失败；Node 下没有 import.meta.glob，同样降级）
let pondlifeLoad = null;
function loadPondlife() {
  if (pondlifeLoad) return pondlifeLoad;
  let loaders = {};
  try { loaders = import.meta.glob('../../world/island/pondlife.js') || {}; } catch (_) { loaders = {}; }
  const fn = loaders['../../world/island/pondlife.js'];
  pondlifeLoad = fn ? fn().catch(() => null) : Promise.resolve(null);
  return pondlifeLoad;
}

export function createLootKit() {
  const lootMat = mat();
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfe8e4, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.46, depthWrite: false });
  const pearlMat = new THREE.MeshStandardMaterial({ color: 0xfdf6ee, roughness: 0.22, metalness: 0.1, emissive: 0x5a4a3c, emissiveIntensity: 0.7 });
  const geos = {};
  const G0 = (k, f) => (geos[k] || (geos[k] = f()));
  const kit = { pondlife: null, usingPondlife: { frog: false, crab: false } };
  loadPondlife().then((m) => { kit.pondlife = m; });

  const mesh = (geo, m = lootMat) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; return o; };

  function make(id) {
    const group = new THREE.Group();
    group.name = 'loot-' + id;
    const o = { id, group, state: '', t: 0, extra: {}, update() {}, setState(s) { o.state = s; } };
    switch (id) {
      case 'goldfish': case 'koi': case 'loach': {
        // 完整的鱼模型（fishModel.js）：身体会弯——在水里摆尾、上岸后侧躺着卷身拍尾
        const f = createFishModel(id, lootMat);
        group.add(f.mesh);
        o.extra = { fish: f };
        o.update = (dt) => { o.t += dt; f.update(dt, o.state); };
        break;
      }
      case 'weed': group.add(mesh(G0('weed', () => mergeParts(weedParts(), { aoH: 0.3 })))); break;
      case 'lotusLeaf': group.add(mesh(G0('leaf', () => mergeParts(leafParts(), { aoH: 0 })))); break;
      case 'lotusPod': group.add(mesh(G0('pod', () => mergeParts(podParts(), { aoH: 0 })))); break;
      case 'pebble': group.add(mesh(G0('pebble', () => mergeParts(pebbleParts(), { aoH: 0.15 })))); break;
      case 'clam': case 'pearlClam': {
        const pearl = id === 'pearlClam';
        const sp = pearl ? shellParts(0x8d7aa6, 0x6e5c88, 0xf1d8e8) : shellParts(0x6c7a5a, 0x4f5a42, 0xe8dcd0);
        const bot = mesh(G0('clamB' + id, () => mergeParts(sp.bottom, { aoH: 0 })));
        const hinge = new THREE.Group();
        hinge.position.set(0, 0.0, -0.16);
        const topM = mesh(G0('clamT' + id, () => mergeParts(sp.top, { aoH: 0 })));
        topM.position.set(0, 0, 0.16); // 顶壳相对铰链
        hinge.add(topM);
        group.add(bot, hinge);
        let pm = null;
        if (pearl) { pm = new THREE.Mesh(G0('pearl', () => new THREE.SphereGeometry(0.085, 14, 10)), pearlMat); pm.position.set(0, 0.14, 0.03); pm.visible = false; group.add(pm); }
        let open = 0;
        o.extra = { pearl: pm, hinge };
        o.setOpen = (v) => { open = v; hinge.rotation.x = -open * 1.05; if (pm) { pm.visible = open > 0.15; pm.scale.setScalar(0.4 + 0.6 * Math.min(1, open)); } };
        break;
      }
      case 'twig': group.add(mesh(G0('twig', () => mergeParts(twigParts(), { aoH: 0 })))); break;
      case 'bottle': {
        const glass = new THREE.Mesh(G0('bottleGlass', () => {
          const pts = [[0, 0], [0.085, 0.0], [0.1, 0.03], [0.1, 0.2], [0.085, 0.26], [0.045, 0.31], [0.036, 0.36], [0.04, 0.44], [0.046, 0.455], [0.0, 0.455]].map((p) => new THREE.Vector2(p[0], p[1]));
          return new THREE.LatheGeometry(pts, 14);
        }), glassMat);
        glass.renderOrder = 6;
        const inner = mesh(G0('bottleIn', () => mergeParts([
          part(G.cyl(0.05, 0.05, 0.22, 10), 0xfff0cc, { p: [0, 0.14, 0], ao: 0 }),
          part(G.torus(0.05, 0.006, 4, 10), 0xe8d6a8, { p: [0, 0.25, 0], r: [Math.PI / 2, 0, 0], ao: 0 }),
          part(G.torus(0.05, 0.006, 4, 10), 0xe8d6a8, { p: [0, 0.03, 0], r: [Math.PI / 2, 0, 0], ao: 0 }),
          part(G.box(0.012, 0.012, 0.012), 0xc0392b, { p: [0, 0.14, 0.05], ao: 0 }), // 系纸条的小红线
        ], { aoH: 0 })));
        const cork = mesh(G0('bottleCork', () => mergeParts([part(G.cyl(0.036, 0.03, 0.07, 10), 0xc58a50, { p: [0, 0.475, 0], ao: 0 })], { aoH: 0 })));
        group.add(inner, glass, cork);
        o.extra = { cork, glass };
        o.setCork = (v) => { cork.position.y = v * 0.5; cork.position.x = v * 0.06; cork.rotation.z = v * 1.2; cork.visible = v < 1.9; };
        break;
      }
      case 'frog': case 'crab': {
        const pl = kit.pondlife;
        let inst = null;
        try {
          const f = pl && (id === 'frog' ? pl.createFrog : pl.createCrab);
          if (typeof f === 'function') { inst = f(); if (inst && inst.group) kit.usingPondlife[id] = true; else inst = null; }
        } catch (_) { inst = null; }
        if (!inst) { inst = id === 'frog' ? placeholderFrog(lootMat) : placeholderCrab(lootMat); kit.usingPondlife[id] = false; }
        group.add(inst.group);
        o.inner = inst;
        o.setState = (s) => { o.state = s; try { inst.setState(s); } catch (_) { /* ignore */ } };
        o.update = (dt) => { try { inst.update(dt); } catch (_) { /* ignore */ } };
        o.setState(id === 'frog' ? 'sit' : 'idle');
        break;
      }
      default: break;
    }
    return o;
  }
  kit.make = make;
  kit.waitPondlife = () => loadPondlife();
  return kit;
}

export default createLootKit;
