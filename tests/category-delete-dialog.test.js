const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const core = require('../miniprogram/utils/core');
const store = require('../miniprogram/utils/store');
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
let db; let dialogs; let toasts; let action; let pending;
function page(name) {
  let config; global.Page = value => { config = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/' + name + '.js'); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(value) { Object.assign(this.data, value); } };
  for (const [key, value] of Object.entries(config)) if (typeof value === 'function') p[key] = value.bind(p);
  return p;
}
function setup(name = 'categories', type = 'income') {
  const p = page(name); p.setData(name === 'categories' ? { type } : { kind: type }); p.onShow();
  const category = p.data.categories[0]; p.beginRemove({ currentTarget: { dataset: { id: category.id } } });
  return p;
}
test.beforeEach(() => {
  db = new Map(); dialogs = []; toasts = []; action = 'confirm'; pending = null;
  const s = core.freshState();
  s.records = [{ id: 'salary', type: 'income', categoryId: 'income_salary', amountCents: 12345, refundCents: 0, date: '2026-10-01', time: '12:00', payment: '银行卡', note: '工资', createdAt: 1, updatedAt: 1 }];
  db.set(store.KEY, s);
  global.wx = {
    getStorageSync: key => clone(db.get(key)), setStorageSync: (key, value) => db.set(key, clone(value)),
    pageScrollTo: () => {}, showToast: options => toasts.push(options),
    showModal: options => {
      dialogs.push(options);
      // Match the platform contract; permissive mocks previously hid this failure.
      if (options.confirmText && options.confirmText.length > 4) { if (options.fail) options.fail({ errMsg: 'showModal:fail confirmText length should not larger than 4' }); return; }
      if (options.showCancel === false) return;
      if (action === 'fail') { if (options.fail) options.fail({ errMsg: 'showModal:fail' }); return; }
      if (action === 'defer') { pending = options; return; }
      if (options.success) options.success({ confirm: action === 'confirm', cancel: action === 'cancel' });
    }
  };
  require('./helpers/storage-io').installStorageIO(wx, db);
});

test('严格微信弹窗参数下收入分类可迁移删除，账单金额和身份不变', () => {
  const before = clone(db.get(store.KEY).records[0]); const p = setup();
  const source = p.data.deletingId; const target = p.data.targets[0]; p.remove();
  assert.equal(dialogs[0].confirmText, '确认删除'); assert.match(dialogs[0].content, new RegExp(target.name));
  const s = store.read(); assert.ok(!s.categories.some(c => c.id === source));
  assert.deepEqual(s.records[0], Object.assign({}, before, { categoryId: target.id }));
  assert.equal(p.data.deletingId, ''); assert.equal(toasts.at(-1).title, '分类已删除');
});

test('支出、资产和负债分类的确认按钮也满足平台限制', () => {
  for (const [name, type] of [['categories', 'expense'], ['asset-categories', 'asset'], ['asset-categories', 'liability']]) {
    const p = setup(name, type); const source = p.data.deletingId; p.remove();
    const categories = name === 'categories' ? store.read().categories : store.read().assetCategories;
    assert.ok(!categories.some(c => c.id === source)); assert.equal(dialogs.at(-1).confirmText.length, 4);
  }
});

test('取消确认时账单和分类不变，可再次确认', () => {
  const p = setup(); const before = clone(db.get(store.KEY)); action = 'cancel'; p.remove();
  assert.deepEqual(db.get(store.KEY), before); assert.ok(p.data.deletingId); assert.equal(toasts.length, 0);
  action = 'confirm'; p.remove(); assert.equal(p.data.deletingId, '');
});

test('弹窗调用失败有提示且不写账本，重试可以完成删除', () => {
  for (const [name, type] of [['categories', 'income'], ['asset-categories', 'asset']]) {
    const p = setup(name, type); const before = clone(db.get(store.KEY)); action = 'fail'; p.remove();
    assert.deepEqual(db.get(store.KEY), before); assert.match(toasts.at(-1).title, /无法弹出确认框/); assert.ok(p.data.deletingId);
    action = 'confirm'; p.remove(); assert.equal(p.data.deletingId, '');
  }
});

test('迁移目标无效时明确提示而不是抛出异常或无响应', () => {
  for (const [name, type] of [['categories', 'income'], ['asset-categories', 'asset']]) {
    const p = setup(name, type); const before = clone(db.get(store.KEY)); p.setData({ targetIndex: 999 }); p.remove();
    assert.match(dialogs.at(-1).content, /有效的同类型迁移分类/); assert.deepEqual(db.get(store.KEY), before);
  }
});

test('写入失败保留原分类和账单并提示错误，不显示删除成功', () => {
  const p = setup(); const before = clone(db.get(store.KEY));
  const save = wx.setStorageSync; wx.setStorageSync = (key, value) => { if (key === store.KEY) throw new Error('storage full'); save(key, value); };
  p.remove(); assert.deepEqual(db.get(store.KEY), before); assert.ok(p.data.deletingId);
  assert.equal(dialogs.at(-1).title, '操作未完成'); assert.equal(toasts.length, 0);
});

test('确认回调使用弹窗展示时的分类，页面状态变化不会误删另一分类', () => {
  const p = setup(); const source = p.data.deletingId; const target = p.data.targets[0].id; action = 'defer'; p.remove();
  p.setData({ deletingId: target }); pending.success({ confirm: true });
  assert.ok(!store.read().categories.some(c => c.id === source)); assert.ok(store.read().categories.some(c => c.id === target));
});
