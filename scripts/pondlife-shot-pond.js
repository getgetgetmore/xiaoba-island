// 截图用 --eval-file 脚本：池塘全景 / 青蛙跳跃途中 / 入水涟漪。__MODE__ 由 scripts/_plpond.sh 替换：plain | jump | splash | dive
(async () => {
  const mode = '__MODE__';
  const pl = __pet.island.pondLife;
  const frog = pl.frogs[0];
  const freeze = () => { pl.update = () => {}; };
  __pet.setFocus('pond');
  if (mode === 'crab') { __pet.step(1 / 30, 100); __pet.setFocus('crab:0'); __pet.step(1 / 30, 90); return; }
  if (mode === 'plain') {
    __pet.step(1 / 30, 150);
    return;
  }
  // 先让相机就位（模拟照常运行），再捕捉瞬间
  __pet.step(1 / 30, 100);
  if (mode === 'jump') {
    // 等青蛙 0 腾空到最高点附近
    for (let i = 0; i < 3000 && !(frog.phase === 'hop' && frog.u > 0.45); i++) __pet.step(1 / 30, 1);
    freeze();
    __pet.setFocus('frog:0');
    __pet.step(1 / 30, 90);
  } else if (mode === 'splash' || mode === 'dive') {
    // 用一只靠近的狗位置把青蛙吓进水里：假装狗在池塘东侧
    const dp = { x: frog.group.position.x + 0.9, z: frog.group.position.z };
    const orig = pl.update;
    for (let i = 0; i < 600 && frog.phase !== 'sink'; i++) { orig(1 / 30, { hour: 11, dayFactor: 1, sunsetFactor: 0, rain: 0 }, dp); }
    for (let i = 0; i < 9; i++) orig(1 / 30, { hour: 11, dayFactor: 1, sunsetFactor: 0, rain: 0 }, dp);
    freeze();
    __pet.setFocus('frog:0');
    __pet.step(1 / 30, 90);
  }
})();
