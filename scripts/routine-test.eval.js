// 作息模拟（页面内运行）：把岛上的时间依次拨到一天里的各个时段，每段跑 4 分钟，统计小狗把时间花在了什么上；
// 再专门检查几个节点：6:30 起床伸懒腰、7:00 早饭、18:00 晚饭（各吃一次、碗会空）、午睡、22:00 回窝睡觉。
// 用法：node scripts/shot.cjs --out shots/routine.png --query "hour=5&weather=clear&seed=5" --wait 300 --timeout 400000 --eval-file scripts/routine-test.eval.js
const P = __pet; window.requestAnimationFrame = () => 0;
const B = P.brain, D = P.dog, env = P.env, I = P.island, M = B.mover;
env.setWeather('clear', { instant: true });
const run = (sec, each) => { const n = Math.round(sec * 30); for (let i = 0; i < n; i++) { P.step(1 / 30, 1); if (each) each(i / 30); } };
const name = () => (B.state || '').split(':')[1] || B.state;
const checks = {}, table = [];
const ck = (k, ok, info) => { checks[k] = (ok ? 'PASS' : 'FAIL') + (info ? ' ' + info : ''); };

// ---- 夜里：在窝里睡
env.setHour(3); run(40);
ck('03:00 在窝里睡觉', M.inKennel && D.action === 'sleep', D.action);
// ---- 6:30 起床
env.setHour(6.45); run(20);
ck('06:27 还在睡', M.inKennel && D.action === 'sleep', D.action);
const acts = new Set(); let sawWake = false, drank = false;
env.setHour(6.52); run(40, () => { acts.add(D.action); if (name() === 'wake') sawWake = true; if (name() === 'drink' && D.action === 'drink') drank = true; });
ck('06:31 起床：出窝、伸懒腰、抖毛', sawWake && acts.has('playbow') && acts.has('shake') && !M.inKennel, [...acts].join(','));
run(60, () => { if (name() === 'drink' && D.action === 'drink') drank = true; });
ck('起床后去喝水', drank);
ck('07:00 前碗是空的', I.bowl.level === 0 && !B.state.includes('eat'), 'level ' + I.bowl.level);
// ---- 早饭
env.setHour(7.02);
let eatT = 0, eats = 0, lastEat = false, minLevel = 1, maxLevel = 0;
run(150, () => { const e = name() === 'eat'; if (e && !lastEat) eats++; lastEat = e; if (e && D.action === 'drink') eatT += 1 / 30; maxLevel = Math.max(maxLevel, I.bowl.level); minLevel = Math.min(minLevel, I.bowl.level); });
ck('07:01 早饭：碗里盛上狗粮，跑去吃，吃完碗空', eats === 1 && eatT > 5 && maxLevel > 0.9 && I.bowl.level === 0, `吃了 ${eats} 次，埋头 ${eatT.toFixed(1)}s，碗 ${maxLevel.toFixed(2)}→${I.bowl.level.toFixed(2)}`);
const dist = Math.hypot(M.x - I.anchors.bowl.x, M.z - I.anchors.bowl.z);
eats = 0; run(120, () => { const e = name() === 'eat'; if (e && !lastEat) eats++; lastEat = e; });
ck('早饭只吃一次', eats === 0, '又吃了 ' + eats + ' 次');

// ---- 一天各时段的时间分配
const blocks = {};
for (const h of [7.6, 8.5, 9.5, 10.5, 11.5, 12.6, 13.5, 14.3, 15.2, 16.2, 17.2, 18.05, 18.8, 19.7, 20.8, 21.7, 22.1, 23.5]) {
  env.setHour(h);
  const t = {}; let fast = 0;
  run(h === 18.05 ? 200 : 240, () => { const k = name(); t[k] = (t[k] || 0) + 1 / 30; if (M.speed > 2) fast += 1 / 30; });
  const top = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + ' ' + Math.round(v) + 's').join('，');
  table.push(String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0') + '  ' + top + '  奔跑 ' + Math.round(fast) + 's');
  blocks[h] = { fast, rest: (t.nap || 0) + (t.sunbathe || 0) + (t.sit || 0) + (t.fetchMat || 0) };
  if (h === 18.05) ck('18:03 晚饭', (t.eat || 0) > 8 && I.bowl.level === 0, top);
  if (h === 20.8) ck('20:48 晚上不疯跑、在窝门口歇着', fast < 6 && (t.evening || 0) + (t.sit || 0) > 90, top);
  if (h === 23.5) ck('23:30 在窝里睡觉', M.inKennel && D.action === 'sleep', D.action);
}
// 单个 4 分钟的时段随机性大，按上午 / 中午 / 傍晚几段合起来看
const sum = (hs, k) => hs.reduce((a, h) => a + blocks[h][k], 0);
const amRun = sum([7.6, 8.5, 9.5], 'fast'), noonRun = sum([12.6, 13.5, 14.3], 'fast'), pmRun = sum([16.2, 17.2], 'fast'), noonRest = sum([12.6, 13.5, 14.3], 'rest');
ck('上午 7:30–9:30 活跃（有奔跑）', amRun >= 20, '奔跑 ' + Math.round(amRun) + 's / 12 分钟');
ck('中午 12:30–14:30 以午睡 / 晒太阳 / 坐着为主', noonRest >= 300 && noonRun <= Math.max(15, amRun * 0.6), '休息 ' + Math.round(noonRest) + 's、奔跑 ' + Math.round(noonRun) + 's / 12 分钟');
ck('傍晚 16:00–17:30 又活跃起来', pmRun >= 15, '奔跑 ' + Math.round(pmRun) + 's / 8 分钟');
const fails = Object.values(checks).filter((v) => v.startsWith('FAIL')).length;
return { fails, checks, table, errors: P.info().errors };
