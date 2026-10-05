const core = require('./core');
const KEY = 'daily-expense:state:v1'; const SAFETY_KEY = 'daily-expense:before-restore:v1';
function read() {
  let data; try { data = wx.getStorageSync(KEY); } catch (e) { throw new Error('无法读取本地账本，请稍后重试'); }
  if (data === '' || data === undefined || data === null) { const s = core.freshState(); write(s); return s; }
  try { return core.validateState(data); } catch (e) { throw new Error('本地账本数据异常。请到「我的 → 导出与备份」恢复有效备份，原数据未被覆盖。'); }
}
function write(s) {
  core.validateState(s); s.updatedAt = new Date().toISOString();
  try { wx.setStorageSync(KEY, s); } catch (e) { throw new Error('保存失败：本地空间不足或存储不可用，请先导出备份'); }
  return s;
}
function saveRecord(input, recordId) {
  const s = read(); const prev = recordId ? s.records.find(r => r.id === recordId) : null;
  if (recordId && !prev) throw new Error('这笔账单已不存在');
  const record = core.createRecord(s, input, prev);
  if (prev) s.records[s.records.findIndex(r => r.id === recordId)] = record; else s.records.push(record);
  write(s); return record;
}
function removeRecord(recordId) { const s = read(); s.records = s.records.filter(r => r.id !== recordId); write(s); }
function saveCategory(name, icon, categoryId) {
  const s = read(); name = String(name || '').trim();
  if (!name || name.length > 8) throw new Error('分类名称须为 1—8 个字');
  if (s.categories.some(c => c.name === name && c.id !== categoryId)) throw new Error('分类名称已经存在');
  if (categoryId) { const c = s.categories.find(c => c.id === categoryId); if (!c) throw new Error('分类已不存在'); c.name = name; c.icon = icon; }
  else { if (s.categories.length >= 40) throw new Error('最多支持 40 个分类'); s.categories.push({ id: core.id('cat'), name, icon, color: core.COLORS[s.categories.length % core.COLORS.length] }); }
  write(s);
}
function removeCategory(categoryId, targetId) {
  const s = read(); if (s.categories.length <= 1) throw new Error('至少保留一个分类');
  if (targetId === categoryId || !s.categories.some(c => c.id === targetId)) throw new Error('请选择有效的迁移分类');
  s.records.forEach(r => { if (r.categoryId === categoryId) r.categoryId = targetId; });
  s.categories = s.categories.filter(c => c.id !== categoryId); write(s);
}
function setBudget(v) { const s = read(); s.settings.budgetCents = core.amountToCents(v, true); write(s); }
function parseBackup(text) {
  let data; try { data = JSON.parse(text); } catch (e) { throw new Error('文件不是有效的 JSON 备份'); }
  if (!data || data.app !== 'daily-expense-miniapp' || data.version !== 1) throw new Error('请选择小日账导出的 JSON 备份');
  return core.validateState(data.state);
}
function backupText() { return JSON.stringify({ app: 'daily-expense-miniapp', version: 1, exportedAt: new Date().toISOString(), state: read() }, null, 2); }
function restore(s) {
  core.validateState(s); const prev = wx.getStorageSync(KEY);
  try { wx.setStorageSync(SAFETY_KEY, prev || core.freshState()); } catch (e) { throw new Error('无法创建恢复前副本，已取消恢复'); }
  return write(s);
}
function restoreSafety() { const s = wx.getStorageSync(SAFETY_KEY); if (!s) throw new Error('没有恢复前副本'); return write(core.validateState(s)); }
function markBackup() { const s = read(); s.lastBackupAt = new Date().toISOString(); write(s); }
module.exports = { KEY, SAFETY_KEY, read, write, saveRecord, removeRecord, saveCategory, removeCategory, setBudget, parseBackup, backupText, restore, restoreSafety, markBackup };
