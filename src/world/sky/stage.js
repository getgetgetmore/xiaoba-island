// 舞台：一个跟随相机位置与朝向的 Group。日月星云闪电都挂在它下面，
// 用“屏幕归一化坐标 (u,v ∈ [-1,1])”定位，保证任何窗口宽高比下都在画面内。
import * as THREE from 'three';

export function createStage(ctx) {
  const group = new THREE.Group();
  group.name = 'sky.stage';
  const uTanH = { value: 0.3 };
  const uTanV = { value: 0.3 };
  const stage = {
    group,
    tanH: 0.3,
    tanV: 0.3,
    aspect: 1,
    uTanH,
    uTanV,
    /** NDC (u,v) + 深度 d → 舞台本地坐标（相机朝 -Z） */
    pos(u, v, d, out) {
      return out.set(u * stage.tanH * d, v * stage.tanV * d, -d);
    },
    /** 以“画面高度的比例”表示的尺寸 → 世界尺寸 */
    size(h, d) {
      return h * stage.tanV * d;
    },
    sync(camera) {
      if (!camera) return;
      stage.aspect = camera.aspect || 1;
      stage.tanV = Math.tan(((camera.fov || 32) * Math.PI) / 360);
      stage.tanH = stage.tanV * stage.aspect;
      uTanH.value = stage.tanH;
      uTanV.value = stage.tanV;
      group.position.copy(camera.position);
      group.quaternion.copy(camera.quaternion);
    },
  };

  // 渲染前再同步一次（main 在 step 末尾才移动相机，避免天空滞后一帧）
  if (ctx.scene) {
    const prev = ctx.scene.onBeforeRender;
    ctx.scene.onBeforeRender = function (renderer, scene, camera, ...rest) {
      stage.sync(camera);
      return prev.call(this, renderer, scene, camera, ...rest);
    };
  }
  return stage;
}
