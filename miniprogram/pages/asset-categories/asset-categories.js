const store = require('../../utils/store'); const assets = require('../../utils/assets'); const categoryPage = require('../../utils/category-page');
Page(Object.assign(categoryPage({
  field: 'kind', values: assets.KINDS, icons: ['💳', '💰', '💬', '📈', '📜', '🪙', '📊', '💵', '📦', '🏠', '🚗', '🧾', '🤝', '🏦', '🏅'],
  list: s => s.assetCategories, usage: s => s.accounts, saveCategory: store.saveAssetCategory, removeCategory: store.removeAssetCategory,
  minimumError: '资产和负债各至少保留一个分类', removeTitle: '删除资产分类？',
  removeContent: name => `此分类下的全部账户（含归档账户）将迁移到「${name}」，金额和历史记录保持不变。`
}), {
  kindChange(e) { this.switchGroup(e.currentTarget.dataset.kind); }
}));
