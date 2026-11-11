const store = require('../../utils/store'); const core = require('../../utils/core'); const ui = require('../../utils/ui'); const { VERSION } = require('../../utils/version');
Page({
  data: { count: 0, categoryCount: 0, budget: '', storageError: '', version: VERSION, backupText: '' },
  onShow() {
    try {
      const s = store.read(); const age = core.backupAge(s, Date.now());
      const backupText = age && age.sent ? (age.days <= 0 ? '今天已发送备份' : `上次发送备份：${age.days} 天前`) : '尚未发送过备份';
      this.setData({ count: s.records.length, categoryCount: s.categories.length, budget: s.settings.budgetCents ? core.money(s.settings.budgetCents) : '', storageError: '', backupText });
    } catch (e) { this.setData({ storageError: e.message, backupText: '' }); }
  },
  budgetInput(e) { this.setData({ budget: e.detail.value }); },
  saveBudget() { ui.run(() => { store.setBudget(this.data.budget || '0'); ui.toast('预算已保存'); }); },
  categories() { wx.navigateTo({ url: '/pages/categories/categories' }); },
  backup() { wx.navigateTo({ url: '/pages/backup/backup' }); },
  bills() { ui.bills(); }
});
