// 手绘（水粉/油画）全屏后处理（WP8）。
// 管线：场景 → HalfFloat MSAA RenderTarget（存显示空间值） → 全屏 pass：
//   [低频抖动采样坐标] → 8 扇区广义 Kuwahara（显示/感知空间，扇区方向随低频噪声场旋转，带笔触方向感）
//   → 小细节保护（按与滤镜结果的局部差异回混原图）→ 笔触明暗 → 调色（降饱和、暗部偏青、亮部偏暖）
//   → 画布/纸纹 + 水渍 + 暗角。tone mapping(ACES, renderer.toneMappingExposure) 与 sRGB 编码由各材质在场景 pass 内完成（只做一次）。
// 用法：const fx = createPainterly(renderer, { width, height, pixelRatio }); fx.render(scene, camera);
import * as THREE from 'three';
import { PAINT_NOISE_GLSL } from '../core/paint.js';

export const DEFAULT_FX_PARAMS = {
  radius: 5.0, // Kuwahara 半径（CSS px，内部乘 pixelRatio）
  sharp: 28.0, // 扇区方差敏感度：越大越保边（越小越糊）
  warp: 1.2, // 采样坐标低频抖动幅度（CSS px，建议 ≤1.5）
  flow: 0.9, // 扇区方向随噪声场旋转的程度 0..1
  stroke: 0.07, // 笔触明暗条纹强度
  detail: 0.85, // 小细节保护强度 0..1
  saturation: 0.9, // 饱和度（1=不变）
  shadowTint: 0.5, // 暗部偏青强度
  highlightTint: 0.5, // 亮部偏暖强度
  grain: 0.075, // 画布/纸纹颗粒强度
  stain: 0.05, // 低频水渍明暗强度
  vignette: 0.1, // 暗角强度
};

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;     // 1 / RT 像素尺寸
uniform float uPR;       // pixelRatio
uniform float uRadius, uSharp, uWarp, uFlow, uStroke, uDetail;
uniform float uSat, uShadowTint, uHighTint, uGrain, uStain, uVignette;
uniform float uEdgeFade; // 0..1：透明模式下把靠近窗口边缘的内容渐隐，避免云/雨被窗口矩形硬切
varying vec2 vUv;

${PAINT_NOISE_GLSL}

float n2(vec2 p, float z) { return pNoise(vec3(p, z)); }
float lumOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// RT 内已是 tone mapping + sRGB 编码后的显示空间值，滤镜直接在感知空间工作
float pl(vec3 c) { return lumOf(c); }
// RT 里是预乘 alpha 的颜色（透明处 rgba 全 0）；滤镜对 rgba 一起做，边缘自然保持预乘一致
vec4 fetch(vec2 uv) { return texture2D(tDiffuse, uv); }

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 p = fc / uPR; // CSS 像素坐标：纹理尺度固定

  // 1) 低频抖动：让边缘有湿画法的轻微颤动
  vec2 wob = vec2(n2(p * 0.045, 1.7), n2(p * 0.045 + 31.0, 5.3)) - 0.5;
  vec2 uv0 = vUv + wob * 2.0 * uWarp * uPR * uTexel;

  // 2) 笔触方向场（低频），扇区整体旋转
  float fieldN = n2(p * 0.011, 9.1) * 0.65 + n2(p * 0.027 + 4.0, 2.2) * 0.35;
  float rot = (fieldN - 0.5) * 6.2831853 * uFlow;
  float R = uRadius * uPR;

  vec4 center = fetch(uv0);
  float Lc = pl(center.rgb) + center.a * 0.5; // 把透明度也计入“亮度”，让滤镜把透明/不透明的交界当作边缘保住

  vec4 A[8];   // rgb * w, (unused)
  vec3 B[8];   // ΣL w, ΣL² w, Σw
  for (int k = 0; k < 8; k++) { A[k] = center; B[k] = vec3(Lc, Lc * Lc, 1.0); }

  // 3 圈 x 16 角度 = 48 个采样，每个按三角权重分给相邻两个扇区
  for (int r = 0; r < 3; r++) {
    float fr = 0.3 + 0.35 * float(r);
    float rad = R * fr;
    float gw = exp(-fr * fr * 1.6);
    for (int a = 0; a < 16; a++) {
      float fa = float(a) + 0.5 * float(r);
      float th = fa * 0.3926991 + rot;
      vec2 off = vec2(cos(th), sin(th)) * rad * uTexel;
      vec4 c = fetch(uv0 + off);
      float L = pl(c.rgb) + c.a * 0.5;
      float f = fa * 0.5;
      int i0 = int(floor(f));
      float t = f - float(i0);
      i0 = i0 - (i0 / 8) * 8;
      int i1 = i0 == 7 ? 0 : i0 + 1;
      float w0 = gw * (1.0 - t), w1 = gw * t;
      A[i0] += c * w0; B[i0] += vec3(L, L * L, 1.0) * vec3(w0);
      A[i1] += c * w1; B[i1] += vec3(L, L * L, 1.0) * vec3(w1);
    }
  }
  // 修正：B 上面把 (L, L², 1) 整体乘了 w，三项分别是 ΣLw, ΣL²w, Σw —— 符合预期

  vec4 acc = vec4(0.0);
  float wacc = 0.0;
  for (int k = 0; k < 8; k++) {
    float W = B[k].z;
    vec4 m = A[k] / W;
    float Lm = B[k].x / W;
    float sig = sqrt(max(B[k].y / W - Lm * Lm, 0.0));
    float wt = 1.0 / (1.0 + pow(sig * uSharp + 1e-4, 6.0));
    acc += m * wt;
    wacc += wt;
  }
  vec4 col4 = acc / max(wacc, 1e-5);
  vec3 col = col4.rgb;
  float alpha = col4.a;

  // 3) 小细节保护：与滤镜结果差异大的小亮点/暗点/细线回混原图
  vec4 orig4 = fetch(vUv);
  vec3 orig = orig4.rgb;
  float dL = abs(pl(orig) - pl(col));
  float dC = length(orig - col);
  float keep = smoothstep(0.07, 0.2, max(dL, dC * 0.8)) * uDetail;
  col = mix(col, orig, keep);
  alpha = mix(alpha, orig4.a, keep);

  // 4) 笔触明暗：沿方向场拉伸的噪声条纹
  vec2 dir = vec2(cos(rot), sin(rot));
  vec2 perp = vec2(-dir.y, dir.x);
  float along = dot(p, dir), across = dot(p, perp);
  float st = n2(vec2(across * 0.55, along * 0.05), 6.6) * 0.6 + n2(vec2(across * 1.3, along * 0.12), 8.8) * 0.4;
  col *= 1.0 + (st - 0.5) * 2.0 * uStroke * (1.0 - keep * 0.8);

  // 5) 调色（显示空间）
  float lum = lumOf(col);
  col = mix(vec3(lum), col, uSat);
  float sw = 1.0 - smoothstep(0.0, 0.5, lum);
  float hw = smoothstep(0.5, 1.0, lum);
  col *= mix(vec3(1.0), vec3(0.93, 1.02, 1.05), sw * uShadowTint);
  col *= mix(vec3(1.0), vec3(1.04, 1.01, 0.95), hw * uHighTint);
  col = clamp(col, 0.0, 1.0);

  gl_FragColor = vec4(col, 1.0);

  // 6) 画布/纸纹 + 水渍 + 暗角（显示空间）
  vec2 pw = p + wob * 6.0;
  float weave = sin(pw.x * 1.9 + n2(p * 0.2, 3.0) * 2.0) * sin(pw.y * 1.9 + n2(p * 0.2, 4.0) * 2.0);
  float fib = n2(p * 0.85, 1.0) * 0.55 + n2(p * 1.9 + 7.0, 2.0) * 0.45;
  float grain = (fib - 0.5) * 1.5 + weave * 0.32;
  float stain = n2(p * 0.006, 11.0) * 0.6 + n2(p * 0.017 + 3.0, 12.0) * 0.4 - 0.5;
  float dl = lumOf(gl_FragColor.rgb);
  float g = grain * uGrain * (1.25 - 0.7 * dl) + stain * uStain * 2.0;
  gl_FragColor.rgb *= 1.0 + g;
  vec2 q = vUv - 0.5;
  gl_FragColor.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
  // 预乘 alpha 输出；透明模式下靠近窗口四边渐隐
  vec2 eb = min(vUv, 1.0 - vUv);
  float ef = mix(1.0, smoothstep(0.0, 0.07, min(eb.x, eb.y)), uEdgeFade);
  alpha = clamp(alpha, 0.0, 1.0) * ef;
  gl_FragColor = vec4(min(gl_FragColor.rgb * ef, vec3(alpha)), alpha);
}
`;

export function createPainterly(renderer, opts = {}) {
  const params = { ...DEFAULT_FX_PARAMS, ...(opts.params || {}) };
  const size = new THREE.Vector2(1, 1);
  let pixelRatio = opts.pixelRatio || renderer.getPixelRatio() || 1;
  let cssW = opts.width || 1, cssH = opts.height || 1;

  const ext = renderer.extensions;
  const hdr = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    samples: 4,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });

  // 色彩管线：three r170 对 RenderTarget 默认不做 tone mapping，也只输出线性。其场景里有大量 toneMapped:false 的
  // 天空/云/雨材质（它们按“直出 sRGB”调色，不走 ACES），若在后处理里统一 tone map 会与 fx=0 不一致。
  // 因此借用 isXRRenderTarget 开关，让 RT 的行为与默认帧缓冲完全一致：每个材质按自己的 toneMapped 设置在
  // 着色器里完成 ACES（含 toneMappingExposure）+ sRGB 编码；RT 里存的就是最终显示值，后处理 pass 不再变换色彩。
  rt.isXRRenderTarget = true;
  rt.texture.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: rt.texture },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uPR: { value: 1 },
      uRadius: { value: 4 }, uSharp: { value: 28 }, uWarp: { value: 1 }, uFlow: { value: 1 }, uStroke: { value: 0 }, uDetail: { value: 1 },
      uSat: { value: 1 }, uShadowTint: { value: 0 }, uHighTint: { value: 0 }, uGrain: { value: 0 }, uStain: { value: 0 }, uVignette: { value: 0 }, uEdgeFade: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false, // tone mapping + sRGB 已在场景 pass 内完成（见 rt.isXRRenderTarget 说明）
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  const fsScene = new THREE.Scene();
  fsScene.add(quad);
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const fx = {
    params,
    enabled: opts.enabled !== false,
    /** 最近一次“场景 pass”的统计（不含全屏 pass） */
    stats: { calls: 0, triangles: 0 },
    rt,
    setEnabled(v) { fx.enabled = !!v; },
    setSize(w, h, pr) {
      cssW = Math.max(1, w); cssH = Math.max(1, h);
      if (pr) pixelRatio = pr;
      size.set(Math.max(1, Math.round(cssW * pixelRatio)), Math.max(1, Math.round(cssH * pixelRatio)));
      rt.setSize(size.x, size.y);
    },
    render(scene, camera) {
      if (!fx.enabled) {
        renderer.render(scene, camera);
        const r = renderer.info.render;
        fx.stats.calls = r.calls; fx.stats.triangles = r.triangles;
        return;
      }
      // 以 drawing buffer 实际尺寸为准，防外部改尺寸后不同步
      const db = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (db.x !== size.x || db.y !== size.y) {
        size.copy(db);
        rt.setSize(size.x, size.y);
        pixelRatio = renderer.getPixelRatio();
      }
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, camera);
      const r = renderer.info.render;
      fx.stats.calls = r.calls; fx.stats.triangles = r.triangles;
      renderer.setRenderTarget(null);

      const u = mat.uniforms;
      u.uTexel.value.set(1 / size.x, 1 / size.y);
      u.uPR.value = pixelRatio;
      u.uRadius.value = params.radius; u.uSharp.value = params.sharp; u.uWarp.value = params.warp; u.uFlow.value = params.flow;
      u.uStroke.value = params.stroke; u.uDetail.value = params.detail; u.uSat.value = params.saturation;
      u.uShadowTint.value = params.shadowTint; u.uHighTint.value = params.highlightTint;
      u.uGrain.value = params.grain; u.uStain.value = params.stain; u.uVignette.value = params.vignette;
      u.uEdgeFade.value = params.edgeFade || 0;
      renderer.render(fsScene, fsCam);
    },
    dispose() { rt.dispose(); mat.dispose(); geo.dispose(); },
  };
  fx.setSize(cssW, cssH, pixelRatio);
  return fx;
}

export default createPainterly;
