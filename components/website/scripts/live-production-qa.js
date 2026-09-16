const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const base = 'https://20fates.com';
  const outPath = path.join(process.cwd(), 'live-production-qa-report.json');
  const browser = await chromium.launch({ headless: true });

  const routes = [
    '/',
    '/campaigns/',
    '/campaigns/keep-on-the-borderlands/',
    '/campaigns/drakkenheim/',
    '/campaigns/thrones-of-the-djinni-lords/',
    '/campaigns/eberron-black-lanterns/',
    '/campaigns/vecna-eve-of-ruin/',
    '/campaigns/avylan/',
    '/campaigns/waterdeep-dragonheist-dotmm/',
    '/campaigns/epic-quests/',
    '/start/',
    '/faq/',
    '/about/',
    '/attendance-policy/'
  ];

  const campaignPrefillIds = [
    'keep-on-the-borderlands',
    'drakkenheim-tuesday',
    'drakkenheim-friday',
    'thrones-of-the-djinni-lords',
    'eberron-black-lanterns',
    'vecna-eve-of-ruin',
    'avylan',
    'waterdeep-dragonheist-dotmm',
    'epic-quests'
  ];

  const legacyRoutes = [
    '/campaigns/city-of-shade/',
    '/campaigns/fortune-wheel/',
    '/campaigns/out-of-the-abyss/',
    '/campaigns/solo/',
    '/campaigns/private/',
    '/campaigns/waterdeep/'
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    base,
    routeChecks: [],
    consoleErrors: [],
    requestFailures: [],
    menuCheck: {},
    prefillChecks: {},
    drakkenheimChecks: {},
    epicChecks: {},
    legacyRedirectChecks: {},
    contentChecks: {},
    overallPass: false
  };

  for (const route of routes) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') report.consoleErrors.push({ route, text: msg.text() });
    });
    page.on('requestfailed', (req) => {
      report.requestFailures.push({ route, url: req.url(), error: req.failure() ? req.failure().errorText : 'unknown' });
    });
    const res = await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    report.routeChecks.push({
      route,
      status: res ? res.status() : null,
      finalUrl: page.url()
    });
    await context.close();
  }

  // Mobile menu
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const toggle = page.locator('[data-nav-toggle]');
    const nav = page.locator('[data-main-nav]');
    const before = await toggle.getAttribute('aria-expanded');
    await toggle.click();
    const afterOpen = await toggle.getAttribute('aria-expanded');
    const navOpen = await nav.evaluate((el) => el.classList.contains('open'));
    await toggle.click();
    const afterClose = await toggle.getAttribute('aria-expanded');
    const navClosed = await nav.evaluate((el) => !el.classList.contains('open'));
    report.menuCheck = { before, afterOpen, afterClose, navOpen, navClosed, ok: afterOpen === 'true' && afterClose === 'false' && navOpen && navClosed };
    await context.close();
  }

  // Prefill checks
  for (const id of campaignPrefillIds) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${base}/start/?campaign=${id}`, { waitUntil: 'domcontentloaded' });
    const selected = await page.locator('#campaign-interest').inputValue();
    report.prefillChecks[id] = { selected, ok: selected === id };
    await context.close();
  }

  // Drakkenheim checks
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    const page = await context.newPage();
    await page.goto(base + '/campaigns/drakkenheim/', { waitUntil: 'domcontentloaded' });
    const tueBtn = page.locator('a[href="/start/?campaign=drakkenheim-tuesday"]');
    const friBtn = page.locator('a[href="/start/?campaign=drakkenheim-friday"]');
    const tueText = ((await tueBtn.first().textContent()) || '').trim();
    const friText = ((await friBtn.first().textContent()) || '').trim();
    report.drakkenheimChecks = {
      hasTuesdayLink: (await tueBtn.count()) > 0,
      hasFridayLink: (await friBtn.count()) > 0,
      tuesdayLabel: tueText,
      fridayLabel: friText,
      ok: tueText.includes('Tuesday') && friText.includes('Friday')
    };
    await context.close();
  }

  // Epic checks
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    const page = await context.newPage();
    await page.goto(base + '/campaigns/epic-quests/', { waitUntil: 'domcontentloaded' });
    const waitlistBtns = page.locator('a[href="/start/?campaign=epic-quests"]');
    const text = await page.textContent('body');
    const firstBtn = ((await waitlistBtns.first().textContent()) || '').trim();
    report.epicChecks = {
      waitlistButtonCount: await waitlistBtns.count(),
      firstWaitlistButtonLabel: firstBtn,
      containsCurrentlyFullCopy: (text || '').toLowerCase().includes('currently full'),
      containsWaitlistCopy: (text || '').toLowerCase().includes('waitlist'),
      ok: (await waitlistBtns.count()) > 0 && firstBtn.includes('Join the Waitlist')
    };
    await context.close();
  }

  // Legacy redirects
  for (const route of legacyRoutes) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    const res = await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    const finalPath = new URL(page.url()).pathname;
    const expected = route === '/campaigns/waterdeep/' ? '/campaigns/waterdeep-dragonheist-dotmm/' : '/campaigns/';
    report.legacyRedirectChecks[route] = {
      status: res ? res.status() : null,
      finalPath,
      expected,
      ok: finalPath === expected
    };
    await context.close();
  }

  // Built-content assertions against live HTML of key pages.
  {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await context.newPage();
    const detailRoutes = [
      '/campaigns/keep-on-the-borderlands/',
      '/campaigns/drakkenheim/',
      '/campaigns/thrones-of-the-djinni-lords/',
      '/campaigns/eberron-black-lanterns/',
      '/campaigns/vecna-eve-of-ruin/',
      '/campaigns/avylan/',
      '/campaigns/waterdeep-dragonheist-dotmm/',
      '/campaigns/epic-quests/'
    ];
    let containsOldHeading = false;
    let detailHasViewCampaign = false;
    let detailMissingBackToCampaigns = false;
    for (const route of detailRoutes) {
      await page.goto(base + route, { waitUntil: 'domcontentloaded' });
      const html = await page.content();
      if (html.includes('Player-Facing Campaign Pitch')) containsOldHeading = true;
      if (html.includes('>View Campaign<')) detailHasViewCampaign = true;
      if (!html.includes('>Back to Campaigns<')) detailMissingBackToCampaigns = true;
    }
    report.contentChecks = {
      noPlayerFacingCampaignPitch: !containsOldHeading,
      detailNoViewCampaignCta: !detailHasViewCampaign,
      detailHasBackToCampaigns: !detailMissingBackToCampaigns
    };
    await context.close();
  }

  await browser.close();

  report.overallPass =
    report.routeChecks.every((r) => r.status === 200) &&
    report.consoleErrors.length === 0 &&
    report.requestFailures.length === 0 &&
    report.menuCheck.ok &&
    Object.values(report.prefillChecks).every((v) => v.ok) &&
    report.drakkenheimChecks.ok &&
    report.epicChecks.ok &&
    Object.values(report.legacyRedirectChecks).every((v) => v.ok) &&
    Object.values(report.contentChecks).every((v) => v === true);

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('live production QA complete');
})();

