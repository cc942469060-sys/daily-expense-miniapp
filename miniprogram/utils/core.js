const dates = require('./date');
const assets = require('./assets');
const TYPES = ['expense', 'income'];
const PAYMENTS = ['未指定', '微信', '支付宝', '银行卡', '现金', '其他'];
const COLORS = ['#39775B', '#DB9D4F', '#718EC3', '#B98BC2', '#D58075', '#599CA0', '#8D9970', '#899096'];
const EXTRA_EXPENSE_CATEGORIES = [['insurance', '保险', '🛡️'], ['finance', '理财', '📊'], ['loan', '贷款', '🏦'], ['travel', '旅行', '🧳'], ['elders', '长辈', '🧓'], ['gift', '礼金', '🎁']].map((c, i) => ({ id: c[0], type: 'expense', name: c[1], icon: c[2], color: COLORS[i] }));
const DEFAULT_CATEGORIES = [['food', '餐饮', '🍜'], ['transport', '交通', '🚇'], ['shopping', '购物', '🛒'], ['home', '住房', '🏠'], ['fun', '娱乐', '🎮'], ['health', '医疗', '💊'], ['study', '学习', '📚'], ['other', '其他', '📦']].map((c, i) => ({ id: c[0], type: 'expense', name: c[1], icon: c[2], color: COLORS[i] })).concat(EXTRA_EXPENSE_CATEGORIES);
const INCOME_CATEGORIES = [['income_salary', '工资', '💼'], ['income_bonus', '奖金补贴', '🏅'], ['income_reimbursement', '报销', '🧾'], ['income_redpacket', '红包', '🧧'], ['income_gift', '礼金', '🎁'], ['income_sidejob', '兼职副业', '🛠️'], ['income_investment', '投资收益', '📈'], ['income_other', '其他收入', '💰']].map((c, i) => ({ id: c[0], type: 'income', name: c[1], icon: c[2], color: COLORS[i] }));
const MAX_CENTS = 999999999;
function freshState() {
  return Object.assign({ version: 3, categories: DEFAULT_CATEGORIES.concat(INCOME_CATEGORIES).map(c => Object.assign({}, c)), records: [], settings: { budgetCents: 0, expenseCategoryRevision: 1, assetAmountsHidden: false }, updatedAt: '', lastBackupAt: '' }, assets.initialFields());
}
function amountToCents(value, allowZero) {
  const raw = String(value).trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) throw new Error('请输入金额，最多保留两位小数');
  const parts = raw.split('.'); const cents = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
  if (cents > MAX_CENTS || cents < (allowZero ? 0 : 1)) throw new Error('金额须在 0.01—9,999,999.99 元之间');
  return cents;
}
function money(cents) { return (cents / 100).toFixed(2); }
function id(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }
function validate(s, version) {
  if (!s || s.version !== version || !Array.isArray(s.categories) || !Array.isArray(s.records)) throw new Error('备份格式或版本不支持');
  if (!s.categories.length || s.categories.length > (version === 1 ? 40 : 80) || s.records.length > 50000) throw new Error('分类或账单数量超过支持范围');
  const cats = new Map(); const ids = new Set(); const names = new Set();
  s.categories.forEach(c => {
    if (!c || typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) || cats.has(c.id) || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 8 || typeof c.icon !== 'string' || !c.icon || c.icon.length > 10 || !/^#[a-fA-F0-9]{6}$/.test(c.color)) throw new Error('分类数据无效');
    if (version >= 2 && !TYPES.includes(c.type)) throw new Error('分类类型无效');
    const name = (version === 1 ? '' : c.type + ':') + c.name.trim();
    if (names.has(name)) throw new Error('分类名称重复');
    names.add(name); cats.set(c.id, c);
  });
  if (version >= 2) TYPES.forEach(type => {
    const count = s.categories.filter(c => c.type === type).length;
    if (count < 1 || count > 40) throw new Error('收入和支出各须保留 1—40 个分类');
  });
  s.records.forEach(r => {
    if (!r || typeof r.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(r.id) || ids.has(r.id) || !cats.has(r.categoryId) || !Number.isSafeInteger(r.amountCents) || r.amountCents <= 0 || r.amountCents > MAX_CENTS || !PAYMENTS.includes(r.payment) || typeof r.note !== 'string' || r.note.length > 100 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) || !Number.isSafeInteger(r.createdAt) || r.createdAt < 0 || !Number.isSafeInteger(r.updatedAt) || r.updatedAt < 0 || !Number.isSafeInteger(r.refundCents) || r.refundCents < 0 || r.refundCents > r.amountCents) throw new Error('账单数据无效');
    if (version >= 2 && (!TYPES.includes(r.type) || cats.get(r.categoryId).type !== r.type || (r.type === 'income' && r.refundCents !== 0))) throw new Error('账单类型、分类或退款数据无效');
    dates.parseDate(r.date);
    if (r.date < '2000-01-01' || r.date > '2100-12-31') throw new Error('账单日期超出范围');
    ids.add(r.id);
  });
  if (!s.settings || !Number.isSafeInteger(s.settings.budgetCents) || s.settings.budgetCents < 0 || s.settings.budgetCents > MAX_CENTS || typeof s.updatedAt !== 'string' || typeof s.lastBackupAt !== 'string') throw new Error('设置数据无效');
  if (s.settings.expenseCategoryRevision !== undefined && (!Number.isSafeInteger(s.settings.expenseCategoryRevision) || s.settings.expenseCategoryRevision < 0)) throw new Error('分类升级标记无效');
  return s;
}
function validateState(s) { validate(s, 3); return assets.validateState(s); }
function upgradeExpenseCategories(s) {
  if (s && s.version === 2) validate(s, 2); else validateState(s);
  if (s.settings.expenseCategoryRevision >= 1) return s;
  const next = JSON.parse(JSON.stringify(s));
  const ids = new Set(next.categories.map(c => c.id));
  const names = new Set(next.categories.filter(c => c.type === 'expense').map(c => c.name.trim()));
  EXTRA_EXPENSE_CATEGORIES.forEach(c => {
    // Respect existing names and the category limit without changing historical references.
    if (names.has(c.name) || names.size >= 40) return;
    let categoryId = c.id; let suffix = 1;
    while (ids.has(categoryId)) categoryId = c.id + '_' + suffix++;
    ids.add(categoryId); names.add(c.name);
    next.categories.push(Object.assign({}, c, { id: categoryId }));
  });
  // Apply this preset update once, so later user deletions and renames remain effective.
  next.settings.expenseCategoryRevision = 1;
  return next.version === 2 ? validate(next, 2) : validateState(next);
}
function migrateState(s) {
  if (s && s.version === 3) return upgradeExpenseCategories(s);
  if (s && s.version === 2) {
    const next = JSON.parse(JSON.stringify(upgradeExpenseCategories(s)));
    Object.assign(next, assets.initialFields(), { version: 3 });
    next.settings.assetAmountsHidden = false;
    return validateState(next);
  }
  validate(s, 1);
  const next = JSON.parse(JSON.stringify(s)); next.version = 2;
  next.categories.forEach(c => { c.type = 'expense'; });
  next.records.forEach(r => { r.type = 'expense'; });
  const ids = new Set(next.categories.map(c => c.id));
  INCOME_CATEGORIES.forEach(c => {
    let categoryId = c.id; let suffix = 1;
    while (ids.has(categoryId)) categoryId = c.id + '_' + suffix++;
    ids.add(categoryId); next.categories.push(Object.assign({}, c, { id: categoryId }));
  });
  return migrateState(next);
}
function net(r) { return r.type === 'income' ? r.amountCents : r.amountCents - r.refundCents; }
function summarize(records) {
  const s = { incomeCents: 0, expenseCents: 0, grossExpenseCents: 0, refundCents: 0, incomeCount: 0, expenseCount: 0 };
  records.forEach(r => {
    if (r.type === 'income') { s.incomeCents += r.amountCents; s.incomeCount++; }
    else { s.expenseCents += net(r); s.grossExpenseCents += r.amountCents; s.refundCents += r.refundCents; s.expenseCount++; }
  });
  s.balanceCents = s.incomeCents - s.expenseCents;
  s.incomeText = money(s.incomeCents); s.expenseText = money(s.expenseCents); s.balanceText = money(s.balanceCents);
  return s;
}
// A total always describes one direction; mixed views use summarize().
function total(records, type = 'expense') {
  if (!TYPES.includes(type)) throw new Error('收支类型无效');
  return records.filter(r => r.type === type).reduce((sum, r) => sum + net(r), 0);
}
function filterRecords(state, filter) {
  const f = filter || {}; const query = String(f.query || '').trim().toLowerCase();
  const cats = {}; state.categories.forEach(c => { cats[c.id] = c; });
  return state.records.filter(r => (!f.type || r.type === f.type) && (!f.start || r.date >= f.start) && (!f.end || r.date <= f.end) && (!f.categoryId || r.categoryId === f.categoryId) && (!f.payment || r.payment === f.payment) && (!query || (r.note + ' ' + cats[r.categoryId].name).toLowerCase().includes(query)))
    .sort((a, b) => (b.date + ' ' + b.time).localeCompare(a.date + ' ' + a.time) || b.createdAt - a.createdAt);
}
function decorate(state, r) {
  const c = state.categories.find(c => c.id === r.categoryId); const cents = net(r);
  return Object.assign({}, r, { categoryName: c.name, icon: c.icon, color: c.color, typeName: r.type === 'income' ? '收入' : '支出', sign: cents ? (r.type === 'income' ? '+' : '−') : '', amountText: money(cents), originalText: money(r.amountCents), refundText: money(r.refundCents) });
}
function groups(state, records, fullRecords, type) {
  const days = {};
  (fullRecords || records).forEach(r => { if (!days[r.date]) days[r.date] = []; days[r.date].push(r); });
  const summaries = {}; Object.keys(days).forEach(day => { summaries[day] = summarize(days[day]); });
  const result = [];
  records.forEach(r => {
    let g = result[result.length - 1];
    if (!g || g.date !== r.date) {
      const s = summaries[r.date];
      const text = type === 'income' ? '收入 ¥' + s.incomeText : type === 'expense' ? '支出 ¥' + s.expenseText : '收入 ¥' + s.incomeText + ' · 支出 ¥' + s.expenseText;
      g = Object.assign({ date: r.date, records: [], summaryText: text }, s); result.push(g);
    }
    g.records.push(decorate(state, r));
  });
  return result;
}
function statistics(state, mode, anchor, today, type = 'expense') {
  if (!TYPES.includes(type)) throw new Error('收支类型无效');
  const bounds = dates.range(mode, anchor); const all = filterRecords(state, bounds);
  const records = all.filter(r => r.type === type); const sum = total(records, type); const summary = summarize(all);
  const gross = records.reduce((s, r) => s + r.amountCents, 0); const refunded = gross - sum;
  const effectiveEnd = bounds.end > today ? today : bounds.end;
  const days = effectiveEnd < bounds.start ? 1 : dates.dayCount(bounds.start, effectiveEnd);
  const categories = state.categories.filter(c => c.type === type).map(c => {
    const cents = total(records.filter(r => r.categoryId === c.id), type);
    return Object.assign({}, c, { cents, amountText: money(cents), percent: sum ? (cents / sum * 100).toFixed(1) : '0.0', width: sum ? Math.round(cents / sum * 100) : 0 });
  }).filter(c => c.cents > 0).sort((a, b) => b.cents - a.cents);
  const bars = [];
  if (mode === 'year') {
    for (let i = 1; i <= 12; i++) {
      const month = anchor.slice(0, 4) + '-' + String(i).padStart(2, '0'); const r = dates.range('month', month + '-01');
      bars.push({ label: i + '月', cents: total(records.filter(r => r.date.slice(0, 7) === month), type), start: r.start, end: r.end });
    }
  } else {
    for (let value = bounds.start; value <= bounds.end; value = dates.shiftDays(value, 1)) {
      bars.push({ label: mode === 'week' ? ['日', '一', '二', '三', '四', '五', '六'][dates.parseDate(value).getDay()] : String(Number(value.slice(8))), cents: total(records.filter(r => r.date === value), type), start: value, end: value });
      if (value === bounds.end) break;
    }
  }
  const peak = Math.max(1, ...bars.map(b => b.cents));
  bars.forEach(b => { b.height = b.cents ? Math.max(3, Math.round(b.cents / peak * 100)) : 0; b.amountText = money(b.cents); });
  const top = records.slice().sort((a, b) => net(b) - net(a)).slice(0, 3).map(r => decorate(state, r));
  return { type, summary, start: bounds.start, end: bounds.end, label: dates.periodLabel(mode, anchor), totalText: money(sum), grossText: money(gross), refundText: money(refunded), refundCents: refunded, count: records.length, averageText: money(Math.round(sum / days)), maxText: top.length ? top[0].amountText : '0.00', days, categories, bars, peakText: money(!sum ? 0 : peak), top };
}
function createRecord(state, input, previous) {
  const now = Date.now(); const type = input.type;
  if (!TYPES.includes(type)) throw new Error('请选择收入或支出');
  if (previous && previous.type !== type && previous.refundCents) throw new Error('这笔支出已有退款，请先处理原退款再修改类型');
  dates.parseDate(input.date);
  if (input.date < '2000-01-01' || input.date > dates.dateKey(new Date())) throw new Error('请选择 2000 年起至今天的日期');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error('时间格式无效');
  if (!state.categories.some(c => c.id === input.categoryId && c.type === type)) throw new Error('请选择对应收支类型的有效分类');
  if (!PAYMENTS.includes(input.payment)) throw new Error('收支方式无效');
  const note = String(input.note || '').trim(); if (note.length > 100) throw new Error('备注最多 100 字');
  const amountCents = amountToCents(input.amount); const refundCents = amountToCents(input.refund || '0', true);
  if (type === 'income' && refundCents) throw new Error('收入不能登记退款');
  if (refundCents > amountCents) throw new Error('退款不能超过原支出金额');
  return { id: previous ? previous.id : id('bill'), type, categoryId: input.categoryId, amountCents, refundCents, payment: input.payment, date: input.date, time: input.time, note, createdAt: previous ? previous.createdAt : now, updatedAt: now };
}
function csv(state, records) {
  const cell = v => { let s = String(v); if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const rows = [['日期', '时间', '收支类型', '分类', '原始金额（元）', '退款金额（元）', '有效金额（元）', '收支方式', '备注']];
  (records || filterRecords(state)).forEach(r => { const c = state.categories.find(c => c.id === r.categoryId); rows.push([r.date, r.time, r.type === 'income' ? '收入' : '支出', c.name, money(r.amountCents), r.type === 'income' ? '' : money(r.refundCents), money(net(r)), r.payment, r.note]); });
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
module.exports = { TYPES, PAYMENTS, COLORS, DEFAULT_CATEGORIES, INCOME_CATEGORIES, freshState, amountToCents, money, id, validateState, upgradeExpenseCategories, migrateState, net, summarize, total, filterRecords, decorate, groups, statistics, createRecord, csv };
