const core = require('./core');
const KEY = 'daily-expense:state:v3';
const MARKER = 'daily-expense:initialized:v3';
const LOG = 'daily-expense:diagnostics:v1';
const SNAPSHOTS = ['daily-expense:snapshot:0', 'daily-expense:snapshot:1'];
const OLD = ['daily-expense:state:v2', 'daily-expense:state:v1'];
const SAFETY = ['daily-expense:before-restore:v3', 'daily-expense:before-restore:v2', 'daily-expense:before-restore:v1'];
const AUTO_FILES = ['xiaorizhang-auto-0.json', 'xiaorizhang-auto-1.json'];
const OLD_EXPORT = 'xiaorizhang-backup.json';
// WeChat allows 1MB per storage key and 10MB in total. KEY therefore holds either a legacy
// single-object ledger or a small index of immutable chunks; writing the index is the commit point.
const CHUNK_PREFIX = 'daily-expense:chunk:';
const CHUNK_AVERAGE = 512; const CHUNK_MIN_ITEMS = 64; const CHUNK_MAX_ITEMS = 2000;
// Measured in characters: even at 3 UTF-8 bytes each plus JSON escaping, a chunk stays below 1MB.
const CHUNK_MAX_LENGTH = 256 * 1024;
const STAMPS = ['updatedAt', 'lastBackupAt'];
const CAPACITY_WARNING = 0.8;
const MISSING = '本地账本数据异常：发现使用记录或副本，但主账本无法读取。已停止自动创建和保存，请到「我的 → 导出与备份」检查本地副本。';
let warningOwner; let warningPending = false;
function rememberWarning(pending) { warningOwner = wx; warningPending = pending; }
// Per-runtime caches. Chunks never change after they are written, so cached text stays valid
// for as long as the key exists; tests replace the global wx object, which resets everything.
let cacheOwner; let cache;
function session() {
  if (cacheOwner !== wx) { cacheOwner = wx; cache = { chunks: new Map(), byHash: new Map(), ledger: null, files: new Map() }; }
  return cache;
}
const clone = value => JSON.parse(JSON.stringify(value));
const missing = value => value === '' || value === undefined || value === null;
function setItem(key, value) {
  // Tag storage failures so a full 10MB quota can be told apart from file-system errors.
  try { wx.setStorageSync(key, value); }
  catch (e) { const error = e instanceof Error ? e : new Error(String((e && e.errMsg) || e)); error.storage = true; throw error; }
}
function quota(e) { return !!e && e.storage === true && /exceed|quota|full|空间不足/i.test(String(e.message || '')); }
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
function fnv(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash;
}
function checksumText(text) { return fnv(text).toString(16); }
function checksum(state) { return checksumText(JSON.stringify(state)); }
// cyrb53: a 53-bit hash for chunk and index integrity, stronger than the 32-bit envelope checksum.
function hash53(text) {
  let h1 = 0xdeadbeef; let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
function boundary(id) {
  let h = fnv(String(id));
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) % CHUNK_AVERAGE === 0;
}
function split(items) {
  // Boundaries depend on record IDs, not positions, so editing or deleting one record
  // rewrites only the chunk around it and appending rewrites only the last chunk.
  const chunks = []; let parts = []; let length = 2;
  const close = () => {
    if (!parts.length) return;
    const text = '[' + parts.join(',') + ']';
    chunks.push({ text, hash: hash53(text), length: text.length, count: parts.length });
    parts = []; length = 2;
  };
  for (const item of items) {
    const text = JSON.stringify(item);
    if (parts.length && length + 1 + text.length > CHUNK_MAX_LENGTH) close();
    length += (parts.length ? 1 : 0) + text.length; parts.push(text);
    if (parts.length >= CHUNK_MAX_ITEMS || (parts.length >= CHUNK_MIN_ITEMS && boundary(item.id))) close();
  }
  close();
  return chunks;
}
function fingerprint(parts) {
  // Business content only: export and edit timestamps live in the index, not in any chunk.
  const describe = list => list.map(c => c.hash + ':' + c.length).join(',');
  return hash53(parts.meta.hash + ':' + parts.meta.length + '|' + describe(parts.records) + '|' + describe(parts.history));
}
function plan(state) {
  const meta = {};
  for (const key of Object.keys(state)) if (key !== 'records' && key !== 'accountValueHistory' && !STAMPS.includes(key)) meta[key] = state[key];
  const text = JSON.stringify(meta);
  if (text.length > CHUNK_MAX_LENGTH) throw new Error('分类、设置或账户资料过多，无法保存');
  const planned = { keys: Object.keys(state), meta: { text, hash: hash53(text), length: text.length, count: 1 }, records: split(state.records), history: split(state.accountValueHistory) };
  planned.fingerprint = fingerprint(planned);
  return planned;
}
function isManifest(value) { return !!value && typeof value === 'object' && value.layout === 'chunked'; }
function validRef(ref) {
  return !!ref && typeof ref === 'object' && typeof ref.key === 'string' && ref.key.startsWith(CHUNK_PREFIX) && typeof ref.hash === 'string' && Number.isSafeInteger(ref.length) && ref.length > 0 && Number.isSafeInteger(ref.count) && ref.count > 0;
}
function manifestOf(planned, refs, state) {
  const body = { layout: 'chunked', format: 1, version: 3, keys: planned.keys, updatedAt: state.updatedAt, lastBackupAt: state.lastBackupAt, meta: refs.meta, records: refs.records, history: refs.history, fingerprint: planned.fingerprint };
  body.check = hash53(JSON.stringify(body));
  return body;
}
function checkManifest(m) {
  if (!isManifest(m) || m.format !== 1 || m.version !== 3 || !Array.isArray(m.keys) || !m.keys.every(key => typeof key === 'string') || typeof m.updatedAt !== 'string' || typeof m.lastBackupAt !== 'string' || !validRef(m.meta) || !Array.isArray(m.records) || !m.records.every(validRef) || !Array.isArray(m.history) || !m.history.every(validRef) || typeof m.fingerprint !== 'string') throw new Error('账本索引无效');
  const { check, ...body } = m;
  if (check !== hash53(JSON.stringify(body))) throw new Error('账本索引校验失败');
  return m;
}
function refsOf(m) {
  const refs = [m.meta].concat(m.records, m.history);
  if (!refs.every(ref => ref && typeof ref.key === 'string')) throw new Error('无法确认账本分块');
  return refs.map(ref => ref.key);
}
function remember(key, text, hash) {
  const c = session(); c.chunks.set(key, { text, hash });
  if (!c.byHash.has(hash)) c.byHash.set(hash, new Set());
  c.byHash.get(hash).add(key);
}
function forget(key) {
  const c = session(); const entry = c.chunks.get(key); if (!entry) return;
  c.chunks.delete(key); const keys = c.byHash.get(entry.hash);
  if (keys) { keys.delete(key); if (!keys.size) c.byHash.delete(entry.hash); }
}
function discard(keys) {
  for (const key of keys) {
    try { if (typeof wx.removeStorageSync === 'function') wx.removeStorageSync(key); } catch (e) { /* removed by the next cleanup */ }
    forget(key);
  }
}
function chunkText(ref, present) {
  if (!present.has(ref.key)) throw new Error('账本分块缺失');
  const cached = session().chunks.get(ref.key);
  if (cached) {
    if (cached.hash !== ref.hash || cached.text.length !== ref.length) throw new Error('账本分块校验失败');
    return cached.text;
  }
  let text;
  try { text = wx.getStorageSync(ref.key); } catch (e) { throw new Error('无法读取本地账本，请稍后重试'); }
  if (typeof text !== 'string' || text.length !== ref.length || hash53(text) !== ref.hash) throw new Error('账本分块校验失败');
  remember(ref.key, text, ref.hash);
  return text;
}
function readManifest(m, keys) {
  checkManifest(m);
  const present = new Set(keys);
  const meta = JSON.parse(chunkText(m.meta, present));
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('账本分块无效');
  const items = refs => {
    const all = [];
    for (const ref of refs) {
      const list = JSON.parse(chunkText(ref, present));
      if (!Array.isArray(list) || list.length !== ref.count) throw new Error('账本分块无效');
      for (const item of list) all.push(item);
    }
    return all;
  };
  const records = items(m.records); const history = items(m.history); const state = {};
  // Rebuild in the saved key order so exported JSON stays identical to the in-memory state.
  for (const key of m.keys) state[key] = key === 'records' ? records : key === 'accountValueHistory' ? history : STAMPS.includes(key) ? m[key] : meta[key];
  return state;
}
let chunkSequence = 0;
function storeChunks(planned, present) {
  const written = [];
  const put = chunk => {
    const c = session();
    for (const key of c.byHash.get(chunk.hash) || []) {
      // Identical content that still exists is shared instead of written again.
      if (present.has(key) && c.chunks.get(key).text === chunk.text) return { key, hash: chunk.hash, length: chunk.length, count: chunk.count };
    }
    const key = CHUNK_PREFIX + Date.now().toString(36) + '-' + (++chunkSequence).toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    setItem(key, chunk.text); written.push(key);
    let actual; try { actual = wx.getStorageSync(key); } catch (e) { actual = null; }
    if (actual !== chunk.text) throw new Error('分块写入核验失败');
    remember(key, chunk.text, chunk.hash); present.add(key);
    return { key, hash: chunk.hash, length: chunk.length, count: chunk.count };
  };
  try { return { refs: { meta: put(planned.meta), records: planned.records.map(put), history: planned.history.map(put) }, written }; }
  catch (e) { discard(written); throw e; }
}
function chunkState(state, present) {
  const planned = plan(state); const stored = storeChunks(planned, present);
  return { manifest: manifestOf(planned, stored.refs, state), written: stored.written };
}
function load() {
  const c = session(); const keys = keyList(); const raw = get(KEY, keys);
  if (!missing(raw)) {
    try {
      if (isManifest(raw)) {
        const signature = JSON.stringify(raw); const present = new Set(keys);
        if (c.ledger && c.ledger.signature === signature && refsOf(raw).every(key => present.has(key))) return { state: JSON.parse(c.ledger.text), raw, manifest: raw };
        const state = core.migrateState(readManifest(raw, keys));
        c.ledger = { signature, text: JSON.stringify(state) };
        return { state, raw, manifest: raw };
      }
      if (raw.version !== 3) throw new Error('version');
      return { state: core.migrateState(clone(raw)), raw };
    } catch (e) { throw new Error('本地账本数据异常。请到「我的 → 导出与备份」检查本地副本，原数据未被覆盖。'); }
  }
  // A missing v3 must never silently resurrect a stale pre-upgrade ledger.
  if (keys.some(key => key === MARKER || SNAPSHOTS.includes(key) || key.startsWith(CHUNK_PREFIX))) throw new Error(MISSING);
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
function resolve(raw) {
  session();
  return core.migrateState(isManifest(raw) ? readManifest(raw, keyList()) : raw);
}
function unpack(value) {
  if (!value || value.format !== 1 || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || typeof value.savedAt !== 'string' || checksum(value.state) !== value.checksum) throw new Error('副本完整性校验失败');
  return core.migrateState(value.state);
}
function checkEnvelope(value) {
  if (!value || value.format !== 2 || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || typeof value.savedAt !== 'string') throw new Error('副本完整性校验失败');
  return checkManifest(value.manifest);
}
function unpackAny(value, keys) {
  if (!value || value.format !== 2) return unpack(value);
  checkEnvelope(value);
  return core.migrateState(readManifest(value.manifest, keys));
}
function latestOf(slots) { return Math.max(0, ...slots.map(slot => slot ? slot.sequence : 0)); }
function olderOf(slots) { return !slots[0] ? 0 : !slots[1] ? 1 : slots[0].sequence <= slots[1].sequence ? 0 : 1; }
function current(slots, print) { const latest = latestOf(slots); return slots.some(slot => slot && slot.sequence === latest && slot.fingerprint === print); }
function storageSlot(value, present) {
  if (missing(value)) return null;
  try {
    if (value.format === 2) {
      checkEnvelope(value);
      if (!refsOf(value.manifest).every(key => present.has(key))) return null;
      return { sequence: value.sequence, fingerprint: value.manifest.fingerprint };
    }
    return { sequence: value.sequence, fingerprint: plan(unpack(value)).fingerprint };
  } catch (e) { return null; }
}
function snapshot(state, manifest) {
  const keys = keyList(); const present = new Set(keys);
  const slots = SNAPSHOTS.map(key => storageSlot(get(key, keys), present));
  const planned = manifest ? null : plan(state);
  // Export timestamps alone should not evict an older business-data revision.
  if (current(slots, manifest ? manifest.fingerprint : planned.fingerprint)) return;
  // Snapshots reference the same immutable chunks instead of copying the ledger into one key.
  const stored = manifest ? null : storeChunks(planned, present);
  const value = { format: 2, sequence: latestOf(slots) + 1, savedAt: new Date().toISOString(), manifest: manifest || manifestOf(planned, stored.refs, state) };
  const slot = SNAPSHOTS[olderOf(slots)];
  try { setItem(slot, value); } catch (e) { if (stored) discard(stored.written); throw e; }
  if (JSON.stringify(get(slot)) !== JSON.stringify(value)) throw new Error('副本写入核验失败');
}
function fileSlot(fs, root, names, name) {
  if (!names.includes(name)) return null;
  const path = `${root}/${name}`; const files = session().files; let size;
  try { size = fs.statSync(path).size; } catch (e) { return null; }
  const cached = files.get(name);
  if (cached && cached.size === size) return cached;
  try {
    const value = JSON.parse(fs.readFileSync(path, 'utf8'));
    const info = { sequence: value.sequence, fingerprint: plan(unpack(value)).fingerprint, size };
    files.set(name, info); return info;
  } catch (e) { files.delete(name); return null; }
}
function snapshotFile(state, manifest, stateText) {
  const { fs, root, names } = disk();
  const slots = AUTO_FILES.map(name => fileSlot(fs, root, names, name));
  const print = manifest ? manifest.fingerprint : plan(state).fingerprint;
  if (current(slots, print)) return;
  const sequence = latestOf(slots) + 1; const name = AUTO_FILES[olderOf(slots)];
  const path = `${root}/${name}`; const temp = `${path}.tmp`; const json = stateText || JSON.stringify(state);
  // Same envelope as format 1 copies (readable by earlier versions), plus the content fingerprint.
  const text = '{"format":1,"sequence":' + sequence + ',"savedAt":' + JSON.stringify(new Date().toISOString()) + ',"checksum":' + JSON.stringify(checksumText(json)) + ',"fingerprint":' + JSON.stringify(print) + ',"state":' + json + '}';
  fs.writeFileSync(temp, text, 'utf8');
  if (fs.readFileSync(temp, 'utf8') !== text) throw new Error('备份文件核验失败');
  // Only replace the older/invalid slot after a verified temporary copy exists.
  // The other slot remains intact even if rename fails or the process exits.
  session().files.delete(name);
  if (names.includes(name)) fs.unlinkSync(path);
  fs.renameSync(temp, path);
  if (!names.includes(name)) names.push(name);
  if (fs.readFileSync(path, 'utf8') !== text) throw new Error('备份文件核验失败');
  try { session().files.set(name, { sequence, fingerprint: print, size: fs.statSync(path).size }); } catch (e) { /* re-read next time */ }
}
function collect() {
  // Delete chunks that no index references. Any unreadable index aborts the whole cleanup.
  if (typeof wx.removeStorageSync !== 'function') return;
  const keys = keyList(); const chunks = keys.filter(key => key.startsWith(CHUNK_PREFIX));
  if (!chunks.length) return;
  const live = new Set(); const add = m => refsOf(m).forEach(key => live.add(key));
  for (const key of [KEY, SAFETY[0]]) { const value = get(key, keys); if (isManifest(value)) add(value); }
  for (const key of SNAPSHOTS) { const value = get(key, keys); if (value && value.format === 2) add(value.manifest); }
  for (const key of chunks) if (!live.has(key)) { wx.removeStorageSync(key); forget(key); }
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
function protectState(state, manifest, stateText) {
  const failures = [];
  for (const [name, action] of [['历史快照', () => snapshot(state, manifest)], ['设备文件备份', () => snapshotFile(state, manifest, stateText)], ['使用标记', () => wx.setStorageSync(MARKER, { version: 1 })]]) {
    try { action(); } catch (e) { failures.push(name); }
  }
  // Leftover chunks only cost space; a failed cleanup is retried after the next save.
  try { collect(); } catch (e) { /* retried later */ }
  rememberWarning(failures.length > 0);
  return failures;
}
function protect() {
  const loaded = load();
  if (!loaded.raw || loaded.raw.version !== 3) return [];
  const warnings = protectState(loaded.state, loaded.manifest);
  log('protect', warnings.length ? 'degraded:' + warnings.join(',') : 'ok', loaded.state);
  return warnings;
}
function reason(e) {
  const message = String((e && e.message) || '');
  if (/exceed|quota|full|空间不足/i.test(message)) return '本地空间不足（' + message + '）';
  return message || '本地空间不足或存储不可用';
}
function reclaim() {
  // Release the older of two valid storage snapshots and the chunks only it uses. The device
  // files keep their own two full copies, and the next save rotates a snapshot into the slot.
  if (typeof wx.removeStorageSync !== 'function') return false;
  const keys = keyList(); const present = new Set(keys);
  const slots = SNAPSHOTS.map(key => storageSlot(get(key, keys), present));
  if (!slots[0] || !slots[1]) return false;
  wx.removeStorageSync(SNAPSHOTS[olderOf(slots)]);
  collect();
  return true;
}
function discardUnreferenced(next) {
  // Remove the new chunks only when the index provably still points elsewhere.
  try { if (JSON.stringify(wx.getStorageSync(KEY)) === JSON.stringify(next.manifest)) return; }
  catch (e) { return; }
  discard(next.written);
}
function commit(input, touch = true, operation = 'save', recovering = false) {
  const c = session(); const state = clone(input); core.validateState(state);
  if (touch) state.updatedAt = new Date().toISOString();
  let previous; let next;
  const attempt = () => {
    if (!recovering) {
      previous = load();
      if (previous.raw && previous.raw.version === 3) {
        // Abort before changing the primary ledger if the previous valid state cannot be protected.
        snapshot(previous.state, previous.manifest);
        snapshotFile(previous.state, previous.manifest);
      }
    }
    // Chunks are written under new keys first; the old index keeps pointing at the old ones.
    next = chunkState(state, new Set(keyList()));
    setItem(KEY, next.manifest);
  };
  try {
    try { attempt(); }
    catch (e) {
      if (next) { discardUnreferenced(next); next = undefined; }
      // With a full quota, free the older storage snapshot once and retry, so that edits such
      // as deletions can still be saved. Any other failure is reported unchanged.
      let freed = false;
      try { freed = quota(e) && reclaim(); } catch (r) { freed = false; }
      if (!freed) throw e;
      attempt();
    }
  } catch (e) {
    if (next) discardUnreferenced(next);
    rememberWarning(true);
    if (recovering || (previous && previous.raw)) log(operation, 'failed', state);
    throw new Error('保存失败：' + reason(e) + '。原数据未主动覆盖，请先检查或导出备份。');
  }
  try {
    if (JSON.stringify(get(KEY)) !== JSON.stringify(next.manifest)) throw new Error('mismatch');
  } catch (e) {
    rememberWarning(true);
    log(operation, 'unverified', state);
    throw new Error('保存结果无法核实，请重新检查账本和本地副本，勿重复提交。');
  }
  // The main write has committed. A later backup failure is a warning, not a failed save.
  const text = JSON.stringify(state);
  // Pending category upgrades are applied on every read, so only cache states that need none.
  c.ledger = state.settings.expenseCategoryRevision >= 1 ? { signature: JSON.stringify(next.manifest), text } : null;
  const warnings = protectState(state, next.manifest, text);
  log(operation, warnings.length ? 'committed-degraded:' + warnings.join(',') : 'ok', state);
  return state;
}
function candidates() {
  session();
  const result = []; let keys;
  try { keys = keyList(); } catch (e) { result.push({ id: 'storage-error', label: '本地存储', error: e.message }); }
  function add(id, label, read, kind) {
    try {
      const raw = read(); if (missing(raw)) return;
      let state;
      if (kind === 'snapshot') state = unpackAny(raw, keys);
      else if (kind === 'backup') {
        if (!raw || raw.app !== 'daily-expense-miniapp' || ![1, 2, 3].includes(raw.version) || !raw.state || raw.state.version !== raw.version) throw new Error('不是有效的账本备份');
        state = core.migrateState(raw.state);
      } else if (isManifest(raw)) state = core.migrateState(readManifest(raw, keys));
      else { if (!raw || raw.version !== Number(id.slice(-1))) throw new Error('数据版本无效'); state = core.migrateState(raw); }
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
function capacity() {
  try {
    const info = wx.getStorageInfoSync(); const used = Number(info.currentSize); const limit = Number(info.limitSize);
    if (!Number.isFinite(used) || !Number.isFinite(limit) || used < 0 || limit <= 0) return null;
    return { usedKB: used, limitKB: limit, ratio: used / limit };
  } catch (e) { return null; }
}
function capacityText(c) { return `${(c.usedKB / 1024).toFixed(1)} MB / ${(c.limitKB / 1024).toFixed(0)} MB`; }
function capacityWarning() {
  const c = capacity();
  if (!c || c.ratio < CAPACITY_WARNING) return '';
  return `本地存储已用 ${Math.min(100, Math.round(c.ratio * 100))}%（${capacityText(c)}）。请导出 JSON 备份并保存到设备之外；空间用满后将无法继续保存。`;
}
function diagnostics() {
  const report = { inspectedAt: new Date().toISOString(), candidates: candidates().map(({ state, ...item }) => item), events: [] };
  try { const info = wx.getStorageInfoSync(); report.storage = { currentSize: info.currentSize, limitSize: info.limitSize, ledgerKeys: info.keys.filter(key => key.startsWith('daily-expense:') && !key.startsWith(CHUNK_PREFIX)), chunkKeys: info.keys.filter(key => key.startsWith(CHUNK_PREFIX)).length, primaryPresent: info.keys.includes(KEY) }; } catch (e) { report.storageError = '无法读取存储容量'; }
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
module.exports = { KEY, MARKER, LOG, SNAPSHOTS, OLD, SAFETY, AUTO_FILES, CHUNK_PREFIX, CHUNK_MAX_LENGTH, missing, get, load, resolve, commit, protect, candidates, candidate, diagnostics, checksum, protectionWarning, capacity, capacityText, capacityWarning };
