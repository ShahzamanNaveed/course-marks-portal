const fs = require('fs');
const path = require('path');
const vm = require('vm');

const roots = ['server.js', 'src', 'scripts', 'public/js'];
const files = [];
for (const root of roots) {
  const full = path.resolve(root);
  if (fs.statSync(full).isFile()) files.push(full);
  else {
    for (const entry of fs.readdirSync(full, { recursive: true })) {
      const candidate = path.join(full, entry);
      if (candidate.endsWith('.js') && fs.statSync(candidate).isFile()) files.push(candidate);
    }
  }
}
for (const file of files) new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
console.log(`Syntax check passed for ${files.length} JavaScript files.`);
