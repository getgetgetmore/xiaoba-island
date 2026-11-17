// 农场各时段的规则表（纯数据）。逻辑（farmSim 的 rules 参数）和画面（lighting 的预设名）都只读这张表，
// 代码里不写死“白天 / 夜晚”。本版“捣乱”模式只用白天的那一份；清晨 / 黄昏 / 夜晚先把设想填进来，留给以后的夜晚模式。
// 字段含义见 farmSim.js 的 DEFAULT_RULES：
//   lighting  灯光预设名（lighting.js 的 FARM_LIGHT_PRESETS）
//   keeper    管理员：awake 是否醒着、speed 追逐速度、visionRange / visionAngle 视野、lantern 是否提灯、hearing 听力倍率
//   animals   各类动物的状态：'roam' 闲逛 | 'roost' 回窝 / 睡觉
//   mischief  可用的捣乱点种类及分值倍率（没列出的不可用；'*' = 其余所有种类）
//   events    这个时段特有的事件（预留）
import { DEFAULT_RULES } from '../farmSim.js';

const day = { ...DEFAULT_RULES, phase: 'day', lighting: 'day' };

export const FARM_RULES = {
  dawn: {
    ...day, phase: 'dawn', lighting: 'dawn',
    keeper: { ...day.keeper, speed: 4.2, visionRange: 8 },                 // 刚起床，还没睡醒
    animals: { ...day.animals, chickens: 'roost' },                         // 鸡还在窝里
    events: ['rooster_crow'],                                               // 预留：公鸡打鸣把管理员叫醒
  },
  day,
  dusk: {
    ...day, phase: 'dusk', lighting: 'dusk',
    keeper: { ...day.keeper, visionRange: 8.5 },
    events: ['herd_home'],                                                  // 预留：管理员把动物赶回圈
  },
  night: {
    ...day, phase: 'night', lighting: 'night',
    keeper: { ...day.keeper, speed: 4.3, visionRange: 5.5, visionAngle: 70, lantern: true, hearing: 1.5 }, // 提灯巡夜：看得近、听得清
    animals: { chickens: 'roost', ducks: 'roost', pigs: 'roost', sheep: 'roost', cows: 'roost' },
    mischief: { ...day.mischief, '*': 1.5, henhouse: 3, scatter: 0, pounce_bird: 0 },                       // 夜里分值更高；鸡都睡了，改成偷鸡蛋（henhouse）
    events: ['fireflies', 'egg_heist'],
  },
};

/** 取某个时段的规则。mode = 'caper' 时本版一律用白天的规则（夜晚模式做出来之前，不让一局游戏因为现实时间是夜里就变成另一种玩法）。 */
export function rulesFor(phase, { mode = 'caper', force = false } = {}) {
  if (mode === 'caper' && !force) return FARM_RULES.day;
  return FARM_RULES[phase] || FARM_RULES.day;
}

export default FARM_RULES;
