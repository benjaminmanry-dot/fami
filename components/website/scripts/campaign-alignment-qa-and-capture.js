const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const base = 'http://127.0.0.1:4173';
  const outDir = path.join(process.cwd(), 'campaign-alignment-screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const routes = [
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

  const shots = [];
  for (const route of routes) {
    const name = route === '/campaigns/' ? 'campaigns' : route.replaceAll('/', '-').replace(/^-|-$/g, '');
    shots.push({ name: `${name}-desktop`, url: route, viewport: { width: 1440, height: 2400 }, mobile: false });
    shots.push({ name: `${name}-mobile`, url: route, viewport: { width: 390, height: 844 }, mobile: true });
  }

  const qa = {
    generatedAt: new Date().toISOString(),
    base,
    routeStatus: [],
    screenshots: [],
    consoleErrors: [],
    requestFailures: [],
    menuCheck: null,
    formChecks: {},
    prefillChecks: {},
    legacyQueryHandling: {},
    campaignLinkChecks: {},
    fileLinkChecks: {},
    overallPass: false
  };

  const browser = await chromium.launch({ headless: true });

  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: shot.viewport,
      isMobile: shot.mobile,
      hasTouch: shot.mobile
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        qa.consoleErrors.push({ page: shot.name, text: msg.text() });
      }
    });
    page.on('requestfailed', (req) => {
      qa.requestFailures.push({
        page: shot.name,
        url: req.url(),
        error: req.failure() ? req.failure().errorText : 'unknown'
      });
    });

    const response = await page.goto(base + shot.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(450);
    const fileName = `${shot.name}.png`;
    await page.screenshot({ path: path.join(outDir, fileName), fullPage: true });

    qa.screenshots.push(fileName);
    qa.routeStatus.push({
      page: shot.name,
      url: shot.url,
      status: response ? response.status() : null
    });

    await context.close();
  }

  // Mobile menu open/close behavior.
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

  // Start form integrity checks.
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
      const selectors = 'form[name="session-zero"] input, form[name="session-zero"] select, form[name="session-zero"] textarea';
      return Array.from(document.querySelectorAll(selectors))
        .filter((el) => !el.getAttribute('name') || !el.getAttribute('name').trim())
        .map((el) => el.outerHTML.slice(0, 140));
    });

    qa.formChecks = {
      formExists,
      method,
      dataNetlify,
      action,
      hiddenFormNameCount,
      fieldsWithoutNameCount: fieldsWithoutName.length,
      fieldsWithoutName,
      ok:
        formExists &&
        String(method || '').toUpperCase() === 'POST' &&
        dataNetlify === 'true' &&
        action === '/start/thanks/' &&
        hiddenFormNameCount > 0 &&
        fieldsWithoutName.length === 0
    };
    await context.close();
  }

  // Start prefill checks for all active campaign IDs.
  {
    const ids = [
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

    for (const id of ids) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
      const page = await context.newPage();
      await page.goto(`${base}/start/?campaign=${id}`, { waitUntil: 'domcontentloaded' });
      const selected = await page.locator('#campaign-interest').inputValue();
      qa.prefillChecks[id] = { selected, ok: selected === id };
      await context.close();
    }
  }

  // Legacy query handling checks.
  {
    // Aliases that should map to current IDs.
    const aliases = {
      drakkenheim: 'drakkenheim-tuesday',
      waterdeep: 'waterdeep-dragonheist-dotmm'
    };
    for (const [legacy, expected] of Object.entries(aliases)) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
      const page = await context.newPage();
      await page.goto(`${base}/start/?campaign=${legacy}`, { waitUntil: 'domcontentloaded' });
      const selected = await page.locator('#campaign-interest').inputValue();
      qa.legacyQueryHandling[legacy] = { selected, expected, ok: selected === expected };
      await context.close();
    }

    // Retired IDs should redirect to /campaigns/.
    for (const retired of ['fortune-wheel', 'out-of-the-abyss', 'city-of-shade']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
      const page = await context.newPage();
      await page.goto(`${base}/start/?campaign=${retired}`, { waitUntil: 'domcontentloaded' });
      const finalPath = new URL(page.url()).pathname;
      qa.legacyQueryHandling[retired] = {
        finalPath,
        expected: '/campaigns/',
        ok: finalPath === '/campaigns/'
      };
      await context.close();
    }
  }

  // Campaign CTA link checks on /campaigns/.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 2000 } });
    const page = await context.newPage();
    await page.goto(base + '/campaigns/', { waitUntil: 'domcontentloaded' });

    const expectedLinks = [
      '/start/?campaign=keep-on-the-borderlands',
      '/start/?campaign=drakkenheim-tuesday',
      '/start/?campaign=drakkenheim-friday',
      '/start/?campaign=thrones-of-the-djinni-lords',
      '/start/?campaign=eberron-black-lanterns',
      '/start/?campaign=vecna-eve-of-ruin',
      '/start/?campaign=avylan',
      '/start/?campaign=waterdeep-dragonheist-dotmm',
      '/start/?campaign=epic-quests',
      '/campaigns/keep-on-the-borderlands/',
      '/campaigns/drakkenheim/',
      '/campaigns/thrones-of-the-djinni-lords/',
      '/campaigns/eberron-black-lanterns/',
      '/campaigns/vecna-eve-of-ruin/',
      '/campaigns/avylan/',
      '/campaigns/waterdeep-dragonheist-dotmm/',
      '/campaigns/epic-quests/'
    ];

    for (const href of expectedLinks) {
      const count = await page.locator(`a[href="${href}"]`).count();
      qa.campaignLinkChecks[href] = { count, ok: count > 0 };
    }
    await context.close();
  }

  // File-level legacy route and link checks.
  {
    const netlifyToml = fs.readFileSync(path.join(process.cwd(), 'netlify.toml'), 'utf8');
    const requiredRedirects = [
      '/campaigns/city-of-shade/',
      '/campaigns/fortune-wheel/',
      '/campaigns/out-of-the-abyss/',
      '/campaigns/solo/',
      '/campaigns/private/',
      '/campaigns/waterdeep/'
    ];
    for (const from of requiredRedirects) {
      qa.fileLinkChecks[`redirect:${from}`] = { ok: netlifyToml.includes(`from = "${from}"`) };
    }

    const distStart = fs.readFileSync(path.join(process.cwd(), 'dist/start/index.html'), 'utf8');
    const requiredStartValues = [
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
    for (const id of requiredStartValues) {
      qa.fileLinkChecks[`startOption:${id}`] = { ok: distStart.includes(`value="${id}"`) };
    }
  }

  await browser.close();

  qa.overallPass =
    qa.routeStatus.every((r) => r.status === 200) &&
    qa.consoleErrors.length === 0 &&
    qa.requestFailures.length === 0 &&
    qa.menuCheck &&
    qa.menuCheck.ok &&
    qa.formChecks.ok &&
    Object.values(qa.prefillChecks).every((v) => v.ok) &&
    Object.values(qa.legacyQueryHandling).every((v) => v.ok) &&
    Object.values(qa.campaignLinkChecks).every((v) => v.ok) &&
    Object.values(qa.fileLinkChecks).every((v) => v.ok);

  fs.writeFileSync(path.join(outDir, 'qa-report.json'), JSON.stringify(qa, null, 2));
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({ generatedAt: qa.generatedAt, files: qa.screenshots.concat(['qa-report.json']) }, null, 2)
  );

  console.log('campaign alignment QA and screenshots complete');
})();

