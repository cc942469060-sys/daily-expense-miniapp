const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const core = require('../miniprogram/utils/core');
const store = require('../miniprogram/utils/store');
const clone = value => value === undefined ? '' : JSON.parse(JSON.stringify(value));
let db; let navigation;
function record(id, date, amountCents, extra) {
  return Object.assign({ id, date, amountCents, type: 'expense', categoryId: 'food', refundCents: 0, time: '12:00', payment: '微信', note: '午饭', createdAt: 1, updatedAt: 1 }, extra);
}
function state(records) { const s = core.freshState(); s.records = records; return s; }
function page(name) {
  let config; global.Page = value => { config = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/' + name + '.js'); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(value) { Object.assign(this.data, value); } };
  for (const [key, value] of Object.entries(config)) if (typeof value === 'function') p[key] = value.bind(p);
  return p;
}
function bills(records, filter = {}) { db.set(store.KEY, state(records)); const p = page('bills'); p.onLoad(filter); p.onShow(); return p; }
function sort(p, index) { p.sortChange({ detail: { value: String(index) } }); }
function visible(p) { return p.data.groups.flatMap(g => g.records); }
function ids(records) { return records.map(r => r.id); }
test.beforeEach(() => {
  db = new Map(); navigation = [];
  global.wx = { getStorageSync: key => clone(db.get(key)), setStorageSync: (key, value) => db.set(key, clone(value)), navigateTo: options => navigation.push(options.url), showModal: () => {}, showToast: () => {} };
  require('./helpers/storage-io').installStorageIO(wx, db);
});

test('金额排序跨日期按净支出排序，包含全额退款，原记录和默认时间顺序不变', () => {
  const s = state([
    record('old-large', '2024-01-01', 90000), record('new-small', '2026-10-01', 100),
    record('refunded', '2025-01-01', 100000, { refundCents: 99000 }),
    record('zero', '2025-06-01', 5000, { refundCents: 5000 })
  ]);
  const before = JSON.stringify(s);
  assert.deepEqual(ids(core.filterRecords(s)), ['new-small', 'zero', 'refunded', 'old-large']);
  assert.deepEqual(ids(core.filterRecords(s, { sort: 'amount_desc' })), ['old-large', 'refunded', 'new-small', 'zero']);
  assert.deepEqual(ids(core.filterRecords(s, { sort: 'amount_asc' })), ['zero', 'new-small', 'refunded', 'old-large']);
  assert.equal(JSON.stringify(s), before);
});

test('同金额按日期、时间和创建时间倒序，完全相同时顺序稳定', () => {
  const s = state([
    record('a', '2024-01-01', 100), record('b', '2024-01-02', 100),
    record('c', '2024-01-02', 100, { time: '13:00' }),
    record('e', '2024-01-02', 100, { time: '13:00', createdAt: 2 }),
    record('d', '2024-01-02', 100, { time: '13:00', createdAt: 2 })
  ]);
  for (const order of ['amount_desc', 'amount_asc']) assert.deepEqual(ids(core.filterRecords(s, { sort: order })), ['d', 'e', 'c', 'b', 'a']);
});

test('收入和混合视图按金额大小排序，正负号和合计保留原含义', () => {
  const s = state([record('expense', '2024-01-01', 30000), record('income-big', '2024-01-02', 50000, { type: 'income', categoryId: 'income_salary' }), record('income-small', '2024-01-03', 100, { type: 'income', categoryId: 'income_salary' })]);
  const mixed = core.filterRecords(s, { sort: 'amount_desc' });
  assert.deepEqual(ids(mixed), ['income-big', 'expense', 'income-small']);
  assert.deepEqual(mixed.map(r => core.decorate(s, r).sign), ['+', '−', '+']);
  assert.deepEqual(core.summarize(mixed), core.summarize(s.records));
  assert.deepEqual(ids(core.filterRecords(s, { type: 'income', sort: 'amount_asc' })), ['income-small', 'income-big']);
});

test('从统计支出分类进入后切换排序保留日期、分类、搜索和支付方式', () => {
  const records = [record('large', '2024-02-01', 30000), record('small', '2024-02-02', 100), record('cash', '2024-02-02', 50000, { payment: '现金' }), record('other-note', '2024-02-02', 80000, { note: '早餐' }), record('other-category', '2024-02-02', 90000, { categoryId: 'shopping' }), record('outside', '2024-03-01', 99999)];
  db.set(store.KEY, state(records));
  const stats = page('stats'); stats.setData({ today: '2026-10-16', anchor: '2024-02-10' }); stats.refresh();
  stats.categoryBills({ currentTarget: { dataset: { id: 'food' } } });
  const filter = Object.fromEntries(new URL('https://example.invalid' + navigation[0]).searchParams);
  const p = page('bills'); p.onLoad(filter); p.setData({ query: '午饭', paymentIndex: core.PAYMENTS.indexOf('微信') + 1 }); p.onShow();
  const before = clone(db.get(store.KEY)); const summary = clone(p.data.summary);
  sort(p, 1);
  assert.equal(p.data.type, 'expense'); assert.equal(p.data.start, '2024-02-01'); assert.equal(p.data.end, '2024-02-29'); assert.equal(p.data.categoryId, 'food');
  assert.equal(p.data.query, '午饭'); assert.deepEqual(ids(visible(p)), ['large', 'small']);
  assert.equal(p.data.groups.length, 1); assert.equal(visible(p)[0].date, '2024-02-01');
  assert.deepEqual(p.data.summary, summary); assert.deepEqual(db.get(store.KEY), before);
  sort(p, 2); assert.deepEqual(ids(visible(p)), ['small', 'large']);
  sort(p, 0); assert.deepEqual(p.data.groups.map(g => g.date), ['2024-02-02', '2024-02-01']);
});

test('先排序全部筛选结果再分页，加载更多不重复或漏项，切换排序重置分页', () => {
  const records = Array.from({ length: 205 }, (_, i) => record('bill_' + i, '2024-01-01', i + 1, { createdAt: 205 - i }));
  const p = bills(records, { type: 'expense', categoryId: 'food' }); const summary = clone(p.data.summary);
  sort(p, 1); assert.equal(p.data.shown, 100); assert.equal(p.data.hasMore, true);
  assert.deepEqual(visible(p).map(r => r.amountCents), Array.from({ length: 100 }, (_, i) => 205 - i));
  p.more(); p.more(); assert.equal(p.data.shown, 205); assert.equal(p.data.hasMore, false);
  assert.equal(new Set(ids(visible(p))).size, 205);
  assert.deepEqual(visible(p).map(r => r.amountCents), Array.from({ length: 205 }, (_, i) => 205 - i));
  assert.deepEqual(p.data.summary, summary);
  sort(p, 2); assert.equal(p.data.limit, 100); assert.equal(p.data.shown, 100);
  assert.deepEqual(visible(p).map(r => r.amountCents), Array.from({ length: 100 }, (_, i) => i + 1));
  sort(p, 0); assert.equal(p.data.groups[0].expenseText, summary.expenseText);
});

test('编辑返回按更新金额重新排序，明细点击仍定位原账单', () => {
  const p = bills([record('a', '2024-01-01', 1000), record('b', '2024-01-02', 2000)], { type: 'expense' });
  sort(p, 1); assert.deepEqual(ids(visible(p)), ['b', 'a']);
  p.select({ detail: { id: visible(p)[0].id } }); assert.match(navigation.at(-1), /id=b$/);
  const s = clone(db.get(store.KEY)); s.records[0].amountCents = 3000; db.set(store.KEY, s); p.onShow();
  assert.equal(p.data.sortIndex, 1); assert.deepEqual(ids(visible(p)), ['a', 'b']); assert.equal(p.data.totalText, '50.00');
  s.records = [s.records[1]]; db.set(store.KEY, s); p.onShow(); assert.deepEqual(ids(visible(p)), ['b']);
});

test('筛选保留排序，重置恢复时间排序，新开页面仍默认时间排序', () => {
  const p = bills([record('a', '2024-01-01', 200), record('b', '2024-02-01', 100), record('income', '2024-01-01', 500, { type: 'income', categoryId: 'income_salary' })]);
  sort(p, 1);
  p.dateChange({ currentTarget: { dataset: { field: 'end' } }, detail: { value: '2024-01-31' } });
  assert.equal(p.data.sortIndex, 1); assert.deepEqual(ids(visible(p)), ['income', 'a']);
  p.typeChange({ currentTarget: { dataset: { type: 'income' } } });
  assert.equal(p.data.sortIndex, 1); assert.deepEqual(ids(visible(p)), ['income']);
  p.clear(); assert.equal(p.data.sortIndex, 0); assert.equal(p.data.end, ''); assert.equal(p.data.type, '');
  assert.equal(visible(p)[0].id, 'b');
  sort(p, 2); const another = page('bills'); another.onLoad({}); another.onShow(); assert.equal(another.data.sortIndex, 0);
});

test('空结果金额排序显示空列表，无效排序选择不改变当前状态', () => {
  const p = bills([]); sort(p, 1); assert.deepEqual(p.data.groups, []); assert.equal(p.data.count, 0); assert.equal(p.data.storageError, '');
  for (const index of [-1, 3, 1.5, 'bad']) sort(p, index);
  assert.equal(p.data.sortIndex, 1); assert.equal(p.data.hasMore, false);
  sort(p, 2); assert.deepEqual(p.data.groups, []); assert.equal(p.data.totalText, '0.00');
});
