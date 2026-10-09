const store = require('../../utils/store'); const assets = require('../../utils/assets'); const dates = require('../../utils/date'); const ui = require('../../utils/ui');
Page({
  data: { accountId: '', mode: 'new', kind: 'asset', categories: [], categoryIndex: 0, name: '', note: '', cardLast4: '', amount: '', valuedOn: '', updateNote: '', today: '', minDate: '2000-01-01', label: '当前余额', account: null, hidden: false, history: [], historyPage: 1, historyPages: 1, historyCount: 0, hasMore: false, canDelete: false, busy: false, storageError: '' },
  onLoad(options) {
    const today = dates.dateKey(new Date());
    this.setData({ accountId: options.id || '', mode: options.id ? 'detail' : 'new', kind: options.kind === 'liability' ? 'liability' : 'asset', today, valuedOn: today });
  },
  onShow() { this.refresh(); },
  refresh() {
    try {
      const s = store.read(); const a = s.accounts.find(a => a.id === this.data.accountId);
      if (this.data.accountId && !a) throw new Error('账户已不存在，请返回资产页');
      const kind = a ? a.kind : this.data.kind; const categories = s.assetCategories.filter(c => c.kind === kind);
      const oldCategory = this.data.categories[this.data.categoryIndex];
      const categoryId = this.data.mode === 'edit' || this.data.mode === 'new' ? oldCategory && oldCategory.id : a && a.categoryId;
      const categoryIndex = Math.max(0, categories.findIndex(c => c.id === categoryId));
      const hidden = s.settings.assetAmountsHidden;
      const history = a ? s.accountValueHistory.filter(h => h.accountId === a.id).reverse() : [];
      const historyPages = Math.max(1, Math.ceil(history.length / 50)); const historyPage = Math.min(this.data.historyPage, historyPages);
      this.setData({ kind, categories, categoryIndex, hidden, account: a ? assets.displayAccount(s, a) : null, label: assets.valueLabel(kind, categories[categoryIndex].id), minDate: a ? a.valuedOn : '2000-01-01', today: dates.dateKey(new Date()), historyPage, historyPages, historyCount: history.length, canDelete: history.length === 1, hasMore: historyPage < historyPages,
        history: history.slice((historyPage - 1) * 50, historyPage * 50).map(h => ({ id: h.id, valuedOn: h.valuedOn, recordedText: dates.dateKey(new Date(h.recordedAt)) + ' ' + dates.timeKey(new Date(h.recordedAt)), opening: h.reason === 'opening', amountText: hidden ? '••••' : assets.money(h.amountCents), previousText: hidden ? '••••' : h.previousCents === null ? '—' : assets.money(h.previousCents), changeText: hidden ? '••••' : h.previousCents === null ? '初始金额' : (h.amountCents - h.previousCents > 0 ? '+' : '') + assets.money(h.amountCents - h.previousCents), note: h.note })), storageError: '' });
      wx.setNavigationBarTitle({ title: a ? a.name : '添加资产或负债' });
    } catch (e) { this.setData({ storageError: e.message, account: null, history: [] }); }
  },
  kindChange(e) { if (this.data.mode !== 'new') return; const kind = e.currentTarget.dataset.kind; if (!assets.KINDS.includes(kind)) return; this.setData({ kind, categories: [], categoryIndex: 0 }); this.refresh(); },
  categoryChange(e) { const categoryIndex = Number(e.detail.value); const c = this.data.categories[categoryIndex]; if (c) this.setData({ categoryIndex, label: assets.valueLabel(this.data.kind, c.id) }); },
  input(e) { const field = e.currentTarget.dataset.field; if (['name', 'note', 'cardLast4', 'amount', 'updateNote'].includes(field)) this.setData({ [field]: e.detail.value }); },
  dateChange(e) { this.setData({ valuedOn: e.detail.value }); },
  edit() { if (!this.data.account || this.data.account.archived) return; const a = this.data.account; this.setData({ mode: 'edit', name: a.name, note: a.note, cardLast4: a.cardLast4, categoryIndex: this.data.categories.findIndex(c => c.id === a.categoryId) }); },
  beginUpdate() {
    ui.run(() => {
      const a = store.read().accounts.find(a => a.id === this.data.accountId); if (!a || a.archivedAt !== null) throw new Error('账户不可更新');
      // Revealing the amount requires this explicit edit action, even while overview amounts are hidden.
      this.setData({ mode: 'value', amount: assets.money(a.amountCents), valuedOn: dates.dateKey(new Date()), updateNote: '', minDate: a.valuedOn, label: assets.valueLabel(a.kind, a.categoryId) });
    });
  },
  cancel() { this.setData({ mode: 'detail', amount: '', updateNote: '', note: '' }); this.refresh(); },
  save() {
    if (this.data.busy) return;
    const mode = this.data.mode; if (!['new', 'edit', 'value'].includes(mode)) return;
    const c = this.data.categories[this.data.categoryIndex]; if (!c) return;
    const input = { kind: this.data.kind, categoryId: c.id, name: this.data.name, note: mode === 'value' ? this.data.updateNote : this.data.note, cardLast4: this.data.cardLast4, amount: this.data.amount, valuedOn: this.data.valuedOn };
    const persist = () => {
      try {
        const a = mode === 'value' ? store.updateAccountValue(this.data.accountId, input) : store.saveAccount(input, mode === 'edit' ? this.data.accountId : '');
        this.setData({ accountId: a.id, mode: 'detail', amount: '', updateNote: '', note: '', historyPage: 1 }); this.refresh(); ui.toast('账户已保存');
      } catch (e) { ui.error(e); } finally { this.setData({ busy: false }); }
    };
    this.setData({ busy: true });
    if (mode !== 'value') { persist(); return; }
    try { assets.amountToCents(input.amount); } catch (e) { this.setData({ busy: false }); ui.error(e); return; }
    wx.showModal({ title: '更新当前金额？', content: `将当前金额设为 ¥${assets.money(assets.amountToCents(input.amount))}，金额日期 ${input.valuedOn}。本次更新会保留历史。`, confirmText: '确认更新', success: r => { if (r.confirm) persist(); else this.setData({ busy: false }); }, fail: () => this.setData({ busy: false }) });
  },
  moreHistory() { if (this.data.hasMore) { this.setData({ historyPage: this.data.historyPage + 1 }); this.refresh(); wx.pageScrollTo({ selector: '#history', duration: 200 }); } },
  previousHistory() { if (this.data.historyPage > 1) { this.setData({ historyPage: this.data.historyPage - 1 }); this.refresh(); wx.pageScrollTo({ selector: '#history', duration: 200 }); } },
  toggleHidden() { ui.run(() => { store.setAssetAmountsHidden(!this.data.hidden); this.refresh(); }); },
  archive() {
    if (this.data.busy || !this.data.account) return; const archived = !this.data.account.archived;
    this.setData({ busy: true });
    wx.showModal({ title: archived ? '归档账户？' : '重新启用账户？', content: archived ? '仅零余额账户可以归档，账户资料与金额更新历史会保留。' : '重新启用后，可继续手动更新当前金额。', success: r => {
      if (r.confirm) ui.run(() => { store.archiveAccount(this.data.accountId, archived); this.refresh(); ui.toast(archived ? '账户已归档' : '账户已启用'); });
    }, complete: () => this.setData({ busy: false }) });
  },
  remove() {
    if (this.data.busy || !this.data.canDelete) return; this.setData({ busy: true });
    wx.showModal({ title: '删除误建账户？', content: '将永久删除此账户及其初始金额。只有尚未更新过金额的账户可以删除。', confirmText: '删除', confirmColor: '#B04E49', success: r => {
      if (r.confirm) ui.run(() => { store.removeAccount(this.data.accountId); wx.navigateBack(); });
    }, complete: () => this.setData({ busy: false }) });
  }
});
