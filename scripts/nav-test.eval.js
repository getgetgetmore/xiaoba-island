// 寻路批量测试（页面内运行）：单独建一个寻路控制器，从全岛的格点出发，走 / 跑向各个常用目标和随机点，
// 统计：没到（超时）、中途放弃、明显卡顿（有目标却停住超过 0.8 秒）、绕远（用时远超直线所需）。
// 用法：node scripts/shot.cjs --out shots/nav.png --query "hour=11&weather=clear&seed=5&brain=off" --wait 300 --timeout 300000 --eval-file scripts/nav-test.eval.js
const P = __pet; window.requestAnimationFrame = () => 0;
const { createMover, RUN_SPEED, WALK_SPEED } = await import('/src/dog/brain/mover.js');
const I = P.island, A = I.anchors, T = P.THREE;
const dummy = { group: new T.Group(), speed: 0 };
dummy.group.scale.setScalar(1.5);
const m = createMover({ island: I }, dummy);

const starts = [];
for (let x = -6.5; x <= 6.51; x += 1.0) for (let z = -6; z <= 6.01; z += 1.0) if (I.isWalkable(x, z)) starts.push([x, z]);
const goals = [['窝门', A.kennelDoor.x, A.kennelDoor.z], ['喝水点', A.pondDrink.x, A.pondDrink.z], ['草坪', A.lawn.x, A.lawn.z], ['午睡点', A.napSpot.x, A.napSpot.z], ['看晚霞', A.sunsetSpot.x, A.sunsetSpot.z]];
if (A.lookout) goals.push(['坡道底', A.lookout.base.x, A.lookout.base.z]);
(A.sniffSpots || []).forEach((s, i) => goals.push(['嗅' + i, s.x, s.z]));
(A.flowerSpots || []).slice(0, 4).forEach((s, i) => goals.push(['花' + i, s.x, s.z]));
// 伪随机的可行走点
let seed = 99; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
for (let k = 0; k < 14; ) { const x = (rnd() * 2 - 1) * 6.5, z = (rnd() * 2 - 1) * 6; if (I.isWalkable(x, z)) { goals.push(['随机' + k, x, z]); k++; } }

// 哪些点和草坪连通（按 0.25 的格子在 isWalkable 上做一次洪水填充）：被障碍围死的小块地方本来就走不到 / 走不出来
const E = 0.13, ok = (x, z) => I.isWalkable(x, z) && I.isWalkable(x + E, z) && I.isWalkable(x - E, z) && I.isWalkable(x, z + E) && I.isWalkable(x, z - E); // 和寻路栅格同一个标准：只有一条缝宽的地方不算通
const G = 0.25, key = (x, z) => Math.round(x / G) + ',' + Math.round(z / G), seen = new Set(), q = [[A.lawn.x, A.lawn.z]];
seen.add(key(A.lawn.x, A.lawn.z));
while (q.length) { const [x, z] = q.pop(); for (const [dx, dz] of [[G, 0], [-G, 0], [0, G], [0, -G]]) { const nx = Math.round((x + dx) / G) * G, nz = Math.round((z + dz) / G) * G, k = key(nx, nz); if (!seen.has(k) && ok(nx, nz)) { seen.add(k); q.push([nx, nz]); } } }
// 点本身可能贴着障碍（喝水点、窝门口）：它旁边 0.4 以内有连通的格子就算走得到
const connected = (x, z) => { for (let dx = -0.5; dx <= 0.501; dx += G) for (let dz = -0.5; dz <= 0.501; dz += G) if (Math.hypot(dx, dz) <= 0.4 && seen.has(key(x + dx, z + dz))) return true; return false; };
const stat = { trials: 0, timeout: 0, blocked: 0, stall: 0, slow: 0, unreachable: 0, unreachableBad: 0 };
const worst = [];
const byGoal = {};
for (const run of [true, false]) {
  for (const [name, gx, gz] of goals) {
    for (const [sx, sz] of starts) {
      const direct = Math.hypot(gx - sx, gz - sz);
      if (direct < 0.8) continue;
      m.inKennel = false; m.onRamp = false;
      m.place(sx, sz, Math.atan2(gx - sx, gz - sz) + 2.2); // 起步时背对着目标偏一点
      m.goTo(gx, gz, { run, arriveR: 0.15 });
      const v = run ? RUN_SPEED : WALK_SPEED;
      const limit = (direct * 1.9 + 3) / v + 4; // 允许绕路（直线的 1.9 倍 + 3）再加 4 秒
      let t = 0, stallT = 0, maxStall = 0;
      while (m.hasGoal && t < 60) {
        m.update(1 / 30); t += 1 / 30;
        if (m.speed < 0.12) { stallT += 1 / 30; maxStall = Math.max(maxStall, stallT); } else stallT = 0;
      }
      const fin = Math.hypot(m.x - gx, m.z - gz);
      let flag = '';
      if (!connected(sx, sz) || !connected(gx, gz)) { // 走不到的：只要求不超时、不长时间卡着，干脆地放弃
        stat.unreachable++;
        if (m.hasGoal || maxStall > 2.2) { stat.unreachableBad++; if (worst.length < 28) worst.push(`走不到的 (${sx},${sz})→${name} ` + (m.hasGoal ? '超时' : '卡顿' + maxStall.toFixed(1) + 's')); }
        continue;
      }
      stat.trials++;
      if (m.hasGoal) { stat.timeout++; flag = '超时'; }
      else if (m.blocked || fin > 0.5) { stat.blocked++; flag = '放弃(离目标' + fin.toFixed(1) + ')'; }
      else if (maxStall > 0.8 + 0.5) { stat.stall++; flag = '卡顿' + maxStall.toFixed(1) + 's'; } // 起步转身也算停着，多给 0.5 秒
      else if (t > limit) { stat.slow++; flag = '绕远' + t.toFixed(1) + 's/' + limit.toFixed(1); }
      if (flag) {
        byGoal[name] = (byGoal[name] || 0) + 1;
        if (worst.length < 28) worst.push(`${run ? '跑' : '走'} (${sx},${sz})→${name}(${gx.toFixed(1)},${gz.toFixed(1)}) ${flag} 停在(${m.x.toFixed(1)},${m.z.toFixed(1)})`);
      }
    }
  }
}
return { starts: starts.length, goals: goals.length, goalsReachable: goals.filter((g) => connected(g[1], g[2])).map((g) => g[0]).join(" "), startsReachable: starts.filter((p) => connected(p[0], p[1])).length, ...stat, fail: stat.timeout + stat.blocked + stat.stall + stat.slow + stat.unreachableBad, byGoal, worst };
