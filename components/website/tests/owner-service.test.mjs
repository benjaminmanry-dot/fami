import test from 'node:test';
import assert from 'node:assert/strict';
import { simulationRuntime, DEMO_TIME } from '../scripts/owner-simulation.mjs';
import { ownerHandler, verifyOwner } from '../supabase/functions/_shared/http.mjs';
import { encryptBackup, decryptBackup, prepareRestore } from '../supabase/functions/_shared/backup.mjs';
import { balance } from '../supabase/functions/_shared/ledger.mjs';
import { checkRestore } from '../scripts/owner-backup.mjs';

test('one confirmation survives concurrency, mixed outcomes, duplicate clicks and event replay', async () => {
  const r = await simulationRuntime({ trackingOnly: false });
  try {
    await r.service.command({ type: 'collectionSwitch', enabled: true }, 'owner');
    const input = { sessionId: 'session-today', minutes: 240 }, reviewed = await r.service.preview(input);
    assert.equal(reviewed.collectTotalCents, 5500);
    const cmd = { type: 'closeSession', input, reviewed };
    await Promise.all([r.service.command(cmd, 'owner'), r.service.command(cmd, 'owner')]);
    await Promise.all([r.service.work(), r.service.work()]);
    let s = (await r.store.read()).body;
    assert.equal(s.obligations.length, 5);
    assert.equal(r.calls.filter(c => c.phase === 'pay').length, 2);
    assert.equal(s.operations.filter(o => o.status === 'succeeded').length, 1);
    assert.equal(s.operations.filter(o => o.status === 'failed').length, 1);
    assert.equal(s.operations.filter(o => o.status === 'held').length, 2);
    assert.equal(balance(s, 'session-today:player-0'), 0);
    assert.equal(balance(s, 'session-today:player-1'), 3000);
    const op = s.operations.find(o => o.status === 'succeeded');
    const event = { id: 'evt_synthetic', livemode: false, type: 'invoice.paid', data: { object: { id: op.invoiceId } } };
    await r.service.stripeEvent(event); await r.service.stripeEvent(event); await r.service.work();
    s = (await r.store.read()).body;
    assert.equal(s.receipts.length, 1); assert.equal(s.allocations.length, 1); assert.equal(s.events.length, 1);
    assert.equal(r.calls.filter(c => c.phase === 'pay').length, 2);
  } finally { await r.db.close(); }
});

test('revoked consent, late receipt and feed outage stop unstarted collection', async () => {
  for (const barrier of ['revoked', 'late-receipt', 'offline']) {
    const r = await simulationRuntime({ trackingOnly: false });
    try {
      await r.service.command({ type: 'collectionSwitch', enabled: true }, 'owner');
      const input = { sessionId: 'session-today', minutes: 120, rows: ['player-1','player-2','player-3','player-4'].map(playerId => ({ playerId, disposition: 'defer' })) };
      await r.service.command({ type: 'closeSession', input, reviewed: await r.service.preview(input) }, 'owner');
      if (barrier === 'revoked') await r.service.command({ type: 'revokeAuthorization', payerId: 'payer-0' }, 'owner');
      if (barrier === 'late-receipt') await r.store.transact(s => s.receipts.push({ id: 'venmo:late', providerId: 'late', provider: 'venmo', amountCents: 1900, currency: 'usd', direction: 'incoming', receivedAt: DEMO_TIME, status: 'received', authenticated: true, payerId: 'payer-0', refundedCents: 0, feeCents: null, reviewReason: 'Late receipt' }));
      if (barrier === 'offline') await r.store.transact(s => { s.feeds.cashapp.status = 'disconnected'; });
      await r.service.work(); assert.equal(r.calls.filter(c => c.phase === 'pay').length, 0, barrier);
    } finally { await r.db.close(); }
  }
});

test('lost provider response is reconciled and never re-executed, even days later', async () => {
  let at = DEMO_TIME; const r = await simulationRuntime({ trackingOnly: false, clock: () => at });
  try {
    await r.service.command({ type: 'collectionSwitch', enabled: true }, 'owner');
    const input = { sessionId: 'session-today', minutes: 120, rows: ['player-1','player-2','player-3','player-4'].map(playerId => ({ playerId, disposition: 'defer' })) };
    await r.service.command({ type: 'closeSession', input, reviewed: await r.service.preview(input) }, 'owner');
    const normal = r.gateway.collect; r.gateway.collect = async (...args) => { await normal(...args); throw new Error('Lost response after provider accepted payment'); };
    await r.service.work(); at = '2026-09-07T23:00:00.000Z'; await r.service.work();
    assert.equal(r.calls.filter(c => c.phase === 'pay').length, 1);
    assert.equal((await r.store.read()).body.operations[0].status, 'succeeded');
  } finally { await r.db.close(); }
});

test('owner API rejects unsigned access, other origins, forged webhooks and wrong MFA identities', async () => {
  const r = await simulationRuntime({ trackingOnly: false });
  try {
    const handler = ownerHandler({ service: r.service, store: r.store, gateway: r.gateway, origin: 'https://20fates.com', authorize: async token => { if (token !== 'owner') throw new Error('denied'); return 'owner'; } });
    const req = (headers, body = { action: 'view' }, path = '') => handler(new Request('https://example.supabase.co/functions/v1/owner-api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
    assert.equal((await req({})).status, 401);
    assert.equal((await req({ Authorization: 'Bearer attacker' }, { action: 'command', command: { type: 'collectionSwitch', enabled: true } })).status, 401);
    assert.equal((await req({ Authorization: 'Bearer owner', Origin: 'https://attacker.invalid' })).status, 403);
    assert.equal((await req({ Authorization: 'Bearer owner' }, {}, '/backup')).status, 401);
    assert.equal((await req({}, {}, '/stripe-event')).status, 401);
    const response = await req({ Authorization: 'Bearer owner', Origin: 'https://20fates.com' }); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store, private');
    for (const altered of [{ aal: 'aal1' }, { sub: 'someone-else' }, { role: 'service_role' }]) {
      const client = { auth: { getUser: async () => ({ data: { user: { id: 'owner', factors: [{ status: 'verified', factor_type: 'totp' }] } } }), getClaims: async () => ({ data: { claims: { sub: 'owner', role: 'authenticated', aal: 'aal2', ...altered } } }) } };
      await assert.rejects(verifyOwner(client, 'signed-token', 'owner'));
    }
    assert.equal(r.calls.length, 0);
  } finally { await r.db.close(); }
});

test('encrypted full backup restores identically, rejects tampering, and disables payment replay', async () => {
  const r = await simulationRuntime({ trackingOnly: false });
  try {
    await r.store.fence('paid-operation', 'pay', 'digest');
    const data = await r.store.backup(), secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    const encrypted = await encryptBackup(data, secret), decoded = await decryptBackup(encrypted, secret);
    assert.deepEqual(decoded, data); assert.equal(JSON.stringify(encrypted).includes('Rowan'), false);
    await assert.rejects(decryptBackup({ ...encrypted, ciphertext: 'AA' + encrypted.ciphertext.slice(2) }, secret));
    const restored = prepareRestore(decoded); assert.equal(restored.ledger.body.settings.collectionEnabled, false); assert.equal(restored.ledger.body.settings.recoveryHold, true);
    assert.equal((await checkRestore(decoded)).verified,true);
    const other = await simulationRuntime({ seed: restored.ledger.body });
    try { for (const f of restored.fences) await other.store.fence(f.operation_id, f.phase, f.digest); await other.service.work(); assert.equal(other.calls.length, 0); assert.equal(await other.store.fence('paid-operation','pay','digest'),false); } finally { await other.db.close(); }
  } finally { await r.db.close(); }
});

test('delayed bank success and later refunds update visibility without a second collection',async()=>{
  const r=await simulationRuntime({trackingOnly:false,outcome:'pending'});
  try{
    await r.service.command({type:'collectionSwitch',enabled:true},'owner');
    const input={sessionId:'session-today',minutes:120,rows:['player-1','player-2','player-3','player-4'].map(playerId=>({playerId,disposition:'defer'}))};
    await r.service.command({type:'closeSession',input,reviewed:await r.service.preview(input)},'owner');await r.service.work();
    let s=(await r.store.read()).body,op=s.operations[0];assert.equal(op.status,'pending');assert.equal(s.receipts.length,0);
    const result=r.outcomes.get(op.id);result.status='succeeded';await r.service.reconcile();s=(await r.store.read()).body;assert.equal(s.receipts.length,1);assert.equal(balance(s,op.items[0].obligationId),0);
    result.refundedCents=500;await r.service.stripeEvent({id:'evt_refund_synthetic',livemode:false,type:'charge.refunded',data:{object:{payment_intent:result.paymentIntentId}}});
    s=(await r.store.read()).body;assert.equal(s.receipts[0].refundedCents,500);assert.match(s.receipts[0].reviewReason,/refund/i);await r.service.work();assert.equal(r.calls.filter(c=>c.phase==='pay').length,1);
  }finally{await r.db.close();}
});

test('provider-looking error text cannot leak secrets through the owner API',async()=>{
  const handler=ownerHandler({origin:'https://20fates.com',authorize:async()=> 'owner',service:{view:async()=>{throw new Error('Invalid API Key provided: synthetic-sensitive-value');}}});
  const response=await handler(new Request('https://example.supabase.co/functions/v1/owner-api',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({action:'view'})}));
  assert.equal(response.status,400);assert.equal((await response.text()).includes('synthetic-sensitive-value'),false);
});
