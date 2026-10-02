// Only browser assets become public; backend source and secrets stay out of dist.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
for (const entry of ['css', 'js']) {
  fs.cpSync(path.join(root, entry), path.join(output, entry), { recursive: true });
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const localEndpoint = 'data-api-url="local-api/generate.php"';
if (!html.includes(localEndpoint)) throw new Error('Local API configuration missing from index.html.');
fs.writeFileSync(path.join(output, 'index.html'), html.replace(localEndpoint, 'data-api-url="api/generate"'));
console.log('StudyGen browser assets built in dist/.');
