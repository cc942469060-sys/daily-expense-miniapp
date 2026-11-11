const store = require('../../utils/store'); const core = require('../../utils/core'); const categoryPage = require('../../utils/category-page');
Page(Object.assign(categoryPage({
  field: 'type', values: core.TYPES, icons: ['🍜', '🚇', '🛒', '🏠', '🎮', '💊', '📚', '📦', '☕', '🐱', '🎁', '✈️', '👕', '💡', '🍎', '🏃', '💼', '🏅', '🧾', '🧧', '💰', '📈', '🛠️', '🛡️', '📊', '🏦', '🧳', '🧓'],
  list: s => s.categories, usage: s => s.records, saveCategory: store.saveCategory, removeCategory: store.removeCategory,
  minimumError: '每种收支类型至少保留一个分类', removeTitle: '删除分类？',
  removeContent: name => `此分类下的历史账单将迁移到「${name}」，账单金额保持不变。`
}), {
  typeChange(e) { this.switchGroup(e.currentTarget.dataset.type); }
}));
