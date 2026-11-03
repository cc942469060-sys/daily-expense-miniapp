let exportSequence = 0;
function backupName() { return `xiaorizhang-backup-${Date.now()}-${++exportSequence}-${Math.random().toString(36).slice(2, 10)}.json`; }
function writeFile(name, content) {
  return new Promise((resolve, reject) => {
    const path = `${wx.env.USER_DATA_PATH}/${name}`;
    const fs = wx.getFileSystemManager();
    if (/^xiaorizhang-backup-/.test(name)) {
      try { if (fs.readdirSync(wx.env.USER_DATA_PATH).includes(name)) { reject(new Error('同名备份已存在，请重新导出，旧文件未覆盖')); return; } }
      catch (e) { reject(new Error('无法检查已有备份，已取消导出')); return; }
    }
    fs.writeFile({ filePath: path, data: content, encoding: 'utf8', success: () => resolve(path), fail: () => reject(new Error('文件写入失败，请检查存储空间')) });
  });
}
function shareFile(path, name) {
  return new Promise(resolve => {
    const fail = (e, stage) => {
      const error = String(e && (e.errMsg || e.message) || '未知错误').split(path).join('[本地文件]').slice(0, 500);
      resolve({ status: /cancel/i.test(error) ? 'cancelled' : 'failed', stage, error });
    };
    try {
      const stat = wx.getFileSystemManager().statSync(path);
      if (!stat.isFile() || stat.size <= 0) throw new Error('文件为空或不是有效文件，请重新生成');
    } catch (e) { fail(e, 'file'); return; }
    if (typeof wx.shareFileMessage !== 'function') { fail(new Error('当前微信环境不支持文件发送，请升级微信后重试'), 'support'); return; }
    // Keep the native call in the tap handler's synchronous call stack.
    // Do not await file generation, access checks or a dialog before this call.
    try { wx.shareFileMessage({ filePath: path, fileName: name, success: () => resolve({ status: 'sent' }), fail: e => fail(e, 'share') }); }
    catch (e) { fail(e, 'share'); }
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
module.exports = { writeFile, shareFile, chooseBackup, backupName };
