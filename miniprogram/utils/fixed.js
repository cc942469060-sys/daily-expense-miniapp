// Fixed monthly expenses (mortgage, phone bill, electricity...): templates that record a bill
// with one tap. They live in state.fixedExpenses, which older ledgers and backups do not have;
// a missing list reads as empty, so no migration is needed. Bills made from a template carry
// its id as fixedId, which tells whether this month's bill is already recorded.
const dates = require('./date');
const { moneyText } = require('./money');
const MAX_FIXED = 50;
const MAX_CENTS = 999999999;
function list(s) { return Array.isArray(s.fixedExpenses) ? s.fixedExpenses : []; }
function validId(v) { return typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v); }
function validMonth(v) { return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v); }
function validateList(s, payments) {
  if (s.fixedExpenses === undefined) return s;
  if (!Array.isArray(s.fixedExpenses) || s.fixedExpenses.length > MAX_FIXED) throw new Error('固定支出数据无效');
  const ids = new Set(); const names = new Set();
  s.fixedExpenses.forEach(f => {
    const c = f && s.categories.find(c => c.id === f.categoryId);
    if (!f || !validId(f.id) || ids.has(f.id) || typeof f.name !== 'string' || !f.name.trim() || f.name.length > 12 || names.has(f.name.trim()) || !c || c.type !== 'expense' || typeof f.variable !== 'boolean' || !Number.isSafeInteger(f.amountCents) || f.amountCents < (f.variable ? 0 : 1) || f.amountCents > MAX_CENTS || !Number.isSafeInteger(f.day) || f.day < 1 || f.day > 31 || !payments.includes(f.payment) || typeof f.note !== 'string' || f.note.length > 80 || !(f.endMonth === '' || validMonth(f.endMonth)) || !Number.isSafeInteger(f.createdAt) || f.createdAt < 0 || !Number.isSafeInteger(f.updatedAt) || f.updatedAt < 0) throw new Error('固定支出数据无效');
    ids.add(f.id); names.add(f.name.trim());
  });
  return s;
}
function monthOf(date) { return date.slice(0, 7); }
// The day the bill falls due in a month; the 31st becomes the last day of shorter months.
function dueDate(item, month) {
  const y = Number(month.slice(0, 4)); const m = Number(month.slice(5, 7));
  const last = new Date(y, m, 0, 12).getDate();
  return `${month}-${String(Math.min(item.day, last)).padStart(2, '0')}`;
}
// One tap on or after the due day records the bill on the due day (a missed auto-debit keeps its
// real date); tapping before it, when paying early, records today. Never a future date.
function recordDate(item, today) { const due = dueDate(item, monthOf(today)); return due <= today ? due : today; }
function activeIn(item, month) { return item.endMonth === '' || item.endMonth >= month; }
function billsOf(s, itemId, month) { return s.records.filter(r => r.fixedId === itemId && monthOf(r.date) === month); }
// Amount to suggest: the latest bill made from this template (variable amounts follow the
// last month), else the template's own amount.
function lastAmountCents(s, item) {
  let latest = null;
  for (const r of s.records) if (r.fixedId === item.id && (!latest || r.date > latest.date || (r.date === latest.date && r.createdAt > latest.createdAt))) latest = r;
  return latest ? latest.amountCents : item.amountCents;
}
// This month's checklist on the home page, ordered by due day.
function plan(s, today) {
  const month = monthOf(today); const cats = {}; s.categories.forEach(c => { cats[c.id] = c; });
  const items = list(s).filter(item => activeIn(item, month)).map(item => {
    const bills = billsOf(s, item.id, month).sort((a, b) => (b.date + b.time < a.date + a.time ? -1 : 1));
    const due = dueDate(item, month); const amountCents = lastAmountCents(s, item);
    const recordedCents = bills.reduce((sum, r) => sum + r.amountCents - r.refundCents, 0);
    const status = bills.length ? 'done' : due < today ? 'overdue' : due === today ? 'today' : 'upcoming';
    return { id: item.id, name: item.name, icon: cats[item.categoryId].icon, variable: item.variable, day: item.day, due, dueText: Number(due.slice(5, 7)) + '月' + Number(due.slice(8)) + '日', status, billId: bills.length ? bills[0].id : '', count: bills.length,
      amountText: bills.length ? moneyText(recordedCents) : amountCents ? moneyText(amountCents) : '', estimated: !bills.length && item.variable };
  }).sort((a, b) => a.day - b.day || (a.name < b.name ? -1 : 1));
  const done = items.filter(i => i.status === 'done').length;
  return { month, items, done, total: items.length, pending: items.length - done, overdue: items.filter(i => i.status === 'overdue').length };
}
function describe(s, item, today) {
  const c = s.categories.find(c => c.id === item.categoryId);
  const ended = item.endMonth !== '' && item.endMonth < monthOf(today);
  return Object.assign({}, item, { icon: c.icon, categoryName: c.name, amountText: item.amountCents ? moneyText(item.amountCents) : '', ended, endText: item.endMonth ? item.endMonth.replace('-', '年') + '月' : '' });
}
// Suggestions from history: expenses with the same category and note that appear exactly once a
// month in at least 3 of the last 6 months, on about the same day, with amounts that stay close.
// Bills already made from a template, and pairs a template already covers, are left out.
const LOOKBACK_MONTHS = 6; const MIN_MONTHS = 3; const DAY_SPREAD = 3;
function shiftMonth(month, n) { const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function noteKey(note) { return String(note || '').trim().toLowerCase(); }
function signature(categoryId, note) { return categoryId + '|' + noteKey(note); }
function suggestions(s, today, dismissed = []) {
  const month = monthOf(today); const since = shiftMonth(month, -LOOKBACK_MONTHS) + '-01';
  const cats = {}; s.categories.forEach(c => { cats[c.id] = c; });
  const covered = list(s).map(f => ({ categoryId: f.categoryId, name: noteKey(f.name) }));
  const groupsByKey = new Map();
  for (const r of s.records) {
    if (r.type !== 'expense' || r.fixedId || r.date < since || r.date > today) continue;
    const key = signature(r.categoryId, r.note);
    if (!groupsByKey.has(key)) groupsByKey.set(key, []);
    groupsByKey.get(key).push(r);
  }
  const result = [];
  for (const [key, records] of groupsByKey) {
    if (dismissed.includes(key)) continue;
    const byMonth = new Map(); records.forEach(r => { const m = monthOf(r.date); byMonth.set(m, (byMonth.get(m) || 0) + 1); });
    // Once a month only; the current month may not have come round yet.
    if ([...byMonth.values()].some(n => n > 1)) continue;
    if ([...byMonth.keys()].filter(m => m < month).length < MIN_MONTHS) continue;
    const sorted = records.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const days = sorted.map(r => Number(r.date.slice(8))).sort((a, b) => a - b); const day = days[Math.floor(days.length / 2)];
    if (days.some(d => Math.abs(d - day) > DAY_SPREAD)) continue;
    const amounts = sorted.map(r => r.amountCents); const min = Math.min(...amounts); const max = Math.max(...amounts);
    if (max > min * 2.5) continue;
    const r0 = sorted[sorted.length - 1]; const c = cats[r0.categoryId];
    const name = (r0.note.trim() || c.name).slice(0, 12);
    if (covered.some(f => f.categoryId === r0.categoryId && (f.name === noteKey(name) || noteKey(r0.note).startsWith(f.name)))) continue;
    if (list(s).some(f => noteKey(f.name) === noteKey(name))) continue;
    const variable = max !== min;
    result.push({ key, name, icon: c.icon, categoryId: r0.categoryId, categoryName: c.name, note: '', payment: r0.payment, day, variable, amountCents: r0.amountCents, amountText: moneyText(r0.amountCents), rangeText: variable ? moneyText(min) + '—' + moneyText(max) : '', months: byMonth.size, recordIds: sorted.map(r => r.id) });
  }
  return result.sort((a, b) => b.months - a.months || a.day - b.day).slice(0, 5);
}
// Fixed against everything else in a set of expense records, by net amount.
function split(records) {
  let fixedCents = 0; let dailyCents = 0; let fixedCount = 0;
  records.forEach(r => { if (r.type !== 'expense') return; const cents = r.amountCents - r.refundCents; if (r.fixedId) { fixedCents += cents; fixedCount++; } else dailyCents += cents; });
  const totalCents = fixedCents + dailyCents;
  const percent = totalCents ? Math.round(fixedCents / totalCents * 1000) / 10 : 0;
  return { fixedCents, dailyCents, fixedCount, fixedText: moneyText(fixedCents), dailyText: moneyText(dailyCents), fixedPercent: percent.toFixed(1), dailyPercent: totalCents ? (100 - percent).toFixed(1) : '0.0', fixedWidth: Math.round(percent) };
}
module.exports = { signature, suggestions, split, MAX_FIXED, list, validateList, dueDate, recordDate, activeIn, billsOf, lastAmountCents, plan, describe };
