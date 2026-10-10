const core = require('./core');
const KEY = 'daily-expense:state:v3';
const MARKER = 'daily-expense:initialized:v3';
const LOG = 'daily-expense:diagnostics:v1';
const SNAPSHOTS = ['daily-expense:snapshot:0', 'daily-expense:snapshot:1'];
const OLD = ['daily-expense:state:v2', 'daily-expense:state:v1'];
const SAFETY = ['daily-expense:before-restore:v3', 'daily-expense:before-restore:v2', 'daily-expense:before-restore:v1'];
const AUTO_FILES = ['xiaorizhang-auto-0.json', 'xiaorizhang-auto-1.json'];
const OLD_EXPORT = 'xiaorizhang-backup.json';
const MISSING = '本地账本数据异常：发现使用记录或副本，但主账本无法读取。已停止自动创建和保存，请到「我的 → 导出与备份」检查本地副本。';
let warningOwner; let warningPending = false;
function rememberWarning(pending) { warningOwner = wx; warningPending = pending; }
const clone = value => JSON.parse(JSON.stringify(value));
const missing = value => value === '' || value === undefined || value === null;
function keyList() {
  try {
    const info = wx.getStorageInfoSync();
    if (!info || !Array.isArray(info.keys)) throw new Error('invalid keys');
    return info.keys;
  } catch (e) { throw new Error('无法读取本地存储目录，已停止保存，请稍后重试'); }
}
function get(key, keys = keyList()) {
  let value;
  try { value = wx.getStorageSync(key); }
  catch (e) { throw new Error('无法读取本地账本，请稍后重试'); }
  if (missing(value) && keys.includes(key)) throw new Error(MISSING);
  return value;
}
function disk() {
  if (!wx.env || !wx.env.USER_DATA_PATH || !wx.getFileSystemManager) throw new Error('无法检查设备内备份文件');
  const fs = wx.getFileSystemManager(); const root = wx.env.USER_DATA_PATH;
  return { fs, root, names: fs.readdirSync(root) };
}
function fileEvidence() {
  try { return disk().names.some(name => AUTO_FILES.includes(name) || name === OLD_EXPORT || /^xiaorizhang-backup-.*\.json$/.test(name) || /^xiaorizhang-auto-.*\.tmp$/.test(name)); }
  catch (e) { throw new Error('无法检查设备内备份文件，已停止自动创建账本，请稍后重试'); }
}
function load() {
  const keys = keyList(); const raw = get(KEY, keys);
  if (!missing(raw)) {
    try { if (raw.version !== 3) throw new Error('version'); return { state: core.migrateState(clone(raw)), raw }; }
    catch (e) { throw new Error('本地账本数据异常。请到「我的 → 导出与备份」检查本地副本，原数据未被覆盖。'); }
  }
  // A missing v3 must never silently resurrect a stale pre-upgrade ledger.
  if (keys.some(key => key === MARKER || SNAPSHOTS.includes(key))) throw new Error(MISSING);
  if (fileEvidence()) throw new Error(MISSING);
  for (let i = 0; i < OLD.length; i++) {
    const old = get(OLD[i], keys);
    if (!missing(old)) {
      try { if (old.version !== 2 - i) throw new Error('version'); return { state: core.migrateState(old), raw: old }; }
      catch (e) { throw new Error('旧版账本数据异常，原数据未被覆盖。请到「我的 → 导出与备份」检查本地副本。'); }
    }
  }
  if (keys.some(key => SAFETY.includes(key) || key === LOG)) throw new Error(MISSING);
  // Empty state is only a view. The first user save creates the ledger.
  return { state: core.freshState(), raw: null };
}
function checksum(state) {
  const text = JSON.stringify(state); let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash.toString(16);
}
function unpack(value) {
  if (!value || value.format !== 1 || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || typeof value.savedAt !== 'string' || checksum(value.state) !== value.checksum) throw new Error('副本完整性校验失败');
  return core.migrateState(value.state);
}
function envelope(state, sequence) { return { format: 1, sequence, savedAt: new Date().toISOString(), checksum: checksum(state), state: clone(state) }; }
function content(state) { const { updatedAt, lastBackupAt, ...data } = state; return JSON.stringify(data); }
function rotate(state, read, write, slots) {
  const values = slots.map(slot => {
    const value = read(slot);
    try { unpack(value); return value; } catch (e) { return null; }
  });
  // Export timestamps alone should not evict an older business-data revision.
  const latest = Math.max(0, ...values.map(value => value ? value.sequence : 0));
  const match = values.findIndex(value => value && content(value.state) === content(state));
  if (match >= 0 && values[match].sequence === latest) return;
  const sequence = latest + 1;
  // Revisiting an older state makes that slot current again; keep the actual predecessor.
  const index = match >= 0 ? match : !values[0] ? 0 : !values[1] ? 1 : values[0].sequence <= values[1].sequence ? 0 : 1;
  const value = envelope(state, sequence); write(slots[index], value);
  const actual = read(slots[index]); unpack(actual);
  if (JSON.stringify(actual) !== JSON.stringify(value)) throw new Error('副本写入核验失败');
}
function snapshot(state) {
  const keys = keyList();
  rotate(state, key => get(key, keys), (key, value) => wx.setStorageSync(key, value), SNAPSHOTS);
}
function snapshotFile(state) {
  const { fs, root, names } = disk();
  rotate(state, name => {
    if (!names.includes(name)) return null;
    const text = fs.readFileSync(`${root}/${name}`, 'utf8');
    try { return JSON.parse(text); } catch (e) { return null; }
  }, (name, value) => {
    const temp = `${root}/${name}.tmp`; const text = JSON.stringify(value);
    fs.writeFileSync(temp, text, 'utf8');
    if (fs.readFileSync(temp, 'utf8') !== text) throw new Error('备份文件核验失败');
    // Only replace the older/invalid slot after a verified temporary copy exists.
    // The other slot remains intact even if rename fails or the process exits.
    if (names.includes(name)) fs.unlinkSync(`${root}/${name}`);
    fs.renameSync(temp, `${root}/${name}`);
    if (!names.includes(name)) names.push(name);
  }, AUTO_FILES);
}
function log(operation, result, state) {
  // Metadata only. Diagnostic failure must not turn a committed save into a reported failure.
  try {
    const previous = wx.getStorageSync(LOG); const entries = Array.isArray(previous) ? previous.filter(e => e && typeof e === 'object').slice(-39) : [];
    let version = '';
    try { const info = wx.getAccountInfoSync().miniProgram; version = `${info.envVersion || ''}:${info.version || ''}`; } catch (e) { /* optional */ }
    entries.push({ time: new Date().toISOString(), operation, result, version, records: state ? state.records.length : null, accounts: state ? state.accounts.length : null });
    wx.setStorageSync(LOG, entries);
  } catch (e) { rememberWarning(true); }
}
function protectState(state) {
  const failures = [];
  for (const [name, action] of [['历史快照', () => snapshot(state)], ['设备文件备份', () => snapshotFile(state)], ['使用标记', () => wx.setStorageSync(MARKER, { version: 1 })]]) {
    try { action(); } catch (e) { failures.push(name); }
  }
  rememberWarning(failures.length > 0);
  return failures;
}
function protect() {
  const loaded = load();
  if (!loaded.raw || loaded.raw.version !== 3) return [];
  const warnings = protectState(loaded.state);
  log('protect', warnings.length ? 'degraded:' + warnings.join(',') : 'ok', loaded.state);
  return warnings;
}
function commit(input, touch = true, operation = 'save', recovering = false) {
  const state = clone(input); core.validateState(state);
  if (touch) state.updatedAt = new Date().toISOString();
  let previous;
  try {
    if (!recovering) {
      previous = load();
      if (previous.raw && previous.raw.version === 3) {
        // Abort before changing the primary ledger if the previous valid state cannot be protected.
        snapshot(previous.state);
        snapshotFile(previous.state);
      }
    }
    wx.setStorageSync(KEY, state);
  } catch (e) {
    rememberWarning(true);
    if (recovering || (previous && previous.raw)) log(operation, 'failed', state);
    throw new Error('保存失败：' + (e.message || '本地空间不足或存储不可用') + '。原数据未主动覆盖，请先检查或导出备份。');
  }
  try {
    if (JSON.stringify(get(KEY)) !== JSON.stringify(state)) throw new Error('mismatch');
  } catch (e) {
    rememberWarning(true);
    log(operation, 'unverified', state);
    throw new Error('保存结果无法核实，请重新检查账本和本地副本，勿重复提交。');
  }
  // The main write has committed. A later backup failure is a warning, not a failed save.
  const warnings = protectState(state);
  log(operation, warnings.length ? 'committed-degraded:' + warnings.join(',') : 'ok', state);
  return state;
}
function candidates() {
  const result = []; let keys;
  try { keys = keyList(); } catch (e) { result.push({ id: 'storage-error', label: '本地存储', error: e.message }); }
  function add(id, label, read, kind) {
    try {
      const raw = read(); if (missing(raw)) return;
      let state;
      if (kind === 'snapshot') state = unpack(raw);
      else if (kind === 'backup') {
        if (!raw || raw.app !== 'daily-expense-miniapp' || ![1, 2, 3].includes(raw.version) || !raw.state || raw.state.version !== raw.version) throw new Error('不是有效的账本备份');
        state = core.migrateState(raw.state);
      } else { if (!raw || raw.version !== Number(id.slice(-1))) throw new Error('数据版本无效'); state = core.migrateState(raw); }
      result.push({ id, label, valid: true, records: state.records.length, accounts: state.accounts.length, updatedAt: state.updatedAt, savedAt: raw.savedAt || raw.exportedAt || '', state });
    } catch (e) { result.push({ id, label, valid: false, error: e.message }); }
  }
  for (const [key, label] of keys ? [[KEY, '当前账本'], ...OLD.map((key, i) => [key, '升级前账本 v' + (2 - i)]), ...SAFETY.map((key, i) => [key, '导入前副本 v' + (3 - i)]), ...SNAPSHOTS.map((key, i) => [key, '历史快照 ' + (i + 1)])] : []) {
    add(key, label, () => get(key, keys), SNAPSHOTS.includes(key) ? 'snapshot' : 'state');
  }
  try {
    const { fs, root, names } = disk();
    const exports = names.filter(name => name === OLD_EXPORT || /^xiaorizhang-backup-[a-zA-Z0-9-]+\.json$/.test(name)).sort().reverse();
    for (const name of AUTO_FILES.reduce((all, file) => all.concat(file, file + '.tmp'), []).concat(exports)) if (names.includes(name)) {
      const autoIndex = AUTO_FILES.indexOf(name.replace(/\.tmp$/, ''));
      const label = autoIndex < 0 ? '曾导出的 JSON 备份' : '设备自动备份 ' + (autoIndex + 1) + (name.endsWith('.tmp') ? '（中断时保留）' : '');
      add('file:' + name, label, () => JSON.parse(fs.readFileSync(`${root}/${name}`, 'utf8')), autoIndex >= 0 ? 'snapshot' : 'backup');
    }
  } catch (e) { result.push({ id: 'file-error', label: '设备文件备份', error: '无法读取设备内备份文件' }); }
  return result;
}
function candidate(id) {
  const value = candidates().find(item => item.id === id && item.valid);
  if (!value) throw new Error('副本已变化或无法读取，请重新检查');
  return value;
}
function diagnostics() {
  const report = { inspectedAt: new Date().toISOString(), candidates: candidates().map(({ state, ...item }) => item), events: [] };
  try { const info = wx.getStorageInfoSync(); report.storage = { currentSize: info.currentSize, limitSize: info.limitSize, ledgerKeys: info.keys.filter(key => key.startsWith('daily-expense:')), primaryPresent: info.keys.includes(KEY) }; } catch (e) { report.storageError = '无法读取存储容量'; }
  try { const app = wx.getAccountInfoSync().miniProgram; report.application = { version: app.version, environment: app.envVersion }; } catch (e) { report.application = { unavailable: true }; }
  try { const events = wx.getStorageSync(LOG); if (Array.isArray(events)) report.events = events.filter(e => e && typeof e === 'object').slice(-40).map(e => ({ time: e.time, operation: e.operation, result: e.result, version: e.version, records: e.records, accounts: e.accounts })); } catch (e) { report.logError = '无法读取诊断记录'; }
  return report;
}
function protectionWarning() {
  try {
    const events = wx.getStorageSync(LOG); const last = Array.isArray(events) ? events[events.length - 1] : null;
    return (warningOwner === wx && warningPending) || (last && /degraded|unverified|failed/.test(last.result)) ? '最近一次保存或备份保护未完整完成，请检查本地副本，并将有效 JSON 备份保存到设备之外。' : '';
  } catch (e) { return '无法检查备份保护状态，请到「导出与备份」检查。'; }
}
module.exports = { KEY, MARKER, LOG, SNAPSHOTS, OLD, SAFETY, AUTO_FILES, missing, get, load, commit, protect, candidates, candidate, diagnostics, checksum, protectionWarning };
