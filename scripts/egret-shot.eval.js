// 白鹭特写（配合 scripts/shot.cjs）：加载导入的模型，摆在空地上，切到指定状态跑若干帧后截图。
// 用法（把占位符换掉再交给 shot.cjs）：
//   sed -e "s/__STATE__/walk/" -e "s/__FRAMES__/40/" -e "s/__YAW__/1.57/" -e "s/__LIFT__/0/" -e "s/__CARRY__/0/" scripts/egret-shot.eval.js > tmp.js
//   node scripts/shot.cjs --out shots/egret/walk.png --query "hour=11&weather=clear&seed=5&brain=off&backdrop=1" --size 700x600 --wait 300 --eval-file tmp.js
// __STATE__：fly | glide | land | stand | walk | peck | takeoff；__FRAMES__：切到该状态后跑多少帧（30 帧/秒）；
// __YAW__：鸟的朝向（弧度，1.57 = 侧面朝右）；__LIFT__：抬到离地多高（飞行状态用 1.2 左右）；__CARRY__：1 = 驮着东西的飞法。
const P = __pet; window.requestAnimationFrame = () => 0;
const m = await import('/src/world/egret.js');
const loaded = await m.preloadEgret();
const eg = m.createEgret();
const x0 = -0.3, z0 = 4.6, y0 = P.island.heightAt(x0, z0) + __LIFT__;
eg.group.position.set(x0, y0, z0); eg.group.rotation.y = __YAW__;
eg.carry = !!__CARRY__;
P.ctx.scene.add(eg.group);
for (let i = 0; i < 30; i++) eg.update(1 / 30);
eg.setState('__STATE__');
for (let i = 0; i < __FRAMES__; i++) { eg.update(1 / 30); if (eg.state === 'walk') { eg.group.position.x += Math.sin(__YAW__) * eg.walkSpeed / 30; eg.group.position.z += Math.cos(__YAW__) * eg.walkSpeed / 30; } }
const p = eg.group.position;
P.setFocus({ tx: p.x, ty: p.y + 1.0, tz: p.z, R: 1.5, pitch: 0.1, az: 0 });
for (let i = 0; i < 60; i++) P.step(1 / 10, 1);
let nan = 0; eg.group.traverse((o) => { if (o.isBone) for (const e of o.matrixWorld.elements) if (!Number.isFinite(e)) nan++; });
return { loaded, state: eg.state, dims: eg.dims, nan, errors: P.info().errors.length };
