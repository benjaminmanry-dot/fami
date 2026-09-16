import test from 'node:test';
import assert from 'node:assert/strict';
import { simulationRuntime, DEMO_TIME } from '../scripts/owner-simulation.mjs';
import { ownerService } from '../supabase/functions/_shared/service.mjs';
import { ownerHandler } from '../supabase/functions/_shared/http.mjs';
import { balance, collectionHold, dashboard } from '../supabase/functions/_shared/ledger.mjs';
import { stripeGateway } from '../supabase/functions/_shared/stripe.mjs';
import { prepareRestore } from '../supabase/functions/_shared/backup.mjs';
import { checkRestore } from '../scripts/owner-backup.mjs';
import { readFile } from 'node:fs/promises';

test('an authorized tracking schedule refreshes receipts despite timing jitter and never drains collection', async () => {
  let refreshed = 0;
  const handler = ownerHandler({
    service: { trackingOnly: true, sync: async force => { assert.equal(force, true); refreshed++; }, work: async () => assert.fail('Tracking schedule entered collection work') },
    store: { due: async () => false }, cronSecret: 'synthetic-worker-secret'
  });
  const response = await handler(new Request('https://owner.example.invalid/cron', { method: 'POST', headers: { 'x-owner-cron-secret': 'synthetic-worker-secret' } }));
  assert.equal(response.status, 200); assert.equal(refreshed, 1);
});

test('tracking records capped absent, monthly and waived fees with no later collection backlog', async () => {
  const r = await simulationRuntime({ trackingOnly: true });
  try {
    r.gmail.batch = async () => { throw new Error('Receipt connection unavailable'); };
    r.gateway.history = async () => { throw new Error('Read-only Stripe unavailable'); };
    await r.store.transact(s => { s.settings.recoveryHold = true; s.settings.historyConfirmedAt = null; });
    const input = { sessionId: 'session-today', minutes: 210, rows: [{ playerId: 'player-0', attendance: 'absent' }, { playerId: 'player-4', disposition: 'waive' }] };
    const reviewed = await r.service.preview(input);
    assert.equal(reviewed.collectTotalCents, 0);
    assert.equal(reviewed.obligationTotalCents, 11500);
    assert.equal(reviewed.rows[0].disposition, 'record');
    assert.equal(reviewed.rows[1].disposition, 'monthly');
    const command = { type: 'closeSession', input, reviewed };
    await Promise.all([r.service.command(command, 'owner'), r.service.command(command, 'owner')]);
    await r.service.work();
    const s = (await r.store.read()).body;
    assert.equal(s.obligations.length, 5); assert.equal(s.operations.length, 0); assert.equal(r.calls.length, 0);
    assert.ok(s.obligations.every(o => o.collectionEligible === false && o.collectCents === 0));
    assert.equal(s.obligations[0].attendance, 'absent'); assert.equal(s.obligations[2].amountCents, 2500);
    assert.equal((await r.service.view()).trackingOnly, true);
    // Even a later separately activated collection service cannot turn these
    // permanent record-only fees into provider actions.
    assert.match(collectionHold(s, s.payers[0], [s.obligations[0]], DEMO_TIME), /record-only/i);
    const restored = prepareRestore(await r.store.backup());
    assert.ok(restored.ledger.body.obligations.every(o => o.collectionEligible === false));
    assert.equal((await checkRestore(restored)).verified, true);
    await assert.rejects(r.store.transact(body => { body.obligations[0].collectionEligible = true; }), /Historical obligation changed/);
  } finally { await r.db.close(); }
});

test('crafted owner requests and worker calls cannot cross the tracking write boundary', async () => {
  const r = await simulationRuntime({ trackingOnly: true });
  try {
    const service = ownerService({ store: r.store, gateway: r.gateway, gmail: r.gmail, collectionActivated: true, clock: () => DEMO_TIME });
    r.gateway.allowWrites = true;
    const handler = ownerHandler({ service, store: r.store, gateway: r.gateway, origin: 'https://20fates.com', authorize: async () => 'owner', cronSecret: 'synthetic-worker' });
    const request = (body, path = '', extra = {}) => handler(new Request(`https://example.supabase.co/owner-api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner', Origin: 'https://20fates.com', ...extra }, body: JSON.stringify(body) }));
    for (const body of [
      { action: 'setup', payerId: 'payer-0', requestId: 'crafted-setup' },
      { action: 'command', command: { type: 'collectionSwitch', enabled: true, trackingOnly: false } },
      { action: 'command', command: { type: 'collectBalance', id: 'crafted-collect', payerId: 'payer-0', items: [] } },
      { action: 'command', command: { type: 'recordAuthorization', payerId: 'payer-0', effectiveFrom: '2026-09-04', evidence: 'not new charge authority' } },
      { action: 'preview', input: { sessionId: 'session-today', minutes: 120, trackingOnly: false, rows: [{ playerId: 'player-0', disposition: 'collect' }] } },
      { action: 'statement', payerId: 'payer-0', items: [] }
    ]) { const response = await request(body); assert.equal(response.status, 400); assert.match((await response.json()).error, /tracking|record-only/i); }
    await r.store.transact(s => { s.settings.collectionEnabled = true; s.operations.push({ id: 'old-queue', status: 'queued', payerId: 'payer-0', items: [] }); });
    await service.work(); assert.equal((await request({}, '/cron', { 'x-owner-cron-secret': 'synthetic-worker' })).status, 200);
    assert.equal(r.calls.length, 0); assert.equal((await r.store.read()).body.setupRequests.length, 0);
    assert.equal((await service.view()).collectionActivated, false);
    assert.equal((await service.view()).overview.collectionEnabled, false);
    await assert.rejects(r.service.command({ type: 'importHistory', data: { schema: '20fates-history/1' } }, 'owner'), /fictional rehearsal/);
    const deployment = await readFile(new URL('../supabase/functions/owner-api/index.ts', import.meta.url), 'utf8');
    assert.match(deployment, /const trackingOnly = true;/); assert.match(deployment, /const providerWrites = !trackingOnly &&/);
    const provider = stripeGateway({}, { trackingOnly: true, allowWrites: true });
    await assert.rejects(provider.collect({}, {}, () => { throw new Error('effect called'); }), /tracking|activated/i);
    await assert.rejects(provider.setup({}, {}, () => { throw new Error('effect called'); }), /tracking|activated/i);
  } finally { await r.db.close(); }
});

test('tracking visibility names missing, stale and uncovered intervals without implying unpaid balances', async () => {
  const r = await simulationRuntime({ trackingOnly: true });
  try {
    await r.service.sync(true);
    let s = (await r.store.read()).body;
    assert.equal(dashboard(s, DEMO_TIME).coverage.complete, false);
    await r.store.transact(body => { body.settings.recoveryHold = true; body.settings.historyConfirmedAt = null; });
    await r.service.command({ type: 'confirmTracking', from: '2026-09-01', confirmation: 'ROSTER, FEES AND TRACKING HISTORY REVIEWED' }, 'owner');
    s = (await r.store.read()).body;
    assert.equal(s.settings.collectionEnabled, false);
    assert.equal(s.settings.recoveryHold, true); assert.equal(s.settings.historyConfirmedAt, null);
    assert.equal(dashboard(s, DEMO_TIME).coverage.complete, true);
    assert.equal(dashboard(s, '2026-09-05T01:00:00Z').coverage.complete, false);
    assert.equal(dashboard(s, DEMO_TIME, '2026-05').coverage.complete, false);
    assert.equal(dashboard(s, DEMO_TIME, '2026-10').coverage.complete, false);
    s.feeds.cashapp.verified = false;
    assert.ok(dashboard(s, DEMO_TIME).coverage.gaps.some(x => /Cash App/.test(x)));
    s.feeds.cashapp.verified = true; s.feeds.cashapp.status = 'backfilling';
    assert.equal(dashboard(s, DEMO_TIME).coverage.complete, false);
    const restore = prepareRestore(await r.store.backup());
    assert.equal(restore.ledger.body.settings.trackingConfirmedAt, null);
  } finally { await r.db.close(); }
});

test('tracking preserves receipt identities, partial and cross-session allocations without provider actions', async () => {
  const r = await simulationRuntime({ trackingOnly: true });
  try {
    for (const sessionId of ['session-previous', 'session-today']) {
      const input = { sessionId, minutes: 120 }; await r.service.command({ type: 'closeSession', input, reviewed: await r.service.preview(input) }, 'owner');
    }
    const receipt = { id: 'venmo:trackingreceipt', providerId: 'trackingreceipt', provider: 'venmo', payerName: 'Rowan Example', amountCents: 2500, currency: 'usd', direction: 'incoming', receivedAt: DEMO_TIME, authenticated: true, status: 'received', source: 'gmail' };
    r.gmail.batch = async (provider, cursor, at) => ({ receipts: provider === 'venmo' ? [receipt] : [], cursor: null, at, complete: true, verified: true, coverage: { from: '2026-06-06T23:00:00Z', through: at } });
    await r.service.sync(true); await r.service.sync(true);
    let s = (await r.store.read()).body;
    assert.equal(s.receipts.length, 1); assert.equal(s.allocations.length, 0); assert.match(s.receipts[0].reviewReason, /Choose/);
    await r.service.command({ type: 'allocateReceipt', receiptId: receipt.id, payerId: 'payer-0', allocations: [{ obligationId: 'session-previous:player-0', amountCents: 1900 }, { obligationId: 'session-today:player-0', amountCents: 600 }] }, 'owner');
    s = (await r.store.read()).body;
    assert.equal(balance(s, 'session-previous:player-0'), 0); assert.equal(balance(s, 'session-today:player-0'), 1300);
    assert.equal(s.operations.length, 0); assert.equal(r.calls.length, 0);
    assert.ok(s.obligations.every(o => o.collectionEligible === false));
  } finally { await r.db.close(); }
});
