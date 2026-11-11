const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path'); const fs = require('node:fs');
const core = require('../miniprogram/utils/core'); const store = require('../miniprogram/utils/store');
const { applySetData } = require('./helpers/set-data');
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
let db; let navigation;
function page(name, options) {
  let config; global.Page = v => { config = v; }; const file = path.resolve(__dirname, `../miniprogram/pages/${name}/${name}.js`); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(v) { applySetData(this.data, v); } };
  for (const [k, v] of Object.entries(config)) if (typeof v === 'function') p[k] = v.bind(p);
  if (p.onLoad) p.onLoad(options || {}); if (p.onShow) p.onShow(); return p;
}
function bill(id, date, categoryId, extra) { return Object.assign({ id, type: 'expense', categoryId, amountCents: 100, refundCents: 0, payment: '微信', date, time: '12:00', note: '', createdAt: 1, updatedAt: 1 }, extra); }
function seed(records) { const s = core.freshState(); s.records = records; db.set(store.KEY, s); return s; }
const visible = p => p.data.groups.flatMap(g => g.records);
test.beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 11, 12) });
  db = new Map(); navigation = [];
  global.wx = { getStorageSync: k => clone(db.get(k)), setStorageSync: (k, v) => db.set(k, clone(v)), showToast() {}, showModal() {}, navigateTo: o => navigation.push(o.url), pageScrollTo() {} };
  require('./helpers/storage-io').installStorageIO(wx, db);
});

test('首页近 30 天加载更多只追加新的一页，结果与一次加载相同', () => {
  const days = ['2026-11-11', '2026-11-10', '2026-11-09'];
  seed(Array.from({ length: 250 }, (_, i) => bill('r' + String(i).padStart(3, '0'), days[Math.floor(i / 90)], 'food', { amountCents: 100 + i, createdAt: 1000 - i })));
  const p = page('home'); const payloads = []; const set = p.setData; p.setData = v => { payloads.push(v); set.call(p, v); };
  p.moreRecent(); p.moreRecent(); p.moreRecent();
  assert.equal(p.data.recentShown, 250); assert.equal(p.data.recentHasMore, false); assert.equal(payloads.length, 2);
  assert.ok(payloads.every(v => !('groups' in v)));
  const full = page('home'); full.setData({ recentLimit: 300 }); full.refresh();
  assert.deepEqual(p.data.groups, full.data.groups); assert.ok(!('createdAt' in visible(p)[0]));
});

test('统计图第一次点柱子显示区间和金额，再点或点说明才进入明细', () => {
  seed([bill('a', '2026-11-03', 'food', { amountCents: 123456 }), bill('b', '2026-11-05', 'food', { amountCents: 500 })]);
  const p = page('stats'); const index = p.data.stats.bars.findIndex(b => b.start === '2026-11-03');
  const tap = i => p.barTap({ currentTarget: { dataset: { index: i, start: p.data.stats.bars[i].start, end: p.data.stats.bars[i].end } } });
  tap(index); assert.equal(p.data.selectedBar, index); assert.equal(p.data.barInfo, '2026/11/03 · 支出 ¥1,234.56'); assert.deepEqual(navigation, []);
  p.openBar(); assert.match(navigation.pop(), /start=2026-11-03&end=2026-11-03/);
  tap(index); assert.match(navigation.pop(), /type=expense&start=2026-11-03&end=2026-11-03/);
  p.typeChange({ currentTarget: { dataset: { type: 'income' } } }); assert.equal(p.data.selectedBar, -1); assert.equal(p.data.barInfo, '');
  p.modeChange({ currentTarget: { dataset: { mode: 'year' } } }); tap(10); assert.equal(p.data.barInfo, '2026/11/01 — 2026/11/30 · 收入 ¥0.00');
});

test('备份页默认折叠历史导出、CSV、高级恢复与诊断，从聊天恢复保持可见', () => {
  seed([]); const p = page('backup'); assert.equal(p.data.moreOpen, false); p.toggleMore(); assert.equal(p.data.moreOpen, true);
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/backup/backup.wxml'), 'utf8');
  const fold = wxml.indexOf('<block wx:if="{{moreOpen || storageError || protectionWarning}}">'); const end = wxml.indexOf('</block>', wxml.indexOf('检查与诊断'));
  assert.ok(fold > 0 && wxml.indexOf('从聊天文件恢复') < fold && wxml.indexOf('生成备份文件') < fold);
  for (const section of ['toggleHistory', 'toggleRecovery', '导出 CSV', '检查与诊断']) { const at = wxml.indexOf(section); assert.ok(at > fold && at < end, section); }
});

test('记账页分类按近 90 天使用次数排序，同次数保持分类管理中的顺序', () => {
  const old = Array.from({ length: 10 }, (_, i) => bill('old' + i, '2026-07-01', 'food'));
  seed(old.concat([bill('s1', '2026-11-01', 'shopping'), bill('s2', '2026-11-02', 'shopping'), bill('s3', '2026-11-03', 'shopping'), bill('t1', '2026-10-20', 'transport'), bill('t2', '2026-10-21', 'transport', { updatedAt: 5 }), bill('f1', '2026-08-14', 'food')]));
  const ids = page('record').data.categories.map(c => c.id);
  const managed = store.read().categories.filter(c => c.type === 'expense').map(c => c.id);
  assert.deepEqual(ids.slice(0, 3), ['shopping', 'transport', 'food']); assert.deepEqual(ids.slice(3), managed.filter(id => !['shopping', 'transport', 'food'].includes(id)));
  assert.equal(page('record').data.categoryId, 'transport');
  assert.deepEqual(page('categories').data.categories.map(c => c.id), managed);
});
