const test = require('node:test'); const assert = require('node:assert/strict');
const core = require('../miniprogram/utils/core'); const store = require('../miniprogram/utils/store');
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
let db; let io; let sent; let tap; let confirm;
function page() {
  let config; global.Page=v=>{config=v;}; const file=require.resolve('../miniprogram/pages/backup/backup'); delete require.cache[file]; require(file);
  const p={data:clone(config.data),setData(v){Object.assign(this.data,v);}};
  Object.entries(config).forEach(([k,v])=>{if(typeof v==='function')p[k]=v.bind(p);}); p.onShow(); return p;
}
function backup(name, exportedAt, updatedAt='2024-01-01T00:00:00.000Z') {
  const s=core.freshState(); s.updatedAt=updatedAt;
  io.files.set('/sandbox/'+name,JSON.stringify({app:'daily-expense-miniapp',version:3,exportedAt,state:s}));
  return 'file:'+name;
}
function event(id){return {currentTarget:{dataset:{id}}};}
test.beforeEach(()=>{
  db=new Map();sent=[];tap=false;confirm=false;
  global.wx={getStorageSync:k=>clone(db.get(k)),setStorageSync:(k,v)=>db.set(k,clone(v)),showToast:()=>{},pageScrollTo:()=>{},showModal:o=>{if(o.success)o.success({confirm});},shareFileMessage:o=>{assert.ok(tap);sent.push(o.filePath);o.success();}};
  io=require('./helpers/storage-io').installStorageIO(wx,db); store.write(core.freshState());
});

test('默认只选最新手动导出，自动快照与导入前副本归入折叠的高级恢复',()=>{
  const old=backup('xiaorizhang-backup-100-1-a.json','2024-01-01T00:00:00Z');
  const latest=backup('xiaorizhang-backup-101-1-b.json','2025-01-01T00:00:00Z','2023-01-01T00:00:00Z');
  db.set(store.SAFETY_KEY,core.freshState()); const p=page();
  assert.equal(p.data.latestExport.id,latest);assert.deepEqual(p.data.historyExports.map(c=>c.id),[old]);
  assert.ok(p.data.recoveryCopies.some(c=>c.label.includes('历史快照')));assert.ok(p.data.recoveryCopies.some(c=>c.id===store.SAFETY_KEY));
  assert.ok(p.data.recoveryCopies.every(c=>!c.id.includes('xiaorizhang-backup-')));
  assert.equal(p.data.historyOpen,false);assert.equal(p.data.recoveryOpen,false);
});
test('折叠、刷新只改变显示，所有副本和账本原文保持不变',()=>{
  backup('xiaorizhang-backup-100-1-a.json','2024-01-01T00:00:00Z');const beforeDb=clone([...db]);const beforeFiles=[...io.files];
  const p=page();p.toggleHistory();p.toggleRecovery();p.inspectLocal();
  assert.equal(p.data.historyOpen,true);assert.equal(p.data.recoveryOpen,true);
  p.toggleHistory();p.toggleRecovery();assert.deepEqual([...db],beforeDb);assert.deepEqual([...io.files],beforeFiles);
});
test('新生成文件成为最新项，上一份移入历史，重新进入页面仍能识别',async()=>{
  const old=backup('xiaorizhang-backup-100-1-a.json','2024-01-01T00:00:00Z');const p=page();await p.exportFile('json');
  assert.equal(p.data.latestExport.id,p.data.pendingId);assert.equal(p.data.latestExport.fileName,p.data.fileName);
  assert.ok(p.data.historyExports.some(c=>c.id===old));assert.match(p.data.sendStatus,/文件已生成/);assert.equal(sent.length,0);
  const reopened=page();assert.equal(reopened.data.latestExport.id,p.data.pendingId);assert.equal(reopened.data.pendingId,'');assert.equal(reopened.data.sendStatus,'');
});
test('历史文件点击发送直接复用原文件，不增加导出文件、不标记当前账本已备份',async()=>{
  const id=backup('xiaorizhang-backup-100-1-a.json','2024-01-01T00:00:00Z');backup('xiaorizhang-backup-200-1-b.json','2025-01-01T00:00:00Z');
  const p=page();const before=[...io.files];tap=true;const sending=p.sendExport(event(id));tap=false;await sending;
  assert.deepEqual(sent,['/sandbox/xiaorizhang-backup-100-1-a.json']);assert.deepEqual([...io.files],before);
  assert.equal(p.data.pendingId,id);assert.match(p.data.sendStatus,/已发送/);assert.equal(store.read().lastBackupAt,'');
});
test('损坏的导出、旧固定文件名和读取错误都保留可见入口',()=>{
  const old=backup('xiaorizhang-backup.json','2024-01-01T00:00:00Z');io.files.set('/sandbox/xiaorizhang-backup-1999999999999-1-a.json','broken');
  const p=page();assert.equal(p.data.latestExport.valid,false);assert.equal(p.data.historyExports[0].id,old);
  const before=[...io.files];p.sendExport(event(p.data.latestExport.id));assert.equal(sent.length,0);assert.deepEqual([...io.files],before);
  io.fs.readdirSync=()=>{throw new Error('unavailable');};p.inspectLocal();assert.ok(p.data.recoveryCopies.some(c=>c.id==='file-error'));
});
test('最新和历史备份的恢复仍需确认，取消不会改写账本',async()=>{
  const id=backup('xiaorizhang-backup-100-1-a.json','2024-01-01T00:00:00Z');const p=page();const before=clone(db.get(store.KEY));
  await p.recoverCandidate(event(id));assert.deepEqual(db.get(store.KEY),before);
  confirm=true;await p.recoverCandidate(event(id));assert.equal(store.read().records.length,0);assert.ok(store.hasSafety());
});
test('没有手动导出时显示空态，CSV待发送文件不会混入JSON历史',async()=>{
  const p=page();assert.equal(p.data.latestExport,null);assert.deepEqual(p.data.historyExports,[]);
  await p.exportFile('csv');assert.equal(p.data.sendFileType,'csv');assert.equal(p.data.latestExport,null);assert.deepEqual(p.data.historyExports,[]);
});
