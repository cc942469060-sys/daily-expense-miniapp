const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const core = require('../miniprogram/utils/core');
const store = require('../miniprogram/utils/store');
const persistence = require('../miniprogram/utils/ledger-storage');
const { installStorageIO } = require('./helpers/storage-io');
// Documented wx storage limits: 1MB per key and 10MB for all keys of one mini program.
const KEY_LIMIT = 1024 * 1024; const TOTAL_LIMIT = 10 * 1024 * 1024;
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
const bytes = v => Buffer.byteLength(JSON.stringify(v));
const input = { type: 'expense', amount: '20', refund: '0', categoryId: 'food', date: '2024-02-10', time: '12:00', payment: '微信', note: '午饭' };
let db, sizes, writes, failWrite;
const used = () => [...sizes.values()].reduce((a, b) => a + b, 0);
function put(key, value) { db.set(key, clone(value)); sizes.set(key, bytes(value)); }
function platform() {
  global.wx = { showToast() {}, showModal(o) { if (o.success) o.success({ confirm: true }); }, navigateTo() {}, navigateBack() {}, setNavigationBarTitle() {}, pageScrollTo() {} };
  installStorageIO(wx, db);
  wx.getStorageSync = key => clone(db.get(key));
  wx.setStorageSync = (key, value) => {
    if (failWrite && failWrite(key)) throw new Error('setStorageSync:fail exceed storage max size 10MB');
    const n = bytes(value);
    if (n > KEY_LIMIT) throw new Error('setStorageSync:fail exceed storage item max length');
    if (used() - (sizes.get(key) || 0) + n > TOTAL_LIMIT) throw new Error('setStorageSync:fail exceed storage max size 10MB');
    writes.push(key); put(key, value);
  };
  wx.removeStorageSync = key => { sizes.delete(key); db.delete(key); };
  wx.getStorageInfoSync = () => ({ keys: [...db.keys()], currentSize: Math.ceil(used() / 1024), limitSize: TOTAL_LIMIT / 1024 });
}
// A new wx object starts a new runtime session, so nothing is served from in-memory caches.
function restart() { global.wx = Object.assign({}, wx); }
function bills(count, from = 0) {
  const notes = ['', '午饭', '地铁', '超市买菜', '房租', '外卖晚饭', '给孩子买书', ''];
  return Array.from({ length: count }, (_, i) => {
    const n = from + i; const t = Date.UTC(2016, 0, 1) + n * 3 * 3600 * 1000;
    return { id: 'bill_' + n.toString(36).padStart(6, '0') + '_' + (Math.imul(n + 1, 2654435761) >>> 0).toString(36), type: n % 15 ? 'expense' : 'income', categoryId: n % 15 ? ['food', 'transport', 'shopping', 'home'][n % 4] : 'income_salary', amountCents: 100 + (n * 7919) % 50000, refundCents: 0, payment: ['微信', '支付宝', '银行卡', '未指定'][n % 4], date: new Date(Math.min(t, Date.UTC(2026, 0, 1))).toISOString().slice(0, 10), time: '12:' + String(n % 60).padStart(2, '0'), note: notes[n % notes.length], createdAt: t, updatedAt: t };
  });
}
function ledger(count) { const s = core.freshState(); s.records = bills(count); return s; }
function chunkKeys() { return [...db.keys()].filter(k => k.startsWith(persistence.CHUNK_PREFIX)).sort(); }
function page(name) {
  let config; global.Page = value => { config = value; };
  const file = path.resolve(__dirname, `../miniprogram/pages/${name}/${name}.js`); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(value) { Object.assign(this.data, value); } };
  for (const [k, v] of Object.entries(config)) if (typeof v === 'function') p[k] = v.bind(p);
  return p;
}
test.beforeEach(() => { db = new Map(); sizes = new Map(); writes = []; failWrite = null; platform(); });

test('超过 1MB 的账本仍可新增、修改和删除，没有单个存储键超过上限', () => {
  const s = ledger(6000); assert.ok(bytes(s) > KEY_LIMIT);
  store.write(s);
  const added = store.saveRecord(input); store.saveRecord(Object.assign({}, input, { amount: '12.30' }), added.id);
  store.removeRecord(s.records[10].id);
  restart(); const after = store.read();
  assert.equal(after.records.length, 6000); assert.equal(after.records.find(r => r.id === added.id).amountCents, 1230);
  assert.ok(!after.records.some(r => r.id === s.records[10].id));
  assert.equal(db.get(store.KEY).layout, 'chunked'); assert.ok(chunkKeys().length >= 4);
  assert.ok(Math.max(...sizes.values()) < KEY_LIMIT / 2);
});

test('旧版卡在 1MB 上限的单键账本，升级后可继续新增和删除，原账本留作快照', () => {
  const all = bills(6000); let lo = 1; let hi = all.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; const s = core.freshState(); s.records = all.slice(0, mid); if (bytes(s) <= KEY_LIMIT) lo = mid; else hi = mid - 1; }
  const s = core.freshState(); s.records = all.slice(0, lo); s.updatedAt = '2026-01-02T00:00:00.000Z';
  const older = clone(s); older.records = older.records.slice(0, 4000); older.updatedAt = '2025-12-01T00:00:00.000Z';
  // v1.4.4 left the latest version unprotected because its snapshot envelope no longer fit in one key.
  put(store.KEY, s); put(persistence.MARKER, { version: 1 });
  put(persistence.SNAPSHOTS[0], { format: 1, sequence: 3, savedAt: '2025-12-01T00:00:00.000Z', checksum: persistence.checksum(older), state: older });
  store.saveRecord(input); store.removeRecord(s.records[0].id);
  restart(); assert.equal(store.read().records.length, lo); assert.equal(db.get(store.KEY).layout, 'chunked');
  const copies = persistence.candidates().filter(c => c.valid && persistence.SNAPSHOTS.includes(c.id)).map(c => c.records);
  assert.ok(copies.includes(lo)); assert.ok(Math.max(...writes.map(k => sizes.get(k) || 0)) < KEY_LIMIT / 2);
});

test('写入分块中途失败时账本不变，也不残留新分块', () => {
  store.write(ledger(3000)); const before = store.read(); const chunks = chunkKeys();
  let n = 0; failWrite = key => key.startsWith(persistence.CHUNK_PREFIX) && ++n === 2;
  assert.throws(() => store.removeCategory('food', 'other'), /保存失败：本地空间不足/);
  failWrite = null; assert.deepEqual(chunkKeys(), chunks);
  restart(); assert.deepEqual(store.read(), before);
});

test('索引写入失败时清理新分块，账本保持原样，重试成功', () => {
  store.write(ledger(1000)); const before = store.read(); const chunks = chunkKeys();
  failWrite = key => key === store.KEY;
  assert.throws(() => store.saveRecord(input), /保存失败/);
  failWrite = null; assert.deepEqual(chunkKeys(), chunks); assert.deepEqual(store.read(), before);
  store.saveRecord(input); assert.equal(store.read().records.length, 1001);
});

test('分块损坏或缺失时拒绝读取和保存，不覆盖原数据，设备文件副本仍可恢复', () => {
  store.write(ledger(3000)); const root = clone(db.get(store.KEY)); const victim = root.records[1].key;
  const damaged = db.get(victim).replace('"bill_', '"bilx_'); db.set(victim, damaged); restart(); writes = [];
  assert.throws(() => store.read(), /数据异常/); assert.throws(() => store.saveRecord(input));
  assert.deepEqual(writes, []); assert.deepEqual(db.get(store.KEY), root); assert.equal(db.get(victim), damaged);
  db.delete(victim); restart();
  assert.throws(() => store.read(), /数据异常/);
  assert.equal(persistence.candidates().find(c => c.id === store.KEY).valid, false);
  assert.ok(persistence.candidates().some(c => c.valid && c.id.startsWith('file:') && c.records === 3000));
});

test('分块读写保持账单顺序与字段顺序', () => {
  const s = ledger(2500); s.records.reverse(); s.records.splice(100, 0, s.records.pop()); s.settings.budgetCents = 4200;
  store.write(s, false); restart();
  assert.equal(JSON.stringify(store.read()), JSON.stringify(s));
  assert.equal(JSON.stringify(store.parseBackup(store.backupText())), JSON.stringify(s));
});

test('大账本的恢复前副本只保存索引，可完整找回', () => {
  store.write(ledger(6000)); const before = store.read();
  store.restore(core.freshState()); assert.equal(store.read().records.length, 0);
  const safety = db.get(store.SAFETY_KEY); assert.equal(safety.layout, 'chunked'); assert.ok(bytes(safety) < 64 * 1024);
  restart(); store.restoreSafety(); assert.deepEqual(store.read().records, before.records);
});

test('只更新备份时间时不重写任何分块', () => {
  store.write(ledger(3000)); writes = [];
  store.markBackup();
  assert.ok(writes.includes(store.KEY)); assert.ok(!writes.some(k => k.startsWith(persistence.CHUNK_PREFIX)));
});

test('多次保存后只保留被引用的分块', () => {
  store.write(ledger(3000));
  for (let i = 0; i < 8; i++) store.saveRecord(Object.assign({}, input, { note: '第' + i + '笔' }));
  store.setBudget('100'); store.removeRecord(store.read().records[0].id);
  const live = new Set(); const refs = m => [m.meta, ...m.records, ...m.history].forEach(r => live.add(r.key));
  refs(db.get(store.KEY)); persistence.SNAPSHOTS.forEach(k => refs(db.get(k).manifest));
  assert.deepEqual(chunkKeys(), [...live].sort());
});

test('存储总量用满时保存失败，原账本完整，不残留新分块', () => {
  store.write(ledger(500)); const before = store.read(); const chunks = chunkKeys();
  // Fill the rest of the quota with other data, leaving room only for tiny writes.
  for (let i = 0; used() < TOTAL_LIMIT - 4096; i++) put('other:' + i, 'x'.repeat(Math.min(900 * 1024, TOTAL_LIMIT - 4096 - used())));
  assert.throws(() => store.saveRecord(input), /保存失败：本地空间不足/);
  assert.deepEqual(chunkKeys(), chunks); restart(); assert.deepEqual(store.read(), before);
});

test('存储用满时释放较旧的存储快照，仍可删除账单', () => {
  // The category migration rewrites every chunk, so the older snapshot holds a full extra version.
  store.write(ledger(3000)); store.removeCategory('shopping', 'other');
  const count = store.read().records.length; const victim = store.read().records[1500].id;
  for (let i = 0; used() < TOTAL_LIMIT - 512; i++) put('other:' + i, 'x'.repeat(Math.min(900 * 1024, TOTAL_LIMIT - 512 - used())));
  store.removeRecord(victim);
  restart(); const after = store.read();
  assert.equal(after.records.length, count - 1); assert.ok(!after.records.some(r => r.id === victim));
  assert.ok(persistence.candidates().some(c => c.valid && c.id.startsWith('file:') && c.records === count));
});

test('存储接近上限时首页和备份页提示容量', () => {
  store.saveRecord(input);
  const info = wx.getStorageInfoSync; wx.getStorageInfoSync = () => Object.assign(info(), { currentSize: 8800, limitSize: 10240 });
  const home = page('home'); home.onShow(); assert.match(home.data.capacityWarning, /已用 86%/);
  const backup = page('backup'); backup.onShow(); assert.equal(backup.data.storageUsage, '8.6 MB / 10 MB'); assert.ok(backup.data.capacityWarning);
  wx.getStorageInfoSync = info; home.onShow(); assert.equal(home.data.capacityWarning, '');
});
