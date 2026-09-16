const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const base = 'http://127.0.0.1:4173';
  const outDir = path.join(process.cwd(), 'final-launch-screenshot-packet');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  const shots = [
    { name: 'home-desktop', url: '/', viewport: { width: 1440, height: 2200 }, mobile: false },
    { name: 'home-mobile', url: '/', viewport: { width: 390, height: 844 }, mobile: true },
    { name: 'campaigns-desktop', url: '/campaigns/', viewport: { width: 1440, height: 2600 }, mobile: false },
    { name: 'campaigns-mobile', url: '/campaigns/', viewport: { width: 390, height: 844 }, mobile: true },
    { name: 'start-desktop', url: '/start/', viewport: { width: 1440, height: 2200 }, mobile: false },
    { name: 'start-mobile', url: '/start/', viewport: { width: 390, height: 844 }, mobile: true },
    { name: 'faq-desktop', url: '/faq/', viewport: { width: 1440, height: 2200 }, mobile: false },
    { name: 'about-desktop', url: '/about/', viewport: { width: 1440, height: 2200 }, mobile: false }
  ];

  const qa = {
    generatedAt: new Date().toISOString(),
    base,
    pageStatus: [],
    consoleErrors: [],
    requestFailures: [],
    screenshots: [],
    menuCheck: null,
    queryPrefill: {},
    campaignReserveLinks: {},
    formChecks: {}
  };

  for (const s of shots) {
    const context = await browser.newContext({
      viewport: s.viewport,
      isMobile: s.mobile,
      hasTouch: s.mobile,
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    page.on('console', m => {
      if (m.type() === 'error') qa.consoleErrors.push({ page: s.name, text: m.text() });
    });
    page.on('requestfailed', r => qa.requestFailures.push({ page: s.name, url: r.url(), err: r.failure()?.errorText || 'unknown' }));

    const res = await page.goto(base + s.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const filename = `${s.name}.png`;
    await page.screenshot({ path: path.join(outDir, filename), fullPage: true });
    qa.screenshots.push(filename);
    qa.pageStatus.push({ page: s.name, url: s.url, status: res ? res.status() : null });

    await context.close();
  }

  // Menu open/close mobile check
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('[data-nav-toggle]');
    const nav = page.locator('[data-main-nav]');
    const before = await btn.getAttribute('aria-expanded');
    await btn.click();
    const afterOpen = await btn.getAttribute('aria-expanded');
    const navOpenClass = await nav.evaluate(el => el.classList.contains('open'));
    await btn.click();
    const afterClose = await btn.getAttribute('aria-expanded');
    const navClosedClass = await nav.evaluate(el => !el.classList.contains('open'));
    qa.menuCheck = { before, afterOpen, afterClose, navOpenClass, navClosedClass, ok: afterOpen === 'true' && afterClose === 'false' && navOpenClass && navClosedClass };
    await ctx.close();
  }

  // Query prefill checks
  for (const c of ['drakkenheim', 'city-of-shade', 'waterdeep', 'fortune-wheel', 'out-of-the-abyss', 'solo', 'private-bespoke']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/start/?campaign=${c}`, { waitUntil: 'domcontentloaded' });
    const selected = await page.locator('#campaign-interest').inputValue();
    qa.queryPrefill[c] = { selected, ok: selected === c };
    await ctx.close();
  }

  // Campaign link checks on campaigns page
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
    const page = await ctx.newPage();
    await page.goto(base + '/campaigns/', { waitUntil: 'domcontentloaded' });

    const targets = [
      '/start/?campaign=drakkenheim',
      '/start/?campaign=city-of-shade',
      '/start/?campaign=waterdeep',
      '/start/?campaign=fortune-wheel',
      '/start/?campaign=out-of-the-abyss',
      '/start/?campaign=solo',
      '/start/?campaign=private-bespoke'
    ];

    for (const t of targets) {
      const count = await page.locator(`a[href="${t}"]`).count();
      qa.campaignReserveLinks[t] = { count, ok: count > 0 };
    }
    await ctx.close();
  }

  // Form checks
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(base + '/start/', { waitUntil: 'domcontentloaded' });

    const form = page.locator('form[name="session-zero"]');
    const formExists = await form.count() > 0;
    const method = await form.getAttribute('method');
    const dataNetlify = await form.getAttribute('data-netlify');
    const action = await form.getAttribute('action');
    const hiddenFormName = await page.locator('input[type="hidden"][name="form-name"][value="session-zero"]').count();

    const fieldsWithoutName = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('form[name="session-zero"] input, form[name="session-zero"] select, form[name="session-zero"] textarea'));
      return els.filter(el => !el.getAttribute('name') || !el.getAttribute('name').trim()).map(el => el.outerHTML.slice(0, 120));
    });

    qa.formChecks = {
      formExists,
      method,
      dataNetlify,
      action,
      hiddenFormNameCount: hiddenFormName,
      fieldsWithoutNameCount: fieldsWithoutName.length,
      fieldsWithoutName,
      ok: formExists && String(method).toUpperCase() === 'POST' && dataNetlify === 'true' && action === '/start/thanks/' && hiddenFormName > 0 && fieldsWithoutName.length === 0
    };

    await ctx.close();
  }

  qa.overallOk =
    qa.pageStatus.every(p => p.status === 200) &&
    qa.consoleErrors.length === 0 &&
    qa.requestFailures.length === 0 &&
    qa.menuCheck.ok &&
    Object.values(qa.queryPrefill).every(v => v.ok) &&
    Object.values(qa.campaignReserveLinks).every(v => v.ok) &&
    qa.formChecks.ok;

  fs.writeFileSync(path.join(outDir, 'qa-report.json'), JSON.stringify(qa, null, 2));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ files: qa.screenshots.concat(['qa-report.json']), generatedAt: qa.generatedAt }, null, 2));
  console.log('qa complete');
})();

