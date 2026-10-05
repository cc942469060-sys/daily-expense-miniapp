const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const ui = require('../../utils/ui');
Page({
  data: { today: '', todayText: '0.00', monthText: '0.00', count: 0, groups: [], budget: 0, budgetPercent: 0, remainingText: '', overspent: false, storageError: '' },
  onShow() {
    try {
      const s = store.read(); const today = dates.dateKey(new Date()); const day = core.filterRecords(s, { start: today, end: today }); const month = core.filterRecords(s, dates.range('month', today));
      const used = core.total(month); const budget = s.settings.budgetCents; const allRecords = core.filterRecords(s);
      this.setData({ today, todayText: core.money(core.total(day)), monthText: core.money(used), count: day.length, groups: core.groups(s, allRecords.slice(0, 8), allRecords), budget, budgetPercent: budget ? Math.min(100, Math.round(used / budget * 100)) : 0, remainingText: core.money(Math.abs(budget - used)), overspent: used > budget, storageError: '' });
    } catch (e) { this.setData({ storageError: e.message }); }
  },
  add() { ui.edit(); },
  select(e) { ui.edit(e.detail.id); },
  allBills() { ui.bills(); },
  todayBills() { ui.bills({ start: this.data.today, end: this.data.today }); },
  monthBills() { ui.bills(dates.range('month', this.data.today)); },
  backup() { wx.navigateTo({ url: '/pages/backup/backup' }); }
});
