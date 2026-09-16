const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = process.cwd();
const pdfPath = path.join(root, "public", "downloads", "keep-on-the-borderlands-frontier-expedition-charter.pdf");
const notesPath = path.join(root, "docs", "campaign-briefs", "keep-on-the-borderlands-pdf-production-notes.md");
const reviewDir = path.join(root, "campaign-brief-pdf-review", "keep-on-the-borderlands");
const sourcePath = path.join(reviewDir, "source.html");
const qaPath = path.join(reviewDir, "qa-report.json");

fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
fs.mkdirSync(path.dirname(notesPath), { recursive: true });
fs.mkdirSync(reviewDir, { recursive: true });

const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Keep on the Borderlands - Frontier Expedition Charter</title>
  <style>
    @page {
      size: Letter;
      margin: 0;
    }

    :root {
      --paper: #e4cf9e;
      --paper-light: #f2e3bd;
      --paper-deep: #c7a96f;
      --ink: #211811;
      --iron: #4a4437;
      --wax: #8f2f25;
      --amber: #a9772f;
      --faint: rgba(33, 24, 17, 0.18);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: #34271c;
      color: var(--ink);
      font-family: Georgia, "Times New Roman", serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .sheet {
      width: 8.5in;
      min-height: 11in;
      margin: 0 auto;
      padding: 0.34in;
      break-after: page;
      page-break-after: always;
      position: relative;
      overflow: hidden;
      background:
        linear-gradient(90deg, transparent 48.8%, rgba(86, 62, 37, 0.10) 49%, rgba(255, 255, 255, 0.10) 49.35%, transparent 49.7%),
        linear-gradient(0deg, transparent 32%, rgba(86, 62, 37, 0.08) 32.2%, rgba(255, 255, 255, 0.08) 32.45%, transparent 32.7%),
        linear-gradient(0deg, transparent 69%, rgba(86, 62, 37, 0.07) 69.1%, rgba(255, 255, 255, 0.07) 69.35%, transparent 69.7%),
        radial-gradient(circle at 12% 18%, rgba(143, 47, 37, 0.09), transparent 16%),
        radial-gradient(circle at 88% 12%, rgba(72, 50, 30, 0.13), transparent 18%),
        radial-gradient(circle at 18% 86%, rgba(52, 38, 22, 0.12), transparent 17%),
        radial-gradient(ellipse at 70% 82%, rgba(91, 61, 33, 0.10), transparent 21%),
        linear-gradient(90deg, transparent 8%, rgba(54, 39, 24, 0.08) 8.2%, transparent 8.4%),
        linear-gradient(0deg, transparent 50%, rgba(255, 255, 255, 0.08) 50.4%, transparent 50.8%),
        var(--paper);
    }

    .sheet::before {
      content: "";
      position: absolute;
      inset: 0.17in;
      border: 2px solid rgba(33, 24, 17, 0.78);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.26), 0 0 0 1px rgba(33, 24, 17, 0.14);
      pointer-events: none;
    }

    .sheet::after {
      content: "";
      position: absolute;
      inset: 0.28in;
      border: 1px dashed rgba(33, 24, 17, 0.18);
      pointer-events: none;
    }

    .page {
      position: relative;
      height: 10.32in;
      padding: 0.18in 0.2in 0.08in;
      z-index: 1;
    }

    .page-header,
    .page-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.2in;
      color: var(--iron);
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.2pt;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .page-header {
      padding-bottom: 0.08in;
      border-bottom: 1px solid rgba(33, 24, 17, 0.42);
      margin-bottom: 0.12in;
    }

    .page-footer {
      position: absolute;
      left: 0.2in;
      right: 0.2in;
      bottom: 0.02in;
      padding-top: 0.06in;
      border-top: 1px solid rgba(33, 24, 17, 0.32);
    }

    .content {
      position: relative;
      height: 9.58in;
      overflow: hidden;
    }

    .title-card {
      display: grid;
      grid-template-columns: 1fr 1.25in;
      gap: 0.18in;
      align-items: start;
      padding: 0.14in 0.16in 0.13in;
      border: 2px solid rgba(33, 24, 17, 0.72);
      background: rgba(242, 227, 189, 0.56);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
    }

    h1, h2, h3, p, ul {
      margin-top: 0;
    }

    h1 {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 29pt;
      line-height: 0.94;
      letter-spacing: 0.035em;
      text-transform: uppercase;
      margin-bottom: 0.05in;
    }

    .subtitle {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 12pt;
      text-transform: uppercase;
      letter-spacing: 0.13em;
      color: var(--wax);
      font-weight: 700;
      margin: 0 0 0.09in;
    }

    .source {
      display: grid;
      grid-template-columns: 0.92in 1fr;
      gap: 0.04in 0.09in;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.7pt;
      line-height: 1.28;
      color: var(--iron);
    }

    .source b {
      color: var(--ink);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .seal {
      width: 1.16in;
      height: 1.16in;
      border: 3px double var(--wax);
      border-radius: 0.08in;
      color: var(--wax);
      display: grid;
      place-items: center;
      text-align: center;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-weight: 800;
      font-size: 6.2pt;
      line-height: 1.1;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      transform: rotate(-8deg);
      padding: 0.06in;
      background: rgba(242, 227, 189, 0.22);
      box-shadow: inset 0 0 0 1px rgba(143, 47, 37, 0.18);
    }

    .seal .tower {
      font-size: 11pt;
      display: block;
      line-height: 1;
      color: var(--ink);
      letter-spacing: 0;
      margin: 0.025in 0;
    }

    .seal .seal-sub {
      display: block;
      font-size: 5.3pt;
      letter-spacing: 0.06em;
      color: var(--iron);
      margin-top: 0.02in;
    }

    .charter-kicker {
      font-family: "Trebuchet MS", Arial, sans-serif;
      color: var(--iron);
      text-transform: uppercase;
      letter-spacing: 0.105em;
      font-size: 7.8pt;
      line-height: 1.25;
      margin: -0.035in 0 0.09in;
    }

    h2 {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 11.2pt;
      line-height: 1.18;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: var(--ink);
      margin: 0.13in 0 0.055in;
      padding-bottom: 0.025in;
      border-bottom: 1px solid rgba(33, 24, 17, 0.3);
    }

    h3 {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 8.6pt;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0.085in 0 0.035in;
      color: var(--wax);
    }

    p {
      font-size: 9.25pt;
      line-height: 1.29;
      margin-bottom: 0.055in;
    }

    ul {
      padding-left: 0.17in;
      margin-bottom: 0.07in;
    }

    li {
      font-size: 8.65pt;
      line-height: 1.23;
      margin-bottom: 0.026in;
    }

    .lead {
      font-size: 10.2pt;
      line-height: 1.28;
    }

    .first-line {
      font-weight: 700;
      font-size: 10.6pt;
    }

    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.14in;
      align-items: start;
    }

    .wide-narrow {
      display: grid;
      grid-template-columns: 1.35fr 0.85fr;
      gap: 0.14in;
      align-items: start;
    }

    .narrow-wide {
      display: grid;
      grid-template-columns: 0.92fr 1.25fr;
      gap: 0.14in;
      align-items: start;
    }

    .box {
      border: 1.5px solid rgba(33, 24, 17, 0.62);
      background: rgba(242, 227, 189, 0.68);
      padding: 0.08in 0.1in 0.075in;
      margin: 0.085in 0;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
    }

    .box.wax {
      border-left: 0.08in solid var(--wax);
    }

    .box h3 {
      margin-top: 0;
    }

    .maxim {
      margin-top: 0.12in;
      font-size: 9.7pt;
      line-height: 1.3;
    }

    .caption {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.2pt;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: var(--iron);
    }

    .stamp {
      display: inline-block;
      border: 2px solid var(--wax);
      color: var(--wax);
      padding: 0.035in 0.06in;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 7.6pt;
      transform: rotate(-4deg);
      margin: 0.04in 0 0.06in;
    }

    .stamp.dark {
      color: var(--ink);
      border-color: var(--ink);
      transform: rotate(3deg);
    }

    .ledger-slip {
      border: 1.5px solid rgba(33, 24, 17, 0.55);
      background: rgba(242, 227, 189, 0.46);
      padding: 0.07in 0.085in;
      margin-top: 0.09in;
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr;
      gap: 0.08in;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 6.95pt;
      line-height: 1.18;
    }

    .ledger-slip b {
      display: block;
      color: var(--wax);
      letter-spacing: 0.07em;
      text-transform: uppercase;
      margin-bottom: 0.02in;
    }

    .thumbmark {
      position: absolute;
      width: 0.62in;
      height: 0.42in;
      border-radius: 50%;
      background: radial-gradient(ellipse at center, rgba(58, 40, 22, 0.15), rgba(58, 40, 22, 0.04) 58%, transparent 70%);
      transform: rotate(-18deg);
      pointer-events: none;
    }

    .tm1 { left: 0.58in; top: 0.82in; }
    .tm2 { right: 0.72in; bottom: 1.05in; transform: rotate(19deg); }
    .tm3 { left: 0.82in; bottom: 0.72in; transform: rotate(8deg); }

    .note {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.6pt;
      line-height: 1.25;
      color: var(--iron);
      background: rgba(255, 244, 210, 0.38);
      border-left: 3px solid var(--amber);
      padding: 0.055in 0.07in;
      margin: 0.07in 0;
    }

    .ledger {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.04in 0.08in;
      margin-top: 0.045in;
    }

    .ledger div {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.55pt;
      line-height: 1.15;
      border-bottom: 1px dotted rgba(33, 24, 17, 0.36);
      padding-bottom: 0.025in;
    }

    .field-note-grid {
      display: grid;
      grid-template-columns: 1.03fr 1.05fr;
      gap: 0.12in;
      align-items: stretch;
      margin-top: 0.11in;
    }

    .field-form {
      border: 1.5px solid rgba(33, 24, 17, 0.58);
      background: rgba(242, 227, 189, 0.56);
      padding: 0.075in 0.09in;
    }

    .field-lines {
      display: grid;
      grid-template-columns: 0.72in 1fr;
      gap: 0.025in 0.07in;
      margin-top: 0.045in;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 6.75pt;
      line-height: 1.05;
    }

    .field-lines b {
      color: var(--wax);
      text-transform: uppercase;
      letter-spacing: 0.055em;
    }

    .field-lines span {
      border-bottom: 1px dotted rgba(33, 24, 17, 0.45);
      min-height: 0.105in;
    }

    .field-diagram {
      position: relative;
      border: 1.5px solid rgba(33, 24, 17, 0.44);
      background:
        linear-gradient(45deg, transparent 48%, rgba(33, 24, 17, 0.055) 49%, transparent 50%),
        rgba(242, 227, 189, 0.42);
      min-height: 1.22in;
      overflow: hidden;
    }

    .field-diagram svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }

    .tally {
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.1pt;
      line-height: 1.15;
      letter-spacing: 0.08em;
      color: rgba(33, 24, 17, 0.56);
      margin-top: 0.045in;
    }

    .checklist {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.035in 0.08in;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 7.85pt;
      line-height: 1.16;
    }

    .checklist span::before {
      content: "[ ] ";
      color: var(--wax);
      font-weight: 900;
    }

    .route-sketch {
      position: absolute;
      right: 0.16in;
      bottom: 0.46in;
      width: 2.1in;
      height: 1.15in;
      opacity: 0.46;
      pointer-events: none;
    }

    .route-sketch svg {
      width: 100%;
      height: 100%;
    }

    .margin-note {
      position: absolute;
      font-family: "Trebuchet MS", Arial, sans-serif;
      color: rgba(33, 24, 17, 0.56);
      font-size: 7.6pt;
      line-height: 1.15;
      transform: rotate(-4deg);
      max-width: 1.2in;
    }

    .mn1 { right: 0.25in; top: 4.15in; }
    .mn2 { left: 0.25in; bottom: 1.0in; transform: rotate(3deg); }
    .mn3 { right: 0.28in; top: 2.55in; transform: rotate(5deg); }

    .compact p {
      font-size: 8.75pt;
      line-height: 1.24;
      margin-bottom: 0.045in;
    }

    .compact li {
      font-size: 8.15pt;
      line-height: 1.18;
    }

    .tight h2 {
      margin-top: 0.1in;
    }

    .skills {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.05in 0.09in;
    }

    .skill {
      border-bottom: 1px dotted rgba(33, 24, 17, 0.32);
      padding-bottom: 0.035in;
      font-size: 7.8pt;
      line-height: 1.18;
    }

    .skill b {
      color: var(--wax);
      font-family: "Trebuchet MS", Arial, sans-serif;
      text-transform: uppercase;
      font-size: 7.2pt;
      letter-spacing: 0.05em;
    }

    .signoff {
      margin-top: 0.08in;
      padding-top: 0.08in;
      border-top: 1px solid rgba(33, 24, 17, 0.32);
      font-family: "Trebuchet MS", Arial, sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      font-size: 7.8pt;
    }

    .notice .page-header {
      border: 3px solid rgba(33, 24, 17, 0.72);
      justify-content: center;
      padding: 0.09in 0.12in;
      margin-bottom: 0.14in;
      background: rgba(242, 227, 189, 0.5);
      font-size: 13pt;
      color: var(--ink);
    }

    .notice .page-header span:first-child {
      display: none;
    }

    .notice .page-header span:last-child {
      font-weight: 800;
      letter-spacing: 0.11em;
    }

    .notice .content {
      border-left: 0.06in solid rgba(143, 47, 37, 0.72);
      padding-left: 0.12in;
    }

    .field-page .page-header {
      border: 2px solid rgba(33, 24, 17, 0.64);
      padding: 0.08in 0.1in;
      background: rgba(242, 227, 189, 0.42);
      margin-bottom: 0.1in;
    }

    .field-page .page-header span:first-child {
      font-size: 12pt;
      color: var(--ink);
      font-weight: 800;
    }

    .letter .page-header {
      border-bottom: 0;
      margin-bottom: 0.06in;
      padding-bottom: 0;
      font-style: italic;
      text-transform: none;
      letter-spacing: 0.02em;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 8.2pt;
    }

    .letter-paper {
      border: 1.5px solid rgba(33, 24, 17, 0.5);
      background: rgba(242, 227, 189, 0.38);
      padding: 0.11in 0.14in;
      height: 9.08in;
      position: relative;
    }

    .letter-paper::before {
      content: "Roads desk copy";
      position: absolute;
      right: 0.18in;
      top: 0.12in;
      transform: rotate(3deg);
      color: rgba(143, 47, 37, 0.64);
      border: 1.5px solid rgba(143, 47, 37, 0.62);
      padding: 0.025in 0.045in;
      font-family: "Trebuchet MS", Arial, sans-serif;
      font-size: 6.4pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .letter-paper h2:first-of-type {
      margin-top: 0;
    }

    .letter .signoff {
      border-top: 0;
      margin-top: 0.05in;
      padding-top: 0;
    }

    .charter.sheet::before {
      inset: 0.19in;
      border: 3px double rgba(33, 24, 17, 0.74);
      box-shadow: inset 0 0 0 1px rgba(143, 47, 37, 0.2);
    }

    .charter.sheet::after {
      inset: 0.37in;
      border: 0;
      border-top: 1px solid rgba(33, 24, 17, 0.18);
      border-bottom: 1px solid rgba(33, 24, 17, 0.14);
    }

    .charter .page-header {
      border-bottom: 0;
      margin-bottom: 0.05in;
      padding-bottom: 0;
    }

    .charter .title-card {
      display: block;
      min-height: 2.48in;
      padding: 0.2in 0.22in 0.16in;
      border: 3px double rgba(33, 24, 17, 0.76);
      background:
        radial-gradient(circle at 79% 42%, rgba(143, 47, 37, 0.055), transparent 18%),
        rgba(242, 227, 189, 0.46);
      position: relative;
    }

    .charter h1 {
      font-size: 37pt;
      max-width: 5.2in;
    }

    .charter .subtitle {
      font-size: 13.2pt;
      margin-bottom: 0.06in;
    }

    .charter .charter-kicker {
      max-width: 5.35in;
      margin-bottom: 0.12in;
    }

    .charter .source {
      width: 4.85in;
      padding-top: 0.07in;
      border-top: 1px solid rgba(33, 24, 17, 0.38);
    }

    .charter .seal {
      position: absolute;
      right: 0.32in;
      top: 0.28in;
      width: 1.28in;
      height: 1.08in;
      border-width: 3px;
      transform: rotate(-7deg);
      background: rgba(242, 227, 189, 0.32);
    }

    .charter .stamp {
      margin-left: 0.08in;
      margin-top: 0.07in;
      font-size: 8.4pt;
      transform: rotate(-4deg);
    }

    .notice.sheet::before {
      inset: 0.2in;
      border: 2px solid rgba(33, 24, 17, 0.76);
    }

    .notice.sheet::after {
      inset: 0.42in;
      border: 0;
      border-left: 0.055in solid rgba(143, 47, 37, 0.72);
    }

    .notice .note {
      width: 96%;
      margin-left: 0.04in;
      transform: rotate(-0.5deg);
      background: rgba(248, 230, 184, 0.72);
      border-left: 0.035in solid var(--amber);
    }

    .notice .ledger-slip {
      transform: rotate(-0.15deg);
      background: rgba(242, 227, 189, 0.62);
      box-shadow: 0.04in 0.04in 0 rgba(33, 24, 17, 0.05);
    }

    .notice .stamp.dark {
      margin-left: 0.03in;
      margin-bottom: 0.07in;
      transform: rotate(3deg);
    }

    .field-page.sheet::before {
      inset: 0.16in;
      border: 1.5px solid rgba(33, 24, 17, 0.72);
    }

    .field-page.sheet::after {
      inset: 0.31in;
      border: 1px dotted rgba(33, 24, 17, 0.24);
    }

    .field-page .field-note-grid {
      grid-template-columns: 0.82fr 1.24fr;
    }

    .field-page .field-form {
      min-height: 1.43in;
      background: rgba(242, 227, 189, 0.64);
    }

    .field-page .field-lines {
      gap: 0.032in 0.075in;
      font-size: 7.1pt;
    }

    .field-page .field-lines span {
      min-height: 0.128in;
    }

    .field-page .field-diagram {
      min-height: 1.43in;
      background:
        linear-gradient(45deg, transparent 48%, rgba(33, 24, 17, 0.06) 49%, transparent 50%),
        linear-gradient(0deg, transparent 49%, rgba(33, 24, 17, 0.035) 50%, transparent 51%),
        rgba(242, 227, 189, 0.5);
    }

    .field-page .box,
    .field-page .ledger div {
      background: rgba(242, 227, 189, 0.52);
    }

    .letter.sheet::before {
      inset: 0.17in;
      border: 1.5px solid rgba(33, 24, 17, 0.58);
    }

    .letter.sheet::after {
      inset: 0.32in;
      border: 0;
      border-top: 1px solid rgba(33, 24, 17, 0.13);
      border-bottom: 1px solid rgba(33, 24, 17, 0.12);
    }

    .letter .letter-paper {
      transform: rotate(0.18deg);
      box-shadow: 0.05in 0.05in 0 rgba(33, 24, 17, 0.045);
      border-style: solid;
      background:
        linear-gradient(0deg, transparent 68%, rgba(255,255,255,.08) 68.2%, transparent 68.5%),
        rgba(242, 227, 189, 0.46);
    }

    .letter h2 {
      border-bottom: 1px solid rgba(33, 24, 17, 0.22);
      letter-spacing: 0.065em;
    }

    .letter .page-footer {
      border-top: 0;
      font-style: italic;
      text-transform: none;
      letter-spacing: 0.03em;
    }

    @media screen {
      .sheet {
        margin: 0.25in auto;
        box-shadow: 0 16px 60px rgba(0, 0, 0, 0.45);
      }
    }
  </style>
</head>
<body>
  <section class="sheet charter" data-page="1">
    <div class="thumbmark tm1"></div>
    <div class="page">
      <div class="page-header">
        <span>The Keep Gatehouse</span>
        <span>Outer Road Permit // Charter Copy</span>
      </div>
      <main class="content">
        <div class="title-card">
          <div>
            <h1>Keep on the Borderlands</h1>
            <p class="subtitle">Frontier Expedition Charter</p>
            <p class="charter-kicker">A provisional road-writ for chartered companies passing beyond the outer patrol</p>
            <div class="source">
              <b>Issued at</b><span>The Keep Gatehouse</span>
              <b>Recognized by</b><span>Office of the Castellan</span>
              <b>Bearer</b><span>Chartered Company</span>
              <b>Authority</b><span>Outer Road Leave</span>
              <b>Warning</b><span>Valid inside the walls; disputed beyond them</span>
            </div>
          </div>
          <div class="seal"><span>Road Leave<br />Granted<span class="tower">[GATE]</span><span class="seal-sub">Return With Report</span></span></div>
        </div>

        <div class="stamp">Gatehouse Copy</div>

        <h2>Welcome to the Borderlands</h2>
        <p class="first-line">You have reached the last reliable stone before the wild country takes offense.</p>
        <p>The Keep stands where the road thins, where old maps disagree, and where the civilized world prefers to believe its borders are firmer than they are. Behind these walls are beds, witnesses, market stalls, chapel bells, bored guards, frightened merchants, and people who will swear they have always believed in brave adventurers so long as the brave adventurers stand between them and whatever comes down from the hills.</p>
        <p>Beyond these walls are ravines, broken trails, abandoned works, old caves, hidden camps, rival claims, and things that have learned to wait. Some are beasts. Some are bandits. Some are hungry. Some are organized. Some will speak before they strike, which does not make them safer.</p>
        <p>This charter grants your company provisional leave to operate beyond the Keep's ordinary patrol range. It does not grant immunity from consequence, immunity from bad judgment, or the right to drag every disaster you find back through the gate and call it civic service.</p>
        <p>If you return with useful knowledge, the Keep will listen. If you return with proof of danger, the Keep may act. If you return with treasure, do not pretend you found it by accident. If you return with fewer companions than you departed with, report the circumstances plainly.</p>

        <div class="box wax maxim">
          <h3>Operational Maxim</h3>
          <p><strong>A living scout with a poor map is of more use than a dead hero with a perfect one.</strong> Learn what waits beyond the road. Choose your ground. Return when wisdom says return.</p>
        </div>

        <h2>The Charter</h2>
        <p>By authority of the Castellan's office, the bearer company is recognized as a provisional expedition band operating in the unsettled lands beyond the Keep.</p>
        <p>The Keep will value accurate reports, recoverable supplies, routes made safer, enemies understood, captives returned, and avoidable panic avoided. The Keep will not value boasts that cannot be checked.</p>
        <div class="route-sketch" aria-hidden="true">
          <svg viewBox="0 0 300 160" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 126 C72 95 80 120 126 81 C160 52 191 71 282 23" fill="none" stroke="#201812" stroke-width="3" stroke-dasharray="7 6"/>
            <path d="M35 110 l18 -12 l18 18 l-15 15 z M208 50 c20 -18 38 -11 45 12 c-23 -2 -37 6 -45 -12z" fill="none" stroke="#8f2f25" stroke-width="3"/>
            <circle cx="126" cy="82" r="8" fill="none" stroke="#201812" stroke-width="3"/>
            <text x="18" y="148" font-family="Trebuchet MS" font-size="16" fill="#201812">road // ravine // cave marks</text>
          </svg>
        </div>
      </main>
      <div class="page-footer"><span>Outer Road Permit // Return to the Castellan's Clerk</span><span>Page 1 of 4</span></div>
    </div>
  </section>

  <section class="sheet notice" data-page="2">
    <div class="page">
      <div class="page-header">
        <span>Quartermaster Copy</span>
        <span>Read Before Passing the Gate</span>
      </div>
      <main class="content compact">
        <div class="stamp dark">Posted at the East Gate</div>
        <div class="two-col">
          <div>
            <h2>This Charter Permits</h2>
            <ul>
              <li>Travel beyond the outer road and marked patrol boundary.</li>
              <li>Investigate caves, ruins, camps, trails, shrines, ravines, and other sites of strategic concern.</li>
              <li>Recover goods, records, signs, tools, maps, and materials abandoned beyond protected territory.</li>
              <li>Report hostile movements, unnatural hazards, missing travelers, and changes in road safety.</li>
              <li>Negotiate when negotiation preserves lives, knowledge, or strategic advantage.</li>
              <li>Defend yourselves when threatened.</li>
            </ul>
          </div>
          <div>
            <h2>This Charter Does Not Permit</h2>
            <ul>
              <li>Start private wars under the Keep's name.</li>
              <li>Promise military support the Castellan has not authorized.</li>
              <li>Threaten farmers, travelers, pilgrims, merchants, or Keep personnel.</li>
              <li>Conceal hazards that may endanger the road.</li>
              <li>Assume every armed stranger is an enemy.</li>
              <li>Assume every polite stranger is a friend.</li>
            </ul>
          </div>
        </div>

        <div class="note">Quartermaster's note: rope is cheaper than rescue.</div>
        <div class="stamp dark">Supplies Advised</div>

        <h2>Campaign Tone: Frontier Pressure, Old Roads, and Hard-Won Victories</h2>
        <p>This is a campaign about the edge of safety. The Keep is your base, market, rumor mill, court of public opinion, shelter from weather and pursuit, and the place where your reputation begins to matter.</p>
        <p>The wilderness beyond the Keep is not empty space between set pieces. Roads matter. Time matters. Light matters. Noise matters. Who saw your fire matters. Which trail you used and which trail you ignored may matter later.</p>
        <p>Expect scouting, planning, negotiation, tactical combat, uncertain information, and decisions made before every sword is drawn. Some victories will be clean. Some will be narrow. Some will look like choosing not to fight yet. Some will look like retreating with enough information to return better prepared.</p>
        <div class="box wax">
          <p><strong>This is not punishment. This is pressure.</strong> The campaign rewards attention and teamwork. Ask questions, test assumptions, talk to people, compare rumors, watch the terrain, plan exits, and treat the world as something alive.</p>
        </div>

        <h2>Player Buy-In: Terms of Company Conduct</h2>
        <p>Your character should have a reason to risk danger on the frontier. That reason may be noble, practical, desperate, scholarly, spiritual, mercenary, personal, or complicated. You do not need to be a flawless hero. You do need enough reason to leave the walls and enough sense to work with the people who leave beside you.</p>
        <p>Your character should be willing to operate as part of an expedition company: sharing information, making plans, accepting that other characters may see risks differently, and staying engaged when the smart answer is not the loudest one.</p>
        <p>Newer adventurers can thrive here by being curious, consistent, and willing to think with the group. Bring a character who can want something, fear something, learn something, and still show up when the company gathers at the gate.</p>
        <p>Disagreement is welcome. Sabotage of the party's ability to function is not. Characters who reject all cooperation, attack every stranger, or treat retreat as shame will have a harder time than characters who adapt.</p>
        <div class="ledger-slip">
          <div><b>Rope first</b>Cheap until needed.</div>
          <div><b>Ask chapel</b>Lost names travel there.</div>
          <div><b>No soldiers</b>Do not promise what the Keep cannot spare.</div>
          <div><b>Report back</b>Truth before glory.</div>
        </div>
      </main>
      <div class="page-footer"><span>Road Ledger Mark // Valid inside the walls; disputed beyond them</span><span>Page 2 of 4</span></div>
    </div>
  </section>

  <section class="sheet field-page" data-page="3">
    <div class="thumbmark tm2"></div>
    <div class="page">
      <div class="page-header">
        <span>Outer-Road Field Sheet</span>
        <span>Mark water / smoke / tracks / witness</span>
      </div>
      <main class="content compact tight">
        <div class="field-note-grid" style="margin-top:0;margin-bottom:.09in">
          <div class="field-form">
            <h3>Company Return Note</h3>
            <div class="field-lines">
              <b>Route</b><span></span>
              <b>Water</b><span></span>
              <b>Smoke</b><span></span>
              <b>Tracks</b><span></span>
            </div>
            <div class="tally">supply ticks: |||| / ||| / |||||</div>
          </div>
          <div class="field-diagram" aria-label="Sketch of outer road and cave-country markers">
            <svg viewBox="0 0 420 180" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 138 C82 88 122 144 174 98 C229 48 278 72 398 30" fill="none" stroke="#201812" stroke-width="4" stroke-dasharray="10 8" opacity=".62"/>
              <path d="M64 114 c34 -42 76 -36 104 -2" fill="none" stroke="#4a4437" stroke-width="3" opacity=".42"/>
              <path d="M254 61 c31 -21 66 -7 78 25 c-35 -5 -58 6 -78 -25z" fill="none" stroke="#8f2f25" stroke-width="4" opacity=".72"/>
              <path d="M330 56 l28 -18 l30 27 l-20 20 z" fill="none" stroke="#8f2f25" stroke-width="4" opacity=".58"/>
              <circle cx="174" cy="98" r="11" fill="none" stroke="#201812" stroke-width="4" opacity=".62"/>
              <text x="24" y="26" font-family="Trebuchet MS, Arial" font-size="14" fill="#201812" opacity=".72">outer road sketch // not to scale</text>
              <text x="282" y="109" font-family="Trebuchet MS, Arial" font-size="12" fill="#8f2f25" opacity=".8">cave marks</text>
            </svg>
          </div>
        </div>
        <div class="two-col">
          <div class="box">
            <h3>This Campaign Is</h3>
            <ul>
              <li>A frontier expedition campaign where the party chooses routes, priorities, and risks.</li>
              <li>A game of scouting, preparation, negotiation, tactical danger, and hard-earned progress.</li>
              <li>A campaign where the Keep and the wilds respond to what the party does.</li>
              <li>A place where monsters, factions, travelers, merchants, and local powers may all have motives.</li>
              <li>A campaign where information is valuable and a good retreat can be a victory.</li>
              <li>Beginner-friendly, provided players ask questions and work with the table.</li>
              <li>Consequence-driven without being adversarial.</li>
            </ul>
          </div>
          <div class="box">
            <h3>This Campaign Is Not</h3>
            <ul>
              <li>A scripted tour where every problem waits in one correct order.</li>
              <li>A campaign where every fight is guaranteed to be fair if you happen to find it.</li>
              <li>A punishment machine designed to embarrass new players.</li>
              <li>A nostalgia exhibit about how games used to be played.</li>
              <li>A place where reckless violence automatically produces heroic outcomes.</li>
              <li>A solo-protagonist story where one character's impulses matter more than the company.</li>
            </ul>
          </div>
        </div>

        <p class="lead"><strong>The purpose of the danger is not to defeat you.</strong> The purpose of the danger is to make your choices matter.</p>

        <div class="wide-narrow">
          <div>
            <h2>The Keep and the Wild Beyond</h2>
            <p>The Keep survives because it is useful, armed, watched, and afraid in the proper measure. Within the walls are people who want the road open, people who profit from fear, people who have lost family beyond the patrol markers, and people who think adventurers are necessary trouble.</p>
            <p>A company with a good reputation may gain better information, better access, better prices, and better warnings. A careless reputation may close doors, poison rumors, and make guards suddenly very interested in paperwork.</p>
            <p>Beyond the Keep, assume less. Old roads may lead somewhere useful, or somewhere that used to be useful. Cave-country is rarely empty. Camps move. Tracks cross. Smoke lies.</p>
          </div>
          <div class="box">
            <h3>Report What You Learn</h3>
            <div class="checklist">
              <span>Name</span><span>Route</span>
              <span>Hazard</span><span>Witness</span>
              <span>Proof</span><span>Water</span>
              <span>Smoke</span><span>Tracks</span>
            </div>
          </div>
        </div>

        <h2>Expedition Work</h2>
        <p>Expedition work is not merely walking until danger appears. A competent company considers the route, light, noise, time, supplies, information, reputation, prisoners, parley, and retreat.</p>
        <div class="box wax">
          <h3>Expedition Checklist</h3>
          <div class="checklist">
            <span>Known path</span><span>Way back</span>
            <span>Light discipline</span><span>Noise discipline</span>
            <span>Food and water</span><span>Rope and oil</span>
            <span>Rumors checked</span><span>Exit plan</span>
          </div>
        </div>
        <div class="ledger">
          <div>Scout a road, ravine, cave mouth, ruin, or abandoned camp.</div>
          <div>Identify who or what is threatening travelers.</div>
          <div>Recover a missing person, goods, records, or proof.</div>
          <div>Map a route that patrols cannot safely hold.</div>
          <div>Confirm whether a rumor is harmless, profitable, dangerous, or all three.</div>
          <div>Negotiate safe passage, warning, exchange, or temporary alliance.</div>
        </div>
      </main>
      <div class="page-footer"><span>Field Copy // Return with truth before glory</span><span>Page 3 of 4</span></div>
    </div>
  </section>

  <section class="sheet letter" data-page="4">
    <div class="thumbmark tm3"></div>
    <div class="page">
      <div class="page-header">
        <span>Return to the Castellan's Clerk</span>
        <span>Initial Briefing and Return Instructions</span>
      </div>
      <main class="content compact tight letter-paper">
        <h2>Useful Character Tools</h2>
        <div class="skills">
          <div class="skill"><b>Perception</b><br />Spot tracks, ambush signs, hidden entrances, and useful details before they become emergencies.</div>
          <div class="skill"><b>Investigation</b><br />Make sense of ruins, camps, maps, mechanisms, patterns, and conflicting reports.</div>
          <div class="skill"><b>Survival</b><br />Follow trails, read terrain, find water, predict travel trouble, and avoid getting lost.</div>
          <div class="skill"><b>Stealth</b><br />Approach quietly, observe without starting a fight, and leave before something notices you.</div>
          <div class="skill"><b>Insight</b><br />Judge motives, fear, lies, morale, and whether a negotiation is about to sour.</div>
          <div class="skill"><b>Persuasion</b><br />Gather rumors, calm frightened people, negotiate passage, and build trust.</div>
          <div class="skill"><b>Athletics</b><br />Climb, haul, force, swim, brace, retreat, and survive rough terrain.</div>
          <div class="skill"><b>Lore Skills</b><br />Arcana, History, Nature, and Religion help read old signs, ruins, shrines, creatures, and warnings.</div>
        </div>

        <div class="narrow-wide">
          <div class="box">
            <h3>Tools That Help</h3>
            <p>Cartographer's tools, navigator's tools, herbalism kit, thieves' tools, healer's kit, rope work, trap awareness, languages, rituals, detection magic, light management, mobility, healing, and ways to solve problems quietly.</p>
          </div>
          <div class="box">
            <h3>Character Prompts</h3>
            <ul>
              <li>I need money, but not at any price.</li>
              <li>I lost someone beyond the road.</li>
              <li>I want the Keep to survive, even if I dislike who commands it.</li>
              <li>I need a second chance and the frontier is the only place offering one.</li>
              <li>I am looking for a place, person, relic, route, truth, or name the maps failed to keep.</li>
            </ul>
          </div>
        </div>

        <h2>First Expedition Briefing</h2>
        <p>The Castellan's office has received too many reports that agree in the wrong places. Travelers on the outer road have gone missing. A muleteer returned without his load and with an arrow in his wagon board. Smoke has been seen near cave-country where no lawful camp has been recorded.</p>
        <p>None of these reports prove a single organized threat. Together, they prove enough to be inconvenient.</p>
        <div class="two-col">
          <div class="box wax">
            <h3>Primary Objectives</h3>
            <ul>
              <li>Confirm whether the outer road is being watched or tested.</li>
              <li>Locate signs of camps, cave traffic, ambush points, or organized movement.</li>
              <li>Identify immediate threats to travelers or the Keep.</li>
              <li>Recover evidence where possible.</li>
              <li>Return with a usable report.</li>
            </ul>
          </div>
          <div class="box">
            <h3>Known Complications</h3>
            <ul>
              <li>The Keep cannot spare soldiers without weakening the walls.</li>
              <li>Merchants want the road declared safe before anyone knows whether it is.</li>
              <li>Intelligent enemies and frightened people are both possible. Do not confuse the two if you can help it.</li>
            </ul>
          </div>
        </div>

        <h2>Final Instruction</h2>
        <p>You are not being sent beyond the walls because the Keep thinks you are invincible. You are being sent because the Keep cannot survive on walls alone.</p>
        <p><strong>Carry rope. Count arrows. Listen before opening doors.</strong> Ask why a trail exists. Treat strangers as people before treating them as problems. Treat problems as real before treating them as stories.</p>
        <p>If you must fight, fight with a plan. If you must run, run toward tomorrow. If you return, return with something the Keep did not know.</p>
        <div class="signoff">
          Marwen Thrice-Locked<br />
          Deputy Clerk of Roads and Warnings<br />
          Office of the Castellan
        </div>
        <div class="stamp">Authorized Beyond Outer Road</div>
        <div class="margin-note mn3">return with report</div>
      </main>
      <div class="page-footer"><span>Gatehouse Copy // Road Leave Recorded</span><span>Page 4 of 4</span></div>
    </div>
  </section>
</body>
</html>`;

fs.writeFileSync(sourcePath, html, "utf8");

const notes = `# Keep on the Borderlands PDF Production Notes

## Artifact

- PDF: \`public/downloads/keep-on-the-borderlands-frontier-expedition-charter.pdf\`
- Review previews: \`campaign-brief-pdf-review/keep-on-the-borderlands/\`
- Review packet: \`campaign-brief-pdf-review/keep-on-the-borderlands-review-packet.zip\`

## Source Inputs

- \`docs/campaign-briefs/keep-on-the-borderlands-frontier-expedition-charter.md\`
- \`docs/campaign-briefs/keep-on-the-borderlands-pdf-layout-plan.md\`
- Black Lanterns Operation Brief was used as structural inspiration only.

## Layout Summary

- 4-page US Letter portrait PDF.
- Fixed page layout exported from an HTML/CSS print source.
- Worn parchment frontier charter style.
- Gatehouse permit / quartermaster road packet identity.
- Simple black border, fold marks, weather stains, wax-red gatehouse stamps, road-leave mark, route/cave sketch motifs, marginal notes, supply checklist styling, copied-charter headers/footers, and page numbering.

## Content Handling

The approved tone and all required core sections are preserved:

- Welcome to the Borderlands
- The Charter
- Campaign Tone
- Player Buy-In
- What This Campaign Is / Is Not
- The Keep and the Wild Beyond
- Expedition Work
- Useful Character Tools
- First Expedition Briefing
- Final Instruction

Content was lightly shortened and reorganized for PDF readability:

- Long descriptive paragraphs were condensed.
- Charter permissions/prohibitions were moved into parallel lists.
- Expedition considerations were boxed as a practical checklist.
- Useful skills were condensed into short skill entries.
- Character hooks were boxed as prompts.
- Human-review notes, assumptions, and production/layout notes from the Markdown source were excluded from the player-facing PDF body.

## QA Notes

- The PDF is intended for human visual review, not final publishing.
- The handout avoids website CTA language, pricing, testimonials, and public sales copy.
- The PDF should remain readable at normal zoom, with no tiny body text or intentionally hidden critical information.
- Decorative marginalia is non-essential; all important content appears in body text, lists, or callout boxes.

## Draft 4 Structural Rebuild

This revision rebuilds the PDF as a bundled frontier packet rather than one uniform mission-style document. The four pages now read as distinct papers gathered together at the Keep.

Page identities:

- Page 1: Gatehouse Charter. A rough formal road-writ issued at the gate, with a large title, grounded ledger block, wax-red authorization stamp, and Operational Maxim.
- Page 2: Gatehouse Notice / Rules of Charter. A posted warning sheet with permit/prohibition columns, public gate-warning language, quartermaster slip, and Terms of Company Conduct.
- Page 3: Outer-Road Field Sheet. A practical mark-up sheet with supply ticks, route sketch, field-note lines, checkboxes, report marks, and the Expedition Checklist.
- Page 4: Briefing Letter / Return Instructions. A more letter-like dispatch from Marwen Thrice-Locked, Deputy Clerk of Roads and Warnings, with Useful Character Tools, First Expedition Briefing, boxed objectives/complications, and Final Instruction.

Dossier-like elements removed or softened:

- Reduced the uniform repeated page template as the dominant visual language.
- Reduced rigid file-code/footer energy from the visible page design.
- Reduced repeated top bars and formal filing language.
- Replaced generalized official-document framing with gatehouse, notice-board, field-sheet, and letter-specific artifact identities.

Frontier-packet elements added:

- Gatehouse charter ledger fields.
- Posted notice-board styling on page 2.
- Quartermaster note slip and practical margin language.
- Expanded field form/checklist identity on page 3.
- Larger hand-drawn road/cave sketch.
- Mud smudges, fold marks, weathering, supply ticks, rough stamps, and practical return/report language.
- Fictional signatory: Marwen Thrice-Locked, Deputy Clerk of Roads and Warnings, Office of the Castellan.

Content changes made:

- No required section was removed.
- No pricing, testimonials, website CTA language, or public sales copy was added.
- No campaign page copy, routing, pricing, CTA labels, form logic, metadata, or website files were changed.
- The approved 4-page structure was preserved.

## Draft 4 QA Results

- PDF exported successfully.
- PDF opens and text can be extracted.
- Page count: 4.
- File size: 325,115 bytes / approximately 0.31 MB.
- Preview images generated for all 4 pages.
- Layout overflow check: passed for all pages.
- Required-section text check: passed for all required sections.
- Public sales/forbidden language scan: passed for \`Subscribe\`, \`Join Now\`, \`Add To Cart\`, \`$0\`, \`$12/hour\`, \`testimonial\`, and \`Reserve a Free Session Zero\`.
- Dossier-language reduction scan: passed for \`Frontier Expedition Authority\`, \`KOB-FC-001\`, \`Filed under\`, \`Seal status\`, and \`Tower-Gate Authority\`.
- Visual review pass: pages are readable at normal preview scale, with no obvious text cut off.

## Draft 5 Page-Level Physical Differentiation Pass

This pass keeps the approved content intact and focuses on making the four pages feel like separate papers bundled together, not four pages of one shared template.

Per-page changes:

- Page 1: Strengthened the gatehouse charter feel with a larger title hierarchy, certificate-like double border, central road-leave stamp, softened header treatment, and ledger fields that read more like marks on a charter than a file record.
- Page 2: Strengthened the posted notice feel with a bolder notice-board heading, heavier public-warning border, left-side posted-strip treatment, pinned/scrap-like quartermaster notes, and clearer public rules energy.
- Page 3: Strengthened the field sheet direction with a larger route-sketch area, more prominent fillable company return note, stronger checklist/form styling, lighter border treatment, and practical mark-up space.
- Page 4: Strengthened the folded briefing-letter feel with softer italic dispatch headings, an inner letter paper panel, lighter footer treatment, subtle rotation/shadow, roads-desk copy stamp, and retained Marwen Thrice-Locked signatory.

Content changes made:

- No substantial content rewrite.
- No required section was removed.
- The section name \`Player Buy-In\` was restored in the page 2 heading as \`Player Buy-In: Terms of Company Conduct\` so the approved section remains explicit.
- No pricing, testimonials, website CTA language, public sales copy, campaign page copy, routing, pricing, CTA labels, form logic, metadata, or website files were changed.

## Draft 5 QA Results

- PDF exported successfully.
- PDF opens and text can be extracted.
- Page count: 4.
- File size: 357,801 bytes / approximately 0.34 MB.
- Preview images generated for all 4 pages.
- Layout overflow check: passed for all pages.
- Required-section text check: passed for all required sections.
- Public sales/forbidden language scan: passed for \`Subscribe\`, \`Join Now\`, \`Add To Cart\`, \`$0\`, \`$12/hour\`, \`testimonial\`, and \`Reserve a Free Session Zero\`.
- Artifact-identity check: passed for gatehouse charter, posted gate notice, outer-road field sheet, briefing letter, and Marwen Thrice-Locked signatory.
- Visual review pass: pages are readable at normal preview scale, with no obvious text cut off.

## Human Review Focus

Please review:

- Does the frontier charter mood feel right for Keep on the Borderlands?
- Is the text readable enough for real player use?
- Does the design feel official but practical, rather than overly polished?
- Are any sections too compressed?
- Should the final PDF use this 4-page structure, or should it expand to 5-6 pages for more breathing room?
`;

fs.writeFileSync(notesPath, notes, "utf8");

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 850, height: 1100, deviceScaleFactor: 2 },
  });

  await page.goto("file://" + sourcePath.replace(/\\/g, "/"), { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "print" });

  const overflowReport = await page.$$eval(".sheet", (sheets) =>
    sheets.map((sheet, index) => {
      const content = sheet.querySelector(".content");
      return {
        page: index + 1,
        sheetScrollHeight: sheet.scrollHeight,
        sheetClientHeight: sheet.clientHeight,
        contentScrollHeight: content ? content.scrollHeight : null,
        contentClientHeight: content ? content.clientHeight : null,
        overflows: content ? content.scrollHeight > content.clientHeight + 2 : false,
      };
    })
  );

  await page.pdf({
    path: pdfPath,
    width: "8.5in",
    height: "11in",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });

  await page.emulateMedia({ media: "screen" });
  for (let i = 1; i <= 4; i += 1) {
    const locator = page.locator(`.sheet[data-page="${i}"]`);
    await locator.screenshot({
      path: path.join(reviewDir, `page-${String(i).padStart(2, "0")}.png`),
    });
  }

  await browser.close();

  const stats = fs.statSync(pdfPath);
  const qa = {
    generatedAt: new Date().toISOString(),
    pdfPath,
    sourcePath,
    notesPath,
    reviewDir,
    expectedPageCount: 4,
    pdfSizeBytes: stats.size,
    pdfSizeMb: Number((stats.size / 1024 / 1024).toFixed(3)),
    overflowReport,
    generatedPreviewImages: [1, 2, 3, 4].map((i) => path.join(reviewDir, `page-${String(i).padStart(2, "0")}.png`)),
  };

  fs.writeFileSync(qaPath, JSON.stringify(qa, null, 2), "utf8");
  console.log(JSON.stringify(qa, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
