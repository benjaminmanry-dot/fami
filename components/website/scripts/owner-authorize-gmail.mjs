import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_MAILBOX = 'reviewer@example.invalid';
const CALLBACK_PATH = '/oauth/callback';
const COMPLETE_PATH = '/oauth/complete';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
const genericFailure = new Error('Gmail authorization did not complete');

const exactScope = value => {
  const scopes = String(value || '').trim().split(/\s+/).filter(Boolean);
  return scopes.length === 1 && scopes[0] === GMAIL_SCOPE;
};
const safeValue = value => typeof value === 'string' && value.length > 0 && !/[\r\n]/.test(value);
const localUrl = (raw, port = 8766) => {
  const origin = `http://127.0.0.1:${port}`;
  try { const url = new URL(raw, origin); return url.origin === origin ? url : null; } catch { return null; }
};

export function callbackCode(request, state, port = 8766) {
  if (request.method !== 'GET' || request.host !== `127.0.0.1:${port}`) return null;
  const url = localUrl(request.url, port);
  if (!url) return null;
  if (url.pathname !== CALLBACK_PATH || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1 || url.searchParams.get('state') !== state) return null;
  const code = url.searchParams.get('code');
  return safeValue(code) && code.length <= 4096 ? code : null;
}

export async function exchangeAndSave({ client, code, verifier, privateDir, fetchImpl = fetch }) {
  const token = await fetchImpl(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: client.redirectUri }), signal: AbortSignal.timeout(15000)
  });
  if (!token.ok) throw genericFailure;
  const tokenData = await token.json();
  if (!safeValue(tokenData.access_token) || !safeValue(tokenData.refresh_token) || !exactScope(tokenData.scope)) throw genericFailure;
  const profile = await fetchImpl(PROFILE_URL, { headers: { Authorization: `Bearer ${tokenData.access_token}` }, signal: AbortSignal.timeout(15000) });
  if (!profile.ok || (await profile.json()).emailAddress !== GMAIL_MAILBOX) throw genericFailure;
  const destination = resolve(privateDir, 'gmail-authorization.env');
  const contents = [
    `GMAIL_CLIENT_ID=${JSON.stringify(client.clientId)}`,
    `GMAIL_CLIENT_SECRET=${JSON.stringify(client.clientSecret)}`,
    `GMAIL_REFRESH_TOKEN=${JSON.stringify(tokenData.refresh_token)}`,
    `GMAIL_RECEIPT_MAILBOX=${JSON.stringify(GMAIL_MAILBOX)}`
  ].join('\n') + '\n';
  try { await writeFile(destination, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); } catch { throw genericFailure; }
  return destination;
}

async function readClient(privateDir) {
  let raw;
  try { raw = await readFile(resolve(privateDir, 'gmail-oauth-client.json'), 'utf8'); } catch { throw genericFailure; }
  let web;
  try { web = JSON.parse(raw).web; } catch { throw genericFailure; }
  const redirectUri = 'http://127.0.0.1:8766/oauth/callback';
  if (!safeValue(web?.client_id) || !safeValue(web?.client_secret) || !Array.isArray(web?.redirect_uris) || !web.redirect_uris.includes(redirectUri)) throw genericFailure;
  return { clientId: web.client_id, clientSecret: web.client_secret, redirectUri };
}

export async function authorizeGmail({ privateDir = resolve(process.cwd(), '.owner-private'), fetchImpl = fetch, timeoutMs = 20 * 60 * 1000 } = {}) {
  const client = await readClient(privateDir), state = randomBytes(32).toString('base64url'), verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.search = new URLSearchParams({ client_id: client.clientId, redirect_uri: client.redirectUri, response_type: 'code', scope: GMAIL_SCOPE, access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' });
  try { await writeFile(resolve(privateDir, 'gmail-authorization-url.txt'), authorizationUrl + '\n', { encoding: 'utf8', mode: 0o600 }); } catch { throw genericFailure; }
  let server;
  const code = await new Promise((resolveCode, rejectCode) => {
    const fail = () => { clearTimeout(timer); server?.close(); rejectCode(genericFailure); };
    let accepted = false;
    server = createServer((req, res) => {
      const host = req.headers.host || '', candidate = callbackCode({ method: req.method, host, url: req.url || '' }, state);
      const url = localUrl(req.url || '');
      const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-type': 'text/plain; charset=utf-8' };
      if (req.method === 'GET' && host === '127.0.0.1:8766' && url?.pathname === COMPLETE_PATH) { res.writeHead(200, headers); res.end('Authorization received. You may return to the terminal.'); return; }
      if (!candidate || accepted) { res.writeHead(400, headers); res.end('Authorization could not be completed.'); return; }
      accepted = true; clearTimeout(timer); res.writeHead(303, { ...headers, Location: COMPLETE_PATH }); res.end(); resolveCode(candidate);
    });
    const timer = setTimeout(fail, timeoutMs);
    server.once('error', fail); server.listen(8766, '127.0.0.1');
  });
  try { return await exchangeAndSave({ client, code, verifier, privateDir, fetchImpl }); } finally { server.close(); }
}

export function isMainEntry(moduleUrl, argv1) {
  return typeof argv1 === 'string' && argv1.length > 0 && moduleUrl === pathToFileURL(resolve(argv1)).href;
}

if (isMainEntry(import.meta.url, process.argv[1])) {
  authorizeGmail().then(() => console.log('Gmail authorization saved privately.')).catch(() => { console.error('Gmail authorization did not complete.'); process.exitCode = 1; });
}
