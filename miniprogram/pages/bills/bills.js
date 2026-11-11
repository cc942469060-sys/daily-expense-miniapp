const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const ui = require('../../utils/ui');
const SORTS = ['date_desc', 'amount_desc', 'amount_asc'];
const PAGE_SIZE = 100;
// Only the fields the list shows (plus the amount used for sorting) are sent to the view layer.
const FIELDS = ['id', 'type', 'amountCents', 'refundCents', 'payment', 'date', 'time', 'note', 'categoryName', 'icon', 'typeName', 'sign', 'amountText', 'refundText'];
function pick(bill) { const view = {}; FIELDS.forEach(key => { view[key] = bill[key]; }); return view; }
Page({
  data: { type: '', start: '', end: '', query: '', categoryId: '', categories: [], categoryNames: [], categoryIndex: 0, payments: ['全部收支方式'].concat(core.PAYMENTS), paymentIndex: 0, sortNames: ['时间：从近到远', '金额：从大到小', '金额：从小到大'], sortIndex: 0, groups: [], summary: {}, count: 0, totalText: '0.00', limit: 100, hasMore: false, shown: 0, today: '', storageError: '' },
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
      const records = core.filterRecords(s, { type: d.type, start: d.start, end: d.end, query: d.query, categoryId, payment: d.paymentIndex ? core.PAYMENTS[d.paymentIndex - 1] : '', sort: SORTS[d.sortIndex] });
      const summary = core.summarize(records);
      this.ledger = s; this.filtered = records;
      const groups = this.build(records.slice(0, d.limit));
      this.setData({ categories, categoryNames: ['全部分类'].concat(categories.map(c => (d.type ? '' : (c.type === 'income' ? '收入 · ' : '支出 · ')) + c.name)), categoryId, categoryIndex: categoryId ? categories.findIndex(c => c.id === categoryId) + 1 : 0, payments: [d.type === 'income' ? '全部收款方式' : d.type === 'expense' ? '全部支付方式' : '全部收支方式'].concat(core.PAYMENTS), groups, summary, count: records.length, totalText: d.type === 'income' ? summary.incomeText : summary.expenseText, hasMore: records.length > d.limit, shown: Math.min(d.limit, records.length), storageError: '' });
    } catch (e) { this.ledger = null; this.filtered = null; this.setData({ storageError: e.message, groups: [] }); }
  },
  build(slice) {
    // Day subtotals always use the full filtered list, so paging never changes them.
    if (this.data.sortIndex !== 0) return slice.length ? [{ date: 'amount', records: slice.map(r => pick(core.decorate(this.ledger, r))) }] : [];
    return core.groups(this.ledger, slice, this.filtered, this.data.type).map(g => Object.assign({}, g, { records: g.records.map(pick) }));
  },
  typeChange(e) {
    const type = e.currentTarget.dataset.type;
    if (type && !core.TYPES.includes(type)) return;
    clearTimeout(this.searchTimer); this.setData({ type, categoryId: '', categoryIndex: 0, limit: 100 }); this.refresh();
  },
  dateChange(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value, limit: 100 }); this.refresh(); },
  categoryChange(e) { const i = Number(e.detail.value); this.setData({ categoryId: i ? this.data.categories[i - 1].id : '', limit: 100 }); this.refresh(); },
  paymentChange(e) { this.setData({ paymentIndex: Number(e.detail.value), limit: 100 }); this.refresh(); },
  sortChange(e) {
    const sortIndex = Number(e.detail.value);
    if (!Number.isInteger(sortIndex) || sortIndex < 0 || sortIndex >= SORTS.length) return;
    clearTimeout(this.searchTimer); this.setData({ sortIndex, limit: 100 }); this.refresh();
  },
  search(e) { this.setData({ query: e.detail.value, limit: 100 }); clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => this.refresh(), 250); },
  clear() { clearTimeout(this.searchTimer); this.setData({ type: '', start: '', end: '', categoryId: '', categoryIndex: 0, paymentIndex: 0, sortIndex: 0, query: '', limit: 100 }); this.refresh(); },
  more() {
    const d = this.data;
    if (!d.hasMore || !this.filtered) return;
    const limit = d.limit + PAGE_SIZE; const added = this.build(this.filtered.slice(d.shown, limit));
    const update = { limit, shown: Math.min(limit, this.filtered.length), hasMore: this.filtered.length > limit };
    // Append through data paths so only the new page crosses to the view layer.
    let index = d.groups.length;
    if (index && added.length && d.groups[index - 1].date === added[0].date) {
      const last = d.groups[index - 1]; const first = added.shift();
      first.records.forEach((bill, i) => { update[`groups[${index - 1}].records[${last.records.length + i}]`] = bill; });
    }
    added.forEach(group => { update[`groups[${index++}]`] = group; });
    this.setData(update);
  },
  onReachBottom() { this.more(); },
  select(e) { ui.edit(e.detail.id); },
  add() { ui.edit('', this.data.type || 'expense'); }
});
