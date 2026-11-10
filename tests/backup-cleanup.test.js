const test = require('node:test'); const assert = require('node:assert/strict');
const core = require('../miniprogram/utils/core'); const store = require('../miniprogram/utils/store'); const dates = require('../miniprogram/utils/date');
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
const input = { type: 'expense', amount: '20', refund: '0', categoryId: 'food', date: '2024-02-10', time: '12:00', payment: '微信', note: '' };
let db; let io; let confirm; let modals;
function page() {
  let config; global.Page = v => { config = v; }; const file = require.resolve('../miniprogram/pages/backup/backup'); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(v) { Object.assign(this.data, v); } };
  Object.entries(config).forEach(([k, v]) => { if (typeof v === 'function') p[k] = v.bind(p); }); p.onShow(); return p;
}
function backup(name, exportedAt, updatedAt = '2024-01-01T00:00:00.000Z') {
  const s = core.freshState(); s.updatedAt = updatedAt;
  io.files.set('/sandbox/' + name, JSON.stringify({ app: 'daily-expense-miniapp', version: 3, exportedAt, state: s }, null, 2));
  return 'file:' + name;
}
const path = id => '/sandbox/' + id.slice(5);
const event = id => ({ currentTarget: { dataset: { id } } });
const local = iso => { const d = new Date(iso); return dates.dateKey(d) + ' ' + dates.timeKey(d); };
test.beforeEach(() => {
  db = new Map(); confirm = false; modals = [];
  global.wx = { getStorageSync: k => clone(db.get(k)), setStorageSync: (k, v) => db.set(k, clone(v)), showToast() {}, pageScrollTo() {}, showModal(o) { modals.push(o); if (o.success) o.success({ confirm }); } };
  io = require('./helpers/storage-io').installStorageIO(wx, db); store.write(core.freshState());
});

test('历史导出折叠时只列出文件名和大小，展开后才读取检查', () => {
  const old = backup('xiaorizhang-backup-100-1-a.json', '2024-01-01T00:00:00Z'); const latest = backup('xiaorizhang-backup-200-1-b.json', '2025-01-01T00:00:00Z');
  const read = io.fs.readFileSync; const reads = []; io.fs.readFileSync = (p, e) => { reads.push(p); return read(p, e); };
  const p = page();
  assert.equal(p.data.latestExport.id, latest); assert.equal(p.data.latestExport.valid, true);
  assert.equal(p.data.historyExports[0].id, old); assert.equal(p.data.historyExports[0].pending, true);
  assert.ok(p.data.historyExports[0].size > 0); assert.ok(p.data.exportSizeText); assert.ok(!reads.includes(path(old)));
  p.toggleHistory(); assert.equal(p.data.historyExports[0].valid, true); assert.ok(reads.includes(path(old)));
});

test('删除单个导出需确认，只删除该文件，账本和自动副本不变', () => {
  const old = backup('xiaorizhang-backup-100-1-a.json', '2024-01-01T00:00:00Z'); const latest = backup('xiaorizhang-backup-200-1-b.json', '2025-01-01T00:00:00Z');
  const p = page(); p.toggleHistory(); const ledger = clone(db.get(store.KEY));
  const autos = [...io.files.keys()].filter(k => k.includes('xiaorizhang-auto-')); assert.ok(autos.length);
  p.removeExport(event(old)); assert.ok(io.files.has(path(old))); assert.equal(p.data.busy, false);
  assert.match(modals.at(-1).content, /xiaorizhang-backup-100-1-a\.json.*无法恢复/);
  confirm = true; p.removeExport(event(old));
  assert.ok(!io.files.has(path(old))); assert.ok(io.files.has(path(latest))); assert.ok(autos.every(k => io.files.has(k)));
  assert.deepEqual(db.get(store.KEY), ledger); assert.deepEqual(p.data.historyExports, []); assert.equal(p.data.latestExport.id, latest);
});

test('删除全部历史导出时保留最近一份', () => {
  for (const [time, tag] of [[100, 'a'], [200, 'b'], [300, 'c']]) backup(`xiaorizhang-backup-${time}-1-${tag}.json`, new Date(time).toISOString());
  const p = page(); p.toggleHistory(); confirm = true; p.removeHistory();
  assert.match(modals.at(-1).content, /2 个较早的 JSON 导出文件/);
  assert.deepEqual([...io.files.keys()].filter(k => k.includes('xiaorizhang-backup-')), ['/sandbox/xiaorizhang-backup-300-1-c.json']);
  assert.equal(p.data.historyExports.length, 0); assert.equal(p.data.latestExport.fileName, 'xiaorizhang-backup-300-1-c.json');
});

test('只能删除手动导出，账本读取异常时禁止删除', () => {
  const old = backup('xiaorizhang-backup-100-1-a.json', '2024-01-01T00:00:00Z'); backup('xiaorizhang-backup-200-1-b.json', '2025-01-01T00:00:00Z');
  for (const ids of [['file:xiaorizhang-auto-0.json'], [store.KEY], ['file:../xiaorizhang-backup-1-1-a.json'], []]) assert.throws(() => store.removeExports(ids), /只能删除手动导出/);
  db.set(store.KEY, { broken: true }); const p = page(); p.toggleHistory(); confirm = true; p.removeExport(event(old));
  assert.ok(io.files.has(path(old))); assert.match(modals.at(-1).content, /账本读取异常时不能删除/); assert.equal(p.data.busy, false);
});

test('删除刚生成、待发送的文件后清除发送入口', async () => {
  const p = page(); await p.exportFile('json'); const id = p.data.pendingId; assert.ok(io.files.has(path(id)));
  confirm = true; p.removeExport(event(id));
  assert.ok(!io.files.has(path(id))); assert.equal(p.data.pendingId, ''); assert.equal(p.pendingFile, null); assert.equal(p.data.latestExport, null);
});

test('备份页按本地时间显示生成时间、账本时间和恢复确认', async () => {
  const id = backup('xiaorizhang-backup-100-1-a.json', '2024-01-01T00:00:00.000Z', '2023-12-31T23:30:00.000Z');
  const p = page();
  assert.equal(p.data.latestExport.savedText, local('2024-01-01T00:00:00.000Z')); assert.equal(p.data.latestExport.updatedText, local('2023-12-31T23:30:00.000Z'));
  assert.ok(p.data.recoveryCopies.filter(c => c.valid).every(c => !/[TZ]/.test(c.updatedText + c.savedText)));
  await p.recoverCandidate(event(id)); assert.match(modals.at(-1).content, new RegExp('账本时间 ' + local('2023-12-31T23:30:00.000Z')));
});

test('设备文件空间用满时提示删除导出，释放空间后可继续保存', () => {
  store.saveRecord(input);
  const write = io.fs.writeFileSync; io.fs.writeFileSync = () => { throw new Error('writeFileSync:fail the maximum size of the file storage limit is exceeded'); };
  store.saveRecord(input); assert.match(store.protectionWarning(), /设备文件空间不足.*删除不需要的导出文件/);
  assert.throws(() => store.saveRecord(input), /设备文件空间不足.*删除不需要的导出文件后重试/);
  assert.equal(store.read().records.length, 2);
  io.fs.writeFileSync = write; store.saveRecord(input); assert.equal(store.read().records.length, 3);
});
