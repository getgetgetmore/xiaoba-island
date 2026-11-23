// 衣帽间（完整房间版）：一间四面墙的旧木屋房间，小狗可以在里面走动，相机可以绕着房间转。
// 三个区：橱柜区（north 墙，空的陈列架）、镜子区（west 墙，真的能照出小狗的穿衣镜）、拍照区（east 墙，可换背景板）。
// south 墙是进门的那面（一扇回小屋的小门，布景）。没有天花板：留几根横梁和两串暖光小灯泡。
// 坐标：房间中心 = 原点，地面 y = 0；x 向东（east = +x），z 向南（south = +z，north = -z）。
// 舞台幕布：z = 2.35，横跨 x = -HW..HW（东西墙之间），单独一个 group（不属于任何墙）；setOpen(k)：1 = 收在两侧用金色绑带束起，0 = 拉上；上方檐幔在相机较高时淡出。
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
  const _col = new THREE.Color();
  for (const [zc, yEnd, sag] of [[-0.3, 3.12, 0.25], [1.6, 3.0, 0.28]]) {
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

  const RUG_Z = 0.6, RUG_S = 0.7; // 地垫缩小并南移，给换装站台和帘子让位
  // ---------- 圆形编织地垫（房间中央，顶面 y = 0） ----------
  {
    const rings = [[1.6, PAL.rugRed], [1.38, PAL.rugCream], [1.18, PAL.rugTeal], [0.96, PAL.rugGold], [0.74, PAL.rugRed], [0.5, PAL.rugCream], [0.26, PAL.rugTeal]];
    rings.forEach(([r, col], i) => sG.add(new THREE.CylinderGeometry(r, r, 0.07, 32), { pos: [0, i * 0.0015 - 0.035, RUG_Z], scale: [RUG_S, 1, RUG_S], color: col, ao: false, jitter: 0.06 }));
    const rope = new THREE.TorusGeometry(1.6, 0.04, 6, 48); rope.rotateX(PI / 2);
    sG.add(rope, { pos: [0, -0.005, RUG_Z], scale: [RUG_S, 1, RUG_S], color: 0xa98840, ao: false, jitter: 0.1 });
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

  // ======================= north：两个柜体（左 3 排 / 右 3 排） =======================
  // 左柜体：head 头上 / eyes 眼睛 / neck 脖子；右柜体：body 身上（挂衣杆）/ back 背上 / feet 脚上（鞋架）。
  // 每个柜体：宽 4.15（左端 0.45 的图标立柱 + 3.6 的内宽 + 0.1 右立柱），高 2.38，正面敞开。两柜体之间隔 0.3 的墙面。
  const PITCH = 0.95, CAB_LZ = 0.38, CAB_H = 2.38, INNER = 3.6;
  const SECS = [
    { id: 'left', zones: ['head', 'eyes', 'neck'], xl: -4.3 },
    { id: 'right', zones: ['body', 'back', 'feet'], xl: 0.15 },
  ];
  for (const sc of SECS) {
    sc.x0 = sc.xl + 0.45; sc.x1 = sc.x0 + INNER; sc.cx = (sc.x0 + sc.x1) / 2; sc.mid = sc.xl + 2.075;
  }
  // y = 陈列品底部；ctr = 木牌高度
  const ROWDEF = [
    { zone: 'head', section: 0, y: 1.44, ctr: 1.88 },
    { zone: 'eyes', section: 0, y: 0.78, ctr: 1.1 },
    { zone: 'neck', section: 0, y: 0.12, ctr: 0.43 },
    { zone: 'body', section: 1, y: 1.64, ctr: 1.83, rail: 2.22 },
    { zone: 'back', section: 1, y: 0.78, ctr: 1.1 },
    { zone: 'feet', section: 1, y: 0.12, ctr: 0.43 },
  ];
  {
    const s = 'north', B = bd.north, zc = 0.37;
    for (const sc of SECS) {
      const W4 = 0.45 + INNER + 0.1;
      put(B, s, BOX(W4, 0.08, 0.66), sc.xl + W4 / 2, 0.04, zc, { color: C.woodDeep });
      put(B, s, BOX(0.45, CAB_H - 0.08, 0.64), sc.xl + 0.225, 0.08 + (CAB_H - 0.08) / 2, 0.36, { color: tone(PAL.post, 0.12), ao: true });
      put(B, s, BOX(0.1, CAB_H - 0.08, 0.64), sc.x1 + 0.05, 0.08 + (CAB_H - 0.08) / 2, 0.36, { color: tone(PAL.post, 0.12), ao: true });
      for (let i = 0; i < 10; i++) put(B, s, BOX(0.355, CAB_H - 0.1, 0.03), sc.x0 + 0.18 + i * 0.36, 0.1 + (CAB_H - 0.1) / 2, 0.065, { color: tone(PAL.back, 0.2) });
      for (let i = 0; i < 9; i++) put(B, s, BOX(0.36, 0.04, 0.62), sc.x0 + 0.2 + i * 0.4, 0.10, zc, { color: tone(PAL.shelf, 0.14) });
      put(B, s, BOX(INNER, 0.04, 0.03), sc.cx, 0.14, 0.695, { color: PAL.shelfDark });
      // 隔板：下两层净空 0.62，顶排：右柜体挂衣杆（杆下净空 0.78），左柜体帽子（0.94）
      for (const [y, t] of [[0.76, 0.04], [1.42, 0.04], [CAB_H - 0.03, 0.06]]) {
        put(B, s, BOX(INNER, t, 0.62), sc.cx, y, zc, { color: tone(PAL.shelf, 0.1) });
        put(B, s, BOX(INNER, t + 0.03, 0.025), sc.cx, y, 0.69, { color: PAL.shelfDark });
      }
      put(B, s, BOX(W4 + 0.12, 0.07, 0.74), sc.xl + W4 / 2, CAB_H + 0.035, 0.37, { color: C.woodDeep });
    }
    // 右柜体的挂衣杆
    {
      const sc = SECS[1], ry = ROWDEF[3].rail;
      rod(B, s, [sc.x0, ry, CAB_LZ], [sc.x1, ry, CAB_LZ], 0.022, 0.022, 6, { color: 0xd7b98a });
      for (const x of [sc.x0 + 0.03, sc.x1 - 0.03]) put(B, s, BOX(0.06, 0.1, 0.1), x, ry, CAB_LZ, { color: C.woodDeep });
    }
    // 每排左端的图标木牌
    for (const r of ROWDEF) {
      const sc = SECS[r.section];
      const px = sc.xl + 0.225, py = r.ctr, pz = 0.68;
      put(B, s, BOX(0.34, 0.34, 0.025), px, py, pz + 0.0125, { color: 0xd9c18f, ao: false });
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(B, s, BOX(0.025, 0.025, 0.012), px + dx * 0.14, py + dy * 0.14, pz + 0.03, { color: C.woodDeep });
      const ic = 0x7a4a2a, z0 = pz + 0.032;
      const ip = (pts, dx = 0, dy = 0, col = ic) => put(B, s, poly(pts), px + dx, py + dy, z0, { color: col });
      const ring = (cx, cy, ro, ri) => {
        const n = 10, o = [], i2 = [];
        for (let k = 0; k < n; k++) { const a = k / n * PI * 2; o.push([cx + Math.cos(a) * ro, cy + Math.sin(a) * ro]); i2.push([cx + Math.cos(a) * ri, cy + Math.sin(a) * ri]); }
        ip(o); ip(i2, 0, 0, 0xd9c18f);
      };
      if (r.zone === 'head') { // 礼帽
        ip([[-0.06, -0.03], [0.06, -0.03], [0.055, 0.07], [-0.055, 0.07]], 0, 0.01);
        ip([[-0.12, -0.07], [0.12, -0.07], [0.1, -0.03], [-0.1, -0.03]], 0, 0.01);
        ip([[-0.06, -0.02], [0.06, -0.02], [0.06, 0.012], [-0.06, 0.012]], 0, 0.01, C.rust);
      } else if (r.zone === 'eyes') { // 眼镜
        ring(-0.07, 0, 0.06, 0.04); ring(0.07, 0, 0.06, 0.04);
        ip([[-0.015, 0.005], [0.015, 0.005], [0.015, 0.02], [-0.015, 0.02]]);
        ip([[-0.14, 0.02], [-0.12, 0.02], [-0.12, 0.04], [-0.14, 0.04]]);
      } else if (r.zone === 'neck') { // 围巾 / 领结
        ip([[0, 0], [0.12, 0.08], [0.12, -0.08]], 0, 0, C.rust);
        ip([[0, 0], [-0.12, 0.08], [-0.12, -0.08]], 0, 0, C.rust);
        ip([[-0.03, -0.035], [0.03, -0.035], [0.03, 0.035], [-0.03, 0.035]], 0, 0, 0x4a2a14);
      } else if (r.zone === 'body') { // 衣架
        ip([[-0.012, 0.1], [0.012, 0.1], [0.012, 0.05], [-0.012, 0.05]]);
        ip([[-0.014, 0.06], [0.014, 0.05], [0.13, -0.04], [0.11, -0.06]]);
        ip([[0.014, 0.06], [-0.014, 0.05], [-0.13, -0.04], [-0.11, -0.06]]);
        ip([[-0.13, -0.04], [0.13, -0.04], [0.13, -0.065], [-0.13, -0.065]]);
      } else if (r.zone === 'back') { // 小背包
        ip([[-0.08, -0.09], [0.08, -0.09], [0.08, 0.06], [-0.08, 0.06]]);
        ip([[-0.06, 0.06], [0.06, 0.06], [0.04, 0.1], [-0.04, 0.1]]);
        ip([[-0.065, -0.01], [0.065, -0.01], [0.065, 0.03], [-0.065, 0.03]], 0, 0, C.rust);
        ip([[-0.055, -0.08], [0.055, -0.08], [0.055, -0.05], [-0.055, -0.05]], 0, 0, 0x4a2a14);
      } else { // 鞋子
        ip([[-0.12, -0.06], [0.12, -0.06], [0.12, -0.03], [-0.12, -0.03]], 0, -0.02, 0x4a2a14);
        ip([[-0.12, -0.03], [-0.02, -0.03], [-0.02, 0.09], [-0.12, 0.09]], 0, -0.02);
        ip([[-0.02, -0.03], [0.12, -0.03], [0.1, 0.02], [-0.02, 0.05]], 0, -0.02);
      }
    }
  }


  // ======================= north 墙 group：换装站台（在两个柜体正前方居中） =======================
  const ST = { x: 0, z: -1.8, r: 0.8, top: 0.1 };
  const CURT = { z: 2.35, x0: -HW, x1: HW }; // 舞台幕布所在的线（东西两墙之间）
  {
    const B = bd.north;
    B.add(new THREE.CylinderGeometry(0.93, 0.95, 0.06, 28), { pos: [ST.x, 0.01, ST.z], color: C.woodDeep, ao: false });
    B.add(new THREE.CylinderGeometry(0.82, 0.84, 0.092, 28), { pos: [ST.x, 0.046, ST.z], color: 0x7a5a3c, ao: false });
    for (let i = 0; i < 8; i++) {
      B.add(new THREE.CylinderGeometry(0.79, 0.79, 0.016, 3, 1, false, i * PI / 4, PI / 4), { pos: [ST.x, 0.092, ST.z], color: tone(i % 2 ? 0xb08c60 : 0xa07c52, 0.12), ao: false });
    }
    const rim = new THREE.TorusGeometry(0.81, 0.028, 5, 36); rim.rotateX(PI / 2);
    B.add(rim, { pos: [ST.x, 0.085, ST.z], color: 0x4a3626, ao: false, jitter: 0.04 });
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
      const bx = 4.05, bz = sz * 1.95, yaw = Math.atan2(PH.x - bx, PH.z - bz);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * PI * 2 + 0.6;
        cylBetween(B, [bx, 1.3, bz], [bx + Math.cos(a) * 0.26, 0, bz + Math.sin(a) * 0.26], 0.022, 0.016, 5, { color: C.woodGreyDark, ao: false });
      }
      cylBetween(B, [bx, 1.2, bz], [bx, 1.7, bz], 0.03, 0.026, 6, { color: C.woodDeep, ao: false });
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      B.add(BOX(0.5, 0.5, 0.14), { pos: [bx, 1.8, bz], rot: [0, yaw, 0], color: C.woodDeep, ao: false });
      gE.add(BOX(0.42, 0.42, 0.03), { pos: [bx + fx * 0.09, 1.8, bz + fz * 0.09], rot: [0, yaw, 0] });
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

  // ---------- 舞台幕布：大幕（两片，会动）+ 檐幔（固定，俯视时淡出）+ 金色绑带和流苏 ----------
  // 单独一个 group 加到 scene（横跨东西两面墙，不跟任何一面墙消失）
  const curtainGroup = new THREE.Group(); curtainGroup.name = 'stage-curtain';
  scene.add(curtainGroup);
  // 幕布的颜色（用户定：米白，配金色的滚边、绑带和流苏）。lo 褶谷 / mid 中间 / hi 褶峰 / band 顶上的小横幅 / glow 自发光
  // 备选的圣诞绿：{ lo: 0x0e3b22, mid: 0x1b6a3a, hi: 0x3d9a5c, band: 0x175c33, glow: 0x061f0f }
  const CLOTH = { lo: 0x9c8452, mid: 0xe4d3a6, hi: 0xf6ecd0, band: 0xd4c08e, glow: 0x1c160c };
  const clothMix = (t, g) => { // t: 0 褶谷 → 1 褶峰；g: 整体明暗
    const c = _col;
    if (t < 0.5) c.setHex(mixHex(CLOTH.lo, CLOTH.mid, t * 2)); else c.setHex(mixHex(CLOTH.mid, CLOTH.hi, (t - 0.5) * 2));
    c.multiplyScalar(g);
    return c;
  };
  // ---- 两片大幕：每片 NC 列（沿宽度，从墙边往中间）× NR 行（从上到下） ----
  const NF = 10, NS = 6, NC = NF * NS + 1, NR = 13, CT = 3.1, CB = 0.04, WCL = HW + 0.04;
  const WOPEN = [];
  for (let r = 0; r < NR; r++) WOPEN.push(r <= 7 ? 0.3 + 0.9 * Math.pow(1 - r / 7, 1.5) : 0.3 - 0.04 * (r - 7) / (NR - 8));
  const cN = 2 * NC * NR;
  const cPos = new Float32Array(cN * 3), cNor = new Float32Array(cN * 3), cCol = new Float32Array(cN * 3);
  const cIdx = new Uint16Array(2 * (NC - 1) * (NR - 1) * 6);
  const vid = (p, c, r) => (p * NC + c) * NR + r;
  for (let p = 0, t = 0; p < 2; p++) {
    for (let c = 0; c < NC; c++) {
      const u = c / (NC - 1), s = Math.sin(u * NF * PI * 2 + p * 1.3);
      for (let r = 0; r < NR; r++) {
        const o = vid(p, c, r) * 3, col = clothMix(0.5 + 0.5 * s, 1 - 0.16 * (r / (NR - 1)));
        cCol[o] = col.r; cCol[o + 1] = col.g; cCol[o + 2] = col.b;
        if (c < NC - 1 && r < NR - 1) {
          const A = vid(p, c, r), B = vid(p, c + 1, r), Cc = vid(p, c, r + 1), Dd = vid(p, c + 1, r + 1);
          if (p === 0) { cIdx[t++] = A; cIdx[t++] = Cc; cIdx[t++] = B; cIdx[t++] = B; cIdx[t++] = Cc; cIdx[t++] = Dd; }
          else { cIdx[t++] = A; cIdx[t++] = B; cIdx[t++] = Cc; cIdx[t++] = B; cIdx[t++] = Dd; cIdx[t++] = Cc; }
        }
      }
    }
  }
  const panelGeo = new THREE.BufferGeometry();
  panelGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
  panelGeo.setAttribute('normal', new THREE.BufferAttribute(cNor, 3));
  panelGeo.setAttribute('color', new THREE.BufferAttribute(cCol, 3));
  panelGeo.setIndex(new THREE.BufferAttribute(cIdx, 1));
  const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 0, emissive: CLOTH.glow });
  const panelMesh = new THREE.Mesh(panelGeo, clothMat);
  panelMesh.name = 'curtain-panels'; panelMesh.castShadow = true; panelMesh.receiveShadow = false; panelMesh.frustumCulled = false;
  curtainGroup.add(panelMesh);
  let curtainK = -1;
  let tieMesh = null;
  function setOpen(k) {
    k = k > 1 ? 1 : k < 0 ? 0 : (k === k ? k : 1);
    if (k === curtainK) return; // 没变：直接返回
    curtainK = k;
    const ampMax = 0.03 + 0.025 * k;
    for (let p = 0; p < 2; p++) {
      const sgn = p === 0 ? -1 : 1;
      for (let r = 0; r < NR; r++) {
        const v = r / (NR - 1), wo = WOPEN[r], W = wo + (WCL - wo) * (1 - k);
        const amp = Math.min(ampMax, 0.4 * W / NF), yb = CT - v * (CT - CB), lift = 0.2 * k * v * v * v * v;
        for (let c = 0; c < NC; c++) {
          const u = c / (NC - 1), o = vid(p, c, r) * 3;
          cPos[o] = sgn * HW - sgn * u * W;
          cPos[o + 1] = yb + lift * u * u;
          cPos[o + 2] = CURT.z + amp * Math.sin(u * NF * PI * 2 + p * 1.3) + p * 0.012;
        }
      }
      for (let r = 0; r < NR; r++) {
        const r0 = r > 0 ? r - 1 : r, r1 = r < NR - 1 ? r + 1 : r;
        for (let c = 0; c < NC; c++) {
          const c0 = c > 0 ? c - 1 : c, c1 = c < NC - 1 ? c + 1 : c;
          const a = vid(p, c0, r) * 3, b = vid(p, c1, r) * 3, d = vid(p, c, r0) * 3, e = vid(p, c, r1) * 3;
          const ux = cPos[b] - cPos[a], uy = cPos[b + 1] - cPos[a + 1], uz = cPos[b + 2] - cPos[a + 2];
          const vx = cPos[e] - cPos[d], vy = cPos[e + 1] - cPos[d + 1], vz = cPos[e + 2] - cPos[d + 2];
          let nx, ny, nz;
          if (p === 0) { nx = vy * uz - vz * uy; ny = vz * ux - vx * uz; nz = vx * uy - vy * ux; }
          else { nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx; }
          const nl = Math.hypot(nx, ny, nz) || 1, o = vid(p, c, r) * 3;
          cNor[o] = nx / nl; cNor[o + 1] = ny / nl; cNor[o + 2] = nz / nl;
        }
      }
    }
    panelGeo.attributes.position.needsUpdate = true;
    panelGeo.attributes.normal.needsUpdate = true;
    if (tieMesh) tieMesh.visible = k >= 0.97; // 幕拉开的过程中，绑带和流苏不显示
  }
  // ---- 金色绑带 + 流苏（固定在两侧墙边 y≈1.3） ----
  const tieB = new GeoBuilder({ seed: 77, jitter: 0.04, aoK: 0 });
  const GOLD = 0xe2a822, GOLD2 = 0xc48a14;
  for (const sd of [-1, 1]) {
    const cx = sd * (HW - 0.15), ty = 1.31, tz = CURT.z;
    tieB.add(BOX(0.4, 0.1, 0.24), { pos: [cx, ty, tz], color: GOLD2, ao: false });
    tieB.add(BOX(0.42, 0.03, 0.26), { pos: [cx, ty + 0.045, tz], color: GOLD, ao: false });
    const kx = cx - sd * 0.2, kz = tz + 0.13;
    tieB.add(new THREE.IcosahedronGeometry(0.075, 1), { pos: [kx, ty, kz], color: GOLD, ao: false });
    tieB.add(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 10), { pos: [kx, ty, kz - 0.04], rot: [PI / 2, 0, 0], color: GOLD2, ao: false });
    cylBetween(tieB, [kx, ty - 0.05, kz], [kx, ty - 0.3, kz], 0.014, 0.014, 5, { color: GOLD, ao: false, jitter: 0 });
    tieB.add(new THREE.IcosahedronGeometry(0.045, 1), { pos: [kx, ty - 0.33, kz], color: GOLD, ao: false });
    tieB.add(new THREE.CylinderGeometry(0.035, 0.085, 0.3, 10), { pos: [kx, ty - 0.5, kz], color: GOLD2, ao: false });
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * PI * 2;
      cylBetween(tieB, [kx + Math.cos(a) * 0.075, ty - 0.62, kz + Math.sin(a) * 0.075], [kx + Math.cos(a) * 0.09, ty - 0.82, kz + Math.sin(a) * 0.09], 0.01, 0.006, 3, { color: GOLD, ao: false, jitter: 0 });
    }
  }
  const tieGeo = tieB.build(); geos.push(tieGeo);
  const tieMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, emissive: 0x3a2808 });
  tieMesh = new THREE.Mesh(tieGeo, tieMat);
  tieMesh.name = 'curtain-ties'; tieMesh.castShadow = true;
  curtainGroup.add(tieMesh);
  // ---- 檐幔：5 个下垂的波浪布兜 + 交接处的小垂片 + 顶上平直的小横幅（固定，z 在大幕南侧） ----
  const VZ = CURT.z + 0.08, VTOP = 3.15;
  const vP = [], vN = [], vC = [], vI = [];
  const pushV = (x, y, z, nx, ny, nz, col) => { vP.push(x, y, z); vN.push(nx, ny, nz); vC.push(col.r, col.g, col.b); return vP.length / 3 - 1; };
  const quad = (xa, xb, ya, yb, z, hex) => { // 朝 +z 的平直条
    _col.setHex(hex);
    const A = pushV(xa, yb, z, 0, 0, 1, _col), B = pushV(xb, yb, z, 0, 0, 1, _col), Cc = pushV(xa, ya, z, 0, 0, 1, _col), Dd = pushV(xb, ya, z, 0, 0, 1, _col);
    vI.push(A, Cc, B, B, Cc, Dd);
  };
  {
    const NA = 25, NB = 6, SW = 1.8, FW = 6;
    for (let j = 0; j < 5; j++) {
      const x0 = -HW + SW * j + SW / 2, base = vP.length / 3, pts = [];
      for (let b = 0; b <= NB; b++) for (let a = 0; a <= NA; a++) {
        const aa = a / NA, bb = b / NB, D = 0.6 * Math.pow(Math.sin(PI * aa), 0.9);
        const ph = aa * FW * PI * 2;
        pts.push(x0 + (aa - 0.5) * 1.92 * (1 - 0.22 * bb), VTOP - bb * D,
          VZ + (j % 2) * 0.025 + (0.03 + 0.03 * bb) * Math.sin(ph) * Math.sin(PI * aa) + 0.09 * Math.sin(PI * aa) * bb, ph);
      }
      const at = (a, b) => (b * (NA + 1) + a) * 4;
      for (let b = 0; b <= NB; b++) for (let a = 0; a <= NA; a++) {
        const a0 = Math.max(a - 1, 0), a1 = Math.min(a + 1, NA), b0 = Math.max(b - 1, 0), b1 = Math.min(b + 1, NB);
        const P = at(a0, b), Q = at(a1, b), R = at(a, b0), S = at(a, b1);
        const ux = pts[Q] - pts[P], uy = pts[Q + 1] - pts[P + 1], uz = pts[Q + 2] - pts[P + 2];
        const vx = pts[S] - pts[R], vy = pts[S + 1] - pts[R + 1], vz = pts[S + 2] - pts[R + 2];
        const nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const o = at(a, b), col = clothMix(0.5 + 0.5 * Math.sin(pts[o + 3]), 1 - 0.12 * (b / NB));
        pushV(pts[o], pts[o + 1], pts[o + 2], nx / nl, ny / nl, nz / nl, col);
      }
      for (let b = 0; b < NB; b++) for (let a = 0; a < NA; a++) {
        const A = base + b * (NA + 1) + a, B = A + 1, Cc = A + NA + 1, Dd = Cc + 1;
        vI.push(A, Cc, B, B, Cc, Dd);
      }
    }
    // 交接处的小垂片（约 0.5 长，收尖）
    for (let j = 1; j < 5; j++) {
      const x = -HW + SW * j, z = VZ + 0.07, c0 = clothMix(0.4, 1), r0 = c0.r, g0 = c0.g, b0 = c0.b, c1 = clothMix(0.8, 0.95);
      const TL = pushV(x - 0.13, 3.02, z, 0, 0, 1, { r: r0, g: g0, b: b0 });
      const TC = pushV(x, 3.02, z + 0.04, 0, 0.2, 1, c1);
      const TR = pushV(x + 0.13, 3.02, z, 0, 0, 1, { r: r0, g: g0, b: b0 });
      const TP = pushV(x, 2.5, z + 0.01, 0, 0, 1, { r: r0, g: g0, b: b0 });
      vI.push(TL, TP, TC, TC, TP, TR);
    }
    // 顶上平直的小横幅（盖住上沿）+ 金色滚边
    quad(-HW - 0.02, HW + 0.02, 2.95, 3.22, VZ + 0.1, CLOTH.band);
    quad(-HW - 0.02, HW + 0.02, 2.93, 2.97, VZ + 0.105, 0xe2a822);
    quad(-HW - 0.02, HW + 0.02, 3.18, 3.22, VZ + 0.105, 0xe2a822);
  }
  const valGeo = new THREE.BufferGeometry();
  valGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vP), 3));
  valGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vN), 3));
  valGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vC), 3));
  valGeo.setIndex(new THREE.BufferAttribute(new Uint16Array(vI), 1));
  const valMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 0, emissive: CLOTH.glow });
  const valMesh = new THREE.Mesh(valGeo, valMat);
  valMesh.name = 'curtain-valance'; valMesh.castShadow = true; valMesh.receiveShadow = false;
  curtainGroup.add(valMesh);
  let valOp = 1;
  setOpen(1);

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
  dogSpot.position.set(0, 0, 2.8); // 帘子（z=1.55）以南 1.25
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
  for (let i = 0; i < 10; i++) obstacles.push({ x: -3.9 + i * 0.8667, z: -2.95, r: 0.6 }); // 两个柜体（含中间的空隙）
  obstacles.push({ x: -4.25, z: -0.4, r: 0.5 }, { x: -4.25, z: 0.4, r: 0.5 }); // 镜子
  obstacles.push({ x: -4.25, z: CURT.z, r: 0.28 }, { x: 4.25, z: CURT.z, r: 0.28 }); // 两侧束起的幕布
  obstacles.push({ x: 4.0, z: -1.95, r: 0.4 }, { x: 4.0, z: 1.95, r: 0.4 }); // 柔光灯架
  obstacles.push({ x: -3.5, z: 1.7, r: 0.35 }); // 矮凳
  obstacles.push({ x: -4.0, z: 2.75, r: 0.5 }); // 西南角小箱子
  obstacles.push({ x: -3.95, z: 2.85 - 0.0, r: 0.3 }); // 衣帽架（与小箱子相邻，合并覆盖）
  obstacles.push({ x: 3.7, z: 2.75, r: 0.55 }); // 东南角木箱
  const walk = { x0: -HW + 0.45, x1: HW - 0.45, z0: -HD + 0.45, z1: HD - 0.45 };

  const cabinet = {
    wall: 'north',
    visible: 4,
    sections: SECS.map((sc, k) => ({
      id: sc.id, zones: sc.zones,
      clip: { x0: sc.x0, x1: sc.x1 },
      slotX: (i) => sc.cx + (i - 1.5) * PITCH,
      viewSpot: new THREE.Vector3(sc.mid, 1.25, -3.1 + 4.5),
      lookAt: new THREE.Vector3(sc.mid, 1.2, -3.1),
      standSpot: new THREE.Vector3(k === 0 ? -3.95 : 3.95, 0, -1.2),
    })),
    rows: ROWDEF.map((r) => {
      const o = { zone: r.zone, section: r.section, y: r.y, z: -HD + CAB_LZ, pitch: PITCH };
      if (r.rail !== undefined) o.rail = r.rail;
      return o;
    }),
  };
  const dress = {
    standSpot: new THREE.Vector3(ST.x, ST.top, ST.z),
    radius: ST.r,
    browse: { y: 2.5, z: 1.3, lookY: 1.1, lookZ: -3.1, panMin: cabinet.sections[0].viewSpot.x, panMax: cabinet.sections[1].viewSpot.x },
    front: { viewSpot: new THREE.Vector3(0, 1.0, 1.3), lookAt: new THREE.Vector3(0, 0.85, ST.z) },
  };
  const curtain = { setOpen, get open() { return curtainK; }, z: CURT.z, x0: CURT.x0, x1: CURT.x1 };
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
    // 檐幔随相机高度淡出：y < 4.6 全显（默认的平视视角在这个范围里），4.6 → 5.8 渐隐，>= 5.8 隐藏——俯视时它会挡住站台和柜子（大幕和绑带一直显示）
    const cy = camera.position.y;
    const op = cy < 4.6 ? 1 : cy >= 5.8 ? 0 : 1 - (cy - 4.6) / 1.2;
    if (op !== valOp) { valOp = op; valMesh.visible = op > 0; valMat.opacity = op; valMat.transparent = op < 1; }
  }

  function dispose() {
    for (const g of geos) g.dispose();
    mirrorGeo.dispose(); backGeo.dispose(); panelGeo.dispose(); valGeo.dispose(); clothMat.dispose(); valMat.dispose(); tieMat.dispose();
    mirrorMesh.dispose?.();
    for (const tx of backdropTex) tx.dispose();
    backMat.dispose();
    matWood.dispose(); matSmooth.dispose(); matGlow.dispose(); matSoft.dispose();
    key.shadow.map?.dispose();
  }

  return {
    scene, camera, size: { w: W, d: D, h: H }, dogSpot, obstacles, walk, walls,
    cabinet, dress, curtain, mirror, photo, door, resize, update, dispose,
  };
}
