const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const core = require('../miniprogram/utils/core');
const store = require('../miniprogram/utils/store');
const dates = require('../miniprogram/utils/date');
let db; let failKey; let navigation; let errors;
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
const event = type => ({ currentTarget: { dataset: { type } } });
function input(extra) {
  return Object.assign({ type: 'expense', amount: '500', categoryId: 'transport', date: '2024-02-10', time: '12:00', payment: '微信', note: '出差', refund: '0' }, extra);
}
function income(extra) { return input(Object.assign({ type: 'income', categoryId: 'income_salary', payment: '银行卡', amount: '8000', note: '工资' }, extra)); }
function legacy() {
  return {
    version: 1,
    categories: [{ id: 'food', name: '餐饮', icon: '🍜', color: '#39775B' }],
    records: [{ id: 'old_bill', categoryId: 'food', amountCents: 12345, refundCents: 345, payment: '现金', date: '2024-02-29', time: '13:20', note: '旧账', createdAt: 123, updatedAt: 456 }],
    settings: { budgetCents: 500000 }, updatedAt: '2024-03-01T00:00:00.000Z', lastBackupAt: '2024-03-02T00:00:00.000Z'
  };
}
function page(name) {
  let config; global.Page = value => { config = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/' + name + '.js');
  delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(value) { Object.assign(this.data, value); } };
  for (const [key, value] of Object.entries(config)) if (typeof value === 'function') p[key] = value.bind(p);
  return p;
}
test.beforeEach(() => {
  db = new Map(); failKey = ''; navigation = []; errors = [];
  global.wx = {
    getStorageSync: key => clone(db.get(key)),
    setStorageSync: (key, value) => { if (key === failKey) throw new Error('full'); db.set(key, clone(value)); },
    showToast: () => {}, showModal: options => { errors.push(options.content); if (options.success) options.success({ confirm: true }); },
    navigateBack: () => navigation.push('back'), navigateTo: options => navigation.push(options.url),
    setNavigationBarTitle: () => {}, pageScrollTo: () => {}
  };
});

test('混合收支汇总、分类占比和趋势按类型计算', () => {
  store.saveRecord(income());
  store.saveRecord(income({ amount: '200', categoryId: 'income_redpacket' }));
  store.saveRecord(input({ amount: '2200', refund: '200' }));
  const s = store.read(); const summary = core.summarize(s.records);
  assert.equal(summary.incomeCents, 820000); assert.equal(summary.expenseCents, 200000);
  assert.equal(summary.balanceText, '6200.00'); assert.equal(summary.refundCents, 20000);
  const expense = core.statistics(s, 'month', '2024-02-10', '2024-03-01', 'expense');
  const received = core.statistics(s, 'month', '2024-02-10', '2024-03-01', 'income');
  assert.equal(expense.totalText, '2000.00'); assert.equal(expense.count, 1);
  assert.equal(expense.categories[0].percent, '100.0'); assert.equal(expense.bars[9].cents, 200000);
  assert.equal(received.totalText, '8200.00'); assert.equal(received.count, 2);
  assert.equal(received.categories[0].percent, '97.6'); assert.equal(received.bars[9].cents, 820000);
  assert.equal(received.maxText, '8000.00'); assert.equal(received.refundCents, 0);
  assert.deepEqual(received.summary, expense.summary);
});

test('仅收入、负结余、空账本和全额退款使用稳定的零值与方向', () => {
  const s = core.freshState();
  assert.equal(core.summarize([]).balanceText, '0.00');
  assert.equal(core.statistics(s, 'year', '2024-02-10', '2024-03-01', 'income').bars.length, 12);
  s.records.push(core.createRecord(s, income({ amount: '10' })));
  assert.equal(core.summarize(s.records).expenseCents, 0);
  s.records.push(core.createRecord(s, input({ amount: '30' })));
  assert.equal(core.summarize(s.records).balanceText, '-20.00');
  s.records[1].refundCents = 3000;
  assert.equal(core.decorate(s, s.records[1]).sign, '');
  assert.equal(core.decorate(s, s.records[0]).sign, '+');
  const stat = core.statistics(s, 'month', '2024-02-10', '2024-03-01', 'expense');
  assert.equal(stat.count, 1); assert.equal(stat.categories.length, 0); assert.equal(stat.totalText, '0.00');
});

test('报销按到账月增加收入，退款继续扣原支出月', () => {
  const expense = store.saveRecord(input({ date: '2024-01-31' }));
  store.saveRecord(income({ amount: '500', categoryId: 'income_reimbursement', date: '2024-02-02' }));
  const s = store.read();
  assert.equal(core.summarize(s.records).balanceCents, 0);
  assert.equal(core.statistics(s, 'month', '2024-01-01', '2024-03-01').summary.balanceCents, -50000);
  assert.equal(core.statistics(s, 'month', '2024-02-01', '2024-03-01', 'income').totalText, '500.00');
  assert.equal(s.records.find(r => r.id === expense.id).refundCents, 0);
  store.saveRecord(input({ date: '2024-01-30', amount: '20', refund: '20' }));
  assert.equal(core.statistics(store.read(), 'month', '2024-02-01', '2024-03-01', 'income').totalText, '500.00');
});

test('收入退款、跨类型分类、非法或缺失类型被拒绝且不写入', () => {
  store.read(); const before = clone(db.get(store.KEY));
  for (const bad of [income({ refund: '1' }), income({ categoryId: 'food' }), input({ type: undefined }), input({ type: 'transfer' })]) {
    assert.throws(() => store.saveRecord(bad));
    assert.deepEqual(db.get(store.KEY), before);
  }
  for (const mutate of [s => delete s.categories[0].type, s => s.categories[0].type = 'unknown', s => delete s.records[0].type, s => s.records[0].categoryId = 'food', s => s.records[0].refundCents = 1]) {
    const s = core.freshState(); s.records = [core.createRecord(s, income())]; mutate(s);
    assert.throws(() => core.validateState(s));
  }
});

test('有退款的支出不能直接转换为收入，无退款转换保留记录身份', () => {
  const expense = store.saveRecord(input({ refund: '10' }));
  assert.throws(() => store.saveRecord(income(), expense.id), /退款/);
  store.saveRecord(input(), expense.id);
  const changed = store.saveRecord(income({ amount: '500' }), expense.id);
  assert.equal(changed.id, expense.id); assert.equal(changed.createdAt, expense.createdAt);
  assert.equal(changed.type, 'income'); assert.equal(changed.refundCents, 0);
});

test('混合收支的分页日期小计使用完整筛选结果', () => {
  const s = core.freshState();
  s.records = Array.from({ length: 150 }, (_, i) => core.createRecord(s, i % 2 ? income({ amount: '2' }) : input({ amount: '1' })));
  const all = core.filterRecords(s);
  for (const limit of [8, 100, 150]) {
    const group = core.groups(s, all.slice(0, limit), all)[0];
    assert.equal(group.records.length, limit); assert.equal(group.incomeText, '150.00'); assert.equal(group.expenseText, '75.00');
    assert.equal(group.balanceText, '75.00');
  }
  const filtered = core.filterRecords(s, { type: 'income', payment: '银行卡', query: '工资', start: '2024-02-01', end: '2024-02-29' });
  assert.equal(filtered.length, 75);
  assert.equal(core.groups(s, filtered.slice(0, 8), filtered, 'income')[0].summaryText, '收入 ¥150.00');
});

test('v1 自动迁移保留原数据和时间戳，重复读取不会重复添加分类', () => {
  const old = legacy(); db.set(store.LEGACY_KEY, clone(old));
  const next = store.read();
  assert.equal(next.version, 3); assert.equal(next.records[0].type, 'expense');
  assert.deepEqual(next.records[0], Object.assign({}, old.records[0], { type: 'expense' }));
  assert.equal(next.updatedAt, old.updatedAt); assert.equal(next.lastBackupAt, old.lastBackupAt);
  assert.deepEqual(next.settings, Object.assign({}, old.settings, { expenseCategoryRevision: 1, assetAmountsHidden: false })); assert.equal(next.categories.length, 15);
  assert.equal(core.summarize(next.records).expenseText, '120.00');
  assert.deepEqual(db.get(store.LEGACY_KEY), old);
  assert.deepEqual(store.read(), next);
});

test('旧版满 40 个分类并与默认收入 ID 冲突仍能迁移', () => {
  const old = legacy();
  old.categories = Array.from({ length: 40 }, (_, i) => ({ id: i === 0 ? 'food' : i === 1 ? 'income_salary' : i === 2 ? 'income_salary_1' : 'old_' + i, name: '分类' + i, icon: '📦', color: '#39775B' }));
  const next = core.migrateState(old);
  assert.equal(next.categories.length, 48);
  assert.equal(next.categories.filter(c => c.type === 'expense').length, 40);
  assert.equal(next.categories.find(c => c.type === 'income' && c.name === '工资').id, 'income_salary_2');
  assert.deepEqual(core.migrateState(next), next);
  assert.equal(old.version, 1); assert.equal(old.categories[0].type, undefined);
});

test('迁移写入失败保留旧账本，重试成功；损坏数据不被空账本覆盖', () => {
  const old = legacy(); db.set(store.LEGACY_KEY, clone(old)); failKey = store.KEY;
  assert.throws(() => store.read(), /升级保存失败/);
  assert.deepEqual(db.get(store.LEGACY_KEY), old); assert.equal(db.has(store.KEY), false);
  failKey = ''; assert.equal(store.read().records.length, 1);
  db.set(store.KEY, { bad: true });
  assert.throws(() => store.read(), /数据异常/); assert.deepEqual(db.get(store.KEY), { bad: true });
  db.delete(store.KEY); db.set(store.LEGACY_KEY, { bad: true });
  assert.throws(() => store.read(), /数据异常/); assert.equal(db.has(store.KEY), false);
});

test('新版备份完整往返，旧备份解析不写入当前账本且未知版本被拒绝', () => {
  store.saveRecord(income()); store.saveRecord(input({ refund: '10' })); store.setBudget('2000');
  const before = clone(db.get(store.KEY)); const backup = JSON.parse(store.backupText());
  assert.equal(backup.version, 3); assert.deepEqual(store.parseBackup(JSON.stringify(backup)), before);
  const parsed = store.parseBackup(JSON.stringify({ app: 'daily-expense-miniapp', version: 1, state: legacy() }));
  assert.equal(parsed.version, 3); assert.equal(parsed.records[0].type, 'expense');
  assert.deepEqual(db.get(store.KEY), before);
  for (const version of [0, 4, '3', 1, 2]) assert.throws(() => store.parseBackup(JSON.stringify(Object.assign({}, backup, { version }))));
  store.restore(parsed); assert.equal(store.read().records[0].id, 'old_bill');
  store.restoreSafety(); assert.equal(store.read().records.length, 2);
  assert.equal(store.read().settings.budgetCents, 200000);
});

test('旧恢复前副本可迁移，损坏的新副本不回退到陈旧副本', () => {
  db.set(store.LEGACY_SAFETY_KEY, legacy());
  assert.equal(store.hasSafety(), true);
  store.restoreSafety(); assert.equal(store.read().records[0].id, 'old_bill');
  db.set(store.SAFETY_KEY, { bad: true }); const before = clone(db.get(store.KEY));
  assert.throws(() => store.restoreSafety()); assert.deepEqual(db.get(store.KEY), before);
});

test('从旧账本直接恢复时也保留原账本，写入失败不改变当前收入', () => {
  db.set(store.LEGACY_KEY, legacy()); store.restore(core.freshState());
  assert.deepEqual(db.get(store.SAFETY_KEY), legacy()); store.restoreSafety();
  assert.equal(store.read().records[0].id, 'old_bill');
  store.saveRecord(income()); const before = clone(db.get(store.KEY)); failKey = store.KEY;
  assert.throws(() => store.restore(core.freshState()), /保存失败/);
  assert.deepEqual(db.get(store.KEY), before);
  failKey = ''; store.restoreSafety(); assert.deepEqual(store.read().records, before.records);
});

test('分类名称在类型内唯一，迁移同类型且每种类型至少保留一个', () => {
  store.saveCategory('其他', '💰', '', 'income');
  assert.throws(() => store.saveCategory('其他', '💰', '', 'income'), /已经存在/);
  assert.throws(() => store.removeCategory('food', 'income_salary'), /同一收支类型/);
  assert.throws(() => store.saveCategory('改型测试', '💼', 'food', 'income'), /收支类型/);
  const bill = store.saveRecord(income());
  store.removeCategory('income_salary', 'income_other');
  assert.equal(store.read().records.find(r => r.id === bill.id).categoryId, 'income_other');
  for (const category of store.read().categories.filter(c => c.type === 'income' && c.id !== 'income_other')) store.removeCategory(category.id, 'income_other');
  assert.throws(() => store.removeCategory('income_other', 'food'), /至少保留一个/);
});

test('每种分类上限独立为 40，收入写入失败保留上次成功数据', () => {
  for (let i = 0; i < 32; i++) store.saveCategory('收入' + i, '💰', '', 'income');
  assert.throws(() => store.saveCategory('额外收入', '💰', '', 'income'), /40/);
  store.saveCategory('额外支出', '📦', '', 'expense');
  const before = clone(db.get(store.KEY)); failKey = store.KEY;
  assert.throws(() => store.saveRecord(income()), /保存失败/);
  assert.deepEqual(db.get(store.KEY), before);
});

test('CSV 区分收入支出，收入退款留空，保留中文及公式保护', () => {
  store.saveRecord(income({ amount: '8000', note: '=SUM(1,2)"\n工资' }));
  store.saveRecord(input({ amount: '500', refund: '100', note: '差旅' }));
  const csv = core.csv(store.read());
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('"收支类型"'));
  assert.ok(csv.includes('"收入","工资","8000.00","","8000.00","银行卡"'));
  assert.ok(csv.includes('"支出","交通","500.00","100.00","400.00","微信"'));
  assert.ok(csv.includes("'=SUM(1,2)"));
  assert.ok(csv.includes('""\n工资'));
});

test('页面收入完整流程：首页预算、统计钻取、明细、编辑和删除', () => {
  const today = dates.dateKey(new Date());
  store.saveRecord(input({ amount: '2200', date: today })); store.setBudget('3000');
  const record = page('record'); record.onLoad({ type: 'income' });
  assert.equal(record.data.type, 'income'); assert.ok(record.data.categories.every(c => c.type === 'income'));
  record.setData({ amount: '8000', note: '工资' }); record.save();
  const id = store.read().records.find(r => r.type === 'income').id;
  const home = page('home'); home.onShow();
  assert.equal(home.data.monthSummary.balanceText, '5800.00'); assert.equal(home.data.remainingText, '800.00');
  assert.equal(home.data.budgetPercent, 73); assert.equal(home.data.count, 2);
  home.monthBills(event('income')); assert.match(navigation.pop(), /type=income/);
  home.todayBills(event('income')); assert.match(navigation.pop(), /type=income/);
  const stats = page('stats'); stats.onShow(); stats.typeChange(event('income'));
  assert.equal(stats.data.stats.totalText, '8000.00'); assert.equal(stats.data.stats.count, 1);
  stats.allBills(); assert.match(navigation.pop(), /type=income/);
  stats.barBills({ currentTarget: { dataset: { start: today, end: today } } }); assert.match(navigation.pop(), /type=income/);
  stats.categoryBills({ currentTarget: { dataset: { id: 'income_salary' } } }); assert.match(navigation.pop(), /type=income/);
  const bills = page('bills'); bills.onLoad({ type: 'income' }); bills.onShow();
  assert.equal(bills.data.count, 1); assert.equal(bills.data.totalText, '8000.00');
  bills.add(); assert.match(navigation.pop(), /type=income/);
  const edit = page('record'); edit.onLoad({ id }); assert.equal(edit.data.type, 'income');
  edit.setData({ amount: '8500' }); edit.save(); home.onShow();
  assert.equal(home.data.monthSummary.balanceText, '6300.00'); assert.equal(home.data.remainingText, '800.00');
  edit.remove(); home.onShow(); assert.equal(home.data.monthSummary.balanceText, '-2200.00');
  assert.deepEqual(errors, ['删除后对应统计会立即更新，此操作无法撤销。']);
});

test('记账切换类型分别使用最近分类方式，连续记收入保留类型', () => {
  store.saveRecord(input({ categoryId: 'shopping', payment: '现金' }));
  store.saveRecord(income({ categoryId: 'income_redpacket', payment: '微信' }));
  const p = page('record'); p.onLoad({});
  assert.equal(p.data.categoryId, 'shopping'); assert.equal(p.data.payments[p.data.paymentIndex], '现金');
  p.setData({ amount: '66', date: '2024-03-01', note: '礼物' }); p.typeChange(event('income'));
  assert.equal(p.data.categoryId, 'income_redpacket'); assert.equal(p.data.payments[p.data.paymentIndex], '微信');
  assert.equal(p.data.amount, '66'); assert.equal(p.data.note, '礼物');
  p.saveMore(); assert.equal(p.data.type, 'income'); assert.equal(p.data.categoryId, 'income_redpacket');
  assert.equal(p.data.amount, ''); assert.equal(p.data.note, ''); assert.equal(p.data.date, '2024-03-01');
  p.typeChange(event('expense')); assert.equal(p.data.categoryId, 'shopping');
  const r = store.saveRecord(input({ refund: '20' })); const edit = page('record'); edit.onLoad({ id: r.id });
  edit.typeChange(event('income')); assert.equal(edit.data.type, 'expense'); assert.match(errors.pop(), /退款/);
});

test('明细切换类型清理分类和分页，混合日小计不受分页截断', () => {
  const s = store.read();
  s.records = Array.from({ length: 120 }, (_, i) => core.createRecord(s, i % 2 ? income({ amount: '2' }) : input({ amount: '1' })));
  store.write(s);
  const bills = page('bills'); bills.onLoad({}); bills.onShow();
  assert.equal(bills.data.shown, 100); assert.equal(bills.data.groups[0].incomeText, '120.00');
  assert.equal(bills.data.groups[0].expenseText, '60.00');
  bills.more(); assert.equal(bills.data.shown, 120);
  bills.setData({ categoryId: 'transport' }); bills.typeChange(event('income'));
  assert.equal(bills.data.categoryId, ''); assert.equal(bills.data.limit, 100);
  assert.equal(bills.data.count, 60); assert.equal(bills.data.groups[0].summaryText, '收入 ¥120.00');
  assert.ok(bills.data.categories.every(c => c.type === 'income'));
  bills.clear(); assert.equal(bills.data.type, ''); assert.equal(bills.data.count, 120);
  const home = page('home'); home.onShow(); assert.equal(home.data.groups[0].records.length, 8);
  assert.equal(home.data.groups[0].incomeText, '120.00');
});

test('编辑时切换收支须重选分类，保存失败保留原账单和输入', () => {
  const r = store.saveRecord(input());
  const p = page('record'); p.onLoad({ id: r.id }); p.typeChange(event('income'));
  assert.equal(p.data.categoryId, ''); p.save();
  assert.match(errors.pop(), /分类/); assert.equal(store.read().records[0].type, 'expense');
  assert.equal(navigation.length, 0);
  p.category({ currentTarget: { dataset: { id: 'income_reimbursement' } } });
  failKey = store.KEY; p.save();
  assert.match(errors.pop(), /保存失败/); assert.equal(p.data.amount, '500.00');
  assert.equal(p.data.saving, false); assert.equal(store.read().records[0].type, 'expense');
  failKey = ''; p.save();
  assert.equal(store.read().records[0].type, 'income'); assert.equal(store.read().records[0].id, r.id);
  assert.deepEqual(navigation, ['back']);
});

test('所有周期的收入趋势只累计收入，明细可组合类型与同名分类筛选', () => {
  store.saveRecord(income({ amount: '2', date: '2024-02-29' }));
  store.saveRecord(income({ amount: '3', date: '2024-03-01' }));
  store.saveRecord(input({ amount: '100', date: '2024-02-29' }));
  store.saveCategory('餐饮', '💰', 'income_salary', 'income');
  const s = store.read();
  const day = core.statistics(s, 'day', '2024-02-29', '2024-04-01', 'income');
  const week = core.statistics(s, 'week', '2024-02-29', '2024-04-01', 'income');
  const year = core.statistics(s, 'year', '2024-02-29', '2024-04-01', 'income');
  assert.equal(day.totalText, '2.00'); assert.equal(week.totalText, '5.00');
  assert.equal(year.bars[1].cents, 200); assert.equal(year.bars[2].cents, 300);
  assert.equal(core.filterRecords(s, { type: 'income', query: '餐饮', categoryId: 'income_salary', payment: '银行卡', start: '2024-02-01', end: '2024-02-29' }).length, 1);
  assert.equal(core.filterRecords(s, { type: 'expense', categoryId: 'income_salary' }).length, 0);
});

test('分类页面切换清理编辑状态，删除迁移只提供当前类型', () => {
  const p = page('categories'); p.onShow();
  p.edit({ currentTarget: { dataset: { id: 'food' } } }); p.typeChange(event('income'));
  assert.equal(p.data.editingId, ''); assert.equal(p.data.name, '');
  p.setData({ name: '稿酬', icon: '💰' }); p.save();
  const added = store.read().categories.find(c => c.name === '稿酬');
  assert.equal(added.type, 'income');
  p.beginRemove({ currentTarget: { dataset: { id: added.id } } });
  assert.ok(p.data.targets.every(c => c.type === 'income' && c.id !== added.id));
  p.remove(); assert.ok(!store.read().categories.some(c => c.id === added.id));
});

test('旧备份取消恢复不迁移当前账本，页面可发现旧恢复前副本', async () => {
  store.saveRecord(income()); const before = clone(db.get(store.KEY));
  wx.chooseMessageFile = options => options.success({ tempFiles: [{ path: '/old.json', size: 2000 }] });
  wx.getFileSystemManager = () => ({ readFile: options => options.success({ data: JSON.stringify({ app: 'daily-expense-miniapp', version: 1, state: legacy() }) }) });
  wx.showModal = options => options.success({ confirm: false });
  const backup = page('backup'); await backup.importJson();
  assert.deepEqual(db.get(store.KEY), before); assert.equal(db.has(store.SAFETY_KEY), false); assert.equal(backup.data.busy, false);
  db.set(store.LEGACY_SAFETY_KEY, legacy()); backup.refresh(); assert.equal(backup.data.hasSafety, true);
});
