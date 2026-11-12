// 白鹭来访 / 乘鹭出门的流程测试（页面内运行）。
// 用法：node scripts/shot.cjs --out shots/egret-test.png --query "hour=10&weather=clear&seed=5" --wait 300 --timeout 400000 --eval-file scripts/egret-test.eval.js
const P = __pet; window.requestAnimationFrame = () => 0;
try { localStorage.removeItem('shiba-island.travel'); } catch (_) { /* ignore */ }
const T = P.travel, B = P.brain, D = P.dog, env = P.env, I = P.island, M = B.mover;
const checks = {};
const ck = (k, ok, info) => { checks[k] = (ok ? 'PASS' : 'FAIL') + (info !== undefined ? ' ' + info : ''); };
const run = (sec, each) => { const n = Math.round(sec * 30); for (let i = 0; i < n; i++) { P.step(1 / 30, 1); if (each && each(i / 30) === false) return i / 30; } return sec; };
const until = (fn, max) => run(max, () => !fn());
env.setWeather('clear', { instant: true }); env.setHour(10);
run(3);

// ---- 1. 普通来访：飞来 → 落在岛边 → 走走啄啄 → 不超过 1 分钟飞走
ck('1a 空闲时可以来访', T.phase === 'idle' && T.visitNow({ ride: false }) === true);
const tArr = until(() => T.phase === 'stay', 15);
ck('1b 15 秒内落到岛上', T.phase === 'stay', tArr.toFixed(1) + 's');
let onGround = true, maxEdge = 0, states = new Set(), moved = 0, last = null, stayT = 0, dogStay = true;
const tStay = run(70, (t) => {
  if (T.phase !== 'stay') return false;
  const b = T.info().bird; states.add(b.state); stayT = t;
  const p = b.pos, gy = I.heightAt(p[0], p[2]);
  if (Math.abs(p[1] - gy) > 0.05) onGround = false;
  const r = Math.hypot(p[0], p[2]); maxEdge = Math.max(maxEdge, r);
  if (last) moved += Math.hypot(p[0] - last[0], p[2] - last[2]); last = p;
  if (!D.group.visible || B.mode === 'game') dogStay = false;
});
ck('1c 停留不超过 60 秒', stayT > 20 && stayT <= 60.5, stayT.toFixed(1) + 's');
ck('1d 停留期间贴着地面、在岛的边缘活动', onGround && maxEdge > 5.5, '最远离岛心 ' + maxEdge.toFixed(1));
ck('1e 会走动和啄地', moved > 0.8 && states.has('walk') && states.has('peck'), '走了 ' + moved.toFixed(1) + '，状态 ' + [...states].join(','));
ck('1f 不带狗走时小狗照常生活', dogStay);
until(() => T.phase === 'idle', 15);
ck('1g 飞走后消失', T.phase === 'idle' && T.info().bird === null);

// ---- 2. 天气：雨天不来；在岛上时下雨提前走
env.setWeather('rain', { instant: true }); run(1);
ck('2a 下雨时不来', T.visitNow({ ride: false }) === false);
env.setWeather('clear', { instant: true }); run(40); // 等雨停、小狗出窝
T.visitNow({ ride: false }); until(() => T.phase === 'stay', 15); run(5);
env.setWeather('rain', { instant: true });
const tGo = until(() => T.phase === 'leave' || T.phase === 'idle', 8);
ck('2b 在岛上时下雨：马上飞走', T.phase === 'leave' || T.phase === 'idle', tGo.toFixed(1) + 's');
env.setWeather('clear', { instant: true }); until(() => T.phase === 'idle', 15); run(45);

// ---- 3. 出门：小狗跑过去、趴到背上、被驮走
env.setHour(10.2);
until(() => B.canGame() && !M.inKennel && !M.onRamp, 60);
ck('3a 来访（带狗走）', T.debugStart('ride') === true);
until(() => T.phase === 'board' || T.phase === 'idle', 40);
ck('3b 小狗被接管，跑向白鹭', T.phase === 'board' && B.mode === 'game', T.phase + ' / ' + B.mode);
until(() => T.phase === 'mount', 12);
run(1.0);
const seat = new P.THREE.Vector3(); let rideOK = false;
until(() => T.phase === 'depart', 3); run(2, () => { const b = T.info().bird; if (b && D.action === 'lie' && D.group.position.y > 1.5) rideOK = true; });
ck('3c 趴在白鹭背上飞起来', rideOK, '动作 ' + D.action + ' 高度 ' + D.group.position.y.toFixed(1));
until(() => T.phase === 'away', 15);
const inf = T.info();
ck('3d 飞远后：小狗和白鹭都不在岛上，提示条出现', T.phase === 'away' && !D.group.visible && inf.bird === null && /出门/.test(inf.hint), inf.hint);
ck('3e 出门状态写进本地存储', /"away":true/.test(localStorage.getItem('shiba-island.travel') || ''));
// 出门期间
P.stick.click(null); run(0.3);
ck('3f 出门期间点树枝：不拿出来，提示小狗出门了', P.stick.state === 'hidden' && /出门/.test(T.info().toast), T.info().toast);
ck('3g 出门期间不能开始钓鱼 / 遛狗', P.fishing.start({}) === false && !P.fishing.active && P.game.start({}) === false && !P.game.active);
ck('3h 出门期间白鹭不再来', T.visitNow({ ride: false }) === false);
ck('3i 出门期间不能摸', B.canPet() === false);
run(30);
ck('3j 过一会儿仍在外面', T.phase === 'away');

// ---- 4. 18:00 回来
env.setHour(18.01);
until(() => T.phase === 'return', 2);
ck('4a 18:00 白鹭驮着小狗飞回来', T.phase === 'return' && D.group.visible, T.phase);
until(() => T.phase === 'leave' || T.phase === 'idle', 20);
const gy = I.heightAt(M.x, M.z);
ck('4b 小狗跳下来站在岛上，恢复自主', B.mode === 'auto' && D.group.visible && I.isWalkable(M.x, M.z) && Math.abs(D.group.position.y - gy) < 0.15, B.mode + ' y差 ' + (D.group.position.y - gy).toFixed(2));
ck('4c 提示条消失、存储里不再是出门中', T.info().hint === '' && !/"away":true/.test(localStorage.getItem('shiba-island.travel') || ''));
until(() => T.phase === 'idle', 15);
let ate = false; run(60, () => { if (/eat/.test(B.state)) ate = true; });
ck('4d 回来后去吃晚饭', ate, B.state);

// ---- 5. 一天只出门一次；手动召回
env.setHour(11.2); run(60); // 选一个附近没有来访时刻的时间，免得时刻表自己触发一次来访
until(() => B.canGame() && !M.inKennel && !M.onRamp, 60);
T.visitNow({ ride: true }); until(() => T.phase === 'stay', 15);
const t5 = until(() => T.phase !== 'stay', 62);
ck('5a 今天出过门了：白鹭再来也不跟着走', T.phase === 'leave' && B.mode !== 'game', T.phase);
until(() => T.phase === 'idle', 15);
T.debugStart('away'); run(1);
ck('5b 调试：直接进入出门状态', T.phase === 'away' && !D.group.visible);
ck('5c 点“叫它回来”', T.recall() === true && T.phase === 'return');
until(() => T.phase === 'idle', 30);
ck('5d 召回后小狗回到岛上', B.mode === 'auto' && D.group.visible && T.info().hint === '');

// ---- 6. 时刻表：晴天 5 次、阴天 3 次、雷雨 0 次（把时间依次拨到各个时刻）
const countDay = (w) => {
  env.setWeather(w, { instant: true }); T.noRide = true;
  env.setHour(7.5); run(2);
  const v0 = T.visits;
  for (const s of T.info().slots) { env.setHour(s + 0.02); run(0.5); T.noRide = true; until(() => T.phase === 'idle', 90); }
  return T.visits - v0;
};
localStorage.removeItem('shiba-island.travel');
// 换一天的时刻表要等日期变化；这里直接把完成标记清掉
ck('6a 时刻表有 5 个时刻，都在 8:00–18:00', T.info().slots.length === 5 && T.info().slots.every((s) => s >= 8 && s < 18), T.info().slots.join(' '));
T.resetDay(); const nClear = countDay('clear');
T.resetDay(); const nCloudy = countDay('cloudy');
T.resetDay(); const nStorm = countDay('storm');
ck('6b 晴天来 5 次、阴天 3 次、雷雨 0 次', nClear === 5 && nCloudy === 3 && nStorm === 0, nClear + ' / ' + nCloudy + ' / ' + nStorm);
env.setWeather('clear', { instant: true });
const errs = P.info().errors;
const fails = Object.values(checks).filter((v) => v.startsWith('FAIL')).length;
return { fails, checks, stub: T.info().stub, errors: errs };
