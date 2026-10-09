const dates = require('./date');
const KINDS = ['asset', 'liability'];
const MAX_CENTS = 99999999999;
const MAX_ACCOUNTS = 200;
const MAX_HISTORY = 20000;
const COLORS = ['#39775B', '#718EC3', '#599CA0', '#DB9D4F', '#B98BC2', '#D58075'];
const DEFAULT_CATEGORIES = [
  ['bank', '银行卡', '💳'], ['alipay', '支付宝', '💰'], ['wechat', '微信', '💬'],
  ['stock', '股票', '📈'], ['bond', '国债', '📜'], ['gold', '黄金', '🪙'],
  ['fund', '基金/理财', '📊'], ['cash', '现金', '💵'], ['other', '其他资产', '📦']
].map((c, i) => ({ id: 'asset_' + c[0], kind: 'asset', name: c[1], icon: c[2], color: COLORS[i % COLORS.length] })).concat([
  ['credit', '信用卡', '💳'], ['mortgage', '房贷', '🏠'], ['car', '车贷', '🚗'],
  ['instalment', '消费贷/分期', '🧾'], ['personal', '个人借款', '🤝'], ['other', '其他负债', '📦']
].map((c, i) => ({ id: 'debt_' + c[0], kind: 'liability', name: c[1], icon: c[2], color: COLORS[i % COLORS.length] })));
function initialFields() {
  return { assetCategories: DEFAULT_CATEGORIES.map(c => Object.assign({}, c)), accounts: [], accountValueHistory: [] };
}
function id(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }
function money(cents) { return (cents / 100).toFixed(2); }
function validId(v) { return typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v); }
function validCents(v) { return Number.isSafeInteger(v) && v >= 0 && v <= MAX_CENTS; }
function timestamp(v) { return Number.isSafeInteger(v) && v >= 0; }
function checkDate(value) {
  dates.parseDate(value);
  if (value < '2000-01-01' || value > dates.dateKey(new Date())) throw new Error('金额日期须在 2000 年起至今天之间');
}
function amountToCents(value) {
  const raw = String(value).trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw)) throw new Error('请输入 0—999,999,999.99 元的金额，最多两位小数');
  const parts = raw.split('.');
  const cents = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
  if (!validCents(cents)) throw new Error('账户金额超出支持范围');
  return cents;
}
function validateState(s) {
  if (!Array.isArray(s.assetCategories) || !Array.isArray(s.accounts) || !Array.isArray(s.accountValueHistory) || s.accounts.length > MAX_ACCOUNTS || s.accountValueHistory.length > MAX_HISTORY) throw new Error('资产账户或历史数量无效');
  if (!s.settings || typeof s.settings.assetAmountsHidden !== 'boolean') throw new Error('资产显示设置无效');
  const cats = new Map(); const names = new Set();
  s.assetCategories.forEach(c => {
    if (!c || !validId(c.id) || cats.has(c.id) || !KINDS.includes(c.kind) || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 8 || typeof c.icon !== 'string' || !c.icon || c.icon.length > 10 || !/^#[a-fA-F0-9]{6}$/.test(c.color)) throw new Error('资产分类数据无效');
    const key = c.kind + ':' + c.name.trim();
    if (names.has(key)) throw new Error('资产分类名称重复');
    cats.set(c.id, c); names.add(key);
  });
  KINDS.forEach(kind => { const n = s.assetCategories.filter(c => c.kind === kind).length; if (n < 1 || n > 40) throw new Error('资产和负债各须保留 1—40 个分类'); });
  const accounts = new Map();
  s.accounts.forEach(a => {
    const c = a && cats.get(a.categoryId);
    if (!a || !validId(a.id) || accounts.has(a.id) || !KINDS.includes(a.kind) || !c || c.kind !== a.kind || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 24 || !validCents(a.amountCents) || typeof a.note !== 'string' || a.note.length > 200 || typeof a.cardLast4 !== 'string' || !/^(\d{4})?$/.test(a.cardLast4) || !timestamp(a.createdAt) || !timestamp(a.updatedAt) || a.updatedAt < a.createdAt || !(a.archivedAt === null || timestamp(a.archivedAt))) throw new Error('资产账户数据无效');
    if (a.archivedAt !== null && (a.amountCents !== 0 || a.archivedAt < a.createdAt || a.archivedAt > a.updatedAt)) throw new Error('归档账户必须为零余额且归档时间有效');
    checkDate(a.valuedOn); accounts.set(a.id, a);
  });
  const latest = new Map(); const ids = new Set();
  s.accountValueHistory.forEach(h => {
    const a = h && accounts.get(h.accountId); const prev = h && latest.get(h.accountId);
    if (!h || !a || !validId(h.id) || ids.has(h.id) || !validCents(h.amountCents) || !timestamp(h.recordedAt) || h.recordedAt < a.createdAt || h.recordedAt > a.updatedAt || typeof h.note !== 'string' || h.note.length > 200) throw new Error('资产金额历史无效');
    checkDate(h.valuedOn);
    if (!prev) {
      if (h.reason !== 'opening' || h.previousCents !== null || h.recordedAt !== a.createdAt) throw new Error('账户缺少有效的初始金额');
    } else if (h.reason !== 'manual_update' || h.previousCents !== prev.amountCents || h.valuedOn < prev.valuedOn || h.recordedAt < prev.recordedAt) throw new Error('资产金额历史不连续');
    ids.add(h.id); latest.set(a.id, h);
  });
  s.accounts.forEach(a => { const h = latest.get(a.id); if (!h || h.amountCents !== a.amountCents || h.valuedOn !== a.valuedOn) throw new Error('账户金额与最新历史不一致'); });
  return s;
}
function accountInfo(state, input, previous) {
  const kind = previous ? previous.kind : input.kind;
  if (!KINDS.includes(kind) || (previous && input.kind !== kind)) throw new Error('账户的资产或负债类型不能更改');
  if (!state.assetCategories.some(c => c.id === input.categoryId && c.kind === kind)) throw new Error('请选择对应类型的资产分类');
  const name = String(input.name || '').trim(); const note = String(input.note || '').trim(); const cardLast4 = String(input.cardLast4 || '').trim();
  if (!name || name.length > 24) throw new Error('账户名称须为 1—24 个字');
  if (note.length > 200) throw new Error('备注最多 200 字');
  if (!/^(\d{4})?$/.test(cardLast4)) throw new Error('卡号尾号须为 4 位数字，也可以不填');
  return { kind, categoryId: input.categoryId, name, note, cardLast4 };
}
function createAccount(state, input) {
  if (state.accounts.length >= MAX_ACCOUNTS) throw new Error('最多支持 200 个账户（含归档账户）');
  const info = accountInfo(state, input); checkDate(input.valuedOn);
  const now = Date.now();
  return Object.assign(info, { id: id('account'), amountCents: amountToCents(input.amount), valuedOn: input.valuedOn, archivedAt: null, createdAt: now, updatedAt: now });
}
function valueEntry(account, input, opening) {
  checkDate(input.valuedOn);
  if (!opening && input.valuedOn < account.valuedOn) throw new Error('金额日期不能早于上次更新日期');
  const note = String(input.note || '').trim(); if (note.length > 200) throw new Error('备注最多 200 字');
  return { id: id('value'), accountId: account.id, previousCents: opening ? null : account.amountCents, amountCents: amountToCents(input.amount), valuedOn: input.valuedOn, recordedAt: opening ? account.createdAt : Math.max(Date.now(), account.updatedAt), reason: opening ? 'opening' : 'manual_update', note };
}
function summary(s) {
  const active = s.accounts.filter(a => a.archivedAt === null);
  const assetCents = active.filter(a => a.kind === 'asset').reduce((n, a) => n + a.amountCents, 0);
  const liabilityCents = active.filter(a => a.kind === 'liability').reduce((n, a) => n + a.amountCents, 0);
  return { assetCents, liabilityCents, netCents: assetCents - liabilityCents };
}
function valueLabel(kind, categoryId) { return kind === 'liability' ? '当前欠款' : ['asset_stock', 'asset_gold', 'asset_fund', 'asset_bond'].includes(categoryId) ? '当前市值／估值' : '当前余额'; }
function displayAccount(s, a) {
  const c = s.assetCategories.find(c => c.id === a.categoryId);
  return { id: a.id, kind: a.kind, categoryId: a.categoryId, name: a.name, note: a.note, cardLast4: a.cardLast4, valuedOn: a.valuedOn, archived: a.archivedAt !== null, icon: c.icon, color: c.color, categoryName: c.name, amountText: s.settings.assetAmountsHidden ? '••••' : money(a.amountCents), stale: a.archivedAt === null && dates.dayCount(a.valuedOn, dates.dateKey(new Date())) > 31 };
}
function csv(s) {
  const cell = v => { let str = String(v); if (/^[\s]*[=+\-@\t\r]/.test(str)) str = "'" + str; return '"' + str.replace(/"/g, '""') + '"'; };
  const rows = [['类型', '分类', '账户名称', '当前金额（元）', '金额日期', '状态', '卡号尾号', '备注']];
  s.accounts.forEach(a => rows.push([a.kind === 'asset' ? '资产' : '负债', s.assetCategories.find(c => c.id === a.categoryId).name, a.name, money(a.amountCents), a.valuedOn, a.archivedAt === null ? '使用中' : '已归档', a.cardLast4, a.note]));
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
module.exports = { KINDS, COLORS, MAX_CENTS, MAX_ACCOUNTS, MAX_HISTORY, DEFAULT_CATEGORIES, initialFields, validateState, amountToCents, money, id, accountInfo, createAccount, valueEntry, summary, valueLabel, displayAccount, csv };
