// 占位昆虫：空实现（targets 为空数组）。接口对应 DESIGN.md 3.5。
import * as THREE from 'three';

export function createCritters(ctx) {
  const group = new THREE.Group();
  group.name = 'critters(stub)';
  const targets = []; // { id, kind, position, active, chaseable }
  return {
    group,
    update(dt, env) {},
    targets,
    startle(id) {},
  };
}
