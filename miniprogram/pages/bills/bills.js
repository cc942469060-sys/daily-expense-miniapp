const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const ui = require('../../utils/ui');
Page({
  data: { start: '', end: '', query: '', categoryId: '', categories: [], categoryNames: [], categoryIndex: 0, payments: ['全部支付方式'].concat(core.PAYMENTS), paymentIndex: 0, groups: [], count: 0, totalText: '0.00', limit: 100, hasMore: false, shown: 0, today: '', storageError: '' },
  onLoad(options) {
    this.setData({ start: options.start || '', end: options.end || '', categoryId: options.categoryId || '', today: dates.dateKey(new Date()) });
  },
  onShow() { this.refresh(); },
  onUnload() { clearTimeout(this.searchTimer); },
  refresh() {
    try {
      const s = store.read(); const d = this.data;
      if (d.start) dates.parseDate(d.start); if (d.end) dates.parseDate(d.end);
      if (d.start && d.end && d.start > d.end) throw new Error('开始日期不能晚于结束日期');
      const categoryId = s.categories.some(c => c.id === d.categoryId) ? d.categoryId : '';
      const records = core.filterRecords(s, { start: d.start, end: d.end, query: d.query, categoryId, payment: d.paymentIndex ? core.PAYMENTS[d.paymentIndex - 1] : '' });
      this.setData({ categories: s.categories, categoryNames: ['全部分类'].concat(s.categories.map(c => c.name)), categoryId, categoryIndex: categoryId ? s.categories.findIndex(c => c.id === categoryId) + 1 : 0, groups: core.groups(s, records.slice(0, d.limit), records), count: records.length, totalText: core.money(core.total(records)), hasMore: records.length > d.limit, shown: Math.min(d.limit, records.length), storageError: '' });
    } catch (e) { this.setData({ storageError: e.message, groups: [] }); }
  },
  dateChange(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value, limit: 100 }); this.refresh(); },
  categoryChange(e) { const i = Number(e.detail.value); this.setData({ categoryId: i ? this.data.categories[i - 1].id : '', limit: 100 }); this.refresh(); },
  paymentChange(e) { this.setData({ paymentIndex: Number(e.detail.value), limit: 100 }); this.refresh(); },
  search(e) { this.setData({ query: e.detail.value, limit: 100 }); clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => this.refresh(), 250); },
  clear() { clearTimeout(this.searchTimer); this.setData({ start: '', end: '', categoryId: '', categoryIndex: 0, paymentIndex: 0, query: '', limit: 100 }); this.refresh(); },
  more() { this.setData({ limit: this.data.limit + 100 }); this.refresh(); },
  select(e) { ui.edit(e.detail.id); },
  add() { ui.edit(); }
});
