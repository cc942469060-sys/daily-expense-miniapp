const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/utils/core');
const dates = require('../miniprogram/utils/date');

function record(date, amountCents, extra) {
  return Object.assign({ id: core.id('bill'), type: 'expense', categoryId: 'food', amountCents, refundCents: 0, date, time: '12:00', payment: '未指定', note: '', createdAt: 1, updatedAt: 1 }, extra);
}
function state(records = []) { const s = core.freshState(); s.records = records; return s; }
function custom(s, start, end, type = 'expense', today = '2026-10-11') {
  return core.statistics(s, 'custom', today, today, type, { start, end });
}
function assertTotalsMatch(s, stats) {
  assert.equal(stats.bars.reduce((sum, b) => sum + b.cents, 0), core.amountToCents(stats.totalText, true));
  assert.equal(stats.categories.reduce((sum, c) => sum + c.cents, 0), core.amountToCents(stats.totalText, true));
  for (const bar of stats.bars) {
    assert.ok(bar.start >= stats.start && bar.end <= stats.end);
    assert.equal(core.total(core.filterRecords(s, { type: stats.type, start: bar.start, end: bar.end }), stats.type), bar.cents);
  }
}

test('2024—2026 跨年范围包含首尾当天，收支、退款、分类和趋势一致', () => {
  const s = state([
    record('2024-08-02', 99999), record('2024-08-03', 10000, { refundCents: 2000 }),
    record('2024-12-31', 12000, { type: 'income', categoryId: 'income_salary' }),
    record('2025-06-01', 20000, { categoryId: 'shopping' }),
    record('2026-10-11', 5000), record('2026-10-11', 6000, { type: 'income', categoryId: 'income_other' }),
    record('2026-10-12', 99999)
  ]);
  const expense = custom(s, '2024-08-03', '2026-10-11');
  const income = custom(s, '2024-08-03', '2026-10-11', 'income');
  assert.equal(expense.totalText, '330.00'); assert.equal(expense.refundText, '20.00');
  assert.equal(expense.count, 3); assert.equal(income.count, 2); assert.equal(income.totalText, '180.00');
  assert.equal(expense.summary.balanceText, '-150.00'); assert.deepEqual(expense.summary, income.summary);
  assert.equal(expense.categories[0].name, '购物'); assert.equal(expense.top[0].amountText, '200.00');
  assert.equal(expense.granularity, 'year');
  assert.deepEqual(expense.bars.map(b => [b.label, b.start, b.end, b.cents]), [
    ['2024年', '2024-08-03', '2024-12-31', 8000],
    ['2025年', '2025-01-01', '2025-12-31', 20000],
    ['2026年', '2026-01-01', '2026-10-11', 5000]
  ]);
  assertTotalsMatch(s, expense); assertTotalsMatch(s, income);
});

test('全部模式从首笔账单至今天，切换收支不会缩短时间范围', () => {
  const s = state([
    record('2026-05-01', 800), record('2024-08-03', 2000, { type: 'income', categoryId: 'income_salary' }),
    record('2025-12-01', 1200, { refundCents: 1200 })
  ]);
  const before = JSON.stringify(s);
  for (const type of core.TYPES) {
    const stats = core.statistics(s, 'all', '2026-10-11', '2026-10-11', type);
    assert.equal(stats.start, '2024-08-03'); assert.equal(stats.end, '2026-10-11');
    assert.equal(stats.days, dates.dayCount('2024-08-03', '2026-10-11'));
    assert.equal(stats.summary.incomeText, '20.00'); assert.equal(stats.summary.expenseText, '8.00');
    assertTotalsMatch(s, stats);
  }
  assert.equal(JSON.stringify(s), before);
});

test('自定义两年范围按月汇总，跨年的月份标签明确且首尾明细不越界', () => {
  const s = state([record('2024-11-19', 999), record('2024-11-20', 100), record('2025-01-01', 200), record('2025-02-09', 300), record('2025-02-10', 999)]);
  const stats = custom(s, '2024-11-20', '2025-02-09');
  assert.equal(stats.granularity, 'month');
  assert.deepEqual(stats.bars.map(b => [b.label, b.start, b.end, b.cents]), [
    ['2024-11', '2024-11-20', '2024-11-30', 100], ['2024-12', '2024-12-01', '2024-12-31', 0],
    ['2025-01', '2025-01-01', '2025-01-31', 200], ['2025-02', '2025-02-01', '2025-02-09', 300]
  ]);
  assertTotalsMatch(s, stats);
});

test('较短跨年范围按日展示，包含没有账单的日期', () => {
  const s = state([record('2024-12-31', 100), record('2025-01-02', 200)]);
  const stats = custom(s, '2024-12-31', '2025-01-02');
  assert.equal(stats.granularity, 'day'); assert.equal(stats.days, 3); assert.equal(stats.averageText, '1.00');
  assert.deepEqual(stats.bars.map(b => [b.label, b.cents]), [['12/31', 100], ['01/01', 0], ['01/02', 200]]);
  assertTotalsMatch(s, stats);
});

test('自定义日均包含闰日和无支出日期，单日也可正常统计', () => {
  const s = state([record('2024-02-29', 300), record('2024-03-01', 600)]);
  const stats = custom(s, '2024-02-28', '2024-03-01');
  assert.equal(stats.days, 3); assert.equal(stats.averageText, '3.00');
  const single = custom(s, '2024-02-29', '2024-02-29');
  assert.equal(single.days, 1); assert.equal(single.bars.length, 1); assert.equal(single.totalText, '3.00');
});

test('趋势粒度在 62 天、24 个月边界切换', () => {
  const s = state();
  assert.equal(custom(s, '2024-01-01', '2024-03-02').granularity, 'day');
  assert.equal(custom(s, '2024-01-01', '2024-03-02').bars.length, 62);
  assert.equal(custom(s, '2024-01-01', '2024-03-03').granularity, 'month');
  assert.equal(custom(s, '2024-01-01', '2025-12-31').bars.length, 24);
  assert.equal(custom(s, '2024-01-01', '2026-01-01').granularity, 'year');
});

test('全部和自定义的空账本、仅收入及全额退款保持稳定零值', () => {
  const s = state();
  const empty = core.statistics(s, 'all', '', '2026-10-11');
  assert.equal(empty.start, '2026-10-11'); assert.equal(empty.end, '2026-10-11');
  assert.equal(empty.totalText, '0.00'); assert.equal(empty.averageText, '0.00'); assert.equal(empty.days, 1);
  assert.equal(empty.bars.length, 1); assert.deepEqual(empty.categories, []);
  s.records = [record('2024-02-29', 100, { refundCents: 100 }), record('2025-01-01', 200, { type: 'income', categoryId: 'income_salary' })];
  const stats = custom(s, '2024-01-01', '2026-10-11');
  assert.equal(stats.totalText, '0.00'); assert.equal(stats.count, 1); assert.equal(stats.refundText, '1.00');
  assert.equal(stats.peakText, '0.00'); assert.ok(stats.bars.every(b => b.height === 0));
  assertTotalsMatch(s, stats);
});

test('自定义拒绝缺少日期、无效日期、倒序、过早和未来范围', () => {
  const s = state();
  assert.throws(() => core.statistics(s, 'custom', '', '2026-10-11'), /日期格式/);
  for (const [start, end] of [['2024-02-30', '2024-03-01'], ['2024-03-01', '2024-02-29'], ['1999-12-31', '2024-01-01'], ['2024-01-01', '2026-10-12']]) {
    assert.throws(() => custom(s, start, end));
  }
});

test('全部模式在设备日期回退时仍包含已保存的较晚账单', () => {
  const s = state([record('2024-01-01', 100), record('2026-10-11', 200)]);
  const stats = core.statistics(s, 'all', '', '2026-10-10');
  assert.equal(stats.end, '2026-10-11'); assert.equal(stats.totalText, '3.00');
  assertTotalsMatch(s, stats);
});

test('大量多年账单按年汇总，金额完整且不生成数万个每日柱子', () => {
  const s = state(Array.from({ length: 50000 }, (_, i) => record(String(2000 + i % 101) + '-01-01', 1, { id: 'bill_' + i })));
  const stats = core.statistics(s, 'all', '', '2100-12-31');
  assert.equal(stats.count, 50000); assert.equal(stats.totalText, '500.00');
  assert.equal(stats.granularity, 'year'); assert.equal(stats.bars.length, 101);
  assert.equal(stats.bars.reduce((sum, b) => sum + b.cents, 0), 50000);
});
