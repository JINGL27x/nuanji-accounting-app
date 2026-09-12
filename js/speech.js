// 语音识别 + 中文/英文 口语解析
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// 安卓 App 内的 WebView 不支持 Web Speech API，
// 此时用 App 注入的原生识别通道 window.AndroidSpeech（android.speech.SpeechRecognizer）
const ASR = (typeof window.AndroidSpeech !== 'undefined' && window.AndroidSpeech) || null;

// 是否跑在自己的 App 里：注入对象优先，UA 里的 NuanjiApp 标识兜底
const UA_TAG = /NuanjiApp\//.test(navigator.userAgent || '');
export const inApp = !!ASR || UA_TAG;
const NATIVE = !!ASR;

export const supported = inApp || !!SR;

// ========== 第 1 层：重复字清理（修「卡带」）==========
// 现象：流式神经网络模型在噪声、轻声、停顿处会「卡带」——同一个字连着吐好几遍。
//   实测例子：「打车二十五元」→「打车车二二十五元」
//            「坐飞机花了两万块」→「坐飞机预祝做做做做了两万块」
// 做法：把「同一个汉字连着出现 ≥2 次」压回 1 次；同时把「3~4 字词块连着重复」压回 1 次。
// 为什么需要白名单：汉语里很多叠字是正常词（谢谢、多多、看看、天天…），不能一律压掉。
const LEGIT_DOUBLE = new Set([
  // 称谓/昵称
  '爸', '妈', '哥', '姐', '弟', '妹', '宝', '娃', '乖', '亲', '星', '泡', '毛',
  // 时间/量词
  '天', '年', '月', '日', '夜', '时', '刻', '分', '秒', '次', '回', '遍',
  '人', '家', '户', '处', '个', '种', '各', '样', '件', '条', '张', '份', '本', '套', '对', '双', '群', '层', '重', '叠', '圈', '团', '方', '面', '头',
  // 常用动词/形容词叠用
  '等', '看', '想', '说', '讲', '试', '走', '转', '谈', '聊', '算', '查', '找', '帮', '问', '数', '坐', '歇',
  '慢', '轻', '悄', '渐', '好', '深', '远', '早', '紧', '频', '屡', '常', '刚', '多', '少', '大', '小', '高', '长', '短', '生', '死', '活',
  // 拟声/口语
  '谢', '滴', '哈', '呵', '嘻', '嘿', '碰',
]);

/** 清掉「卡带」造成的重复字 */
export function collapseRepeats(s) {
  let t = String(s || '');
  // ① 3~4 字的词块被整体重复（如「二十五二十五」），直接压成 1 份
  t = t.replace(/([\u4e00-\u9fa5]{3,4})\1+/g, '$1');
  // ② 同一个汉字连吐 ≥2 次 → 压成 1 次（白名单里的叠字保留 2 次）
  t = t.replace(/([\u4e00-\u9fa5])(?:\s*\1)+/g, (m, c) => (LEGIT_DOUBLE.has(c) ? c + c : c));
  return t;
}
// ========== 重复字清理结束 ==========

// ========== 第 2 层：误听纠正（记账场景高频词）==========
// 只收「明显听岔了、且改完一定更对」的词；自映射（A→A）这类无效规则不放。
const CORRECTIONS = [
  // —— 交通 ——
  [/法哥|发哥|法车|搭车|达车|打车车/g, '打车'],
  [/弟铁|地贴|第铁/g, '地铁'],
  [/滴答/g, '滴滴'],
  [/停车费/g, '停车'],
  [/过路费/g, '过路'],
  [/机票钱/g, '机票'],
  // —— 餐饮 ——
  [/午犯|五饭|午范|无饭/g, '午饭'],
  [/早翻|早反|找餐/g, '早餐'],
  [/晚翻|玩饭|碗饭/g, '晚饭'],
  [/来查|奶查|奈茶|奶菜/g, '奶茶'],
  [/外买|外迈|歪卖/g, '外卖'],
  [/夜霄|夜消/g, '夜宵'],
  [/吃反/g, '吃饭'],
  // —— 购物 ——
  [/潮是|超市市|吵市/g, '超市'],
  [/拼夕夕|拼朵朵/g, '拼多多'],
  // —— 居家/生活 ——
  [/水电费/g, '水电'],
  [/物业费/g, '物业'],
  [/燃汽/g, '燃气'],
  [/网费|网废/g, '网费'],
  // —— 收入 ——
  [/薪水|月薪|新水/g, '工资'],
  [/外块/g, '外快'],
  // —— 动词：本 App 最高频的两个动作 ——
  [/预祝做*了?/g, '花了'],
  [/花做了|花做+/g, '花了'],
  [/做做了/g, '做了'],
  [/收如|收人/g, '收入'],
  [/赚了|转到了/g, '赚'],
  // —— 量词归一 ——
  [/块钱/g, '块'],
  [/元钱/g, '元'],
];

/** 对语音识别结果做纠错，返回修正后的文本 */
export function correctText(raw) {
  let t = collapseRepeats(raw);        // 先清「卡带」重复
  for (const [re, replacement] of CORRECTIONS) {
    t = t.replace(re, replacement);
  }
  return collapseRepeats(t);           // 纠错替换后可能又带出重复，再清一遍
}
// ========== 纠错层结束 ==========

// 错误码 → 人话提示
const ERR_TEXT = {
  'unsupported': '这台设备没有可用的语音识别服务，请改用「手动记一笔」',
  'no-engine': '这台手机没有语音识别引擎。请到「设置 → 语音助手 / 无障碍」里开启语音服务，或点「手动记一笔」',
  'need-app': '语音记账要在「暖记账本」App 里用。你现在打开的是网页版，请回到桌面点「暖记账本」图标，或点「手动记一笔」',
  'error': '语音识别失败，请重试或改用手动记账',
  'not-allowed': '麦克风权限被拒绝，请允许后再试',
  'service-not-allowed': '麦克风权限被拒绝，请允许后再试',
  'audio-capture': '没检测到麦克风，请检查设备',
  'no-speech': '没听到声音，靠近麦克风再说一次',
  'aborted': '识别被中断，请再点一次麦克风',
  'network': '网络不通，语音识别需要联网',
  'bad-grammar': '识别出错，请重试',
  'language-not-supported': '该语言不支持，已改为中文',
  'no-device': '没检测到麦克风设备，请插上耳机或打开麦克风',
  'start-failed': '手机的语音服务连不上，App 会自己换一条路再试一次；若反复失败，请到「我的 → 语音识别自检」看看状态',
  'preparing': '语音引擎正在首次准备（大约十几秒），请稍等一下再点麦克风',
  'vosk-err': '内置语音识别没能启动，请再点一次麦克风；若反复失败请到「我的 → 语音识别自检」',
};
/** 把 diag() 的探测结果翻译成一句短的"缺什么"，便于定位问题 */
function diagSummary() {
  try {
    const d = JSON.parse((ASR && ASR.diag && ASR.diag()) || '{}');
    const asrOk = d.asr === 1 || d.vosk === 1; // asr=新字段，vosk=旧字段兼容
    const miss = [];
    if (!d.sys) miss.push('系统语音服务');
    if (!d.ondev) miss.push('系统离线识别');
    if (!d.intent) miss.push('语音输入界面');
    if (!asrOk) miss.push('内置离线引擎');
    return miss.length
      ? ('App 探测不到：' + miss.join('、') + '（安卓 ' + d.sdk + '）')
      : ('App v' + d.ver + '｜安卓 ' + d.sdk + '｜错误码 ' + (d.err || '无'));
  } catch (_) {
    return '';
  }
}

export function errText(code) {
  if (code === 'no-engine' && inApp) {
    const s = diagSummary();
    return ERR_TEXT['no-engine'] + (s ? '｜' + s : '');
  }
  return ERR_TEXT[code] || ('语音识别失败：' + code);
}

// 给用户看的「一句话体检」，先说结论，再说原因和建议
export function envText() {
  if (!inApp) {
    return '你现在打开的是网页版，语音记账用不了。\n'
      + '回到手机桌面，点「暖记账本」图标打开 App 就能用了。';
  }
  try {
    const d = JSON.parse((ASR && ASR.diag && ASR.diag()) || '{}');
    const asrOk = d.asr === 1 || d.vosk === 1;
    const preparing = d.asr === 0 || d.vosk === 0;
    const usable = !!(d.sys || d.ondev || d.intent || asrOk);
    const lines = [];
    lines.push('语音记账：' + (usable ? '可以用 ✔' : (preparing ? '正在准备，稍等再试' : '暂时用不了 ✘')));
    if (usable) lines.push('点一下首页的麦克风，说完再点一下就好。');
    else if (preparing) lines.push('第一次打开要先装好语音引擎，大约十几秒；装好以后不联网也能用。');
    lines.push('麦克风：' + (d.mic ? '已允许 ✔' : '还没允许（第一次点麦克风时会弹窗问你）'));
    if (asrOk) lines.push('语音引擎：已装好，不联网也能用 ✔');
    else if (preparing) lines.push('语音引擎：正在准备中…');
    else lines.push('语音引擎：没装好 ✘');
    if (!usable && !preparing) lines.push('别急，可以先点「手动记一笔」把账记上。若一直这样，把下面「详细诊断信息」截图发我。');
    return lines.join('\n');
  } catch (_) {
    return '暂时读不到语音状态，把 App 完全关掉再打开试试。';
  }
}

// 技术诊断信息（默认收起，排障/反馈时复制给对方看）
export function envTech() {
  if (!inApp) return '当前不在 App 里运行（网页版）。';
  try {
    const d = JSON.parse((ASR && ASR.diag && ASR.diag()) || '{}');
    const PATH_NAME = { sherpa: 'App 内置离线引擎', sys: '手机系统语音服务', ondev: '手机离线识别', intent: '系统语音输入界面' };
    return [
      '版本：v' + (d.ver || '?') + '（安卓 ' + (d.sdk || '?') + '）',
      '识别引擎：' + (d.engine || '未知'),
      '手机自带语音：' + ((d.sys || d.ondev || d.intent) ? '有' : '没有'),
      '上次识别用的通道：' + (PATH_NAME[d.path] || '还没用过'),
      '上次错误码：' + (d.err || '无')
    ].join('\n');
  } catch (_) {
    return '版本信息读取失败。';
  }
}

// 预检麦克风权限，返回 'granted' | 'denied' | 'prompt' | 'unknown'
export async function checkMic() {
  if (NATIVE) {
    try { return ASR.micState() || 'prompt'; } catch (_) { return 'prompt'; }
  }
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const s = await navigator.permissions.query({ name: 'microphone' });
      return s.state;
    }
  } catch (_) {}
  return 'unknown';
}

// 走 App 原生识别（sherpa-onnx 流式，结果通过 window.__asr 回调）
// 关键时序：原生通道在 stop() 之后才回调 onFinal（那才是本次听写的最终结果），
// 所以「停止后到达的 onFinal 必须交付」，不能因为已 stopped 就丢掉，否则卡片永远不弹。
function nativeListen({ lang = 'zh-CN', onPartial, onFinal, onError }) {
  let stopped = false;    // 用户已点停止（此后不再要 partial）
  let delivered = false;  // 最终结果只交付一次
  window.__asr = {
    onReady() {},
    // 实时结果也先过一遍纠错/去重，免得屏幕上滚动一堆重复字
    onPartial(t) { if (!stopped && t) onPartial && onPartial(correctText(t)); },
    onFinal(t) {
      if (delivered) return;
      delivered = true;
      // 纠错后再交付（即使是空串也交付，让界面复位）
      onFinal && onFinal(correctText(String(t || '')).trim());
    },
    onError(code) {
      if (delivered) return;
      delivered = true;
      if (['start-failed', 'vosk-err', 'preparing', 'error', 'network'].includes(code)) {
        onError && onError(code || 'error');
      } else {
        onFinal && onFinal(''); // 非致命错误：复位界面即可
      }
    },
  };
  try {
    ASR.start(lang);
  } catch (_) {
    window.__asr.onError('start-failed');
  }
  return {
    stop() { stopped = true; try { ASR.stop(); } catch (_) {} },
  };
}

export function listen({ lang = 'zh-CN', onPartial, onFinal, onError }) {
  // 在 App 内一律走原生通道（WebView 里的 Web Speech API 多半只是摆设）
  if (NATIVE) return nativeListen({ lang, onPartial, onFinal, onError });
  // 在 App 里（UA 有标识）却没拿到注入对象 → 说明是旧版 App，提示升级
  if (UA_TAG) { onError && onError('no-engine'); return null; }
  if (!SR) { onError && onError('need-app'); return null; }
  const rec = new SR();
  rec.lang = lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  let done = false;      // 已交付最终结果
  let cancelled = false; // 用户主动停止，丢弃结果
  let lastText = '';     // 累计听到的内容（含中间结果），用于兜底
  rec.onresult = (e) => {
    let final = '', interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
    }
    const combined = (final + interim).trim();
    if (combined) lastText = combined;
    if (interim) onPartial && onPartial(correctText(interim));
    if (final) { done = true; onFinal && onFinal(correctText(final).trim()); }
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech') lastText = ''; // 真没听到，清空兜底
    const fatal = !['no-speech', 'aborted'].includes(e.error);
    if (fatal) done = true;
    onError && onError(e.error || 'error');
  };
  rec.onend = () => {
    if (done || cancelled) return;
    // 关键修复：有些浏览器结束时最后一段仍是「中间结果」，
    // 此时用已累计听到的内容兜底，保证仍能弹出记录卡片。
    onFinal && onFinal(correctText(lastText));
  };
  try { rec.start(); } catch (_) { onError && onError('start-failed'); }
  return { stop() { cancelled = true; try { rec.stop(); } catch (_) {} } };
}

// 中文数字 → 数值（支持 十/百/千/万/亿）
const DIGIT = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
const SMALL_UNIT = { '十': 10, '百': 100, '千': 1000 };
const BIG_UNIT = { '万': 10000, '亿': 100000000 };

// 单个中文数字串 → 数值，例如 一千万 → 10000000、二十五 → 25
function cnTokenToNum(str) {
  let total = 0;    // 亿/万以上累计
  let section = 0;  // 当前段（万以下）
  let number = 0;   // 当前个位数字
  let lastUnit = 0; // 最近一次出现的单位（含万/亿），用于口语简写
  let seenZero = false;
  for (const ch of str) {
    if (ch === '零') { seenZero = true; number = 0; }
    else if (DIGIT[ch] !== undefined) { number = DIGIT[ch]; }
    else if (SMALL_UNIT[ch] !== undefined) {
      section += (number || 1) * SMALL_UNIT[ch];
      lastUnit = SMALL_UNIT[ch]; number = 0; seenZero = false;
    } else if (BIG_UNIT[ch] !== undefined) {
      section += number; number = 0;
      if (ch === '万') total += section * 10000;
      else total = (total + section) * 100000000;
      lastUnit = BIG_UNIT[ch]; section = 0; seenZero = false;
    }
  }
  // 口语简写：一千二=1200、两千五=2500、三万五=35000（但一百零五=105 不适用）
  if (number > 0 && lastUnit > 10 && !seenZero) {
    section += number * (lastUnit / 10);
    number = 0;
  }
  return total + section + number;
}

// 从整句里挑出中文数字串，取其中最大的一个作为金额
function parseCN(s) {
  const segs = s.match(/[零一二两三四五六七八九十百千万亿]+/g);
  if (!segs) return 0;
  let best = 0;
  for (const seg of segs) {
    const v = cnTokenToNum(seg);
    if (v > best) best = v;
  }
  return best;
}

const EXPENSE_KW = {
  '餐饮': ['吃', '饭', '餐', '午', '早', '晚', '夜宵', '宵夜', '面条', '面', '米饭', '火锅', '外卖', '咖啡', '奶茶', '小吃', '零食', '菜', '食堂', '餐厅', '饭店', '烧烤', '快餐', '点心', '水果', '饮料', '买菜'],
  '交通': ['车', '地铁', '公交', '打车', '出租', '打的', '网约车', '滴滴', '油', '加油', '高铁', '火车', '飞机', '机票', '航班', '机场', '坐飞机', '飞行', '停车', '过路', '单车', '共享单车', '船', '轮渡', '高速'],
  '购物': ['买', '购', '衣', '鞋', '包', '超市', '商城', '淘宝', '京东', '拼多多', '日用品', '百货', '快递', '网购', '化妆品', '数码'],
  '居家': ['房租', '水电', '水费', '电费', '物业', '燃气', '宽带', '家居', '家具', '家电', '装修', '打扫', '取暖', '暖气', '车位', '保洁'],
  '娱乐': ['电影', '游戏', '唱', 'ktv', '游玩', '票', '演出', '展览', '健身', '运动', '网吧', '密室', '剧本杀', '按摩'],
  '医疗': ['药', '医', '医院', '看病', '诊所', '体检', '挂号', '牙', '牙医', '药店', '药房', '打针', '疫苗'],
  '教育': ['书', '课', '学', '培训', '学费', '补习', '考试', '文具', '网课', '书本', '教材', '辅导'],
  '人情': ['红包', '礼', '随礼', '份子', '请客', '生日', '结婚', '满月', '随份子'],
  '通讯': ['话费', '流量', '网费', '手机费', '宽带费', '电话费'],
  '旅行': ['旅游', '旅行', '出游', '景点', '酒店', '住宿', '门票', '民宿', '跟团'],
  '宠物': ['猫', '狗', '宠', '粮', '猫粮', '狗粮', '宠物医院', '驱虫'],
};
const INCOME_KW = {
  '工资': ['工资', '薪水', '月薪', '发工资'],
  '兼职': ['兼职', '外快', '零工', '接单'],
  '理财': ['理财', '利息', '基金', '股票', '分红', '收益', '股息'],
};
const INCOME_TYPE_KW = ['收入', '工资', '赚', '进账', '入账', '奖金', '分红', '利息'];

export function parse(text, categories) {
  const t = (text || '').toLowerCase();
  let amount = null;
  // 取整句中「最大」的金额数字，并跳过日期/时间（9月10号、下午3点…）
  let best = null;
  const NUM_RE = /(\d+(?:\.\d{1,2})?)\s*(亿|万|千)?/g;
  let mm;
  while ((mm = NUM_RE.exec(t)) !== null) {
    const after = t.slice(mm.index + mm[0].length, mm.index + mm[0].length + 1);
    if (after && '年月日号点时分'.includes(after)) continue; // 跳过日期/时间
    let v = parseFloat(mm[1]);
    const u = mm[2];
    if (u === '亿') v *= 100000000;
    else if (u === '万') v *= 10000;
    else if (u === '千') v *= 1000;
    if (best === null || v > best) best = v;
  }
  if (best !== null) amount = best;
  else { const cn = parseCN(t); if (cn > 0) amount = cn; }

  let type = 'expense';
  if (INCOME_TYPE_KW.some((k) => t.includes(k))) type = 'income';

  // 打分制：所有分类都扫一遍，选关键词命中最多的（不再先到先得）
  const map = type === 'income' ? INCOME_KW : EXPENSE_KW;
  let bestName = null, bestScore = 0;
  for (const name in map) {
    let score = 0;
    for (const kw of map[name]) {
      if (t.includes(kw)) score += kw.length; // 长关键词权重更高，避免单字"买"抢走"狗粮"
    }
    if (score > bestScore) { bestScore = score; bestName = name; }
  }
  let categoryId = null;
  if (bestName) {
    const c = categories.find((x) => x.type === type && x.name === bestName && !x.hidden);
    if (c) categoryId = c.id;
  }
  if (!categoryId) {
    const fallback = categories.find((x) => x.type === type && !x.hidden);
    if (fallback) categoryId = fallback.id;
  }
  return { amount, type, categoryId, categoryName: bestName };
}
