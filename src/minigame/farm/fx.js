// 农场的小特效：一批会弹起、落下、变小消失的小圆粒（一个 InstancedMesh，不分配对象）。
// createFarmFx(scene, material) → { burst(kind, x, y, z, n), update(dt), clear(), group }
//   kind：dust 尘土 | dirt 泥块 | feather 羽毛 | water 水花 | petal 花瓣 | hay 干草 | milk 牛奶 | mud 泥点 | leaf 叶子 | wood 木屑 | star 星星（撞晕）
import * as THREE from 'three';

const KINDS = {
  dust: { colors: [0xe8d2a0, 0xd9bd84], up: 1.6, spread: 1.6, g: 3, life: 0.5, size: 0.11 },
  dirt: { colors: [0x8a5a34, 0x6d4526, 0xa9733f], up: 3.4, spread: 1.8, g: 11, life: 0.7, size: 0.1 },
  feather: { colors: [0xffffff, 0xfff2c0, 0xffd84a], up: 2.6, spread: 2.2, g: 2.2, life: 1.1, size: 0.1 },
  water: { colors: [0x8fd3f4, 0xc9ecff, 0x5fb4e6], up: 4.2, spread: 2.0, g: 12, life: 0.7, size: 0.1 },
  petal: { colors: [0xf7a6c8, 0xffd84a, 0xb38cf0, 0xffffff], up: 2.4, spread: 2.0, g: 4, life: 0.9, size: 0.08 },
  hay: { colors: [0xf0cf6a, 0xd9ae45], up: 3.2, spread: 2.4, g: 7, life: 0.9, size: 0.1 },
  milk: { colors: [0xffffff, 0xf2f2ea], up: 3.0, spread: 1.8, g: 11, life: 0.6, size: 0.1 },
  mud: { colors: [0x6b4a2c, 0x54381f], up: 3.0, spread: 1.8, g: 11, life: 0.6, size: 0.1 },
  leaf: { colors: [0x4fae3c, 0x73c94a, 0x2f8431], up: 2.2, spread: 1.6, g: 4, life: 0.8, size: 0.09 },
  wood: { colors: [0xd9a866, 0xb5803f], up: 3.4, spread: 2.2, g: 11, life: 0.7, size: 0.1 },
  star: { colors: [0xffe36a, 0xfff6c0], up: 2.0, spread: 1.4, g: 1, life: 0.8, size: 0.1 },
};
const MAX = 220;

export function createFarmFx(scene, material) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = material || new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.name = 'farmFx';
  const P = new Float32Array(MAX * 8); // x y z vx vy vz age life
  const G = new Float32Array(MAX * 2); // 重力、大小
  const col = new THREE.Color(), m4 = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let next = 0, seed = 1234567;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < MAX; i++) { P[i * 8 + 7] = 0; m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); mesh.setColorAt(i, col.set(0xffffff)); }
  scene.add(mesh);

  function burst(kind, x, y, z, n = 8) {
    const K = KINDS[kind] || KINDS.dust;
    for (let k = 0; k < n; k++) {
      const i = next; next = (next + 1) % MAX;
      const a = rnd() * Math.PI * 2, r = K.spread * (0.3 + 0.7 * rnd());
      P[i * 8] = x + Math.cos(a) * 0.12; P[i * 8 + 1] = y + 0.1 + rnd() * 0.2; P[i * 8 + 2] = z + Math.sin(a) * 0.12;
      P[i * 8 + 3] = Math.cos(a) * r; P[i * 8 + 4] = K.up * (0.6 + 0.6 * rnd()); P[i * 8 + 5] = Math.sin(a) * r;
      P[i * 8 + 6] = 0; P[i * 8 + 7] = K.life * (0.7 + 0.5 * rnd());
      G[i * 2] = K.g; G[i * 2 + 1] = K.size * (0.7 + 0.6 * rnd());
      mesh.setColorAt(i, col.set(K.colors[(rnd() * K.colors.length) | 0]));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  function update(dt) {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const life = P[i * 8 + 7];
      if (life <= 0) continue;
      any = true;
      let age = P[i * 8 + 6] + dt;
      if (age >= life) { P[i * 8 + 7] = 0; m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); continue; }
      P[i * 8 + 6] = age;
      P[i * 8 + 4] -= G[i * 2] * dt;
      P[i * 8] += P[i * 8 + 3] * dt; P[i * 8 + 1] += P[i * 8 + 4] * dt; P[i * 8 + 2] += P[i * 8 + 5] * dt;
      if (P[i * 8 + 1] < 0.04) { P[i * 8 + 1] = 0.04; P[i * 8 + 4] *= -0.3; P[i * 8 + 3] *= 0.6; P[i * 8 + 5] *= 0.6; }
      const u = age / life, sz = G[i * 2 + 1] * (u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3);
      m4.compose(v.set(P[i * 8], P[i * 8 + 1], P[i * 8 + 2]), q, s.set(sz, sz, sz));
      mesh.setMatrixAt(i, m4);
    }
    if (any) mesh.instanceMatrix.needsUpdate = true;
  }
  function clear() { for (let i = 0; i < MAX; i++) { P[i * 8 + 7] = 0; m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); } mesh.instanceMatrix.needsUpdate = true; }
  return { burst, update, clear, group: mesh };
}

export default createFarmFx;
