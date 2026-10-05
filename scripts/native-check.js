const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const cp = require('node:child_process');
const compiler = process.argv[2] || process.env.WECHAT_COMPILER_DIR;
if (!compiler) { console.error('用法：node scripts/native-check.js "微信开发者工具/code/package.nw/node_modules/wcc-exec"'); process.exit(1); }
const mini = path.join(__dirname,'../miniprogram');
function files(dir, ext) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name),ext):e.name.endsWith(ext)?[path.join(dir,e.name)]:[]); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'xiaorizhang-compile-'));
try {
  for (const [tool,ext] of [['wcc','.wxml'],['wcsc','.wxss']]) {
    const args = files(mini,ext).map(f=>'./'+path.relative(mini,f).replace(/\\/g,'/'));
    const output = path.join(temp,tool+'.js');
    const result = cp.spawnSync(path.join(compiler,tool+'.exe'),args.concat(['-o',output]),{cwd:mini,encoding:'utf8',windowsHide:true});
    if (result.error) throw result.error; if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${tool} 编译失败`);
    console.log(`${tool}：${args.length} 个 ${ext} 文件编译成功（${fs.statSync(output).size} 字节）`);
  }
} finally {
  // 只清理明确命名的编译结果，不做递归删除。
  for (const name of ['wcc.js','wcsc.js']) { const file = path.join(temp,name); if (fs.existsSync(file)) fs.unlinkSync(file); }
  fs.rmdirSync(temp);
}
