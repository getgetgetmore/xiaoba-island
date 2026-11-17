// URL 参数解析。Node 下（无 location）返回默认值。

const WEATHERS = ['clear', 'cloudy', 'rain', 'storm'];
const FOCUS = ['dog', 'kennel', 'lawn'];

export function defaultParams() {
  return {
    hour: null, // number | null（null = 跟随系统时间）
    weather: null, // 'clear'|'cloudy'|'rain'|'storm'|null（null = 自动）
    timescale: 1,
    seed: 20240601,
    brain: true, // brain=off → false
    action: null, // string | null
    focus: null, // 'dog'|'kennel'|'lawn'|null
    panel: false,
    nopause: false, // 调试：标签页不可见时也继续渲染（截图工具使用）
    fx: true, // 手绘后处理（fx=0 关闭，对比用）
    fps: 0, // 帧率：0 = 自适应（空闲 30、操作时 60），30 / 60 = 强制
    backdrop: null, // 背景画面：null = 按窗口大小自动（小窗口只留小岛），0 = 始终只留小岛，1 = 始终完整画面
    game: null, // 调试：game=farm | fishing 启动后自动开始农场 / 钓鱼小游戏（game=walk 是 farm 的旧名）
    farmNet: null, // 调试：farmNet=mock 农场里加几只本机模拟的“别人的宠物”（验证联机接口用）
    gameT: null, // 调试：gameT=<秒> 把游戏时间快进到指定秒数（自动驾驶，只在带 game 参数时生效）
    egret: null, // 调试：egret=visit 白鹭现在来一趟 | ride 来了并带小狗出门 | away 直接进入“小狗出门了”的状态
  };
}

/** @param {string} [search] 形如 "?hour=18&weather=rain"；省略时读取 location.search（若存在） */
export function parseParams(search) {
  const out = defaultParams();
  if (search === undefined) {
    search = typeof location !== 'undefined' && location && typeof location.search === 'string' ? location.search : '';
  }
  if (!search) return out;
  const q = new URLSearchParams(search);

  if (q.has('hour')) {
    const h = parseFloat(q.get('hour'));
    if (Number.isFinite(h)) out.hour = ((h % 24) + 24) % 24;
  }
  if (q.has('weather')) {
    const w = q.get('weather');
    if (WEATHERS.includes(w)) out.weather = w;
  }
  if (q.has('timescale')) {
    const t = parseFloat(q.get('timescale'));
    if (Number.isFinite(t) && t > 0) out.timescale = t;
  }
  if (q.has('seed')) {
    const s = parseInt(q.get('seed'), 10);
    if (Number.isFinite(s)) out.seed = s;
  }
  if (q.get('brain') === 'off') out.brain = false;
  if (q.has('action') && q.get('action')) {
    out.action = q.get('action');
    out.brain = false; // action 隐含 brain=off
  }
  if (q.has('focus')) {
    const f = q.get('focus');
    if (FOCUS.includes(f)) out.focus = f;
  }
  if (q.get('nopause') === '1') out.nopause = true;
  if (q.get('fx') === '0' || q.get('fx') === 'off' || q.get('fx') === 'false') out.fx = false;
  if (q.get('fps') === '60') out.fps = 60;
  else if (q.get('fps') === '30') out.fps = 30;
  if (q.get('backdrop') === '0') out.backdrop = 0;
  else if (q.get('backdrop') === '1') out.backdrop = 1;
  if (q.get('game') === 'walk' || q.get('game') === 'farm') out.game = 'farm';
  if (q.get('farmNet') === 'mock') out.farmNet = 'mock';
  else if (q.get('game') === 'fishing') out.game = 'fishing';
  if (['visit', 'ride', 'away'].includes(q.get('egret'))) out.egret = q.get('egret');
  if (q.has('gameT')) {
    const gt = parseFloat(q.get('gameT'));
    if (Number.isFinite(gt) && gt >= 0) out.gameT = Math.min(gt, 179.99);
  }
  if (q.has('panel')) {
    const p = q.get('panel');
    out.panel = p === '1' || p === 'true' || p === '';
  }
  return out;
}

export default parseParams;
