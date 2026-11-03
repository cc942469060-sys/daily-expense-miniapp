const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const files = require('../../utils/files'); const ui = require('../../utils/ui');
const assets = require('../../utils/assets');
function isManualExport(item) { return /^file:xiaorizhang-backup(?:-[a-zA-Z0-9-]+)?\.json$/.test(item.id); }
function exportTime(item) {
  const timestamp = Date.parse(item.savedAt || '');
  if (Number.isFinite(timestamp)) return timestamp;
  const match = item.id.match(/^file:xiaorizhang-backup-(\d+)-/);
  return match ? Number(match[1]) : 0;
}
Page({
  data: { count: 0, accountCount: 0, backupTime: '尚未成功发送备份', busy: false, storageError: '', fileName: '', pendingId: '', sendFileType: '', sendStatus: '', sendError: '', latestExport: null, historyExports: [], recoveryCopies: [], historyOpen: false, recoveryOpen: false, hasSafety: false, inspected: false, candidates: [], diagnosticText: '', protectionWarning: '' },
  onShow() { this.refresh(); },
  refresh() {
    try {
      const s = store.read(); const time = s.lastBackupAt ? new Date(s.lastBackupAt) : null;
      this.setData({ count: s.records.length, accountCount: s.accounts.length, backupTime: time && !Number.isNaN(time.getTime()) ? `${dates.dateKey(time)} ${dates.timeKey(time)}` : '尚未成功发送备份', storageError: '' });
    } catch (e) { this.setData({ storageError: e.message }); }
    try { this.setData({ hasSafety: store.hasSafety() }); } catch (e) { this.setData({ hasSafety: false }); }
    this.inspectLocal();
  },
  inspectLocal() {
    const report = store.diagnostics();
    if (this.lastSendDiagnostic) report.fileSend = this.lastSendDiagnostic;
    const candidates = report.candidates.filter(item => item.id !== store.KEY);
    const manual = candidates.filter(isManualExport).map(item => Object.assign({}, item, { fileName: item.id.slice(5) }))
      .sort((a, b) => exportTime(b) - exportTime(a) || b.id.localeCompare(a.id));
    this.setData({ inspected: true, candidates, latestExport: manual[0] || null, historyExports: manual.slice(1), recoveryCopies: candidates.filter(item => !isManualExport(item)), diagnosticText: JSON.stringify(report, null, 2), protectionWarning: store.protectionWarning() });
  },
  toggleHistory() { this.setData({ historyOpen: !this.data.historyOpen }); },
  toggleRecovery() { this.setData({ recoveryOpen: !this.data.recoveryOpen }); },
  sendExport(e) {
    if (this.data.busy) return;
    return ui.run(() => {
      const id = e.currentTarget.dataset.id;
      if (!this.data.candidates.some(item => item.id === id && item.valid && isManualExport(item))) throw new Error('请选择有效的导出文件');
      // Synchronous validation and native sending preserve the user's tap.
      store.recoveryCandidate(id);
      const name = id.slice(5);
      this.pendingFile = { path: wx.env.USER_DATA_PATH + '/' + name, name, type: 'candidate' };
      this.setData({ fileName: name, pendingId: id, sendFileType: 'candidate' });
      return this.sendGenerated();
    });
  },
  copyDiagnostics() {
    this.inspectLocal();
    wx.setClipboardData({ data: this.data.diagnosticText, success: () => ui.toast('诊断摘要已复制'), fail: () => ui.error(new Error('复制失败，请重试')) });
  },
  async exportCandidate(e) {
    if (this.data.busy) return; this.setData({ busy: true });
    try {
      const item = store.recoveryCandidate(e.currentTarget.dataset.id);
      const name = files.backupName();
      const content = JSON.stringify({ app: 'daily-expense-miniapp', version: 3, exportedAt: new Date().toISOString(), state: item.state }, null, 2);
      const path = await files.writeFile(name, content); this.readyToSend(path, name, 'candidate');
    } catch (e) { ui.error(e); } finally { this.setData({ busy: false }); this.inspectLocal(); }
  },
  async recoverCandidate(e) {
    if (this.data.busy) return; this.setData({ busy: true });
    try {
      const item = store.recoveryCandidate(e.currentTarget.dataset.id);
      const confirmed = await new Promise(resolve => wx.showModal({ title: '恢复此本地副本？', content: `${item.label}，账本时间 ${item.updatedAt || '未知'}。包含 ${item.records} 笔账单、${item.accounts} 个资产与负债账户。将替换当前账本，请先导出需要保留的副本。`, confirmText: '恢复', success: r => resolve(r.confirm), fail: () => resolve(false) }));
      if (confirmed) { store.restoreCandidate(item.id, item.token); this.refresh(); ui.toast('副本已恢复'); }
    } catch (e) { ui.error(e); } finally { this.setData({ busy: false }); }
  },
  exportCsv() { this.exportFile('csv'); },
  exportAssets() { this.exportFile('assets'); },
  exportJson() { this.exportFile('json'); },
  async exportFile(type) {
    if (this.data.busy) return; this.setData({ busy: true });
    try {
      if (type === 'json') store.prepareBackup();
      const name = type === 'csv' ? 'xiaorizhang-bills.csv' : type === 'assets' ? 'xiaorizhang-assets.csv' : files.backupName();
      const content = type === 'csv' ? core.csv(store.read()) : type === 'assets' ? assets.csv(store.read()) : store.backupText();
      const path = await files.writeFile(name, content); this.readyToSend(path, name, type, type === 'json' ? JSON.parse(content).state.updatedAt : '');
    } catch (e) { ui.error(e); } finally { this.setData({ busy: false }); }
  },
  readyToSend(path, name, type, updatedAt) {
    this.pendingFile = { path, name, type, updatedAt };
    this.setData({ fileName: name, pendingId: 'file:' + name, sendFileType: type, sendStatus: '文件已生成，请点击下方按钮发送。', sendError: '' });
    this.inspectLocal();
    if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },
  sendGenerated() {
    if (this.data.busy || !this.pendingFile) return;
    const file = this.pendingFile;
    this.setData({ busy: true, sendStatus: '正在发送…', sendError: '' });
    return files.shareFile(file.path, file.name).then(result => {
      this.lastSendDiagnostic = { time: new Date().toISOString(), type: file.type, status: result.status, stage: result.stage || '', error: result.error || '' };
      if (result.status === 'sent') {
        let status = '文件已发送，请在聊天中妥善保存。';
        if (file.type === 'json') {
          try {
            if (store.read().updatedAt === file.updatedAt) store.markBackup();
            else status = '已发送生成时的备份；账本已有更新，请重新生成最新备份。';
          } catch (e) { status = '文件已发送，但备份时间未能更新：' + e.message; }
        }
        this.setData({ sendStatus: status }); this.refresh();
      } else if (result.status === 'cancelled') this.setData({ sendStatus: '已取消发送，文件保留，可再次点击发送。' });
      else {
        const hint = result.stage === 'file' ? '文件无法读取，请重新生成后发送。' : /TAP|gesture/i.test(result.error) ? '微信要求由点击直接发起发送，请再次点击发送按钮。' : '发送失败，文件保留。可重试发送或复制诊断摘要。';
        this.setData({ sendStatus: hint, sendError: result.error });
      }
    }).catch(e => {
      this.setData({ sendStatus: '发送结果处理异常，请先检查聊天中是否收到文件。', sendError: e.message });
    }).finally(() => { this.setData({ busy: false }); this.inspectLocal(); });
  },
  async importJson() {
    if (this.data.busy) return; this.setData({ busy: true });
    try {
      const text = await files.chooseBackup(); if (text === null) return;
      const state = store.parseBackup(text);
      const assetCount = state.accounts.filter(a => a.kind === 'asset').length; const debtCount = state.accounts.length - assetCount;
      const emptyWarning = state.accounts.length ? '' : '此备份没有资产账户，恢复后现有资产和负债也会被清空。';
      const confirmed = await new Promise(resolve => wx.showModal({ title: '恢复全部数据？', content: `备份包含 ${state.records.length} 笔账单、${assetCount} 个资产账户、${debtCount} 个负债账户（含归档）。将替换全部账单、账户、金额历史、分类和设置，并保留恢复前副本。${emptyWarning}`, confirmText: '恢复', success: r => resolve(r.confirm), fail: () => resolve(false) }));
      if (confirmed) { store.restore(state); this.refresh(); ui.toast('账本已恢复'); }
    } catch (e) { ui.error(e); } finally { this.setData({ busy: false }); }
  },
  undoRestore() {
    wx.showModal({ title: '恢复到导入前？', content: '将替换全部账单、资产账户、金额历史、分类和设置。导入之后新增或修改的数据不会保留。', confirmText: '恢复副本', success: r => { if (r.confirm) ui.run(() => { store.restoreSafety(); this.refresh(); ui.toast('副本已恢复'); }); } });
  }
});
