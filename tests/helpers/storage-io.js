// Shared mock for platform directory and file APIs. No disk or phone data is used.
function installStorageIO(wx, db) {
  const files = new Map(); const root = '/sandbox';
  wx.getStorageInfoSync = () => ({ keys: [...db.keys()], currentSize: 1, limitSize: 10240 });
  wx.env = { USER_DATA_PATH: root };
  const fs = {
    readdirSync: () => [...files.keys()].filter(p => p.startsWith(root + '/')).map(p => p.slice(root.length + 1)),
    readFileSync: p => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p); },
    writeFileSync: (p, value) => { files.set(p, value); },
    unlinkSync: p => { files.delete(p); },
    renameSync: (from, to) => { if (!files.has(from)) throw new Error('ENOENT'); files.set(to, files.get(from)); files.delete(from); },
    writeFile: options => { files.set(options.filePath, options.data); options.success(); },
    readFile: options => { if (files.has(options.filePath)) options.success({ data: files.get(options.filePath) }); else options.fail(); }
  };
  wx.getFileSystemManager = () => fs;
  return { files, fs };
}
module.exports = { installStorageIO };
