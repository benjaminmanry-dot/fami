import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { callbackCode, exchangeAndSave, GMAIL_MAILBOX, GMAIL_SCOPE, isMainEntry } from '../scripts/owner-authorize-gmail.mjs';

const client = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret', redirectUri: 'http://127.0.0.1:8766/oauth/callback' };
const request = (url, host = '127.0.0.1:8766') => ({ method: 'GET', host, url });
const temporary = async run => { const directory = await mkdtemp(join(tmpdir(), 'owner-gmail-auth-')); try { return await run(directory); } finally { await rm(directory, { recursive: true, force: true }); } };
const fakeFetch = ({ access = 'synthetic-access', scope = GMAIL_SCOPE, mailbox = GMAIL_MAILBOX } = {}) => async (url, options = {}) => {
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: access, refresh_token: 'synthetic-refresh', scope });
  assert.equal(options.headers.Authorization, 'Bearer synthetic-access'); return Response.json({ emailAddress: mailbox });
};

test('only one exact localhost callback can supply a code', () => {
  const state = 'synthetic-state';
  assert.equal(callbackCode(request('/oauth/callback?state=wrong&code=synthetic-code'), state), null);
  assert.equal(callbackCode(request('/oauth/callback?state=synthetic-state&code=synthetic-code', 'localhost:8766'), state), null);
  assert.equal(callbackCode(request('https://not-loopback.invalid/oauth/callback?state=synthetic-state&code=synthetic-code'), state), null);
  assert.equal(callbackCode(request('/oauth/callback?state=synthetic-state&state=synthetic-state&code=synthetic-code'), state), null);
  assert.equal(callbackCode(request('/oauth/callback?state=synthetic-state&code=synthetic-code'), state), 'synthetic-code');
});

test('the direct-run guard is portable and safe when argv is missing', () => {
  const entry = resolve('scripts', 'owner-authorize-gmail.mjs');
  assert.equal(isMainEntry(pathToFileURL(entry).href, entry), true);
  assert.equal(isMainEntry(pathToFileURL(entry).href), false);
});

test('broader or missing scope and a mismatched mailbox never save credentials', async () => {
  for (const reply of [{ access: '' }, { scope: '' }, { scope: `${GMAIL_SCOPE} https://www.googleapis.com/auth/gmail.modify` }, { mailbox: 'different@example.invalid' }]) await temporary(async privateDir => {
    await assert.rejects(exchangeAndSave({ client, code: 'synthetic-code', verifier: 'synthetic-verifier', privateDir, fetchImpl: fakeFetch(reply) }), /did not complete/);
    await assert.rejects(readFile(join(privateDir, 'gmail-authorization.env')));
  });
});

test('valid exact consent saves only private env entries', async () => await temporary(async privateDir => {
  const saved = await exchangeAndSave({ client, code: 'synthetic-code', verifier: 'synthetic-verifier', privateDir, fetchImpl: fakeFetch() });
  assert.equal(saved, join(privateDir, 'gmail-authorization.env'));
  assert.equal(await readFile(saved, 'utf8'), 'GMAIL_CLIENT_ID="synthetic-client"\nGMAIL_CLIENT_SECRET="synthetic-secret"\nGMAIL_REFRESH_TOKEN="synthetic-refresh"\nGMAIL_RECEIPT_MAILBOX="reviewer@example.invalid"\n');
}));
