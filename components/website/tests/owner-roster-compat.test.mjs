import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, emptyLedger, previewCloseout, previewPayerPlanPeriod, validateLedger, dashboard, payerBalance, previewStatement, balance, collectionHold } from '../supabase/functions/_shared/ledger.mjs';
import { prepareRestore } from '../supabase/functions/_shared/backup.mjs';
import { checkRestore } from '../scripts/owner-backup.mjs';

// Business oracle frozen before repair: $90 owed; covered play adds $0;
// received $30 leaves $60; received $60 clears exactly; table income stays $0.
test('unpaid flat period through partial receipt, settlement and fresh database restore', async () => {
  const { s, command } = ledger();
  command('saveMembership', { record: { id: 'covered', playerId: 'player-ember', tableId: 'table-slate', from: '2026-09-01', rateCents: 1000, capCents: 4000, fixedCents: null, cadence: 'monthly' } });
  const plan = { id: 'journey', payerId: 'payer-aurora', coveredMembershipIds: ['covered'], amountCents: 9000, cadence: 'fortnightly', anchor: '2026-09-01', from: '2026-09-01', paidThrough: '2026-09-01' };
  for (const field of ['anchor', 'paidThrough']) assert.throws(() => command('savePayerPlan', { record: { ...plan, [field]: '' } }));
  assert.equal(s.obligations.length + s.receipts.length, 0);
  command('savePayerPlan', { record: plan });
  assert.equal(s.obligations.length + s.receipts.length, 0, 'Saving terms does not infer debt or payment');
  const reviewed = previewPayerPlanPeriod(s, { planId: plan.id, periodStart: '2026-09-15' }, now);
  command('recordPayerPlanPeriod', { planId: plan.id, periodStart: '2026-09-15', reviewed });
  const obligationId = s.obligations[0].id;
  const picture = (remaining, received) => {
    assert.equal(balance(s, obligationId), remaining);
    assert.equal(payerBalance(s, plan.payerId), remaining, 'Combined payer balance must include the plan');
    const view = dashboard(s, now, '2026-09');
    assert.equal(view.totals.expected, 9000);
    assert.equal(view.totals.outstanding, remaining);
    assert.equal(view.totals.received, received);
    assert.equal(view.tables[0].collectedCents + view.tables[0].outstandingCents, 0);
    assert.equal(s.operations.length, 0);
  };
  picture(9000, 0);
  assert.throws(() => command('recordPayerPlanPeriod', { planId: plan.id, periodStart: '2026-09-15', reviewed }), /already recorded/);
  command('saveSession', { record: { id: 'covered-play', tableId: 'table-slate', startsAt: '2026-09-20T18:00:00Z', endsAt: '2026-09-20T22:00:00Z' } });
  const input = { sessionId: 'covered-play', minutes: 240 };
  command('closeSession', { input, reviewed: previewCloseout(s, input, now) });
  assert.equal(s.obligations.length, 1);
  picture(9000, 0);
  const receipt = (id, amountCents, authenticated = true) => ({ id: `venmo:${id}`, providerId: id, provider: 'venmo', payerName: 'Aurora Example', payerId: plan.payerId, amountCents, currency: 'usd', direction: 'incoming', receivedAt: '2026-09-30T18:00:00Z', authenticated, status: 'received', source: 'gmail' });
  const allocate = (id, amountCents) => command('allocateReceipt', { receiptId: `venmo:${id}`, payerId: plan.payerId, allocations: [{ obligationId, amountCents }] });
  command('ingestReceipts', { provider: 'venmo', receipts: [receipt('unverified', 9000, false)] });
  assert.throws(() => allocate('unverified', 9000), /authenticated/);
  picture(9000, 0);
  assert.match(collectionHold(s, s.payers[0], [s.obligations[0]], now), /record-only/);
  assert.throws(() => command('collectBalance', { id: 'forbidden', payerId: plan.payerId, items: [{ obligationId, amountCents: 9000 }] }));
  command('ingestReceipts', { provider: 'venmo', receipts: [receipt('partial', 3000)] });
  assert.equal(payerBalance(s, plan.payerId), 9000, 'Receipt requires explicit owner matching');
  assert.throws(() => allocate('partial', 3001), /exceeds/);
  allocate('partial', 3000); picture(6000, 3000);
  assert.throws(() => allocate('partial', 3000), /exceeds/);
  command('ingestReceipts', { provider: 'venmo', receipts: [receipt('partial', 3000), receipt('final', 6000)] });
  allocate('final', 6000); picture(0, 9000);
  assert.equal(s.receipts.length, 3);
  const restored = prepareRestore({ format: '20fates-backup/1', ledger: { revision: 0, body: s }, fences: [] });
  assert.equal(payerBalance(restored.ledger.body, plan.payerId), 0);
  assert.equal(restored.ledger.body.obligations[0].collectionEligible, false);
  assert.equal(restored.ledger.body.settings.trackingConfirmedAt, null);
  assert.equal((await checkRestore(restored)).verified, true);
});

const now = '2026-10-10T18:00:00.000Z', actor = 'fictional-owner';
function ledger() {
  const s = emptyLedger(now), command = (type, data) => applyCommand(s, { type, ...data }, actor, now);
  command('savePayer', { record: { id: 'payer-aurora', name: 'Aurora Example', email: '', aliases: [] } });
  command('savePlayer', { record: { id: 'player-ember', name: 'Ember Example', payerId: 'payer-aurora', email: '', discord: '', note: '' } });
  command('savePlayer', { record: { id: 'player-river', name: 'River Example', payerId: 'payer-aurora', email: '', discord: '', note: '' } });
  command('savePlayer', { record: { id: 'player-cobalt', name: 'Cobalt Example', payerId: 'payer-aurora', email: '', discord: '', note: '' } });
  command('saveTable', { record: { id: 'table-slate', name: 'Slate Table', capacity: 3, timezone: 'America/Chicago', weekday: 5, startTime: '18:00', normalMinutes: 240 } });
  return { s, command };
}

test('an explicit no-fee membership occupies a seat without an obligation or collection backlog', () => {
  const { s, command } = ledger();
  command('saveMembership', { record: { id: 'seat-free', playerId: 'player-ember', tableId: 'table-slate', from: '2026-09-01', rateCents: 0, capCents: 0, fixedCents: 0, cadence: 'weekly' } });
  command('saveSession', { record: { id: 'session-free', tableId: 'table-slate', startsAt: '2026-10-03T23:00:00Z', endsAt: '2026-10-04T03:00:00Z' } });
  const reviewed = previewCloseout(s, { sessionId: 'session-free', minutes: 240 }, now);
  assert.equal(reviewed.rows[0].amountCents, 0);
  command('closeSession', { input: { sessionId: 'session-free', minutes: 240 }, reviewed });
  assert.equal(s.memberships.length, 1);
  assert.equal(s.obligations.length, 0);
  assert.equal(s.operations.length, 0);
  assert.equal(dashboard(s, now).tables[0].occupiedSeats, 1);
  assert.equal(dashboard(s, now).tables[0].estimatedSessionCents, 0);
  assert.throws(() => command('saveMembership', { record: { id: 'bad-free', playerId: 'player-river', tableId: 'table-slate', from: '2026-09-01', rateCents: 1, capCents: 0, fixedCents: 0, cadence: 'weekly' } }), /zero cap/);
});

test('a payer-level plan records one reviewed period and keeps covered session closeouts out of table income and collections', () => {
  const { s, command } = ledger();
  for (const [id, playerId] of [['seat-ember', 'player-ember'], ['seat-river', 'player-river']]) command('saveMembership', { record: { id, playerId, tableId: 'table-slate', from: '2026-09-01', rateCents: 1000, capCents: 4000, fixedCents: null, cadence: 'monthly' } });
  assert.throws(() => command('savePayerPlan', { record: { id: 'plan-incomplete', payerId: 'payer-aurora', coveredMembershipIds: ['seat-ember'], amountCents: 9000, cadence: 'fortnightly', anchor: '2026-09-01', from: '2026-09-01', paidThrough: null, note: '' } }), /paid-through/);
  command('savePayerPlan', { record: { id: 'plan-aurora', payerId: 'payer-aurora', coveredMembershipIds: ['seat-ember', 'seat-river'], amountCents: 9000, cadence: 'fortnightly', anchor: '2026-09-01', from: '2026-09-01', paidThrough: '2026-10-01', note: 'fictional flat arrangement' } });
  const reviewedPeriod = previewPayerPlanPeriod(s, { planId: 'plan-aurora', periodStart: '2026-09-15' }, now);
  command('recordPayerPlanPeriod', { planId: 'plan-aurora', periodStart: '2026-09-15', reviewed: reviewedPeriod });
  assert.equal(s.obligations.length, 1);
  assert.equal(s.obligations[0].amountCents, 9000);
  assert.equal(s.obligations[0].collectionEligible, false);
  assert.equal(s.obligations[0].tableId, undefined);
  assert.equal(payerBalance(s, 'payer-aurora'), 9000);
  assert.equal(dashboard(s, now, '2026-09').totals.expected, 9000);
  assert.throws(() => previewStatement(s, 'payer-aurora', [{ obligationId: s.obligations[0].id, amountCents: 9000 }], now), /Invalid payer/);

  command('saveSession', { record: { id: 'session-covered', tableId: 'table-slate', startsAt: '2026-10-03T23:00:00Z', endsAt: '2026-10-04T03:00:00Z' } });
  const reviewedCloseout = previewCloseout(s, { sessionId: 'session-covered', minutes: 240 }, now);
  assert.deepEqual(reviewedCloseout.rows.map(r => [r.disposition, r.amountCents, r.collectCents, r.payerPlanId]), [['payer_plan', 0, 0, 'plan-aurora'], ['payer_plan', 0, 0, 'plan-aurora']]);
  command('closeSession', { input: { sessionId: 'session-covered', minutes: 240 }, reviewed: reviewedCloseout });
  assert.equal(s.obligations.length, 1);
  assert.equal(s.operations.length, 0);
  assert.equal(dashboard(s, now).tables[0].estimatedSessionCents, 0);
  assert.equal(dashboard(s, now).tables[0].outstandingCents, 0);
  assert.throws(() => command('recordPayerPlanPeriod', { planId: 'plan-aurora', periodStart: '2026-09-15', reviewed: reviewedPeriod }), /already recorded/);
  assert.throws(() => previewPayerPlanPeriod(s, { planId: 'plan-aurora', periodStart: '2026-09-16' }, now), /anchor/);
});

test('payer-plan coverage cannot overlap on the same covered seat, but a dated replacement can begin at the prior end', () => {
  const { command } = ledger();
  command('saveMembership', { record: { id: 'seat-ember', playerId: 'player-ember', tableId: 'table-slate', from: '2026-09-01', rateCents: 1000, capCents: 4000, fixedCents: null, cadence: 'monthly' } });
  command('savePayerPlan', { record: { id: 'plan-first', payerId: 'payer-aurora', coveredMembershipIds: ['seat-ember'], amountCents: 9000, cadence: 'fortnightly', anchor: '2026-09-01', from: '2026-09-01', until: '2026-10-01', paidThrough: '2026-09-30', note: '' } });
  assert.throws(() => command('savePayerPlan', { record: { id: 'plan-overlap', payerId: 'payer-aurora', coveredMembershipIds: ['seat-ember'], amountCents: 9000, cadence: 'fortnightly', anchor: '2026-09-15', from: '2026-09-15', paidThrough: '2026-10-01', note: '' } }), /already has a payer-level plan/);
  assert.doesNotThrow(() => command('savePayerPlan', { record: { id: 'plan-replacement', payerId: 'payer-aurora', coveredMembershipIds: ['seat-ember'], amountCents: 9000, cadence: 'fortnightly', anchor: '2026-10-01', from: '2026-10-01', paidThrough: '2026-10-14', note: '' } }));
});

test('monthly payer-plan periods retain the original anchor across short months', () => {
  const { s, command } = ledger();
  command('saveMembership', { record: { id: 'seat-ember', playerId: 'player-ember', tableId: 'table-slate', from: '2026-01-01', rateCents: 1000, capCents: 4000, fixedCents: null, cadence: 'monthly' } });
  command('savePayerPlan', { record: { id: 'plan-month-end', payerId: 'payer-aurora', coveredMembershipIds: ['seat-ember'], amountCents: 9000, cadence: 'monthly', anchor: '2026-01-31', from: '2026-01-31', paidThrough: '2026-04-30', note: '' } });
  assert.deepEqual(previewPayerPlanPeriod(s, { planId: 'plan-month-end', periodStart: '2026-02-28' }, now).periodEnd, '2026-03-31');
  assert.deepEqual(previewPayerPlanPeriod(s, { planId: 'plan-month-end', periodStart: '2026-03-31' }, now).periodEnd, '2026-04-30');
});

test('covered, ordinary and free seats retain distinct accounting in one closeout', () => {
  const { s, command } = ledger();
  for (const [id, playerId, free] of [['covered', 'player-ember', false], ['ordinary', 'player-river', false], ['free', 'player-cobalt', true]]) command('saveMembership', { record: { id, playerId, tableId: 'table-slate', from: '2026-09-01', rateCents: free ? 0 : 1000, capCents: free ? 0 : 4000, fixedCents: free ? 0 : null, cadence: 'monthly' } });
  command('savePayerPlan', { record: { id: 'mixed-plan', payerId: 'payer-aurora', coveredMembershipIds: ['covered'], amountCents: 9000, cadence: 'fortnightly', anchor: '2026-09-01', from: '2026-09-01', until: '2026-09-25', paidThrough: '2026-09-01' } });
  assert.throws(() => previewPayerPlanPeriod(s, { planId: 'mixed-plan', periodStart: '2026-09-15' }, now), /whole recorded period/);
  command('saveSession', { record: { id: 'mixed-play', tableId: 'table-slate', startsAt: '2026-09-20T18:00:00Z', endsAt: '2026-09-20T22:00:00Z' } });
  const input = { sessionId: 'mixed-play', minutes: 240 };
  command('closeSession', { input, reviewed: previewCloseout(s, input, now) });
  assert.equal(s.obligations.length, 1);
  assert.equal(s.obligations[0].playerId, 'player-river');
  assert.equal(payerBalance(s, 'payer-aurora'), 4000);
  assert.equal(dashboard(s, now, '2026-09').tables[0].outstandingCents, 4000);
  assert.equal(dashboard(s, now).tables[0].occupiedSeats, 3);
  assert.equal(s.operations.length, 0);
});

test('unknown roster terms can be revised and resolved without erasing their evidence', () => {
  const { s, command } = ledger();
  command('saveRosterDraft', { record: { id: 'draft-unknown', label: 'Unconfirmed group', knownFacts: ['fictional label'], aliasHolds: ['fictional alias'], termHolds: ['cycle anchor unknown'] } });
  command('saveRosterDraft', { record: { id: 'draft-unknown', label: 'Unconfirmed group', knownFacts: ['fictional label', 'payer confirmed'], aliasHolds: ['fictional alias'], termHolds: ['cycle anchor unknown'] } });
  assert.equal(s.rosterDrafts.length, 1);
  assert.equal(s.rosterDrafts[0].revisions.length, 1);
  assert.equal(s.memberships.length + s.obligations.length + s.allocations.length + s.operations.length, 0);
  assert.throws(() => command('confirmTracking', { from: '2026-09-01', confirmation: 'ROSTER, FEES AND TRACKING HISTORY REVIEWED' }), /Resolve roster drafts/);
  command('resolveRosterDraft', { id: 'draft-unknown', resolutionNote: 'Fictional written roster record reviewed' });
  assert.ok(s.rosterDrafts[0].resolvedAt);
  assert.equal(s.rosterDrafts[0].resolutionNote, 'Fictional written roster record reviewed');
  assert.doesNotThrow(() => command('confirmTracking', { from: '2026-09-01', confirmation: 'ROSTER, FEES AND TRACKING HISTORY REVIEWED' }));
  const legacy = structuredClone(s); delete legacy.payerPlans; delete legacy.rosterDrafts; assert.doesNotThrow(() => validateLedger(legacy));
  assert.deepEqual(legacy.payerPlans, []); assert.deepEqual(legacy.rosterDrafts, []);
  const restored = prepareRestore({ format: '20fates-backup/1', ledger: { revision: 0, body: legacy }, fences: [] });
  assert.deepEqual(restored.ledger.body.payerPlans, []); assert.deepEqual(restored.ledger.body.rosterDrafts, []);
});
