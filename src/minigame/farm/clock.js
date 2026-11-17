// 农场时钟：农场里“现在是什么时候、什么天气”。逻辑和画面都只问它，不直接读系统时间。
// createFarmClock({ env, source }) → clock
//   clock.hour (0..24)、clock.weather、clock.phase ('dawn' | 'day' | 'dusk' | 'night')、clock.blend (这个时段进行到多少 0..1)
//   clock.source：
//     'env'   默认。跟随岛上的时间和天气（ctx.env，即电脑时钟）；
//     'fixed' 固定在 setFixed(hour, weather) 给的时刻（调试、剧情、测试）；
//     'host'  联机时以房主的农场时间为准：由 setHostTime(hour, weather) 喂进来（见 net.js 的 'time' 消息）。
//   clock.on('phase', fn)：时段变化时调用 fn(phase, prevPhase)。
//   clock.update()：每帧调用一次。
// 时段的分界集中在 PHASES，改这里即可。纯逻辑，不依赖 three / DOM。

export const PHASES = [
  { id: 'dawn', from: 5, to: 7 },
  { id: 'day', from: 7, to: 17.5 },
  { id: 'dusk', from: 17.5, to: 19.5 },
  { id: 'night', from: 19.5, to: 29 }, // 到次日 5:00
];

export function phaseAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  for (const p of PHASES) {
    const a = p.from, b = p.to;
    const x = h < a && b > 24 ? h + 24 : h;
    if (x >= a && x < b) return { id: p.id, blend: (x - a) / (b - a) };
  }
  return { id: 'night', blend: 0 };
}

export function createFarmClock({ env = null, source = 'env' } = {}) {
  const listeners = { phase: [] };
  const fixed = { hour: 11, weather: 'clear' };
  const host = { hour: 11, weather: 'clear' };
  const clock = {
    hour: 11, weather: 'clear', phase: 'day', blend: 0, source,
    setSource(s) { clock.source = s; clock.update(); },
    setFixed(hour, weather) { if (Number.isFinite(hour)) fixed.hour = hour; if (weather) fixed.weather = weather; clock.source = 'fixed'; clock.update(); },
    setHostTime(hour, weather) { if (Number.isFinite(hour)) host.hour = hour; if (weather) host.weather = weather; },
    on(type, fn) { if (listeners[type]) listeners[type].push(fn); return () => { const a = listeners[type], i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; },
    update() {
      const src = clock.source === 'fixed' ? fixed : clock.source === 'host' ? host : env;
      if (src) { clock.hour = Number.isFinite(src.hour) ? src.hour : clock.hour; clock.weather = src.weather || clock.weather; }
      const p = phaseAt(clock.hour);
      clock.blend = p.blend;
      if (p.id !== clock.phase) {
        const prev = clock.phase;
        clock.phase = p.id;
        for (const fn of listeners.phase) { try { fn(p.id, prev); } catch (_) { /* 监听方出错不影响时钟 */ } }
      }
    },
  };
  // 第一次更新不触发事件：直接把时段摆到位
  const src0 = source === 'fixed' ? fixed : source === 'host' ? host : env;
  if (src0 && Number.isFinite(src0.hour)) { clock.hour = src0.hour; clock.weather = src0.weather || 'clear'; }
  const p0 = phaseAt(clock.hour); clock.phase = p0.id; clock.blend = p0.blend;
  return clock;
}

export default createFarmClock;
