// 本地存储层（IndexedDB）
const DB_NAME = 'nuanji-ledger';
const DB_VER = 2;   // v2：新增 accounts（账户）/ plans（定投计划）。老库升级时只加表，不动已有数据。
let dbp = null;

function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('budgets')) db.createObjectStore('budgets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('quick')) db.createObjectStore('quick', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('accounts')) db.createObjectStore('accounts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('plans')) db.createObjectStore('plans', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function store(name, mode) {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}
function reqP(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

export async function getAll(name) { return reqP((await store(name, 'readonly')).getAll()); }
export async function get(name, key) { return reqP((await store(name, 'readonly')).get(key)); }
export async function put(name, val) { return reqP((await store(name, 'readwrite')).put(val)); }
export async function del(name, key) { return reqP((await store(name, 'readwrite')).delete(key)); }
export async function clearStore(name) { return reqP((await store(name, 'readwrite')).clear()); }

// 默认分类（支出12 + 收入4）
const DEFAULT_CATS = [
  { type: 'expense', name: '餐饮', emoji: '🍜', color: '#FF8A5B' },
  { type: 'expense', name: '交通', emoji: '🚌', color: '#5BA8FF' },
  { type: 'expense', name: '购物', emoji: '🛍️', color: '#FF6FB5' },
  { type: 'expense', name: '居家', emoji: '🏠', color: '#B98CFF' },
  { type: 'expense', name: '娱乐', emoji: '🎮', color: '#FFC15B' },
  { type: 'expense', name: '医疗', emoji: '💊', color: '#FF7A7A' },
  { type: 'expense', name: '教育', emoji: '📚', color: '#4FD0C0' },
  { type: 'expense', name: '人情', emoji: '🎁', color: '#FF9F6B' },
  { type: 'expense', name: '通讯', emoji: '📱', color: '#7C9CFF' },
  { type: 'expense', name: '旅行', emoji: '✈️', color: '#4FC3F7' },
  { type: 'expense', name: '宠物', emoji: '🐾', color: '#8ED081' },
  { type: 'expense', name: '其他', emoji: '📦', color: '#B0A393' },
  { type: 'income', name: '工资', emoji: '💰', color: '#3ED35A' },
  { type: 'income', name: '兼职', emoji: '💼', color: '#2FB8A0' },
  { type: 'income', name: '理财', emoji: '📈', color: '#36C26B' },
  { type: 'income', name: '其他收入', emoji: '🪙', color: '#8FD98F' },
];

// 默认账户（钱平时放在哪几个地方）。initial = 开户时的金额，用户第一次用时填。
// 前四个是日常花钱的地方；「基金」是理财账户 —— 定投要有个去处，先给一个，不要可以删。
const DEFAULT_ACCOUNTS = [
  { name: '微信', emoji: '💚', color: '#3ED35A', kind: 'normal' },
  { name: '支付宝', emoji: '💙', color: '#5BA8FF', kind: 'normal' },
  { name: '银行卡', emoji: '💳', color: '#B98CFF', kind: 'normal' },
  { name: '现金', emoji: '💵', color: '#FFC15B', kind: 'normal' },
  { name: '基金', emoji: '📈', color: '#F2703F', kind: 'invest' },
];

export async function seedIfEmpty() {
  const cats = await getAll('categories');
  if (cats.length === 0) {
    DEFAULT_CATS.forEach((c, i) => {
      put('categories', { id: 'c' + i, name: c.name, type: c.type, emoji: c.emoji, color: c.color, hidden: false, order: i });
    });
  }
  const accs = await getAll('accounts');
  if (accs.length === 0) {
    DEFAULT_ACCOUNTS.forEach((a, i) => {
      put('accounts', {
        id: 'a' + i, name: a.name, emoji: a.emoji, color: a.color,
        initial: 0, order: i, hidden: false, kind: a.kind || 'normal', createdAt: Date.now(),
      });
    });
  }
}

// ---------- 账户 ----------
// 按 order 排好再返回 —— IndexedDB 的 getAll 是按主键（id）排的，
// id 是 'a0'/'a1'/'a<时间戳>' 这种，自建账户会排在默认账户前面，顺序很跳。
export async function getAllAccounts() {
  const all = await getAll('accounts');
  all.sort((a, b) => (a.order || 0) - (b.order || 0));
  return all;
}
export async function addAccount(a) { return put('accounts', a); }
export async function delAccount(id) { return del('accounts', id); }

// ---------- 定投计划 ----------
export async function getAllPlans() { return getAll('plans'); }
export async function addPlan(p) { return put('plans', p); }
export async function delPlan(id) { return del('plans', id); }

export async function getCategories(type) {
  const all = await getAll('categories');
  all.sort((a, b) => (a.order || 0) - (b.order || 0));
  return all.filter((c) => !c.hidden && (!type || c.type === type));
}
export async function getAllCategories() { return getAll('categories'); }

export async function addRecord(rec) { return put('records', rec); }
export async function deleteRecord(id) { return del('records', id); }
export async function getRecords() { return getAll('records'); }

export async function getBudget(id) { return get('budgets', id); }
export async function setBudget(id, limit) {
  if (limit == null || limit === '' || Number(limit) <= 0) return del('budgets', id);
  return put('budgets', { id, limit: Number(limit) });
}
export async function getBudgets() { return getAll('budgets'); }

export async function getQuick() { return getAll('quick'); }
export async function addQuick(q) { return put('quick', q); }
export async function deleteQuick(id) { return del('quick', id); }

// 备份：导出全部 / 导入覆盖
export async function exportAll() {
  const [records, categories, budgets, quick, accounts, plans] = await Promise.all([
    getAll('records'), getAll('categories'), getAll('budgets'), getAll('quick'),
    getAll('accounts'), getAll('plans'),
  ]);
  return { app: 'nuanji', version: 2, exportedAt: new Date().toISOString(), records, categories, budgets, quick, accounts, plans };
}
export async function importAll(data, merge = false) {
  if (!merge) {
    await Promise.all([clearStore('records'), clearStore('categories'), clearStore('budgets'),
      clearStore('quick'), clearStore('accounts'), clearStore('plans')]);
  }
  for (const r of data.records || []) await put('records', r);
  for (const c of data.categories || []) await put('categories', c);
  for (const b of data.budgets || []) await put('budgets', b);
  for (const q of data.quick || []) await put('quick', q);
  for (const a of data.accounts || []) await put('accounts', a);
  for (const p of data.plans || []) await put('plans', p);
  await seedIfEmpty();   // 老备份里没有账户的话，补上默认的几个，免得页面空着
}
