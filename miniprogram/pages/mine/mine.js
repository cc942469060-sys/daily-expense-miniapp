const store = require('../../utils/store'); const core = require('../../utils/core'); const ui = require('../../utils/ui');
Page({
  data: { count: 0, categoryCount: 0, budget: '', storageError: '' },
  onShow() {
    try { const s = store.read(); this.setData({ count: s.records.length, categoryCount: s.categories.length, budget: s.settings.budgetCents ? core.money(s.settings.budgetCents) : '', storageError: '' }); }
    catch (e) { this.setData({ storageError: e.message }); }
  },
  budgetInput(e) { this.setData({ budget: e.detail.value }); },
  saveBudget() { ui.run(() => { store.setBudget(this.data.budget || '0'); ui.toast('预算已保存'); }); },
  categories() { wx.navigateTo({ url: '/pages/categories/categories' }); },
  backup() { wx.navigateTo({ url: '/pages/backup/backup' }); },
  bills() { ui.bills(); }
});
