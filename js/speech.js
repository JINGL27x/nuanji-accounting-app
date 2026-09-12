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

// 苹果设备：iPhone / iPad / iPod；iPadOS 13+ 的 UA 伪装成 Mac，靠触点数认出来
export const APPLE_MOBILE = (() => {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 1);
})();

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
  'need-model': '语音引擎还没下载。到「我的 → 语音记账自检」点「下载语音引擎」就能用了（约 198MB，下载一次以后不再需要）',
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
    // 苹果的 Safari（含「添加到主屏幕」后）自带 webkitSpeechRecognition，
    // 所以网页版在 iPhone 上是能语音记账的，别一律报「用不了」。
    if (SR) {
      return '语音记账：可以用 ✔（用的是苹果自带的语音识别）\n'
        + '点一下首页的麦克风开始说，说完再点一下它就替你记上。\n'
        + '中间可以停一下再接着说，能连着记好几笔。\n'
        + '第一次点会弹窗问麦克风权限，点「允许」。\n'
        + '注意：苹果这套是要联网的，不像安卓版那样完全离线。';
    }
    return '你现在打开的是网页版，语音记账用不了。\n'
      + '回到手机桌面，点「暖记账本」图标打开 App 就能用了。';
  }
  try {
    const d = JSON.parse((ASR && ASR.diag && ASR.diag()) || '{}');
    const asrOk = d.asr === 1 || d.vosk === 1;
    const preparing = d.asr === 0 || d.vosk === 0;
    const needModel = d.asr === 3;
    const usable = !!(d.sys || d.ondev || d.intent || asrOk);
    const pct = Number(d.mPct || 0);
    const lines = [];
    lines.push('语音记账：' + (usable ? '可以用 ✔'
      : (needModel ? '要先下载语音引擎' : (preparing ? '正在装语音引擎，稍等' : '暂时用不了 ✘'))));
    if (usable) lines.push('点一下首页的麦克风，说完再点一下就好。');
    else if (needModel) {
      lines.push('语音引擎还没下载（约 198MB，建议连 WiFi）。点下面的「下载语音引擎」，');
      lines.push('下载一次以后就一直能用，以后不用再下，也不联网也能用。');
    } else if (preparing) {
      lines.push(pct > 0
        ? '正在下载语音引擎，当前 ' + pct + '%。建议连 WiFi，中途别关 App。'
        : '正在装语音引擎，稍等一下。');
    }
    lines.push('麦克风：' + (d.mic ? '已允许 ✔' : '还没允许（第一次点麦克风时会弹窗问你）'));
    if (asrOk) lines.push('语音引擎：已装好，不联网也能用 ✔');
    else if (needModel) lines.push('语音引擎：还没下载（约 198MB）');
    else if (preparing) lines.push(pct > 0 ? '语音引擎：正在下载 ' + pct + '%…' : '语音引擎：准备中…');
    else lines.push('语音引擎：没装好 ✘');
    if (!usable && !preparing && !needModel) {
      lines.push('别急，可以先点「手动记一笔」把账记上。若一直这样，把下面「详细诊断信息」截图发我。');
    }
    return lines.join('\n');
  } catch (_) {
    return '暂时读不到语音状态，把 App 完全关掉再打开试试。';
  }
}

/** 是否还没下载语音模型（需要在界面上引导用户下载） */
export function needModel() {
  if (!inApp) return false;
  try {
    const d = JSON.parse((ASR && ASR.diag && ASR.diag()) || '{}');
    return d.asr === 3;
  } catch (_) {
    return false;
  }
}

/** 触发原生下载语音模型（约 198MB） */
export function startModelDownload() {
  if (ASR && typeof ASR.downloadModel === 'function') {
    ASR.downloadModel();
    return true;
  }
  return false;
}

// 技术诊断信息（默认收起，排障/反馈时复制给对方看）
export function envTech() {
  if (!inApp) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent || '');
    const stand = typeof navigator !== 'undefined' && navigator.standalone === true;
    return '当前不在 App 里运行（网页版' + (ios ? ' · ' + (stand ? '已加到主屏幕' : 'Safari 里打开') : '') + '）。'
      + '\n平台：' + (ios ? 'iOS' : '其他') + '｜浏览器语音识别：' + (SR ? '有' : '没有');
  }
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
  // 苹果设备：Safari 的 Web Speech API 会「假死」且不报错，得专门伺候（见 appleListen）
  if (APPLE_MOBILE) return appleListen({ lang, onPartial, onFinal, onError });
  return webListen({ lang, onPartial, onFinal, onError });
}

// ===== 苹果专用：连续听写 =====
// Safari 的 Web Speech API 有三个坑，而且**没有一个会报错**，所以必须自己补一层：
//   ① continuous=false 并不会在静音时真正停止（WebKit 里它只管「要不要清空历史」），
//      所以其实能一直听 —— 这反而让「一口气说好几笔」成为可能。
//   ② transcript 累积太久会被限流、开始识别不准。
//   ③ 最要命的「假死」：识别到一半突然不吐字了，既不触发 onend 也不触发 onerror，
//      地址栏麦克风图标还亮着，看着在听其实已经死了。
// 对策：自己维护累积文本（不依赖浏览器历史）+ 看门狗 + 判定假死后程序化重启。
// 参考：业界做 iOS Safari 连续听写的通行做法（状态机 + watchdog）。
function appleListen({ lang = 'zh-CN', onPartial, onFinal, onError }) {
  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let acc = '';          // 已定稿的内容（自己累积，不靠浏览器历史）
  let pending = '';      // 当前这半句还没定稿的中间结果
  let phase = 'run';     // run=在听 / reboot=重启中 / done=已结束
  let lastHeard = Date.now();
  let everHeard = false;
  let restarts = 0;
  let heardSinceBoot = false; // 本次重听之后是否听到过东西
  let blindBoots = 0;         // 连续「重新起来却什么也没听到」的次数（防止空转）
  const startedAt = Date.now();

  const IDLE_HEARD = 7000;   // 听过之后这么久没动静 → 判定假死
  const IDLE_NEVER = 20000;  // 从头到尾没开口 → 收工
  const TOTAL_MAX = 150000;  // 总时长上限，别让它跑一整天
  const REBOOT_MAX = 40;     // 重启次数上限

  let wd = null;     // 看门狗定时器
  let bootTimer = null;

  const full = () => ((acc ? acc + ' ' : '') + pending).trim();

  function emit() {
    if (phase === 'done') return;
    const t = full();
    if (t) onPartial && onPartial(correctText(t));
  }

  function finish(err) {
    if (phase === 'done') return;
    phase = 'done';
    clearTimeout(wd); wd = null;
    clearTimeout(bootTimer); bootTimer = null;
    // Safari 的怪毛病：光 stop() 麦克风还亮着，要先在一次 try start 之后 stop 才真释放
    try { rec.start(); } catch (_) { }
    try { rec.stop(); } catch (_) { }
    const t = full();
    if (t) { onFinal && onFinal(correctText(t).trim()); }
    else { onError && onError(err || 'no-speech'); }
  }

  // 安排一次「重新起来听」。为什么要算 blindBoots：
  // 如果每次起来都什么也听不到（比如 iOS 要求每次开始都要用户手势），
  // 就会变成「起来 → 结束 → 再起来」的空转死循环，务必踩刹车。
  function scheduleBoot(delay) {
    if (phase === 'done') return;
    if (!heardSinceBoot) {
      blindBoots++;
      if (blindBoots >= 3) { finish(everHeard ? null : 'start-failed'); return; }
    }
    restarts++;
    clearTimeout(bootTimer);
    bootTimer = setTimeout(() => {
      bootTimer = null;
      if (phase === 'reboot') startRec();
    }, delay);
  }

  function startRec() {
    if (phase === 'done') return;
    try {
      rec.start();
      phase = 'run';
      heardSinceBoot = false;
      lastHeard = Math.max(lastHeard, Date.now() - 3000); // 给点余量，别刚起来就被判死
    } catch (_) {
      // 起不来多半是 iOS 要求每次开始都要用户手势 → 没法自动续命，把已听到的交出去
      finish('start-failed');
    }
  }

  function reboot() {
    if (phase !== 'run') return;
    phase = 'reboot';
    try { rec.stop(); } catch (_) { }
    scheduleBoot(900); // 正常情况靠 onend 立刻重启；onend 不来时由这个定时器兜底
  }

  rec.onresult = (e) => {
    let fin = '', interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) fin += r[0].transcript; else interim += r[0].transcript;
    }
    if (interim) { pending = interim; lastHeard = Date.now(); emit(); }
    if (fin) {
      const t = String(fin).trim();
      if (t) { acc = acc ? acc + ' ' + t : t; heardSinceBoot = true; blindBoots = 0; }
      pending = ''; lastHeard = Date.now(); everHeard = true;
      emit();
    }
  };

  rec.onerror = (e) => {
    const code = (e && e.error) || 'error';
    // not-allowed / service-not-allowed：权限或系统不给用，重启也没戏，直接收工
    if (code === 'not-allowed' || code === 'service-not-allowed') { finish(code); return; }
    // aborted / no-speech 是常态（我们自己 stop 也会报），交给看门狗处理即可
    if (code === 'aborted' || code === 'no-speech') return;
    if (phase === 'run') reboot();
  };

  rec.onend = () => {
    if (phase === 'done') return;
    if (phase === 'reboot') {
      clearTimeout(bootTimer); bootTimer = null;
      setTimeout(startRec, 250);
      return;
    }
    // 浏览器自己结束了（一句话听完了）。为了能接着说下一句，继续起来听。
    phase = 'reboot';
    scheduleBoot(400);
  };

  wd = setInterval(() => {
    if (phase === 'done') return;
    const idle = Date.now() - lastHeard;
    const aged = Date.now() - startedAt;
    if (!everHeard && idle > IDLE_NEVER) { finish('no-speech'); return; }
    if (aged > TOTAL_MAX || restarts > REBOOT_MAX) { finish(null); return; }
    if (phase === 'run' && idle > IDLE_HEARD) reboot();
  }, 1000);

  try { rec.start(); } catch (_) { finish('start-failed'); }

  return {
    stop() {
      if (phase === 'done') return;
      phase = 'done';
      clearTimeout(wd); wd = null;
      clearTimeout(bootTimer); bootTimer = null;
      try { rec.start(); } catch (_) { }
      try { rec.stop(); } catch (_) { }
      const t = full();
      onFinal && onFinal(correctText(t || '').trim());
    },
  };
}
// ===== 苹果专用结束 =====

/** 普通浏览器路径（Chrome 等）：静音后浏览器自己会 end，一句话即最终稿 */
function webListen({ lang = 'zh-CN', onPartial, onFinal, onError }) {
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
const INCOME_TYPE_KW = ['收入', '工资', '赚', '进账', '入账', '奖金', '分红', '利息', '收'];

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
  if (!categoryId) categoryId = catIdFor(categories, type, null);
  return { amount, type, categoryId, categoryName: bestName };
}

// ========== 判分类的公共零件（parse / parseMulti 共用）==========
/** 给一段文字打分，选出命中最狠的分类名 */
function bestCat(text, type) {
  const map = type === 'income' ? INCOME_KW : EXPENSE_KW;
  let name = null, score = 0;
  for (const nm in map) {
    let s = 0;
    for (const kw of map[nm]) if (text.includes(kw)) s += kw.length; // 长关键词权重更高
    if (s > score) { score = s; name = nm; }
  }
  return { name, score };
}
/** 这段文字是收入还是支出 */
function typeOf(text) {
  return INCOME_TYPE_KW.some((k) => text.includes(k)) ? 'income' : 'expense';
}
/** 分类名 → 分类 id；认不出就兜底「其他 / 其他收入」，再兜底该类型第一个可见分类 */
function catIdFor(categories, type, name) {
  if (name) {
    const c = categories.find((x) => x.type === type && x.name === name && !x.hidden);
    if (c) return c.id;
  }
  const other = categories.find((x) => x.type === type && !x.hidden && (x.name === '其他' || x.name === '其他收入'));
  if (other) return other.id;
  const f = categories.find((x) => x.type === type && !x.hidden);
  return f ? f.id : null;
}

// ========== 一句话多笔 ==========
// 场景：「今天打车花了25元，中午吃饭花38，晚上吃饭60」→ 一次记 3 笔。
// 难点：本 App 的离线模型**一个标点都不吐**，所以不能按逗号切；改成**拿金额当锚点**切：
//   每个金额 + 它前面那段话 = 一笔。
// 又因为模型吐的是中文数字（二十五），且日期/时间/量词也长成数字样，必须先剔干净，否则会多切出「9月」「3点」「两斤」这种假笔。

// 时间词：帮我们理解，但不属于「消费项目」，判分类前先剥掉
// （不剥的话，「中午」里的「午」、「今天」里的「天」会干扰分类）
const TIME_WORDS = [
  '今天', '昨天', '前天', '明天', '后天', '今晚', '昨晚', '今早', '今儿', '当天', '这天',
  '早上', '早晨', '一早', '上午', '中午', '下午', '傍晚', '晚上', '夜里', '夜晚', '凌晨', '半夜', '刚刚', '刚才',
  '周一', '周二', '周三', '周四', '周五', '周六', '周日', '周天',
  '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日', '星期天',
];
// 口语连接词 / 口头语：剥掉，既不影响分类，也能让备注干净
const CONNECT_WORDS = [
  '还有', '另外', '然后', '接着', '此外', '以及', '加上', '再加', '再就是', '最后', '之后', '顺便', '对了', '其中',
  '那个', '这个', '大概', '差不多', '我', '你', '他', '她', '在', '就', '也', '还', '又', '再',
];
// 总结词：出现这些词又没说具体项目 → 是在报总数，不是新的一笔
const TOTAL_WORDS = ['一共', '总共', '合计', '总计', '共花', '累计', '算下来'];
// 项目词首尾常挂的动词/助词/单位，做备注时剥掉（备注要短、要像「打车」「吃饭」）
const TRIM_WORDS = [
  '花了', '花掉', '花费', '花', '付了', '付款', '付', '买了', '买', '给了', '给', '用了', '用', '点了',
  '充了', '充', '交了', '交', '收到', '收了', '收', '赚了', '赚', '入账', '进账', '支出', '消费',
  '块钱', '元钱',
];
const CN_NUM = '零一二两三四五六七八九十百千万亿';
const TIME_AFTER = '年月日号点時时秒';                 // 紧跟这些 → 是时间，不是钱
const MEASURE_AFTER = '个次杯份斤张只件盒瓶碗袋颗人天周月岁遍趟包条位套双米克升顿下些阵番场回通口'; // 紧跟这些 → 是数量
const MONEY_AFTER = '元块钱毛角';                      // 紧跟这些 → 是钱（块=元）
// 紧跟这些 → 数字只是词语的一部分（千万别、一起、一定、一样…），不是金额
const WORD_AFTER = '别共起定样直会向同如并致切些般';
// 前面是这些 → 是概数（几十、上百、好几千），不是确切金额
const APPROX_BEFORE = '几数好上成';

/** 剥掉时间词/连接词/标点/「9月10号」「下午3点」这类时间表达 */
function stripNoise(s) {
  let t = String(s || '');
  for (const w of TIME_WORDS) t = t.split(w).join('');
  for (const w of CONNECT_WORDS) t = t.split(w).join('');
  t = t.replace(/[，,、。.；;：:！!？?…\s]+/g, '');                                  // 标点直接去掉
  t = t.replace(/[0-9零一二两三四五六七八九十百千万]+(月|日|号|點|点|时|時|分|秒)/g, ''); // 时间表达
  return t;
}
/** 反复剥掉首尾的动词/助词/连接词/标点，剩下的当备注 */
function trimNoise(s) {
  let t = String(s || '').trim();
  let changed = true;
  while (changed && t) {
    changed = false;
    const before = t;
    t = t.replace(/^[，,、。.；;：:！!？?…\s—–-]+/, '').replace(/[，,、。.；;：:！!？?…\s—–-]+$/, '');
    for (const w of TRIM_WORDS.concat(CONNECT_WORDS)) {
      if (t.startsWith(w)) { t = t.slice(w.length); changed = true; }
      if (t.endsWith(w)) { t = t.slice(0, -w.length); changed = true; }
    }
    t = t.trim();
    if (t !== before) changed = true;
  }
  return t;
}

/** 扫出句子里的「金额」候选（带位置）；剔除时间/数量/概数，并合并零头「三十八块五 → 38.5」 */
function findAmounts(s) {
  const out = [];
  const re = new RegExp('[0-9]+(?:\\.[0-9]{1,2})?[万千亿]?|[' + CN_NUM + ']+', 'g');
  let m;
  while ((m = re.exec(s)) !== null) {
    const tok = m[0];
    const start = m.index, end = re.lastIndex;
    const after = s.slice(end, end + 1);
    const before = s.slice(start - 1, start);
    // 孤立的一个「一 / 两」多半是词语的一部分（一共、一起、两点…）：只有后跟「元/块/毛/角」才算钱
    if ((tok === '一' || tok === '两') && !(after && MONEY_AFTER.includes(after))) continue;
    if (after && TIME_AFTER.includes(after)) continue;    // 日期 / 时间（9月10号、3点）
    if (after && MEASURE_AFTER.includes(after)) continue; // 数量（三个人、两斤、五次）
    if (after && WORD_AFTER.includes(after)) continue;    // 词语（千万别、一起）
    if (before && APPROX_BEFORE.includes(before)) continue; // 概数（几十、上百）
    let val;
    if (/^[0-9]/.test(tok)) {
      val = parseFloat(tok);
      const u = tok.slice(-1);
      if (u === '万') val *= 10000;
      else if (u === '千') val *= 1000;
      else if (u === '亿') val *= 100000000;
    } else {
      val = cnTokenToNum(tok);
    }
    if (!(val > 0)) continue;
    out.push({ start, end, val, money: !!(after && MONEY_AFTER.includes(after)) });
  }
  // 合并零头：三十八块五 → 38.5、「25块5」→ 25.5
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i], b = out[i + 1];
    const mid = s.slice(a.end, a.end + 1);
    const tail = s.slice(b.end, b.end + 1); // 可能是 ''（句尾）
    if (a.end === b.start - 1 && (mid === '块' || mid === '元')
      && b.val > 0 && b.val < 10 && (b.end - b.start) === 1
      && !(tail && TIME_AFTER.includes(tail))) {
      a.val = Math.round((a.val + b.val / 10) * 100) / 100;
      a.end = b.end; a.money = true;
      out.splice(i + 1, 1); i--;
    }
  }
  return out;
}

/**
 * 一句话 → 多笔。
 * 返回 [{ amount, type, categoryId, categoryName, note, catOk }]；一笔都切不出来就返回 []。
 * 调用方约定：返回 [] 时请回落到老的 parse()（单笔逻辑）。
 */
export function parseMulti(text, categories) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const amts = findAmounts(raw);
  if (!amts.length) return [];

  // 先把每笔的「金额前的话 / 金额后的话」切好
  const segs = [];
  let prevEnd = 0;
  for (let i = 0; i < amts.length; i++) {
    const a = amts[i];
    let ce = a.end;
    if (raw[ce] === '块' || raw[ce] === '元') { ce++; if (raw[ce] === '钱') ce++; } // 连「块钱」一起吃
    else if (raw[ce] === '毛' || raw[ce] === '角') ce++;
    const nextStart = i + 1 < amts.length ? amts[i + 1].start : raw.length;
    segs.push({
      amount: a.val,
      leadRaw: raw.slice(prevEnd, a.start),                  // 金额前的话（先说项目后说钱）
      afterRaw: raw.slice(ce, Math.max(ce, nextStart)),      // 金额后的话（先报钱再说项目）
    });
    prevEnd = ce;
  }

  // 判定整句话的语序：只有当第一笔「金额前」几乎没话（如「25块打车…」）时才认为
  // 是「先报钱再说项目」的倒装；否则一律按最常见的「先说项目后说钱」处理。
  // 这样「25块打车38块吃饭」和「还了信用卡两千交水电费三百」不会互相串。
  const hitOf = (s) => { const t = stripNoise(s); return bestCat(t, typeOf(t)); };
  const firstLead = stripNoise(segs[0].leadRaw);
  let order = 'lead';
  if (firstLead.length <= 3 && !hitOf(segs[0].leadRaw).name && hitOf(segs[0].afterRaw).name) order = 'after';

  const drafts = [];
  for (let i = 0; i < segs.length; i++) {
    const sg = segs[i];
    const isLast = i === segs.length - 1;
    const primary = order === 'after' ? sg.afterRaw : sg.leadRaw;
    // 只有「属于本笔」的那一侧才能兜底：
    //   先项目后金额 → 金额后的话属于下一笔（只有最后一笔的句尾是空闲的）
    //   先金额后项目 → 金额前的话属于上一笔（只有第一笔的句首是空闲的）
    const backup = order === 'after' ? (i === 0 ? sg.leadRaw : '') : (isLast ? sg.afterRaw : '');
    let ctx = stripNoise(primary), type = typeOf(ctx), hit = bestCat(ctx, type);
    if (!hit.name && backup) {
      const ctx2 = stripNoise(backup), t2 = typeOf(ctx2), h2 = bestCat(ctx2, t2);
      if (h2.name) { ctx = ctx2; type = t2; hit = h2; }
    }
    drafts.push({
      amount: sg.amount,
      type,
      categoryName: hit.name,
      catOk: !!hit.name,
      note: trimNoise(ctx).slice(0, 12),
      isTotal: TOTAL_WORDS.some((w) => primary.includes(w)) && !hit.name,
    });
  }

  // 「一共/总共」报总数的那一段：只要还切出了别的笔，就丢掉它（避免记重复）
  let list = drafts.length > 1 ? drafts.filter((d) => !d.isTotal) : drafts;
  if (!list.length) return [];
  list = list.slice(0, 8); // 一句话最多记 8 笔，防止识别噪声切出一堆
  return list.map((d) => ({
    amount: d.amount,
    type: d.type,
    categoryId: catIdFor(categories, d.type, d.categoryName),
    categoryName: d.categoryName,
    note: d.note,
    catOk: d.catOk,
  }));
}

// 模型下载进度：原生侧下载外置语音模型时回调，用于自检页实时显示
let modelProgressCb = null;
export function onModelProgress(fn) { modelProgressCb = fn; }
if (typeof window !== 'undefined') {
  window.__nuanjiAsr = window.__nuanjiAsr || {};
  window.__nuanjiAsr.onModel = function (pct) {
    if (modelProgressCb) { try { modelProgressCb(Number(pct) || 0); } catch (_) { } }
  };
}
