const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/utils/core');
const store = require('../miniprogram/utils/store');
let db; let navigation;
const clone = value => value === undefined ? '' : JSON.parse(JSON.stringify(value));
function record(id, date, extra) {
  return Object.assign({ id, date, type: 'expense', categoryId: 'food', amountCents: 100, refundCents: 0, time: '12:00', payment: '微信', note: '', createdAt: 1, updatedAt: 1 }, extra);
}
function home(records) {
  const s = core.freshState(); s.records = records; s.settings.budgetCents = 10000; db.set(store.KEY, s);
  let config; global.Page = value => { config = value; };
  const file = require.resolve('../miniprogram/pages/home/home'); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(value) { Object.assign(this.data, value); } };
  for (const [key, value] of Object.entries(config)) if (typeof value === 'function') p[key] = value.bind(p);
  p.onShow(); return p;
}
function visible(p) { return p.data.groups.flatMap(g => g.records); }
test.beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 18, 12) });
  db = new Map(); navigation = [];
  global.wx = { getStorageSync: key => clone(db.get(key)), setStorageSync: (key, value) => db.set(key, clone(value)), navigateTo: options => navigation.push(options.url) };
  require('./helpers/storage-io').installStorageIO(wx, db);
});

test('近30天包含今天和第30天，排除更早及未来记录，不再限制8笔', () => {
  const records = Array.from({ length: 12 }, (_, i) => record('today_' + i, '2026-10-18', { createdAt: i }));
  records.push(record('boundary', '2026-09-19'), record('old', '2026-09-18'), record('future', '2026-10-19'));
  const p = home(records);
  assert.equal(p.data.recentStart, '2026-09-19'); assert.equal(p.data.recentCount, 13);
  assert.equal(visible(p).length, 13); assert.equal(visible(p)[0].id, 'today_11');
  assert.equal(visible(p).at(-1).id, 'boundary'); assert.equal(p.data.recentHasMore, false);
  assert.equal(p.data.count, 12); assert.equal(p.data.todayText, '12.00');
  assert.equal(db.get(store.KEY).records.length, 15);
});

test('超过100笔可加载完全部近30天记录，日期小计和首页汇总不随分页改变', () => {
  const records = Array.from({ length: 205 }, (_, i) => record('r_' + i, '2026-10-18', i % 2 ? { type: 'income', categoryId: 'income_salary', amountCents: 200, createdAt: i } : { refundCents: 20, createdAt: i }));
  const p = home(records); const before = clone(db.get(store.KEY));
  assert.equal(p.data.recentShown, 100); assert.equal(p.data.recentHasMore, true);
  assert.equal(p.data.groups[0].incomeText, '204.00'); assert.equal(p.data.groups[0].expenseText, '82.40');
  const summary = clone(p.data.monthSummary); const budgetPercent = p.data.budgetPercent;
  p.moreRecent(); assert.equal(p.data.recentShown, 200); p.moreRecent();
  assert.equal(p.data.recentShown, 205); assert.equal(p.data.recentHasMore, false);
  assert.equal(new Set(visible(p).map(r => r.id)).size, 205);
  assert.deepEqual(p.data.monthSummary, summary); assert.equal(p.data.budgetPercent, budgetPercent);
  p.moreRecent(); assert.equal(p.data.recentLimit, 300); assert.deepEqual(db.get(store.KEY), before);
});

test('跨年及闰年按30个自然日计算', t => {
  t.mock.timers.setTime(new Date(2026, 0, 10, 12).getTime());
  const year = home([record('start', '2025-12-12'), record('old', '2025-12-11'), record('end', '2026-01-10')]);
  assert.equal(year.data.recentStart, '2025-12-12'); assert.equal(year.data.recentCount, 2);
  t.mock.timers.setTime(new Date(2024, 2, 1, 12).getTime());
  const leap = home([record('start', '2024-02-01'), record('leap', '2024-02-29'), record('end', '2024-03-01'), record('old', '2024-01-31')]);
  assert.equal(leap.data.recentStart, '2024-02-01'); assert.equal(leap.data.recentCount, 3);
});

test('跨天返回首页刷新范围，编辑返回更新记录，全部账单入口仍可访问旧记录', t => {
  const p = home([record('boundary', '2026-09-19'), record('kept', '2026-10-18')]);
  t.mock.timers.setTime(new Date(2026, 9, 19, 12).getTime()); p.onShow();
  assert.equal(p.data.recentStart, '2026-09-20'); assert.deepEqual(visible(p).map(r => r.id), ['kept']);
  const s = clone(db.get(store.KEY)); s.records[1].amountCents = 999; db.set(store.KEY, s); p.onShow();
  assert.equal(visible(p)[0].amountText, '9.99'); p.select({ detail: { id: 'kept' } }); assert.match(navigation.pop(), /id=kept$/);
  p.allBills(); assert.equal(navigation.pop(), '/pages/bills/bills');
});

test('仅有旧账单或空账本时首页近30天为空，旧数据仍保留', () => {
  const p = home([record('old', '2024-01-01')]);
  assert.deepEqual(p.data.groups, []); assert.equal(p.data.recentCount, 0); assert.equal(p.data.recentShown, 0);
  assert.equal(p.data.recentHasMore, false); assert.equal(db.get(store.KEY).records.length, 1);
  const empty = home([]); assert.deepEqual(empty.data.groups, []); assert.equal(empty.data.storageError, '');
});

test('刷新读取失败时不残留旧记录或加载按钮，保留恢复入口', () => {
  const p = home([record('today', '2026-10-18')]); db.set(store.KEY, { broken: true }); p.onShow();
  assert.ok(p.data.storageError); assert.deepEqual(p.data.groups, []); assert.equal(p.data.recentHasMore, false);
  p.backup(); assert.equal(navigation.pop(), '/pages/backup/backup');
});
