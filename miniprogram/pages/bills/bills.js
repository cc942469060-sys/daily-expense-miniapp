const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const ui = require('../../utils/ui');
Page({
  data: { type: '', start: '', end: '', query: '', categoryId: '', categories: [], categoryNames: [], categoryIndex: 0, payments: ['全部收支方式'].concat(core.PAYMENTS), paymentIndex: 0, groups: [], summary: {}, count: 0, totalText: '0.00', limit: 100, hasMore: false, shown: 0, today: '', storageError: '' },
  onLoad(options) {
    this.setData({ type: options.type || '', start: options.start || '', end: options.end || '', categoryId: options.categoryId || '', today: dates.dateKey(new Date()) });
  },
  onShow() { this.refresh(); },
  onUnload() { clearTimeout(this.searchTimer); },
  refresh() {
    try {
      const s = store.read(); const d = this.data;
      if (d.type && !core.TYPES.includes(d.type)) throw new Error('收支类型无效');
      if (d.start) dates.parseDate(d.start); if (d.end) dates.parseDate(d.end);
      if (d.start && d.end && d.start > d.end) throw new Error('开始日期不能晚于结束日期');
      const categories = s.categories.filter(c => !d.type || c.type === d.type);
      const categoryId = categories.some(c => c.id === d.categoryId) ? d.categoryId : '';
      const records = core.filterRecords(s, { type: d.type, start: d.start, end: d.end, query: d.query, categoryId, payment: d.paymentIndex ? core.PAYMENTS[d.paymentIndex - 1] : '' });
      const summary = core.summarize(records);
      this.setData({ categories, categoryNames: ['全部分类'].concat(categories.map(c => (d.type ? '' : (c.type === 'income' ? '收入 · ' : '支出 · ')) + c.name)), categoryId, categoryIndex: categoryId ? categories.findIndex(c => c.id === categoryId) + 1 : 0, payments: [d.type === 'income' ? '全部收款方式' : d.type === 'expense' ? '全部支付方式' : '全部收支方式'].concat(core.PAYMENTS), groups: core.groups(s, records.slice(0, d.limit), records, d.type), summary, count: records.length, totalText: d.type === 'income' ? summary.incomeText : summary.expenseText, hasMore: records.length > d.limit, shown: Math.min(d.limit, records.length), storageError: '' });
    } catch (e) { this.setData({ storageError: e.message, groups: [] }); }
  },
  typeChange(e) {
    const type = e.currentTarget.dataset.type;
    if (type && !core.TYPES.includes(type)) return;
    clearTimeout(this.searchTimer); this.setData({ type, categoryId: '', categoryIndex: 0, limit: 100 }); this.refresh();
  },
  dateChange(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value, limit: 100 }); this.refresh(); },
  categoryChange(e) { const i = Number(e.detail.value); this.setData({ categoryId: i ? this.data.categories[i - 1].id : '', limit: 100 }); this.refresh(); },
  paymentChange(e) { this.setData({ paymentIndex: Number(e.detail.value), limit: 100 }); this.refresh(); },
  search(e) { this.setData({ query: e.detail.value, limit: 100 }); clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => this.refresh(), 250); },
  clear() { clearTimeout(this.searchTimer); this.setData({ type: '', start: '', end: '', categoryId: '', categoryIndex: 0, paymentIndex: 0, query: '', limit: 100 }); this.refresh(); },
  more() { this.setData({ limit: this.data.limit + 100 }); this.refresh(); },
  select(e) { ui.edit(e.detail.id); },
  add() { ui.edit('', this.data.type || 'expense'); }
});
