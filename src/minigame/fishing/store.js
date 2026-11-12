// 钓鱼的本地存储（localStorage）：图鉴数据、“每天第一局必出漂流瓶”的日期记录、看过的寄语。
// Node / 无痕模式 / 存储被禁用时全部安全降级（读到空、写入什么都不做，不抛错）。
import { dateKey } from '../../core/messages.js';

export const KEYS = {
  dex: 'shiba.fishing.dex',             // { [lootId]: { count, first: 'YYYY-MM-DD' } }  图鉴：每样东西钓到过多少次、首次钓到的日期
  bottle: 'shiba.fishing.lastBottle',   // 'YYYY-MM-DD'  上次钓到漂流瓶的日期
  seen: 'shiba.fishing.seenMessages',   // [messageId]   看过的寄语
};

function store() {
  try {
    const s = typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch (_) { return null; }
}
export function readJSON(key, fallback) {
  try {
    const s = store();
    if (!s) return fallback;
    const raw = s.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch (_) { return fallback; }
}
export function writeJSON(key, value) {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) { return false; }
}

export function loadDex() {
  const d = readJSON(KEYS.dex, {});
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}
/** 记一次钓到：{ id }。返回这是不是第一次钓到该物品 */
export function recordCatch(id, date) {
  const dex = loadDex();
  const e = dex[id] && typeof dex[id] === 'object' ? dex[id] : null;
  const first = !e;
  dex[id] = { count: (e && Number.isFinite(e.count) ? e.count : 0) + 1, first: e && e.first ? e.first : dateKey(date) };
  writeJSON(KEYS.dex, dex);
  return first;
}
/** 今天是不是还没出过漂流瓶（= 这一局必出） */
export function bottleDue(date) { return readJSON(KEYS.bottle, '') !== dateKey(date); }
export function markBottle(date) { writeJSON(KEYS.bottle, dateKey(date)); }
export function seenMessages() { const a = readJSON(KEYS.seen, []); return Array.isArray(a) ? a : []; }
export function markSeen(id) {
  const a = seenMessages();
  if (!a.includes(id)) { a.push(id); writeJSON(KEYS.seen, a.slice(-200)); }
}
