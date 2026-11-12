// 悬停右上角才浮现的小控制面板：纯 DOM + 内联样式。
// 面板上的指针事件一律 stopPropagation，且面板不在 canvas 内，因此不会触发扔木棍。

const WEATHER_LABEL = { clear: '晴', cloudy: '阴', rain: '雨', storm: '雷雨' };
const PHASE_LABEL = { night: '夜', dawn: '清晨', day: '白天', dusk: '黄昏' };

const TIME_BTNS = [
  { label: '跟随系统', hour: null },
  { label: '清晨', hour: 6.5 },
  { label: '正午', hour: 12 },
  { label: '黄昏', hour: 18.25 },
  { label: '深夜', hour: 1 },
];
const WEATHER_BTNS = [
  { label: '自动', w: null },
  { label: '晴', w: 'clear' },
  { label: '阴', w: 'cloudy' },
  { label: '雨', w: 'rain' },
  { label: '雷雨', w: 'storm' },
];

function css(el, styles) {
  Object.assign(el.style, styles);
  return el;
}

function fmtHour(h) {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

/**
 * @param {{ parent?: HTMLElement, env: object, getStatus?: () => {dogAction?: string, brainState?: string}, alwaysOn?: boolean }} opts
 */
export function createPanel({ parent, env, getStatus, alwaysOn = false }) {
  if (typeof document === 'undefined') return null;
  parent = parent || document.body;

  // 热区：折叠时只有 44x44，悬停后扩展成面板大小
  const zone = css(document.createElement('div'), {
    position: 'absolute', top: '0', right: '0', width: '44px', height: '44px', zIndex: '20',
    font: '12px/1.4 system-ui, "Microsoft YaHei", sans-serif', color: '#4a3b2a', userSelect: 'none',
    webkitAppRegion: 'no-drag', cursor: 'default',
  });
  zone.dataset.petPanel = '1';

  const card = css(document.createElement('div'), {
    position: 'absolute', top: '10px', right: '10px', width: '212px', boxSizing: 'border-box', padding: '10px 12px 12px',
    background: 'rgba(255, 248, 232, 0.88)', backdropFilter: 'blur(10px)', webkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(160, 120, 70, 0.25)', borderRadius: '14px', boxShadow: '0 6px 22px rgba(80, 50, 20, 0.22)',
    opacity: '0', transform: 'translateY(-6px) scale(0.98)', transformOrigin: 'top right', pointerEvents: 'none',
    transition: 'opacity 0.18s ease, transform 0.18s ease',
  });
  zone.appendChild(card);

  // 折叠态的小提示点
  const dot = css(document.createElement('div'), {
    position: 'absolute', top: '12px', right: '12px', width: '8px', height: '8px', borderRadius: '50%',
    background: 'rgba(255,255,255,0.55)', boxShadow: '0 0 0 1px rgba(120,90,50,0.25)', transition: 'opacity 0.18s ease', opacity: '0.0',
  });
  zone.appendChild(dot);

  const title = css(document.createElement('div'), { fontWeight: '600', fontSize: '13px', marginBottom: '2px', letterSpacing: '1px' });
  title.textContent = '柴犬小岛';
  const status1 = css(document.createElement('div'), { fontSize: '12px', color: '#6b563d' });
  const status2 = css(document.createElement('div'), { fontSize: '11px', color: '#8a7358', marginBottom: '8px' });
  card.append(title, status1, status2);

  const groups = [];
  function makeGroup(name, defs, onPick) {
    const label = css(document.createElement('div'), { fontSize: '11px', color: '#8a7358', margin: '6px 0 3px' });
    label.textContent = name;
    const row = css(document.createElement('div'), { display: 'flex', flexWrap: 'wrap', gap: '4px' });
    const btns = defs.map((d, i) => {
      const b = css(document.createElement('button'), {
        font: 'inherit', fontSize: '11.5px', padding: '3px 8px', borderRadius: '9px', cursor: 'pointer',
        border: '1px solid rgba(160,120,70,0.28)', background: 'rgba(255,255,255,0.65)', color: '#5a452c', outline: 'none',
        transition: 'background 0.12s, color 0.12s',
      });
      b.type = 'button';
      b.textContent = d.label;
      b.addEventListener('click', () => {
        onPick(d);
        setActive(btns, i);
      });
      row.appendChild(b);
      return b;
    });
    card.append(label, row);
    groups.push(btns);
    return btns;
  }
  function setActive(btns, idx) {
    btns.forEach((b, i) => {
      const on = i === idx;
      b.style.background = on ? '#e2993f' : 'rgba(255,255,255,0.65)';
      b.style.color = on ? '#fff' : '#5a452c';
      b.style.borderColor = on ? '#e2993f' : 'rgba(160,120,70,0.28)';
    });
  }
  const timeBtns = makeGroup('时间', TIME_BTNS, (d) => env.setHour(d.hour));
  const weatherBtns = makeGroup('天气', WEATHER_BTNS, (d) => env.setWeather(d.w));
  setActive(timeBtns, 0);
  setActive(weatherBtns, 0);

  // 阻止面板上的指针事件冒泡（不会触发木棍、也不会被外层拖拽逻辑当成画面点击）
  for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart']) {
    zone.addEventListener(ev, (e) => e.stopPropagation());
  }

  let open = false;
  let closeTimer = 0;
  function setOpen(v) {
    open = v || alwaysOn;
    zone.style.width = open ? '236px' : '44px';
    zone.style.height = open ? card.offsetHeight + 20 + 'px' : '44px';
    card.style.opacity = open ? '1' : '0';
    card.style.transform = open ? 'none' : 'translateY(-6px) scale(0.98)';
    card.style.pointerEvents = open ? 'auto' : 'none';
    dot.style.opacity = open ? '0' : '0';
  }
  zone.addEventListener('mouseenter', () => {
    clearTimeout(closeTimer);
    setOpen(true);
  });
  zone.addEventListener('mouseleave', () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setOpen(false), 250);
  });

  function refresh() {
    const wl = WEATHER_LABEL[env.weather] || env.weather;
    status1.textContent = `${fmtHour(env.hour)} · ${PHASE_LABEL[env.phase] || env.phase} · ${wl}`;
    const s = getStatus ? getStatus() : {};
    status2.textContent = `狗：${s.dogAction || '-'}　${s.brainState || ''}`;
  }
  refresh();
  const timer = setInterval(refresh, 250);

  parent.appendChild(zone);
  // 初始布局完成后再计算高度（常显时）
  requestAnimationFrame(() => setOpen(alwaysOn));

  return {
    el: zone,
    setOpen,
    refresh,
    destroy() {
      clearInterval(timer);
      clearTimeout(closeTimer);
      zone.remove();
    },
  };
}

export default createPanel;
