const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path');
const store = require('../miniprogram/utils/store'); let db; let navigation;
function clone(v) { return v === undefined ? '' : JSON.parse(JSON.stringify(v)); }
function page(name) {
  let config; global.Page = value=>{ config=value; }; const file = path.resolve(__dirname,`../miniprogram/pages/${name}/${name}.js`); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(value) { Object.assign(this.data,value); } }; for (const [k,v] of Object.entries(config)) if (typeof v === 'function') p[k]=v.bind(p); return p;
}
test.beforeEach(()=>{ db=new Map(); navigation=[]; global.wx={ getStorageSync:key=>clone(db.get(key)),setStorageSync:(key,v)=>db.set(key,clone(v)),showToast:()=>{},showModal:options=>options.success && options.success({confirm:true}),navigateBack:()=>navigation.push('back'),navigateTo:options=>navigation.push(options.url),setNavigationBarTitle:()=>{},pageScrollTo:()=>{} }; require('./helpers/storage-io').installStorageIO(wx, db); });
test('页面流程：新增消费 → 首页 → 统计 → 筛选明细 → 修改退款 → 删除',()=>{
  const record=page('record'); record.onLoad({}); record.input({currentTarget:{dataset:{field:'amount'}},detail:{value:'28.50'}}); record.save(); assert.deepEqual(navigation,['back']);
  const home=page('home'); home.onShow(); assert.equal(home.data.todayText,'28.50'); assert.equal(home.data.count,1);
  const stats=page('stats'); stats.onShow(); assert.equal(stats.data.stats.totalText,'28.50'); assert.equal(stats.data.stats.count,1);
  const bills=page('bills'); bills.onLoad({categoryId:'food'}); bills.onShow(); assert.equal(bills.data.count,1);
  const id=store.read().records[0].id; const edit=page('record'); edit.onLoad({id}); edit.input({currentTarget:{dataset:{field:'refund'}},detail:{value:'8.50'}}); edit.save(); home.onShow(); stats.onShow(); bills.onShow(); assert.equal(home.data.todayText,'20.00'); assert.equal(stats.data.stats.totalText,'20.00'); assert.equal(bills.data.totalText,'20.00'); edit.remove(); home.onShow(); assert.equal(home.data.count,0);
});
test('保存并继续记账清空金额备注，保留日期与分类',()=>{ const p=page('record'); p.onLoad({}); p.setData({amount:'8.88',note:'早餐',date:'2024-02-10'}); p.saveMore(); assert.equal(store.read().records.length,1); assert.equal(p.data.amount,''); assert.equal(p.data.note,''); assert.equal(p.data.date,'2024-02-10'); assert.equal(navigation.length,0); });
test('错误日期筛选显示错误，重置后账单正常显示',()=>{ const p=page('bills'); p.onLoad({start:'2024-03-01',end:'2024-02-01'}); p.onShow(); assert.match(p.data.storageError,/开始日期/); p.clear(); assert.equal(p.data.storageError,''); });
test('存储损坏时首页与我的仍提供备份恢复入口',()=>{ db.set(store.KEY,{bad:true}); const home=page('home'); home.onShow(); assert.match(home.data.storageError,/数据异常/); home.backup(); const mine=page('mine'); mine.onShow(); mine.backup(); assert.equal(navigation.filter(v=>v==='/pages/backup/backup').length,2); });
test('取消发送备份不会更新成功发送时间',async()=>{ const p=page('backup'); store.read(); wx.env={USER_DATA_PATH:'/sandbox'}; wx.getFileSystemManager().writeFile=options=>options.success(); wx.shareFileMessage=options=>options.fail({errMsg:'cancel'}); await p.exportFile('json'); assert.equal(store.read().lastBackupAt,''); assert.equal(p.data.busy,false); assert.match(p.data.fileName,/^xiaorizhang-backup-.+\.json$/); });
test('成功发送 JSON 后才更新备份时间，CSV 不更新备份时间',async()=>{ const p=page('backup'); store.read(); wx.env={USER_DATA_PATH:'/sandbox'}; wx.getFileSystemManager().writeFile=options=>options.success(); wx.shareFileMessage=options=>options.success(); await p.exportFile('csv'); assert.equal(store.read().lastBackupAt,''); await p.exportFile('json'); assert.ok(store.read().lastBackupAt); });
test('取消选取备份文件不会替换账本且释放忙碌状态',async()=>{ const p=page('backup'); store.read(); wx.chooseMessageFile=options=>options.fail({errMsg:'cancel'}); await p.importJson(); assert.equal(store.read().records.length,0); assert.equal(p.data.busy,false); assert.equal(db.has(store.SAFETY_KEY),false); });
test('无效 JSON 文件被拒绝，当前账单不变',async()=>{ const p=page('backup'); const record=page('record'); record.onLoad({}); record.setData({amount:'12.50'}); record.save(); wx.chooseMessageFile=options=>options.success({tempFiles:[{path:'/backup.json',size:2}]}); wx.getFileSystemManager=()=>({readFile:options=>options.success({data:'{}'})}); await p.importJson(); assert.equal(store.read().records.length,1); assert.equal(p.data.busy,false); assert.equal(db.has(store.SAFETY_KEY),false); });

function rangeEvent(field, value) { return { currentTarget: { dataset: { field } }, detail: { value } }; }
function modeEvent(mode) { return { currentTarget: { dataset: { mode } } }; }
function seedStats() {
  const core = require('../miniprogram/utils/core'); const s = core.freshState();
  s.records = [['2024-08-03', 'expense', 1000], ['2025-01-01', 'income', 3000], ['2026-10-11', 'expense', 2000]].map(([date, type, amountCents], i) => ({ id: 'stats_' + i, date, type, amountCents, refundCents: 0, categoryId: type === 'expense' ? 'food' : 'income_salary', payment: '未指定', time: '00:00', note: '', createdAt: i, updatedAt: i }));
  db.set(store.KEY, s);
  const p = page('stats'); p.setData({ today: '2026-10-11', anchor: '2026-10-11' }); p.refresh(); return p;
}
function lastFilter() { return Object.fromEntries(new URL('https://example.invalid' + navigation.at(-1)).searchParams); }

test('统计页全部模式汇总三年，所有明细入口沿用所选范围和收支类型', () => {
  const p = seedStats(); p.modeChange(modeEvent('all'));
  assert.equal(p.data.storageError, ''); assert.equal(p.data.stats.totalText, '30.00');
  assert.equal(p.data.stats.start, '2024-08-03'); assert.equal(p.data.stats.end, '2026-10-11');
  assert.equal(p.data.canNext, false); assert.equal(p.data.canPrev, false);
  p.allBills(); assert.deepEqual(lastFilter(), { type: 'expense', start: '2024-08-03', end: '2026-10-11' });
  p.overviewBills({ currentTarget: { dataset: { type: 'income' } } });
  assert.deepEqual(lastFilter(), { type: 'income', start: '2024-08-03', end: '2026-10-11' });
  p.typeChange({ currentTarget: { dataset: { type: 'income' } } });
  assert.equal(p.data.stats.totalText, '30.00');
  p.categoryBills({ currentTarget: { dataset: { id: 'income_salary' } } });
  assert.deepEqual(lastFilter(), { type: 'income', start: '2024-08-03', end: '2026-10-11', categoryId: 'income_salary' });
  p.barBills({ currentTarget: { dataset: p.data.stats.bars[1] } });
  assert.deepEqual(lastFilter(), { type: 'income', start: '2025-01-01', end: '2025-12-31' });
});

test('统计页自定义跨年日期立即生效，切换视图后保留已选范围', () => {
  const p = seedStats(); p.modeChange(modeEvent('custom'));
  assert.equal(p.data.customStart, '2026-10-01'); assert.equal(p.data.customEnd, '2026-10-11');
  p.rangeChange(rangeEvent('customStart', '2024-01-01'));
  assert.equal(p.data.stats.totalText, '30.00');
  p.rangeChange(rangeEvent('customEnd', '2025-12-31'));
  assert.equal(p.data.stats.totalText, '10.00'); assert.equal(p.data.stats.summary.incomeText, '30.00');
  p.allBills(); const filter = lastFilter();
  assert.deepEqual(filter, { type: 'expense', start: '2024-01-01', end: '2025-12-31' });
  const bills = page('bills'); bills.onLoad(filter); bills.onShow(); assert.equal(bills.data.count, 1); assert.equal(bills.data.totalText, '10.00');
  p.modeChange(modeEvent('year')); assert.equal(p.data.stats.totalText, '20.00');
  p.modeChange(modeEvent('custom')); assert.equal(p.data.stats.totalText, '10.00');
  assert.equal(p.data.customStart, '2024-01-01'); assert.equal(p.data.customEnd, '2025-12-31');
});

test('全部转自定义沿用全部范围，无效范围不改变筛选和账本', () => {
  const p = seedStats(); const before = clone(db.get(store.KEY)); const errors = [];
  wx.showModal = options => errors.push(options.content);
  p.modeChange(modeEvent('all')); p.modeChange(modeEvent('custom'));
  assert.equal(p.data.customStart, '2024-08-03'); assert.equal(p.data.customEnd, '2026-10-11');
  for (const [field, value] of [['customEnd', '2024-01-01'], ['customEnd', '2026-10-12'], ['customStart', '2024-02-30']]) p.rangeChange(rangeEvent(field, value));
  assert.equal(errors.length, 3); assert.equal(p.data.customEnd, '2026-10-11'); assert.equal(p.data.stats.totalText, '30.00');
  p.modeChange(modeEvent('invalid')); assert.equal(p.data.mode, 'custom');
  p.shift({ currentTarget: { dataset: { step: 1 } } }); p.current();
  assert.equal(p.data.mode, 'custom'); assert.equal(p.data.stats.totalText, '30.00');
  assert.deepEqual(db.get(store.KEY), before);
});

test('空账本可切换全部和自定义，恢复到月和年后正常切换周期', () => {
  const p = page('stats'); p.setData({ today: '2026-10-11', anchor: '2026-10-11' }); p.refresh();
  p.modeChange(modeEvent('all')); assert.equal(p.data.stats.count, 0); assert.equal(p.data.stats.days, 1);
  p.modeChange(modeEvent('custom')); assert.equal(p.data.stats.totalText, '0.00'); assert.equal(p.data.storageError, '');
  p.modeChange(modeEvent('month')); p.shift({ currentTarget: { dataset: { step: -1 } } });
  assert.equal(p.data.stats.start, '2026-09-01'); assert.equal(p.data.canNext, true);
  p.current(); assert.equal(p.data.stats.start, '2026-10-01');
  p.modeChange(modeEvent('year')); p.shift({ currentTarget: { dataset: { step: -1 } } });
  assert.equal(p.data.stats.start, '2025-01-01'); assert.equal(p.data.stats.bars.length, 12);
});
