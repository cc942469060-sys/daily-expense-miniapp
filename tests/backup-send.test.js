const test = require('node:test'); const assert = require('node:assert/strict');
const store = require('../miniprogram/utils/store'); const files = require('../miniprogram/utils/files');
const clone = v => v === undefined ? '' : JSON.parse(JSON.stringify(v));
let db; let io; let calls; let tap; let behavior;
function page() {
  let config; global.Page = v => { config = v; };
  const file = require.resolve('../miniprogram/pages/backup/backup'); delete require.cache[file]; require(file);
  const p = { data: clone(config.data), setData(v) { Object.assign(this.data, v); } };
  Object.entries(config).forEach(([k, v]) => { if (typeof v === 'function') p[k] = v.bind(p); }); return p;
}
function send(p) { tap = true; const result = p.sendGenerated(); tap = false; return result; }
test.beforeEach(() => {
  db = new Map(); calls = []; tap = false; behavior = 'success';
  global.wx = { getStorageSync: k => clone(db.get(k)), setStorageSync: (k,v) => db.set(k,clone(v)), showModal: () => {}, showToast: () => {}, pageScrollTo: () => {},
    shareFileMessage: o => { calls.push(o); assert.ok(tap, 'native send must occur synchronously in click');
      if (behavior === 'throw') throw new Error('native exception');
      if (behavior === 'hold') return;
      if (behavior === 'success') o.success(); else o.fail({ errMsg: behavior });
    }
  };
  io = require('./helpers/storage-io').installStorageIO(wx, db);
});

test('生成和发送分开，发送接口在点击调用栈内执行，无异步文件检查', async () => {
  const p = page(); await p.exportFile('json'); assert.equal(calls.length,0); assert.equal(store.read().lastBackupAt,'');
  assert.ok(io.files.has(p.pendingFile.path)); await send(p);
  assert.equal(calls.length,1); assert.ok(store.read().lastBackupAt); assert.match(p.data.sendStatus,/文件已发送/);
});
test('失败保留原始错误，重试使用相同文件且不生成额外文件', async () => {
  const p = page(); await p.exportFile('json'); const path = p.pendingFile.path; const content = io.files.get(path);
  const names = [...io.files.keys()].filter(k=>k.includes('xiaorizhang-backup-'));
  behavior = 'shareFileMessage:fail can only be invoked by user TAP gesture'; await send(p);
  assert.equal(p.data.sendError,behavior); assert.equal(p.data.busy,false); assert.equal(store.read().lastBackupAt,'');
  assert.equal(JSON.parse(p.diagnosticText).fileSend.error,behavior);
  behavior = 'success'; await send(p); assert.equal(calls[1].filePath,path); assert.equal(io.files.get(path),content);
  assert.deepEqual([...io.files.keys()].filter(k=>k.includes('xiaorizhang-backup-')),names);
});
test('取消发送保留文件且不标记成功，重复点击发送只调一次', async () => {
  const p = page(); await p.exportFile('json'); behavior='hold'; const waiting=send(p); send(p);
  assert.equal(calls.length,1); assert.equal(p.data.busy,true); calls[0].fail({errMsg:'shareFileMessage:fail cancel'}); await waiting;
  assert.match(p.data.sendStatus,/取消/); assert.equal(p.data.sendError,''); assert.equal(store.read().lastBackupAt,''); assert.ok(io.files.has(p.pendingFile.path));
});
test('缺失、空文件和不支持发送均有具体错误，不调用原生发送', async () => {
  const p=page(); await p.exportFile('json'); const path=p.pendingFile.path;
  io.files.delete(path); await send(p); assert.equal(calls.length,0); assert.match(p.data.sendError,/ENOENT/);
  io.files.set(path,''); await send(p); assert.match(p.data.sendError,/文件为空/);
  io.files.set(path,'{}'); delete wx.shareFileMessage; await send(p); assert.match(p.data.sendError,/不支持/); assert.equal(p.data.busy,false);
});
test('同步抛错和路径错误不会卡住页面，诊断不暴露本地文件路径', async () => {
  const p=page(); await p.exportFile('json'); behavior='throw'; await send(p);
  assert.match(p.data.sendError,/native exception/); assert.equal(p.data.busy,false);
  behavior='shareFileMessage:fail cannot read '+p.pendingFile.path; await send(p);
  assert.ok(!JSON.parse(p.diagnosticText).fileSend.error.includes(p.pendingFile.path)); assert.match(p.data.sendError,/本地文件/);
});
test('生成失败不覆盖上一份待发送文件，返回页面仍能重试', async () => {
  const p=page(); await p.exportFile('json'); const old=p.pendingFile;
  const write=io.fs.writeFile; io.fs.writeFile=o=>o.fail(); await p.exportFile('json'); assert.equal(p.pendingFile,old);
  io.fs.writeFile=write; p.onShow(); await send(p); assert.equal(calls[0].filePath,old.path);
});
test('CSV与历史副本成功发送不标记当前完整账本已备份', async () => {
  const p=page(); await p.exportFile('json');
  for (const type of ['csv','assets']) { await p.exportFile(type); await send(p); assert.equal(store.read().lastBackupAt,''); }
  p.inspectLocal(); const candidate=p.data.candidates.find(c=>c.valid);
  await p.exportCandidate({currentTarget:{dataset:{id:candidate.id}}}); const count=calls.length;
  assert.equal(p.pendingFile.type,'candidate'); await send(p); assert.equal(calls.length,count+1); assert.equal(store.read().lastBackupAt,'');
});
test('生成后账本变更不会被旧文件标记为最新备份', async () => {
  const p=page(); await p.exportFile('json'); const s=store.read(); s.updatedAt='2099-01-01T00:00:00.000Z'; db.set(store.KEY,s);
  await send(p); assert.equal(store.read().lastBackupAt,''); assert.match(p.data.sendStatus,/账本已有更新/);
});
test('文件发送成功但备份时间写入失败仍报告发送成功', async () => {
  const p=page(); await p.exportFile('json'); const write=wx.setStorageSync;
  wx.setStorageSync=(k,v)=>{ if(k===store.KEY)throw new Error('full'); write(k,v); };
  await send(p); assert.match(p.data.sendStatus,/文件已发送，但备份时间未能更新/); assert.equal(p.data.busy,false);
});
test('同一份备份连续发送两次都算成功备份，不误报账本已有更新，也不改变账本时间', async () => {
  store.saveRecord({ type: 'expense', categoryId: 'food', amount: '12', refund: '0', date: '2024-02-10', time: '12:00', payment: '微信', note: '午饭' });
  const p = page(); await p.exportFile('json'); const updatedAt = store.read().updatedAt;
  await send(p); const first = store.read().lastBackupAt;
  assert.match(p.data.sendStatus, /文件已发送/); assert.equal(store.read().updatedAt, updatedAt);
  // Let the clock move on so a second backup time can be told apart from the first.
  await new Promise(resolve => setTimeout(resolve, 5));
  await send(p);
  assert.match(p.data.sendStatus, /文件已发送/); assert.notEqual(store.read().lastBackupAt, first); assert.equal(store.read().updatedAt, updatedAt);
});
