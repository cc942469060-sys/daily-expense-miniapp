const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path');
const core = require('../miniprogram/utils/core'); const assets = require('../miniprogram/utils/assets'); const store = require('../miniprogram/utils/store'); const dates = require('../miniprogram/utils/date');
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
let db; let failKey; let writes; let modals; let navigation; let confirm;
const input = extra => Object.assign({ kind: 'asset', categoryId: 'asset_bank', name: '工资卡', amount: '1000.01', valuedOn: '2024-02-29', cardLast4: '0123', note: '备用金' }, extra);
const value = extra => Object.assign({ amount: '1234.56', valuedOn: '2024-03-01', note: '核对余额' }, extra);
const event = dataset => ({ currentTarget: { dataset } });
function oldV2() {
  const s = core.freshState(); s.version = 2;
  delete s.accounts; delete s.assetCategories; delete s.accountValueHistory; delete s.settings.assetAmountsHidden;
  s.records.push(core.createRecord(s, { type: 'income', categoryId: 'income_salary', amount: '8000', refund: '0', date: '2024-02-29', time: '12:00', payment: '银行卡', note: '工资' }));
  s.settings.budgetCents = 200000; s.updatedAt = '2024-03-01T00:00:00.000Z'; s.lastBackupAt = '2024-03-02T00:00:00.000Z'; return s;
}
function page(name, options) {
  let config; global.Page = value => { config = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/' + name + '.js'); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(v) { Object.assign(this.data, v); } };
  Object.entries(config).forEach(([k, v]) => { if (typeof v === 'function') p[k] = v.bind(p); });
  if (p.onLoad) p.onLoad(options || {}); if (p.onShow) p.onShow(); return p;
}
test.beforeEach(() => {
  db = new Map(); failKey = ''; writes = 0; modals = []; navigation = []; confirm = true;
  global.wx = {
    getStorageSync: key => clone(db.get(key)), setStorageSync: (key, s) => { if (key === failKey) throw new Error('full'); db.set(key, clone(s)); writes++; },
    showToast: () => {}, showModal: o => { modals.push(o); if (o.success) o.success({ confirm }); if (o.complete) o.complete(); },
    navigateTo: o => navigation.push(o.url), navigateBack: () => navigation.push('back'), setNavigationBarTitle: () => {}, pageScrollTo: () => {}
  };
});

test('新账本有资产与负债预设、空账户和独立金额精度', () => {
  const s = store.read(); assert.equal(s.version, 3); assert.equal(s.accounts.length, 0); assert.equal(s.accountValueHistory.length, 0);
  assert.deepEqual(s.assetCategories.filter(c => c.kind === 'asset').map(c => c.name), ['银行卡', '支付宝', '微信', '股票', '国债', '黄金', '基金/理财', '现金', '其他资产']);
  assert.equal(s.assetCategories.filter(c => c.kind === 'liability').length, 6);
  assert.equal(assets.amountToCents('0'), 0); assert.equal(assets.amountToCents('0.10') + assets.amountToCents('0.20'), 30);
  assert.equal(assets.amountToCents('999999999.99'), 99999999999);
  for (const bad of ['', '-1', '1.234', '1e3', 'NaN', '1000000000', 'Infinity']) assert.throws(() => assets.amountToCents(bad));
});

test('汇总资产负债与负净资产，重名账户并存且与收支预算互不联动', () => {
  const a = store.saveAccount(input({ amount: '160000' }));
  store.saveAccount(input({ kind: 'liability', categoryId: 'debt_mortgage', amount: '60000' }));
  assert.deepEqual(assets.summary(store.read()), { assetCents: 16000000, liabilityCents: 6000000, netCents: 10000000 });
  store.saveAccount(input({ amount: '0' }));
  store.saveRecord({ type: 'expense', categoryId: 'food', amount: '20', refund: '5', date: '2024-02-29', time: '12:00', payment: '现金', note: '' });
  store.setBudget('100'); const before = store.read();
  store.updateAccountValue(a.id, value({ amount: '10' })); const after = store.read();
  assert.deepEqual(after.records, before.records); assert.deepEqual(after.settings, before.settings);
  assert.equal(core.summarize(after.records).expenseText, '15.00'); assert.equal(assets.summary(after).netCents, -5999000);
});

test('开户和更新金额各单次写入，资料修改不产生历史，同金额可刷新日期', () => {
  store.read(); writes = 0; const a = store.saveAccount(input()); assert.equal(writes, 1);
  let s = store.read(); const first = s.accountValueHistory[0]; assert.equal(first.reason, 'opening'); assert.equal(first.previousCents, null); assert.equal(first.recordedAt, a.createdAt);
  store.saveAccount(input({ name: '招行工资卡', categoryId: 'asset_cash', amount: '999' }), a.id);
  s = store.read(); assert.equal(s.accountValueHistory.length, 1); assert.equal(s.accounts[0].amountCents, 100001); assert.equal(s.accounts[0].name, '招行工资卡');
  writes = 0; store.updateAccountValue(a.id, value({ amount: '1000.01' })); assert.equal(writes, 1);
  s = store.read(); assert.equal(s.accounts[0].valuedOn, '2024-03-01'); assert.equal(s.accountValueHistory[1].previousCents, 100001); assert.equal(s.accountValueHistory[1].amountCents, 100001);
  store.updateAccountValue(a.id, value({ amount: '0' })); assert.equal(store.read().accounts[0].amountCents, 0);
});

test('拒绝跨类型、负数、无效尾号、未来日期及倒序金额更新，失败不写入', () => {
  const a = store.saveAccount(input()); const before = clone(db.get(store.KEY));
  for (const bad of [input({ kind: 'liability' }), input({ name: '' }), input({ name: '字'.repeat(25) }), input({ cardLast4: '12345' }), input({ cardLast4: 'abcd' }), input({ note: '字'.repeat(201) }), input({ amount: '-1' }), input({ valuedOn: '2024-02-30' }), input({ valuedOn: '2100-01-01' })]) assert.throws(() => store.saveAccount(bad));
  assert.throws(() => store.saveAccount(input({ kind: 'liability', categoryId: 'debt_credit' }), a.id), /类型/);
  assert.throws(() => store.updateAccountValue(a.id, value({ valuedOn: '2024-02-28' })), /上次/);
  assert.throws(() => store.updateAccountValue(a.id, value({ valuedOn: '2100-01-01' })), /今天/);
  assert.throws(() => store.updateAccountValue('missing', value()), /不存在/);
  assert.deepEqual(db.get(store.KEY), before);
});

test('金额更新写入失败保持账户和历史一致，重试只增加一次', () => {
  const a = store.saveAccount(input()); const before = clone(db.get(store.KEY)); failKey = store.KEY;
  assert.throws(() => store.updateAccountValue(a.id, value()), /保存失败/); assert.deepEqual(db.get(store.KEY), before);
  assert.throws(() => store.saveAccount(input()), /保存失败/); assert.deepEqual(db.get(store.KEY), before);
  failKey = ''; store.updateAccountValue(a.id, value()); const s = store.read();
  assert.equal(s.accountValueHistory.length, 2); assert.equal(s.accounts[0].amountCents, 123456); core.validateState(s);
});

test('归档只允许零余额，保留历史可重启用；仅误建未更新账户可删除', () => {
  const a = store.saveAccount(input()); assert.throws(() => store.archiveAccount(a.id, true), /归档/);
  store.updateAccountValue(a.id, value({ amount: '0' })); store.archiveAccount(a.id, true);
  assert.ok(store.read().accounts[0].archivedAt); assert.equal(store.read().accountValueHistory.length, 2);
  assert.throws(() => store.updateAccountValue(a.id, value()), /启用/); assert.throws(() => store.saveAccount(input(), a.id), /启用/);
  assert.throws(() => store.removeAccount(a.id), /历史/); store.archiveAccount(a.id, false); store.updateAccountValue(a.id, value());
  assert.equal(assets.summary(store.read()).assetCents, 123456);
  const accidental = store.saveAccount(input()); store.removeAccount(accidental.id);
  assert.ok(!store.read().accounts.some(a => a.id === accidental.id)); assert.ok(!store.read().accountValueHistory.some(h => h.accountId === accidental.id));
});

test('资产分类重名限于同类型，迁移包含归档账户且不影响账单历史', () => {
  const a = store.saveAccount(input({ amount: '0' })); store.archiveAccount(a.id, true);
  const history = clone(store.read().accountValueHistory); const expenseCats = clone(store.read().categories);
  store.saveAssetCategory('银行卡', '💳', '', 'liability'); assert.throws(() => store.saveAssetCategory('银行卡', '💳', '', 'asset'), /已经存在/);
  assert.throws(() => store.removeAssetCategory('asset_bank', 'debt_credit'), /同一/);
  assert.throws(() => store.saveAssetCategory('改型', '💳', 'asset_bank', 'liability'), /类型/);
  store.removeAssetCategory('asset_bank', 'asset_cash'); const s = store.read();
  assert.equal(s.accounts[0].categoryId, 'asset_cash'); assert.deepEqual(s.accountValueHistory, history); assert.deepEqual(s.categories, expenseCats);
  for (const c of s.assetCategories.filter(c => c.kind === 'asset' && c.id !== 'asset_cash')) store.removeAssetCategory(c.id, 'asset_cash');
  assert.throws(() => store.removeAssetCategory('asset_cash', 'debt_credit'), /至少保留/);
});

test('资产分类、账户和金额历史遵守容量上限', () => {
  for (let i = 0; i < 31; i++) store.saveAssetCategory('资产' + i, '📦', '', 'asset');
  assert.throws(() => store.saveAssetCategory('超额', '📦', '', 'asset'), /40/);
  store.saveAssetCategory('新负债', '📦', '', 'liability');
  const s = store.read();
  for (let i = 0; i < 200; i++) { const a = assets.createAccount(s, input()); s.accounts.push(a); s.accountValueHistory.push(assets.valueEntry(a, input(), true)); }
  store.write(s); assert.throws(() => store.saveAccount(input()), /200/);
  const a = s.accounts[0];
  while (s.accountValueHistory.length < assets.MAX_HISTORY) s.accountValueHistory.push({ id: 'history_' + s.accountValueHistory.length, accountId: a.id, previousCents: a.amountCents, amountCents: a.amountCents, valuedOn: a.valuedOn, reason: 'manual_update', recordedAt: a.updatedAt, note: '' });
  store.write(s); assert.throws(() => store.updateAccountValue(a.id, value()), /20,000/); assert.equal(store.read().accountValueHistory.length, 20000);
});

test('v3 校验拒绝孤立历史、重复ID、断链、跨类型、负数及金额不一致', () => {
  const a = store.saveAccount(input()); store.updateAccountValue(a.id, value()); const good = store.read();
  const invalid = [
    s => s.accounts.push(clone(s.accounts[0])), s => s.accounts[0].categoryId = 'debt_credit', s => s.accounts[0].amountCents = -1,
    s => s.accounts[0].amountCents += 1, s => s.accounts[0].valuedOn = '2024-03-02', s => s.accounts[0].archivedAt = s.accounts[0].updatedAt,
    s => s.accountValueHistory.shift(), s => s.accountValueHistory[0].accountId = 'missing', s => s.accountValueHistory[1].id = s.accountValueHistory[0].id,
    s => s.accountValueHistory[1].previousCents = 0, s => s.accountValueHistory[1].valuedOn = '2024-01-01', s => s.accountValueHistory[1].recordedAt = 0,
    s => s.accountValueHistory[1].reason = 'opening', s => s.accountValueHistory[0].previousCents = 0, s => delete s.settings.assetAmountsHidden,
    s => s.assetCategories[0].kind = 'unknown', s => s.assetCategories.push(clone(s.assetCategories[0])), s => s.accountValueHistory[1].amountCents = 1.5
  ];
  for (const mutate of invalid) { const s = clone(good); mutate(s); assert.throws(() => core.validateState(s)); }
  assert.deepEqual(store.read(), good);
});

test('v2 原账单和元数据无损升级，旧键保留并只迁移一次', () => {
  const old = oldV2(); db.set(store.V2_KEY, clone(old));
  const s = store.read(); assert.equal(s.version, 3); assert.deepEqual(s.records, old.records); assert.deepEqual(s.categories, old.categories);
  assert.equal(s.settings.budgetCents, old.settings.budgetCents); assert.equal(s.updatedAt, old.updatedAt); assert.equal(s.lastBackupAt, old.lastBackupAt);
  assert.deepEqual(db.get(store.V2_KEY), old); assert.equal(writes, 1); assert.deepEqual(store.read(), s); assert.equal(writes, 1);
});

test('v2 升级失败不覆盖原数据，最新键损坏不回退到旧键', () => {
  const old = oldV2(); db.set(store.V2_KEY, old); failKey = store.KEY;
  assert.throws(() => store.read(), /升级保存失败/); assert.deepEqual(db.get(store.V2_KEY), old); assert.ok(!db.has(store.KEY));
  failKey = ''; store.read(); db.set(store.KEY, { bad: true }); assert.throws(() => store.read(), /数据异常/); assert.deepEqual(db.get(store.KEY), { bad: true });
  db.delete(store.KEY); db.set(store.V2_KEY, { bad: true }); db.set(store.LEGACY_KEY, { version: 1 }); assert.throws(() => store.read(), /数据异常/); assert.ok(!db.has(store.KEY));
});

test('v3 备份往返资产历史和隐藏设置，旧备份替换后可完整恢复前副本', () => {
  const a = store.saveAccount(input()); store.updateAccountValue(a.id, value()); store.setAssetAmountsHidden(true);
  const current = store.read(); const backup = JSON.parse(store.backupText()); assert.equal(backup.version, 3); assert.deepEqual(store.parseBackup(JSON.stringify(backup)), current);
  const old = oldV2(); const parsed = store.parseBackup(JSON.stringify({ app: 'daily-expense-miniapp', version: 2, state: old }));
  assert.deepEqual(store.read(), current); assert.deepEqual(parsed.accounts, []); store.restore(parsed); assert.equal(store.read().accounts.length, 0);
  store.restoreSafety(); const restored = store.read(); assert.deepEqual(restored.accounts, current.accounts); assert.deepEqual(restored.accountValueHistory, current.accountValueHistory); assert.equal(restored.settings.assetAmountsHidden, true);
  db.delete(store.SAFETY_KEY); db.set(store.V2_SAFETY_KEY, old); store.restoreSafety(); assert.deepEqual(store.read().records, old.records);
  db.set(store.SAFETY_KEY, { bad: true }); const before = store.read(); assert.throws(() => store.restoreSafety()); assert.deepEqual(store.read(), before);
});

test('直接恢复也保留 v2 原账本，副本保存失败不改变当前资产', () => {
  const old = oldV2(); db.set(store.V2_KEY, old); store.restore(core.freshState()); assert.deepEqual(db.get(store.SAFETY_KEY), old);
  store.saveAccount(input()); const before = store.read(); failKey = store.SAFETY_KEY;
  assert.throws(() => store.restore(core.freshState()), /已取消恢复/); assert.deepEqual(store.read(), before);
});

test('资产 CSV 使用真实金额含归档，转义中文换行引号和公式', () => {
  const a = store.saveAccount(input({ name: '=SUM(1,2)', amount: '0', note: '@备注"\n第二行' })); store.archiveAccount(a.id, true); store.setAssetAmountsHidden(true);
  store.saveAccount(input({ kind: 'liability', categoryId: 'debt_credit', amount: '123.45' })); const csv = assets.csv(store.read());
  assert.equal(csv.charCodeAt(0), 0xfeff); assert.ok(csv.includes("'=SUM(1,2)")); assert.ok(csv.includes("'@备注\"\"\n第二行"));
  assert.ok(csv.includes('"0.00","2024-02-29","已归档"')); assert.ok(csv.includes('"123.45"')); assert.ok(!csv.includes('••••'));
});

test('账户页面创建、编辑、金额更新、取消与写入失败保留输入', () => {
  const p = page('account'); p.setData({ name: '工资卡', amount: '1000', valuedOn: '2024-02-29' }); p.save();
  assert.equal(p.data.mode, 'detail'); assert.equal(p.data.account.amountText, '1000.00'); const id = p.data.accountId;
  p.edit(); p.setData({ name: '新名称', categoryIndex: 3 }); p.save(); assert.equal(p.data.account.categoryName, '股票'); assert.equal(p.data.label, '当前市值／估值'); assert.equal(p.data.historyCount, 1);
  p.beginUpdate(); p.setData({ amount: '1200', valuedOn: '2024-03-01' }); confirm = false; p.save(); assert.equal(p.data.mode, 'value'); assert.equal(store.read().accounts[0].amountCents, 100000); assert.equal(p.data.busy, false);
  confirm = true; failKey = store.KEY; p.save(); assert.equal(p.data.amount, '1200'); assert.equal(p.data.mode, 'value'); assert.equal(p.data.busy, false); assert.match(modals.at(-1).content, /保存失败/);
  failKey = ''; p.save(); assert.equal(p.data.mode, 'detail'); assert.equal(p.data.historyCount, 2); assert.equal(p.data.account.amountText, '1200.00'); assert.equal(p.data.history[0].changeText, '+200.00');
  p.beginUpdate(); p.setData({ amount: '9999' }); p.cancel(); assert.equal(p.data.amount, ''); assert.equal(store.read().accounts.find(a => a.id === id).amountCents, 120000);
});

test('资产页筛选不改变全局合计，金额隐藏覆盖列表详情历史和占比且重进保留', () => {
  const a = store.saveAccount(input({ amount: '160000' })); store.saveAccount(input({ kind: 'liability', categoryId: 'debt_credit', amount: '60000' }));
  const p = page('assets'); assert.equal(p.data.netText, '100000.00'); p.kindChange(event({ kind: 'liability' })); assert.equal(p.data.count, 1); assert.equal(p.data.netText, '100000.00'); assert.equal(p.data.groups[0].percent, '100.0');
  p.toggleHidden(); assert.equal(p.data.netText, '••••'); assert.equal(p.data.groups[0].amountText, '••••'); assert.equal(p.data.groups[0].percent, ''); assert.equal(p.data.groups[0].accounts[0].amountText, '••••');
  assert.ok(!JSON.stringify(p.data).includes('60000')); const detail = page('account', { id: a.id }); assert.equal(detail.data.account.amountText, '••••'); assert.equal(detail.data.history[0].amountText, '••••'); assert.ok(!JSON.stringify(detail.data).includes('160000'));
  detail.beginUpdate(); assert.equal(detail.data.amount, '160000.00'); detail.cancel(); assert.equal(detail.data.amount, ''); assert.ok(!JSON.stringify(detail.data).includes('160000')); assert.equal(page('assets').data.hidden, true);
  detail.toggleHidden(); assert.equal(detail.data.history[0].amountText, '160000.00');
});

test('账户历史分页、30天更新提示、归档与删除页面流程', () => {
  const today = dates.dateKey(new Date()); const a = store.saveAccount(input({ amount: '0', valuedOn: dates.shiftDays(today, -31) }));
  assert.equal(assets.displayAccount(store.read(), a).stale, true);
  const boundary = store.saveAccount(input({ amount: '0', valuedOn: dates.shiftDays(today, -30) })); assert.equal(assets.displayAccount(store.read(), boundary).stale, false);
  const p = page('account', { id: a.id }); p.archive(); assert.equal(p.data.account.archived, true); p.archive(); assert.equal(p.data.account.archived, false); assert.equal(p.data.busy, false);
  for (let i = 0; i < 55; i++) store.updateAccountValue(a.id, value({ amount: String(i), valuedOn: today }));
  p.onShow(); assert.equal(p.data.history.length, 50); assert.equal(p.data.hasMore, true); p.moreHistory(); assert.equal(p.data.history.length, 6); assert.equal(p.data.hasMore, false); assert.equal(p.data.account.stale, false);
  assert.equal(p.data.historyPage, 2); p.previousHistory(); assert.equal(p.data.historyPage, 1); assert.equal(p.data.history.length, 50);
  const before = store.read(); p.remove(); assert.deepEqual(store.read(), before);
  const accidental = page('account', { id: boundary.id }); accidental.remove(); assert.equal(navigation.at(-1), 'back'); assert.equal(store.read().accounts.length, 1);
});

test('账户分类筛选保留全局合计和占比分母，分类删除后自动清除无效筛选', () => {
  store.saveAccount(input({ amount: '100' })); store.saveAccount(input({ amount: '300', categoryId: 'asset_cash' }));
  const p = page('assets'); p.kindChange(event({ kind: 'asset' }));
  const index = p.data.categories.findIndex(c => c.id === 'asset_bank'); p.categoryChange({ detail: { value: String(index) } });
  assert.equal(p.data.count, 1); assert.equal(p.data.groups[0].percent, '25.0'); assert.equal(p.data.assetText, '400.00');
  store.removeAssetCategory('asset_bank', 'asset_cash'); p.onShow(); assert.equal(p.data.categoryId, ''); assert.equal(p.data.count, 2);
  p.kindChange(event({ kind: 'liability' })); assert.equal(p.data.groups.length, 0); assert.equal(p.data.netText, '400.00');
  store.saveAccount(input({ kind: 'liability', categoryId: 'debt_credit', amount: '0' })); p.onShow(); assert.equal(p.data.groups[0].percent, '');
});

test('分类页面切换类型清理表单，仅提供同类迁移，丢失账户和损坏账本显示错误', () => {
  const p = page('asset-categories'); p.edit(event({ id: 'asset_bank' })); p.kindChange(event({ kind: 'liability' })); assert.equal(p.data.editingId, ''); assert.equal(p.data.name, '');
  p.setData({ name: '借款测试', icon: '📦' }); p.save(); const added = store.read().assetCategories.find(c => c.name === '借款测试');
  p.beginRemove(event({ id: added.id })); assert.ok(p.data.targets.every(c => c.kind === 'liability' && c.id !== added.id)); p.remove(); assert.ok(!store.read().assetCategories.some(c => c.id === added.id));
  const detail = page('account', { id: 'missing' }); assert.match(detail.data.storageError, /不存在/);
  db.set(store.KEY, { bad: true }); assert.match(page('assets').data.storageError, /数据异常/); assert.match(page('asset-categories').data.storageError, /数据异常/);
});

test('恢复旧备份明确提示清空资产，取消保持全部数据，确认后可撤销恢复', async () => {
  store.saveAccount(input()); const before = store.read(); const old = oldV2();
  wx.chooseMessageFile = o => o.success({ tempFiles: [{ path: '/old.json', size: 1000 }] });
  wx.getFileSystemManager = () => ({ readFile: o => o.success({ data: JSON.stringify({ app: 'daily-expense-miniapp', version: 2, state: old }) }) });
  const p = page('backup'); confirm = false; await p.importJson();
  assert.match(modals.at(-1).content, /现有资产和负债也会被清空/); assert.match(modals.at(-1).content, /0 个资产账户、0 个负债账户/); assert.deepEqual(store.read(), before);
  confirm = true; await p.importJson(); assert.equal(store.read().accounts.length, 0); assert.equal(p.data.hasSafety, true);
  p.undoRestore(); assert.deepEqual(store.read().accounts, before.accounts); assert.deepEqual(store.read().accountValueHistory, before.accountValueHistory);
});

test('资产清单导出独立文件，成功发送不改变完整备份时间', async () => {
  store.saveAccount(input()); let filename; let content; wx.env = { USER_DATA_PATH: '/sandbox' };
  wx.getFileSystemManager = () => ({ writeFile: o => { content = o.data; o.success(); } }); wx.shareFileMessage = o => { filename = o.fileName; o.success(); };
  const p = page('backup'); await p.exportFile('assets'); assert.equal(filename, 'xiaorizhang-assets.csv'); assert.match(content, /工资卡/); assert.equal(store.read().lastBackupAt, ''); assert.equal(p.data.busy, false);
});
