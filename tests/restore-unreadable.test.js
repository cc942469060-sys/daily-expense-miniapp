const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path');
const store = require('../miniprogram/utils/store'); const core = require('../miniprogram/utils/core');
const { installStorageIO } = require('./helpers/storage-io');
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
let db; let emptyKey; let writes; let answers; let modals;
test.beforeEach(() => {
  db = new Map(); emptyKey = ''; writes = []; answers = []; modals = [];
  global.wx = {
    // emptyKey stays listed in the storage directory but reads back '' until it is written again.
    getStorageSync: key => key === emptyKey ? '' : clone(db.get(key)),
    setStorageSync: (key, value) => { writes.push(key); db.set(key, clone(value)); if (key === emptyKey) emptyKey = ''; },
    showToast() {}, navigateTo() {}, pageScrollTo() {},
    showModal(o) { modals.push(o.title); if (o.success) o.success({ confirm: answers.length ? answers.shift() : false }); }
  };
  installStorageIO(wx, db);
});
const bill = (amount, note) => ({ type: 'expense', categoryId: 'food', amount, refund: '0', date: '2024-02-10', time: '12:00', payment: '微信', note });
const notes = s => s.records.map(r => r.note).join(',');
// Two saved versions, then the main key stays listed but reads back empty, as in the 2026-10-10 incident.
function unreadableLedger() { store.saveRecord(bill('10', 'A1')); store.saveRecord(bill('20', 'A2')); emptyKey = store.KEY; }
// The device auto backup that holds both bills.
const latestFile = () => store.diagnostics().candidates.find(c => c.valid && c.id.startsWith('file:xiaorizhang-auto-') && c.records === 2).id;
function oldV2() { const s = core.freshState(); s.version = 2; delete s.assetCategories; delete s.accounts; delete s.accountValueHistory; delete s.settings.assetAmountsHidden; return s; }
function backupPage() {
  let config; global.Page = value => { config = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages/backup/backup.js'); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(value) { Object.assign(this.data, value); } };
  for (const [k, v] of Object.entries(config)) if (typeof v === 'function') p[k] = v.bind(p);
  p.onShow(); return p;
}

test('主账本列在存储里却读出为空时，未经同意的恢复仍被拒绝，并标明可以替换', () => {
  unreadableLedger(); const c = store.recoveryCandidate(latestFile()); writes = [];
  assert.throws(() => store.restoreCandidate(c.id, c.token), e => e.unreadable === true && /主账本无法读取/.test(e.message));
  assert.deepEqual(writes, []);
});

test('同意替换后，可以用设备自动备份恢复读不出的主账本，导入前副本不受影响', () => {
  unreadableLedger(); const c = store.recoveryCandidate(latestFile());
  store.restoreCandidate(c.id, c.token, { replaceUnreadable: true });
  assert.equal(notes(store.read()), 'A1,A2'); assert.equal(db.has(store.SAFETY_KEY), false);
});

test('同意替换后，恢复导入前副本和从聊天导入 JSON 也能完成', () => {
  store.saveRecord(bill('10', 'A1')); const backup = store.backupText();
  const b = core.freshState(); b.records.push(core.createRecord(b, bill('99', 'B1'))); store.restore(b);
  emptyKey = store.KEY;
  store.restoreSafety({ replaceUnreadable: true }); assert.equal(notes(store.read()), 'A1');
  emptyKey = store.KEY;
  store.restore(store.parseBackup(backup), { replaceUnreadable: true }); assert.equal(notes(store.read()), 'A1');
});

test('读取出错或存储目录读不出时，即使同意替换也不恢复', () => {
  store.saveRecord(bill('10', 'A1')); const state = store.read(); const get = wx.getStorageSync; const info = wx.getStorageInfoSync;
  wx.getStorageSync = key => { if (key === store.KEY) throw new Error('I/O'); return get(key); };
  assert.throws(() => store.restore(state, { replaceUnreadable: true }), /无法读取本地账本/);
  wx.getStorageSync = get; wx.getStorageInfoSync = () => { throw new Error('I/O'); };
  assert.throws(() => store.restore(state, { replaceUnreadable: true }), /存储目录/);
  wx.getStorageInfoSync = info;
  assert.equal(notes(store.read()), 'A1');
});

test('主账本读不出时强制恢复，不会把陈旧的旧版账本放进导入前副本', () => {
  unreadableLedger(); db.set(store.V2_KEY, oldV2()); const c = store.recoveryCandidate(latestFile());
  store.restoreCandidate(c.id, c.token, { replaceUnreadable: true });
  assert.equal(notes(store.read()), 'A1,A2'); assert.equal(db.has(store.SAFETY_KEY), false);
});

test('备份页恢复读不出的主账本前再确认一次，取消则不写入任何数据', async () => {
  unreadableLedger(); const p = backupPage(); const event = { currentTarget: { dataset: { id: latestFile() } } };
  answers = [true, false]; modals = []; writes = [];
  await p.recoverCandidate(event);
  assert.deepEqual(modals, ['恢复此本地副本？', '主账本无法读取']); assert.deepEqual(writes, []);
  answers = [true, true]; modals = [];
  await p.recoverCandidate(event);
  assert.deepEqual(modals, ['恢复此本地副本？', '主账本无法读取']);
  assert.equal(notes(store.read()), 'A1,A2'); assert.equal(p.data.storageError, '');
});

test('备份页「恢复导入前副本」遇到读不出的主账本，也先再确认一次', async () => {
  store.saveRecord(bill('10', 'A1'));
  const b = core.freshState(); b.records.push(core.createRecord(b, bill('99', 'B1'))); store.restore(b);
  emptyKey = store.KEY; const p = backupPage(); answers = [true, true]; modals = [];
  p.undoRestore(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(modals, ['恢复到导入前？', '主账本无法读取']); assert.equal(notes(store.read()), 'A1');
});
