// 钓鱼机器人（测试 / 调试自动驾驶）：只通过 { click, hold } 操控，和真人一样只看得到界面上的信号
// （假咬 sim.fake、真咬 sim.real、预兆 sim.warn、挣扎 sim.struggle）。
//   skilled  熟练：真咬后 150–250 毫秒点击；拉扯时挣扎（含预兆）就松、安静就拉（反应慢 100–150 毫秒）
//   spam     乱点：每 0.4 秒点一次
//   holder   只会按住不放：真咬后点击，然后一直按住
//   idle     什么都不做
//   eager    抢点：看到假咬就点（用来测“假咬时点击”）
import { mulberry32 } from '../core/util.js';

export function createFishBot({ kind = 'skilled', seed = 1, reactMin = 0.15, reactMax = 0.25, calmReact = 0.12 } = {}) {
  const rng = mulberry32(seed);
  let react = reactMin + (reactMax - reactMin) * rng();
  let biteT = -1;
  let clicked = false;
  let spamT = 0;
  let bel = false, pend = false, pendT = 0; // 对“它在挣扎”的认知（带反应延迟）
  let lastPhase = '', lastCast = -1;
  const out = { click: false, hold: false };

  return function bot(sim, dt) {
    out.click = false;
    if (sim.cast !== lastCast) { lastCast = sim.cast; biteT = -1; clicked = false; react = reactMin + (reactMax - reactMin) * rng(); bel = false; pend = false; }
    lastPhase = sim.phase;
    if (kind === 'idle') { out.hold = false; return out; }
    if (kind === 'spam') {
      spamT += dt;
      if (spamT >= 0.4) { spamT -= 0.4; out.click = true; }
      out.hold = out.click;
      return out;
    }
    if (kind === 'eager') {
      out.hold = false;
      if (sim.phase === 'wait' && sim.fake && !clicked) { clicked = true; out.click = true; out.hold = true; }
      return out;
    }
    // skilled / holder
    if (sim.phase === 'bite') {
      if (biteT < 0) biteT = 0;
      biteT += dt;
      if (!clicked && biteT >= react) { clicked = true; out.click = true; }
      out.hold = clicked;
    } else if (sim.phase === 'fight') {
      if (kind === 'holder') out.hold = true;
      else {
        const sig = sim.warn || sim.struggle;
        if (sig !== pend) { pend = sig; pendT = 0; }
        pendT += dt;
        if (pend !== bel && pendT >= calmReact * (0.8 + 0.5 * rng())) bel = pend;
        out.hold = !bel;
      }
    } else {
      out.hold = kind === 'holder' && sim.phase !== 'cast' ? true : false;
      bel = false; pend = false;
    }
    return out;
  };
}

export default createFishBot;
