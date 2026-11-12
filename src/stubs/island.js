// 占位小岛：扁圆盘 + 方盒狗窝 + 圆锥树 + 池塘。接口完整对应 DESIGN.md 3.3。
import * as THREE from 'three';
import { palette } from '../core/palette.js';

const RADIUS = 8;
const KENNEL = { x: -3.6, z: -2.6 };
const KDIR = { x: Math.SQRT1_2, z: Math.SQRT1_2 }; // 门朝右前方

export function createIsland(ctx) {
  const group = new THREE.Group();
  group.name = 'island(stub)';

  const mat = (c, extra) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true, ...extra });
  const mesh = (geo, m, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    group.add(o);
    return o;
  };

  // 顶面草地 + 下方收拢的岩石
  const top = mesh(new THREE.CylinderGeometry(RADIUS, RADIUS - 0.6, 0.6, 24), mat(palette.grass), 0, -0.3, 0);
  top.castShadow = false;
  mesh(new THREE.ConeGeometry(RADIUS - 0.6, 5, 12), mat(palette.soilDark), 0, -3.1, 0).rotation.x = Math.PI;
  // 草坪亮斑（略高于顶面，仅视觉）
  const lawnMesh = mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.02, 24), mat(palette.lawn), 1.6, 0.011, 0.8);
  lawnMesh.castShadow = false;

  // 狗窝：方盒墙 + 屋顶
  const kennel = new THREE.Group();
  kennel.position.set(KENNEL.x, 0, KENNEL.z);
  kennel.rotation.y = Math.atan2(KDIR.x, KDIR.z);
  group.add(kennel);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.2, 2.0), mat(palette.wall));
  wall.position.y = 0.6;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.8, 4), mat(palette.roof));
  roof.position.y = 1.6;
  roof.rotation.y = Math.PI / 4;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.05), mat(palette.doorInside));
  door.position.set(0, 0.45, 1.0);
  for (const o of [wall, roof, door]) {
    o.castShadow = true;
    o.receiveShadow = true;
    kennel.add(o);
  }

  // 大树
  mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.6, 6), mat(palette.trunk), 4.4, 0.8, -3.4);
  mesh(new THREE.ConeGeometry(1.3, 2.6, 6), mat(palette.leaf), 4.4, 2.6, -3.4);

  // 池塘
  const pond = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.02, 20), new THREE.MeshStandardMaterial({ color: palette.water, roughness: 0.3 }));
  pond.position.set(-4.3, 0.02, 2.8);
  pond.receiveShadow = true;
  group.add(pond);

  // 草垛（田园道具）
  mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.9, 8), mat(palette.soilLight), 0.8, 0.45, -5.2);

  const obstacles = [
    { x: KENNEL.x, z: KENNEL.z, r: 1.5, name: 'kennel' },
    { x: 4.4, z: -3.4, r: 0.9, name: 'tree' },
    { x: -4.3, z: 2.8, r: 1.2, name: 'pond' },
    { x: 0.8, z: -5.2, r: 0.8, name: 'haystack' },
  ];

  const heightAt = (x, z) => 0;

  function isWalkable(x, z) {
    if (!(Number.isFinite(x) && Number.isFinite(z))) return false;
    if (Math.hypot(x, z) > RADIUS - 0.5) return false;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (Math.hypot(x - o.x, z - o.z) < o.r) return false;
    }
    return true;
  }

  function clampWalkable(x, z, margin = 0.5) {
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(z)) z = 0;
    for (let iter = 0; iter < 4; iter++) {
      const d = Math.hypot(x, z);
      const maxR = RADIUS - margin;
      if (d > maxR) {
        x *= maxR / d;
        z *= maxR / d;
      }
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        let dx = x - o.x, dz = z - o.z;
        let dd = Math.hypot(dx, dz);
        const minD = o.r + 0.02;
        if (dd < minD) {
          if (dd < 1e-6) { dx = 1; dz = 0; dd = 1; }
          x = o.x + (dx / dd) * minD;
          z = o.z + (dz / dd) * minD;
        }
      }
    }
    return { x, z };
  }

  const v = (x, z) => new THREE.Vector3(x, heightAt(x, z), z);
  const doorDist = 1.0 + 0.9;
  const anchors = {
    kennelDoor: v(KENNEL.x + KDIR.x * doorDist, KENNEL.z + KDIR.z * doorDist),
    kennelInside: v(KENNEL.x + KDIR.x * 0.2, KENNEL.z + KDIR.z * 0.2),
    kennelFacing: Math.atan2(KDIR.x, KDIR.z),
    lawn: { x: 1.6, z: 0.8, r: 3.6 },
    front: v(0, 5.8),
    frontFacing: 0,
    flowerSpots: [v(-1.0, -4.6), v(1.2, -4.2), v(5.2, 0.5), v(-5.5, -0.8), v(-2.5, 4.6), v(4.2, 4.0), v(-6.0, 0.8)],
    sniffSpots: [v(3.4, -2.4), v(6.0, -1.0), v(-2.0, 0.6), v(0.6, 3.0), v(2.0, -3.6), v(-5.8, 0.0)],
    napSpot: v(3.6, 1.6),
    sunsetSpot: v(2.4, 3.0),
    sunsetFacing: -Math.PI / 2, // 面向 -X（西）
    pond: { x: -4.3, z: 2.8, r: 1.2 },
    pondDrink: v(-2.8, 2.5),
  };

  return {
    group,
    update(dt, env) {},
    radius: RADIUS,
    heightAt,
    isWalkable,
    clampWalkable,
    obstacles,
    groundMeshes: [top],
    anchors,
  };
}
