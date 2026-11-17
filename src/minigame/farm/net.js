// 农场的联机接口（预留）。本版不接真实网络，只有两个实现：
//   createLocalNet()            离线：没有对端，send 什么都不做；
//   createMockNet({ bots })     测试用：在本机模拟几只“别人的宠物”，按固定节奏发 profile / pose / emote / chat，
//                               用来验证“多只宠物同屏、名字牌、表情气泡”这条链路。
// 以后接真实网络（WebSocket 中转或点对点）时，实现同一个接口即可，上层不用改。
//
// FarmNet 接口：
//   net.connected            是否连上了房间
//   net.selfId               自己的 id
//   net.isHost               自己是不是房主（房主负责管理员、动物、可互动物的状态，以及农场时间）
//   net.peers                Map<peerId, { id, profile, pose, lastSeen }>
//   net.join(room, profile)  进房间，profile 是宠物资料（见下），返回 Promise
//   net.leave()
//   net.send(type, payload)  广播一条消息
//   net.on(type, fn)         订阅：fn(payload, fromId)；返回取消订阅的函数
//   net.now()                房间时间（秒），用于对端插值
//   net.update(dt)           每帧调用（假对端靠它驱动；真实实现可以用来做心跳和超时）
//
// 消息种类（MSG）：
//   profile  { profile }                       进场 / 资料变化
//   leave    {}                                离场
//   pose     { x, z, heading, speed, action, muddy, t }   自己宠物的位置和动作，约每秒 10 次
//   cmd      { pounce?, dig?, interact? }      一次性的动作（对端播动画用）
//   emote    { id }                            表情：bark / wag / heart / sleepy / laugh
//   chat     { text }                          文字，发送前经过 sanitizeChat
//   world    { snapshot | delta }              只有房主发：管理员、动物、可互动物的状态
//   time     { hour, weather }                 只有房主发：农场时间
//
// 宠物资料 PetProfile：{ id, name, species: 'shiba', appearance: { ... }, owner: '' }
//   只包含宠物名和外观；不要往里放任何个人信息（账号、邮箱、机器名等）。
// 纯逻辑，不依赖 three / DOM。

export const MSG = Object.freeze({ PROFILE: 'profile', LEAVE: 'leave', POSE: 'pose', CMD: 'cmd', EMOTE: 'emote', CHAT: 'chat', WORLD: 'world', TIME: 'time' });
export const EMOTES = Object.freeze(['bark', 'wag', 'heart', 'sleepy', 'laugh']);
export const NET = Object.freeze({ POSE_HZ: 10, CHAT_MAX: 40, CHAT_PER_10S: 4, NAME_MAX: 12, PEER_TIMEOUT: 8 });

/** 聊天文字的基本清理：去掉控制字符和首尾空白、限长。以后接真实网络时在这里加屏蔽词 / 举报。 */
export function sanitizeChat(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NET.CHAT_MAX);
}
export function sanitizeProfile(p) {
  const o = p && typeof p === 'object' ? p : {};
  return {
    id: String(o.id || '').slice(0, 40),
    name: String(o.name || '小狗').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NET.NAME_MAX) || '小狗',
    species: o.species === 'shiba' ? 'shiba' : 'shiba',
    appearance: o.appearance && typeof o.appearance === 'object' ? { ...o.appearance } : {},
    owner: '',
  };
}
/** 默认的本机宠物资料（以后可以从设置里读名字和外观） */
export function defaultProfile(id = 'local') { return sanitizeProfile({ id, name: '小柴', species: 'shiba', appearance: {} }); }

function emitter() {
  const subs = new Map();
  return {
    on(type, fn) { if (!subs.has(type)) subs.set(type, []); subs.get(type).push(fn); return () => { const a = subs.get(type), i = a ? a.indexOf(fn) : -1; if (i >= 0) a.splice(i, 1); }; },
    emit(type, payload, from) { const a = subs.get(type); if (a) for (const fn of a.slice()) { try { fn(payload, from); } catch (_) { /* 订阅方出错不影响其他人 */ } } },
  };
}

/** 发言限频：10 秒内最多 NET.CHAT_PER_10S 条 */
function chatLimiter() {
  const times = [];
  return (now) => { while (times.length && now - times[0] > 10) times.shift(); if (times.length >= NET.CHAT_PER_10S) return false; times.push(now); return true; };
}

export function createLocalNet() {
  const em = emitter();
  let t = 0;
  const net = {
    kind: 'local', connected: false, selfId: 'local', isHost: true, peers: new Map(),
    join(room, profile) { net.connected = true; net.room = room || 'solo'; net.profile = sanitizeProfile({ ...profile, id: net.selfId }); return Promise.resolve(net); },
    leave() { net.connected = false; },
    send() { return true; },
    on: em.on,
    now: () => t,
    update(dt) { t += dt; },
  };
  return net;
}

/**
 * 假对端。bots：[{ name, path: [[x, z], ...], speed, emoteEvery, say: [...] }]；不给就用默认的两只。
 * 每只沿着自己的路线来回走，按 POSE_HZ 发 pose，隔一阵发个表情或一句话。确定性（不用随机数）。
 */
export function createMockNet({ bots = null } = {}) {
  const em = emitter();
  const canChat = chatLimiter();
  let t = 0, acc = 0;
  const defs = bots || [
    { name: '豆包', path: [[-20, 16], [-12, 18], [-4, 17], [-12, 18]], speed: 2.2, emoteEvery: 7, say: ['汪！', '一起玩吗'] },
    { name: '年糕', path: [[6, 8], [12, 4], [16, 10], [10, 12]], speed: 3.0, emoteEvery: 11, say: ['这里有萝卜'] },
  ];
  const sims = defs.map((d, i) => ({
    id: 'bot' + (i + 1), def: d, seg: 0, u: 0, x: d.path[0][0], z: d.path[0][1], heading: 0, emoteT: (i + 1) * 2.5, n: 0,
    profile: sanitizeProfile({ id: 'bot' + (i + 1), name: d.name, species: 'shiba', appearance: { tint: i } }),
  }));
  const net = {
    kind: 'mock', connected: false, selfId: 'local', isHost: true, peers: new Map(),
    join(room, profile) {
      net.connected = true; net.room = room || 'mock'; net.profile = sanitizeProfile({ ...profile, id: net.selfId });
      for (const b of sims) { net.peers.set(b.id, { id: b.id, profile: b.profile, pose: null, lastSeen: t }); em.emit(MSG.PROFILE, { profile: b.profile }, b.id); }
      return Promise.resolve(net);
    },
    leave() { for (const b of sims) em.emit(MSG.LEAVE, {}, b.id); net.peers.clear(); net.connected = false; },
    /** 自己发的消息：聊天要过清理和限频；其他的在假网络里没有接收方 */
    send(type, payload) {
      if (type === MSG.CHAT) { const text = sanitizeChat(payload && payload.text); if (!text || !canChat(t)) return false; }
      return true;
    },
    on: em.on,
    now: () => t,
    update(dt) {
      t += dt;
      if (!net.connected) return;
      for (const b of sims) {
        const p = b.def.path, a = p[b.seg], c = p[(b.seg + 1) % p.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
        b.u += (b.def.speed * dt) / len;
        if (b.u >= 1) { b.u = 0; b.seg = (b.seg + 1) % p.length; }
        b.x = a[0] + (c[0] - a[0]) * b.u; b.z = a[1] + (c[1] - a[1]) * b.u;
        b.heading = Math.atan2(c[0] - a[0], c[1] - a[1]);
        b.emoteT -= dt;
        if (b.emoteT <= 0) {
          b.emoteT = b.def.emoteEvery || 9; b.n++;
          if (b.n % 3 === 0 && b.def.say && b.def.say.length) em.emit(MSG.CHAT, { text: sanitizeChat(b.def.say[(b.n / 3 | 0) % b.def.say.length]) }, b.id);
          else em.emit(MSG.EMOTE, { id: EMOTES[b.n % EMOTES.length] }, b.id);
        }
      }
      acc += dt;
      if (acc >= 1 / NET.POSE_HZ) {
        acc = 0;
        for (const b of sims) {
          const pose = { x: b.x, z: b.z, heading: b.heading, speed: b.def.speed, action: 'run', muddy: false, t };
          const peer = net.peers.get(b.id); if (peer) { peer.pose = pose; peer.lastSeen = t; }
          em.emit(MSG.POSE, pose, b.id);
        }
      }
    },
  };
  return net;
}

export default createLocalNet;
