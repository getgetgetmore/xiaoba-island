// 可移动的狗垫：扁椭圆垫芯 + 一圈略高的软边，暖色格子。局部坐标：y 向上，长轴沿 z（+z 端是被狗叼起的一头），原点在垫子中心、底面略低于 y=0。
// 位置/朝向/倾斜由行为模块每帧控制；这里只负责造型和一个 1 draw call 的 Mesh。
import * as THREE from 'three';
import { paintMaterial } from '../../core/paint.js';
import { GeoBuilder, jitterGeo, mixHex } from './geo.js';

export const MAT_HALF_X = 0.56; // 外沿半宽（宽 1.12，比狗窝门洞 1.25 窄，拖得出去）
export const MAT_HALF_Z = 0.9;  // 外沿半长（长 1.8：放大后的狗趴下身长约 1.56，整只都在垫沿以内）
export const MAT_LIFT = 0.03;   // 垫子对象的 y = 地面高度 + MAT_LIFT

const CREAM = 0xe2cfa2, CREAM_D = 0xcdb888, RUST = 0xc4683a, TEAL = 0x57908c, RIM = 0xb5532a, RIM2 = 0xc9783a, RIM3 = 0xa6492a;

export function buildMat() {
  const b = new GeoBuilder({ seed: 41, jitter: 0.035, aoK: 0 });
  const A = MAT_HALF_X, Bz = MAT_HALF_Z;
  // 垫芯：扁椭圆。顶面用同心环细分（逐面着色才能画出格子，而不是一块块扇形），图案关于中心 180° 对称，所以翻转 180° 看不出区别
  const sc = [A - 0.05, 1, Bz - 0.05];
  const side = new THREE.CylinderGeometry(1, 1, 0.055, 28, 1, true);
  jitterGeo(side, 0.004, 3);
  b.add(side, { pos: [0, 0.0175, 0], scale: sc, color: RIM3, ao: false });
  const top = new THREE.RingGeometry(0.02, 1, 28, 8);
  top.rotateX(-Math.PI / 2);
  b.add(top, {
    pos: [0, 0.045, 0], scale: sc,
    color: (nx, ny, nz, cx, cy, cz) => {
      const sx = Math.cos((cx / 0.22) * Math.PI * 2), sz = Math.cos((cz / 0.22) * Math.PI * 2);
      let c = CREAM;
      if (sx > 0.55) c = mixHex(c, RUST, 0.85);
      if (sz > 0.55) c = mixHex(c, TEAL, sx > 0.55 ? 0.45 : 0.75);
      else if (sx <= 0.55 && Math.cos((cz / 0.11) * Math.PI * 2) > 0.85) c = CREAM_D;
      return c;
    },
    ao: false, jitter: 0.02,
  });
  // 软边：一圈圆鼓鼓的小垫块（偶数个、颜色交替，同样关于中心对称）
  const N = 30;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rx = A - 0.085, rz = Bz - 0.085;
    const px = Math.sin(a) * rx, pz = Math.cos(a) * rz;
    // 沿椭圆切线方向略拉长，相邻的块互相叠住
    const tx = Math.cos(a) * rx, tz = -Math.sin(a) * rz;
    const ang = Math.atan2(tx, tz);
    const g = new THREE.IcosahedronGeometry(1, 1);
    jitterGeo(g, 0.06, i);
    b.add(g, {
      pos: [px, 0.036 + (i % 2 ? 0.008 : 0), pz], rot: [0, ang, 0], scale: [0.105, 0.064, 0.14],
      color: (nx, ny) => mixHex(i % 2 ? RIM : RIM2, i % 3 === 0 ? RIM3 : CREAM, ny > 0.55 ? 0.06 : 0.0),
      ao: false,
    });
  }
  return b.build();
}

export function createMatObject() {
  const mat = paintMaterial({ vertexColors: true, roughness: 1 }, { space: 'local', scale: 5, strength: 0.2, hue: 0.45, bands: 0.2, levels: 4 });
  const mesh = new THREE.Mesh(buildMat(), mat);
  mesh.name = 'dogMat';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.rotation.order = 'YXZ'; // 先偏航，再绕本地 x 轴抬起 +z 端
  return mesh;
}
