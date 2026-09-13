import * as db from './db.js';
import * as speech from './speech.js';
import * as update from './update.js';
import { donutSVG } from './charts.js';
import { money, moneyShort, moneyNeg, moneyCell, cellAmtLong, dayKey, parseDayKey, rangeFor, monthRange, rangeLabel, uid } from './format.js';
import {
  ACCOUNT_COLORS, isNormal, onlyNormal, accountBalances, totalBalance,
  accountRecords, spentInRange, dueDates, runRecordId, nextRunDate, freqLabel,
  accountGroups, groupBalance,
} from './accounts.js';

const view = document.getElementById('view');
const appbarTitle = document.getElementById('appbar-title');
const appbarAction = document.getElementById('appbar-action');
const tabbar = document.getElementById('tabbar');

const state = { route: '#/record', calDate: new Date(), selDate: new Date(), statsPeriod: 'month', pieSide: 'expense' };
const COLOR_SW = ['#FF8A5B', '#5BA8FF', '#FF6FB5', '#B98CFF', '#FFC15B', '#FF7A7A', '#4FD0C0', '#FF9F6B', '#7C9CFF', '#4FC3F7', '#8ED081', '#B0A393', '#3ED35A', '#2FB8A0'];

const routes = {
  '#/record': { title: '记一笔', render: renderRecord },
  '#/calendar': { title: '日历', render: renderCalendar },
  '#/accounts': { title: '我的钱', render: renderAccounts },
  '#/acct': { title: '账户', render: renderAccountDetail },
  '#/stats': { title: '统计', render: renderStats },
  '#/me': { title: '我的', render: renderMe },
};

/* 上一次用的支付账户 —— 记一笔时默认帮用户选好，省一次点击 */
const LAST_ACCT_KEY = 'nuanji-last-account';
function getLastAccount() { try { return localStorage.getItem(LAST_ACCT_KEY) || ''; } catch (_) { return ''; } }
function setLastAccount(id) { try { localStorage.setItem(LAST_ACCT_KEY, id || ''); } catch (_) { /* 忽略 */ } }

/** 分类表和账户表一次取好，转成 id→对象的映射，省得各页各写一遍 */
async function loadMaps() {
  const [cats, accs] = await Promise.all([db.getAllCategories(), db.getAllAccounts()]);
  const cm = {}; cats.forEach((c) => { cm[c.id] = c; });
  const am = {}; accs.forEach((a) => { am[a.id] = a; });
  return { cats, accs, cm, am };
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 1800);
}

/* ---------- 键盘避让 ----------
   手机弹出软键盘时可视区（visualViewport）立刻变矮。底部弹卡是 fixed 定位的，
   不跟着收缩就会整张卡溢出到屏幕上方，而金额输入框正在弹卡上部 ——
   于是"输入时看不见自己打的数字"。这里把实时可视区高度 / 顶部偏移 / 键盘高度
   写进 CSS 变量，供 styles.css 的 .sheet-mask 使用。 */
const vvApi = window.visualViewport;
let revealTimer;
/** 把弹卡里正在输入的控件滚进可视区（键盘动画结束后再算，否则位置还不准） */
function revealFocus(delay = 60) {
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    const el = document.activeElement;
    if (!el || !el.closest) return;
    const sheet = el.closest('.sheet');
    if (!sheet) return;
    const sr = sheet.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // 底部按钮是吸附在弹卡底部的（sticky），被它挡住的那截不算「看得见」
    const foot = sheet.querySelector('.flex');
    const limitB = sr.bottom - (foot ? foot.offsetHeight : 0) - 4;
    const limitT = sr.top + 14;
    if (r.top < limitT) sheet.scrollTop -= (limitT - r.top);
    else if (r.bottom > limitB) sheet.scrollTop += (r.bottom - limitB + 6);
  }, delay);
}
function syncViewport() {
  const lh = window.innerHeight || 0;                                  // 版面高度（adjustResize 下会被键盘压小）
  const raw = vvApi && vvApi.height ? vvApi.height : lh;                // 真实可视高度
  const vt = vvApi && typeof vvApi.offsetTop === 'number' ? vvApi.offsetTop : 0;
  if (!lh || !raw) return;
  const root = document.documentElement;
  root.style.setProperty('--vv-h', Math.round(Math.min(raw, lh)) + 'px');
  root.style.setProperty('--vv-top', Math.round(vt) + 'px');
  root.style.setProperty('--kb', Math.round(Math.max(0, lh - raw - vt)) + 'px');
  revealFocus(80);
}
if (vvApi) {
  vvApi.addEventListener('resize', syncViewport);
  vvApi.addEventListener('scroll', syncViewport);   // iOS 打字时 WebKit 会自己滚动可视区
}
window.addEventListener('resize', syncViewport);
window.addEventListener('orientationchange', () => setTimeout(syncViewport, 350));
syncViewport();

function openSheet(html, bind) {
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.innerHTML = `<div class="sheet">${html}</div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  // 键盘一定会把视野挤小：聚焦的输入框要自己滚回可见处
  mask.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) revealFocus(340);
  });
  if (bind) bind(mask.querySelector('.sheet'), close);
  return close;
}

function resizeImage(file, max = 900) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        res(cv.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = rej; img.src = fr.result;
    };
    fr.onerror = rej; fr.readAsDataURL(file);
  });
}

function catTiles(cats, selId) {
  return cats.map((c) => `<button class="cat ${c.id === selId ? 'sel' : ''}" data-id="${c.id}"><span class="emoji">${c.emoji}</span><span class="name">${c.name}</span></button>`).join('');
}

/** 金额输入框：只收数字和一个小数点，最多两位小数。
    为什么不能只写 inputmode="decimal" —— 那只是「建议键盘」，中文输入法照样能把汉字塞进框里
    （用户实测在金额里打出了「啊」）。所以必须自己清洗输入：
    - beforeinput 先拦掉明显的非法字符（打字、粘贴都走这里）；
    - input / compositionend 再兜一遍 —— 输入法的合成上屏是拦不住的，只能上屏后立刻擦掉；
    - blur 收尾，保证离开时框里一定是干净的数字。 */
function bindAmountInput(el) {
  if (!el) return;
  const clean = (raw) => {
    let v = String(raw == null ? '' : raw).replace(/[^\d.]/g, '');   // 只留数字和小数点
    const i = v.indexOf('.');
    if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, ''); // 多余的小数点去掉
    let [a, b] = v.split('.');
    a = a.replace(/^0+(?=\d)/, '').slice(0, 9);                     // 去前导零，整数最多 9 位
    return b === undefined ? a : a + '.' + b.slice(0, 2);            // 最多两位小数
  };
  const fix = () => {
    const raw = el.value;
    const v = clean(raw);
    if (v === raw) return;
    const pos = el.selectionStart;                                   // 擦掉字符后光标要跟着回退
    el.value = v;
    const back = raw.length - v.length;
    try { el.setSelectionRange(Math.max(0, pos - back), Math.max(0, pos - back)); } catch (_) { /* 忽略 */ }
  };
  el.addEventListener('beforeinput', (e) => {
    // 只拦「敲进一个非法字符」（打字场景，拦掉就不会闪一下）。
    // 粘贴 / 一次性插入多字符不拦 —— 拦整段会让「粘贴 ¥1,234.56」完全没反应，
    // 交给下面的 input 清洗成 1234.56 才对。
    if (e.data && e.data.length === 1 && /[^\d.]/.test(e.data)) e.preventDefault();
  });
  el.addEventListener('input', fix);
  el.addEventListener('compositionend', fix);
  el.addEventListener('blur', fix);
}

function recordRow(r, cm, am) {
  const c = cm[r.categoryId] || { emoji: '📦', name: '已删分类', color: '#B0A393' };
  const sign = r.type === 'expense' ? '-' : '+';
  const cls = r.type === 'expense' ? 'exp' : 'inc';
  const ph = r.photo ? `<img class="thumb" src="${r.photo}">` : `<span class="emoji">${c.emoji}</span>`;
  // 分类独占一行；备注排在分类下面（灰色小字）；时间放最下面。
  // 以前是「备注 · 分类」挤在同一行，长备注（万宁买护肤品眼霜等等）会把整行撑成三行，很难看。
  const note = r.note ? `<div class="n">${r.note}</div>` : '';
  const time = new Date(r.date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const an = (am && r.accountId && am[r.accountId]) ? am[r.accountId].name : '';
  const meta = time + (an ? ' · ' + an : '');
  return `<div class="item">${ph}<div class="body"><div class="t">${c.name}</div>${note}<div class="s">${meta}</div></div><span class="amt ${cls}">${sign}${moneyShort(r.amount)}</span><button class="edit" data-id="${r.id}" title="修改">✏️</button><button class="del" data-id="${r.id}" title="删除">🗑️</button></div>`;
}

/** 账户页里的流水行：转账、校准、盈亏都得显示，所以单独一套。
 *  selfId = 当前正在看的账户。转账要按它说方向（「转出到银行卡」比「微信 → 银行卡」短也更好懂），
 *  窄屏上不会一上来就被省略号吃掉后半截。
 *  转账/校准/盈亏 不能用「记一笔」那套逻辑改，所以只有删除按钮；普通收支还有「修改」。 */
function ledgerRow(r, cm, am, selfId) {
  const amt = Number(r.amount) || 0;
  const time = new Date(r.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  const money1 = (v) => money(Math.abs(v));
  const del = `<button class="del" data-id="${r.id}" title="删除">🗑️</button>`;
  if (r.kind === 'transfer') {
    const from = (am[r.accountId] || {}).name || '未指定';
    const to = (am[r.toAccountId] || {}).name || '未指定';
    let dir = from + ' → ' + to;
    if (selfId && r.accountId === selfId) dir = '转出到 ' + to;
    else if (selfId && r.toAccountId === selfId) dir = '从 ' + from + ' 转入';
    const tag = r.planId ? '定投自动记的' : (r.note || '');
    const sub = dir + (tag ? ' · ' + tag : '');
    return `<div class="item"><span class="emoji">🔁</span><div class="body"><div class="t">转账</div><div class="n wrap2">${sub}</div><div class="s">${time}</div></div><span class="amt">${money1(amt)}</span>${del}</div>`;
  }
  if (r.kind === 'adjust') {
    return `<div class="item"><span class="emoji">🎯</span><div class="body"><div class="t">余额校准</div>${r.note ? `<div class="n wrap2">${r.note}</div>` : ''}<div class="s">${time}</div></div><span class="amt ${amt < 0 ? 'exp' : 'inc'}">${amt < 0 ? '-' : '+'}${money1(amt)}</span>${del}</div>`;
  }
  if (r.kind === 'pnl') {
    return `<div class="item"><span class="emoji">📈</span><div class="body"><div class="t">投资盈亏</div>${r.note ? `<div class="n wrap2">${r.note}</div>` : ''}<div class="s">${time}</div></div><span class="amt ${amt < 0 ? 'exp' : 'inc'}">${amt < 0 ? '-' : '+'}${money1(amt)}</span>${del}</div>`;
  }
  const c = cm[r.categoryId] || { emoji: '📦', name: '已删分类' };
  const sign = r.type === 'expense' ? '-' : '+';
  const cls = r.type === 'expense' ? 'exp' : 'inc';
  const ph = r.photo ? `<img class="thumb" src="${r.photo}">` : `<span class="emoji">${c.emoji}</span>`;
  const note = r.note ? `<div class="n">${r.note}</div>` : '';
  return `<div class="item">${ph}<div class="body"><div class="t">${c.name}</div>${note}<div class="s">${time}</div></div><span class="amt ${cls}">${sign}${money1(amt)}</span><button class="edit" data-id="${r.id}" title="修改">✏️</button>${del}</div>`;
}

/** 给记录列表统一挂上「改 / 删」两个动作 */
function wireRecordList(listEl) {
  listEl.querySelectorAll('.del').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation(); e.preventDefault();
    const id = b.getAttribute('data-id'); if (!id) return;
    if (confirm('确定删除这条记录？')) { await db.deleteRecord(id); toast('已删除'); router(); }
  }));
  listEl.querySelectorAll('.edit').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation(); e.preventDefault();
    const id = b.getAttribute('data-id'); if (!id) return;
    const rec = (await db.getRecords()).find((x) => x.id === id);
    if (!rec) { toast('这条记录找不到了'); return; }
    openEntrySheet({
      id: rec.id, amount: rec.amount, type: rec.type, categoryId: rec.categoryId,
      note: rec.note, photo: rec.photo, date: rec.date, createdAt: rec.createdAt,
      accountId: rec.accountId,          // 带上原来的账户，别把「钱从哪出」丢了
    });
  }));
}

// ---------- 路由 ----------
function router() {
  const raw = location.hash || '#/record';
  // 账户详情是带参数的地址（#/acct/xxxx），统一落到 '#/acct' 这个壳上
  const route = routes[raw] ? raw : (raw.indexOf('#/acct/') === 0 ? '#/acct' : '#/record');
  state.route = route;
  appbarTitle.textContent = routes[route].title;
  appbarAction.hidden = true; appbarAction.textContent = ''; appbarAction.onclick = null;
  view.classList.remove('view-enter'); void view.offsetWidth; view.classList.add('view-enter');
  routes[route].render();
  [...tabbar.querySelectorAll('.tab')].forEach((t) => t.classList.toggle('active', t.dataset.route === route));
}
window.addEventListener('hashchange', router);

// ---------- 记一笔 ----------
async function renderRecord() {
  // 转账 / 校准 / 盈亏 不是消费，不进这里的任何统计
  const records = onlyNormal(await db.getRecords());
  const now = new Date();
  const todayKey = dayKey(now);
  const [mStart, mEnd] = monthRange(now);
  const mEndTs = mEnd.getTime() + 86400000 - 1;

  // 今日
  const todayRecs = records.filter((r) => dayKey(new Date(r.date)) === todayKey);
  const todayExp = todayRecs.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const todayInc = todayRecs.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  // 本月
  const monthRecs = records.filter((r) => r.date >= mStart.getTime() && r.date <= mEndTs);
  const monthExp = monthRecs.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const monthInc = monthRecs.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);

  view.innerHTML = `
    <div class="mic-wrap">
      <button class="mic" id="mic">🎙️</button>
      <div class="mic-hint">${speech.supported ? (update.APP.ios
        ? '点一下开始说，说完<b>再点一下</b>麦克风。<br>可以一句一句说，也可以连着说好几笔：<b>「打车25，午饭38」</b>'
        : '点一下开始听，说完再点一下记账。<br>一笔一笔说：<b>「午饭38」</b>；也可以一口气说好几笔：<b>「打车25，午饭38，晚饭60」</b>')
        : (speech.inApp ? '这台手机没有语音识别引擎，可用下方「手动记一笔」' : '这台手机 / 浏览器用不了语音，请点下方「手动记一笔」记上')}</div>
      <div class="mic-transcript" id="transcript"></div>
    </div>
    <button class="btn ghost block mt16" id="manual">✏️ 手动记一笔</button>
    <div class="card mt16">
      <div class="card-title">今日</div>
      <div class="day-sum">
        <div class="box tap-box" data-scope="today" data-type="expense"><div class="v exp-amt">${moneyShort(todayExp)}</div><div class="k">支出 ▾</div></div>
        <div class="box tap-box" data-scope="today" data-type="income"><div class="v inc-amt">${moneyShort(todayInc)}</div><div class="k">收入 ▾</div></div>
      </div>
      <div id="todayList" class="rec-list" hidden></div>
    </div>
    <div class="card">
      <div class="card-title">本月（${now.getMonth() + 1}月）</div>
      <div class="day-sum">
        <div class="box tap-box" data-scope="month" data-type="expense"><div class="v exp-amt">${moneyShort(monthExp)}</div><div class="k">支出 ▾</div></div>
        <div class="box tap-box" data-scope="month" data-type="income"><div class="v inc-amt">${moneyShort(monthInc)}</div><div class="k">收入 ▾</div></div>
      </div>
      <div id="monthList" class="rec-list" hidden></div>
    </div>`;
  const mic = view.querySelector('#mic');
  const tr = view.querySelector('#transcript');
  let ctrl = null;          // 当前监听控制器（null = 未听）
  let acc = '';             // 本次听写的临时文本
  let ending = false;       // 已点停止，正在等最终结果
  let pressing = false;     // 手指/鼠标是否正按着
  let longArmed = false;    // 是否已判定为「长按说话」
  let pressTimer = null;
  let endTimer = null;
  const LONG_MS = 260;      // 超过此时长视为长按，否则视为单击

  function reset() {
    clearTimeout(endTimer);
    ctrl = null; ending = false; acc = '';
    mic.classList.remove('listening', 'holding');
  }

  function startListening() {
    if (ctrl) return;
    acc = ''; ending = false;
    mic.classList.add('listening');
    tr.textContent = '在听…（说中文或英文）';
    ctrl = speech.listen({
      lang: 'zh-CN',
      // 实时结果（边说边出字）
      onPartial: (p) => { if (!ending && p) tr.textContent = (acc ? acc + ' ' : '') + p; },
      // 最终结果：停止后到达一次（可能是空串）
      onFinal: (f) => {
        const text = String(f || acc || '').trim();
        reset();
        tr.textContent = '';
        if (text) openEntryFromVoice(text); // 出结果 → 弹记账卡
      },
      onError: (e) => {
        const had = !!String(acc || '').trim();
        reset();
        tr.textContent = '';
        if (!had) toast(speech.errText(e));
      },
    });
  }
  function stopListening() {
    if (!ctrl) { reset(); tr.textContent = ''; return; }
    ending = true;
    mic.classList.remove('listening', 'holding');
    tr.textContent = '识别中…';
    const c = ctrl; ctrl = null;
    try { c.stop(); } catch (_) {}
    // 兜底：2.5 秒还没等到最终结果就复位，避免卡在「识别中…」
    clearTimeout(endTimer);
    endTimer = setTimeout(() => { if (ending) { reset(); tr.textContent = ''; } }, 2500);
  }

  // 指针事件统一处理鼠标 + 触摸，并区分「单击切换」与「长按说话」
  mic.addEventListener('pointerdown', async (e) => {
    e.preventDefault();
    if (!speech.supported) { toast(speech.inApp ? speech.errText('no-engine') : speech.errText('need-app')); return; }
    if (speech.needModel()) {
      if (confirm('语音引擎还没下载（约 198MB，建议连 WiFi）。\n'
        + '下载一次以后就不用再下，而且以后不联网也能用。\n\n现在下载吗？')) {
        if (speech.startModelDownload()) toast('开始下载，请留在本页面别关 App');
      } else {
        toast('也可以先点「手动记一笔」');
      }
      return;
    }
    pressing = true; longArmed = false;
    try { mic.setPointerCapture(e.pointerId); } catch (_) {}
    pressTimer = setTimeout(async () => {
      if (!pressing) return;
      longArmed = true;
      mic.classList.add('holding');
      if (!ctrl) {
        const perm = await speech.checkMic();
        if (perm === 'denied') { toast('麦克风权限被拒绝，请在系统设置里允许后重试'); pressing = false; longArmed = false; mic.classList.remove('holding'); return; }
        startListening(); // 长按开始听
      }
    }, LONG_MS);
  });
  function onRelease() {
    if (!pressing) return;
    pressing = false;
    clearTimeout(pressTimer);
    if (longArmed) {
      longArmed = false; mic.classList.remove('holding');
      stopListening();                 // 长按松手 → 出结果
    } else if (ctrl || ending) {
      stopListening();                 // 单击（已在听）→ 再点一下出结果
    } else {
      startListening();                // 单击（未听）→ 开始听
    }
  }
  mic.addEventListener('pointerup', onRelease);
  mic.addEventListener('pointercancel', () => {
    if (!pressing) return;
    pressing = false; clearTimeout(pressTimer);
    if (longArmed) { longArmed = false; mic.classList.remove('holding'); }
  });
  view.querySelector('#manual').addEventListener('click', () => openEntrySheet({}));

  // 支出/收入卡片点击展开记录
  const { cm, am } = await loadMaps();
  view.querySelectorAll('.tap-box').forEach((box) => {
    box.style.cursor = 'pointer';
    box.addEventListener('click', () => {
      const scope = box.dataset.scope; // 'today' | 'month'
      const type = box.dataset.type;   // 'expense' | 'income'
      const listId = scope + 'List';
      const listEl = view.querySelector('#' + listId);
      // 切换展开/收起
      if (!listEl.hidden) { listEl.hidden = true; box.querySelector('.k').textContent = (type === 'expense' ? '支出' : '收入') + ' ▾'; return; }
      // 先收起另一个列表
      view.querySelectorAll('.rec-list').forEach((el) => { el.hidden = true; });
      view.querySelectorAll('.tap-box .k').forEach((k) => { k.textContent = k.textContent.replace('▴', '▾'); });
      box.querySelector('.k').textContent = (type === 'expense' ? '支出' : '收入') + ' ▴';
      // 筛选记录
      const filtered = scope === 'today'
        ? todayRecs.filter((r) => r.type === type)
        : monthRecs.filter((r) => r.type === type);
      filtered.sort((a, b) => b.date - a.date);
      if (filtered.length === 0) {
        listEl.innerHTML = `<div class="empty">暂无${type === 'expense' ? '支出' : '收入'}记录</div>`;
      } else {
        listEl.innerHTML = `<div class="list">${filtered.map((r) => recordRow(r, cm, am)).join('')}</div>`;
        // 绑定删除
        listEl.querySelectorAll('.del').forEach((b) => {
          b.addEventListener('click', async (e) => {
            e.stopPropagation(); e.preventDefault();
            const id = b.getAttribute('data-id');
            if (!id) return;
            if (confirm('确定删除这条记录？')) { await db.deleteRecord(id); toast('已删除'); router(); }
          });
        });
      }
      listEl.hidden = false;
    });
  });
}

function quickTiles(quicks) {
  let h = quicks.map((q) => `<button class="quick" data-id="${q.id}"><span class="emoji">${q.emoji || '⚡'}</span><span class="nm">${q.label}</span><span class="amt">${q.type === 'income' ? '+' : '-'}¥${q.amount}</span></button>`).join('');
  h += `<button class="quick add" id="addQuick">＋<span class="nm">添加</span></button>`;
  return h;
}
function bindQuick(view, quicks) {
  view.querySelectorAll('.quick[data-id]').forEach((b) => b.onclick = async () => {
    const q = quicks.find((x) => x.id === b.dataset.id); if (!q) return;
    await db.addRecord({ id: uid(), type: q.type, amount: q.amount, categoryId: q.categoryId, note: q.label, photo: null, date: Date.now(), createdAt: Date.now() });
    toast('已记下 ✓');
  });
  const add = view.querySelector('#addQuick'); if (add) add.onclick = openQuickSheet;
}

async function openEntryFromVoice(text) {
  let cats = [];
  try { cats = await db.getCategories(); } catch (_) { cats = []; }
  // 先试「一句话多笔」：能切出 ≥2 笔就弹列表卡让用户逐条确认
  let list = [];
  try { list = speech.parseMulti(text, cats); } catch (_) { list = []; }
  if (list.length > 1) { openVoiceListSheet(list, text); return; }
  if (list.length === 1) {
    const p = list[0];
    openEntrySheet({ amount: p.amount, type: p.type, categoryId: p.categoryId, note: p.note || text });
    return;
  }
  // 切不出笔（多半是没说到金额）→ 走原来的单笔逻辑
  try {
    const p = speech.parse(text, cats);
    openEntrySheet({ amount: p.amount, type: p.type, categoryId: p.categoryId, note: text });
  } catch (err) {
    // 解析出错也照常弹卡，把听到的话放进备注，用户手动补金额
    openEntrySheet({ note: text });
  }
}

/** 一句话听出多笔 → 列表确认卡：每笔都能改分类 / 改金额 / 去掉，确认后一次性记下 */
async function openVoiceListSheet(list, rawText) {
  const all = await db.getAllCategories();
  let rows = list.map((e, i) => ({ ...e, key: i }));

  const optionsHTML = (sel) => {
    const grp = (type, label) => '<optgroup label="' + label + '">' + all.filter((c) => c.type === type).map((c) =>
      `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${c.emoji} ${c.name}${c.hidden ? '（已隐藏）' : ''}</option>`).join('') + '</optgroup>';
    return grp('expense', '支出') + grp('income', '收入');
  };
  const rowHTML = (r) => `
    <div class="vrow" data-key="${r.key}">
      <div class="vmain">
        <select class="vsel">${optionsHTML(r.categoryId)}</select>
        <div class="vnote">${r.note ? r.note : '（没说是什么）'}</div>
      </div>
      <span class="vcur">¥</span><input class="vamt" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="${r.amount}">
      <button class="vdel" title="去掉这笔">✕</button>
    </div>`;

  const html = `
    <h3>听到 ${rows.length} 笔，确认一下</h3>
    <div class="hint-line">你说的：${rawText}<br>分类或金额不对可以直接改；不想要的点 ✕ 去掉。确认后一次全部记下。</div>
    <div class="vlist" id="vlist">${rows.map(rowHTML).join('')}</div>
    <div class="flex mt16">
      <button class="btn soft" id="cancel">取消</button>
      <button class="btn" id="save">全部记好 ✓</button>
    </div>`;

  openSheet(html, (root, close) => {
    const listEl = root.querySelector('#vlist');
    const bindRows = () => {
      listEl.querySelectorAll('.vrow').forEach((rowEl) => {
        const key = Number(rowEl.dataset.key);
        const r = rows.find((x) => x.key === key); if (!r) return;
        const sel = rowEl.querySelector('.vsel');
        sel.addEventListener('change', () => {
          const c = all.find((x) => x.id === sel.value);
          r.categoryId = sel.value;
          if (c) r.type = c.type;
        });
        // 必须先绑清洗器：它在同一次 input 事件里先执行，下面读到的才是干净的数字
        const vamtEl = rowEl.querySelector('.vamt');
        bindAmountInput(vamtEl);
        vamtEl.addEventListener('input', (e) => {
          const v = parseFloat(e.target.value);
          r.amount = isNaN(v) ? 0 : v;
        });
        rowEl.querySelector('.vdel').addEventListener('click', () => {
          rows = rows.filter((x) => x.key !== key);
          repaint();
        });
      });
    };
    const repaint = () => {
      listEl.innerHTML = rows.length
        ? rows.map(rowHTML).join('')
        : '<div class="empty" style="padding:20px">都去掉了，点「取消」关掉就好</div>';
      bindRows();
    };
    bindRows();
    root.querySelector('#cancel').onclick = close;
    root.querySelector('#save').onclick = async () => {
      const ok = rows.filter((r) => Number(r.amount) > 0 && r.categoryId);
      if (!ok.length) { toast('没有可记的条目'); return; }
      const now = Date.now();
      // date 逐条往回退 1 毫秒：既保证排序稳定，又能让「说的顺序」=「列表顺序」
      for (let i = 0; i < ok.length; i++) {
        const r = ok[i];
        await db.addRecord({
          id: uid(), type: r.type, amount: Math.round(Number(r.amount) * 100) / 100,
          categoryId: r.categoryId, note: r.note || '', photo: null,
          date: now - i, createdAt: now,
        });
      }
      toast('已记下 ' + ok.length + ' 笔 ✓');
      close(); router();
    };
  });
}

async function openEntrySheet(prefill = {}) {
  const cats = await db.getCategories();
  const accs = await db.getAllAccounts();
  const editing = !!prefill.id;                     // 带 id = 改一条已有记录
  let type = prefill.type || 'expense';
  let amount = prefill.amount != null && prefill.amount !== '' ? String(prefill.amount) : '';
  let catId = prefill.categoryId || (cats.find((c) => c.type === type) || {}).id;
  // 账户默认用「上次用过的那个」，没有就用第一个 —— 日常记账基本不用再点它
  let acctId = prefill.accountId || getLastAccount() || (accs[0] || {}).id;
  let note = prefill.note || '';
  let photo = prefill.photo || null;
  const when = prefill.date || Date.now();          // 记到哪一天（日历「补一笔」会传过来）
  const wd = new Date(when);
  const isToday = dayKey(wd) === dayKey(new Date());
  const dateLabel = isToday ? '今天' : `${wd.getMonth() + 1}月${wd.getDate()}日`;
  const html = `
    <h3>${editing ? '改一笔' : '记一笔'}</h3>
    <div class="date-chip">📅 记到 ${dateLabel}</div>
    <div class="seg" id="typeSeg">
      <button data-t="expense" class="${type === 'expense' ? 'on' : ''}">支出</button>
      <button data-t="income" class="${type === 'income' ? 'on' : ''}">收入</button>
    </div>
    <div style="text-align:center;margin:10px 0 4px">
      <span style="font-size:20px;color:var(--muted)">¥</span>
      <input id="amt" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="0.00" value="${amount}" style="border:none;outline:none;font-size:38px;font-weight:800;width:58%;text-align:center;color:var(--ink);background:transparent">
    </div>
    <div class="card-title mt16">分类</div>
    <div class="cat-grid" id="catGrid"></div>
    ${acctPickerHTML(accountGroups(accs))}
    <div class="field mt16"><label>备注</label><textarea id="note" class="textarea" placeholder="说点什么…">${note}</textarea></div>
    <div class="field"><label>小票照片（可选）</label><input type="file" id="photo" accept="image/*" capture="environment"></div>
    <div id="thumbBox" class="mt8">${photo ? `<img class="thumb" src="${photo}">` : ''}</div>
    <div class="flex mt16">
      <button class="btn soft" id="cancel">取消</button>
      <button class="btn" id="save">保存</button>
    </div>`;
  openSheet(html, (root, close) => {
    const grid = root.querySelector('#catGrid');
    bindAmountInput(root.querySelector('#amt'));   // 金额框只让输数字（中文输入法也能打汉字，必须自己拦）
    bindAcctPicker(root, accountGroups(accs), () => acctId, (id) => { acctId = id; }, () => (type === 'income' ? '钱进哪里' : '钱从哪出'));
    const renderGrid = () => { grid.innerHTML = catTiles(cats.filter((c) => c.type === type), catId); grid.querySelectorAll('.cat').forEach((b) => b.onclick = () => { catId = b.dataset.id; renderGrid(); }); };
    renderGrid();
    root.querySelectorAll('#typeSeg button').forEach((b) => b.onclick = () => {
      type = b.dataset.t;
      root.querySelectorAll('#typeSeg button').forEach((x) => x.classList.toggle('on', x === b));
      catId = (cats.find((c) => c.type === type) || {}).id; renderGrid();
      if (root['__sync_acct']) root['__sync_acct']();      // 标签跟着改成「钱从哪出 / 钱进哪里」
    });
    const ph = root.querySelector('#photo');
    ph.addEventListener('change', async () => { const f = ph.files[0]; if (f) { photo = await resizeImage(f); root.querySelector('#thumbBox').innerHTML = `<img class="thumb" src="${photo}">`; } });
    root.querySelector('#cancel').onclick = close;
    root.querySelector('#save').onclick = async () => {
      const amt = parseFloat(root.querySelector('#amt').value);
      if (!(amt > 0)) { toast('请输入金额'); return; }
      if (!catId) { toast('请选分类'); return; }
      await db.addRecord({
        id: prefill.id || uid(), type, amount: Math.round(amt * 100) / 100,
        categoryId: catId, note: root.querySelector('#note').value.trim(), photo,
        date: when, createdAt: prefill.createdAt || Date.now(),
        accountId: acctId || null,
      });
      if (acctId) setLastAccount(acctId);          // 下次记一笔默认还用它
      toast(editing ? '已修改 ✓' : '已记下 ✓');
      close(); router();
    };
  });
}

/** 两级账户选择器：「先选大类（微信/支付宝/银行卡/现金…），再选里面的哪个小钱包」。
 *  key 让同一张弹卡里能放两个（转账的「转出」「转入」、定投的「投到哪」「从哪扣」）。
 *  只有一个账户的大类不显示第二行 —— 点一下就直接选中（现金、只有一张卡时的银行卡）。 */
function acctPickerHTML(groups, key = 'acct', title = '钱从哪出') {
  if (!groups || groups.length === 0) return '';
  return `<div class="card-title mt16" id="${key}Title">${title}</div>
    <div class="acct-row" id="${key}G"></div>
    <div class="card-title mt16" id="${key}AT" hidden></div>
    <div class="acct-row" id="${key}A" hidden></div>`;
}
/** 第二行的小标题：「微信里的哪个」；银行卡说「哪张」 */
function subTitle(name) {
  return name + '里的哪' + (name === '银行卡' ? '张' : '个');
}
function bindAcctPicker(root, groups, getSel, setSel, titleFn, key = 'acct') {
  const gRow = root.querySelector('#' + key + 'G');
  if (!gRow || !groups.length) return;
  const title = root.querySelector('#' + key + 'Title');
  const aRow = root.querySelector('#' + key + 'A');
  const aTitle = root.querySelector('#' + key + 'AT');
  const groupOf = (id) => groups.find((g) => g.accounts.some((a) => a.id === id)) || groups[0];

  const sync = () => {
    if (title && titleFn) title.textContent = titleFn();
    const cur = groupOf(getSel());
    gRow.innerHTML = groups.map((g) => `<button class="acct${g.key === cur.key ? ' sel' : ''}" data-g="${g.key}">${g.name}</button>`).join('');
    gRow.querySelectorAll('.acct[data-g]').forEach((b) => {
      b.onclick = () => {
        const g = groups.find((x) => x.key === b.dataset.g);
        if (g) setSel(g.accounts[0].id);      // 切大类时先落在它的第一个小钱包上
        sync();
      };
    });
    const many = cur.accounts.length >= 2;    // 只有一个小钱包就不用问第二遍
    if (aTitle) { aTitle.hidden = !many; aTitle.textContent = subTitle(cur.name); }
    if (aRow) {
      aRow.hidden = !many;
      aRow.innerHTML = many ? cur.accounts.map((a) => `<button class="acct${a.id === getSel() ? ' sel' : ''}" data-id="${a.id}"><span class="e">${a.emoji}</span>${a.name}</button>`).join('') : '';
      aRow.querySelectorAll('.acct[data-id]').forEach((b) => {
        b.onclick = () => { setSel(b.dataset.id); sync(); };
      });
    }
  };
  root['__sync_' + key] = sync;
  sync();
}

/* ==================== 我的钱 / 账户 / 定投 ==================== */

/** 把 #RRGGBB 变成带透明度的 rgba —— 给账户图标做一层淡色底 */
function tint(hex, a) {
  const h = String(hex || '#B0A393').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) || 0;
  const g = parseInt(n.slice(2, 4), 16) || 0;
  const b = parseInt(n.slice(4, 6), 16) || 0;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

/** 账户相关的数据一次取齐：账户表、全部记录、定投计划、算好的余额 */
async function loadAccountWorld() {
  const [accs, recs, plans] = await Promise.all([db.getAllAccounts(), db.getRecords(), db.getAllPlans()]);
  accs.sort((a, b) => (a.order || 0) - (b.order || 0));
  const am = {}; accs.forEach((a) => { am[a.id] = a; });
  return { accs, recs, plans, am, bal: accountBalances(accs, recs) };
}

function accountCardHTML(a, bal, spentM) {
  const v = bal[a.id] || 0;
  return `<button class="acc-card" data-id="${a.id}">
    <span class="acc-ico" style="background:${tint(a.color, .16)}">${a.emoji}</span>
    <span class="acc-nm"><span class="nm-t">${a.name}</span><i class="tag"${a.kind === 'invest' ? '' : ' hidden'}>理财</i></span>
    <span class="acc-bal${v < 0 ? ' neg' : ''}">${moneyNeg(v)}</span>
    <span class="acc-sub">本月花 ${moneyShort(spentM[a.id] || 0)}</span>
  </button>`;
}

/** 账户在别处出现时的叫法：「微信 · 零钱」比光写「零钱」清楚 */
function accLabel(a) {
  if (!a) return '未指定';
  return a.group ? a.group + ' · ' + a.name : a.name;
}

function planCardHTML(p, am) {
  const from = accLabel(am[p.fromAccountId]);
  const to = accLabel(am[p.toAccountId]);
  const next = p.active ? nextRunDate(p) : null;
  const sub = freqLabel(p) + ' · ' + (p.active ? (next ? '下次 ' + (next.getMonth() + 1) + '月' + next.getDate() + '日' : '今天到期') : '已终止');
  return `<button class="plan${p.active ? '' : ' off'}" data-plan="${p.id}">
    <span class="acc-ico" style="background:${tint('#F2703F', .14)}">🔁</span>
    <div class="body"><div class="t">${from} → ${to}</div><div class="n">${sub}</div></div>
    <span class="a">${moneyShort(p.amount)}</span>
  </button>`;
}

async function renderAccounts() {
  const { accs, recs, plans, am, bal } = await loadAccountWorld();
  const total = accs.reduce((s, a) => s + (bal[a.id] || 0), 0);
  const [ms, me] = monthRange(new Date());
  const mEnd = me.getTime() + 86400000 - 1;
  const spentM = {};
  accs.forEach((a) => { spentM[a.id] = spentInRange(recs, a.id, ms.getTime(), mEnd); });

  // 第一次进来：所有账户都还是 0，也没校准过 —— 先请用户把现有金额填一遍
  const needSetup = accs.length > 0 && !recs.some((r) => r.kind === 'adjust')
    && accs.every((a) => !(Number(a.initial) > 0));
  const running = plans.filter((p) => p.active).length;

  // 每一类各自一块，类与类之间留出间隔 —— 不然排在后面的账户会顺着上一类的网格继续流，
  // 看起来就像上一类里的第 N 个钱包（现金、银行卡会被误读成支付宝下面的）。
  //   多个钱包的类：类名行（圆点 + 类名 + 小计 + 「＋」）+ 下面两列的钱包卡片
  //   只有一个钱包的类：直接排成整行 —— 名字只说一遍，不用再顶一个和它同名的类名
  const groups = accountGroups(accs);
  const secsHTML = groups.map((g) => {
    const first = g.accounts[0];
    if (!first) return '';
    if (g.accounts.length < 2) {
      const v = bal[first.id] || 0;
      return `<div class="acc-sec"><div class="acc-single" data-id="${first.id}">
        <span class="acc-ico" style="background:${tint(first.color, .16)}">${first.emoji}</span>
        <span class="acc-nm"><span class="nm-t">${first.name}</span><i class="tag"${first.kind === 'invest' ? '' : ' hidden'}>理财</i></span>
        <span class="acc-bal${v < 0 ? ' neg' : ''}">${moneyNeg(v)}</span>
        ${first.group ? `<button class="gadd" data-group="${first.group}" title="在「${first.group}」里再加一个">＋</button>` : ''}
      </div></div>`;
    }
    return `<div class="acc-sec">
      <div class="acc-sechead">
        <span class="dot" style="background:${first.color}"></span>
        <span class="nm">${g.name}</span>
        <span class="sum">小计 ${moneyNeg(groupBalance(g, bal))}</span>
        <button class="gadd" data-group="${g.name}" title="在「${g.name}」里再加一个">＋</button>
      </div>
      <div class="acc-grid">${g.accounts.map((a) => accountCardHTML(a, bal, spentM)).join('')}</div>
    </div>`;
  }).join('');

  view.innerHTML = `
    ${needSetup ? `<div class="card">
      <div class="card-title">第一步：每个地方现在有多少钱</div>
      <div class="hint-line">填你「现在」实际有多少钱就行（比如微信零钱里还有 683.50）。填完之后你每记一笔，对应的地方会自动加减，随时能看到还剩多少。只填填得出来的，空着的不用管。</div>
      <button class="btn block" id="accSetup">✏️ 填现有金额</button>
    </div>` : ''}
    <div class="card">
      <div class="acc-total">
        <div class="k">我的钱 · 加起来</div>
        <div class="v${total < 0 ? ' neg' : ''}">${moneyNeg(total)}</div>
        <div class="s">${groups.length} 个地方 · ${accs.length} 个钱包${running ? ' · ' + running + ' 个定投在跑' : ''}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">账户 · 点进去看流水</div>
      <div class="acc-secs">${secsHTML}</div>
      <button class="acc-add" id="addAcc"><span class="plus">＋</span><span>添加账户</span></button>
    </div>
    <div class="card">
      <div class="card-title">定投</div>
      ${plans.length ? plans.map((p) => planCardHTML(p, am)).join('')
        : '<div class="hint-line" style="margin-bottom:14px">还没有定投。定投＝每月固定一天，从某个账户自动转一笔钱到理财账户（基金 / 股票），不用你手动记。</div>'}
      <button class="btn ghost block mt16" id="addPlan">＋ 添加定投</button>
    </div>
    <div class="hint-line" style="text-align:center;margin-bottom:18px">转账、校准余额在右上角「🔁 转账」和账户详情里<br>转账只是钱换个地方，不算花钱、不进支出统计</div>`;

  appbarAction.hidden = false;
  appbarAction.textContent = '🔁 转账';
  appbarAction.onclick = () => openTransferSheet();

  const s = view.querySelector('#accSetup');
  if (s) s.onclick = () => openSetupSheet();
  view.querySelector('#addAcc').onclick = () => openAccountEditSheet(null);
  view.querySelector('#addPlan').onclick = () => openPlanSheet(null);
  view.querySelectorAll('.acc-card[data-id], .acc-single[data-id]').forEach((b) => {
    b.onclick = () => { location.hash = '#/acct/' + b.dataset.id; };
  });
  view.querySelectorAll('.gadd[data-group]').forEach((b) => {
    // 整行那个「＋」是嵌在可点的行里面的，别让点击冒泡上去把行也点了
    b.onclick = (e) => { e.stopPropagation(); openAccountEditSheet(null, b.dataset.group); };
  });
  view.querySelectorAll('.plan[data-plan]').forEach((b) => {
    b.onclick = () => openPlanSheet(b.dataset.plan);
  });
}

async function renderAccountDetail() {
  const id = location.hash.split('/')[2] || '';
  const { accs, recs, am, bal } = await loadAccountWorld();
  const a = accs.find((x) => x.id === id);
  if (!a) { toast('这个账户不在了'); location.hash = '#/accounts'; return; }
  appbarTitle.textContent = (a.group ? a.group + ' · ' : '') + a.name + (a.kind === 'invest' ? ' · 理财' : '');

  const cm = {}; (await db.getAllCategories()).forEach((c) => { cm[c.id] = c; });
  const v = bal[a.id] || 0;
  const list = accountRecords(recs, a.id);
  const init = Math.round((Number(a.initial) || 0) * 100) / 100;

  view.innerHTML = `
    <div class="card">
      <div class="acc-total">
        <div class="acc-ico lg" style="background:${tint(a.color, .16)}">${a.emoji}</div>
        <div class="v${v < 0 ? ' neg' : ''}">${moneyNeg(v)}</div>
        <div class="s">开户时 ¥${init} · 共 ${list.length} 笔流水</div>
      </div>
      <div class="acc-acts">
        <button class="btn soft" id="calib">🎯 校准余额</button>
        ${a.kind === 'invest' ? '<button class="btn soft" id="pnl">📈 记盈亏</button>' : ''}
        <button class="btn soft" id="rename">✏️ 编辑</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">流水（${list.length}）</div>
      ${list.length ? `<div class="list">${list.map((r) => ledgerRow(r, cm, am, a.id)).join('')}</div>`
        : '<div class="empty">这个账户还没有流水<br><span style="font-size:12px">去「记一笔」选这个账户，或者点上面「校准余额」</span></div>'}
    </div>
    <div class="card">
      <button class="btn danger block" id="delAcc">删除这个账户</button>
      <div class="hint-line" style="margin:8px 0 0">删掉之后，这个账户的余额就不再显示；记过的账还留着，只是不再挂在账户上。</div>
    </div>`;

  appbarAction.hidden = false;
  appbarAction.textContent = '🔁 转账';
  appbarAction.onclick = () => openTransferSheet();

  view.querySelector('#calib').onclick = () => openCalibrateSheet(a);
  const pnlBtn = view.querySelector('#pnl');
  if (pnlBtn) pnlBtn.onclick = () => openPnlSheet(a);
  view.querySelector('#rename').onclick = () => openAccountEditSheet(a);
  view.querySelector('#delAcc').onclick = async () => {
    if (!confirm('删除账户「' + a.name + '」？\n\n记过的账还在，只是不再挂到这个账户上；这个账户的余额也不再显示。')) return;
    await db.delAccount(a.id);
    toast('已删除账户');
    location.hash = '#/accounts';
  };

  // 流水行上的「改 / 删」
  view.querySelectorAll('.edit').forEach((b) => b.onclick = async () => {
    const rec = (await db.getRecords()).find((x) => x.id === b.dataset.id);
    if (!rec) { toast('这条记录找不到了'); return; }
    openEntrySheet({
      id: rec.id, amount: rec.amount, type: rec.type, categoryId: rec.categoryId,
      note: rec.note, photo: rec.photo, date: rec.date, createdAt: rec.createdAt,
      accountId: rec.accountId,
    });
  });
  view.querySelectorAll('.del').forEach((b) => b.onclick = async () => {
    if (!confirm('确定删除这条记录？')) return;
    await db.deleteRecord(b.dataset.id);
    toast('已删除'); router();
  });
}

/** 第一次用：把「现在每个账户有多少钱」一次填完。
 *  填的是「当前余额」，所以要把这期间已经记过的流水倒推出去，换算成开户金额 ——
 *  这样不管用户是刚装好还是已经用了一阵子，填完都能对上数。 */
async function openSetupSheet() {
  const { accs, bal } = await loadAccountWorld();
  const html = `<h3>填一下现有金额</h3>
    <div class="hint-line">填你「现在」实际有多少钱。只填填得出来的，空着的不动。填完以后记账会自动加减，不用再管；哪天对不上数了，用「校准余额」改一次就行。</div>
    ${accs.map((a) => `<div class="row plain">
      <span class="acc-ico" style="background:${tint(a.color, .16)};width:36px;height:36px;font-size:19px">${a.emoji}</span>
      <div style="flex:1;min-width:0"><div class="label">${a.group ? a.group + ' · ' + a.name : a.name}</div><div class="sub">现在有</div></div>
      <span style="color:var(--muted);font-weight:700">¥</span>
      <input class="input setup-in" style="width:116px;text-align:right" data-aid="${a.id}" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="0.00">
    </div>`).join('')}
    <div class="flex mt16"><button class="btn soft" id="c">取消</button><button class="btn" id="s">保存</button></div>`;
  openSheet(html, (root, close) => {
    root.querySelectorAll('.setup-in').forEach(bindAmountInput);
    root.querySelector('#c').onclick = close;
    root.querySelector('#s').onclick = async () => {
      let n = 0;
      for (const inp of root.querySelectorAll('.setup-in')) {
        const aid = inp.dataset.aid;
        const a = accs.find((x) => x.id === aid); if (!a) continue;
        const raw = inp.value.trim();
        if (raw === '') continue;                        // 没填的账户不动
        const want = parseFloat(raw) || 0;
        const cur = bal[aid] || 0;                       // 现在算出来的余额
        const delta = Math.round((want - cur) * 100) / 100;
        if (delta === 0) continue;
        await db.addAccount(Object.assign({}, a, { initial: Math.round(((Number(a.initial) || 0) + delta) * 100) / 100 }));
        n++;
      }
      toast(n ? '好啦，以后自动加减 ✓' : '没有变化');
      close(); router();
    };
  });
}

/** 新建 / 修改账户。presetGroup = 从某个大类的「＋」进来时，默认归到那一类 */
async function openAccountEditSheet(a, presetGroup) {
  const editing = !!a;
  const all = await db.getAllAccounts();
  let emoji = a ? a.emoji : '💳';
  let color = a ? (a.color || ACCOUNT_COLORS[0]) : ACCOUNT_COLORS[0];
  let kind = a ? (a.kind || 'normal') : 'normal';
  let group = a ? (a.group || '') : (presetGroup || '');

  // 归类候选：常见的几个 + 用户自己已经建过的组名
  const cands = [''];
  ['微信', '支付宝', '银行卡', '现金', '理财'].forEach((g) => { if (!cands.includes(g)) cands.push(g); });
  all.forEach((x) => { if (x.group && !cands.includes(x.group)) cands.push(x.group); });

  const html = `<h3>${editing ? '改账户' : '添加账户'}</h3>
    <div class="field"><label>名字</label><input id="an" class="input" placeholder="如：零钱 / 广发银行 / 基金" value="${editing ? a.name : ''}"></div>
    <div class="field"><label>图标（填一个 emoji 就行）</label><input id="ae" class="input" placeholder="💳" value="${emoji}"></div>
    <div class="card-title">归到哪一类</div>
    <div class="acct-row" id="gpick"></div>
    <div class="hint-line">归类＝和谁排在一起。比如新加一张「建设银行」归到「银行卡」，它就会和「广发银行」归在一起、上面多一个合计；「不归类」就自己单独一格。<b>现金、基金这种只有一个的，不归类就行。</b></div>
    <div class="seg" id="kseg">
      <button data-k="normal" class="${kind === 'normal' ? 'on' : ''}">日常账户</button>
      <button data-k="invest" class="${kind === 'invest' ? 'on' : ''}">理财账户</button>
    </div>
    <div class="hint-line">日常账户＝零钱、余额、银行卡、现金；理财账户＝零钱通、余额宝、基金，可以在这里记盈亏、也能当定投的去处。</div>
    <div class="card-title">颜色</div>
    <div class="cat-grid" id="cgrid"></div>
    <div class="flex mt16"><button class="btn soft" id="c">取消</button><button class="btn" id="s">保存</button></div>`;
  openSheet(html, (root, close) => {
    const gpick = root.querySelector('#gpick');
    const rg2 = () => {
      gpick.innerHTML = cands.map((g) => `<button class="acct${g === group ? ' sel' : ''}" data-g="${g}">${g || '不归类'}</button>`).join('');
      gpick.querySelectorAll('.acct[data-g]').forEach((b) => b.onclick = () => { group = b.dataset.g; rg2(); });
    };
    rg2();
    const grid = root.querySelector('#cgrid');
    const rg = () => {
      grid.innerHTML = ACCOUNT_COLORS.map((c) => `<button class="cat ${c === color ? 'sel' : ''}" data-c="${c}"><span class="emoji" style="background:${c};width:22px;height:22px;border-radius:50%"></span></button>`).join('');
      grid.querySelectorAll('.cat').forEach((b) => b.onclick = () => { color = b.dataset.c; rg(); });
    };
    rg();
    root.querySelectorAll('#kseg button').forEach((b) => b.onclick = () => {
      kind = b.dataset.k;
      root.querySelectorAll('#kseg button').forEach((x) => x.classList.toggle('on', x === b));
    });
    root.querySelector('#ae').addEventListener('input', (e) => { emoji = e.target.value.trim() || '💳'; });
    root.querySelector('#c').onclick = close;
    root.querySelector('#s').onclick = async () => {
      const name = root.querySelector('#an').value.trim();
      if (!name) { toast('请输入名字'); return; }
      if (editing) {
        await db.addAccount(Object.assign({}, a, { name, emoji, color, kind, group }));
      } else {
        // 新账户排到最后（组内的位置也由 order 决定）
        const maxOrder = all.reduce((m, x) => Math.max(m, Number(x.order) || 0), 0);
        await db.addAccount({
          id: 'a' + Date.now(), name, emoji, color, kind, group,
          initial: 0, order: maxOrder + 1, hidden: false, createdAt: Date.now(),
        });
      }
      toast(editing ? '已修改 ✓' : '已添加 ✓'); close(); router();
    };
  });
}

/** 转账：钱从一个账户挪到另一个账户。不算花钱，绝不进支出统计。 */
async function openTransferSheet(prefill) {
  const pre = prefill || {};
  const { accs } = await loadAccountWorld();
  if (accs.length < 2) { toast('至少要有两个账户才能转账，先添一个吧'); return; }
  const groups = accountGroups(accs);
  let fromId = pre.fromId || accs[0].id;
  let toId = pre.toId || (accs.find((a) => a.id !== fromId) || {}).id;
  const html = `<h3>转账</h3>
    <div class="hint-line">钱从一个地方挪到另一个地方（比如微信提现到银行卡、零钱转到零钱通）。转账<b>只是钱换了地方，不算花钱</b>，不会进支出统计。</div>
    ${acctPickerHTML(groups, 'from', '从哪儿出')}
    ${acctPickerHTML(groups, 'to', '挪到哪儿')}
    <div style="text-align:center;margin:16px 0 4px">
      <span style="font-size:20px;color:var(--muted)">¥</span>
      <input id="amt" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="0.00" style="border:none;outline:none;font-size:38px;font-weight:800;width:58%;text-align:center;color:var(--ink);background:transparent">
    </div>
    <div class="field mt16"><label>备注（可选）</label><input id="note" class="input" placeholder="如：还信用卡"></div>
    <div class="flex mt16"><button class="btn soft" id="c">取消</button><button class="btn" id="s">转过去</button></div>`;
  openSheet(html, (root, close) => {
    bindAmountInput(root.querySelector('#amt'));
    bindAcctPicker(root, groups, () => fromId, (id) => { fromId = id; }, null, 'from');
    bindAcctPicker(root, groups, () => toId, (id) => { toId = id; }, null, 'to');
    root.querySelector('#c').onclick = close;
    root.querySelector('#s').onclick = async () => {
      const amt = parseFloat(root.querySelector('#amt').value);
      if (!(amt > 0)) { toast('请输入金额'); return; }
      if (fromId === toId) { toast('两个账户不能是同一个'); return; }
      await db.addRecord({
        id: uid(), kind: 'transfer', type: 'transfer',
        amount: Math.round(amt * 100) / 100,
        accountId: fromId, toAccountId: toId, note: root.querySelector('#note').value.trim(),
        categoryId: null, photo: null, date: Date.now(), createdAt: Date.now(),
      });
      toast('已转账 ✓'); close(); router();
    };
  });
}

/** 校准余额：把软件里算的和实际对一下，差出来的记成一笔「校准」 */
async function openCalibrateSheet(a) {
  const { bal } = await loadAccountWorld();
  const cur = bal[a.id] || 0;
  const html = `<h3>校准「${a.group ? a.group + ' · ' : ''}${a.name}」的余额</h3>
    <div class="hint-line">打开微信 / 银行 App 看一眼真实余额，填在下面。差出来的那部分会记成一笔「校准」，往后就对得上数了。校准不算花钱。</div>
    <div class="calib-cur"><span class="muted">软件里现在算的是</span><span class="a">${moneyNeg(cur)}</span></div>
    <div class="field"><label>实际有多少钱</label>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:18px;color:var(--muted);font-weight:700">¥</span>
        <input id="real" class="input" style="flex:1;text-align:right;font-size:20px;font-weight:700" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${Math.round(cur * 100) / 100}">
      </div>
    </div>
    <div class="field"><label>备注（可选）</label><input id="note" class="input" placeholder="如：漏记了几笔"></div>
    <div class="flex mt16"><button class="btn soft" id="c">取消</button><button class="btn" id="s">校准</button></div>`;
  openSheet(html, (root, close) => {
    bindAmountInput(root.querySelector('#real'));
    root.querySelector('#c').onclick = close;
    root.querySelector('#s').onclick = async () => {
      const raw = root.querySelector('#real').value.trim();
      if (raw === '') { toast('请填一下实际余额'); return; }
      const want = parseFloat(raw) || 0;
      const delta = Math.round((want - cur) * 100) / 100;
      if (delta === 0) { toast('和实际一样，不用改'); close(); return; }
      await db.addRecord({
        id: uid(), kind: 'adjust', type: delta > 0 ? 'income' : 'expense', amount: delta,
        accountId: a.id, note: root.querySelector('#note').value.trim() || '余额校准',
        categoryId: null, photo: null, date: Date.now(), createdAt: Date.now(),
      });
      toast('校准好了 ✓'); close(); router();
    };
  });
}

/** 记投资盈亏：赚了 / 亏了多少钱，自己填（这软件不联网，猜不到行情） */
async function openPnlSheet(a) {
  let dir = 'up';
  const html = `<h3>记「${a.name}」的盈亏</h3>
    <div class="hint-line">基金 / 股票今天赚了还是亏了，自己填一个数，账户余额就跟着变。<b>盈亏不算收入也不算支出</b>，不会影响你的消费统计。</div>
    <div class="seg" id="dseg"><button data-d="up" class="on">📈 赚了</button><button data-d="down">📉 亏了</button></div>
    <div style="text-align:center;margin:10px 0 4px">
      <span style="font-size:20px;color:var(--muted)">¥</span>
      <input id="amt" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="0.00" style="border:none;outline:none;font-size:38px;font-weight:800;width:58%;text-align:center;color:var(--ink);background:transparent">
    </div>
    <div class="field mt16"><label>备注（可选）</label><input id="note" class="input" placeholder="如：今日净值"></div>
    <div class="flex mt16"><button class="btn soft" id="c">取消</button><button class="btn" id="s">记上</button></div>`;
  openSheet(html, (root, close) => {
    bindAmountInput(root.querySelector('#amt'));
    root.querySelectorAll('#dseg button').forEach((b) => b.onclick = () => {
      dir = b.dataset.d;
      root.querySelectorAll('#dseg button').forEach((x) => x.classList.toggle('on', x === b));
    });
    root.querySelector('#c').onclick = close;
    root.querySelector('#s').onclick = async () => {
      const v = parseFloat(root.querySelector('#amt').value);
      if (!(v > 0)) { toast('请输入金额'); return; }
      const delta = Math.round((dir === 'up' ? v : -v) * 100) / 100;
      await db.addRecord({
        id: uid(), kind: 'pnl', type: dir === 'up' ? 'income' : 'expense', amount: delta,
        accountId: a.id, note: root.querySelector('#note').value.trim(),
        categoryId: null, photo: null, date: Date.now(), createdAt: Date.now(),
      });
      toast('记上了 ✓'); close(); router();
    };
  });
}

/** 定投设置：投到哪 + 从哪扣 + 多少钱 + 每月几号（或每周几）+ 开关 */
async function openPlanSheet(planId) {
  const { accs, plans } = await loadAccountWorld();
  const p = planId ? plans.find((x) => x.id === planId) : null;
  if (planId && !p) { toast('这个定投找不到了'); return; }
  if (accs.length < 2) { toast('定投要有「扣钱的账户」和「理财账户」，先添加一个吧'); return; }

  // 定投默认投到「不归类」的理财账户（一般就是基金），没有再退回第一个理财账户
  let toId = p ? p.toAccountId
    : (((accs.find((a) => a.kind === 'invest' && !a.group) || accs.find((a) => a.kind === 'invest') || accs[0]) || {}).id);
  let fromId = p ? p.fromAccountId : (((accs.find((a) => a.id !== toId) || accs[0]) || {}).id);
  let freq = p ? (p.freq || 'monthly') : 'monthly';
  let day = p ? Number(p.day) : new Date().getDate();
  const groups = accountGroups(accs);

  const dayBoxHTML = () => (freq === 'weekly'
    ? `<div class="card-title mt16">每周哪天</div><div class="week-row" id="wrow">${['日', '一', '二', '三', '四', '五', '六'].map((w, i) => `<button data-d="${i}" class="${Number(day) === i ? 'on' : ''}">${w}</button>`).join('')}</div>`
    : `<div class="field mt16"><label>每月几号</label><input id="dnum" class="input" inputmode="numeric" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="15" value="${Number(day) || 1}"><div class="hint-line" style="margin:6px 0 0">遇到小月（比如 2 月没有 31 号）会自动算到当月最后一天。</div></div>`);

  const html = `<h3>${p ? '定投设置' : '添加定投'}</h3>
    <div class="hint-line">定投＝固定时间自动从某个账户转一笔钱到理财账户（基金 / 股票）。<b>不用你手动记，打开 App 就自动补上。</b></div>
    ${acctPickerHTML(groups, 'to', '投到哪儿（基金 / 股票）')}
    ${acctPickerHTML(groups, 'from', '从哪儿扣钱')}
    <div style="text-align:center;margin:16px 0 4px">
      <span style="font-size:20px;color:var(--muted)">¥</span>
      <input id="amt" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="0.00" value="${p ? p.amount : ''}" style="border:none;outline:none;font-size:38px;font-weight:800;width:58%;text-align:center;color:var(--ink);background:transparent">
    </div>
    <div class="card-title mt16">多久投一次</div>
    <div class="seg" id="fseg">
      <button data-f="monthly" class="${freq === 'monthly' ? 'on' : ''}">每月</button>
      <button data-f="weekly" class="${freq === 'weekly' ? 'on' : ''}">每周</button>
    </div>
    <div id="dayBox">${dayBoxHTML()}</div>
    ${p ? `<div class="row plain mt16">
      <div style="flex:1;min-width:0"><div class="label">正在运行</div><div class="sub">关掉以后就不再自动投了（已经投过的不受影响）</div></div>
      <label class="switch"><input type="checkbox" id="act" ${p.active ? 'checked' : ''}><span class="track"></span><span class="dot"></span></label>
    </div>` : ''}
    <div class="flex mt16"><button class="btn soft" id="c">取消</button><button class="btn" id="s">保存</button></div>
    ${p ? '<button class="btn danger block mt16" id="delp">删除这个定投</button>' : ''}`;

  openSheet(html, (root, close) => {
    const dayBox = root.querySelector('#dayBox');
    const bindDayBox = () => {
      const wrow = root.querySelector('#wrow');
      if (wrow) wrow.querySelectorAll('button[data-d]').forEach((b) => b.onclick = () => {
        day = Number(b.dataset.d);
        wrow.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      });
      const dnum = root.querySelector('#dnum');
      if (dnum) dnum.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^\d]/g, ''); day = parseInt(e.target.value, 10) || 1; });
    };
    bindDayBox();
    root.querySelectorAll('#fseg button').forEach((b) => b.onclick = () => {
      freq = b.dataset.f;
      root.querySelectorAll('#fseg button').forEach((x) => x.classList.toggle('on', x === b));
      if (freq === 'weekly') { if (Number(day) > 6) day = new Date().getDay(); } else if (Number(day) < 1) day = new Date().getDate();
      dayBox.innerHTML = dayBoxHTML(); bindDayBox();
    });

    bindAmountInput(root.querySelector('#amt'));
    bindAcctPicker(root, groups, () => toId, (id) => { toId = id; }, null, 'to');
    bindAcctPicker(root, groups, () => fromId, (id) => { fromId = id; }, null, 'from');

    root.querySelector('#c').onclick = close;
    root.querySelector('#s').onclick = async () => {
      const amt = parseFloat(root.querySelector('#amt').value);
      if (!(amt > 0)) { toast('请输入金额'); return; }
      if (toId === fromId) { toast('扣钱的账户和投资的账户不能是同一个'); return; }
      const dnum = root.querySelector('#dnum');
      let d = Number(day);
      if (freq === 'monthly') {
        d = dnum ? (parseInt(dnum.value, 10) || 1) : (Number(day) || 1);
        d = Math.min(31, Math.max(1, d));
      } else {
        d = Math.min(6, Math.max(0, Number(day) || 0));
      }
      const actEl = root.querySelector('#act');
      await db.addPlan({
        id: p ? p.id : ('pl' + Date.now()),
        toAccountId: toId, fromAccountId: fromId,
        amount: Math.round(amt * 100) / 100,
        freq, day: d,
        startDate: p ? p.startDate : Date.now(),
        lastRunKey: p ? (p.lastRunKey || '') : '',
        active: actEl ? !!actEl.checked : true,
        createdAt: p ? p.createdAt : Date.now(),
      });
      await runDuePlans();          // 保存完立刻把已经到期的补上
      toast('定投已保存 ✓'); close(); router();
    };
    const delp = root.querySelector('#delp');
    if (delp) delp.onclick = async () => {
      if (!confirm('删掉这个定投？\n\n以后不再自动投；已经自动记下的那些转账会留着。')) return;
      await db.delPlan(p.id);
      toast('已删除定投'); close(); router();
    };
  });
}

/** 打开 App 时把到期的定投补记上。
 *  记录 id 是「计划 + 日期」拼死的，所以反复打开也只会有一条，不会重复。 */
async function runDuePlans() {
  let plans = [];
  try { plans = await db.getAllPlans(); } catch (_) { return 0; }
  const today = new Date();
  let n = 0;
  for (const p of plans) {
    if (!p.active) continue;
    const keys = dueDates(p, today);
    if (!keys.length) continue;
    for (const k of keys) {
      const ts = new Date(k + 'T09:00:00').getTime();   // 记在当天早上 9 点，日历里不会跑到「未来」
      await db.addRecord({
        id: runRecordId(p, k), kind: 'transfer', type: 'transfer',
        amount: p.amount, accountId: p.fromAccountId, toAccountId: p.toAccountId,
        note: '定投', categoryId: null, photo: null,
        date: ts, createdAt: Date.now(), planId: p.id,
      });
      n++;
    }
    // 记住跑到哪儿了，下次不再重复补
    await db.addPlan(Object.assign({}, p, { lastRunKey: keys[keys.length - 1] }));
  }
  if (n) toast('定投自动记了 ' + n + ' 笔');
  return n;
}

async function openQuickSheet() {
  const cats = await db.getCategories();
  let type = 'expense', amount = '', catId = (cats.find((c) => c.type === 'expense') || {}).id, label = '';
  const html = `<h3>添加常用一笔</h3>
    <div class="seg" id="tseg"><button data-t="expense" class="on">支出</button><button data-t="income">收入</button></div>
    <div class="field"><label>名称</label><input id="ql" class="input" placeholder="如：午饭"></div>
    <div class="field"><label>金额</label><input id="qa" class="input" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="0.00"></div>
    <div class="card-title">分类</div><div class="cat-grid" id="cgrid"></div>
    <div class="flex mt16"><button class="btn soft" id="c">取消</button><button class="btn" id="s">保存</button></div>`;
  openSheet(html, (root, close) => {
    const grid = root.querySelector('#cgrid');
    bindAmountInput(root.querySelector('#qa'));   // 同上：金额框只收数字
    const rg = () => { grid.innerHTML = catTiles(cats.filter((c) => c.type === type), catId); grid.querySelectorAll('.cat').forEach((b) => b.onclick = () => { catId = b.dataset.id; rg(); }); };
    rg();
    root.querySelectorAll('#tseg button').forEach((b) => b.onclick = () => { type = b.dataset.t; root.querySelectorAll('#tseg button').forEach((x) => x.classList.toggle('on', x === b)); catId = (cats.find((c) => c.type === type) || {}).id; rg(); });
    root.querySelector('#c').onclick = close;
    root.querySelector('#s').onclick = async () => {
      const amt = parseFloat(root.querySelector('#qa').value); const lb = root.querySelector('#ql').value.trim();
      if (!(amt > 0)) { toast('请输入金额'); return; }
      if (!lb) { toast('请输入名称'); return; }
      if (!catId) { toast('请选分类'); return; }
      await db.addQuick({ id: uid(), label: lb, type, amount: Math.round(amt * 100) / 100, categoryId: catId, emoji: (cats.find((c) => c.id === catId) || {}).emoji });
      toast('已添加'); close(); router();
    };
  });
}

// ---------- 日历 ----------
function dayTotals(records) {
  const m = {};
  for (const r of records) {
    const k = dayKey(new Date(r.date));
    if (!m[k]) m[k] = { exp: 0, inc: 0, has: false };
    if (r.type === 'expense') m[k].exp += r.amount; else m[k].inc += r.amount;
    m[k].has = true;
  }
  return m;
}
function calendarHTML(d, map) {
  const y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const todayKey = dayKey(new Date());
  const selKey = dayKey(state.selDate || new Date());
  let cells = '';
  for (let i = 0; i < startDow; i++) { const dd = prevDays - startDow + 1 + i; cells += `<button class="cal-day other" disabled><span class="d">${dd}</span></button>`; }
  for (let dd = 1; dd <= daysInMonth; dd++) {
    const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const t = map[k];
    const cls = `cal-day${k === todayKey ? ' today' : ''}${k === selKey ? ' sel' : ''}${t && t.has ? ' has' : ''}`;
    let amtStr = '';
    if (t) { const s = moneyCell(t.exp); amtStr = `<span class="amt${cellAmtLong(s) ? ' sm' : ''}">${s}</span>`; }
    cells += `<button class="${cls}" data-k="${k}"><span class="d">${dd}</span>${amtStr}</button>`;
  }
  const trail = (7 - ((startDow + daysInMonth) % 7)) % 7;
  for (let i = 1; i <= trail; i++) cells += `<button class="cal-day other" disabled><span class="d">${i}</span></button>`;
  return `<div class="card">
      <div class="cal-head"><button id="prev">‹</button><span class="title">${y}年${m + 1}月</span><button id="next">›</button><button id="jumpBtn" class="jump-btn">日期跳转</button></div>
      <div id="jumpPanel" class="jump-panel" hidden>
        <div class="jump-row"><button id="jumpToday" class="btn soft">📍 今天</button><input id="jumpDate" type="date" class="input jump-date"></div>
      </div>
      <div class="cal-grid"><div class="cal-dow">一</div><div class="cal-dow">二</div><div class="cal-dow">三</div><div class="cal-dow">四</div><div class="cal-dow">五</div><div class="cal-dow">六</div><div class="cal-dow">日</div>${cells}</div>
    </div><div id="dayDetail"></div>`;
}
async function renderCalendar() {
  const all = await db.getRecords();
  const records = onlyNormal(all);                     // 日历只看真实收支，转账不算花钱
  const map = dayTotals(records);
  const d = state.calDate || new Date();
  view.innerHTML = calendarHTML(d, map);
  view.querySelector('#prev').onclick = () => { state.calDate = new Date(d.getFullYear(), d.getMonth() - 1, 1); router(); };
  view.querySelector('#next').onclick = () => { state.calDate = new Date(d.getFullYear(), d.getMonth() + 1, 1); router(); };

  // 日期跳转面板
  const jumpBtn = view.querySelector('#jumpBtn');
  const jumpPanel = view.querySelector('#jumpPanel');
  const jumpToday = view.querySelector('#jumpToday');
  const jumpDateInput = view.querySelector('#jumpDate');
  // 设置 date input 默认值为今天
  const todayISO = dayKey(new Date());
  jumpDateInput.value = todayISO;
  jumpBtn.onclick = () => { jumpPanel.hidden = !jumpPanel.hidden; };
  jumpToday.onclick = () => { state.calDate = new Date(); state.selDate = new Date(); router(); };
  jumpDateInput.onchange = () => {
    if (jumpDateInput.value) { state.calDate = parseDayKey(jumpDateInput.value); state.selDate = parseDayKey(jumpDateInput.value); router(); }
  };

  // 点日期：完整重绘，让选中高亮跟着移动，并直接展开那天全部记录
  view.querySelectorAll('.cal-day[data-k]').forEach((b) => b.onclick = () => {
    state.selDate = parseDayKey(b.dataset.k);
    router();
  });
  await renderDayDetail(view, records, all);
}
async function renderDayDetail(view, records, all) {
  const box = view.querySelector('#dayDetail'); if (!box) return;
  const { cm, am } = await loadMaps();
  const k = dayKey(state.selDate || new Date());
  const day = records.filter((r) => dayKey(new Date(r.date)) === k).sort((a, b) => b.date - a.date);
  const expRecs = day.filter((r) => r.type === 'expense');
  const incRecs = day.filter((r) => r.type === 'income');
  const exp = expRecs.reduce((s, r) => s + r.amount, 0);
  const inc = incRecs.reduce((s, r) => s + r.amount, 0);
  // 转账 / 校准 / 盈亏 不算花钱，日历格子里不显示，但得让用户知道「钱动过」
  const special = (all || []).filter((r) => !isNormal(r) && dayKey(new Date(r.date)) === k);
  const sel = state.selDate || new Date();
  const weekName = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][sel.getDay()];
  const dateLabel = `${sel.getMonth() + 1}月${sel.getDate()}日 ${weekName}`;
  box.innerHTML = `<div class="day-label"><span>📌 ${dateLabel}</span><button class="day-add" id="dayAdd">＋ 补一笔</button></div><div class="day-sum">
    <div class="box tap-box" data-dtype="expense"><div class="v exp-amt">${moneyShort(exp)}</div><div class="k">支出 ▾</div></div>
    <div class="box tap-box" data-dtype="income"><div class="v inc-amt">${moneyShort(inc)}</div><div class="k">收入 ▾</div></div>
  </div>${special.length ? `<div class="hint-line" style="margin:0 2px 8px">这天还有 ${special.length} 笔转账 / 校准 / 盈亏，不算支出 —— 在「我的钱」里能看</div>` : ''}<div id="calDayList" class="rec-list" hidden></div>`;

  // 「补一笔」：直接记到当前选中的这一天（昨天忘了记就能补上）
  const addBtn = box.querySelector('#dayAdd');
  if (addBtn) addBtn.onclick = () => {
    const n = new Date();
    const ts = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate(), n.getHours(), n.getMinutes()).getTime();
    openEntrySheet({ date: ts });
  };

  const listEl = box.querySelector('#calDayList');
  let curFilter = 'all'; // all | expense | income | none

  const applyList = () => {
    // 同步箭头
    box.querySelectorAll('.tap-box').forEach((b) => {
      const type = b.dataset.dtype;
      b.querySelector('.k').textContent = (type === 'expense' ? '支出' : '收入') + (curFilter === type ? ' ▴' : ' ▾');
    });
    if (day.length === 0) {
      listEl.innerHTML = `<div class="empty">这天还没有记录<br><span style="font-size:12px">点上面的「＋ 补一笔」就能补上</span></div>`;
      listEl.hidden = false; return;
    }
    if (curFilter === 'none') { listEl.hidden = true; return; }
    const filtered = curFilter === 'all' ? day : day.filter((r) => r.type === curFilter);
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty">暂无${curFilter === 'expense' ? '支出' : '收入'}记录</div>`;
    } else {
      listEl.innerHTML = `<div class="list">${filtered.map((r) => recordRow(r, cm, am)).join('')}</div>`;
      wireRecordList(listEl);
    }
    listEl.hidden = false;
  };

  // 点支出/收入卡片 → 按类型筛选；再点一次收起
  box.querySelectorAll('.tap-box').forEach((b) => {
    b.style.cursor = 'pointer';
    b.addEventListener('click', () => {
      const type = b.dataset.dtype;
      curFilter = curFilter === type ? 'none' : type;
      applyList();
    });
  });

  applyList(); // 默认展示那天全部记录
}

// ---------- 统计 ----------
function budgetBar(name, used, limit) {
  const pct = Math.min(100, (used / limit) * 100);
  let cls = ''; if (pct >= 100) cls = 'over'; else if (pct >= 80) cls = 'warn';
  return `<div class="budget"><div class="top"><span class="nm">${name}</span><span class="val">${moneyShort(used)} / ${moneyShort(limit)}</span></div><div class="bar"><i class="${cls}" style="width:${pct}%"></i></div></div>`;
}
async function renderStats() {
  const period = state.statsPeriod || 'month';
  const d = new Date();
  const [s, e] = rangeFor(period, d);
  const sEnd = e.getTime() + 86400000 - 1;
  const records = onlyNormal(await db.getRecords());
  const inRange = records.filter((r) => r.date >= s.getTime() && r.date <= sEnd);
  const exp = inRange.filter((r) => r.type === 'expense').reduce((a, r) => a + r.amount, 0);
  const inc = inRange.filter((r) => r.type === 'income').reduce((a, r) => a + r.amount, 0);
  const bal = inc - exp;

  const side = state.pieSide || 'expense';
  const cats = await db.getCategories();
  const allCats = await db.getAllCategories(); const cm = {}; allCats.forEach((c) => (cm[c.id] = c));
  const byCat = {};
  inRange.filter((r) => r.type === side).forEach((r) => { byCat[r.categoryId] = (byCat[r.categoryId] || 0) + r.amount; });
  const pieData = cats.filter((c) => c.type === side).map((c) => ({ label: c.name, value: byCat[c.id] || 0, color: c.color })).filter((x) => x.value > 0);
  const pieTotal = pieData.reduce((a, x) => a + x.value, 0);
  const legend = pieData.length ? pieData.map((x) => `<div class="li"><span class="dot" style="background:${x.color}"></span><span class="nm">${x.label}</span><span class="pc">${Math.round((x.value / pieTotal) * 100)}%</span></div>`).join('') : '<div class="muted">暂无数据</div>';

  const [ms, me] = monthRange(new Date());
  const mEnd = me.getTime() + 86400000 - 1;
  const monthRecs = records.filter((r) => r.type === 'expense' && r.date >= ms.getTime() && r.date <= mEnd);
  const monthByCat = {}; monthRecs.forEach((r) => { monthByCat[r.categoryId] = (monthByCat[r.categoryId] || 0) + r.amount; });
  const monthExp = monthRecs.reduce((a, r) => a + r.amount, 0);
  const budgets = await db.getBudgets(); const bm = {}; budgets.forEach((b) => (bm[b.id] = b.limit));
  let budgetHTML = '';
  if (bm.month) budgetHTML += budgetBar('本月总预算', monthExp, bm.month);
  cats.filter((c) => c.type === 'expense' && bm[c.id]).forEach((c) => { budgetHTML += budgetBar(c.name, monthByCat[c.id] || 0, bm[c.id]); });
  if (!budgetHTML) budgetHTML = `<div class="muted">还没设预算，去「我的」里设置</div>`;

  view.innerHTML = `
    <div class="period-seg" id="pseg">
      <button data-p="day" class="${period === 'day' ? 'on' : ''}">日</button>
      <button data-p="week" class="${period === 'week' ? 'on' : ''}">周</button>
      <button data-p="month" class="${period === 'month' ? 'on' : ''}">月</button>
      <button data-p="year" class="${period === 'year' ? 'on' : ''}">年</button>
    </div>
    <div class="card">
      <div class="stat-total">
        <div class="lbl">${rangeLabel(period, d)}</div>
        <div class="big"><span class="exp-amt">${moneyShort(exp)}</span></div>
        <div class="big" style="font-size:22px"><span class="inc-amt">${moneyShort(inc)}</span></div>
        <div class="lbl mt8">结余 ${moneyShort(bal)}</div>
      </div>
    </div>
    <div class="card">
      <div class="seg" id="sideSeg" style="margin-bottom:10px"><button data-s="expense" class="${side === 'expense' ? 'on' : ''}">支出占比</button><button data-s="income" class="${side === 'income' ? 'on' : ''}">收入占比</button></div>
      <div class="pie-wrap">${donutSVG(pieData, { centerText: moneyShort(pieTotal) })}<div class="legend">${legend}</div></div>
    </div>
    <div class="card">
      <div class="card-title">预算（本月）</div>
      ${budgetHTML}
    </div>`;
  view.querySelector('#pseg').querySelectorAll('button').forEach((b) => b.onclick = () => { state.statsPeriod = b.dataset.p; router(); });
  view.querySelector('#sideSeg').querySelectorAll('button').forEach((b) => b.onclick = () => { state.pieSide = b.dataset.s; router(); });
}

// ---------- 我的 ----------
function catManageRows(cats) {
  return cats.map((c) => `<div class="row">
      <span class="emoji">${c.emoji}</span>
      <div style="flex:1;min-width:0"><div class="label">${c.name}</div><div class="sub">${c.type === 'expense' ? '支出' : '收入'}</div></div>
      <label class="switch"><input type="checkbox" data-show="${c.id}" ${c.hidden ? '' : 'checked'}><span class="track"></span><span class="dot"></span></label>
      <button class="del" data-delcat="${c.id}">🗑️</button>
    </div>`).join('');
}
// iPhone／iPad：苹果不让装 apk，网页版就是「iPhone 版」——给一张「添加到主屏幕」的引导卡。
// 已经是从桌面图标打开的（standalone）就没什么要教的了，返回空串。
function iosInstallCard() {
  if (update.APP.standalone) return '';
  const site = location.origin + '/';
  return `<div class="card">
      <div class="card-title">把「暖记账本」装到 iPhone 桌面</div>
      <div class="hint-line">iPhone 不用下安装包，这个网页就是 iPhone 版。按下面三步把它放到桌面，以后点图标打开：全屏、有图标、断网也能记账，跟 App 一样。</div>
      <ol class="steps">
        <li>用 <b>Safari</b> 打开这个网址：<br><span class="site-url">${site}</span><br><span class="muted">微信 / QQ 里直接点开是不行的：先点右上角「···」→「用默认浏览器打开」。</span></li>
        <li>点屏幕<b>最下面中间</b>的「分享」按钮 <b>⬆</b>（方框里一支箭头）。</li>
        <li>菜单里往下滑，点 <b>「添加到主屏幕」</b> → 右上角 <b>「添加」</b>。</li>
      </ol>
      <div class="muted" style="font-size:12px;margin-top:10px">加好之后桌面就多一个「暖记账本」图标，原来那个 Safari 页面可以关掉。账目只存在你手机里，加了桌面图标才不会被系统自动清掉。</div>
    </div>`;
}

async function renderMe() {
  const cats = await db.getAllCategories();
  const expCats = cats.filter((c) => c.type === 'expense');
  const budgets = await db.getBudgets(); const bm = {}; budgets.forEach((b) => (bm[b.id] = b.limit));
  // 本月已花（用于预算实时反馈）
  const records = onlyNormal(await db.getRecords());   // 预算只看真实消费
  const [ms, me] = monthRange(new Date());
  const mEnd = me.getTime() + 86400000 - 1;
  const monthRecs = records.filter((r) => r.type === 'expense' && r.date >= ms.getTime() && r.date <= mEnd);
  const monthByCat = {}; monthRecs.forEach((r) => { monthByCat[r.categoryId] = (monthByCat[r.categoryId] || 0) + r.amount; });
  const monthExp = monthRecs.reduce((a, r) => a + r.amount, 0);
  const pctCls = (u, l) => { const p = l ? Math.min(100, (u / l) * 100) : 0; return p >= 100 ? 'over' : p >= 80 ? 'warn' : ''; };
  const catBudgetRows = expCats.map((c) => {
    const used = monthByCat[c.id] || 0;
    const lim = bm[c.id];
    const pct = lim ? Math.min(100, (used / lim) * 100) : 0;
    return `<div class="b-item">
      <div class="row plain">
        <div style="flex:1;min-width:0"><div class="label">${c.emoji} ${c.name}</div><div class="sub">本月已花 ${moneyShort(used)}${lim ? ` · 预算 ${moneyShort(lim)}` : ''}</div></div>
        <input class="input" style="width:112px;text-align:right" data-bid="${c.id}" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="不设" value="${lim || ''}">
      </div>
      ${lim ? `<div class="bar" style="margin:0 2px 10px"><i class="${pctCls(used, lim)}" style="width:${pct}%"></i></div>` : ''}
    </div>`;
  }).join('');
  const monthPct = bm.month ? Math.min(100, (monthExp / bm.month) * 100) : 0;
  view.innerHTML = `
    <div class="card">
      <div class="card-title">导出 Excel 表格</div>
      <div class="hint-line">把你记的每一笔导成表格，用电脑的 Excel / WPS / Numbers 打开就能看明细、做统计。含日期、时间、收支类型、分类、金额、备注，末尾附带本月合计。</div>
      <button class="btn block" id="expCsv">📊 导出 Excel 表格（.csv）</button>
    </div>
    <div class="card">
      <div class="card-title">分类管理（开关＝显示 / 隐藏，可删除）</div>
      <div id="catList">${catManageRows(cats)}</div>
      <button class="btn ghost block mt16" id="addCat">＋ 添加分类</button>
    </div>
    <div class="card">
      <div class="card-title">预算设置（每月）</div>
      <div class="hint-line">在这里设上限，下面会实时显示本月已花和进度条；「统计」页也会同步显示。超 80% 变橙、超 100% 变红。</div>
      <div class="b-item">
        <div class="row plain">
          <div style="flex:1;min-width:0"><div class="label">本月总预算</div><div class="sub">本月已花 ${moneyShort(monthExp)}${bm.month ? ` · 预算 ${moneyShort(bm.month)}` : ''}</div></div>
          <input class="input" id="bMonth" style="width:112px;text-align:right" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="不设" value="${bm.month || ''}">
        </div>
        ${bm.month ? `<div class="bar" style="margin:0 2px 10px"><i class="${pctCls(monthExp, bm.month)}" style="width:${monthPct}%"></i></div>` : ''}
      </div>
      <div id="catBudgets">${catBudgetRows}</div>
      <button class="btn block mt16" id="saveBudget">保存预算</button>
    </div>
    <div class="card">
      <div class="card-title">备份 / 换手机（数据只存在本机）</div>
      <div class="hint-line">「导出备份」会生成一个记录你全部账目的文件（.json），把它发给自己（微信/邮箱/网盘）存着。换手机、重装 app 或恢复出厂后，用「导入备份」选这个文件，账目就都回来了。安卓和苹果之间也能靠它迁移。</div>
      <div class="flex">
        <button class="btn soft" id="exp">导出备份</button>
        <button class="btn soft" id="imp">导入备份</button>
      </div>
      <div class="muted" style="font-size:12px;margin-top:10px">注：文件是给 app 用的，用记事本打开会是一堆代码，不用看懂；只要留好文件即可。</div>
      <input type="file" id="impFile" accept="application/json" hidden>
    </div>
    ${update.APP.ios ? iosInstallCard() : ''}
    <div class="card">
      <div class="card-title">版本更新</div>
      <div class="hint-line" id="updInfo" style="white-space:pre-line"></div>
      ${update.APP.ios ? '' : `<button class="btn soft block ${update.hasUpdate() ? 'has-update' : ''}" id="updCheck">${update.hasUpdate() ? '发现新版本，点此更新' : '检查更新'}</button>`}
    </div>
    <div class="card">
      <div class="card-title">语音记账自检</div>
      <div class="hint-line" id="asrInfo" style="white-space:pre-line">${speech.envText()}</div>
      <button class="btn soft block mt16" id="asrDl" ${speech.needModel() ? '' : 'hidden'}>⬇ 下载语音引擎（约 198MB）</button>
      <details class="tech-box" style="margin-top:10px">
        <summary>详细诊断信息</summary>
        <div class="hint-line" id="asrTech" style="white-space:pre-line;margin-top:8px">${speech.envTech()}</div>
      </details>
      <button class="btn soft block mt16" id="asrCheck">🔎 重新检测</button>
    </div>
    <div class="card center">
      <div style="font-size:15px;font-weight:700">暖记 · 记账本</div>
      <div class="muted mt8">本地存储 · 语音记账 · 圆形统计<br>数据只存在你的手机，不上传。</div>
    </div>`;
  view.querySelectorAll('[data-show]').forEach((sw) => sw.addEventListener('change', async () => {
    const c = cats.find((x) => x.id === sw.dataset.show); c.hidden = !sw.checked; await db.put('categories', c); toast(sw.checked ? '已显示' : '已隐藏');
  }));
  view.querySelectorAll('[data-delcat]').forEach((b) => b.onclick = async () => {
    const c = cats.find((x) => x.id === b.dataset.delcat);
    if (confirm(`删除分类「${c.name}」？该分类下的记录会保留但显示为「已删分类」`)) { await db.del('categories', c.id); toast('已删除'); router(); }
  });
  view.querySelector('#addCat').onclick = openAddCat;
  view.querySelector('#expCsv').onclick = exportCSV;
  // 预算框也统一成「只收数字」（原来 type="number" 还能输 1e5 这种科学计数法）
  view.querySelectorAll('#catBudgets input[data-bid]').forEach(bindAmountInput);
  bindAmountInput(view.querySelector('#bMonth'));
  view.querySelector('#saveBudget').onclick = async () => {
    const m = parseFloat(view.querySelector('#bMonth').value);
    await db.setBudget('month', isNaN(m) ? '' : m);
    for (const inp of view.querySelectorAll('#catBudgets input')) { const v = parseFloat(inp.value); await db.setBudget(inp.dataset.bid, isNaN(v) ? '' : v); }
    toast('预算已保存'); router(); // 重绘，立刻显示进度条
  };
  view.querySelector('#asrCheck').onclick = () => {
    const t = speech.envText();
    const el = view.querySelector('#asrInfo'); if (el) el.textContent = t;
    const te = view.querySelector('#asrTech'); if (te) te.textContent = speech.envTech();
    alert('语音自检结果：\n\n' + t);
  };

  // 语音模型下载：引导 + 进度
  const dlBtn = view.querySelector('#asrDl');
  if (dlBtn) dlBtn.onclick = () => {
    if (!confirm('语音引擎约 198MB，建议在 WiFi 下下载。\n'
      + '下载一次以后就不用再下了，而且以后不联网也能用。\n\n现在开始下载吗？')) return;
    if (speech.startModelDownload()) {
      dlBtn.hidden = true;
      toast('开始下载语音引擎，请留在本页面');
    } else {
      toast('请把 App 更新到最新版后再试');
    }
  };

  // 语音模型正在下载时，自检卡片实时刷新进度
  speech.onModelProgress(() => {
    const el = view.querySelector('#asrInfo');
    if (el) el.textContent = speech.envText();
    const te = view.querySelector('#asrTech'); if (te) te.textContent = speech.envTech();
    const b = view.querySelector('#asrDl'); if (b) b.hidden = !speech.needModel();
  });

  // ---------- 版本更新 ----------
  const updBtn = view.querySelector('#updCheck');
  const updInfo = view.querySelector('#updInfo');
  const renderUpd = () => {
    const has = update.hasUpdate();
    if (updBtn) {
      updBtn.textContent = has ? '发现新版本，点此更新' : '检查更新';
      updBtn.classList.toggle('has-update', has);
    }
    if (!updInfo) return;
    // 苹果设备：没有「更新」这回事，页面本身永远是最新的
    if (update.APP.ios) {
      updInfo.textContent = update.APP.standalone
        ? '你用的是 iPhone 桌面版。\n它和网页是同一份，我们一改你这边立刻就是最新，不用你手动更新。'
        : 'iPhone 版就是网页版，不用下载安装包，也永远是最新的。\n照上面的步骤加到桌面，就是常驻的 App 了。';
      return;
    }
    updInfo.textContent = has
      ? update.updateNotes()
      : ('当前版本 ' + update.currentVersionText() + '，已经是最新的了');
  };
  renderUpd();
  update.onChange(renderUpd);

  update.onInstallProgress((pct) => {
    if (updInfo) updInfo.textContent = '正在下载新版本… ' + pct + '%\n请留在本页面，下载完会自动弹出安装界面';
  });
  update.onInstallDone(() => {
    if (updInfo) updInfo.textContent = '下载完成，请在弹出的界面点「安装」\n（覆盖升级，账目不会丢）';
    toast('下载完成，请点「安装」');
  });
  update.onInstallError((m) => {
    if (updInfo) updInfo.textContent = '下载失败：' + m + '\n请检查网络后重试';
    toast('下载失败，请稍后重试');
  });

  if (updBtn) updBtn.onclick = async () => {
    if (update.hasUpdate()) { doUpdate(); return; }
    updBtn.textContent = '检查中…';
    const r = await update.checkUpdate();
    renderUpd();
    if (!r.ok) { toast(r.error || '检查失败，请稍后再试'); return; }
    if (update.hasUpdate()) { toast('发现新版本 ' + (update.latest().versionName || '')); doUpdate(); }
    else toast('已经是最新版本 ' + update.currentVersionText());
  };

  // 打开「我的」时自动静默检查一次，有新版本按钮就会亮红点
  // （苹果上没有「更新」这个概念，不必去拉 version.json）
  if (!update.APP.ios) update.checkUpdate().then(renderUpd).catch(() => { });
  view.querySelector('#exp').onclick = exportBackup;
  const impFile = view.querySelector('#impFile');
  view.querySelector('#imp').onclick = () => impFile.click();
  impFile.onchange = importBackup;
}
// 应用内更新：确认后交给原生下载并调起系统安装界面
function doUpdate() {
  const notes = update.updateNotes();
  const url = update.apkUrl();

  // 装不了的情况：网页版打开，或 App 版本太老（v3.3 之前的包没有下载安装能力）
  if (!update.APP.canInstallApk) {
    if (!update.APP.inApp) {
      if (confirm('发现新版本：\n\n' + notes
        + '\n\n你现在用的是网页版，没法直接安装，需要在浏览器里下载后再安装。\n\n现在打开下载页吗？')) {
        window.open(url, '_blank');
      }
      return;
    }
    alert('发现新版本：\n\n' + notes
      + '\n\n你现在这个版本的 App 还不支持「应用内一键更新」，需要手动装一次新版本。'
      + '装好这一次以后，以后就能在 App 里直接更新了。\n\n下载地址：\n' + url);
    return;
  }

  if (!confirm('发现新版本：\n\n' + notes
    + '\n\n下载完成后会弹出系统的安装界面，点「安装」就能覆盖升级。'
    + '你的账目数据会原样保留，不会丢。\n\n现在开始下载吗？')) return;

  update.startUpdate();
  toast('开始下载，请留在本页面');
}

async function openAddCat() {  let type = 'expense', color = COLOR_SW[0], emoji = '📌';
  const html = `<h3>添加分类</h3>
    <div class="seg" id="tseg"><button data-t="expense" class="on">支出</button><button data-t="income">收入</button></div>
    <div class="field"><label>名称</label><input id="cn" class="input" placeholder="如：保险"></div>
    <div class="field"><label>图标 emoji</label><input id="ce" class="input" placeholder="📌" value="📌"></div>
    <div class="card-title">颜色</div>
    <div class="cat-grid" id="cgrid"></div>
    <div class="flex mt16"><button class="btn soft" id="c">取消</button><button class="btn" id="s">保存</button></div>`;
  openSheet(html, (root, close) => {
    const grid = root.querySelector('#cgrid');
    const rg = () => { grid.innerHTML = COLOR_SW.map((c) => `<button class="cat ${c === color ? 'sel' : ''}" data-c="${c}"><span class="emoji" style="background:${c};width:22px;height:22px;border-radius:50%"></span></button>`).join(''); grid.querySelectorAll('.cat').forEach((b) => b.onclick = () => { color = b.dataset.c; rg(); }); };
    rg();
    root.querySelectorAll('#tseg button').forEach((b) => b.onclick = () => { type = b.dataset.t; root.querySelectorAll('#tseg button').forEach((x) => x.classList.toggle('on', x === b)); });
    root.querySelector('#ce').addEventListener('input', (e) => { emoji = e.target.value.trim() || '📌'; });
    root.querySelector('#c').onclick = close;
    root.querySelector('#s').onclick = async () => {
      const name = root.querySelector('#cn').value.trim(); if (!name) { toast('请输入名称'); return; }
      const all = await db.getAllCategories();
      await db.put('categories', { id: 'c' + Date.now(), name, type, emoji, color, hidden: false, order: all.length });
      toast('已添加'); close(); router();
    };
  });
}
// 导出 Excel 表格（CSV，带 BOM，Excel/WPS 打开中文不乱码）
// 注意：转账 / 校准 / 盈亏也要导出来（对账要看），但不计进「合计支出/收入」，否则结余会被算歪。
async function exportCSV() {
  const records = await db.getRecords();
  const cats = await db.getAllCategories(); const cm = {}; cats.forEach((c) => { cm[c.id] = c; });
  const accs = await db.getAllAccounts(); const am = {}; accs.forEach((a) => { am[a.id] = a; });
  if (records.length === 0) { toast('还没有任何记录'); return; }
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const kindLabel = (r) => {
    if (r.kind === 'transfer') return '转账';
    if (r.kind === 'adjust') return '余额校准';
    if (r.kind === 'pnl') return '投资盈亏';
    return r.type === 'expense' ? '支出' : '收入';
  };
  const list = records.slice().sort((a, b) => a.date - b.date);
  const rows = [['日期', '时间', '类型', '分类', '账户', '金额(元)', '备注']];
  let totalExp = 0, totalInc = 0, totalTransfer = 0;
  for (const r of list) {
    const d = new Date(r.date);
    const c = cm[r.categoryId] || null;
    if (isNormal(r)) { if (r.type === 'expense') totalExp += r.amount; else totalInc += r.amount; }
    if (r.kind === 'transfer') totalTransfer += Number(r.amount) || 0;
    let acc = (am[r.accountId] || {}).name || '';
    if (r.kind === 'transfer') acc = (acc || '未指定') + ' → ' + ((am[r.toAccountId] || {}).name || '未指定');
    rows.push([
      dayKey(d),
      d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      kindLabel(r),
      c ? c.name : (r.kind ? '—' : '已删分类'),
      acc,
      (Number(r.amount) || 0).toFixed(2),
      r.note || '',
    ]);
  }
  rows.push([]);
  rows.push(['合计支出', '', '', '', '', totalExp.toFixed(2), '']);
  rows.push(['合计收入', '', '', '', '', totalInc.toFixed(2), '']);
  rows.push(['结余', '', '', '', '', (totalInc - totalExp).toFixed(2), '']);
  rows.push(['（转账合计）', '', '', '', '', totalTransfer.toFixed(2), '']);
  rows.push(['注：转账 / 校准 / 盈亏不算收支，不计入上面的合计。', '', '', '', '', '', '']);
  const csv = '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const how = await saveBlob(blob, `暖记账目_${dayKey(new Date())}.csv`);
  toast(how === 'app' ? '已存到手机「下载」目录，去文件管理里找'
    : how === 'ios' ? '已导出。iPhone 上若没反应，改用 Safari 打开本站（别用桌面图标）再导出一次'
      : '已导出，用 Excel / WPS 打开即可');
}

// 存文件：把 blob 落到本机。返回落盘方式，调用方据此给不同的提示语。
//   'app' → 交给安卓 App 原生写进系统「下载」目录（最稳）
//   'ios' → 浏览器下载，且是苹果设备（iOS 的限制要看提示处理）
//   'web' → 普通浏览器下载
// 两个必须注意的点：
//   ① iOS 的 Safari 不认「没挂到文档里」的 <a>，会一声不响什么都不做 —— 必须先 append 再点。
//   ② 安卓 App 的 WebView 没设 DownloadListener，网页的 <a download> 点了不会产出任何文件，
//      所以 App 内一律改走原生桥 AndroidSpeech.saveFile（App v3.4+ 才有）。
async function saveBlob(blob, filename) {
  const bridge = (typeof window !== 'undefined') && window.AndroidSpeech;
  if (update.APP.inApp && bridge && typeof bridge.saveFile === 'function') {
    try {
      const b64 = await blobToBase64(blob);
      if (bridge.saveFile(filename, blob.type || 'application/octet-stream', b64)) return 'app';
    } catch (_) { /* 桥不在或失败了，退回浏览器那套 */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // 别马上 revoke：Safari 是异步去取这个 blob 的，立刻释放会拿到空文件
  setTimeout(() => { try { a.remove(); } catch (_) { } URL.revokeObjectURL(url); }, 6000);
  return update.APP.ios ? 'ios' : 'web';
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || '');
      res(s.slice(s.indexOf(',') + 1)); // 去掉 data:xxx;base64, 前缀
    };
    fr.onerror = () => rej(fr.error || new Error('read failed'));
    fr.readAsDataURL(blob);
  });
}

async function exportBackup() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const how = await saveBlob(blob, `暖记备份_${dayKey(new Date())}.json`);
  toast(how === 'app' ? '已存到手机「下载」目录，把这个文件发给自己留着'
    : how === 'ios' ? '已导出。iPhone 上若没反应，改用 Safari 打开本站（别用桌面图标）再试'
      : '已导出，请把文件转存到自己那边保管');
}
async function importBackup(e) {
  const f = e.target.files[0]; if (!f) return;
  if (!confirm('导入会覆盖当前所有数据，确定吗？')) { e.target.value = ''; return; }
  try {
    const data = JSON.parse(await f.text());
    await db.importAll(data, false);
    toast('导入成功'); router();
  } catch (err) { toast('文件格式不对'); }
  e.target.value = '';
}

// ---------- 启动 ----------
async function init() {
  if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {})); }
  await db.seedIfEmpty();
  // 老库一次性升级：把「微信 / 支付宝」拆成里面的小钱包（只改名字，余额和流水原地不动）
  // 开关从 subsV1 → subsV2 → subsV3 一路换 —— 已经升过一次的手机也会再跑一遍，
  // 这回只是把几个默认图标统一掉（改名的分支都会自己跳过，安全的）。
  try {
    if (!(await db.getMeta('subsV3'))) {
      const n = await db.migrateSubAccounts();
      await db.setMeta('subsV3', { at: Date.now(), changed: n });
    }
  } catch (_) { /* 升级失败不该拦住 App；下次打开会重试 */ }
  try { await runDuePlans(); } catch (_) { /* 定投补记失败不该拦住整个 App */ }
  if (!location.hash) location.hash = '#/record';
  router();
  tabbar.querySelectorAll('.tab').forEach((t) => t.onclick = () => { if (location.hash !== t.dataset.route) location.hash = t.dataset.route; else router(); });
}
init();
