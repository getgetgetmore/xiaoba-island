// 分享视频的配乐：一段程序合成的原创小曲（120 拍/分，C 大调，拨弦 + 铃音 + 轻鼓点），外加变天那段的雨声和雷声。
// 由 scripts/promo/record.cjs 注入页面运行：window.__promoMusic(总时长秒, 时间点) → AAC 音频包。
// 时间点 marks = { storm: [起, 止], outro: 收尾起点 }，都是秒，由各镜头的时长算出。
(() => {
  if (window.__promoMusic) return;
  const SR = 48000;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  window.__promoMusic = async (dur, marks) => {
    const N = Math.ceil(dur * SR);
    const L = new Float32Array(N), R = new Float32Array(N);
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 4294967296) * 2 - 1; };
    const add = (i, v, pan) => { if (i >= 0 && i < N) { L[i] += v * (1 - Math.max(0, pan)); R[i] += v * (1 + Math.min(0, pan)); } };

    // ---- 乐器
    /** 拨弦（Karplus-Strong）：听起来像尤克里里 / 尼龙弦 */
    function pluck(t, midi, vol = 0.2, pan = 0, len = 1.1, bright = 0.5) {
      const f = hz(midi), n = Math.max(2, Math.round(SR / f));
      const buf = new Float32Array(n);
      let lp = 0;
      for (let i = 0; i < n; i++) { lp += (rnd() - lp) * (0.25 + bright * 0.6); buf[i] = lp; }
      const i0 = Math.round(t * SR), total = Math.round(len * SR);
      const damp = 0.996 - (0.0016 * (midi - 48)) / 12;
      let k = 0, prev = 0;
      for (let i = 0; i < total; i++) {
        const cur = buf[k];
        buf[k] = 0.5 * (cur + prev) * damp; prev = cur; k = (k + 1) % n;
        const env = Math.min(1, i / 60) * Math.min(1, (total - i) / 2400);
        add(i0 + i, cur * vol * env, pan);
      }
    }
    function bass(t, midi, vol = 0.3, len = 0.42) {
      const f = hz(midi), i0 = Math.round(t * SR), total = Math.round(len * SR);
      for (let i = 0; i < total; i++) {
        const x = i / SR, env = Math.min(1, i / 200) * Math.exp(-x * 5.5);
        add(i0 + i, (Math.sin(2 * Math.PI * f * x) + 0.28 * Math.sin(4 * Math.PI * f * x)) * vol * env, 0);
      }
    }
    /** 铃音（钟琴）：主旋律 */
    function bell(t, midi, vol = 0.15, pan = 0.15, len = 0.9) {
      const f = hz(midi), i0 = Math.round(t * SR), total = Math.round(len * SR);
      for (let i = 0; i < total; i++) {
        const x = i / SR, env = Math.min(1, i / 90);
        const v = Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 4.2) + 0.32 * Math.sin(2 * Math.PI * f * 4 * x) * Math.exp(-x * 13) + 0.12 * Math.sin(2 * Math.PI * f * 2 * x) * Math.exp(-x * 7);
        add(i0 + i, v * vol * env, pan);
        add(i0 + i + 11520, v * vol * env * 0.22, -pan); // 一点回声
      }
    }
    function kick(t, vol = 0.42) {
      const i0 = Math.round(t * SR), total = Math.round(0.24 * SR);
      let ph = 0;
      for (let i = 0; i < total; i++) {
        const x = i / SR, f = 46 + 70 * Math.exp(-x * 34);
        ph += (2 * Math.PI * f) / SR;
        add(i0 + i, Math.sin(ph) * Math.exp(-x * 15) * vol * Math.min(1, i / 40), 0);
      }
    }
    /** 一小段噪声：tone 越大越亮；用作沙锤、拍手 */
    function noise(t, vol, len, tone, pan = 0) {
      const i0 = Math.round(t * SR), total = Math.round(len * SR);
      let lp = 0;
      for (let i = 0; i < total; i++) {
        const w = rnd(); lp += (w - lp) * tone;
        const v = tone > 0.5 ? w - lp : lp; // 亮：高通；暗：低通
        add(i0 + i, v * vol * Math.exp(-(i / total) * 5) * Math.min(1, i / 30), pan);
      }
    }

    // ---- 和弦与旋律
    const CH = {
      C: { b: 36, v: [55, 60, 64] }, G: { b: 43, v: [55, 59, 62] }, Am: { b: 45, v: [57, 60, 64] }, F: { b: 41, v: [53, 57, 60] },
    };
    const ARP = [0, 1, 2, 1, 0, 2, 1, 2];
    const MEL = [
      [76, 0, 79, 0, 81, 79, 76, 0], [74, 0, 79, 0, 74, 0, 71, 0], [72, 0, 76, 0, 81, 0, 79, 76], [77, 0, 81, 0, 79, 77, 76, 74],
      [76, 79, 84, 0, 79, 0, 76, 0], [74, 79, 83, 0, 79, 0, 74, 0], [72, 76, 81, 0, 79, 76, 72, 0], [77, 0, 81, 0, 79, 0, 74, 0],
    ];
    const E8 = 0.25; // 一个八分音符（秒）
    /** 一小节（2 秒）：o = { chord, mel, drums, level, beats（只演奏前几拍）} */
    function bar(t0, o) {
      const c = CH[o.chord], lv = o.level === undefined ? 1 : o.level, n8 = (o.beats || 4) * 2;
      for (let k = 0; k < n8; k++) {
        const t = t0 + k * E8, swing = k % 2 ? 0.018 : 0;
        pluck(t + swing, c.v[ARP[k]] + (k % 4 === 3 ? 12 : 0), 0.17 * lv, k % 2 ? 0.35 : -0.35, 0.9, 0.5);
        if (k % 4 === 2) for (let j = 0; j < 3; j++) pluck(t + 0.012 * j, c.v[j] + 12, 0.11 * lv, 0.1, 0.5, 0.75); // 第 2、4 拍的小扫弦
        if (k % 4 === 0) bass(t, c.b + (k === 4 ? 7 : 0), 0.3 * lv);
        if (o.drums) {
          if (k % 4 === 0) kick(t, 0.4);
          if (k % 4 === 2) noise(t, 0.085, 0.09, 0.22, 0.1);
          noise(t + swing, k % 2 ? 0.05 : 0.028, 0.045, 0.9, k % 2 ? 0.4 : -0.4);
        }
        const m = o.mel && o.mel[k];
        if (m) bell(t + swing, m, 0.15 * lv, 0.18);
      }
    }

    // ---- 编排
    const stormA = marks.storm[0], stormB = marks.storm[1], outro = marks.outro;
    const PROG = ['C', 'G', 'Am', 'F'];
    // 第一段：开场到变天之前
    for (const [k, m] of [[0, 84], [1, 88], [2, 91], [3, 96]]) bell(0.02 + k * 0.07, m, 0.1, -0.2, 0.7); // 开场的一串铃音
    for (let b = 0, t = 0; t < stormA - 0.01; b++, t += 2) bar(t, { chord: PROG[b % 4], mel: MEL[b % 8], drums: t >= 2, beats: Math.min(4, Math.round((stormA - t) / 0.5)) });
    // 变天：只留低沉的拨弦，加雨声和雷声
    const S = ['Am', 'F', 'G'];
    for (let b = 0, t = stormA; t < stormB - 0.01; b++, t += 2) {
      const c = CH[S[b % 3]], beats = Math.min(4, Math.round((stormB - t) / 0.5));
      for (let k = 0; k < beats; k++) { bass(t + k * 0.5, c.b, 0.26, 0.5); pluck(t + k * 0.5 + 0.25, c.v[k % 3], 0.12, k % 2 ? 0.3 : -0.3, 0.8, 0.3); }
    }
    {
      const i0 = Math.round(stormA * SR), i1 = Math.round(stormB * SR);
      let lpL = 0, lpR = 0, hpL = 0, hpR = 0;
      for (let i = i0; i < i1 && i < N; i++) { // 雨：带通的沙沙声，左右声道各自独立
        const x = (i - i0) / SR, env = Math.min(1, x / 1.2) * Math.min(1, (stormB - stormA - x) / 0.5);
        const a = rnd(), b = rnd();
        lpL += (a - lpL) * 0.55; lpR += (b - lpR) * 0.55; hpL += (lpL - hpL) * 0.08; hpR += (lpR - hpR) * 0.08;
        L[i] += (lpL - hpL) * 0.085 * env; R[i] += (lpR - hpR) * 0.085 * env;
      }
      for (const [t, vol] of [[stormA + 0.15, 0.5], [stormA + 2.7, 0.34]]) { // 雷：很低的隆隆声
        const j0 = Math.round(t * SR), total = Math.round(1.9 * SR);
        let lp = 0, lp2 = 0;
        for (let i = 0; i < total; i++) {
          const x = i / SR; lp += (rnd() - lp) * 0.012; lp2 += (lp - lp2) * 0.02;
          add(j0 + i, lp2 * 13 * vol * Math.min(1, x / 0.05) * Math.exp(-x * 2.1) * (1 + 0.5 * Math.sin(x * 23)), 0.2 * Math.sin(x * 3));
        }
      }
      for (let k = 0; k < 4; k++) bell(stormB - 0.5 + k * 0.11, [84, 88, 91, 96][k], 0.09, 0.1, 0.6); // 雨停，回到主旋律前的一串铃音
    }
    // 第二段：日常与互动（镜头切换都卡在拍子上）
    let t = stormB, b = 0;
    for (; t < outro - 1.99; b++, t += 2) bar(t, { chord: PROG[b % 4], mel: MEL[b % 8], drums: true });
    // 收尾：鼓点退场，最后落在 C 和弦上
    const O = [['F', [77, 0, 81, 0, 84, 0, 81, 0]], ['G', [79, 0, 83, 0, 86, 0, 83, 79]]];
    for (let k = 0; k < O.length && t < dur - 2.4; k++, t += 2) bar(t, { chord: O[k][0], mel: O[k][1], drums: false, level: 0.9 });
    for (let j = 0; j < 4; j++) pluck(t + j * 0.045, [48, 55, 60, 64][j], 0.2, j % 2 ? 0.3 : -0.3, 2.6, 0.6);
    bass(t, 36, 0.3, 1.4);
    for (const [k, m] of [[0, 84], [1, 88], [2, 91], [4, 96]]) bell(t + k * 0.16, m, 0.13, 0.1, 1.6);

    // ---- 母带：整体淡出 + 软限幅 + 归一
    let peak = 0;
    for (let i = 0; i < N; i++) {
      const x = i / SR, fade = Math.min(1, x / 0.02) * Math.min(1, Math.max(0, (dur - x) / 1.6));
      L[i] = Math.tanh(L[i] * 1.35) * fade; R[i] = Math.tanh(R[i] * 1.35) * fade;
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    }
    const gain = peak > 0 ? 0.86 / peak : 1;
    const rms = [];
    let bad = 0;
    for (let s0 = 0; s0 < N; s0 += SR * 5) {
      let e = 0, n = 0;
      for (let i = s0; i < Math.min(N, s0 + SR * 5); i++) {
        L[i] *= gain; R[i] *= gain;
        if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) bad++;
        e += L[i] * L[i] + R[i] * R[i]; n += 2;
      }
      rms.push(+Math.sqrt(e / n).toFixed(3));
    }

    // ---- AAC 编码
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const chunks = []; let desc = null, err = null;
    const enc = new AudioEncoder({
      output(chunk, meta) {
        const u8 = new Uint8Array(chunk.byteLength); chunk.copyTo(u8);
        chunks.push({ ts: chunk.timestamp, dur: chunk.duration || Math.round((1024 * 1e6) / SR), b64: b64(u8) });
        if (meta && meta.decoderConfig && meta.decoderConfig.description && !desc) desc = new Uint8Array(meta.decoderConfig.description);
      },
      error(e) { err = e; },
    });
    enc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 160000 });
    const BLK = 4800;
    for (let i = 0; i < N; i += BLK) {
      const n = Math.min(BLK, N - i);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i * 1e6) / SR), data });
      enc.encode(ad); ad.close();
    }
    await enc.flush(); enc.close();
    if (err) throw err;
    return { desc: desc ? b64(desc) : null, chunks, peak: +(peak * gain).toFixed(3), rawPeak: +peak.toFixed(3), rms, bad };
  };
})();
