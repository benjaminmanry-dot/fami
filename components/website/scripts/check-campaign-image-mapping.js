const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const remote = {
  drakkenheim:
    'https://images.squarespace-cdn.com/content/v1/699ec7cef7db606f11d4dafe/1772013522793-2RR4CZD10XALFQGK54SJ/drakk.png',
  waterdeep:
    'https://images.squarespace-cdn.com/content/v1/699ec7cef7db606f11d4dafe/1772013522772-HTKWFWGVOI2R3ENY4PTB/waterdeep.png',
};

const pages = [
  {
    page: '/',
    file: 'index.html',
    cards: [
      ['Keep on the Borderlands', 'Keep on the Borderlands', '/assets/campaigns/keep-on-the-borderlands-card-v1.webp'],
      ['Dungeons of Drakkenheim', 'Dungeons of Drakkenheim', remote.drakkenheim],
      ['Epic Quests', 'Epic Quests', '/assets/campaigns/epic-quests-card-v1.webp'],
    ],
  },
  {
    page: '/austin/',
    file: 'austin/index.html',
    cards: [
      ['austin-keep-on-the-borderlands', 'Keep on the Borderlands', '/assets/campaigns/keep-on-the-borderlands-card-v1.webp'],
      ['austin-drakkenheim', 'Dungeons of Drakkenheim', remote.drakkenheim],
      ['austin-thrones-of-the-djinni-lords', 'Thrones of the Djinni Lords', '/assets/campaigns/thrones-of-the-djinni-lords-card-v1.webp'],
      ['austin-eberron-black-lanterns', 'Eberron: Black Lanterns', '/assets/campaigns/eberron-black-lanterns-card-v1.webp'],
      ['austin-vecna-eve-of-ruin', 'Vecna: Eve of Ruin', '/assets/campaigns/vecna-eve-of-ruin-card-v1.webp'],
      ['austin-avylan', 'Avylan', '/assets/campaigns/avylan-card-v1.webp'],
      ['austin-waterdeep', 'Waterdeep', remote.waterdeep],
      ['austin-epic-quests', 'Epic Quests', '/assets/campaigns/epic-quests-card-v1.webp'],
    ],
  },
  {
    page: '/campaigns/',
    file: 'campaigns/index.html',
    cards: [
      ['keep-on-the-borderlands', 'Keep on the Borderlands', '/assets/campaigns/keep-on-the-borderlands-card-v1.webp'],
      ['drakkenheim', 'Dungeons of Drakkenheim', remote.drakkenheim],
      ['thrones-of-the-djinni-lords', 'Thrones of the Djinni Lords', '/assets/campaigns/thrones-of-the-djinni-lords-card-v1.webp'],
      ['eberron-black-lanterns', 'Eberron: Black Lanterns', '/assets/campaigns/eberron-black-lanterns-card-v1.webp'],
      ['vecna-eve-of-ruin', 'Vecna: Eve of Ruin', '/assets/campaigns/vecna-eve-of-ruin-card-v1.webp'],
      ['avylan', 'Avylan', '/assets/campaigns/avylan-card-v1.webp'],
      ['waterdeep-dragonheist-dotmm', 'Waterdeep', remote.waterdeep],
      ['epic-quests', 'Epic Quests', '/assets/campaigns/epic-quests-card-v1.webp'],
    ],
  },
];

const detailHeroes = [
  ['campaigns/keep-on-the-borderlands/index.html', 'Keep on the Borderlands', '/assets/campaigns/keep-on-the-borderlands-hero-v1.webp'],
  ['campaigns/drakkenheim/index.html', 'Dungeons of Drakkenheim', remote.drakkenheim],
  ['campaigns/thrones-of-the-djinni-lords/index.html', 'Thrones of the Djinni Lords', '/assets/campaigns/thrones-of-the-djinni-lords-hero-v1.webp'],
  ['campaigns/eberron-black-lanterns/index.html', 'Eberron: Black Lanterns', '/assets/campaigns/eberron-black-lanterns-hero-v1.webp'],
  ['campaigns/vecna-eve-of-ruin/index.html', 'Vecna: Eve of Ruin', '/assets/campaigns/vecna-eve-of-ruin-hero-v1.webp'],
  ['campaigns/avylan/index.html', 'Avylan', '/assets/campaigns/avylan-hero-v1.webp'],
  ['campaigns/waterdeep-dragonheist-dotmm/index.html', 'Waterdeep', remote.waterdeep],
  ['campaigns/epic-quests/index.html', 'Epic Quests', '/assets/campaigns/epic-quests-hero-v1.webp'],
];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function cardBlockById(html, id) {
  const article = new RegExp(`<article\\b[^>]*id=["']${escapeRegExp(id)}["'][\\s\\S]*?<\\/article>`, 'i').exec(html);
  return article && article[0];
}

function cardBlockByHeading(html, heading) {
  const matches = html.match(/<article\b[\s\S]*?<\/article>/gi) || [];
  return matches.find((block) => {
    const headingMatch = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i.exec(block);
    if (!headingMatch) return false;
    const headingText = stripTags(headingMatch[1]).replace(/\s+/g, ' ').trim();
    return headingText === heading;
  });
}

function imgSrc(block) {
  const match = /<img\b[^>]*class=["'][^"']*\bcard-media\b[^"']*["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/i.exec(block || '');
  return match && match[1];
}

function imgAlt(block) {
  const match = /<img\b[^>]*class=["'][^"']*\bcard-media\b[^"']*["'][^>]*\balt=["']([^"']*)["'][^>]*>/i.exec(block || '');
  return match && match[1];
}

function heroBlock(html) {
  const match = /<div class=["']campaign-hero-image["']>[\s\S]*?<\/div>/i.exec(html);
  return match && match[0];
}

function localAssetExists(src) {
  if (!src.startsWith('/')) return true;
  return fs.existsSync(path.join(root, src.replace(/^\//, '')));
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '');
}

const rows = [];

for (const page of pages) {
  const html = read(page.file);
  for (const [selector, label, expected] of page.cards) {
    const block = selector.startsWith('austin-') || selector.includes('-')
      ? cardBlockById(html, selector) || cardBlockByHeading(html, label)
      : cardBlockByHeading(html, label);
    const current = imgSrc(block);
    rows.push({
      type: 'card',
      page: page.page,
      campaign: label,
      selector,
      currentImageSrc: current || '(missing)',
      expectedImageSrc: expected,
      altText: imgAlt(block) || '(missing)',
      status: current === expected && localAssetExists(expected) ? 'correct' : 'incorrect',
    });
  }
}

for (const [file, label, expected] of detailHeroes) {
  const html = read(file);
  const current = imgSrc(heroBlock(html));
  rows.push({
    type: 'detail hero',
    page: '/' + file.replace(/index\.html$/, '').replace(/\\/g, '/'),
    campaign: label,
    selector: 'section.campaign-hero-grid .campaign-hero-image > img.card-media',
    currentImageSrc: current || '(missing)',
    expectedImageSrc: expected,
    altText: imgAlt(heroBlock(html)) || '(missing)',
    status: current === expected && localAssetExists(expected) ? 'correct' : 'incorrect',
  });
}

const failures = rows.filter((row) => row.status !== 'correct');
const report = {
  checkedAt: new Date().toISOString(),
  overallPass: failures.length === 0,
  summary: {
    totalChecks: rows.length,
    failures: failures.length,
  },
  rows,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length) {
  process.exit(1);
}
