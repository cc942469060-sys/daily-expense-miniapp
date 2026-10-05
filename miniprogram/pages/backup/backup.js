const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const files = require('../../utils/files'); const ui = require('../../utils/ui');
Page({
  data: { count: 0, backupTime: '尚未成功发送备份', busy: false, storageError: '', fileName: '', hasSafety: false },
  onShow() { this.refresh(); },
  refresh() {
    try {
      const s = store.read(); const time = s.lastBackupAt ? new Date(s.lastBackupAt) : null;
      this.setData({ count: s.records.length, backupTime: time && !Number.isNaN(time.getTime()) ? `${dates.dateKey(time)} ${dates.timeKey(time)}` : '尚未成功发送备份', storageError: '' });
    } catch (e) { this.setData({ storageError: e.message }); }
    try { this.setData({ hasSafety: !!wx.getStorageSync(store.SAFETY_KEY) }); } catch (e) { this.setData({ hasSafety: false }); }
  },
  exportCsv() { this.exportFile('csv'); },
  exportJson() { this.exportFile('json'); },
  async exportFile(type) {
    if (this.data.busy) return; this.setData({ busy: true });
    try {
      const name = type === 'csv' ? 'xiaorizhang-bills.csv' : 'xiaorizhang-backup.json';
      const content = type === 'csv' ? core.csv(store.read()) : store.backupText();
      const path = await files.writeFile(name, content); this.setData({ fileName: name });
      if (await files.shareFile(path, name)) { if (type === 'json') store.markBackup(); this.refresh(); ui.toast('文件已发送'); }
    } catch (e) { ui.error(e); } finally { this.setData({ busy: false }); }
  },
  async importJson() {
    if (this.data.busy) return; this.setData({ busy: true });
    try {
      const text = await files.chooseBackup(); if (text === null) return;
      const state = store.parseBackup(text);
      const confirmed = await new Promise(resolve => wx.showModal({ title: '恢复备份？', content: `备份包含 ${state.records.length} 笔账单、${state.categories.length} 个分类。恢复会替换当前账本，并保留恢复前副本。`, confirmText: '恢复', success: r => resolve(r.confirm), fail: () => resolve(false) }));
      if (confirmed) { store.restore(state); this.refresh(); ui.toast('账本已恢复'); }
    } catch (e) { ui.error(e); } finally { this.setData({ busy: false }); }
  },
  undoRestore() {
    wx.showModal({ title: '恢复到导入前？', content: '将替换当前账本。导入之后新增或修改的账单不会保留。', confirmText: '恢复副本', success: r => { if (r.confirm) ui.run(() => { store.restoreSafety(); this.refresh(); ui.toast('副本已恢复'); }); } });
  }
});
