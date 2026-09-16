import { insist, OwnerError } from './ledger.mjs';
import { encryptBackup } from './backup.mjs';

export async function verifyOwner(client, token, ownerId) {
  insist(token && token.length < 12000 && ownerId, 'Owner sign-in is required');
  const [userResult, claimResult] = await Promise.all([client.auth.getUser(token), client.auth.getClaims(token)]);
  const user = userResult.data?.user, claims = claimResult.data?.claims;
  insist(!userResult.error && !claimResult.error && user?.id === ownerId && claims?.sub === ownerId && claims?.role === 'authenticated' && claims?.aal === 'aal2' && user.factors?.some(f => f.status === 'verified' && f.factor_type === 'totp'), 'Owner sign-in with the authenticator is required');
  return ownerId;
}
async function secretMatches(received, expected) {
  if (!received || !expected || received.length > 512) return false;
  const hash = async x => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(x)));
  const [a, b] = await Promise.all([hash(received), hash(expected)]); let mismatch = 0; for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i]; return mismatch === 0;
}
async function limitedText(req, max) {
  if (Number(req.headers.get('content-length')) > max) throw new Error('Request is too large');
  const reader = req.body?.getReader(); if (!reader) return ''; const chunks = []; let size = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); throw new Error('Request is too large'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let pos = 0; for (const c of chunks) { bytes.set(c, pos); pos += c.length; } return new TextDecoder().decode(bytes);
}
export function ownerHandler({ service, store, authorize, origin, cronSecret, backupSecret, backupKey, webhookSecret, gateway, background = () => {} }) {
  return async req => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'Pragma': 'no-cache', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    const requestOrigin = req.headers.get('origin');
    if (requestOrigin && requestOrigin !== origin) return reply({ error: 'This origin is not allowed' }, 403);
    if (requestOrigin === origin) { headers['Access-Control-Allow-Origin'] = origin; headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type'; headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'; }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405);
    const path = new URL(req.url).pathname.replace(/\/$/, '');
    try {
      if (path.endsWith('/stripe-event')) {
        const raw = await limitedText(req, 1000000); let event;
        try { event = await gateway.event(raw, req.headers.get('stripe-signature'), webhookSecret); } catch { return reply({ error: 'Invalid Stripe signature' }, 401); }
        await service.stripeEvent(event); return reply({ received: true });
      }
      if (path.endsWith('/cron')) {
        if (!await secretMatches(req.headers.get('x-owner-cron-secret'), cronSecret)) return reply({ error: 'Worker authorization required' }, 401);
        // The native schedule owns the tracking cadence. Checking elapsed time
        // again could skip a run arriving just short of fifteen minutes.
        if (service.trackingOnly) await service.sync(true);
        else if (await store.due()) await service.work();
        return reply({ ok: true });
      }
      if (path.endsWith('/backup')) { if (!await secretMatches(req.headers.get('x-owner-backup-secret'), backupSecret)) return reply({ error: 'Backup authorization required' }, 401); return reply(await encryptBackup(await store.backup(), backupKey)); }
      let actor;
      try { const bearer = req.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1]; actor = await authorize(bearer); } catch { return reply({ error: 'Owner sign-in with the authenticator is required' }, 401); }
      insist(req.headers.get('content-type')?.startsWith('application/json'), 'Use JSON for private operations');
      const input = JSON.parse(await limitedText(req, 2000000)); insist(input && typeof input === 'object', 'Invalid private request');
      switch (input.action) {
        case 'view': return reply(await service.view(input.month));
        case 'refresh': return reply(await service.sync(true));
        case 'preview': return reply(await service.preview(input.input));
        case 'plan-period': return reply(await service.planPeriod(input.input));
        case 'statement': return reply(await service.statement(input.payerId, input.items));
        case 'command': {
          const result = await service.command(input.command, actor);
          if (!service.trackingOnly && ['closeSession', 'collectBalance'].includes(input.command.type)) background(service.work().catch(() => {}));
          return reply(result);
        }
        case 'setup': return reply(await service.setup(input.payerId, input.requestId, actor));
        case 'export': return reply(await store.backup());
        default: return reply({ error: 'Unknown private operation' }, 400);
      }
    } catch (error) {
      // Only locally authored validation errors are suitable for the owner.
      // No provider payload, token, email body or stack is logged or returned.
      const safe = error instanceof OwnerError;
      return reply({ error: safe ? error.message : 'The private operation could not be verified. Refresh the panel and review its status before continuing.' }, 400);
    }
  };
}
