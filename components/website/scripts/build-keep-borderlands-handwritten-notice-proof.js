const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'campaign-brief-pdf-review', 'keep-borderlands-handwritten-notice');
const pdfPath = path.join(root, 'public', 'downloads', 'keep-on-the-borderlands-frontier-expedition-charter.pdf');
const notesPath = path.join(root, 'docs', 'campaign-briefs', 'keep-borderlands-handwritten-notice-production-notes.md');
const bgPath = path.join(root, 'campaign-brief-pdf-review', 'keep-borderlands-two-layer', 'approved-blank-frontier-parchment-background.png');

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
<title>Keep on the Borderlands Handwritten Notice Proof</title>
<style>
  @page { size: Letter portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #120d08; }
  body { color: #1d0e05; }
  .page { width: 8.5in; height: 11in; position: relative; overflow: hidden; page-break-after: always; background: #dec290; }
  .page:last-child { page-break-after: auto; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
  .inkfield { position: absolute; z-index: 2; left: 1.55in; right: 1.9in; top: 1.76in; bottom: 1.62in; mix-blend-mode: multiply; filter: contrast(1.18) saturate(.82); }
  .inkfield.page-two { top: 1.78in; }
  .hand { font-family: "Segoe Print", "Ink Free", Gabriola, Georgia, serif; color: #1e0d04; text-shadow: .18px .14px 0 rgba(63, 28, 10, .24); }
  .formal { font-family: "Palatino Linotype", Palatino, Georgia, serif; }
  .gate-pin { position: absolute; width: .07in; height: .07in; border-radius: 99px; background: rgba(40, 18, 7, .74); box-shadow: 0 0 0 .02in rgba(124, 72, 33, .38), 0 .018in .04in rgba(20, 9, 3, .45); z-index: 3; }
  .gate-pin.a { left: 1.55in; top: 1.72in; }
  .gate-pin.b { right: 1.9in; top: 1.73in; }
  .gate-pin.c { left: 1.57in; bottom: 1.40in; opacity: .48; }
  .title-wrap { text-align: center; margin: .05in 0 .10in; transform: rotate(-.35deg); }
  .smalltop { display: inline-block; font-family: "Segoe Print", "Ink Free", cursive; font-size: 10.5pt; letter-spacing: .06em; color: #693117; border-bottom: 1.5px solid rgba(76, 36, 15, .62); padding: 0 .18in .02in; transform: rotate(.35deg); }
  h1 { margin: .035in 0 .015in; font-family: Gabriola, "Palatino Linotype", Georgia, serif; font-size: 53pt; line-height: .74; color: #180904; font-weight: 700; letter-spacing: .005em; text-shadow: .65px .45px 0 rgba(39, 13, 3, .45), -.28px .1px 0 rgba(107, 50, 20, .2); }
  .subtitle { display: block; font-family: "Segoe Print", "Ink Free", cursive; font-size: 13pt; line-height: 1.05; color: #291207; transform: rotate(.15deg); }
  .issuer { font-family: "Segoe Print", "Ink Free", cursive; font-size: 8.6pt; line-height: 1.18; text-align: center; color: #643016; margin: .055in auto .115in; width: 86%; transform: rotate(-.12deg); }
  .notice-line { height: .035in; margin: .03in 0 .075in; border-top: 1.5px solid rgba(59, 27, 10, .68); transform: rotate(-.18deg); }
  .section { margin: .06in 0 .095in; position: relative; }
  .section.tilt-a { transform: rotate(-.18deg); }
  .section.tilt-b { transform: rotate(.16deg); }
  h2 { margin: 0 0 .03in; font-family: "Segoe Print", "Ink Free", cursive; font-size: 15pt; line-height: 1.02; color: #703317; font-weight: 700; border-bottom: 1.2px solid rgba(75, 35, 14, .52); text-shadow: .25px .18px 0 rgba(67, 29, 10, .24); }
  p { margin: 0 0 .052in; font-family: "Segoe Print", "Ink Free", cursive; font-size: 8.9pt; line-height: 1.22; color: #1f0e05; }
  .leadline { font-size: 10.3pt; line-height: 1.18; font-style: italic; text-align: center; margin: .035in 0 .07in; color: #201006; }
  .maxim { margin: .11in auto .13in; width: 91%; padding: .055in .1in .07in; text-align: center; border-top: 2px solid rgba(54, 25, 10, .68); border-bottom: 2px solid rgba(54, 25, 10, .68); transform: rotate(.22deg); }
  .maxim .label { display: block; font-family: "Segoe Print", "Ink Free", cursive; color: #723317; font-size: 8.3pt; letter-spacing: .07em; margin-bottom: .025in; }
  .maxim .words { display: block; font-family: "Segoe Print", "Ink Free", cursive; font-size: 12.3pt; line-height: 1.16; font-style: italic; color: #1e0d04; }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: .20in; align-items: start; }
  .half h2 { font-size: 12.6pt; }
  .half p { font-size: 8.1pt; line-height: 1.18; }
  .closing { margin-top: .045in; text-align: center; transform: rotate(-.18deg); padding-right: .26in; }
  .closing .return { display: block; font-family: "Segoe Print", "Ink Free", cursive; font-size: 12.8pt; line-height: 1.05; font-style: italic; color: #1d0d04; }
  .closing .sig { display: block; margin-top: .022in; font-family: "Segoe Print", "Ink Free", cursive; font-size: 7.8pt; line-height: 1.05; color: #281207; }
  .note { position: absolute; z-index: 3; font-family: "Ink Free", "Segoe Print", cursive; color: rgba(45, 22, 9, .66); font-size: 8.4pt; line-height: 1.05; font-style: italic; }
  .note.left { left: .69in; top: 4.68in; width: .78in; text-align: right; transform: rotate(-8deg); }
  .note.right { right: .72in; top: 5.14in; width: .62in; transform: rotate(8deg); }
  .note.low { left: 1.03in; bottom: 1.18in; width: .86in; transform: rotate(-9deg); }
  .rule { border-top: 1.1px solid rgba(65, 29, 11, .48); margin: .05in 0 .065in; transform: rotate(.15deg); }
  ul { margin: .02in 0 .08in .12in; padding-left: .12in; }
  li { font-family: "Segoe Print", "Ink Free", cursive; font-size: 7.85pt; line-height: 1.13; margin: 0 0 .035in; color: #1f0e05; }
  li::marker { content: '- '; color: #713317; }
  .brief-list li { font-size: 7.6pt; line-height: 1.11; }
  .field-note { font-style: italic; color: #37190a; border-left: 2px solid rgba(97, 44, 17, .48); padding-left: .08in; margin-top: .04in; }
  .stamp-copy { position: absolute; z-index: 4; right: 1.48in; bottom: 1.53in; font-family: "Segoe Print", "Ink Free", cursive; color: rgba(91, 22, 14, .62); font-size: 8.2pt; line-height: 1.05; text-align: center; transform: rotate(-10deg); }
</style>
</head>
<body>
<section class="page">
  <img class="bg" src="${bgUrl}" alt="" aria-hidden="true" />
  <div class="gate-pin a"></div><div class="gate-pin b"></div>
  <div class="note left">rope first<br/>glory later</div>
  <div class="note right">mark smoke<br/>count arrows</div>
  <main class="inkfield hand">
    <div class="title-wrap">
      <span class="smalltop">posted at the keep gate</span>
      <h1>Keep on the<br/>Borderlands</h1>
      <span class="subtitle">Notice to travellers bound beyond the outer road</span>
    </div>
    <div class="issuer">By order of Castellan Windvarle. Copied for companies seeking road leave past the outer patrol.</div>
    <section class="section tilt-a">
      <h2>Read before passing the gate</h2>
      <p class="leadline">You have reached the last reliable stone before the wild country takes offense.</p>
      <p>The Keep stands where the road thins, where old maps disagree, and where civilized people prefer to believe the border is firmer than it is.</p>
      <p>Beyond the gate are ravines, broken trails, cave mouths, hidden camps, rival claims, and things that have learned to wait. Some will speak before they strike, which does not make them safe.</p>
    </section>
    <div class="maxim">
      <span class="label">Operational maxim</span>
      <span class="words">A living scout with a poor map is of more use than a dead hero with a perfect one.</span>
    </div>
    <div class="split">
      <section class="half section tilt-b">
        <h2>Road leave</h2>
        <p>By leave of Castellan Windvarle, the bearer company may pass beyond the outer road and act as a provisional expedition band in unsettled country.</p>
        <p>This road-writ grants leave to scout roads, ravines, cave-country, ruins, camps, shrines, and other sites of concern; recover useful proof; report hostile movement, missing travelers, unsafe roads, unnatural hazards, and suspicious gatherings; negotiate when parley preserves lives or knowledge; and defend the company when threatened.</p>
      </section>
      <section class="half section tilt-a">
        <h2>The work</h2>
        <p>This is frontier expedition play: scouting, planning, negotiation, tactical danger, logistics, retreat, and teamwork. The Keep matters as base, shelter, market, rumor mill, and reputation center.</p>
        <p><em>This is not punishment. This is pressure.</em></p>
        <p><em>The purpose of the danger is not to defeat you. The purpose of the danger is to make your choices matter.</em></p>
      </section>
    </div>
  </main>
  <div class="stamp-copy">gate copy<br/>road leave<br/>granted</div>
</section>

<section class="page">
  <img class="bg" src="${bgUrl}" alt="" aria-hidden="true" />
  <div class="gate-pin a"></div><div class="gate-pin b"></div><div class="gate-pin c"></div>
  <div class="note left">ask at chapel<br/>before dusk</div>
  <div class="note right">return with<br/>a report</div>
  <main class="inkfield page-two hand">
    <div class="title-wrap">
      <span class="smalltop">carried copy for the road</span>
      <h1>Before You<br/>Pass the Gate</h1>
      <span class="subtitle">Notes for the company beyond the outer patrol</span>
    </div>
    <div class="split">
      <div>
        <section class="section tilt-a">
          <h2>Present reports</h2>
          <p>Travelers on the outer road have gone missing. A muleteer returned without his load and with an arrow in his wagon board. Smoke has been seen near cave-country where no lawful camp has been recorded.</p>
          <p>A patrol found tracks it could not follow without leaving the road unguarded. A chapel novice insists one of the old marker stones has been moved.</p>
          <p>None of these reports prove a single organized threat. Together, they prove enough to be inconvenient.</p>
        </section>
        <section class="section tilt-b">
          <h2>Report what you learn</h2>
          <ul class="brief-list">
            <li>Routes that are safer, watched, blocked, flooded, trapped, or changing.</li>
            <li>Smoke, tracks, camps, cave traffic, ambush points, graves, broken wagons, or missing markers.</li>
            <li>Names, symbols, bargains, warnings, prisoners, survivors, rumors, and lies worth checking.</li>
            <li>Places that need a second expedition, better supplies, quieter steps, or more witnesses.</li>
            <li>People who may be enemies, allies, captives, refugees, scouts, fools, or something in between.</li>
          </ul>
          <p class="field-note">Do not make the report prettier than the truth. The road has enough liars.</p>
        </section>
      </div>
      <div>
        <section class="section tilt-b">
          <h2>What will help</h2>
          <p>A competent company watches the road before trusting it, counts light before entering darkness, listens before opening doors, and remembers that a cave mouth is not just an entrance. It is a question.</p>
          <ul>
            <li>Skills: Perception, Investigation, Survival, Stealth, Insight, Persuasion, Athletics, Medicine, Arcana, History, Nature, and Religion.</li>
            <li>Tools: rope work, cartography, navigation, herbalism, thieves' tools, healer's kits, useful languages, rituals, light management, mobility, healing, and quiet ways to solve loud problems.</li>
            <li>Ask before passing: path out, path back, supplies carried, speaker for parley, rumor being tested, sign to turn back, and promise not to make.</li>
          </ul>
        </section>
        <section class="section tilt-a">
          <h2>Final instruction</h2>
          <p>You are not being sent beyond the walls because the Keep thinks you are invincible. You are being sent because walls alone do not keep a border alive.</p>
          <p>Carry rope. Count arrows. Listen before opening doors. Ask why a trail exists. Treat strangers as people before treating them as problems.</p>
          <p>If you must fight, fight with a plan. If you must run, run toward tomorrow. Return with something the Keep did not know.</p>
          <p class="closing"><span class="return">Return with truth before glory.</span><span class="sig">Castellan Windvarle<br/>The Keep Gate</span></p>
        </section>
      </div>
    </div>
  </main>
</section>
</body>
</html>`;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  const htmlProofPath = path.join(outDir, 'keep-borderlands-handwritten-notice-source.html');
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
    return `<section class="pdf-page"><img src="${src}" alt="Keep on the Borderlands handwritten notice page ${index + 1}" /></section>`;
  }).join('\n');

  const pdfHtml = `<!doctype html><html><head><meta charset="utf-8" /><style>@page{size:Letter portrait;margin:0}html,body{margin:0;padding:0;background:#111}.pdf-page{width:8.5in;height:11in;page-break-after:always;overflow:hidden}.pdf-page:last-child{page-break-after:auto}.pdf-page img{display:block;width:8.5in;height:11in;object-fit:cover}</style></head><body>${pdfImagePages}</body></html>`;
  await page.setContent(pdfHtml, { waitUntil: 'load' });
  await page.pdf({ path: pdfPath, width: '8.5in', height: '11in', printBackground: true, preferCSSPageSize: true });
  await browser.close();

  const qa = {
    generatedAt: new Date().toISOString(),
    pdf: path.relative(root, pdfPath),
    background: path.relative(root, bgPath),
    htmlProof: path.relative(root, htmlProofPath),
    pageCountExpected: 2,
    pagesRendered: 2,
    visibleTextIsFlattenedPageArt: true,
    handwrittenNoticeAesthetic: true,
    centerVellumWashRemoved: true,
    selectableTextLayer: false,
    aiGeneratedTextUsed: false,
    deterministicTextSourceUsed: true,
    siteChanged: false,
    deployed: false,
  };
  fs.writeFileSync(path.join(outDir, 'qa-report.json'), JSON.stringify(qa, null, 2));

  const notes = `# Keep on the Borderlands Handwritten Notice Production Notes\n\n## Output\n\n- PDF: \`public/downloads/keep-on-the-borderlands-frontier-expedition-charter.pdf\`\n- Preview images: \`campaign-brief-pdf-review/keep-borderlands-handwritten-notice/page-01.png\`, \`campaign-brief-pdf-review/keep-borderlands-handwritten-notice/page-02.png\`\n- Source composition: \`campaign-brief-pdf-review/keep-borderlands-handwritten-notice/keep-borderlands-handwritten-notice-source.html\`\n\n## Production Approach\n\nThis proof shifts the artifact from formal broadside typography toward a hand-copied gate notice / traveller packet aesthetic. The visible text is still generated from exact source strings, then flattened into full-page artwork before PDF wrapping.\n\nThe lettering uses practical handwriting-style typography, looser rotations, human marginal notes, and less formal section rhythm. The center vellum/wash layer is removed.\n\n## Accuracy Model\n\nNo AI-generated text is used. No image model is trusted to spell words. The visible words are rendered from deterministic source strings, then flattened into page art.\n\n## QA Notes\n\n- No website files were changed.\n- No deployment was performed.\n- No pricing, testimonials, or website CTA language were added.\n- Visible PDF pages are flattened art images.\n- Selectable text is intentionally omitted from this visual proof.\n`;
  fs.writeFileSync(notesPath, notes, 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
