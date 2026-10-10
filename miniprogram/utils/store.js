const core = require('./core');
const assets = require('./assets');
const persistence = require('./ledger-storage');
const KEY = 'daily-expense:state:v3'; const SAFETY_KEY = 'daily-expense:before-restore:v3';
const V2_KEY = 'daily-expense:state:v2'; const V2_SAFETY_KEY = 'daily-expense:before-restore:v2';
const LEGACY_KEY = 'daily-expense:state:v1'; const LEGACY_SAFETY_KEY = 'daily-expense:before-restore:v1';
function missing(value) { return value === '' || value === undefined || value === null; }
function read() {
  return persistence.load().state;
}
function write(s, touch = true, operation = 'save', recovering = false) {
  return persistence.commit(s, touch, operation, recovering);
}
function saveRecord(input, recordId) {
  const s = read(); const prev = recordId ? s.records.find(r => r.id === recordId) : null;
  if (recordId && !prev) throw new Error('这笔账单已不存在');
  const record = core.createRecord(s, input, prev);
  if (prev) s.records[s.records.findIndex(r => r.id === recordId)] = record; else s.records.push(record);
  write(s); return record;
}
function removeRecord(recordId) { const s = read(); s.records = s.records.filter(r => r.id !== recordId); write(s); }
function saveCategory(name, icon, categoryId, type) {
  const s = read(); name = String(name || '').trim();
  if (!core.TYPES.includes(type)) throw new Error('请选择分类的收支类型');
  if (!name || name.length > 8) throw new Error('分类名称须为 1—8 个字');
  if (s.categories.some(c => c.type === type && c.name.trim() === name && c.id !== categoryId)) throw new Error('分类名称已经存在');
  if (categoryId) {
    const c = s.categories.find(c => c.id === categoryId);
    if (!c) throw new Error('分类已不存在');
    if (c.type !== type) throw new Error('不能修改分类的收支类型');
    c.name = name; c.icon = icon;
  } else {
    const count = s.categories.filter(c => c.type === type).length;
    if (count >= 40) throw new Error('每种收支类型最多支持 40 个分类');
    s.categories.push({ id: core.id('cat'), type, name, icon, color: core.COLORS[count % core.COLORS.length] });
  }
  write(s);
}
function removeCategory(categoryId, targetId) {
  const s = read(); const category = s.categories.find(c => c.id === categoryId); const target = s.categories.find(c => c.id === targetId);
  if (!category) throw new Error('分类已不存在');
  if (s.categories.filter(c => c.type === category.type).length <= 1) throw new Error('每种收支类型至少保留一个分类');
  if (targetId === categoryId || !target || target.type !== category.type) throw new Error('请选择同一收支类型的迁移分类');
  s.records.forEach(r => { if (r.categoryId === categoryId) r.categoryId = targetId; });
  s.categories = s.categories.filter(c => c.id !== categoryId); write(s);
}
function setBudget(v) { const s = read(); s.settings.budgetCents = core.amountToCents(v, true); write(s); }
function parseBackup(text) {
  let data; try { data = JSON.parse(text); } catch (e) { throw new Error('文件不是有效的 JSON 备份'); }
  if (!data || data.app !== 'daily-expense-miniapp' || ![1, 2, 3].includes(data.version) || !data.state || data.state.version !== data.version) throw new Error('请选择小日账支持的 JSON 备份');
  return core.migrateState(data.state);
}
function backupText() { return JSON.stringify({ app: 'daily-expense-miniapp', version: 3, exportedAt: new Date().toISOString(), state: read() }, null, 2); }
function prepareBackup() {
  const loaded = persistence.load();
  // Explicit export is a user action; persist before creating an external copy so
  // that a first export cannot later look like an orphaned recovery file.
  if (!loaded.raw || loaded.raw.version !== 3) write(loaded.state, false, 'prepare-backup');
}
function restore(s) {
  const next = core.migrateState(s);
  let prev = persistence.get(KEY);
  if (missing(prev)) prev = persistence.get(V2_KEY);
  if (missing(prev)) prev = persistence.get(LEGACY_KEY);
  // Never destroy a useful safety copy by replacing it with a fabricated empty state.
  try {
    if (!missing(prev)) {
      wx.setStorageSync(SAFETY_KEY, prev);
      if (JSON.stringify(persistence.get(SAFETY_KEY)) !== JSON.stringify(prev)) throw new Error('副本写入核验失败');
    }
  }
  catch (e) { throw new Error('无法创建恢复前副本，已取消恢复'); }
  return write(next, true, 'restore', true);
}
function safetyData() {
  let current = persistence.get(SAFETY_KEY);
  if (missing(current)) current = persistence.get(V2_SAFETY_KEY);
  return missing(current) ? persistence.get(LEGACY_SAFETY_KEY) : current;
}
function hasSafety() { return !missing(safetyData()); }
function restoreSafety() {
  const s = safetyData(); if (missing(s)) throw new Error('没有恢复前副本');
  return restore(core.migrateState(s));
}
function recoveryCandidate(id) { const item = persistence.candidate(id); return Object.assign({}, item, { token: persistence.checksum(item.state) }); }
function restoreCandidate(id, token) {
  const item = recoveryCandidate(id);
  if (item.token !== token) throw new Error('副本已变化，请重新检查并确认');
  return restore(item.state);
}
function markBackup() { const s = read(); s.lastBackupAt = new Date().toISOString(); write(s); }
function accountIn(s, accountId) {
  const account = s.accounts.find(a => a.id === accountId);
  if (!account) throw new Error('账户已不存在');
  return account;
}
function saveAccount(input, accountId) {
  const s = read(); let account;
  if (accountId) {
    account = accountIn(s, accountId);
    if (account.archivedAt !== null) throw new Error('请先重新启用账户');
    Object.assign(account, assets.accountInfo(s, input, account), { updatedAt: Math.max(Date.now(), account.updatedAt) });
  } else {
    if (s.accountValueHistory.length >= assets.MAX_HISTORY) throw new Error('金额更新历史已达 20,000 条上限');
    account = assets.createAccount(s, input);
    s.accounts.push(account); s.accountValueHistory.push(assets.valueEntry(account, input, true));
  }
  write(s); return account;
}
function updateAccountValue(accountId, input) {
  const s = read(); const account = accountIn(s, accountId);
  if (account.archivedAt !== null) throw new Error('请先重新启用账户');
  if (s.accountValueHistory.length >= assets.MAX_HISTORY) throw new Error('金额更新历史已达 20,000 条上限');
  const entry = assets.valueEntry(account, input, false);
  Object.assign(account, { amountCents: entry.amountCents, valuedOn: entry.valuedOn, updatedAt: entry.recordedAt });
  // Account value and its history are persisted together in a single storage write.
  s.accountValueHistory.push(entry); write(s); return account;
}
function archiveAccount(accountId, archived) {
  const s = read(); const account = accountIn(s, accountId);
  if (archived && account.amountCents !== 0) throw new Error('请先将当前金额更新为 0，再归档账户');
  account.updatedAt = Math.max(Date.now(), account.updatedAt);
  account.archivedAt = archived ? account.updatedAt : null; write(s);
}
function removeAccount(accountId) {
  const s = read(); accountIn(s, accountId);
  const history = s.accountValueHistory.filter(h => h.accountId === accountId);
  if (history.length !== 1 || history[0].reason !== 'opening') throw new Error('已有金额更新历史，请将金额归零后归档');
  s.accounts = s.accounts.filter(a => a.id !== accountId);
  s.accountValueHistory = s.accountValueHistory.filter(h => h.accountId !== accountId); write(s);
}
function setAssetAmountsHidden(hidden) { const s = read(); s.settings.assetAmountsHidden = hidden; write(s); }
function saveAssetCategory(name, icon, categoryId, kind) {
  const s = read(); name = String(name || '').trim();
  if (!assets.KINDS.includes(kind)) throw new Error('请选择资产或负债分类');
  if (!name || name.length > 8) throw new Error('分类名称须为 1—8 个字');
  if (typeof icon !== 'string' || !icon || icon.length > 10) throw new Error('请选择有效图标');
  if (s.assetCategories.some(c => c.kind === kind && c.name.trim() === name && c.id !== categoryId)) throw new Error('分类名称已经存在');
  if (categoryId) {
    const category = s.assetCategories.find(c => c.id === categoryId);
    if (!category || category.kind !== kind) throw new Error('不能修改分类的资产或负债类型');
    category.name = name; category.icon = icon;
  } else {
    const count = s.assetCategories.filter(c => c.kind === kind).length;
    if (count >= 40) throw new Error('资产和负债各最多支持 40 个分类');
    s.assetCategories.push({ id: assets.id('assetcat'), kind, name, icon, color: assets.COLORS[count % assets.COLORS.length] });
  }
  write(s);
}
function removeAssetCategory(categoryId, targetId) {
  const s = read(); const category = s.assetCategories.find(c => c.id === categoryId); const target = s.assetCategories.find(c => c.id === targetId);
  if (!category) throw new Error('分类已不存在');
  if (s.assetCategories.filter(c => c.kind === category.kind).length <= 1) throw new Error('资产和负债各至少保留一个分类');
  if (!target || target.id === categoryId || target.kind !== category.kind) throw new Error('请选择同一资产或负债类型的迁移分类');
  s.accounts.forEach(a => { if (a.categoryId === categoryId) a.categoryId = targetId; });
  s.assetCategories = s.assetCategories.filter(c => c.id !== categoryId); write(s);
}
module.exports = { KEY, SAFETY_KEY, V2_KEY, V2_SAFETY_KEY, LEGACY_KEY, LEGACY_SAFETY_KEY, read, write, saveRecord, removeRecord, saveCategory, removeCategory, setBudget, parseBackup, backupText, prepareBackup, restore, hasSafety, restoreSafety, markBackup, saveAccount, updateAccountValue, archiveAccount, removeAccount, setAssetAmountsHidden, saveAssetCategory, removeAssetCategory, protect: persistence.protect, diagnostics: persistence.diagnostics, protectionWarning: persistence.protectionWarning, recoveryCandidate, restoreCandidate };
