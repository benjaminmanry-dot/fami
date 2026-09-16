const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const base = 'http://127.0.0.1:4173';
  const outDir = path.join(process.cwd(), 'final-launch-screenshot-packet');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  const jobs = [
    { name: 'home-desktop', url: '/', viewport: { width: 1440, height: 2200 }, mobile: false },
    { name: 'home-mobile', url: '/', viewport: { width: 390, height: 844 }, mobile: true },
    { name: 'campaigns-desktop', url: '/campaigns/', viewport: { width: 1440, height: 2400 }, mobile: false },
    { name: 'campaigns-mobile', url: '/campaigns/', viewport: { width: 390, height: 844 }, mobile: true },
    { name: 'start-desktop', url: '/start/', viewport: { width: 1440, height: 2200 }, mobile: false },
    { name: 'start-mobile', url: '/start/', viewport: { width: 390, height: 844 }, mobile: true },
    { name: 'faq-desktop', url: '/faq/', viewport: { width: 1440, height: 2200 }, mobile: false },
    { name: 'about-desktop', url: '/about/', viewport: { width: 1440, height: 2200 }, mobile: false }
  ];

  const report = { generatedAt: new Date().toISOString(), base, screenshots: [], pages: [], consoleErrors: [], requestFailures: [] };

  for (const job of jobs) {
    const context = await browser.newContext({
      viewport: job.viewport,
      isMobile: job.mobile,
      hasTouch: job.mobile,
      deviceScaleFactor: 1
    });
    const page = await context.newPage();
    page.on('console', msg => { if (msg.type() === 'error') report.consoleErrors.push({ page: job.name, text: msg.text() }); });
    page.on('requestfailed', req => report.requestFailures.push({ page: job.name, url: req.url(), error: req.failure()?.errorText || 'unknown' }));

    const res = await page.goto(base + job.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    const file = `${job.name}.png`;
    await page.screenshot({ path: path.join(outDir, file), fullPage: true });
    report.screenshots.push(file);
    report.pages.push({ name: job.name, status: res ? res.status() : null, finalUrl: page.url() });
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(outDir, 'screenshot-report.json'), JSON.stringify(report, null, 2));
  console.log('screenshots complete');
})();
