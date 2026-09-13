// 账户与定投的纯逻辑：不碰 DOM、不碰存储，方便单独验证。
//
// 钱只有五种动法，每种都改到某个账户的余额：
//   支出 / 收入   —— kind 缺省或 'normal'
//   转账          —— kind='transfer'，accountId 减、toAccountId 加
//   校准          —— kind='adjust'，amount 是差额（可正可负）
//   盈亏          —— kind='pnl'，同上，给投资账户用
// 后三种都「不算消费」，绝不能进任何支出/收入统计。
import { dayKey } from './format.js';

export const ACCOUNT_COLORS = ['#3ED35A', '#5BA8FF', '#B98CFF', '#FFC15B', '#F2703F', '#4FD0C0', '#FF6FB5', '#7C9CFF'];

/** 是不是普通记账（支出/收入）。转账、校准、盈亏都不算。 */
export function isNormal(r) { return !r || !r.kind || r.kind === 'normal'; }
export function onlyNormal(records) { return (records || []).filter(isNormal); }

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * 每个账户当前还剩多少。
 *   余额 = 初始金额 + 收入 − 支出 + 转入 − 转出 + 校准调整 + 盈亏调整
 * 允许为负 —— 记账要的是如实记录，不是管住用户。
 */
export function accountBalances(accounts, records) {
  const bal = {};
  (accounts || []).forEach((a) => { bal[a.id] = num(a.initial); });
  const has = (id) => !!id && bal[id] !== undefined;

  for (const r of records || []) {
    const amt = num(r.amount);
    switch (r.kind) {
      case 'transfer':
        if (has(r.accountId)) bal[r.accountId] -= amt;       // 转出
        if (has(r.toAccountId)) bal[r.toAccountId] += amt;   // 转入
        break;
      case 'adjust':
      case 'pnl':
        if (has(r.accountId)) bal[r.accountId] += amt;       // amount 就是差额
        break;
      default:
        if (has(r.accountId)) bal[r.accountId] += (r.type === 'income' ? amt : -amt);
    }
  }
  return bal;
}

export function totalBalance(accounts, records) {
  const b = accountBalances(accounts, records);
  return (accounts || []).reduce((s, a) => s + (b[a.id] || 0), 0);
}

/** 某个账户的流水（倒序）。转入的记录也算它的流水，方便看出钱从哪来。 */
export function accountRecords(records, accountId) {
  return (records || [])
    .filter((r) => r.accountId === accountId || r.toAccountId === accountId)
    .sort((a, b) => b.date - a.date);
}

/** 某个账户在 [start, end] 这段时间里，实际花掉多少（只算普通支出，不看转账校准） */
export function spentInRange(records, accountId, startTs, endTs) {
  return onlyNormal(records)
    .filter((r) => r.accountId === accountId && r.type === 'expense' && r.date >= startTs && r.date <= endTs)
    .reduce((s, r) => s + num(r.amount), 0);
}

/**
 * 从计划的起点起、到 now 为止，这个定投计划应该产生哪些「到期日」。
 * 已经跑过的（记在 lastRunKey 之后的）不再返回 —— 保证不会重复补。
 */
export function dueDates(plan, now = new Date()) {
  const out = [];
  if (!plan || !plan.active) return out;
  if (!(num(plan.amount) > 0)) return out;
  if (!plan.toAccountId) return out;
  if (!plan.fromAccountId) return out;      // 没有「扣钱账户」会凭空生钱，宁可不跑
  if (plan.toAccountId === plan.fromAccountId) return out;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(plan.startDate || Date.now());
  let from = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  if (plan.lastRunKey) {
    const lr = new Date(plan.lastRunKey + 'T00:00:00');
    if (!isNaN(lr)) from = new Date(Math.max(from.getTime(), lr.getTime() + 86400000));
  }
  if (from > today) return out;

  if (plan.freq === 'weekly') {
    const d = new Date(from);
    while (d <= today) {
      if (d.getDay() === Number(plan.day)) out.push(dayKey(d));
      d.setDate(d.getDate() + 1);
    }
  } else {
    const want = Number(plan.day) || 1;
    let y = from.getFullYear(), m = from.getMonth();
    while (y < today.getFullYear() || (y === today.getFullYear() && m <= today.getMonth())) {
      const dim = new Date(y, m + 1, 0).getDate();
      const d = new Date(y, m, Math.min(want, dim));   // 31 号遇到小月自动落到月末
      if (d >= from && d <= today) out.push(dayKey(d));
      m += 1; if (m > 11) { m = 0; y += 1; }
    }
  }
  return out;
}

/** 定投生成的记录用固定 id —— 反复打开 App 也不会重复记 */
export function runRecordId(plan, key) { return 'tf_' + plan.id + '_' + key; }

/** 下一次什么时候投（界面上显示「下次：10月15日」）。
 *  注意要从「上次投过的那天」的第二天起算 —— 今天正好投过的话，
 *  直接从今天起算会又算出今天，界面就会显示一个已经过去的「下次」。 */
export function nextRunDate(plan, from = new Date()) {
  if (!plan || !plan.active) return null;
  let today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (plan.lastRunKey) {
    const lr = new Date(plan.lastRunKey + 'T00:00:00');
    if (!isNaN(lr)) {
      const nx = new Date(lr.getTime() + 86400000);
      if (nx > today) today = nx;
    }
  }
  if (plan.freq === 'weekly') {
    const d = new Date(today);
    for (let i = 0; i < 8; i++) { if (d.getDay() === Number(plan.day)) return new Date(d); d.setDate(d.getDate() + 1); }
    return null;
  }
  const want = Number(plan.day) || 1;
  let y = today.getFullYear(), m = today.getMonth();
  for (let i = 0; i < 14; i++) {
    const dim = new Date(y, m + 1, 0).getDate();
    const d = new Date(y, m, Math.min(want, dim));
    if (d >= today) return d;
    m += 1; if (m > 11) { m = 0; y += 1; }
  }
  return null;
}

export function freqLabel(plan) {
  if (!plan) return '';
  return plan.freq === 'weekly'
    ? ('每周' + ('日一二三四五六'[Number(plan.day) % 7] || ''))
    : ('每月 ' + (Number(plan.day) || 1) + ' 号');
}
