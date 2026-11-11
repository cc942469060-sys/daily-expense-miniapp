const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path');
const core = require('../miniprogram/utils/core'); const assets = require('../miniprogram/utils/assets'); const store = require('../miniprogram/utils/store');
const { applySetData } = require('./helpers/set-data');
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
const DAY = 86400000;
let db; let writes; let modals;
function page(name, options) {
  let config; global.Page = v => { config = v; }; const file = path.resolve(__dirname, `../miniprogram/pages/${name}/${name}.js`); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(v) { applySetData(this.data, v); } };
  for (const [k, v] of Object.entries(config)) if (typeof v === 'function') p[k] = v.bind(p);
  if (p.onLoad) p.onLoad(options || {}); if (p.onShow) p.onShow(); return p;
}
function bill(id, cents, createdAt, extra) { return Object.assign({ id, type: 'expense', categoryId: 'food', amountCents: cents, refundCents: 0, payment: '微信', date: '2026-10-01', time: '12:00', note: '', createdAt, updatedAt: createdAt }, extra); }
function seed(records, extra) { const s = Object.assign(core.freshState(), extra); s.records = records; db.set(store.KEY, s); return s; }
test.beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-11T12:00:00+08:00') });
  db = new Map(); writes = []; modals = [];
  global.wx = { getStorageSync: k => clone(db.get(k)), setStorageSync: (k, v) => { writes.push(k); db.set(k, clone(v)); }, showToast() {}, showModal(o) { modals.push(o); }, navigateTo() {}, pageScrollTo() {} };
  require('./helpers/storage-io').installStorageIO(wx, db);
});

test('显示金额带千分位，输入和 CSV 仍用不带分隔符的数字', () => {
  for (const [cents, text] of [[0, '0.00'], [5, '0.05'], [99999, '999.99'], [123456, '1,234.56'], [100000000, '1,000,000.00'], [-220000, '-2,200.00']]) assert.equal(core.moneyText(cents), text);
  assert.equal(assets.moneyText(99999999999), '999,999,999.99'); assert.equal(core.money(123456), '1234.56');
  const s = seed([bill('big', 580000, Date.now(), { date: '2026-11-11' })]);
  const home = page('home'); assert.equal(home.data.monthSummary.expenseText, '5,800.00'); assert.equal(home.data.groups[0].records[0].amountText, '5,800.00');
  const record = page('record', { id: 'big' }); assert.equal(record.data.amount, '5800.00');
  assert.match(core.csv(s), /"5800\.00"/); assert.ok(!core.csv(s).includes('5,800'));
});

test('金额输入接受 12. 、.5 和正确分组的千分位，拒绝含糊写法', () => {
  for (const [raw, cents] of [['12.', 1200], ['.5', 50], ['0.10', 10], [' 8 ', 800], ['1,234.50', 123450], ['1,234,567.8', 123456780], ['1,000', 100000]]) assert.equal(core.amountToCents(raw), cents);
  for (const raw of ['12,34', '1,2345', '1,234,56', ',123', '.', '', '1.234', '12..', '1,234.567']) assert.throws(() => core.amountToCents(raw), raw);
  assert.equal(assets.amountToCents('999,999,999.99'), 99999999999); assert.equal(assets.amountToCents('0.'), 0); assert.throws(() => assets.amountToCents('1,000,000,000'));
  seed([]); const record = page('record'); record.setData({ amount: '12.' }); record.save();
  assert.equal(store.read().records[0].amountCents, 1200);
});

test('超过 30 天未发送备份时首页提醒，可 7 天后再提醒，读取不写入存储', t => {
  seed([bill('old', 100, Date.now() - 31 * DAY)]); writes = [];
  const home = page('home'); assert.match(home.data.backupReminder, /已经记账 31 天，还没有发送过备份/); assert.deepEqual(writes, []);
  home.snoozeBackup(); assert.equal(home.data.backupReminder, ''); assert.deepEqual(writes, [store.REMINDER_KEY]);
  home.onShow(); assert.equal(home.data.backupReminder, '');
  t.mock.timers.setTime(Date.now() + 8 * DAY); home.onShow(); assert.match(home.data.backupReminder, /还没有发送过备份/);
});

test('最近发送过备份或账本为空时不提醒，旧备份按发送时间计算', t => {
  seed([]); assert.equal(page('home').data.backupReminder, '');
  seed([bill('new', 100, Date.now() - 5 * DAY)]); assert.equal(page('home').data.backupReminder, '');
  seed([bill('old', 100, Date.now() - 400 * DAY)], { lastBackupAt: new Date(Date.now() - 10 * DAY).toISOString() }); assert.equal(page('home').data.backupReminder, '');
  t.mock.timers.setTime(Date.now() + 25 * DAY); assert.match(page('home').data.backupReminder, /已经 35 天没有发送新的备份了/);
});

test('我的页面显示上次发送备份的时间', () => {
  seed([bill('a', 100, Date.now())]); assert.equal(page('mine').data.backupText, '尚未发送过备份');
  seed([bill('a', 100, Date.now())], { lastBackupAt: new Date(Date.now() - 3 * DAY).toISOString() }); assert.equal(page('mine').data.backupText, '上次发送备份：3 天前');
  seed([bill('a', 100, Date.now())], { lastBackupAt: new Date().toISOString() }); assert.equal(page('mine').data.backupText, '今天已发送备份');
});
