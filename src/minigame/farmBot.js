// 农场捣乱机器人（测试 / 调试自动驾驶）：只通过 sim.command 的指令 { moveTo, pounce, dig } 操控宠物，
// 和真人一样不能直接改状态；可以读 sim 的公开状态（管理员在哪、朝哪看、哪些捣乱点还没做）。
//   idle     什么都不做
//   random   乱跑乱扑：每 1–3.5 秒换一个随机目标点，随手扑、偶尔原地刨两下，不躲管理员
//   skilled  有计划地捣乱：挑“近、且管理员看不见”的捣乱点，先滚泥再去床单 / 喷泉石板地拿连带分；
//            被追时往她过不去的狗洞、看不见的躲藏点或离她远的地方跑；通缉前到出口等着，通缉一开始就钻出去
// 用法：const bot = createFarmBot({ kind, seed }); 每帧 sim.command(petId, bot(sim, petId, dt))
import { mulberry32 } from '../core/util.js';
import { FARM } from './farmSim.js';

const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

export function createFarmBot({ kind = 'skilled', seed = 1 } = {}) {
  const rng = mulberry32(seed);
  const out = { moveTo: null, pounce: false, dig: false };
  if (kind === 'idle') return function idleBot() { out.moveTo = null; out.pounce = false; out.dig = false; return out; };
  if (kind === 'random') return createRandom(rng, out);
  return createSkilled(rng, out);
}

function createRandom(rng, out) {
  let t = 0, digT = 0, tx = 0, tz = 0;
  return function randomBot(sim, petId, dt) {
    const me = sim.petById(petId);
    out.pounce = false; out.dig = false;
    if (!me) { out.moveTo = null; return out; }
    const W = sim.map.size.w, D = sim.map.size.d;
    t -= dt;
    if (t <= 0) {
      t = 1 + 2.5 * rng();
      tx = (rng() - 0.5) * (W - 2); tz = (rng() - 0.5) * (D - 2);
      if (rng() < 0.15) digT = 1 + 2 * rng();
    }
    if (digT > 0) { digT -= dt; out.dig = true; out.moveTo = null; return out; }
    out.moveTo = { x: tx, z: tz };
    if (rng() < 0.8 * dt) out.pounce = true;
    return out;
  };
}

function createSkilled(rng, out) {
  let field = null, fieldT = 0, fieldX = 1e9, fieldZ = 1e9;
  let route = null, routeGoal = null;
  let task = null, taskT = 0, cool = {};
  let mode = 'work', fleeGoal = null, fleeT = 0, hideT = 0;
  let trampleSide = 1, ringA = 0;
  let lastTime = -1;

  const dist = (a, b, x, z) => Math.hypot(a - x, b - z);

  function refreshField(sim, me, force) {
    if (!force && field && fieldT > 0 && dist(me.x, me.z, fieldX, fieldZ) < 2) return;
    field = sim.nav('pet').field(me.x, me.z, sim.gateOpen); fieldT = 0.6; fieldX = me.x; fieldZ = me.z; route = null;
  }
  const pathLen = (sim, x, z) => (field ? sim.nav('pet').fieldDist(field, x, z) : Infinity);

  /** 沿路线走向 (x, z)；返回给 moveTo 的点 */
  function steer(sim, me, x, z) {
    const nav = sim.nav('pet');
    if (!route || !routeGoal || dist(routeGoal[0], routeGoal[1], x, z) > 0.3) {
      if (nav.freeAt(me.x, me.z, sim.gateOpen) && nav.freeAt(x, z, sim.gateOpen) && nav.los(me.x, me.z, x, z, sim.gateOpen)) route = [[x, z]];
      else route = field ? nav.fieldPath(field, x, z) : null;
      if (!route || !route.length) route = [[x, z]];
      routeGoal = [x, z];
    }
    while (route.length > 1 && dist(route[0][0], route[0][1], me.x, me.z) < 0.5) route.shift();
    const [wx, wz] = route[0];
    if (route.length === 1) return { x: wx, z: wz };
    const dx = wx - me.x, dz = wz - me.z, d = Math.hypot(dx, dz) || 1;
    const L = Math.max(d, 3.4);
    return { x: me.x + (dx / d) * L, z: me.z + (dz / d) * L };
  }

  function keeperRisk(sim, x, z) {
    const K = sim.keeper, kr = sim.rules.keeper;
    if (!K.active || !kr.awake) return 0;
    const d = dist(K.x, K.z, x, z);
    let r = 0;
    if (d < kr.visionRange + 2 && !sim.world.sightBlocked(K.x, K.z, x, z)) r += 10 + (kr.visionRange + 2 - d) * 1.5;
    if (d < 6) r += 15;
    // 她正赶去的出事地点附近：别去（去了就是被驱赶）
    if (K.state === 'suspicious' && dist(K.sceneX, K.sceneZ, x, z) < FARM.SCENE_R + 1.5) r += 25;
    // 刚被她赶走的地方：短时间内回去捣乱 = 驱赶无效、直接被抓，换个地方
    if (K.shooCd > 0 && dist(K.shooX, K.shooZ, x, z) < FARM.AGAIN_R + 1.5) r += 40;
    return r;
  }

  function listTasks(sim, me) {
    const tasks = [];
    const mul = sim.rules.mischief || {};
    const fountainPrintOpen = sim.objects.some((o) => o.kind === 'fountain' && !o.mudded && o.plaza > 0);
    const linesOpen = sim.objects.some((o) => o.kind === 'clothesline' && !o.mudded);
    for (const o of sim.objects) {
      if (!(mul[o.kind] > 0)) continue;
      const k = FARM.KINDS[o.kind];
      if (!k) continue;
      if (!o.done) {
        let bias = 0;
        if (o.kind === 'mud_pit' && !me.muddy) bias -= 6;
        if (o.kind === 'clothesline' && me.muddy) bias -= 8;
        if (o.kind === 'clothesline' && !me.muddy && sim.objects.some((m) => m.kind === 'mud_pit')) bias += 4;
        if (o.kind === 'fountain' && me.muddy && fountainPrintOpen) bias += 25;
        tasks.push({ key: o.id, type: k.trigger, o, x: o.x, z: o.z, bias });
      }
      if (me.muddy && (mul.mud_print > 0) && !o.mudded) {
        if (o.kind === 'clothesline' && o.done) tasks.push({ key: o.id + ':print', type: 'printLine', o, x: o.x, z: o.z, bias: -8 });
        if (o.kind === 'fountain' && o.plaza > 0) tasks.push({ key: o.id + ':print', type: 'printPlaza', o, x: o.x, z: o.z, bias: -8 });
      }
    }
    if (!me.muddy && (fountainPrintOpen || linesOpen)) {
      // 已经滚过泥（泥塘做完了）但泥被洗掉 / 干了：值得再去滚一次
      for (const o of sim.objects) if (o.kind === 'mud_pit' && o.done) tasks.push({ key: o.id + ':reroll', type: 'roll', o, x: o.x, z: o.z, bias: 6 });
    }
    for (const g of sim.groups) {
      if (!g.poultry || g.done) continue;
      let cx = 0, cz = 0, n = 0;
      for (const a of sim.animals) if (sim.groups[a.group] === g) { cx += a.x; cz += a.z; n++; }
      if (n) tasks.push({ key: 'grp:' + g.id, type: 'scatter', g, x: cx / n, z: cz / n, bias: 0 });
    }
    return tasks;
  }

  function pickTask(sim, me) {
    const tasks = listTasks(sim, me);
    let best = null, bc = Infinity;
    for (const t of tasks) {
      if (cool[t.key] > sim.time) continue;
      const L = pathLen(sim, t.x, t.z);
      if (!Number.isFinite(L)) continue;
      const c = L + keeperRisk(sim, t.x, t.z) + t.bias;
      if (c < bc) { bc = c; best = t; }
    }
    return best;
  }

  /** 逃跑目标：狗洞的另一边、她看不见的躲藏点、离她远的空地 */
  function pickFlee(sim, me) {
    const K = sim.keeper, nav = sim.nav('pet');
    const cands = [];
    for (const h of sim.world.hides) cands.push({ x: h.x, z: h.z, hide: true });
    for (const c of sim.world.gapColliders) {
      // 洞的两侧（沿薄的方向）
      const thinX = c.shape === 'box' ? (c.hw < c.hd) : true;
      const nx = c.shape === 'box' ? (thinX ? c.co : c.si) : 1, nz = c.shape === 'box' ? (thinX ? -c.si : c.co) : 0;
      const a = { x: c.x + nx * 1.6, z: c.z + nz * 1.6 }, b = { x: c.x - nx * 1.6, z: c.z - nz * 1.6 };
      const far = dist(a.x, a.z, K.x, K.z) > dist(b.x, b.z, K.x, K.z) ? a : b;
      far.gap = true; cands.push(far);
    }
    const shooed = K.state === 'chase' && K.shoo; // 只是被驱赶：离开现场就没事了
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, r = shooed ? 11 : 7; cands.push({ x: me.x + Math.sin(a) * r, z: me.z + Math.cos(a) * r }); }
    let best = null, bs = -Infinity;
    for (const c of cands) {
      if (!nav.freeAt(c.x, c.z, sim.gateOpen)) continue;
      const dm = pathLen(sim, c.x, c.z);
      if (!Number.isFinite(dm)) continue;
      const dk = dist(K.x, K.z, c.x, c.z);
      let s = dk - 1.35 * dm;
      if (sim.world.sightBlocked(K.x, K.z, c.x, c.z)) s += 5;
      if (c.hide && !sim.keeperSeesPoint(c.x, c.z)) s += 6;
      if (c.gap) s += 8;
      if (shooed) s += dist(K.sceneX, K.sceneZ, c.x, c.z) > FARM.SCENE_R + 2.5 ? 10 : -10;
      const tx = c.x - me.x, tz = c.z - me.z, kx = K.x - me.x, kz = K.z - me.z, kd = Math.hypot(kx, kz) || 1, td = Math.hypot(tx, tz) || 1;
      if ((tx * kx + tz * kz) / (kd * td) > 0.3 && dm > 1.5) s -= 12;
      if (s > bs) { bs = s; best = c; }
    }
    return best || { x: me.x - (K.x - me.x), z: me.z - (K.z - me.z) };
  }

  function execTask(sim, me, t) {
    const o = t.o;
    const d = dist(me.x, me.z, t.x, t.z);
    const K = sim.keeper;
    const watched = sim.canKeeperSee(me) || (K.active && dist(K.x, K.z, me.x, me.z) < 4.5);
    const near = (r) => d < r;
    switch (t.type) {
      case 'pounce': {
        let ax = o.x, az = o.z;
        if (o.kind === 'pen_gate') {
          // 站在门的一侧（离自己近、走得到的那侧），正对着门扑
          const gb = sim.world.gates.find((q) => q.oi === o.oi);
          if (gb) {
            const nx = gb.hw < gb.hd ? gb.co : gb.si, nz = gb.hw < gb.hd ? -gb.si : gb.co;
            const a = [gb.x + nx * 1.0, gb.z + nz * 1.0], b = [gb.x - nx * 1.0, gb.z - nz * 1.0];
            const la = pathLen(sim, a[0], a[1]), lb = pathLen(sim, b[0], b[1]);
            [ax, az] = la <= lb ? a : b;
          }
          if (dist(me.x, me.z, ax, az) > 0.6 && me.pounceCd <= 0.4) { out.moveTo = steer(sim, me, ax, az); return; }
          out.moveTo = { x: o.x, z: o.z };
          const err = Math.abs(wrap(Math.atan2(o.x - me.x, o.z - me.z) - me.heading));
          if (me.pounceCd <= 0 && err < 0.5 && !watched) out.pounce = true;
          return;
        }
        if (!near(o.r + 1.7)) { out.moveTo = steer(sim, me, ax, az); return; }
        out.moveTo = { x: o.x, z: o.z };
        const err = Math.abs(wrap(Math.atan2(o.x - me.x, o.z - me.z) - me.heading));
        if (me.pounceCd <= 0 && err < 0.45 && !watched) out.pounce = true;
        if (watched) out.moveTo = steer(sim, me, me.x - (K.x - me.x), me.z - (K.z - me.z));
        return;
      }
      case 'dig': {
        if (!near(0.5)) { out.moveTo = steer(sim, me, o.x, o.z); return; }
        out.moveTo = { x: o.x, z: o.z };
        out.dig = !watched;
        return;
      }
      case 'trample': {
        const L = o.r + 1.3;
        const tx = o.x + trampleSide * L, tz = o.z;
        if (dist(me.x, me.z, tx, tz) < 0.6) trampleSide = -trampleSide;
        if (!near(o.r + 2) || !watched) out.moveTo = steer(sim, me, o.x + trampleSide * L, tz);
        return;
      }
      case 'roll': case 'splash': case 'printLine': {
        out.moveTo = near(1.5) ? { x: o.x, z: o.z } : steer(sim, me, o.x, o.z);
        return;
      }
      case 'printPlaza': {
        const R = (o.r + o.plaza) / 2;
        let tx = o.x + Math.sin(ringA) * R, tz = o.z + Math.cos(ringA) * R;
        if (dist(me.x, me.z, tx, tz) < 0.7) { ringA += 0.9; tx = o.x + Math.sin(ringA) * R; tz = o.z + Math.cos(ringA) * R; }
        out.moveTo = steer(sim, me, tx, tz);
        return;
      }
      case 'scatter': {
        let bird = null, bd = Infinity;
        for (const a of sim.animals) if (sim.groups[a.group] === t.g) { const dd = dist(a.x, a.z, me.x, me.z); if (dd < bd) { bd = dd; bird = a; } }
        if (!bird) return;
        if (bd > 2.5) { out.moveTo = steer(sim, me, bird.x, bird.z); return; }
        out.moveTo = { x: bird.x + Math.sin(bird.heading) * 0.8, z: bird.z + Math.cos(bird.heading) * 0.8 };
        if (me.pounceCd <= 0 && bd < 1.6 && !watched) out.pounce = true;
        return;
      }
    }
  }

  return function skilledBot(sim, petId, dt) {
    const me = sim.petById(petId);
    out.pounce = false; out.dig = false; out.moveTo = null;
    if (!me || me.held || me.escaped || sim.finished) { route = null; task = null; return out; }
    if (sim.time < lastTime) { task = null; route = null; cool = {}; }
    lastTime = sim.time;
    fieldT -= dt; taskT -= dt; fleeT -= dt;
    refreshField(sim, me, false);
    const K = sim.keeper, kr = sim.rules.keeper;
    const exit = sim.map.spawns.exit;
    const kd = K.active ? dist(K.x, K.z, me.x, me.z) : Infinity;

    // ---- 通缉阶段：直奔出口
    if (sim.phase === 'wanted' && exit) { out.moveTo = steer(sim, me, exit.x, exit.z); return out; }

    // ---- 危险判断
    const chased = K.active && K.state === 'chase';
    const prying = K.active && (K.state === 'suspicious' || K.state === 'search') && kd < 6.5;
    const exitLen = exit ? pathLen(sim, exit.x, exit.z) : Infinity;
    const toWanted = FARM.WANTED_AT - sim.time;
    const exitMode = exit && Number.isFinite(exitLen) && (toWanted < exitLen / (FARM.DOG_SPEED * 0.8) + 14);

    if (me.hidden && !me.hideSeen && (chased || prying || (kd < 9 && K.state !== 'patrol'))) {
      // 躲着别动，等她走远
      hideT += dt;
      if (hideT < 20) { out.moveTo = null; return out; }
    } else hideT = 0;

    if (chased || prying) {
      if (exitMode && toWanted < 2.5 && dist(me.x, me.z, exit.x, exit.z) < 2) { out.moveTo = { x: exit.x, z: exit.z }; return out; }
      if (mode !== 'flee' || fleeT <= 0 || !fleeGoal) { fleeGoal = pickFlee(sim, me); fleeT = 0.5; }
      mode = 'flee'; task = null;
      out.moveTo = steer(sim, me, fleeGoal.x, fleeGoal.z);
      return out;
    }
    if (mode === 'flee') { mode = 'work'; route = null; }

    // ---- 通缉前去出口等着
    if (exitMode) {
      out.moveTo = dist(me.x, me.z, exit.x, exit.z) < 1.5 ? { x: exit.x, z: exit.z } : steer(sim, me, exit.x, exit.z);
      return out;
    }

    // ---- 捣乱
    if (task && task.o && task.o.done && task.key === task.o.id) task = null;
    if (task && task.g && task.g.done) task = null;
    if (task && (task.type === 'printLine' || task.type === 'printPlaza') && (task.o.mudded || !me.muddy)) task = null;
    if (task && task.type === 'roll' && me.muddy) task = null;
    if (task && taskT <= 0) { cool[task.key] = sim.time + 4; task = null; }  // 太久没做成：先换一个
    if (!task || (taskT < 18 && fieldT === 0.6)) {
      const nt = pickTask(sim, me);
      if (nt && (!task || nt.key !== task.key)) { task = nt; taskT = 25; trampleSide = rng() < 0.5 ? 1 : -1; ringA = rng() * TAU; route = null; }
      else if (nt && task) { task.x = nt.x; task.z = nt.z; }
    }
    if (!task) {
      if (exit) out.moveTo = steer(sim, me, exit.x, exit.z);
      return out;
    }
    execTask(sim, me, task);
    return out;
  };
}

export default createFarmBot;
