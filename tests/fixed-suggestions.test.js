const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path');
const core = require('../miniprogram/utils/core'); const fixed = require('../miniprogram/utils/fixed');
const store = require('../miniprogram/utils/store'); const { applySetData } = require('./helpers/set-data');
let db; let navigation; let n = 0;
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
function page(name) {
  let config; global.Page = value => { config = value; };
  const file = path.resolve(__dirname, `../miniprogram/pages/${name}/${name}.js`); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(value) { applySetData(this.data, value); } };
  for (const [k, v] of Object.entries(config)) if (typeof v === 'function') p[k] = v.bind(p);
  return p;
}
function bill(date, amountCents, note, extra) { return Object.assign({ id: 'b' + n++, type: 'expense', categoryId: 'home', amountCents, refundCents: 0, payment: '银行卡', date, time: '08:00', note, createdAt: n, updatedAt: n }, extra); }
function seed(records) { const s = core.freshState(); s.records = records; db.set(store.KEY, s); return s; }
const monthly = (note, amounts, day = 25, months = ['2026-07', '2026-08', '2026-09', '2026-10']) => months.map((m, i) => bill(`${m}-${String(day + (i % 2)).padStart(2, '0')}`, amounts[i % amounts.length], note));
test.beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 26, 9) });
  db = new Map(); navigation = [];
  global.wx = { getStorageSync: key => clone(db.get(key)), setStorageSync: (key, v) => db.set(key, clone(v)), showToast: () => {}, navigateBack: () => {}, navigateTo: o => navigation.push(o.url), setNavigationBarTitle: () => {}, pageScrollTo: () => {}, showModal: o => o.success && o.success({ confirm: true }) };
  require('./helpers/storage-io').installStorageIO(wx, db);
});

test('每月一次、日期和金额相近的支出被推荐；金额有变化时标记为会变', () => {
  const s = seed(monthly('房贷', [200000]).concat(monthly('电费', [15000, 21000], 10)));
  const list = fixed.suggestions(s, '2026-11-26');
  assert.deepEqual(list.map(i => [i.name, i.variable, i.day, i.months]), [['电费', true, 11, 4], ['房贷', false, 26, 4]].sort((a, b) => a[2] - b[2]));
  assert.equal(list.find(i => i.name === '房贷').amountText, '2,000.00'); assert.equal(list.find(i => i.name === '电费').rangeText, '150.00—210.00');
});

test('不推荐：少于 3 个月、一个月多笔、日期分散、金额差太大、超过 6 个月前、已有模板或已关联', () => {
  const records = [].concat(
    monthly('网费', [10000], 5, ['2026-09', '2026-10']),
    monthly('午饭', [2000], 12), [bill('2026-08-14', 2000, '午饭')],
    ['2026-07-02', '2026-08-15', '2026-09-28'].map(d => bill(d, 5000, '理发')),
    monthly('物业', [10000, 40000], 3),
    monthly('旧会员', [1500], 8, ['2025-12', '2026-01', '2026-02', '2026-03']),
    monthly('话费', [5800], 18),
    monthly('保险', [30000], 20).map(r => Object.assign(r, { fixedId: 'fixed_x' })));
  const s = seed(records); s.fixedExpenses = [{ id: 'fixed_x', name: '话费', categoryId: 'home', amountCents: 5800, variable: false, day: 18, payment: '微信', note: '', endMonth: '', createdAt: 1, updatedAt: 1 }];
  assert.deepEqual(fixed.suggestions(s, '2026-11-26'), []);
});

test('采纳推荐：表单预填，保存后历史账单关联模板，本月已记不重复，推荐消失', () => {
  seed(monthly('房贷', [200000], 25, ['2026-08', '2026-09', '2026-10', '2026-11']));
  const p = page('fixed'); p.onLoad({}); p.onShow(); assert.equal(p.data.suggestions.length, 1);
  p.adopt({ currentTarget: { dataset: { key: p.data.suggestions[0].key } } });
  assert.equal(p.data.name, '房贷'); assert.equal(p.data.amount, '2000.00'); assert.equal(p.data.variable, false); assert.equal(p.data.categories[p.data.categoryIndex].id, 'home');
  p.save(); const s = store.read();
  assert.equal(s.fixedExpenses.length, 1); assert.ok(s.records.every(r => r.fixedId === s.fixedExpenses[0].id));
  assert.equal(p.data.suggestions.length, 0);
  assert.equal(fixed.plan(s, '2026-11-26').items[0].status, 'done');
});

test('忽略推荐后不再出现，账本本身不变', () => {
  seed(monthly('房贷', [200000])); const before = clone(db.get(store.KEY));
  const home = page('home'); home.onShow(); assert.equal(home.data.fixedSuggestions, 1);
  const p = page('fixed'); p.onLoad({}); p.onShow(); p.dismiss({ currentTarget: { dataset: { key: p.data.suggestions[0].key } } });
  assert.equal(p.data.suggestions.length, 0); home.onShow(); assert.equal(home.data.fixedSuggestions, 0);
  assert.deepEqual(db.get(store.KEY), before);
});

test('统计页拆分固定与日常支出（净额），并可进入对应明细', () => {
  const item = store.saveFixed({ name: '房贷', amount: '2000', variable: false, day: 25, categoryId: 'home', payment: '银行卡', note: '', endMonth: '' });
  store.recordFixed(item.id);
  store.saveRecord({ type: 'expense', amount: '600', refund: '0', categoryId: 'food', date: '2026-11-20', time: '12:00', payment: '微信', note: '' });
  const r = store.saveRecord({ type: 'expense', amount: '500', categoryId: 'food', date: '2026-11-21', time: '12:00', payment: '微信', note: '' });
  store.saveRecord({ type: 'expense', amount: '500', refund: '100', categoryId: 'food', date: '2026-11-21', time: '12:00', payment: '微信', note: '' }, r.id);
  store.saveRecord({ type: 'income', amount: '8000', categoryId: 'income_salary', date: '2026-11-10', time: '09:00', payment: '银行卡', note: '' });
  const stats = page('stats'); stats.onShow(); const split = stats.data.stats.fixedSplit;
  assert.equal(split.fixedText, '2,000.00'); assert.equal(split.dailyText, '1,000.00'); assert.equal(split.fixedPercent, '66.7'); assert.equal(split.dailyPercent, '33.3'); assert.equal(split.fixedCount, 1);
  stats.fixedBills({ currentTarget: { dataset: { fixed: 'fixed' } } });
  const filter = Object.fromEntries(new URL('https://x.invalid' + navigation.pop()).searchParams);
  assert.deepEqual(filter, { type: 'expense', start: '2026-11-01', end: '2026-11-30', fixed: 'fixed' });
  const bills = page('bills'); bills.onLoad(filter); bills.onShow(); assert.equal(bills.data.count, 1); assert.equal(bills.data.totalText, '2,000.00');
  const daily = page('bills'); daily.onLoad(Object.assign({}, filter, { fixed: 'daily' })); daily.onShow(); assert.equal(daily.data.count, 2); assert.equal(daily.data.totalText, '1,000.00');
  daily.clearFixed(); assert.equal(daily.data.count, 3);
  stats.typeChange({ currentTarget: { dataset: { type: 'income' } } }); assert.equal(stats.data.stats.fixedSplit, null);
});
