function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function timeKey(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期格式应为 YYYY-MM-DD');
  const p = value.split('-').map(Number); const d = new Date(p[0], p[1] - 1, p[2], 12);
  if (p[0] < 1900 || p[0] > 2200 || dateKey(d) !== value) throw new Error('日期无效');
  return d;
}
function shiftDays(value, n) { const d = parseDate(value); d.setDate(d.getDate() + n); return dateKey(d); }
function range(mode, anchor) {
  const d = parseDate(anchor); let start = anchor; let end = anchor;
  if (mode === 'week') { start = shiftDays(anchor, -((d.getDay() + 6) % 7)); end = shiftDays(start, 6); }
  else if (mode === 'month') { start = dateKey(new Date(d.getFullYear(), d.getMonth(), 1, 12)); end = dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)); }
  else if (mode === 'year') { start = `${d.getFullYear()}-01-01`; end = `${d.getFullYear()}-12-31`; }
  else if (mode !== 'day') throw new Error('统计周期无效');
  return { start, end };
}
function shiftPeriod(mode, anchor, step) {
  const d = parseDate(anchor);
  if (mode === 'day' || mode === 'week') d.setDate(d.getDate() + step * (mode === 'week' ? 7 : 1));
  else if (mode === 'month') { d.setDate(1); d.setMonth(d.getMonth() + step); }
  else if (mode === 'year') { d.setDate(1); d.setMonth(0); d.setFullYear(d.getFullYear() + step); }
  else throw new Error('统计周期无效');
  return dateKey(d);
}
function dayCount(start, end) {
  const a = start.split('-').map(Number); const b = end.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000) + 1;
}
function periodLabel(mode, anchor) {
  const r = range(mode, anchor);
  if (mode === 'week') return `${r.start.replace(/-/g, '/')} — ${r.end.slice(5).replace('-', '/')}`;
  if (mode === 'month') return `${anchor.slice(0, 4)}年${Number(anchor.slice(5, 7))}月`;
  if (mode === 'year') return `${anchor.slice(0, 4)}年`;
  return anchor.replace(/-/g, '/');
}
module.exports = { dateKey, timeKey, parseDate, shiftDays, range, shiftPeriod, dayCount, periodLabel };
