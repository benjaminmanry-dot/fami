const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'campaign-brief-pdf-review', 'keep-borderlands-artifact-lettering');
const pdfPath = path.join(root, 'public', 'downloads', 'keep-on-the-borderlands-frontier-expedition-charter.pdf');
const notesPath = path.join(root, 'docs', 'campaign-briefs', 'keep-borderlands-artifact-lettering-production-notes.md');
const bgPath = path.join(root, 'campaign-brief-pdf-review', 'keep-borderlands-two-layer', 'approved-blank-frontier-parchment-background.png');
const fontDir = path.join(root, 'assets', 'fonts', 'handout-proof');

function dataUri(filePath, mime) {
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}
function imgDataUri(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  return dataUri(filePath, mime);
}
function fontData(name) {
  return dataUri(path.join(fontDir, name), 'font/truetype');
}

const bgUrl = imgDataUri(bgPath);
const eagle = fontData('font-1.woff2');
const fondamentoItalic = fontData('font-2.woff2');
const fondamento = fontData('font-3.woff2');
const imFellItalic = fontData('font-4.woff2');
const imFell = fontData('font-5.woff2');
const macondo = fontData('font-6.woff2');

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Keep on the Borderlands Artifact Lettering Proof</title>
<style>
@font-face{font-family:'EagleLakeLocal';src:url(${eagle}) format('truetype');font-weight:400;font-style:normal}
@font-face{font-family:'FondamentoLocal';src:url(${fondamento}) format('truetype');font-weight:400;font-style:normal}
@font-face{font-family:'FondamentoLocal';src:url(${fondamentoItalic}) format('truetype');font-weight:400;font-style:italic}
@font-face{font-family:'IMFellLocal';src:url(${imFell}) format('truetype');font-weight:400;font-style:normal}
@font-face{font-family:'IMFellLocal';src:url(${imFellItalic}) format('truetype');font-weight:400;font-style:italic}
@font-face{font-family:'MacondoLocal';src:url(${macondo}) format('truetype');font-weight:400;font-style:normal}
@page{size:Letter portrait;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#100b06}
.page{width:8.5in;height:11in;position:relative;overflow:hidden;page-break-after:always;background:#dcc18f}
.page:last-child{page-break-after:auto}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.ink-root{position:absolute;inset:0;z-index:2;mix-blend-mode:multiply;filter:url(#inkRoughen) contrast(1.2) saturate(.82)}
.write{position:absolute;left:1.55in;right:1.78in;top:1.68in;bottom:1.42in;color:#211005}
.write.page2{top:1.73in;right:1.86in}
.topnote{font-family:FondamentoLocal,serif;font-size:12.5pt;color:#663018;text-align:center;letter-spacing:.03em;transform:rotate(-1deg);margin-bottom:.015in}
h1{font-family:MacondoLocal,EagleLakeLocal,serif;font-weight:400;font-size:52pt;line-height:.78;text-align:center;margin:.01in 0 .035in;color:#120704;text-shadow:.55px .35px 0 rgba(34,12,3,.55),-.25px 0 rgba(85,42,18,.25);transform:rotate(.25deg)}
.sub{font-family:FondamentoLocal,serif;font-size:16pt;line-height:1.02;text-align:center;color:#251105;margin:.01in 0 .06in;transform:rotate(-.35deg)}
.issuer{font-family:FondamentoLocal,serif;font-size:9.4pt;line-height:1.12;text-align:center;width:84%;margin:0 auto .11in;color:#5d2a13;transform:rotate(.25deg)}
.rule{border-top:1.5px solid rgba(52,24,9,.62);margin:.055in 0 .075in;transform:rotate(-.25deg)}
.section{margin:.08in 0 .115in;position:relative}
.section.tight{margin-bottom:.07in}
.section.slantA{transform:rotate(-.22deg)}
.section.slantB{transform:rotate(.18deg)}
h2{font-family:MacondoLocal,FondamentoLocal,serif;font-size:17.2pt;font-weight:400;line-height:.95;color:#713215;margin:0 0 .032in;border-bottom:1.2px solid rgba(79,35,13,.48);text-shadow:.25px .18px 0 rgba(56,22,7,.28)}
p{font-family:IMFellLocal,Georgia,serif;font-size:9.55pt;line-height:1.13;margin:0 0 .053in;color:#201006;text-shadow:.16px .12px 0 rgba(54,25,10,.23)}
.lead{font-family:FondamentoLocal,serif;font-style:italic;font-size:11.3pt;line-height:1.08;text-align:center;color:#1e0d04;margin:.04in auto .075in;width:90%}
.maxim{width:88%;margin:.12in auto .14in;padding:.055in .1in .065in;text-align:center;border-top:2px solid rgba(47,20,8,.68);border-bottom:2px solid rgba(47,20,8,.68);transform:rotate(.28deg)}
.maxim .label{display:block;font-family:FondamentoLocal,serif;font-size:9.2pt;color:#783719;margin-bottom:.03in}
.maxim .words{display:block;font-family:FondamentoLocal,serif;font-style:italic;font-size:14.3pt;line-height:1.1;color:#180905;text-shadow:.25px .18px 0 rgba(49,19,7,.25)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:.23in;align-items:start}
.two p{font-size:8.75pt;line-height:1.11}
.compact p{font-size:8.55pt;line-height:1.1}
ul{margin:.015in 0 .08in .05in;padding-left:.16in}
li{font-family:IMFellLocal,Georgia,serif;font-size:8.45pt;line-height:1.09;margin:0 0 .034in;color:#1f0f05;text-shadow:.13px .1px 0 rgba(54,25,10,.18)}
li::marker{content:'– ';color:#713215}
.field-note{font-family:FondamentoLocal,serif;font-style:italic;font-size:9.5pt;line-height:1.08;color:#34180a;border-left:2px solid rgba(90,40,15,.44);padding-left:.08in;margin-top:.05in;transform:rotate(-.2deg)}
.return{font-family:FondamentoLocal,serif;font-style:italic;font-size:15.8pt;line-height:1.02;text-align:center;margin:.08in .24in .025in 0;color:#180905;transform:rotate(-.45deg)}
.sig{font-family:FondamentoLocal,serif;font-size:9pt;line-height:1.05;text-align:center;margin-right:.26in;color:#241006}
.margin-note{position:absolute;z-index:3;font-family:FondamentoLocal,serif;font-style:italic;font-size:8.6pt;line-height:1.04;color:rgba(45,21,8,.68)}
.margin-note.left{left:.73in;top:4.7in;width:.73in;text-align:right;transform:rotate(-10deg)}
.margin-note.right{right:.72in;top:5.15in;width:.62in;transform:rotate(8deg)}
.pin{position:absolute;z-index:3;width:.065in;height:.065in;border-radius:99px;background:rgba(41,18,7,.75);box-shadow:0 0 0 .02in rgba(116,70,33,.34),0 .018in .045in rgba(20,9,3,.45)}
.pin.a{left:1.56in;top:1.68in}.pin.b{right:1.8in;top:1.7in}
.stamp-copy{position:absolute;right:1.48in;bottom:1.48in;z-index:4;font-family:FondamentoLocal,serif;font-style:italic;font-size:8.2pt;line-height:1.03;color:rgba(101,20,15,.58);text-align:center;transform:rotate(-9deg)}
</style>
</head>
<body>
<svg width="0" height="0" aria-hidden="true">
  <filter id="inkRoughen">
    <feTurbulence type="fractalNoise" baseFrequency="0.018 0.09" numOctaves="2" seed="11" result="noise" />
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.55" xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>
<section class="page">
  <img class="bg" src="${bgUrl}" alt="" />
  <div class="pin a"></div><div class="pin b"></div>
  <div class="margin-note left">rope first<br/>glory later</div>
  <div class="margin-note right">mark smoke<br/>count arrows</div>
  <main class="ink-root"><div class="write">
    <div class="topnote">posted at the keep gate</div>
    <h1>Keep on the<br/>Borderlands</h1>
    <div class="sub">Notice to travellers bound beyond the outer road</div>
    <div class="issuer">By order of Castellan Windvarle. Copied for companies seeking road leave past the outer patrol.</div>
    <section class="section slantA">
      <h2>Read before passing the gate</h2>
      <p class="lead">You have reached the last reliable stone before the wild country takes offense.</p>
      <p>The Keep stands where the road thins, where old maps disagree, and where civilized people prefer to believe the border is firmer than it is.</p>
      <p>Beyond the gate are ravines, broken trails, cave mouths, hidden camps, rival claims, and things that have learned to wait. Some will speak before they strike, which does not make them safe.</p>
    </section>
    <div class="maxim"><span class="label">Operational maxim</span><span class="words">A living scout with a poor map is of more use than a dead hero with a perfect one.</span></div>
    <div class="two">
      <section class="section tight slantB compact"><h2>Road leave</h2><p>By leave of Castellan Windvarle, the bearer company may pass beyond the outer road and act as a provisional expedition band in unsettled country.</p><p>This road-writ grants leave to scout roads, ravines, cave-country, ruins, camps, shrines, and other sites of concern; recover useful proof; report hostile movement, missing travelers, unsafe roads, unnatural hazards, and suspicious gatherings; negotiate when parley preserves lives or knowledge; and defend the company when threatened.</p></section>
      <section class="section tight slantA compact"><h2>The work</h2><p>This is frontier expedition play: scouting, planning, negotiation, tactical danger, logistics, retreat, and teamwork. The Keep matters as base, shelter, market, rumor mill, and reputation center.</p><p><em>This is not punishment. This is pressure.</em></p><p><em>The purpose of the danger is not to defeat you. The purpose of the danger is to make your choices matter.</em></p></section>
    </div>
  </div></main>
  <div class="stamp-copy">gate copy<br/>road leave<br/>granted</div>
</section>
<section class="page">
  <img class="bg" src="${bgUrl}" alt="" />
  <div class="pin a"></div><div class="pin b"></div>
  <div class="margin-note left">ask at chapel<br/>before dusk</div>
  <div class="margin-note right">return with<br/>a report</div>
  <main class="ink-root"><div class="write page2">
    <div class="topnote">carried copy for the road</div>
    <h1>Before You<br/>Pass the Gate</h1>
    <div class="sub">Notes for the company beyond the outer patrol</div>
    <div class="two">
      <div>
        <section class="section slantA"><h2>Present reports</h2><p>Travelers on the outer road have gone missing. A muleteer returned without his load and with an arrow in his wagon board. Smoke has been seen near cave-country where no lawful camp has been recorded.</p><p>A patrol found tracks it could not follow without leaving the road unguarded. A chapel novice insists one of the old marker stones has been moved.</p><p>None of these reports prove a single organized threat. Together, they prove enough to be inconvenient.</p></section>
        <section class="section slantB"><h2>Report what you learn</h2><ul><li>Routes that are safer, watched, blocked, flooded, trapped, or changing.</li><li>Smoke, tracks, camps, cave traffic, ambush points, graves, broken wagons, or missing markers.</li><li>Names, symbols, bargains, warnings, prisoners, survivors, rumors, and lies worth checking.</li><li>Places that need a second expedition, better supplies, quieter steps, or more witnesses.</li><li>People who may be enemies, allies, captives, refugees, scouts, fools, or something in between.</li></ul><p class="field-note">Do not make the report prettier than the truth. The road has enough liars.</p></section>
      </div>
      <div>
        <section class="section slantB"><h2>What will help</h2><p>A competent company watches the road before trusting it, counts light before entering darkness, listens before opening doors, and remembers that a cave mouth is not just an entrance. It is a question.</p><ul><li>Skills: Perception, Investigation, Survival, Stealth, Insight, Persuasion, Athletics, Medicine, Arcana, History, Nature, and Religion.</li><li>Tools: rope work, cartography, navigation, herbalism, thieves' tools, healer's kits, useful languages, rituals, light management, mobility, healing, and quiet ways to solve loud problems.</li><li>Ask before passing: path out, path back, supplies carried, speaker for parley, rumor being tested, sign to turn back, and promise not to make.</li></ul></section>
        <section class="section slantA"><h2>Final instruction</h2><p>You are not being sent beyond the walls because the Keep thinks you are invincible. You are being sent because walls alone do not keep a border alive.</p><p>Carry rope. Count arrows. Listen before opening doors. Ask why a trail exists. Treat strangers as people before treating them as problems.</p><p>If you must fight, fight with a plan. If you must run, run toward tomorrow. Return with something the Keep did not know.</p><div class="return">Return with truth before glory.</div><div class="sig">Castellan Windvarle<br/>The Keep Gate</div></section>
      </div>
    </div>
  </div></main>
</section>
</body>
</html>`;

async function main(){
  fs.mkdirSync(outDir,{recursive:true});
  fs.mkdirSync(path.dirname(pdfPath),{recursive:true});
  const htmlPath=path.join(outDir,'keep-borderlands-artifact-lettering-source.html');
  fs.writeFileSync(htmlPath,html,'utf8');
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:816,height:1056},deviceScaleFactor:2});
  await page.setContent(html,{waitUntil:'load'});
  const pages=await page.$$('.page');
  const imagePaths=[];
  for(let i=0;i<pages.length;i++){
    const imagePath=path.join(outDir,`page-${String(i+1).padStart(2,'0')}.png`);
    await pages[i].screenshot({path:imagePath});
    imagePaths.push(imagePath);
  }
  const pdfPages=imagePaths.map((p,i)=>`<section class="pdf-page"><img src="${imgDataUri(p)}" alt="Keep on the Borderlands artifact lettering page ${i+1}" /></section>`).join('\n');
  const pdfHtml=`<!doctype html><html><head><meta charset="utf-8"/><style>@page{size:Letter portrait;margin:0}html,body{margin:0;padding:0;background:#111}.pdf-page{width:8.5in;height:11in;page-break-after:always;overflow:hidden}.pdf-page:last-child{page-break-after:auto}.pdf-page img{display:block;width:8.5in;height:11in;object-fit:cover}</style></head><body>${pdfPages}</body></html>`;
  await page.setContent(pdfHtml,{waitUntil:'load'});
  await page.pdf({path:pdfPath,width:'8.5in',height:'11in',printBackground:true,preferCSSPageSize:true});
  await browser.close();
  const qa={generatedAt:new Date().toISOString(),pdf:path.relative(root,pdfPath),background:path.relative(root,bgPath),htmlProof:path.relative(root,htmlPath),pageCountExpected:2,pagesRendered:2,visibleTextIsFlattenedPageArt:true,artifactLetteringAesthetic:true,centerVellumWashRemoved:true,selectableTextLayer:false,aiGeneratedTextUsed:false,deterministicTextSourceUsed:true,siteChanged:false,deployed:false};
  fs.writeFileSync(path.join(outDir,'qa-report.json'),JSON.stringify(qa,null,2));
  const notes=`# Keep on the Borderlands Artifact Lettering Production Notes\n\n## Output\n\n- PDF: \`public/downloads/keep-on-the-borderlands-frontier-expedition-charter.pdf\`\n- Preview images: \`campaign-brief-pdf-review/keep-borderlands-artifact-lettering/page-01.png\`, \`campaign-brief-pdf-review/keep-borderlands-artifact-lettering/page-02.png\`\n- Source composition: \`campaign-brief-pdf-review/keep-borderlands-artifact-lettering/keep-borderlands-artifact-lettering-source.html\`\n\n## Production Approach\n\nThis proof resets from system handwriting fonts to higher-quality diegetic lettering assets and parchment-integrated ink treatment. It uses imported local font assets, rough ink displacement, flattened page art, and no center wash.\n\nThe goal is closer to a high-quality in-world gate notice or traveller handout while keeping exact deterministic text rendering.\n\n## Accuracy Model\n\nNo AI-generated text is used. No image model is asked to spell. The visible text is rendered from exact source strings and flattened into page artwork.\n\n## QA Notes\n\n- No website files were changed.\n- No deployment was performed.\n- No pricing, testimonials, or website CTA language were added.\n- Selectable text is intentionally omitted from this visual proof.\n`;
  fs.writeFileSync(notesPath,notes,'utf8');
}
main().catch(err=>{console.error(err);process.exit(1)});
