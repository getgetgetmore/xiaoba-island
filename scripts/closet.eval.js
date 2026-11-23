// 衣帽间里面玩法的端到端检查（页面内运行）：走动、右键 360° 转视角、橱柜（分区、常穿排序、滑动、悬停取出、展示面板、穿上 / 脱下）、
// 照镜子、自拍、拍照区（换背景、姿势、保存照片）、存档、退出后复原。
// 用法：node scripts/shot.cjs --out shots/closet.png --query "hour=11&weather=clear&seed=5" --size 900x640 --wait 500 --timeout 240000 --eval-file scripts/closet.eval.js
//   可选 &stop=free|orbit|cabinet|hover|item|worn|mirror|selfie|photo：停在这个画面截图；&bd=<序号> 拍照区用哪个背景
window.requestAnimationFrame = () => 0;
const P = __pet, W = P.wardrobe, D = P.dog, B = P.brain, out = {};
const q = new URLSearchParams(location.search), stopAt = q.get('stop');
try { localStorage.removeItem('shiba.wardrobe.v1'); } catch (_) { /* ignore */ }
const step = (sec, until) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { P.step(1 / 60, 1); if (until && until()) return true; } return false; };
const f = (n) => +n.toFixed(2);
const checks = {};
const ck = (k, ok, info) => { checks[k] = (ok ? 'PASS' : 'FAIL') + (info !== undefined ? ' ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''); };
const done = (extra) => ({ stop: stopAt, ...extra, info: W.closet ? W.closet.info() : null, fails: Object.values(checks).filter((s) => s.startsWith('FAIL')).length, checks, errors: P.info().errors });
// 保存照片会触发下载：测试里不真的下载
let downloads = 0; HTMLAnchorElement.prototype.click = function () { if (this.download) downloads++; };
const el = P.ctx.renderer.domElement;
const ptr = (type, x, y, o = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, buttons: 1, clientX: x, clientY: y, screenX: x, screenY: y, ...o }));
const key = (type, code) => document.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));
const clickAt = (p) => { ptr('pointermove', p.x, p.y, { buttons: 0 }); ptr('pointerdown', p.x, p.y); ptr('pointerup', p.x, p.y, { buttons: 0 }); };
const btn = (text) => [...document.querySelectorAll('.pet-wardrobe button')].find((b) => b.offsetParent && b.textContent.includes(text));

step(1);
W.open();
step(8, () => W.phase === 'room'); step(0.6);
const C = W.closet, R = W.room;
ck('进了衣帽间：自由走动模式，底下有 橱柜 / 照镜子 / 拍照区 / 自拍 四个按钮', W.phase === 'room' && C.mode === 'free' && ['橱柜', '照镜子', '拍照区', '自拍'].every((t) => !!btn(t)), C.info().bar);
if (stopAt === 'free') return done();

// ---- 走动：键盘
const z0 = C.info().dog.z;
key('keydown', 'KeyW'); step(1.0);
const walking = D.action === 'walk', z1 = C.info().dog.z;
key('keyup', 'KeyW'); step(0.8);
ck('按 W：小狗往画面里（北）走，松开就停', walking && z1 < z0 - 0.8 && C.info().dog.speed < 0.1 && D.action === 'idle', { z0: f(z0), z1: f(z1), action: D.action });
// ---- 走动：点地面
const tx = R.walk.x0 + 1.2, tz = 1.2;
clickAt(C.floorScreen(tx, tz));
const arrived = step(6, () => { const d = C.info().dog; return Math.hypot(d.x - tx, d.z - tz) < 0.15 && d.speed < 0.1; });
ck('点一下地面：小狗走过去', arrived, C.info().dog);
// ---- 碰撞：往橱柜里走、往墙外走，都不会穿进家具 / 出界
let minClear = 1e9, outside = 0;
for (const [x, z] of [[0, -R.size.d], [R.size.w, 0], [-R.size.w, 0.4], [R.mirror.standSpot.x - 2, R.mirror.standSpot.z], [0, R.size.d]]) {
  C.walkTo(x, z);
  step(5, () => { const d = C.info().dog; for (const o of R.obstacles) minClear = Math.min(minClear, Math.hypot(d.x - o.x, d.z - o.z) - o.r); if (d.x < R.walk.x0 - 1e-3 || d.x > R.walk.x1 + 1e-3 || d.z < R.walk.z0 - 1e-3 || d.z > R.walk.z1 + 1e-3) outside++; return !C.info().dog.walking; });
}
ck('走到哪儿都不穿家具、不出可走范围', minClear > 0.3 && outside === 0, { minClear: f(minClear), outside });

// ---- 右键拖动 360° 转视角；转到墙背后时那面墙藏起来
C.walkTo(0, 0.5); step(4, () => !C.info().dog.walking);
const az0 = C.info().orbit.az;
ptr('pointerdown', 400, 300, { button: 2, buttons: 2 }); ptr('pointermove', 400 - 349, 300, { button: 2, buttons: 2 }); ptr('pointerup', 400 - 349, 300, { button: 2, buttons: 0 });
step(1.2);
const i1 = C.info();
ck('右键往左拖：视角绕着房间转过去（转了约 180°），这时北墙在镜头背后被藏起来、南墙露出来', Math.abs(i1.orbit.az - az0 - 349 * 0.009) < 0.1 && i1.walls.north === false && i1.walls.south === true, { az: i1.orbit.az, walls: i1.walls });
if (stopAt === 'orbit') return done();
C.orbit.azT = Math.PI * 2 + 0.6; step(2);
ck('可以一直转（超过 360° 不卡）', Math.abs(C.info().orbit.az - (Math.PI * 2 + 0.6)) < 0.05, C.info().orbit);
const d0 = C.info().orbit.dist;
el.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); step(0.8);
ck('滚轮拉近', C.info().orbit.dist < d0 - 1, { d0, d1: C.info().orbit.dist });
C.orbit.azT = 0; step(1.5);

// ---- 橱柜
btn('橱柜').click(); step(4.5);
const ci = C.info();
const zones = ci.rows.map((r) => r.zone);
ck('点“橱柜”：四排分区（帽子 / 衣服 / 装饰品 / 鞋子），每排可视范围里摆着前几件，相机到橱柜正面', ci.mode === 'cabinet' && ['hat', 'top', 'acc', 'shoes'].every((z) => zones.includes(z)) && ci.rows.every((r) => r.shown.length === Math.min(R.cabinet.visible, r.order.length) && r.shown.every((id, k) => id === r.order[k])) && Math.hypot(ci.cam[0] - R.cabinet.viewSpot.x, ci.cam[2] - R.cabinet.viewSpot.z) < 0.4, ci.rows.map((r) => r.zone + ':' + r.shown.length + '/' + r.order.length));
if (stopAt === 'cabinet') return done();
const hatRow = ci.rows.find((r) => r.zone === 'hat'), firstHat = hatRow.order[0], secondHat = hatRow.order[1];
// 悬停：向上取出
const hp = C.itemScreen(firstHat);
ptr('pointermove', hp.x, hp.y, { buttons: 0 }); step(0.6);
ck('鼠标移到一件上：它往上取出一截', C.info().hover === firstHat && C.info().lift > 0.85, { hover: C.info().hover, lift: C.info().lift });
if (stopAt === 'hover') return done();
// 滑动：滚轮翻这一排
const canScroll = hatRow.max > 0;
el.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true, clientX: hp.x, clientY: hp.y })); step(0.8);
const sc = C.info().rows.find((r) => r.zone === 'hat');
ck('在一排上滚滚轮：这一排往左滑一格，露出后面的（别的排不动）', !canScroll || (Math.abs(sc.scroll - 1) < 0.05 && sc.shown[0] === hatRow.order[1] && C.info().rows.filter((r) => r.zone !== 'hat').every((r) => r.scroll === 0)), { canScroll, scroll: sc.scroll, shown: sc.shown });
// 按住拖动也能翻
const hp2 = C.itemScreen(sc.shown[0]);
ptr('pointermove', hp2.x, hp2.y, { buttons: 0 }); ptr('pointerdown', hp2.x, hp2.y); ptr('pointermove', hp2.x + 400, hp2.y); ptr('pointerup', hp2.x + 400, hp2.y, { buttons: 0 }); step(0.8);
ck('按住往右拖：这一排滑回去；拖动不算点击（没有打开展示面板）', C.info().rows.find((r) => r.zone === 'hat').scroll < 0.05 && C.info().mode === 'cabinet', { scroll: C.info().rows.find((r) => r.zone === 'hat').scroll, mode: C.info().mode });
// 点开：展示面板
clickAt(C.itemScreen(firstHat)); step(0.9);
const pi = C.info();
ck('点一件：出现展示面板（分区、名字、“穿上”），这件飞到前面放大', pi.mode === 'item' && pi.selected === firstHat && pi.panel && pi.panel.wear === '穿上' && pi.panel.zone === '帽子' && pi.panel.name.length > 0, pi.panel);
if (stopAt === 'item') return done();
btn('▶').click(); step(0.5);
ck('面板上点 ▶：直接看同一分区的下一件', C.info().selected === secondHat && C.info().panel.zone === '帽子', C.info().selected);
btn('◀').click(); step(0.5);
btn('穿上').click(); step(0.3);
const wi = C.info();
const saved1 = JSON.parse(localStorage.getItem('shiba.wardrobe.v1') || '{}');
ck('点“穿上”：小狗戴上了，按钮变成“脱下”，存了档', D.outfit.hat === firstHat && wi.panel.wear === '脱下' && saved1.outfit && saved1.outfit.hat === firstHat && saved1.counts[firstHat] === 1, { outfit: D.outfit, saved: saved1 });
step(1.0);
const so = C.info();
const closeUp = so.showOff && Math.hypot(so.cam[0] - so.dog.x, so.cam[2] - so.dog.z) < 4;
step(3.2);
ck('穿上以后镜头切到小狗身上给个特写（它转一圈），然后回到橱柜', closeUp && !C.info().showOff && Math.hypot(C.info().cam[0] - R.cabinet.viewSpot.x, C.info().cam[2] - R.cabinet.viewSpot.z) < 0.4, { closeUp, cam: C.info().cam });
// 再穿上衣服、装饰品、鞋子各一件
for (const z of ['top', 'acc', 'shoes']) { const id = C.info().rows.find((r) => r.zone === z).order[1]; C.select(id); step(0.2); btn('穿上').click(); step(0.2); }
step(1.6);
ck('四个分区各穿一件', ['hat', 'top', 'acc', 'shoes'].every((z) => !!D.outfit[z]), D.outfit);
if (stopAt === 'worn') { key('keydown', 'Escape'); step(0.2); key('keydown', 'Escape'); step(2.5); C.walkTo(0.6, 0.8); step(4, () => !C.info().dog.walking); C.orbit.azT = 0.5; C.orbit.distT = 8; step(1.5); return done(); }
btn('脱下').click(); step(0.3);
ck('点“脱下”：这个分区脱掉了', !D.outfit[C.info().selected ? 'shoes' : 'shoes'] && C.info().panel.wear === '穿上', D.outfit);
// 常穿的排前面：第 3 顶帽子穿 3 次、第 1 顶共 2 次、第 2 顶 1 次，重新打开橱柜就按这个顺序排
const third = hatRow.order[2];
C.wear(third); C.wear(firstHat); C.wear(third); C.wear(secondHat); C.wear(third);
key('keydown', 'Escape'); step(0.3);
ck('Esc：从展示面板退回橱柜，再按退回自由走动', C.info().mode === 'cabinet');
key('keydown', 'Escape'); step(0.5);
C.setMode('cabinet'); step(0.2);
const order2 = C.info().rows.find((r) => r.zone === 'hat').order;
ck('常穿的排在前面：按穿的次数从多到少排', C.info().mode === 'cabinet' && order2[0] === third && order2[1] === firstHat && order2[2] === secondHat, { order: order2, counts: C.info().counts });
key('keydown', 'Escape'); step(0.5);

// ---- 照镜子
btn('照镜子').click();
const atMirror = step(8, () => { const d = C.info().dog; return Math.hypot(d.x - R.mirror.standSpot.x, d.z - R.mirror.standSpot.z) < 0.2 && !d.walking; }); step(3);
const mi = C.info();
ck('点“照镜子”：小狗走到镜子前、面朝镜子坐下，相机到看镜子的机位', atMirror && mi.mode === 'mirror' && Math.abs(Math.atan2(Math.sin(mi.dog.heading - R.mirror.facing), Math.cos(mi.dog.heading - R.mirror.facing))) < 0.1 && D.action === 'sit' && Math.hypot(mi.cam[0] - R.mirror.viewSpot.x, mi.cam[2] - R.mirror.viewSpot.z) < 0.5, mi.dog);
if (stopAt === 'mirror') return done();
btn('站好').click(); step(0.6);
ck('照镜子时可以换姿势', D.action === 'idle' && C.info().dog.pose === 'stand', D.action);
key('keydown', 'Escape'); step(0.5);

// ---- 自拍
btn('自拍').click(); step(2.5);
const si = C.info();
ck('点“自拍”：镜头凑到小狗面前，小狗坐下眯眼笑', si.mode === 'selfie' && Math.hypot(si.cam[0] - si.dog.x, si.cam[2] - si.dog.z) < 3 && D.action === 'sit' && D.bliss === 1, { cam: si.cam, dog: si.dog });
if (stopAt === 'selfie') return done();
btn('咔嚓').click(); step(0.2);
ck('点“咔嚓”：存下一张照片（画面数据不为空）', downloads === 1 && C.info().lastPhoto > 5000, { downloads, bytes: C.info().lastPhoto });
key('keydown', 'Escape'); step(0.5);

// ---- 拍照区
btn('拍照区').click();
const atPhoto = step(9, () => { const d = C.info().dog; return Math.hypot(d.x - R.photo.standSpot.x, d.z - R.photo.standSpot.z) < 0.2 && !d.walking; }); step(3);
const ph = C.info();
ck('点“拍照区”：小狗走上圆台、面朝房间，相机到正对背景墙的机位', atPhoto && ph.mode === 'photo' && Math.abs(ph.dog.y - R.photo.standSpot.y) < 0.02 && Math.hypot(ph.cam[0] - R.photo.viewSpot.x, ph.cam[2] - R.photo.viewSpot.z) < 0.5, ph.dog);
const bd0 = ph.backdrop;
btn('▶').click(); step(0.3);
ck('点 ▶：换一面背景墙（存了档）', C.info().backdrop === (bd0 + 1) % R.photo.backdrops.length && JSON.parse(localStorage.getItem('shiba.wardrobe.v1')).backdrop === C.info().backdrop, { from: bd0, to: C.info().backdrop, n: R.photo.backdrops.length });
const poses = {};
for (const name of ['站好', '坐好', '眯眼笑', '趴下', '撅屁股', '露肚皮']) { btn(name).click(); step(0.5); poses[name] = D.action; }
ck('六个固定拍照姿势都能摆', poses['站好'] === 'idle' && poses['坐好'] === 'sit' && poses['趴下'] === 'lie' && poses['撅屁股'] === 'playbow' && poses['露肚皮'] === 'roll', poses);
if (stopAt === 'photo') {
  if (q.get('bd')) R.photo.setBackdrop(+q.get('bd')); btn(q.get('pose') || '坐好').click(); step(1.2);
  // 前面自拍“咔嚓”的白色闪光靠定时器淡出，脚本同步跑完之前定时器不会触发：截图前手动清掉
  for (const d of document.querySelectorAll('.pet-wardrobe div')) if (d.style.background === 'rgb(255, 255, 255)') { d.style.transition = 'none'; d.style.opacity = '0'; }
  return done();
}
btn('咔嚓').click(); step(0.2);
ck('拍照区也能“咔嚓”存照片', downloads === 2);

// ---- 退出：衣服还穿着；小岛复原
key('keydown', 'Escape'); step(0.5);
const outfitIn = { ...D.outfit };
key('keydown', 'Escape');
const leftOk = step(6, () => !W.active); step(2);
ck('自由走动时按 Esc：返回小岛；衣服还穿在身上，小狗回到岛上、brain 回到 auto', leftOk && JSON.stringify(D.outfit) === JSON.stringify(outfitIn) && D.group.parent === P.ctx.scene && B.mode === 'auto' && !B.mover.ext, { outfit: D.outfit, mode: B.mode });
step(6);
ck('回岛以后小狗正常活动（贴着岛的地面、没有报错）', Math.abs(D.group.position.y - P.island.heightAt(D.group.position.x, D.group.position.z)) < 0.12 && P.info().errors.length === 0, { y: f(D.group.position.y), state: B.state });
// ---- 存档：下次启动时把这身衣服穿回去（启动时调用的就是 applySavedOutfit）
{
  const { applySavedOutfit } = await import('/src/wardrobe/closet.js');
  const want = JSON.stringify(D.outfit);
  for (const z of ['hat', 'top', 'acc', 'shoes']) D.wear(z, null);
  const bare = Object.values(D.outfit).every((v) => !v);
  applySavedOutfit(D); step(0.2);
  ck('存档：脱光以后按存档能原样穿回去（启动时就是这么恢复的）', bare && JSON.stringify(D.outfit) === want && want.length > 60, D.outfit);
}
return done({ downloads });
