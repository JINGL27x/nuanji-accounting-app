// 金额与日期工具
export function money(n, withSymbol = true) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const s = v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withSymbol ? '¥' + s : s;
}
export function moneyShort(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return '¥' + s;
}
/** 余额用：负号放在 ¥ 前面。'¥-120' 这种写法非常别扭，'−¥120' 才像钱。 */
export function moneyNeg(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const abs = Math.abs(v);
  const s = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return (v < 0 ? '-¥' : '¥') + s;
}
/** 日历格子里那行金额。格子只有 36~44px 可用宽度，取舍如下：
    - 带 ¥ 和两位小数（金额看得准，符号也让「这是钱」一目了然）；
    - 上万改用「万」，否则 ¥12345.67 这种九位字符串必然超出；
    太长的（8 位以上或带「万」）由 CSS 自动降到 8px，见 .cal-day .amt.sm。 */
export function moneyCell(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  if (v >= 10000) return '¥' + (v / 10000).toFixed(2) + '万';   // ¥1.23万
  return '¥' + v.toFixed(2);                                    // ¥113.19
}
/** 这串金额在格子里算不算「长」（决定是否用小一号字） */
export function cellAmtLong(s) { return s.length >= 8 || s.indexOf('万') >= 0; }

export function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseDayKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 周一为一周开始
export function weekRange(d) {
  const s = startOfDay(d);
  const back = (s.getDay() + 6) % 7;
  const start = addDays(s, -back);
  const end = addDays(start, 6);
  return [start, end];
}
export function monthRange(d) {
  return [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 0)];
}
export function yearRange(d) {
  return [new Date(d.getFullYear(), 0, 1), new Date(d.getFullYear(), 11, 31)];
}
export function rangeFor(period, d) {
  if (period === 'day') { const s = startOfDay(d); return [s, s]; }
  if (period === 'week') return weekRange(d);
  if (period === 'month') return monthRange(d);
  if (period === 'year') return yearRange(d);
  return [startOfDay(d), startOfDay(d)];
}
// 时间戳是否落在 [start,end] 当天内
export function inRange(ts, start, end) {
  const s = startOfDay(start).getTime();
  const e = startOfDay(end).getTime() + 86400000 - 1;
  return ts >= s && ts <= e;
}
export function monthLabel(d) { return `${d.getFullYear()}年${d.getMonth() + 1}月`; }
export function rangeLabel(period, d) {
  if (period === 'day') return dayKey(d);
  if (period === 'week') { const [a, b] = weekRange(d); return `${dayKey(a)} ~ ${dayKey(b)}`; }
  if (period === 'month') return monthLabel(d);
  if (period === 'year') return `${d.getFullYear()}年`;
  return '';
}
export function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id' + Date.now() + Math.random().toString(16).slice(2);
}
