// 截图用 --eval-file 脚本：在池塘旁的草地上摆一只模型的某个状态并特写。
// 用法：把 window.__PL_WHAT 设成 'frog:sit' / 'crab:pinch' 之类——shot.cjs 只能传一个脚本，所以由下面的 location.hash 决定：
//   node scripts/shot.cjs --out x.png --query "hour=11&backdrop=1" --eval-file scripts/pondlife-shot-model.js
// 通过环境变量 PL_WHAT=frog:croak 传入（shot.cjs 会把 --eval-file 的内容原样执行，这里的值由调用方替换占位符）。
(async () => {
  const what = '__WHAT__'.split(':');
  const THREE = __pet.THREE;
  const m = await import('/src/world/island/pondlife.js');
  const obj = what[0] === 'frog' ? m.createFrog() : m.createCrab();
  obj.setState(what[1]);
  if (what[2] && what[2] !== "-") obj.dir = +what[2];
  if (what[1] === 'pinch' || what[1] === 'walk') what[1] === 'walk' && (obj.walkRate = 1);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.5, 24), new THREE.MeshStandardMaterial({ color: 0x9a8f78, roughness: 1 }));
  disc.position.set(-1.2, 0.35, 4.4);
  __pet.ctx.scene.add(disc);
  obj.group.position.set(-1.2, 0.6, 4.4);
  obj.group.rotation.y = what[3] !== undefined ? +what[3] : 0.2;
  if (what[4]) obj.group.position.y += +what[4];
  __pet.ctx.scene.add(obj.group);
  __pet.ctx.debugTarget = obj.group;
  __pet.setFocus('debug');
  for (let i = 0; i < 90; i++) { obj.update(1 / 30); }
  __pet.step(1 / 30, 60);
  if (what[1] === 'croak') for (let i = 0; i < 100 && obj.body.morphTargetInfluences[1] < 0.9; i++) obj.update(1 / 60);
  else for (let i = 0; i < 12; i++) obj.update(1 / 30);
  __pet.step(1 / 30, 3);
})();
