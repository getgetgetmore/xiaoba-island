// 像素化渲染：先把场景画到低分辨率渲染目标（内部高度约 216–270 像素，宽度按画面比例），
// 再用最近邻放大铺满画布——边缘是清晰的像素格，阴影也是硬边。
// 第二版加了 1 像素描边：放大那一步的着色器读深度，凡是“旁边有更近的物体”的像素，
// 就把自己的颜色压暗并偏向蓝紫（不是纯黑），于是物体 / 角色的轮廓外面描上一圈比本色更深的线。
//
// 用法：const px = createPixelPass(renderer, { height: 216, outline: true });
//        px.render(scene, camera);
//  - outline：true（默认）| false | { depth, dark, tint, crease }
//      depth  深度差阈值（世界单位，默认 0.03；正交相机下再自动加 1.3 个像素的世界尺寸，避免斜坡上出线；越小线越多）
//      dark   描边颜色 = 本色 × dark（默认 0.1，深色实线）
//      tint   向蓝紫偏的程度 0..1（默认 0.75）
//      crease 折痕描边强度 0..1（默认 0，开了会把体素棱角也描出来）
//    可随时 px.setOutline(...) 修改。
//  - 防抖（正交相机）：每帧把镜头沿画面的左右 / 上下方向对齐到像素格的整数倍再画，所以镜头平移时静止的东西落在同样的像素上、
//    边缘和描边不会一帧一个样；对齐掉的那一点零头在放大时按亚像素补回来（渲染目标四周多画 1 格），平移仍然顺滑。
//    相机本身不会被改动（画完就还原），界面上按相机算的屏幕坐标不受影响。
//  - ss：超采样倍数（默认 1）。大于 1 时内部按 ss 倍分辨率画，再按格取平均（颜色）/ 取最近（深度）缩回像素格，转视角时闪得轻一些。
//  - 画布尺寸变化时自动重建渲染目标（也可以手动 px.setSize(画布宽, 画布高)）。
//  - 渲染目标不做色调映射 / sRGB 编码，由放大这一步统一编码，颜色与普通渲染一致。
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uView;  // 画面上的像素格数
uniform vec2 uOff;   // 镜头对齐像素格时挪掉的零头（单位：格）
uniform int uSS;     // 超采样倍数
uniform float uNear, uFar, uOrtho;
uniform float uThr, uDark, uTint, uCrease, uOn, uPix, uSlope;
varying vec2 vUv;
float lin(float d) {
  if (uOrtho > 0.5) return uNear + d * (uFar - uNear);
  return (uNear * uFar) / (uFar - d * (uFar - uNear));
}
// p：带一圈边的像素格坐标（0 .. uView + 1）
float depthAt(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(uView) + 1);
  if (uSS <= 1) return lin(texelFetch(tDepth, p, 0).r);
  float d = 1.0;
  for (int j = 0; j < 4; j++) { if (j >= uSS) break; for (int i = 0; i < 4; i++) { if (i >= uSS) break; d = min(d, texelFetch(tDepth, p * uSS + ivec2(i, j), 0).r); } }
  return lin(d);
}
// 这一格是不是“半透明的树”留下的像素（卡通材质把它的 alpha 写成了 0.5）
bool seeAt(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(uView) + 1);
  return texelFetch(tColor, p * max(uSS, 1), 0).a < 0.75;
}
vec3 colorAt(ivec2 p) {
  if (uSS <= 1) return texelFetch(tColor, p, 0).rgb;
  vec3 s = vec3(0.0);
  for (int j = 0; j < 4; j++) { if (j >= uSS) break; for (int i = 0; i < 4; i++) { if (i >= uSS) break; s += texelFetch(tColor, p * uSS + ivec2(i, j), 0).rgb; } }
  return s / float(uSS * uSS);
}
void main() {
  ivec2 p = ivec2(floor(vUv * uView - uOff)) + 1;
  p = clamp(p, ivec2(0), ivec2(uView) + 1);
  vec3 col = colorAt(p);
  if (uOn > 0.5) {
    float dc = depthAt(p);
    float thr = uOrtho > 0.5 ? uThr + 1.3 * uPix : uThr * max(dc, 1.0) / 20.0;
    // 上下相邻的两格：平地上本来就差 uPix / tan(俯角) 的深度，视线放得越平差得越多——阈值跟着俯角走，否则整片地面都会被当成边
    float thrV = uOrtho > 0.5 ? uThr + max(1.3, uSlope + 0.25) * uPix : thr;
    float dl = depthAt(p + ivec2(-1, 0)), dr = depthAt(p + ivec2(1, 0));
    float du = depthAt(p + ivec2(0, 1)), dd = depthAt(p + ivec2(0, -1));
    float edge = 0.0;
    // 旁边更近的那一格如果是半透明的树，不算边（否则树后面透出来的东西全被描黑）
    if ((dc - dl > thr && !seeAt(p + ivec2(-1, 0))) || (dc - dr > thr && !seeAt(p + ivec2(1, 0))) ||
        (dc - du > thrV && !seeAt(p + ivec2(0, 1))) || (dc - dd > thrV && !seeAt(p + ivec2(0, -1)))) edge = 1.0;
    // 折痕：深度的二阶差分（平面上为 0，棱角处不为 0）
    float cr = max(abs(dl + dr - 2.0 * dc), abs(du + dd - 2.0 * dc));
    if (uCrease > 0.0 && cr > thr * 0.6 && cr < thr * 3.0) edge = max(edge, uCrease);
    if (edge > 0.0) {
      vec3 dark = col * uDark;
      vec3 tint = vec3(0.012, 0.006, 0.035);
      dark = mix(dark, tint, uTint);
      col = mix(col, dark, min(edge, 1.0));
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function createPixelPass(renderer, opts = {}) {
  const height = Math.max(8, Math.round(opts.height || 216));
  const ss = Math.max(1, Math.min(4, Math.round(opts.ss || 1)));
  const blitScene = new THREE.Scene();
  const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blitMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      tColor: { value: null }, tDepth: { value: null }, uView: { value: new THREE.Vector2(1, 1) }, uOff: { value: new THREE.Vector2(0, 0) }, uSS: { value: ss },
      uNear: { value: 0.1 }, uFar: { value: 100 }, uOrtho: { value: 0 },
      uThr: { value: 0.03 }, uDark: { value: 0.1 }, uTint: { value: 0.75 }, uCrease: { value: 0 }, uOn: { value: 1 }, uPix: { value: 0.04 }, uSlope: { value: 1.1 },
    },
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
  quad.frustumCulled = false;
  blitScene.add(quad);

  function setOutline(o) {
    const u = blitMat.uniforms;
    if (o === false) { u.uOn.value = 0; return; }
    u.uOn.value = 1;
    if (o && typeof o === 'object') {
      if (o.depth !== undefined) u.uThr.value = o.depth;
      if (o.dark !== undefined) u.uDark.value = o.dark;
      if (o.tint !== undefined) u.uTint.value = o.tint;
      if (o.crease !== undefined) u.uCrease.value = o.crease;
    }
  }
  setOutline(opts.outline === undefined ? true : opts.outline);

  let rt = null, rw = 0, rh = 0, cw = 0, ch = 0;
  const tmp = new THREE.Vector2();

  function setSize(canvasW, canvasH) {
    cw = Math.max(1, Math.round(canvasW)); ch = Math.max(1, Math.round(canvasH));
    rh = height;
    rw = Math.max(1, Math.round(height * cw / ch));
    if (rt) { if (rt.depthTexture) rt.depthTexture.dispose(); rt.dispose(); }
    rt = new THREE.WebGLRenderTarget((rw + 2) * ss, (rh + 2) * ss, { // 四周各多 1 格，给亚像素偏移用
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType, // 线性空间存色，避免暗部色阶断裂
      depthBuffer: true,
      samples: 0, // 不做多重采样：边缘保持硬像素
      generateMipmaps: false,
    });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    rt.depthTexture = new THREE.DepthTexture((rw + 2) * ss, (rh + 2) * ss);
    rt.depthTexture.minFilter = THREE.NearestFilter;
    rt.depthTexture.magFilter = THREE.NearestFilter;
    blitMat.uniforms.tColor.value = rt.texture;
    blitMat.uniforms.tDepth.value = rt.depthTexture;
    blitMat.uniforms.uView.value.set(rw, rh);
  }

  function render(scene, camera) {
    renderer.getDrawingBufferSize(tmp);
    if (!rt || tmp.x !== cw || tmp.y !== ch) setSize(tmp.x, tmp.y);
    const u = blitMat.uniforms;
    u.uNear.value = camera.near; u.uFar.value = camera.far; u.uOrtho.value = camera.isOrthographicCamera ? 1 : 0;
    if (camera.isOrthographicCamera) u.uPix.value = (camera.top - camera.bottom) / camera.zoom / rh;
    // 镜头对齐像素格 + 取景范围四周各放大 1 格；画完还原
    let saved = null; u.uOff.value.set(0, 0);
    if (camera.isOrthographicCamera && !camera.parent) {
      camera.updateMatrixWorld();
      const e = camera.matrixWorld.elements, z = camera.zoom || 1, pos = camera.position;
      // 视线和地面的夹角：e[9] 是相机 +Z 轴（朝后）的 y 分量 = sin(俯角)
      const sp = Math.min(0.999, Math.max(0.05, Math.abs(e[9]))); u.uSlope.value = Math.sqrt(1 - sp * sp) / sp;
      const tw = (camera.right - camera.left) / z / rw, th = (camera.top - camera.bottom) / z / rh;
      const cx = pos.x * e[0] + pos.y * e[1] + pos.z * e[2], cy = pos.x * e[4] + pos.y * e[5] + pos.z * e[6];
      const dx = Math.round(cx / tw) * tw - cx, dy = Math.round(cy / th) * th - cy;
      if (opts.onSnap) opts.onSnap(Math.round(cx / tw), Math.round(cy / th)); // 镜头落在第几格：要跟着世界走的屏幕图案（抖动）用
      saved = { x: pos.x, y: pos.y, z: pos.z, l: camera.left, r: camera.right, t: camera.top, b: camera.bottom };
      pos.set(pos.x + e[0] * dx + e[4] * dy, pos.y + e[1] * dx + e[5] * dy, pos.z + e[2] * dx + e[6] * dy);
      camera.left -= tw * z; camera.right += tw * z; camera.top += th * z; camera.bottom -= th * z;
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      u.uOff.value.set(dx / tw, dy / th);
    }
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    if (saved) {
      camera.position.set(saved.x, saved.y, saved.z);
      camera.left = saved.l; camera.right = saved.r; camera.top = saved.t; camera.bottom = saved.b;
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    }
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(blitScene, blitCam);
    renderer.setRenderTarget(prev);
  }

  function dispose() {
    if (rt) { if (rt.depthTexture) rt.depthTexture.dispose(); rt.dispose(); }
    rt = null;
    quad.geometry.dispose();
    blitMat.dispose();
  }

  return { render, setSize, setOutline, dispose, get width() { return rw; }, get height() { return rh; } };
}
