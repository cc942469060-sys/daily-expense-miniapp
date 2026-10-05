const store = require('../../utils/store'); const core = require('../../utils/core'); const dates = require('../../utils/date'); const ui = require('../../utils/ui');
Page({
  data: { id: '', amount: '', categoryId: '', categories: [], date: '', time: '', today: '', paymentIndex: 0, payments: core.PAYMENTS, note: '', refund: '0', saving: false, ready: false },
  onLoad(options) {
    ui.run(() => {
      const s = store.read(); const now = new Date(); const r = options.id ? s.records.find(r => r.id === options.id) : null;
      if (options.id && !r) throw new Error('这笔账单已不存在，请返回账单列表');
      const recent = s.records.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
      this.setData({ ready: true, id: r ? r.id : '', categories: s.categories, categoryId: r ? r.categoryId : recent ? recent.categoryId : s.categories[0].id, amount: r ? core.money(r.amountCents) : '', date: r ? r.date : dates.dateKey(now), time: r ? r.time : dates.timeKey(now), today: dates.dateKey(now), note: r ? r.note : '', refund: r ? core.money(r.refundCents) : '0', paymentIndex: r ? core.PAYMENTS.indexOf(r.payment) : recent ? core.PAYMENTS.indexOf(recent.payment) : 0 });
      if (r) wx.setNavigationBarTitle({ title: '账单详情 / 编辑' });
    });
  },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  category(e) { this.setData({ categoryId: e.currentTarget.dataset.id }); },
  dateChange(e) { this.setData({ date: e.detail.value }); },
  timeChange(e) { this.setData({ time: e.detail.value }); },
  paymentChange(e) { this.setData({ paymentIndex: Number(e.detail.value) }); },
  save() { this.commit(false); },
  saveMore() { this.commit(true); },
  commit(more) {
    if (this.data.saving || !this.data.ready) return;
    this.setData({ saving: true });
    try {
      const d = this.data; store.saveRecord({ amount: d.amount, categoryId: d.categoryId, date: d.date, time: d.time, payment: d.payments[d.paymentIndex], note: d.note, refund: d.refund }, d.id);
      ui.toast('已保存到本地');
      if (more) this.setData({ amount: '', note: '', refund: '0', time: dates.timeKey(new Date()) });
      else wx.navigateBack();
    } catch (e) { ui.error(e); }
    finally { this.setData({ saving: false }); }
  },
  remove() {
    wx.showModal({ title: '删除这笔账单？', content: '删除后对应统计会立即更新，此操作无法撤销。', confirmText: '删除', confirmColor: '#B04E49', success: result => {
      if (result.confirm) ui.run(() => { store.removeRecord(this.data.id); ui.toast('已删除'); wx.navigateBack(); });
    } });
  }
});
