const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const store = require('../miniprogram/utils/store');
const persistence = require('../miniprogram/utils/ledger-storage');
const core = require('../miniprogram/utils/core');
const { installStorageIO } = require('./helpers/storage-io');
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
const input = { type: 'expense', amount: '20', refund: '0', categoryId: 'food', date: '2024-02-10', time: '12:00', payment: '微信', note: 'PRIVATE_NOTE' };
let db, io, writes, failKey, errors, confirm;
test.beforeEach(() => {
  db = new Map(); writes = []; failKey = ''; errors = []; confirm = false;
  global.wx = {
    getStorageSync: key => clone(db.get(key)),
    setStorageSync: (key, value) => { if (key === failKey) throw new Error('quota'); writes.push(key); db.set(key, clone(value)); },
    showToast() {}, showModal(o) { errors.push(o.content); if (o.success) o.success({ confirm }); },
    shareFileMessage(o) { o.success(); }, navigateTo() {}
  };
  io = installStorageIO(wx, db);
});
function seed() { store.saveRecord(input); return clone(db.get(store.KEY)); }
function backupPage() {
  let config; global.Page = value => { config = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages/backup/backup.js'); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(value) { Object.assign(this.data, value); } };
  for (const [k, v] of Object.entries(config)) if (typeof v === 'function') p[k] = v.bind(p);
  p.onShow(); return p;
}
function oldV2() { const s = core.freshState(); s.version = 2; delete s.assetCategories; delete s.accounts; delete s.accountValueHistory; delete s.settings.assetAmountsHidden; return s; }
test('首次浏览、启动保护和只读诊断不创建空账本', () => {
  assert.equal(store.read().records.length, 0); store.protect(); backupPage(); store.diagnostics();
  assert.deepEqual(writes, []); assert.equal(io.files.size, 0);
});
test('列出的主键临时返回空值时，不覆盖账本或轮换副本', () => {
  const before = seed(); const files = [...io.files]; writes = [];
  wx.getStorageSync = key => key === store.KEY ? '' : clone(db.get(key));
  assert.throws(() => store.read(), /主账本无法读取/);
  assert.throws(() => store.saveRecord(input), /主账本无法读取/);
  assert.deepEqual(db.get(store.KEY), before); assert.deepEqual([...io.files], files); assert.deepEqual(writes, []);
});
test('即使所有读取都返回空字符串，也不会将已列出的账本当作首次使用', () => {
  const before = seed(); writes = []; wx.getStorageSync = () => '';
  assert.throws(() => store.read()); assert.deepEqual(db.get(store.KEY), before); assert.deepEqual(writes, []);
});
test('存储目录异常时拒绝初始化和保存', () => {
  wx.getStorageInfoSync = () => { throw new Error('I/O'); };
  assert.throws(() => store.read(), /存储目录/); assert.throws(() => store.saveRecord(input)); assert.deepEqual(writes, []);
});
test('文件目录无法检查时拒绝创建空账本', () => {
  io.fs.readdirSync = () => { throw new Error('I/O'); };
  assert.throws(() => store.read(), /备份文件/); assert.deepEqual(writes, []);
});
test('主键丢失后，不静默回退到空的旧版账本', () => {
  seed(); db.set(store.V2_KEY, oldV2()); db.delete(store.KEY); writes = [];
  assert.throws(() => store.read(), /主账本无法读取/); assert.equal(db.has(store.KEY), false); assert.deepEqual(writes, []);
});
test('所有存储键消失但文件副本尚存时，仍阻止静默初始化', () => {
  seed(); db.clear(); writes = [];
  assert.throws(() => store.read(), /主账本无法读取/); assert.deepEqual(writes, []);
  assert.ok(store.diagnostics().candidates.some(c => c.id.startsWith('file:') && c.valid && c.records === 1));
});
test('只有导入前副本也不能创建空主账本，且检查不修改副本', () => {
  const s = core.freshState(); db.set(store.SAFETY_KEY, s); writes = [];
  assert.throws(() => store.read(), /主账本无法读取/); const report = store.diagnostics();
  assert.ok(report.candidates.find(c => c.id === store.SAFETY_KEY).valid); assert.deepEqual(writes, []);
});
test('旧版固定名称 JSON 可以被发现和恢复，原文件不被覆盖', () => {
  const s = seed(); const raw = JSON.stringify({ app: 'daily-expense-miniapp', version: 3, state: s });
  db.clear(); io.files.clear(); io.files.set('/sandbox/xiaorizhang-backup.json', raw);
  assert.throws(() => store.read()); const c = store.recoveryCandidate('file:xiaorizhang-backup.json');
  store.restoreCandidate(c.id, c.token); assert.equal(store.read().records.length, 1);
  assert.equal(io.files.get('/sandbox/xiaorizhang-backup.json'), raw);
});
test('冷启动为已有账本建立保护，但不改写主账本', () => {
  const s = seed(); db.clear(); io.files.clear(); db.set(store.KEY, s); writes = [];
  store.protect(); assert.equal(writes.includes(store.KEY), false); assert.deepEqual(db.get(store.KEY), s);
  assert.ok(db.has(persistence.MARKER)); assert.ok(io.files.has('/sandbox/' + persistence.AUTO_FILES[0]));
});
test('两个快照和两个文件保留最近不同版本，不因重复读取被轮换', () => {
  seed(); store.setBudget('100'); store.setBudget('200'); store.setBudget('300');
  const storage = persistence.SNAPSHOTS.map(k => db.get(k));
  assert.deepEqual(storage.map(s => s.state.settings.budgetCents).sort(), [20000, 30000]);
  assert.equal(io.files.size, 2); const before = [...io.files]; writes = [];
  store.read(); store.read(); store.diagnostics();
  assert.deepEqual(writes, []); assert.deepEqual([...io.files], before);
});
test('保存前快照失败则取消写入，原主账本完整', () => {
  const before = seed(); persistence.SNAPSHOTS.forEach(k => db.delete(k)); failKey = persistence.SNAPSHOTS[0];
  assert.throws(() => store.setBudget('100'), /保存失败/); assert.deepEqual(db.get(store.KEY), before);
});
test('保存前独立文件备份失败则取消写入，原主账本完整', () => {
  const before = seed(); io.files.clear(); io.fs.writeFileSync = () => { throw new Error('disk full'); };
  assert.throws(() => store.setBudget('100'), /保存失败/); assert.deepEqual(db.get(store.KEY), before);
});
test('主账本写入失败不污染有效副本，重试不会重复记录', () => {
  const before = seed(); failKey = store.KEY;
  assert.throws(() => store.saveRecord(input), /保存失败/); assert.deepEqual(db.get(store.KEY), before);
  assert.ok(store.diagnostics().candidates.filter(c => c.valid).every(c => c.records === 1));
  failKey = ''; store.saveRecord(input); assert.equal(store.read().records.length, 2);
});
test('主写入成功后的快照失败只标记保护不足，不谎报保存失败', () => {
  const set = wx.setStorageSync;
  wx.setStorageSync = (key, value) => {
    if (persistence.SNAPSHOTS.includes(key)) throw new Error('quota');
    set(key, value);
  };
  store.saveRecord(input); assert.equal(store.read().records.length, 1);
  const page = backupPage(); assert.match(page.data.protectionWarning, /未完整完成/);
  assert.match(store.diagnostics().events.at(-1).result, /committed-degraded/);
});
test('保护与诊断日志都写入失败时，本次会话仍显示保护不足', () => {
  const set = wx.setStorageSync;
  wx.setStorageSync = (key, value) => { if (key !== store.KEY) throw new Error('quota'); set(key, value); };
  store.saveRecord(input); assert.equal(store.read().records.length, 1); assert.match(store.protectionWarning(), /未完整完成/);
});
test('主写入被静默丢弃时必须报结果无法核实，不报成功', () => {
  const before = seed(); const set = wx.setStorageSync;
  wx.setStorageSync = (key, value) => { if (key !== store.KEY) set(key, value); };
  assert.throws(() => store.setBudget('100'), /结果无法核实/); assert.deepEqual(db.get(store.KEY), before);
});
test('平台返回对象引用时，失败的修改也不能改变存储中的原对象', () => {
  const before = seed(); wx.getStorageSync = key => db.has(key) ? db.get(key) : '';
  failKey = store.KEY; assert.throws(() => store.saveRecord(input)); assert.deepEqual(db.get(store.KEY), before);
});
test('导出时间变化不挤掉上一版业务数据', () => {
  seed(); store.setBudget('100'); store.markBackup(); store.markBackup();
  assert.deepEqual(persistence.SNAPSHOTS.map(k => db.get(k).state.settings.budgetCents).sort(), [0, 10000]);
});
test('返回较旧业务状态后，下一次修改仍保留直接上一版', () => {
  seed(); store.setBudget('100'); store.setBudget('0'); store.setBudget('200');
  assert.deepEqual(persistence.SNAPSHOTS.map(k => db.get(k).state.settings.budgetCents).sort(), [0, 20000]);
  assert.deepEqual([...io.files.values()].map(text => JSON.parse(text).state.settings.budgetCents).sort(), [0, 20000]);
});
test('存储目录不可读时仍可只读检查并导出独立文件副本', async () => {
  seed(); wx.getStorageInfoSync = () => { throw new Error('I/O'); }; writes = [];
  const report = store.diagnostics(); const item = report.candidates.find(c => c.valid && c.id.startsWith('file:'));
  assert.ok(item); const page = backupPage();
  await page.exportCandidate({ currentTarget: { dataset: { id: item.id } } });
  assert.match(page.data.fileName, /^xiaorizhang-backup-/); assert.deepEqual(writes, []);
});
test('文件轮换重命名中断时保留另一份完整文件及可读取临时副本', () => {
  seed(); store.setBudget('100');
  io.fs.renameSync = () => { throw new Error('interrupted'); };
  store.setBudget('200'); // Primary committed; file rotation is degraded.
  const copies = store.diagnostics().candidates.filter(c => c.id.startsWith('file:') && c.valid);
  assert.ok(copies.some(c => c.id.endsWith('.tmp')));
  assert.ok(copies.some(c => !c.id.endsWith('.tmp')));
  assert.equal(store.read().settings.budgetCents, 20000);
});
test('JSON 文件名冲突时拒绝覆盖旧文件', async () => {
  const files = require('../miniprogram/utils/files');
  io.files.set('/sandbox/xiaorizhang-backup-collision.json', 'original');
  await assert.rejects(files.writeFile('xiaorizhang-backup-collision.json', 'new'), /未覆盖/);
  assert.equal(io.files.get('/sandbox/xiaorizhang-backup-collision.json'), 'original');
});
test('一个副本校验失败不妨碍发现其他有效副本', () => {
  seed(); store.setBudget('100'); const value = db.get(persistence.SNAPSHOTS[0]); value.state.records[0].amountCents++;
  const report = store.diagnostics(); assert.equal(report.candidates.find(c => c.id === persistence.SNAPSHOTS[0]).valid, false);
  assert.ok(report.candidates.find(c => c.id === persistence.SNAPSHOTS[1]).valid);
});
test('损坏主账本可以显式从副本恢复，损坏原文保留在导入前副本', () => {
  seed(); db.set(store.KEY, { corrupt: 'original' }); const c = store.recoveryCandidate(persistence.SNAPSHOTS[0]);
  store.restoreCandidate(c.id, c.token); assert.equal(store.read().records.length, 1);
  assert.deepEqual(db.get(store.SAFETY_KEY), { corrupt: 'original' });
});
test('预览后副本发生变化时拒绝恢复', () => {
  seed(); const c = store.recoveryCandidate(persistence.SNAPSHOTS[0]);
  store.setBudget('100'); store.setBudget('200'); const before = store.read();
  assert.throws(() => store.restoreCandidate(c.id, c.token), /副本已变化/); assert.deepEqual(store.read(), before);
});
test('没有主账本的恢复不会把现有导入前副本覆盖为空', () => {
  const before = seed(); db.delete(store.KEY); db.set(store.SAFETY_KEY, before);
  const c = store.recoveryCandidate(persistence.SNAPSHOTS[0]); store.restoreCandidate(c.id, c.token);
  assert.deepEqual(db.get(store.SAFETY_KEY), before);
});
test('恢复预览取消不写数据，异常账本仍可导出有效副本', async () => {
  seed(); db.set(store.KEY, { broken: true }); const before = [...db]; const page = backupPage(); writes = [];
  const event = { currentTarget: { dataset: { id: persistence.SNAPSHOTS[0] } } };
  await page.recoverCandidate(event); assert.deepEqual(writes, []); assert.deepEqual([...db], before);
  await page.exportCandidate(event); assert.match(page.data.fileName, /^xiaorizhang-backup-/);
  assert.deepEqual(writes, []); assert.deepEqual([...db], before);
});
test('显式确认恢复本地副本后刷新页面', async () => {
  seed(); db.delete(store.KEY); const page = backupPage(); confirm = true;
  await page.recoverCandidate({ currentTarget: { dataset: { id: persistence.SNAPSHOTS[0] } } });
  assert.equal(page.data.storageError, ''); assert.equal(page.data.count, 1); assert.equal(page.data.busy, false);
});
test('诊断日志限制为40条，摘要不含账单或账户明细', () => {
  seed(); for (let i = 0; i < 45; i++) store.setBudget(String(i));
  const report = store.diagnostics(); assert.equal(report.events.length, 40);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_NOTE')); assert.ok(!JSON.stringify(report).includes('amountCents'));
  writes = []; store.diagnostics(); assert.deepEqual(writes, []);
});
test('JSON 连续导出不覆盖以前生成的同名备份', async () => {
  seed(); io.files.set('/sandbox/xiaorizhang-backup.json', 'original'); const page = backupPage();
  await page.exportFile('json'); const first = page.data.fileName;
  await page.exportFile('json'); assert.notEqual(page.data.fileName, first);
  assert.ok(io.files.has('/sandbox/' + first)); assert.equal(io.files.get('/sandbox/xiaorizhang-backup.json'), 'original');
});
test('首次主动导出空账本后仍能继续记账', async () => {
  const page = backupPage(); await page.exportFile('json');
  assert.ok(db.has(store.KEY)); store.saveRecord(input); assert.equal(store.read().records.length, 1);
});
test('设备日期回退后已存资产和账单仍可读取和备份，新金额输入仍禁止未来日期', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T12:00:00+08:00') });
  seed(); const account = store.saveAccount({ kind: 'asset', categoryId: 'asset_bank', name: '测试账户', amount: '100', valuedOn: '2026-10-10', cardLast4: '', note: '' });
  const before = clone(db.get(store.KEY)); t.mock.timers.setTime(new Date('2026-10-09T12:00:00+08:00').getTime());
  assert.equal(store.read().accounts.length, 1); assert.equal(store.parseBackup(store.backupText()).accounts.length, 1);
  assert.throws(() => store.updateAccountValue(account.id, { amount: '120', valuedOn: '2026-10-10', note: '' }), /今天/);
  assert.deepEqual(db.get(store.KEY), before);
});
