'use strict';
/*
 * 成片检查：node scripts/promo/verify.cjs <mp4> [--at 1,5,12.5] [--cols 4] [--tw 480]
 * 用隐藏的 Electron 窗口里的 <video> 实际解码这个文件：报告时长、分辨率、有没有音轨并真的解出了声音，
 * 再在指定的时间点截图拼成一张图（<mp4 同名>-check.png）。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

if (process.versions.electron) {
  const { app, BrowserWindow, nativeImage } = require('electron');
  const p = JSON.parse(Buffer.from(process.argv.find((a) => a.startsWith('--payload=')).slice(10), 'base64').toString('utf8'));
  app.setPath('userData', path.join(os.tmpdir(), 'shiba-verify-' + process.pid));
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.whenReady().then(async () => {
    let code = 0;
    const win = new BrowserWindow({ show: false, x: -10000, y: -10000, width: 640, height: 360, webPreferences: { backgroundThrottling: false } });
    try {
      const html = path.join(os.tmpdir(), 'shiba-verify-' + process.pid + '.html');
      fs.writeFileSync(html, '<html><body style="margin:0;background:#000"><video id="v" preload="auto"></video></body></html>');
      await win.loadFile(html);
      const r = await win.webContents.executeJavaScript(`(async () => {
        const v = document.getElementById('v');
        v.src = ${JSON.stringify(require('url').pathToFileURL(p.file).href)};
        await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = () => no(new Error('无法解码：' + (v.error && v.error.message))); });
        const out = { duration: +v.duration.toFixed(3), width: v.videoWidth, height: v.videoHeight };
        // 静音播放 1.5 秒，看音轨是否真的解出了数据
        v.muted = true; await v.play(); await new Promise((r) => setTimeout(r, 1500)); v.pause();
        out.audioBytes = v.webkitAudioDecodedByteCount; out.videoBytes = v.webkitVideoDecodedByteCount; out.playedTo = +v.currentTime.toFixed(2);
        const at = ${JSON.stringify(p.at)} || Array.from({ length: 12 }, (_, i) => +(((i + 0.5) * v.duration) / 12).toFixed(2));
        const cols = ${p.cols}, tw = ${p.tw}, th = Math.round((tw * v.videoHeight) / v.videoWidth);
        const c = document.createElement('canvas'); c.width = tw * cols; c.height = th * Math.ceil(at.length / cols);
        const g = c.getContext('2d');
        for (let k = 0; k < at.length; k++) {
          v.currentTime = Math.min(at[k], v.duration - 0.05);
          await new Promise((r) => { v.onseeked = r; });
          await new Promise((r) => setTimeout(r, 60));
          const x = (k % cols) * tw, y = Math.floor(k / cols) * th;
          g.drawImage(v, x, y, tw, th);
          g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, y, 70, 22); g.fillStyle = '#fff'; g.font = '14px sans-serif'; g.fillText(at[k] + 's', x + 6, y + 16);
        }
        out.sheet = c.toDataURL('image/png');
        return out; })()`);
      const sheet = p.file.replace(/\.mp4$/i, '') + '-check.png';
      fs.writeFileSync(sheet, nativeImage.createFromDataURL(r.sheet).toPNG());
      delete r.sheet;
      console.log('[verify] ' + JSON.stringify(r));
      console.log('[saved] ' + sheet);
      fs.unlinkSync(html);
    } catch (e) { console.error('[verify] ' + e.message); code = 1; }
    win.destroy(); app.exit(code);
  });
  return;
}

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--') && /\.mp4$/i.test(a));
if (!file) { console.log('用法: node scripts/promo/verify.cjs <mp4> [--at 1,5] [--cols 4]'); process.exit(2); }
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const at = opt('--at', null);
const payload = Buffer.from(JSON.stringify({ file: path.resolve(file), at: at ? at.split(',').map(Number) : null, cols: parseInt(opt('--cols', '4'), 10), tw: parseInt(opt('--tw', '480'), 10) })).toString('base64');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
require('child_process').spawn(require('electron'), [__filename, '--payload=' + payload], { stdio: ['ignore', 'inherit', 'inherit'], env, windowsHide: true }).on('exit', (c) => process.exit(c || 0));
