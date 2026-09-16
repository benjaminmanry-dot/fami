import { insist, dollarsToCents } from './ledger.mjs';

const providerDomains = { venmo: ['venmo.com'], cashapp: ['square.com'] };
// Candidate domains remain broader than trusted senders so a provider-address
// change reaches the private review queue instead of silently disappearing.
const candidateDomains = { venmo: providerDomains.venmo, cashapp: ['cash.app', 'square.com', 'squareup.com'] };
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const retryDelay = (response, clock, attempt) => {
  const value = response.headers.get('retry-after');
  const retryAfter = /^\d+$/.test(value || '') ? Number(value) * 1000 : Number.isFinite(Date.parse(value || '')) ? Date.parse(value) - clock() : 0;
  return Math.max(1000, retryAfter, 1000 * 2 ** attempt);
};
const retryable = async response => {
  if ([429, 500, 502, 503, 504].includes(response.status)) return true;
  if (response.status !== 403) return false;
  try { return ['rateLimitExceeded', 'userRateLimitExceeded'].includes((await response.clone().json())?.error?.errors?.[0]?.reason); } catch { return false; }
};
const decodeQuotedPrintable = value => value.replace(/=\r?\n/g, '').replace(/(?:=[0-9a-f]{2})+/gi, encoded => new TextDecoder().decode(Uint8Array.from(encoded.match(/[0-9a-f]{2}/gi), byte => Number.parseInt(byte, 16))));
function receiptParts(payload) {
  const content = [];
  const walk = part => {
    if (part.mimeType === 'text/plain' || part.mimeType === 'text/html' || part.mime_type === 'text/plain' || part.mime_type === 'text/html') {
      const raw = part.body?.content ?? (part.body?.data ? new TextDecoder().decode(Uint8Array.from(atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))) : '');
      const encoding = (part.headers || []).find(header => header.name?.toLowerCase() === 'content-transfer-encoding')?.value?.toLowerCase();
      const body = encoding === 'quoted-printable' ? decodeQuotedPrintable(raw) : raw;
      content.push({ type: part.mimeType || part.mime_type, text: body.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim() });
    }
    for (const p of part.parts || []) walk(p);
  };
  walk(payload); return content;
}
export function mailText(payload) {
  return receiptParts(payload).map(part => part.text).join(' ').replace(/\s+/g, ' ').trim();
}
export function authenticatedProvider(payload, provider) {
  const headers = payload.headers || [], header = name => headers.find(h => h.name.toLowerCase() === name)?.value || '';
  const from = header('from').match(/(?:<|^)([^<>\s]+@([a-zA-Z0-9.-]+))>?$/), domain = from?.[2]?.toLowerCase();
  if (!providerDomains[provider]?.includes(domain)) return false;
  // Only Gmail's first receiver-added Authentication-Results is considered.
  // This function accepts Gmail API MIME, never caller-supplied raw email.
  const auth = header('authentication-results').replace(/\s+/g, ' ');
  const escaped = domain.replaceAll('.', '\\.');
  return /^mx\.google\.com;\s/i.test(auth) && new RegExp(`\\bdkim=pass\\b[^;]*header\\.i=@${escaped}(?:\\s|;)`, 'i').test(auth) && new RegExp(`\\bdmarc=pass\\b[^;]*header\\.from=${escaped}(?:\\s|;|$)`, 'i').test(auth);
}
export function parseReceipt(message, provider, { cashappTemplateVerified = false } = {}) {
  insist(providerDomains[provider], 'Unknown receipt provider');
  const p = message.payload || {}, headers = p.headers || [], header = n => headers.find(h => h.name.toLowerCase() === n)?.value || '';
  const subject = header('subject').trim(), parts = receiptParts(p), body = parts.map(part => part.text).join(' '), authenticated = authenticatedProvider(p, provider);
  const sourceId = message.id, receivedAt = new Date(Number(message.internalDate || message.internal_date)).toISOString();
  // Marketing and transfers can never masquerade as incoming customer income.
  if (/transfer|cash out|withdrawal|bank deposit|you paid|you sent/i.test(subject)) return null;
  if (provider === 'cashapp') {
    const plain = parts.filter(part => part.type === 'text/plain').map(part => part.text);
    const html = parts.filter(part => part.type === 'text/html').map(part => part.text);
    const plainMatch = plain.length === 1 && plain[0].match(/^You were sent \$([\d,]+(?:\.\d{1,2})?) by (.{1,150}?)\. To view your receipt, visit: (https:\/\/cash\.app\/[^\s]+)$/i);
    const htmlMatch = html.length === 1 && html[0].match(/^(.{1,150}?) paid you \$([\d,]+(?:\.\d{1,2})?)(?:[.!]?\s)/i);
    const creditMatches = html.length === 1 ? [...html[0].matchAll(/\+\$([\d,]+(?:\.\d{1,2})?)/g)] : [];
    const transaction = html.length === 1 && html[0].match(/\bTransaction details Complete Payment received\b[\s\S]*?\bto Cash balance Transaction number #([A-Za-z]-[A-Za-z0-9]{9})\b/i);
    let cashTemplate = subject === 'Payment received' && plainMatch && htmlMatch && creditMatches.length === 1 && transaction;
    try {
      const receiptUrl = plainMatch && new URL(plainMatch[3]);
      const amounts = [plainMatch?.[1], htmlMatch?.[2], creditMatches[0]?.[1]].map(value => dollarsToCents(value?.replaceAll(',', '')));
      cashTemplate &&= receiptUrl.protocol === 'https:' && receiptUrl.hostname === 'cash.app' && receiptUrl.pathname.includes('/receipt/') && !receiptUrl.search && !receiptUrl.hash && amounts.every(amount => amount === amounts[0]);
    } catch { cashTemplate = false; }
    if (!cashTemplate) {
      if (!/paid|sent|received|payment|refund/i.test(subject)) return null;
      return { id: `${provider}:unverified_mail_${sourceId}`, providerId: `unverified_mail_${sourceId}`, provider, source: 'gmail', sourceId, amountCents: 0, payerName: '', currency: 'usd', direction: 'unknown', receivedAt, authenticated: false, status: 'review', reviewReason: 'Unknown receipt format; inspect its source before recording money' };
    }
    if (!authenticated) return { id: `${provider}:unverified_mail_${sourceId}`, providerId: `unverified_mail_${sourceId}`, provider, source: 'gmail', sourceId, amountCents: 0, payerName: '', currency: 'usd', direction: 'unknown', receivedAt, authenticated: false, status: 'review', reviewReason: 'Receipt origin is not verified; inspect its source before recording money' };
    const proof = authenticated && cashappTemplateVerified;
    return { id: `${provider}:${transaction[1]}`, providerId: transaction[1], provider, source: 'gmail', sourceId, amountCents: dollarsToCents(plainMatch[1].replaceAll(',', '')), payerName: plainMatch[2], currency: 'usd', direction: 'incoming', receivedAt, providerDate: null, providerTimezone: header('date').match(/([+-]\d{4}|GMT|UTC)\s*$/)?.[1] || null, authenticated: proof, status: proof ? 'received' : 'review', feeCents: null, reviewReason: proof ? null : 'Receipt origin or Cash App template is not verified' };
  }
  const pattern = provider === 'venmo' ? /^(.{1,150}?) paid you \$([\d,]+\.\d{2})$/ : /^(.{1,150}?) (?:sent|paid) you \$([\d,]+\.\d{2})[.!]?$/;
  const match = subject.match(pattern), transaction = body.match(/Transaction\s+(?:ID|number)\s*[:#]?\s*([A-Za-z0-9-]{6,64})/i);
  if (!match || !transaction || (provider === 'venmo' && !/Money credited to your Venmo account\./i.test(body))) {
    if (!/paid|sent|received|payment|refund/i.test(subject)) return null;
    return { id: `${provider}:unverified_mail_${sourceId}`, providerId: `unverified_mail_${sourceId}`, provider, source: 'gmail', sourceId, amountCents: 0, payerName: '', currency: 'usd', direction: 'unknown', receivedAt, authenticated: false, status: 'review', reviewReason: 'Unknown receipt format; inspect its source before recording money' };
  }
  const proof = authenticated && (provider !== 'cashapp' || cashappTemplateVerified);
  return { id: `${provider}:${transaction[1]}`, providerId: transaction[1], provider, source: 'gmail', sourceId, amountCents: dollarsToCents(match[2].replaceAll(',', '')), payerName: match[1], currency: 'usd', direction: 'incoming', receivedAt, providerDate: body.match(/Transaction details Date\s+(.+?)\s+Transaction ID/i)?.[1] || null, providerTimezone: header('date').match(/([+-]\d{4}|GMT|UTC)\s*$/)?.[1] || null, authenticated: proof, status: proof ? 'received' : 'review', feeCents: null, reviewReason: proof ? null : 'Receipt origin or Cash App template is not verified' };
}

export class GmailFeed {
  constructor(config, fetcher = fetch, { sleeper = wait, clock = Date.now, batchDeadlineMs = 20000 } = {}) { this.config = config; this.fetcher = fetcher; this.sleeper = sleeper; this.clock = clock; this.batchDeadlineMs = batchDeadlineMs; }
  async accessToken(timeout = 15000) {
    const c = this.config; insist(c.clientId && c.clientSecret && c.refreshToken, 'Dedicated Gmail read-only authorization is not connected');
    const r = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(timeout) });
    insist(r.ok, 'Gmail authorization expired or was revoked'); const data = await r.json();
    insist(data.access_token && data.scope === 'https://www.googleapis.com/auth/gmail.readonly', 'Gmail authorization must have only the approved read-only scope'); return data.access_token;
  }
  async batch(provider, cursor = null, now = new Date().toISOString()) {
    const deadline = this.clock() + this.batchDeadlineMs;
    const token = await this.accessToken(Math.min(15000, Math.max(1, deadline - this.clock())));
    const request = async path => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remaining = deadline - this.clock(); insist(remaining > 0, 'Gmail could not complete the receipt sync');
        let response;
        try { response = await this.fetcher('https://gmail.googleapis.com/gmail/v1/users/me/' + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(Math.min(15000, remaining)) }); } catch { insist(false, 'Gmail could not complete the receipt sync'); }
        if (response.ok) return await response.json();
        if (!(await retryable(response)) || attempt === 2) insist(false, 'Gmail could not complete the receipt sync');
        const delay = retryDelay(response, this.clock, attempt); insist(delay < deadline - this.clock(), 'Gmail could not complete the receipt sync'); await this.sleeper(delay);
      }
    };
    const profile = await request('profile'); insist(profile.emailAddress?.toLowerCase() === this.config.mailbox?.toLowerCase(), 'Gmail connection does not match the approved receipt mailbox');
    const after = cursor?.after ?? Math.floor((Date.parse(now) - 90 * 86400000) / 1000), before = cursor?.before ?? Math.floor(Date.parse(now) / 1000);
    const q = `after:${after} before:${before} {${candidateDomains[provider].map(d => 'from:' + d).join(' ')}} {subject:paid subject:payment subject:received subject:sent subject:refund subject:transfer}`;
    const search = new URLSearchParams({ q, maxResults: '40' }); if (cursor?.pageToken) search.set('pageToken', cursor.pageToken);
    const page = await request('messages?' + search);
    const receipts = [];
    const messages = page.messages || [];
    // This project's current quota is 6,000 units/minute; messages.get costs 20.
    // Space starts below that rate, including when requests finish very quickly.
    let previousReadAt = -Infinity;
    for (const row of messages) {
      const delay = 250 - (this.clock() - previousReadAt);
      if (delay > 0) { insist(delay < deadline - this.clock(), 'Gmail could not complete the receipt sync'); await this.sleeper(delay); }
      previousReadAt = this.clock();
      const receipt = parseReceipt(await request(`messages/${encodeURIComponent(row.id)}?format=full`), provider, this.config); if (receipt) receipts.push(receipt);
    }
    return { receipts, cursor: page.nextPageToken ? { after, before, pageToken: page.nextPageToken } : { after: before - 2 * 86400 }, complete: !page.nextPageToken, verified: provider === 'venmo' || this.config.cashappTemplateVerified === true, at: now, coverage: { from: new Date(after * 1000).toISOString(), through: new Date(before * 1000).toISOString() } };
  }
}
