const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const OUTPUT_FILE = 'campaign-offers.v1.json';
const CONTRACT_NAME = 'public-offer-snapshot';
const CONTRACT_VERSION = 'public-offer/1';
const OWNER = '20fates-website';
const OFFER_STATE = 'current';
const SITE_ORIGIN = 'https://20fates.com';
const TIME_ZONE = 'America/Chicago';
const VALID_DAYS = new Set([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
]);
const VALID_STATUSES = new Set(['open', 'full']);
const VALID_TABLE_STATUSES = new Set(['open', 'waitlist']);
const PRICE_PATTERN = /^\$(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?\/(?:hour|week)$/;

function buildCampaignOfferSnapshot(rootDir) {
  const errors = [];
  const dataPath = resolve(rootDir, 'data', 'campaigns.json');
  let data;

  try {
    data = JSON.parse(readFileSync(dataPath, 'utf8'));
  } catch (error) {
    throw new Error(`Campaign offer snapshot validation failed: cannot read ${dataPath}: ${error.message}`);
  }

  if (!data || typeof data !== 'object' || !Array.isArray(data.campaigns) || data.campaigns.length === 0) {
    throw new Error('Campaign offer snapshot validation failed: data/campaigns.json must contain a non-empty campaigns array.');
  }

  const activeCampaigns = data.campaigns
    .map((campaign, index) => ({ campaign, index }))
    .filter(({ campaign }) => campaign?.status !== 'inactive');
  if (activeCampaigns.length === 0) errors.push('A current campaign offer snapshot must contain at least one active campaign.');
  const offers = activeCampaigns.map(({ campaign, index }) => validateAndProject(campaign, index, data, errors));
  validateUnique(data.campaigns, 'id', errors);
  validateUnique(offers, 'title', errors);
  validateUnique(data.campaigns, 'primary_cta_url', errors);
  validateScheduleRoster(data.current_schedule, activeCampaigns.map(({ campaign }) => campaign), errors);
  validatePublicPages(rootDir, activeCampaigns.map(({ campaign }) => campaign), data.current_schedule, data.campaigns, errors);

  if (errors.length > 0) {
    throw new Error(`Campaign offer snapshot validation failed:\n- ${errors.join('\n- ')}`);
  }

  const sourceIdentity = `sha256:${createHash('sha256').update(JSON.stringify(offers)).digest('hex')}`;
  const snapshot = {
    contract: CONTRACT_NAME,
    version: CONTRACT_VERSION,
    owner: OWNER,
    source: {
      identity: sourceIdentity
    },
    freshness: {
      source_identity: 'source.identity',
      offer_state: OFFER_STATE,
      consumer_observation: 'fetched_at'
    },
    visibility: 'public',
    payload: {
      offers
    }
  };

  validateSnapshotEnvelope(snapshot);
  return snapshot;
}

function validateAndProject(campaign, index, data, errors) {
  const at = `campaigns[${index}]`;
  if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) {
    errors.push(`${at} must be an object.`);
    campaign = {};
  }

  const id = requiredString(campaign.id, `${at}.id`, errors);
  const slug = requiredString(campaign.slug, `${at}.slug`, errors);
  const title = requiredString(campaign.title, `${at}.title`, errors);
  const status = requiredString(campaign.status, `${at}.status`, errors);
  const day = requiredString(campaign.day, `${at}.day`, errors);
  const time = requiredString(campaign.time_central, `${at}.time_central`, errors);
  const priceField = campaign.price_hourly ? 'price_hourly' : 'price_weekly';
  const price = requiredString(campaign[priceField], `${at}.${priceField}`, errors);
  const pagePath = requiredString(campaign.secondary_cta_url, `${at}.secondary_cta_url`, errors);
  const primaryCta = requiredString(campaign.primary_cta_url, `${at}.primary_cta_url`, errors);
  const seatsFilled = requiredInteger(campaign.seats_filled, `${at}.seats_filled`, errors);
  const seatsTotal = requiredInteger(campaign.seats_total, `${at}.seats_total`, errors);
  const seatsOpen = requiredInteger(campaign.seats_open, `${at}.seats_open`, errors);

  if (id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) errors.push(`${at}.id must be a lowercase kebab-case stable ID.`);
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.push(`${at}.slug must be lowercase kebab-case.`);
  if (status && !VALID_STATUSES.has(status)) errors.push(`${at}.status must be "open" or "full" for schema version 1.`);

  if (Number.isInteger(seatsFilled) && seatsFilled < 0) errors.push(`${at}.seats_filled cannot be negative.`);
  if (Number.isInteger(seatsTotal) && seatsTotal < 1) errors.push(`${at}.seats_total must be at least 1.`);
  if (Number.isInteger(seatsOpen) && seatsOpen < 0) errors.push(`${at}.seats_open cannot be negative.`);
  if (status === 'open' && [seatsFilled, seatsTotal, seatsOpen].every(Number.isInteger) && seatsFilled + seatsOpen !== seatsTotal) {
    errors.push(`${at} contradicts itself: seats_filled + seats_open must equal seats_total.`);
  }
  if (status === 'open' && Number.isInteger(seatsOpen) && seatsOpen === 0) errors.push(`${at} is open but has no open seats.`);
  if (status === 'full' && Number.isInteger(seatsOpen) && seatsOpen !== 0) errors.push(`${at} is full but has ${seatsOpen} open seats.`);
  if (status === 'full' && Number.isInteger(seatsFilled) && Number.isInteger(seatsTotal) && seatsFilled < seatsTotal) errors.push(`${at} is full but has fewer players than its seat target.`);

  const expectedPagePath = slug ? `/campaigns/${slug}/` : '';
  if (pagePath && pagePath !== expectedPagePath) errors.push(`${at}.secondary_cta_url must be ${expectedPagePath}.`);
  if (id && primaryCta !== `/start/?campaign=${id}`) errors.push(`${at}.primary_cta_url must target its stable ID.`);

  if (price && !PRICE_PATTERN.test(price)) errors.push(`${at}.${priceField} must be a public hourly or weekly price.`);

  const tables = campaignTables(campaign, data.current_schedule);
  validateCampaignTables(campaign, tables, at, errors);

  const facts = campaign.quick_facts;
  let scheduleLabel = '';
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    errors.push(`${at}.quick_facts must be an object.`);
  } else {
    scheduleLabel = requiredString(facts.schedule, `${at}.quick_facts.schedule`, errors);
    const factSeats = String(facts.seats_open || '');
    for (const table of tables) {
      if (!hasSchedule(scheduleLabel, table)) errors.push(`${at}.quick_facts.schedule is missing ${table.day} ${table.time_central}.`);
    }
    if (status === 'full' && !/waitlist/i.test(factSeats)) errors.push(`${at}.quick_facts.seats_open must identify the waitlist.`);
    if (status === 'open' && tables.length === 1 && !factSeats.startsWith(`${seatsOpen} of ${seatsTotal}`)) errors.push(`${at}.quick_facts.seats_open must begin with "${seatsOpen} of ${seatsTotal}".`);
    if (status === 'open' && tables.length > 1 && !factSeats.startsWith(`${seatsOpen} across `)) errors.push(`${at}.quick_facts.seats_open must begin with "${seatsOpen} across ".`);
    if (facts.price !== price) errors.push(`${at}.quick_facts.price must match ${priceField}.`);
  }

  return {
    id,
    slug,
    title,
    status,
    open_seats: seatsOpen,
    has_open_seats: Number.isInteger(seatsOpen) && seatsOpen > 0,
    schedule: {
      day,
      time,
      time_zone: TIME_ZONE,
      label: scheduleLabel
    },
    price,
    canonical_url: pagePath === expectedPagePath ? `${SITE_ORIGIN}${pagePath}` : ''
  };
}

function validateScheduleRoster(schedule, campaigns, errors) {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    errors.push('data/campaigns.json must contain a non-empty current_schedule array.');
    return;
  }

  const scheduled = schedule.filter((table) => table?.campaign_id);
  validateUnique(scheduled, 'campaign_id', errors);
  for (const table of scheduled) {
    if (!campaigns.some((campaign) => tableBelongsToCampaign(table, campaign))) {
      errors.push(`current_schedule campaign_id "${table.campaign_id}" has no active campaign.`);
    }
  }
}

function campaignTables(campaign, schedule) {
  if (!Array.isArray(schedule) || !campaign?.id) return [];
  return schedule.filter((table) => tableBelongsToCampaign(table, campaign));
}

function tableBelongsToCampaign(table, campaign) {
  return table?.campaign_id === campaign?.id || table?.campaign_id?.startsWith(`${campaign?.id}-`);
}

function validateCampaignTables(campaign, tables, at, errors) {
  if (tables.length === 0) {
    errors.push(`${at} has no current_schedule entry.`);
    return;
  }

  for (const table of tables) {
    const tableAt = `current_schedule[${table.campaign_id}]`;
    const day = requiredString(table.day, `${tableAt}.day`, errors);
    const time = requiredString(table.time_central, `${tableAt}.time_central`, errors);
    const status = requiredString(table.status, `${tableAt}.status`, errors);
    const seatsFilled = requiredInteger(table.seats_filled, `${tableAt}.seats_filled`, errors);
    const seatsTotal = requiredInteger(table.seats_total, `${tableAt}.seats_total`, errors);
    const seatsOpen = requiredInteger(table.seats_open, `${tableAt}.seats_open`, errors);
    if (day && !VALID_DAYS.has(day)) errors.push(`${tableAt}.day is not a valid weekday.`);
    if (time && !/^(?:[1-9]|1[0-2]):[0-5][0-9] (?:AM|PM)$/.test(time)) errors.push(`${tableAt}.time_central must use a 12-hour time such as "6:00 PM".`);
    if (status && !VALID_TABLE_STATUSES.has(status)) errors.push(`${tableAt}.status must be "open" or "waitlist".`);
    if (Number.isInteger(seatsFilled) && seatsFilled < 0) errors.push(`${tableAt}.seats_filled cannot be negative.`);
    if (Number.isInteger(seatsTotal) && seatsTotal < 1) errors.push(`${tableAt}.seats_total must be at least 1.`);
    if (Number.isInteger(seatsOpen) && seatsOpen < 0) errors.push(`${tableAt}.seats_open cannot be negative.`);
    if (status === 'open' && [seatsFilled, seatsTotal, seatsOpen].every(Number.isInteger) && seatsFilled + seatsOpen !== seatsTotal) errors.push(`${tableAt} contradicts its seat counts.`);
    if (status === 'waitlist' && Number.isInteger(seatsOpen) && seatsOpen !== 0) errors.push(`${tableAt} is waitlisted but has open seats.`);
    if (status === 'waitlist' && Number.isInteger(seatsFilled) && Number.isInteger(seatsTotal) && seatsFilled < seatsTotal) errors.push(`${tableAt} is waitlisted below its seat target.`);
  }

  if (tables.length === 1) {
    if (campaign.day !== tables[0].day) errors.push(`${at}.day contradicts current_schedule.`);
    if (campaign.time_central !== tables[0].time_central) errors.push(`${at}.time_central contradicts current_schedule.`);
  } else {
    const expectedDays = [...new Set(tables.map((table) => table.day))].join(' / ');
    if (campaign.day !== expectedDays) errors.push(`${at}.day must be "${expectedDays}".`);
    if (campaign.time_central !== 'Multiple times') errors.push(`${at}.time_central must be "Multiple times" for multiple tables.`);
  }

  const totals = tables.reduce((sum, table) => ({
    filled: sum.filled + (Number.isInteger(table.seats_filled) ? table.seats_filled : 0),
    seats: sum.seats + (Number.isInteger(table.seats_total) ? table.seats_total : 0),
    open: sum.open + (Number.isInteger(table.seats_open) ? table.seats_open : 0)
  }), { filled: 0, seats: 0, open: 0 });
  if (campaign.seats_filled !== totals.filled || campaign.seats_total !== totals.seats || campaign.seats_open !== totals.open) errors.push(`${at} seat totals contradict current_schedule.`);
  const expectedStatus = tables.some((table) => table.status === 'open') ? 'open' : 'full';
  if (campaign.status !== expectedStatus) errors.push(`${at}.status must be "${expectedStatus}" to match current_schedule.`);
}

function validatePublicPages(rootDir, campaigns, schedule, allCampaigns, errors) {
  const homePage = readPublicPage(resolve(rootDir, 'index.html'), 'homepage', errors);
  const austinPage = readPublicPage(resolve(rootDir, 'austin', 'index.html'), 'Austin page', errors);
  const campaignIndex = readPublicPage(resolve(rootDir, 'campaigns', 'index.html'), 'campaign index', errors);
  const startPage = readPublicPage(resolve(rootDir, 'start', 'index.html'), 'Session Zero page', errors);

  for (const campaign of campaigns) {
    if (!campaign || typeof campaign !== 'object') continue;
    const at = campaign.id || 'campaign with missing ID';
    const tables = campaignTables(campaign, schedule);
    const publicTitle = publicCampaignTitle(campaign);
    const price = campaign.price_hourly || campaign.price_weekly || '';

    for (const [label, page] of [['austin/index.html', austinPage], ['campaigns/index.html', campaignIndex]]) {
      const card = articleAround(page, `href="${campaign.secondary_cta_url}"`);
      if (!card) {
        errors.push(`${at} is missing from ${label}.`);
        continue;
      }
      if (label === 'campaigns/index.html' && !card.includes(`<h2>${escapeHtml(publicTitle)}</h2>`)) errors.push(`${at} title has drifted from ${label}.`);
      if (price && !card.includes(price)) errors.push(`${at} price has drifted from ${label}.`);
      for (const table of tables) {
        if (!hasSchedule(card, table)) errors.push(`${table.campaign_id} schedule has drifted from ${label}.`);
        if (!hasAvailability(card, table)) errors.push(`${table.campaign_id} availability has drifted from ${label}.`);
      }
    }

    for (const table of tables) {
      const optionPattern = new RegExp(`<option\\s+value="${escapeRegex(table.campaign_id)}"[^>]*>([^<]+)</option>`);
      const option = startPage.match(optionPattern)?.[1] || '';
      if (!option) errors.push(`${table.campaign_id} is missing from start/index.html.`);
      else {
        if (!hasSchedule(option, table)) errors.push(`${table.campaign_id} schedule has drifted from start/index.html.`);
        if (table.status === 'waitlist' && !/waitlist/i.test(option)) errors.push(`${table.campaign_id} waitlist status has drifted from start/index.html.`);
      }
    }

    if (typeof campaign.secondary_cta_url !== 'string' || !campaign.secondary_cta_url.startsWith('/campaigns/')) continue;
    const relativePath = campaign.secondary_cta_url.replace(/^\/+|\/+$/g, '');
    const detailPage = readPublicPage(resolve(rootDir, relativePath, 'index.html'), campaign.secondary_cta_url, errors);
    if (price && !detailPage.includes(price)) errors.push(`${at} price has drifted from ${campaign.secondary_cta_url}.`);
    if (!detailPage.includes(`>${escapeHtml(publicTitle)}</h1>`)) errors.push(`${at} title has drifted from ${campaign.secondary_cta_url}.`);
    if (!detailPage.includes(`<link rel="canonical" href="${SITE_ORIGIN}${campaign.secondary_cta_url}">`)) errors.push(`${at} canonical URL has drifted from ${campaign.secondary_cta_url}.`);
    for (const table of tables) {
      if (!hasSchedule(detailPage, table)) errors.push(`${table.campaign_id} schedule has drifted from ${campaign.secondary_cta_url}.`);
      if (!hasAvailability(detailPage, table)) errors.push(`${table.campaign_id} availability has drifted from ${campaign.secondary_cta_url}.`);
    }
    validateSeoSeatClaim(detailPage, campaign, errors);
  }

  for (const campaign of allCampaigns.filter((item) => item?.status === 'inactive')) {
    if (campaignIndex.includes(`href="${campaign.secondary_cta_url}"`) || austinPage.includes(`href="${campaign.secondary_cta_url}"`)) errors.push(`${campaign.id} is inactive but still appears in a public roster.`);
    if (startPage.includes(`value="${campaign.id}"`)) errors.push(`${campaign.id} is inactive but still appears in start/index.html.`);
  }

  validateHomepage(homePage, campaigns, schedule, errors);
}

function validateHomepage(homePage, campaigns, schedule, errors) {
  for (const campaign of campaigns) {
    const link = linkAround(homePage, `href="${campaign.secondary_cta_url}"`);
    if (!link) continue;
    if (!pageText(link).includes(publicCampaignTitle(campaign))) errors.push(`${campaign.id} title has drifted from index.html.`);
    for (const table of campaignTables(campaign, schedule)) {
      if (!hasSchedule(link, table)) errors.push(`${table.campaign_id} schedule has drifted from index.html.`);
    }
    const text = pageText(link).toLowerCase();
    if (campaign.status === 'full' && !text.includes('waitlist')) errors.push(`${campaign.id} availability has drifted from index.html.`);
    if (campaign.status === 'open' && !seatCountTokens(campaign.seats_open).some((token) => text.includes(token))) errors.push(`${campaign.id} availability has drifted from index.html.`);
  }
}

function validateSeoSeatClaim(page, campaign, errors) {
  if (campaign.status !== 'open') return;
  const description = page.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] || '';
  const claim = description.match(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|[0-9]+) current (?:seat|seats|opening|openings)\b/i)?.[1];
  if (claim && !seatCountValues(campaign.seats_open).includes(claim.toLowerCase())) errors.push(`${campaign.id} seat count has drifted in its meta description.`);
}

function hasSchedule(value, table) {
  const text = pageText(value);
  const day = `(?:${escapeRegex(table.day)}|${escapeRegex(table.day.slice(0, 3))})`;
  const shortTime = table.time_central?.replace(':00', '') || '';
  const time = `(?:${escapeRegex(table.time_central)}|${escapeRegex(shortTime)})`;
  return new RegExp(`\\b${day}\\b.{0,80}\\b${time}\\b`, 'i').test(text);
}

function hasAvailability(value, table) {
  const text = pageText(value);
  const day = new RegExp(`\\b(?:${escapeRegex(table.day)}|${escapeRegex(table.day.slice(0, 3))})\\b`, 'ig');
  let match;
  while ((match = day.exec(text))) {
    const nearby = text.slice(match.index, match.index + 180).toLowerCase();
    if (table.status === 'waitlist' && nearby.includes('waitlist')) return true;
    if (table.status === 'open') {
      const tokens = [...seatCountTokens(table.seats_open), `${table.seats_open} of ${table.seats_total}`];
      if (tokens.some((token) => nearby.includes(token))) return true;
    }
  }
  return false;
}

function seatCountTokens(count) {
  return seatCountValues(count).flatMap((value) => [`${value} seat`, `${value} seats`]);
}

function seatCountValues(count) {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return [String(count), words[count]].filter(Boolean);
}

function pageText(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function requiredString(value, field, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${field} is required and must be a non-empty string.`);
    return '';
  }
  if (value !== value.trim()) errors.push(`${field} must not have leading or trailing whitespace.`);
  if (/[\u0000-\u001f\u007f]/.test(value)) errors.push(`${field} must be a single line without control characters.`);
  if (value.length > 500) errors.push(`${field} must not exceed 500 characters.`);
  return value;
}

function requiredInteger(value, field, errors) {
  if (!Number.isInteger(value)) {
    errors.push(`${field} is required and must be an integer.`);
    return Number.NaN;
  }
  return value;
}

function validateUnique(items, field, errors) {
  const seen = new Map();
  items.forEach((item, index) => {
    const value = item?.[field];
    if (typeof value !== 'string' || value === '') return;
    if (seen.has(value)) errors.push(`${field} "${value}" is duplicated at entries ${seen.get(value)} and ${index}.`);
    else seen.set(value, index);
  });
}

function validateSnapshotEnvelope(snapshot) {
  const errors = [];
  const exactObject = (value, field, expectedKeys) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${field} must be an object.`);
      return false;
    }
    const actualKeys = Object.keys(value);
    const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
    const unexpected = actualKeys.filter((key) => !expectedKeys.includes(key));
    if (missing.length || unexpected.length) {
      errors.push(`${field} must contain exactly ${expectedKeys.join(', ')}.`);
    }
    return true;
  };

  exactObject(snapshot, 'envelope', ['contract', 'version', 'owner', 'source', 'freshness', 'visibility', 'payload']);
  if (snapshot?.contract !== CONTRACT_NAME) errors.push(`contract must be "${CONTRACT_NAME}".`);
  if (snapshot?.version !== CONTRACT_VERSION) errors.push(`version must be "${CONTRACT_VERSION}".`);
  if (snapshot?.owner !== OWNER) errors.push(`owner must be "${OWNER}".`);
  if (snapshot?.visibility !== 'public') errors.push('visibility must be "public".');

  if (exactObject(snapshot?.source, 'source', ['identity'])
      && !/^sha256:[0-9a-f]{64}$/.test(snapshot.source.identity)) {
    errors.push('source.identity must be a deterministic SHA-256 identity.');
  }

  if (exactObject(snapshot?.freshness, 'freshness', ['source_identity', 'offer_state', 'consumer_observation'])) {
    if (snapshot.freshness.source_identity !== 'source.identity') errors.push('freshness.source_identity must reference source.identity.');
    if (!['current', 'withdrawn'].includes(snapshot.freshness.offer_state)) errors.push('freshness.offer_state must be "current" or "withdrawn".');
    if (snapshot.freshness.consumer_observation !== 'fetched_at') errors.push('freshness.consumer_observation must assign fetched_at to the consumer.');
  }

  if (exactObject(snapshot?.payload, 'payload', ['offers'])) {
    if (!Array.isArray(snapshot.payload.offers)) {
      errors.push('payload.offers must be an array.');
    } else {
      for (const [index, offer] of snapshot.payload.offers.entries()) {
        if (exactObject(offer, `payload.offers[${index}]`, ['id', 'slug', 'title', 'status', 'open_seats', 'has_open_seats', 'schedule', 'price', 'canonical_url'])) {
          exactObject(offer.schedule, `payload.offers[${index}].schedule`, ['day', 'time', 'time_zone', 'label']);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Campaign offer snapshot envelope validation failed:\n- ${errors.join('\n- ')}`);
  }
}

function readPublicPage(path, label, errors) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    errors.push(`Cannot read ${label} at ${path}: ${error.message}`);
    return '';
  }
}

function articleAround(text, needle) {
  if (!text || !needle) return '';
  const index = text.indexOf(needle);
  if (index === -1) return '';
  const start = text.lastIndexOf('<article', index);
  const end = text.indexOf('</article>', index);
  return start === -1 || end === -1 ? '' : text.slice(start, end + '</article>'.length);
}

function linkAround(text, needle) {
  if (!text || !needle) return '';
  const index = text.indexOf(needle);
  if (index === -1) return '';
  const start = text.lastIndexOf('<a ', index);
  const end = text.indexOf('</a>', index);
  return start === -1 || end === -1 ? '' : text.slice(start, end + '</a>'.length);
}

function publicCampaignTitle(campaign) {
  const tableSuffix = ` (${campaign.day} Table)`;
  return campaign.title?.endsWith(tableSuffix)
    ? campaign.title.slice(0, -tableSuffix.length)
    : campaign.title;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeCampaignOfferSnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

function checkBuiltSnapshot(rootDir) {
  const expected = serializeCampaignOfferSnapshot(buildCampaignOfferSnapshot(rootDir));
  const outputPath = resolve(rootDir, 'dist', OUTPUT_FILE);
  let actual;
  let snapshot;

  try {
    actual = readFileSync(outputPath, 'utf8');
    snapshot = JSON.parse(actual);
  } catch (error) {
    throw new Error(`Built campaign offer snapshot is missing or malformed at ${outputPath}: ${error.message}`);
  }

  validateSnapshotEnvelope(snapshot);

  if (actual !== expected) {
    throw new Error(`Built campaign offer snapshot has drifted from data/campaigns.json: rebuild and recheck ${outputPath}.`);
  }

  console.log(`Campaign offer snapshot check passed: ${outputPath}`);
}

if (require.main === module) {
  try {
    checkBuiltSnapshot(process.cwd());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  OUTPUT_FILE,
  buildCampaignOfferSnapshot,
  serializeCampaignOfferSnapshot
};
