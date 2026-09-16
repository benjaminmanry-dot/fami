import { applyCommand, previewCloseout, previewStatement, previewPayerPlanPeriod, dashboard, get, insist, collectionHold, validateLedger, balance, instant, ident } from './ledger.mjs';

const ownerCommands = new Set(['savePayer', 'savePlayer', 'saveTable', 'saveMembership', 'savePayerPlan', 'saveRosterDraft', 'resolveRosterDraft', 'recordPayerPlanPeriod', 'endMembership', 'saveSession', 'scheduleOccurrences', 'saveDraft', 'cancelSession', 'closeSession', 'collectBalance', 'recordAuthorization', 'revokeAuthorization', 'collectionSwitch', 'confirmOpening', 'confirmTracking', 'allocateReceipt', 'classifyReceipt', 'importHistory']);
const recordAudit = (s, type, now, details = {}) => s.audit.push({ id: `audit:${s.audit.length + 1}`, actor: 'private server', at: now, type, ...details });
export async function digest(value) { const bytes = new TextEncoder().encode(JSON.stringify(value)); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join(''); }

export function ownerService({ store, gateway, gmail, collectionActivated = false, trackingOnly = true, simulation = false, clock = () => new Date().toISOString() }) {
  collectionActivated = !trackingOnly && collectionActivated;
  async function view(month) { const { body, revision } = await store.read(), overview = dashboard(body, clock(), month); if (trackingOnly) overview.collectionEnabled = false; return { ledger: body, revision, overview, environment: simulation ? 'local simulation' : gateway.mode, collectionActivated, trackingOnly }; }
  async function command(cmd, actor) {
    insist(ownerCommands.has(cmd?.type), 'Unknown owner operation');
    insist(!(simulation && cmd.type === 'importHistory'), 'History import is disabled in the fictional rehearsal; never put actual records in its login-bypassed database');
    if (trackingOnly) insist(!['collectBalance', 'recordAuthorization', 'confirmOpening'].includes(cmd.type) && !(cmd.type === 'collectionSwitch' && cmd.enabled), 'Tracking mode cannot activate collection or payment setup');
    if (cmd.type === 'collectionSwitch' && cmd.enabled) insist(collectionActivated, 'Live collection has not been activated for this deployment');
    if (!trackingOnly && (['closeSession', 'collectBalance'].includes(cmd.type) || (cmd.type === 'collectionSwitch' && cmd.enabled))) await sync(true);
    const result = await store.transact(s => applyCommand(s, cmd, actor, clock(), { trackingOnly }));
    return { result: result.result, ...(await view()) };
  }
  async function sync(force = false) {
    const at = clock(); let snapshot = (await store.read()).body;
    for (const provider of ['venmo', 'cashapp']) {
      const f = snapshot.feeds[provider]; if (!force && f.lastAttempt && Date.parse(at) - Date.parse(f.lastAttempt) < 15 * 60000) continue;
      try {
        const batch = await gmail.batch(provider, f.cursor || null, at);
        await store.transact(s => {
          s.feeds[provider].verified = batch.verified === true;
          applyCommand(s, { type: 'ingestReceipts', provider, receipts: batch.receipts, syncedAt: batch.complete ? batch.at : undefined }, 'receipt sync', at);
          Object.assign(s.feeds[provider], { cursor: batch.cursor, lastAttempt: at, ...(batch.complete ? {} : { status: 'backfilling', reason: 'Receipt backfill is still in progress' }) });
          if (batch.complete && batch.coverage) recordCoverage(s.feeds[provider], batch.coverage);
        });
      } catch {
        await store.transact(s => { Object.assign(s.feeds[provider], { status: 'disconnected', lastAttempt: at, reason: provider === 'cashapp' ? 'Cash App receipt connection or authentic template proof is missing' : 'Gmail receipt sync did not complete; check its dedicated authorization' }); });
      }
    }
    snapshot = (await store.read()).body;
    if (force || !snapshot.feeds.stripe.lastAttempt || Date.parse(at) - Date.parse(snapshot.feeds.stripe.lastAttempt) >= 15 * 60000) {
      try {
        const since = new Date(Date.parse(at) - 90 * 86400000).toISOString();
        const receipts = await gateway.history(snapshot, since);
        await store.transact(s => {
          s.feeds.stripe.verified = true;
          applyCommand(s, { type: 'ingestReceipts', provider: 'stripe', receipts, syncedAt: at }, 'Stripe sync', at);
          s.feeds.stripe.lastAttempt = at;
          recordCoverage(s.feeds.stripe, { from: since, through: at });
          // Stripe refunds can alter old payments. Only the rolling interval
          // actually reread is current; older retained records are not proof.
          s.feeds.stripe.coveredFrom = since;
          // Provider updates change outcomes, never original receipt amounts.
          for (const r of receipts) { const saved = get(s, 'receipts', r.id); if ((r.refundedCents || 0) > saved.refundedCents) { saved.refundedCents = r.refundedCents; saved.reviewReason = 'Refund received; review its session allocation'; } }
        });
      } catch {
        await store.transact(s => { Object.assign(s.feeds.stripe, { status: 'disconnected', lastAttempt: at, reason: 'Stripe history sync is incomplete; check the approved account and read permissions' }); });
      }
    }
    await reconcile();
    return await view();
  }
  function guard(s, op) {
    insist(!trackingOnly, 'Tracking mode cannot write to payment providers');
    insist(collectionActivated, 'Collection has not been activated');
    const p = get(s, 'payers', op.payerId), items = op.items.map(i => get(s, 'obligations', i.obligationId));
    const withoutSelf = { ...s, operations: s.operations.filter(o => o.id !== op.id) };
    const held = collectionHold(withoutSelf, p, items, clock()); insist(!held, held);
    insist(JSON.stringify(p.authorization) === JSON.stringify(op.authorization) && p.setup.paymentMethodId === op.paymentMethodId && p.stripeCustomerId === op.customerId, 'Authorization or saved method changed after approval');
    for (const i of op.items) {
      const o = get(s, 'obligations', i.obligationId), membership = get(s, 'memberships', o.membershipId);
      insist(membership.capCents === o.capCents && i.amountCents <= balance(s, o.id), 'Cap or unpaid amount changed after approval');
    }
  }
  async function setOutcome(operationId, outcome) {
    await store.transact(s => {
      const op = get(s, 'operations', operationId); Object.assign(op, outcome, { updatedAt: clock() });
      if (outcome.status === 'succeeded') {
        const id = `stripe:${outcome.paymentIntentId}`; let receipt = s.receipts.find(r => r.id === id);
        if (!receipt) { receipt = { id, providerId: outcome.paymentIntentId, provider: 'stripe', payerId: op.payerId, payerName: '', currency: 'usd', direction: 'incoming', amountCents: outcome.amountCents, receivedAt: outcome.receivedAt, source: 'stripe_api', status: 'received', authenticated: true, refundedCents: outcome.refundedCents || 0, feeCents: outcome.feeCents, reviewReason: null }; s.receipts.push(receipt); }
        insist(receipt.amountCents === op.amountCents && (!receipt.payerId || receipt.payerId === op.payerId), 'Provider payment identity or amount mismatch'); receipt.payerId = op.payerId;
        const missing = op.items.filter(i => !s.allocations.some(a => a.id === `payment:${op.id}:${i.obligationId}`));
        if (missing.some(i => balance(s, i.obligationId) < i.amountCents) || s.allocations.filter(a => a.receiptId === id).reduce((n, a) => n + a.amountCents, 0) + missing.reduce((n, i) => n + i.amountCents, 0) > receipt.amountCents) {
          receipt.reviewReason = 'Late outside payment or allocation conflicts with completed Stripe payment';
        } else {
          for (const item of missing) s.allocations.push({ id: `payment:${op.id}:${item.obligationId}`, receiptId: id, obligationId: item.obligationId, amountCents: item.amountCents, at: clock(), actor: 'verified Stripe payment' });
          receipt.reviewReason = null;
        }
        receipt.refundedCents = outcome.refundedCents || 0;
        if (receipt.refundedCents || outcome.disputed) receipt.reviewReason = outcome.disputed ? 'Stripe reports a dispute; owner review required' : 'Stripe reports a refund; review the allocation before another collection';
      }
      recordAudit(s, 'payment_reconciled', clock(), { operationId, status: outcome.status, invoiceId: outcome.invoiceId || null });
    });
  }
  async function reconcile() {
    const ops = (await store.read()).body.operations.filter(o => ['pending', 'uncertain', 'processing', 'failed'].includes(o.status));
    for (const op of ops.slice(0, 20)) {
      // A still-running request retains its claim; scheduled recovery begins
      // after its lease. Recovery reads provider truth and makes no writes.
      if (op.status === 'processing' && Date.parse(clock()) - Date.parse(op.startedAt) < 180000) continue;
      try { await setOutcome(op.id, await gateway.inspect(op)); } catch { await store.transact(s => { const x = get(s, 'operations', op.id); x.status = 'uncertain'; x.reason = 'Provider result cannot yet be verified; no retry is allowed'; }); }
    }
  }
  async function work() {
    await sync(false);
    if (trackingOnly) return await view();
    const deadline = Date.now() + 50000;
    for (let processed = 0; processed < 5 && Date.now() < deadline; processed++) {
      let selected;
      await store.transact(s => {
        selected = null; const op = s.operations.find(o => o.status === 'queued'); if (!op) return;
        try { guard(s, op); } catch (e) { op.status = 'held'; op.reason = e.message; recordAudit(s, 'collection_held', clock(), { operationId: op.id }); return; }
        op.status = 'processing'; op.startedAt = clock(); selected = structuredClone(op); recordAudit(s, 'collection_started', clock(), { operationId: op.id });
      });
      if (!selected) break;
      const op = selected;
      const checkpoint = patch => store.transact(s => Object.assign(get(s, 'operations', op.id), patch));
      const effect = async (phase, run) => {
        const snapshot = (await store.read()).body; guard(snapshot, get(snapshot, 'operations', op.id));
        if (phase === 'pay') await gateway.preflight(op, snapshot);
        const hash = await digest({ id: op.id, items: op.items, customer: op.customerId, authorization: op.authorization, phase });
        insist(await store.fence(op.id, phase, hash), 'This provider action was already started; reconcile it without retrying');
        await checkpoint({ stage: phase, ...(phase === 'pay' ? { attempts: 1 } : {}) });
        return await run();
      };
      try {
        const outcome = await gateway.collect(op, (await store.read()).body, effect, checkpoint);
        await setOutcome(op.id, outcome);
      } catch {
        await checkpoint({ status: 'uncertain', reason: 'The approved operation stopped; reconciling its existing Stripe record without another attempt' });
        try { await setOutcome(op.id, await gateway.inspect({ ...op, invoiceId: get((await store.read()).body, 'operations', op.id).invoiceId })); } catch { /* The durable uncertain record remains visible. */ }
      }
    }
    return await view();
  }
  async function setup(payerId, requestId, actor) {
    insist(!trackingOnly, 'Tracking mode cannot create hosted setup or write to payment providers');
    insist(gateway.allowWrites !== false, 'Hosted setup needs provider activation; no request was started');
    ident(requestId); const at = clock();
    const saved = await store.transact(s => {
      get(s, 'payers', payerId);
      const current = s.setupRequests.find(r => r.payerId === payerId && (r.status === 'started' || r.status === 'uncertain' || (r.status === 'open' && r.expiresAt > at)));
      if (current) return current;
      insist(!s.setupRequests.some(r => r.id === requestId), 'This setup request already exists');
      const integrationSuffix = [...crypto.getRandomValues(new Uint8Array(8))].map(n => String.fromCharCode(97 + n % 26)).join('');
      const request = { id: requestId, payerId, status: 'started', createdAt: at, actor, integrationSuffix }; s.setupRequests.push(request); recordAudit(s, 'setup_requested', at, { payerId, requestId }); return request;
    });
    const request = saved.result;
    if (request.status === 'open') return request;
    insist(request.id === requestId && !request.attempted, 'An earlier hosted setup request needs reconciliation');
    const payer = get(saved.body, 'payers', payerId);
    try {
      const result = await gateway.setup(payer, request, async (phase, run) => { insist(await store.fence(request.id, phase, await digest({ request, payerId, phase })), 'This setup action already started; reconcile the existing request'); await store.transact(s => { get(s, 'setupRequests', request.id).attempted = true; }); return await run(); });
      await store.transact(s => { get(s, 'payers', payerId).stripeCustomerId = result.customerId; Object.assign(get(s, 'setupRequests', request.id), result, { status: 'open' }); });
      return { ...request, ...result, status: 'open' };
    } catch { await store.transact(s => { Object.assign(get(s, 'setupRequests', request.id), { status: 'uncertain', reason: 'Hosted setup was not verified; no automatic replacement was created' }); }); throw new Error('Hosted setup needs provider verification or activation; no payment was attempted'); }
  }
  async function stripeEvent(event) {
    insist(!trackingOnly, 'Tracking mode uses read-only history; enrollment webhooks are deferred');
    insist(event.livemode === (gateway.mode === 'live'), 'Stripe event mode mismatch'); ident(event.id);
    if ((await store.read()).body.events.some(e => e.id === event.id && e.status === 'complete')) return { duplicate: true };
    if (event.type === 'checkout.session.completed') {
      const data = await gateway.verifySetup(event.data.object.id);
      await store.transact(s => {
        const request = get(s, 'setupRequests', data.requestId), p = get(s, 'payers', data.payerId);
        insist(request.payerId === p.id && (!request.sessionId || request.sessionId === data.sessionId) && (!p.stripeCustomerId || p.stripeCustomerId === data.customerId), 'Enrollment identities do not match');
        p.stripeCustomerId = data.customerId; p.setup = { ...data, verifiedAt: clock() }; p.attention = null; request.status = 'complete'; request.url = null; recordAudit(s, 'hosted_setup_verified', clock(), { payerId: p.id, requestId: request.id });
      });
    } else {
      const s = (await store.read()).body;
      const matching = s.operations.filter(o => o.invoiceId === event.data?.object?.id || o.id === event.data?.object?.metadata?.owner_operation_id || o.paymentIntentId === event.data?.object?.id || o.paymentIntentId === event.data?.object?.payment_intent);
      for (const op of matching) await setOutcome(op.id, await gateway.inspect(op));
    }
    await store.transact(s => { if (!s.events.some(e => e.id === event.id)) s.events.push({ id: event.id, type: event.type, at: clock(), status: 'complete' }); });
    return { ok: true };
  }
  return { trackingOnly, view, command, sync, work, reconcile, setup, stripeEvent, async statement(payerId, items) { insist(!trackingOnly, 'Tracking mode has record-only balances, not collectible statements'); await sync(true); return previewStatement((await store.read()).body, payerId, items, clock()); }, async preview(input) { if (!trackingOnly) await sync(true); return previewCloseout((await store.read()).body, input, clock(), { trackingOnly }); }, async planPeriod(input) { return previewPayerPlanPeriod((await store.read()).body, input, clock()); } };
}

function recordCoverage(feed, range) {
  const from = instant(range.from), through = instant(range.through);
  insist(from <= through, 'Receipt coverage interval is invalid');
  const overlaps = feed.coveredThrough && from <= feed.coveredThrough && through >= feed.coveredFrom;
  feed.coveredFrom = overlaps && feed.coveredFrom < from ? feed.coveredFrom : from;
  feed.coveredThrough = overlaps && feed.coveredThrough > through ? feed.coveredThrough : through;
}
