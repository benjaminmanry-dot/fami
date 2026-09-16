import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger, applyCommand, previewCloseout, balance, dashboard, localToInstant } from '../supabase/functions/_shared/ledger.mjs';
import { validateOwnerPublicConfig } from '../scripts/owner-public-config.js';

const now = '2026-09-04T23:00:00.000Z';
const actor = 'test-owner';
function fixture() {
  const s = emptyLedger(now);
  const command = (type, data) => applyCommand(s, { type, ...data }, actor, now);
  command('savePayer', { record: { id: 'payer-a', name: 'Example Payer', email: 'payer@example.invalid', aliases: [{ provider: 'venmo', name: 'Example Payer' }] } });
  command('savePlayer', { record: { id: 'player-a', name: 'Example Player', payerId: 'payer-a' } });
  command('saveTable', { record: { id: 'table-a', name: 'Example Table', capacity: 6, timezone: 'America/Chicago', weekday: 5, startTime: '14:00', normalMinutes: 240 } });
  command('saveMembership', { record: { id: 'member-a', playerId: 'player-a', tableId: 'table-a', from: '2026-09-01', until: null, rateCents: 950, capCents: 3000, fixedCents: null, cadence: 'weekly' } });
  command('saveSession', { record: { id: 'session-a', tableId: 'table-a', startsAt: '2026-09-04T19:00:00Z', endsAt: '2026-09-04T23:00:00Z' } });
  return { s, command };
}

test('reserved-seat absence uses actual duration and personal cap; cancellation bills nobody', () => {
  const { s, command } = fixture();
  const input = { sessionId: 'session-a', minutes: 240, rows: [{ playerId: 'player-a', attendance: 'absent', disposition: 'defer' }] };
  const p = previewCloseout(s, input, now);
  assert.equal(p.rows[0].calculatedCents, 3800);
  assert.equal(p.rows[0].amountCents, 3000);
  command('closeSession', { input, reviewed: p });
  assert.equal(balance(s, s.obligations[0].id), 3000);
  assert.equal(s.operations.length, 0);
  assert.equal(s.obligations[0].attendance, 'absent');
  command('closeSession', { input, reviewed: p });
  assert.equal(s.obligations.length, 1);
  const other = fixture();
  other.command('cancelSession', { sessionId: 'session-a', reason: 'No game' });
  assert.throws(() => previewCloseout(other.s, input, now), /canceled/);
  assert.equal(other.s.obligations.length, 0);
});

test('invalid money, non-integer time, overlapping membership and stale review fail closed', () => {
  const { s, command } = fixture();
  assert.throws(() => previewCloseout(s, { sessionId: 'session-a', minutes: 0 }, now));
  assert.throws(() => command('saveMembership', { record: { ...s.memberships[0], id: 'other' } }), /overlap/);
  const input = { sessionId: 'session-a', minutes: 120 };
  const p = previewCloseout(s, input, now);
  assert.equal(p.rows[0].amountCents, 1900);
  assert.throws(() => command('closeSession', { input: { ...input, minutes: 180 }, reviewed: p }), /changed/);
  assert.throws(() => previewCloseout(s, { ...input, rows: [{ playerId: 'player-a', amountCents: -1 }] }, now));
});

test('partial and lump-sum allocations stay bounded and receipts deduplicate permanently', () => {
  const { s, command } = fixture();
  const input = { sessionId: 'session-a', minutes: 240 };
  command('closeSession', { input, reviewed: previewCloseout(s, input, now) });
  const receipt = { id: 'venmo:1234567890', provider: 'venmo', providerId: '1234567890', amountCents: 1200, currency: 'usd', direction: 'incoming', receivedAt: now, payerName: 'Example Payer', authenticated: true, source: 'gmail', status: 'received' };
  command('ingestReceipts', { receipts: [receipt, receipt], provider: 'venmo', syncedAt: now });
  assert.equal(s.receipts.length, 1);
  assert.equal(balance(s, s.obligations[0].id), 1800);
  assert.throws(() => command('allocateReceipt', { receiptId: receipt.id, payerId: 'payer-a', allocations: [{ obligationId: s.obligations[0].id, amountCents: 1201 }] }));
  command('ingestReceipts', { receipts: [{ ...receipt, id: 'venmo:another', providerId: 'another', amountCents: 5000 }], provider: 'venmo', syncedAt: now });
  assert.equal(s.allocations.length, 1);
  assert.equal(s.receipts[1].reviewReason, 'Choose what this payment covers');
});

test('monthly and waived rows preserve arrangements; historical rates do not change', () => {
  const { s, command } = fixture();
  const input = { sessionId: 'session-a', minutes: 210, rows: [{ playerId: 'player-a', disposition: 'monthly' }] };
  command('closeSession', { input, reviewed: previewCloseout(s, input, now) });
  assert.equal(s.operations.length, 0);
  assert.equal(s.obligations[0].disposition, 'monthly');
  command('saveMembership', { record: { ...s.memberships[0], id: 'next-rate', from: '2026-09-05', rateCents: 1200 } });
  assert.equal(s.obligations[0].rateCents, 950);
  assert.equal(s.memberships[0].until, '2026-09-05');
});

test('timezones preserve local session date and reject DST gaps and ambiguity', () => {
  assert.equal(localToInstant('2026-09-04T20:00', 'America/Chicago'), '2026-09-05T01:00:00.000Z');
  assert.throws(() => localToInstant('2026-03-08T02:30', 'America/Chicago'), /does not exist/);
  assert.throws(() => localToInstant('2026-11-01T01:30', 'America/Chicago'), /ambiguous/);
  const { s } = fixture();
  assert.equal(dashboard(s, now, '2026-09').needsCloseout.length, 1);
  assert.equal(dashboard(s, now, '2026-09').tables[0].openSeats, 5);
});

test('ambiguous receipt names never guess a payer; one payer can split a lump sum across two tables',()=>{
  const {s,command}=fixture();
  command('saveTable',{record:{...s.tables[0],id:'table-b',name:'Second Example Table'}});
  command('saveMembership',{record:{...s.memberships[0],id:'member-b',tableId:'table-b'}});
  command('saveSession',{record:{id:'session-b',tableId:'table-b',startsAt:'2026-09-03T19:00:00Z',endsAt:'2026-09-03T23:00:00Z'}});
  for(const sessionId of ['session-a','session-b']){const input={sessionId,minutes:240};command('closeSession',{input,reviewed:previewCloseout(s,input,now)});}
  command('savePayer',{record:{id:'payer-b',name:'Other Example',aliases:[{provider:'venmo',name:'Example Payer'}]}});
  const r={id:'venmo:lumpsum123',provider:'venmo',providerId:'lumpsum123',amountCents:4500,currency:'usd',direction:'incoming',receivedAt:now,payerName:'Example Payer',authenticated:true,source:'gmail',status:'received'};
  command('ingestReceipts',{receipts:[r],provider:'venmo'});assert.equal(s.allocations.length,0);assert.match(s.receipts[0].reviewReason,/Several payers/);
  command('allocateReceipt',{receiptId:r.id,payerId:'payer-a',allocations:[{obligationId:'session-a:player-a',amountCents:3000},{obligationId:'session-b:player-a',amountCents:1500}]});
  assert.equal(balance(s,'session-a:player-a'),0);assert.equal(balance(s,'session-b:player-a'),1500);
  assert.throws(()=>command('allocateReceipt',{receiptId:r.id,payerId:'payer-b',allocations:[{obligationId:'session-b:player-a',amountCents:1}]}));
});
test('fees and authoritative late refund updates stay separate from receipts, with no negative unallocated money',()=>{
  const {s,command}=fixture();const receipt={id:'stripe:pi_example',provider:'stripe',providerId:'pi_example',amountCents:3000,currency:'usd',direction:'incoming',receivedAt:now,authenticated:true,source:'stripe_api',status:'received',payerId:'payer-a',feeCents:null};
  command('ingestReceipts',{provider:'stripe',receipts:[receipt,{...receipt,id:'stripe:fee_example',providerId:'fee_example',amountCents:12,direction:'fee',feeCents:0}]});
  command('ingestReceipts',{provider:'stripe',receipts:[{...receipt,refundedCents:500,feeCents:110,disputed:true}]});
  const d=dashboard(s,now);assert.equal(d.totals.received,3000);assert.equal(d.totals.providerFees,122);assert.equal(d.totals.refunds,500);assert.equal(d.totals.unallocated,2500);assert.match(s.receipts[0].reviewReason,/dispute/);
});

test('production build rejects server keys while accepting only intentionally public configuration',()=>{
  const makeKey=role=>'synthetic.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
  const base={VITE_SUPABASE_URL:'https://example.supabase.co'};
  assert.doesNotThrow(()=>validateOwnerPublicConfig({}));assert.doesNotThrow(()=>validateOwnerPublicConfig({...base,VITE_SUPABASE_ANON_KEY:makeKey('anon')}));
  assert.doesNotThrow(()=>validateOwnerPublicConfig({...base,VITE_SUPABASE_ANON_KEY:'sb_publishable_syntheticPublicFixture'}));
  for(const key of [makeKey('service_role'),'sb_secret_syntheticPrivateFixture','synthetic-stripe-server-key','not-a-key'])assert.throws(()=>validateOwnerPublicConfig({...base,VITE_SUPABASE_ANON_KEY:key}));
});

test('rescheduling preserves occurrence identity; future and canceled sessions cannot be billed',()=>{
  const {s,command}=fixture();
  command('saveSession',{record:{id:'session-a',tableId:'table-a',startsAt:'2026-09-05T02:00:00Z',endsAt:'2026-09-05T05:00:00Z'}});
  assert.equal(s.sessions.length,1);assert.equal(s.sessions[0].localDate,'2026-09-04');
  assert.throws(()=>previewCloseout(s,{sessionId:'session-a',minutes:180},now),/future/);
  command('cancelSession',{sessionId:'session-a',reason:'Synthetic cancellation'});command('scheduleOccurrences',{through:'2026-09-11'});
  assert.equal(s.sessions.filter(x=>x.localDate==='2026-09-04').length,1);assert.equal(s.obligations.length,0);
});

test('capacity checks include future memberships, not just the first day',()=>{
  const {s,command}=fixture();command('endMembership',{id:'member-a',until:'2026-09-05'});
  command('saveTable',{record:{...s.tables[0],capacity:1}});
  command('saveMembership',{record:{...s.memberships[0],id:'future-a',from:'2026-09-10',until:null}});
  command('savePlayer',{record:{id:'player-b',name:'Second Example',payerId:'payer-a'}});
  assert.throws(()=>command('saveMembership',{record:{...s.memberships[0],id:'second-overlap',playerId:'player-b',from:'2026-09-06',until:null}}),/no open reserved seat/);
  assert.throws(()=>command('endMembership',{id:'member-a',until:'2026-09-11'}),/extend an ended seat/);
});

test('an older receipt cannot automatically settle a later session',()=>{
  const {s,command}=fixture(),input={sessionId:'session-a',minutes:240};
  command('closeSession',{input,reviewed:previewCloseout(s,input,now)});
  command('ingestReceipts',{provider:'venmo',receipts:[{id:'venmo:older123',provider:'venmo',providerId:'older123',amountCents:3000,currency:'usd',direction:'incoming',receivedAt:'2026-08-04T23:00:00Z',payerName:'Example Payer',authenticated:true,source:'gmail',status:'received'}]});
  assert.equal(s.allocations.length,0);assert.equal(balance(s,'session-a:player-a'),3000);assert.equal(s.receipts[0].reviewReason,'Choose what this payment covers');
});
