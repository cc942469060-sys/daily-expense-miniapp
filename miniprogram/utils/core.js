const dates = require('./date');
const PAYMENTS = ['未指定', '微信', '支付宝', '银行卡', '现金', '其他'];
const COLORS = ['#39775B', '#DB9D4F', '#718EC3', '#B98BC2', '#D58075', '#599CA0', '#8D9970', '#899096'];
const DEFAULT_CATEGORIES = [['food', '餐饮', '🍜'], ['transport', '交通', '🚇'], ['shopping', '购物', '🛒'], ['home', '住房', '🏠'], ['fun', '娱乐', '🎮'], ['health', '医疗', '💊'], ['study', '学习', '📚'], ['other', '其他', '📦']].map((c, i) => ({ id: c[0], name: c[1], icon: c[2], color: COLORS[i] }));
const MAX_CENTS = 999999999;
function freshState() { return { version: 1, categories: DEFAULT_CATEGORIES.map(c => Object.assign({}, c)), records: [], settings: { budgetCents: 0 }, updatedAt: '', lastBackupAt: '' }; }
function amountToCents(value, allowZero) {
  const raw = String(value).trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) throw new Error('请输入金额，最多保留两位小数');
  const parts = raw.split('.'); const cents = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
  if (cents > MAX_CENTS || cents < (allowZero ? 0 : 1)) throw new Error('消费金额须在 0.01—9,999,999.99 元之间');
  return cents;
}
function money(cents) { return (cents / 100).toFixed(2); }
function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`; }
function validateState(s) {
  if (!s || s.version !== 1 || !Array.isArray(s.categories) || !Array.isArray(s.records)) throw new Error('备份格式或版本不支持');
  if (!s.categories.length || s.categories.length > 40 || s.records.length > 50000) throw new Error('分类或账单数量超过支持范围');
  const cats = new Set(); const ids = new Set();
  s.categories.forEach(c => {
    if (!c || typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) || cats.has(c.id) || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 8 || typeof c.icon !== 'string' || !c.icon || c.icon.length > 10 || !/^#[a-fA-F0-9]{6}$/.test(c.color)) throw new Error('分类数据无效');
    cats.add(c.id);
  });
  if (new Set(s.categories.map(c => c.name.trim())).size !== s.categories.length) throw new Error('分类名称重复');
  s.records.forEach(r => {
    if (!r || typeof r.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(r.id) || ids.has(r.id) || !cats.has(r.categoryId) || !Number.isSafeInteger(r.amountCents) || r.amountCents <= 0 || r.amountCents > MAX_CENTS || !PAYMENTS.includes(r.payment) || typeof r.note !== 'string' || r.note.length > 100 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) || !Number.isSafeInteger(r.createdAt) || r.createdAt < 0 || !Number.isSafeInteger(r.updatedAt) || r.updatedAt < 0 || !Number.isSafeInteger(r.refundCents) || r.refundCents < 0 || r.refundCents > r.amountCents) throw new Error('账单数据无效');
    dates.parseDate(r.date); if (r.date < '2000-01-01' || r.date > '2100-12-31') throw new Error('账单日期超出范围'); ids.add(r.id);
  });
  if (!s.settings || !Number.isSafeInteger(s.settings.budgetCents) || s.settings.budgetCents < 0 || s.settings.budgetCents > MAX_CENTS || typeof s.updatedAt !== 'string' || typeof s.lastBackupAt !== 'string') throw new Error('设置数据无效');
  return s;
}
function net(r) { return r.amountCents - r.refundCents; }
function total(records) { return records.reduce((sum, r) => sum + net(r), 0); }
function filterRecords(state, filter) {
  const f = filter || {}; const query = String(f.query || '').trim().toLowerCase();
  const cats = {}; state.categories.forEach(c => { cats[c.id] = c; });
  return state.records.filter(r => (!f.start || r.date >= f.start) && (!f.end || r.date <= f.end) && (!f.categoryId || r.categoryId === f.categoryId) && (!f.payment || r.payment === f.payment) && (!query || `${r.note} ${cats[r.categoryId].name}`.toLowerCase().includes(query)))
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`) || b.createdAt - a.createdAt);
}
function decorate(state, r) {
  const c = state.categories.find(c => c.id === r.categoryId);
  return Object.assign({}, r, { categoryName: c.name, icon: c.icon, color: c.color, amountText: money(net(r)), originalText: money(r.amountCents), refundText: money(r.refundCents) });
}
function groups(state, records, fullRecords) {
  const dayTotals = {};
  (fullRecords || records).forEach(r => { dayTotals[r.date] = (dayTotals[r.date] || 0) + net(r); });
  const result = [];
  records.forEach(r => {
    let g = result[result.length - 1];
    if (!g || g.date !== r.date) { g = { date: r.date, records: [], sum: 0, totalText: '' }; result.push(g); }
    g.records.push(decorate(state, r)); g.sum = dayTotals[r.date]; g.totalText = money(g.sum);
  });
  return result;
}
function statistics(state, mode, anchor, today) {
  const bounds = dates.range(mode, anchor); const records = filterRecords(state, bounds); const sum = total(records);
  const gross = records.reduce((s, r) => s + r.amountCents, 0); const refunded = gross - sum;
  const effectiveEnd = bounds.end > today ? today : bounds.end;
  const days = effectiveEnd < bounds.start ? 1 : dates.dayCount(bounds.start, effectiveEnd);
  const categories = state.categories.map(c => {
    const cents = total(records.filter(r => r.categoryId === c.id));
    return Object.assign({}, c, { cents, amountText: money(cents), percent: sum ? (cents / sum * 100).toFixed(1) : '0.0', width: sum ? Math.round(cents / sum * 100) : 0 });
  }).filter(c => c.cents > 0).sort((a, b) => b.cents - a.cents);
  const bars = [];
  if (mode === 'year') {
    for (let i = 1; i <= 12; i++) {
      const month = `${anchor.slice(0, 4)}-${String(i).padStart(2, '0')}`; const r = dates.range('month', `${month}-01`);
      bars.push({ label: `${i}月`, cents: total(records.filter(r => r.date.slice(0, 7) === month)), start: r.start, end: r.end });
    }
  } else {
    for (let value = bounds.start; value <= bounds.end; value = dates.shiftDays(value, 1)) {
      bars.push({ label: mode === 'week' ? ['日', '一', '二', '三', '四', '五', '六'][dates.parseDate(value).getDay()] : String(Number(value.slice(8))), cents: total(records.filter(r => r.date === value)), start: value, end: value });
      if (value === bounds.end) break;
    }
  }
  const peak = Math.max(1, ...bars.map(b => b.cents));
  bars.forEach(b => { b.height = b.cents ? Math.max(3, Math.round(b.cents / peak * 100)) : 0; b.amountText = money(b.cents); });
  return { start: bounds.start, end: bounds.end, label: dates.periodLabel(mode, anchor), totalText: money(sum), grossText: money(gross), refundText: money(refunded), refundCents: refunded, count: records.length, averageText: money(Math.round(sum / days)), days, categories, bars, peakText: money(!sum ? 0 : peak), top: records.slice().sort((a, b) => net(b) - net(a)).slice(0, 3).map(r => decorate(state, r)) };
}
function createRecord(state, input, previous) {
  const now = Date.now(); dates.parseDate(input.date);
  if (input.date < '2000-01-01' || input.date > dates.dateKey(new Date())) throw new Error('请选择 2000 年起至今天的日期');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error('时间格式无效');
  if (!state.categories.some(c => c.id === input.categoryId)) throw new Error('请选择有效分类');
  if (!PAYMENTS.includes(input.payment)) throw new Error('支付方式无效');
  const note = String(input.note || '').trim(); if (note.length > 100) throw new Error('备注最多 100 字');
  const amountCents = amountToCents(input.amount); const refundCents = amountToCents(input.refund || '0', true);
  if (refundCents > amountCents) throw new Error('退款不能超过原消费金额');
  return { id: previous ? previous.id : id('bill'), categoryId: input.categoryId, amountCents, refundCents, payment: input.payment, date: input.date, time: input.time, note, createdAt: previous ? previous.createdAt : now, updatedAt: now };
}
function csv(state, records) {
  const cell = v => { let s = String(v); if (/^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const rows = [['日期', '时间', '分类', '原消费（元）', '退款（元）', '净消费（元）', '支付方式', '备注']];
  (records || filterRecords(state)).forEach(r => { const c = state.categories.find(c => c.id === r.categoryId); rows.push([r.date, r.time, c.name, money(r.amountCents), money(r.refundCents), money(net(r)), r.payment, r.note]); });
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
module.exports = { PAYMENTS, COLORS, DEFAULT_CATEGORIES, freshState, amountToCents, money, id, validateState, net, total, filterRecords, decorate, groups, statistics, createRecord, csv };
