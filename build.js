/* Build: gộp + làm rối toàn bộ JS thành 1 file, nén CSS/HTML -> thư mục dist/ (đây là thứ bạn đưa lên hosting).
   Chạy: npm install && npm run build */
const fs = require('fs'), path = require('path'), O = require('javascript-obfuscator');
const OUT = 'dist', rd = f => fs.readFileSync(f, 'utf8');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT + '/assets', { recursive: true });
const pages = fs.readdirSync('.').filter(f => f.endsWith('.html'));
const grab = (h, tag) => [...h.match(new RegExp('<!--' + tag + '-->([\\s\\S]*?)<!--/' + tag + '-->'))[1].matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
const first = rd('index.html'), jsList = grab(first, 'js'), cssList = grab(first, 'css');
const code = jsList.map(f => rd(f)).join(';\n');
fs.writeFileSync(OUT + '/assets/a.js', O.obfuscate(code, {
  compact: true, renameGlobals: false, identifierNamesGenerator: 'hexadecimal', stringArray: true, stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.8, splitStrings: true, splitStringsChunkLength: 6, transformObjectKeys: false, sourceMap: false
}).getObfuscatedCode());
fs.writeFileSync(OUT + '/assets/s.css', cssList.map(f => rd(f)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*([{};:,>])\s*/g, '$1').replace(/\n+/g, ''));
for (const p of pages) fs.writeFileSync(path.join(OUT, p), rd(p)
  .replace(/<!--js-->[\s\S]*?<!--\/js-->/, '<script src="assets/a.js"></script>')
  .replace(/<!--css-->[\s\S]*?<!--\/css-->/, '<link rel="stylesheet" href="assets/s.css">').replace(/\n\s*/g, '\n'));
for (const f of ['logo.png', '.nojekyll', '_headers', '_redirects']) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(OUT, f));
console.log('Xong -> ' + OUT + '/ (a.js ' + Math.round(fs.statSync(OUT + '/assets/a.js').size / 1024) + ' KB)');
