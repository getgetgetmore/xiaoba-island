// 管理员的视野显示：每帧把她的位置、朝向、视野角度，以及扇形里每条视线能看多远，写进卡通材质的 farmVision（见 props.js）。
// 逻辑层判断“看不看得见”用的是同一套数：前方 visionRange、visionAngle 的扇形，中间没有房子 / 树挡着；贴身 NEAR_SENSE 以内不看朝向。
// 颜色跟着她的状态走：巡逻 = 淡黄，赶过来 / 搜索 = 橙，驱赶 = 橙红，抓 = 红；小狗在视野里时整体亮一档。
import * as THREE from 'three';
import { farmVision, FARM_VIS_RAYS } from './props.js';
import { FARM } from '../farmSim.js';

const DEG = Math.PI / 180;
const COLORS = { calm: 0xfff3b0, alert: 0xffb040, shoo: 0xff8436, catch: 0xff4a3a };

export function createFarmVision({ heightAt } = {}) {
  const U = farmVision, dist = U.uVisDist.value;
  const want = new THREE.Color(COLORS.calm);
  let fade = 0, seenK = 0, mode = 'calm';

  /** 沿朝向 a 的这条视线能看多远（被挡住的地方短）。sightBlocked 沿一条线是单调的：挡住以后更远的都挡住，所以可以二分 */
  function reach(world, x, z, a, range) {
    const sx = Math.sin(a), cz = Math.cos(a);
    if (!world.sightBlocked(x, z, x + sx * range, z + cz * range)) return range;
    let lo = 0, hi = range;
    for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (world.sightBlocked(x, z, x + sx * m, z + cz * m)) hi = m; else lo = m; }
    return lo;
  }

  /** on：这一帧要不要显示（游戏进行中） */
  function update(sim, dt, on) {
    const K = sim && sim.keeper, kr = sim && sim.rules && sim.rules.keeper;
    const show = !!(on && K && K.active !== false && kr && kr.awake && K.state !== 'carry' && !sim.finished);
    fade += ((show ? 1 : 0) - fade) * (1 - Math.exp(-9 * Math.max(0, dt)));
    if (!show && fade < 0.02) { fade = 0; U.uVisOn.value = 0; return; }
    U.uVisOn.value = 1;
    if (show) {
      const half = (kr.visionAngle * DEG) / 2, range = kr.visionRange;
      U.uVisPos.value.set(K.x, K.z);
      U.uVisDir.value.set(Math.sin(K.heading), Math.cos(K.heading));
      U.uVisHalf.value = half;
      U.uVisNear.value = FARM.NEAR_SENSE;
      U.uVisY.value = heightAt ? heightAt(K.x, K.z) : 0;
      for (let i = 0; i < FARM_VIS_RAYS; i++) dist[i] = reach(sim.world, K.x, K.z, K.heading + ((i / (FARM_VIS_RAYS - 1)) * 2 - 1) * half, range);
      mode = K.state === 'chase' ? (K.shoo ? 'shoo' : 'catch') : K.state === 'suspicious' || K.state === 'search' ? 'alert' : 'calm';
      const me = sim.pets.find((p) => p.owner === 'local');
      const sees = me ? sim.canKeeperSee(me) : false;
      seenK += ((sees ? 1 : 0) - seenK) * (1 - Math.exp(-10 * Math.max(0, dt)));
    }
    want.set(COLORS[mode]);
    U.uVisColor.value.lerp(want, 1 - Math.exp(-8 * Math.max(0, dt)));
    U.uVisAmt.value = fade * (0.2 + 0.14 * seenK + (mode === 'calm' ? 0 : 0.05));
    U.uVisRim.value = fade * (0.5 + 0.25 * seenK);
  }
  function reset() { fade = 0; seenK = 0; mode = 'calm'; U.uVisOn.value = 0; U.uVisColor.value.set(COLORS.calm); }
  return { update, reset, info: () => ({ on: U.uVisOn.value === 1, mode, fade: +fade.toFixed(2), seen: +seenK.toFixed(2), near: +Math.min(...dist).toFixed(2), far: +Math.max(...dist).toFixed(2) }) };
}

export default createFarmVision;
