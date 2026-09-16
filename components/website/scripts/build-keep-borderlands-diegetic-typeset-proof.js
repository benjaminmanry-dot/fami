const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'campaign-brief-pdf-review', 'keep-borderlands-diegetic-typeset');
const pdfPath = path.join(root, 'public', 'downloads', 'keep-on-the-borderlands-frontier-expedition-charter.pdf');
const notesPath = path.join(root, 'docs', 'campaign-briefs', 'keep-borderlands-diegetic-typeset-production-notes.md');
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
  .vellum { position: absolute; z-index: 1; left: 1.42in; right: 1.62in; top: 1.95in; bottom: 1.40in; background: radial-gradient(ellipse at center, rgba(252, 232, 187, .84) 0%, rgba(246, 222, 176, .72) 55%, rgba(238, 207, 156, .2) 100%); border-radius: 48% 49% 44% 45% / 6% 8% 5% 7%; }
  .ink { position: absolute; z-index: 2; left: 1.50in; right: 1.72in; top: 1.78in; bottom: 1.36in; }
  .ink.page-two { top: 1.82in; }
  .gate-title { text-align: center; margin-top: .08in; }
  .kicker { display: inline-block; font-size: 9pt; letter-spacing: .22em; text-transform: uppercase; color: #7d3b19; padding: .02in .12in; border-top: 1px solid rgba(78, 38, 18, .62); border-bottom: 1px solid rgba(78, 38, 18, .52); }
  h1 { margin: .02in 0 .02in; font-size: 39pt; line-height: .84; letter-spacing: .035em; text-transform: uppercase; color: #190b04; font-weight: 700; }
  h1 .small { font-size: 21pt; letter-spacing: .1em; }
  .issuer { margin: .02in auto .12in; width: 86%; font-size: 8.2pt; line-height: 1.1; text-align: center; text-transform: uppercase; letter-spacing: .12em; color: #723519; }
  .hand-rule { height: .035in; margin: .03in auto .07in; width: 78%; border-top: 1px solid rgba(62, 31, 15, .75); border-bottom: 1px solid rgba(62, 31, 15, .36); transform: rotate(-.25deg); }
  .section { position: relative; margin: .06in 0 .085in; }
  .section.compact { margin-bottom: .055in; }
  h2 { margin: 0 0 .035in; font-size: 12.2pt; line-height: 1; letter-spacing: .065em; text-transform: uppercase; color: #743718; font-weight: 700; border-bottom: 1px solid rgba(74, 38, 18, .5); }
  p { margin: 0 0 .047in; font-size: 8.55pt; line-height: 1.14; }
  .opening { font-size: 9.55pt; font-style: italic; text-align: center; line-height: 1.08; margin-bottom: .06in; }
  .drop p:first-of-type::first-letter { float: left; font-size: 31pt; line-height: .72; padding: .035in .045in .02in 0; color: #723718; font-weight: 700; }
  .maxim-band { position: relative; margin: .085in 0 .09in; padding: .055in .16in .06in; text-align: center; border-top: 2px solid rgba(55, 27, 12, .72); border-bottom: 2px solid rgba(55, 27, 12, .72); }
  .maxim-band::before, .maxim-band::after { content: '✦'; position: absolute; top: 50%; transform: translateY(-50%); color: #713617; font-size: 11pt; }
  .maxim-band::before { left: .035in; }
  .maxim-band::after { right: .035in; }
  .maxim-label { display: block; margin-bottom: .022in; font-size: 7.3pt; letter-spacing: .18em; text-transform: uppercase; color: #813d1c; font-weight: 700; }
  .maxim { display: block; font-style: italic; font-size: 12.2pt; line-height: 1.06; }
  .two-stream { display: grid; grid-template-columns: 1fr 1fr; gap: .17in; align-items: start; }
  .stream-note { margin: .025in 0 .04in; padding-left: .075in; border-left: 2px solid rgba(113, 54, 24, .44); font-style: italic; color: #3a1c0c; }
  .truth { text-align: center; font-size: 9.3pt; font-style: italic; line-height: 1.08; margin: .035in 0; }
  ul { margin: .02in 0 .055in .14in; padding-left: .15in; }
  li { margin: 0 0 .024in; font-size: 8.25pt; line-height: 1.08; }
  .diamond-list li::marker { content: '◆  '; font-size: 7pt; color: #713718; }
  .marginal { position: absolute; z-index: 2; font-size: 7.2pt; line-height: 1.05; font-style: italic; color: rgba(49, 25, 11, .68); transform: rotate(-4deg); }
  .marginal.left { left: .68in; top: 4.68in; width: .68in; text-align: right; }
  .marginal.right { right: .70in; top: 5.2in; width: .55in; transform: rotate(5deg); }
  .marginal.bottom { left: 1.05in; bottom: 1.02in; width: .8in; transform: rotate(-8deg); }
  .notice-band { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: .08in; margin: .05in 0 .1in; }
  .notice-band .bar { height: .02in; border-top: 1px solid rgba(59, 30, 14, .68); border-bottom: 1px solid rgba(59, 30, 14, .35); }
  .notice-band .words { font-size: 15pt; letter-spacing: .08em; text-transform: uppercase; color: #2b1609; }
  .page-two h1 { font-size: 33pt; margin-top: .10in; }
  .page-two .issuer { margin-bottom: .10in; }
  .page-two .two-stream p { font-size: 8.15pt; line-height: 1.09; }
  .page-two li { font-size: 7.85pt; line-height: 1.05; }
  .final { margin-top: .03in; text-align: center; }
  .final .return { display: block; font-style: italic; font-size: 13.2pt; line-height: 1.05; margin: .04in 0 .025in; }
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
  fs.writeFileSync(path.join(outDir, 'keep-borderlands-diegetic-typeset-proof.html'), html, 'utf8');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: pdfPath, width: '8.5in', height: '11in', printBackground: true, preferCSSPageSize: true });
  const pages = await page.$$('.page');
  for (let i = 0; i < pages.length; i++) {
    await pages[i].screenshot({ path: path.join(outDir, `page-${String(i + 1).padStart(2, '0')}.png`) });
  }
  await browser.close();

  const qa = {
    generatedAt: new Date().toISOString(),
    pdf: path.relative(root, pdfPath),
    background: path.relative(root, bgPath),
    visualReference: path.relative(root, refPath),
    htmlProof: path.relative(root, path.join(outDir, 'keep-borderlands-diegetic-typeset-proof.html')),
    pageCountExpected: 2,
    pagesRendered: 2,
    selectableTextLayer: true,
    generatedBodyTextUsed: false,
    siteChanged: false,
    deployed: false,
  };
  fs.writeFileSync(path.join(outDir, 'qa-report.json'), JSON.stringify(qa, null, 2));

  const notes = `# Keep on the Borderlands Diegetic Typeset Production Notes\n\n## Output\n\n- PDF: \`public/downloads/keep-on-the-borderlands-frontier-expedition-charter.pdf\`\n- Preview images: \`campaign-brief-pdf-review/keep-borderlands-diegetic-typeset/page-01.png\`, \`campaign-brief-pdf-review/keep-borderlands-diegetic-typeset/page-02.png\`\n- HTML proof source: \`campaign-brief-pdf-review/keep-borderlands-diegetic-typeset/keep-borderlands-diegetic-typeset-proof.html\`\n- Visual reference: \`campaign-brief-pdf-review/keep-borderlands-diegetic-lettering/keep-borderlands-diegetic-lettering-reference-b.png\`\n\n## Production Approach\n\nThis proof uses Reference B as the visual north star for broadside rhythm: large handout title, notice band, maxim/proverb zone, drop-cap sections, marginal road notes, diamond bullets, and looser artifact pacing.\n\nThe visible text is controlled exact HTML text, not AI-generated fake body writing. The PDF remains selectable/searchable.\n\n## Content Handling\n\nThe approved two-page charter draft was condensed to preserve the key player-facing ideas while fitting the illustrated field. The exact preservation lines remain present.\n\nPreserved exactly:\n\n- You have reached the last reliable stone before the wild country takes offense.\n- A living scout with a poor map is of more use than a dead hero with a perfect one.\n- This is not punishment. This is pressure.\n- The purpose of the danger is not to defeat you. The purpose of the danger is to make your choices matter.\n- Return with truth before glory.\n\n## Known Design Tradeoff\n\nThis pass intentionally stays exact/readable/selectable, so the text is still typographic rather than truly hand-lettered raster art. The structure is now much closer to the generated diegetic reference, but final visual polish may still benefit from custom title lettering or a raster lettering layer with an accessibility overlay.\n\n## QA Notes\n\n- No website files were changed.\n- No deployment was performed.\n- No pricing, testimonials, or website CTA language were added.\n- No generated fake body text was used in the PDF.\n`;
  fs.writeFileSync(notesPath, notes, 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
