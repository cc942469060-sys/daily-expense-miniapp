const store = require('../../utils/store'); const ui = require('../../utils/ui'); const core = require('../../utils/core');
Page({
  data: { type: 'expense', categories: [], editingId: '', name: '', icon: '📦', icons: ['🍜', '🚇', '🛒', '🏠', '🎮', '💊', '📚', '📦', '☕', '🐱', '🎁', '✈️', '👕', '💡', '🍎', '🏃', '💼', '🏅', '🧾', '🧧', '💰', '📈', '🛠️', '🛡️', '📊', '🏦', '🧳', '🧓'], deletingId: '', targets: [], targetIndex: 0 },
  onShow() { this.refresh(); },
  refresh() { ui.run(() => { const s = store.read(); this.setData({ categories: s.categories.filter(c => c.type === this.data.type).map(c => Object.assign({}, c, { count: s.records.filter(r => r.categoryId === c.id).length })) }); }); },
  typeChange(e) { const type = e.currentTarget.dataset.type; if (!core.TYPES.includes(type)) return; this.cancel(); this.setData({ type }); this.refresh(); },
  input(e) { this.setData({ name: e.detail.value }); },
  pickIcon(e) { this.setData({ icon: e.currentTarget.dataset.icon }); },
  edit(e) { const c = this.data.categories.find(c => c.id === e.currentTarget.dataset.id); if (!c) return; this.setData({ editingId: c.id, name: c.name, icon: c.icon, deletingId: '' }); wx.pageScrollTo({ scrollTop: 0, duration: 250 }); },
  cancel() { this.setData({ editingId: '', name: '', icon: '📦', deletingId: '' }); },
  save() { ui.run(() => { store.saveCategory(this.data.name, this.data.icon, this.data.editingId, this.data.type); ui.toast('分类已保存'); this.cancel(); this.refresh(); }); },
  beginRemove(e) {
    if (this.data.categories.length <= 1) { ui.error(new Error('每种收支类型至少保留一个分类')); return; }
    const categoryId = e.currentTarget.dataset.id;
    this.setData({ deletingId: categoryId, targets: this.data.categories.filter(c => c.id !== categoryId), targetIndex: 0 });
    wx.pageScrollTo({ selector: '#migration', duration: 250 });
  },
  targetChange(e) { this.setData({ targetIndex: Number(e.detail.value) }); },
  cancelRemove() { this.setData({ deletingId: '' }); },
  remove() {
    const target = this.data.targets[this.data.targetIndex];
    wx.showModal({ title: '删除分类？', content: `此分类下的历史账单将迁移到「${target.name}」，账单金额保持不变。`, confirmText: '迁移并删除', success: res => {
      if (res.confirm) ui.run(() => { store.removeCategory(this.data.deletingId, target.id); this.cancel(); this.refresh(); ui.toast('分类已删除'); });
    } });
  }
});
