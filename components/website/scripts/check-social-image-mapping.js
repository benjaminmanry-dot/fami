const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const site = 'https://20fates.com';

const remote = {
  drakkenheim:
    'https://images.squarespace-cdn.com/content/v1/699ec7cef7db606f11d4dafe/1772013522793-2RR4CZD10XALFQGK54SJ/drakk.png',
  waterdeep:
    'https://images.squarespace-cdn.com/content/v1/699ec7cef7db606f11d4dafe/1772013522772-HTKWFWGVOI2R3ENY4PTB/waterdeep.png',
};

const checks = [
  ['/', 'index.html', `${site}/assets/campaigns/keep-on-the-borderlands-card-v1.webp`, 'correct'],
  ['/austin/', 'austin/index.html', `${site}/assets/campaigns/keep-on-the-borderlands-card-v1.webp`, 'correct'],
  ['/campaigns/', 'campaigns/index.html', `${site}/assets/campaigns/keep-on-the-borderlands-card-v1.webp`, 'correct'],
  ['/campaigns/keep-on-the-borderlands/', 'campaigns/keep-on-the-borderlands/index.html', `${site}/assets/campaigns/keep-on-the-borderlands-hero-v1.webp`, 'correct'],
  ['/campaigns/drakkenheim/', 'campaigns/drakkenheim/index.html', remote.drakkenheim, 'acceptable legacy'],
  ['/campaigns/thrones-of-the-djinni-lords/', 'campaigns/thrones-of-the-djinni-lords/index.html', `${site}/assets/campaigns/thrones-of-the-djinni-lords-hero-v1.webp`, 'correct'],
  ['/campaigns/eberron-black-lanterns/', 'campaigns/eberron-black-lanterns/index.html', `${site}/assets/campaigns/eberron-black-lanterns-hero-v1.webp`, 'correct'],
  ['/campaigns/vecna-eve-of-ruin/', 'campaigns/vecna-eve-of-ruin/index.html', `${site}/assets/campaigns/vecna-eve-of-ruin-hero-v1.webp`, 'correct'],
  ['/campaigns/avylan/', 'campaigns/avylan/index.html', `${site}/assets/campaigns/avylan-hero-v1.webp`, 'correct'],
  ['/campaigns/waterdeep-dragonheist-dotmm/', 'campaigns/waterdeep-dragonheist-dotmm/index.html', remote.waterdeep, 'acceptable legacy'],
  ['/campaigns/epic-quests/', 'campaigns/epic-quests/index.html', `${site}/assets/campaigns/epic-quests-hero-v1.webp`, 'correct'],
];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function attr(html, pattern) {
  const match = pattern.exec(html);
  return match && match[1];
}

function publicFileExists(url) {
  if (!url.startsWith(`${site}/assets/campaigns/`)) return true;
  const fileName = url.replace(`${site}/assets/campaigns/`, '');
  return fs.existsSync(path.join(root, 'public', 'assets', 'campaigns', fileName));
}

const rows = checks.map(([page, file, expectedImage, expectedStatus]) => {
  const html = read(file);
  const canonical = attr(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  const ogImage = attr(html, /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  const twitterImage = attr(html, /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
  const canonicalExpected = `${site}${page}`;
  const sameImages = ogImage === twitterImage;
  const matchesExpected = ogImage === expectedImage && twitterImage === expectedImage;
  const imageAvailable = publicFileExists(expectedImage);
  const canonicalCorrect = canonical === canonicalExpected;
  let status = 'incorrect';

  if (matchesExpected && imageAvailable && canonicalCorrect) {
    status = expectedStatus;
  } else if (matchesExpected && !imageAvailable && canonicalCorrect) {
    status = 'incorrect';
  }

  return {
    page,
    currentOgImage: ogImage || '(missing)',
    currentTwitterImage: twitterImage || '(missing)',
    expectedImage,
    canonical: canonical || '(missing)',
    expectedCanonical: canonicalExpected,
    imageAvailable,
    sameImages,
    status,
  };
});

const failures = rows.filter((row) => row.status === 'incorrect');
const report = {
  checkedAt: new Date().toISOString(),
  overallPass: failures.length === 0,
  summary: {
    totalChecks: rows.length,
    failures: failures.length,
    acceptableLegacyImages: rows.filter((row) => row.status === 'acceptable legacy').length,
  },
  rows,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length) {
  process.exit(1);
}
