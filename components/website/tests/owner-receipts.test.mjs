import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, authenticatedProvider, GmailFeed } from '../supabase/functions/_shared/receipts.mjs';

// Entirely synthetic. Observed provider structures are represented without real records.
const sample = () => ({ id: 'synthetic001', internalDate: '1788501808000', payload: { mimeType: 'text/html', headers: [
  { name: 'From', value: 'Venmo <reviewer@example.invalid>' },
  { name: 'Subject', value: 'Example Payer paid you $38.00' },
  { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass reviewer@example.invalid header.s=example; dmarc=pass (p=REJECT) header.from=venmo.com' },
  { name: 'Date', value: 'Thu, 03 Sep 2026 22:03:28 +0000' }
], body: { content: '<style>hidden</style><p>Example Payer paid you $38.00</p><p>Money credited to your Venmo account.</p><p>Transaction details Date Sep 03, 2026 Transaction ID 9000000000000000001</p>' } } });
const cashSample = (amount = '40', options = {}) => {
  const { plainAmount = amount, creditAmount = amount, transaction = 'F-a0123b4c5', completion = 'Complete Payment received', subject = 'Payment received', from = 'Cash App <reviewer@example.invalid>', auth = 'mx.google.com; dkim=pass reviewer@example.invalid header.s=example; dmarc=pass header.from=square.com', duplicateAuth = false, mime = false, quotedPrintable = false, literalUnicode = false, payerName = 'Example Full Payer', displayName = 'Example Display', receiptPath = 'receipt/synthetic' } = options;
  const plain = `You were sent $${plainAmount} by ${payerName}. To view your receipt, visit: https://cash.app/${receiptPath}`;
  const html = `<p>${displayName} paid you $${amount}</p><p>+$${creditAmount}</p><p>Transaction details ${completion}</p><p>to Cash balance Transaction number #${transaction}</p><p>Open this receipt in Cash App</p>`;
  const quoted = value => Buffer.from(value).toString('hex').replace(/../g, byte => '=' + byte.toUpperCase());
  const body = value => { const encoded = quotedPrintable && !literalUnicode ? quoted(value) : value; return mime ? { data: Buffer.from(encoded).toString('base64url') } : { content: encoded }; };
  return { id: 'cash-synthetic-001', internalDate: '1788501808000', payload: { mimeType: 'multipart/alternative', headers: [
    { name: 'From', value: from }, { name: 'Subject', value: subject },
    ...(duplicateAuth ? [{ name: 'Authentication-Results', value: 'mx.google.com; dkim=fail; dmarc=fail header.from=square.com' }] : []),
    { name: 'Authentication-Results', value: auth }, { name: 'Date', value: 'Thu, 03 Sep 2026 22:03:28 -0500' }
  ], parts: [{ mimeType: 'text/plain', headers: quotedPrintable ? [{ name: 'Content-Transfer-Encoding', value: 'quoted-printable' }] : [], body: body(plain) }, { mimeType: 'text/html', headers: quotedPrintable ? [{ name: 'Content-Transfer-Encoding', value: 'quoted-printable' }] : [], body: body(html) }] } };
};

test('authenticated incoming receipt extracts exact identity and excludes transfers', () => {
  const m = sample(), r = parseReceipt(m, 'venmo');
  assert.equal(r.amountCents, 3800); assert.equal(r.providerId, '100000000000000001'); assert.equal(r.authenticated, true);
  assert.equal(r.providerTimezone, '+0000');
  m.payload.headers[1].value = 'Your Venmo instant transfer has been sent'; assert.equal(parseReceipt(m, 'venmo'), null);
});
test('forged sender, duplicate authentication header, and absent transaction fail closed', () => {
  const m = sample(); m.payload.headers[0].value = 'Venmo <venmo@venmo.com.attacker.invalid>';
  assert.equal(authenticatedProvider(m.payload, 'venmo'), false);
  const duplicate = sample(); duplicate.payload.headers.splice(2, 0, { name: 'Authentication-Results', value: 'mx.google.com; dkim=fail; dmarc=fail header.from=venmo.com' });
  assert.equal(parseReceipt(duplicate, 'venmo').authenticated, false);
  const noId = sample(); noId.payload.body.content = 'Money credited to your Venmo account.';
  assert.equal(parseReceipt(noId, 'venmo').direction, 'unknown');
});

test('Cash App accepts only the observed authenticated MIME receipt and holds malformed or outgoing notices for review', () => {
  const integerReceipt = parseReceipt(cashSample(), 'cashapp', { cashappTemplateVerified: true });
  assert.equal(integerReceipt.amountCents, 4000);
  const receipt = parseReceipt(cashSample('40.50', { mime: true, quotedPrintable: true }), 'cashapp', { cashappTemplateVerified: true });
  assert.deepEqual({ amountCents: receipt.amountCents, payerName: receipt.payerName, providerId: receipt.providerId, status: receipt.status, providerDate: receipt.providerDate, providerTimezone: receipt.providerTimezone }, { amountCents: 4050, payerName: 'Example Full Payer', providerId: 'F-a0123b4c5', status: 'received', providerDate: null, providerTimezone: '-0500' });
  assert.equal(parseReceipt(cashSample('40', { quotedPrintable: true, literalUnicode: true, payerName: 'Example Caf\u00e9' }), 'cashapp', { cashappTemplateVerified: true }).payerName, 'Example Caf\u00e9');
  for (const input of [
    cashSample('40', { plainAmount: '' }), cashSample('40', { plainAmount: '40.01' }), cashSample('40', { creditAmount: '' }), cashSample('40', { creditAmount: '40.01' }),
    cashSample('40', { transaction: '' }), cashSample('40', { transaction: 'not-a-transaction' }), cashSample('40', { completion: '' }), cashSample('40', { completion: 'Pending Payment received' }), cashSample('40', { receiptPath: 'not-a-receipt/synthetic' }),
    cashSample('40', { subject: 'Transfer received' }),
    cashSample('40', { subject: 'You paid $40' }), cashSample('40', { from: 'Cash App <cash@square.com.attacker.invalid>' }),
    cashSample('40', { duplicateAuth: true })
  ]) {
    const parsed = parseReceipt(input, 'cashapp', { cashappTemplateVerified: true });
    assert.ok(parsed === null || (parsed.status === 'review' && parsed.amountCents === 0));
  }
});

test('Gmail is GET-only after token refresh, bound to the approved mailbox, and resumes a stable backfill after outage',async()=>{
  const calls=[];let pages=0;
  const fetcher=async(url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET'});
    let data;
    if(String(url).includes('/token'))data={access_token:'synthetic-token',scope:'https://www.googleapis.com/auth/gmail.readonly'};
    else if(String(url).endsWith('/profile'))data={emailAddress:'owner@example.invalid'};
    else if(String(url).includes('/messages?'))data=++pages===1?{messages:[{id:'synthetic001'}],nextPageToken:'synthetic-next-page'}:{messages:[]};
    else data=sample();
    return Response.json(data);
  };
  const f=new GmailFeed({clientId:'synthetic-id',clientSecret:'synthetic-secret',refreshToken:'synthetic-refresh',mailbox:'owner@example.invalid'},fetcher);
  const a=await f.batch('venmo',null,'2026-09-04T23:00:00Z');assert.equal(a.complete,false);assert.equal(a.receipts.length,1);
  const b=await f.batch('venmo',a.cursor,'2026-09-11T23:00:00Z');assert.equal(b.complete,true);
  assert.equal(b.coverage.through, '2026-09-04T23:00:00.000Z');
  assert.deepEqual(b.coverage, a.coverage); // Finishing an old page is not proof of the intervening week's mail.
  const queries=calls.filter(x=>x.url.includes('/messages?')).map(x=>new URL(x.url).searchParams.get('q'));
  assert.equal(queries[0],queries[1]);assert.ok(calls.filter(x=>!x.url.includes('/token')).every(x=>x.method==='GET'));
  await f.batch('cashapp',null,'2026-09-04T23:00:00Z');
  assert.match(new URL(calls.filter(x=>x.url.includes('/messages?')).at(-1).url).searchParams.get('q'), /\{from:cash\.app from:square\.com from:squareup\.com\}/);
  const wrong=new GmailFeed({...f.config,mailbox:'different@example.invalid'},fetcher);await assert.rejects(wrong.batch('venmo'),/approved receipt mailbox/);
});

test('Gmail rejects missing or broader authorization before reading the mailbox', async () => {
  for (const scope of [undefined, '', 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send']) {
    const calls = [];
    const feed = new GmailFeed({ clientId: 'synthetic-id', clientSecret: 'synthetic-secret', refreshToken: 'synthetic-refresh' }, async url => {
      calls.push(String(url));
      return Response.json({ access_token: 'synthetic-token', scope });
    });
    await assert.rejects(feed.batch('venmo'), /only the approved read-only scope/);
    assert.deepEqual(calls, ['https://oauth2.googleapis.com/token']);
  }
});

test('Gmail reads receipts sequentially and retries only bounded rate limits', async () => {
  const run = async ({ failures = [], deadline = 20000 }) => {
    let attempts = 0, active = 0, maximumActive = 0, time = 0; const sleeps = [];
    const feed = new GmailFeed({ clientId: 'synthetic-id', clientSecret: 'synthetic-secret', refreshToken: 'synthetic-refresh', mailbox: 'owner@example.invalid' }, async url => {
      const value = String(url);
      if (value.includes('/token')) return Response.json({ access_token: 'synthetic-token', scope: 'https://www.googleapis.com/auth/gmail.readonly' });
      if (value.endsWith('/profile')) return Response.json({ emailAddress: 'owner@example.invalid' });
      if (value.includes('/messages?')) return Response.json({ messages: [{ id: 'first' }, { id: 'second' }] });
      attempts++; active++; maximumActive = Math.max(maximumActive, active); await Promise.resolve(); active--;
      const failure = failures[attempts - 1]; time += failure?.elapsed || 0;
      return failure ? Response.json({ error: { errors: [{ reason: failure.reason }] } }, { status: failure.status, headers: failure.retryAfter ? { 'retry-after': failure.retryAfter } : {} }) : Response.json(sample());
    }, { clock: () => time, sleeper: async milliseconds => { sleeps.push(milliseconds); time += milliseconds; }, batchDeadlineMs: deadline });
    return { feed, result: () => ({ attempts, maximumActive, sleeps }) };
  };
  const transient = await run({ failures: [{ status: 403, reason: 'rateLimitExceeded', retryAfter: '1' }] });
  assert.equal((await transient.feed.batch('venmo')).receipts.length, 2); assert.deepEqual(transient.result(), { attempts: 3, maximumActive: 1, sleeps: [1000] });
  const paced = await run({});
  assert.equal((await paced.feed.batch('venmo')).receipts.length, 2); assert.deepEqual(paced.result(), { attempts: 2, maximumActive: 1, sleeps: [250] });
  const permanent = await run({ failures: [{ status: 403, reason: 'forbidden' }] });
  await assert.rejects(permanent.feed.batch('venmo'), /Gmail could not complete the receipt sync/); assert.deepEqual(permanent.result(), { attempts: 1, maximumActive: 1, sleeps: [] });
  const exhausted = await run({ failures: [{ status: 429 }, { status: 429 }], deadline: 1500 });
  await assert.rejects(exhausted.feed.batch('venmo'), /Gmail could not complete the receipt sync/); assert.deepEqual(exhausted.result(), { attempts: 2, maximumActive: 1, sleeps: [1000] });
  const slowResponse = await run({ failures: [{ status: 429, elapsed: 18000, retryAfter: '3' }] });
  await assert.rejects(slowResponse.feed.batch('venmo'), /Gmail could not complete the receipt sync/); assert.deepEqual(slowResponse.result(), { attempts: 1, maximumActive: 1, sleeps: [] });
});
