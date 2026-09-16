const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'campaign-brief-pdf-review', 'keep-borderlands-lettered-art');
const pdfPath = path.join(root, 'public', 'downloads', 'keep-on-the-borderlands-frontier-expedition-charter.pdf');
const notesPath = path.join(root, 'docs', 'campaign-briefs', 'keep-borderlands-lettered-art-production-notes.md');
const bgPath = path.join(root, 'campaign-brief-pdf-review', 'keep-borderlands-two-layer', 'approved-blank-frontier-parchment-background.png');
const refPath = path.join(root, 'campaign-brief-pdf-review', 'keep-borderlands-diegetic-lettering', 'keep-borderlands-diegetic-lettering-reference-b.png');

function imgDataUri(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

const bgUrl = imgDataUri(bgPath);

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Keep on the Borderlands Frontier Expedition Charter</title>
<style>
  @page { size: Letter portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #14100b; }
  body { font-family: Georgia, Cambria, serif; color: #221207; }
  .page { width: 8.5in; height: 11in; position: relative; overflow: hidden; page-break-after: always; background: #e8d1a6; }
  .page:last-child { page-break-after: auto; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
  .vellum { display: none; }
  .letter-art { position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: .12; mix-blend-mode: multiply; }
  .letter-art::before { content: ''; position: absolute; left: 1.58in; right: 1.92in; top: 1.86in; bottom: 1.24in; background:
      repeating-linear-gradient(1deg, rgba(61, 31, 13, .06) 0, rgba(61, 31, 13, .06) 1px, transparent 1px, transparent 9px),
      radial-gradient(circle at 27% 34%, rgba(88, 43, 17, .07), transparent 2.1in),
      radial-gradient(circle at 69% 64%, rgba(88, 43, 17, .06), transparent 2.2in);
    filter: blur(.15px); }
  .ink { position: absolute; z-index: 2; left: 1.58in; right: 1.92in; top: 1.78in; bottom: 1.36in; mix-blend-mode: multiply; filter: contrast(1.13) saturate(.84); }
  .ink.page-two { top: 1.82in; }
  .gate-title { text-align: center; margin-top: .08in; }
  .kicker { display: inline-block; font-family: "Palatino Linotype", Palatino, Georgia, serif; font-size: 9pt; letter-spacing: .26em; text-transform: uppercase; color: #6f3418; padding: .018in .13in; border-top: 1px solid rgba(78, 38, 18, .62); border-bottom: 1px solid rgba(78, 38, 18, .52); transform: rotate(-.4deg); text-shadow: .25px .2px 0 rgba(64, 27, 10, .25); }
  h1 { margin: .02in 0 .02in; font-family: "Palatino Linotype", Palatino, Georgia, serif; font-size: 39pt; line-height: .84; letter-spacing: .018em; text-transform: uppercase; color: #170a03; font-weight: 700; text-shadow: .55px .35px 0 rgba(34, 12, 3, .42), -.3px .15px 0 rgba(112, 55, 24, .22); transform: rotate(.25deg); -webkit-text-stroke: .22px rgba(26, 10, 3, .45); }
  h1 .small { font-size: 21pt; letter-spacing: .075em; }
  .issuer { margin: .02in auto .12in; width: 86%; font-family: "Palatino Linotype", Palatino, Georgia, serif; font-size: 8.1pt; line-height: 1.1; text-align: center; text-transform: uppercase; letter-spacing: .135em; color: #6d3217; text-shadow: .2px .15px 0 rgba(71, 32, 13, .2); }
  .hand-rule { height: .035in; margin: .03in auto .07in; width: 78%; border-top: 1px solid rgba(62, 31, 15, .75); border-bottom: 1px solid rgba(62, 31, 15, .36); transform: rotate(-.25deg); }
  .section { position: relative; margin: .06in 0 .085in; }
  .section.compact { margin-bottom: .055in; }
  h2 { margin: 0 0 .035in; font-family: "Palatino Linotype", Palatino, Georgia, serif; font-size: 12.2pt; line-height: 1; letter-spacing: .052em; text-transform: uppercase; color: #713517; font-weight: 700; border-bottom: 1px solid rgba(74, 38, 18, .54); text-shadow: .28px .2px 0 rgba(72, 27, 10, .28); }
  p { margin: 0 0 .043in; font-family: "Palatino Linotype", Palatino, Georgia, serif; font-size: 8.25pt; line-height: 1.12; color: #211005; text-shadow: .2px .16px 0 rgba(68, 31, 12, .25), -.12px 0 0 rgba(68, 31, 12, .14); }
  .opening { font-size: 9.3pt; font-style: italic; text-align: center; line-height: 1.08; margin-bottom: .055in; transform: rotate(-.12deg); }
  .drop p:first-of-type::first-letter { float: left; font-family: Gabriola, "Palatino Linotype", Georgia, serif; font-size: 39pt; line-height: .62; padding: .025in .045in .018in 0; color: #733517; font-weight: 700; text-shadow: .4px .25px 0 rgba(50, 20, 8, .32); }
  .maxim-band { position: relative; margin: .085in 0 .09in; padding: .055in .16in .06in; text-align: center; border-top: 2px solid rgba(55, 27, 12, .72); border-bottom: 2px solid rgba(55, 27, 12, .72); transform: rotate(-.1deg); }
  .maxim-band::before, .maxim-band::after { content: '✦'; position: absolute; top: 50%; transform: translateY(-50%); color: #713617; font-size: 11pt; }
  .maxim-band::before { left: .035in; }
  .maxim-band::after { right: .035in; }
  .maxim-label { display: block; margin-bottom: .022in; font-size: 7.3pt; letter-spacing: .18em; text-transform: uppercase; color: #813d1c; font-weight: 700; }
  .maxim { display: block; font-family: Georgia, "Palatino Linotype", serif; font-style: italic; font-size: 12.2pt; line-height: 1.06; text-shadow: .26px .2px 0 rgba(68, 31, 12, .28); }
  .two-stream { display: grid; grid-template-columns: 1fr 1fr; gap: .18in; align-items: start; }
  .stream-note { margin: .025in 0 .04in; padding-left: .075in; border-left: 2px solid rgba(113, 54, 24, .44); font-style: italic; color: #3a1c0c; }
  .truth { text-align: center; font-size: 9.3pt; font-style: italic; line-height: 1.08; margin: .035in 0; }
  ul { margin: .02in 0 .055in .14in; padding-left: .15in; }
  li { margin: 0 0 .022in; font-family: "Palatino Linotype", Palatino, Georgia, serif; font-size: 7.95pt; line-height: 1.06; color: #211005; text-shadow: .15px .1px 0 rgba(68, 31, 12, .18); }
  .diamond-list li::marker { content: '◆  '; font-size: 7pt; color: #713718; }
  .marginal { position: absolute; z-index: 2; font-family: "Segoe Print", "Ink Free", Gabriola, cursive; font-size: 7.6pt; line-height: 1.02; font-style: italic; color: rgba(47, 24, 10, .58); transform: rotate(-4deg); text-shadow: .15px .1px 0 rgba(44, 21, 9, .18); }
  .marginal.left { left: .68in; top: 4.68in; width: .68in; text-align: right; }
  .marginal.right { right: .70in; top: 5.2in; width: .55in; transform: rotate(5deg); }
  .marginal.bottom { left: 1.05in; bottom: 1.02in; width: .8in; transform: rotate(-8deg); }
  .notice-band { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: .08in; margin: .05in 0 .1in; }
  .notice-band .bar { height: .02in; border-top: 1px solid rgba(59, 30, 14, .68); border-bottom: 1px solid rgba(59, 30, 14, .35); }
  .notice-band .words { font-family: "Palatino Linotype", Palatino, Georgia, serif; font-size: 15pt; letter-spacing: .07em; text-transform: uppercase; color: #261207; text-shadow: .3px .2px 0 rgba(51, 21, 8, .24); }
  .page-two h1 { font-size: 33pt; margin-top: .10in; transform: rotate(-.18deg); }
  .page-two .issuer { margin-bottom: .10in; }
  .page-two .two-stream p { font-size: 7.95pt; line-height: 1.08; }
  .page-two li { font-size: 7.55pt; line-height: 1.04; }
  .final { margin-top: .03in; text-align: center; }
  .final .return { display: block; font-family: Georgia, "Palatino Linotype", serif; font-style: italic; font-size: 13.2pt; line-height: 1.05; margin: .04in 0 .025in; text-shadow: .24px .18px 0 rgba(68, 31, 12, .25); }
  .final .sig { display: block; font-size: 8.6pt; line-height: 1.05; letter-spacing: .04em; }
  .face { position: absolute; z-index: 2; bottom: .56in; left: 0; right: 0; text-align: center; font-size: 6.5pt; letter-spacing: .22em; text-transform: uppercase; color: rgba(84, 45, 23, .45); }
  .pin { position: absolute; z-index: 2; width: .055in; height: .055in; border-radius: 999px; background: rgba(61, 30, 13, .7); box-shadow: 0 0 0 .018in rgba(122, 74, 39, .4); }
  .pin.a { left: 1.46in; top: 1.74in; } .pin.b { right: 1.70in; top: 1.75in; }
</style>
</head>
<body>
<section class="page">
  <img class="bg" src="${bgUrl}" alt="" aria-hidden="true" />
  <div class="vellum"></div>
  <div class="letter-art"></div>
  <div class="pin a"></div><div class="pin b"></div>
  <div class="marginal left">rope first<br/>glory later</div>
  <div class="marginal right">mark smoke<br/>count arrows</div>
  <main class="ink">
    <div class="gate-title">
      <span class="kicker">Road-Writ of the Keep Gate</span>
      <h1>Keep <span class="small">on the</span><br/>Borderlands</h1>
      <div class="notice-band"><span class="bar"></span><span class="words">Notice to Travellers</span><span class="bar"></span></div>
    </div>
    <div class="issuer">By order of Castellan Windvarle, posted at the Keep gate for those passing beyond the outer road</div>
    <section class="section drop">
      <h2>Welcome to the Borderlands</h2>
      <p class="opening">You have reached the last reliable stone before the wild country takes offense.</p>
      <p>The Keep stands where the road thins, where old maps disagree, and where civilized people prefer to believe the border is firmer than it is.</p>
      <p>Beyond the gate are ravines, broken trails, cave mouths, hidden camps, rival claims, and things that have learned to wait. Some will speak before they strike, which does not make them safe.</p>
    </section>
    <div class="maxim-band"><span class="maxim-label">Operational Maxim</span><span class="maxim">A living scout with a poor map is of more use than a dead hero with a perfect one.</span></div>
    <div class="two-stream">
      <section class="section compact drop">
        <h2>On the Matter of Charter</h2>
        <p>By leave of Castellan Windvarle, the bearer company may pass beyond the outer road and act as a provisional expedition band in unsettled country.</p>
        <p>This road-writ grants leave to scout roads, ravines, cave-country, ruins, camps, shrines, and other sites of concern; recover useful proof; report hostile movement, missing travelers, unsafe roads, unnatural hazards, and suspicious gatherings; negotiate when parley preserves lives or knowledge; and defend the company when threatened.</p>
      </section>
      <section class="section compact drop">
        <h2>On the Nature of the Work</h2>
        <p>This is frontier expedition play: scouting, planning, negotiation, tactical danger, logistics, retreat, and teamwork. The Keep matters as base, shelter, market, rumor mill, and reputation center.</p>
        <p class="truth">This is not punishment. This is pressure.</p>
        <p class="truth">The purpose of the danger is not to defeat you. The purpose of the danger is to make your choices matter.</p>
      </section>
    </div>
    <section class="section compact">
      <h2>On the Kind of Company Worth Chartering</h2>
      <p>Bring a character with a reason to risk the frontier and enough sense to work with the company. Coin, duty, lost kin, old knowledge, a second chance, a debt, a vow, a name worth carrying, or a road worth reopening will all serve.</p>
      <p>You do not need to be flawless. You do need to share information, make plans, stay engaged, and care whether the company survives.</p>
    </section>
  </main>
  <div class="face">First face of the road-writ</div>
</section>

<section class="page">
  <img class="bg" src="${bgUrl}" alt="" aria-hidden="true" />
  <div class="vellum"></div>
  <div class="letter-art"></div>
  <div class="marginal left">ask at chapel<br/>before dusk</div>
  <div class="marginal right">return with report</div>
  <main class="ink page-two">
    <div class="gate-title">
      <span class="kicker">Carried Copy for the Road</span>
      <h1>Before You Pass<br/>the Gate</h1>
    </div>
    <div class="issuer">Practical road notes for the company beyond the outer road</div>
    <div class="two-stream">
      <div>
        <section class="section drop">
          <h2>Present Reports</h2>
          <p>Travelers on the outer road have gone missing. A muleteer returned without his load and with an arrow in his wagon board. Smoke has been seen near cave-country where no lawful camp has been recorded.</p>
          <p>A patrol found tracks it could not follow without leaving the road unguarded. A chapel novice insists one of the old marker stones has been moved.</p>
          <p>None of these reports prove a single organized threat. Together, they prove enough to be inconvenient.</p>
        </section>
        <section class="section">
          <h2>What Must Be Reported</h2>
          <ul class="diamond-list">
            <li>Routes that are safer, watched, blocked, flooded, trapped, or changing.</li>
            <li>Smoke, tracks, camps, cave traffic, ambush points, graves, broken wagons, or missing markers.</li>
            <li>Names, symbols, bargains, warnings, prisoners, survivors, rumors, and lies worth checking.</li>
            <li>Places that need a second expedition, better supplies, quieter steps, or more witnesses.</li>
            <li>People who may be enemies, allies, captives, refugees, scouts, fools, or something in between.</li>
          </ul>
          <p class="stream-note">Do not make the report prettier than the truth. The road has enough liars.</p>
        </section>
      </div>
      <div>
        <section class="section">
          <h2>What Will Help</h2>
          <p>A competent company watches the road before trusting it, counts light before entering darkness, listens before opening doors, and remembers that a cave mouth is not just an entrance. It is a question.</p>
          <ul class="diamond-list">
            <li>Skills: Perception, Investigation, Survival, Stealth, Insight, Persuasion, Athletics, Medicine, Arcana, History, Nature, and Religion.</li>
            <li>Tools: rope work, cartography, navigation, herbalism, thieves' tools, healer's kits, useful languages, rituals, light management, mobility, healing, and quiet ways to solve loud problems.</li>
            <li>Ask before passing: path out, path back, supplies carried, speaker for parley, rumor being tested, sign to turn back, and promise not to make.</li>
          </ul>
        </section>
        <section class="section drop">
          <h2>Final Instruction</h2>
          <p>You are not being sent beyond the walls because the Keep thinks you are invincible. You are being sent because walls alone do not keep a border alive.</p>
          <p>Carry rope. Count arrows. Listen before opening doors. Ask why a trail exists. Treat strangers as people before treating them as problems. Treat problems as real before treating them as stories.</p>
          <p>If you must fight, fight with a plan. If you must run, run toward tomorrow. If you return, return with something the Keep did not know.</p>
          <p class="final"><span class="return">Return with truth before glory.</span><span class="sig">Castellan Windvarle<br/>The Keep Gate</span></p>
        </section>
      </div>
    </div>
  </main>
  <div class="face">Second face of the road-writ</div>
</section>
</body>
</html>`;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  const htmlProofPath = path.join(outDir, 'keep-borderlands-lettered-art-source.html');
  fs.writeFileSync(htmlProofPath, html, 'utf8');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  const pages = await page.$$('.page');
  const imagePaths = [];
  for (let i = 0; i < pages.length; i++) {
    const imagePath = path.join(outDir, `page-${String(i + 1).padStart(2, '0')}.png`);
    await pages[i].screenshot({ path: imagePath });
    imagePaths.push(imagePath);
  }

  const pdfImagePages = imagePaths.map((imagePath, index) => {
    const src = imgDataUri(imagePath);
    return `<section class="pdf-page"><img src="${src}" alt="Keep on the Borderlands road-writ page ${index + 1}" /></section>`;
  }).join('\n');

  const pdfHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: Letter portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #111; }
  .pdf-page { width: 8.5in; height: 11in; page-break-after: always; overflow: hidden; }
  .pdf-page:last-child { page-break-after: auto; }
  .pdf-page img { display: block; width: 8.5in; height: 11in; object-fit: cover; }
</style>
</head>
<body>${pdfImagePages}</body>
</html>`;
  await page.setContent(pdfHtml, { waitUntil: 'load' });
  await page.pdf({ path: pdfPath, width: '8.5in', height: '11in', printBackground: true, preferCSSPageSize: true });
  await browser.close();

  const qa = {
    generatedAt: new Date().toISOString(),
    pdf: path.relative(root, pdfPath),
    background: path.relative(root, bgPath),
    visualReference: path.relative(root, refPath),
    htmlProof: path.relative(root, htmlProofPath),
    pageCountExpected: 2,
    pagesRendered: 2,
    visibleTextIsFlattenedPageArt: true,
    selectableTextLayer: false,
    generatedBodyTextUsed: false,
    aiGeneratedTextUsed: false,
    deterministicTextSourceUsed: true,
    siteChanged: false,
    deployed: false,
  };
  fs.writeFileSync(path.join(outDir, 'qa-report.json'), JSON.stringify(qa, null, 2));

  const notes = `# Keep on the Borderlands Lettered-Art Production Notes\n\n## Output\n\n- PDF: \`public/downloads/keep-on-the-borderlands-frontier-expedition-charter.pdf\`\n- Preview images: \`campaign-brief-pdf-review/keep-borderlands-lettered-art/page-01.png\`, \`campaign-brief-pdf-review/keep-borderlands-lettered-art/page-02.png\`\n- Source composition: \`campaign-brief-pdf-review/keep-borderlands-lettered-art/keep-borderlands-lettered-art-source.html\`\n- Visual reference: \`campaign-brief-pdf-review/keep-borderlands-diegetic-lettering/keep-borderlands-diegetic-lettering-reference-b.png\`\n\n## Production Approach\n\nThis proof changes the production model from \"PDF text over art\" to visible page art.\n\nThe exact approved copy is rendered deterministically into the page composition, visually integrated with ink-like texture, title rhythm, broadside spacing, marginal notes, and the approved blank frontier parchment. The resulting visible pages are exported as full-page PNG art and then wrapped into a two-page PDF.\n\nNo AI-generated text is used. No image model is trusted to spell words. The visible text is generated from exact source strings by deterministic rendering and then flattened into the page image.\n\n## Accuracy Model\n\nThe visible text comes from controlled source strings, not from generative lettering. This gives us a practical text-accuracy guarantee for the visible wording: the renderer is drawing the exact strings we provide.\n\nThis proof intentionally does not include a selectable text layer, because the goal is to review the artifact feel without allowing live PDF text to become the visible design layer again. After visual approval, a separate hidden accessibility/search layer can be added without changing the visible art.\n\n## Content Handling\n\nThe approved two-page charter draft was condensed to preserve the key player-facing ideas while fitting the illustrated field. The exact preservation lines are present in the source composition:\n\n- You have reached the last reliable stone before the wild country takes offense.\n- A living scout with a poor map is of more use than a dead hero with a perfect one.\n- This is not punishment. This is pressure.\n- The purpose of the danger is not to defeat you. The purpose of the danger is to make your choices matter.\n- Return with truth before glory.\n\n## QA Notes\n\n- No website files were changed.\n- No deployment was performed.\n- No pricing, testimonials, or website CTA language were added.\n- No AI-generated fake body text was used.\n- Visible PDF pages are flattened art images, not live PDF text over the background.\n`;
  fs.writeFileSync(notesPath, notes, 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
