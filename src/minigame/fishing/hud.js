// 钓鱼小游戏的界面（DOM 叠加层，中文，风格与遛狗 HUD 一致）：
// 顶部：6 个小圆点（第几钩 / 钓上来没有）、得分、“✕ 回小岛”；等鱼提示；真咬时的大“!”；拉扯时的进度条和“尾巴疼”条（底部）；
// 出水小卡片；漂流瓶纸条；结算面板。窗口很小（最小 220×200）时整体按比例缩小，不溢出、不互相遮挡。
import { iconOf, STAR_ICON } from './icons.js';

const CSS = /* css */ `
#fs-hud { position: fixed; inset: 0; z-index: 40; pointer-events: none; overflow: hidden; border-radius: 22px; display: none;
  --u: 1; color: #5a3a26; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif; user-select: none; -webkit-user-select: none; }
#fs-hud.on { display: block; }
#fs-hud * { box-sizing: border-box; }
.fs-top { position: absolute; left: calc(8px * var(--u)); right: calc(8px * var(--u)); top: calc(8px * var(--u)); display: flex; flex-wrap: wrap; align-items: center; gap: calc(5px * var(--u)); }
.fs-chip { display: flex; align-items: center; gap: calc(4px * var(--u)); height: calc(24px * var(--u)); padding: 0 calc(8px * var(--u)); border-radius: calc(12px * var(--u));
  background: rgba(255, 246, 230, 0.92); border: calc(1.5px * var(--u)) solid #5a3a26; font-weight: 700; font-size: calc(12.5px * var(--u)); line-height: 1; white-space: nowrap; box-shadow: 0 calc(2px * var(--u)) 0 rgba(90, 58, 38, 0.25); }
.fs-dots { gap: calc(5px * var(--u)); }
.fs-dot { width: calc(11px * var(--u)); height: calc(11px * var(--u)); border-radius: 50%; border: calc(1.5px * var(--u)) solid #5a3a26; background: #fff6e6; flex: none; transition: background 0.2s, transform 0.2s; }
.fs-dot.cur { background: #ffd67a; transform: scale(1.25); animation: fs-pulse 1s ease-in-out infinite alternate; }
.fs-dot.ok { background: #7ddf64; }
.fs-dot.no { background: #d9cdb8; position: relative; }
.fs-dot.no::after { content: ""; position: absolute; left: 15%; right: 15%; top: 42%; height: calc(1.5px * var(--u)); background: #5a3a26; transform: rotate(-40deg); }
@keyframes fs-pulse { from { transform: scale(1.1); } to { transform: scale(1.35); } }
.fs-score { gap: calc(4px * var(--u)); }
.fs-score svg { width: calc(14px * var(--u)); height: calc(14px * var(--u)); flex: none; }
.fs-score b { min-width: calc(16px * var(--u)); text-align: right; font-variant-numeric: tabular-nums; }
.fs-bump { animation: fs-bump 0.32s ease-out; }
@keyframes fs-bump { 0% { transform: scale(1); } 35% { transform: scale(1.22); } 100% { transform: scale(1); } }
.fs-spacer { flex: 1 1 0; min-width: 0; }
.fs-btn { pointer-events: auto; cursor: pointer; font: inherit; color: inherit; }
.fs-exit { height: calc(24px * var(--u)); padding: 0 calc(9px * var(--u)); border-radius: calc(12px * var(--u)); background: #ffe3d2; border: calc(1.5px * var(--u)) solid #5a3a26; font-weight: 700; font-size: calc(12px * var(--u));
  box-shadow: 0 calc(2px * var(--u)) 0 rgba(90, 58, 38, 0.25); white-space: nowrap; }
.fs-exit:hover { background: #ffd0b5; }
.fs-exit:active { transform: translateY(calc(1px * var(--u))); }
#fs-hud[data-compact="1"] .fs-exit .fs-t { display: none; }
.fs-bottom { position: absolute; left: calc(8px * var(--u)); right: calc(8px * var(--u)); bottom: calc(8px * var(--u)); display: flex; flex-direction: column; align-items: center; gap: calc(6px * var(--u)); }
.fs-hint { max-width: 100%; text-align: center; font-size: calc(12.5px * var(--u)); font-weight: 700; line-height: 1.45; padding: calc(5px * var(--u)) calc(11px * var(--u)); border-radius: calc(12px * var(--u)); background: rgba(255, 246, 230, 0.93);
  border: calc(1.5px * var(--u)) solid #5a3a26; transition: opacity 0.3s; }
.fs-hint b { color: #e0642a; }
.fs-hint.off { opacity: 0; }
.fs-hint.alert { background: #ffe9a8; border-color: #b3261a; color: #b3261a; }
.fs-fight { display: none; width: min(100%, calc(260px * var(--u))); padding: calc(6px * var(--u)) calc(9px * var(--u)); border-radius: calc(14px * var(--u)); background: rgba(255, 246, 230, 0.94); border: calc(1.5px * var(--u)) solid #5a3a26;
  box-shadow: 0 calc(2px * var(--u)) 0 rgba(90, 58, 38, 0.25); flex-direction: column; gap: calc(5px * var(--u)); }
.fs-fight.on { display: flex; }
.fs-row { display: flex; align-items: center; gap: calc(6px * var(--u)); font-size: calc(11.5px * var(--u)); font-weight: 800; }
.fs-row svg { width: calc(16px * var(--u)); height: calc(16px * var(--u)); flex: none; }
.fs-row .fs-lbl { width: calc(46px * var(--u)); flex: none; white-space: nowrap; }
.fs-meter { flex: 1 1 auto; min-width: calc(30px * var(--u)); height: calc(10px * var(--u)); border-radius: calc(6px * var(--u)); background: rgba(90, 58, 38, 0.18); overflow: hidden; border: calc(1px * var(--u)) solid rgba(90, 58, 38, 0.5); }
.fs-meter > i { display: block; height: 100%; width: 100%; transform-origin: left center; transform: scaleX(0); border-radius: inherit; }
.fs-prog > i { background: linear-gradient(90deg, #7ddf64, #35b86a); }
.fs-pain > i { background: linear-gradient(90deg, #ffb347, #e83a2a); }
.fs-pain.hot { animation: fs-hot 0.3s ease-in-out infinite alternate; }
@keyframes fs-hot { from { transform: scale(1); } to { transform: scale(1.04); } }
.fs-state { text-align: center; font-size: calc(12px * var(--u)); font-weight: 900; line-height: 1.1; min-height: calc(14px * var(--u)); }
.fs-state.pull { color: #2f9a4a; }
.fs-state.warn { color: #d08a1a; }
.fs-state.hold { color: #d4372a; animation: fs-hot 0.25s ease-in-out infinite alternate; }
.fs-bang { position: absolute; left: 0; right: 0; top: 24%; display: none; justify-content: center; }
.fs-bang.on { display: flex; }
.fs-bang span { display: block; font-size: calc(66px * var(--u)); font-weight: 900; line-height: 1; color: #ff4a2a; -webkit-text-stroke: calc(3.5px * var(--u)) #5a3a26; paint-order: stroke fill; text-shadow: 0 calc(4px * var(--u)) 0 rgba(90, 58, 38, 0.45); animation: fs-bang 0.35s cubic-bezier(.2, 1.6, .4, 1); }
@keyframes fs-bang { from { transform: scale(0.3) rotate(-14deg); opacity: 0; } to { transform: scale(1) rotate(0); opacity: 1; } }
.fs-banner { position: absolute; left: 0; right: 0; top: 34%; text-align: center; font-weight: 900; font-size: calc(30px * var(--u)); color: #fff7e6; -webkit-text-stroke: calc(3px * var(--u)) #3a6ea0; paint-order: stroke fill; text-shadow: 0 calc(4px * var(--u)) 0 rgba(30, 60, 90, 0.4); opacity: 0; pointer-events: none; }
.fs-banner.go { animation: fs-ban 1.5s ease-out; }
@keyframes fs-ban { 0% { opacity: 0; transform: scale(1.6); } 12% { opacity: 1; transform: scale(1); } 75% { opacity: 1; } 100% { opacity: 0; transform: translateY(calc(-10px * var(--u))); } }
.fs-flash { position: absolute; inset: 0; opacity: 0; background: radial-gradient(ellipse at center, rgba(255, 90, 60, 0) 50%, rgba(230, 40, 30, 0.5) 100%); }
.fs-flash.go { animation: fs-flash 0.5s ease-out; }
@keyframes fs-flash { 0% { opacity: 1; } 100% { opacity: 0; } }
.fs-card { position: absolute; left: 50%; bottom: calc(10px * var(--u)); transform: translateX(-50%); display: none; width: min(calc(100% - 16px * var(--u)), calc(250px * var(--u))); padding: calc(8px * var(--u)) calc(11px * var(--u)); gap: calc(9px * var(--u)); align-items: center;
  background: #fff6e6; border: calc(2.5px * var(--u)) solid #5a3a26; border-radius: calc(16px * var(--u)); box-shadow: 0 calc(4px * var(--u)) 0 rgba(90, 58, 38, 0.35); }
.fs-card.on { display: flex; animation: fs-in 0.4s cubic-bezier(.2, 1.4, .4, 1); }
.fs-card.out { opacity: 0; transition: opacity 0.3s; }
@keyframes fs-in { from { transform: translateX(-50%) scale(0.7); opacity: 0; } to { transform: translateX(-50%) scale(1); opacity: 1; } }
.fs-card .fs-ic { width: calc(44px * var(--u)); height: calc(44px * var(--u)); flex: none; border-radius: calc(12px * var(--u)); background: #ffe9cc; display: flex; align-items: center; justify-content: center; }
.fs-card .fs-ic svg { width: 78%; height: 78%; }
.fs-card .fs-tx { min-width: 0; text-align: left; display: flex; flex-direction: column; gap: calc(3px * var(--u)); }
.fs-name { font-size: calc(15px * var(--u)); font-weight: 900; line-height: 1.1; display: flex; align-items: center; gap: calc(6px * var(--u)); flex-wrap: wrap; }
.fs-rar { font-size: calc(10.5px * var(--u)); font-weight: 800; padding: calc(2px * var(--u)) calc(7px * var(--u)); border-radius: calc(8px * var(--u)); border: calc(1.2px * var(--u)) solid #5a3a26; background: #e8dcc6; line-height: 1; }
.fs-rar.uncommon { background: #bfe3ff; }
.fs-rar.rare { background: #ffd23f; }
.fs-rar.special { background: #e2c8ff; }
.fs-quip { font-size: calc(11.5px * var(--u)); font-weight: 700; line-height: 1.35; opacity: 0.85; }
.fs-pts { margin-left: auto; font-size: calc(11px * var(--u)); color: #e0642a; font-weight: 900; }
#fs-hud[data-compact="1"] .fs-quip { display: none; }
#fs-hud[data-tiny="1"] .fs-card .fs-ic { display: none; }
.fs-noteWrap { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; padding: calc(10px * var(--u)); background: rgba(60, 40, 25, 0.3); pointer-events: auto; }
.fs-noteWrap.on { display: flex; }
.fs-note { width: min(100%, calc(270px * var(--u))); max-height: 100%; overflow: hidden; padding: calc(14px * var(--u)) calc(16px * var(--u)) calc(11px * var(--u)); background: #fbf0d2; border: calc(2px * var(--u)) solid #8a5f3c; border-radius: calc(6px * var(--u)) calc(14px * var(--u)) calc(8px * var(--u)) calc(16px * var(--u));
  box-shadow: 0 calc(5px * var(--u)) 0 rgba(90, 58, 38, 0.35); transform: rotate(-1.5deg); animation: fs-unroll 0.7s cubic-bezier(.2, 1.2, .3, 1) both; text-align: center; display: flex; flex-direction: column; gap: calc(8px * var(--u));
  background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(20px * var(--u)), rgba(138, 95, 60, 0.18) calc(20px * var(--u)), rgba(138, 95, 60, 0.18) calc(21px * var(--u))); }
@keyframes fs-unroll { from { transform: rotate(-1.5deg) scaleY(0.05); opacity: 0.3; } to { transform: rotate(-1.5deg) scaleY(1); opacity: 1; } }
.fs-note .fs-nt { font-size: calc(10.5px * var(--u)); font-weight: 800; opacity: 0.6; }
.fs-note .fs-ntext { font-size: calc(15px * var(--u)); font-weight: 800; line-height: 1.55; color: #4a2f1c; text-align: left; }
.fs-note .fs-nfrom { font-size: calc(11.5px * var(--u)); font-weight: 700; text-align: right; opacity: 0.8; }
#fs-hud[data-tiny="1"] .fs-note .fs-ntext { font-size: calc(13px * var(--u)); line-height: 1.4; }
.fs-result { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; padding: calc(8px * var(--u)); background: rgba(60, 40, 25, 0.28); }
.fs-result.on { display: flex; }
.fs-rcard { pointer-events: auto; width: min(100%, calc(320px * var(--u))); max-height: 100%; display: flex; flex-direction: column; align-items: center; gap: calc(6px * var(--u)); padding: calc(12px * var(--u)) calc(14px * var(--u)) calc(11px * var(--u));
  background: #fff6e6; border: calc(2.5px * var(--u)) solid #5a3a26; border-radius: calc(20px * var(--u)); box-shadow: 0 calc(5px * var(--u)) 0 rgba(90, 58, 38, 0.35); animation: fs-in2 0.4s cubic-bezier(.2, 1.4, .4, 1); text-align: center; overflow: hidden; }
@keyframes fs-in2 { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.fs-title { font-size: calc(17px * var(--u)); font-weight: 900; line-height: 1.15; }
.fs-sub { font-size: calc(11.5px * var(--u)); font-weight: 700; opacity: 0.75; line-height: 1.2; }
.fs-stars { display: flex; gap: calc(4px * var(--u)); }
.fs-stars svg { width: calc(30px * var(--u)); height: calc(30px * var(--u)); }
.fs-stars svg.on { animation: fs-star 0.5s cubic-bezier(.2, 1.6, .4, 1) both; }
@keyframes fs-star { from { transform: scale(0) rotate(-40deg); } to { transform: scale(1) rotate(0); } }
.fs-pct { font-size: calc(28px * var(--u)); font-weight: 900; line-height: 1; color: #e0642a; }
.fs-pct small { font-size: calc(12px * var(--u)); color: #5a3a26; margin-left: calc(4px * var(--u)); }
.fs-list { display: flex; flex-wrap: wrap; justify-content: center; gap: calc(4px * var(--u)); width: 100%; }
.fs-item { display: flex; align-items: center; gap: calc(3px * var(--u)); padding: calc(2px * var(--u)) calc(7px * var(--u)) calc(2px * var(--u)) calc(3px * var(--u)); border-radius: calc(10px * var(--u)); background: #ffe9cc; font-size: calc(11px * var(--u)); font-weight: 800; white-space: nowrap; }
.fs-item svg { width: calc(20px * var(--u)); height: calc(20px * var(--u)); flex: none; }
.fs-item.uncommon { background: #d6ecff; }
.fs-item.rare { background: #ffe38a; }
.fs-item.special { background: #ebdaff; }
.fs-item.none { background: #eee4d2; opacity: 0.8; }
.fs-stat { display: flex; gap: calc(8px * var(--u)); font-size: calc(11.5px * var(--u)); font-weight: 800; }
.fs-stat span { padding: calc(2px * var(--u)) calc(8px * var(--u)); border-radius: calc(9px * var(--u)); background: #ffe9cc; }
.fs-btns { display: flex; gap: calc(8px * var(--u)); width: 100%; margin-top: calc(2px * var(--u)); }
.fs-btns button { flex: 1 1 0; min-width: 0; height: calc(30px * var(--u)); border-radius: calc(15px * var(--u)); border: calc(2px * var(--u)) solid #5a3a26; font-weight: 800; font-size: calc(13px * var(--u)); background: #ffe3d2; box-shadow: 0 calc(2px * var(--u)) 0 rgba(90, 58, 38, 0.3); }
.fs-btns button.main { background: #ffb347; }
.fs-btns button:hover { filter: brightness(1.06); }
.fs-btns button:active { transform: translateY(calc(1px * var(--u))); }
#fs-hud[data-compact="1"] .fs-sub, #fs-hud[data-compact="1"] .fs-title, #fs-hud[data-compact="1"] .fs-stat { display: none; }
#fs-hud[data-compact="1"] .fs-stars svg { width: calc(24px * var(--u)); height: calc(24px * var(--u)); }
#fs-hud[data-tiny="1"] .fs-stars svg { width: calc(20px * var(--u)); height: calc(20px * var(--u)); }
#fs-hud[data-tiny="1"] .fs-pct { font-size: calc(22px * var(--u)); }
#fs-hud[data-tiny="1"] .fs-item svg { width: calc(16px * var(--u)); height: calc(16px * var(--u)); }
#fs-hud[data-tiny="1"] .fs-item { font-size: calc(10px * var(--u)); padding-right: calc(5px * var(--u)); }
#fs-hud[data-tiny="1"] .fs-row .fs-lbl { display: none; }
#fs-hud[data-tiny="1"] .fs-hint { font-size: calc(11px * var(--u)); padding: calc(3px * var(--u)) calc(8px * var(--u)); }
#fs-hud[data-tiny="1"] .fs-top { gap: calc(3px * var(--u)); }
#fs-hud[data-tiny="1"] .fs-chip { padding: 0 calc(5px * var(--u)); }
#fs-toast { position: fixed; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 41; max-width: calc(100% - 16px); padding: 6px 12px; border-radius: 13px; background: rgba(255, 246, 230, 0.96); border: 1.5px solid #5a3a26;
  color: #5a3a26; font: 700 12.5px/1.4 "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; text-align: center; pointer-events: none; opacity: 0; transition: opacity 0.25s; box-shadow: 0 2px 0 rgba(90, 58, 38, 0.25); }
#fs-toast.on { opacity: 1; }
`;

const PAIN_ICON = '<svg viewBox="0 0 24 24"><path d="M12 2c3 3.4 5.6 6.2 5.6 10a5.6 5.6 0 0 1-11.2 0C6.4 8.2 9 5.4 12 2Z" fill="#ff7a52" stroke="#5a3a26" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v5" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="#fff"/></svg>';
const PULL_ICON = '<svg viewBox="0 0 24 24"><path d="M3 12c4-6 6-6 9-2s5 4 9-2" fill="none" stroke="#35b86a" stroke-width="2.4" stroke-linecap="round"/><path d="M18 5l3.6 3.2L17.6 11" fill="none" stroke="#35b86a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COIN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#ffc926" stroke="#5a3a26" stroke-width="1.8"/><path d="M12 6.5l1.7 3.6 3.9.5-2.9 2.7.8 3.9-3.5-2-3.5 2 .8-3.9-2.9-2.7 3.9-.5z" fill="#fff1b0" stroke="#5a3a26" stroke-width="1" stroke-linejoin="round"/></svg>';

export function createFishHud(parent) {
  if (typeof document === 'undefined') return null;
  if (!document.getElementById('fs-style')) {
    const st = document.createElement('style');
    st.id = 'fs-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.id = 'fs-hud';
  root.innerHTML = `
    <div class="fs-flash"></div>
    <div class="fs-top">
      <div class="fs-chip fs-dots"></div>
      <div class="fs-chip fs-score">${COIN}<b>0</b></div>
      <div class="fs-spacer"></div>
      <button class="fs-btn fs-exit" type="button" title="退出，回到小岛（Esc）">✕<span class="fs-t"> 回小岛</span></button>
    </div>
    <div class="fs-bang"><span>!</span></div>
    <div class="fs-banner"></div>
    <div class="fs-card"></div>
    <div class="fs-bottom">
      <div class="fs-hint off"></div>
      <div class="fs-fight">
        <div class="fs-state"></div>
        <div class="fs-row">${PULL_ICON}<span class="fs-lbl">拉力</span><div class="fs-meter fs-prog"><i></i></div></div>
        <div class="fs-row">${PAIN_ICON}<span class="fs-lbl">尾巴疼</span><div class="fs-meter fs-pain"><i></i></div></div>
      </div>
    </div>
    <div class="fs-noteWrap"></div>
    <div class="fs-result"><div class="fs-rcard"></div></div>`;
  (parent || document.body).appendChild(root);
  const q = (s) => root.querySelector(s);
  const el = {
    flash: q('.fs-flash'), dots: q('.fs-dots'), score: q('.fs-score'), scoreN: q('.fs-score b'), exit: q('.fs-exit'), bang: q('.fs-bang'), banner: q('.fs-banner'), card: q('.fs-card'),
    hint: q('.fs-hint'), fight: q('.fs-fight'), state: q('.fs-state'), prog: q('.fs-prog > i'), pain: q('.fs-pain > i'), painBox: q('.fs-pain'),
    noteWrap: q('.fs-noteWrap'), result: q('.fs-result'), rcard: q('.fs-rcard'),
  };
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  let toastEl = document.getElementById('fs-toast');
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'fs-toast'; (parent || document.body).appendChild(toastEl); }
  let toastT = 0;

  let lastScore = -1, lastState = '', lastHint = '', lastDots = '', cardTimer = 0;
  const bump = (n) => { n.classList.remove('fs-bump'); void n.offsetWidth; n.classList.add('fs-bump'); };
  const rarCls = (r) => (r === 'uncommon' || r === 'rare' || r === 'special' ? r : '');

  const hud = {
    root, el,
    onExit: null,
    show(on) {
      root.classList.toggle('on', !!on);
      if (on) { lastScore = -1; lastState = ''; lastHint = ''; lastDots = ''; hud.hideCard(true); hud.hideNote(); hud.hideResult(); hud.fight(null); hud.bang(false); }
    },
    resize(w, h) {
      const m = Math.min(w, h * 1.15);
      root.style.setProperty('--u', String(Math.max(0.62, Math.min(1.2, m / 440))));
      root.dataset.compact = m < 380 || h < 330 ? '1' : '';
      root.dataset.tiny = h < 270 || w < 270 ? '1' : '';
    },
    /** results：长度 = 总钩数，每项 'ok' | 'no' | ''；cur = 当前第几钩（0 起）或 -1 */
    setCasts(results, cur) {
      const key = results.join(',') + '|' + cur;
      if (key === lastDots) return;
      lastDots = key;
      el.dots.innerHTML = results.map((r, i) => `<span class="fs-dot ${r}${i === cur ? ' cur' : ''}"></span>`).join('');
      el.dots.title = cur >= 0 ? `第 ${cur + 1} 钩 / 共 ${results.length} 钩` : '';
    },
    setScore(n) { if (n !== lastScore) { if (lastScore >= 0) bump(el.score); lastScore = n; el.scoreN.textContent = String(n); } },
    hint(html, kind) {
      if (html === null || html === undefined) { if (lastHint !== '') { lastHint = ''; el.hint.classList.add('off'); } return; }
      const key = html + '|' + (kind || '');
      if (key === lastHint) return;
      lastHint = key;
      el.hint.innerHTML = html;
      el.hint.classList.toggle('alert', kind === 'alert');
      el.hint.classList.remove('off');
    },
    bang(on) { el.bang.classList.toggle('on', !!on); },
    /** 拉扯面板：null = 隐藏；否则 { progress, pain, mode: 'pull'|'warn'|'hold' } */
    fight(f) {
      if (!f) { el.fight.classList.remove('on'); return; }
      el.fight.classList.add('on');
      el.prog.style.transform = `scaleX(${Math.max(0, Math.min(1, f.progress)).toFixed(3)})`;
      el.pain.style.transform = `scaleX(${Math.max(0, Math.min(1, f.pain)).toFixed(3)})`;
      el.painBox.classList.toggle('hot', f.pain > 0.6);
      if (f.mode !== lastState) {
        lastState = f.mode;
        el.state.className = 'fs-state ' + f.mode;
        el.state.textContent = f.mode === 'hold' ? '它在挣扎！快松手！' : f.mode === 'warn' ? '要挣扎了…松手！' : '现在拉！按住鼠标';
      }
    },
    banner(text) { el.banner.textContent = text; el.banner.classList.remove('go'); void el.banner.offsetWidth; el.banner.classList.add('go'); },
    flashRed() { el.flash.classList.remove('go'); void el.flash.offsetWidth; el.flash.classList.add('go'); },
    card(def, rarityLabel, quip, points) {
      clearTimeout(cardTimer);
      el.card.classList.remove('out');
      el.card.innerHTML = `<div class="fs-ic">${iconOf(def.id)}</div><div class="fs-tx"><div class="fs-name">${def.name}<span class="fs-rar ${rarCls(def.rarity)}">${rarityLabel}</span>${points ? `<span class="fs-pts">+${points}</span>` : ''}</div><div class="fs-quip">${quip}</div></div>`;
      el.card.classList.remove('on'); void el.card.offsetWidth; el.card.classList.add('on');
    },
    hideCard(now) {
      if (now) { el.card.classList.remove('on', 'out'); return; }
      el.card.classList.add('out');
      clearTimeout(cardTimer);
      cardTimer = setTimeout(() => el.card.classList.remove('on', 'out'), 320);
    },
    /** 漂流瓶纸条：点“收下”或点任意处关闭 */
    note(msg, onClose) {
      const from = msg && msg.from ? `<div class="fs-nfrom">——${msg.from}</div>` : '';
      el.noteWrap.innerHTML = `<div class="fs-note"><div class="fs-nt">漂流瓶里的纸条</div><div class="fs-ntext"></div>${from}<div class="fs-btns"><button type="button" class="fs-btn main" data-a="ok">收下</button></div></div>`;
      el.noteWrap.querySelector('.fs-ntext').textContent = (msg && msg.text) || '……（纸条上的字迹已经模糊了）';
      el.noteWrap.classList.add('on');
      const close = () => { el.noteWrap.classList.remove('on'); hud._noteClose = null; if (onClose) onClose(); };
      hud._noteClose = close;
      el.noteWrap.querySelector('[data-a="ok"]').addEventListener('click', close);
      el.noteWrap.addEventListener('click', (e) => { if (e.target === el.noteWrap) close(); }, { once: true });
    },
    hideNote() { el.noteWrap.classList.remove('on'); hud._noteClose = null; },
    get noteOpen() { return el.noteWrap.classList.contains('on'); },
    toast(text, ms = 2400) {
      toastEl.textContent = text;
      toastEl.classList.add('on');
      clearTimeout(toastT);
      toastT = setTimeout(() => toastEl.classList.remove('on'), ms);
    },
    showResult(res, rarityLabels, { onAgain, onExit }) {
      const stars = [1, 2, 3].map((i) => STAR_ICON(i <= res.stars)).join('');
      const msg = res.stars === 3 ? '大丰收！小柴的尾巴今天超有用！' : res.stars === 2 ? '收获不错，下次还想来钓！' : '慢慢来，小柴的尾巴还在热身呢。';
      const items = res.catches.length
        ? res.catches.map((c) => `<span class="fs-item ${rarCls(c.rarity)}" title="${rarityLabels[c.rarity] || ''} +${c.points}">${iconOf(c.id)}${c.name}</span>`).join('')
        : '<span class="fs-item none">这一局什么都没钓到</span>';
      el.rcard.innerHTML = `
        <div class="fs-title">钓鱼结束！</div>
        <div class="fs-stars">${stars}</div>
        <div class="fs-pct">${res.completion}<small>% 完成度</small></div>
        <div class="fs-sub">${msg}</div>
        <div class="fs-list">${items}</div>
        <div class="fs-stat"><span>得分 <b>${res.score}</b></span><span>钓上 <b>${res.landed}/${res.casts}</b></span>${res.prank ? '<span>被大鱼拽下水 1 次</span>' : ''}</div>
        <div class="fs-btns"><button type="button" class="fs-btn main" data-a="again">再来一局</button><button type="button" class="fs-btn" data-a="exit">回小岛</button></div>`;
      el.rcard.querySelector('[data-a="again"]').addEventListener('click', () => onAgain && onAgain());
      el.rcard.querySelector('[data-a="exit"]').addEventListener('click', () => onExit && onExit());
      el.result.classList.add('on');
      hud.fight(null); hud.bang(false); hud.hint(null); hud.hideCard(true);
    },
    hideResult() { el.result.classList.remove('on'); },
    get resultVisible() { return el.result.classList.contains('on'); },
    dispose() { root.remove(); if (toastEl) toastEl.remove(); },
  };
  el.exit.addEventListener('click', () => hud.onExit && hud.onExit());
  return hud;
}
