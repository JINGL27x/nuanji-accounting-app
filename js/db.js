// 本地存储层（IndexedDB）
const DB_NAME = 'nuanji-ledger';
const DB_VER = 3;   // v2：加 accounts / plans；v3：加 meta（记「子账户拆分」这类一次性迁移有没有做过）
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
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
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

// 默认账户。微信 / 支付宝下面本来就分好几个小钱包（零钱、零钱通、余额、余额宝、小荷包），
// 银行卡也常常好几张 —— 所以账户带一个 group 字段：
//   group 相同的算同一个「大类」（点进去再选具体哪个）；没有 group 的自己单独算一类。
// order 隔开编号（1x 微信 / 2x 支付宝…），中间留空方便以后插。
// initial = 开户时的金额，用户第一次用时填。
const DEFAULT_ACCOUNTS = [
  { id: 'a0', name: '零钱', emoji: '💬', color: '#3ED35A', group: '微信', kind: 'normal', order: 1 },
  { id: 'a1', name: '零钱通', emoji: '💰', color: '#2FB8A0', group: '微信', kind: 'invest', order: 2 },
  { id: 'a2', name: '余额', emoji: '💲', color: '#5BA8FF', group: '支付宝', kind: 'normal', order: 11 },
  { id: 'a3', name: '余额宝', emoji: '🐷', color: '#7C9CFF', group: '支付宝', kind: 'invest', order: 12 },
  { id: 'a4', name: '小荷包', emoji: '👛', color: '#FF6FB5', group: '支付宝', kind: 'normal', order: 13 },
  { id: 'a5', name: '银行卡', emoji: '💳', color: '#B98CFF', group: '银行卡', kind: 'normal', order: 21 },
  { id: 'a6', name: '现金', emoji: '💵', color: '#FFC15B', group: '', kind: 'normal', order: 31 },
  { id: 'a7', name: '基金', emoji: '📈', color: '#F2703F', group: '', kind: 'invest', order: 41 },
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
    DEFAULT_ACCOUNTS.forEach((a) => {
      put('accounts', {
        id: a.id, name: a.name, emoji: a.emoji, color: a.color, group: a.group,
        initial: 0, order: a.order, hidden: false, kind: a.kind, createdAt: Date.now(),
      });
    });
  }
}

/**
 * 老库升级：把「微信 / 支付宝」拆成里面的小钱包。
 * 原则是**只改名字、只补缺的，绝不碰余额和流水** ——
 * 因为 id 不变，原来记在这个账户上的每一笔账、以及你填的开户金额，都原地不动。
 * 只在「账户还是默认那个名字」时才动手，用户改过名字的一律不碰。幂等，跑几遍都一样。
 * 另外三件小事：把用户自建的账户排到最后（先后顺序不变）、名字带「银行」的顺手归到「银行卡」、
 * 统一几个丑 / 撞车的默认图标（💚零钱→💬、💙余额→💲、🧧小荷包→👛、📈余额宝→🐷）。
 */
export async function migrateSubAccounts() {
  const accs = await getAllAccounts();
  const byId = {}; accs.forEach((a) => { byId[a.id] = a; });
  const hasGroup = (g) => accs.some((a) => a.group === g);
  let n = 0;

  // 微信：a0「微信」→「零钱」，再补一个「零钱通」
  if (byId.a0 && byId.a0.name === '微信' && !hasGroup('微信')) {
    await put('accounts', Object.assign({}, byId.a0, { name: '零钱', group: '微信', order: 1 }));
    await put('accounts', {
      id: 'as1', name: '零钱通', emoji: '💰', color: '#2FB8A0', group: '微信',
      initial: 0, order: 2, hidden: false, kind: 'invest', createdAt: Date.now(),
    });
    n += 2;
  }

  // 支付宝：a1「支付宝」→「余额」，再补「余额宝」「小荷包」
  if (byId.a1 && byId.a1.name === '支付宝' && !hasGroup('支付宝')) {
    await put('accounts', Object.assign({}, byId.a1, { name: '余额', group: '支付宝', order: 11 }));
    await put('accounts', {
      id: 'as2', name: '余额宝', emoji: '🐷', color: '#7C9CFF', group: '支付宝',
      initial: 0, order: 12, hidden: false, kind: 'invest', createdAt: Date.now(),
    });
    await put('accounts', {
      id: 'as3', name: '小荷包', emoji: '👛', color: '#FF6FB5', group: '支付宝',
      initial: 0, order: 13, hidden: false, kind: 'normal', createdAt: Date.now(),
    });
    n += 3;
  }

  // 银行卡归到「银行卡」这个大类下（一张卡时看不出差别；以后加了建设银行就会自动成组）
  if (byId.a2 && !byId.a2.group) {
    await put('accounts', Object.assign({}, byId.a2, { group: '银行卡', order: 21 })); n++;
  }
  if (byId.a3 && byId.a3.order === 3) {   // 老的「现金」
    await put('accounts', Object.assign({}, byId.a3, { order: 31 })); n++;
  }
  if (byId.a4 && byId.a4.order === 4) {   // 老的「基金」
    await put('accounts', Object.assign({}, byId.a4, { order: 41 })); n++;
  }

  // 上一版里用户自己加的账户，order 是「当时的最大值 + 1」—— 通常就只有 5、6 这种小数字。
  // 而默认账户升级后的 order 变成了 1 / 11 / 21…，这些小 order 会被夹在「微信」和「支付宝」中间，
  // 看起来就像有个账户跑错了组。所以把「不是已知默认账户」的一律排到最后，先后顺序保持不变。
  const KNOWN = new Set(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'as1', 'as2', 'as3']);
  const extras = accs
    .filter((a) => !KNOWN.has(a.id) && (a.order === undefined || a.order === null || Number(a.order) < 100))
    .sort((x, y) => (Number(x.order) || 0) - (Number(y.order) || 0));
  let next = 101;
  for (const a of extras) {
    const patch = { order: next++ };
    // 名字里带「银行」的自建账户（比如「广发银行」）顺手归到「银行卡」大类，
    // 省得升级完还要手动归类一次 —— 用户随时可以在「编辑」里改回去。
    if (!a.group && /银行/.test(a.name || '')) patch.group = '银行卡';
    await put('accounts', Object.assign({}, a, patch));
    n++;
  }

  // 统一几个不好看 / 撞车的默认图标，给「已经升过级的手机」也补一遍：
  //   💚 零钱 → 💬（绿色爱心太土）  💙 余额 → 💲（蓝色爱心太土）
  //   🧧 小荷包 → 👛（粉色底上红红包太扎眼）  📈 余额宝 → 🐷（跟「基金」撞成一样的了）
  // ⚠️ 两件事都不能只看一样：
  //   ① 不能只按图标找 —— 余额宝和基金都是 📈，只认图标会把基金也改了；
  //   ② 也不能只按 id 找 —— id 在不同库里是重排过的：从老版本升上来的手机「余额」是 a1，
  //      而全新安装的手机「余额」是 a2、「余额宝」是 a3、「小荷包」是 a4（余额宝压根不叫 as2）。
  // 所以判据是「**名字 + 现在的图标**两个都还是默认那一对」才动手 ——
  // 这样既不会误伤基金（名字不叫余额宝），也不会漏掉任何一种 id 布局，
  // 用户自己改过名字或换过图标的更是一律不碰。
  const ICON_FIX = [
    { name: '零钱',   from: '💚', to: '💬' },
    { name: '余额',   from: '💙', to: '💲' },
    { name: '余额宝', from: '📈', to: '🐷' },
    { name: '小荷包', from: '🧧', to: '👛' },
  ];
  const fresh = await getAllAccounts();   // 前面的改名分支刚写过，得重新取一遍才拿得到新名字
  for (const a of fresh) {
    const fix = ICON_FIX.find((f) => f.name === a.name && f.from === a.emoji);
    if (fix) {
      await put('accounts', Object.assign({}, a, { emoji: fix.to })); n++;
    }
  }
  return n;
}

/** 一次性迁移的开关：做过就记在 meta 里，别每次都跑 */
export async function getMeta(id) { return get('meta', id); }
export async function setMeta(id, val) { return put('meta', Object.assign({ id }, val || {})); }

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
  const [records, categories, budgets, quick, accounts, plans, meta] = await Promise.all([
    getAll('records'), getAll('categories'), getAll('budgets'), getAll('quick'),
    getAll('accounts'), getAll('plans'), getAll('meta'),
  ]);
  return { app: 'nuanji', version: 3, exportedAt: new Date().toISOString(), records, categories, budgets, quick, accounts, plans, meta };
}
export async function importAll(data, merge = false) {
  if (!merge) {
    await Promise.all([clearStore('records'), clearStore('categories'), clearStore('budgets'),
      clearStore('quick'), clearStore('accounts'), clearStore('plans'), clearStore('meta')]);
  }
  for (const r of data.records || []) await put('records', r);
  for (const c of data.categories || []) await put('categories', c);
  for (const b of data.budgets || []) await put('budgets', b);
  for (const q of data.quick || []) await put('quick', q);
  for (const a of data.accounts || []) await put('accounts', a);
  for (const p of data.plans || []) await put('plans', p);
  for (const m of data.meta || []) await put('meta', m);
  // 老备份里没有账户 / 账户还是老结构的话，这里补上并升级
  await seedIfEmpty();
}
