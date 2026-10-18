const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const ui = require('../../utils/ui');
Page({
  data: { today: '', todayText: '0.00', monthText: '0.00', todaySummary: {}, monthSummary: {}, count: 0, groups: [], recentStart: '', recentCount: 0, recentShown: 0, recentLimit: 100, recentHasMore: false, budget: 0, budgetPercent: 0, remainingText: '', overspent: false, storageError: '' },
  onShow() {
    this.refresh();
  },
  refresh() {
    this.setData({ protectionWarning: store.protectionWarning() });
    try {
      const s = store.read(); const today = dates.dateKey(new Date());
      const day = core.filterRecords(s, { start: today, end: today }); const month = core.filterRecords(s, dates.range('month', today));
      const todaySummary = core.summarize(day); const monthSummary = core.summarize(month);
      const used = monthSummary.expenseCents; const budget = s.settings.budgetCents;
      const recentStart = dates.shiftDays(today, -29); const recent = core.filterRecords(s, { start: recentStart, end: today });
      this.setData({ today, todayText: todaySummary.expenseText, monthText: monthSummary.expenseText, todaySummary, monthSummary, count: day.length, recentStart, recentCount: recent.length, recentShown: Math.min(this.data.recentLimit, recent.length), recentHasMore: recent.length > this.data.recentLimit, groups: core.groups(s, recent.slice(0, this.data.recentLimit), recent), budget, budgetPercent: budget ? Math.min(100, Math.round(used / budget * 100)) : 0, remainingText: core.money(Math.abs(budget - used)), overspent: used > budget, storageError: '' });
    } catch (e) { this.setData({ storageError: e.message, groups: [], recentCount: 0, recentShown: 0, recentHasMore: false }); }
  },
  moreRecent() { if (!this.data.recentHasMore) return; this.setData({ recentLimit: this.data.recentLimit + 100 }); this.refresh(); },
  add() { ui.edit(); },
  select(e) { ui.edit(e.detail.id); },
  allBills() { ui.bills(); },
  todayBills(e) { ui.bills({ start: this.data.today, end: this.data.today, type: e.currentTarget.dataset.type || '' }); },
  monthBills(e) { ui.bills(Object.assign(dates.range('month', this.data.today), { type: e.currentTarget.dataset.type || '' })); },
  backup() { wx.navigateTo({ url: '/pages/backup/backup' }); }
});
