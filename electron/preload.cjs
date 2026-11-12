'use strict';
/*
 * 桌宠外壳注入（preload，隔离上下文 + sandbox）。只做三件事：
 *  1) contextBridge 暴露 window.petShell（只读信息，不暴露通用 IPC）；
 *  2) 在 DOMContentLoaded 后向 body 注入顶部拖动把手与右下角缩放手柄（插在 #app 之外，
 *     画面的 canvas 收不到这些元素上的事件，且这里还额外 stopPropagation）；
 *  3) 缩放手柄的指针增量经 IPC 交给主进程，由主进程 setBounds。
 * 截图模式（--capture）下不注入任何 UI，保证截图只有画面。
 */
const { contextBridge, ipcRenderer } = require('electron');

const cfg = ipcRenderer.sendSync('shell:config') || {};

contextBridge.exposeInMainWorld(
  'petShell',
  Object.freeze({
    isElectron: true,
    capture: !!cfg.capture,
    platform: String(cfg.platform || ''),
    version: String(cfg.version || ''),
    /** true = 鼠标事件穿过窗口落到下面的程序（鼠标移动仍会转发给页面，用来判断何时恢复） */
    setClickThrough: (v) => ipcRenderer.send('shell:ignore', !!v),
  }),
);

const CSS = `
.pet-shell-drag, .pet-shell-grip {
  position: fixed; z-index: 2147483646; box-sizing: border-box;
  user-select: none; -webkit-user-select: none; transition: opacity 0.2s ease;
}
.pet-shell-drag {
  top: 6px; left: 50%; width: 64px; height: 18px; margin-left: -32px;
  border-radius: 9px; background: rgba(90, 60, 30, 0.34);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
  -webkit-app-region: drag; cursor: move; opacity: 0; pointer-events: none;
}
.pet-shell-drag::after {
  content: ""; position: absolute; left: 50%; top: 50%;
  width: 26px; height: 4px; margin: -2px 0 0 -13px; border-radius: 2px;
  background: rgba(255, 255, 255, 0.85);
}
.pet-shell-grip {
  right: 3px; bottom: 3px; width: 22px; height: 22px; border-radius: 7px;
  background: rgba(90, 60, 30, 0.3); cursor: nwse-resize; touch-action: none;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none;
}
.pet-shell-grip svg { display: block; }
html.pet-shell-hover .pet-shell-drag { opacity: 1; pointer-events: auto; }
html.pet-shell-hover .pet-shell-grip { opacity: 1; pointer-events: auto; }
`;

// 这些事件到达外壳元素后都不再向上冒泡（画面的扔木棍、面板等只监听画面内的事件）
const STOP_EVENTS = [
  'pointerdown', 'pointerup', 'pointermove', 'pointercancel',
  'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu',
  'touchstart', 'touchend', 'touchmove', 'wheel',
];

function stopAll(el) {
  for (const ev of STOP_EVENTS) el.addEventListener(ev, (e) => e.stopPropagation());
}

function setupShell() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);


  const grip = document.createElement('div');
  grip.className = 'pet-shell-grip';
  grip.title = '拖拽缩放';
  grip.innerHTML =
    '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">' +
    '<path d="M9 1 1 9M9 5 5 9" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>';
  stopAll(grip);

  let rs = null; // { id, x0, y0 }：pointerdown 时的屏幕坐标
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      grip.setPointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    rs = { id: e.pointerId, x0: e.screenX, y0: e.screenY };
    ipcRenderer.send('shell:resize-start');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!rs || e.pointerId !== rs.id) return;
    ipcRenderer.send('shell:resize-move', { dx: e.screenX - rs.x0, dy: e.screenY - rs.y0 });
  });
  const endResize = (e) => {
    if (!rs || (e && e.pointerId !== rs.id)) return;
    try {
      grip.releasePointerCapture(rs.id);
    } catch (_) {
      /* ignore */
    }
    rs = null;
    ipcRenderer.send('shell:resize-end');
  };
  grip.addEventListener('pointerup', endResize);
  grip.addEventListener('pointercancel', endResize);
  grip.addEventListener('lostpointercapture', endResize);

  // 主进程每 120ms 轮询光标是否在窗口内，据此显示/隐藏把手（拖动把手区域不会把指针事件送进页面）
  ipcRenderer.on('shell:hover', (_e, inside) => {
    document.documentElement.classList.toggle('pet-shell-hover', !!inside);
  });

  document.body.append(grip);

  // 左键按住画面拖动 = 移动整个窗口（移动超过 5 像素才算拖动，否则仍是一次点击）
  let mv = null;
  const endMove = () => {
    if (mv && mv.active) ipcRenderer.send('shell:move-end');
    mv = null;
  };
  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.target || e.target.tagName !== 'CANVAS') return;
    if (document.documentElement.dataset.petNoDrag === '1') return; // 正在摸小狗：按住来回搓不算拖窗口
    mv = { id: e.pointerId, x0: e.screenX, y0: e.screenY, active: false };
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!mv || e.pointerId !== mv.id) return;
    if (!(e.buttons & 1)) { endMove(); return; }
    const dx = e.screenX - mv.x0, dy = e.screenY - mv.y0;
    if (!mv.active && Math.hypot(dx, dy) > 5) {
      mv.active = true;
      try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      ipcRenderer.send('shell:move-start');
    }
    if (mv.active) ipcRenderer.send('shell:move', { dx, dy });
  }, true);
  window.addEventListener('pointerup', endMove, true);
  window.addEventListener('pointercancel', endMove, true);
  window.addEventListener('blur', endMove);
}

if (!cfg.capture) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupShell, { once: true });
  else setupShell();
}
