// 画面顶部的小提示条：“小柴乘着白鹭出门了，18:00 回来 [叫它回来]”，以及一闪而过的短提示（比如出门期间点了玩具架）。
// createAwayHint({ parent, onRecall }) → { show(text, { recall }), hide(), toast(text), visible, el }
const css = (el, o) => { Object.assign(el.style, o); return el; };

export function createAwayHint({ parent, onRecall }) {
  const host = parent || document.body;
  const wrap = css(document.createElement('div'), {
    position: 'absolute', left: '50%', top: '10px', transform: 'translateX(-50%)', zIndex: '30',
    display: 'none', alignItems: 'center', gap: '8px', maxWidth: 'calc(100% - 24px)', boxSizing: 'border-box',
    padding: '6px 8px 6px 14px', borderRadius: '999px',
    background: 'rgba(255,248,232,0.94)', boxShadow: '0 3px 12px rgba(40,20,5,0.22)',
    color: '#4a2a14', font: '13px/1.35 "Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif',
    userSelect: 'none', whiteSpace: 'nowrap', opacity: '0', transition: 'opacity 0.25s ease',
  });
  wrap.className = 'pet-away-hint';
  const text = css(document.createElement('span'), { overflow: 'hidden', textOverflow: 'ellipsis' });
  const btn = css(document.createElement('button'), {
    border: 'none', borderRadius: '999px', padding: '4px 11px', cursor: 'pointer', flex: 'none',
    background: '#c9783a', color: '#fff8e8', font: 'inherit', fontWeight: '600',
  });
  btn.type = 'button';
  btn.textContent = '叫它回来';
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (onRecall) onRecall(); });
  wrap.append(text, btn);

  const tip = css(document.createElement('div'), {
    position: 'absolute', left: '50%', top: '52px', transform: 'translateX(-50%)', zIndex: '30', pointerEvents: 'none',
    padding: '5px 13px', borderRadius: '999px', background: 'rgba(74,42,20,0.82)', color: '#fff8e8',
    font: '13px/1.35 "Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif', whiteSpace: 'nowrap',
    opacity: '0', transition: 'opacity 0.25s ease',
  });
  host.append(wrap, tip);

  let tipTimer = 0;
  const hint = {
    el: wrap, visible: false, text: '',
    show(t, { recall = true } = {}) {
      hint.visible = true; hint.text = t;
      text.textContent = t;
      btn.style.display = recall ? '' : 'none';
      wrap.style.padding = recall ? '6px 8px 6px 14px' : '6px 14px';
      wrap.style.display = 'flex';
      requestAnimationFrame(() => { wrap.style.opacity = '1'; });
      wrap.style.opacity = '1';
    },
    hide() {
      hint.visible = false; hint.text = '';
      wrap.style.opacity = '0';
      wrap.style.display = 'none';
    },
    /** 一闪而过的短提示 */
    toast(t, ms = 2200) {
      hint.lastToast = t;
      tip.textContent = t;
      tip.style.top = hint.visible ? '52px' : '12px';
      tip.style.opacity = '1';
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => { tip.style.opacity = '0'; }, ms);
    },
    lastToast: '',
  };
  return hint;
}

export default createAwayHint;
