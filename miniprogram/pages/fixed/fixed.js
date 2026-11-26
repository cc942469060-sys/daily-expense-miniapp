const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const ui = require('../../utils/ui'); const fixed = require('../../utils/fixed');
const DAYS = Array.from({ length: 31 }, (_, i) => `每月 ${i + 1} 日`);
function blank() { return { editingId: '', name: '', amount: '', variable: false, dayIndex: 0, categoryIndex: 0, paymentIndex: 0, note: '', endMonth: '' }; }
Page({
  data: Object.assign({ items: [], categories: [], payments: core.PAYMENTS, days: DAYS, thisMonth: '', storageError: '', max: fixed.MAX_FIXED }, blank()),
  onLoad(options) { this.pendingEdit = options && options.id; },
  onShow() { this.refresh(); },
  refresh() {
    try {
      const s = store.read(); const today = dates.dateKey(new Date());
      const categories = s.categories.filter(c => c.type === 'expense');
      const items = fixed.list(s).map(item => fixed.describe(s, item, today)).sort((a, b) => Number(a.ended) - Number(b.ended) || a.day - b.day);
      this.setData({ items, categories, thisMonth: today.slice(0, 7), storageError: '' });
      if (this.data.categoryIndex >= categories.length) this.setData({ categoryIndex: 0 });
      if (this.pendingEdit) { const id = this.pendingEdit; this.pendingEdit = ''; this.edit({ currentTarget: { dataset: { id } } }); }
    } catch (e) { this.setData({ storageError: e.message, items: [] }); }
  },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  variableChange(e) { this.setData({ variable: !!e.detail.value }); },
  pick(e) { this.setData({ [e.currentTarget.dataset.field]: Number(e.detail.value) }); },
  endChange(e) { this.setData({ endMonth: e.detail.value }); },
  clearEnd() { this.setData({ endMonth: '' }); },
  edit(e) {
    const item = this.data.items.find(i => i.id === e.currentTarget.dataset.id); if (!item) return;
    const categoryIndex = this.data.categories.findIndex(c => c.id === item.categoryId);
    this.setData({ editingId: item.id, name: item.name, amount: item.amountCents ? core.money(item.amountCents) : '', variable: item.variable, dayIndex: item.day - 1, categoryIndex: Math.max(0, categoryIndex), paymentIndex: Math.max(0, core.PAYMENTS.indexOf(item.payment)), note: item.note, endMonth: item.endMonth });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },
  cancel() { this.setData(blank()); },
  save() {
    const d = this.data; const category = d.categories[d.categoryIndex];
    ui.run(() => {
      store.saveFixed({ name: d.name, amount: d.amount, variable: d.variable, day: d.dayIndex + 1, categoryId: category && category.id, payment: d.payments[d.paymentIndex], note: d.note, endMonth: d.endMonth }, d.editingId);
      ui.toast(d.editingId ? '已保存修改' : '已添加'); this.setData(blank()); this.refresh();
    });
  },
  remove(e) {
    const item = this.data.items.find(i => i.id === e.currentTarget.dataset.id); if (!item) return;
    wx.showModal({ title: '删除固定支出？', content: `删除「${item.name}」后不再出现在首页清单，已记入的账单保留不变。`, confirmText: '确认删除', confirmColor: '#B04E49', success: result => {
      if (result.confirm) ui.run(() => { store.removeFixed(item.id); if (this.data.editingId === item.id) this.setData(blank()); ui.toast('已删除'); this.refresh(); });
    } });
  }
});
