// 衣帽间里面玩法的端到端检查（页面内运行）：走动、右键 360° 转视角、换装（跳上站台触发、挑衣服的镜头、悬停取出、滑动、点一件直接穿上、
// 帘子拉上再拉开、鼠标移到身上的服饰出“脱下”按钮、常穿排序）、照镜子、自拍、拍照区（换背景、姿势、保存照片）、存档、退出后复原。
// 用法：node scripts/shot.cjs --out shots/closet.png --query "hour=11&weather=clear&seed=5" --size 900x640 --wait 500 --timeout 240000 --eval-file scripts/closet.eval.js
//   可选 &stop=free|orbit|browse|browseL|browseR|hover|curtain|show|worn|offbtn|mirror|selfie|photo：停在这个画面截图；&bd=<序号> 拍照区用哪个背景
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
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const ZALL = ['head', 'eyes', 'neck', 'body', 'back', 'feet'];

step(1);
W.open();
step(8, () => W.phase === 'room'); step(0.6);
const C = W.closet, R = W.room, DS = R.dress.standSpot, BR = R.dress.browse, CU = R.curtain;
ck('进了衣帽间：自由走动模式，底下只有“自拍”一个按钮（换装 / 镜子 / 拍照区都是走过去触发），帘子收在两边', W.phase === 'room' && C.mode === 'free' && !!btn('自拍') && C.info().bar.length === 1 && CU.open === 1, C.info().bar);
if (stopAt === 'free') return done();

// ---- 走动：键盘
const z0 = C.info().dog.z;
key('keydown', 'KeyW'); step(1.0);
const walking = D.action === 'walk', z1 = C.info().dog.z;
key('keyup', 'KeyW'); step(0.8);
ck('按 W：小狗往画面里（北）走，松开就停', walking && z1 < z0 - 0.8 && C.info().dog.speed < 0.1 && D.action === 'idle', { z0: f(z0), z1: f(z1), action: D.action });
// ---- 走动：点地面
const tx = R.walk.x0 + 1.2, tz = 0.9;
clickAt(C.floorScreen(tx, tz));
const arrived = step(6, () => { const d = C.info().dog; return Math.hypot(d.x - tx, d.z - tz) < 0.15 && d.speed < 0.1; });
ck('点一下地面：小狗走过去', arrived, C.info().dog);
// ---- 碰撞：往柜子里走、往墙外走，都不会穿进家具 / 出界
let minClear = 1e9, outside = 0;
for (const [x, z] of [[2.2, -R.size.d], [R.size.w, 0], [-R.size.w, 0.4], [R.mirror.standSpot.x - 2, R.mirror.standSpot.z], [0, R.size.d], [-1.8, 1.5]]) {
  if (C.mode !== 'free') { key('keydown', 'Escape'); step(0.1); }
  C.walkTo(x, z);
  step(5, () => { const d = C.info().dog; for (const o of R.obstacles) minClear = Math.min(minClear, Math.hypot(d.x - o.x, d.z - o.z) - o.r); if (d.x < R.walk.x0 - 1e-3 || d.x > R.walk.x1 + 1e-3 || d.z < R.walk.z0 - 1e-3 || d.z > R.walk.z1 + 1e-3) outside++; return !C.info().dog.walking; });
}
ck('走到哪儿都不穿家具（包括帘子的立柱）、不出可走范围', minClear > 0.3 && outside === 0, { minClear: f(minClear), outside });

// ---- 右键拖动 360° 转视角；转到墙背后时那面墙藏起来
if (C.mode !== 'free') { key('keydown', 'Escape'); step(0.1); }
C.walkTo(0, 0.5); step(5, () => !C.info().dog.walking && C.mode === 'free'); step(0.5);
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
C.orbit.azT = 0; C.orbit.distT = 13; step(1.5);

// ---- 换装
// 路过不触发：点地面从站台的一边走到另一边，途中从站台上踩过去（跳上又跳下），不触发换装
C.walkTo(DS.x - 2.4, DS.z + 0.3); step(6, () => !C.info().dog.walking);
let passY = 0, passMode = 'free';
C.walkTo(DS.x + 2.4, DS.z + 0.3); step(7, () => { const i = C.info(); passY = Math.max(passY, i.dog.y); if (i.mode !== 'free') passMode = i.mode; return !i.dog.walking; });
ck('点地面走去别处、只是从站台上踩过去：不触发换装', passMode === 'free' && C.mode === 'free' && passY > DS.y * 0.9 && C.info().dog.y === 0, { passMode, passY: f(passY), dog: C.info().dog });
// 走上站台：触发
let hopY = 0;
C.walkTo(DS.x + 0.2, DS.z + 0.25);
const dressOn = step(7, () => { hopY = Math.max(hopY, C.info().dog.y); return C.mode === 'dress'; });
ptr('pointermove', innerWidth / 2, innerHeight * 0.4, { buttons: 0 }); // 鼠标在画面中间：镜头在两个柜体中间
step(4, () => { hopY = Math.max(hopY, C.info().dog.y); return false; });
const ci = C.info();
const zones = ci.rows.map((r) => r.zone), SEC = R.cabinet.sections;
ck('跳上衣柜前的站台（有一个起跳的弧线）：自动进入换装——小狗在台子中间面朝衣柜坐下，帘子收在两边', dressOn && ci.mode === 'dress' && ci.stage === 'browse' && hopY > DS.y + 0.12 && Math.abs(ci.dog.y - DS.y) < 0.02 && Math.hypot(ci.dog.x - DS.x, ci.dog.z - DS.z) < 0.12 && angDiff(ci.dog.heading, Math.PI) < 0.1 && D.action === 'sit' && ci.curtain === 1 && ci.title === '换装', { dog: ci.dog, hopY: f(hopY), action: D.action, curtain: ci.curtain });
ck('挑衣服的镜头：在小狗身后上方对着一排排衣服（朝北看柜子，离柜子有一段距离）', Math.abs(ci.cam[1] - BR.y) < 0.15 && Math.abs(ci.cam[2] - BR.z) < 0.15 && Math.abs(ci.cam[0]) < 0.3 && ci.cam[2] > DS.z + 1.5 && ci.walls.north === true, ci.cam);
ck('柜子按身体部位分 6 个区（头上 / 眼睛 / 脖子 / 身上 / 背上 / 脚上），左右两个柜体各 3 排，每排可视范围里摆着前几件', SEC.length === 2 && ci.rows.length === 6 && ZALL.every((z) => zones.includes(z)) && ci.rows.filter((r) => r.sec === 0).length === 3 && ci.rows.every((r) => r.order.length >= 4 && r.shown.length === Math.min(R.cabinet.visible, r.order.length) && r.shown.every((id, k) => id === r.order[k])), ci.rows.map((r) => r.zone + '@' + r.sec + ':' + r.shown.length + '/' + r.order.length));
if (stopAt === 'browse') return done();
// 鼠标左右移动：镜头跟着在两个柜体之间平移
const cr = el.getBoundingClientRect();
ptr('pointermove', cr.left + 3, cr.top + cr.height * 0.4, { buttons: 0 }); step(2);
const panL = C.info().cam[0];
if (stopAt === 'browseL') return done();
ptr('pointermove', cr.right - 3, cr.top + cr.height * 0.4, { buttons: 0 }); step(2);
const panR = C.info().cam[0];
ck('鼠标移到画面左边 / 右边：镜头平移到左边 / 右边的柜体正面', Math.abs(panL - BR.panMin) < 0.1 && Math.abs(panR - BR.panMax) < 0.1, { panL, panR, want: [BR.panMin, BR.panMax] });
if (stopAt === 'browseR') return done();
// 把鼠标移到某一件上（镜头跟着鼠标平移，所以要挪几次才对得准）
const hoverOn = (id) => { let m = null; for (let k = 0; k < 7; k++) { const p = C.itemScreen(id); m = m ? { x: m.x + (p.x - m.x) * 0.5, y: p.y } : { x: Math.min(cr.right - 4, Math.max(cr.left + 4, p.x)), y: p.y }; ptr('pointermove', m.x, m.y, { buttons: 0 }); step(0.7); } ptr('pointermove', m.x, m.y, { buttons: 0 }); step(0.3); return m; };
const hatRow = ci.rows.find((r) => r.zone === 'head'), firstHat = hatRow.order[0], secondHat = hatRow.order[1], third = hatRow.order[2];
const nameOf = async (id) => (await import('/src/wardrobe/garments.js')).GARMENTS.find((g) => g.id === id).name;
const hatName = await nameOf(firstHat);
let hp = hoverOn(firstHat);
ck('鼠标移到一件上：它往上取出一截，旁边显示名字', C.info().hover === firstHat && C.info().lift > 0.85 && C.info().nameTag === hatName, { hover: C.info().hover, lift: C.info().lift, nameTag: C.info().nameTag });
if (stopAt === 'hover') return done();
// 滑动：滚轮翻这一排
el.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true, clientX: hp.x, clientY: hp.y })); step(0.8);
const sc = C.info().rows.find((r) => r.zone === 'head');
ck('在一排上滚滚轮：这一排往左滑一格，露出后面的（别的排不动）', hatRow.max > 0 && Math.abs(sc.scroll - 1) < 0.05 && sc.shown[0] === hatRow.order[1] && C.info().rows.filter((r) => r.zone !== 'head').every((r) => r.scroll === 0), { max: hatRow.max, scroll: sc.scroll, shown: sc.shown });
// 按住拖动也能翻
ptr('pointerdown', hp.x, hp.y); ptr('pointermove', hp.x + 400, hp.y); ptr('pointerup', hp.x + 400, hp.y, { buttons: 0 }); step(0.8);
ck('按住往右拖：这一排滑回去；拖动不算点击（没有换衣服）', C.info().rows.find((r) => r.zone === 'head').scroll < 0.05 && C.info().stage === 'browse' && !D.outfit.head, { scroll: C.info().rows.find((r) => r.zone === 'head').scroll, stage: C.info().stage });
// 换一次衣服的全过程：记录经过的阶段、帘子最小开度、衣服是在帘子多大开度时换上的
const runChange = () => {
  const seen = [], before = JSON.stringify(D.outfit); let minCurt = 1, swapAt = null, camZ = null;
  step(4, () => { const i = C.info(); if (seen[seen.length - 1] !== i.stage) seen.push(i.stage); if (camZ === null) camZ = i.cam[2]; minCurt = Math.min(minCurt, i.curtain); if (swapAt === null && JSON.stringify(D.outfit) !== before) swapAt = i.curtain; return i.stage === 'show'; });
  return { seen: seen.join('>'), minCurt, swapAt, camZ };
};
// 点一件：直接穿上
hp = hoverOn(firstHat);
clickAt(hp);
if (stopAt === 'curtain') { step(4, () => C.info().curtain < (+q.get('k') || 0.5)); return done(); }
const ch = runChange();
const saved1 = JSON.parse(localStorage.getItem('shiba.wardrobe.v1') || '{}');
ck('点一件：直接给小狗穿上（不出面板）——镜头切到帘子外面，帘子拉上 → 换好 → 帘子拉开；衣服是在帘子拉上的时候换的；存了档', ch.seen === 'closing>hold>opening>show' && ch.minCurt === 0 && ch.swapAt !== null && ch.swapAt < 0.1 && ch.camZ > CU.z + 0.5 && D.outfit.head === firstHat && saved1.outfit && saved1.outfit.head === firstHat && saved1.counts[firstHat] === 1, { ...ch, outfit: D.outfit, saved: saved1 });
step(2.0);
const sh = C.info();
ck('帘子拉开以后：镜头到了小狗前面，小狗朝着镜头站着，底下有“接着选”', sh.stage === 'show' && sh.curtain === 1 && Math.hypot(sh.cam[0] - R.dress.front.viewSpot.x, sh.cam[2] - R.dress.front.viewSpot.z) < 0.2 && sh.cam[2] > sh.dog.z && Math.cos(sh.dog.heading) > 0.7 && D.action === 'idle' && sh.bar.length === 1 && !!btn('接着选'), { cam: sh.cam, dog: sh.dog, bar: sh.bar });
if (stopAt === 'show') return done();
// 鼠标移到身上的服饰：那个位置出现“脱下”按钮
const hoverZone = (z) => { const p = C.zoneScreen(z); ptr('pointermove', p.x, p.y, { buttons: 0 }); step(0.25); const b = btn('脱下'), r = b ? b.getBoundingClientRect() : null; return { p, zone: C.info().hoverZone, text: C.info().offBtn, near: r ? Math.hypot((r.left + r.right) / 2 - p.x, (r.top + r.bottom) / 2 - p.y) : 1e9 }; };
const noBtn0 = !btn('脱下');
const hz = hoverZone('head');
ck('鼠标移到它戴的帽子上：帽子那儿出现“脱下”按钮（没移上去时没有）', noBtn0 && hz.zone === 'head' && hz.text === '脱下' + hatName && hz.near < 40, hz);
ptr('pointermove', cr.left + 30, cr.bottom - 30, { buttons: 0 }); step(1.0);
ck('鼠标移开：按钮消失', !btn('脱下') && C.info().hoverZone === null, { offBtn: C.info().offBtn });
hoverZone('head'); btn('脱下').click();
const off1 = runChange(); step(0.5);
ck('点“脱下”：帘子拉上再拉开，帽子脱掉了，按钮也没了', off1.seen === 'closing>hold>opening>show' && off1.minCurt === 0 && !D.outfit.head && !btn('脱下') && !JSON.parse(localStorage.getItem('shiba.wardrobe.v1')).outfit.head, { ...off1, outfit: D.outfit });
// 接着选
btn('接着选').click(); step(3);
const bk = C.info();
ck('点“接着选”：回到挑衣服——小狗转回去面朝衣柜坐下，镜头回到一排排衣服上', bk.stage === 'browse' && angDiff(bk.dog.heading, Math.PI) < 0.1 && D.action === 'sit' && Math.abs(bk.cam[1] - BR.y) < 0.15 && bk.bar.length === 0, { dog: bk.dog, cam: bk.cam, action: D.action });
// 六个部位各穿一件
for (const z of ZALL) { C.choose(C.info().rows.find((r) => r.zone === z).order[1]); step(4, () => C.info().stage === 'show'); if (z === 'neck') { C.backToBrowse(); step(0.5); } }
step(1.5);
ck('六个部位可以同时各穿一件，互不顶掉（在亮相时接着点、回去挑再点都可以）', ZALL.every((z) => !!D.outfit[z]) && D.outfit.head === secondHat, D.outfit);
if (stopAt === 'worn') return done();
{
  const res = {};
  for (const z of ZALL) { ptr('pointermove', cr.left + 30, cr.bottom - 30, { buttons: 0 }); step(0.8); const h = hoverZone(z); res[z] = h.zone === z && h.near < 40 ? 'ok' : JSON.stringify(h); if (stopAt === 'offbtn' && z === (q.get('zone') || 'body')) return done(); }
  ck('六个部位的服饰都能在身上指到：鼠标移到哪件上，就在那儿出现那件的“脱下”按钮', ZALL.every((z) => res[z] === 'ok'), res);
}
ptr('pointermove', cr.left + 30, cr.bottom - 30, { buttons: 0 }); step(0.8);
hoverZone('feet'); btn('脱下').click(); runChange(); step(0.3);
ck('脱下脚上的：别的部位不受影响', !D.outfit.feet && ['head', 'eyes', 'neck', 'body', 'back'].every((z) => !!D.outfit[z]), D.outfit);
// 在柜子里点正穿着的那件 = 脱下
key('keydown', 'Escape'); step(1.5);
ck('亮相时按 Esc：先回到挑衣服', C.mode === 'dress' && C.info().stage === 'browse', C.info().stage);
const neckId = D.outfit.neck;
hp = hoverOn(neckId);
const tagWorn = C.info().nameTag;
clickAt(hp); runChange(); step(0.3);
ck('柜子里正穿着的那件有标记，点它 = 脱下', !!tagWorn && tagWorn.includes('穿着中') && !D.outfit.neck && !!D.outfit.eyes, { tagWorn, outfit: D.outfit });
// 常穿的排前面：第 3 顶帽子穿 3 次、第 1 顶共 2 次、第 2 顶 1 次；下次上站台就按这个顺序排
C.wear(third); C.wear(firstHat); C.wear(third); C.wear(hatRow.order[3]); C.wear(third);
key('keydown', 'Escape'); step(1.2);
key('keydown', 'Escape'); step(0.6);
const stayD = C.mode === 'free' && C.info().latch === 'dress'; step(1.0);
ck('挑衣服时按 Esc：离开换装；人还站在台子上也不会马上又触发', stayD && C.mode === 'free', { mode: C.mode, latch: C.info().latch });
C.walkTo(0, 0.5); step(5, () => !C.info().dog.walking);
C.walkTo(DS.x, DS.z); const againD = step(7, () => C.mode === 'dress'); step(2);
const order2 = C.info().rows.find((r) => r.zone === 'head').order;
ck('走开再跳上站台：又进入换装；常穿的排在前面（按穿的次数从多到少）', againD && order2[0] === third && order2[1] === firstHat && order2[2] === secondHat, { order: order2.slice(0, 4), counts: C.info().counts });
key('keydown', 'KeyS'); step(1.3); key('keyup', 'KeyS'); step(0.6);
ck('在站台上用键盘往外走（S）：跳下台子，自动回到自由走动', C.mode === 'free' && C.info().dog.y === 0 && C.info().dog.z > DS.z + 0.9, { mode: C.mode, dog: C.info().dog });

// ---- 照镜子
C.walkTo(0, 0.5); step(5, () => !C.info().dog.walking && C.mode === 'free');
C.walkTo(R.mirror.standSpot.x + 0.25, R.mirror.standSpot.z + 0.2);
const atMirror = step(8, () => { const d = C.info().dog; return Math.hypot(d.x - R.mirror.standSpot.x, d.z - R.mirror.standSpot.z) < 0.2 && !d.walking; }); step(3);
const mi = C.info();
ck('走到镜子前的小地垫上：自动进入照镜子——小狗站正、面朝镜子坐下，相机到看镜子的机位', atMirror && mi.mode === 'mirror' && angDiff(mi.dog.heading, R.mirror.facing) < 0.1 && D.action === 'sit' && Math.hypot(mi.cam[0] - R.mirror.viewSpot.x, mi.cam[2] - R.mirror.viewSpot.z) < 0.5, mi.dog);
if (stopAt === 'mirror') return done();
const p0 = C.info().dog.pose;
btn('换个姿势').click(); step(0.5);
const p1 = C.info().dog.pose;
clickAt(C.dogScreen()); step(0.5);
const p2 = C.info().dog.pose;
ck('只有一个“换个姿势”按钮；点按钮、点小狗都会换到下一个姿势', C.info().bar.length === 1 && p0 === 'sit' && p1 === 'smile' && p2 === 'lie' && D.action === 'lie', { p0, p1, p2, bar: C.info().bar });
key('keydown', 'Escape'); step(0.6);
const stay = C.mode === 'free' && C.info().latch === 'mirror'; step(1.0);
ck('按 Esc 离开照镜子：人还站在地垫上也不会马上又触发', stay && C.mode === 'free', { mode: C.mode, latch: C.info().latch });
key('keydown', 'KeyD'); step(1.4); key('keyup', 'KeyD'); step(0.4);
C.walkTo(R.mirror.standSpot.x, R.mirror.standSpot.z); const again = step(6, () => C.mode === 'mirror');
ck('走开再走回来：又能照镜子', again, C.mode);
key('keydown', 'KeyD'); step(1.6); key('keyup', 'KeyD'); step(0.4);
ck('照镜子时用键盘走开：自动回到自由走动', C.mode === 'free', C.mode);

// ---- 自拍
btn('自拍').click(); step(2.5);
const si = C.info();
ck('点“自拍”：镜头凑到小狗面前，小狗坐下眯眼笑', si.mode === 'selfie' && Math.hypot(si.cam[0] - si.dog.x, si.cam[2] - si.dog.z) < 3 && D.action === 'sit' && D.bliss === 1, { cam: si.cam, dog: si.dog });
if (stopAt === 'selfie') return done();
btn('咔嚓').click(); step(0.2);
ck('点“咔嚓”：存下一张照片（画面数据不为空）', downloads === 1 && C.info().lastPhoto > 5000, { downloads, bytes: C.info().lastPhoto });
key('keydown', 'Escape'); step(0.5);

// ---- 拍照区
C.walkTo(0, 0.5); step(5, () => !C.info().dog.walking && C.mode === 'free');
let maxY = 0;
C.walkTo(R.photo.standSpot.x - 0.2, R.photo.standSpot.z + 0.15);
const atPhoto = step(9, () => { maxY = Math.max(maxY, C.info().dog.y); const d = C.info().dog; return Math.hypot(d.x - R.photo.standSpot.x, d.z - R.photo.standSpot.z) < 0.2 && !d.walking; }); step(3);
const ph = C.info();
ck('走到圆台：小狗跳上去（有一个起跳的弧线），自动进入拍照——面朝房间坐好，相机到正对背景墙的机位', atPhoto && maxY > R.photo.standSpot.y + 0.12 && ph.mode === 'photo' && Math.abs(ph.dog.y - R.photo.standSpot.y) < 0.02 && Math.hypot(ph.cam[0] - R.photo.viewSpot.x, ph.cam[2] - R.photo.viewSpot.z) < 0.5, ph.dog);
const bd0 = ph.backdrop;
btn('▶').click(); step(0.3);
ck('点 ▶：换一面背景墙（存了档）', C.info().backdrop === (bd0 + 1) % R.photo.backdrops.length && JSON.parse(localStorage.getItem('shiba.wardrobe.v1')).backdrop === C.info().backdrop, { from: bd0, to: C.info().backdrop, n: R.photo.backdrops.length });
const poses = [];
for (let k = 0; k < 6; k++) { if (k % 2) clickAt(C.dogScreen()); else btn('换个姿势').click(); step(0.5); poses.push(C.info().dog.pose + ':' + D.action); }
ck('“换个姿势” / 点小狗：六个固定姿势轮着来', new Set(poses).size === 6 && ['idle', 'sit', 'lie', 'playbow', 'roll'].every((a) => poses.some((p) => p.endsWith(':' + a))), poses);
if (stopAt === 'photo') {
  if (q.get('bd')) R.photo.setBackdrop(+q.get('bd')); for (let k = 0; k < (+q.get('pose') || 0); k++) { btn('换个姿势').click(); step(0.4); } step(1.0);
  // 前面自拍“咔嚓”的白色闪光靠定时器淡出，脚本同步跑完之前定时器不会触发：截图前手动清掉
  for (const d of document.querySelectorAll('.pet-wardrobe div')) if (d.style.background === 'rgb(255, 255, 255)') { d.style.transition = 'none'; d.style.opacity = '0'; }
  return done();
}
btn('咔嚓').click(); step(0.2);
ck('拍照区也能“咔嚓”存照片', downloads === 2);
// 走下圆台：自动离开拍照
C.walkTo(0, 0.5); const offOk = step(6, () => !C.info().dog.walking); step(0.6);
ck('走下圆台：自动回到自由走动，并且接着走到点的地方（不会一出圆台就停住）', offOk && C.mode === 'free' && C.info().dog.y === 0 && Math.hypot(C.info().dog.x, C.info().dog.z - 0.5) < 0.2, { mode: C.mode, dog: C.info().dog });

// ---- 退出：衣服还穿着；小岛复原
const outfitIn = { ...D.outfit };
key('keydown', 'Escape');
const leftOk = step(6, () => !W.active); step(2);
ck('自由走动时按 Esc：返回小岛；衣服还穿在身上，小狗回到岛上、brain 回到 auto', leftOk && JSON.stringify(D.outfit) === JSON.stringify(outfitIn) && D.group.parent === P.ctx.scene && B.mode === 'auto' && !B.mover.ext, { outfit: D.outfit, mode: B.mode });
step(6);
ck('回岛以后小狗正常活动（贴着岛的地面、没有报错）', Math.abs(D.group.position.y - P.island.heightAt(D.group.position.x, D.group.position.z)) < 0.12 && P.info().errors.length === 0, { y: f(D.group.position.y), state: B.state });
// ---- 存档：下次启动时把这身衣服穿回去（启动时调用的就是 applySavedOutfit）
{
  const { applySavedOutfit, loadWardrobe } = await import('/src/wardrobe/closet.js');
  const want = JSON.stringify(D.outfit);
  for (const z of ZALL) D.wear(z, null);
  const bare = Object.values(D.outfit).every((v) => !v);
  applySavedOutfit(D); step(0.2);
  ck('存档：脱光以后按存档能原样穿回去（启动时就是这么恢复的）', bare && JSON.stringify(D.outfit) === want && want.length > 60, D.outfit);
  // 老存档（分区名还是 hat / top / acc / shoes）：按服饰 id 归到现在的分区
  const keep = localStorage.getItem('shiba.wardrobe.v1');
  localStorage.setItem('shiba.wardrobe.v1', JSON.stringify({ outfit: { hat: 'hat_cap', top: 'top_sweater', acc: 'acc_scarf', shoes: 'shoes_socks' }, counts: { hat_cap: 3 }, backdrop: 2 }));
  const old = loadWardrobe();
  localStorage.setItem('shiba.wardrobe.v1', keep);
  ck('老存档能认：帽子归到头上、围巾归到脖子、衣服归到身上、袜子归到脚上', old.outfit.head === 'hat_cap' && old.outfit.neck === 'acc_scarf' && old.outfit.body === 'top_sweater' && old.outfit.feet === 'shoes_socks' && old.counts.hat_cap === 3 && old.backdrop === 2, old.outfit);
}
return done({ downloads });
