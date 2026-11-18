'use strict';
/*
 * 柴犬小岛 · Electron 桌宠外壳（WP6）
 *   npm run pet                                    先 vite build，再以桌宠模式启动
 *   npx electron . --capture=shots/wp6/pet.png     隐藏窗口截图后自动退出（验收用：不弹窗、不建托盘、不读写窗口状态）
 *       [--capture-delay=3000] [--query="hour=21&weather=clear"]
 * --query 原样透传为页面 URL 参数（见 src/core/params.js）。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, dialog } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'dist', 'index.html');
const PRELOAD = path.join(__dirname, 'preload.cjs');

const DEFAULT_W = 560;
const DEFAULT_H = 480;
const MARGIN = 24;
const MIN_W = 220;
const MIN_H = 200;
const SAVE_DELAY = 400;
const HOVER_INTERVAL = 120;
const CAPTURE_TIMEOUT = 60000;

// ------------------------------------------------------------------ 命令行参数
function readArg(name) {
  const hit = process.argv.find((a) => a === name || a.startsWith(name + '='));
  if (hit === undefined) return undefined;
  const i = hit.indexOf('=');
  return i < 0 ? '' : hit.slice(i + 1).replace(/^"(.*)"$/, '$1');
}
const captureArg = readArg('--capture');
const CAPTURE = captureArg !== undefined;
const CAPTURE_OUT = path.resolve(ROOT, captureArg || 'shots/wp6/pet.png');
const captureDelayArg = parseInt(readArg('--capture-delay') ?? '', 10);
const CAPTURE_DELAY = Number.isFinite(captureDelayArg) && captureDelayArg >= 0 ? captureDelayArg : 3000;
const QUERY = (readArg('--query') || '').replace(/^\?/, '');
// --selftest：以正常桌宠模式启动几秒，用合成的指针事件驱动缩放手柄，验证“手柄 → IPC → setBounds → 画面自适应”全链路后自动退出（验收用）
const SELFTEST = readArg('--selftest') !== undefined;
// --perf：以正常桌宠模式运行约半分钟，测量帧间隔、每帧模拟/渲染耗时、各进程 CPU 与内存，打印后自动退出
const PERF = readArg('--perf') !== undefined;
// 截图模式下隐藏窗口的 document.hidden 为真，需要 nopause=1 让主循环继续渲染（与 scripts/shot.cjs 一致）
const SEARCH = '?' + [QUERY, CAPTURE ? 'nopause=1' : ''].filter(Boolean).join('&');

// Chromium 开关（与 scripts/shot.cjs 本机已验证的组合一致）
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
if (CAPTURE) {
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  if (process.env.SHOT_SWIFTSHADER === '1') {
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  }
  // 截图进程使用独立 userData，避免与正在运行的桌宠争用同一配置目录
  app.setPath('userData', path.join(os.tmpdir(), 'shiba-pet-capture-' + process.pid));
}

// ------------------------------------------------------------------ 状态
let win = null;
let tray = null;
let pinned = true;
let saveTimer = null;
let hoverTimer = null;
let hoverInside = null;
let resizeStart = null;
let moveStart = null;
let ignoring = false; // 当前是否处于点穿状态
let sizeDIP = null; // 窗口应有的尺寸（只在创建、缩放、重置时更新；移动窗口时永远用它，避免高 DPI 下取整造成的尺寸漂移）

const log = (...args) => console.log('[pet]', ...args);

function displayArea(rect) {
  return screen.getDisplayMatching(rect).workArea;
}

function defaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(DEFAULT_W, wa.width);
  const height = Math.min(DEFAULT_H, wa.height);
  return { x: wa.x + wa.width - width - MARGIN, y: wa.y + wa.height - height - MARGIN, width, height };
}

/** 把矩形约束到工作区内：先夹尺寸（最小 / 最大为工作区），再夹位置 */
function fitToArea(b, wa) {
  const width = Math.min(Math.max(Math.round(b.width), MIN_W), wa.width);
  const height = Math.min(Math.max(Math.round(b.height), MIN_H), wa.height);
  const x = Math.min(Math.max(Math.round(b.x), wa.x), wa.x + wa.width - width);
  const y = Math.min(Math.max(Math.round(b.y), wa.y), wa.y + wa.height - height);
  return { x, y, width, height };
}

/** 矩形是否在某个显示器工作区内有足够可见面积（显示器拔掉后防止窗口“丢失”） */
function isOnScreen(b) {
  return screen.getAllDisplays().some(({ workArea: w }) => {
    const ix = Math.min(b.x + b.width, w.x + w.width) - Math.max(b.x, w.x);
    const iy = Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y);
    return ix >= Math.min(120, b.width) && iy >= Math.min(120, b.height);
  });
}

function restoreBounds(saved) {
  const s = saved && saved.bounds;
  if (!s || ![s.x, s.y, s.width, s.height].every(Number.isFinite)) return defaultBounds();
  if (!isOnScreen(s)) return defaultBounds();
  return fitToArea(s, displayArea(s));
}

// ------------------------------------------------------------------ 窗口状态持久化
function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch (_) {
    return null;
  }
}

function saveState() {
  if (CAPTURE || SELFTEST || !win || win.isDestroyed() || win.isMinimized()) return; // 自检会临时改窗口大小和位置：不写进用户的窗口状态
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    const gb = win.getBounds();
    const bounds = { x: gb.x, y: gb.y, width: sizeDIP ? sizeDIP.width : gb.width, height: sizeDIP ? sizeDIP.height : gb.height };
    fs.writeFileSync(stateFile(), JSON.stringify({ bounds, alwaysOnTop: pinned }, null, 2));
  } catch (e) {
    log('保存窗口状态失败：' + e.message);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveState();
  }, SAVE_DELAY);
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveState();
  }
}

// ------------------------------------------------------------------ 窗口操作
function setPinned(v) {
  pinned = !!v;
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(pinned);
  rebuildMenu();
  scheduleSave();
}

function resetBounds() {
  if (!win || win.isDestroyed()) return;
  const db = defaultBounds();
  sizeDIP = { width: db.width, height: db.height };
  win.setBounds(db);
  win.show();
  scheduleSave();
}

function createWindow(bounds) {
  sizeDIP = { width: bounds.width, height: bounds.height };
  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: pinned,
    skipTaskbar: true,
    resizable: false, // 缩放由 preload 手柄 + 主进程 setBounds 自行实现
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false,
    focusable: !CAPTURE,
    title: '柴犬小岛',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.on('move', scheduleSave);
  win.on('resize', scheduleSave);
  win.on('closed', () => {
    win = null;
  });
  if (CAPTURE) {
    win.webContents.on('console-message', (_e, level, message) => log(`[page:${level}] ${message}`));
  }
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log(`页面加载失败 ${code} ${desc} ${url}`);
  });
  return win;
}

function loadPage() {
  return win.loadFile(INDEX, { search: SEARCH });
}

// ------------------------------------------------------------------ 鼠标悬停探测
// 顶部拖动把手使用 -webkit-app-region: drag，区域内的指针事件不会送到页面，
// 所以“移入窗口才显示把手”改由主进程轮询光标位置，再通知页面切换 class。
function startHoverPoll() {
  hoverTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    if (inside !== hoverInside) {
      hoverInside = inside;
      win.webContents.send('shell:hover', inside);
    }
  }, HOVER_INTERVAL);
}

// ------------------------------------------------------------------ IPC（只接受本窗口的 webContents）
function registerIpc() {
  ipcMain.on('shell:config', (e) => {
    e.returnValue = { capture: CAPTURE, version: app.getVersion(), platform: process.platform };
  });
  ipcMain.on('shell:resize-start', (e) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    const b0 = win.getBounds();
    const b = { x: b0.x, y: b0.y, width: sizeDIP ? sizeDIP.width : b0.width, height: sizeDIP ? sizeDIP.height : b0.height };
    resizeStart = { bounds: b, wa: displayArea(b) };
  });
  ipcMain.on('shell:resize-move', (e, d) => {
    if (!win || win.isDestroyed() || !resizeStart || e.sender !== win.webContents || !d) return;
    const dx = Number(d.dx);
    const dy = Number(d.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const s = resizeStart.bounds;
    // 以 pointerdown 时的初始 bounds + 累计增量计算，左上角固定；越界时只夹尺寸/位置，不抖动
    const nb = fitToArea({ x: s.x, y: s.y, width: s.width + dx, height: s.height + dy }, resizeStart.wa);
    sizeDIP = { width: nb.width, height: nb.height };
    win.setBounds(nb, false);
  });
  // 左键拖动画面移动窗口：以按下时的 bounds + 鼠标累计位移计算（尺寸保持不变）
  // 点穿：光标在透明像素上时让鼠标事件穿过窗口（forward: true 仍把鼠标移动转发给页面）
  ipcMain.on('shell:ignore', (e, v) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    ignoring = !!v;
    win.setIgnoreMouseEvents(ignoring, { forward: true });
  });
  ipcMain.on('shell:move-start', (e) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    const b = win.getBounds();
    moveStart = { x: b.x, y: b.y, width: sizeDIP ? sizeDIP.width : b.width, height: sizeDIP ? sizeDIP.height : b.height };
  });
  ipcMain.on('shell:move', (e, d) => {
    if (!win || win.isDestroyed() || !moveStart || e.sender !== win.webContents || !d) return;
    const dx = Number(d.dx), dy = Number(d.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    win.setBounds({ x: Math.round(moveStart.x + dx), y: Math.round(moveStart.y + dy), width: moveStart.width, height: moveStart.height }, false);
  });
  ipcMain.on('shell:move-end', (e) => {
    if (!moveStart || e.sender !== (win && win.webContents)) return;
    moveStart = null;
    scheduleSave();
  });
  ipcMain.on('shell:resize-end', (e) => {
    if (!resizeStart || e.sender !== (win && win.webContents)) return;
    resizeStart = null;
    scheduleSave();
  });
}

// ------------------------------------------------------------------ 托盘图标（代码生成的 PNG）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 小狗头：橘色圆脸 + 两只耳朵 + 奶白口鼻 + 黑眼睛鼻子，带一像素抗锯齿
const ICON_SHAPES = [
  { cx: -0.55, cy: -0.55, r: 0.3, col: [226, 153, 63] },
  { cx: 0.55, cy: -0.55, r: 0.3, col: [226, 153, 63] },
  { cx: 0, cy: 0.05, r: 0.8, col: [226, 153, 63] },
  { cx: 0, cy: 0.38, rx: 0.42, ry: 0.3, col: [255, 236, 200] },
  { cx: -0.28, cy: -0.05, r: 0.1, col: [60, 40, 25] },
  { cx: 0.28, cy: -0.05, r: 0.1, col: [60, 40, 25] },
  { cx: 0, cy: 0.2, r: 0.11, col: [60, 40, 25] },
];

function makeIconPng(size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ux = ((x + 0.5) / size) * 2 - 1;
      const uy = ((y + 0.5) / size) * 2 - 1;
      let R = 0, G = 0, B = 0, A = 0;
      for (const s of ICON_SHAPES) {
        const rx = s.rx ?? s.r;
        const ry = s.ry ?? s.r;
        const d = (Math.hypot((ux - s.cx) / rx, (uy - s.cy) / ry) - 1) * Math.min(rx, ry); // 近似有符号距离（单位：归一化坐标）
        const cov = Math.min(1, Math.max(0, 0.5 - d * (size / 2)));
        if (cov <= 0) continue;
        const nA = cov + A * (1 - cov);
        R = (s.col[0] * cov + R * A * (1 - cov)) / nA;
        G = (s.col[1] * cov + G * A * (1 - cov)) / nA;
        B = (s.col[2] * cov + B * A * (1 - cov)) / nA;
        A = nA;
      }
      const i = (y * size + x) * 4;
      out[i] = Math.round(R);
      out[i + 1] = Math.round(G);
      out[i + 2] = Math.round(B);
      out[i + 3] = Math.round(A * 255);
    }
  }
  return encodePng(size, size, out);
}

function rebuildMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '置顶', type: 'checkbox', checked: pinned, click: (item) => setPinned(item.checked) },
      { label: '重置大小和位置', click: () => resetBounds() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]),
  );
}

function createTray() {
  const icon = nativeImage.createFromBuffer(makeIconPng(16));
  icon.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: makeIconPng(32) });
  tray = new Tray(icon);
  tray.setToolTip('柴犬小岛');
  rebuildMenu();
  tray.on('click', () => {
    if (win && !win.isDestroyed()) win.show();
  });
}

// ------------------------------------------------------------------ 两种运行模式
function startNormal() {
  if (!fs.existsSync(INDEX)) {
    dialog.showErrorBox('柴犬小岛', '找不到 dist/index.html，请先运行 npm run build（或直接使用 npm run pet）。');
    app.quit();
    return;
  }
  app.setAppUserModelId('com.shiba-island.pet');
  const saved = loadState();
  pinned = !saved || saved.alwaysOnTop !== false;
  createWindow(restoreBounds(saved));
  win.once('ready-to-show', () => win.show());
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  }, 2000);
  loadPage().catch((e) => log('加载页面失败：' + e.message));
  createTray();
  startHoverPoll();
  if (SELFTEST) runSelfTest();
  if (PERF) runPerf();
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
    }
  });
}

async function runPerf() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code);
  const out = { cores: os.cpus().length, cpu: os.cpus()[0].model, runs: [] };
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      let ok = false;
      try { ok = await js('!!(window.__pet && window.__pet.ready)'); } catch (_) { /* 尚未就绪 */ }
      if (ok) break;
      await sleep(150);
    }
    out.gpu = await js(`(() => { const gl = window.__pet.ctx.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`);
    out.dpr = await js("window.devicePixelRatio");
    const keep = win.getBounds();
    for (const [w, h] of [[560, 480], [1100, 720]]) {
      win.setBounds({ x: keep.x, y: keep.y, width: w, height: h });
      await sleep(2500);
      const run = { size: [w, h] };
      app.getAppMetrics(); // 重置 CPU 统计的起点
      const heap0 = await js("performance.memory ? performance.memory.usedJSHeapSize : 0");
      // 帧间隔：连续 480 帧
      run.frame = await js(`new Promise((res) => { const ts = []; function f(t) { ts.push(t); if (ts.length < 481) requestAnimationFrame(f); else { const d = []; for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]); d.sort((a, b) => a - b); const r2 = (v) => Math.round(v * 100) / 100; res({ fps: r2(1000 * d.length / (ts[ts.length - 1] - ts[0])), p50: r2(d[d.length >> 1]), p95: r2(d[Math.floor(d.length * 0.95)]), p99: r2(d[Math.floor(d.length * 0.99)]), max: r2(d[d.length - 1]), over25ms: d.filter((v) => v > 25).length }); } } requestAnimationFrame(f); })`);
      const m = app.getAppMetrics();
      run.cpu = {}; run.memMB = {};
      for (const p of m) {
        run.cpu[p.type] = Math.round(((run.cpu[p.type] || 0) + p.cpu.percentCPUUsage) * 10) / 10;
        run.memMB[p.type] = Math.round((run.memMB[p.type] || 0) + p.memory.workingSetSize / 1024);
      }
      const heap1 = await js("performance.memory ? performance.memory.usedJSHeapSize : 0");
      run.heapMB = Math.round(heap1 / 1048576 * 10) / 10;
      run.heapGrowthKBps = Math.round((heap1 - heap0) / 1024 / 8);
      // 每帧开销：纯模拟（不渲染）与 一次同步渲染（含 GPU 完成）
      run.simMs = await js(`(() => { const t = performance.now(); window.__pet.step(1 / 60, 600); return Math.round((performance.now() - t) / 600 * 1000) / 1000; })()`);
      run.renderMs = await js(`(() => { const p = window.__pet, gl = p.ctx.renderer.getContext(); p.step(0, 0); gl.finish(); const t = performance.now(); for (let i = 0; i < 40; i++) { p.step(0, 0); gl.finish(); } return Math.round((performance.now() - t) / 40 * 100) / 100; })()`);
      run.info = JSON.parse(await js('JSON.stringify(window.__pet.info())'));
      out.runs.push(run);
    }
    win.setBounds(keep);
    await sleep(300);
  } catch (e) {
    out.error = String(e && e.message ? e.message : e);
  }
  console.log('[perf] ' + JSON.stringify(out));
  app.exit(0);
}

async function runSelfTest() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code);
  const out = { ok: false };
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      let ok = false;
      try { ok = await js('!!(window.__pet && window.__pet.ready)'); } catch (_) { /* 尚未就绪 */ }
      if (ok) break;
      await sleep(150);
    }
    await sleep(1500);
    out.visible = win.isVisible();
    out.alwaysOnTop = win.isAlwaysOnTop();
    // 自检不依赖用户当前的窗口大小和位置：先摆成默认的大小和位置再测。
    // （用户把窗口缩到接近最小尺寸时，下面“再缩小 80×60”那一步缩不动，会误报失败。）
    // 自检期间不保存窗口状态（见 saveState），退出后用户的窗口还是原来的样子。
    out.userBounds = win.getBounds();
    {
      const db = defaultBounds();
      sizeDIP = { width: db.width, height: db.height };
      win.setBounds(db);
      await sleep(700);
    }
    out.before = win.getBounds();
    out.shell = await js(`({ petShell: !!window.petShell, drag: !document.querySelector('.pet-shell-drag'), grip: !!document.querySelector('.pet-shell-grip'), canvas: (() => { const c = document.querySelector('canvas'); return c ? [c.clientWidth, c.clientHeight] : null; })() })`);
    // 合成指针事件：在缩放手柄上按下 → 向左上拖 80×60 → 松开
    await js(`(() => { const g = document.querySelector('.pet-shell-grip'); const ev = (t, x, y) => g.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 1, button: 0, screenX: x, screenY: y })); ev('pointerdown', 1000, 800); ev('pointermove', 960, 770); ev('pointermove', 920, 740); })()`);
    await sleep(600);
    out.during = win.getBounds();
    out.canvasDuring = await js(`(() => { const c = document.querySelector('canvas'); return [c.clientWidth, c.clientHeight, c.width, c.height]; })()`);
    out.stickAfterGripClick = await js('window.__pet.stick.state');
    // 拖回原大小并松开
    await js(`(() => { const g = document.querySelector('.pet-shell-grip'); const ev = (t, x, y) => g.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 1, button: 0, screenX: x, screenY: y })); ev('pointermove', 1000, 800); ev('pointerup', 1000, 800); })()`);
    await sleep(500);
    out.after = win.getBounds();
    // 合成指针事件：在画面上按住左键拖 40×30 → 窗口应跟着移动；拖回原处松开；木棍不应被触发
    await js(`(() => { const c = document.querySelector('canvas'); const ev = (t, x, y, b) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 77, button: 0, buttons: b, screenX: x, screenY: y, clientX: 200, clientY: 200 })); ev('pointerdown', 900, 700, 1); ev('pointermove', 920, 715, 1); ev('pointermove', 940, 730, 1); })()`);
    await sleep(500);
    out.moved = win.getBounds();
    await js(`(() => { const c = document.querySelector('canvas'); const ev = (t, x, y, b) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 77, button: 0, buttons: b, screenX: x, screenY: y, clientX: 200, clientY: 200 })); ev('pointermove', 900, 700, 1); ev('pointerup', 900, 700, 0); })()`);
    await sleep(500);
    out.movedBack = win.getBounds();
    out.stickAfterDrag = await js('window.__pet.stick.state');
    // 滚轮缩放 + 右键旋转
    await js(`(() => { const c = document.querySelector('canvas'); c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -600, clientX: 100, clientY: 120 })); })()`);
    await sleep(700);
    out.zoom = await js('({ z: +window.__pet.userView.zoom.toFixed(2), cx: +window.__pet.userView.cx.toFixed(2), cy: +window.__pet.userView.cy.toFixed(2) })');
    // 点穿判定（需要 backdrop=0，即只显示小岛）：窗口左上角是空的，画面中心偏下是岛体
    out.hit = await js(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); const p = window.__pet; const u = p.userView; u.zoomT = u.zoom = 1; u.cxT = u.cx = 0.5; u.cyT = u.cy = 0.5; p.step(1 / 60, 2); return { corner: p.hitTest(r.left + 12, r.top + 12), center: p.hitTest(r.left + r.width * 0.5, r.top + r.height * 0.62), api: typeof window.petShell.setClickThrough, backdrop: p.ctx.view.backdrop }; })()`);
    out.info = JSON.parse(await js('JSON.stringify(window.__pet.info())'));
    const near = (a, b) => Math.abs(a - b) <= 5; // 高 DPI 缩放下窗口尺寸/位置有几个像素的取整误差
    out.ok = near(out.during.width, out.before.width - 80) && near(out.during.height, out.before.height - 60)
      && near(out.after.width, out.before.width) && near(out.after.height, out.before.height)
      && near(out.canvasDuring[0], out.during.width) && near(out.canvasDuring[1], out.during.height)
      && near(out.moved.x, out.before.x + 40) && near(out.moved.y, out.before.y + 30) && near(out.movedBack.x, out.before.x) && near(out.movedBack.y, out.before.y)
      && near(out.movedBack.width, out.before.width) && near(out.movedBack.height, out.before.height)
      && out.hit.api === 'function' && (out.hit.backdrop >= 0.999 || (out.hit.corner === false && out.hit.center === true))
      && out.zoom.z > 1.5 && out.zoom.cx < 0.5 // stickAfterDrag 只作参考：置顶窗口可能接到用户真实的点击
      && out.shell.petShell && out.shell.drag && out.shell.grip && out.stickAfterGripClick === 'hidden' && out.info.errors.length === 0;
  } catch (e) {
    out.error = String(e && e.message ? e.message : e);
  }
  console.log('[selftest] ' + JSON.stringify(out));
  app.exit(out.ok ? 0 : 1);
}

async function runCapture() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const killer = setTimeout(() => {
    log('[error] 截图总超时，强制退出');
    app.exit(1);
  }, CAPTURE_TIMEOUT);
  let code = 0;
  try {
    if (!fs.existsSync(INDEX)) throw new Error('找不到 dist/index.html，请先 npm run build');
    // 屏幕外 + 不 show：不打扰用户
    createWindow({ x: -10000, y: -10000, width: DEFAULT_W, height: DEFAULT_H });
    await loadPage();
    const t0 = Date.now();
    for (;;) {
      let ok = false;
      try {
        ok = await win.webContents.executeJavaScript('!!(window.__pet && window.__pet.ready)');
      } catch (_) {
        /* 页面尚未可执行 */
      }
      if (ok) break;
      if (Date.now() - t0 > CAPTURE_TIMEOUT - 10000) throw new Error('等待 window.__pet.ready 超时（见上方 console 输出）');
      await sleep(100);
    }
    await sleep(CAPTURE_DELAY);
    let img = await win.webContents.capturePage();
    for (let i = 0; i < 10 && img.isEmpty(); i++) {
      await sleep(200);
      img = await win.webContents.capturePage();
    }
    if (img.isEmpty()) throw new Error('capturePage 返回空图像');
    fs.mkdirSync(path.dirname(CAPTURE_OUT), { recursive: true });
    const png = img.toPNG();
    fs.writeFileSync(CAPTURE_OUT, png);
    const s = img.getSize();
    log(`[saved] ${CAPTURE_OUT} (${s.width}x${s.height}, ${png.length} bytes)`);
    const info = await win.webContents.executeJavaScript('JSON.stringify(window.__pet.info())');
    log('[info] ' + info);
    const errs = JSON.parse(info).errors || [];
    if (errs.length) log(`[warn] __pet.errors 非空 (${errs.length})`);
  } catch (e) {
    log('[error] ' + (e && e.message ? e.message : e));
    code = 1;
  }
  clearTimeout(killer);
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(code);
}

function start() {
  app.on('before-quit', flushSave);
  app.on('window-all-closed', () => {
    if (!CAPTURE) app.quit();
  });
  app.whenReady().then(() => {
    registerIpc();
    if (CAPTURE) runCapture();
    else startNormal();
  });
}

const gotLock = CAPTURE || app.requestSingleInstanceLock();
if (gotLock) start();
else app.exit(0);
