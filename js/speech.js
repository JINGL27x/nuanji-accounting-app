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
    const miss = [];
    if (!d.sys) miss.push('系统语音服务');
    if (!d.ondev) miss.push('系统离线识别');
    if (!d.intent) miss.push('语音输入界面');
    if (d.vosk !== 1) miss.push('内置离线引擎');
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

// 运行环境说明，供「我的 → 语音自检」显示
export function envText() {
  if (!inApp) {
    return '当前运行环境：网页版（浏览器或"添加到主屏幕"）。这里没有语音识别接口，语音记账用不了，请点桌面的「暖记账本」图标打开 App。';
  }
  try {
    const d = JSON.parse((ASR && ASR.diag && ASR.diag()) || '{}');
    const parts = [];
    parts.push('运行环境：暖记账本 App v' + (d.ver || '?') + '（安卓 ' + (d.sdk || '?') + '）');
    parts.push('麦克风权限：' + (d.mic ? '已授权 ✔' : '还没授权，第一次点麦克风时会弹窗问你'));
    parts.push('手机自带语音服务：' + ((d.sys || d.ondev || d.intent) ? '有 ✔' : '没有（国产手机常见，不影响使用）'));
    if (d.vosk === 1) parts.push('App 内置离线语音：就绪 ✔（不联网也能用）');
    else if (d.vosk === 0) parts.push('App 内置离线语音：首次准备中，约十几秒');
    else parts.push('App 内置离线语音：加载失败 ✘');
    parts.push('语音记账是否可用：' + ((d.sys || d.ondev || d.intent || d.vosk === 1) ? '可以用 ✔' : '暂时用不了 ✘'));
    parts.push('最近一次错误码：' + (d.err || '无'));
    return parts.join('\n');
  } catch (_) {
    return '运行环境：暖记账本 App（版本信息读取失败）';
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

// 走 App 原生识别（AndroidSpeech.start / stop，结果通过 window.__asr 回调）
function nativeListen({ lang = 'zh-CN', onPartial, onFinal, onError }) {
  let finished = false;
  window.__asr = {
    onReady() {},
    onPartial(t) { if (!finished && t) onPartial && onPartial(t); },
    onFinal(t) {
      if (finished) return;
      finished = true;
      if (t && String(t).trim()) onFinal && onFinal(String(t).trim());
      else onError && onError('no-speech');
    },
    onError(code) {
      if (finished) return;
      finished = true;
      onError && onError(code || 'error');
    },
  };
  try {
    ASR.start(lang);
  } catch (_) {
    window.__asr.onError('start-failed');
  }
  return {
    stop() { finished = true; try { ASR.stop(); } catch (_) {} },
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
    if (interim) onPartial && onPartial(interim);
    if (final) { done = true; onFinal && onFinal(final.trim()); }
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
    onFinal && onFinal(lastText);
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
  '餐饮': ['吃', '饭', '餐', '午', '早', '晚', '夜宵', '面条', '面', '米饭', '火锅', '外卖', '咖啡', '奶茶', '小吃', '零食', '菜', '宵夜'],
  '交通': ['车', '地铁', '公交', '打车', '出租', '油', '高铁', '火车', '机票', '飞行', '停车', '过路', '加油', '滴滴'],
  '购物': ['买', '购', '衣', '鞋', '包', '超市', '商城', '淘宝', '京东', '拼多多', '日用品', '百货'],
  '居家': ['房租', '水电', '物业', '燃气', '宽带', '家居', '家具', '家电', '装修', '打扫'],
  '娱乐': ['电影', '游戏', '唱', 'ktv', '游玩', '票', '演出', '展览', '健身', '运动', '网吧'],
  '医疗': ['药', '医', '医院', '看病', '诊所', '体检', '挂号', '牙'],
  '教育': ['书', '课', '学', '培训', '学费', '补习', '考试', '文具'],
  '人情': ['红包', '礼', '随礼', '份子', '请客', '生日', '结婚', '满月'],
  '通讯': ['话费', '流量', '网费', '手机费'],
  '旅行': ['旅游', '旅行', '出游', '景点', '酒店', '住宿', '门票'],
  '宠物': ['猫', '狗', '宠', '粮'],
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
