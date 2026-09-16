const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const base = 'http://127.0.0.1:4173';
  const outDir = path.join(process.cwd(), 'emergency-v1-screenshot-packet');
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

  const qa = {
    generatedAt: new Date().toISOString(),
    base,
    screenshots: [],
    consoleErrors: [],
    requestFailures: [],
    pages: []
  };

  for (const job of jobs) {
    const context = await browser.newContext({
      viewport: job.viewport,
      isMobile: job.mobile,
      hasTouch: job.mobile,
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    page.on('console', msg => {
      if (msg.type() === 'error') {
        qa.consoleErrors.push({ page: job.name, text: msg.text() });
      }
    });

    page.on('requestfailed', req => {
      qa.requestFailures.push({ page: job.name, url: req.url(), error: req.failure()?.errorText || 'unknown' });
    });

    const res = await page.goto(base + job.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const file = `${job.name}.png`;
    const filePath = path.join(outDir, file);
    await page.screenshot({ path: filePath, fullPage: true });

    qa.screenshots.push({ file, url: base + job.url, mobile: job.mobile, viewport: job.viewport });
    qa.pages.push({ name: job.name, status: res ? res.status() : null, finalUrl: page.url() });

    await context.close();
  }

  // CTA/link checks
  const checkContext = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const checkPage = await checkContext.newPage();

  const checks = [];

  async function checkLink(pagePath, text, expectedHrefPart) {
    await checkPage.goto(base + pagePath, { waitUntil: 'networkidle' });
    const locator = checkPage.getByRole('link', { name: text }).first();
    const count = await locator.count();
    if (!count) {
      checks.push({ page: pagePath, text, ok: false, reason: 'missing' });
      return;
    }
    const href = await locator.getAttribute('href');
    checks.push({ page: pagePath, text, ok: !!href && href.includes(expectedHrefPart), href: href || null, expectedHrefPart });
  }

  await checkLink('/', 'Reserve a Free Session Zero', '/start/');
  await checkLink('/', 'Browse Campaigns', '/campaigns/');
  await checkLink('/campaigns/', 'View Campaign', '/campaigns/#');
  await checkLink('/campaigns/', 'Reserve a Free Session Zero', '/start/?campaign=');

  await checkPage.goto(base + '/start/', { waitUntil: 'networkidle' });
  const formExists = (await checkPage.locator('form[name="session-zero"]').count()) > 0;
  const netlifyAttr = await checkPage.locator('form[name="session-zero"]').getAttribute('data-netlify');
  const actionAttr = await checkPage.locator('form[name="session-zero"]').getAttribute('action');
  const requiredCount = await checkPage.locator('form[name="session-zero"] [required]').count();

  qa.linkChecks = checks;
  qa.formChecks = {
    formExists,
    netlifyAttr,
    actionAttr,
    requiredFieldCount: requiredCount
  };

  await checkContext.close();
  await browser.close();

  fs.writeFileSync(path.join(outDir, 'qa-report.json'), JSON.stringify(qa, null, 2));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
    generatedAt: qa.generatedAt,
    files: qa.screenshots.map(s => s.file).concat(['qa-report.json'])
  }, null, 2));

  console.log('done');
})();
