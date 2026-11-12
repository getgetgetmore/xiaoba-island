'use strict';
/*
 * 推广视频录制器（同一个文件有两种运行身份，做法同 scripts/shot.cjs）：
 *   node scripts/promo/record.cjs --out promo/柴犬小岛-推广.mp4 [--only a,b] [--size 1920x1080]
 *   node scripts/promo/record.cjs --stills <镜头名> [--at 0,30,60] [--cols 4]     → promo/stills/<镜头名>.png（预览拼图）
 *   node scripts/promo/record.cjs --list
 * 原理：隐藏的 Electron 窗口加载页面 → 注入 director.js → 逐帧 __pet.step() 渲染、在 2D 画布上合成字幕等叠加层
 *       → WebCodecs 编码 H.264 / AAC → 回到主进程用 mp4-muxer 封装。全程离线逐帧，不依赖实时帧率，也不需要 ffmpeg。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const FPS = 30;

function parseArgs(argv) {
  const o = { out: null, stills: null, at: null, cols: 4, only: null, size: '1920x1080', list: false, timeout: 90000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--out') o.out = next();
    else if (a === '--stills') o.stills = next();
    else if (a === '--at') o.at = next().split(',').map((s) => parseInt(s, 10));
    else if (a === '--cols') o.cols = parseInt(next(), 10) || 4;
    else if (a === '--only') o.only = next().split(',');
    else if (a === '--size') o.size = next();
    else if (a === '--list') o.list = true;
  }
  return o;
}

// ------------------------------------------------------------------ Electron 身份
if (process.versions.electron) {
  const { app, BrowserWindow, nativeImage } = require('electron');
  const payloadArg = process.argv.find((a) => a.startsWith('--payload='));
  const payload = JSON.parse(Buffer.from(payloadArg.slice('--payload='.length), 'base64').toString('utf8'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const directorSrc = fs.readFileSync(path.join(__dirname, 'director.js'), 'utf8');
  const musicSrc = fs.readFileSync(path.join(__dirname, 'music.js'), 'utf8');

  app.setPath('userData', path.join(os.tmpdir(), 'shiba-promo-' + process.pid));
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');

  let exitCode = 0;
  const [W, H] = payload.size.split('x').map((n) => parseInt(n, 10));

  async function openScene(win, query) {
    await win.loadURL(payload.base + '/?' + query + (query ? '&' : '') + 'nopause=1&fps=30');
    const t0 = Date.now();
    for (;;) {
      let ok = false;
      try { ok = await win.webContents.executeJavaScript('!!(window.__pet && window.__pet.ready)'); } catch (_) { /* 页面尚未可执行 */ }
      if (ok) break;
      if (Date.now() - t0 > payload.timeout) throw new Error('等待 window.__pet 就绪超时');
      await sleep(100);
    }
    await win.webContents.executeJavaScript(directorSrc + '\n;0');
  }
  const js = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code}\n})()`);

  app.whenReady().then(async () => {
    const win = new BrowserWindow({
      width: W, height: H, useContentSize: true, x: -10000, y: -10000,
      show: false, frame: false, transparent: true, skipTaskbar: true, focusable: false, resizable: true,
      paintWhenInitiallyHidden: true, backgroundColor: '#00000000', enableLargerThanScreen: true,
      webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setContentSize(W, H);
    win.webContents.on('console-message', (...args) => {
      let level, message;
      if (args[0] && typeof args[0] === 'object' && 'message' in args[0] && args.length === 1) { level = args[0].level; message = args[0].message; } else { level = args[1]; message = args[2]; }
      const lv = typeof level === 'string' ? level : ['verbose', 'info', 'warning', 'error'][level] || String(level);
      if (lv === 'error' || /^\[promo\]/.test(message)) console.log(`[page.${lv}] ${message}`);
    });
    win.webContents.on('render-process-gone', (_e, d) => { console.error('[promo] 渲染进程退出: ' + d.reason); exitCode = 1; });

    try {
      // ---------- 列出镜头
      await openScene(win, 'backdrop=1');
      const all = await js(win, 'return __promo.list();');
      const list = all.filter((s) => !s.debug); // 成片里的镜头（调试镜头只能用 --stills 看）
      if (payload.list) {
        let t = 0;
        for (const s of list) { console.log(`${s.name.padEnd(12)} ${String(s.frames).padStart(4)} 帧  ${(s.frames / FPS).toFixed(1)}s  @${(t / FPS).toFixed(1)}s  ${s.query}`); t += s.frames; }
        console.log(`合计 ${t} 帧 = ${(t / FPS).toFixed(2)}s`);
      } else if (payload.stills) {
        // ---------- 预览拼图
        for (const name of payload.stills.split(',')) {
          const sc = all.find((s) => s.name === name);
          if (!sc) throw new Error('没有这个镜头：' + name);
          await openScene(win, sc.query);
          const at = payload.at || Array.from({ length: 8 }, (_, i) => Math.round((i * (sc.frames - 1)) / 7));
          const url = await js(win, `return await __promo.stills(${JSON.stringify(name)}, ${JSON.stringify(at)}, ${payload.cols});`);
          const file = path.join(ROOT, 'promo', 'stills', name + '.png');
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, nativeImage.createFromDataURL(url).toPNG());
          console.log(`[saved] ${file}  帧 ${at.join(',')}`);
          const errs = await js(win, 'return __pet.info().errors;');
          if (errs.length) console.log('[warn] 页面错误：' + JSON.stringify(errs).slice(0, 400));
        }
      } else {
        // ---------- 正片
        const { Muxer, ArrayBufferTarget } = require('mp4-muxer');
        const scenes = payload.only ? list.filter((s) => payload.only.includes(s.name)) : list;
        const video = []; // { ts, dur, key, data }
        let vDesc = null, vCodec = null, frameBase = 0;
        const startOf = {}; // 各镜头的起始时间（秒），配乐按它卡点
        const usF = 1e6 / FPS;
        for (const sc of scenes) {
          const t0 = Date.now();
          startOf[sc.name] = frameBase / FPS;
          await openScene(win, sc.query);
          await js(win, `await __promo.begin(${JSON.stringify(sc.name)});`);
          let got = 0;
          for (;;) {
            const r = await js(win, 'return await __promo.run(20);');
            if (r.desc && !vDesc) { vDesc = Buffer.from(r.desc, 'base64'); vCodec = r.codec; }
            else if (r.desc && vDesc && Buffer.compare(vDesc, Buffer.from(r.desc, 'base64')) !== 0) console.log(`[warn] 镜头 ${sc.name} 的编码参数与第一段不同`);
            for (const c of r.chunks) { video.push({ ts: Math.round((frameBase + c.f) * usF), dur: Math.round(usF), key: c.key, data: Buffer.from(c.b64, 'base64') }); got++; }
            if (r.done) break;
          }
          const errs = await js(win, 'return __pet.info().errors;');
          console.log(`[scene] ${sc.name.padEnd(12)} ${got}/${sc.frames} 帧  ${((Date.now() - t0) / 1000).toFixed(1)}s` + (errs.length ? '  页面错误：' + JSON.stringify(errs).slice(0, 300) : ''));
          if (got !== sc.frames) throw new Error(`镜头 ${sc.name} 帧数不对`);
          frameBase += sc.frames;
        }
        // ---------- 配乐
        const dur = frameBase / FPS;
        const sEnd = (n) => startOf[n] + scenes.find((s) => s.name === n).frames / FPS;
        const marks = { storm: 'storm' in startOf ? [startOf.storm, sEnd('storm')] : [dur, dur], outro: 'ending' in startOf ? startOf.ending : dur };
        await win.webContents.executeJavaScript(musicSrc + '\n;0');
        const a = await js(win, `return await __promoMusic(${dur}, ${JSON.stringify(marks)});`);
        const aDesc = Buffer.from(a.desc, 'base64');
        const audio = a.chunks.map((c) => ({ ts: c.ts, dur: c.dur, data: Buffer.from(c.b64, 'base64') }));
        console.log(`[music] ${audio.length} 个音频包，峰值 ${a.peak}（归一前 ${a.rawPeak}），每 5 秒响度 ${a.rms.join(' ')}，异常采样 ${a.bad}`);
        if (a.bad || !a.desc) throw new Error('配乐生成或编码有问题');
        // ---------- 封装（按时间交错写入）
        const muxer = new Muxer({
          target: new ArrayBufferTarget(),
          video: { codec: 'avc', width: W, height: H, frameRate: FPS },
          audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 },
          fastStart: 'in-memory', firstTimestampBehavior: 'offset',
        });
        video.sort((x, y) => x.ts - y.ts);
        let vi = 0, ai = 0, vFirst = true, aFirst = true;
        while (vi < video.length || ai < audio.length) {
          const takeV = ai >= audio.length || (vi < video.length && video[vi].ts <= audio[ai].ts);
          if (takeV) {
            const c = video[vi++];
            muxer.addVideoChunkRaw(new Uint8Array(c.data), c.key ? 'key' : 'delta', c.ts, c.dur, vFirst ? { decoderConfig: { codec: vCodec, codedWidth: W, codedHeight: H, description: new Uint8Array(vDesc) } } : undefined);
            vFirst = false;
          } else {
            const c = audio[ai++];
            muxer.addAudioChunkRaw(new Uint8Array(c.data), 'key', c.ts, c.dur, aFirst ? { decoderConfig: { codec: 'mp4a.40.2', numberOfChannels: 2, sampleRate: 48000, description: new Uint8Array(aDesc) } } : undefined);
            aFirst = false;
          }
        }
        muxer.finalize();
        const file = path.resolve(ROOT, payload.out);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(muxer.target.buffer));
        console.log(`[saved] ${file}  ${W}x${H}  ${dur.toFixed(2)}s  ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
      }
    } catch (e) {
      console.error('[promo] ' + (e && e.stack ? e.stack : e));
      exitCode = 1;
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
  if (!opts.out && !opts.stills && !opts.list) {
    console.log('用法: node scripts/promo/record.cjs --out promo/x.mp4 | --stills <镜头名> [--at 0,30] | --list');
    process.exit(2);
  }
  const { spawn } = require('child_process');
  const electronExe = require('electron');
  const { createServer } = await import('vite');
  const server = await createServer({
    root: ROOT, logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 5900 + Math.floor(Math.random() * 300), strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const base = ((server.resolvedUrls && server.resolvedUrls.local[0]) || `http://127.0.0.1:${server.config.server.port}/`).replace(/\/$/, '');
  const payload = Buffer.from(JSON.stringify({ ...opts, base }), 'utf8').toString('base64');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1';
  const child = spawn(electronExe, [__filename, '--payload=' + payload], { stdio: ['ignore', 'inherit', 'inherit'], env, windowsHide: true });
  child.on('exit', async (code) => {
    try { await server.close(); } catch (_) { /* ignore */ }
    process.exit(code || 0);
  });
})().catch((e) => {
  console.error('[promo] ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
