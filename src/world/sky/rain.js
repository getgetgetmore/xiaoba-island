// 雨：GPU 动画的细长雨丝（一个 draw call）+ 地面水花涟漪（一个 draw call）。
import * as THREE from 'three';

const DROPS = 1800;
const SPLASHES = 280;

const RAIN_VERT = `
attribute vec4 aSeed;   // xyz: 0..1 随机位置  w: 密度阈值/随机量
attribute vec2 aCorner; // x: 左右(-1/1)  y: 头(0)/尾(1)
uniform float uTime; uniform float uWind; uniform float uDensity;
uniform float uLen; uniform float uWidth; uniform float uFall;
varying float vA;
void main(){
  float r1 = fract(aSeed.w * 7.13);
  float r2 = fract(aSeed.w * 3.71);
  float r3 = fract(aSeed.w * 11.3);
  float sp = 0.8 + 0.5 * r1;
  float H = 15.0;
  float p = fract(aSeed.y - uTime * uFall * sp / H);
  float vx = uWind * 3.2;
  float tf = H / (uFall * sp);
  vec3 vel = vec3(vx, -uFall * sp, 0.0);
  float x = (aSeed.x - 0.5) * 21.0 - vx * tf * (p - 0.5); // 雨集中下在小岛上（原先铺满整个画面，岛上反而稀疏）
  float y = -2.0 + p * H;
  float z = -9.5 + aSeed.z * 19.0;
  vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
  vec3 vv = normalize((modelViewMatrix * vec4(vel, 0.0)).xyz);
  float len = uLen * (0.7 + 0.6 * r2);
  vec3 pos = mv.xyz - vv * len * aCorner.y;
  vec3 side = normalize(cross(vv, vec3(0.0, 0.0, 1.0))) * uWidth * aCorner.x;
  pos += side * (1.0 - 0.7 * aCorner.y);
  gl_Position = projectionMatrix * vec4(pos, 1.0);
  float vis = clamp((uDensity - aSeed.w) * 12.0, 0.0, 1.0);
  vA = vis * (1.0 - aCorner.y * 0.9) * (0.45 + 0.55 * r3) * smoothstep(0.0, 0.07, p) * smoothstep(1.0, 0.93, p);
  // 落在岛面范围内的雨丝到地面就消失（不穿到岛体下面）
  vA *= mix(1.0, smoothstep(0.05, 0.6, y), step(length(vec2(x, z)), 7.4));
}`;
const RAIN_FRAG = `
uniform vec3 uColor; uniform float uAlpha;
varying float vA;
void main(){
  gl_FragColor = vec4(uColor, vA * uAlpha);
  #include <colorspace_fragment>
}`;

const SPL_VERT = `
attribute vec4 aSeed;   // x,z 位置  y 相位  w 阈值
attribute vec3 aBase;   // 中心点（含高度）
attribute vec2 aCorner;
uniform float uTime; uniform float uDensity;
varying vec2 vC; varying float vA;
void main(){
  float sp = 0.9 + 0.9 * fract(aSeed.w * 5.31);
  float ph = fract(uTime * sp * 0.55 + aSeed.y);
  float rad = 0.07 + ph * 0.42;
  vec3 pos = aBase + vec3(aCorner.x, 0.0, aCorner.y) * rad;
  vC = aCorner;
  float vis = clamp((uDensity - aSeed.w) * 10.0, 0.0, 1.0);
  vA = vis * (1.0 - ph) * smoothstep(0.0, 0.08, ph);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;
const SPL_FRAG = `
uniform vec3 uColor; uniform float uAlpha;
varying vec2 vC; varying float vA;
void main(){
  float r = length(vC);
  float ring = smoothstep(0.45, 0.72, r) * (1.0 - smoothstep(0.8, 1.0, r));
  gl_FragColor = vec4(uColor, ring * vA * uAlpha);
  #include <colorspace_fragment>
}`;

function quadIndex(n) {
  const idx = new Uint16Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = i * 4;
    idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  return idx;
}

export function createRain(ctx, rng) {
  const group = new THREE.Group();
  group.name = 'sky.rain';

  // ---- 雨丝 ----
  const seed = new Float32Array(DROPS * 4 * 4);
  const corner = new Float32Array(DROPS * 4 * 2);
  const pos = new Float32Array(DROPS * 4 * 3);
  for (let i = 0; i < DROPS; i++) {
    const sx = rng(), sy = rng(), sz = rng(), sw = (i + rng()) / DROPS; // 阈值均匀分布 → 密度线性
    for (let k = 0; k < 4; k++) {
      const j = (i * 4 + k) * 4;
      seed[j] = sx; seed[j + 1] = sy; seed[j + 2] = sz; seed[j + 3] = sw;
      corner[(i * 4 + k) * 2] = k % 2 === 0 ? -1 : 1;
      corner[(i * 4 + k) * 2 + 1] = k < 2 ? 0 : 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  geo.setIndex(new THREE.BufferAttribute(quadIndex(DROPS), 1));
  const rainU = {
    uTime: { value: 0 },
    uWind: { value: 0 },
    uDensity: { value: 0 },
    uLen: { value: 1.35 },
    uWidth: { value: 0.026 },
    uFall: { value: 14 },
    uColor: { value: new THREE.Color(0xcfe3ee) },
    uAlpha: { value: 0.5 },
  };
  const rain = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: rainU, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG,
    transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide,
  }));
  rain.name = 'sky.rain.drops';
  rain.frustumCulled = false;
  rain.renderOrder = 20;
  rain.visible = false;
  group.add(rain);

  // ---- 水花 ----
  const island = ctx.island;
  const sSeed = new Float32Array(SPLASHES * 4 * 4);
  const sBase = new Float32Array(SPLASHES * 4 * 3);
  const sCorner = new Float32Array(SPLASHES * 4 * 2);
  const sPos = new Float32Array(SPLASHES * 4 * 3);
  for (let i = 0; i < SPLASHES; i++) {
    let x = 0, z = 0, ok = false;
    for (let t = 0; t < 40 && !ok; t++) {
      const a = rng() * Math.PI * 2, r = 7.0 * Math.sqrt(rng());
      x = Math.cos(a) * r; z = Math.sin(a) * r;
      ok = true;
      try {
        if (island && island.obstacles) for (const o of island.obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + 0.15) { ok = false; break; }
        if (ok && island && island.isWalkable && !island.isWalkable(x, z)) ok = false;
      } catch (e) { ok = true; }
    }
    let y = 0.03;
    try { if (island && island.heightAt) y = island.heightAt(x, z) + 0.04; } catch (e) { /* 忽略 */ }
    if (!Number.isFinite(y)) y = 0.04;
    const ph = rng(), sw = (i + rng()) / SPLASHES;
    for (let k = 0; k < 4; k++) {
      const j = (i * 4 + k);
      sSeed[j * 4] = x; sSeed[j * 4 + 1] = ph; sSeed[j * 4 + 2] = z; sSeed[j * 4 + 3] = sw;
      sBase[j * 3] = x; sBase[j * 3 + 1] = y; sBase[j * 3 + 2] = z;
      sCorner[j * 2] = k % 2 === 0 ? -1 : 1;
      sCorner[j * 2 + 1] = k < 2 ? -1 : 1;
    }
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('aSeed', new THREE.BufferAttribute(sSeed, 4));
  sGeo.setAttribute('aBase', new THREE.BufferAttribute(sBase, 3));
  sGeo.setAttribute('aCorner', new THREE.BufferAttribute(sCorner, 2));
  sGeo.setIndex(new THREE.BufferAttribute(quadIndex(SPLASHES), 1));
  const splU = {
    uTime: { value: 0 },
    uDensity: { value: 0 },
    uColor: { value: new THREE.Color(0xe6f3f8) },
    uAlpha: { value: 0.55 },
  };
  const splash = new THREE.Mesh(sGeo, new THREE.ShaderMaterial({
    uniforms: splU, vertexShader: SPL_VERT, fragmentShader: SPL_FRAG,
    transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide,
  }));
  splash.name = 'sky.rain.splash';
  splash.frustumCulled = false;
  splash.renderOrder = 19;
  splash.visible = false;
  group.add(splash);

  let t = 0;
  const _col = new THREE.Color();
  function update(dt, env, bright, scaleAlpha = 1) {
    t += dt;
    const density = Math.pow(Math.max(env.rain, 0), 1.35);
    const on = density > 0.002;
    rain.visible = on;
    splash.visible = on;
    if (!on) return;
    rainU.uTime.value = t;
    rainU.uWind.value = env.wind;
    rainU.uDensity.value = density;
    splU.uTime.value = t;
    splU.uDensity.value = density;
    // 夜里雨丝不刺眼：随环境亮度
    const b = 0.38 + 0.62 * bright;
    rainU.uColor.value.setHex(0xcfe3ee).multiplyScalar(b);
    rainU.uAlpha.value = (0.6 + 0.15 * env.storm) * scaleAlpha;
    splU.uColor.value.setHex(0xe6f3f8).multiplyScalar(b);
    splU.uAlpha.value = 0.7 * scaleAlpha;
  }
  return { group, update };
}
