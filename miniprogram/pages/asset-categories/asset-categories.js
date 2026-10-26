const store = require('../../utils/store'); const ui = require('../../utils/ui'); const assets = require('../../utils/assets');
Page({
  data: { kind: 'asset', categories: [], editingId: '', name: '', icon: '📦', icons: ['💳', '💰', '💬', '📈', '📜', '🪙', '📊', '💵', '📦', '🏠', '🚗', '🧾', '🤝', '🏦', '🏅'], deletingId: '', targets: [], targetIndex: 0, storageError: '' },
  onShow() { this.refresh(); },
  refresh() {
    try { const s = store.read(); this.setData({ categories: s.assetCategories.filter(c => c.kind === this.data.kind).map(c => Object.assign({}, c, { count: s.accounts.filter(a => a.categoryId === c.id).length })), storageError: '' }); }
    catch (e) { this.setData({ categories: [], storageError: e.message }); }
  },
  kindChange(e) { const kind = e.currentTarget.dataset.kind; if (!assets.KINDS.includes(kind)) return; this.cancel(); this.setData({ kind }); this.refresh(); },
  input(e) { this.setData({ name: e.detail.value }); },
  pickIcon(e) { this.setData({ icon: e.currentTarget.dataset.icon }); },
  edit(e) { const c = this.data.categories.find(c => c.id === e.currentTarget.dataset.id); if (!c) return; this.setData({ editingId: c.id, name: c.name, icon: c.icon, deletingId: '' }); wx.pageScrollTo({ scrollTop: 0, duration: 250 }); },
  cancel() { this.setData({ editingId: '', name: '', icon: '📦', deletingId: '' }); },
  save() { ui.run(() => { store.saveAssetCategory(this.data.name, this.data.icon, this.data.editingId, this.data.kind); ui.toast('分类已保存'); this.cancel(); this.refresh(); }); },
  beginRemove(e) {
    if (this.data.categories.length <= 1) { ui.error(new Error('资产和负债各至少保留一个分类')); return; }
    const categoryId = e.currentTarget.dataset.id;
    this.setData({ deletingId: categoryId, targets: this.data.categories.filter(c => c.id !== categoryId), targetIndex: 0 });
    wx.pageScrollTo({ selector: '#migration', duration: 250 });
  },
  targetChange(e) { this.setData({ targetIndex: Number(e.detail.value) }); },
  cancelRemove() { this.setData({ deletingId: '' }); },
  remove() {
    ui.run(() => {
      const categoryId = this.data.deletingId;
      const category = this.data.categories.find(c => c.id === categoryId);
      const target = this.data.targets[this.data.targetIndex];
      if (!category || !target || target.id === categoryId || target.kind !== category.kind) throw new Error('请选择有效的同类型迁移分类后重试');
      wx.showModal({ title: '删除资产分类？', content: `此分类下的全部账户（含归档账户）将迁移到「${target.name}」，金额和历史记录保持不变。`, confirmText: '确认删除', success: r => {
        if (r.confirm) ui.run(() => { store.removeAssetCategory(categoryId, target.id); this.cancel(); this.refresh(); ui.toast('分类已删除'); });
      }, fail: () => wx.showToast({ title: '无法弹出确认框，请重试', icon: 'none' }) });
    });
  }
});
