// 农场小游戏的界面（DOM 叠加层，像素风的方角小面板）：
//   顶部：剩余时间、捣乱分、管理员的火气条、被抓次数；中上：横幅（“全场通缉！”等）；底部：操作提示；
//   飘字（+分）、区域清单提示、对端宠物的名字牌和气泡、指向出口的箭头、结算面板。
// createFarmHud(parent) → hud（各方法见下）。纯界面，不含玩法逻辑。
const css = (el, o) => { Object.assign(el.style, o); return el; };
const div = (o, text) => { const e = css(document.createElement('div'), o); if (text !== undefined) e.textContent = text; return e; };
const FONT = '"Cascadia Mono","Consolas","Microsoft YaHei UI","Microsoft YaHei",monospace';
const INK = '#3b2414', PAPER = '#fff3d6', EDGE = '#3b2414';
const box = (extra = {}) => ({ background: PAPER, color: INK, border: `3px solid ${EDGE}`, boxShadow: '0 3px 0 rgba(59,36,20,0.55)', font: `700 14px/1.2 ${FONT}`, padding: '4px 9px', borderRadius: '2px', ...extra });

export function createFarmHud(parent) {
  const root = div({ position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '25', display: 'none', userSelect: 'none', overflow: 'hidden' });
  root.className = 'farm-hud';
  (parent || document.body).appendChild(root);

  // ---- 顶部状态条
  const top = div({ position: 'absolute', left: '8px', right: '8px', top: '8px', display: 'flex', gap: '6px', alignItems: 'stretch', flexWrap: 'wrap' });
  const timeEl = div(box({ minWidth: '58px', textAlign: 'center' }), '5:00');
  const scoreEl = div(box({ minWidth: '70px', textAlign: 'center' }), '捣乱 0');
  const angerWrap = div(box({ display: 'flex', alignItems: 'center', gap: '6px', flex: '1 1 110px', minWidth: '110px' }));
  const angerFace = div({ flex: 'none' }, '管理员');
  const angerBar = div({ flex: '1', height: '10px', background: '#e8d7ae', border: `2px solid ${EDGE}`, position: 'relative' });
  const angerFill = div({ position: 'absolute', left: '0', top: '0', bottom: '0', width: '0%', background: '#f0a23a' });
  angerBar.appendChild(angerFill); angerWrap.append(angerFace, angerBar);
  const caughtEl = div(box({ letterSpacing: '2px' }), '♥♥♥');
  top.append(timeEl, scoreEl, angerWrap, caughtEl);

  const bannerEl = div({ ...box({ font: `700 20px/1.2 ${FONT}`, padding: '8px 16px', background: '#ffd75a' }), position: 'absolute', left: '50%', top: '22%', transform: 'translateX(-50%)', opacity: '0', transition: 'opacity 0.2s', whiteSpace: 'nowrap' });
  const toastEl = div({ ...box({ background: '#3b2414', color: PAPER, border: `3px solid ${PAPER}` }), position: 'absolute', left: '50%', top: '56px', transform: 'translateX(-50%)', opacity: '0', transition: 'opacity 0.2s', whiteSpace: 'nowrap' });
  const hintEl = div({ ...box({ font: `600 12px/1.3 ${FONT}`, background: 'rgba(255,243,214,0.92)' }), position: 'absolute', left: '50%', bottom: '10px', transform: 'translateX(-50%)', whiteSpace: 'nowrap', maxWidth: 'calc(100% - 16px)', overflow: 'hidden', textOverflow: 'ellipsis' });
  const arrowEl = div({ position: 'absolute', left: '0', top: '0', width: '0', height: '0', display: 'none' });
  const arrowIn = div({ ...box({ background: '#7ee08a', padding: '3px 7px', font: `700 13px/1 ${FONT}` }), position: 'absolute', transform: 'translate(-50%,-50%)', whiteSpace: 'nowrap' }, '出口');
  arrowEl.appendChild(arrowIn);
  const layer = div({ position: 'absolute', inset: '0' }); // 飘字、名字牌
  root.append(layer, top, bannerEl, toastEl, hintEl, arrowEl);

  // ---- 结算面板
  const result = div({ position: 'absolute', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center', background: 'rgba(30,18,8,0.45)', pointerEvents: 'auto' });
  const card = div(box({ padding: '14px 18px', minWidth: '210px', maxWidth: '86%', textAlign: 'center', font: `700 14px/1.5 ${FONT}` }));
  const rTitle = div({ font: `700 20px/1.3 ${FONT}` });
  const rStars = div({ font: `700 28px/1.2 ${FONT}`, letterSpacing: '4px', color: '#f0a23a', margin: '4px 0' });
  const rBody = div({ font: `600 13px/1.6 ${FONT}`, textAlign: 'left', margin: '6px 0 10px' });
  const rBtns = div({ display: 'flex', gap: '8px', justifyContent: 'center' });
  const mkBtn = (label, bg) => { const b = css(document.createElement('button'), { ...box({ background: bg, cursor: 'pointer', font: `700 14px/1.2 ${FONT}`, padding: '6px 14px' }) }); b.type = 'button'; b.textContent = label; return b; };
  const btnAgain = mkBtn('再来一局', '#ffd75a'), btnExit = mkBtn('回小岛', '#bfe6a8');
  rBtns.append(btnAgain, btnExit); card.append(rTitle, rStars, rBody, rBtns); result.appendChild(card); root.appendChild(result);
  let onAgain = null, onExit = null;
  btnAgain.addEventListener('click', (e) => { e.stopPropagation(); if (onAgain) onAgain(); });
  btnExit.addEventListener('click', (e) => { e.stopPropagation(); if (onExit) onExit(); });

  // ---- 暂停遮罩（切到别的窗口时）
  const pauseEl = div({ position: 'absolute', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center', background: 'rgba(30,18,8,0.5)', pointerEvents: 'none' });
  const pauseCard = div(box({ padding: '12px 18px', textAlign: 'center', font: `700 18px/1.4 ${FONT}`, background: '#ffd75a' }));
  pauseCard.append(div({}, '已暂停'), div({ font: `600 13px/1.5 ${FONT}` }, '点一下或按任意键继续　·　Esc 退出'));
  pauseEl.appendChild(pauseCard); root.appendChild(pauseEl);

  let bannerT = 0, toastT = 0;
  const pops = [];            // 飘字 { el, t, x, y }
  const plates = new Map();   // 名字牌 id → { el, name, bubble, bubbleT }
  const marks = new Map();    // 捣乱点的标记 id → { el, text }

  const hud = {
    el: root, resultVisible: false, pauseVisible: false, lastToast: '', lastBanner: '',
    show(on) { root.style.display = on ? 'block' : 'none'; if (!on) { hud.hideResult(); hud.pause(false); hud.clear(); } },
    /** 暂停遮罩 */
    pause(on) { pauseEl.style.display = on ? 'flex' : 'none'; hud.pauseVisible = !!on; },
    clear() { for (const p of pops) p.el.remove(); pops.length = 0; for (const p of plates.values()) p.el.remove(); plates.clear(); for (const m of marks.values()) m.el.remove(); marks.clear(); bannerEl.style.opacity = '0'; toastEl.style.opacity = '0'; arrowEl.style.display = 'none'; },
    setTime(left) { const s = Math.max(0, Math.ceil(left)); timeEl.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); timeEl.style.background = s <= 60 ? '#ffb0a0' : PAPER; },
    setScore(n) { scoreEl.textContent = '捣乱 ' + Math.round(n); },
    /** 火气 0..1；chasing = 正在追 */
    setAnger(v, chasing) { angerFill.style.width = Math.round(Math.min(1, Math.max(0, v)) * 100) + '%'; angerFill.style.background = chasing ? '#e2432f' : v > 0.6 ? '#f07a3a' : '#f0a23a'; angerFace.textContent = chasing === 'shoo' ? '在赶你！' : chasing === 'come' ? '赶来中…' : chasing ? '追来了！' : '管理员'; angerWrap.style.background = chasing ? '#ffd0c4' : PAPER; },
    setCaught(n, max) { caughtEl.textContent = '♥'.repeat(Math.max(0, max - n)) + '♡'.repeat(Math.min(max, n)); },
    hint(html) { if (html) { hintEl.innerHTML = html; hintEl.style.display = 'block'; } else hintEl.style.display = 'none'; },
    banner(text, sec = 2.2, bg = '#ffd75a') { hud.lastBanner = text; bannerEl.textContent = text; bannerEl.style.background = bg; bannerEl.style.opacity = '1'; bannerT = sec; },
    toast(text, sec = 2.4) { hud.lastToast = text; toastEl.textContent = text; toastEl.style.opacity = '1'; toastT = sec; },
    /** 在屏幕坐标 (x, y) 冒一个飘字 */
    popup(x, y, text, color = '#fff3d6') {
      const el = div({ position: 'absolute', left: '0', top: '0', font: `700 16px/1 ${FONT}`, color, textShadow: `2px 0 ${EDGE}, -2px 0 ${EDGE}, 0 2px ${EDGE}, 0 -2px ${EDGE}`, whiteSpace: 'nowrap', willChange: 'transform' }, text);
      layer.appendChild(el); pops.push({ el, t: 0, x, y });
      if (pops.length > 14) { const p = pops.shift(); p.el.remove(); }
    },
    /** 出口箭头：给屏幕坐标（已夹在画面内）；null = 不显示 */
    setArrow(p) { if (!p) { arrowEl.style.display = 'none'; return; } arrowEl.style.display = 'block'; arrowEl.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`; },
    /** 名字牌：每帧给出 [{ id, name, x, y }]（屏幕坐标）；不在列表里的自动移除 */
    setPlates(list) {
      const seen = new Set();
      for (const it of list) {
        seen.add(it.id);
        let p = plates.get(it.id);
        if (!p) {
          const el = div({ position: 'absolute', left: '0', top: '0', transform: 'translate(-50%,-100%)', textAlign: 'center', whiteSpace: 'nowrap', willChange: 'transform' });
          const bub = div({ ...box({ font: `600 12px/1.2 ${FONT}`, padding: '2px 6px', background: '#ffffff' }), display: 'none', marginBottom: '3px' });
          const nm = div({ font: `700 12px/1 ${FONT}`, color: '#fff3d6', textShadow: `1px 0 ${EDGE}, -1px 0 ${EDGE}, 0 1px ${EDGE}, 0 -1px ${EDGE}` }, it.name);
          el.append(bub, nm); layer.appendChild(el);
          p = { el, bub, nm, bubbleT: 0 }; plates.set(it.id, p);
        }
        p.el.style.transform = `translate(${Math.round(it.x)}px, ${Math.round(it.y)}px) translate(-50%,-100%)`;
      }
      for (const [id, p] of plates) if (!seen.has(id)) { p.el.remove(); plates.delete(id); }
    },
    /**
     * 捣乱点的标记：每帧给出 [{ id, x, y, text }]（屏幕坐标）。text 为空 = 只显示一个小感叹号（这里有东西可以捣乱）；
     * 有 text = 小狗已经走到跟前，显示怎么操作。不在列表里的自动移除。
     */
    setMarks(list) {
      const seen = new Set();
      for (const it of list) {
        seen.add(it.id);
        let m = marks.get(it.id);
        if (!m) {
          const el = div({ position: 'absolute', left: '0', top: '0', whiteSpace: 'nowrap', willChange: 'transform' });
          layer.appendChild(el); m = { el, text: undefined }; marks.set(it.id, m);
        }
        const text = it.text || '';
        if (text !== m.text) {
          m.text = text;
          css(m.el, text
            ? { ...box({ font: `700 13px/1.2 ${FONT}`, padding: '3px 8px', background: '#ffe36a' }), zIndex: '2' }
            : { ...box({ font: `700 12px/1 ${FONT}`, padding: '1px 5px', background: '#ffe36a', borderWidth: '2px', boxShadow: '0 2px 0 rgba(59,36,20,0.55)' }), zIndex: '1' });
          m.el.textContent = text || '!';
        }
        m.el.style.transform = `translate(${Math.round(it.x)}px, ${Math.round(it.y)}px) translate(-50%,-100%)`;
      }
      for (const [id, m] of marks) if (!seen.has(id)) { m.el.remove(); marks.delete(id); }
    },
    markCount: () => marks.size,
    markTexts: () => [...marks.values()].map((m) => m.text).filter(Boolean),
    /** 某只宠物头顶冒气泡（表情符号或一句话） */
    bubble(id, text, sec = 2.6) { const p = plates.get(id); if (!p) return false; p.bub.textContent = text; p.bub.style.display = 'inline-block'; p.bubbleT = sec; return true; },
    plateCount: () => plates.size,
    showResult(res, cb = {}) {
      onAgain = cb.onAgain || null; onExit = cb.onExit || null;
      rTitle.textContent = res.escaped ? '溜之大吉！' : res.caught >= 3 ? '被牵回家了…' : '时间到！';
      rStars.textContent = '★'.repeat(res.stars) + '☆'.repeat(Math.max(0, 3 - res.stars));
      const kinds = Object.values(res.mischief || {}).reduce((a, b) => a + b, 0);
      rBody.innerHTML = `捣乱分　${Math.round(res.score)}<br>完成度　${Math.round(res.completion)}%<br>捣乱次数　${kinds}<br>清空区域　${res.zonesCleared || 0}<br>被抓　${res.caught} 次`;
      result.style.display = 'flex'; hud.resultVisible = true;
    },
    hideResult() { result.style.display = 'none'; hud.resultVisible = false; },
    update(dt) {
      if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) bannerEl.style.opacity = '0'; }
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.style.opacity = '0'; }
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i]; p.t += dt;
        const u = p.t / 0.9;
        if (u >= 1) { p.el.remove(); pops.splice(i, 1); continue; }
        p.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - 34 * u)}px) translate(-50%,-50%)`;
        p.el.style.opacity = String(u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3);
      }
      for (const p of plates.values()) if (p.bubbleT > 0) { p.bubbleT -= dt; if (p.bubbleT <= 0) p.bub.style.display = 'none'; }
    },
    dispose() { root.remove(); },
  };
  return hud;
}

export default createFarmHud;
