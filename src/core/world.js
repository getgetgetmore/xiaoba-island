// 模块装载 / 契约校验 / 每帧更新（main.js 与 scripts/smoke.mjs 共用）。
// 动态 import() 的路径写成字面量，Vite 与 Node 都能解析。
import { isFiniteNum } from './util.js';

/** 创建顺序（DESIGN 3.1）：island → sky → critters → dog → stick → brain */
export const SPECS = [
  { key: 'island', path: 'src/world/island.js', factory: 'createIsland', real: () => import('../world/island.js'), stub: () => import('../stubs/island.js') },
  { key: 'sky', path: 'src/world/sky.js', factory: 'createSky', real: () => import('../world/sky.js'), stub: () => import('../stubs/sky.js') },
  { key: 'critters', path: 'src/world/critters.js', factory: 'createCritters', real: () => import('../world/critters.js'), stub: () => import('../stubs/critters.js') },
  { key: 'dog', path: 'src/dog/dogModel.js', factory: 'createDog', real: () => import('../dog/dogModel.js'), stub: () => import('../stubs/dogModel.js') },
  { key: 'stick', path: 'src/interaction/stick.js', factory: 'createStick', real: () => import('../interaction/stick.js'), stub: () => import('../stubs/stick.js') },
  { key: 'brain', path: 'src/dog/dogBrain.js', factory: 'createBrain', real: () => import('../dog/dogBrain.js'), stub: () => import('../stubs/dogBrain.js') },
];

/** 每帧更新顺序（DESIGN 3.1）：env → sky → island → critters → stick → brain → dog */
export const UPDATE_ORDER = ['sky', 'island', 'critters', 'stick', 'brain', 'dog'];

/** 记录错误（相同 module+stage+message 只记一次），返回是否为新记录 */
export function recordError(errors, module, stage, err) {
  const message = err && err.message ? String(err.message) : String(err);
  const exists = errors.some((e) => e.module === module && e.stage === stage && e.message === message);
  if (exists) return false;
  const stack = err && err.stack ? String(err.stack).split('\n').slice(0, 6).join('\n') : '';
  errors.push({ module, stage, message, stack });
  if (typeof console !== 'undefined') console.error(`[${module}:${stage}] ${message}`);
  return true;
}

// ---------- 契约校验 ----------
const FN = 'function';
const SHAPES = {
  island: {
    group: 'object', update: FN, radius: 'number', heightAt: FN, isWalkable: FN, clampWalkable: FN, obstacles: 'array', groundMeshes: 'array', anchors: 'object',
  },
  sky: { group: 'object', update: FN, sunLight: 'object' },
  critters: { group: 'object', update: FN, targets: 'array', startle: FN },
  dog: {
    group: 'object', mouthAnchor: 'object', actions: 'array', setAction: FN, action: 'string', actionTime: 'number', actionDone: 'boolean',
    speed: 'number', lookAt: FN, setCarrying: FN, update: FN, size: 'object',
  },
  stick: {
    group: 'object', update: FN, state: 'string', position: 'object', handPos: 'object', idleTimeout: 'number',
    click: FN, attachTo: FN, release: FN, dismiss: FN,
  },
  brain: { update: FN, mode: 'string', state: 'string' },
};
const ANCHOR_VEC = ['kennelDoor', 'kennelInside', 'front'];
const ANCHOR_NUM = ['kennelFacing', 'frontFacing', 'sunsetFacing'];
const ANCHOR_VEC2 = ['napSpot', 'sunsetSpot', 'pondDrink'];
const ANCHOR_CIRCLE = ['lawn', 'pond'];

function typeOk(v, t) {
  if (t === 'array') return Array.isArray(v);
  if (t === 'object') return v !== null && typeof v === 'object';
  return typeof v === t;
}

/** 返回问题列表（空数组 = 符合契约的形状要求） */
export function validateShape(key, obj) {
  const problems = [];
  if (!obj || typeof obj !== 'object') return [`${key}: 工厂没有返回对象`];
  const shape = SHAPES[key];
  for (const f of Object.keys(shape)) {
    if (!typeOk(obj[f], shape[f])) problems.push(`${key}.${f} 缺失或类型不是 ${shape[f]}`);
  }
  if (key === 'island' && obj.anchors) {
    const a = obj.anchors;
    for (const f of ANCHOR_VEC.concat(ANCHOR_VEC2)) {
      const v = a[f];
      if (!v || !isFiniteNum(v.x) || !isFiniteNum(v.y) || !isFiniteNum(v.z)) problems.push(`island.anchors.${f} 不是有效 Vector3`);
    }
    for (const f of ANCHOR_NUM) if (!isFiniteNum(a[f])) problems.push(`island.anchors.${f} 不是有效数字`);
    for (const f of ANCHOR_CIRCLE) {
      const c = a[f];
      if (!c || !isFiniteNum(c.x) || !isFiniteNum(c.z) || !isFiniteNum(c.r)) problems.push(`island.anchors.${f} 不是 {x,z,r}`);
    }
    if (!Array.isArray(a.flowerSpots) || a.flowerSpots.length < 6) problems.push('island.anchors.flowerSpots 少于 6 个');
    if (!Array.isArray(a.sniffSpots) || a.sniffSpots.length < 5) problems.push('island.anchors.sniffSpots 少于 5 个');
  }
  return problems;
}

/** 更严格的岛屿校验（smoke 使用）：anchors 可行走等 */
export function validateIslandDeep(island) {
  const problems = [];
  const a = island.anchors;
  const chk = (name, v, allow = false) => {
    if (!allow && !island.isWalkable(v.x, v.z)) problems.push(`anchors.${name} (${v.x.toFixed(2)}, ${v.z.toFixed(2)}) 不可行走`);
    const h = island.heightAt(v.x, v.z);
    if (!isFiniteNum(h)) problems.push(`heightAt(anchors.${name}) 不是有限数`);
  };
  chk('kennelDoor', a.kennelDoor);
  chk('kennelInside', a.kennelInside, true);
  chk('front', a.front);
  chk('napSpot', a.napSpot);
  chk('sunsetSpot', a.sunsetSpot);
  chk('pondDrink', a.pondDrink);
  a.flowerSpots.forEach((v, i) => chk(`flowerSpots[${i}]`, v, true)); // 昆虫活动点：不要求可行走
  a.sniffSpots.forEach((v, i) => chk(`sniffSpots[${i}]`, v));
  if (!island.isWalkable(a.lawn.x, a.lawn.z)) problems.push('lawn 中心不可行走');
  // clampWalkable 必须返回可行走点
  for (const [x, z] of [[100, 100], [0, 0], [-3.6, -2.6], [-4.3, 2.8], [4.4, -3.4], [7.9, 0]]) {
    const c = island.clampWalkable(x, z);
    if (!c || !island.isWalkable(c.x, c.z)) problems.push(`clampWalkable(${x}, ${z}) 返回了不可行走点`);
  }
  return problems;
}

/**
 * 装载全部真实模块（失败回退 stub）并按顺序创建。
 * @param ctx   已含 scene/camera/renderer/env/palette/rng
 * @param opts  { errors, real: Set<string>|null（null=全部用真实模块）, skip: Set<string> }
 */
export async function loadWorld(ctx, { errors, real = null, skip = null } = {}) {
  const used = {}; // key -> 'real' | 'stub'
  for (const spec of SPECS) {
    if (skip && skip.has(spec.key)) {
      ctx[spec.key] = null;
      used[spec.key] = 'skipped';
      continue;
    }
    let inst = null;
    const wantReal = !real || real.has(spec.key);
    if (wantReal) {
      let mod = null;
      try {
        mod = await spec.real();
      } catch (e) {
        recordError(errors, spec.key, 'load', e);
      }
      if (mod) {
        try {
          if (typeof mod[spec.factory] !== 'function') throw new Error(`${spec.path} 没有导出 ${spec.factory}`);
          const candidate = mod[spec.factory](ctx);
          const problems = validateShape(spec.key, candidate);
          if (problems.length) throw new Error(`契约不符：${problems.slice(0, 6).join('；')}`);
          inst = candidate;
          used[spec.key] = 'real';
        } catch (e) {
          recordError(errors, spec.key, 'create', e);
        }
      }
    }
    if (!inst) {
      const mod = await spec.stub();
      inst = mod[spec.factory](ctx);
      used[spec.key] = 'stub';
    }
    ctx[spec.key] = inst;
    if (inst.group && ctx.scene) ctx.scene.add(inst.group);
  }
  return used;
}

/** 创建逐帧推进器：env → sky → island → critters → stick → brain → dog。同一模块连续报同一错误只记录一次。 */
export function createStepper(ctx, errors) {
  const lastMsg = {};
  function step(dt) {
    try {
      ctx.env.update(dt);
    } catch (e) {
      if (lastMsg.env !== e.message) { lastMsg.env = e.message; recordError(errors, 'env', 'update', e); }
    }
    for (let i = 0; i < UPDATE_ORDER.length; i++) {
      const key = UPDATE_ORDER[i];
      const m = ctx[key];
      if (!m) continue;
      try {
        m.update(dt, ctx.env);
        if (lastMsg[key] !== undefined) lastMsg[key] = undefined; // 恢复后允许再次记录
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (lastMsg[key] !== msg) {
          lastMsg[key] = msg;
          recordError(errors, key, 'update', e);
        }
      }
    }
  }
  return step;
}
