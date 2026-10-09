const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const files = require('../../utils/files'); const ui = require('../../utils/ui');
const assets = require('../../utils/assets');
Page({
  data: { count: 0, accountCount: 0, backupTime: '尚未成功发送备份', busy: false, storageError: '', fileName: '', hasSafety: false },
  onShow() { this.refresh(); },
  refresh() {
    try {
      const s = store.read(); const time = s.lastBackupAt ? new Date(s.lastBackupAt) : null;
      this.setData({ count: s.records.length, accountCount: s.accounts.length, backupTime: time && !Number.isNaN(time.getTime()) ? `${dates.dateKey(time)} ${dates.timeKey(time)}` : '尚未成功发送备份', storageError: '' });
    } catch (e) { this.setData({ storageError: e.message }); }
    try { this.setData({ hasSafety: store.hasSafety() }); } catch (e) { this.setData({ hasSafety: false }); }
  },
  exportCsv() { this.exportFile('csv'); },
  exportAssets() { this.exportFile('assets'); },
  exportJson() { this.exportFile('json'); },
  async exportFile(type) {
    if (this.data.busy) return; this.setData({ busy: true });
    try {
      const name = type === 'csv' ? 'xiaorizhang-bills.csv' : type === 'assets' ? 'xiaorizhang-assets.csv' : 'xiaorizhang-backup.json';
      const content = type === 'csv' ? core.csv(store.read()) : type === 'assets' ? assets.csv(store.read()) : store.backupText();
      const path = await files.writeFile(name, content); this.setData({ fileName: name });
      if (await files.shareFile(path, name)) { if (type === 'json') store.markBackup(); this.refresh(); ui.toast('文件已发送'); }
    } catch (e) { ui.error(e); } finally { this.setData({ busy: false }); }
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
