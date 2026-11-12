// 占位天空：渐变穹顶 + 一盏带阴影的平行光 + 半球光。接口对应 DESIGN.md 3.4。
import * as THREE from 'three';
import { palette } from '../core/palette.js';
import { clamp, lerp } from '../core/util.js';

const _a = new THREE.Color();
const _b = new THREE.Color();
const _c = new THREE.Color();

export function createSky(ctx) {
  const group = new THREE.Group();
  group.name = 'sky(stub)';

  // 渐变穹顶（ShaderMaterial，无需 Canvas）
  const uniforms = {
    topColor: { value: new THREE.Color(palette.sky.day.top) },
    midColor: { value: new THREE.Color(palette.sky.day.mid) },
    horizonColor: { value: new THREE.Color(palette.sky.day.horizon) },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 16),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 topColor; uniform vec3 midColor; uniform vec3 horizonColor; varying vec3 vP;',
        'void main(){ float h = clamp(vP.y, -0.2, 1.0);',
        '  vec3 c = mix(horizonColor, midColor, smoothstep(-0.1, 0.35, h));',
        '  c = mix(c, topColor, smoothstep(0.3, 0.9, h));',
        '  gl_FragColor = vec4(c, 1.0);',
        '  #include <colorspace_fragment>',
        '}',
      ].join('\n'),
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  const hemi = new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, 1.0);
  group.add(hemi);

  const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  const sc = sunLight.shadow.camera;
  sc.left = -11; sc.right = 11; sc.top = 11; sc.bottom = -11; sc.near = 1; sc.far = 80;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.03;
  group.add(sunLight);
  group.add(sunLight.target);

  const sunCol = new THREE.Color(0xfff1d6);
  const moonCol = new THREE.Color(palette.moonLight);

  function skyMix(env, key, out) {
    // 夜 → 昼 → 霞光 → 阴雨
    _a.setHex(palette.sky.night[key]);
    _b.setHex(palette.sky.day[key]);
    out.copy(_a).lerp(_b, env.dayFactor);
    _c.setHex(palette.sky.dusk[key]);
    out.lerp(_c, clamp(env.sunsetFactor) * 0.9);
    const gray = env.storm > 0.5 ? palette.sky.storm[key] : env.rain > 0.3 ? palette.sky.rain[key] : palette.sky.cloudy[key];
    _c.setHex(gray);
    _c.multiplyScalar(lerp(0.25, 1, env.dayFactor)); // 夜间阴天不要变亮
    out.lerp(_c, clamp(env.cloudiness * 0.9));
    return out;
  }

  function update(dt, env) {
    skyMix(env, 'top', uniforms.topColor.value);
    skyMix(env, 'mid', uniforms.midColor.value);
    skyMix(env, 'horizon', uniforms.horizonColor.value);
    if (ctx.camera) dome.position.copy(ctx.camera.position);

    const day = env.dayFactor;
    const dir = day > 0.15 ? env.sunDir : env.moonDir;
    const dimmer = 1 - 0.6 * env.cloudiness;
    sunLight.position.copy(dir).multiplyScalar(30);
    sunLight.intensity = lerp(0.5, 2.6, day) * dimmer * (1 + env.lightning * 0.5);
    sunLight.color.copy(moonCol).lerp(sunCol, day);
    hemi.intensity = lerp(0.55, 1.0, day) * (1 - 0.2 * env.cloudiness) + env.lightning * 0.8;
  }

  return { group, update, sunLight };
}
