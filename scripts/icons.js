// 无第三方依赖：生成微信 tabBar 使用的透明 PNG 图标。
const fs = require('node:fs'); const path = require('node:path'); const zlib = require('node:zlib');
const size = 64; const root = path.join(__dirname, '../miniprogram/assets'); fs.mkdirSync(root, { recursive: true });
function crc(buffer) { let c = 0xffffffff; for (const b of buffer) { c ^= b; for (let n = 0; n < 8; n++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(name, data) { const type = Buffer.from(name); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const check = Buffer.alloc(4); check.writeUInt32BE(crc(Buffer.concat([type, data]))); return Buffer.concat([length, type, data, check]); }
function png(pixels) {
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc(size * (1 + size * 4)); for (let y = 0; y < size; y++) pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const shapes = {
  assets: [[12,19,51,19],[12,19,12,51],[12,51,52,51],[52,51,52,19],[12,19,43,11],[43,11,43,19],[52,30,38,30],[38,30,38,41],[38,41,52,41],[44,35,46,35]],
  home: [[11,30,32,12],[32,12,53,30],[17,28,17,51],[17,51,47,51],[47,51,47,28],[27,51,27,36],[27,36,37,36],[37,36,37,51]],
  stats: [[14,50,14,37],[14,37,23,37],[23,37,23,50],[29,50,29,25],[29,25,38,25],[38,25,38,50],[44,50,44,14],[44,14,53,14],[53,14,53,50],[10,53,56,53]],
  mine: [[13,53,13,47],[13,47,17,40],[17,40,25,36],[25,36,39,36],[39,36,47,40],[47,40,51,47],[51,47,51,53],[13,53,51,53]]
};
for (const [name, lines] of Object.entries(shapes)) for (const active of [false, true]) {
  const pixels = Buffer.alloc(size * size * 4); const color = active ? [34,104,76] : [123,135,127];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let distance = Infinity;
    for (const [a,b,c,d] of lines) { const dx = c - a; const dy = d - b; const t = Math.max(0, Math.min(1, ((x-a)*dx+(y-b)*dy)/(dx*dx+dy*dy))); distance = Math.min(distance, Math.hypot(x-a-t*dx,y-b-t*dy)); }
    if (name === 'mine') distance = Math.min(distance, Math.abs(Math.hypot(x-32,y-22)-10));
    const alpha = Math.max(0, Math.min(1, 2.4-distance)); const i = (y*size+x)*4;
    pixels[i] = color[0]; pixels[i+1] = color[1]; pixels[i+2] = color[2]; pixels[i+3] = Math.round(alpha*255);
  }
  fs.writeFileSync(path.join(root, `${name}${active ? '-active' : ''}.png`), png(pixels));
}
console.log(`已生成 ${Object.keys(shapes).length * 2} 个 tabBar 图标`);
