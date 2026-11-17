// 把逻辑层（farmSim）里的角色接到模型上：宠物（本机的那只借用岛上的小狗，其余的另建小狗实例）、管理员、大鹅、动物。
// createFarmActors({ scene, heightAt, localDog, makeDog, env }) → actors
//   actors.sync(sim, dt)        每帧调用：按 sim 的状态摆位置、切动作、推进动画
//   actors.event(e, sim)        把 sim 的事件转成一次性的动作（管理员弯腰抓、大鹅叫…）
//   actors.petObject(id)        某只宠物的 Object3D（名字牌 / 镜头跟随用）
//   actors.reset()              一局结束 / 重开：清掉动物和对端宠物的模型
import * as THREE from 'three';
import { createFarmModel, FARM_MODELS, farmToonMaterial } from './models.js';

const PET_ACTION = { idle: 'idle', walk: 'walk', run: 'run', pounce: 'pounce', dig: 'playbow', roll: 'roll', tumble: 'roll', stunned: 'flinch', tossed: 'roll', held: 'idle', swim: 'walk', escaped: 'idle' };
const MUD = new THREE.Color(0x9a7a56), CLEAN = new THREE.Color(0xffffff);
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export function createFarmActors({ scene, heightAt, localDog, makeDog, env, dogScale = 1 }) {
  const group = new THREE.Group(); group.name = 'farmActors'; scene.add(group);
  const pets = new Map();     // petId → { dog, obj, local, action, mats, muddy, x, z }
  const animals = new Map();  // id → { model, x, z, heading }
  const hp = new THREE.Vector3();
  let keeper = null, goose = null, grabT = 0, honkT = 0;

  /** 小狗在农场里换成和其他角色一样的卡通材质（岛上的手绘材质在这套灯光下发暗）；返回 { mats, swaps }，swaps 用来在归还小狗时换回去 */
  function toonDog(dog) {
    const mats = [], swaps = [];
    dog.group.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.vertexColors) return;
      const m = farmToonMaterial.clone();
      swaps.push([o, o.material]); o.material = m; mats.push(m);
    });
    return { mats, swaps };
  }
  function petFor(p) {
    let a = pets.get(p.id);
    if (a) return a;
    const local = p.owner === 'local';
    const dog = local ? localDog : makeDog(p);
    if (!local) { dog.group.scale.setScalar(dogScale); group.add(dog.group); }
    dog.group.rotation.order = 'YXZ';
    const td = toonDog(dog);
    a = { dog, obj: dog.group, local, action: '', mats: td.mats, swaps: td.swaps, muddy: false, x: p.x, z: p.z, heading: p.heading };
    pets.set(p.id, a);
    return a;
  }
  function releasePet(a) {
    for (const [mesh, orig] of a.swaps) mesh.material = orig; // 换回原来的材质
    for (const m of a.mats) m.dispose();
    if (!a.local) a.obj.removeFromParent();
  }
  function setShadow(obj) { obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; } }); }

  function syncPet(p, sim, dt) {
    const a = petFor(p), d = a.dog, g = a.obj;
    const act = PET_ACTION[p.action] || 'idle';
    if (act !== a.action) { a.action = act; d.setAction(act, { fade: act === 'pounce' ? 0.06 : 0.15 }); }
    d.speed = p.speed || 0;
    if (p.muddy !== a.muddy) { a.muddy = p.muddy; for (const m of a.mats) m.color.copy(p.muddy ? MUD : CLEAN); }
    g.visible = !p.hidden && !p.escaped;
    if (p.held && keeper && keeper.parts && keeper.parts.holdPoint) {
      // 被拎着：挂在管理员的手上，四脚悬空晃
      keeper.group.updateMatrixWorld(true);
      keeper.parts.holdPoint.getWorldPosition(hp);
      g.position.set(hp.x, hp.y - 0.62 * dogScale, hp.z);
      g.rotation.set(-0.5 + 0.12 * Math.sin(sim.time * 9), keeper.group.rotation.y + 0.4, 0.1 * Math.sin(sim.time * 7));
    } else {
      const y = heightAt(p.x, p.z) + (p.action === 'swim' ? -0.3 : 0) + (p.air || 0); // air：被扔出去时离地的高度
      g.position.set(p.x, y, p.z);
      g.rotation.set(0, p.heading, 0);
    }
    d.update(dt, env);
    a.x = p.x; a.z = p.z;
  }

  function animalAction(m, a, moving) {
    const has = (n) => m.actions.includes(n);
    if (a.action === 'sleep' && has('sleep')) return 'sleep';
    if (a.action === 'peck' && has('peck')) return 'peck';
    if (moving) return 'run';
    if (a.scared > 0 && has('scared')) return 'scared';
    return 'idle';
  }
  function syncAnimal(a, dt) {
    let s = animals.get(a.id);
    if (!s) {
      const model = createFarmModel(a.kind);
      model.actions = (FARM_MODELS[a.kind] || {}).actions || [];
      setShadow(model.group);
      group.add(model.group);
      s = { model, x: a.x, z: a.z };
      animals.set(a.id, s);
    }
    const m = s.model, sp = dt > 0 ? Math.hypot(a.x - s.x, a.z - s.z) / dt : 0;
    s.x = a.x; s.z = a.z;
    m.group.position.set(a.x, heightAt(a.x, a.z), a.z);
    m.group.rotation.y = a.heading;
    m.speed = Math.max(0.6, sp);
    const act = animalAction(m, a, sp > 0.25);
    if (m.action !== act) m.setAction(act);
    m.update(dt);
  }

  function sync(sim, dt) {
    // ---- 管理员（先摆她：被拎着的小狗要用她手的位置）
    const K = sim.keeper;
    if (K && K.active !== false) {
      if (!keeper) { keeper = createFarmModel('keeper'); keeper.px = K.x; keeper.pz = K.z; setShadow(keeper.group); group.add(keeper.group); }
      const sp = dt > 0 ? Math.hypot(K.x - keeper.px, K.z - keeper.pz) / dt : 0;
      keeper.px = K.x; keeper.pz = K.z;
      keeper.group.visible = true;
      keeper.group.position.set(K.x, heightAt(K.x, K.z), K.z);
      keeper.group.rotation.y = K.heading;
      keeper.speed = Math.max(0.8, sp);
      grabT = Math.max(0, grabT - dt);
      const act = grabT > 0 ? 'grab' : K.state === 'carry' ? 'carry' : K.action === 'shoo' ? 'grab' : sp > 0.3 ? 'run' : 'idle'; // 驱赶时站在小狗跟前挥手：借用伸手的动作
      if (keeper.action !== act) keeper.setAction(act);
      keeper.setAngry((K.state === 'chase' && !K.shoo) || K.state === 'carry' || K.anger > 0.75); // 驱赶时还没真生气
      keeper.update(dt);
    } else if (keeper) keeper.group.visible = false;
    // ---- 大鹅
    const G = sim.goose;
    if (G && G.active) {
      if (!goose) { goose = createFarmModel('goose'); goose.px = G.x; goose.pz = G.z; setShadow(goose.group); group.add(goose.group); }
      const sp = dt > 0 ? Math.hypot(G.x - goose.px, G.z - goose.pz) / dt : 0;
      goose.px = G.x; goose.pz = G.z;
      goose.group.visible = true;
      goose.group.position.set(G.x, heightAt(G.x, G.z), G.z);
      goose.group.rotation.y = G.heading;
      goose.speed = Math.max(0.8, sp);
      honkT = Math.max(0, honkT - dt);
      const act = honkT > 0 ? 'honk' : sp > 0.3 ? 'run' : 'idle';
      if (goose.action !== act) goose.setAction(act);
      goose.update(dt);
    } else if (goose) goose.group.visible = false;
    // ---- 动物
    for (const a of sim.animals) syncAnimal(a, dt);
    // ---- 宠物
    const alive = new Set();
    for (const p of sim.pets) { alive.add(p.id); syncPet(p, sim, dt); }
    for (const [id, a] of pets) if (!alive.has(id)) { releasePet(a); pets.delete(id); }
  }

  function event(e) {
    if (e.type === 'caught') grabT = 0.6;
    else if (e.type === 'released' && e.toss) grabT = 0.4; // 扔出去的那一下：借用伸手抓的动作
    else if (e.type === 'honk' || (e.type === 'peck' && e.by === 'goose')) honkT = 0.7;
  }
  function reset() {
    for (const s of animals.values()) s.model.group.removeFromParent();
    animals.clear();
    for (const [id, a] of pets) { releasePet(a); pets.delete(id); }
    if (keeper) { keeper.group.removeFromParent(); keeper = null; }
    if (goose) { goose.group.removeFromParent(); goose = null; }
    grabT = 0; honkT = 0;
  }
  return {
    group, sync, event, reset,
    petObject: (id) => { const a = pets.get(id); return a ? a.obj : null; },
    get keeper() { return keeper; }, get goose() { return goose; }, animals, pets,
    angDiff,
  };
}

export default createFarmActors;
