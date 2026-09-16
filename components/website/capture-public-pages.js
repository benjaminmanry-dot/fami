const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const outDir = path.join(process.cwd(), 'public-pages-packet');
fs.mkdirSync(outDir, { recursive: true });

const urls = [
  'https://www.20fates.com/contact',
  'https://www.20fates.com/attendance-policy',
  'https://www.20fates.com/start',
  'https://www.20fates.com/home',
  'https://www.20fates.com/faq',
  'https://www.20fates.com/about',
  'https://www.20fates.com/drakkenheim',
  'https://www.20fates.com/adventures',
  'https://www.20fates.com/adventures/p/dungeons-of-drakkenheim',
  'https://www.20fates.com/adventures/p/intrigue-in-the-city-of-shade',
  'https://www.20fates.com/adventures/p/bespoke-campaigns-dcyf6',
  'https://www.20fates.com/adventures/p/solo-campaigns-zx47j',
  'https://www.20fates.com/adventures/p/turn-of-fortunes-wheel-t6jwg',
  'https://www.20fates.com/adventures/p/dungeons-of-drakkenheim-t3lz9',
  'https://www.20fates.com/adventures/p/secrets-of-waterdeep-tcbxl',
  'https://www.20fates.com/adventures/p/advanced-service-1-2kgm4-9x2dc',
  'https://www.20fates.com/adventures/p/advanced-service-le73c-tgy8h'
];

function slugify(u) {
  const url = new URL(u);
  let s = (url.pathname === '/' ? 'root' : url.pathname.slice(1))
    .replace(/\//g, '__')
    .replace(/[^a-zA-Z0-9_\-.]/g, '-');
  return s + '.png';
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 2400 } });
  const page = await context.newPage();
  const manifest = [];

  for (const url of urls) {
    const file = slugify(url);
    const filepath = path.join(outDir, file);
    let status = 'ok';
    let title = '';
    let finalUrl = '';
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: filepath, fullPage: true });
      title = await page.title();
      finalUrl = page.url();
      manifest.push({ url, finalUrl, title, status, httpStatus: resp ? resp.status() : null, file });
    } catch (e) {
      status = 'error';
      manifest.push({ url, finalUrl, title, status, error: String(e), file: null });
    }
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const readme = [
    '# Public Pages Screenshot Packet',
    '',
    `Captured: ${new Date().toISOString()}`,
    `Count requested: ${urls.length}`,
    `Count successful: ${manifest.filter(m => m.status === 'ok').length}`,
    '',
    '## Entries',
    ...manifest.map(m => `- ${m.status.toUpperCase()} | ${m.url} | ${m.file || 'no-file'}`)
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'README.md'), readme);

  await browser.close();
  console.log(JSON.stringify({ outDir, total: urls.length, ok: manifest.filter(m => m.status === 'ok').length }, null, 2));
})();
