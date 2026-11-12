// Node 无头冒烟测试：不创建 renderer（ctx.renderer = null）。
// 用法：node scripts/smoke.mjs [--only island,sky,critters,dog,stick,brain] [--frames 300] [--quiet]
//   --only 指定要测的真实模块（其余用 stub）；别名：dogModel=dog, dogBrain=brain。
import * as THREE from 'three';
import { palette } from '../src/core/palette.js';
import { createEnvironment } from '../src/core/env.js';
import { mulberry32 } from '../src/core/util.js';
import { SPECS, loadWorld, createStepper, validateIslandDeep } from '../src/core/world.js';

const argv = process.argv.slice(2);
const getArg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const FRAMES = Math.max(300, parseInt(getArg('--frames') || '300', 10));
const QUIET = argv.includes('--quiet');
const ALIAS = { dogModel: 'dog', dogBrain: 'brain', dogmodel: 'dog', dogbrain: 'brain' };

let only = null;
const onlyArg = getArg('--only');
if (onlyArg !== undefined) {
  only = new Set(onlyArg.split(',').map((s) => s.trim()).filter(Boolean).map((s) => ALIAS[s] || s));
  const valid = new Set(SPECS.map((s) => s.key));
  for (const k of only) {
    if (!valid.has(k)) {
      console.error(`未知模块 "${k}"，可选：${[...valid].join(', ')}`);
      process.exit(2);
    }
  }
}

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.error('FAIL ' + msg);
};

const WEATHERS = ['clear', 'cloudy', 'rain', 'storm'];
const HOURS = [2, 6, 10, 13, 18.25, 21];
const DT = 1 / 30;

function bad(n) {
  return !Number.isFinite(n);
}

/** 遍历场景检查 position/rotation/scale 是否 NaN，返回第一个问题描述或 null */
function checkScene(scene) {
  let msg = null;
  scene.traverse((o) => {
    if (msg) return;
    const p = o.position, r = o.rotation, s = o.scale;
    if (bad(p.x) || bad(p.y) || bad(p.z)) msg = `NaN position: ${o.name || o.type} (${p.x}, ${p.y}, ${p.z})`;
    else if (bad(r.x) || bad(r.y) || bad(r.z)) msg = `NaN rotation: ${o.name || o.type}`;
    else if (bad(s.x) || bad(s.y) || bad(s.z)) msg = `NaN scale: ${o.name || o.type}`;
    else if (o.isInstancedMesh && o.instanceMatrix) {
      const a = o.instanceMatrix.array;
      const n = Math.min(o.count * 16, a.length);
      for (let i = 0; i < n; i++) if (bad(a[i])) { msg = `NaN instanceMatrix: ${o.name || 'InstancedMesh'}[${(i / 16) | 0}]`; break; }
    }
  });
  return msg;
}

function checkEnv(env) {
  for (const k of ['hour', 'dayFactor', 'sunsetFactor', 'cloudiness', 'rain', 'storm', 'wind', 'wetness', 'lightning', 'lightningSeq', 'elapsed']) {
    if (bad(env[k])) return `env.${k} = ${env[k]}`;
  }
  for (const k of ['sunDir', 'moonDir']) {
    const v = env[k];
    if (bad(v.x) || bad(v.y) || bad(v.z)) return `env.${k} NaN`;
  }
  return null;
}

function checkModules(ctx) {
  const dog = ctx.dog, stick = ctx.stick;
  if (dog) {
    if (bad(dog.speed)) return 'dog.speed NaN';
    if (bad(dog.actionTime)) return 'dog.actionTime NaN';
    if (!dog.actions.includes(dog.action)) return `dog.action "${dog.action}" 不在 actions 中`;
  }
  if (stick) {
    const p = stick.position;
    if (bad(p.x) || bad(p.y) || bad(p.z)) return 'stick.position NaN';
  }
  for (const t of (ctx.critters && ctx.critters.targets) || []) {
    const p = t.position;
    if (!p || bad(p.x) || bad(p.y) || bad(p.z)) return `critters.targets[${t.id}].position NaN`;
  }
  return null;
}

function stats(ctx) {
  // 近似 draw call / 三角形统计（每个可见 Mesh 计 1 次；InstancedMesh 计 1 次、三角形×count）
  const out = {};
  const mods = ['island', 'sky', 'critters', 'dog', 'stick'];
  for (const k of mods) {
    const g = ctx[k] && ctx[k].group;
    if (!g) continue;
    let calls = 0, tris = 0;
    g.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isLineSegments)) return;
      // 可见性（含父级）
      for (let p = o; p; p = p.parent) if (p.visible === false) return;
      const geo = o.geometry;
      if (!geo) return;
      calls++;
      const idx = geo.index ? geo.index.count : geo.attributes.position ? geo.attributes.position.count : 0;
      const n = o.isMesh ? idx / 3 : 0;
      tris += n * (o.isInstancedMesh ? o.count : 1);
    });
    out[k] = { calls, tris: Math.round(tris) };
  }
  return out;
}

async function runCase(weather, hour) {
  const label = `${weather} @ ${hour}`;
  const errors = [];
  const ctx = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(32, 1.5, 1, 400),
    renderer: null,
    env: null,
    palette,
    rng: mulberry32(12345),
    island: null, sky: null, critters: null, dog: null, stick: null, brain: null,
  };
  ctx.camera.position.set(0, 18, 34);
  ctx.camera.lookAt(0, 0, 0);
  ctx.env = createEnvironment({ rng: mulberry32(777), hour, weather });
  const used = await loadWorld(ctx, { errors, real: only });
  const step = createStepper(ctx, errors);

  for (const e of errors) fail(`[${label}] 模块 ${e.module} ${e.stage} 出错（${SPECS.find((s) => s.key === e.module)?.path || e.module}）：${e.message}\n${e.stack}`);
  if (errors.length) return { used, ctx };

  if (weather === WEATHERS[0] && hour === HOURS[0]) {
    for (const k of SPECS.map((s) => s.key)) {
      const w = used[k];
      if (!QUIET) console.log(`  ${k.padEnd(9)} -> ${w}${w === 'real' ? '' : '  (stub)'}`);
    }
    for (const p of validateIslandDeep(ctx.island)) fail(`[island 契约] ${p}`);
  }

  const startErrors = errors.length;
  let lightningStart = ctx.env.lightningSeq;
  for (let f = 0; f < FRAMES; f++) {
    // 交互冒烟：点击木棍（任何状态下 click 都应合法）
    if (ctx.stick && (f === 40 || f === 100 || f === 170 || f === 240)) {
      try {
        const l = ctx.island.anchors.lawn;
        ctx.stick.click(f === 40 ? null : new THREE.Vector3(l.x, 0, l.z));
      } catch (e) {
        errors.push({ module: 'stick', stage: 'click', message: e.message, stack: e.stack });
        break;
      }
    }
    step(DT);
    if (errors.length > startErrors) break;
    if (f % 10 === 0 || f === FRAMES - 1) {
      const m = checkEnv(ctx.env) || checkScene(ctx.scene) || checkModules(ctx);
      if (m) {
        fail(`[${label}] 第 ${f} 帧：${m}`);
        return { used, ctx };
      }
    }
  }
  for (const e of errors) fail(`[${label}] 模块 ${e.module} ${e.stage} 出错（${SPECS.find((s) => s.key === e.module)?.path || e.module}）：${e.message}\n${e.stack}`);
  return { used, ctx, lightning: ctx.env.lightningSeq - lightningStart };
}

async function main() {
  console.log(`冒烟测试：${WEATHERS.length} 种天气 × ${HOURS.length} 个时刻 × ${FRAMES} 帧；真实模块：${only ? [...only].join(',') || '(无)' : '全部'}`);
  let lastCtx = null;
  let n = 0;
  for (const w of WEATHERS) {
    for (const h of HOURS) {
      const r = await runCase(w, h);
      lastCtx = r.ctx;
      n++;
      if (!QUIET && failures.length === 0) process.stdout.write('.');
      if (failures.length > 5) break;
    }
    if (failures.length > 5) break;
  }
  process.stdout.write('\n');

  // 额外检查：storm 下闪电计数增长
  {
    const errors = [];
    const ctx = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer: null, env: null, palette, rng: mulberry32(1) };
    ctx.env = createEnvironment({ rng: mulberry32(9), hour: 20, weather: 'storm' });
    ctx.env.setWeather('storm', { instant: true });
    const seq0 = ctx.env.lightningSeq;
    for (let i = 0; i < 30 * 60; i++) ctx.env.update(DT);
    if (ctx.env.lightningSeq <= seq0 + 3) fail(`storm 60 秒内 lightningSeq 增长过少：${ctx.env.lightningSeq - seq0}`);
  }

  if (lastCtx && !QUIET) {
    const st = stats(lastCtx);
    console.log('近似预算统计（最后一个用例，draw calls / 三角形）：');
    for (const [k, v] of Object.entries(st)) console.log(`  ${k.padEnd(9)} calls=${v.calls}  tris=${v.tris}`);
  }

  if (failures.length) {
    console.error(`\n冒烟测试失败：${failures.length} 项`);
    process.exit(1);
  }
  console.log(`冒烟测试通过（${n} 个用例）`);
}

main().catch((e) => {
  console.error('冒烟脚本自身异常：', e);
  process.exit(1);
});
