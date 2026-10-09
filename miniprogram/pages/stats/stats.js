const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const ui = require('../../utils/ui');
Page({
  data: { modes: [{ id: 'day', name: '日' }, { id: 'week', name: '周' }, { id: 'month', name: '月' }, { id: 'year', name: '年' }], mode: 'month', type: 'expense', anchor: '', today: '', stats: null, chartWidth: 0, canNext: false, canPrev: true, storageError: '' },
  onShow() { const today = dates.dateKey(new Date()); this.setData({ today, anchor: this.data.anchor || today }); this.refresh(); },
  refresh() {
    try {
      const d = this.data; const stats = core.statistics(store.read(), d.mode, d.anchor, d.today, d.type);
      this.setData({ stats, chartWidth: Math.max(620, stats.bars.length * (d.mode === 'year' ? 70 : 50)), canNext: dates.range(d.mode, dates.shiftPeriod(d.mode, d.anchor, 1)).start <= d.today, canPrev: dates.range(d.mode, dates.shiftPeriod(d.mode, d.anchor, -1)).end >= '2000-01-01', storageError: '' });
    } catch (e) { this.setData({ storageError: e.message, stats: null }); }
  },
  typeChange(e) { const type = e.currentTarget.dataset.type; if (!core.TYPES.includes(type)) return; this.setData({ type }); this.refresh(); },
  overviewBills(e) { ui.bills({ start: this.data.stats.start, end: this.data.stats.end, type: e.currentTarget.dataset.type || '' }); },
  modeChange(e) { this.setData({ mode: e.currentTarget.dataset.mode }); this.refresh(); },
  dateChange(e) { this.setData({ anchor: e.detail.value }); this.refresh(); },
  shift(e) {
    const step = Number(e.currentTarget.dataset.step);
    if ((step > 0 && !this.data.canNext) || (step < 0 && !this.data.canPrev)) return;
    const anchor = dates.shiftPeriod(this.data.mode, this.data.anchor, step);
    this.setData({ anchor: anchor < '2000-01-01' ? '2000-01-01' : anchor > this.data.today ? this.data.today : anchor }); this.refresh();
  },
  current() { this.setData({ anchor: this.data.today }); this.refresh(); },
  allBills() { ui.bills({ type: this.data.type, start: this.data.stats.start, end: this.data.stats.end }); },
  categoryBills(e) { ui.bills({ type: this.data.type, start: this.data.stats.start, end: this.data.stats.end, categoryId: e.currentTarget.dataset.id }); },
  barBills(e) { ui.bills({ type: this.data.type, start: e.currentTarget.dataset.start, end: e.currentTarget.dataset.end }); },
  select(e) { ui.edit(e.currentTarget.dataset.id); }
});
