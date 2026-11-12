// 推广视频的“导演”脚本：由 scripts/promo/record.cjs 注入到页面里运行。
// 每个镜头 = { query, frames, setup(), frame(i), under(g, i), rect(i), over(g, i), caps }：
//   query  页面地址参数（时间、天气、小游戏等）；frames 帧数（30 帧/秒）
//   setup  录制前的准备（摆好小狗、快进到要拍的时刻）；frame 每帧开头调用（运镜、模拟鼠标）
//   under / over  画在 3D 画面下面 / 上面的 2D 内容；rect 3D 画面在成片里的位置（缺省铺满）
//   caps   字幕 [[起始帧, 结束帧, 文字, 选项]]
(() => {
  if (window.__promo) return;
  const P = window.__pet, ctx = P.ctx, THREE = P.THREE, gl = ctx.renderer.domElement;
  window.requestAnimationFrame = () => 0; // 冻结页面自己的主循环：之后每一帧都由这里的 P.step 推进
  const W = gl.width, H = gl.height, FPS = 30, DT = 1 / FPS;
  const U = H / 1080; // 叠加层的尺寸单位（按 1080p 设计）
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const FONT = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';
  const INK = '#4a2a14', CREAM = '#fff6e2', SKY = '#cfe8f6';

  // ------------------------------------------------------------------ 小工具
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const backOut = (t) => { t = clamp(t); const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const seg = (i, a, b) => clamp((i - a) / Math.max(1, b - a));
  const step = (n = 1, dt = DT) => P.step(dt, n);
  /** 不录制地快进，直到条件成立（或到上限） */
  const until = (fn, max = 1800, dt = DT) => { let n = 0; while (n < max && !fn()) { P.step(dt, 1); n++; } return n; };
  const dog = () => P.dog, brain = () => P.brain, env = () => P.env, view = () => P.userView;
  const dogPos = () => P.dog.group.position;
  const v3 = new THREE.Vector3();
  /** 世界坐标 → 画面像素 */
  function screenOf(x, y, z) {
    v3.set(x, y, z).project(ctx.camera);
    return [(v3.x * 0.5 + 0.5) * W, (-v3.y * 0.5 + 0.5) * H];
  }
  /** 模拟鼠标（真实的 DOM 指针事件） */
  const mouseAt = { x: W / 2, y: H / 2 };
  function mouse(type, x, y, button = 0) {
    mouseAt.x = x; mouseAt.y = y;
    const init = { clientX: x, clientY: y, bubbles: true, cancelable: true, button, buttons: type === 'pointerdown' ? 1 : 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    gl.dispatchEvent(new PointerEvent(type, init));
    if (type === 'pointermove') gl.dispatchEvent(new MouseEvent('mousemove', init));
  }
  function setView(o) { const u = view(); for (const k in o) { u[k] = o[k]; if (k + 'T' in u) u[k + 'T'] = o[k]; } }
  function snapCamera(n = 40) { for (let i = 0; i < n; i++) P.step(1 / 10, 1); }

  // ------------------------------------------------------------------ 画字
  function rr(x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
  /** 字幕：一张小小的米色纸签，上面是深棕色的楷体字。p = 出现进度 0..1，q = 消失进度 0..1；align 决定 x 是中心还是左 / 右边缘 */
  const KAI = '"KaiTi", "STKaiti", "Microsoft YaHei UI", serif';
  function pill(text, x, y, size, { p = 1, q = 0, align = 'center', font = KAI, weight = 400 } = {}) {
    const a = ease(p) * (1 - ease(q));
    if (a <= 0.001) return;
    g.save();
    g.globalAlpha = a;
    g.font = `${weight} ${size * U}px ${font}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    const w = g.measureText(text).width, px = size * 0.62 * U, h = size * 1.72 * U, bw = w + 2 * px;
    const left = align === 'center' ? x - bw / 2 : align === 'right' ? x - bw : x, top = y - h / 2 + (1 - ease(p)) * 10 * U;
    g.shadowColor = 'rgba(40,20,5,0.26)'; g.shadowBlur = 16 * U; g.shadowOffsetY = 5 * U;
    g.fillStyle = 'rgba(255,248,232,0.93)'; rr(left, top, bw, h, h / 2); g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = INK; g.fillText(text, left + px, top + h / 2 + size * 0.04 * U);
    g.restore();
  }
  function drawCaps(sc, i) {
    for (const c of sc.caps || []) {
      const [a, b, text, o = {}] = c;
      if (i < a || i > b) continue;
      pill(text, (o.x !== undefined ? o.x : 0.5) * W, (o.y !== undefined ? o.y : 0.9) * H, o.size || 40, { p: seg(i, a, a + 10), q: seg(i, b - 8, b) });
    }
  }
  function wash(color, a) { if (a <= 0) return; g.save(); g.globalAlpha = clamp(a); g.fillStyle = color; g.fillRect(0, 0, W, H); g.restore(); }

  // ------------------------------------------------------------------ 抚摸的小手（页面里是 DOM 图片，这里照着它的位置画到成片上）
  let cur_hand = 1;
  function drawHand() {
    const el = Array.from(gl.parentElement.querySelectorAll('img')).find((e) => e.style.display !== 'none' && /translate/.test(e.style.transform));
    if (!el) return;
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*rotate\(([-\d.]+)deg\)\s*scale\(([-\d.]+)\)\s*translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform);
    if (!m) return;
    g.save();
    const k = +m[4] * (typeof cur_hand === 'number' ? cur_hand : 1); // 特写镜头里把小手画大一点
    g.translate(+m[1], +m[2]); g.rotate((+m[3] * Math.PI) / 180); g.scale(k, k); g.translate(+m[5], +m[6]);
    if (el.style.filter) g.filter = el.style.filter;
    g.globalAlpha = el.style.opacity === '' ? 1 : +el.style.opacity;
    g.drawImage(el, 0, 0, 60, 44);
    g.restore();
  }

  const FULL = { x: 0, y: 0, w: W, h: H };

  // ------------------------------------------------------------------ 镜头
  const SCENES = {};
  const ORDER = [];
  const scene = (name, def) => { SCENES[name] = { name, ...def }; ORDER.push(name); };

  // 1. 开场：从一片白里浮现小岛，镜头绕着它转
  scene('title', {
    query: 'backdrop=1&hour=10.1&weather=clear&seed=3', frames: 120,
    setup() { brain().force('zoomies'); P.setFocus({ ty: 0.75, R: 10.4, vy: 6.9 }); setView({ az: -0.3 }); step(60); },
    frame(i) { P.setFocus({ ty: 0.75, R: 10.4, vy: 6.9 }); setView({ az: lerp(-0.3, 0.42, ease(i / 119)) }); },
    over(i) {
      wash('#ffffff', 1 - ease(seg(i, 0, 16)));
    },
    caps: [[26, 114, '一座漂在桌面上的小岛，住着一只小柴犬']],
  });

  // 3. 延时：从清晨到深夜
  function clockPill(h, i) {
    const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
    const txt = String(hh).padStart(2, '0') + ':' + String(Math.floor(mm / 10) * 10).padStart(2, '0');
    const w = 208 * U, hgt = 66 * U, x = W - w - 64 * U, y = 56 * U, a = ease(seg(i, 4, 16));
    g.save(); g.globalAlpha = a;
    g.shadowColor = 'rgba(40,20,5,0.26)'; g.shadowBlur = 16 * U; g.shadowOffsetY = 5 * U;
    g.fillStyle = 'rgba(255,248,232,0.93)'; rr(x, y, w, hgt, hgt / 2); g.fill(); g.shadowColor = 'transparent';
    const day = h > 6.2 && h < 18.6, cx = x + 38 * U, cy = y + hgt / 2;
    g.fillStyle = day ? '#f0a23a' : '#7f93bd'; g.beginPath(); g.arc(cx, cy, 15 * U, 0, 7); g.fill();
    if (!day) { g.fillStyle = 'rgba(255,248,232,1)'; g.beginPath(); g.arc(cx + 7 * U, cy - 5 * U, 13 * U, 0, 7); g.fill(); }
    g.fillStyle = INK; g.font = `600 ${38 * U}px "Microsoft YaHei UI", sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(txt, x + 68 * U, cy + 2 * U);
    g.restore();
  }
  scene('timelapse', {
    query: 'backdrop=1&hour=5.4&weather=clear&seed=3', frames: 180,
    setup() { step(40); },
    frame(i) { const t = i / 179; this.h = lerp(5.4, 22.6, t); env().setHour(this.h); setView({ az: lerp(0.5, 0.1, ease(t)) }); P.setFocus({ ty: 0.2, R: 9.4, vy: 6.1 }); },
    over(i) { clockPill(this.h, i); },
    caps: [[8, 174, '岛上的时间，跟着你的电脑时钟走']],
  });

  // 4. 变天：正打着滚，下雨了
  scene('storm', {
    query: 'backdrop=1&hour=15.5&weather=clear&seed=7', frames: 165,
    setup() { brain().force('roll'); P.setFocus({ tx: -0.1, ty: 0.9, tz: 0.2, R: 4.5, pitch: 0.27, az: 0.12 }); until(() => dog().action === 'roll', 600); step(24); },
    // 天气默认要 20 秒才变完：这里把岛上的时间流速调快，让乌云和雨在一两秒内压上来
    frame(i) { if (i === 0) { env().setTimeScale(14); env().setWeather('storm'); } },
    caps: [[34, 158, '下雨啦，快回窝！']],
  });

  // 5. 日常四连拍
  const follow = (o = {}) => { const p = dogPos(); P.setFocus({ tx: p.x + (o.dx || 0), ty: p.y + (o.dy === undefined ? 0.5 : o.dy), tz: p.z + (o.dz || 0), R: o.R || 2.1, pitch: o.pitch === undefined ? 0.3 : o.pitch, az: o.az === undefined ? 0.2 : o.az }); };
  const tag = (i, text, n) => pill(text, 0.045 * W, 0.085 * H, 36, { p: seg(i, 2, 12), q: seg(i, n - 9, n - 1), align: 'left' });
  scene('life_roll', {
    query: 'backdrop=1&hour=11&weather=clear&seed=7', frames: 75,
    setup() { brain().force('roll'); const f = () => follow({ R: 1.7 }); until(() => { f(); return dog().action === 'roll'; }, 600); step(8); },
    frame() { follow({ R: 1.7 }); },
    over(i) { tag(i, '晴天，先打个滚', 75); },
  });
  scene('life_zoom', {
    query: 'backdrop=1&hour=11&weather=clear&seed=7', frames: 60,
    setup() { brain().force('zoomies'); P.setFocus({ tx: 1.5, ty: 0.45, tz: 0.9, R: 3.0, pitch: 0.4, az: 0.1 }); until(() => /zoomies/.test(brain().state) && dog().action === 'run', 900); step(4); },
    over(i) { tag(i, '没事，就是想疯跑一圈', 60); },
  });
  scene('life_mat', {
    query: 'backdrop=1&hour=11&weather=clear&seed=7', frames: 75,
    setup() { brain().force('sunbathe'); const f = () => follow({ R: 2.3, az: 0.5, pitch: 0.34 }); until(() => { f(); return /sunbathe:drag/.test(brain().state) && !brain().mover.inKennel; }, 2400); step(6); },
    frame() { follow({ R: 2.3, az: 0.5, pitch: 0.34 }); },
    over(i) { tag(i, '把垫子拖出来晒太阳', 75); },
  });
  scene('life_lookout', {
    query: 'backdrop=1&hour=18.3&weather=clear&seed=7', frames: 90,
    setup() { brain().force('lookout'); const f = () => follow({ R: 2.6, az: -0.35, pitch: 0.16, dy: 0.3 }); until(() => { f(); return /lookout:watch/.test(brain().state); }, 2400); step(20); },
    frame() { follow({ R: 2.6, az: -0.35, pitch: 0.16, dy: 0.3 }); },
    over(i) { tag(i, '傍晚，上瞭望台发呆', 90); },
  });

  // 6. 摸摸小狗
  scene('pet', {
    query: 'backdrop=1&hour=11&weather=clear&seed=9', frames: 135, hand: 1.7,
    setup() { brain().force('sit'); const f = () => follow({ R: 1.55, az: 0.15, pitch: 0.26, dy: 0.45 }); until(() => { f(); return dog().action === 'sit'; }, 900); step(20); },
    frame(i) {
      follow({ R: 1.55, az: 0.15, pitch: 0.26, dy: 0.45 });
      const p = dogPos(); const [sx, sy] = screenOf(p.x, p.y + 1.13, p.z);
      const inT = easeOut(seg(i, 0, 14));
      mouse('pointermove', lerp(W * 0.86, sx, inT) + Math.sin(i * 0.42) * 95 * U * inT, lerp(H * 0.3, sy, inT) + Math.sin(i * 0.21) * 22 * U);
    },
    caps: [[22, 130, '摸摸它，烦恼 −1']],
  });

  // 7. 扔树枝
  scene('fetch', {
    query: 'backdrop=1&hour=16&weather=clear&seed=4', frames: 195,
    // 树枝拿在“手里”时离镜头很近，换特写机位会显得巨大：这里用小岛的默认机位，只做画面放大
    setup() {
      setView({ zoom: 1.75, cx: 0.5, cy: 0.5 });
      mouse('pointermove', W * 0.5, H * 0.5); P.stick.click(null);
      let k = 0; until(() => { k++; mouse('pointermove', W * 0.5 + Math.sin(k * 0.3) * 120 * U, H * 0.5 + Math.cos(k * 0.23) * 50 * U); return /wait:(spin|bounce)/.test(brain().state); }, 900);
    },
    frame(i) {
      setView({ zoom: 1.75, cx: 0.5, cy: 0.5 });
      if (i < 20) mouse('pointermove', W * 0.5 + Math.sin(i * 0.36) * 150 * U, H * 0.5 + Math.cos(i * 0.27) * 60 * U);
      if (i === 20) P.stick.click(new THREE.Vector3(3.3, 0, 2.2));
    },
    caps: [[10, 188, '扔根树枝，快乐 +1']],
  });

  // 8. 遛狗小游戏
  scene('walk', {
    query: 'backdrop=1&hour=11&weather=clear&seed=11&game=walk&gameT=42', frames: 105,
    caps: [[10, 99, '遛狗？明明是它在遛你']],
  });

  // 9. 尾巴钓鱼：先钓到锦鲤，再钓到……螃蟹
  const fishSetup = (id) => {
    const F = P.fishing;
    F.start({ instant: true, seed: 5, forceBottle: false, allowPrank: false });
    F.setBot('skilled');
    until(() => !!F.sim, 300);
    F.debugNext(id); // 这一钩就钓到指定的东西
    until(() => F.sim.phase === 'bite', 2400);
  };
  scene('fishing', {
    query: 'backdrop=1&hour=11&weather=clear&seed=5', frames: 255,
    // 先悠闲地坐着等（尾巴垂在水里、小金鱼围过来），咬钩 → 拉扯 → 挂在尾巴上提出水面 → 是只螃蟹，夹着尾巴不放
    setup() {
      const F = P.fishing;
      F.start({ instant: true, seed: 5, forceBottle: false, allowPrank: false });
      F.setBot('skilled');
      until(() => !!F.sim, 300);
      F.debugNext('crab');
      until(() => { const S = F.sim; return S.phase === 'bite' || (S.phase === 'wait' && !S.fake && S.wait - S.t < 2.3); }, 2400);
      this.biteAt = 0; this.landAt = 0;
    },
    frame(i) {
      const ph = P.fishing.sim.phase;
      if (!this.biteAt && (ph === 'bite' || ph === 'fight')) this.biteAt = i;
      if (!this.landAt && ph === 'land') this.landAt = i;
    },
    over(i) {
      const b = this.biteAt || 9999, l = this.landAt || 9999;
      pill('尾巴垂进池塘，悠闲地钓会儿鱼', 0.5 * W, 0.9 * H, 40, { p: seg(i, 8, 18), q: seg(i, b + 4, b + 14) });
      pill('咬钩了！', 0.5 * W, 0.9 * H, 40, { p: seg(i, b + 16, b + 24), q: seg(i, l - 2, l + 6) });
      pill('……是一只不肯松钳的螃蟹', 0.5 * W, 0.9 * H, 40, { p: seg(i, l + 16, l + 26), q: seg(i, 246, 254) });
    },
  });

  // 10. 收尾：夜里的小岛，镜头慢慢拉远
  scene('ending', {
    query: 'backdrop=1&hour=20.4&weather=clear&seed=3', frames: 180,
    cam(i) { const t = ease(i / 179); P.setFocus({ ty: lerp(0.3, 0.9, t), R: lerp(8.6, 11.2, t), vy: lerp(5.6, 7.3, t) }); setView({ az: lerp(0.45, -0.1, t) }); },
    setup() { this.cam(0); step(90); },
    frame(i) { this.cam(i); },
    over(i) {
      wash('#000000', ease(seg(i, 158, 179)));
    },
  });

  // 调试镜头（不进成片）：land_<东西>，从出水那一刻开始，放大看尾巴附近。node scripts/promo/record.cjs --stills land_koi
  for (const id of ['goldfish', 'koi', 'loach', 'crab', 'frog', 'weed', 'lotusLeaf', 'lotusPod', 'pebble', 'clam', 'pearlClam', 'twig', 'bottle']) {
    scene('land_' + id, {
      debug: true, query: 'backdrop=1&hour=11&weather=clear&seed=5', frames: 150,
      setup() { fishSetup(id); until(() => P.fishing.sim.phase === 'land', 1500); },
      frame() { setView({ zoom: 2.3, cx: 0.57, cy: 0.5 }); },
    });
  }

  // ------------------------------------------------------------------ 合成一帧
  let cur = null, fi = 0;
  function compose(sc, i) {
    if (sc.frame) sc.frame(i);
    P.step(sc.dt || DT, sc.sub || 1);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none';
    g.fillStyle = SKY; g.fillRect(0, 0, W, H);
    if (sc.under) sc.under(i);
    const r = sc.rect ? sc.rect(i) : FULL;
    g.drawImage(gl, r.x, r.y, r.w, r.h);
    if (sc.hand) { cur_hand = sc.hand; drawHand(); }
    if (sc.over) sc.over(i);
    drawCaps(sc, i);
  }

  // ------------------------------------------------------------------ 编码
  let enc = null, out = [], desc = null, codec = null, encErr = null;
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  function takeChunks() { const r = { chunks: out, desc: desc ? b64(desc) : null, codec }; out = []; desc = null; return r; }

  window.__promo = {
    list: () => ORDER.map((n) => ({ name: n, frames: SCENES[n].frames, query: SCENES[n].query, debug: !!SCENES[n].debug })),
    async begin(name) {
      cur = SCENES[name]; fi = 0; out = []; desc = null; encErr = null;
      enc = new VideoEncoder({
        output(chunk, meta) {
          const u8 = new Uint8Array(chunk.byteLength); chunk.copyTo(u8);
          out.push({ f: Math.round((chunk.timestamp * FPS) / 1e6), key: chunk.type === 'key', b64: b64(u8) });
          if (meta && meta.decoderConfig && meta.decoderConfig.description && !desc) { desc = new Uint8Array(meta.decoderConfig.description.slice ? meta.decoderConfig.description.slice(0) : meta.decoderConfig.description); codec = meta.decoderConfig.codec; }
        },
        error(e) { encErr = e; console.error('[promo] 编码出错 ' + e.message); },
      });
      enc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 7.5e6, framerate: FPS, avc: { format: 'avc' }, latencyMode: 'quality' });
      if (cur.setup) await cur.setup();
    },
    async run(n) {
      for (let k = 0; k < n && fi < cur.frames; k++, fi++) {
        compose(cur, fi);
        const vf = new VideoFrame(cv, { timestamp: Math.round((fi * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
        enc.encode(vf, { keyFrame: fi % 60 === 0 });
        vf.close();
        while (enc.encodeQueueSize > 3) await new Promise((r) => setTimeout(r, 2));
      }
      if (encErr) throw encErr;
      const done = fi >= cur.frames;
      if (done) { await enc.flush(); enc.close(); } else await new Promise((r) => setTimeout(r, 0));
      return { done, ...takeChunks() };
    },
    /** 预览：把指定的几帧缩小后拼成一张图 */
    async stills(name, at, cols = 4) {
      const sc = SCENES[name];
      if (sc.setup) await sc.setup();
      const tw = cols === 1 ? 1280 : 480, th = Math.round((tw * H) / W), rows = Math.ceil(at.length / cols);
      const sheet = document.createElement('canvas'); sheet.width = tw * cols; sheet.height = th * rows;
      const sg = sheet.getContext('2d');
      const last = Math.max(...at);
      for (let i = 0, k = 0; i <= last; i++) {
        compose(sc, i);
        while (k < at.length && at[k] === i) {
          const x = (k % cols) * tw, y = Math.floor(k / cols) * th;
          sg.drawImage(cv, x, y, tw, th);
          sg.fillStyle = 'rgba(0,0,0,0.55)'; sg.fillRect(x, y, 58, 22); sg.fillStyle = '#fff'; sg.font = '14px sans-serif'; sg.fillText('f' + i, x + 6, y + 16);
          k++;
        }
      }
      return sheet.toDataURL('image/png');
    },
    _: { SCENES, compose, until, step, mouse, screenOf, setView, snapCamera },
  };
  console.log('[promo] 导演就绪 ' + W + 'x' + H);
})();
