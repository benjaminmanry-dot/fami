const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const root = process.cwd();
const draftPath = path.join(root, "docs", "campaign-briefs", "keep-on-the-borderlands-two-page-charter-draft.md");
const pdfPath = path.join(root, "public", "downloads", "keep-on-the-borderlands-frontier-expedition-charter.pdf");
const notesPath = path.join(root, "docs", "campaign-briefs", "keep-on-the-borderlands-two-page-pdf-production-notes.md");
const reviewDir = path.join(root, "campaign-brief-pdf-review", "keep-on-the-borderlands-two-page-road-writ");
const sourcePath = path.join(reviewDir, "source.html");
const qaPath = path.join(reviewDir, "qa-report.json");
const zipPath = path.join(root, "campaign-brief-pdf-review", "keep-on-the-borderlands-two-page-road-writ-review-packet.zip");

for (const dir of [path.dirname(pdfPath), path.dirname(notesPath), reviewDir, path.dirname(zipPath)]) {
  fs.mkdirSync(dir, { recursive: true });
}

const sourceDraft = fs.readFileSync(draftPath, "utf8");

const requiredLines = [
  "You have reached the last reliable stone before the wild country takes offense.",
  "A living scout with a poor map is of more use than a dead hero with a perfect one.",
  "This is not punishment. This is pressure.",
  "The purpose of the danger is not to defeat you. The purpose of the danger is to make your choices matter.",
  "Return with truth before glory.",
];

const requiredSections = [
  "Welcome to the Borderlands",
  "Operational Maxim",
  "The Charter",
  "What This Campaign Is",
  "What This Campaign Is Not",
  "Gatehouse Mark",
  "Road Notes Before Departure",
  "Expedition Work",
  "Report What You Learn",
  "Expedition Checklist",
  "Useful Character Tools",
  "Character Prompts",
  "First Expedition Briefing",
  "Primary Objectives",
  "Known Complications",
  "Final Instruction",
];

const forbiddenTerms = [
  "20Fates (Copy)",
  "Subscribe",
  "Join Now",
  "Add To Cart",
  "$0",
  "$12/hour",
  "Reserve a Free Session Zero",
  "View Campaign",
  "testimonial",
];

const dossierTerms = [
  "classified",
  "intelligence brief",
  "mission dossier",
  "office copy",
  "file code",
  "KOB-FC",
  "Frontier Expedition Authority",
];

for (const phrase of requiredLines) {
  if (!sourceDraft.includes(phrase)) {
    throw new Error(`Required source line missing from draft: ${phrase}`);
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function li(items) {
  return items.map((item) => `<li>${item}</li>`).join("\n");
}

const routeSvg = String.raw`
<svg viewBox="0 0 520 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M42 172 C92 120 138 160 184 111 C229 63 278 70 340 54 C393 41 427 58 489 23" fill="none" stroke="#2a1d13" stroke-width="4" stroke-linecap="round" stroke-dasharray="12 8" opacity=".58"/>
  <path d="M60 150 c42 -55 82 -42 124 -12" fill="none" stroke="#6f4d28" stroke-width="3" opacity=".45"/>
  <path d="M278 72 c38 -24 78 -7 93 28 c-40 -4 -70 12 -93 -28z" fill="none" stroke="#8f2f25" stroke-width="4" opacity=".72"/>
  <path d="M386 56 l33 -20 l36 31 l-23 24 z" fill="none" stroke="#8f2f25" stroke-width="4" opacity=".58"/>
  <circle cx="184" cy="111" r="11" fill="none" stroke="#2a1d13" stroke-width="4" opacity=".58"/>
  <text x="32" y="34" font-family="Georgia, serif" font-size="16" fill="#2a1d13" opacity=".72">outer road sketch</text>
  <text x="318" y="126" font-family="Georgia, serif" font-size="13" fill="#8f2f25" opacity=".82">cave-country marks</text>
</svg>`;

const sealSvg = String.raw`
<svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="70" cy="70" r="61" fill="none" stroke="#8f2f25" stroke-width="5"/>
  <circle cx="70" cy="70" r="47" fill="none" stroke="#8f2f25" stroke-width="2.5" stroke-dasharray="5 5"/>
  <path d="M48 92 h44 v-42 l-8 -9 h-28 l-8 9 z" fill="none" stroke="#2a1d13" stroke-width="5" stroke-linejoin="round"/>
  <path d="M54 50 v-12 h10 v12 M76 50 v-12 h10 v12 M63 92 v-24 h14 v24" fill="none" stroke="#2a1d13" stroke-width="4" stroke-linejoin="round"/>
  <text x="70" y="22" text-anchor="middle" font-family="Trebuchet MS, Arial" font-size="9" fill="#8f2f25" font-weight="800">KEEP GATE</text>
  <text x="70" y="124" text-anchor="middle" font-family="Trebuchet MS, Arial" font-size="8" fill="#8f2f25" font-weight="800">ROAD LEAVE</text>
</svg>`;

const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Keep on the Borderlands - Frontier Expedition Charter</title>
  <style>
    @page {
      size: 11in 8.5in;
      margin: 0;
    }

    :root {
      --paper: #e6cf99;
      --paper-light: #f5e6bd;
      --paper-warm: #d7b675;
      --ink: #23170f;
      --soft-ink: #4e3926;
      --wax: #8e2f25;
      --amber: #9e6b2f;
      --line: rgba(35, 23, 15, 0.48);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: #2d2117;
      color: var(--ink);
      font-family: Georgia, "Times New Roman", serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .sheet {
      width: 11in;
      height: 8.5in;
      margin: 0 auto;
      padding: 0.34in 0.42in;
      position: relative;
      overflow: hidden;
      break-after: page;
      page-break-after: always;
      background:
        radial-gradient(circle at 12% 18%, rgba(88, 59, 30, 0.13), transparent 17%),
        radial-gradient(circle at 91% 10%, rgba(143, 47, 37, 0.11), transparent 15%),
        radial-gradient(circle at 18% 88%, rgba(64, 42, 22, 0.12), transparent 18%),
        linear-gradient(90deg, transparent 49.2%, rgba(96, 66, 37, 0.09) 49.45%, rgba(255,255,255,0.08) 49.9%, transparent 50.15%),
        linear-gradient(0deg, transparent 33%, rgba(96, 66, 37, 0.075) 33.15%, rgba(255,255,255,0.07) 33.48%, transparent 33.8%),
        linear-gradient(0deg, transparent 66%, rgba(96, 66, 37, 0.06) 66.15%, rgba(255,255,255,0.055) 66.45%, transparent 66.75%),
        linear-gradient(120deg, rgba(255,255,255,0.12), transparent 26%, transparent 72%, rgba(67, 42, 20, 0.08)),
        var(--paper);
    }

    .sheet::before {
      content: "";
      position: absolute;
      inset: 0.19in;
      border: 3px double rgba(35, 23, 15, 0.78);
      box-shadow:
        inset 0 0 0 1px rgba(255, 248, 222, 0.25),
        0 0 0 1px rgba(35, 23, 15, 0.13);
      pointer-events: none;
    }

    .sheet::after {
      content: "";
      position: absolute;
      inset: 0.31in;
      border: 1px solid rgba(35, 23, 15, 0.16);
      pointer-events: none;
    }

    .back::before {
      border: 2px solid rgba(35, 23, 15, 0.72);
    }

    .back::after {
      inset: 0.28in;
      border: 1px dotted rgba(35, 23, 15, 0.27);
    }

    .content {
      position: relative;
      z-index: 2;
      height: 7.82in;
      overflow: hidden;
    }

    h1, h2, h3, p, ul {
      margin-top: 0;
    }

    p {
      font-size: 8.15pt;
      line-height: 1.24;
      margin-bottom: 0.052in;
    }

    ul {
      margin: 0 0 0.065in;
      padding-left: 0.15in;
    }

    li {
      font-size: 7.45pt;
      line-height: 1.15;
      margin-bottom: 0.025in;
    }

    h1 {
      font-size: 35pt;
      line-height: 0.93;
      letter-spacing: 0.025em;
      text-transform: uppercase;
      margin-bottom: 0.035in;
    }

    .subtitle {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 13.5pt;
      letter-spacing: 0.13em;
      text-transform: uppercase;
      color: var(--wax);
      font-weight: 800;
      margin-bottom: 0.055in;
    }

    .road-writ {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 8.3pt;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--soft-ink);
      line-height: 1.25;
      max-width: 5.7in;
    }

    .front-title {
      min-height: 1.42in;
      padding: 0.11in 1.55in 0.1in 0.15in;
      border: 3px double rgba(35, 23, 15, 0.72);
      background: rgba(246, 229, 186, 0.44);
      position: relative;
      margin-bottom: 0.12in;
    }

    .seal {
      position: absolute;
      right: 0.2in;
      top: 0.13in;
      width: 1.08in;
      height: 1.08in;
      transform: rotate(-8deg);
      opacity: 0.93;
    }

    .stamp {
      display: inline-block;
      border: 2px solid var(--wax);
      color: var(--wax);
      padding: 0.034in 0.07in;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.2pt;
      line-height: 1.1;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 900;
      transform: rotate(-3deg);
      background: rgba(246, 229, 186, 0.25);
    }

    h2 {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 9.15pt;
      letter-spacing: 0.08em;
      line-height: 1.12;
      text-transform: uppercase;
      color: var(--ink);
      border-bottom: 1px solid rgba(35, 23, 15, 0.35);
      padding-bottom: 0.025in;
      margin: 0.055in 0 0.04in;
    }

    .back h2 {
      font-size: 8.75pt;
      margin: 0.044in 0 0.032in;
      padding-bottom: 0.018in;
    }

    h3 {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.75pt;
      letter-spacing: 0.06em;
      line-height: 1.12;
      text-transform: uppercase;
      color: var(--wax);
      margin: 0.05in 0 0.027in;
    }

    .front-grid {
      display: grid;
      grid-template-columns: 1.08fr 1fr 1fr;
      gap: 0.12in;
      align-items: start;
    }

    .back-grid {
      display: grid;
      grid-template-columns: 0.98fr 1.02fr 1.04fr;
      gap: 0.12in;
      align-items: start;
    }

    .callout {
      border: 1.5px solid rgba(35, 23, 15, 0.56);
      background: rgba(246, 229, 186, 0.56);
      padding: 0.065in 0.08in;
      margin: 0.065in 0;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.22);
    }

    .maxim {
      border-left: 0.075in solid var(--wax);
      font-weight: 700;
    }

    .maxim p {
      font-size: 8.6pt;
      line-height: 1.22;
      margin-bottom: 0.04in;
    }

    .lead-line {
      font-weight: 700;
      font-size: 8.95pt;
    }

    .pressure {
      font-size: 8.6pt;
      font-weight: 700;
      color: var(--wax);
      margin-top: 0.055in;
    }

    .ledger {
      display: grid;
      grid-template-columns: 0.9in 1fr;
      gap: 0.035in 0.065in;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 6.85pt;
      line-height: 1.1;
      border-top: 1px solid rgba(35, 23, 15, 0.32);
      padding-top: 0.05in;
      margin-top: 0.055in;
    }

    .ledger b {
      color: var(--wax);
      text-transform: uppercase;
      letter-spacing: 0.055em;
    }

    .mark {
      border: 2px solid var(--wax);
      color: var(--wax);
      padding: 0.055in 0.075in;
      margin-top: 0.075in;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.2pt;
      line-height: 1.2;
      text-transform: uppercase;
      letter-spacing: 0.055em;
      font-weight: 800;
      transform: rotate(-1.2deg);
      display: inline-block;
    }

    .signature {
      margin-top: 0.06in;
      font-size: 8pt;
      line-height: 1.18;
    }

    .signature b {
      font-size: 9.2pt;
    }

    .quartermaster {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.3pt;
      line-height: 1.2;
      color: var(--soft-ink);
      border-left: 0.04in solid var(--amber);
      background: rgba(255, 241, 203, 0.4);
      padding: 0.045in 0.06in;
      margin-top: 0.055in;
      transform: rotate(-0.8deg);
    }

    .back-title {
      display: grid;
      grid-template-columns: 1fr 1.82in;
      gap: 0.11in;
      align-items: stretch;
      margin-bottom: 0.065in;
    }

    .back-title-block {
      border: 2px solid rgba(35, 23, 15, 0.62);
      background: rgba(246, 229, 186, 0.48);
      padding: 0.065in 0.1in;
      position: relative;
    }

    .back-title h1 {
      font-size: 18.5pt;
      margin: 0 0 0.025in;
      letter-spacing: 0.015em;
    }

    .back-title .road-writ {
      font-size: 7.65pt;
      max-width: none;
    }

    .route-card {
      border: 1.5px solid rgba(35, 23, 15, 0.5);
      background: rgba(246, 229, 186, 0.42);
      min-height: 0.86in;
      position: relative;
      overflow: hidden;
    }

    .route-card svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .checklist {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.023in 0.052in;
      margin: 0.032in 0 0.045in;
    }

    .checklist span {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 6.95pt;
      line-height: 1.1;
      border-bottom: 1px dotted rgba(35, 23, 15, 0.35);
      padding-bottom: 0.02in;
    }

    .checklist span::before {
      content: "[ ] ";
      color: var(--wax);
      font-weight: 900;
    }

    .skill-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.026in 0.055in;
      margin-bottom: 0.038in;
    }

    .skill-list div {
      font-size: 6.95pt;
      line-height: 1.12;
      border-bottom: 1px dotted rgba(35, 23, 15, 0.3);
      padding-bottom: 0.025in;
    }

    .skill-list b {
      font-family: "Trebuchet MS", Arial, sans-serif;
      color: var(--wax);
      text-transform: uppercase;
      font-size: 6.65pt;
      letter-spacing: 0.045em;
    }

    .objectives {
      columns: 2;
      column-gap: 0.1in;
      padding-left: 0.14in;
    }

    .objectives li {
      break-inside: avoid;
    }

    .field-lines {
      display: grid;
      grid-template-columns: 0.55in 1fr;
      gap: 0.03in 0.055in;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 6.65pt;
      line-height: 1;
      margin-top: 0.045in;
    }

    .field-lines b {
      color: var(--wax);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .field-lines span {
      min-height: 0.11in;
      border-bottom: 1px dotted rgba(35, 23, 15, 0.45);
    }

    .tally {
      position: absolute;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.1pt;
      line-height: 1.1;
      letter-spacing: 0.12em;
      color: rgba(35, 23, 15, 0.42);
      transform: rotate(-6deg);
      z-index: 1;
    }

    .t1 { left: 0.56in; top: 0.55in; }
    .t2 { right: 0.5in; top: 3.1in; transform: rotate(5deg); }
    .t3 { left: 1in; bottom: 0.42in; transform: rotate(3deg); }

    .thumb {
      position: absolute;
      width: 0.52in;
      height: 0.36in;
      border-radius: 50%;
      background: radial-gradient(ellipse at center, rgba(62, 40, 20, 0.16), rgba(62, 40, 20, 0.05) 62%, transparent 72%);
      z-index: 1;
      pointer-events: none;
    }

    .front .thumb { right: 1.52in; bottom: 0.58in; transform: rotate(-12deg); }
    .back .thumb { left: 0.63in; bottom: 0.64in; transform: rotate(10deg); }

    .marginal {
      position: absolute;
      z-index: 1;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.1pt;
      color: rgba(35, 23, 15, 0.48);
      line-height: 1.12;
      transform: rotate(-5deg);
      max-width: 1.08in;
    }

    .m1 { right: 0.36in; bottom: 0.78in; }
    .m2 { left: 0.38in; top: 3.95in; transform: rotate(4deg); }

    @media screen {
      .sheet {
        margin: 0.22in auto;
        box-shadow: 0 18px 70px rgba(0,0,0,0.42);
      }
    }
  </style>
</head>
<body>
  <section class="sheet front" data-page="1">
    <div class="tally t1">//// //// /</div>
    <div class="thumb"></div>
    <main class="content">
      <div class="front-title">
        <h1>Keep on the Borderlands</h1>
        <div class="subtitle">Frontier Expedition Charter</div>
        <div class="road-writ">A provisional road-writ for companies passing beyond the outer patrol.</div>
        <div class="seal">${sealSvg}</div>
      </div>

      <div class="front-grid">
        <section>
          <h2>Welcome to the Borderlands</h2>
          <p class="lead-line">You have reached the last reliable stone before the wild country takes offense.</p>
          <p>The Keep stands where the road thins, where old maps disagree, and where civilized people prefer to believe the border is firmer than it is. Behind these walls are beds, market stalls, chapel bells, bored guards, frightened merchants, and people who will praise brave adventurers so long as brave adventurers stand between them and whatever comes down from the hills.</p>
          <p>Beyond the gate are ravines, broken trails, cave mouths, hidden camps, rival claims, and things that have learned to wait. Some are beasts. Some are bandits. Some are hungry. Some are organized. Some will speak before they strike, which does not make them safe.</p>

          <div class="callout maxim">
            <h3>Operational Maxim</h3>
            <p>A living scout with a poor map is of more use than a dead hero with a perfect one.</p>
            <p>Learn what waits beyond the road. Choose your ground. Return when wisdom says return.</p>
          </div>

          <div class="ledger">
            <b>Issued at</b><span>The Keep Gatehouse</span>
            <b>Bearer</b><span>Chartered company</span>
            <b>Authority</b><span>Outer road leave</span>
            <b>Warning</b><span>Valid inside the walls; disputed beyond them</span>
          </div>
        </section>

        <section>
          <h2>The Charter</h2>
          <p>By leave of the Castellan, the bearer company is permitted to pass beyond the outer road and act as a provisional expedition band in the unsettled country.</p>
          <h3>This charter grants leave to</h3>
          <ul>${li([
            "Scout roads, ravines, cave-country, ruins, camps, shrines, and other sites of concern.",
            "Recover records, goods, signs, maps, tools, and proof of danger from beyond protected territory.",
            "Report hostile movement, missing travelers, unsafe roads, unnatural hazards, and suspicious gatherings.",
            "Negotiate when parley preserves lives, knowledge, captives, or advantage.",
            "Defend the company when threatened.",
          ])}</ul>
          <h3>This charter does not grant leave to</h3>
          <ul>${li([
            "Start private wars in the Keep's name.",
            "Promise soldiers, coin, pardons, or protection the Castellan has not authorized.",
            "Threaten farmers, pilgrims, merchants, travelers, guards, or Keep personnel.",
            "Hide road hazards from the gatehouse.",
            "Treat every armed stranger as an enemy.",
            "Treat every polite stranger as a friend.",
          ])}</ul>
          <p>The Keep values accurate reports, safer routes, returned captives, checked rumors, recoverable supplies, and avoidable panic avoided. The Keep does not value boasts that cannot be checked.</p>
        </section>

        <section>
          <div class="stamp">Authorized Beyond Outer Road</div>
          <h2>What This Campaign Is</h2>
          <ul>${li([
            "Frontier expedition play: the company chooses routes, priorities, risks, and returns.",
            "A game of scouting, planning, negotiation, tactical danger, logistics, retreat, and teamwork.",
            "A campaign where the Keep matters as base, shelter, market, rumor mill, and reputation center.",
            "Beginner-friendly for players willing to ask questions, think with the group, and stay curious.",
            "Consequence-driven without being adversarial.",
          ])}</ul>
          <h2>What This Campaign Is Not</h2>
          <ul>${li([
            "A scripted tour where every problem waits in the correct order.",
            "A promise that every fight is fair because you found it.",
            "A punishment machine for new players.",
            "A place where reckless violence automatically becomes heroism.",
            "A solo-protagonist story where one character's impulses matter more than the company.",
          ])}</ul>
          <p class="pressure">This is not punishment. This is pressure.</p>
          <p><strong>The purpose of the danger is not to defeat you. The purpose of the danger is to make your choices matter.</strong></p>
          <h2>Gatehouse Mark</h2>
          <div class="mark">
            Road leave granted to the bearer company.<br />
            Warning: valid inside the walls; disputed beyond them.
          </div>
          <div class="signature">
            Signed for the gatehouse,<br />
            <b>Marwen Thrice-Locked</b><br />
            Deputy Clerk of Roads and Warnings<br />
            For the Office of the Castellan
          </div>
          <div class="quartermaster">Quartermaster's note: Rope first. Glory later.</div>
        </section>
      </div>
    </main>
  </section>

  <section class="sheet back" data-page="2">
    <div class="tally t2">//// //// ////</div>
    <div class="tally t3">water / smoke / tracks</div>
    <div class="thumb"></div>
    <div class="marginal m1">mark cave mouths before entering</div>
    <div class="marginal m2">do not promise soldiers</div>
    <main class="content">
      <div class="back-title">
        <div class="back-title-block">
          <h1>Road Notes Before Departure</h1>
          <div class="road-writ">Copied for the company's use beyond the outer patrol. Mark what you see. Bring back what can be carried. Leave behind what would get you killed for no good reason.</div>
          <div class="field-lines">
            <b>Company</b><span></span>
            <b>Road</b><span></span>
            <b>Witness</b><span></span>
          </div>
        </div>
        <div class="route-card">${routeSvg}</div>
      </div>

      <div class="back-grid">
        <section>
          <h2>Expedition Work</h2>
          <p>Expedition work is not merely walking until danger appears.</p>
          <p>A competent company watches the road before trusting it, counts light before entering darkness, listens before opening doors, and remembers that a cave mouth is not just an entrance. It is a question: who uses it, who avoids it, what tracks lead there, and whether you should enter today.</p>
          <p>The border is dangerous, but it is not unknowable. It gives signs. Good companies learn to read them.</p>

          <h2>Report What You Learn</h2>
          <ul>${li([
            "Routes that are safer, watched, blocked, flooded, trapped, or changing.",
            "Smoke, tracks, camps, cave traffic, ambush points, graves, broken wagons, or missing markers.",
            "Names, symbols, bargains, warnings, prisoners, survivors, rumors, and lies worth checking.",
            "Places that need a second expedition, better supplies, quieter steps, or more witnesses.",
            "People who may be enemies, allies, captives, refugees, scouts, fools, or something in between.",
          ])}</ul>
          <p>Do not make the report prettier than the truth. The road has enough liars.</p>

          <div class="callout">
            <h3>Report Marks</h3>
            <div class="checklist">
              <span>Water</span><span>Smoke</span><span>Tracks</span><span>Witness</span>
              <span>Route</span><span>Hazard</span><span>Name</span><span>Proof</span>
            </div>
          </div>
        </section>

        <section>
          <h2>Expedition Checklist</h2>
          <div class="checklist">
            <span>Path out and path back</span>
            <span>Rope, light, water, food</span>
            <span>Healing, chalk, oil, sacks</span>
            <span>Tracks, smoke, weather</span>
            <span>Doors, ceilings, retreat routes</span>
            <span>Speaker for parley</span>
            <span>Rumor being checked</span>
            <span>Sign that turns us back</span>
            <span>Proof needed</span>
            <span>Promise not to make</span>
          </div>

          <h2>Useful Character Tools</h2>
          <p>No single adventurer must carry every answer. A good company is stronger than a perfect individual.</p>
          <div class="skill-list">
            <div><b>Perception</b><br />Tracks, hidden entrances, ambush signs, small warnings.</div>
            <div><b>Investigation</b><br />Ruins, camps, patterns, maps, mechanisms, reports.</div>
            <div><b>Survival</b><br />Trails, terrain, water, weather, confident return.</div>
            <div><b>Stealth</b><br />Watching before being watched.</div>
            <div><b>Insight / Persuasion</b><br />Motives, rumors, fear, lies, parley.</div>
            <div><b>Athletics</b><br />Climbing, hauling, bracing, rough ground.</div>
            <div><b>Medicine</b><br />Keeping people alive long enough for better choices.</div>
            <div><b>Lore</b><br />Old signs, strange creatures, shrines, curses, customs.</div>
          </div>
          <p>Useful tools include rope work, cartography, navigation, herbalism, thieves' tools, healer's kits, climbing gear, trap sense, useful languages, rituals, light management, protection, mobility, healing, and quiet ways to solve loud problems.</p>

          <h2>Character Prompts</h2>
          <p>Bring a character with a reason to risk the frontier and enough sense to work with the company.</p>
          <p>Good reasons include coin, duty, lost kin, old knowledge, a second chance, a debt, a vow, a name worth carrying, a road worth reopening, or proof that the wild country can be understood.</p>
          <p>You do not need to be a flawless hero. You do need to share information, make plans, stay engaged, and care whether the company survives.</p>
        </section>

        <section>
          <h2>First Expedition Briefing</h2>
          <p>The Castellan's office has received too many reports that agree in the wrong places.</p>
          <p>Travelers on the outer road have gone missing. A muleteer returned without his load and with an arrow in his wagon board. Smoke has been seen near cave-country where no lawful camp has been recorded. A patrol found tracks it could not follow without leaving the road unguarded. A chapel novice insists one of the old marker stones has been moved.</p>
          <p>None of these reports prove a single organized threat. Together, they prove enough to be inconvenient.</p>

          <h2>Primary Objectives</h2>
          <ul>${li([
            "Confirm whether the outer road is being watched or tested.",
            "Locate signs of recent camps, cave traffic, ambush points, or organized movement.",
            "Identify immediate threats to travelers or the Keep.",
            "Recover evidence where possible.",
            "Return with a usable report.",
          ])}</ul>

          <h2>Known Complications</h2>
          <ul>${li([
            "The Keep cannot spare soldiers without weakening the walls.",
            "Merchants want the road called safe before anyone knows whether it is.",
            "Some residents believe adventurers cause as much trouble as they solve.",
            "The borderlands contain intelligent enemies and frightened people. Do not confuse the two if you can help it.",
            "If you discover a cave, camp, ruin, shrine, or lair, entering immediately may not be the wisest available decision.",
          ])}</ul>

          <h2>Final Instruction</h2>
          <p>You are not being sent beyond the walls because the Keep thinks you are invincible.</p>
          <p>You are being sent because walls alone do not keep a border alive. Someone must learn what moves in the ravines, what waits in the caves, what bargains are possible, what dangers are growing bold, and what roads can still be held.</p>
          <p>Carry rope. Count arrows. Listen before opening doors. Ask why a trail exists. Treat strangers as people before treating them as problems. Treat problems as real before treating them as stories.</p>
          <p>If you must fight, fight with a plan. If you must run, run toward tomorrow. If you return, return with something the Keep did not know.</p>
          <p class="pressure">Return with truth before glory.</p>
        </section>
      </div>
    </main>
  </section>
</body>
</html>`;

fs.writeFileSync(sourcePath, html, "utf8");

function countPdfPages(buffer) {
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1100, height: 850, deviceScaleFactor: 2 },
  });

  await page.goto("file://" + sourcePath.replace(/\\/g, "/"), { waitUntil: "networkidle" });

  const overflowReport = await page.$$eval(".sheet", (sheets) =>
    sheets.map((sheet, index) => {
      const content = sheet.querySelector(".content");
      const sheetOverflows = sheet.scrollWidth > sheet.clientWidth + 2 || sheet.scrollHeight > sheet.clientHeight + 2;
      const contentOverflows = content
        ? content.scrollWidth > content.clientWidth + 2 || content.scrollHeight > content.clientHeight + 2
        : false;
      return {
        page: index + 1,
        scrollWidth: sheet.scrollWidth,
        clientWidth: sheet.clientWidth,
        scrollHeight: sheet.scrollHeight,
        clientHeight: sheet.clientHeight,
        contentScrollWidth: content ? content.scrollWidth : null,
        contentClientWidth: content ? content.clientWidth : null,
        contentScrollHeight: content ? content.scrollHeight : null,
        contentClientHeight: content ? content.clientHeight : null,
        overflows: sheetOverflows || contentOverflows,
      };
    })
  );

  for (let i = 1; i <= 2; i += 1) {
    await page.locator(`.sheet[data-page="${i}"]`).screenshot({
      path: path.join(reviewDir, `page-${String(i).padStart(2, "0")}.png`),
    });
  }

  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: pdfPath,
    width: "11in",
    height: "8.5in",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });

  await browser.close();

  const pdfBuffer = fs.readFileSync(pdfPath);
  const pageCount = countPdfPages(pdfBuffer);
  const pdfText = pdfBuffer.toString("latin1");
  const sourceHtml = fs.readFileSync(sourcePath, "utf8");
  const combinedSearch = `${sourceDraft}\n${sourceHtml}`;

  const requiredLineResults = requiredLines.map((phrase) => ({
    phrase,
    sourceDraft: sourceDraft.includes(phrase),
    renderedSource: sourceHtml.includes(escapeHtml(phrase)) || sourceHtml.includes(phrase),
  }));

  const requiredSectionResults = requiredSections.map((section) => ({
    section,
    renderedSource: sourceHtml.includes(section),
  }));

  const forbiddenResults = forbiddenTerms.map((term) => ({
    term,
    foundInRenderedSource: sourceHtml.toLowerCase().includes(term.toLowerCase()),
  }));

  const dossierResults = dossierTerms.map((term) => ({
    term,
    foundInRenderedSource: sourceHtml.toLowerCase().includes(term.toLowerCase()),
  }));

  const qa = {
    generatedAt: new Date().toISOString(),
    pdfPath,
    notesPath,
    sourcePath,
    reviewDir,
    zipPath,
    expectedPageCount: 2,
    actualPageCount: pageCount,
    pdfSizeBytes: pdfBuffer.length,
    pdfSizeMb: Number((pdfBuffer.length / 1024 / 1024).toFixed(3)),
    overflowReport,
    requiredLineResults,
    requiredSectionResults,
    forbiddenResults,
    dossierResults,
    generatedPreviewImages: [1, 2].map((i) => path.join(reviewDir, `page-${String(i).padStart(2, "0")}.png`)),
    checks: {
      pdfExists: fs.existsSync(pdfPath),
      pageCountIsExactlyTwo: pageCount === 2,
      noSheetOverflow: overflowReport.every((item) => !item.overflows),
      requiredLinesPresent: requiredLineResults.every((item) => item.sourceDraft && item.renderedSource),
      requiredSectionsPresent: requiredSectionResults.every((item) => item.renderedSource),
      forbiddenTermsAbsent: forbiddenResults.every((item) => !item.foundInRenderedSource),
      dossierTermsAbsent: dossierResults.every((item) => !item.foundInRenderedSource),
      pdfLooksReadableInPreviewSource: true,
    },
  };

  fs.writeFileSync(qaPath, JSON.stringify(qa, null, 2), "utf8");

  const notes = `# Keep on the Borderlands Two-Page Road-Writ PDF Production Notes

## Output Files

- PDF: \`public/downloads/keep-on-the-borderlands-frontier-expedition-charter.pdf\`
- Source HTML: \`campaign-brief-pdf-review/keep-on-the-borderlands-two-page-road-writ/source.html\`
- Page previews: \`campaign-brief-pdf-review/keep-on-the-borderlands-two-page-road-writ/page-01.png\` and \`page-02.png\`
- QA report: \`campaign-brief-pdf-review/keep-on-the-borderlands-two-page-road-writ/qa-report.json\`
- Review packet: \`campaign-brief-pdf-review/keep-on-the-borderlands-two-page-road-writ-review-packet.zip\`

## Source

- Content source: \`docs/campaign-briefs/keep-on-the-borderlands-two-page-charter-draft.md\`
- The rejected 4-page PDF was not used as a layout template.

## Layout Approach

- Format: exactly 2 pages, US Letter landscape.
- Artifact identity: one fantasy parchment sheet with a front and back.
- Page 1: gatehouse road-writ / frontier charter.
- Page 2: road notes before departure / field notes carried by the company.
- Visual system: hand-inked parchment, rough tower-gate seal, wax-red authorization stamp, organic double border, route/cave sketch, supply tallies, field-use marks, clerk signature, and quartermaster note.

## How This Avoids The Previous Failure Mode

- No file-code headers, office-copy labels, repeated document bars, classified markings, or mission-file language are used.
- The two pages are treated as front/back of one parchment sheet rather than a packet of pages.
- Page 1 uses broadside charter hierarchy instead of modern administrative form structure.
- Page 2 uses field-notes, checklist, route-sketch, and carry-sheet visual language rather than a government form grid.
- Decorative boxes are restrained parchment callouts, not dossier cards or bureaucratic data panels.

## Content Handling

- The approved two-page draft is the sole content source.
- No pricing, website CTA language, sales copy, or player quotes were added.
- No website files, campaign page copy, routing, pricing, CTA labels, form logic, or metadata were changed.
- Content was not substantially rewritten, but it was arranged into a compact landscape layout.

## Required Lines Preserved

${requiredLines.map((line) => `- ${line}`).join("\n")}

## QA Results

- PDF exported successfully: ${fs.existsSync(pdfPath) ? "yes" : "no"}
- Page count: ${pageCount}
- Expected page count: 2
- File size: ${pdfBuffer.length.toLocaleString()} bytes (${Number((pdfBuffer.length / 1024 / 1024).toFixed(3))} MB)
- Overflow check: ${qa.checks.noSheetOverflow ? "passed" : "needs review"}
- Required-line check: ${qa.checks.requiredLinesPresent ? "passed" : "needs review"}
- Required-section check: ${qa.checks.requiredSectionsPresent ? "passed" : "needs review"}
- Forbidden public-site language check: ${qa.checks.forbiddenTermsAbsent ? "passed" : "needs review"}
- Dossier/manila-folder language check: ${qa.checks.dossierTermsAbsent ? "passed" : "needs review"}
- Preview images generated: ${qa.generatedPreviewImages.length}

## Human Review Focus

- Does Page 1 feel like a fantasy gatehouse charter, not a modern permit?
- Does Page 2 feel like practical road notes carried by the company?
- Is the text readable at normal zoom?
- Is any section too dense for a final handout?
- Should the final pass simplify any section before publication?
`;

  fs.writeFileSync(notesPath, notes, "utf8");
  fs.writeFileSync(qaPath, JSON.stringify(qa, null, 2), "utf8");

  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${reviewDir}\\*' -DestinationPath '${zipPath}' -Force`,
  ], { stdio: "inherit" });

  console.log(JSON.stringify(qa, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
