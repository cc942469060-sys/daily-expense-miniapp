function error(e) { wx.showModal({ title: '操作未完成', content: e.message || '请稍后重试', showCancel: false }); }
function run(fn) { try { return fn(); } catch (e) { error(e); return undefined; } }
function toast(title) { wx.showToast({ title, icon: 'success' }); }
function edit(recordId) { wx.navigateTo({ url: `/pages/record/record${recordId ? `?id=${encodeURIComponent(recordId)}` : ''}` }); }
function bills(filter) {
  const q = Object.keys(filter || {}).filter(k => filter[k]).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(filter[k])}`).join('&');
  wx.navigateTo({ url: `/pages/bills/bills${q ? `?${q}` : ''}` });
}
module.exports = { error, run, toast, edit, bills };
