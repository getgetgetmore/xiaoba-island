// 换装入口的端到端检查（页面内运行）：点小屋正面 → 镜头推进 → 开门 → 进衣帽间 → 返回 → 小岛复原；以及与其他互动的互斥。
// 用法：node scripts/shot.cjs --out shots/wardrobe-flow.png --query "hour=11&weather=clear&seed=5" --size 560x480 --wait 500 --timeout 200000 --eval-file scripts/wardrobe-flow.eval.js
//   可选 &stop=push|door|room：停在这个阶段截图（不再往下跑）
window.requestAnimationFrame = () => 0;
const P = __pet, W = P.wardrobe, D = P.dog, B = P.brain, I = P.island, cam = P.ctx.camera, out = {};
const stopAt = new URLSearchParams(location.search).get('stop');
const step = (sec, until) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { P.step(1 / 60, 1); if (until && until()) return true; } return false; };
const f = (n) => +n.toFixed(2);
const checks = {};
const ck = (k, ok, info) => { checks[k] = (ok ? 'PASS' : 'FAIL') + (info !== undefined ? ' ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''); };
step(1);
const door = I.wardrobeDoor;
const before = { parent: D.group.parent === P.ctx.scene, mode: B.mode, cam: cam.position.toArray().map(f), door: door.open, visible: D.group.visible, zoom: P.userView.zoomT };

// ---- 点小屋正面：把拱门中心投影到屏幕，在那里发一次点击
const el = P.ctx.renderer.domElement, r = el.getBoundingClientRect();
const v = door.frontCenter.clone(); v.y += 0.45; v.project(cam);
const cx = r.left + (v.x * 0.5 + 0.5) * r.width, cy = r.top + (-v.y * 0.5 + 0.5) * r.height;
const ev = (type, o = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 5, button: 0, clientX: cx, clientY: cy, screenX: cx, screenY: cy, ...o }));
ev('pointermove'); step(0.1);
ck('悬停在小屋正面：可以点（hover，光标是手指）', W.hover === true && el.style.cursor === 'pointer', { hover: W.hover, cursor: el.style.cursor });
ev('pointerdown'); ev('pointerup'); step(0.05);
ck('点一下小屋正面：开始进衣帽间，小狗由 brain 的 game 模式托管', W.active && W.phase === 'in' && B.mode === 'game', W.info());
// 互斥：这时点玩具架上的树枝没有反应
P.stick.click(null); step(0.05);
ck('进行中拿不出树枝', P.stick.state === 'hidden', P.stick.state);

// ---- 镜头推进：一路朝门走，最后在屋里（离门不到 2），门还关着
let maxJump = 0, last = cam.position.clone(), minD = 1e9;
const dist0 = Math.hypot(before.cam[0] - door.center.x, before.cam[1] - door.center.y, before.cam[2] - door.center.z);
const track = () => { const d = cam.position.distanceTo(last); if (d > maxJump) maxJump = d; last.copy(cam.position); minD = Math.min(minD, cam.position.distanceTo(door.center)); return false; };
if (stopAt === 'push') { step(2.05, track); return { stop: 'push', info: W.info(), errors: P.info().errors }; }
if (stopAt === 'face') { step(1.25, track); return { stop: 'face', info: W.info(), errors: P.info().errors }; }
step(4, () => { track(); return W.phase === 'door'; });
const dIn = cam.position.distanceTo(door.center);
ck('镜头推进到屋里（刚进拱门，离衣帽间的门不到 2.6）：这时门还没开', W.phase === 'door' && dIn < 2.6 && door.open < 0.05, { dist: f(dIn), door: f(door.open) });
if (stopAt === 'door') { step(0.42, track); return { stop: 'door', info: W.info(), errors: P.info().errors }; }
if (stopAt === 'open') { step(0.8, track); return { stop: 'open', info: W.info(), errors: P.info().errors }; }
// ---- 门自己打开，画面淡入衣帽间
let maxOpen = 0;
step(3, () => { track(); maxOpen = Math.max(maxOpen, door.open); return W.phase === 'room'; });
// 窗口越窄平时的镜头离得越远，飞过去的路就越长：按“起点到门的距离”的比例来判断有没有跳变（平滑飞过去时单帧最多约 1.8%）
ck('镜头推进全程没有跳变（60 帧下单帧位移 < 起点到门距离的 2.5%）', maxJump < dist0 * 0.025, { maxJump: f(maxJump), dist0: f(dist0) });
ck('门自己打开，然后进入衣帽间：小狗挂到了衣帽间场景里、界面出现', maxOpen > 0.95 && W.phase === 'room' && W.inRoom && D.group.parent === W.room.dogSpot && W.info().ui && W.info().fade === 0, { maxOpen: f(maxOpen), ...W.info() });
ck('衣帽间里：标题和返回按钮都在', !!document.querySelector('.pet-wardrobe') && /衣帽间/.test(document.querySelector('.pet-wardrobe').textContent) && /返回/.test(document.querySelector('.pet-wardrobe button').textContent));
step(1.5);
ck('小狗站在衣帽间中间（位置在 dogSpot 原点）', D.group.position.length() < 1e-6 && D.action === 'idle', { pos: D.group.position.toArray().map(f), action: D.action });
if (stopAt === 'room') return { stop: 'room', info: W.info(), errors: P.info().errors };

// ---- 返回小岛
document.querySelector('.pet-wardrobe button').click();
step(0.05);
ck('点“返回小岛”：开始退出', W.phase === 'leave', W.phase);
const backOk = step(5, () => !W.active);
step(2.5);
const after = { parent: D.group.parent === P.ctx.scene, mode: B.mode, cam: cam.position.toArray().map(f), door: door.open, visible: D.group.visible, zoom: P.userView.zoomT };
const camBack = Math.hypot(after.cam[0] - before.cam[0], after.cam[1] - before.cam[1], after.cam[2] - before.cam[2]);
ck('退出后小岛复原：小狗回到岛的场景、brain 回到 auto、门关上、镜头回到原位', backOk && after.parent && after.mode === 'auto' && after.door === 0 && after.visible && camBack < 0.3 && !document.querySelector('.pet-wardrobe').offsetParent, { after, camBack: f(camBack) });
ck('退出后小狗落在可行走的地方、贴着地面', I.isWalkable(D.group.position.x, D.group.position.z) || B.mover.inKennel, { pos: D.group.position.toArray().map(f) });

// ---- 再进一次，半路按 Esc：直接从当前位置退出来
W.open(); step(1.6);
document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
step(0.05);
const escPhase = W.phase;
const escOk = step(4, () => !W.active); step(2.5);
ck('推进到一半按 Esc：原路退出来，小岛复原', escPhase === 'out' && escOk && B.mode === 'auto' && door.open === 0 && D.group.parent === P.ctx.scene, { escPhase, mode: B.mode });

// ---- 夜里小狗在窝里睡觉也能进；出来以后它接着睡
P.env.setHour(2); step(40, () => B.mover.inKennel && D.action === 'sleep');
const slept = B.mover.inKennel && D.action === 'sleep';
const nightOpen = W.open();
step(8, () => W.phase === 'room');
const nightRoom = W.phase === 'room' && D.group.visible;
W.close(); step(6, () => !W.active); step(6, () => D.action === 'sleep');
ck('夜里小狗在窝里睡觉时也能进衣帽间；出来后它回窝里接着睡', slept && nightOpen && nightRoom && B.mover.inKennel && D.action === 'sleep' && D.group.visible, { slept, nightOpen, nightRoom, action: D.action, inKennel: B.mover.inKennel });

// ---- 木棍在场时点小屋正面不会进衣帽间（那是扔木棍的落点）
P.env.setHour(11); step(30, () => !B.mover.inKennel && B.mode === 'auto');
P.stick.click(null); step(0.3);
ck('木棍在手上时不能进衣帽间', P.stick.state === 'held' && W.canOpen(true) === false && W.open() === false);
P.stick.dismiss(); step(1.5);

const fails = Object.values(checks).filter((s) => s.startsWith('FAIL')).length;
return { fails, checks, errors: P.info().errors };
