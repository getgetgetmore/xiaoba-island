// 占位木棍：极简状态机。接口完整对应 DESIGN.md 3.7。
// 浏览器里自己监听 renderer.domElement 的 pointer 事件（按下后移动 > 6px 视为拖拽，不算点击）。
import * as THREE from 'three';
import { palette } from '../core/palette.js';
import { damp } from '../core/util.js';

const FLIGHT_TIME = 1.0;
const RETURN_TIME = 0.6;

export function createStick(ctx) {
  const group = new THREE.Group();
  group.name = 'stick(stub)';

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.6, 6).rotateZ(Math.PI / 2), // 长度沿本地 X
    new THREE.MeshStandardMaterial({ color: palette.stick, roughness: 0.9 }),
  );
  mesh.castShadow = true;
  group.add(mesh);
  group.visible = false;

  const handPos = new THREE.Vector3(0, 1.5, 7.2);
  const position = new THREE.Vector3().copy(handPos);

  const stick = {
    group,
    state: 'hidden',
    position,
    handPos,
    target: null,
    idleTimeout: 10,
    click,
    attachTo,
    release,
    dismiss,
    update,
  };

  let heldTime = 0;
  let t = 0;
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  let scale = 0;
  let carrier = null;

  function click(worldPoint) {
    switch (stick.state) {
      case 'hidden':
        stick.state = 'held';
        heldTime = 0;
        position.copy(handPos);
        group.visible = true;
        break;
      case 'held': {
        const p = worldPoint || new THREE.Vector3(0, 0, 0);
        const c = ctx.island ? ctx.island.clampWalkable(p.x, p.z) : { x: p.x, z: p.z };
        const y = ctx.island ? ctx.island.heightAt(c.x, c.z) : 0;
        stick.target = new THREE.Vector3(c.x, y, c.z);
        from.copy(position);
        to.copy(stick.target);
        t = 0;
        stick.state = 'flying';
        break;
      }
      default:
        heldTime = 0; // 其它状态只刷新交互时间
    }
  }

  function attachTo(dog) {
    if (stick.state !== 'landed' || !dog) return;
    carrier = dog;
    stick.state = 'carried';
  }

  function release() {
    if (stick.state !== 'carried') return;
    from.copy(position);
    carrier = null;
    t = 0;
    stick.state = 'returning';
  }

  function dismiss() {
    carrier = null;
    stick.target = null;
    if (stick.state !== 'hidden') stick.state = 'hidden';
  }

  function update(dt, env) {
    const bob = Math.sin((env ? env.elapsed : 0) * 2.5) * 0.06;
    switch (stick.state) {
      case 'held':
        heldTime += dt;
        position.set(handPos.x, handPos.y + bob, handPos.z);
        group.rotation.set(0, 0, 0.4 + bob);
        if (heldTime >= stick.idleTimeout) dismiss();
        break;
      case 'flying': {
        t += dt / FLIGHT_TIME;
        const k = Math.min(t, 1);
        position.lerpVectors(from, to, k);
        position.y += Math.sin(k * Math.PI) * 2.5;
        group.rotation.z += dt * 12;
        if (t >= 1) stick.state = 'landed';
        break;
      }
      case 'landed':
        position.copy(to);
        position.y += 0.05;
        group.rotation.set(0, group.rotation.y, 0);
        break;
      case 'carried':
        if (carrier) {
          carrier.mouthAnchor.updateWorldMatrix(true, false);
          carrier.mouthAnchor.getWorldPosition(position);
          group.rotation.set(0, carrier.group.rotation.y, 0);
        }
        break;
      case 'returning': {
        t += dt / RETURN_TIME;
        const k = Math.min(t, 1);
        position.lerpVectors(from, handPos, k);
        position.y += Math.sin(k * Math.PI) * 0.6;
        if (t >= 1) {
          stick.state = 'held';
          heldTime = 0;
        }
        break;
      }
      default:
        break;
    }
    group.position.copy(position);
    scale = damp(scale, stick.state === 'hidden' ? 0 : 1, 14, dt);
    group.scale.setScalar(Math.max(scale, 0.0001));
    group.visible = scale > 0.01;
  }

  // 浏览器指针交互
  if (typeof document !== 'undefined' && ctx.renderer && ctx.renderer.domElement) {
    const el = ctx.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 6) return;
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, ctx.camera);
      let p = null;
      const hits = ctx.island ? ray.intersectObjects(ctx.island.groundMeshes, false) : [];
      if (hits.length) p = hits[0].point;
      else {
        const out = new THREE.Vector3();
        if (ray.ray.intersectPlane(plane, out)) p = out;
      }
      click(p);
    });
  }

  return stick;
}
