import * as db from './db.js';
import * as speech from './speech.js';
import { donutSVG } from './charts.js';
import { money, moneyShort, dayKey, parseDayKey, rangeFor, monthRange, rangeLabel, uid } from './format.js';

const view = document.getElementById('view');
const appbarTitle = document.getElementById('appbar-title');
const appbarAction = document.getElementById('appbar-action');
const tabbar = document.getElementById('tabbar');

const state = { route: '#/record', calDate: new Date(), selDate: new Date(), statsPeriod: 'month', pieSide: 'expense' };
const COLOR_SW = ['#FF8A5B', '#5BA8FF', '#FF6FB5', '#B98CFF', '#FFC15B', '#FF7A7A', '#4FD0C0', '#FF9F6B', '#7C9CFF', '#4FC3F7', '#8ED081', '#B0A393', '#3ED35A', '#2FB8A0'];

const routes = {
  '#/record': { title: '记一笔', render: renderRecord },
  '#/calendar': { title: '日历', render: renderCalendar },
  '#/stats': { title: '统计', render: renderStats },
  '#/me': { title: '我的', render: renderMe },
};

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 1800);
}

function openSheet(html, bind) {
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.innerHTML = `<div class="sheet">${html}</div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
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

function recordRow(r, cm) {
  const c = cm[r.categoryId] || { emoji: '📦', name: '已删分类', color: '#B0A393' };
  const sign = r.type === 'expense' ? '-' : '+';
  const cls = r.type === 'expense' ? 'exp' : 'inc';
  const ph = r.photo ? `<img class="thumb" src="${r.photo}">` : `<span class="emoji">${c.emoji}</span>`;
  const sub = (r.note ? r.note + ' · ' : '') + c.name;
  const time = new Date(r.date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return `<div class="item">${ph}<div class="body"><div class="t">${sub}</div><div class="s">${time}</div></div><span class="amt ${cls}">${sign}${moneyShort(r.amount)}</span><button class="del" data-id="${r.id}">🗑️</button></div>`;
}

// ---------- 路由 ----------
function router() {
  const r = location.hash || '#/record';
  const route = routes[r] ? r : '#/record';
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
  const records = await db.getRecords();
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
      <div class="mic-hint">${speech.supported ? '点一下，说「午饭38」或「打车25块」' : (speech.inApp ? '这台手机没有语音识别引擎，可用下方「手动记一笔」' : '网页版用不了语音，请点桌面「暖记账本」图标打开，或用下方「手动记一笔」')}</div>
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
  let ctrl = null;
  mic.addEventListener('click', async () => {
    if (!speech.supported) { toast(speech.inApp ? speech.errText('no-engine') : speech.errText('need-app')); return; }
    if (ctrl) { ctrl.stop(); mic.classList.remove('listening'); ctrl = null; return; }
    const perm = await speech.checkMic();
    if (perm === 'denied') { toast('麦克风权限被拒绝，请在地址栏允许后重试'); return; }
    mic.classList.add('listening'); tr.textContent = '在听…（说中文或英文）';
    ctrl = speech.listen({
      lang: 'zh-CN',
      onPartial: (p) => { tr.textContent = p; },
      onFinal: (f) => { mic.classList.remove('listening'); ctrl = null; if (f) { tr.textContent = f; openEntryFromVoice(f); } },
      onError: (e) => { mic.classList.remove('listening'); ctrl = null; tr.textContent = ''; toast(speech.errText(e)); },
    });
  });
  view.querySelector('#manual').addEventListener('click', () => openEntrySheet({}));

  // 支出/收入卡片点击展开记录
  const cats = await db.getAllCategories(); const cm = {}; cats.forEach((c) => (cm[c.id] = c));
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
        listEl.innerHTML = `<div class="list">${filtered.map((r) => recordRow(r, cm)).join('')}</div>`;
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
  try {
    const cats = await db.getCategories();
    const p = speech.parse(text, cats);
    openEntrySheet({ amount: p.amount, type: p.type, categoryId: p.categoryId, note: text });
  } catch (err) {
    // 解析出错也照常弹卡，把听到的话放进备注，用户手动补金额
    openEntrySheet({ note: text });
  }
}

async function openEntrySheet(prefill = {}) {
  const cats = await db.getCategories();
  let type = prefill.type || 'expense';
  let amount = prefill.amount != null ? String(prefill.amount) : '';
  let catId = prefill.categoryId || (cats.find((c) => c.type === type) || {}).id;
  let note = prefill.note || '';
  let photo = prefill.photo || null;
  const html = `
    <h3>记一笔</h3>
    <div class="seg" id="typeSeg">
      <button data-t="expense" class="${type === 'expense' ? 'on' : ''}">支出</button>
      <button data-t="income" class="${type === 'income' ? 'on' : ''}">收入</button>
    </div>
    <div style="text-align:center;margin:10px 0 4px">
      <span style="font-size:20px;color:var(--muted)">¥</span>
      <input id="amt" inputmode="decimal" placeholder="0.00" value="${amount}" style="border:none;outline:none;font-size:38px;font-weight:800;width:58%;text-align:center;color:var(--ink);background:transparent">
    </div>
    <div class="card-title mt16">分类</div>
    <div class="cat-grid" id="catGrid"></div>
    <div class="field mt16"><label>备注</label><textarea id="note" class="textarea" placeholder="说点什么…">${note}</textarea></div>
    <div class="field"><label>小票照片（可选）</label><input type="file" id="photo" accept="image/*" capture="environment"></div>
    <div id="thumbBox" class="mt8"></div>
    <div class="flex mt16">
      <button class="btn soft" id="cancel">取消</button>
      <button class="btn" id="save">保存</button>
    </div>`;
  openSheet(html, (root, close) => {
    const grid = root.querySelector('#catGrid');
    const renderGrid = () => { grid.innerHTML = catTiles(cats.filter((c) => c.type === type), catId); grid.querySelectorAll('.cat').forEach((b) => b.onclick = () => { catId = b.dataset.id; renderGrid(); }); };
    renderGrid();
    root.querySelectorAll('#typeSeg button').forEach((b) => b.onclick = () => {
      type = b.dataset.t;
      root.querySelectorAll('#typeSeg button').forEach((x) => x.classList.toggle('on', x === b));
      catId = (cats.find((c) => c.type === type) || {}).id; renderGrid();
    });
    const ph = root.querySelector('#photo');
    ph.addEventListener('change', async () => { const f = ph.files[0]; if (f) { photo = await resizeImage(f); root.querySelector('#thumbBox').innerHTML = `<img class="thumb" src="${photo}">`; } });
    root.querySelector('#cancel').onclick = close;
    root.querySelector('#save').onclick = async () => {
      const amt = parseFloat(root.querySelector('#amt').value);
      if (!(amt > 0)) { toast('请输入金额'); return; }
      if (!catId) { toast('请选分类'); return; }
      await db.addRecord({ id: uid(), type, amount: Math.round(amt * 100) / 100, categoryId: catId, note: root.querySelector('#note').value.trim(), photo, date: Date.now(), createdAt: Date.now() });
      toast('已记下 ✓'); close(); router();
    };
  });
}

async function openQuickSheet() {
  const cats = await db.getCategories();
  let type = 'expense', amount = '', catId = (cats.find((c) => c.type === 'expense') || {}).id, label = '';
  const html = `<h3>添加常用一笔</h3>
    <div class="seg" id="tseg"><button data-t="expense" class="on">支出</button><button data-t="income">收入</button></div>
    <div class="field"><label>名称</label><input id="ql" class="input" placeholder="如：午饭"></div>
    <div class="field"><label>金额</label><input id="qa" class="input" inputmode="decimal" placeholder="0.00"></div>
    <div class="card-title">分类</div><div class="cat-grid" id="cgrid"></div>
    <div class="flex mt16"><button class="btn soft" id="c">取消</button><button class="btn" id="s">保存</button></div>`;
  openSheet(html, (root, close) => {
    const grid = root.querySelector('#cgrid');
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
    const amt = t ? `<span class="amt">${moneyShort(t.exp)}</span>` : '';
    cells += `<button class="${cls}" data-k="${k}"><span class="d">${dd}</span>${amt}</button>`;
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
  const records = await db.getRecords();
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
  await renderDayDetail(view, records);
}
async function renderDayDetail(view, records) {
  const box = view.querySelector('#dayDetail'); if (!box) return;
  const cats = await db.getAllCategories(); const cm = {}; cats.forEach((c) => (cm[c.id] = c));
  const k = dayKey(state.selDate || new Date());
  const day = records.filter((r) => dayKey(new Date(r.date)) === k).sort((a, b) => b.date - a.date);
  const expRecs = day.filter((r) => r.type === 'expense');
  const incRecs = day.filter((r) => r.type === 'income');
  const exp = expRecs.reduce((s, r) => s + r.amount, 0);
  const inc = incRecs.reduce((s, r) => s + r.amount, 0);
  const sel = state.selDate || new Date();
  const weekName = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][sel.getDay()];
  const dateLabel = `${sel.getMonth() + 1}月${sel.getDate()}日 ${weekName}`;
  box.innerHTML = `<div class="day-label">📌 ${dateLabel}</div><div class="day-sum">
    <div class="box tap-box" data-dtype="expense"><div class="v exp-amt">${moneyShort(exp)}</div><div class="k">支出 ▾</div></div>
    <div class="box tap-box" data-dtype="income"><div class="v inc-amt">${moneyShort(inc)}</div><div class="k">收入 ▾</div></div>
  </div><div id="calDayList" class="rec-list" hidden></div>`;
  const listEl = box.querySelector('#calDayList');
  let curFilter = 'all'; // all | expense | income | none

  const applyList = () => {
    // 同步箭头
    box.querySelectorAll('.tap-box').forEach((b) => {
      const type = b.dataset.dtype;
      b.querySelector('.k').textContent = (type === 'expense' ? '支出' : '收入') + (curFilter === type ? ' ▴' : ' ▾');
    });
    if (day.length === 0) {
      listEl.innerHTML = `<div class="empty">这天还没有记录</div>`;
      listEl.hidden = false; return;
    }
    if (curFilter === 'none') { listEl.hidden = true; return; }
    const filtered = curFilter === 'all' ? day : day.filter((r) => r.type === curFilter);
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty">暂无${curFilter === 'expense' ? '支出' : '收入'}记录</div>`;
    } else {
      listEl.innerHTML = `<div class="list">${filtered.map((r) => recordRow(r, cm)).join('')}</div>`;
      listEl.querySelectorAll('.del').forEach((d) => {
        d.addEventListener('click', async (e) => {
          e.stopPropagation(); e.preventDefault();
          const id = d.getAttribute('data-id');
          if (!id) return;
          if (confirm('确定删除这条记录？')) { await db.deleteRecord(id); toast('已删除'); router(); }
        });
      });
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
  const records = await db.getRecords();
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
async function renderMe() {
  const cats = await db.getAllCategories();
  const expCats = cats.filter((c) => c.type === 'expense');
  const budgets = await db.getBudgets(); const bm = {}; budgets.forEach((b) => (bm[b.id] = b.limit));
  // 本月已花（用于预算实时反馈）
  const records = await db.getRecords();
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
        <input class="input" style="width:112px;text-align:right" data-bid="${c.id}" type="number" inputmode="decimal" placeholder="不设" value="${lim || ''}">
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
          <input class="input" id="bMonth" style="width:112px;text-align:right" type="number" inputmode="decimal" placeholder="不设" value="${bm.month || ''}">
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
    <div class="card">
      <div class="card-title">语音识别自检</div>
      <div class="hint-line" id="asrInfo" style="white-space:pre-line">${speech.envText()}</div>
      <button class="btn soft block" id="asrCheck">🔎 重新检测语音环境</button>
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
  view.querySelector('#saveBudget').onclick = async () => {
    const m = parseFloat(view.querySelector('#bMonth').value);
    await db.setBudget('month', isNaN(m) ? '' : m);
    for (const inp of view.querySelectorAll('#catBudgets input')) { const v = parseFloat(inp.value); await db.setBudget(inp.dataset.bid, isNaN(v) ? '' : v); }
    toast('预算已保存'); router(); // 重绘，立刻显示进度条
  };
  view.querySelector('#asrCheck').onclick = () => {
    const t = speech.envText();
    const el = view.querySelector('#asrInfo');
    if (el) el.textContent = t;
    alert('语音自检结果：\n\n' + t);
  };
  view.querySelector('#exp').onclick = exportBackup;
  const impFile = view.querySelector('#impFile');
  view.querySelector('#imp').onclick = () => impFile.click();
  impFile.onchange = importBackup;
}
async function openAddCat() {
  let type = 'expense', color = COLOR_SW[0], emoji = '📌';
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
async function exportCSV() {
  const records = await db.getRecords();
  const cats = await db.getAllCategories(); const cm = {}; cats.forEach((c) => (cm[c.id] = c));
  if (records.length === 0) { toast('还没有任何记录'); return; }
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const list = records.slice().sort((a, b) => a.date - b.date);
  const rows = [['日期', '时间', '类型', '分类', '金额(元)', '备注']];
  let totalExp = 0, totalInc = 0;
  for (const r of list) {
    const d = new Date(r.date);
    const c = cm[r.categoryId] || { name: '已删分类' };
    if (r.type === 'expense') totalExp += r.amount; else totalInc += r.amount;
    rows.push([
      dayKey(d),
      d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      r.type === 'expense' ? '支出' : '收入',
      c.name,
      r.amount.toFixed(2),
      r.note || '',
    ]);
  }
  rows.push([]);
  rows.push(['合计支出', '', '', '', totalExp.toFixed(2), '']);
  rows.push(['合计收入', '', '', '', totalInc.toFixed(2), '']);
  rows.push(['结余', '', '', '', (totalInc - totalExp).toFixed(2), '']);
  const csv = '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `暖记账目_${dayKey(new Date())}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('已导出，用 Excel / WPS 打开即可');
}

async function exportBackup() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `暖记备份_${dayKey(new Date())}.json`; a.click();
  URL.revokeObjectURL(url); toast('已导出，请把文件转存到自己那边保管');
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
  if (!location.hash) location.hash = '#/record';
  router();
  tabbar.querySelectorAll('.tab').forEach((t) => t.onclick = () => { if (location.hash !== t.dataset.route) location.hash = t.dataset.route; else router(); });
}
init();
