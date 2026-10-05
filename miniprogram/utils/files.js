const ui = require('./ui');
function writeFile(name, content) {
  return new Promise((resolve, reject) => {
    const path = `${wx.env.USER_DATA_PATH}/${name}`;
    wx.getFileSystemManager().writeFile({ filePath: path, data: content, encoding: 'utf8', success: () => resolve(path), fail: () => reject(new Error('文件写入失败，请检查存储空间')) });
  });
}
function shareFile(path, name) {
  return new Promise(resolve => {
    if (!wx.shareFileMessage) { wx.showModal({ title: '文件已生成', content: '当前环境不支持发送文件，请使用较新版本微信真机操作。开发者工具可在文件系统中查看文件。', showCancel: false }); resolve(false); return; }
    wx.shareFileMessage({ filePath: path, fileName: name, success: () => resolve(true), fail: e => { if (!/cancel/i.test(e.errMsg || '')) ui.error(new Error('文件已生成，但发送失败。请在真机重试导出。')); resolve(false); } });
  });
}
function chooseBackup() {
  return new Promise((resolve, reject) => {
    if (!wx.chooseMessageFile) { reject(new Error('当前环境不支持选择文件，请使用微信真机恢复备份')); return; }
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ['json'], success: res => {
      const f = res.tempFiles[0]; if (!f || f.size > 8 * 1024 * 1024) { reject(new Error('备份文件过大，最多支持 8 MB')); return; }
      wx.getFileSystemManager().readFile({ filePath: f.path, encoding: 'utf8', success: r => resolve(r.data), fail: () => reject(new Error('无法读取备份文件')) });
    }, fail: e => /cancel/i.test(e.errMsg || '') ? resolve(null) : reject(new Error('选择文件失败，请在真机重试')) });
  });
}
module.exports = { writeFile, shareFile, chooseBackup };
