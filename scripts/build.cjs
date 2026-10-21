const fs = require('node:fs');
const path = require('node:path');
const { zipSync } = require('fflate');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'addon/manifest.json'), 'utf8'));
const files = {};
for (const name of fs.readdirSync(path.join(root, 'addon')).sort()) {
  files[name] = new Uint8Array(fs.readFileSync(path.join(root, 'addon', name)));
}
files.LICENSE = new Uint8Array(fs.readFileSync(path.join(root, 'LICENSE')));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const target = path.join(root, 'dist', `paper-metadata-search-${manifest.version}.xpi`);
fs.writeFileSync(target, zipSync(files));
console.log(target);
