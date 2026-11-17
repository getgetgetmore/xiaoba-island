// 农场灯光：createFarmLighting(scene) → { setPhase(phase, k), update(dt), follow(x, z, half), sun, hemi, glowMaterial, phase }
// 四个时段预设：dawn | day | dusk | night。每个预设 = 太阳（月亮）的方向和颜色 + 天光 + 背景色 + 夜里窗户 / 路灯的暖光。
// 夜里的光不用点光源：窗玻璃和灯泡是单独合并的一块“自发光”网格（map.js 生成），它的 MeshBasicMaterial 颜色由这里按时段改——
// 白天是淡淡的玻璃色，夜里是暖黄色，所以场景里的真实光源始终只有 2 个（半球光 + 平行光）。
// setPhase(phase, k)：k ∈ [0,1]，一次性应用的比例（1 = 立刻切换，默认；小于 1 时先走一部分，剩下的由 update(dt) 慢慢过渡）。
import * as THREE from 'three';

/** 窗玻璃 / 路灯灯泡共用的发光材质（顶点色全是白的，颜色由 material.color 决定）。 */
export const farmGlowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xbfd8ec });

export const FARM_LIGHT_PRESETS = {
  day: { sunColor: 0xfff0cc, sun: 2.6, dir: [-22, 36, 18], hemiSky: 0xcfe0ff, hemiGround: 0xb8a888, hemi: 1.7, bg: 0x1a5a52, glow: 0xbfd8ec },
  dawn: { sunColor: 0xffb98a, sun: 2.2, dir: [34, 13, 18], hemiSky: 0xffd8c8, hemiGround: 0x9a8a9a, hemi: 1.45, bg: 0x4a6a78, glow: 0xffe0a8 },
  dusk: { sunColor: 0xff8a50, sun: 2.0, dir: [-34, 12, 14], hemiSky: 0xd8a0c0, hemiGround: 0x7a6a80, hemi: 1.25, bg: 0x2c3a58, glow: 0xffd070 },
  night: { sunColor: 0x8aa6ff, sun: 0.95, dir: [-14, 32, 12], hemiSky: 0x7a8ac8, hemiGround: 0x34405e, hemi: 1.1, bg: 0x0a1226, glow: 0xffd27a },
};

export function createFarmLighting(scene) {
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0xb8a888, 1.7);
  const sun = new THREE.DirectionalLight(0xfff0cc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -16; sc.right = sc.top = 16; sc.near = 1; sc.far = 160;
  scene.add(hemi, sun, sun.target);
  if (!scene.background || !scene.background.isColor) scene.background = new THREE.Color(0x1a5a52);

  // 当前值和目标值
  const mk = (p) => ({
    sunColor: new THREE.Color(p.sunColor), sun: p.sun, dir: new THREE.Vector3(...p.dir),
    hemiSky: new THREE.Color(p.hemiSky), hemiGround: new THREE.Color(p.hemiGround), hemi: p.hemi,
    bg: new THREE.Color(p.bg), glow: new THREE.Color(p.glow),
  });
  const cur = mk(FARM_LIGHT_PRESETS.day), tgt = mk(FARM_LIGHT_PRESETS.day);
  const api = { sun, hemi, glowMaterial: farmGlowMaterial, phase: 'day', _tx: 0, _tz: 0, _half: 16 };
  const UP = new THREE.Vector3(0, 1, 0), vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3(), vt = new THREE.Vector3();

  function apply() {
    sun.color.copy(cur.sunColor); sun.intensity = cur.sun;
    hemi.color.copy(cur.hemiSky); hemi.groundColor.copy(cur.hemiGround); hemi.intensity = cur.hemi;
    scene.background.copy(cur.bg);
    farmGlowMaterial.color.copy(cur.glow);
    // 阴影对准的位置按阴影贴图的格子取整（沿光照相机的左右 / 上下方向）：镜头走到哪儿，影子的边缘都落在同样的格子上，不会跟着抖
    vz.copy(cur.dir).normalize(); vx.crossVectors(UP, vz).normalize(); vy.crossVectors(vz, vx);
    const tex = (2 * api._half) / sun.shadow.mapSize.x;
    vt.set(api._tx, 0, api._tz);
    const a = vt.dot(vx), b = vt.dot(vy);
    vt.addScaledVector(vx, Math.round(a / tex) * tex - a).addScaledVector(vy, Math.round(b / tex) * tex - b);
    sun.position.copy(vt).add(cur.dir);
    sun.target.position.copy(vt);
    sun.target.updateMatrixWorld();
  }
  function blend(k) {
    cur.sunColor.lerp(tgt.sunColor, k); cur.sun += (tgt.sun - cur.sun) * k; cur.dir.lerp(tgt.dir, k);
    cur.hemiSky.lerp(tgt.hemiSky, k); cur.hemiGround.lerp(tgt.hemiGround, k); cur.hemi += (tgt.hemi - cur.hemi) * k;
    cur.bg.lerp(tgt.bg, k); cur.glow.lerp(tgt.glow, k);
  }
  api.setPhase = (phase, k = 1) => {
    const p = FARM_LIGHT_PRESETS[phase];
    if (!p) throw new Error('未知的时段：' + phase);
    api.phase = phase;
    const t = mk(p);
    Object.assign(tgt, t);
    blend(Math.max(0, Math.min(1, k)));
    apply();
  };
  api.update = (dt) => { blend(1 - Math.exp(-dt * 2.5)); apply(); };
  /** 让太阳（和阴影范围）跟着镜头目标走；half = 阴影相机覆盖的半宽（世界单位）。 */
  // 范围按 4 个单位一档取整（缩放时不会每帧都变）；位置在 apply() 里按阴影贴图的格子取整。
  api.follow = (x, z, half = 16) => {
    const h = Math.ceil((half + 2.5) / 4) * 4;
    api._tx = x; api._tz = z;
    if (h !== api._half) { api._half = h; sc.left = sc.bottom = -h; sc.right = sc.top = h; sc.updateProjectionMatrix(); }
    apply();
  };
  apply();
  return api;
}
