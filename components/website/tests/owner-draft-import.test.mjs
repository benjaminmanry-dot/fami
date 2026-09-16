import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, emptyLedger } from '../supabase/functions/_shared/ledger.mjs';
const now = '2026-09-11T07:00:00Z';
const draft = (id = 'draft-example') => ({ id, label: 'Fictional reserved seat', knownFacts: ['Current occupied seat; fee arrangement supplied'], aliasHolds: ['Payer unknown'], termHolds: ['Effective date unknown'] });
const run = (s, records) => applyCommand(s, { type: 'importHistory', data: { schema: '20fates-history/1', rosterDrafts: records } }, 'test owner', now, { trackingOnly: true });

test('draft-only history import preserves unknown facts without financial records and is repeat-safe', () => {
  const s = emptyLedger(now), record = draft();
  run(s, [record]);
  assert.deepEqual(s.rosterDrafts[0].knownFacts, record.knownFacts);
  assert.deepEqual(s.rosterDrafts[0].termHolds, record.termHolds);
  assert.equal(s.rosterDrafts[0].resolvedAt, undefined);
  run(s, [record]);
  assert.equal(s.rosterDrafts.length, 1);
  for (const key of ['payers', 'players', 'tables', 'memberships', 'payerPlans', 'sessions', 'obligations', 'receipts', 'allocations', 'operations']) assert.equal(s[key].length, 0, key);
  assert.equal(s.settings.collectionEnabled, false);
  assert.equal(s.settings.trackingConfirmedAt, null);
});

test('invalid or changed imported drafts fail atomically without replacing owner work', () => {
  const s = emptyLedger(now);
  run(s, [draft()]);
  const before = structuredClone(s);
  assert.throws(() => run(s, [draft('new-valid'), { ...draft('new-invalid'), termHolds: [null] }]), /draft entry/);
  assert.deepEqual(s, before);
  assert.throws(() => run(s, [{ ...draft(), knownFacts: ['Different assertion'] }]), /differs/);
  assert.deepEqual(s, before);
  assert.throws(() => run(s, Array.from({ length: 201 }, (_, i) => draft('too-many-' + i))), /200/);
  assert.deepEqual(s, before);
});

test('draft import cannot smuggle resolution, obligations or collection flags through a draft record', () => {
  const s = emptyLedger(now);
  run(s, [{ ...draft(), resolvedAt: now, resolutionNote: 'Pretend resolved', obligations: [{ amountCents: 9999 }], collectionEnabled: true }]);
  assert.equal(s.rosterDrafts[0].resolvedAt, undefined);
  assert.equal(s.rosterDrafts[0].obligations, undefined);
  assert.equal(s.obligations.length, 0);
  assert.equal(s.settings.collectionEnabled, false);
});
