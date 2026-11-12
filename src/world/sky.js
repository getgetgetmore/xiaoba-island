// WP2 天空 / 光照 / 天气（DESIGN.md 3.4）。
// 天空是“舞台背景”：渐变与日月星云都按画面（相机）空间布置，保证任何窗口比例下铺满且观感稳定；
// 平行光方向仍取 env.sunDir / moonDir（光从镜头侧前方打来）。
import * as THREE from 'three';
import { palette } from '../core/palette.js';
import { clamp, lerp, smoothstep, mulberry32 } from '../core/util.js';
import { createStage } from './sky/stage.js';
import { createBackground } from './sky/background.js';
import { createSunMoon, createStars } from './sky/celestial.js';
import { createRain } from './sky/rain.js';
import { createLightning } from './sky/lightning.js';

const D_SUN = 170;
const D_MOON = 165;

// 调色辅助（预分配，update 内不 new）
const _a = new THREE.Color();
const _b = new THREE.Color();
const _c = new THREE.Color();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _p = new THREE.Vector3();

const hex = (h) => new THREE.Color(h);
// 手绘天空色板（顶 / 中 / 地平线），偏青蓝
const PAL = {
  day: { top: hex(0x3d9db0), mid: hex(0x5cbcc0), hor: hex(0xbfe6d6) }, // 晴天提亮（原 0x2a8496 / 0x3aa0a8 / 0x9fd0c4 偏暗）
  dawn: { top: hex(0x4f7f9a), mid: hex(0xe4a796), hor: hex(0xf6d5a2) },
  dusk: { top: hex(0x4a4f94), mid: hex(0xe08672), hor: hex(0xf5b56e) },
  night: { top: hex(0x081a30), mid: hex(0x0f2f48), hor: hex(0x1b4a5c) },
  cloudy: { top: hex(0x6b8890), mid: hex(0x86a2a6), hor: hex(0xa9bdb9) },
  rain: { top: hex(0x55707a), mid: hex(0x6e8791), hor: hex(0x8fa3a8) },
  storm: { top: hex(0x33434f), mid: hex(0x46596a), hor: hex(0x5d707c) },
};
const CLOUD = {
  day: [hex(0xfff4de), hex(0x6f94ad)],
  dawn: [hex(0xffd2b8), hex(0x7f86a8)],
  dusk: [hex(0xffc79a), hex(0x8a5f88)],
  night: [hex(0x5c7aa8), hex(0x1f3050)],
  cloudy: [hex(0xdde5e6), hex(0x7b929c)],
  rain: [hex(0xaebbc0), hex(0x56707c)],
  storm: [hex(0x7b8a98), hex(0x2f3b48)],
};
const COL = {
  // 亮部偏暖黄、暗部（半球光）偏冷蓝绿
  sunDay: hex(0xffe2a6),
  sunDusk: hex(0xffa24f),
  sunCool: hex(0xe3eaf0),
  moon: hex(0x8aa6e6),
  hemiSkyDay: hex(0x9fcfd6),
  hemiGrDay: hex(0x55705a),
  hemiSkyDusk: hex(0xc9a3bd),
  hemiGrDusk: hex(0x6d5a62),
  hemiSkyNight: hex(0x5d86b8),
  hemiGrNight: hex(0x2d4a5a),
  hemiSkyOver: hex(0xb4cdd2),
  hemiGrOver: hex(0x667c80),
  flash: hex(0xdbe6ff),
  sunLowCol: hex(0xff9340),
  sunCol: hex(palette.sun),
  haloWarm: hex(0xff8a4a),
  haloDay: hex(0xffe9a8),
  moonCol: hex(palette.moon),
  moonHalo: hex(0x8fa8e8),
  glowDusk: hex(0xffa36a),
  glowDawn: hex(0xffc29a),
  mDay: hex(0xffffff),
  mDusk: hex(0xe39a7e),
  mNight: hex(0x40607f),
  mOver: hex(0x8fa2a2),
};

export function createSky(ctx) {
  const group = new THREE.Group();
  group.name = 'sky';
  const rng = mulberry32(((ctx.rng ? ctx.rng() : 0.5) * 4294967296) >>> 0);

  const stage = createStage(ctx);
  const bg = createBackground();
  const { sun, moon } = createSunMoon();
  const stars = createStars(stage, rng);
  const bolt = createLightning(stage, rng);
  const rain = createRain(ctx, rng);

  stage.group.add(bg.mesh, sun.mesh, moon.mesh, stars.mesh, bolt.mesh);
  group.add(stage.group);
  group.add(rain.group);

  // ---- 光 ----
  const hemi = new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, 1.0);
  group.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
  sunLight.name = 'sky.sunLight';
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  const sc = sunLight.shadow.camera;
  sc.left = -11; sc.right = 11; sc.top = 11; sc.bottom = -11; sc.near = 8; sc.far = 80;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.035;
  sunLight.target.position.set(0, 0.5, 0);
  group.add(sunLight);
  group.add(sunLight.target);

  // ---- 雾（只做轻微空气感：越远越被雨雾/地平线色染一点点）----
  let fog = null;
  if (ctx.scene) {
    fog = new THREE.Fog(0xdff0f7, 30, 200);
    ctx.scene.fog = fog;
  }

  // ---- 颜色混合 ----
  const top = new THREE.Color();
  const mid = new THREE.Color();
  const hor = new THREE.Color();
  const cloudLit = new THREE.Color();
  const cloudDark = new THREE.Color();
  const meadowL = new THREE.Color();
  let time = 0;
  let exposure = 1;

  function skyMix(env, key, out, dawn) {
    out.copy(PAL.night[key]).lerp(PAL.day[key], env.dayFactor);
    out.lerp((dawn ? PAL.dawn : PAL.dusk)[key], clamp(env.sunsetFactor * 1.05));
    // 阴雨天色：阴 → 雨 → 雷雨 连续过渡；夜间不变亮，且仍保留一点蓝
    _c.copy(PAL.cloudy[key]).lerp(PAL.rain[key], clamp(env.rain / 0.6));
    _c.lerp(PAL.storm[key], env.storm);
    _c.multiplyScalar(lerp(0.3, 1, env.dayFactor));
    out.lerp(_c, clamp(env.cloudiness * 0.92));
    return out;
  }

  function update(dt, env) {
    time += dt;
    const cam = ctx.camera;
    stage.sync(cam);
    const aspect = stage.aspect;
    const dawn = env.hour < 12;
    const cloudy = env.cloudiness;

    // ================= 天空渐变 =================
    skyMix(env, 'top', top, dawn);
    skyMix(env, 'mid', mid, dawn);
    skyMix(env, 'hor', hor, dawn);
    const U = bg.uniforms;
    // 背景画面的显示程度（main.js 按窗口大小给出）：1 = 完整画面，0 = 只有小岛漂浮在桌面上
    const backdrop = ctx.view && Number.isFinite(ctx.view.backdrop) ? ctx.view.backdrop : 1;
    U.uTop.value.copy(top);
    U.uMid.value.copy(mid);
    U.uHor.value.copy(hor);
    U.uAsp.value = aspect;
    U.uFlash.value = env.lightning * 0.22;

    // ================= 太阳 / 月亮（舞台化弧线）=================
    // 由 env.sunDir 反推天球角 θ：sunDir ∝ (cosθ, 0.8 sinθ, 0.3)
    const sx = env.sunDir.x, sy = env.sunDir.y / 0.8;
    const sl = Math.hypot(sx, sy) || 1;
    const cosS = sx / sl, sinS = sy / sl;
    const mx = env.moonDir.x, my = env.moonDir.y / 0.8;
    const ml = Math.hypot(mx, my) || 1;
    const cosM = mx / ml, sinM = my / ml;

    const vLow = 0.1 + 0.12 * clamp((1.2 - aspect) / 0.6);
    const vHigh = 0.66;
    const uArc = 0.64;

    // 太阳
    {
      const vis = smoothstep(-0.14, 0.03, sinS);
      const low = 1 - smoothstep(0.08, 0.55, sinS);
      const u = uArc * cosS;
      const v = vLow + (vHigh - vLow) * sinS;
      const r = lerp(0.07, 0.115, low) * (0.65 + 0.35 * clamp(aspect / 0.9));
      const S = r / sun.core;
      const veil = 1 - 0.95 * smoothstep(0.1, 0.9, cloudy);
      const dSun = lerp(D_SUN, 100, low); // 太阳低时画在云前面，避免被云盖住
      stage.pos(u, v, dSun, _p);
      sun.mesh.position.copy(_p);
      const w = stage.size(S, dSun);
      sun.mesh.scale.set(w, w, 1);
      sun.mesh.visible = vis * veil > 0.003;
      const su = sun.uniforms;
      su.uColor.value.copy(COL.sunCol).lerp(COL.sunLowCol, low * 0.85);
      su.uHaloColor.value.copy(COL.haloDay).lerp(COL.haloWarm, low);
      su.uHalo.value = lerp(0.55, 0.95, low);
      su.uAlpha.value = vis * veil;
      // 背景大光晕
      U.uSun.value.set(u * 0.5 + 0.5, v * 0.5 + 0.5);
      U.uSunCol.value.copy(dawn ? COL.glowDawn : COL.glowDusk).lerp(COL.haloDay, (1 - low) * 0.8);
      U.uSunGlow.value = vis * veil * (0.1 + 0.55 * low + 0.25 * env.sunsetFactor);
    }
    // 月亮
    {
      const vis = smoothstep(-0.14, 0.03, sinM) * smoothstep(0.55, 0.05, env.dayFactor);
      const u = uArc * cosM;
      const v = vLow + (vHigh - vLow) * sinM;
      const r = lerp(0.062, 0.078, 1 - smoothstep(0.08, 0.5, sinM)) * (0.7 + 0.3 * clamp(aspect / 0.9));
      const S = r / moon.core;
      const veil = 1 - 0.95 * smoothstep(0.1, 0.9, cloudy);
      stage.pos(u, v, D_MOON, _p);
      moon.mesh.position.copy(_p);
      const w = stage.size(S, D_MOON);
      moon.mesh.scale.set(w, w, 1);
      moon.mesh.visible = vis * veil > 0.003;
      const mu = moon.uniforms;
      mu.uColor.value.copy(COL.moonCol);
      mu.uHaloColor.value.copy(COL.moonHalo);
      mu.uHalo.value = 0.55;
      mu.uAlpha.value = vis * veil;
      U.uMoon.value.set(u * 0.5 + 0.5, v * 0.5 + 0.5);
      U.uMoonCol.value.copy(COL.moonHalo);
      U.uMoonGlow.value = vis * veil * 0.45;
    }

    // ================= 星星 =================
    {
      const night = 1 - smoothstep(0.02, 0.45, env.dayFactor);
      const a = night * (1 - clamp(cloudy * 1.3)) * (1 - clamp(env.sunsetFactor * 1.5)) * backdrop; // 只留小岛时不画满屏星星
      stars.mesh.visible = a > 0.01;
      stars.uniforms.uAlpha.value = a;
      stars.uniforms.uTime.value = time;
      stars.uniforms.uScale.value = ctx.renderer ? ctx.renderer.getPixelRatio() : 1;
    }

    // ================= 云 / 草甸 / 前景草 =================
    {
      const day = env.dayFactor;
      const lit = (k) => CLOUD[k][0];
      const drk = (k) => CLOUD[k][1];
      cloudLit.copy(lit('night')).lerp(lit('day'), day);
      cloudDark.copy(drk('night')).lerp(drk('day'), day);
      const sf = clamp(env.sunsetFactor * 1.15);
      const sk = dawn ? 'dawn' : 'dusk';
      cloudLit.lerp(lit(sk), sf);
      cloudDark.lerp(drk(sk), sf);
      const gw = clamp(cloudy * 1.05);
      _a.copy(lit('cloudy')).lerp(lit('rain'), clamp(env.rain / 0.6)).lerp(lit('storm'), env.storm).multiplyScalar(lerp(0.4, 1, day));
      _b.copy(drk('cloudy')).lerp(drk('rain'), clamp(env.rain / 0.6)).lerp(drk('storm'), env.storm).multiplyScalar(lerp(0.5, 1, day));
      cloudLit.lerp(_a, gw);
      cloudDark.lerp(_b, gw);
      cloudLit.multiplyScalar(1 + env.lightning * 0.3);
      U.uCloudLit.value.copy(cloudLit);
      U.uCloudDark.value.copy(cloudDark);
      U.uBackdrop.value = backdrop;
      // 用户缩放（视图裁切）：背景画面跟着一起放大
      if (ctx.view && ctx.view.zoom > 0) { U.uViewZ.value = ctx.view.zoom; U.uViewC.value.set(ctx.view.cx, 1 - ctx.view.cy); }
      U.uCloud.value = cloudy;
      U.uOver.value = smoothstep(0.35, 0.95, cloudy);
      U.uTime.value = time;
      // 云的受光方向：取日/月在屏幕上的位置
      const lu = day > 0.3 ? U.uSun.value.x * 2 - 1 : U.uMoon.value.x * 2 - 1;
      U.uLightXY.value.set(lu * 0.9, 0.55);

      // 草甸受光色（日夜、晚霞、阴雨）
      meadowL.copy(COL.mNight).lerp(COL.mDay, day);
      meadowL.lerp(COL.mDusk, clamp(env.sunsetFactor * 0.95));
      meadowL.lerp(COL.mOver, clamp(cloudy * 0.85));
      meadowL.multiplyScalar(1 - 0.22 * env.storm + env.lightning * 0.4 + 0.24 * day * clamp(1 - cloudy * 1.6));
      U.uMeadowLight.value.copy(meadowL);
      // 小岛投影：位置/大小随画面比例
      const uw = 0.82 / Math.max(1, aspect);
      const vs = 0.1 + 0.9 * Math.min(1, aspect) * 0.0;
      U.uShadow.value.set(0, -0.9, uw * 1.25, 0.2);
      U.uShadowAmt.value = lerp(0.75, 0.9, 1 - env.dayFactor * 0.4) * (1 - 0.3 * cloudy);
      void vs;
    }

    // ================= 光照 =================
    updateLights(env);

    // ================= 雨 / 闪电 =================
    {
      const bright = clamp(0.25 + 0.75 * env.dayFactor + env.lightning * 0.5);
      rain.update(dt, env, bright, 1);
      bolt.update(env);
    }

    // ================= 雾 =================
    if (fog && cam) {
      const dist = cam.position.length();
      const m = clamp(0.03 + 0.05 * cloudy + 0.1 * env.rain, 0.02, 0.2);
      const near = Math.max(0.5, dist - 11);
      fog.near = near;
      fog.far = near + 22 / m;
      fog.color.copy(hor);
    }

    // ================= 曝光 =================
    if (ctx.renderer) {
      // 晴朗的白天整体更明亮通透（sunny：晴天≈0.76，阴天及以上为 0）
      // 白天整体提亮：晴天最亮；阴天光线柔和发灰但不能发黑（之前只提亮了晴天，晴转阴时像突然天黑）；下雨再暗一些
      const cl = clamp(cloudy * 1.6);
      const dayBoost = env.dayFactor * (0.42 * (1 - cl) + 0.34 * cl) * (1 - 0.4 * clamp(env.rain));
      const target = 1.0 + 0.1 * (1 - env.dayFactor) - 0.05 * cloudy - 0.04 * env.storm + 0.1 * env.lightning + dayBoost;
      exposure += (target - exposure) * Math.min(1, dt * 4);
      ctx.renderer.toneMappingExposure = exposure;
    }
  }

  function updateLights(env) {
    const day = env.dayFactor;
    const cloudy = env.cloudiness;
    const sunsetF = clamp(env.sunsetFactor);

    // 太阳：强度取决于仰角（太阳很低时渐弱，避免长阴影盖满整个岛）
    const eSun = env.sunDir.y;
    const sunK = smoothstep(-0.13, 0.1, eSun);
    const lowSun = 1 - smoothstep(0.05, 0.4, eSun);
    let sunI = 2.25 * sunK * (1 - 0.6 * cloudy) * (1 + 0.45 * lowSun);
    // 月亮
    const eMoon = env.moonDir.y;
    let moonI = 1.2 * smoothstep(-0.05, 0.3, eMoon) * (1 - smoothstep(0.1, 0.6, day)) * (1 - 0.45 * cloudy);
    const tot = sunI + moonI;
    const ws = tot > 1e-4 ? sunI / tot : 1;

    // 方向：把太阳压到不低于 ~0.2 的仰角，并保证从镜头侧前方来
    _v1.set(env.sunDir.x, clamp(env.sunDir.y, 0.36, 0.78), Math.max(env.sunDir.z, 0.38)).normalize();
    _v2.set(env.moonDir.x, clamp(env.moonDir.y, 0.3, 0.85), Math.max(env.moonDir.z, 0.35)).normalize();
    _v1.lerp(_v2, 1 - ws).normalize();
    sunLight.position.copy(_v1).multiplyScalar(40).add(sunLight.target.position);

    // 颜色
    _a.copy(COL.sunDay).lerp(COL.sunDusk, clamp(lowSun * 0.9 + sunsetF * 0.5));
    _a.lerp(COL.sunCool, clamp(cloudy * 0.6 + env.rain * 0.3));
    sunLight.color.copy(COL.moon).lerp(_a, ws);
    sunLight.color.lerp(COL.flash, env.lightning * 0.6);
    sunLight.intensity = (sunI + moonI) * (1 + env.lightning * 0.35);

    // 半球光 / 环境光
    hemi.color.copy(COL.hemiSkyNight).lerp(COL.hemiSkyDay, day);
    hemi.groundColor.copy(COL.hemiGrNight).lerp(COL.hemiGrDay, day);
    hemi.color.lerp(COL.hemiSkyDusk, sunsetF * 0.7);
    hemi.groundColor.lerp(COL.hemiGrDusk, sunsetF * 0.7);
    hemi.color.lerp(COL.hemiSkyOver, clamp(cloudy * 0.85));
    hemi.groundColor.lerp(COL.hemiGrOver, clamp(cloudy * 0.85));
    // 夜里仍要看得清：夜间环境光不低于白天的约 0.75 倍；雨天略暗
    const hi = lerp(1.15, 1.2, day) * (1 - 0.12 * cloudy - 0.1 * env.storm) * (1 + 0.2 * sunsetF) + day * (0.4 * (1 - clamp(cloudy * 1.6)) + 0.46 * clamp(cloudy * 1.6)) * (1 - 0.35 * clamp(env.rain)); // 晴天多给环境光，暗部（岛体侧面、草根）不发闷
    hemi.intensity = hi + env.lightning * 0.55;
  }

  return { group, update, sunLight };
}
