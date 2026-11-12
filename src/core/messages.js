// 漂流瓶里的寄语。与游戏逻辑解耦：只提供一个可扩展的列表和 pickMessage()。
// 每条：{ id, text, from?, when? }
//   id    唯一标识（图鉴 / “看过的寄语”都靠它）
//   text  寄语正文
//   from  署名（可省略；没有署名时界面只显示正文）
//   when  可省略 = 任何时候都可能出现；否则只在满足条件的日子出现（并且那一天会被优先挑选）：
//         { md: '12-25' }                         某一天（月-日）
//         { from: '12-20', to: '12-26' }          一段日期（含首尾，可跨年：'12-28' ～ '01-03'）
//         { months: [6, 7, 8] }                   某些月份
//         { weekdays: [0, 6] }                    星期几（0 = 周日）
// 以后换成正式文案时，只改这个文件里的 MESSAGES（或在运行时 MESSAGES.push(...)）。
import { mulberry32 } from './util.js';

export const MESSAGES = [
  { id: 'm01', text: '今天也辛苦啦。先喝口水，再摸摸小柴的头吧。', from: '漂流瓶' },
  { id: 'm02', text: '风很轻，云很慢，你不用着急。', from: '远处的风' },
  { id: 'm03', text: '给今天的你一根看不见的小骨头：奖励你努力过。', from: '小柴' },
  { id: 'm04', text: '如果事情太多，就先做最小的那一件。' },
  { id: 'm05', text: '池塘里的小鱼说：你笑起来的时候，水面也会亮一点。', from: '小金鱼' },
  { id: 'm06', text: '不管今天过得怎么样，这座小岛都给你留着一块晒太阳的草地。', from: '小岛' },
  { id: 'm07', text: '汪！（翻译：我在这儿，哪儿也不去。）', from: '小柴' },
  { id: 'm08', text: '深呼吸三次。好，现在你比刚才轻松一点点了。' },
  { id: 'm09', text: '有些烦恼像水草，甩一甩就掉了。', from: '被甩了半天的水草' },
  { id: 'm10', text: '记得抬头看看天，云今天特意为你换了形状。', from: '云' },
  { id: 'm11', text: '你已经做得很好了，真的。', from: '一位路过的朋友' },
  { id: 'm12', text: '捡到这个瓶子的人，今天会遇到一件小小的好事。', from: '瓶子的上一位主人' },
  { id: 'm13', text: '先吃点好吃的，剩下的问题明天再说。', from: '小柴的肚子' },
  { id: 'm14', text: '每一次钓上来的都不一样，生活也是。慢慢来。' },
  { id: 'm15', text: '听说今天适合发呆十分钟。别告诉别人。', from: '青蛙' },
  { id: 'm16', text: '你值得被好好对待，包括被你自己。' },
  { id: 'm17', text: '小岛的萤火虫晚上会替你守夜，放心睡。', from: '萤火虫' },
  { id: 'm18', text: '摸摸头，给你一点勇气。', from: '小柴' },
  { id: 'm19', text: '谢谢你今天来看我，我把最好的一片荷叶留给你。', from: '荷叶' },
  { id: 'm20', text: '愿你的每一个明天，都有尾巴摇得停不下来的好心情。', from: '小柴' },
  // 带日期的示例（占位）：正式文案可以按这个格式继续加
  { id: 'd-newyear', text: '新的一年，从这个瓶子开始：愿你顺顺利利，岁岁平安。', from: '小柴', when: { from: '12-31', to: '01-02' } },
  { id: 'd-xmas', text: '圣诞快乐！小柴给你留了一块姜饼形状的云。', from: '小柴', when: { from: '12-24', to: '12-25' } },
  { id: 'd-weekend', text: '周末啦，今天什么都不用赶，陪小柴晒晒太阳吧。', from: '小岛', when: { weekdays: [0, 6] } },
];

/** 把 Date / 'YYYY-MM-DD' / 毫秒数 统一成 { y, m, d, wd }；无法识别时用今天 */
export function parseDate(date) {
  let dt = null;
  if (date instanceof Date) dt = date;
  else if (typeof date === 'number') dt = new Date(date);
  else if (typeof date === 'string') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date);
    if (m) dt = new Date(+m[1], +m[2] - 1, +m[3]);
  }
  if (!dt || Number.isNaN(dt.getTime())) dt = new Date();
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), wd: dt.getDay() };
}

/** 本地日期字符串 YYYY-MM-DD（用于“今天是否已出过瓶”之类的记录） */
export function dateKey(date) {
  const t = parseDate(date);
  return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
}

const md = (s) => { const [a, b] = String(s).split('-').map((n) => parseInt(n, 10)); return (a || 0) * 100 + (b || 0); };

/** 这条寄语今天能不能出：没有 when = 能；有 when = 必须满足其中写出的全部条件 */
export function matchesWhen(when, t) {
  if (!when) return true;
  const today = t.m * 100 + t.d;
  if (when.md !== undefined && md(when.md) !== today) return false;
  if (when.from !== undefined || when.to !== undefined) {
    const a = md(when.from !== undefined ? when.from : '01-01'), b = md(when.to !== undefined ? when.to : '12-31');
    const inside = a <= b ? today >= a && today <= b : today >= a || today <= b; // a > b：跨年
    if (!inside) return false;
  }
  if (Array.isArray(when.months) && !when.months.includes(t.m)) return false;
  if (Array.isArray(when.weekdays) && !when.weekdays.includes(t.wd)) return false;
  return true;
}

/**
 * 挑一条寄语。
 *  rng   () => [0,1)；缺省用“日期”做种子的确定性随机（同一天同一 seed 结果相同）
 *  date  Date | 'YYYY-MM-DD' | 毫秒数，缺省 = 今天
 *  seen  已经看过的 id（数组 / Set）：优先返回没看过的；全看过了才重复
 *  list  候选列表，缺省 MESSAGES
 * 规则：今天“有日期条件且正好满足”的寄语优先（其中再优先没看过的）；其余再从无条件 / 满足条件的里面挑。
 */
export function pickMessage({ rng, date, seen, list = MESSAGES } = {}) {
  const t = parseDate(date);
  const r = typeof rng === 'function' ? rng : mulberry32(t.y * 10000 + t.m * 100 + t.d);
  const seenSet = seen instanceof Set ? seen : new Set(Array.isArray(seen) ? seen : []);
  const ok = list.filter((m) => m && m.id !== undefined && typeof m.text === 'string' && matchesWhen(m.when, t));
  if (!ok.length) return null;
  const dated = ok.filter((m) => m.when);
  const fresh = (arr) => arr.filter((m) => !seenSet.has(m.id));
  // 今天专属的寄语：还有没看过的就一定出它；否则（都看过了）回到普通池
  let pool = fresh(dated);
  if (!pool.length) {
    const plain = ok.filter((m) => !m.when);
    pool = fresh(plain);
    if (!pool.length) pool = plain.length ? plain : ok;
  }
  return pool[Math.min(pool.length - 1, Math.floor(r() * pool.length))];
}

export default pickMessage;
