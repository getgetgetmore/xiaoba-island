// Environment：时间 + 马尔可夫天气 + 闪电。严格对应 DESIGN.md 3.2。
import { Vector3 } from 'three';
import { clamp, damp, smoothstep, mulberry32, rand, weightedPick } from './util.js';

export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm'];

// 各天气的连续量目标
const TARGETS = {
  clear: { cloudiness: 0.15, rain: 0, storm: 0, wind: 0.15 },
  cloudy: { cloudiness: 0.7, rain: 0, storm: 0, wind: 0.3 },
  rain: { cloudiness: 0.9, rain: 0.6, storm: 0, wind: 0.5 },
  storm: { cloudiness: 1, rain: 1, storm: 1, wind: 1 },
};
// 停留时长（分钟）
const DWELL = { clear: [8, 20], cloudy: [5, 12], rain: [4, 10], storm: [3, 6] };
// 马尔可夫转移（不含自身）
const TRANSITIONS = {
  clear: [['cloudy', 0.8], ['rain', 0.2]],
  cloudy: [['clear', 0.45], ['rain', 0.45], ['storm', 0.1]],
  rain: [['cloudy', 0.5], ['clear', 0.2], ['storm', 0.3]],
  storm: [['rain', 0.6], ['cloudy', 0.4]],
};

const TRANSITION_LAMBDA = 0.15; // 指数阻尼，约 20 秒到 95%

function systemHour() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + d.getMilliseconds() / 3600000;
}

/** 梯形/钟形脉冲：在 [a,b] 内以 peak 为峰，两侧 smoothstep */
function bump(h, a, peak, b) {
  return smoothstep(a, peak, h) * (1 - smoothstep(peak, b, h));
}

export function createEnvironment({ rng, hour, weather, timeScale } = {}) {
  rng = rng || mulberry32(1);

  const env = {
    // —— 只读状态 ——
    hour: 12,
    phase: 'day',
    dayFactor: 1,
    sunsetFactor: 0,
    sunDir: new Vector3(0, 1, 0.3).normalize(),
    moonDir: new Vector3(0, -1, 0.3).normalize(),
    weather: 'clear',
    cloudiness: TARGETS.clear.cloudiness,
    rain: 0,
    storm: 0,
    wind: TARGETS.clear.wind,
    wetness: 0,
    lightning: 0,
    lightningSeq: 0,
    isNight: false,
    isRaining: false,
    elapsed: 0, // 启动以来累计的真实 dt 之和（不受 timeScale 影响）

    update,
    setHour,
    setTimeScale,
    setWeather,
  };

  // —— 内部状态 ——
  let follow = true; // 跟随系统时钟
  let scale = timeScale > 0 ? timeScale : 1;
  let auto = true; // 自动天气
  let dwell = 0; // 当前天气剩余停留（模拟秒）
  let strikeTimer = 2.5; // 距下次雷击（真实秒）
  let strikeT = 99; // 距上次雷击（真实秒）
  let hasSecond = false;
  let secondDelay = 0.15;

  if (typeof hour === 'number' && Number.isFinite(hour)) {
    follow = false;
    env.hour = ((hour % 24) + 24) % 24;
  } else {
    env.hour = systemHour();
  }

  if (weather && TARGETS[weather]) {
    auto = false;
    env.weather = weather;
  } else {
    // 初始天气 clear 60 / cloudy 25 / rain 15
    env.weather = weightedPick(rng, [['clear', 0.6], ['cloudy', 0.25], ['rain', 0.15]]);
    resetDwell();
  }
  snapContinuous();
  computeAstro();
  computeDerived();
  env.wetness = env.rain > 0.15 ? 0.6 : 0;

  function resetDwell() {
    const [a, b] = DWELL[env.weather];
    dwell = rand(rng, a, b) * 60;
  }

  function snapContinuous() {
    const t = TARGETS[env.weather];
    env.cloudiness = t.cloudiness;
    env.rain = t.rain;
    env.storm = t.storm;
    env.wind = t.wind;
  }

  function setHour(h) {
    if (h === null || h === undefined || !Number.isFinite(h)) {
      follow = true;
      env.hour = systemHour();
    } else {
      follow = false;
      env.hour = ((h % 24) + 24) % 24;
    }
    computeAstro();
    computeDerived();
  }

  function setTimeScale(s) {
    scale = Number.isFinite(s) && s > 0 ? s : 1;
  }

  function setWeather(name, { instant = false } = {}) {
    if (name === null || name === undefined) {
      auto = true;
      resetDwell();
      return;
    }
    if (!TARGETS[name]) return;
    auto = false;
    env.weather = name;
    if (name === 'storm') strikeTimer = Math.min(strikeTimer, rand(rng, 2, 5));
    if (instant) {
      snapContinuous();
      computeDerived();
    }
  }

  function computeAstro() {
    const h = env.hour;
    // 日出 6:00、日落 18:30
    let theta;
    if (h >= 6 && h <= 18.5) theta = Math.PI * ((h - 6) / 12.5);
    else {
      const t = h > 18.5 ? (h - 18.5) / 11.5 : (h + 24 - 18.5) / 11.5;
      theta = Math.PI + Math.PI * t;
    }
    // 太阳自 +X 升起，落向 -X，略偏 +Z
    env.sunDir.set(Math.cos(theta), Math.sin(theta) * 0.8, 0.3).normalize();
    env.moonDir.set(-Math.cos(theta), -Math.sin(theta) * 0.8, 0.3).normalize();

    env.dayFactor = smoothstep(5.25, 6.75, h) * (1 - smoothstep(17.75, 19.25, h));
    env.phase = h >= 5 && h < 7 ? 'dawn' : h >= 7 && h < 17.5 ? 'day' : h >= 17.5 && h < 19.5 ? 'dusk' : 'night';
    env.isNight = env.dayFactor < 0.25;
  }

  function computeDerived() {
    const h = env.hour;
    const glow = Math.max(bump(h, 17.25, 18.25, 19.25), 0.6 * bump(h, 5.5, 6.25, 7.0));
    const rainKill = 1 - clamp(env.rain / 0.3);
    env.sunsetFactor = clamp(glow * (1 - 0.85 * env.cloudiness) * rainKill);
    env.isRaining = env.rain > 0.15;
    env.isNight = env.dayFactor < 0.25;
  }

  function pickNextWeather() {
    env.weather = weightedPick(rng, TRANSITIONS[env.weather]);
    resetDwell();
    if (env.weather === 'storm') strikeTimer = rand(rng, 2, 6);
  }

  function update(dt) {
    if (!(dt > 0)) dt = 0;
    env.elapsed += dt;
    const simDt = dt * scale;

    // —— 时间 ——
    if (follow && scale === 1) env.hour = systemHour();
    else env.hour = (env.hour + simDt / 3600) % 24;
    computeAstro();

    // —— 天气切换 ——
    if (auto) {
      dwell -= simDt;
      if (dwell <= 0) pickNextWeather();
    }

    // —— 连续量平滑 ——
    const k = TRANSITION_LAMBDA * clamp(scale, 1, 20);
    const t = TARGETS[env.weather];
    env.cloudiness = approach(env.cloudiness, t.cloudiness, k, dt);
    env.rain = approach(env.rain, t.rain, k, dt);
    env.storm = approach(env.storm, t.storm, k, dt);
    env.wind = approach(env.wind, t.wind, k, dt);

    // —— 地面潮湿度：雨时升，雨停后约 60s（模拟秒）回落 ——
    if (env.rain > 0.15) env.wetness = Math.min(1, env.wetness + (env.rain / 15) * simDt);
    else env.wetness = Math.max(0, env.wetness - simDt / 60);

    // —— 闪电 ——
    strikeT += dt;
    if (env.weather === 'storm' && env.storm > 0.6) {
      strikeTimer -= dt;
      if (strikeTimer <= 0) {
        env.lightningSeq++;
        strikeT = 0;
        hasSecond = rng() < 0.6;
        secondDelay = rand(rng, 0.1, 0.22);
        strikeTimer = rand(rng, 4, 12);
      }
    }
    let l = Math.exp(-strikeT * 10);
    if (hasSecond && strikeT > secondDelay) l = Math.max(l, 0.7 * Math.exp(-(strikeT - secondDelay) * 12));
    env.lightning = l < 0.002 ? 0 : clamp(l);

    computeDerived();
  }

  return env;
}

function approach(cur, target, lambda, dt) {
  const v = damp(cur, target, lambda, dt);
  return Math.abs(v - target) < 0.0005 ? target : v;
}

export default createEnvironment;
