const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const ui = require('../../utils/ui');
Page({
  data: { modes: [{ id: 'day', name: '日' }, { id: 'week', name: '周' }, { id: 'month', name: '月' }, { id: 'year', name: '年' }, { id: 'all', name: '全部' }, { id: 'custom', name: '自定义' }], mode: 'month', type: 'expense', anchor: '', today: '', customStart: '', customEnd: '', stats: null, chartWidth: 0, canNext: false, canPrev: true, storageError: '' },
  onShow() { const today = dates.dateKey(new Date()); this.setData({ today, anchor: this.data.anchor || today }); this.refresh(); },
  refresh() {
    try {
      const d = this.data; const stats = core.statistics(store.read(), d.mode, d.anchor, d.today, d.type, { start: d.customStart, end: d.customEnd });
      const extended = d.mode === 'all' || d.mode === 'custom';
      const barWidth = extended ? (stats.granularity === 'day' ? 80 : 120) : d.mode === 'year' ? 70 : 50;
      this.setData({ stats, chartWidth: Math.max(620, stats.bars.length * barWidth), canNext: !extended && dates.range(d.mode, dates.shiftPeriod(d.mode, d.anchor, 1)).start <= d.today, canPrev: !extended && dates.range(d.mode, dates.shiftPeriod(d.mode, d.anchor, -1)).end >= '2000-01-01', storageError: '' });
    } catch (e) { this.setData({ storageError: e.message, stats: null }); }
  },
  typeChange(e) { const type = e.currentTarget.dataset.type; if (!core.TYPES.includes(type)) return; this.setData({ type }); this.refresh(); },
  overviewBills(e) { ui.bills({ start: this.data.stats.start, end: this.data.stats.end, type: e.currentTarget.dataset.type || '' }); },
  modeChange(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!this.data.modes.some(m => m.id === mode)) return;
    const update = { mode };
    if (mode === 'custom' && !this.data.customStart) {
      const stats = this.data.stats; const today = this.data.today;
      update.customStart = stats && stats.start >= '2000-01-01' && stats.start <= today ? stats.start : today;
      update.customEnd = stats && stats.end <= today ? stats.end : today;
    }
    this.setData(update); this.refresh();
  },
  dateChange(e) { this.setData({ anchor: e.detail.value }); this.refresh(); },
  rangeChange(e) {
    const field = e.currentTarget.dataset.field;
    if (field !== 'customStart' && field !== 'customEnd') return;
    const value = e.detail.value;
    try {
      dates.parseDate(value);
      if (value < '2000-01-01' || value > this.data.today) throw new Error('请选择 2000 年起至今天的日期');
      const start = field === 'customStart' ? value : this.data.customStart;
      const end = field === 'customEnd' ? value : this.data.customEnd;
      if (start > end) throw new Error('开始日期不能晚于结束日期');
      this.setData({ [field]: value }); this.refresh();
    } catch (e) { ui.error(e); }
  },
  shift(e) {
    const step = Number(e.currentTarget.dataset.step);
    if ((step > 0 && !this.data.canNext) || (step < 0 && !this.data.canPrev)) return;
    const anchor = dates.shiftPeriod(this.data.mode, this.data.anchor, step);
    this.setData({ anchor: anchor < '2000-01-01' ? '2000-01-01' : anchor > this.data.today ? this.data.today : anchor }); this.refresh();
  },
  current() { if (this.data.mode === 'all' || this.data.mode === 'custom') return; this.setData({ anchor: this.data.today }); this.refresh(); },
  allBills() { ui.bills({ type: this.data.type, start: this.data.stats.start, end: this.data.stats.end }); },
  categoryBills(e) { ui.bills({ type: this.data.type, start: this.data.stats.start, end: this.data.stats.end, categoryId: e.currentTarget.dataset.id }); },
  barBills(e) { ui.bills({ type: this.data.type, start: e.currentTarget.dataset.start, end: e.currentTarget.dataset.end }); },
  select(e) { ui.edit(e.currentTarget.dataset.id); }
});
