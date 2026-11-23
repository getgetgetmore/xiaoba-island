// 换装的入口流程：点小屋正面 → 镜头转到正对小屋、从拱门推进屋里 → 后墙上衣帽间的门自己打开 → 画面淡入衣帽间（另一个小场景）；
// 点“返回小岛”或按 Esc → 淡出 → 镜头从屋里退出来、门关上 → 回到平时的镜头。
// 衣帽间里面的玩法（走动、转视角、逛橱柜、照镜子、自拍、拍照区）在 closet.js，这里只管怎么进、怎么出。
//
// createWardrobe(ctx, { createRoom }) → wardrobe = {
//   active, phase, inRoom, hover,
//   camW, camPos, camLook, camFov, // 给 main.js：camW 0..1 = 脚本镜头占多少（0 = 完全是平时的镜头），camPos / camLook / camFov 是脚本镜头的位置、注视点和视角
//   room,                       // 衣帽间场景（inRoom 时 main.js 画它）
//   canOpen(), open(), close(), update(dt), resize(w, h), info(),
// }
// 阶段 phase：idle → in（镜头推进）→ door（开门、继续往里、末尾淡到暖白）→ reveal（衣帽间淡入）→ room → leave（淡到暖白）→ out（退出来、关门）→ idle。
// 小狗：整个过程由 brain 的 game 模式托管（下雨、夜里也能进，brain.enterGame 的 anytime）。在岛上的阶段它原地待着；
// 进了衣帽间把小狗模型挂到衣帽间场景里，出来再挂回去（位置由 brain 的 mover 下一帧写回）。
import * as THREE from 'three';
import { createCloset, applySavedOutfit } from './closet.js';

const T = { face: 1.4, push: 1.2, door: 1.45, fade: 0.38, reveal: 0.45, leave: 0.3, out: 1.6 }; // 各阶段的时长（秒）
const FADE_COLOR = '#fff1d0';
const FONT = '"Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif';
const css = (el, o) => { Object.assign(el.style, o); return el; };
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

export function createWardrobe(ctx, { createRoom } = {}) {
  const island = ctx.island, door = island && island.wardrobeDoor, dog = ctx.dog, brain = ctx.brain;
  const canvas = ctx.renderer ? ctx.renderer.domElement : null;
  const W = {
    active: false, phase: 'idle', inRoom: false, hover: false,
    camW: 0, camPos: new THREE.Vector3(), camLook: new THREE.Vector3(), camFov: 32,
    room: null, closet: null,
    canOpen, open, close, update, resize, info,
  };
  if (!door || !dog || !brain || !canvas) return W; // stub 小岛 / 没有 brain：没有这个功能
  applySavedOutfit(dog); // 启动时把上次穿的那身穿上（岛上、小游戏里也穿着）

  // ---- 镜头路线上的几个点（世界坐标）：A 小屋正前方，B 屋子中间，D 贴近衣帽间的门
  const C = door.center, N = door.normal, UP = new THREE.Vector3(0, 1, 0);
  const at = (n, up) => new THREE.Vector3().copy(C).addScaledVector(N, n).addScaledVector(UP, up);
  // fov：岛上平时是 32° 的长焦；钻进屋里以后屋子很小，要放宽到 56° 才能把整扇门、门楣上的衣架牌和两边的墙都收进画面
  const A = { pos: at(door.depth + 3.3, 0.5), look: at(0, 0.05), fov: 32 };
  const B = { pos: at(2.2, 0.16), look: at(0, 0.1), fov: 56 }; // 刚进拱门：在这儿看着门打开
  const D = { pos: at(0.5, 0.02), look: at(-1, 0), fov: 56 };
  const from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), camW: 0, open: 0, fov: 32 }; // 退出时的起点（当时的镜头和门）
  const mix = (p, q, k) => { W.camPos.lerpVectors(p.pos, q.pos, k); W.camLook.lerpVectors(p.look, q.look, k); W.camFov = p.fov + (q.fov - p.fov) * k; };

  // ---- 界面：一层暖白的淡入淡出；ui 是衣帽间里的界面容器（内容由 closet.js 填）
  const host = canvas.parentElement || document.body;
  const root = css(document.createElement('div'), { position: 'absolute', inset: '0', zIndex: '40', pointerEvents: 'none', display: 'none', userSelect: 'none', font: `13px/1.4 ${FONT}`, color: '#4a2a14' });
  root.className = 'pet-wardrobe';
  const fade = css(document.createElement('div'), { position: 'absolute', inset: '0', background: FADE_COLOR, opacity: '0' });
  const ui = css(document.createElement('div'), { position: 'absolute', inset: '0', opacity: '0', display: 'none' });
  root.append(ui, fade);
  host.appendChild(root);

  // ---- 小狗：brain 的 game 模式托管
  let t = 0, dogParent = null, viewW = 1, viewH = 1, toldKennel = false;
  const calm = () => (dog.action === 'lie' || dog.action === 'sleep' || dog.action === 'sit' ? dog.action : 'sit');
  const ctl = {
    state: 'wardrobe',
    update(dt, S) {
      S.mover.clearGoal(); S.mover.hold = false; S.mover.spinRate = 0; S.mover.face(NaN);
      S.look(null);
      if (W.inRoom && W.closet) W.closet.drive(dt, S.mover); // 衣帽间里：位置、朝向、动作都由 closet 算（写进 mover.ext）
      else dog.setAction(S.mover.gait() || calm()); // 在岛上的阶段：原地待着（原来趴着 / 睡着的保持，别的坐下）
    },
    onNeedKennel() { toldKennel = true; }, // 下雨 / 天黑：换装不受影响
  };

  function ensureRoom() {
    if (W.room || !createRoom) return W.room;
    W.room = createRoom();
    W.room.resize(viewW, viewH);
    W.closet = createCloset(ctx, { room: W.room, ui, onExit: close });
    return W.room;
  }

  /** 现在能不能进衣帽间（quiet：只是悬停时问一下，不弹提示） */
  function canOpen(quiet = false) {
    if (W.active || W.phase !== 'idle') return false;
    if ((ctx.game && ctx.game.active) || (ctx.fishing && ctx.fishing.active)) return false;
    if (ctx.stick && ctx.stick.state !== 'hidden') return false;
    if (ctx.travel) { if (quiet ? ctx.travel.away : ctx.travel.blockPlay()) return false; } // 小狗乘白鹭出门了：blockPlay 会弹提示
    return !!(brain.canDress && brain.canDress());
  }

  function setPhase(p) { W.phase = p; t = 0; }

  function open() {
    if (!canOpen()) return false;
    if (!ensureRoom()) return false;
    if (!brain.enterGame(ctl, { anytime: true })) return false;
    W.active = true; W.hover = false; toldKennel = false;
    root.style.display = 'block';
    fade.style.opacity = '0'; ui.style.display = 'none'; ui.style.opacity = '0';
    W.camW = 0; mix(A, A, 0);
    door.setOpen(0);
    if (ctx.gameHooks && ctx.gameHooks.onWardrobeStart) ctx.gameHooks.onWardrobeStart();
    setPhase('in');
    return true;
  }

  /** 返回小岛：在衣帽间里是“淡出 → 退出来”；镜头还在推进的路上就直接从当前位置退出来 */
  function close() {
    if (!W.active) return;
    if (W.phase === 'room' || W.phase === 'reveal') { setPhase('leave'); return; }
    if (W.phase === 'in' || W.phase === 'door') startOut();
  }
  function startOut() {
    from.pos.copy(W.camPos); from.look.copy(W.camLook); from.camW = W.camW; from.open = door.open; from.fov = W.camFov;
    setPhase('out');
  }

  function enterRoom() {
    const room = ensureRoom();
    void room;
    W.inRoom = true;
    dogParent = dog.group.parent;
    dog.group.visible = true;
    W.closet.enter(); // 小狗挂进衣帽间场景，站到进门的位置
    dog.setAction('idle', { fade: 0.05 });
    ui.style.display = 'block';
  }
  function exitRoom() {
    W.inRoom = false;
    if (W.closet) W.closet.exit();
    (dogParent || ctx.scene).add(dog.group);
    dogParent = null;
    const m = brain.mover;
    if (m) { dog.group.position.set(m.x, island.heightAt(m.x, m.z) + (m.extraY || 0), m.z); dog.group.rotation.set(0, m.heading, 0); }
    ui.style.display = 'none'; ui.style.opacity = '0';
  }
  function finish() {
    door.setOpen(0);
    W.camW = 0; W.active = false; W.inRoom = false;
    dog.group.visible = true;
    root.style.display = 'none'; fade.style.opacity = '0';
    if (brain.mode === 'game') brain.exitGame();
    if (ctx.gameHooks && ctx.gameHooks.onWardrobeStop) ctx.gameHooks.onWardrobeStop();
    setPhase('idle');
  }

  /** 每帧（在 brain 之后）调用 */
  function update(dt) {
    if (!W.active) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    t += dt;
    // 别的模块把 brain 抢走了（不该发生）：直接收场
    if (brain.mode !== 'game') { if (W.inRoom) exitRoom(); finish(); return; }
    switch (W.phase) {
      case 'in': {
        // 先把镜头从平时的位置交给脚本（camW 0 → 1），同时沿 A → B 往屋里推
        W.camW = ease(t / T.face);
        mix(A, B, ease((t - T.face * 0.45) / (T.push + T.face * 0.55)));
        // 小狗正趴在窝里：镜头要从门洞进去，先把它藏起来（它“先进衣帽间了”）
        if (brain.mover && brain.mover.inKennel && t > T.face * 0.7) dog.group.visible = false;
        if (t >= T.face + T.push) setPhase('door');
        break;
      }
      case 'door': {
        W.camW = 1;
        // 先看着门打开、光从门里透出来（镜头只是慢慢凑近一点），门开得差不多了再穿过去
        door.setOpen(ease(t / 0.75));
        mix(B, D, 0.07 * ease(t / 0.7) + 0.93 * ease((t - 0.6) / (T.door - 0.6)));
        fade.style.opacity = String(clamp01((t - (T.door - T.fade)) / T.fade));
        if (t >= T.door) { fade.style.opacity = '1'; enterRoom(); setPhase('reveal'); }
        break;
      }
      case 'reveal': {
        const k = clamp01(t / T.reveal);
        fade.style.opacity = String(1 - k); ui.style.opacity = String(k);
        if (k >= 1) setPhase('room');
        break;
      }
      case 'room': break;
      case 'leave': {
        const k = clamp01(t / T.leave);
        fade.style.opacity = String(k); ui.style.opacity = String(1 - k);
        if (k >= 1) {
          exitRoom();
          door.setOpen(1); W.camW = 1; mix(D, D, 0);
          if (brain.mover && brain.mover.inKennel) dog.group.visible = false;
          startOut();
        }
        break;
      }
      case 'out': {
        const k = clamp01(t / T.out);
        fade.style.opacity = String(Math.max(0, parseFloat(fade.style.opacity || '0') - dt / T.fade));
        // 从当时的位置退到小屋正前方，门跟着关上；后半段把镜头交还给平时的取景
        const e = ease(k / 0.75);
        W.camPos.lerpVectors(from.pos, A.pos, e); W.camLook.lerpVectors(from.look, A.look, e); W.camFov = from.fov + (A.fov - from.fov) * e;
        door.setOpen(from.open * (1 - ease(k / 0.6)));
        W.camW = from.camW * (1 - ease((k - 0.45) / 0.55));
        if (k > 0.5) dog.group.visible = true;
        if (k >= 1) finish();
        break;
      }
      default: break;
    }
    // 在衣帽间里：相机、藏墙、橱柜里的动画、界面（小狗的位置在 brain 里由 closet.drive 写好了）
    if (W.inRoom && W.closet) W.closet.update(dt);
  }

  function resize(w, h) { viewW = Math.max(1, w); viewH = Math.max(1, h); if (W.room) W.room.resize(viewW, viewH); }

  // ---- 指针：点小屋正面进衣帽间；悬停时给个“可以点”的光标（光标由 stick.js 统一设置，它会来读 wardrobe.hover）
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function overFront(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1);
    ray.setFromCamera(ndc, ctx.camera);
    if (ctx.petInput && (ctx.petInput.over || ctx.petInput.active)) return false; // 鼠标在小狗身上：那是摸摸
    if (island.shelf && island.shelf.pick(ray)) return false;                      // 在玩具架的格子上：那是拿玩具
    return door.pickFront(ray);
  }
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) down = { x: e.screenX, y: e.screenY, far: 0 }; });
  canvas.addEventListener('pointermove', (e) => {
    // 记下按住期间离起点最远到过哪儿：拖着窗口转一圈又回到原处松手，不能算一次点击
    if (down) down.far = Math.max(down.far, Math.hypot(e.screenX - down.x, e.screenY - down.y));
    W.hover = !W.active && !down && canOpen(true) && overFront(e);
  });
  canvas.addEventListener('pointerleave', () => { W.hover = false; down = null; });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || e.button !== 0) return;
    const moved = Math.max(down.far, Math.hypot(e.screenX - down.x, e.screenY - down.y));
    down = null;
    if (moved > 6 || W.active) return; // 拖动是移动窗口，不算点击
    if (ctx.stick && ctx.stick.state !== 'hidden') return;
    if (overFront(e)) open();
  });
  // Esc：在衣帽间的子模式里（橱柜 / 照镜子 / 拍照……）先退回自由走动；已经在自由走动才是返回小岛
  document.addEventListener('keydown', (e) => { if (W.active && e.code === 'Escape') { e.preventDefault(); if (W.inRoom && W.phase === 'room' && W.closet && W.closet.back()) return; close(); } });

  function info() {
    return { active: W.active, phase: W.phase, inRoom: W.inRoom, hover: W.hover, camW: +W.camW.toFixed(3), door: +door.open.toFixed(3), fade: +parseFloat(fade.style.opacity || '0').toFixed(2), ui: ui.style.display !== 'none', toldKennel, closet: W.closet && W.inRoom ? W.closet.info() : null };
  }
  return W;
}

export default createWardrobe;
