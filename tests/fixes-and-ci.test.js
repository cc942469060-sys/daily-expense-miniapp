const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path'); const fs = require('node:fs');
const core = require('../miniprogram/utils/core'); const store = require('../miniprogram/utils/store'); const persistence = require('../miniprogram/utils/ledger-storage');
const { applySetData } = require('./helpers/set-data');
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
let db;
test.beforeEach(() => {
  db = new Map();
  global.wx = { getStorageSync: k => clone(db.get(k)), setStorageSync: (k, v) => db.set(k, clone(v)), showToast() {}, showModal() {}, navigateTo() {} };
  require('./helpers/storage-io').installStorageIO(wx, db);
});

test('排序改用普通比较后，顺序与原来的 localeCompare 完全一致', () => {
  let seed = 7; const rand = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  const s = core.freshState();
  s.records = Array.from({ length: 3000 }, (_, i) => ({ id: 'bill_' + (1700000000000 + rand(50)).toString(36) + '_' + rand(1e6).toString(36).padStart(4, '0'), type: rand(5) ? 'expense' : 'income', categoryId: 'food', amountCents: 100 * (1 + rand(5)), refundCents: 0, payment: '微信', date: `2026-0${1 + rand(3)}-1${rand(3)}`, time: `1${rand(3)}:0${rand(2)}`, note: '', createdAt: rand(3), updatedAt: 1 }));
  s.records.forEach(r => { if (r.type === 'income') r.categoryId = 'income_salary'; });
  const old = sort => (a, b) => {
    const amountOrder = sort === 'amount_desc' ? core.net(b) - core.net(a) : sort === 'amount_asc' ? core.net(a) - core.net(b) : 0;
    const timeOrder = (b.date + ' ' + b.time).localeCompare(a.date + ' ' + a.time) || b.createdAt - a.createdAt;
    return amountOrder || timeOrder || (sort ? a.id.localeCompare(b.id) : 0);
  };
  for (const sort of [undefined, 'amount_desc', 'amount_asc']) assert.deepEqual(core.filterRecords(s, { sort }).map(r => r.id), s.records.slice().sort(old(sort)).map(r => r.id), String(sort));
});

test('删除分类时等迁移面板渲染后再滚动过去', () => {
  for (const name of ['categories', 'asset-categories']) {
    let config; global.Page = v => { config = v; }; const file = path.resolve(__dirname, `../miniprogram/pages/${name}/${name}.js`); delete require.cache[file]; require(file);
    const rendered = []; const scrolls = [];
    // WeChat renders setData asynchronously; callbacks run after the view has updated.
    const p = { data: clone(config.data), setData(v, done) { applySetData(this.data, v); if (done) rendered.push(done); } };
    for (const [k, v] of Object.entries(config)) if (typeof v === 'function') p[k] = v.bind(p);
    wx.pageScrollTo = o => scrolls.push(o.selector || o.scrollTop); p.onShow();
    p.beginRemove({ currentTarget: { dataset: { id: p.data.categories[1].id } } });
    assert.deepEqual(scrolls, [], name); rendered.forEach(done => done());
    assert.deepEqual(scrolls, ['#migration'], name);
  }
});

test('账单页日期选择器互相限制，不能选出开始晚于结束的范围', () => {
  const pickers = read('miniprogram/pages/bills/bills.wxml').match(/<picker mode="date"[^>]*>/g);
  assert.match(pickers[0], /data-field="start"/); assert.match(pickers[0], /end="\{\{end \|\| today\}\}"/);
  assert.match(pickers[1], /data-field="end"/); assert.match(pickers[1], /start="\{\{start \|\| '2000-01-01'\}\}"/);
});

test('意外错误记入诊断摘要，去掉引号内容和本地路径，最多保留 20 条，记录失败也不抛错', () => {
  let app; global.App = config => { app = config; }; const file = path.resolve(__dirname, '../miniprogram/app.js'); delete require.cache[file]; require(file);
  app.onError('MiniProgramError\nCannot read property \'x\' of undefined at wxfile://usr/xiaorizhang-backup.json\nnote "午饭 PRIVATE_NOTE" failed');
  app.onUnhandledRejection({ reason: new Error('请求“PRIVATE_NOTE”未处理') });
  const report = store.diagnostics(); assert.equal(report.errors.length, 2);
  assert.deepEqual(report.errors.map(e => e.kind), ['error', 'rejection']);
  assert.match(report.errors[0].message, /^MiniProgramError \| Cannot read property "…" of undefined at \[路径\] \| note "…" failed$/);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_NOTE')); assert.ok(!JSON.stringify(report).includes('wxfile'));
  assert.equal(store.protectionWarning(), '');
  for (let i = 0; i < 25; i++) app.onError('boom ' + i);
  assert.equal(store.diagnostics().errors.length, 20); assert.equal(store.diagnostics().errors.at(-1).message, 'boom 24');
  wx.setStorageSync = () => { throw new Error('full'); }; assert.doesNotThrow(() => app.onError('still fine'));
  assert.ok(!db.has(persistence.KEY));
});

test('CI 在 PR 和 main 上运行测试与结构检查，README 写明所需 Node.js 版本', () => {
  const workflow = read('.github/workflows/test.yml');
  for (const part of ['pull_request:', 'branches: [main]', 'node-version: 22', 'run: npm test', 'run: npm run check', 'contents: read']) assert.ok(workflow.includes(part), part);
  assert.match(read('README.md'), /Node\.js 20\.11 或更新版本/);
});
