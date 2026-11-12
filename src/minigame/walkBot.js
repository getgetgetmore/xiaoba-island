// 遛狗小游戏的机器人（自动驾驶）。所有机器人都只通过“手”的输入（hand, grip）来操控，不碰小狗的位置。
// 用途：scripts/walk-test.mjs 验证公平性 / 难度；URL 调试参数 gameT 快进 / 截图时让小狗自己走（高手档）。
//
// createAutopilot(opts) → (sim) => { hand, grip }
//   opts.delay    反应延迟（秒）：命令在 delay 秒之后才生效
//   opts.noise    手的目标位置噪声（米，每排固定一个随机偏移）
//   opts.tug      会不会拽
//   opts.comp     会不会抵消小狗的意志力（读 sim.will 反向多拉一点）
//   opts.gripNear 只在离下一排 ≤ 这么近（米）时才收紧；0 = 从不收紧；Infinity = 按高手策略
//   opts.always   全程收紧
//   opts.idle     什么都不做（手放在 0，不收紧）
//   opts.crosser  遇到会撞上的横穿物是否提前收紧
import { WALK, speedAt } from './walkSim.js';

const R = WALK.RADIUS;
const KT = WALK.K_LOOSE * WALK.K_TIGHT_MUL;
const sgn = (v) => (v < 0 ? -1 : 1);

export function createAutopilot(opts = {}) {
  const o = { delay: 0.12, noise: 0, tug: true, comp: true, gripNear: Infinity, always: false, idle: false, crosser: true, seed: 1, ...opts };
  let rowI = 0;
  const cmdState = new Map();
  const queue = [];
  let rngS = (o.seed >>> 0) || 1;
  const rnd = () => { rngS = (Math.imul(rngS, 1664525) + 1013904223) >>> 0; return rngS / 4294967296; };
  const rowNoise = new Map();
  let lastT = -1;

  function plan(sim) {
    if (o.idle) return { hand: 0, grip: false };
    const dist = sim.dist;
    const rows = sim.rows;
    while (rowI < rows.length && (!rows[rowI].hazard ? rows[rowI].s + 1.7 < dist : rows[rowI].s + (rows[rowI].kind === 'walker' ? 0 : 1.7) < dist)) rowI++;
    // 找下一个危险排（跳过非危险排）
    let row = null, ri = rowI;
    for (; ri < rows.length; ri++) { if (rows[ri].hazard) { row = rows[ri]; break; } }
    let tx = sim.x, grip = false, brakeFor = false;
    let rowAhead = 99;
    if (row) {
      rowAhead = row.s - dist;
      tx = WALK.LANES[row.safe];
      if (o.noise) {
        if (!rowNoise.has(row)) rowNoise.set(row, (rnd() * 2 - 1) * o.noise);
        tx += rowNoise.get(row);
      }
      // 顺路的骨头
      if (!o.noise) {
        for (let i = sim.iLo; i <= sim.iHi; i++) {
          const e = sim.entities[i];
          if (e.cls !== 'bone' || e.state !== 'idle') continue;
          const a = e.s - dist;
          if (a < -0.4) continue;
          if (a > rowAhead - 1.8) break;
          tx = e.x;
          break;
        }
      }
      // 横穿物：按“不收紧时到达的时刻”预测，会撞上就提前收紧，直到它从我的道上过去
      if (o.crosser) for (let i = ri; i < Math.min(rows.length, ri + 3); i++) {
        const rw = rows[i];
        if (rw.kind !== 'crosser') continue;
        const e = rw.ents[0];
        const ahead = e.s - dist;
        if (ahead < -1.5 || e.state === 'done' || ahead > e.trig + 0.9 * speedAt(sim.time, sim.duration)) continue;
        const vRef = speedAt(sim.time, sim.duration);
        const xd = WALK.LANES[rw.safe];
        if (cmdState.get(e) === undefined) {
          const xc = e.x0 + e.vx * Math.max(0, e.trig / vRef);
          const w = e.hw + R + 1.0;
          cmdState.set(e, Math.abs(xc - xd) < w || Math.abs(xc - sim.x) < w || Math.abs(xc - tx) < w ? 'brake' : 'go');
        }
        if (cmdState.get(e) === 'brake') {
          const xr = e.dir > 0 ? Math.max(xd, sim.x, tx) : Math.min(xd, sim.x, tx);
          const passed = e.active && e.dir * (e.x - xr) > e.hw + R + 0.5;
          if (!passed) brakeFor = true;
        }
      }
    }
    // 前冲：看到小动物就提前收紧，直到冲过去
    if (o.crosser) for (let i = sim.iLo; i <= sim.iHi; i++) {
      const e = sim.entities[i];
      if (e.cls !== 'critter') continue;
      const a = e.s - dist;
      if (a < 34 && a > -6 && e.state !== 'done') brakeFor = true;
      if (a > 34) break;
    }
    if (sim.dashT > 0.2) brakeFor = true;
    const e = tx - sim.x;
    let W = o.comp ? sim.will : 0;
    // 诱惑物 / 害怕的东西快到了：它的力马上会变得很大，提前按“会变大”来准备（收紧 + 反向多拉一点）
    let incoming = false;
    if (o.comp && o.gripNear === Infinity) {
      const lu = sim.lure, fe = sim.fear;
      const aLu = lu ? lu.s - dist : 99, aFe = fe ? fe.s - dist : 99;
      if (Math.min(aLu, aFe) < 11 && Math.min(aLu, aFe) > -1.5) {
        incoming = true;
        const dirW = aLu < aFe ? sgn(lu.x - sim.x) : sgn(sim.x - fe.x + (Math.abs(sim.x - fe.x) < 0.25 ? (fe.x > 0 ? -1 : 1) * 0.3 : 0));
        W = dirW * Math.max(Math.abs(W), 8);
      }
    }
    const tLeft = (rowAhead - 1.5) / Math.max(2, sim.speed);
    const needTight = (Math.abs(e) > 0.45 && (tLeft < 2.2 || (Math.abs(e) > 1.0 && tLeft < 3.2))) || (Math.abs(W) > 5.5 && tLeft < 1.8) || incoming;
    if (o.always) grip = true;
    else if (o.gripNear === 0) grip = false;
    else if (o.gripNear === Infinity) grip = (needTight && (sim.gripMeter < 0.4 || (Math.abs(e) > 1.0 && tLeft < 1.2))) || (brakeFor && sim.gripMeter < 0.6);
    else grip = (Math.abs(e) > 0.6 && rowAhead < o.gripNear) || (brakeFor && rowAhead < o.gripNear * 1.6);
    if (o.gripNear === Infinity && !o.always && (sim.slipT > 0 || sim.gripMeter > 0.6)) grip = false; // 握力快满了：松手歇一下，别脱手
    // 手的位置
    let hand = tx;
    if (grip) {
      hand = Math.abs(W) > 1 ? tx - sgn(W) * (WALK.SLACK_TIGHT + Math.abs(W) / KT) : tx + (Math.abs(e) > 0.3 ? sgn(e) * WALK.SLACK_TIGHT : 0);
    } else if (o.comp && Math.abs(W) > 0.3 && sim.slipT <= 0) {
      // 松着：把手放到小狗“想去的方向”的另一边，让绳子刚好拉住它（张力 = 它的力，低于握力阈值，不会累积握力）
      hand = tx - sgn(W) * (WALK.SLACK_LOOSE + Math.abs(W) / WALK.K_LOOSE);
    }
    // 拽：要在很短的时间内横移很远，或者小狗在嗅
    if (o.tug && sim.tugCd <= 0 && sim.slipT <= 0 && ((Math.abs(e) > 1.5 && rowAhead < 7 && !grip) || sim.sniffT > 0.4)) {
      const dir = sim.sniffT > 0.4 ? (sim.x > 0 ? -1 : 1) : sgn(e);
      hand = sim.x + dir * 2.6;
      grip = false;
    }
    return { hand: Math.max(-WALK.HAND_MAX, Math.min(WALK.HAND_MAX, hand)), grip };
  }

  const out = { hand: 0, grip: false };
  return (sim) => {
    const cmd = plan(sim);
    if (o.delay <= 0) return cmd;
    queue.push({ t: sim.time, hand: cmd.hand, grip: cmd.grip });
    // 取 delay 秒之前的命令
    let pick = null;
    while (queue.length > 1 && sim.time - queue[1].t >= o.delay) queue.shift();
    pick = queue[0];
    if (sim.time - pick.t < o.delay - 1e-6) { out.hand = sim.hand; out.grip = false; return out; }
    out.hand = pick.hand; out.grip = pick.grip;
    void lastT;
    return out;
  };
}
