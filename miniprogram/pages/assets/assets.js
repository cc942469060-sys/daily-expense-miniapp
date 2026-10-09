const store = require('../../utils/store'); const assets = require('../../utils/assets'); const ui = require('../../utils/ui');
Page({
  data: { hidden: false, kind: '', categoryId: '', categories: [], categoryIndex: 0, archived: false, groups: [], assetText: '0.00', liabilityText: '0.00', netText: '0.00', count: 0, archivedCount: 0, storageError: '' },
  onShow() { this.refresh(); },
  refresh() {
    try {
      const s = store.read(); const hidden = s.settings.assetAmountsHidden; const totals = assets.summary(s);
      const categories = [{ id: '', name: '全部分类' }].concat(s.assetCategories.filter(c => !this.data.kind || c.kind === this.data.kind).map(c => ({ id: c.id, name: c.name + (this.data.kind ? '' : c.kind === 'asset' ? '（资产）' : '（负债）') })));
      const categoryIndex = Math.max(0, categories.findIndex(c => c.id === this.data.categoryId)); const categoryId = categories[categoryIndex].id;
      const selected = s.accounts.filter(a => (a.archivedAt !== null) === this.data.archived && (!this.data.kind || a.kind === this.data.kind) && (!categoryId || a.categoryId === categoryId));
      const groups = s.assetCategories.map(c => {
        const accounts = selected.filter(a => a.categoryId === c.id).sort((a, b) => b.updatedAt - a.updatedAt);
        const cents = accounts.reduce((n, a) => n + a.amountCents, 0); const base = c.kind === 'asset' ? totals.assetCents : totals.liabilityCents;
        return { id: c.id, kind: c.kind, name: c.name, icon: c.icon, amountText: hidden ? '••••' : assets.money(cents), percent: hidden || !base ? '' : (cents / base * 100).toFixed(1), accounts: accounts.map(a => assets.displayAccount(s, a)) };
      }).filter(c => c.accounts.length);
      this.setData({ hidden, groups, categories, categoryId, categoryIndex, assetText: hidden ? '••••' : assets.money(totals.assetCents), liabilityText: hidden ? '••••' : assets.money(totals.liabilityCents), netText: hidden ? '••••' : assets.money(totals.netCents), count: selected.length, archivedCount: s.accounts.filter(a => a.archivedAt !== null).length, storageError: '' });
    } catch (e) { this.setData({ groups: [], assetText: '—', liabilityText: '—', netText: '—', count: 0, storageError: e.message }); }
  },
  toggleHidden() { ui.run(() => { store.setAssetAmountsHidden(!this.data.hidden); this.refresh(); }); },
  kindChange(e) { const kind = e.currentTarget.dataset.kind; if (kind !== '' && !assets.KINDS.includes(kind)) return; this.setData({ kind, categoryId: '' }); this.refresh(); },
  categoryChange(e) { const category = this.data.categories[Number(e.detail.value)]; if (category) { this.setData({ categoryId: category.id }); this.refresh(); } },
  toggleArchived() { this.setData({ archived: !this.data.archived }); this.refresh(); },
  add() { wx.navigateTo({ url: '/pages/account/account' + (this.data.kind ? '?kind=' + this.data.kind : '') }); },
  open(e) { wx.navigateTo({ url: '/pages/account/account?id=' + e.currentTarget.dataset.id }); },
  categories() { wx.navigateTo({ url: '/pages/asset-categories/asset-categories' }); }
});
