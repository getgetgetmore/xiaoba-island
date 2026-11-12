// 生成打包用的应用图标 build/icon.png（256×256 的小柴犬头像，纯代码绘制，无外部素材）。
// 用法：node scripts/make-icon.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
// 形状：圆 / 椭圆 / 三角（耳朵）。坐标范围 -1..1，y 向下。
const ORANGE = [226, 148, 62], ORANGE_D = [196, 118, 44], CREAM = [255, 240, 214], DARK = [52, 36, 26], PINK = [240, 196, 180], RED = [200, 68, 58], GOLD = [236, 190, 80];
const tri = (ax, ay, bx, by, cx, cy, col) => ({ tri: [ax, ay, bx, by, cx, cy], col });
const ell = (cx, cy, rx, ry, col) => ({ cx, cy, rx, ry, col });
const SHAPES = [
  // 耳朵（外）与内耳
  tri(-0.86, -0.3, -0.62, -0.98, -0.18, -0.58, ORANGE_D), tri(0.86, -0.3, 0.62, -0.98, 0.18, -0.58, ORANGE_D),
  tri(-0.72, -0.4, -0.6, -0.8, -0.36, -0.56, PINK), tri(0.72, -0.4, 0.6, -0.8, 0.36, -0.56, PINK),
  // 项圈（露在脸下方）
  ell(0, 0.86, 0.5, 0.12, RED), ell(0, 0.95, 0.07, 0.07, GOLD),
  // 脸
  ell(0, 0.08, 0.84, 0.76, ORANGE),
  // 脸颊与嘴套的奶白
  ell(-0.44, 0.38, 0.4, 0.36, CREAM), ell(0.44, 0.38, 0.4, 0.36, CREAM), ell(0, 0.42, 0.36, 0.34, CREAM),
  // 眉点
  ell(-0.3, -0.3, 0.1, 0.065, CREAM), ell(0.3, -0.3, 0.1, 0.065, CREAM),
  // 眼睛、鼻子、嘴
  ell(-0.32, -0.02, 0.085, 0.1, DARK), ell(0.32, -0.02, 0.085, 0.1, DARK),
  ell(0, 0.26, 0.11, 0.085, DARK),
  ell(-0.1, 0.46, 0.1, 0.05, DARK), ell(0.1, 0.46, 0.1, 0.05, DARK), ell(-0.1, 0.43, 0.1, 0.05, CREAM), ell(0.1, 0.43, 0.1, 0.05, CREAM),
];

function inside(s, x, y) {
  if (s.tri) {
    const [ax, ay, bx, by, cx, cy] = s.tri;
    const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
    const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
    const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }
  const nx = (x - s.cx) / s.rx, ny = (y - s.cy) / s.ry;
  return nx * nx + ny * ny <= 1;
}

const SS = 4; // 4×4 超采样抗锯齿
const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = ((px + (sx + 0.5) / SS) / SIZE) * 2 - 1, y = ((py + (sy + 0.5) / SS) / SIZE) * 2 - 1;
        let col = null;
        for (const s of SHAPES) if (inside(s, x * 1.06, y * 1.06)) col = s.col;
        if (col) { r += col[0]; g += col[1]; b += col[2]; a += 1; }
      }
    }
    const i = (py * SIZE + px) * 4;
    if (a > 0) { rgba[i] = Math.round(r / a); rgba[i + 1] = Math.round(g / a); rgba[i + 2] = Math.round(b / a); }
    rgba[i + 3] = Math.round((a / (SS * SS)) * 255);
  }
}

// ---- PNG 编码 ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0); return Buffer.concat([len, td, crc]); };
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) { raw[y * (SIZE * 4 + 1)] = 0; rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
const out = path.resolve(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('icon written:', out, png.length, 'bytes');
