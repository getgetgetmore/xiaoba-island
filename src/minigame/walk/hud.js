// 遛狗小游戏的界面（DOM 叠加层，中文）：倒计时 + 操作提示、顶部剩余时间 / 骨头 / 失误、右上角“✕ 回小岛”、
// 横穿物提示、撞到时的红色闪屏、结算面板。窗口很小（最小 220×200）时按比例缩小，不溢出、不互相遮挡。
const CSS = /* css */ `
#wk-hud { position: fixed; inset: 0; z-index: 40; pointer-events: none; overflow: hidden; border-radius: 22px; display: none;
  --u: 1; color: #5a3a26; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif; user-select: none; -webkit-user-select: none; }
#wk-hud.on { display: block; }
#wk-hud * { box-sizing: border-box; }
.wk-top { position: absolute; left: calc(8px * var(--u)); right: calc(8px * var(--u)); top: calc(8px * var(--u)); display: flex; flex-wrap: wrap; align-items: center; gap: calc(5px * var(--u)); }
.wk-chip { display: flex; align-items: center; gap: calc(4px * var(--u)); height: calc(24px * var(--u)); padding: 0 calc(8px * var(--u)); border-radius: calc(12px * var(--u));
  background: rgba(255, 246, 230, 0.9); border: calc(1.5px * var(--u)) solid #5a3a26; font-weight: 700; font-size: calc(12.5px * var(--u)); line-height: 1; white-space: nowrap; box-shadow: 0 calc(2px * var(--u)) 0 rgba(90, 58, 38, 0.25); }
.wk-chip svg { width: calc(14px * var(--u)); height: calc(14px * var(--u)); flex: none; }
.wk-time { flex: 1 1 calc(96px * var(--u)); min-width: 0; gap: calc(6px * var(--u)); }
.wk-bar { flex: 1 1 auto; min-width: calc(24px * var(--u)); height: calc(8px * var(--u)); border-radius: calc(5px * var(--u)); background: rgba(90, 58, 38, 0.18); overflow: hidden; }
.wk-bar > i { display: block; height: 100%; width: 100%; transform-origin: left center; background: linear-gradient(90deg, #ffb347, #ff8a3d); border-radius: inherit; }
.wk-clock { min-width: calc(34px * var(--u)); text-align: right; font-variant-numeric: tabular-nums; }
.wk-bump { animation: wk-bump 0.32s ease-out; }
@keyframes wk-bump { 0% { transform: scale(1); } 35% { transform: scale(1.22); } 100% { transform: scale(1); } }
.wk-btn { pointer-events: auto; cursor: pointer; font: inherit; color: inherit; }
.wk-exit { height: calc(24px * var(--u)); padding: 0 calc(9px * var(--u)); border-radius: calc(12px * var(--u)); background: #ffe3d2; border: calc(1.5px * var(--u)) solid #5a3a26; font-weight: 700; font-size: calc(12px * var(--u));
  box-shadow: 0 calc(2px * var(--u)) 0 rgba(90, 58, 38, 0.25); white-space: nowrap; }
.wk-exit:hover { background: #ffd0b5; }
.wk-exit:active { transform: translateY(calc(1px * var(--u))); }
#wk-hud[data-compact="1"] .wk-exit .wk-t { display: none; }
.wk-center { position: absolute; left: 0; right: 0; top: 44%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: calc(8px * var(--u)); padding: 0 calc(10px * var(--u)); }
.wk-count { font-size: calc(76px * var(--u)); font-weight: 900; line-height: 1; color: #fff7e6; -webkit-text-stroke: calc(3px * var(--u)) #5a3a26; paint-order: stroke fill; text-shadow: 0 calc(4px * var(--u)) 0 rgba(90, 58, 38, 0.45); }
.wk-count.pop { animation: wk-pop 0.9s ease-out; }
@keyframes wk-pop { 0% { transform: scale(1.7); opacity: 0; } 18% { transform: scale(1); opacity: 1; } 80% { opacity: 1; } 100% { transform: scale(0.85); opacity: 0.2; } }
.wk-hint { max-width: 96%; text-align: center; font-size: calc(12.5px * var(--u)); font-weight: 700; line-height: 1.5; padding: calc(5px * var(--u)) calc(11px * var(--u)); border-radius: calc(12px * var(--u)); background: rgba(255, 246, 230, 0.92);
  border: calc(1.5px * var(--u)) solid #5a3a26; transition: opacity 0.5s; }
.wk-hint b { color: #e0642a; }
.wk-hint.off { opacity: 0; }
.wk-warn { position: absolute; top: 30%; display: none; flex-direction: column; align-items: center; gap: calc(2px * var(--u)); }
.wk-warn.on { display: flex; }
.wk-warn[data-side="-1"] { left: calc(8px * var(--u)); }
.wk-warn[data-side="1"] { right: calc(8px * var(--u)); }
.wk-warn .wk-sign { width: calc(38px * var(--u)); height: calc(38px * var(--u)); animation: wk-blink 0.5s ease-in-out infinite alternate; filter: drop-shadow(0 calc(2px * var(--u)) 0 rgba(90, 58, 38, 0.35)); }
.wk-warn .wk-lbl { font-size: calc(11px * var(--u)); font-weight: 800; padding: calc(1px * var(--u)) calc(6px * var(--u)); border-radius: calc(8px * var(--u)); background: rgba(255, 246, 230, 0.92); border: calc(1.2px * var(--u)) solid #5a3a26; white-space: nowrap; }
@keyframes wk-blink { from { transform: scale(0.9); } to { transform: scale(1.12); } }
.wk-flash { position: absolute; inset: 0; opacity: 0; background: radial-gradient(ellipse at center, rgba(255, 90, 60, 0) 45%, rgba(230, 40, 30, 0.55) 100%); }
.wk-flash.go { animation: wk-flash 0.55s ease-out; }
@keyframes wk-flash { 0% { opacity: 1; } 100% { opacity: 0; } }
.wk-result { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; padding: calc(8px * var(--u)); background: rgba(60, 40, 25, 0.28); }
.wk-result.on { display: flex; }
.wk-card { pointer-events: auto; width: min(100%, calc(340px * var(--u))); max-height: 100%; display: flex; flex-direction: column; align-items: center; gap: calc(6px * var(--u)); padding: calc(12px * var(--u)) calc(14px * var(--u)) calc(11px * var(--u));
  background: #fff6e6; border: calc(2.5px * var(--u)) solid #5a3a26; border-radius: calc(20px * var(--u)); box-shadow: 0 calc(5px * var(--u)) 0 rgba(90, 58, 38, 0.35); animation: wk-in 0.4s cubic-bezier(.2, 1.4, .4, 1); text-align: center; overflow: hidden; }
@keyframes wk-in { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.wk-title { font-size: calc(17px * var(--u)); font-weight: 900; line-height: 1.15; }
.wk-sub { font-size: calc(11.5px * var(--u)); font-weight: 700; opacity: 0.75; line-height: 1.2; }
.wk-stars { display: flex; gap: calc(4px * var(--u)); }
.wk-stars svg { width: calc(32px * var(--u)); height: calc(32px * var(--u)); }
.wk-stars svg.on { animation: wk-star 0.5s cubic-bezier(.2, 1.6, .4, 1) both; }
@keyframes wk-star { from { transform: scale(0) rotate(-40deg); } to { transform: scale(1) rotate(0); } }
.wk-pct { font-size: calc(30px * var(--u)); font-weight: 900; line-height: 1; color: #e0642a; }
.wk-pct small { font-size: calc(13px * var(--u)); color: #5a3a26; margin-left: calc(4px * var(--u)); }
.wk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: calc(4px * var(--u)) calc(8px * var(--u)); width: 100%; font-size: calc(12px * var(--u)); font-weight: 700; }
.wk-grid div { display: flex; justify-content: space-between; gap: calc(4px * var(--u)); padding: calc(3px * var(--u)) calc(8px * var(--u)); border-radius: calc(9px * var(--u)); background: #ffe9cc; }
.wk-grid span { opacity: 0.75; }
.wk-btns { display: flex; gap: calc(8px * var(--u)); width: 100%; margin-top: calc(2px * var(--u)); }
.wk-btns button { flex: 1 1 0; min-width: 0; height: calc(30px * var(--u)); border-radius: calc(15px * var(--u)); border: calc(2px * var(--u)) solid #5a3a26; font-weight: 800; font-size: calc(13px * var(--u)); background: #ffe3d2; box-shadow: 0 calc(2px * var(--u)) 0 rgba(90, 58, 38, 0.3); }
.wk-btns button.main { background: #ffb347; }
.wk-btns button:hover { filter: brightness(1.06); }
.wk-btns button:active { transform: translateY(calc(1px * var(--u))); }
.wk-grip { gap: calc(5px * var(--u)); }
.wk-grip .wk-gl { font-size: calc(11px * var(--u)); opacity: 0.8; }
.wk-gbar { width: calc(54px * var(--u)); height: calc(8px * var(--u)); border-radius: calc(5px * var(--u)); background: rgba(90, 58, 38, 0.18); overflow: hidden; }
.wk-gbar > i { display: block; height: 100%; width: 100%; transform-origin: left center; background: linear-gradient(90deg, #7ddf64, #ffd23f); border-radius: inherit; transition: background 0.2s; }
.wk-grip.hot { background: #ffd9d2; animation: wk-hot 0.35s ease-in-out infinite alternate; }
.wk-grip.hot .wk-gbar > i { background: linear-gradient(90deg, #ff8a5c, #e83a2a); }
@keyframes wk-hot { from { transform: scale(1); } to { transform: scale(1.08); } }
.wk-rope b { color: #e0642a; min-width: calc(14px * var(--u)); text-align: center; }
.wk-rope.tight { background: #ffe9a8; }
.wk-combo { position: absolute; left: calc(10px * var(--u)); top: calc(48px * var(--u)); font-weight: 900; font-size: calc(18px * var(--u)); color: #fff7e6; -webkit-text-stroke: calc(2.5px * var(--u)) #5a3a26; paint-order: stroke fill; text-shadow: 0 calc(3px * var(--u)) 0 rgba(90, 58, 38, 0.35); display: none; }
.wk-combo.on { display: block; }
.wk-combo small { font-size: calc(11px * var(--u)); margin-right: calc(3px * var(--u)); }
.wk-banner { position: absolute; left: 0; right: 0; top: 36%; text-align: center; font-weight: 900; font-size: calc(30px * var(--u)); color: #fff1ea; -webkit-text-stroke: calc(3px * var(--u)) #b3261a; paint-order: stroke fill; text-shadow: 0 calc(4px * var(--u)) 0 rgba(90, 20, 10, 0.4); opacity: 0; pointer-events: none; }
.wk-banner.go { animation: wk-ban 1.3s ease-out; }
@keyframes wk-ban { 0% { opacity: 0; transform: scale(1.6); } 12% { opacity: 1; transform: scale(1); } 75% { opacity: 1; } 100% { opacity: 0; transform: translateY(calc(-10px * var(--u))); } }
#wk-hud[data-tiny="1"] .wk-grid div:nth-child(n+7) { display: none; }
#wk-hud[data-tiny="1"] .wk-grip .wk-gl { display: none; }
#wk-hud[data-tiny="1"] .wk-gbar { width: calc(36px * var(--u)); }
#wk-hud[data-compact="1"] .wk-sub, #wk-hud[data-compact="1"] .wk-title { display: none; }
#wk-hud[data-compact="1"] .wk-stars svg { width: calc(26px * var(--u)); height: calc(26px * var(--u)); }
#wk-hud[data-tiny="1"] .wk-grid { grid-template-columns: 1fr; gap: calc(2px * var(--u)); }
#wk-hud[data-tiny="1"] .wk-grid div { padding: calc(1px * var(--u)) calc(6px * var(--u)); }
#wk-hud[data-tiny="1"] .wk-stars svg { width: calc(22px * var(--u)); height: calc(22px * var(--u)); }
#wk-hud[data-tiny="1"] .wk-pct { font-size: calc(24px * var(--u)); }
`;

const ICON_BONE = '<svg viewBox="0 0 24 24"><g fill="#fff1d2" stroke="#5a3a26" stroke-width="1.7" stroke-linejoin="round"><rect x="5" y="9" width="14" height="6" rx="1.5"/><circle cx="4.8" cy="8.2" r="2.7"/><circle cx="4.8" cy="15.8" r="2.7"/><circle cx="19.2" cy="8.2" r="2.7"/><circle cx="19.2" cy="15.8" r="2.7"/></g><rect x="5.2" y="9.9" width="13.6" height="4.2" fill="#fff1d2"/></svg>';
const ICON_HIT = '<svg viewBox="0 0 24 24"><path d="M12 3 22 20H2z" fill="#ffc926" stroke="#5a3a26" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9.5v5" stroke="#3a2a22" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.2" fill="#3a2a22"/></svg>';
const SIGN = '<svg class="wk-sign" viewBox="0 0 48 48"><path d="M24 4 45 41H3z" fill="#ffc926" stroke="#5a3a26" stroke-width="3.2" stroke-linejoin="round"/><path d="M24 17v13" stroke="#3a2a22" stroke-width="4.5" stroke-linecap="round"/><circle cx="24" cy="36" r="2.6" fill="#3a2a22"/></svg>';
const STAR = (on) => `<svg viewBox="0 0 32 32" class="${on ? 'on' : ''}"><path d="M16 3l3.9 8.2 8.9 1.2-6.5 6.2 1.7 8.9L16 23l-8 4.5 1.7-8.9-6.5-6.2 8.9-1.2z" fill="${on ? '#ffc926' : '#e8dcc6'}" stroke="#5a3a26" stroke-width="2" stroke-linejoin="round"/></svg>`;

const WARN_LABEL = { ball: '皮球要过路', bike: '单车要过路', skate: '滑板要过路', squirrel: '松鼠！小狗要冲', cat: '小猫！小狗要冲' };

export function createHud(parent) {
  if (typeof document === 'undefined') return null;
  if (!document.getElementById('wk-style')) {
    const st = document.createElement('style');
    st.id = 'wk-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.id = 'wk-hud';
  root.innerHTML = `
    <div class="wk-flash"></div>
    <div class="wk-top">
      <div class="wk-chip wk-time"><div class="wk-bar"><i></i></div><span class="wk-clock">3:00</span></div>
      <div class="wk-chip wk-bones">${ICON_BONE}<span>0</span></div>
      <div class="wk-chip wk-hits">${ICON_HIT}<span>0</span></div>
      <div class="wk-chip wk-grip"><span class="wk-gl">握力</span><div class="wk-gbar"><i></i></div></div>
      <div class="wk-chip wk-rope" title="绳子：松 / 紧"><span class="wk-gl">绳</span><b>松</b></div>
      <button class="wk-btn wk-exit" type="button" title="退出，回到小岛（Esc）">✕<span class="wk-t"> 回小岛</span></button>
    </div>
    <div class="wk-combo"><small>连击</small>×<span>0</span></div>
    <div class="wk-banner"></div>
    <div class="wk-warn" data-side="-1">${SIGN}<div class="wk-lbl"></div></div>
    <div class="wk-center"><div class="wk-count"></div><div class="wk-hint"></div></div>
    <div class="wk-result"><div class="wk-card"></div></div>`;
  (parent || document.body).appendChild(root);
  const q = (s) => root.querySelector(s);
  const el = {
    flash: q('.wk-flash'), bar: q('.wk-bar > i'), clock: q('.wk-clock'), bones: q('.wk-bones'), boneN: q('.wk-bones span'), hits: q('.wk-hits'), hitN: q('.wk-hits span'),
    grip: q('.wk-grip'), gbar: q('.wk-gbar > i'), rope: q('.wk-rope'), ropeB: q('.wk-rope b'), combo: q('.wk-combo'), comboN: q('.wk-combo span'), banner: q('.wk-banner'),
    exit: q('.wk-exit'), warn: q('.wk-warn'), warnLbl: q('.wk-warn .wk-lbl'), count: q('.wk-count'), hint: q('.wk-hint'), result: q('.wk-result'), card: q('.wk-card'),
  };
  // 界面里的按钮不能触发“向后拉”（游戏在 document 上监听指针）
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  let lastClock = '', lastBones = -1, lastHits = -1, lastWarn = '', lastCombo = -1, lastTight = null;

  const bump = (node) => { node.classList.remove('wk-bump'); void node.offsetWidth; node.classList.add('wk-bump'); };

  const hud = {
    root, el,
    onExit: null,
    show(on) {
      root.classList.toggle('on', !!on);
      if (on) { lastClock = ''; lastBones = -1; lastHits = -1; lastWarn = ''; lastCombo = -1; lastTight = null; el.combo.classList.remove('on'); hud.hideResult(); el.warn.classList.remove('on'); el.count.textContent = ''; }
    },
    resize(w, h) {
      const m = Math.min(w, h * 1.15);
      root.style.setProperty('--u', String(Math.max(0.62, Math.min(1.2, m / 440))));
      root.dataset.compact = m < 380 || h < 330 ? '1' : '';
      root.dataset.tiny = h < 270 || w < 270 ? '1' : '';
    },
    setTime(remain, total) {
      const r = Math.max(0, Math.ceil(remain - 1e-6));
      const s = `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
      if (s !== lastClock) { lastClock = s; el.clock.textContent = s; }
      el.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, remain / total)).toFixed(4)})`;
    },
    setBones(n) { if (n !== lastBones) { if (lastBones >= 0) bump(el.bones); lastBones = n; el.boneN.textContent = String(n); } },
    /** 握力条 0..1（≥0.7 变红闪），slipping = 正在脱手 */
    setGrip(v, slipping) {
      el.gbar.style.transform = `scaleX(${Math.max(0, Math.min(1, v)).toFixed(3)})`;
      el.grip.classList.toggle('hot', v >= 0.7 || !!slipping);
    },
    setRope(tight) { if (tight !== lastTight) { lastTight = tight; el.ropeB.textContent = tight ? '紧' : '松'; el.rope.classList.toggle('tight', !!tight); } },
    setCombo(n) {
      if (n === lastCombo) return;
      if (n > lastCombo && n >= 3) bump(el.combo);
      lastCombo = n;
      el.combo.classList.toggle('on', n >= 3);
      el.comboN.textContent = String(n);
    },
    banner(text) { el.banner.textContent = text; el.banner.classList.remove('go'); void el.banner.offsetWidth; el.banner.classList.add('go'); },
    setHits(n) { if (n !== lastHits) { if (lastHits >= 0) bump(el.hits); lastHits = n; el.hitN.textContent = String(n); } },
    countdown(text) {
      el.count.textContent = text || '';
      el.count.classList.remove('pop'); void el.count.offsetWidth;
      if (text) el.count.classList.add('pop');
    },
    hint(html, on = true) { if (html !== undefined && html !== null) el.hint.innerHTML = html; el.hint.style.display = ''; el.hint.classList.toggle('off', !on); },
    flashHit() { el.flash.classList.remove('go'); void el.flash.offsetWidth; el.flash.classList.add('go'); },
    /** 横穿物提示：side = 它出发的那一侧（-1 左 / 1 右 / 0 不显示） */
    warn(side, kind) {
      const key = side + ':' + kind;
      if (key === lastWarn) return;
      lastWarn = key;
      if (!side) { el.warn.classList.remove('on'); return; }
      el.warn.dataset.side = String(side);
      el.warnLbl.textContent = WARN_LABEL[kind] || '小心！';
      el.warn.classList.add('on');
    },
    showResult(res, { onAgain, onExit }) {
      const stars = [1, 2, 3].map((i) => STAR(i <= res.stars)).join('');
      const msg = res.stars === 3 ? '太棒啦，小柴今天超开心！' : res.stars === 2 ? '散步很愉快，下次会更好！' : '慢慢来，小柴陪你再走一圈。';
      el.card.innerHTML = `
        <div class="wk-title">遛狗完成！</div>
        <div class="wk-stars">${stars}</div>
        <div class="wk-pct">${res.completion}<small>% 完成度</small></div>
        <div class="wk-sub">${msg}</div>
        <div class="wk-grid">
          <div><span>躲开</span><b>${res.avoided}</b></div>
          <div><span>失误</span><b>${res.hits}</b></div>
          <div><span>骨头</span><b>${res.bones}/${res.bonesTotal}</b></div>
          <div><span>路程</span><b>${res.distance} 米</b></div>
          <div><span>最大连击</span><b>×${res.maxCombo}</b></div>
          <div><span>脱手</span><b>${res.slips} 次</b></div>
          <div><span>拽</span><b>${res.tugs} 次</b></div>
          <div><span>用时</span><b>${Math.round(res.duration)} 秒</b></div>
        </div>
        <div class="wk-btns"><button type="button" class="wk-btn main" data-a="again">再来一次</button><button type="button" class="wk-btn" data-a="exit">回小岛</button></div>`;
      el.card.querySelector('[data-a="again"]').addEventListener('click', () => onAgain && onAgain());
      el.card.querySelector('[data-a="exit"]').addEventListener('click', () => onExit && onExit());
      el.result.classList.add('on');
      el.hint.style.display = 'none';
    },
    hideResult() { el.result.classList.remove('on'); },
    get resultVisible() { return el.result.classList.contains('on'); },
    dispose() { root.remove(); },
  };
  el.exit.addEventListener('click', () => hud.onExit && hud.onExit());
  return hud;
}
