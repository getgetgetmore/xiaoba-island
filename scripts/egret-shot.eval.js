// 白鹭特写截图脚本（配合 scripts/shot.cjs 的 --eval-file）。
// 用法：把下面的常量按需改好（或用 sed 替换 __XXX__ 占位符），再：
//   node scripts/shot.cjs --out shots/egret/stand.png --query "hour=11&weather=clear&seed=5&brain=off&backdrop=1" \
//        --size 900x600 --wait 300 --eval-file scripts/egret-shot.eval.js
// 例：sed -e "s/__STATE__/walk/;s/__FRAMES__/70/;s/__YAW__/0/;s/__LIFT__/0/;s/__CARRY__/false/;s/__R__/1.6/" scripts/egret-shot.eval.js > tmp.js
//   STATE  : fly | glide | land | stand | walk | peck | takeoff（先 setState，再按 FRAMES 帧 1/60 秒推进）
//   FRAMES : 推进多少帧后截图（用来挑动作的某一瞬间；fly 一个扇翅周期约 30 帧）
//   YAW    : 鸟绕 Y 的朝向（弧度）。0 = 头朝 +Z；相机在 +Z 看，所以侧面是 ±1.5708
//   LIFT   : 抬离地面的高度（飞行状态用，如 1.6）；0 = 站在草地上
//   CARRY  : true/false，是否驮着小狗
//   R      : 取景半高（世界单位）；站立特写约 1.6，飞行约 2.6；设为 0 表示不调用 setFocus（默认全景，鸟放在 (4.6, 3.6)）
const STATE = '__STATE__', FRAMES = +'__FRAMES__', YAW = +'__YAW__', LIFT = +'__LIFT__', CARRY = '__CARRY__' === 'true', R = +"__R__";
window.requestAnimationFrame = () => 0;
const P = __pet;
const { createEgret } = await import('/src/world/egret.js');
const eg = createEgret();
eg.carry = CARRY;
const pano = R === 0;
const x0 = pano ? 4.6 : -0.3, z0 = pano ? 3.6 : 4.6;
const y0 = P.island.heightAt(x0, z0) + LIFT;
eg.group.position.set(x0, y0, z0);
eg.group.rotation.y = pano ? 2.2 : YAW;
P.ctx.scene.add(eg.group);
if (CARRY) { // 摆一个占位的“小狗”方块，看翅根有没有穿过
  const dog = new P.THREE.Mesh(new P.THREE.BoxGeometry(0.45, 0.4, 1.25), new P.THREE.MeshBasicMaterial({ color: 0xd9a05b }));
  dog.position.set(0, 0.2, 0);
  eg.seat.add(dog);
}
eg.setState(STATE);
let nan = false;
for (let i = 0; i < FRAMES; i++) {
  eg.update(1 / 60);
  if (STATE === 'walk') eg.group.position.addScaledVector(new P.THREE.Vector3(Math.sin(eg.group.rotation.y), 0, Math.cos(eg.group.rotation.y)), eg.walkSpeed / 60);
}
eg.group.updateMatrixWorld(true);
if (!pano) P.setFocus({ tx: x0, ty: y0 + 1.0, tz: z0, R, pitch: 0.08, az: 0 });
for (let i = 0; i < 60; i++) P.step(1 / 10, 1); // 让相机收敛到取景
P.step(0, 0);
return { state: eg.state, tris: eg.triangles, dims: eg.dims, errors: P.info().errors.length };
