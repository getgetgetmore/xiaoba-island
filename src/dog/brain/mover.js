// 狗狗移动控制器：加减速、转向速率上限、先转身再加速、栅格寻路（A*）绕开障碍、进出狗窝直线段。
// 只通过 island 契约（heightAt / isWalkable / clampWalkable / obstacles / anchors）读取世界信息。
import { clamp, damp, moveTowards, wrapAngle, angleDiff, smoothstep } from '../../core/util.js';

export const WALK_SPEED = 0.9;
export const RUN_SPEED = 3.6;
const DOG_MARGIN = 0.4; // 狗身体半径 + 余量（绕开障碍时加在障碍半径上；狗在画面里放大了 1.5 倍，按放大后的体型留）

export function createMover(ctx, dog) {
  const island = ctx.island;
  const anchors = island.anchors;

  const mover = {
    x: 0, z: 0, heading: 0, speed: 0,
    angVel: 0,
    inKennel: false,    // 狗在窝内（kennelDoor↔kennelInside 这一段），此时忽略 walkable/障碍
    onRamp: false,      // 狗在瞭望台坡道/平台上（lookout.base↔lookout.top 这一段），同样是脚本化路段：忽略 walkable/障碍；goal 为普通 nav 时先沿坡道中线走回 base
    hasGoal: false,
    arrived: false,     // 最近一个目标是正常到达
    blocked: false,     // 最近一个目标因卡住被放弃
    hold: false,        // true：速度降到 0（受惊时）
    spinRate: 0,        // ≠0：heading 被直接旋转（兴奋转圈）
    driveSpeed: -1,     // ≥0：直接按该速度沿 heading 前进（扑跃）
    extraY: 0,          // 额外抬高（站/趴在垫子上时 = 垫面高度），由 brain 每帧给出
    reverse: false,     // true：倒退着走——身体朝向与行进方向相反（叼着垫子边缘往后拖时用）
    get settled() { return !mover.hasGoal && mover.speed < 0.08 && mover.driveSpeed < 0; },
    goTo, goStraight, clearGoal, face, update, place, gait, headingError,
  };

  const kennelObs = island.obstacles.find((o) => o.name === 'kennel') || null;
  const goal = { kind: 'nav', x: 0, z: 0, vmax: WALK_SPEED, arriveR: 0.12, through: false, ramp: 0, rampTop: false, free: false };
  let facing = NaN;
  let avoidIdx = -1, avoidSide = 1;
  let stuckT = 0;
  let progBest = 1e9, progT = 0; // 进展看门狗：长时间离目标没有明显更近就放弃（防止在障碍圆的凹口里来回蹭）
  let curGait = null;
  let slopePitch = 0, lastDt = 1 / 30;

  // ------------------------------------------------------------------ 路线规划（栅格 A*）
  // 小岛很小、障碍是固定的：把它铺成 0.25 一格的栅格。能站的格子 = isWalkable（gridFree）；其中离每个障碍圆还有 PAD 以上的算“宽敞”（gridOpen）。
  // 贴着障碍的窄道可以走，但代价高，而且不能在里面抄直线近路。
  // goTo 时在栅格上搜一条最短路（贴着障碍的格子代价略高，路线自然离障碍远一点），再用“能直接看到就连直线”把它拉直成几个路点。
  // 老办法是走一步看一步、见到障碍就贴着绕，在狗窝 / 池塘 / 坡道这些挨在一起的障碍之间容易钻进夹角里出不来。
  const CELL = 0.25, GR = 9.5, GN = Math.round((2 * GR) / CELL) + 1, PAD = 0.14;
  let gridFree = null, gridOpen = null, gridCost = null, gScore = null, came = null, stamp = null, closed = null, planId = 0;
  const gi = (v) => Math.round((v + GR) / CELL), gv = (i) => -GR + i * CELL;
  function buildGrid() {
    gridFree = new Uint8Array(GN * GN); gridOpen = new Uint8Array(GN * GN); gridCost = new Float32Array(GN * GN);
    gScore = new Float32Array(GN * GN); came = new Int32Array(GN * GN); stamp = new Uint32Array(GN * GN); closed = new Uint32Array(GN * GN);
    const obs = island.obstacles;
    for (let iz = 0; iz < GN; iz++) for (let ix = 0; ix < GN; ix++) {
      const x = gv(ix), z = gv(iz);
      // 格子中心和四周一小圈都能站才算数：只有一条缝宽的“通道”实际走不过去（一步就踩出界），不当作路
      const E = 0.13;
      let ok = island.isWalkable(x, z) && island.isWalkable(x + E, z) && island.isWalkable(x - E, z) && island.isWalkable(x, z + E) && island.isWalkable(x, z - E);
      gridFree[iz * GN + ix] = ok ? 1 : 0;
      if (ok) for (let k = 0; k < obs.length; k++) if (Math.hypot(x - obs[k].x, z - obs[k].z) < obs[k].r + PAD) { ok = false; break; }
      gridOpen[iz * GN + ix] = ok ? 1 : 0;
    }
    // 只保留和草坪连通的格子（连通的规则和下面搜路时一样：不钻对角缝）。孤立的格子不当起点、终点，也不算“能走直线”——
    // 否则小狗能沿直线走进去，却规划不出离开的路线，之后每个目标都立刻放弃，卡在原地。
    {
      const lw = anchors.lawn, s0 = lw ? gi(lw.z) * GN + gi(lw.x) : -1;
      if (s0 >= 0 && gridFree[s0]) {
        const seen = new Uint8Array(GN * GN), stack = [s0];
        seen[s0] = 1;
        while (stack.length) {
          const c = stack.pop(), cx = c % GN, cz = (c / GN) | 0;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const nx = cx + dx, nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= GN || nz >= GN) continue;
            const ni = nz * GN + nx;
            if (!gridFree[ni] || seen[ni]) continue;
            if (dx && dz && (!gridFree[cz * GN + nx] || !gridFree[nz * GN + cx])) continue;
            seen[ni] = 1; stack.push(ni);
          }
        }
        for (let i = 0; i < GN * GN; i++) if (!seen[i]) { gridFree[i] = 0; gridOpen[i] = 0; }
      }
    }
    for (let iz = 0; iz < GN; iz++) for (let ix = 0; ix < GN; ix++) {
      if (!gridFree[iz * GN + ix]) continue;
      let near = 3;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= GN || jz >= GN || !gridFree[jz * GN + jx]) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dz)));
      }
      gridCost[iz * GN + ix] = (near === 1 ? 1.6 : near === 2 ? 0.5 : 0) + (gridOpen[iz * GN + ix] ? 0 : 3);
    }
  }
  const freeAt = (x, z) => { const ix = gi(x), iz = gi(z); return ix >= 0 && iz >= 0 && ix < GN && iz < GN && gridOpen[iz * GN + ix] === 1; };
  /** 两点之间能不能走直线（沿途每半格取一个点，都落在能站的格子里） */
  function los(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / (CELL * 0.5)));
    for (let k = 0; k <= n; k++) { const u = k / n; if (!freeAt(x0 + (x1 - x0) * u, z0 + (z1 - z0) * u)) return false; }
    return true;
  }
  /** 离 (x, z) 最近的能站的格子（2.5 以内），没有则 -1 */
  function nearestFree(x, z) {
    const cx = gi(x), cz = gi(z);
    let best = -1, bd = 1e9;
    for (let r = 0; r <= 10 && best < 0; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const ix = cx + dx, iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= GN || iz >= GN || !gridFree[iz * GN + ix]) continue;
        const d = Math.hypot(gv(ix) - x, gv(iz) - z);
        if (d < bd) { bd = d; best = iz * GN + ix; }
      }
    }
    return best;
  }
  const heap = [];
  function heapPush(i, fs) { heap.push(i); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (fs[heap[p]] <= fs[heap[c]]) break; const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p; } }
  function heapPop(fs) {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last; let p = 0;
      for (;;) { const l = 2 * p + 1, r = l + 1; let m = p; if (l < heap.length && fs[heap[l]] < fs[heap[m]]) m = l; if (r < heap.length && fs[heap[r]] < fs[heap[m]]) m = r; if (m === p) break; const t = heap[p]; heap[p] = heap[m]; heap[m] = t; p = m; }
    }
    return top;
  }
  let fScore = null;
  /** 规划从 (x0, z0) 到 (x1, z1) 的路线：返回路点数组 [[x, z], …]（最后一个是目标本身），规划不出来返回 null */
  function plan(x0, z0, x1, z1) {
    if (!gridFree) { buildGrid(); fScore = new Float32Array(GN * GN); }
    if (freeAt(x0, z0) && los(x0, z0, x1, z1)) return [[x1, z1]]; // 大多数时候：直接走过去
    const sI = nearestFree(x0, z0), gI = nearestFree(x1, z1);
    if (sI < 0 || gI < 0) return null;
    const gx = gI % GN, gz = (gI / GN) | 0;
    planId++; heap.length = 0;
    gScore[sI] = 0; stamp[sI] = planId; came[sI] = -1; fScore[sI] = 0; heapPush(sI, fScore);
    let found = false, bestI = sI, bestH = 1e9;
    while (heap.length) {
      const cur = heapPop(fScore);
      if (closed[cur] === planId) continue;
      closed[cur] = planId;
      if (cur === gI) { found = true; break; }
      const cx = cur % GN, cz = (cur / GN) | 0;
      const hh = Math.hypot(cx - gx, cz - gz);
      if (hh < bestH) { bestH = hh; bestI = cur; } // 记下离目标最近的、走得到的格子
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= GN || nz >= GN) continue;
        const ni = nz * GN + nx;
        if (!gridFree[ni] || closed[ni] === planId) continue;
        if (dx && dz && (!gridFree[cz * GN + nx] || !gridFree[nz * GN + cx])) continue; // 不从两个障碍格的对角缝里钻过去
        const g = gScore[cur] + (dx && dz ? 1.4142 : 1) * (1 + gridCost[ni]);
        if (stamp[ni] === planId && g >= gScore[ni]) continue;
        stamp[ni] = planId; gScore[ni] = g; came[ni] = cur;
        fScore[ni] = g + Math.hypot(nx - gx, nz - gz);
        heapPush(ni, fScore);
      }
    }
    // 目标被障碍围死（走不到）：走到能到的最近处为止
    const cells = [];
    for (let c = found ? gI : bestI; c >= 0; c = came[c]) cells.push([gv(c % GN), gv((c / GN) | 0)]);
    cells.reverse();
    // 拉直：从当前点出发，能直接看到的最远一个路点就直接连过去
    const pts = [[x0, z0]].concat(cells), out = [];
    for (let i = 0; i < pts.length - 1; ) {
      let j = pts.length - 1;
      while (j > i + 1 && !los(pts[i][0], pts[i][1], pts[j][0], pts[j][1])) j--;
      out.push(pts[j]); i = j;
    }
    if (!found) { if (!out.length) out.push([x0, z0]); out.partial = true; return out; }
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - x1, last[1] - z1) > 0.02) out.push([x1, z1]); // 目标本身可能在留边的范围里（窝门口、喝水点）：最后一小段直接走过去
    return out;
  }
  let path = null, pi = 0, needPlan = false, replans = 0;
  /** 卡住 / 长时间没进展：先按当前位置重新规划一次，还不行再放弃 */
  function retryOrGiveUp() {
    if (goal.kind === 'nav' && replans < 1 && !(path && path.partial)) { replans++; needPlan = true; path = null; progBest = 1e9; progT = 0; stuckT = 0; }
    else giveUp();
  }

  function place(x, z, heading) {
    mover.x = x; mover.z = z;
    mover.heading = heading;
    mover.speed = 0; mover.angVel = 0;
    mover.hasGoal = false;
    apply();
  }

  // 待执行的脚本直线段：goStraight 被调用时如果狗离入口（窝门 / 坡道底）还远，先正常寻路走到入口，再走直线段。
  // 这样即使上一步寻路没走到（被障碍挡住而放弃），也不会从远处沿直线穿过池塘、狗窝墙等障碍。
  let pending = null; // { x, z, opts }
  // 绕道：寻路走不通（被障碍和岛沿夹住等）时，先去草坪中心这个“枢纽”，到了再回头去原目标；每个目标只绕一次
  let detoured = false, onDetour = false, resume = null;
  function goTo(x, z, opts) {
    pending = null;
    detoured = false; onDetour = false; resume = null;
    setNav(x, z, opts);
  }
  function setNav(x, z, { run = false, speed = 0, arriveR = 0.12, through = false } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    goal.kind = 'nav';
    goal.x = x; goal.z = z;
    goal.vmax = speed > 0 ? Math.min(speed, RUN_SPEED) : run ? RUN_SPEED : WALK_SPEED;
    goal.arriveR = arriveR;
    goal.ramp = 0;
    goal.through = through;
    goal.free = false;
    mover.hasGoal = true;
    mover.arrived = false;
    mover.blocked = false;
    facing = NaN;
    stuckT = 0;
    progBest = 1e9; progT = 0;
    needPlan = true; path = null; replans = 0;
  }

  /** 直线走向目标，忽略障碍与 walkable（进出狗窝用）。 */
  /** ramp：undefined = 普通脚本直线（狗窝）；true = 走向平台（到达后 onRamp 保持）；false = 走回坡道底端（到达后 onRamp 清除）。 */
  /** opts.free：小游戏用的脚本化直线段（钓鱼走到池塘水边）——不走窝门 / 坡道入口，直接从当前位置沿直线走过去，到达后不改变 inKennel / onRamp。 */
  function goStraight(x, z, opts = {}) {
    if (opts.free) {
      pending = null; detoured = false; onDetour = false; resume = null;
      startStraight(x, z, opts);
      goal.free = true;
      return;
    }
    const isRamp = opts.ramp !== undefined;
    const inZone = isRamp ? mover.onRamp : mover.inKennel;
    const entry = isRamp ? (anchors.lookout ? anchors.lookout.base : null) : anchors.kennelDoor;
    detoured = false; onDetour = false; resume = null;
    if (!inZone && entry && Math.hypot(mover.x - entry.x, mover.z - entry.z) > 0.9) {
      pending = { x, z, opts };
      setNav(entry.x, entry.z, { run: opts.run, speed: opts.speed, arriveR: 0.2 });
      return;
    }
    pending = null;
    startStraight(x, z, opts);
  }
  function startStraight(x, z, { run = false, speed = 0, arriveR = 0.1, ramp } = {}) {
    setNav(x, z, { run, speed, arriveR });
    goal.kind = 'straight';
    if (ramp !== undefined) {
      goal.ramp = 1;
      goal.rampTop = !!ramp;
      mover.onRamp = true;
    }
  }

  function clearGoal() {
    mover.hasGoal = false;
  }

  function face(angle) {
    facing = Number.isFinite(angle) ? angle : NaN;
  }

  function headingError(angle) {
    return Math.abs(angleDiff(mover.heading, angle));
  }

  function gait() {
    const sp = mover.speed;
    if (sp > 2.3 || (curGait === 'run' && sp > 1.8)) curGait = 'run';
    else if (sp > 0.15 || (curGait === 'walk' && sp > 0.07)) curGait = 'walk';
    else curGait = null;
    return curGait;
  }

  /** 寻路走不通时：若正要去某个入口，先绕道草坪中心再试一次；否则放弃该目标 */
  function giveUp() {
    const lw = anchors.lawn;
    if (!detoured && lw && goal.kind === 'nav' && !mover.inKennel && !mover.onRamp && Math.hypot(mover.x - lw.x, mover.z - lw.z) > 1.2) {
      detoured = true; onDetour = true;
      resume = { x: goal.x, z: goal.z, arriveR: goal.arriveR, through: goal.through, vmax: goal.vmax };
      goal.x = lw.x; goal.z = lw.z; goal.arriveR = 0.8; goal.through = false;
      stuckT = 0; progBest = 1e9; progT = 0; avoidIdx = -1;
      needPlan = true; path = null;
      return;
    }
    pending = null; onDetour = false; resume = null;
    mover.hasGoal = false;
    mover.blocked = true;
  }

  // 返回绕开障碍后的期望朝向
  function steer(dirHeading, distGoal) {
    const obs = island.obstacles;
    const sx = Math.sin(dirHeading), cz = Math.cos(dirHeading);
    const L = Math.min(distGoal, 1.4 + mover.speed * 0.7);
    let best = -1, bestD = 1e9, bestLat = 0;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const ox = o.x - mover.x, oz = o.z - mover.z;
      const D = Math.hypot(ox, oz);
      const rI = o.r + DOG_MARGIN;
      // 目标就在该障碍外缘附近且已经很近：不再绕它
      if (distGoal < 1.3 && Math.hypot(goal.x - o.x, goal.z - o.z) < rI) continue;
      const along = ox * sx + oz * cz;
      if (along < -0.1 && D > rI) continue;
      if (D > L + rI) continue;
      const lat = ox * cz - oz * sx;
      if (Math.abs(lat) >= rI && D > rI) continue;
      if (D < bestD) { bestD = D; best = i; bestLat = lat; }
    }
    if (best < 0) { avoidIdx = -1; return dirHeading; }
    const o = obs[best];
    const ox = o.x - mover.x, oz = o.z - mover.z;
    const rI = o.r + DOG_MARGIN;
    if (avoidIdx !== best) {
      avoidIdx = best;
      avoidSide = bestLat > 0 ? -1 : 1;
    }
    const a0 = Math.atan2(ox, oz);
    const alpha = bestD > rI ? Math.asin(Math.min(1, rI / bestD)) : Math.PI / 2 + 0.3;
    return a0 + avoidSide * (alpha + 0.12);
  }

  function update(dt) {
    if (!(dt > 0)) return;
    lastDt = Math.min(dt, 0.1);
    let vdes = 0;
    let desiredHeading = NaN;
    if (mover.inKennel && kennelObs && Math.hypot(mover.x - kennelObs.x, mover.z - kennelObs.z) > kennelObs.r + 1.3) mover.inKennel = false;
    if (mover.onRamp && anchors.lookout) {
      const lkA = anchors.lookout, bx = lkA.base.x - lkA.top.x, bz = lkA.base.z - lkA.top.z;
      const tt = clamp(((mover.x - lkA.top.x) * bx + (mover.z - lkA.top.z) * bz) / (bx * bx + bz * bz), 0, 1);
      if (Math.hypot(mover.x - (lkA.top.x + bx * tt), mover.z - (lkA.top.z + bz * tt)) > 1.2) mover.onRamp = false;
    }
    let freePass = mover.inKennel || mover.onRamp;
    const door = anchors.kennelDoor;
    const lk = anchors.lookout;

    if (mover.driveSpeed >= 0) {
      mover.speed = Math.min(RUN_SPEED, mover.driveSpeed);
      freePass = freePass || false;
    } else {
      if (mover.hasGoal) {
        let tx = goal.x, tz = goal.z;
        let exiting = false, exitRamp = false;
        if (mover.inKennel && goal.kind === 'nav') { tx = door.x; tz = door.z; exiting = true; }
        else if (mover.onRamp && goal.kind === 'nav' && lk) { tx = lk.base.x; tz = lk.base.z; exiting = true; exitRamp = true; }
        const straight = exiting || goal.kind === 'straight';
        if (straight) freePass = true;
        // 普通寻路：沿规划好的路点走；规划不出来（起点 / 终点被围死）才退回到“见障碍就绕”的老办法
        let viaPath = false, remain = 0, turnNext = 0;
        if (!straight) {
          if (needPlan) { needPlan = false; path = plan(mover.x, mover.z, goal.x, goal.z); pi = 0; }
          if (path) {
            // 已经能直接看到后面的路点（或者这个路点已经踩到了）就往后跳：拐弯处自然切角
            while (pi < path.length - 1 && (Math.hypot(path[pi][0] - mover.x, path[pi][1] - mover.z) < 0.28 || los(mover.x, mover.z, path[pi + 1][0], path[pi + 1][1]))) pi++;
            if (pi < path.length - 1) {
              tx = path[pi][0]; tz = path[pi][1]; viaPath = true;
              turnNext = Math.abs(angleDiff(Math.atan2(tx - mover.x, tz - mover.z), Math.atan2(path[pi + 1][0] - tx, path[pi + 1][1] - tz)));
              for (let k = pi; k < path.length - 1; k++) remain += Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]);
            } else if (path.partial) {
              // 目标走不到：到了能到的最近处就放弃（不再绕道重试）
              tx = path[pi][0]; tz = path[pi][1]; viaPath = true;
              if (Math.hypot(tx - mover.x, tz - mover.z) < 0.3) { detoured = true; giveUp(); }
            }
          }
        }
        const dx = tx - mover.x, dz = tz - mover.z;
        const dist = Math.hypot(dx, dz);
        const arriveR = exiting ? 0.2 : goal.arriveR;
        if (!viaPath && dist < arriveR) {
          if (exiting) {
            if (exitRamp) mover.onRamp = false; else mover.inKennel = false;
          } else if (onDetour && resume) {
            // 绕道到了草坪中心：回头去原来的目标
            goal.x = resume.x; goal.z = resume.z; goal.arriveR = resume.arriveR; goal.through = resume.through; goal.vmax = resume.vmax;
            onDetour = false; resume = null;
            stuckT = 0; progBest = 1e9; progT = 0; avoidIdx = -1;
            needPlan = true; path = null;
          } else if (pending && goal.kind === 'nav') {
            const p = pending;
            pending = null;
            startStraight(p.x, p.z, p.opts);
          } else {
            mover.hasGoal = false;
            mover.arrived = true;
            if (goal.kind === 'straight') {
              if (goal.ramp) mover.onRamp = goal.rampTop;
              else if (!goal.free) mover.inKennel = !island.isWalkable(goal.x, goal.z);
            }
          }
        } else {
          const dirH = Math.atan2(dx, dz);
          const steerH = straight || path ? dirH : steer(dirH, dist);
          // 倒退时：行进方向不变，身体朝向取反方向
          const faceH = mover.reverse ? steerH + Math.PI : steerH;
          const err = Math.abs(angleDiff(mover.heading, faceH));
          const vmax = exiting ? Math.min(goal.vmax, exitRamp ? 1.7 : 1.6) : goal.vmax;
          let gate;
          if (viaPath) {
            // 中途的路点：不停下，只在要拐急弯时放慢；方向差太多（刚起步背对着路）就先转身再走
            vdes = vmax;
            if (dist < 0.35 + turnNext * 0.55) vdes = Math.min(vdes, Math.max(1.0, vmax * (1 - turnNext / 2.4)));
            gate = err > 1.2 ? smoothstep(1.5, 0.4, err) : clamp(1 - err / 1.6, 0.5, 1);
          } else {
            vdes = goal.through && !straight ? vmax : Math.min(vmax, 0.15 + 2.4 * dist);
            gate = goal.through && !straight ? clamp(1 - err / 1.6, 0.55, 1) : smoothstep(1.5, 0.4, err);
          }
          vdes *= gate;
          desiredHeading = faceH;
          // 卡住检测：想走但长时间没速度
          if (mover.speed < 0.12 && err < 0.5) stuckT += dt; else stuckT = 0;
          if (stuckT > 1.5) { stuckT = 0; retryOrGiveUp(); }
          if (!straight) {
            const left = dist + remain; // 沿路线还剩多远（绕着障碍走时，到目标的直线距离不一定在变近）
            if (left < progBest - 0.08) { progBest = left; progT = 0; } else progT += dt;
            if (progT > 4) { progT = 0; retryOrGiveUp(); }
          }
        }
      } else if (Number.isFinite(facing)) {
        desiredHeading = facing;
      }
      if (mover.hold) vdes = 0;
      const rate = vdes > mover.speed ? (vdes > 1.5 ? 4.5 : 2.6) : 6.0;
      mover.speed = moveTowards(mover.speed, vdes, rate * dt);
    }

    // 朝向
    if (mover.spinRate !== 0) {
      mover.heading += mover.spinRate * dt;
      mover.angVel = 0;
    } else if (mover.driveSpeed < 0 && Number.isFinite(desiredHeading)) {
      const err = angleDiff(mover.heading, desiredHeading);
      const maxTurn = 5.0 - 2.2 * clamp(mover.speed / RUN_SPEED);
      const tgt = clamp(err * 7, -maxTurn, maxTurn);
      mover.angVel = damp(mover.angVel, tgt, 16, dt);
      let d = mover.angVel * dt;
      if (Math.abs(d) > Math.abs(err)) d = err;
      mover.heading += d;
    } else {
      mover.angVel = damp(mover.angVel, 0, 16, dt);
      mover.heading += mover.angVel * dt;
    }
    mover.heading = wrapAngle(mover.heading);

    // 位移
    const step = mover.speed * dt;
    if (step > 1e-6) {
      const sgn = mover.reverse && mover.driveSpeed < 0 ? -1 : 1;
      let nx = mover.x + Math.sin(mover.heading) * step * sgn;
      let nz = mover.z + Math.cos(mover.heading) * step * sgn;
      // 已经站在不能站的地方（被摆过去的、小游戏结束时留下的……）：放行，让它沿规划的路线走回能站的地方，而不是原地卡死
      const outside = !freePass && !island.isWalkable(mover.x, mover.z);
      if (!freePass && !outside && !island.isWalkable(nx, nz)) {
        const c = island.clampWalkable(nx, nz);
        const moved = Math.hypot(c.x - mover.x, c.z - mover.z);
        if (moved <= step * 1.35 + 0.01 && island.isWalkable(c.x, c.z)) { nx = c.x; nz = c.z; }
        else { nx = mover.x; nz = mover.z; mover.speed *= 0.5; }
      }
      mover.x = nx;
      mover.z = nz;
    }
    apply();
  }

  function apply() {
    const g = dog.group;
    g.position.set(mover.x, island.heightAt(mover.x, mover.z) + mover.extraY, mover.z);
    // 身体顺着地面坡度前后倾斜（上下瞭望台坡道时最明显；否则身体是水平的，后半截会陷进木板里）
    {
      const sc = g.scale.x || 1, d = 0.3 * sc;
      const fx = Math.sin(mover.heading) * d, fz = Math.cos(mover.heading) * d;
      const hf = island.heightAt(mover.x + fx, mover.z + fz), hb = island.heightAt(mover.x - fx, mover.z - fz);
      const want = clamp(-Math.atan2(hf - hb, 2 * d), -0.55, 0.55);
      slopePitch += (want - slopePitch) * (1 - Math.exp(-9 * lastDt));
      if (g.rotation.order !== 'YXZ') g.rotation.order = 'YXZ'; // 先偏航，再绕身体自己的横轴俯仰
      g.rotation.x = slopePitch;
    }
    g.rotation.y = mover.heading;
    dog.speed = mover.reverse ? -mover.speed : mover.speed; // 负值 = 倒退（模型据此倒着迈步）
  }

  return mover;
}
