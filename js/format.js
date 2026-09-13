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
/** 日历格子里那行金额：位置只有 40px 上下（360 宽的屏更窄），必须尽量短。
    所以不带 ¥（格子里的橙色数字本身就是金额，点进去有精确值）、不带小数，上万用「万」。
    实测：『¥113.19』『¥1000』在 360 宽的屏上都会被截成省略号，现在的最长形态是『1.2万』。 */
export function moneyCell(n) {
  const v = Math.round(Number(n) || 0);
  if (v >= 10000) {
    const w = Math.round(v / 1000) / 10;          // 12345 → 1.2（万）
    return (Number.isInteger(w) ? w : w.toFixed(1)) + '万';
  }
  return String(v);
}

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
