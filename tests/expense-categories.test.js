const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/utils/core');
const store = require('../miniprogram/utils/store');
const names = ['保险', '理财', '贷款', '旅行', '长辈', '礼金'];
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
let db; let failWrite; let writes;
function previousState() {
  const s = core.freshState();
  s.version = 2; delete s.assetCategories; delete s.accounts; delete s.accountValueHistory; delete s.settings.assetAmountsHidden;
  delete s.settings.expenseCategoryRevision;
  s.categories = s.categories.filter(c => c.type === 'income' || !names.includes(c.name));
  s.records = [{ id: 'old', type: 'expense', categoryId: 'food', amountCents: 12345, refundCents: 345, payment: '现金', date: '2024-02-29', time: '12:00', note: '原账单', createdAt: 1, updatedAt: 2 }];
  s.settings.budgetCents = 500000;
  s.updatedAt = '2024-03-01T00:00:00.000Z'; s.lastBackupAt = '2024-03-02T00:00:00.000Z';
  return s;
}
test.beforeEach(() => {
  db = new Map(); failWrite = false; writes = 0;
  global.wx = {
    getStorageSync: key => clone(db.get(key)),
    setStorageSync: (key, value) => { if (failWrite) throw new Error('full'); if (key === store.KEY) writes++; db.set(key, clone(value)); }
  };
  require('./helpers/storage-io').installStorageIO(wx, db);
});

test('六个新支出分类可记账，礼金与收入礼金分别统计', () => {
  const s = store.read();
  assert.equal(s.categories.filter(c => c.type === 'expense').length, 14);
  for (const name of names) {
    const category = s.categories.find(c => c.type === 'expense' && c.name === name);
    assert.ok(category);
    store.saveRecord({ type: 'expense', categoryId: category.id, amount: '10', refund: '0', date: '2024-02-29', time: '12:00', payment: '微信', note: '' });
  }
  const receivedGift = s.categories.find(c => c.type === 'income' && c.name === '礼金');
  const paidGift = s.categories.find(c => c.type === 'expense' && c.name === '礼金');
  assert.notEqual(receivedGift.id, paidGift.id);
  assert.equal(core.summarize(store.read().records).expenseText, '60.00');
  assert.equal(core.summarize(store.read().records).incomeText, '0.00');
});

test('旧 v2 账本自动补齐一次，原记录、预算和时间保持不变', () => {
  const old = previousState(); db.set(store.V2_KEY, clone(old));
  const next = store.read();
  assert.equal(next.categories.length, 22);
  assert.deepEqual(next.records, old.records);
  assert.deepEqual(next.categories.slice(0, old.categories.length), old.categories);
  assert.equal(next.settings.budgetCents, old.settings.budgetCents);
  assert.equal(next.updatedAt, old.updatedAt); assert.equal(next.lastBackupAt, old.lastBackupAt);
  assert.equal(core.summarize(next.records).expenseText, '120.00');
  assert.equal(writes, 0); assert.deepEqual(store.read(), next); assert.equal(writes, 0);
  store.write(next, false); assert.equal(writes, 1); assert.deepEqual(store.read(), next);
});

test('同名分类不重复，ID 冲突不覆盖旧分类或历史记录', () => {
  const old = previousState();
  old.categories.push({ id: 'custom_finance', type: 'expense', name: '理财', icon: '💰', color: '#39775B' });
  old.categories.push({ id: 'insurance', type: 'expense', name: '宠物', icon: '🐱', color: '#39775B' });
  old.records[0].categoryId = 'insurance'; db.set(store.V2_KEY, clone(old));
  const next = store.read();
  const finance = next.categories.filter(c => c.type === 'expense' && c.name === '理财');
  assert.equal(finance.length, 1); assert.equal(finance[0].id, 'custom_finance'); assert.equal(finance[0].icon, '💰');
  assert.equal(next.categories.find(c => c.name === '保险').id, 'insurance_1');
  assert.equal(next.categories.find(c => c.id === 'insurance').name, '宠物');
  assert.equal(next.records[0].categoryId, 'insurance');
});

test('升级后删除和改名不会被重启或备份恢复还原', () => {
  db.set(store.V2_KEY, previousState()); store.read();
  store.removeCategory('insurance', 'other');
  store.saveCategory('出游', '🧳', 'travel', 'expense');
  assert.ok(!store.read().categories.some(c => c.name === '保险'));
  const backup = store.parseBackup(store.backupText()); store.restore(backup);
  assert.ok(!store.read().categories.some(c => c.name === '保险'));
  assert.equal(store.read().categories.find(c => c.id === 'travel').name, '出游');
});

test('补齐写入失败保留旧数据，重试可以成功', () => {
  const old = previousState(); db.set(store.V2_KEY, clone(old)); failWrite = true;
  assert.throws(() => store.write(store.read(), false), /保存失败/); assert.deepEqual(db.get(store.V2_KEY), old); assert.equal(db.has(store.KEY), false);
  failWrite = false; store.write(store.read(), false); assert.equal(store.read().categories.length, 22); assert.equal(writes, 1);
});

test('旧备份解析补齐但不写入，旧恢复前副本同样补齐', () => {
  const old = previousState();
  const parsed = store.parseBackup(JSON.stringify({ app: 'daily-expense-miniapp', version: 2, state: old }));
  assert.equal(parsed.categories.length, 22); assert.equal(writes, 0);
  assert.equal(old.settings.expenseCategoryRevision, undefined);
  db.set(store.V2_SAFETY_KEY, clone(old)); store.restoreSafety();
  assert.equal(store.read().categories.length, 22); assert.deepEqual(store.read().records, old.records);
});

test('分类接近上限时不超额、不删除旧分类', () => {
  const old = previousState();
  for (let i = 0; i < 31; i++) old.categories.push({ id: 'custom_' + i, type: 'expense', name: '自定义' + i, icon: '📦', color: '#39775B' });
  db.set(store.V2_KEY, clone(old));
  const next = store.read();
  assert.equal(next.categories.filter(c => c.type === 'expense').length, 40);
  assert.deepEqual(next.categories.slice(0, old.categories.length), old.categories);
  assert.ok(next.categories.some(c => c.name === '保险'));
  assert.equal(next.settings.expenseCategoryRevision, 1);
  core.validateState(next);
});
