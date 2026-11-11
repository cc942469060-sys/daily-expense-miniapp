const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path'); const fs = require('node:fs');
const core = require('../miniprogram/utils/core'); const { installStorageIO } = require('./helpers/storage-io'); const { applySetData } = require('./helpers/set-data');
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const event = dataset => ({ currentTarget: { dataset } });
let db; let io;
function install(data = new Map(), files = new Map()) {
  db = new Map([...data].map(([k, v]) => [k, clone(v)]));
  global.wx = { getStorageSync: k => clone(db.get(k)), setStorageSync: (k, v) => db.set(k, clone(v)), showToast() {}, showModal() {}, navigateTo() {}, pageScrollTo() {} };
  io = installStorageIO(wx, db); for (const [k, v] of files) io.files.set(k, v);
}
// Loading the storage modules again resets their counters and caches, as a new launch does.
function launch(data, files) {
  install(data, files);
  for (const name of ['store', 'ledger-storage']) delete require.cache[require.resolve(`../miniprogram/utils/${name}`)];
  return require('../miniprogram/utils/store');
}
function page(name) {
  let config; global.Page = v => { config = v; };
  // The shared module is loaded again too, so it uses the store module the test is using.
  for (const file of [`../miniprogram/pages/${name}/${name}.js`, '../miniprogram/utils/category-page.js']) delete require.cache[require.resolve(file)];
  require(`../miniprogram/pages/${name}/${name}.js`);
  const p = { data: clone(config.data), setData(v, done) { applySetData(this.data, v); if (done) done(); } };
  for (const [k, v] of Object.entries(config)) if (typeof v === 'function') p[k] = v.bind(p);
  return p;
}
test.beforeEach(() => install());

test('启动预热只填充缓存：不写入任何数据，之后第一次保存的结果与未预热时逐字节相同', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-01T12:00:00+08:00') });
  let draws = 0; t.mock.method(Math, 'random', () => (++draws * 0.618034) % 1);
  // Large enough to be split into many chunks, so the first save has caches to rebuild.
  const s = core.freshState();
  s.records = Array.from({ length: 3000 }, (_, i) => ({ id: 'bill_' + (1700000000000 + i).toString(36) + '_' + i.toString(36).padStart(4, '0'), type: 'expense', categoryId: 'food', amountCents: 100 + i, refundCents: 0, payment: '微信', date: `2026-0${1 + i % 9}-1${i % 10}`, time: '12:00', note: '', createdAt: i, updatedAt: i }));
  launch().write(s, false);
  const saved = { data: new Map(db), files: new Map(io.files) };
  const sorted = map => [...map].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const dump = () => ({ data: sorted(db), files: sorted(io.files) });
  const firstSave = warmFirst => {
    const store = launch(saved.data, saved.files); draws = 0;
    store.protect();
    if (warmFirst) { const before = dump(); assert.equal(store.warm(), true); assert.deepEqual(dump(), before, '预热不应写入任何数据'); }
    store.saveRecord({ type: 'expense', categoryId: 'food', amount: '12.5', refund: '0', date: '2026-11-01', time: '12:00', payment: '微信', note: '午饭' });
    assert.equal(store.read().records.length, 3001);
    return dump();
  };
  assert.deepEqual(firstSave(true), firstSave(false));
});

test('预热遇到空账本或损坏的账本时静默跳过，不改动数据', () => {
  const store = launch();
  assert.equal(store.warm(), false); assert.equal(db.size, 0);
  db.set(store.KEY, { bad: true });
  assert.equal(store.warm(), false); assert.deepEqual(db.get(store.KEY), { bad: true });
});

test('账本无法读取时，收支分类页和资产分类页都在页面内提示，不再弹窗', () => {
  const store = launch(); const modals = []; wx.showModal = o => modals.push(o.content);
  db.set(store.KEY, { bad: true });
  for (const name of ['categories', 'asset-categories']) {
    const p = page(name); p.onShow();
    assert.match(p.data.storageError, /数据异常/, name); assert.deepEqual(p.data.categories, [], name);
    // As on the other pages, the error replaces the editor, which could not save anyway.
    assert.match(read(`miniprogram/pages/${name}/${name}.wxml`), /<view wx:if="\{\{storageError\}\}" class="error">\{\{storageError\}\}<\/view>\s*<block wx:else>/, name);
  }
  assert.deepEqual(modals, []);
});

test('分类页的使用次数与逐个分类统计的结果一致，资产分类计入归档账户', () => {
  const store = launch();
  for (const [categoryId, amount] of [['food', '10'], ['food', '20'], ['transport', '5']]) store.saveRecord({ type: 'expense', categoryId, amount, refund: '0', date: '2024-02-29', time: '12:00', payment: '微信', note: '' });
  const account = extra => Object.assign({ kind: 'asset', categoryId: 'asset_bank', name: '工资卡', amount: '1000', valuedOn: '2024-02-29', cardLast4: '0123', note: '' }, extra);
  store.saveAccount(account()); store.archiveAccount(store.saveAccount(account({ name: '旧卡', amount: '0' })).id, true);
  const s = store.read();
  const categories = page('categories'); categories.onShow();
  for (const c of categories.data.categories) assert.equal(c.count, s.records.filter(r => r.categoryId === c.id).length, c.id);
  assert.equal(categories.data.categories.find(c => c.id === 'food').count, 2);
  categories.typeChange(event({ type: 'bogus' })); assert.equal(categories.data.type, 'expense');
  const assetCategories = page('asset-categories'); assetCategories.onShow();
  for (const c of assetCategories.data.categories) assert.equal(c.count, s.accounts.filter(a => a.categoryId === c.id).length, c.id);
  assert.equal(assetCategories.data.categories.find(c => c.id === 'asset_bank').count, 2);
  assetCategories.kindChange(event({ kind: 'liability' })); assert.equal(assetCategories.data.kind, 'liability');
  assert.ok(assetCategories.data.categories.length > 0 && assetCategories.data.categories.every(c => c.kind === 'liability'));
});
