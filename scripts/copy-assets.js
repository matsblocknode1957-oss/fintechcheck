const fs = require('fs');
const path = require('path');

const assets = ['dashboard.html', 'index.html'];
const src = path.join(__dirname, '..', 'src', 'api');
const dest = path.join(__dirname, '..', 'dist', 'api');

fs.mkdirSync(dest, { recursive: true });

for (const file of assets) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
  console.log(`copied ${file} → dist/api/${file}`);
}
