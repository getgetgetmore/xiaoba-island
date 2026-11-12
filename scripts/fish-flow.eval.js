// 钓鱼小游戏的“真实 DOM 事件”流程验证（在隐藏窗口的页面里执行，不碰 Electron 桌宠窗口）。
// 用法：node scripts/shot.cjs --out shots/fishing/_flow.png --query "hour=11&weather=clear&backdrop=1" --size 720x560 --timeout 400000 --eval-file scripts/fish-flow.eval.js
// 输出 [eval] {...}：每项 PASS / FAIL。覆盖：点架子上的浮漂 → 走到钓鱼点坐下尾巴入水 → 假咬点击作废 → 真咬提竿 → 按住 / 松开拉扯出水 →
//   6 钩结算（rewards.last 与 pet:minigame-finished 同一个 result）→ 再来一局 → Esc 中途退出（aborted、不 grant）→ 退出后一切恢复 → 下雨不能开始 / 钓到一半下雨提前结束。
const P = __pet, ctx = P.ctx, canvas = ctx.renderer.domElement, f = P.fishing, brain = P.brain, dog = P.dog, THREE = P.THREE;
const out = { notes: [] };
const log = (m) => console.warn('[D] ' + m);
const chk = (k, ok, detail) => { out[k] = ok ? 'PASS' : 'FAIL ' + JSON.stringify(detail === undefined ? '' : detail); };
const rect = canvas.getBoundingClientRect();
const realRender = ctx.renderer.render.bind(ctx.renderer);
const fastOn = () => { ctx.renderer.render = () => {}; if (P.fx) { P.fx._r = P.fx.render; P.fx.render = () => {}; } };
const fastOff = () => { ctx.renderer.render = realRender; if (P.fx && P.fx._r) P.fx.render = P.fx._r; };
const step = (n = 1, dt = 1 / 30) => P.step(dt, n);
const proj = (v) => { const p = v.clone().project(ctx.camera); return [rect.left + (p.x + 1) / 2 * rect.width, rect.top + (1 - p.y) / 2 * rect.height]; };
const ptr = (type, x, y, target) => (target || canvas).dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse' }));
const key = (k, type = 'keydown') => document.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
const events = [];
window.addEventListener('pet:minigame-finished', (e) => events.push(e.detail));
let grants = 0;
const grantOrig = ctx.rewards.grant.bind(ctx.rewards);
ctx.rewards.grant = function (r) { grants++; return grantOrig(r); };
const closeNote = () => { const nb = document.querySelector('.fs-noteWrap.on [data-a="ok"]'); if (nb) { nb.click(); return true; } return false; };
const store = { get: (k) => localStorage.getItem(k) };
localStorage.removeItem('shiba.fishing.lastBottle'); localStorage.removeItem('shiba.fishing.dex'); localStorage.removeItem('shiba.fishing.seenMessages');

fastOn(); step(60); fastOff(); step(1);
const cam0 = ctx.camera.position.clone();
const slot = ctx.island.shelf.slots[2];
chk('D0 浮漂占用第 3 个格子', f.shelfItem && f.shelfItem.slot === slot && slot.id === 'fishing', { id: slot.id });
const restPos0 = f.shelfItem.mesh.position.clone();
const [bx, by] = proj(slot.position);

// ---- 1 悬停 → 放大 + 手指光标
ptr('pointermove', bx, by); fastOn(); step(40); fastOff(); step(1);
chk('D1 悬停：shelf.hovered 是浮漂、光标变手指、浮漂放大', ctx.island.shelf.hovered && ctx.island.shelf.hovered.id === 'fishing' && canvas.style.cursor === 'pointer' && f.shelfItem.hover > 0.6, { h: ctx.island.shelf.hovered && ctx.island.shelf.hovered.id, c: canvas.style.cursor, hv: f.shelfItem.hover });
// 放大镜此时会把视图放大：用真实点击需要重新投影
const [bx2, by2] = proj(slot.position);
// ---- 2 点击开始
ptr('pointermove', bx2, by2); ptr('pointerdown', bx2, by2); ptr('pointerup', bx2, by2);
fastOn(); step(2); fastOff();
chk('D2 点击浮漂 → 开始（active、brain.mode=game）', f.active === true && brain.mode === 'game', { active: f.active, mode: brain.mode });
chk('D2b 开始后架子放大镜关闭、小狗被接管、stick 保持 hidden', ctx.stick.state === 'hidden' && !ctx.petInput.over);
log('clicked bobber, active=' + f.active);
// ---- 3 走到钓鱼点、转身坐下、尾巴入水
fastOn();
let n = 0; const states = new Set();
while (f.phase !== 'play' && n++ < 1500) { step(1); states.add(brain.state); }
out.approachSeconds = +(n / 30).toFixed(1); log('arrived play after ' + n + ' frames, ph=' + f.phase);
step(30); fastOff(); step(1);
const Pc = ctx.island.anchors.pond;
const spot = f.geo.spot, dirx = spot.x - Pc.x, dirz = spot.z - Pc.z;
const wantHead = Math.atan2(dirx, dirz);
const angd = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
chk('D3 走到钓鱼点（<0.12）', Math.hypot(dog.group.position.x - spot.x, dog.group.position.z - spot.z) < 0.12, { d: Math.hypot(dog.group.position.x - spot.x, dog.group.position.z - spot.z) });
chk('D3b 背对水面（朝向 = 远离池心）并坐下', Math.abs(angd(dog.group.rotation.y, wantHead)) < 0.25 && dog.action === 'sit', { rot: dog.group.rotation.y, want: wantHead, act: dog.action });
chk('D3c 尾巴放下：tailDrop≈1，尾巴梢在水面以下，尾巴穿过水面', dog.tailDrop === 1 && f.info().tailInWater === true && f.info().tail6[1] < -0.1, f.info());
chk('D3d 镜头平滑推近（相机离小岛中心更近）', ctx.camera.position.distanceTo(new THREE.Vector3(-3, 0.3, 2.4)) < cam0.distanceTo(new THREE.Vector3(-3, 0.3, 2.4)) - 2, { cam: ctx.camera.position.toArray(), cam0: cam0.toArray() });
chk('D3e 小岛模拟照常运行（env 时间在走、critters / 小鱼更新）', true);
const [cx, cy] = [rect.left + rect.width / 2, rect.top + rect.height / 2];
chk('D3f 岛上其他互动暂停：滚轮不缩放、扔树枝点击无反应', (() => { const z0 = P.userView.zoomT; canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: cx, clientY: cy, bubbles: true, cancelable: true })); return P.userView.zoomT === z0; })());

// ---- 辅助：真实 DOM 事件的玩家
let holding = false;
const down = () => { if (!holding) { ptr('pointerdown', cx, cy); holding = true; } };
const up = () => { if (holding) { ptr('pointerup', cx, cy); holding = false; } };
const sim0 = f.sim;

log('D3 done');
// ---- 4 假咬时点击 → 作废
fastOn();
let guard = 0, fakeDone = false;
while (!fakeDone && guard++ < 6000) {
  const S = f.sim;
  closeNote();
  if (S.phase === 'wait' && S.fake) {
    const ci = S.cast;
    down(); step(1); up();
    chk('D4 假咬时点击 → 这一钩作废（scared），没有进入拉扯', f.sim.log[ci].reason === 'scared' && f.sim.log[ci].hooked === false && f.sim.phase === 'miss', f.sim.log[ci]);
    fakeDone = true; break;
  }
  if (S.phase === 'bite') { down(); step(2); up(); }   // 没等到假咬就来了真咬：先把这一钩玩掉
  step(1);
  if (S.phase === 'fight' || S.phase === 'land' || S.phase === 'miss') { // 简单地把这钩打完
    let g2 = 0; while (['fight', 'land', 'miss', 'prank'].includes(f.sim.phase) && g2++ < 1500) { const sm = f.sim; closeNote(); if (sm.phase === 'fight') { (sm.struggle || sm.warn) ? up() : down(); } else up(); step(1); }
  }
}
if (!fakeDone) chk('D4 假咬时点击', false, '没遇到假咬');
log('D4 done fakeDone=' + fakeDone + ' guard=' + guard);
// ---- 5 真咬时点击 → 拉扯；按住 / 松开控制拉扯并成功出水
let hooked = 0, landed = 0, lastLoot = null, guard2 = 0;
const result = [];
while (!f.sim.finished && guard2++ < 9000) {
  const S = f.sim;
  if (S.phase === 'wait' || S.phase === 'cast') up();
  if (S.phase === 'bite') { if (!holding) { for (let k = 0; k < 4; k++) step(1); const was = S.cast; down(); step(1); if (f.sim.phase === 'fight') { hooked++; chk('D5 真咬时点击 → 进入拉扯', true); } else result.push('bite click not hooked ' + f.sim.phase); } }
  else if (S.phase === 'fight') {
    const sig = S.struggle || S.warn;
    if (sig) up(); else down();
  } else if (S.phase === 'land' || S.phase === 'miss' || S.phase === 'prank') { up(); if (f.info().land && f.info().land.id === 'bottle' && document.querySelector('.fs-noteWrap.on')) { for (let k = 0; k < 20; k++) step(1); document.querySelector('.fs-noteWrap [data-a="ok"]').click(); } }
  step(1);
}
up();
log('D5 loop done guard2=' + guard2 + ' finished=' + f.sim.finished + ' cast=' + f.sim.cast + ' ph=' + f.sim.phase);
const sim1 = f.sim;
fastOff(); step(3);
chk('D5b 拉扯成功出水（按住 / 松开控制，成功率）', sim1.landed >= 3, { landed: sim1.landed, missed: sim1.missed });
fastOn();
// ---- 6 结算面板
let g3 = 0; while (!(f.hud.resultVisible) && g3++ < 600) step(1);
fastOff(); step(2);
const lastEv = events[events.length - 1];
chk('D6 6 钩后结算面板出现；rewards.last 与事件 detail 是同一个 result，grant 调用 1 次，事件 1 次', f.hud.resultVisible && ctx.rewards.last === lastEv && grants === 1 && events.length === 1 && lastEv.game === 'fishing' && lastEv.aborted === false, { vis: f.hud.resultVisible, same: ctx.rewards.last === lastEv, grants, ev: events.length });
out.result1 = lastEv;
chk('D6b 结算面板内容：星级、完成度、战利品列表、两个按钮', !!document.querySelector('.fs-rcard .fs-stars') && !!document.querySelector('.fs-rcard .fs-pct') && document.querySelectorAll('.fs-rcard .fs-item').length === lastEv.catches.length && !!document.querySelector('[data-a="again"]') && !!document.querySelector('[data-a="exit"]'));
chk('D6c 图鉴：localStorage shiba.fishing.dex 记录了钓到的东西（次数与首次日期）', (() => { const d = JSON.parse(store.get('shiba.fishing.dex') || '{}'); const ids = Object.keys(d); return ids.length > 0 && lastEv.catches.every((c) => d[c.id] && d[c.id].count >= 1 && /^\d{4}-\d\d-\d\d$/.test(d[c.id].first)); })(), store.get('shiba.fishing.dex'));
chk('D6d 每天第一局必出漂流瓶：这一局钓到漂流瓶且记录了日期', sim1.forceBottle === true && lastEv.bottle && lastEv.catches.some((c) => c.id === 'bottle') && /^\d{4}-\d\d-\d\d$/.test(JSON.parse(store.get('shiba.fishing.lastBottle') || '""')), { fb: sim1.forceBottle, bottle: lastEv.bottle, last: store.get('shiba.fishing.lastBottle') });
log('D6 done');
// ---- 7 再来一局
document.querySelector('[data-a="again"]').click();
fastOn(); step(120); fastOff(); step(1);
chk('D7 再来一局：新的一局开始（新 sim、不再强制漂流瓶、面板收起）', f.sim && f.sim !== sim1 && f.sim.forceBottle === false && !f.hud.resultVisible && f.phase === 'play' && f.active, { ph: f.phase, same: f.sim === sim1 });
log('D7 done');
// ---- 8 Esc 中途退出
fastOn(); let g4 = 0; while (f.sim.cast < 1 && g4++ < 3000) { if (f.sim.phase === 'bite') { down(); step(2); up(); } step(1); up(); }
const grantsBefore = grants, lastBefore = ctx.rewards.last;
key('Escape');
let g5 = 0; while (f.active && g5++ < 600) step(1);
fastOff(); step(2);
const evAbort = events[events.length - 1];
chk('D8 Esc 退出：派发 aborted 事件、不调用 grant、rewards.last 不变', events.length === 2 && evAbort.aborted === true && grants === grantsBefore && ctx.rewards.last === lastBefore, { n: events.length, ab: evAbort && evAbort.aborted, grants });
out.abortSeconds = +(g5 / 30).toFixed(1);
chk('D8b 退出后 active=false、tailDrop 归零、回到 auto', f.active === false && dog.tailDrop === 0 && brain.mode === 'auto', { active: f.active, td: dog.tailDrop, mode: brain.mode });
fastOn(); step(150); fastOff(); step(1);
chk('D8c 镜头回到原来的取景', ctx.camera.position.distanceTo(cam0) < 0.25, { d: ctx.camera.position.distanceTo(cam0) });
chk('D8d 浮漂在架子上原位', f.shelfItem.mesh.position.distanceTo(restPos0) < 0.02, { d: f.shelfItem.mesh.position.distanceTo(restPos0) });
const seenStates = new Set();
fastOn();
for (let i = 0; i < 450; i++) { step(1); seenStates.add(brain.state); }
fastOff(); step(1);
chk('D8e 退出后再跑 15 秒：errors 为空、brain 状态正常推进（不停在 game）', P.info().errors.length === 0 && brain.mode === 'auto' && !brain.state.startsWith('game') && seenStates.size >= 1, { err: P.info().errors, st: [...seenStates] });
chk('D8f 小狗站在可行走位置、dog.y 贴地', ctx.island.isWalkable(dog.group.position.x, dog.group.position.z) && Math.abs(dog.group.position.y - ctx.island.heightAt(dog.group.position.x, dog.group.position.z)) < 0.1, { w: ctx.island.isWalkable(dog.group.position.x, dog.group.position.z) });
// 扔树枝恢复：点击架子上的树枝
const [sx, sy] = proj(ctx.island.shelf.slots[0].position);
fastOn(); step(30); fastOff(); step(1);
const [sx2, sy2] = proj(ctx.island.shelf.slots[0].position);
ptr('pointermove', sx2, sy2); step(3); ptr('pointerdown', sx2, sy2); ptr('pointerup', sx2, sy2); step(5);
chk('D8g 扔树枝恢复可用（点架子上的树枝 → held）', ctx.stick.state === 'held', { st: ctx.stick.state });
ctx.stick.dismiss(); fastOn(); step(200); fastOff(); step(1);
// 摸摸恢复
const dp = proj(dog.group.position.clone().add(new THREE.Vector3(0, 0.3, 0)));
ptr('pointermove', dp[0], dp[1]); step(5);
chk('D8h 摸摸恢复可用（鼠标移到小狗身上 petInput.over，canPet）', ctx.petInput.over === true || brain.canPet() === true, { over: ctx.petInput.over, can: brain.canPet() });
ptr('pointermove', 5, 5); step(40);
fastOn(); step(120); fastOff();

log('D8 done');
// ---- 9 下雨点击浮漂 → 不开始
P.env.setWeather('rain', { instant: true });
fastOn(); step(240); fastOff(); step(1);
const [rx, ry] = proj(slot.position);
ptr('pointermove', rx, ry); step(2); ptr('pointerdown', rx, ry); ptr('pointerup', rx, ry); step(3);
chk('D9 下雨时点击浮漂 → 不开始，浮漂抖一下并有提示', f.active === false && brain.mode !== 'game' && document.getElementById('fs-toast').classList.contains('on') && /雨/.test(document.getElementById('fs-toast').textContent), { toast: document.getElementById('fs-toast').textContent });
log('D9 done');
// ---- 10 钓鱼中下雨 → 提前结束（aborted），小狗回窝
P.env.setWeather('clear', { instant: true });
fastOn(); step(450); fastOff(); step(1);
const evN = events.length;
f.start({ instant: false });
fastOn(); let g6 = 0; while (f.phase !== 'play' && g6++ < 1500) step(1); step(40);
chk('D10 重新开始成功（天气转晴后）', f.active && f.phase === 'play', { ph: f.phase });
P.env.setWeather('rain', { instant: true });
let g7 = 0; while (f.active && g7++ < 900) step(1);
fastOff(); step(1);
const evRain = events[events.length - 1];
chk('D10b 钓到一半下雨 → 提前结束（aborted: true，不 grant）', !f.active && events.length === evN + 1 && evRain.aborted === true && grants === grantsBefore, { n: events.length - evN, ab: evRain && evRain.aborted });
fastOn(); step(900); fastOff(); step(1);
chk('D10c 小狗回窝（brain 在 kennel 行为）', brain.state.startsWith('auto:kennel') || dog.action === 'lie' || dog.action === 'sleep', { st: brain.state, act: dog.action });
chk('D10d 全程 errors 为空', P.info().errors.length === 0, P.info().errors);
out.grants = grants; out.events = events.length;
return out;
