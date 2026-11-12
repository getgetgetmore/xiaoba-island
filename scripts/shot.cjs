'use strict';
/*
 * 无头截图工具（同一个文件有两种运行身份）：
 *   node scripts/shot.cjs --out shots/x/a.png [--query "hour=18.2&weather=clear"] [--size 900x640]
 *        [--wait 2500] [--eval "<js>"] [--frames N --interval ms] [--timeout 60000]
 *   1) 作为 Node 进程：在空闲端口启动独立 Vite dev server，再拉起 Electron 子进程运行本文件，结束后关闭服务并退出。
 *   2) 作为 Electron 主进程（带 --payload）：开隐藏窗口（show:false，不弹窗、不抢焦点），加载页面，
 *      等 window.__pet.ready → 再等 --wait 毫秒 → 执行 --eval → capturePage 保存 PNG。
 * 输出（stdout）：页面 console 的 error/warn、保存的文件、以及 __pet.info() 的 JSON。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');

// ------------------------------------------------------------------ 参数解析
function parseArgs(argv) {
  const o = { out: null, query: '', size: '900x640', wait: 2500, eval: null, frames: 1, interval: 500, timeout: 60000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--out') o.out = next();
    else if (a === '--query') o.query = next();
    else if (a === '--size') o.size = next();
    else if (a === '--wait') o.wait = Number(next());
    else if (a === '--eval') o.eval = next();
    else if (a === '--eval-file') o.eval = fs.readFileSync(next(), 'utf8'); // 多行脚本（npm 在 Windows 下会截断含换行的参数）
    else if (a === '--frames') o.frames = Math.max(1, parseInt(next(), 10) || 1);
    else if (a === '--interval') o.interval = Number(next());
    else if (a === '--timeout') o.timeout = Number(next());
    else if (a === '--dist') o.dist = true;
    else if (a === '--dom') o.dom = true; // 用 capturePage 截整个页面（含 DOM 叠加层，但隐藏窗口下可能是旧帧）
    else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

const HELP = `用法: npm run shot -- --out <png> [--query "hour=18.2&weather=clear"] [--size 900x640]
                    [--wait 2500] [--eval "<js>" | --eval-file <js文件>] [--frames N --interval ms] [--timeout 60000] [--dist]
  --dist: 不起 Vite，直接以 file:// 加载 dist/index.html（需先 npm run build，用于验证 Electron 加载构建产物）`;

function framePath(out, i, n) {
  if (n <= 1) return out;
  const ext = path.extname(out) || '.png';
  return out.slice(0, out.length - (path.extname(out) ? ext.length : 0)) + '-' + i + ext;
}

// ------------------------------------------------------------------ Electron 身份
if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const payloadArg = process.argv.find((a) => a.startsWith('--payload='));
  const payload = JSON.parse(Buffer.from(payloadArg.slice('--payload='.length), 'base64').toString('utf8'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 每个实例独立 userData，可并行；固定缩放因子 1，截图尺寸 = --size
  app.setPath('userData', path.join(os.tmpdir(), 'shiba-shot-' + process.pid));
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  if (process.env.SHOT_SWIFTSHADER === '1') {
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  }

  let exitCode = 0;
  const fatal = (msg) => {
    console.error('[shot] ' + msg);
    exitCode = 1;
  };

  app.whenReady().then(async () => {
    const [w, h] = payload.size.split('x').map((n) => parseInt(n, 10));
    const win = new BrowserWindow({
      width: w, height: h, useContentSize: true,
      x: -10000, y: -10000, // 即便意外显示也在屏幕外
      show: false, frame: false, transparent: true, skipTaskbar: true, focusable: false, resizable: true,
      paintWhenInitiallyHidden: true, backgroundColor: '#00000000',
      webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setContentSize(w, h);

    win.webContents.on('console-message', (...args) => {
      // 兼容 Electron 新旧事件签名
      let level, message;
      if (args[0] && typeof args[0] === 'object' && 'message' in args[0] && args.length === 1) {
        level = args[0].level; message = args[0].message;
      } else {
        level = args[1]; message = args[2];
      }
      const lv = typeof level === 'string' ? level : ['verbose', 'info', 'warning', 'error'][level] || String(level);
      if (lv === 'error' || lv === 'warning' || lv === 'warn') console.log(`[console.${lv === 'warning' ? 'warn' : lv}] ${message}`);
    });
    win.webContents.on('render-process-gone', (_e, d) => fatal('渲染进程退出: ' + d.reason));
    win.webContents.on('did-fail-load', (_e, code, desc, url) => fatal(`页面加载失败 ${code} ${desc} ${url}`));

    try {
      await win.loadURL(payload.url);

      // 等待 __pet 就绪
      const t0 = Date.now();
      for (;;) {
        let ok = false;
        try {
          ok = await win.webContents.executeJavaScript('!!(window.__pet && window.__pet.ready)');
        } catch (_) { /* 页面尚未可执行 */ }
        if (ok) break;
        if (Date.now() - t0 > payload.timeout) throw new Error('等待 window.__pet 就绪超时（页面可能出错，见上方 console 输出）');
        await sleep(100);
      }

      await sleep(payload.wait);

      if (payload.eval) {
        try {
          const r = await win.webContents.executeJavaScript(`(async () => { ${payload.eval}\n})()`);
          if (r !== undefined) console.log('[eval] ' + JSON.stringify(r));
        } catch (e) {
          console.log('[eval error] ' + e.message);
          exitCode = 1;
        }
        await sleep(200);
      }

      for (let i = 0; i < payload.frames; i++) {
        // 隐藏窗口的合成器不保证呈现新帧，capturePage 可能拿到旧画面。
        // 所以优先在页面内“渲染当前帧并立刻读 WebGL 画布”（同一任务内 drawing buffer 有效），得到真正的当前画面。
        // 注意：这种方式只含 3D 画布，不含 DOM 叠加层（面板等）和 CSS 圆角；需要 DOM 时用 --dom。
        let img = null;
        if (!payload.dom) {
          try {
            const dataUrl = await win.webContents.executeJavaScript(
              `(() => { const p = window.__pet; const r = p && p.ctx && p.ctx.renderer; if (!r) return null; p.step(0, 0); return r.domElement.toDataURL('image/png'); })()`,
            );
            if (dataUrl) img = require('electron').nativeImage.createFromDataURL(dataUrl);
          } catch (_) { img = null; }
        }
        if (!img || img.isEmpty()) {
          if (payload.dom) { try { win.showInactive(); win.webContents.invalidate(); } catch (_) { /* ignore */ } await sleep(600); } // 窗口在屏幕外（x=-10000），showInactive 不抢焦点 // 隐藏窗口里让合成器重新出一帧，DOM 叠加层才是最新的
          img = await win.webContents.capturePage();
          for (let retry = 0; retry < 10 && img.isEmpty(); retry++) {
            await sleep(200);
            img = await win.webContents.capturePage();
          }
        }
        if (img.isEmpty()) throw new Error('capturePage 返回空图像');
        const file = path.resolve(ROOT, framePath(payload.out, i, payload.frames));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const png = img.toPNG();
        fs.writeFileSync(file, png);
        const s = img.getSize();
        console.log(`[saved] ${file} (${s.width}x${s.height}, ${png.length} bytes)`);
        if (i < payload.frames - 1) await sleep(payload.interval);
      }

      const info = await win.webContents.executeJavaScript('JSON.stringify(window.__pet.info())');
      console.log('[info] ' + info);
      const errs = JSON.parse(info).errors || [];
      if (errs.length) console.log(`[warn] __pet.errors 非空 (${errs.length})`);
    } catch (e) {
      fatal(e.message);
    }
    win.destroy();
    app.exit(exitCode);
  });
  app.on('window-all-closed', () => {});
  return;
}

// ------------------------------------------------------------------ Node 身份
(async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.out) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 2);
  }
  if (!/^\d+x\d+$/.test(opts.size)) {
    console.error('--size 格式应为 WxH，例如 900x640');
    process.exit(2);
  }

  const { spawn } = require('child_process');
  let electronExe;
  try {
    electronExe = require('electron');
  } catch (e) {
    console.error('[shot] 找不到 electron：' + e.message);
    process.exit(1);
  }
  if (typeof electronExe !== 'string' || !fs.existsSync(electronExe)) {
    console.error('[shot] electron 二进制不存在（npm install 时可能下载失败）：' + electronExe);
    process.exit(1);
  }

  let server = null;
  let url;
  let q = opts.query.replace(/^\?/, '');
  q += (q ? '&' : '') + 'nopause=1';
  if (opts.dist) {
    const idx = path.join(ROOT, 'dist', 'index.html');
    if (!fs.existsSync(idx)) { console.error('[shot] dist/index.html 不存在，请先 npm run build'); process.exit(1); }
    url = require('url').pathToFileURL(idx).href + '?' + q;
  } else {
  const { createServer } = await import('vite');
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    clearScreen: false,
    server: { host: '127.0.0.1', port: 5300 + Math.floor(Math.random() * 600), strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const base = (server.resolvedUrls && server.resolvedUrls.local[0]) || `http://127.0.0.1:${server.config.server.port}/`;
  url = base.replace(/\/$/, '') + '/?' + q;
  }

  const payload = Buffer.from(JSON.stringify({ ...opts, url }), 'utf8').toString('base64');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1';
  const child = spawn(electronExe, [__filename, '--payload=' + payload], { stdio: ['ignore', 'inherit', 'inherit'], env, windowsHide: true });

  const killer = setTimeout(() => {
    console.error('[shot] 总超时，强制结束');
    child.kill();
  }, opts.timeout + opts.wait + opts.frames * (opts.interval + 1000) + 15000);

  child.on('exit', async (code) => {
    clearTimeout(killer);
    try { if (server) await server.close(); } catch (_) { /* ignore */ }
    process.exit(code || 0);
  });
})().catch((e) => {
  console.error('[shot] ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
