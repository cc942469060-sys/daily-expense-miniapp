Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { groups: { type: Array, value: [] }, flat: { type: Boolean, value: false }, emptyText: { type: String, value: '还没有记录，记下你的第一笔收支吧' } },
  methods: { select(e) { this.triggerEvent('select', { id: e.currentTarget.dataset.id }); } }
});
