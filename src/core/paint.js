// 手绘质感材质工具（DESIGN 3.0）。所有模块的实体材质都应通过这里创建/加工，保证全场统一的“水粉画”观感：
//  - 固有色被噪声打散成一块块深浅/冷暖略有差异的笔触色斑（不再是均匀平涂）；
//  - 受光结果做带抖动边缘的柔和分色阶（像一笔亮部、一笔暗部），没有塑料感的连续渐变和高光。
// 用法：
//   import { paintMaterial, applyPaint, PAINT_NOISE_GLSL } from '../core/paint.js';
//   const mat = paintMaterial({ color: 0x7c9a4a, flatShading: true }, { scale: 1.4, strength: 0.25 });
//   applyPaint(existingMaterial, { space: 'local' });   // 给已有材质（可已带 onBeforeCompile）叠加手绘效果
// 选项：
//   scale    笔触色斑的密度（越大越碎），默认 1.5
//   strength 明度扰动幅度 0..1，默认 0.18
//   hue      冷暖色偏扰动幅度，默认 0.5
//   bands    受光分色阶的强度 0..1（0 = 不分阶），默认 0.3
//   levels   色阶数，默认 4
//   stretch  [x,y,z] 噪声各轴的频率倍数：某轴数值越大，色斑在该轴上越短（[1,6,1] = 水平方向的长笔触/木纹，[6,1,6] = 竖向笔触），默认 [1,1,1]
//   space    'world'（静态物体，默认）| 'local'（会移动/有动画的物体，如狗、昆虫、木棍，避免色斑在身上“游动”）
import * as THREE from 'three';

export const PAINT_NOISE_GLSL = /* glsl */ `
float pHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float pNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(pHash(i), pHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(pHash(i + vec3(0.0, 1.0, 0.0)), pHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(pHash(i + vec3(0.0, 0.0, 1.0)), pHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(pHash(i + vec3(0.0, 1.0, 1.0)), pHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
`;

let paintId = 0;

export function applyPaint(material, opts = {}) {
  const { scale = 1.5, strength = 0.18, hue = 0.5, bands = 0.3, levels = 4, stretch = [1, 1, 1], space = 'world' } = opts;
  // 幂等：同一材质重复加工只更新参数（否则着色器里会重复注入噪声函数导致编译失败）
  if (material.userData.paintUniforms) {
    const u = material.userData.paintUniforms;
    u.uPaintScale.value.set(scale * stretch[0], scale * stretch[1], scale * stretch[2]);
    u.uPaintParams.value.set(strength, hue, bands, levels);
    return material;
  }
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  const key = `paint${space === 'world' ? 'W' : 'L'}`;
  const uniforms = {
    uPaintScale: { value: new THREE.Vector3(scale * stretch[0], scale * stretch[1], scale * stretch[2]) },
    uPaintParams: { value: new THREE.Vector4(strength, hue, bands, levels) },
  };
  material.userData.paintUniforms = uniforms;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    shader.uniforms.uPaintScale = uniforms.uPaintScale;
    shader.uniforms.uPaintParams = uniforms.uPaintParams;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vPaintPos;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 paintP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            paintP = instanceMatrix * paintP;
          #endif
          ${space === 'world' ? 'paintP = modelMatrix * paintP;' : ''}
          vPaintPos = paintP.xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `varying vec3 vPaintPos;\nuniform vec3 uPaintScale;\nuniform vec4 uPaintParams;\n${PAINT_NOISE_GLSL}\nvoid main() {\n  float paintN = 0.5;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 pp = vPaintPos * uPaintScale;
          paintN = pNoise(pp) * 0.65 + pNoise(pp * 2.7 + 11.3) * 0.35;
          float blotch = smoothstep(0.28, 0.72, paintN);
          diffuseColor.rgb *= 1.0 + (blotch - 0.5) * 2.0 * uPaintParams.x;
          diffuseColor.rgb += (pNoise(pp * 0.55 + 4.7) - 0.5) * uPaintParams.y * vec3(0.10, 0.04, -0.08);
          diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.0));
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          float pl = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
          float q = max(floor(pl * uPaintParams.w + 0.5 + (paintN - 0.5) * 0.9), 0.6) / uPaintParams.w;
          outgoingLight *= mix(1.0, (q + 0.03) / (pl + 0.03), uPaintParams.z);
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `${prevKey}|${key}|${paintId}`;
  paintId += 0; // 相同 space 的材质共享同一份 program（uniform 各自独立）
  material.needsUpdate = true;
  return material;
}

/** 创建带手绘质感的无光泽标准材质。params 同 MeshStandardMaterial。 */
export function paintMaterial(params = {}, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, ...params });
  return applyPaint(mat, opts);
}
