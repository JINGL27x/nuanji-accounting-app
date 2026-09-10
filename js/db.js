// 本地存储层（IndexedDB）
const DB_NAME = 'nuanji-ledger';
const DB_VER = 1;
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

export async function seedIfEmpty() {
  const cats = await getAll('categories');
  if (cats.length === 0) {
    DEFAULT_CATS.forEach((c, i) => {
      put('categories', { id: 'c' + i, name: c.name, type: c.type, emoji: c.emoji, color: c.color, hidden: false, order: i });
    });
  }
}

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
  const [records, categories, budgets, quick] = await Promise.all([
    getAll('records'), getAll('categories'), getAll('budgets'), getAll('quick'),
  ]);
  return { app: 'nuanji', version: 1, exportedAt: new Date().toISOString(), records, categories, budgets, quick };
}
export async function importAll(data, merge = false) {
  if (!merge) {
    await Promise.all([clearStore('records'), clearStore('categories'), clearStore('budgets'), clearStore('quick')]);
  }
  for (const r of data.records || []) await put('records', r);
  for (const c of data.categories || []) await put('categories', c);
  for (const b of data.budgets || []) await put('budgets', b);
  for (const q of data.quick || []) await put('quick', q);
}
