const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const base = 'http://127.0.0.1:4173';
  const qa = {};

  const browser = await chromium.launch({ headless: true });

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mpage = await mobile.newPage();
  await mpage.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const before = await mpage.getAttribute('[data-nav-toggle]', 'aria-expanded');
  await mpage.click('[data-nav-toggle]');
  const opened = await mpage.getAttribute('[data-nav-toggle]', 'aria-expanded');
  const navOpen = await mpage.$eval('[data-main-nav]', el => el.classList.contains('open'));
  await mpage.click('[data-nav-toggle]');
  const closed = await mpage.getAttribute('[data-nav-toggle]', 'aria-expanded');
  const navClosed = await mpage.$eval('[data-main-nav]', el => !el.classList.contains('open'));
  qa.menu = { before, opened, closed, navOpen, navClosed, ok: opened === 'true' && closed === 'false' && navOpen && navClosed };
  await mobile.close();

  qa.prefill = {};
  for (const c of ['drakkenheim', 'city-of-shade', 'waterdeep', 'fortune-wheel', 'out-of-the-abyss', 'solo', 'private-bespoke']) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${base}/start/?campaign=${c}`, { waitUntil: 'domcontentloaded' });
    const selected = await p.$eval('#campaign-interest', el => el.value);
    qa.prefill[c] = { selected, ok: selected === c };
    await ctx.close();
  }

  await browser.close();

  const campaignsHtml = fs.readFileSync('dist/campaigns/index.html', 'utf8');
  const requiredLinks = [
    '/start/?campaign=drakkenheim',
    '/start/?campaign=city-of-shade',
    '/start/?campaign=waterdeep',
    '/start/?campaign=fortune-wheel',
    '/start/?campaign=out-of-the-abyss',
    '/start/?campaign=solo',
    '/start/?campaign=private-bespoke'
  ];
  qa.campaignLinks = Object.fromEntries(requiredLinks.map(link => [link, { ok: campaignsHtml.includes(`href="${link}"`) }]));

  const startHtml = fs.readFileSync('start/index.html', 'utf8');
  const distStartHtml = fs.readFileSync('dist/start/index.html', 'utf8');
  const combined = `${startHtml}\n${distStartHtml}`;

  const formTagOk = /<form[^>]*name="session-zero"[^>]*method="POST"[^>]*data-netlify="true"[^>]*action="\/start\/thanks\/"/i.test(startHtml);
  const hiddenFormNameOk = /<input[^>]*type="hidden"[^>]*name="form-name"[^>]*value="session-zero"/i.test(startHtml);

  function fieldsWithoutName(html) {
    const fields = html.match(/<(input|select|textarea)\b[^>]*>/gi) || [];
    return fields.filter(tag => !/\bname\s*=\s*"[^"]+"/i.test(tag));
  }

  qa.form = {
    formTagOk,
    hiddenFormNameOk,
    localFieldsWithoutNameCount: fieldsWithoutName(startHtml).length,
    distFieldsWithoutNameCount: fieldsWithoutName(distStartHtml).length,
    ok: formTagOk && hiddenFormNameOk && fieldsWithoutName(startHtml).length === 0 && fieldsWithoutName(distStartHtml).length === 0
  };

  qa.overallOk = qa.menu.ok && Object.values(qa.prefill).every(v => v.ok) && Object.values(qa.campaignLinks).every(v => v.ok) && qa.form.ok;

  fs.writeFileSync('final-launch-screenshot-packet/qa-report.json', JSON.stringify(qa, null, 2));
  console.log('qa checks complete');
})();
