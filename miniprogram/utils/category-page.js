const store = require('./store'); const ui = require('./ui');
// Shared behaviour of the two category management pages. `field` splits categories into
// groups: 'type' (expense / income) or 'kind' (asset / liability); `values` lists the groups,
// the first one shown on open. Each page adds its own tab handler, named as in its template.
function categoryPage(options) {
  const { field, values, icons, list, usage, saveCategory, removeCategory, minimumError, removeTitle, removeContent } = options;
  return {
    data: { [field]: values[0], categories: [], editingId: '', name: '', icon: '📦', icons, deletingId: '', targets: [], targetIndex: 0, storageError: '' },
    onShow() { this.refresh(); },
    refresh() {
      try {
        const s = store.read(); const counts = {};
        // One pass over bills or accounts instead of one pass per category.
        usage(s).forEach(item => { counts[item.categoryId] = (counts[item.categoryId] || 0) + 1; });
        this.setData({ categories: list(s).filter(c => c[field] === this.data[field]).map(c => Object.assign({}, c, { count: counts[c.id] || 0 })), storageError: '' });
      } catch (e) { this.setData({ categories: [], storageError: e.message }); }
    },
    switchGroup(value) { if (!values.includes(value)) return; this.cancel(); this.setData({ [field]: value }); this.refresh(); },
    input(e) { this.setData({ name: e.detail.value }); },
    pickIcon(e) { this.setData({ icon: e.currentTarget.dataset.icon }); },
    edit(e) { const c = this.data.categories.find(c => c.id === e.currentTarget.dataset.id); if (!c) return; this.setData({ editingId: c.id, name: c.name, icon: c.icon, deletingId: '' }); wx.pageScrollTo({ scrollTop: 0, duration: 250 }); },
    cancel() { this.setData({ editingId: '', name: '', icon: '📦', deletingId: '' }); },
    save() { ui.run(() => { saveCategory(this.data.name, this.data.icon, this.data.editingId, this.data[field]); ui.toast('分类已保存'); this.cancel(); this.refresh(); }); },
    beginRemove(e) {
      if (this.data.categories.length <= 1) { ui.error(new Error(minimumError)); return; }
      const categoryId = e.currentTarget.dataset.id;
      // The migration panel only exists after this update renders, so scroll in the callback.
      this.setData({ deletingId: categoryId, targets: this.data.categories.filter(c => c.id !== categoryId), targetIndex: 0 }, () => wx.pageScrollTo({ selector: '#migration', duration: 250 }));
    },
    targetChange(e) { this.setData({ targetIndex: Number(e.detail.value) }); },
    cancelRemove() { this.setData({ deletingId: '' }); },
    remove() {
      ui.run(() => {
        // Capture the choice now; the page may change while the dialog is open.
        const categoryId = this.data.deletingId;
        const category = this.data.categories.find(c => c.id === categoryId);
        const target = this.data.targets[this.data.targetIndex];
        if (!category || !target || target.id === categoryId || target[field] !== category[field]) throw new Error('请选择有效的同类型迁移分类后重试');
        wx.showModal({ title: removeTitle, content: removeContent(target.name), confirmText: '确认删除', success: res => {
          if (res.confirm) ui.run(() => { removeCategory(categoryId, target.id); this.cancel(); this.refresh(); ui.toast('分类已删除'); });
        }, fail: () => wx.showToast({ title: '无法弹出确认框，请重试', icon: 'none' }) });
      });
    }
  };
}
module.exports = categoryPage;
