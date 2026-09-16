const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const base = 'http://127.0.0.1:4173';
  const outDir = path.join(process.cwd(), 'final-campaign-correction-screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const requiredRoutes = [
    '/campaigns/',
    '/campaigns/keep-on-the-borderlands/',
    '/campaigns/drakkenheim/',
    '/campaigns/thrones-of-the-djinni-lords/',
    '/campaigns/eberron-black-lanterns/',
    '/campaigns/vecna-eve-of-ruin/',
    '/campaigns/avylan/',
    '/campaigns/waterdeep-dragonheist-dotmm/',
    '/campaigns/epic-quests/',
    '/start/'
  ];

  const screenshotRoutes = [
    '/campaigns/',
    '/campaigns/drakkenheim/',
    '/campaigns/epic-quests/',
    '/campaigns/thrones-of-the-djinni-lords/',
    '/campaigns/eberron-black-lanterns/',
    '/start/'
  ];

  const qa = {
    generatedAt: new Date().toISOString(),
    base,
    routeChecks: [],
    screenshotFiles: [],
    consoleErrors: [],
    requestFailures: [],
    formChecks: {},
    menuCheck: {},
    campaignLinkChecks: {},
    contentChecks: {},
    overallPass: false
  };

  const browser = await chromium.launch({ headless: true });

  for (const route of requiredRoutes) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const res = await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    qa.routeChecks.push({ route, status: res ? res.status() : null });
    await context.close();
  }

  for (const route of screenshotRoutes) {
    const slug = route === '/campaigns/' ? 'campaigns' : route.replaceAll('/', '-').replace(/^-|-$/g, '');
    const variants = [
      { name: `${slug}-desktop`, viewport: { width: 1440, height: 2400 }, mobile: false },
      { name: `${slug}-mobile`, viewport: { width: 390, height: 844 }, mobile: true }
    ];

    for (const v of variants) {
      const context = await browser.newContext({ viewport: v.viewport, isMobile: v.mobile, hasTouch: v.mobile });
      const page = await context.newPage();

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          qa.consoleErrors.push({ page: v.name, text: msg.text() });
        }
      });
      page.on('requestfailed', (req) => {
        qa.requestFailures.push({
          page: v.name,
          url: req.url(),
          error: req.failure() ? req.failure().errorText : 'unknown'
        });
      });

      await page.goto(base + route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      const fileName = `${v.name}.png`;
      await page.screenshot({ path: path.join(outDir, fileName), fullPage: true });
      qa.screenshotFiles.push(fileName);
      await context.close();
    }
  }

  // Mobile menu QA.
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
    qa.menuCheck = {
      before,
      afterOpen,
      afterClose,
      navOpen,
      navClosed,
      ok: afterOpen === 'true' && afterClose === 'false' && navOpen && navClosed
    };
    await context.close();
  }

  // Start form QA.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
    const page = await context.newPage();
    await page.goto(base + '/start/', { waitUntil: 'domcontentloaded' });
    const form = page.locator('form[name="session-zero"]');
    const formExists = (await form.count()) > 0;
    const method = formExists ? await form.getAttribute('method') : null;
    const dataNetlify = formExists ? await form.getAttribute('data-netlify') : null;
    const action = formExists ? await form.getAttribute('action') : null;
    const hiddenFormNameCount = await page.locator('input[type="hidden"][name="form-name"][value="session-zero"]').count();
    const fieldsWithoutName = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('form[name="session-zero"] input, form[name="session-zero"] select, form[name="session-zero"] textarea'));
      return els.filter((el) => !el.getAttribute('name') || !el.getAttribute('name').trim()).length;
    });

    qa.formChecks = {
      formExists,
      method,
      dataNetlify,
      action,
      hiddenFormNameCount,
      fieldsWithoutNameCount: fieldsWithoutName,
      ok:
        formExists &&
        String(method || '').toUpperCase() === 'POST' &&
        dataNetlify === 'true' &&
        action === '/start/thanks/' &&
        hiddenFormNameCount > 0 &&
        fieldsWithoutName === 0
    };
    await context.close();
  }

  // Campaign CTA link QA on /campaigns.
  {
    const context = await browser.newContext({ viewport: { width: 1400, height: 2400 } });
    const page = await context.newPage();
    await page.goto(base + '/campaigns/', { waitUntil: 'domcontentloaded' });

    const reserveHrefs = [
      '/start/?campaign=keep-on-the-borderlands',
      '/start/?campaign=drakkenheim-tuesday',
      '/start/?campaign=drakkenheim-friday',
      '/start/?campaign=thrones-of-the-djinni-lords',
      '/start/?campaign=eberron-black-lanterns',
      '/start/?campaign=vecna-eve-of-ruin',
      '/start/?campaign=avylan',
      '/start/?campaign=waterdeep-dragonheist-dotmm',
      '/start/?campaign=epic-quests'
    ];
    for (const href of reserveHrefs) {
      const count = await page.locator(`a[href="${href}"]`).count();
      qa.campaignLinkChecks[href] = { count, ok: count > 0 };
    }

    const epicCta = page.locator('#epic-quests a[href="/start/?campaign=epic-quests"]');
    const epicCtaText = ((await epicCta.first().textContent()) || '').trim();
    qa.campaignLinkChecks.epicWaitlistLabel = {
      text: epicCtaText,
      ok: epicCtaText === 'Join the Waitlist'
    };

    await context.close();
  }

  // Content checks in built output.
  {
    const distRoot = path.join(process.cwd(), 'dist');
    const detailPaths = [
      'campaigns/keep-on-the-borderlands/index.html',
      'campaigns/drakkenheim/index.html',
      'campaigns/thrones-of-the-djinni-lords/index.html',
      'campaigns/eberron-black-lanterns/index.html',
      'campaigns/vecna-eve-of-ruin/index.html',
      'campaigns/avylan/index.html',
      'campaigns/waterdeep-dragonheist-dotmm/index.html',
      'campaigns/epic-quests/index.html'
    ];

    const allDistHtml = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.endsWith('.html')) allDistHtml.push(fs.readFileSync(full, 'utf8'));
      }
    }
    walk(distRoot);
    const aggregate = allDistHtml.join('\n');
    qa.contentChecks.noPlayerFacingCampaignPitch = !aggregate.includes('Player-Facing Campaign Pitch');

    let detailContainsViewCampaign = false;
    let allDetailsHaveBackToCampaigns = true;
    for (const rel of detailPaths) {
      const html = fs.readFileSync(path.join(distRoot, rel), 'utf8');
      if (html.includes('>View Campaign<')) detailContainsViewCampaign = true;
      if (!html.includes('>Back to Campaigns<')) allDetailsHaveBackToCampaigns = false;
    }
    qa.contentChecks.detailPagesNoViewCampaignCta = !detailContainsViewCampaign;
    qa.contentChecks.detailPagesHaveBackToCampaigns = allDetailsHaveBackToCampaigns;

    const drakHtml = fs.readFileSync(path.join(distRoot, 'campaigns/drakkenheim/index.html'), 'utf8');
    qa.contentChecks.drakkenheimTuesdayCta = drakHtml.includes('>Reserve Tuesday Session Zero<') && drakHtml.includes('href="/start/?campaign=drakkenheim-tuesday"');
    qa.contentChecks.drakkenheimFridayCta = drakHtml.includes('>Reserve Friday Session Zero<') && drakHtml.includes('href="/start/?campaign=drakkenheim-friday"');

    const epicDetail = fs.readFileSync(path.join(distRoot, 'campaigns/epic-quests/index.html'), 'utf8');
    const epicCard = fs.readFileSync(path.join(distRoot, 'campaigns/index.html'), 'utf8');
    qa.contentChecks.epicDetailJoinWaitlist = epicDetail.includes('>Join the Waitlist<') && epicDetail.includes('href="/start/?campaign=epic-quests"');
    qa.contentChecks.epicCardJoinWaitlist = epicCard.includes('id="epic-quests"') && epicCard.includes('>Join the Waitlist<') && epicCard.includes('href="/start/?campaign=epic-quests"');
  }

  await browser.close();

  qa.overallPass =
    qa.routeChecks.every((r) => r.status === 200) &&
    qa.consoleErrors.length === 0 &&
    qa.requestFailures.length === 0 &&
    qa.formChecks.ok &&
    qa.menuCheck.ok &&
    Object.values(qa.campaignLinkChecks).every((v) => v.ok !== false) &&
    Object.values(qa.contentChecks).every((v) => v === true);

  fs.writeFileSync(path.join(outDir, 'qa-report.json'), JSON.stringify(qa, null, 2));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ generatedAt: qa.generatedAt, files: qa.screenshotFiles.concat(['qa-report.json']) }, null, 2));
  console.log('final campaign correction QA and screenshots complete');
})();

