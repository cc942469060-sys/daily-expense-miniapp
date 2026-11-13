const test = require('node:test'); const assert = require('node:assert/strict');
const store = require('../miniprogram/utils/store'); const core = require('../miniprogram/utils/core'); const persistence = require('../miniprogram/utils/ledger-storage');
const { installStorageIO } = require('./helpers/storage-io');
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
let db; let failKey; let failMessage;
test.beforeEach(() => {
  db = new Map(); failKey = ''; failMessage = 'setStorageSync:fail simulated io error';
  global.wx = {
    getStorageSync: key => clone(db.get(key)),
    setStorageSync: (key, value) => { if (key === failKey) throw new Error(failMessage); db.set(key, clone(value)); },
    showToast() {}, showModal() {}
  };
  installStorageIO(wx, db);
});
const bill = (amount, note) => ({ type: 'expense', categoryId: 'food', amount, refund: '0', date: '2024-02-10', time: '12:00', payment: '微信', note });
const notes = s => s.records.map(r => r.note).join(',');
const safetyNotes = () => notes(store.recoveryCandidate(store.SAFETY_KEY).state);
// Ledger A, then an imported ledger B and one more change: by then the rotating snapshots and
// device files hold only B, so A survives only in the before-import copy.
function importedWithChange() {
  store.saveRecord(bill('10', 'A1')); store.saveRecord(bill('20', 'A2')); store.saveRecord(bill('30', 'A3'));
  const b = core.freshState(); b.records.push(core.createRecord(b, bill('99', 'B1'))); store.restore(b);
  store.saveRecord(bill('5', 'B2'));
  assert.equal(safetyNotes(), 'A1,A2,A3');
}

test('恢复导入前副本时写入失败，导入前副本保持不变，之后仍可恢复', () => {
  importedWithChange();
  failKey = store.KEY;
  assert.throws(() => store.restoreSafety(), /保存失败/);
  failKey = '';
  assert.equal(notes(store.read()), 'B1,B2'); assert.equal(safetyNotes(), 'A1,A2,A3');
  // An ordinary save runs chunk cleanup; the copy must survive it.
  store.saveRecord(bill('1', 'B3')); assert.equal(safetyNotes(), 'A1,A2,A3');
  store.restoreSafety();
  assert.equal(notes(store.read()), 'A1,A2,A3'); assert.equal(safetyNotes(), 'B1,B2,B3');
});

test('从副本列表恢复导入前副本时写入失败，副本保持不变', () => {
  importedWithChange();
  const c = store.recoveryCandidate(store.SAFETY_KEY); failKey = store.KEY;
  assert.throws(() => store.restoreCandidate(c.id, c.token), /保存失败/);
  failKey = '';
  assert.equal(notes(store.read()), 'B1,B2'); assert.equal(safetyNotes(), 'A1,A2,A3');
});

test('存储已满、释放较旧快照后仍写不进去时，导入前副本的分块不被清理', () => {
  importedWithChange();
  failKey = store.KEY; failMessage = 'setStorageSync:fail exceed storage max size';
  assert.throws(() => store.restoreSafety(), /保存失败/);
  failKey = '';
  // The retry after a full quota really released one storage snapshot.
  assert.equal(persistence.SNAPSHOTS.filter(key => db.has(key)).length, 1);
  assert.equal(notes(store.read()), 'B1,B2'); assert.equal(safetyNotes(), 'A1,A2,A3');
});

test('导入其他备份失败时，已有的导入前副本保持不变', () => {
  importedWithChange();
  const c = core.freshState(); c.records.push(core.createRecord(c, bill('7', 'C1')));
  failKey = store.KEY;
  assert.throws(() => store.restore(c), /保存失败/);
  failKey = '';
  assert.equal(notes(store.read()), 'B1,B2'); assert.equal(safetyNotes(), 'A1,A2,A3');
});

test('原本没有导入前副本时导入失败，也不会留下一个', () => {
  store.saveRecord(bill('10', 'A1')); assert.equal(store.hasSafety(), false);
  failKey = store.KEY;
  assert.throws(() => store.restore(core.freshState()), /保存失败/);
  failKey = '';
  assert.equal(store.hasSafety(), false); assert.equal(notes(store.read()), 'A1');
});

test('主账本写入结果无法核实时，保留刚存入的恢复前副本，不换回旧副本', () => {
  importedWithChange();
  // The main write lands but reads back differently, so the restore may have taken effect and
  // the copy just made of B is the one to keep.
  const set = wx.setStorageSync;
  wx.setStorageSync = (key, value) => set(key, key === store.KEY ? Object.assign({}, value, { check: 'x' }) : value);
  assert.throws(() => store.restoreSafety(), /无法核实/);
  wx.setStorageSync = set;
  assert.equal(safetyNotes(), 'B1,B2');
});
