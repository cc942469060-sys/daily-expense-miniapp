const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const ui = require('../../utils/ui'); const fixed = require('../../utils/fixed');
const { viewGroups, appendGroups } = require('../../utils/list');
Page({
  data: { today: '', todayText: '0.00', monthText: '0.00', todaySummary: {}, monthSummary: {}, count: 0, groups: [], recentStart: '', recentCount: 0, recentShown: 0, recentLimit: 100, recentHasMore: false, budget: 0, budgetPercent: 0, remainingText: '', overspent: false, storageError: '', capacityWarning: '', fixedPlan: null, fixedSuggestions: 0 },
  onShow() {
    this.refresh();
  },
  refresh() {
    this.setData({ protectionWarning: store.protectionWarning(), capacityWarning: store.capacityWarning() });
    try {
      const s = store.read(); const today = dates.dateKey(new Date());
      const day = core.filterRecords(s, { start: today, end: today }); const month = core.filterRecords(s, dates.range('month', today));
      const todaySummary = core.summarize(day); const monthSummary = core.summarize(month);
      const used = monthSummary.expenseCents; const budget = s.settings.budgetCents;
      const recentStart = dates.shiftDays(today, -29); const recent = core.filterRecords(s, { start: recentStart, end: today });
      this.ledger = s; this.recent = recent;
      this.setData({ today, todayText: todaySummary.expenseText, monthText: monthSummary.expenseText, todaySummary, monthSummary, count: day.length, recentStart, recentCount: recent.length, recentShown: Math.min(this.data.recentLimit, recent.length), recentHasMore: recent.length > this.data.recentLimit, groups: viewGroups(core.groups(s, recent.slice(0, this.data.recentLimit), recent)), budget, budgetPercent: budget ? Math.min(100, Math.round(used / budget * 100)) : 0, remainingText: core.moneyText(Math.abs(budget - used)), overspent: used > budget, storageError: '', backupReminder: store.backupReminder(s), fixedPlan: fixed.plan(s, today), fixedSuggestions: store.fixedSuggestions(s, today).length });
    } catch (e) { this.ledger = null; this.recent = null; this.setData({ storageError: e.message, groups: [], recentCount: 0, recentShown: 0, recentHasMore: false, backupReminder: '', fixedPlan: null }); }
  },
  // One tap records a fixed-amount bill; an amount that changes each month opens the record page
  // filled in. A tap on a stale "记一笔" after this month's bill exists asks before adding another.
  fixedTap(e) {
    const item = this.data.fixedPlan && this.data.fixedPlan.items.find(i => i.id === e.currentTarget.dataset.id);
    if (!item) return;
    if (item.status === 'done') { ui.edit(item.billId); return; }
    if (item.variable) { wx.navigateTo({ url: '/pages/record/record?fixed=' + encodeURIComponent(item.id) }); return; }
    ui.run(() => {
      const result = store.recordFixed(item.id);
      if (result.duplicate) {
        wx.showModal({ title: '本月已经记过', content: `「${item.name}」本月已有账单，还要再记一笔吗？`, confirmText: '再记一笔', success: r => {
          if (r.confirm) ui.run(() => { store.recordFixed(item.id, true); ui.toast('已记入'); this.refresh(); });
          else this.refresh();
        } });
        return;
      }
      ui.toast('已记入 ¥' + core.moneyText(result.record.amountCents)); this.refresh();
    });
  },
  manageFixed() { wx.navigateTo({ url: '/pages/fixed/fixed' }); },
  snoozeBackup() { ui.run(() => { store.snoozeBackupReminder(); this.setData({ backupReminder: '' }); }); },
  moreRecent() {
    // Append the next page only; day subtotals already cover the full 30 days.
    const d = this.data;
    if (!d.recentHasMore || !this.recent) return;
    const limit = d.recentLimit + 100;
    const added = viewGroups(core.groups(this.ledger, this.recent.slice(d.recentShown, limit), this.recent));
    this.setData(appendGroups(d.groups, added, { recentLimit: limit, recentShown: Math.min(limit, this.recent.length), recentHasMore: this.recent.length > limit }));
  },
  add() { ui.edit(); },
  select(e) { ui.edit(e.detail.id); },
  allBills() { ui.bills(); },
  todayBills(e) { ui.bills({ start: this.data.today, end: this.data.today, type: e.currentTarget.dataset.type || '' }); },
  monthBills(e) { ui.bills(Object.assign(dates.range('month', this.data.today), { type: e.currentTarget.dataset.type || '' })); },
  backup() { wx.navigateTo({ url: '/pages/backup/backup' }); }
});
