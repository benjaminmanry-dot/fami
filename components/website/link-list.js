const fs = require('fs');
const path = require('path');

const pages = [
  'dist/index.html',
  'dist/campaigns/index.html',
  'dist/start/index.html',
  'dist/faq/index.html',
  'dist/about/index.html',
  'dist/attendance-policy/index.html',
  'dist/billing/terms/index.html',
  'dist/billing/setup-complete/index.html'
];

const hrefs = new Set();
for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8');
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (href.startsWith('/')) hrefs.add(href);
  }
}

const norm = [...hrefs].map(h => {
  if (h.includes('?')) return h;
  if (h.endsWith('/')) return h;
  if (h.includes('#')) return h;
  if (h.endsWith('.html')) return h;
  return h + '/';
});

console.log(JSON.stringify(norm.sort(), null, 2));
