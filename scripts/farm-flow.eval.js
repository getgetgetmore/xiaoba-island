// 农场小游戏外壳的端到端检查（页面内运行）：整局结算与奖励、退出后小岛复原、中途退出不发奖励、与其他互动互斥。
// 用法：node scripts/shot.cjs --out shots/farm-flow.png --query "hour=11&weather=clear&seed=5" --size 560x480 --wait 500 --timeout 200000 --eval-file scripts/farm-flow.eval.js
window.requestAnimationFrame = () => 0;
const P = __pet, G = P.game, D = P.dog, R = P.ctx.renderer, out = {};
const evts = []; window.addEventListener('pet:minigame-finished', (e) => evts.push(e.detail));
const before = { parent: D.group.parent === P.ctx.scene, scale: D.group.scale.x, tone: R.toneMapping, shadow: R.shadowMap.type, mat: [], mode: P.brain.mode };
D.group.traverse((o) => { if (o.isMesh) before.mat.push(o.material); });
P.ctx.rewards.last = null;
// ---- 1. 整局跑完（机器人，快进到 296 秒后实时跑完）
out.start = G.start({ seed: 7, autopilot: true, ff: 296 });
let n = 0; while (n < 600 && G.info().phase !== 'result') { P.step(1 / 30, 1); n++; }
const i1 = G.info();
out.finish = { frames: n, phase: i1.phase, time: i1.time, result: i1.result && { game: i1.result.game, completion: i1.result.completion, stars: i1.result.stars, score: i1.result.score, caught: i1.result.caught, escaped: i1.result.escaped, aborted: i1.result.aborted }, panel: !!document.querySelector('.farm-hud') && G.info().phase === 'result' };
out.reward = { granted: !!(P.ctx.rewards.last && P.ctx.rewards.last.game === 'farm'), events: evts.map((e) => e.game + ':' + e.aborted) };
out.noDrag = document.documentElement.dataset.petNoDrag;
// ---- 2. 回小岛：一切复原
G.stop(false); P.step(1 / 30, 60);
const after = { mat: [] }; D.group.traverse((o) => { if (o.isMesh) after.mat.push(o.material); });
out.restored = {
  active: G.active, parent: D.group.parent === P.ctx.scene, scale: D.group.scale.x, tone: R.toneMapping === before.tone, shadow: R.shadowMap.type === before.shadow,
  mats: after.mat.length === before.mat.length && after.mat.every((m, k) => m === before.mat[k]), mode: P.brain.mode, noDrag: document.documentElement.dataset.petNoDrag,
  hud: getComputedStyle(document.querySelector('.farm-hud')).display, onGround: Math.abs(D.group.position.y - P.island.heightAt(D.group.position.x, D.group.position.z)) < 0.15, visible: D.group.visible,
};
// ---- 3. 中途退出：只发事件、不发奖励
P.ctx.rewards.last = null; evts.length = 0;
G.start({ seed: 9, autopilot: true }); P.step(1 / 30, 90); G.stop(); P.step(1 / 30, 30);
out.abort = { granted: !!P.ctx.rewards.last, events: evts.map((e) => e.game + ':' + e.aborted), active: G.active, parent: D.group.parent === P.ctx.scene };
// ---- 4. 小游戏期间其他互动被拦住；出门时不能开始
G.start({ seed: 3, autopilot: true }); P.step(1 / 30, 20);
P.stick.click(null); P.step(1 / 30, 5);
out.block = { stick: P.stick.state, fishing: P.fishing.start({}) };
G.stop(); P.step(1 / 30, 20);
out.errors = P.info().errors;
return out;
