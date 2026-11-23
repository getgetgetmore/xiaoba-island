// 衣帽间（完整房间版）：一间四面墙的旧木屋房间，小狗可以在里面走动，相机可以绕着房间转。
// 三个区：橱柜区（north 墙，空的陈列架）、镜子区（west 墙，真的能照出小狗的穿衣镜）、拍照区（east 墙，可换背景板）。
// south 墙是进门的那面（一扇回小屋的小门，布景）。没有天花板：留几根横梁和两串暖光小灯泡。
// 坐标：房间中心 = 原点，地面 y = 0；x 向东（east = +x），z 向南（south = +z，north = -z）。
// 小狗 rotation.y = θ 时面朝 (sinθ, 0, cosθ)：朝北 θ = π，朝西 θ = -π/2，朝南 θ = 0。
// 灯光：狗毛的亮度取决于场景里第一盏平行光（rig.js furMat），所以保留一盏偏白的平行光作为第一盏，强度不低于 4.2，且不再加第二盏平行光。
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mulberry32 } from '../core/util.js';
import { paintMaterial } from '../core/paint.js';
import { C } from '../world/island/colors.js';
import { GeoBuilder, cylBetween, mixHex } from '../world/island/geo.js';

const W = 9, D = 7, H = 3.2; // 房间内部尺寸
const HW = W / 2, HD = D / 2;
const PI = Math.PI;

const PAL = {
  plankA: 0xa88660, plankB: 0x9a7650, plankC: 0x8c6c4a, plankD: 0xb08e66,
  floorA: 0x866444, floorB: 0x7a5a3c, floorC: 0x8e6c4a,
  rugRed: 0xb5532a, rugCream: 0xe8dcc0, rugTeal: 0x46683d, rugGold: 0xc9a85a,
  shelf: 0xb08c60, shelfDark: 0x8a6a48, post: 0x9a7a52, back: 0x4a6258,
};

// 墙的局部坐标：lx 沿墙（从房间里面对着墙看，向右为 +lx），y 向上，lz = 离墙面的距离（向房间里为正）
const FR = {
  north: { ry: 0, p: (lx, y, lz) => [lx, y, -HD + lz] },
  south: { ry: PI, p: (lx, y, lz) => [-lx, y, HD - lz] },
  west: { ry: PI / 2, p: (lx, y, lz) => [-HW + lz, y, -lx] },
  east: { ry: -PI / 2, p: (lx, y, lz) => [HW - lz, y, lx] },
};

const BACKDROPS = [
  { id: 'wood', name: '木墙本色' },
  { id: 'sky', name: '蓝天白云' },
  { id: 'sakura', name: '樱花粉' },
  { id: 'forest', name: '森林绿' },
  { id: 'night', name: '夜空星星' },
  { id: 'festive', name: '节日彩旗' },
];
const CW = 640, CH = 512;

// ---------- 背景板的图案（程序绘制） ----------
function drawBackdrop(id, g) {
  const rnd = mulberry32(id.length * 977 + id.charCodeAt(0));
  const R = (a, b) => a + rnd() * (b - a);
  const grad = (stops, x0 = 0, y0 = 0, x1 = 0, y1 = CH) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([t, c]) => gr.addColorStop(t, c));
    g.fillStyle = gr; g.fillRect(0, 0, CW, CH);
  };
  const circle = (x, y, r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, PI * 2); g.fill(); };
  if (id === 'wood') {
    const cols = ['#b88e5c', '#a98150', '#c29a66', '#9c7648', '#b08656'];
    const pw = 64;
    for (let i = 0; i < 10; i++) {
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      g.fillRect(i * pw, 0, pw, CH);
      for (let k = 0; k < 16; k++) {
        const x = i * pw + R(4, pw - 6);
        g.strokeStyle = `rgba(70,42,20,${R(0.08, 0.22)})`; g.lineWidth = R(1, 2.5);
        g.beginPath(); g.moveTo(x, 0);
        for (let y = 0; y <= CH; y += 64) g.lineTo(x + Math.sin(y * 0.02 + k) * 3, y);
        g.stroke();
      }
      if (rnd() < 0.6) {
        const kx = i * pw + R(16, pw - 16), ky = R(40, CH - 40);
        g.fillStyle = 'rgba(80,48,24,0.55)'; g.beginPath(); g.ellipse(kx, ky, 7, 12, 0, 0, PI * 2); g.fill();
        g.strokeStyle = 'rgba(80,48,24,0.3)'; g.lineWidth = 2; g.beginPath(); g.ellipse(kx, ky, 12, 20, 0, 0, PI * 2); g.stroke();
      }
      g.fillStyle = '#4a3220'; g.fillRect(i * pw + pw - 3, 0, 3, CH);
      g.fillStyle = '#6a4a2a';
      for (const y of [18, CH - 18]) { g.beginPath(); g.arc(i * pw + pw / 2, y, 3, 0, PI * 2); g.fill(); }
    }
  } else if (id === 'sky') {
    grad([[0, '#3f93df'], [0.55, '#8cc8f2'], [1, '#d6eefb']]);
    circle(500, 110, 90, 'rgba(255,248,200,0.28)'); circle(500, 110, 48, '#fff6c8');
    const cloud = (cx, cy, s) => {
      const parts = [[0, 0, 34], [38, -10, 42], [82, 2, 34], [-34, 8, 28], [118, 12, 24], [40, 14, 36]];
      g.fillStyle = 'rgba(190,214,236,0.8)';
      for (const [dx, dy, r] of parts) { g.beginPath(); g.arc(cx + dx * s, cy + dy * s + 8 * s, r * s, 0, PI * 2); g.fill(); }
      g.fillStyle = '#ffffff';
      for (const [dx, dy, r] of parts) { g.beginPath(); g.arc(cx + dx * s, cy + dy * s, r * s, 0, PI * 2); g.fill(); }
    };
    cloud(70, 90, 1.1); cloud(300, 200, 0.9); cloud(430, 300, 0.7); cloud(120, 330, 0.8); cloud(240, 40, 0.6);
    g.fillStyle = '#7fc063'; g.beginPath(); g.moveTo(0, 430); g.quadraticCurveTo(160, 360, 330, 430); g.quadraticCurveTo(480, 480, CW, 410); g.lineTo(CW, CH); g.lineTo(0, CH); g.fill();
    g.fillStyle = '#5da84a'; g.beginPath(); g.moveTo(0, 470); g.quadraticCurveTo(200, 430, 400, 478); g.quadraticCurveTo(540, 505, CW, 460); g.lineTo(CW, CH); g.lineTo(0, CH); g.fill();
  } else if (id === 'sakura') {
    grad([[0, '#ff9fbd'], [0.6, '#ffc4d6'], [1, '#ffe0e9']]);
    for (let i = 0; i < 18; i++) circle(R(0, CW), R(0, CH), R(14, 44), `rgba(255,255,255,${R(0.1, 0.3)})`);
    const branch = (pts, w0) => {
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (let k = 0; k < pts.length - 1; k++) {
        g.strokeStyle = '#6a4636'; g.lineWidth = w0 * (1 - k / pts.length * 0.7);
        g.beginPath(); g.moveTo(pts[k][0], pts[k][1]); g.lineTo(pts[k + 1][0], pts[k + 1][1]); g.stroke();
      }
    };
    const flower = (x, y, r) => {
      const col = ['#ff9fb8', '#ffb6c8', '#ffd0dc', '#ff8fae'][Math.floor(rnd() * 4)];
      const rot = rnd() * 6;
      for (let p = 0; p < 5; p++) {
        const a = rot + p * PI * 2 / 5;
        g.fillStyle = col; g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.55, r * 0.4, a, 0, PI * 2); g.fill();
      }
      circle(x, y, r * 0.2, '#f4c24a');
    };
    const b1 = [[-10, 90], [90, 120], [180, 100], [270, 150], [340, 140]];
    const b2 = [[90, 120], [140, 190], [210, 230], [300, 250]];
    const b3 = [[CW + 10, 400], [520, 360], [440, 380], [370, 330], [300, 340]];
    const b4 = [[520, 360], [560, 290], [600, 250]];
    for (const [pts, w] of [[b1, 18], [b2, 12], [b3, 20], [b4, 11]]) branch(pts, w);
    for (const pts of [b1, b2, b3, b4]) for (let k = 0; k < pts.length; k++) for (let n = 0; n < 5; n++) flower(pts[k][0] + R(-34, 34), pts[k][1] + R(-34, 34), R(14, 26));
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,${Math.round(R(150, 200))},${Math.round(R(180, 215))},0.9)`;
      g.beginPath(); g.ellipse(R(0, CW), R(0, CH), 7, 4, R(0, 6), 0, PI * 2); g.fill();
    }
  } else if (id === 'forest') {
    grad([[0, '#d9f1c2'], [0.5, '#b4dc96'], [1, '#86b565']]);
    g.fillStyle = 'rgba(255,255,200,0.14)';
    for (const x of [90, 250, 430, 560]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 50, 0); g.lineTo(x - 90, CH); g.lineTo(x - 190, CH); g.fill(); }
    const hill = (y, col, amp) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, CH); for (let x = 0; x <= CW; x += 40) g.lineTo(x, y + Math.sin(x * 0.012 + y) * amp); g.lineTo(CW, CH); g.fill(); };
    hill(270, '#8fbf72', 26); hill(330, '#6fa65a', 22);
    const pine = (x, base, h, col, dark) => {
      g.fillStyle = '#5a4030'; g.fillRect(x - h * 0.04, base - h * 0.12, h * 0.08, h * 0.14);
      for (let k = 0; k < 4; k++) {
        const w = h * (0.34 - k * 0.07), y1 = base - h * 0.1 - k * h * 0.22;
        g.fillStyle = col; g.beginPath(); g.moveTo(x - w, y1); g.lineTo(x + w, y1); g.lineTo(x, y1 - h * 0.34); g.fill();
        g.fillStyle = dark; g.beginPath(); g.moveTo(x + w * 0.1, y1 - h * 0.04); g.lineTo(x + w, y1); g.lineTo(x, y1 - h * 0.34); g.fill();
      }
    };
    for (let i = 0; i < 9; i++) pine(i * 80 + R(0, 40), 340 + R(0, 15), R(120, 170), '#4d8a52', '#3a6e42');
    for (let i = 0; i < 7; i++) pine(i * 100 + R(0, 50) - 10, 440 + R(0, 25), R(190, 260), '#2f6a3e', '#245432');
    g.fillStyle = '#4c8a46'; g.fillRect(0, 470, CW, 50);
    for (let i = 0; i < 60; i++) circle(R(0, CW), R(300, CH), R(1.5, 3.5), 'rgba(255,255,210,0.5)');
  } else if (id === 'night') {
    grad([[0, '#080c2a'], [0.6, '#1d2556'], [1, '#3a3f78']]);
    circle(440, 130, 110, 'rgba(255,240,180,0.10)'); circle(440, 130, 70, 'rgba(255,240,180,0.18)');
    g.save(); g.beginPath(); g.rect(0, 0, CW, CH); g.arc(466, 116, 42, 0, PI * 2); g.clip('evenodd');
    g.fillStyle = '#fff1b8'; g.beginPath(); g.arc(440, 130, 46, 0, PI * 2); g.fill(); g.restore();
    for (let i = 0; i < 170; i++) {
      const x = R(0, CW), y = R(0, CH * 0.85), r = R(0.8, 2.2);
      circle(x, y, r, `rgba(255,255,${Math.round(R(210, 255))},${R(0.5, 1)})`);
    }
    const spark = (x, y, r) => {
      g.fillStyle = '#fff8d0'; g.beginPath();
      g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r); g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.fill();
      circle(x, y, r * 0.35, 'rgba(255,248,208,0.35)');
    };
    for (let i = 0; i < 9; i++) spark(R(30, CW - 30), R(20, 330), R(8, 18));
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(130, 60); g.lineTo(60, 100); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 6; g.beginPath(); g.moveTo(130, 60); g.lineTo(80, 90); g.stroke();
    g.fillStyle = '#10163a'; g.beginPath(); g.moveTo(0, 440); g.quadraticCurveTo(120, 380, 260, 440); g.quadraticCurveTo(420, 500, CW, 420); g.lineTo(CW, CH); g.lineTo(0, CH); g.fill();
    g.fillStyle = '#0a0f2a'; g.beginPath(); g.moveTo(0, 480); g.quadraticCurveTo(220, 440, 420, 490); g.quadraticCurveTo(540, 510, CW, 470); g.lineTo(CW, CH); g.lineTo(0, CH); g.fill();
  } else { // festive
    grad([[0, '#fff1d6'], [1, '#ffe2bf']], 0, 0, CW, CH);
    const flagCols = ['#e8503a', '#f2b632', '#3aa6a0', '#f08bb0', '#4a7fd0', '#7cc15a'];
    const string = (y0, sag, fw, cnt) => {
      const pt = (t) => [t * CW, y0 + sag * 4 * t * (1 - t) + (t - 0.5) * 20];
      g.strokeStyle = '#6a4a30'; g.lineWidth = 3; g.beginPath(); g.moveTo(...pt(0)); for (let k = 1; k <= 40; k++) g.lineTo(...pt(k / 40)); g.stroke();
      for (let k = 0; k < cnt; k++) {
        const t0 = (k + 0.2) / cnt, t1 = (k + 0.8) / cnt, tm = (t0 + t1) / 2;
        const a = pt(t0), c = pt(t1), m = pt(tm);
        g.fillStyle = flagCols[(k + Math.floor(y0)) % flagCols.length];
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.lineTo(m[0], m[1] + fw); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(a[0] + 6, a[1] + 8); g.lineTo(m[0], m[1] + fw - 12); g.stroke();
      }
    };
    string(40, 60, 70, 11); string(170, 50, 62, 11); string(300, 55, 66, 10);
    for (let i = 0; i < 90; i++) {
      g.save(); g.translate(R(0, CW), R(0, CH)); g.rotate(R(0, 6));
      g.fillStyle = flagCols[Math.floor(rnd() * flagCols.length)]; g.globalAlpha = 0.85;
      g.fillRect(-4, -2, 9, 4); g.restore();
    }
    for (const [x, y, c] of [[70, 440, '#e8503a'], [140, 460, '#f2b632'], [520, 450, '#3aa6a0'], [580, 430, '#f08bb0']]) {
      g.strokeStyle = '#7a6a58'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y + 36); g.quadraticCurveTo(x - 10, y + 80, x + 4, CH); g.stroke();
      circle(x, y, 36, c); circle(x - 10, y - 12, 9, 'rgba(255,255,255,0.45)');
    }
  }
}

export function createWardrobeRoom() {
  const rng = mulberry32(2024);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2c2018);
  scene.fog = null;

  // ---------- 材质（全项目统一的手绘质感） ----------
  const matWood = paintMaterial({ vertexColors: true, roughness: 1, flatShading: true }, { scale: 1.5, strength: 0.2, hue: 0.6, bands: 0.3, levels: 4, stretch: [4, 1, 4] });
  const matSmooth = paintMaterial({ vertexColors: true, roughness: 1 }, { scale: 1.3, strength: 0.22, hue: 0.8, bands: 0.3, levels: 4 });
  const matGlow = paintMaterial({ color: 0xb8a67a, emissive: 0xffa940, emissiveIntensity: 1.6, roughness: 0.6 }, { scale: 3, strength: 0.08, bands: 0 });
  const matSoft = paintMaterial({ color: 0xf4ead8, emissive: 0xfff0d0, emissiveIntensity: 1.2, roughness: 0.6 }, { scale: 3, strength: 0.05, bands: 0 });
  matWood.color.setScalar(0.92); matSmooth.color.setScalar(0.95);
  matWood.emissive.setHex(0x1c1208); matSmooth.emissive.setHex(0x1c1208);

  const mk = (seed, jitter = 0.07) => new GeoBuilder({ seed, jitter, aoH: 0.5, aoK: 0.3 });
  const bG = mk(31), sG = new GeoBuilder({ seed: 32, jitter: 0.04, aoK: 0 }), gG = new GeoBuilder({ seed: 33, jitter: 0, aoK: 0 });
  const bd = { north: mk(41), south: mk(42), west: mk(43), east: mk(44) };
  const gE = new GeoBuilder({ seed: 45, jitter: 0, aoK: 0 });

  const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  const tone = (base, amt) => mixHex(base, rng() < 0.5 ? 0xffffff : 0x000000, Math.abs((rng() - 0.5) * amt));
  const woodTone = () => tone(pick([PAL.plankA, PAL.plankB, PAL.plankC, PAL.plankD, PAL.plankB]), 0.2);
  const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // 在墙的局部坐标里放东西
  const put = (bld, side, geo, lx, y, lz, o = {}) => {
    bld.add(geo, { jitter: o.jitter, scale: o.scale, color: o.color, ao: o.ao === undefined ? false : o.ao, pos: FR[side].p(lx, y, lz), rot: [0, FR[side].ry + (o.ry || 0), 0] });
  };
  const rod = (bld, side, p0, p1, r0, r1, sides, o = {}) => cylBetween(bld, FR[side].p(...p0), FR[side].p(...p1), r0, r1, sides, { ao: false, ...o });
  const poly = (pts) => { // 局部 xy 平面里的平面多边形（朝 +z），用来画牌子上的图案
    const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    return new THREE.ShapeGeometry(s);
  };

  // ---------- 地板：横铺的旧木板（顶面 y = -0.02，地垫顶面在 0），略歪、有色差 ----------
  {
    const bw = 0.36, zs = D + 0.24, n = Math.ceil(zs / bw);
    for (let i = 0; i < n; i++) {
      const z = -zs / 2 + bw / 2 + i * bw;
      bG.add(BOX(W + 0.24, 0.06, bw - 0.014), {
        pos: [0, -0.05, z], rot: [0, (rng() - 0.5) * 0.006, (rng() - 0.5) * 0.004],
        color: tone(pick([PAL.floorA, PAL.floorB, PAL.floorC, PAL.floorA]), 0.18), ao: false,
      });
    }
    bG.add(BOX(W + 0.24, 0.04, zs), { pos: [0, -0.1, 0], color: C.innerDark, ao: false });
  }

  // ---------- 灯泡串（没有天花板，不做横梁；每面墙顶上有一条压顶木，属于各自的墙） ----------
  // 两串小灯泡（挂在东西墙之间，低垂的弧线）
  const bulbPos = [];
  for (const [zc, yEnd, sag] of [[0.5, 3.0, 0.3], [2.3, 3.0, 0.28]]) {
    const xL = -HW + 0.06, xR = HW - 0.06;
    const p = (t) => [xL + (xR - xL) * t, yEnd - sag * 4 * t * (1 - t), zc + Math.sin(t * 7 + zc) * 0.06];
    for (let i = 0; i < 36; i++) cylBetween(bG, p(i / 36), p((i + 1) / 36), 0.01, 0.01, 3, { color: C.woodDeep, ao: false, jitter: 0 });
    const N = 12;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N, q = p(t);
      bG.add(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 6), { pos: [q[0], q[1] - 0.04, q[2]], color: C.woodDeep, ao: false, jitter: 0 });
      gG.add(new THREE.IcosahedronGeometry(0.1, 1), { pos: [q[0], q[1] - 0.14, q[2]] });
      bulbPos.push(q);
    }
  }

  // ---------- 圆形编织地垫（房间中央，顶面 y = 0） ----------
  {
    const rings = [[1.6, PAL.rugRed], [1.38, PAL.rugCream], [1.18, PAL.rugTeal], [0.96, PAL.rugGold], [0.74, PAL.rugRed], [0.5, PAL.rugCream], [0.26, PAL.rugTeal]];
    rings.forEach(([r, col], i) => sG.add(new THREE.CylinderGeometry(r, r, 0.07, 32), { pos: [0, i * 0.0015 - 0.035, 0], color: col, ao: false, jitter: 0.06 }));
    const rope = new THREE.TorusGeometry(1.6, 0.04, 6, 48); rope.rotateX(PI / 2);
    sG.add(rope, { pos: [0, -0.005, 0], color: 0xa98840, ao: false, jitter: 0.1 });
  }

  // ---------- 四面墙：竖板（长短不一）+ 踢脚板 + 横档 ----------
  const WALL_NORMAL = { north: [0, 0, 1], south: [0, 0, -1], west: [1, 0, 0], east: [-1, 0, 0] };
  for (const side of ['north', 'south', 'west', 'east']) {
    const pw = 0.4, along = side === 'north' || side === 'south' ? W + 0.24 : D;
    const n = Math.ceil(along / pw), len = n * pw;
    for (let i = 0; i < n; i++) {
      const lx = -len / 2 + pw / 2 + i * pw;
      const h = H + (rng() - 0.5) * 0.1;
      bd[side].add(BOX(pw - 0.016, h, 0.08), { pos: FR[side].p(lx, h / 2 - 0.05, -0.04), rot: [0, FR[side].ry, 0], color: woodTone(), ao: true });
    }
    put(bd[side], side, BOX(len, 0.16, 0.05), 0, 0.08, 0.025, { color: C.woodDeep });
    put(bd[side], side, BOX(len, 0.12, 0.14), 0, H + 0.01, 0.03, { color: tone(0x6a4e34, 0.2) }); // 压顶木
    for (const y of [0.9, 2.45]) put(bd[side], side, BOX(len, 0.12, 0.05), 0, y + (rng() - 0.5) * 0.02, 0.025, { color: 0x7a5a3c });
  }

  // ---------- 小工具：木箱 / 帽盒 / 矮凳 / 挂画 / 挂钩 ----------
  const crateW = (bld, x, z, w, h, d, ry, col) => { // 世界坐标的盖着的小木箱
    bld.add(BOX(w, h, d), { pos: [x, h / 2, z], rot: [0, ry, 0], color: col, ao: true });
    bld.add(BOX(w + 0.05, 0.05, d + 0.05), { pos: [x, h + 0.025, z], rot: [0, ry, 0], color: C.woodDeep, ao: false });
    for (const s of [-1, 1]) bld.add(BOX(0.06, h * 0.92, d + 0.02), { pos: [x + Math.cos(ry) * w * 0.3 * s, h / 2, z - Math.sin(ry) * w * 0.3 * s], rot: [0, ry, 0], color: C.woodGreyDark, ao: false });
  };
  const hatboxW = (bld, x, y0, z, r, h, col, lid) => {
    bld.add(new THREE.CylinderGeometry(r, r * 1.02, h, 14), { pos: [x, y0 + h / 2, z], color: col, ao: false });
    bld.add(new THREE.CylinderGeometry(r * 1.07, r * 1.07, 0.07, 14), { pos: [x, y0 + h + 0.02, z], color: lid, ao: false });
    bld.add(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.03, 8), { pos: [x, y0 + h + 0.07, z], color: C.woodDeep, ao: false });
  };
  const stoolW = (bld, sx, sz, h, r) => {
    bld.add(new THREE.CylinderGeometry(r, r, 0.06, 10), { pos: [sx, h, sz], color: C.woodWarm, ao: false });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2 + 0.5;
      cylBetween(bld, [sx + Math.cos(a) * r * 0.65, h - 0.02, sz + Math.sin(a) * r * 0.65], [sx + Math.cos(a) * r * 1.05, 0, sz + Math.sin(a) * r * 1.05], 0.03, 0.026, 5, { color: C.woodGreyDark, ao: false });
    }
  };
  const painting = (side, lx, y, w, h, sky, hill, sun) => {
    const B = bd[side];
    put(B, side, BOX(w, h, 0.04), lx, y, 0.03, { color: 0x6a4e34 });
    put(B, side, BOX(w - 0.1, h - 0.1, 0.045), lx, y, 0.03, { color: 0xe8dcc0 });
    const iw = w - 0.2, ih = h - 0.2;
    put(B, side, poly([[-iw / 2, -ih / 2], [iw / 2, -ih / 2], [iw / 2, ih / 2], [-iw / 2, ih / 2]]), lx, y, 0.056, { color: sky });
    put(B, side, poly([[-iw / 2, -ih / 2], [iw / 2, -ih / 2], [iw / 2, -ih * 0.1], [iw * 0.1, ih * 0.12], [-iw * 0.2, -ih * 0.12], [-iw / 2, 0]]), lx, y, 0.058, { color: hill });
    put(B, side, poly([[-iw * 0.2, ih * 0.22], [-iw * 0.1, ih * 0.3], [0, ih * 0.22], [-iw * 0.1, ih * 0.14]]), lx + iw * 0.3, y + ih * 0.12, 0.059, { color: sun });
  };
  const hookRow = (side, lx0, n, gap, y) => {
    const B = bd[side];
    put(B, side, BOX(gap * (n - 1) + 0.3, 0.09, 0.03), lx0 + gap * (n - 1) / 2, y, 0.02, { color: C.woodDeep });
    for (let i = 0; i < n; i++) {
      const x = lx0 + i * gap;
      rod(B, side, [x, y, 0.03], [x, y, 0.2], 0.018, 0.018, 4, { color: C.woodDeep });
      rod(B, side, [x, y, 0.2], [x, y + 0.1, 0.2], 0.018, 0.026, 4, { color: C.woodDeep });
    }
  };

  // ======================= north：橱柜区 =======================
  // 橱柜：宽 5.2（含两侧各 0.5 的立柱）、高 2.91、进深 0.68，正面敞开。四排：帽子 / 衣服（挂衣杆）/ 装饰品 / 鞋子
  const ROWS = [
    { zone: 'hat', y: 2.24, ctr: 2.54 },
    { zone: 'top', y: 1.5, ctr: 1.81 },
    { zone: 'acc', y: 0.77, ctr: 1.07 },
    { zone: 'shoes', y: 0.12, ctr: 0.42 },
  ];
  const CAB_LZ = 0.38; // 陈列品中心离墙的距离（世界 z = -3.5 + 0.38 = -3.12）
  const PITCH = 1.0;
  {
    const s = 'north', B = bd.north, zc = 0.37;
    put(B, s, BOX(5.2, 0.08, 0.66), 0, 0.04, zc, { color: C.woodDeep });
    for (const sx of [-1, 1]) {
      put(B, s, BOX(0.5, 2.83, 0.64), sx * 2.35, 1.495, 0.36, { color: tone(PAL.post, 0.12), ao: true });
      put(B, s, BOX(0.04, 2.7, 0.02), sx * 2.35 + 0.17 * sx, 1.5, 0.69, { color: 0x6a4e34 });
    }
    // 后板：竖板，深青绿色，衬出陈列品
    for (let i = 0; i < 12; i++) put(B, s, BOX(0.345, 2.75, 0.03), -2.1 + 0.175 + i * 0.35, 1.475, 0.065, { color: tone(PAL.back, 0.2) });
    // 鞋架：条板
    for (let i = 0; i < 10; i++) put(B, s, BOX(0.38, 0.04, 0.62), -1.89 + i * 0.42, 0.10, zc, { color: tone(PAL.shelf, 0.14) });
    put(B, s, BOX(4.2, 0.04, 0.03), 0, 0.14, 0.695, { color: PAL.shelfDark });
    // 隔板（净空：鞋 0.61 / 装饰 0.61 / 衣服 0.78 / 帽子 0.61）
    for (const [y, t] of [[0.75, 0.04], [1.40, 0.04], [2.22, 0.04], [2.88, 0.06]]) {
      put(B, s, BOX(4.2, t, 0.62), 0, y, zc, { color: tone(PAL.shelf, 0.1) });
      put(B, s, BOX(4.2, t + 0.03, 0.025), 0, y, 0.69, { color: PAL.shelfDark });
    }
    put(B, s, BOX(5.4, 0.07, 0.74), 0, 2.945, 0.37, { color: C.woodDeep });
    // 挂衣杆
    rod(B, s, [-2.1, 2.1, CAB_LZ], [2.1, 2.1, CAB_LZ], 0.022, 0.022, 6, { color: 0xd7b98a });
    for (const sx of [-1, 1]) put(B, s, BOX(0.06, 0.1, 0.1), sx * 2.07, 2.1, CAB_LZ, { color: C.woodDeep });
    // 右立柱上的小木钉（装饰）
    for (const y of [0.42, 1.07, 1.81, 2.54]) {
      rod(B, s, [2.35, y, 0.68], [2.35, y, 0.78], 0.025, 0.04, 6, { color: C.woodDeep });
    }
    // 左立柱上的小木牌（用图形示意：帽子 / 衣架 / 蝴蝶结 / 鞋子）
    for (const r of ROWS) {
      const px = -2.35, py = r.ctr, pz = 0.68;
      put(B, s, BOX(0.36, 0.36, 0.025), px, py, pz + 0.0125, { color: 0xd9c18f, ao: false });
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(B, s, BOX(0.025, 0.025, 0.012), px + dx * 0.15, py + dy * 0.15, pz + 0.03, { color: C.woodDeep });
      const ic = 0x7a4a2a, z0 = pz + 0.032;
      const ip = (pts, dx = 0, dy = 0, col = ic) => put(B, s, poly(pts), px + dx, py + dy, z0, { color: col });
      if (r.zone === 'hat') { // 礼帽
        ip([[-0.06, -0.03], [0.06, -0.03], [0.055, 0.07], [-0.055, 0.07]], 0, 0.01);
        ip([[-0.12, -0.07], [0.12, -0.07], [0.1, -0.03], [-0.1, -0.03]], 0, 0.01);
        ip([[-0.06, -0.02], [0.06, -0.02], [0.06, 0.012], [-0.06, 0.012]], 0, 0.01, C.rust);
      } else if (r.zone === 'top') { // 衣架
        ip([[-0.012, 0.1], [0.012, 0.1], [0.012, 0.05], [-0.012, 0.05]]);
        ip([[-0.014, 0.06], [0.014, 0.05], [0.13, -0.04], [0.11, -0.06]]);
        ip([[0.014, 0.06], [-0.014, 0.05], [-0.13, -0.04], [-0.11, -0.06]]);
        ip([[-0.13, -0.04], [0.13, -0.04], [0.13, -0.065], [-0.13, -0.065]]);
      } else if (r.zone === 'acc') { // 蝴蝶结
        ip([[0, 0], [0.12, 0.08], [0.12, -0.08]], 0.0, 0, C.rust);
        ip([[0, 0], [-0.12, 0.08], [-0.12, -0.08]], 0.0, 0, C.rust);
        ip([[-0.03, -0.035], [0.03, -0.035], [0.03, 0.035], [-0.03, 0.035]], 0, 0, 0x4a2a14);
      } else { // 鞋子
        ip([[-0.12, -0.06], [0.12, -0.06], [0.12, -0.03], [-0.12, -0.03]], 0, -0.02, 0x4a2a14);
        ip([[-0.12, -0.03], [-0.02, -0.03], [-0.02, 0.09], [-0.12, 0.09]], 0, -0.02);
        ip([[-0.02, -0.03], [0.12, -0.03], [0.1, 0.02], [-0.02, 0.05]], 0, -0.02);
      }
    }
    // 墙上点缀
    painting('north', -3.55, 1.9, 0.8, 1.0, 0xa8c8d8, 0x6a8a52, 0xf2d27a);
    painting('north', 3.55, 1.9, 0.8, 1.0, 0xe8c8b0, 0x8a6a52, 0xf2e8d0);
    // 左上角（西北角）的帽盒堆 + 右上角（东北角）的大木箱
    hatboxW(B, -3.85, 0, -2.85, 0.34, 0.3, 0xd7b98a, C.rust);
    hatboxW(B, -3.85, 0.4, -2.85, 0.26, 0.22, C.cream, C.rugTeal);
    hatboxW(B, -3.2, 0, -3.0, 0.26, 0.24, C.rugTeal, C.cream);
    crateW(B, 3.85, -2.85, 0.9, 0.5, 0.55, -0.1, C.woodGrey);
  }

  // ======================= west：镜子区 =======================
  const mirrorCenterY = 1.1;
  {
    const s = 'west', B = bd.west;
    // 木框：左右立柱 + 上下横木 + 顶部的小冠 + 底座
    for (const sx of [-1, 1]) put(B, s, BOX(0.12, 2.14, 0.1), sx * 0.56, mirrorCenterY, 0.07, { color: tone(PAL.shelf, 0.14), ao: true });
    put(B, s, BOX(1.24, 0.12, 0.1), 0, 2.11, 0.07, { color: PAL.shelfDark });
    put(B, s, BOX(1.24, 0.12, 0.1), 0, 0.09, 0.07, { color: PAL.shelfDark });
    put(B, s, BOX(0.6, 0.1, 0.1), 0, 2.22, 0.07, { color: PAL.post });
    put(B, s, new THREE.IcosahedronGeometry(0.07, 1), 0, 2.32, 0.07, { color: C.woodDeep });
    for (const sx of [-1, 1]) put(B, s, BOX(0.18, 0.06, 0.34), sx * 0.56, 0.03, 0.18, { color: C.woodDeep });
    // 挂画 + 挂钩
    painting('west', -2.45, 1.9, 0.8, 1.0, 0xe0d0a8, 0x7a8a52, 0xd9572e);
    painting('west', 2.45, 1.9, 0.8, 1.0, 0xa8b8d8, 0x5a7a62, 0xf2e8d0);
    hookRow('west', -3.1, 3, 0.35, 1.75);
    // 矮凳（镜子旁）
    stoolW(B, -3.5, 1.7, 0.46, 0.26);
    // 西南角的小储物箱
    crateW(B, -4.0, 2.75, 0.7, 0.4, 0.45, 0.2, C.woodWarm);
  }
  const MIR = { x: -3.15, z: 0 }; // 小狗照镜子站的位置
  // 镜前地垫：长椭圆，上面两对脚印提示“站这儿”
  {
    const ell = (sx, sz, y, col) => sG.add(new THREE.CylinderGeometry(1, 1, 0.03, 28), { pos: [MIR.x, y - 0.015, MIR.z], scale: [sx, 1, sz], color: col, ao: false, jitter: 0.05 });
    ell(0.98, 0.62, 0.012, PAL.rugRed); ell(0.9, 0.54, 0.014, PAL.rugCream); ell(0.74, 0.4, 0.016, PAL.rugTeal);
    const paw = (x, z) => {
      sG.add(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 8), { pos: [x, 0.021, z], scale: [1, 1, 1.15], color: 0xe8dcc0, ao: false, jitter: 0 });
      for (let i = 0; i < 3; i++) sG.add(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 6), { pos: [x - 0.1, 0.021, z + (i - 1) * 0.07], color: 0xe8dcc0, ao: false, jitter: 0 });
    };
    paw(MIR.x - 0.38, MIR.z - 0.13); paw(MIR.x - 0.38, MIR.z + 0.13); paw(MIR.x + 0.32, MIR.z - 0.13); paw(MIR.x + 0.32, MIR.z + 0.13);
  }

  // ======================= east：拍照区 =======================
  const PH = { x: 3.3, z: 0 };
  {
    const s = 'east', B = bd.east;
    // 背景板的木框 + 上端的卷轴 + 两侧支脚
    const BZ = 0.14;
    put(B, s, BOX(3.5, 0.1, 0.06), 0, 0.07, BZ, { color: PAL.shelfDark });
    for (const sx of [-1, 1]) {
      put(B, s, BOX(0.06, 2.74, 0.1), sx * 1.7, 1.4, BZ, { color: PAL.shelf, ao: true });
      put(B, s, BOX(0.12, 0.06, 0.5), sx * 1.7, 0.03, BZ + 0.2, { color: C.woodDeep });
      rod(B, s, [sx * 1.7, 2.2, BZ + 0.03], [sx * 1.7, 0.1, BZ + 0.32], 0.025, 0.025, 5, { color: C.woodGreyDark });
    }
    rod(B, s, [-1.78, 2.75, BZ + 0.02], [1.78, 2.75, BZ + 0.02], 0.045, 0.045, 8, { color: 0x7a5a3c });
    for (const sx of [-1, 1]) put(B, s, new THREE.IcosahedronGeometry(0.07, 1), sx * 1.8, 2.75, BZ + 0.02, { color: C.woodDeep });
    // 圆台：顶面 y = 0.08（站位在这里）
    B.add(new THREE.CylinderGeometry(0.95, 0.98, 0.1, 28), { pos: [PH.x, 0.03, PH.z], color: tone(PAL.shelf, 0.1), ao: false });
    B.add(new THREE.CylinderGeometry(0.84, 0.84, 0.01, 28), { pos: [PH.x, 0.0765, PH.z], color: 0xb89c68, ao: false, jitter: 0.04 });
    B.add(new THREE.CylinderGeometry(0.97, 0.97, 0.025, 28), { pos: [PH.x, 0.0, PH.z], color: C.woodDeep, ao: false });
    // 两侧的柔光灯（三脚架 + 柔光箱，灯面用发光材质，布景）
    for (const sz of [-1, 1]) {
      const bx = 3.75, bz = sz * 1.95, yaw = Math.atan2(PH.x - bx, PH.z - bz);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * PI * 2 + 0.6;
        cylBetween(B, [bx, 1.3, bz], [bx + Math.cos(a) * 0.34, 0, bz + Math.sin(a) * 0.34], 0.022, 0.016, 5, { color: C.woodGreyDark, ao: false });
      }
      cylBetween(B, [bx, 1.2, bz], [bx, 1.7, bz], 0.03, 0.026, 6, { color: C.woodDeep, ao: false });
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      B.add(BOX(0.6, 0.6, 0.16), { pos: [bx, 1.8, bz], rot: [0, yaw, 0], color: C.woodDeep, ao: false });
      gE.add(BOX(0.5, 0.5, 0.03), { pos: [bx + fx * 0.09, 1.8, bz + fz * 0.09], rot: [0, yaw, 0] });
    }
    painting('east', -2.75, 1.9, 0.62, 0.8, 0xe8c8d8, 0x8a7a62, 0xf2e8d0);
    painting('east', 2.75, 1.9, 0.62, 0.8, 0xb8d8c8, 0x6a8a52, 0xf2d27a);
    crateW(B, 3.7, 2.75, 0.8, 0.45, 0.5, -0.15, C.woodGrey);
    hatboxW(B, 3.7, 0.45, 2.75, 0.2, 0.2, C.cream, C.rust);
  }

  // ======================= south：进门的墙（小木门是布景） =======================
  {
    const s = 'south', B = bd.south;
    for (const sx of [-1, 1]) put(B, s, BOX(0.1, 2.08, 0.12), sx * 0.52, 1.04, 0.06, { color: PAL.shelfDark, ao: true });
    put(B, s, BOX(1.24, 0.1, 0.12), 0, 2.09, 0.06, { color: PAL.shelfDark });
    put(B, s, BOX(1.1, 0.04, 0.22), 0, 0.02, 0.11, { color: C.woodDeep });
    const planks = [0xa65f2c, 0x9a5a2c, 0xb06a34, 0x9a5a2c, 0xa65f2c];
    planks.forEach((c, i) => put(B, s, BOX(0.185, 1.96, 0.04), -0.38 + i * 0.19, 1.02, 0.035, { color: tone(c, 0.12), ao: true }));
    for (const y of [0.42, 1.62]) put(B, s, BOX(0.96, 0.1, 0.03), 0, y, 0.065, { color: 0x6a4e34 });
    rod(B, s, [-0.42, 0.45, 0.075], [0.42, 1.6, 0.075], 0.03, 0.03, 4, { color: 0x6a4e34 });
    put(B, s, new THREE.IcosahedronGeometry(0.05, 1), 0.3, 1.0, 0.1, { color: 0xc9a85a });
    // 门楣上的小木牌 + 小房子图案
    put(B, s, BOX(0.5, 0.24, 0.03), 0, 2.4, 0.03, { color: 0xd9c18f });
    put(B, s, poly([[-0.09, -0.06], [0.09, -0.06], [0.09, 0.03], [-0.09, 0.03]]), 0, 2.38, 0.05, { color: 0x7a4a2a });
    put(B, s, poly([[-0.12, 0.03], [0.12, 0.03], [0, 0.11]]), 0, 2.38, 0.052, { color: C.rust });
    // 门前小地垫
    put(B, s, BOX(0.9, 0.02, 0.5), 0, 0.01, 0.5, { color: C.rugTeal, jitter: 0.1 });
    put(B, s, BOX(0.8, 0.022, 0.4), 0, 0.011, 0.5, { color: C.cream, jitter: 0.1 });
    // 右侧挂钩 + 西南角（世界）立式衣帽架
    hookRow('south', -3.4, 4, 0.4, 1.75);
    const cx = -3.95, cz = 2.85;
    B.add(new THREE.CylinderGeometry(0.22, 0.24, 0.06, 10), { pos: [cx, 0.03, cz], color: C.woodGreyDark, ao: false });
    cylBetween(B, [cx, 0.05, cz], [cx, 1.75, cz], 0.035, 0.028, 6, { color: C.woodWarm, ao: false });
    for (let i = 0; i < 4; i++) {
      const a = i * PI / 2 + 0.4;
      cylBetween(B, [cx, 1.62, cz], [cx + Math.cos(a) * 0.24, 1.78, cz + Math.sin(a) * 0.24], 0.018, 0.016, 4, { color: C.woodDeep, ao: false });
    }
    B.add(new THREE.IcosahedronGeometry(0.06, 1), { pos: [cx, 1.8, cz], color: C.woodDeep, ao: false });
  }

  // ---------- 合并网格 ----------
  const geos = [];
  const mkMesh = (builder, mat, cast = true, recv = true) => {
    const g = builder.build(); geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast; m.receiveShadow = recv;
    return m;
  };
  const meshG = mkMesh(bG, matWood), meshS = mkMesh(sG, matSmooth, false, true), meshGlow = mkMesh(gG, matGlow, false, false);
  scene.add(meshG, meshS, meshGlow);

  const wallGroups = {};
  for (const side of ['north', 'south', 'west', 'east']) {
    const g = new THREE.Group(); g.name = 'wall-' + side;
    g.add(mkMesh(bd[side], matWood));
    wallGroups[side] = g; scene.add(g);
  }
  wallGroups.east.add(mkMesh(gE, matSoft, false, false));

  // 镜子：Reflector（真的能照出小狗）。color 的线性值 0.5 = 叠加混合的恒等
  const mirrorGeo = new THREE.PlaneGeometry(1.0, 1.9);
  const mirrorMesh = new Reflector(mirrorGeo, { textureWidth: 512, textureHeight: 512, color: new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.LinearSRGBColorSpace), clipBias: 0.003 });
  mirrorMesh.name = 'mirror';
  { const p = FR.west.p(0, mirrorCenterY, 0.07); mirrorMesh.position.set(p[0], p[1], p[2]); mirrorMesh.rotation.y = FR.west.ry; }
  wallGroups.west.add(mirrorMesh);

  // 背景板：一块平面 + 6 张程序绘制的贴图（切换 = 换 map，瞬时）
  const backdropTex = BACKDROPS.map((b) => {
    const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
    drawBackdrop(b.id, cv.getContext('2d'));
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  });
  const backMat = new THREE.MeshStandardMaterial({ map: backdropTex[0], emissiveMap: backdropTex[0], emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 1, metalness: 0 });
  const backGeo = new THREE.PlaneGeometry(3.3, 2.6);
  const backMesh = new THREE.Mesh(backGeo, backMat);
  backMesh.name = 'backdrop'; backMesh.receiveShadow = true;
  { const p = FR.east.p(0, 1.4, 0.115); backMesh.position.set(p[0], p[1], p[2]); backMesh.rotation.y = FR.east.ry; }
  wallGroups.east.add(backMesh);
  let bdIndex = 0;

  // ---------- 站位 ----------
  const dogSpot = new THREE.Object3D();
  dogSpot.name = 'dogSpot';
  dogSpot.position.set(0, 0, 1.0);
  dogSpot.rotation.y = PI; // 本地 +Z 朝北（面朝橱柜）
  scene.add(dogSpot);

  // ---------- 灯光：暖色；整间都看得清，三个区略亮；只有一盏投射阴影 ----------
  scene.add(new THREE.HemisphereLight(0xffe2bc, 0x5a4030, 0.3));
  // 狗毛的亮度取自“第一盏平行光”的颜色×强度（rig.js furMat）：这盏必须是第一盏平行光、偏白、强度不低于 4.2；不要再加第二盏平行光
  const fill = new THREE.DirectionalLight(0xffffff, 4.2);
  fill.position.set(-1.0, 5.5, 3.0);
  fill.target.position.set(0, 0.6, 0);
  scene.add(fill, fill.target);
  // 唯一投影的灯：房间正上方的宽角聚光，阴影贴图覆盖整个地面
  const key = new THREE.SpotLight(0xffe8cc, 10, 0, 0.8, 1.0, 0);
  key.position.set(0.4, 7.2, 1.2);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 3;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  // 灯泡串的暖光（微微闪）+ 各区的补光
  const bulbLight = new THREE.PointLight(0xffa850, 9.0, 12, 1.6);
  bulbLight.position.set(0, 2.5, 0.0);
  const zoneN = new THREE.PointLight(0xffd9a0, 4.0, 9, 1.6); zoneN.position.set(0, 2.4, -1.0);
  const zoneW = new THREE.PointLight(0xffe0b0, 8.0, 9, 1.6); zoneW.position.set(-3.0, 2.6, 0.2);
  const zoneE = new THREE.PointLight(0xfff0d8, 8.0, 9, 1.6); zoneE.position.set(2.6, 2.6, 0.0);
  const zoneS = new THREE.PointLight(0xffd0a0, 7.0, 9, 1.6); zoneS.position.set(0, 2.4, 1.8);
  scene.add(bulbLight, zoneN, zoneW, zoneE, zoneS);

  // ---------- 相机：默认从 south 方向斜上方看向房间中心（调用方接管前的机位） ----------
  const camera = new THREE.PerspectiveCamera(40, 1.4, 0.1, 60);
  camera.position.set(0, 9.0, 10.0);
  camera.lookAt(0, 0.9, 0);
  camera.updateMatrixWorld(true);
  function resize(w, h) {
    camera.aspect = Math.max(0.2, w) / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  // ---------- 接口数据 ----------
  const obstacles = [];
  for (let i = 0; i < 7; i++) obstacles.push({ x: -2.4 + i * 0.8, z: -2.95, r: 0.6 }); // 橱柜
  obstacles.push({ x: -4.25, z: -0.4, r: 0.5 }, { x: -4.25, z: 0.4, r: 0.5 }); // 镜子
  obstacles.push({ x: 3.75, z: -1.95, r: 0.42 }, { x: 3.75, z: 1.95, r: 0.42 }); // 柔光灯架
  obstacles.push({ x: -3.5, z: 1.7, r: 0.35 }); // 矮凳
  obstacles.push({ x: -4.0, z: 2.75, r: 0.5 }); // 西南角小箱子
  obstacles.push({ x: -3.95, z: 2.85 - 0.0, r: 0.3 }); // 衣帽架（与小箱子相邻，合并覆盖）
  obstacles.push({ x: 3.7, z: 2.75, r: 0.55 }); // 东南角木箱
  obstacles.push({ x: -3.85, z: -2.85, r: 0.5 }); // 西北角帽盒堆
  obstacles.push({ x: 3.85, z: -2.85, r: 0.55 }); // 东北角木箱
  const walk = { x0: -HW + 0.45, x1: HW - 0.45, z0: -HD + 0.45, z1: HD - 0.45 };

  const cabinet = {
    wall: 'north',
    rows: ROWS.map((r) => ({ zone: r.zone, y: r.y, z: -HD + CAB_LZ, pitch: PITCH })),
    clip: { x0: -2.1, x1: 2.1 },
    visible: 4,
    slotX: (i) => (i - 1.5) * PITCH,
    viewSpot: new THREE.Vector3(0, 1.5, 2.5),
    lookAt: new THREE.Vector3(0, 1.5, -3.1),
  };
  const mirror = {
    standSpot: new THREE.Vector3(MIR.x, 0.014, MIR.z),
    facing: -PI / 2,
    viewSpot: new THREE.Vector3(0.5, 2.0, 1.8),
    lookAt: new THREE.Vector3(-3.7, 0.85, 0.0),
  };
  const photo = {
    standSpot: new THREE.Vector3(PH.x, 0.08, PH.z),
    facing: -PI / 2,
    viewSpot: new THREE.Vector3(-0.6, 1.1, 0),
    lookAt: new THREE.Vector3(4.3, 1.05, 0),
    backdrops: BACKDROPS.map((b) => ({ id: b.id, name: b.name })),
    setBackdrop(i) {
      const n = BACKDROPS.length;
      bdIndex = ((Math.round(i) % n) + n) % n;
      backMat.map = backdropTex[bdIndex]; backMat.emissiveMap = backdropTex[bdIndex];
    },
    get index() { return bdIndex; },
  };
  const door = { spot: new THREE.Vector3(0, 0, 2.7), facing: 0 };

  const walls = ['north', 'south', 'west', 'east'].map((name) => ({ name, normal: new THREE.Vector3(...WALL_NORMAL[name]), group: wallGroups[name] }));

  // ---------- 动效（不分配对象） ----------
  let t = 0;
  function update(dt) {
    if (!(dt > 0) || !isFinite(dt)) dt = 0;
    t += dt;
    const fl = 1 + Math.sin(t * 2.3) * 0.04 + Math.sin(t * 5.7 + 1.3) * 0.035 + Math.sin(t * 13.1) * 0.015;
    bulbLight.intensity = 9.0 * fl;
    matGlow.emissiveIntensity = 1.6 * fl;
  }

  function dispose() {
    for (const g of geos) g.dispose();
    mirrorGeo.dispose(); backGeo.dispose();
    mirrorMesh.dispose?.();
    for (const tx of backdropTex) tx.dispose();
    backMat.dispose();
    matWood.dispose(); matSmooth.dispose(); matGlow.dispose(); matSoft.dispose();
    key.shadow.map?.dispose();
  }

  return {
    scene, camera, size: { w: W, d: D, h: H }, dogSpot, obstacles, walk, walls,
    cabinet, mirror, photo, door, resize, update, dispose,
  };
}
