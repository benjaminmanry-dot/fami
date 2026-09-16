// Synthetic provider and roster only. Never imported by deployed code.
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ledgerStore } from '../supabase/functions/_shared/store.mjs';
import { emptyLedger, applyCommand, previewCloseout, get } from '../supabase/functions/_shared/ledger.mjs';
import { ownerService } from '../supabase/functions/_shared/service.mjs';
export const DEMO_TIME = '2026-09-04T23:00:00.000Z';
export function seedDemo() {
  const s = emptyLedger(DEMO_TIME), apply = c => applyCommand(s, c, 'synthetic owner', DEMO_TIME);
  const names = ['Rowan', 'Morgan', 'Avery', 'Finch', 'Juniper'];
  for (let i = 0; i < names.length; i++) {
    apply({ type: 'savePayer', record: { id: `payer-${i}`, name: `${names[i]} Example`, email: `${names[i].toLowerCase()}@example.invalid`, aliases: [{ provider: 'venmo', name: `${names[i]} Example` }] } });
    apply({ type: 'savePlayer', record: { id: `player-${i}`, name: `${names[i]} Example`, payerId: `payer-${i}`, discord: `${names[i].toLowerCase()}-example`, note: i === 1 ? 'Monthly arrangement; review the statement together.' : '' } });
  }
  for (const [i, name, day] of [[0, 'The Lantern Road', 5], [1, 'Beyond the Silver Gate', 6], [2, 'A Winter Crown', 0]]) apply({ type: 'saveTable', record: { id: `table-${i}`, name, capacity: 6, weekday: day, startTime: '14:00', normalMinutes: 240, timezone: 'America/Chicago' } });
  for (let i = 0; i < 5; i++) apply({ type: 'saveMembership', record: { id: `member-${i}`, playerId: `player-${i}`, tableId: 'table-0', from: '2026-09-01', rateCents: i === 2 ? 800 : 950, capCents: i === 2 ? 2500 : 3000, cadence: i === 1 ? 'monthly' : 'weekly', fixedCents: i === 4 ? 2000 : null } });
  apply({ type: 'saveMembership', record: { id: 'member-other', playerId: 'player-0', tableId: 'table-1', from: '2026-09-01', rateCents: 950, capCents: 3000, cadence: 'weekly', fixedCents: null } });
  apply({ type: 'saveSession', record: { id: 'session-today', tableId: 'table-0', startsAt: '2026-09-04T19:00:00Z', endsAt: DEMO_TIME } });
  apply({ type: 'saveSession', record: { id: 'session-previous', tableId: 'table-1', startsAt: '2026-09-03T19:00:00Z', endsAt: '2026-09-03T23:00:00Z' } });
  apply({ type: 'scheduleOccurrences', through: '2026-10-04' });
  for (const i of [0, 1, 2]) {
    const p = s.payers[i]; p.stripeCustomerId = `cus_Synthetic${i}`; p.setup = { verifiedAt: DEMO_TIME, paymentMethodId: i === 2 ? 'pm_decline' : 'pm_success', label: 'Synthetic Visa ending 4242', defaultAtSetup: null };
    apply({ type: 'recordAuthorization', payerId: p.id, effectiveFrom: '2026-09-04', evidence: 'Synthetic consent fixture — no real person or payment method' });
  }
  s.settings = { collectionEnabled: false, recoveryHold: false, historyConfirmedAt: DEMO_TIME, migrationCutoff: '2026-09-04' };
  for (const f of Object.values(s.feeds)) Object.assign(f, { verified: true, status: 'connected', lastSuccess: DEMO_TIME, lastAttempt: DEMO_TIME, reason: 'Synthetic local feed' });
  return s;
}
export async function simulationRuntime({ directory, seed = seedDemo(), clock = () => DEMO_TIME, outcome = null, trackingOnly = true } = {}) {
  if (directory) await mkdir(dirname(directory), { recursive: true });
  const db = new PGlite(directory); const exists = (await db.query("select to_regclass('owner_private.ledger') as present")).rows[0].present;
  if (!exists) {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(await readFile(new URL('../supabase/migrations/202609040001_owner_panel.sql', import.meta.url), 'utf8'));
  }
  const rpc = async (name, args) => (await db.query(`select public.${name}(${Object.keys(args).map((_, i) => '$' + (i + 1)).join(',')}) as result`, Object.values(args))).rows[0].result;
  const store = ledgerStore(rpc); if ((await store.read()).revision === -1) await store.transact(s => Object.assign(s, seed));
  const calls = [], outcomes = new Map();
  const result = op => ({ status: outcome || (op.paymentMethodId === 'pm_decline' ? 'failed' : op.paymentMethodId === 'pm_pending' ? 'pending' : 'succeeded'), reason: op.paymentMethodId === 'pm_decline' ? 'Synthetic decline; no retry' : null, invoiceId: `in_Synthetic${op.id.replace(/[^a-z0-9]/gi, '')}`, amountCents: op.amountCents, paymentIntentId: `pi_Synthetic${op.id.replace(/[^a-z0-9]/gi, '')}`, receivedAt: clock(), feeCents: 0, refundedCents: 0, attemptCount: 1 });
  const gateway = {
    mode: 'test',
    async preflight() {},
    async collect(op, s, effect, checkpoint) {
      const invoiceId = result(op).invoiceId;
      await effect('invoice', async () => { calls.push({ id: op.id, phase: 'invoice' }); return { id: invoiceId }; }); await checkpoint({ invoiceId });
      for (const item of op.items) await effect(`line:${item.obligationId}`, async () => { calls.push({ id: op.id, phase: 'line' }); });
      await effect('finalize', async () => { calls.push({ id: op.id, phase: 'finalize' }); });
      await effect('pay', async () => { calls.push({ id: op.id, phase: 'pay' }); outcomes.set(op.id, result(op)); });
      return result(op);
    },
    async inspect(op) { return outcomes.get(op.id) || (op.stage === 'pay' ? result(op) : { status: 'uncertain', invoiceId: op.invoiceId, reason: 'Synthetic operation has no proven payment' }); },
    async history() { return []; },
    async setup(payer, request, effect) { await effect('setup', async () => calls.push({ phase: 'setup' })); return { customerId: payer.stripeCustomerId || 'cus_SyntheticNew', sessionId: 'cs_SyntheticSetup', url: 'https://checkout.stripe.com/synthetic-not-a-real-setup-link', expiresAt: '2026-09-05T23:00:00Z' }; },
    async event() { throw new Error('No external Stripe signatures in local simulation'); }
  };
  const gmail = { async batch(provider, cursor, at) { return { receipts: [], cursor: null, at, complete: true, verified: true, coverage: { from: new Date(Date.parse(at) - 90 * 86400000).toISOString(), through: at } }; } };
  const service = ownerService({ store, gateway, gmail, trackingOnly, collectionActivated: true, simulation: true, clock });
  return { db, store, gateway, gmail, service, calls, outcomes };
}
