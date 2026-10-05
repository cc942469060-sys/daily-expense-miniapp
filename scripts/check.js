const fs = require('node:fs'); const path = require('node:path'); const cp = require('node:child_process');
const root = path.join(__dirname, '..'); const mini = path.join(root, 'miniprogram'); let count = 0;
function assert(condition, message) { if (!condition) throw new Error(message); }
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
for (const file of walk(root)) {
  if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
  if (file.endsWith('.js')) cp.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  if (!file.endsWith('.wxml')) continue;
  const js = fs.readFileSync(file.replace(/\.wxml$/, '.js'), 'utf8'); const wxml = fs.readFileSync(file, 'utf8'); const stack = [];
  for (const match of wxml.matchAll(/<\/?[a-z][^>]*>/g)) {
    const tag = match[0]; const name = tag.match(/^<\/?([\w-]+)/)[1];
    if (tag.startsWith('</')) assert(stack.pop() === name, `${file}: 标签 ${name} 未配对`);
    else if (!tag.endsWith('/>')) stack.push(name);
  }
  assert(!stack.length, `${file}: 存在未闭合标签`);
  for (const match of wxml.matchAll(/(?:bind|catch)(?::)?[\w-]+="([a-zA-Z]\w*)"/g)) assert(new RegExp(`\\b${match[1]}\\s*\\(`).test(js), `${file}: 事件 ${match[1]} 没有处理函数`);
  count++;
}
const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json')));
for (const route of app.pages) for (const ext of ['js','json','wxml','wxss']) assert(fs.existsSync(path.join(mini, `${route}.${ext}`)), `缺少页面文件: ${route}.${ext}`);
for (const tab of app.tabBar.list) for (const icon of [tab.iconPath, tab.selectedIconPath]) assert(fs.existsSync(path.join(mini, icon)), `缺少图标: ${icon}`);
for (const file of walk(mini).filter(f => f.endsWith('.json'))) {
  const config = JSON.parse(fs.readFileSync(file));
  for (const route of Object.values(config.usingComponents || {})) assert(fs.existsSync(path.join(mini, `${route.replace(/^\//, '')}.json`)), `组件路径不存在: ${route}`);
}
console.log(`通过：JS 语法、JSON、${app.pages.length} 个页面、${count} 个 WXML 的标签与事件、组件路径和图标。此检查不替代微信原生编译。`);
