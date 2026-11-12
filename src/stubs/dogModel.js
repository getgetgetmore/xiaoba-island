// 占位柴犬：几个盒子拼成。接口完整对应 DESIGN.md 3.6。
import * as THREE from 'three';
import { palette } from '../core/palette.js';
import { damp, clamp } from '../core/util.js';

export const DOG_ACTIONS = [
  'idle', 'walk', 'run', 'sit', 'lie', 'sleep', 'roll', 'spin', 'playbow', 'sniff', 'drink', 'pounce', 'pickup', 'shake', 'flinch',
];
const ONE_SHOT = { pounce: 0.7, pickup: 0.5, shake: 1.2, flinch: 0.6 };

const _v = new THREE.Vector3();

export function createDog(ctx) {
  const group = new THREE.Group();
  group.name = 'dog(stub)';

  const orange = new THREE.MeshStandardMaterial({ color: palette.shibaOrange, roughness: 0.9 });
  const cream = new THREE.MeshStandardMaterial({ color: palette.shibaCream, roughness: 0.9 });
  const black = new THREE.MeshStandardMaterial({ color: palette.shibaBlack, roughness: 0.6 });
  const box = (w, h, d, m, x, y, z, parent) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  };

  // 内部子节点完成所有姿态动画（brain 只动 group.position / rotation.y）
  const body = new THREE.Group();
  body.position.y = 0.4;
  group.add(body);
  box(0.4, 0.38, 0.75, orange, 0, 0, 0, body); // 躯干（本地 +Z 为前）
  box(0.3, 0.2, 0.4, cream, 0, -0.1, 0.05, body); // 腹部
  const head = new THREE.Group();
  head.position.set(0, 0.3, 0.42);
  body.add(head);
  box(0.34, 0.3, 0.32, orange, 0, 0, 0, head);
  box(0.2, 0.14, 0.18, cream, 0, -0.07, 0.2, head); // 嘴套
  box(0.07, 0.05, 0.05, black, 0, -0.02, 0.3, head); // 鼻
  box(0.07, 0.14, 0.05, orange, -0.11, 0.2, -0.02, head); // 耳
  box(0.07, 0.14, 0.05, orange, 0.11, 0.2, -0.02, head);
  box(0.04, 0.04, 0.02, black, -0.09, 0.05, 0.16, head); // 眼
  box(0.04, 0.04, 0.02, black, 0.09, 0.05, 0.16, head);
  const mouthAnchor = new THREE.Object3D();
  mouthAnchor.position.set(0, -0.1, 0.3);
  head.add(mouthAnchor);

  const tail = new THREE.Group();
  tail.position.set(0, 0.15, -0.4);
  body.add(tail);
  box(0.1, 0.25, 0.1, cream, 0, 0.12, -0.03, tail);

  const legs = [];
  for (const [x, z] of [[-0.14, 0.28], [0.14, 0.28], [-0.14, -0.28], [0.14, -0.28]]) {
    const leg = new THREE.Group();
    leg.position.set(x, -0.15, z);
    box(0.1, 0.3, 0.1, orange, 0, -0.15, 0, leg);
    body.add(leg);
    legs.push(leg);
  }

  const dog = {
    group,
    mouthAnchor,
    actions: DOG_ACTIONS.slice(),
    action: 'idle',
    actionTime: 0,
    actionDone: false,
    speed: 0,
    size: { length: 1.0, height: 0.75, radius: 0.45 },
    setAction,
    lookAt,
    setCarrying,
    update,
  };

  let lookTarget = null;
  let carrying = false;
  let phase = 0;
  let yaw = 0;

  function setAction(name, { fade = 0.25 } = {}) {
    if (!DOG_ACTIONS.includes(name) || name === dog.action) return;
    dog.action = name;
    dog.actionTime = 0;
    dog.actionDone = false;
  }

  function lookAt(worldPos) {
    lookTarget = worldPos || null;
  }

  function setCarrying(b) {
    carrying = !!b;
  }

  function update(dt, env) {
    dog.actionTime += dt;
    const dur = ONE_SHOT[dog.action];
    if (dur !== undefined && dog.actionTime >= dur) dog.actionDone = true;

    const a = dog.action;
    phase += dt * (a === 'run' ? 12 : a === 'walk' ? 6 : a === 'spin' ? 10 : 2);
    const moving = a === 'walk' || a === 'run';
    const swing = moving ? (a === 'run' ? 0.7 : 0.4) : 0;
    for (let i = 0; i < 4; i++) legs[i].rotation.x = Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)) * swing;

    // 简易姿态
    let by = 0.4, pitch = 0, roll = 0;
    if (a === 'sit') { pitch = -0.5; by = 0.3; }
    else if (a === 'lie' || a === 'sleep') { by = 0.2; }
    else if (a === 'roll') { roll = Math.PI; by = 0.25; }
    else if (a === 'playbow') { pitch = 0.3; }
    else if (a === 'sniff' || a === 'drink') { pitch = 0.25; }
    else if (a === 'spin') { by = 0.4 + Math.abs(Math.sin(phase)) * 0.1; }
    else if (a === 'pounce') { by = 0.4 + Math.sin(clamp(dog.actionTime / 0.7) * Math.PI) * 0.3; }
    else if (a === 'flinch') { by = 0.33; }
    else if (a === 'run') { by = 0.4 + Math.abs(Math.sin(phase)) * 0.06; }
    else by = 0.4 + Math.sin(env ? env.elapsed * 2 : 0) * 0.01;
    body.position.y = damp(body.position.y, by, 12, dt);
    body.rotation.x = damp(body.rotation.x, pitch, 10, dt);
    body.rotation.z = damp(body.rotation.z, roll, 10, dt);
    tail.rotation.z = Math.sin(phase * 1.5) * 0.4;

    // 头部看向目标（限幅）
    let yawT = 0;
    if (lookTarget) {
      group.updateWorldMatrix(true, false);
      _v.copy(lookTarget);
      group.worldToLocal(_v);
      yawT = clamp(Math.atan2(_v.x, _v.z), -1.0, 1.0);
    }
    yaw = damp(yaw, yawT, 8, dt);
    head.rotation.y = yaw;
    head.rotation.x = damp(head.rotation.x, carrying ? 0.05 : 0, 8, dt);
  }

  return dog;
}
