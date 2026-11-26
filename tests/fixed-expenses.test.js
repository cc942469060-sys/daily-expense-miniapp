const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path');
const core = require('../miniprogram/utils/core'); const fixed = require('../miniprogram/utils/fixed');
const store = require('../miniprogram/utils/store'); const { applySetData } = require('./helpers/set-data');
let db; let navigation; let modals;
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
function page(name) {
  let config; global.Page = value => { config = value; };
  const file = path.resolve(__dirname, `../miniprogram/pages/${name}/${name}.js`); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(value) { applySetData(this.data, value); } };
  for (const [k, v] of Object.entries(config)) if (typeof v === 'function') p[k] = v.bind(p);
  return p;
}
const tap = id => ({ currentTarget: { dataset: { id } } });
const mortgage = { name: '房贷', amount: '2000', variable: false, day: 25, categoryId: 'home', payment: '银行卡', note: '', endMonth: '' };
const power = { name: '电费', amount: '', variable: true, day: 10, categoryId: 'home', payment: '微信', note: '', endMonth: '' };
test.beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 26, 9, 30) });
  db = new Map(); navigation = []; modals = [];
  global.wx = { getStorageSync: key => clone(db.get(key)), setStorageSync: (key, v) => db.set(key, clone(v)), showToast: () => {}, navigateBack: () => navigation.push('back'), navigateTo: o => navigation.push(o.url), setNavigationBarTitle: () => {}, pageScrollTo: () => {},
    showModal: o => { modals.push(o); if (o.success) o.success({ confirm: true }); } };
  require('./helpers/storage-io').installStorageIO(wx, db);
});

test('没有固定支出字段的旧账本照常读取和保存，清单为空', () => {
  const s = core.freshState(); assert.equal(s.fixedExpenses, undefined); db.set(store.KEY, s);
  assert.deepEqual(fixed.plan(store.read(), '2026-11-26').items, []);
  store.setBudget('100'); assert.equal(store.read().fixedExpenses, undefined);
});

test('固定金额一键记账：扣款日之后记在扣款日，同月再点需确认', () => {
  const item = store.saveFixed(mortgage);
  const first = store.recordFixed(item.id);
  assert.equal(first.record.date, '2026-11-25'); assert.equal(first.record.amountCents, 200000);
  assert.equal(first.record.categoryId, 'home'); assert.equal(first.record.payment, '银行卡'); assert.equal(first.record.note, '房贷'); assert.equal(first.record.fixedId, item.id);
  assert.deepEqual(store.recordFixed(item.id), { duplicate: true }); assert.equal(store.read().records.length, 1);
  store.recordFixed(item.id, true); assert.equal(store.read().records.length, 2);
});

test('提前点击记在今天；31 日在小月和闰年 2 月按月末', t => {
  const item = store.saveFixed(Object.assign({}, mortgage, { day: 31 }));
  assert.equal(store.recordFixed(item.id).record.date, '2026-11-26');
  assert.equal(fixed.dueDate(item, '2026-11'), '2026-11-30'); assert.equal(fixed.dueDate(item, '2024-02'), '2024-02-29'); assert.equal(fixed.dueDate(item, '2026-02'), '2026-02-28');
  t.mock.timers.setTime(new Date(2026, 10, 30, 8).getTime());
  assert.equal(fixed.plan(store.read(), '2026-11-30').items[0].status, 'done');
});

test('本月清单区分已记、已过扣款日、今天和未到，结束月份之后不再显示', () => {
  const a = store.saveFixed(mortgage); store.saveFixed(Object.assign({}, mortgage, { name: '话费', amount: '58', day: 3 }));
  store.saveFixed(Object.assign({}, mortgage, { name: '物业', day: 26 })); store.saveFixed(Object.assign({}, mortgage, { name: '保险', day: 28 }));
  store.saveFixed(Object.assign({}, mortgage, { name: '车贷', endMonth: '2026-10' }));
  store.recordFixed(a.id);
  const plan = fixed.plan(store.read(), '2026-11-26');
  assert.deepEqual(plan.items.map(i => [i.name, i.status]), [['话费', 'overdue'], ['房贷', 'done'], ['物业', 'today'], ['保险', 'upcoming']]);
  assert.equal(plan.done, 1); assert.equal(plan.total, 4); assert.equal(plan.overdue, 1);
  assert.equal(fixed.plan(store.read(), '2026-12-01').items.find(i => i.name === '房贷').status, 'upcoming');
});

test('首页：点「记一笔」直接记入，点「已记」打开账单；过期状态刷新', () => {
  const item = store.saveFixed(mortgage); const home = page('home'); home.onShow();
  assert.equal(home.data.fixedPlan.items[0].status, 'overdue');
  home.fixedTap(tap(item.id)); assert.equal(home.data.fixedPlan.items[0].status, 'done'); assert.equal(home.data.monthSummary.expenseText, '2,000.00');
  const billId = store.read().records[0].id; home.fixedTap(tap(item.id)); assert.equal(navigation.pop(), '/pages/record/record?id=' + billId);
});

test('首页列表过时后再点，先确认才再记一笔，取消不保存', () => {
  const item = store.saveFixed(mortgage); const home = page('home'); home.onShow(); const stale = page('home'); stale.onShow();
  home.fixedTap(tap(item.id));
  wx.showModal = o => { modals.push(o); o.success({ confirm: false }); };
  stale.fixedTap(tap(item.id)); assert.equal(modals.length, 1); assert.equal(store.read().records.length, 1); assert.equal(stale.data.fixedPlan.items[0].status, 'done');
});

test('金额会变的项打开记账页预填，按上次金额填写，保存后带上固定支出标记且编辑不丢失', () => {
  const item = store.saveFixed(power); const home = page('home'); home.onShow();
  home.fixedTap(tap(item.id)); const url = navigation.pop(); assert.equal(url, '/pages/record/record?fixed=' + item.id);
  assert.throws(() => store.recordFixed(item.id), /记账页/);
  const record = page('record'); record.onLoad({ fixed: item.id });
  assert.equal(record.data.amount, ''); assert.equal(record.data.categoryId, 'home'); assert.equal(record.data.note, '电费'); assert.equal(record.data.date, '2026-11-10'); assert.equal(record.data.payments[record.data.paymentIndex], '微信');
  record.setData({ amount: '186.4' }); record.save();
  const bill = store.read().records[0]; assert.equal(bill.fixedId, item.id); assert.equal(bill.amountCents, 18640);
  const edit = page('record'); edit.onLoad({ id: bill.id }); assert.equal(edit.data.fixedName, '电费'); edit.setData({ amount: '190' }); edit.save();
  assert.equal(store.read().records[0].fixedId, item.id);
  home.onShow(); assert.equal(home.data.fixedPlan.items[0].status, 'done');
  const next = page('record'); next.onLoad({ fixed: item.id }); assert.equal(next.data.amount, '190.00');
});

test('记账页从固定支出切换为收入或「保存并再记一笔」不带固定支出标记', () => {
  const item = store.saveFixed(power); const p = page('record'); p.onLoad({ fixed: item.id }); p.setData({ amount: '10' }); p.saveMore();
  assert.equal(p.data.fixedId, ''); p.setData({ amount: '20' }); p.saveMore();
  assert.deepEqual(store.read().records.map(r => r.fixedId), [item.id, undefined]);
  const q = page('record'); q.onLoad({ fixed: item.id }); q.typeChange({ currentTarget: { dataset: { type: 'income' } } }); q.setData({ amount: '5' }); q.save();
  assert.equal(store.read().records.at(-1).fixedId, undefined);
});

test('保存校验：名称、金额、日期、分类与重名', () => {
  assert.throws(() => store.saveFixed(Object.assign({}, mortgage, { name: '' })), /名称/);
  assert.throws(() => store.saveFixed(Object.assign({}, mortgage, { amount: '' })), /金额/);
  assert.throws(() => store.saveFixed(Object.assign({}, mortgage, { day: 32 })), /1—31/);
  assert.throws(() => store.saveFixed(Object.assign({}, mortgage, { categoryId: 'income_salary' })), /支出分类/);
  assert.throws(() => store.saveFixed(Object.assign({}, mortgage, { endMonth: '2026-13' })), /结束月份/);
  store.saveFixed(mortgage); assert.throws(() => store.saveFixed(mortgage), /同名/);
  assert.equal(store.saveFixed(Object.assign({}, power, { amount: '0' })).amountCents, 0);
});

test('删除分类时固定支出随账单一起迁移；删除固定支出保留已记账单', () => {
  const item = store.saveFixed(mortgage); store.recordFixed(item.id);
  store.removeCategory('home', 'loan');
  assert.equal(store.read().fixedExpenses[0].categoryId, 'loan'); assert.equal(store.read().records[0].categoryId, 'loan');
  store.removeFixed(item.id); const s = store.read();
  assert.deepEqual(s.fixedExpenses, []); assert.equal(s.records.length, 1); assert.equal(s.records[0].fixedId, item.id);
});

test('JSON 备份与恢复保留固定支出和账单标记，损坏数据被拒绝', () => {
  const item = store.saveFixed(mortgage); store.recordFixed(item.id);
  const restored = store.parseBackup(store.backupText());
  assert.deepEqual(restored.fixedExpenses, store.read().fixedExpenses); assert.equal(restored.records[0].fixedId, item.id);
  const bad = JSON.parse(store.backupText()); bad.state.fixedExpenses[0].day = 0;
  assert.throws(() => store.parseBackup(JSON.stringify(bad)), /固定支出数据无效/);
  const income = JSON.parse(store.backupText()); Object.assign(income.state.records[0], { type: 'income', categoryId: 'income_salary' });
  assert.throws(() => store.parseBackup(JSON.stringify(income)), /固定支出标记/);
});

test('管理页新增、编辑、删除', () => {
  const p = page('fixed'); p.onLoad({}); p.onShow();
  const home = p.data.categories.findIndex(c => c.id === 'home');
  p.setData({ name: '房贷', amount: '2000', dayIndex: 24, categoryIndex: home }); p.save();
  assert.equal(p.data.items.length, 1); assert.equal(p.data.items[0].day, 25); assert.equal(p.data.name, '');
  p.edit(tap(p.data.items[0].id)); assert.equal(p.data.amount, '2000.00'); p.setData({ amount: '2100' }); p.save();
  assert.equal(store.read().fixedExpenses[0].amountCents, 210000); assert.equal(store.read().fixedExpenses.length, 1);
  p.remove(tap(p.data.items[0].id)); assert.equal(p.data.items.length, 0);
  const mine = page('mine'); mine.onShow(); mine.fixed(); assert.equal(navigation.pop(), '/pages/fixed/fixed');
});
