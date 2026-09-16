// Deterministic business rules shared by the private server and local proof.
// Money arithmetic and the $100 per-session ceiling reuse billing.ts at
// 20fates-billing/7253e03. The legacy Dashboard app remains a recovery reference.
export const SESSION_CEILING = 10000;
export const FEED_MAX_AGE_MS = 20 * 60 * 1000;
const lists = ['payers', 'players', 'tables', 'memberships', 'payerPlans', 'rosterDrafts', 'sessions', 'obligations', 'receipts', 'allocations', 'operations', 'setupRequests', 'events', 'audit'];
const activeOperation = o => ['queued', 'processing', 'pending', 'uncertain'].includes(o.status);
export class OwnerError extends Error {}
export function insist(ok, message) { if (!ok) throw new OwnerError(message); }
export function cents(v, label = 'Amount', max = 1000000) { insist(Number.isSafeInteger(v) && v >= 0 && v <= max, `${label} must be whole cents from 0 to ${max}`); return v; }
export function minutes(v) { insist(Number.isInteger(v) && v > 0 && v <= 1440, 'Duration must be 1–1440 whole minutes'); return v; }
export function calculateFeeCents(duration, rate) { return Math.round(minutes(duration) * cents(rate, 'Hourly rate') / 60); }
export function dollarsToCents(v) { insist(typeof v === 'string' && /^\d+(?:\.\d{1,2})?$/.test(v.trim()), 'Use dollars with at most two decimal places'); return cents(Math.round(Number(v) * 100)); }
export function money(v) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v / 100); }
export function text(v, label, max = 200, optional = false) { insist(typeof v === 'string' && (optional || v.trim()) && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v), `Invalid ${label}`); return v.trim(); }
export function ident(v) { insist(typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,179}$/.test(v), 'Invalid record identity'); return v; }
export function isoDate(v) { insist(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v, 'Invalid calendar date'); return v; }
export function instant(v) { insist(typeof v === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)), 'Time requires a valid UTC offset'); return new Date(v).toISOString(); }
export function zone(v) { text(v, 'timezone', 80); try { new Intl.DateTimeFormat('en', { timeZone: v }).format(); } catch { throw new OwnerError('Unknown timezone'); } return v; }
export function localParts(v, timezone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(v)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
}
export function localDate(v, timezone = 'America/Chicago') { const p = localParts(v, timezone); return `${p.year}-${p.month}-${p.day}`; }
export function localToInstant(value, timezone) {
  insist(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value), 'Invalid local date and time'); isoDate(value.slice(0, 10)); zone(timezone);
  const target = Date.parse(value + ':00Z'); insist(Number.isFinite(target), 'Invalid local date and time');
  // Probe actual zone offsets around the date; reject both missing and repeated
  // wall times instead of silently moving a game at a daylight-saving boundary.
  const offsets = new Set([-36, -12, 0, 12, 36].map(h => {
    const at = target + h * 3600000, p = localParts(at, timezone);
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - at;
  }));
  const matches = [...offsets].map(o => new Date(target - o).toISOString()).filter(at => { const p = localParts(at, timezone); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === value; });
  insist(matches.length, 'This local time does not exist because the clocks change');
  insist(matches.length === 1, 'This local time is ambiguous; enter a time outside the repeated hour');
  return matches[0];
}
export function emptyLedger(now = new Date().toISOString()) {
  return { schema: 1, createdAt: instant(now), ...Object.fromEntries(lists.map(k => [k, []])), settings: { collectionEnabled: false, recoveryHold: true, historyConfirmedAt: null, migrationCutoff: null }, feeds: Object.fromEntries(['stripe', 'venmo', 'cashapp'].map(k => [k, { status: 'disconnected', lastSuccess: null, verified: false, reason: 'Not connected' }])) };
}
function ensureLists(s) { for (const key of lists) if (s[key] === undefined) s[key] = []; return s; }
export function get(s, list, id) { const row = s[list].find(x => x.id === id); insist(row, 'Record was not found; refresh the panel'); return row; }
const put = (s, list, row) => { const i = s[list].findIndex(x => x.id === row.id); if (i < 0) s[list].push(row); else s[list][i] = row; return row; };
const audit = (s, type, actor, at, details = {}) => s.audit.push({ id: `audit:${s.audit.length + 1}`, at, actor, type, ...details });
export const normalizeName = v => String(v).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
export function reserved(s, tableId, date) { return s.memberships.filter(m => m.tableId === tableId && m.from <= date && (!m.until || date < m.until)); }
function activePayerPlan(s, membershipId, date) { return (s.payerPlans || []).find(plan => plan.coveredMembershipIds.includes(membershipId) && plan.from <= date && (!plan.until || date < plan.until)); }
export function allocated(s, receiptId) { return s.allocations.filter(a => a.receiptId === receiptId).reduce((n, a) => n + a.amountCents, 0); }
export function balance(s, obligationId) { const o = get(s, 'obligations', obligationId); return o.amountCents - s.allocations.filter(a => a.obligationId === obligationId).reduce((n, a) => n + a.amountCents, 0); }
export function payerBalance(s, payerId) { return s.obligations.filter(o => o.payerId === payerId).reduce((n, o) => n + balance(s, o.id), 0); }
export function feedProblem(s, now) {
  for (const provider of ['stripe', 'venmo', 'cashapp']) { const f = s.feeds[provider]; if (!f.verified || f.status !== 'connected' || !f.lastSuccess || Date.parse(now) - Date.parse(f.lastSuccess) > FEED_MAX_AGE_MS) return `${provider === 'cashapp' ? 'Cash App' : provider} feed needs verification or a fresh sync`; }
  return null;
}
export function enrollment(payer, date) {
  if (payer.attention || payer.authorization?.revokedAt) return 'Needs attention';
  if (!payer.setup?.verifiedAt || !payer.setup?.paymentMethodId || !payer.stripeCustomerId) return 'Needs setup';
  if (!payer.authorization?.grantedAt || !payer.authorization?.evidence || !payer.authorization?.effectiveFrom || payer.authorization.effectiveFrom > date) return 'Awaiting authorization';
  return 'Ready';
}
export function collectionHold(s, payer, items, now) {
  if (items.some(item => item.payerPlanId)) return 'Payer-level plans are permanent record-only arrangements; they cannot initiate collection';
  if (items.some(item => item.collectionEligible === false)) return 'These are permanent record-only fees; they cannot initiate collection';
  if (!s.settings.collectionEnabled) return 'Collection is switched off';
  if (s.settings.recoveryHold || !s.settings.historyConfirmedAt) return 'Opening balances and recovery need owner confirmation';
  const feed = feedProblem(s, now); if (feed) return feed;
  if (enrollment(payer, localDate(now)) !== 'Ready') return 'Stripe setup or authorization is not ready';
  for (const item of items) {
    if (item.historical || item.closedExternally || item.sessionDate < s.settings.migrationCutoff) return 'Historical records cannot initiate collection';
    if (item.sessionDate < payer.authorization.effectiveFrom) return 'This session predates automatic collection authorization';
    if (!payer.authorization.scope.some(x => x.playerId === item.playerId && x.tableId === item.tableId && x.capCents >= item.amountCents)) return 'This player, table or amount is outside the recorded authorization';
    if (item.capCents < item.amountCents || item.amountCents > SESSION_CEILING) return 'Per-session cap prevents collection';
    if (item.notBefore && item.notBefore > localDate(now)) return 'This balance is deferred until a later date';
    if (s.operations.some(op => op.items.some(x => x.obligationId === item.id) && ['queued', 'processing', 'pending', 'uncertain', 'failed'].includes(op.status))) return 'An earlier attempt needs reconciliation before another collection';
  }
  if (s.receipts.some(r => r.payerId === payer.id && r.direction === 'incoming' && r.status === 'received' && r.amountCents - (r.refundedCents || 0) > allocated(s, r.id))) return 'An unallocated payment for this payer needs review';
  if (s.receipts.some(r => r.reviewReason && !['personal', 'transfer'].includes(r.classification) && (!r.payerId || r.payerId === payer.id) && !['transfer', 'fee'].includes(r.direction))) return 'Unmatched receipts need review before collection';
  return null;
}
export function previewCloseout(s, input, now, { trackingOnly = false } = {}) {
  const session = get(s, 'sessions', ident(input.sessionId));
  insist(session.status !== 'canceled', 'This session is canceled');
  insist(!session.approvedAt, 'This session already has an approved closeout');
  insist(session.startsAt <= now, 'A future session cannot be closed');
  const duration = minutes(input.minutes), table = get(s, 'tables', session.tableId), roster = reserved(s, table.id, session.localDate);
  const edits = input.rows || []; insist(Array.isArray(edits) && edits.length <= roster.length && new Set(edits.map(r => r.playerId)).size === edits.length, 'Invalid closeout roster');
  for (const e of edits) insist(roster.some(m => m.playerId === e.playerId), 'Closeout includes someone without a reserved seat');
  const rows = roster.map(m => {
    const player = get(s, 'players', m.playerId), payer = get(s, 'payers', player.payerId), e = edits.find(x => x.playerId === player.id) || {};
    const plan = activePayerPlan(s, m.id, session.localDate);
    const calculated = m.fixedCents ?? calculateFeeCents(duration, m.rateCents), normal = Math.min(calculated, m.capCents);
    const disposition = plan ? 'payer_plan' : e.disposition ?? (m.cadence === 'weekly' ? (trackingOnly ? 'record' : 'collect') : m.cadence === 'monthly' ? 'monthly' : 'defer');
    if (plan) insist((!e.disposition || e.disposition === 'payer_plan') && (e.amountCents === undefined || e.amountCents === 0) && (e.collectCents === undefined || e.collectCents === 0), 'This seat is covered by a payer-level plan; close it without a separate fee');
    insist((plan ? ['payer_plan'] : trackingOnly ? ['record', 'monthly', 'defer', 'waive'] : ['collect', 'partial', 'monthly', 'defer', 'waive']).includes(disposition), trackingOnly ? 'Tracking mode accepts record-only fees, monthly arrangements, deferrals or waivers; collection is unavailable' : 'Invalid payment disposition');
    const amountCents = plan || disposition === 'waive' ? 0 : cents(e.amountCents ?? normal);
    insist(amountCents <= m.capCents && amountCents <= SESSION_CEILING, 'The final fee exceeds the recorded per-session cap');
    const collectCents = disposition === 'partial' ? cents(e.collectCents) : disposition === 'collect' ? amountCents : 0;
    insist(collectCents <= amountCents && (disposition !== 'partial' || collectCents > 0), 'Partial collection must be positive and at most the fee');
    const attendance = e.attendance || 'unknown'; insist(['present', 'absent', 'unknown'].includes(attendance), 'Invalid attendance');
    const row = { id: `${session.id}:${player.id}`, sessionId: session.id, tableId: table.id, tableName: table.name, sessionDate: session.localDate, playerId: player.id, playerName: player.name, payerId: payer.id, payerName: payer.name, membershipId: m.id, payerPlanId: plan?.id || null, minutes: duration, rateCents: m.rateCents, fixedCents: m.fixedCents, capCents: m.capCents, calculatedCents: calculated, amountCents, adjustmentCents: amountCents - calculated, disposition, attendance, collectCents, note: text(e.note || '', 'note', 500, true), notBefore: e.notBefore ? isoDate(e.notBefore) : null };
    row.collectionEligible = !trackingOnly && !plan;
    row.hold = collectCents ? collectionHold(s, payer, [row], now) : null;
    row.destination = plan ? 'Covered by payer-level plan · no separate table fee' : trackingOnly ? (disposition === 'waive' ? 'Waived' : 'Record only · match received payments; never queued for collection') : collectCents ? (payer.setup?.label || 'Stripe setup incomplete') : disposition === 'monthly' ? 'Monthly statement' : disposition === 'waive' ? 'Waived' : 'Held for later';
    row.authorizationId = payer.authorization?.id || null;
    row.paymentMethodId = payer.setup?.paymentMethodId || null;
    return row;
  });
  return { sessionId: session.id, tableName: table.name, date: session.localDate, timezone: table.timezone, minutes: duration, rows, obligationTotalCents: rows.reduce((n, r) => n + r.amountCents, 0), collectTotalCents: rows.reduce((n, r) => n + (r.hold ? 0 : r.collectCents), 0) };
}
function queue(s, id, payerId, items, now, actor, hold = null) {
  insist(!s.operations.some(o => o.id === id), 'Collection operation already exists');
  const payer = get(s, 'payers', payerId);
  const op = { id, payerId, customerId: payer.stripeCustomerId || null, paymentMethodId: payer.setup?.paymentMethodId || null, authorization: structuredClone(payer.authorization || null), items, amountCents: items.reduce((n, i) => n + i.amountCents, 0), approvedAt: now, approvedBy: actor, status: hold ? 'held' : 'queued', reason: hold, invoiceId: null, stage: 'not_started', attempts: 0 };
  s.operations.push(op); return op;
}
function autoMatch(s, receipt) {
  if (receipt.status !== 'received' || receipt.direction !== 'incoming' || !receipt.authenticated || receipt.currency !== 'usd') return;
  if (receipt.provider === 'stripe' || receipt.source === 'owner_confirmed_export') return;
  const payers = s.payers.filter(p => p.aliases?.some(a => a.provider === receipt.provider && normalizeName(a.name) === normalizeName(receipt.payerName)));
  if (payers.length !== 1) { receipt.reviewReason = payers.length ? 'Several payers use this name' : 'Identify the payer'; return; }
  receipt.payerId = payers[0].id;
  if (s.obligations.some(o => o.payerPlanId && o.payerId === receipt.payerId && balance(s, o.id) > 0)) { receipt.reviewReason = 'Choose what this payment covers, including the payer-level plan'; return; }
  const candidates = s.obligations.filter(o => !o.payerPlanId && o.payerId === receipt.payerId && !o.closedExternally && !o.historical && o.sessionDate <= localDate(receipt.receivedAt, get(s, 'tables', o.tableId).timezone) && balance(s, o.id) > 0);
  if (s.operations.some(o => o.payerId === receipt.payerId && (activeOperation(o) || o.status === 'failed'))) { receipt.reviewReason = 'Payment arrived around a Stripe attempt; reconcile both'; return; }
  if (candidates.length !== 1 || receipt.amountCents > balance(s, candidates[0].id)) { receipt.reviewReason = 'Choose what this payment covers'; return; }
  s.allocations.push({ id: `${receipt.id}:${candidates[0].id}`, receiptId: receipt.id, obligationId: candidates[0].id, amountCents: receipt.amountCents, at: receipt.receivedAt, actor: 'exact receipt match' });
  receipt.reviewReason = null;
}
function addDays(date, days) { return new Date(Date.parse(isoDate(date) + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10); }
function addMonths(date, count) { const [year, month, day] = isoDate(date).split('-').map(Number), target = new Date(Date.UTC(year, month - 1 + count, 1)); const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate(); return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`; }
function rangesOverlap(a, b) { return (!a.until || b.from < a.until) && (!b.until || a.from < b.until); }
function validatePayerPlan(s, plan) {
  ident(plan.id); const payer = get(s, 'payers', plan.payerId); cents(plan.amountCents, 'Payer-plan amount'); insist(plan.amountCents > 0, 'A payer-level plan needs a positive period amount');
  insist(['fortnightly', 'monthly'].includes(plan.cadence), 'Payer-level plans are fortnightly or monthly'); isoDate(plan.anchor); isoDate(plan.from);
  if (plan.until) { isoDate(plan.until); insist(plan.until > plan.from, 'Payer-plan end date must follow its effective date'); }
  insist(plan.paidThrough, 'Confirm paid-through date before saving a payer-level plan'); isoDate(plan.paidThrough); insist(plan.paidThrough >= plan.from, 'Paid-through date precedes payer-plan start');
  insist(Array.isArray(plan.coveredMembershipIds) && plan.coveredMembershipIds.length > 0 && plan.coveredMembershipIds.length <= 30 && new Set(plan.coveredMembershipIds).size === plan.coveredMembershipIds.length, 'Confirm the covered reserved seats');
  for (const id of plan.coveredMembershipIds) { const membership = get(s, 'memberships', id), player = get(s, 'players', membership.playerId); insist(player.payerId === payer.id, 'A covered seat belongs to another payer'); }
  for (const other of s.payerPlans.filter(x => x.id !== plan.id && x.payerId === plan.payerId && rangesOverlap(x, plan))) insist(!other.coveredMembershipIds.some(id => plan.coveredMembershipIds.includes(id)), 'A covered seat already has a payer-level plan for these dates');
  text(plan.note || '', 'payer-plan note', 500, true); return plan;
}
function validateRosterDraft(draft) {
  ident(draft.id); text(draft.label, 'draft label');
  for (const key of ['knownFacts', 'aliasHolds', 'termHolds']) { insist(Array.isArray(draft[key]) && draft[key].length <= 80, 'Invalid roster draft'); for (const value of draft[key]) text(value, 'draft entry', 500); }
  if (draft.resolvedAt) { instant(draft.resolvedAt); text(draft.resolutionNote, 'draft resolution note', 500); }
  if (draft.revisions) { insist(Array.isArray(draft.revisions) && draft.revisions.length <= 20, 'Invalid roster draft revisions'); for (const revision of draft.revisions) validateRosterDraft({ ...revision, revisions: null }); }
  return draft;
}
function planPeriod(plan, periodStart, now) {
  const start = isoDate(periodStart), today = localDate(now), anchor = plan.anchor;
  let end;
  if (plan.cadence === 'fortnightly') { const days = (Date.parse(start + 'T12:00:00Z') - Date.parse(anchor + 'T12:00:00Z')) / 86400000; insist(Number.isInteger(days) && days >= 0 && days % 14 === 0, 'Period start must follow the confirmed fortnightly anchor'); end = addDays(start, 14); }
  else { let n = 0; while (addMonths(anchor, n) < start && n < 2400) n++; insist(addMonths(anchor, n) === start, 'Period start must follow the confirmed monthly anchor'); end = addMonths(anchor, n + 1); }
  insist(start >= plan.from && (!plan.until || end <= plan.until), 'Payer plan must cover the whole recorded period'); insist(end <= today, 'Only a completed payer-plan period can be recorded');
  return { start, end };
}
export function previewPayerPlanPeriod(s, input, now) {
  const plan = get(s, 'payerPlans', ident(input.planId)); validatePayerPlan(s, plan); const period = planPeriod(plan, input.periodStart, now);
  for (const id of plan.coveredMembershipIds) { const membership = get(s, 'memberships', id); insist(membership.from <= period.start && (!membership.until || membership.until >= period.end), 'Each covered seat must span the recorded payer-plan period'); }
  const id = `payer-plan:${plan.id}:${period.start}`; insist(!s.obligations.some(o => o.id === id), 'This payer-plan period is already recorded');
  return { planId: plan.id, payerId: plan.payerId, periodStart: period.start, periodEnd: period.end, amountCents: plan.amountCents, coveredMembershipIds: [...plan.coveredMembershipIds], collectionEligible: false, destination: 'Record only · no table allocation or collection' };
}
export function validateLedger(s) {
  insist(s?.schema === 1, 'Unsupported ledger version');
  insist(s.createdAt, 'Invalid ledger');
  ensureLists(s);
  for (const key of lists) { insist(Array.isArray(s[key]), 'Invalid ledger'); insist(new Set(s[key].map(x => x.id)).size === s[key].length, `Duplicate ${key} identity`); }
  for (const plan of s.payerPlans) validatePayerPlan(s, plan);
  for (const draft of s.rosterDrafts) validateRosterDraft(draft);
  for (const o of s.obligations) {
    cents(o.amountCents); get(s, 'payers', o.payerId);
    if (o.payerPlanId) { const plan = get(s, 'payerPlans', o.payerPlanId); insist(plan.payerId === o.payerId && o.collectionEligible === false, 'Invalid payer-plan obligation'); }
    else get(s, 'players', o.playerId);
    insist(balance(s, o.id) >= 0, 'An obligation is overallocated');
  }
  for (const r of s.receipts) { cents(r.amountCents); insist(allocated(s, r.id) <= r.amountCents, 'A payment is overallocated'); }
  for (const a of s.allocations) { const r = get(s, 'receipts', a.receiptId), o = get(s, 'obligations', a.obligationId); cents(a.amountCents); insist(r.payerId === o.payerId && r.currency === 'usd' && r.direction === 'incoming' && r.status === 'received', 'Allocation payer or receipt mismatch'); }
  insist(JSON.stringify(s).length < 12000000, 'Ledger is approaching its capacity; export and archive with owner approval');
  return s;
}
export function previewStatement(s, payerId, items, now) {
  const payer = get(s, 'payers', payerId);
  insist(Array.isArray(items) && items.length > 0 && items.length <= 30 && new Set(items.map(i => i.obligationId)).size === items.length, 'Choose distinct statement lines');
  const obligations = items.map(i => { const o = get(s, 'obligations', i.obligationId); insist(o.payerId === payerId && !o.payerPlanId && o.collectionEligible !== false && cents(i.amountCents) > 0 && i.amountCents <= balance(s, o.id), 'Invalid payer or outstanding amount'); return o; });
  return { payerId, payerName: payer.name, items: items.map(i => ({ obligationId: i.obligationId, amountCents: i.amountCents })), totalCents: items.reduce((n, i) => n + i.amountCents, 0), hold: collectionHold(s, payer, obligations, now), authorizationId: payer.authorization?.id || null, paymentMethodId: payer.setup?.paymentMethodId || null, destination: payer.setup?.label || 'Stripe setup incomplete' };
}
export function applyCommand(s, cmd, actor, now, context = {}) {
  instant(now); text(actor, 'actor', 200); const next = ensureLists(structuredClone(s));
  const result = mutate(next, cmd, actor, now, context); validateLedger(next); Object.assign(s, next); return result;
}
function mutate(s, cmd, actor, now, context = {}) {
  if (context.trackingOnly) insist(!['collectBalance', 'recordAuthorization', 'confirmOpening'].includes(cmd.type) && !(cmd.type === 'collectionSwitch' && cmd.enabled), 'Tracking mode cannot activate collection or payment setup');
  switch (cmd.type) {
    case 'savePayer': {
      const r = cmd.record, old = s.payers.find(p => p.id === r.id);
      const email = text(r.email || '', 'email', 254, true); insist(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Invalid email address');
      const aliases = r.aliases || []; insist(Array.isArray(aliases) && aliases.length <= 12, 'Invalid payer aliases');
      for (const a of aliases) { insist(['venmo', 'cashapp'].includes(a.provider), 'Invalid payment provider'); text(a.name, 'receipt name', 150); }
      const stripeCustomerId = r.stripeCustomerId || old?.stripeCustomerId || null;
      insist(!stripeCustomerId || /^cus_[A-Za-z0-9]+$/.test(stripeCustomerId), 'Invalid Stripe customer ID');
      insist(!stripeCustomerId || !s.payers.some(p => p.id !== r.id && p.stripeCustomerId === stripeCustomerId), 'Stripe customer already belongs to another payer');
      insist(!old?.setup || stripeCustomerId === old.stripeCustomerId, 'An enrolled Stripe customer cannot be relinked');
      const paymentProvider = r.paymentProvider ?? old?.paymentProvider ?? 'unknown'; insist(['unknown', 'cashapp', 'venmo', 'stripe', 'other'].includes(paymentProvider), 'Invalid current payment arrangement');
      put(s, 'payers', { ...old, id: ident(r.id), name: text(r.name, 'payer name'), email, aliases: aliases.map(a => ({ provider: a.provider, name: a.name.trim() })), stripeCustomerId, paymentProvider, note: text(r.note || '', 'operational note', 500, true) }); break;
    }
    case 'savePlayer': {
      const r = cmd.record, old = s.players.find(p => p.id === r.id); get(s, 'payers', r.payerId);
      put(s, 'players', { id: ident(r.id), name: text(r.name, 'player name'), payerId: r.payerId, email: text(r.email || '', 'contact', 254, true), discord: text(r.discord || '', 'Discord', 150, true), note: text(r.note || '', 'operational note', 500, true), archived: r.archived === true });
      if (old && old.payerId !== r.payerId) get(s, 'payers', r.payerId).authorization = null;
      break;
    }
    case 'saveTable': {
      const r = cmd.record; insist(Number.isInteger(r.capacity) && r.capacity > 0 && r.capacity <= 30, 'Capacity must be 1–30 seats');
      insist(Number.isInteger(r.weekday) && r.weekday >= 0 && r.weekday <= 6 && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.startTime), 'Invalid weekly schedule');
      const today = localDate(now, zone(r.timezone)), dates = [today, ...s.memberships.filter(m => m.tableId === r.id && m.from > today).map(m => m.from)];
      insist(dates.every(d => reserved(s, r.id, d).length <= r.capacity), 'Capacity cannot be lower than current or future reserved seats');
      put(s, 'tables', { id: ident(r.id), name: text(r.name, 'table name'), capacity: r.capacity, timezone: zone(r.timezone), weekday: r.weekday, startTime: r.startTime, normalMinutes: minutes(r.normalMinutes), active: r.active !== false }); break;
    }
    case 'saveMembership': {
      const r = cmd.record; ident(r.id); get(s, 'players', r.playerId); const t = get(s, 'tables', r.tableId); isoDate(r.from); if (r.until) { isoDate(r.until); insist(r.until > r.from, 'End date must follow start date'); }
      insist(!s.memberships.some(m => m.id === r.id), 'Keep rate history: add a new effective date instead of editing a membership');
      cents(r.rateCents, 'Hourly rate'); cents(r.capCents, 'Session cap', SESSION_CEILING);
      if (r.capCents === 0) insist(r.rateCents === 0 && r.fixedCents === 0, 'A zero cap is only for an explicit no-fee occupied seat');
      else { insist(r.capCents > 0, 'Every billed membership needs a positive per-session cap'); if (r.fixedCents !== null && r.fixedCents !== undefined) cents(r.fixedCents, 'Fixed session fee', r.capCents); }
      insist(['weekly', 'monthly', 'manual'].includes(r.cadence), 'Invalid billing cadence');
      const overlapping = s.memberships.filter(m => m.tableId === r.tableId && m.playerId === r.playerId && (!m.until || r.from < m.until) && (!r.until || m.from < r.until));
      insist(overlapping.length <= 1 && overlapping.every(m => m.from < r.from), 'Membership dates overlap');
      insist(!s.obligations.some(o => o.playerId === r.playerId && o.tableId === r.tableId && o.sessionDate >= r.from), 'Rate changes must follow every closed session');
      if (overlapping.length) overlapping[0].until = r.from;
      const dates = [r.from, ...s.memberships.filter(m => m.tableId === t.id && m.from > r.from && (!r.until || m.from < r.until)).map(m => m.from)];
      insist(dates.every(d => reserved(s, t.id, d).length < t.capacity), 'This table has no open reserved seat throughout these membership dates');
      s.memberships.push({ id: r.id, playerId: r.playerId, tableId: r.tableId, from: r.from, until: r.until || null, rateCents: r.rateCents, capCents: r.capCents, fixedCents: r.fixedCents ?? null, cadence: r.cadence }); break;
    }
    case 'savePayerPlan': {
      const r = { ...cmd.record, id: ident(cmd.record?.id), payerId: cmd.record?.payerId, coveredMembershipIds: [...(cmd.record?.coveredMembershipIds || [])], amountCents: cmd.record?.amountCents, cadence: cmd.record?.cadence, anchor: cmd.record?.anchor, from: cmd.record?.from, until: cmd.record?.until || null, paidThrough: cmd.record?.paidThrough || null, note: cmd.record?.note || '' };
      insist(!s.payerPlans.some(p => p.id === r.id), 'Payer-level plans keep their recorded history; add a new plan instead of editing one'); validatePayerPlan(s, r); s.payerPlans.push(r); break;
    }
    case 'saveRosterDraft': {
      const r = cmd.record, old = s.rosterDrafts.find(d => d.id === r?.id); insist(!old?.resolvedAt, 'Resolved drafts preserve their evidence; create a new draft for new uncertainty');
      const revision = old ? { id: old.id, label: old.label, knownFacts: old.knownFacts, aliasHolds: old.aliasHolds, termHolds: old.termHolds, savedAt: old.savedAt, revisedAt: now } : null;
      const entry = { id: ident(r?.id), label: text(r?.label, 'draft label'), knownFacts: [...(r?.knownFacts || [])], aliasHolds: [...(r?.aliasHolds || [])], termHolds: [...(r?.termHolds || [])], createdAt: old?.createdAt || now, savedAt: now, revisions: [...(old?.revisions || []), ...(revision ? [revision] : [])] };
      validateRosterDraft(entry); put(s, 'rosterDrafts', entry); break;
    }
    case 'resolveRosterDraft': {
      const draft = get(s, 'rosterDrafts', cmd.id); insist(!draft.resolvedAt, 'This roster draft is already resolved'); draft.resolvedAt = now; draft.resolutionNote = text(cmd.resolutionNote, 'draft resolution note', 500); break;
    }
    case 'recordPayerPlanPeriod': {
      const preview = previewPayerPlanPeriod(s, { planId: cmd.planId, periodStart: cmd.periodStart }, now); insist(JSON.stringify(preview) === JSON.stringify(cmd.reviewed), 'The payer-plan period changed after review; review it again');
      s.obligations.push({ id: `payer-plan:${preview.planId}:${preview.periodStart}`, payerPlanId: preview.planId, payerId: preview.payerId, sessionDate: preview.periodStart, periodStart: preview.periodStart, periodEnd: preview.periodEnd, amountCents: preview.amountCents, coveredMembershipIds: preview.coveredMembershipIds, collectionEligible: false, disposition: 'payer_plan', historical: false, createdAt: now, note: 'Payer-level period recorded after review' }); break;
    }
    case 'endMembership': { const m = get(s, 'memberships', cmd.id); isoDate(cmd.until); insist(cmd.until > m.from && (!m.until || cmd.until <= m.until) && !s.obligations.some(o => o.membershipId === m.id && o.sessionDate >= cmd.until), 'End date would rewrite closed membership history or extend an ended seat'); m.until = cmd.until; break; }
    case 'saveSession': {
      const r = cmd.record, t = get(s, 'tables', r.tableId), old = s.sessions.find(x => x.id === r.id);
      insist(!old?.approvedAt && old?.status !== 'canceled', 'Closed or canceled sessions keep their history');
      const startsAt = instant(r.startsAt), endsAt = instant(r.endsAt); insist(endsAt > startsAt && Date.parse(endsAt) - Date.parse(startsAt) <= 86400000, 'Session end must be within 24 hours after its start');
      insist(!s.sessions.some(x => x.id !== r.id && x.tableId === t.id && x.startsAt === startsAt), 'A session already exists at this table and time');
      put(s, 'sessions', { ...old, id: ident(r.id), tableId: t.id, startsAt, endsAt, localDate: localDate(startsAt, t.timezone), timezone: t.timezone, status: 'scheduled', draft: old?.draft || null }); break;
    }
    case 'scheduleOccurrences': {
      const through = isoDate(cmd.through); insist(through <= new Date(Date.parse(now) + 45 * 86400000).toISOString().slice(0, 10), 'Generate at most 45 days ahead');
      for (const t of s.tables.filter(t => t.active)) {
        for (let d = localDate(now, t.timezone); d <= through; d = new Date(Date.parse(d + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)) {
          if (new Date(d + 'T12:00:00Z').getUTCDay() !== t.weekday) continue;
          const id = `scheduled:${t.id}:${d}`; if (s.sessions.some(x => x.id === id || (x.tableId === t.id && x.localDate === d))) continue;
          const startsAt = localToInstant(d + 'T' + t.startTime, t.timezone);
          mutate(s, { type: 'saveSession', record: { id, tableId: t.id, startsAt, endsAt: new Date(Date.parse(startsAt) + t.normalMinutes * 60000).toISOString() } }, actor, now);
        }
      } break;
    }
    case 'saveDraft': { const session = get(s, 'sessions', cmd.input.sessionId); insist(!session.approvedAt, 'Closeout already approved'); previewCloseout(s, cmd.input, now, context); session.draft = structuredClone(cmd.input); break; }
    case 'cancelSession': { const session = get(s, 'sessions', cmd.sessionId); insist(!session.approvedAt, 'An approved session cannot be canceled; review its payments'); session.status = 'canceled'; session.canceledReason = text(cmd.reason, 'cancellation reason', 500); session.canceledAt = now; break; }
    case 'closeSession': {
      const session = get(s, 'sessions', cmd.input.sessionId); if (session.approvedAt) return { duplicate: true, sessionId: session.id };
      const p = previewCloseout(s, cmd.input, now, context); insist(JSON.stringify(p) === JSON.stringify(cmd.reviewed), 'The closeout changed after review; review the current amounts again');
      session.approvedAt = now; session.approvedBy = actor; session.minutes = p.minutes; session.review = p; session.draft = null; session.status = 'recorded';
      for (const row of p.rows) { if (row.payerPlanId || (row.amountCents === 0 && row.rateCents === 0 && row.fixedCents === 0 && row.capCents === 0)) continue; s.obligations.push({ ...row, createdAt: now, historical: false }); if (row.collectCents) queue(s, `closeout:${row.id}`, row.payerId, [{ obligationId: row.id, amountCents: row.collectCents }], now, actor, row.hold); }
      break;
    }
    case 'collectBalance': {
      const id = ident(cmd.id); if (s.operations.some(o => o.id === id)) return { duplicate: true, operationId: id };
      const payer = get(s, 'payers', cmd.payerId); insist(Array.isArray(cmd.items) && cmd.items.length > 0 && cmd.items.length <= 30 && new Set(cmd.items.map(i => i.obligationId)).size === cmd.items.length, 'Choose distinct statement lines');
      const obligations = cmd.items.map(i => { const o = get(s, 'obligations', i.obligationId); insist(o.payerId === payer.id && !o.payerPlanId && o.collectionEligible !== false && cents(i.amountCents) > 0 && i.amountCents <= balance(s, o.id), 'Invalid payer or outstanding amount'); return o; });
      insist(!collectionHold(s, payer, obligations, now), collectionHold(s, payer, obligations, now));
      const reviewed = previewStatement(s, payer.id, cmd.items, now); insist(JSON.stringify(cmd.reviewed) === JSON.stringify(reviewed), 'The statement changed after review');
      queue(s, id, payer.id, structuredClone(cmd.items), now, actor);
      for (const old of s.operations.filter(o => o.status === 'held' && o.items.some(i => cmd.items.some(j => j.obligationId === i.obligationId)))) old.status = 'superseded';
      break;
    }
    case 'recordAuthorization': {
      const p = get(s, 'payers', cmd.payerId), effectiveFrom = isoDate(cmd.effectiveFrom), evidence = text(cmd.evidence, 'authorization evidence reference', 500);
      insist(evidence.length >= 10, 'Record a meaningful consent evidence reference');
      insist(effectiveFrom >= localDate(now), 'Automatic collection authorization must start prospectively');
      const scope = s.memberships.filter(m => get(s, 'players', m.playerId).payerId === p.id && (!m.until || m.until > effectiveFrom)).map(m => ({ playerId: m.playerId, tableId: m.tableId, capCents: m.capCents }));
      insist(scope.length > 0, 'Add the authorized reserved seats first');
      p.authorization = { id: `consent:${p.id}:${s.audit.length + 1}`, grantedAt: now, effectiveFrom, evidence, scope, revokedAt: null }; p.attention = null; break;
    }
    case 'revokeAuthorization': { const p = get(s, 'payers', cmd.payerId); if (p.authorization) p.authorization.revokedAt = now; p.attention = 'Automatic collection authorization revoked'; for (const op of s.operations.filter(o => o.payerId === p.id && o.status === 'queued')) { op.status = 'held'; op.reason = p.attention; } break; }
    case 'collectionSwitch': {
      insist(typeof cmd.enabled === 'boolean', 'Invalid collection switch');
      if (cmd.enabled) { insist(!s.settings.recoveryHold && s.settings.historyConfirmedAt, 'Confirm opening balances and recovery first'); insist(!feedProblem(s, now), feedProblem(s, now)); }
      s.settings.collectionEnabled = cmd.enabled;
      if (!cmd.enabled) for (const op of s.operations.filter(o => o.status === 'queued')) { op.status = 'held'; op.reason = 'Owner stopped new collection'; }
      break;
    }
    case 'confirmOpening': {
      insist(!s.settings.collectionEnabled, 'Turn collection off before confirming history');
      insist(cmd.confirmation === 'ROSTER, FEES AND OPENING BALANCES REVIEWED', 'Confirm the roster, individual terms and opening balances together');
      insist(s.payers.length && s.players.length && s.tables.length && !s.rosterDrafts.some(d => !d.resolvedAt), 'Resolve roster drafts and load the actual roster before confirmation');
      s.settings.historyConfirmedAt = now; s.settings.migrationCutoff = isoDate(cmd.cutoff); insist(cmd.cutoff >= localDate(now), 'Collection begins prospectively');
      s.settings.recoveryHold = false; break;
    }
    case 'confirmTracking': {
      insist(cmd.confirmation === 'ROSTER, FEES AND TRACKING HISTORY REVIEWED', 'Confirm the roster, individual terms and available tracking history together');
      insist(s.payers.length && s.players.length && s.tables.length && !s.rosterDrafts.some(d => !d.resolvedAt), 'Resolve roster drafts and load the actual roster before confirmation');
      const from = isoDate(cmd.from); insist(from <= localDate(now), 'Tracking history cannot begin in the future');
      s.settings.trackingFrom = from; s.settings.trackingConfirmedAt = now;
      // This review grants no payment authority and never clears recovery holds.
      break;
    }
    case 'ingestReceipts': {
      insist(['stripe', 'venmo', 'cashapp'].includes(cmd.provider) && Array.isArray(cmd.receipts) && cmd.receipts.length <= 500, 'Invalid receipt batch');
      for (const raw of cmd.receipts) {
        ident(raw.id); ident(raw.providerId); cents(raw.amountCents); insist(raw.provider === cmd.provider && raw.id === `${raw.provider}:${raw.providerId}`, 'Receipt identity must include provider and transaction ID');
        const old = s.receipts.find(r => r.id === raw.id);
        if (old) {
          insist(old.amountCents === raw.amountCents && old.currency === raw.currency && old.direction === raw.direction, 'Provider identity changed amount or direction; review source');
          // A later authoritative read may reveal a refund, dispute or fee. It
          // never changes the original received amount or its allocations.
          if (raw.authenticated && raw.source === 'stripe_api') {
            if (raw.feeCents !== null && raw.feeCents !== undefined) old.feeCents = cents(raw.feeCents);
            old.refundedCents = Math.max(old.refundedCents || 0, cents(raw.refundedCents || 0));
            insist(old.refundedCents <= old.amountCents, 'Refund exceeds receipt');
            if (raw.disputed) old.disputed = true;
            if (old.disputed || old.refundedCents) old.reviewReason = old.disputed ? 'Stripe reports a dispute; owner review required' : 'Refund received; review its session allocation';
          }
          continue;
        }
        insist(['incoming', 'transfer', 'refund', 'outgoing', 'unknown', 'fee'].includes(raw.direction), 'Unknown receipt direction');
        const r = { id: raw.id, providerId: raw.providerId, provider: raw.provider, amountCents: raw.amountCents, currency: text(raw.currency, 'currency', 3), direction: raw.direction, receivedAt: instant(raw.receivedAt), source: text(raw.source, 'source', 40), sourceId: raw.sourceId ? ident(raw.sourceId) : null, payerName: text(raw.payerName || '', 'receipt payer', 150, true), payerId: null, authenticated: raw.authenticated === true, status: raw.authenticated === true && raw.currency === 'usd' && raw.status === 'received' ? 'received' : 'review', refundedCents: 0, feeCents: raw.feeCents === null || raw.feeCents === undefined ? null : cents(raw.feeCents), reviewReason: raw.reviewReason || null };
        r.providerDate = raw.providerDate || null; r.providerTimezone = raw.providerTimezone || null;
        if (raw.payerId) { get(s, 'payers', raw.payerId); r.payerId = raw.payerId; }
        r.refundedCents = cents(raw.refundedCents || 0); r.disputed = raw.disputed === true; insist(r.refundedCents <= r.amountCents, 'Refund exceeds receipt');
        if (r.disputed || r.refundedCents) r.reviewReason = r.disputed ? 'Stripe reports a dispute; owner review required' : 'Refund received; review its session allocation';
        if (!r.authenticated) r.reviewReason = 'Receipt origin or format needs verification';
        s.receipts.push(r); autoMatch(s, r);
      }
      if (cmd.syncedAt) { const f = s.feeds[cmd.provider]; f.lastSuccess = instant(cmd.syncedAt); f.status = f.verified ? 'connected' : 'unverified'; f.reason = f.verified ? null : 'Authentic receipt template proof required'; }
      break;
    }
    case 'allocateReceipt': {
      const r = get(s, 'receipts', cmd.receiptId); get(s, 'payers', cmd.payerId);
      insist(r.direction === 'incoming' && r.currency === 'usd' && r.authenticated && r.status === 'received', 'Only authenticated received USD payments can be allocated');
      insist(!r.payerId || r.payerId === cmd.payerId || allocated(s, r.id) === 0, 'A partly allocated receipt keeps its payer'); r.payerId = cmd.payerId;
      insist(Array.isArray(cmd.allocations) && cmd.allocations.length && new Set(cmd.allocations.map(a => a.obligationId)).size === cmd.allocations.length, 'Choose distinct allocations');
      const sum = cmd.allocations.reduce((n, a) => n + cents(a.amountCents), 0); insist(sum > 0 && sum <= r.amountCents - r.refundedCents - allocated(s, r.id), 'Allocation exceeds the unallocated payment');
      for (const a of cmd.allocations) {
        const o = get(s, 'obligations', a.obligationId); insist(o.payerId === cmd.payerId && a.amountCents > 0 && a.amountCents <= balance(s, o.id), 'Allocation exceeds this payer’s balance');
        insist(!s.operations.some(op => activeOperation(op) && op.items.some(i => i.obligationId === o.id)), 'A Stripe payment is unresolved; reconcile it before allocating');
        s.allocations.push({ id: `${r.id}:${o.id}:${s.allocations.length + 1}`, receiptId: r.id, obligationId: o.id, amountCents: a.amountCents, actor, at: now });
      }
      r.reviewReason = r.amountCents - r.refundedCents > allocated(s, r.id) ? 'Some of this payment is still unallocated' : null; break;
    }
    case 'classifyReceipt': { const r = get(s, 'receipts', cmd.receiptId); insist(!allocated(s, r.id), 'Allocated payments cannot be reclassified'); insist(['personal', 'transfer', 'review'].includes(cmd.classification), 'Invalid receipt classification'); r.classification = cmd.classification; r.reviewReason = cmd.classification === 'review' ? 'Owner retained for review' : null; break; }
    case 'importHistory': {
      insist(!s.settings.collectionEnabled, 'History imports require collection off');
      insist(cmd.data?.schema === '20fates-history/1', 'Use the documented history import format');
      insist(cmd.data.rosterDrafts === undefined || (Array.isArray(cmd.data.rosterDrafts) && cmd.data.rosterDrafts.length <= 200), 'Import at most 200 roster drafts');
      for (const record of cmd.data.rosterDrafts || []) {
        const old = s.rosterDrafts.find(d => d.id === record?.id);
        if (old) {
          insist(['label', 'knownFacts', 'aliasHolds', 'termHolds'].every(key => JSON.stringify(old[key]) === JSON.stringify(record[key])), 'Imported draft differs from the existing record; review and edit it instead');
          continue;
        }
        mutate(s, { type: 'saveRosterDraft', record }, actor, now, context);
      }
      for (const [plural, type] of [['payers', 'savePayer'], ['players', 'savePlayer'], ['tables', 'saveTable'], ['memberships', 'saveMembership']]) for (const record of cmd.data[plural] || []) {
        if (s[plural].some(x => x.id === record.id)) continue;
        mutate(s, { type, record }, actor, now);
      }
      if (cmd.data.receipts?.length) insist(cmd.confirmation === 'RECORD VERIFIED HISTORICAL RECEIPTS', 'Confirm the source and amounts of historical receipts');
      for (const r of cmd.data.receipts || []) mutate(s, { type: 'ingestReceipts', provider: r.provider, receipts: [{ ...r, source: 'owner_confirmed_export', authenticated: true, status: 'received', reviewReason: 'Owner-confirmed historical receipt; choose its allocation' }] }, actor, now);
      for (const raw of cmd.data.obligations || []) {
        if (s.obligations.some(o => o.id === raw.id)) continue;
        get(s, 'players', raw.playerId); get(s, 'payers', raw.payerId); get(s, 'tables', raw.tableId); isoDate(raw.sessionDate); cents(raw.amountCents);
        s.obligations.push({ id: ident(raw.id), playerId: raw.playerId, payerId: raw.payerId, tableId: raw.tableId, sessionDate: raw.sessionDate, amountCents: raw.closedExternally ? 0 : raw.amountCents, reportedAmountCents: raw.amountCents, historical: true, collectionEligible: false, closedExternally: raw.closedExternally === true, disposition: 'defer', createdAt: now, evidence: text(raw.evidence, 'history evidence', 500) });
      }
      s.settings.historyConfirmedAt = null; s.settings.trackingConfirmedAt = null; s.settings.recoveryHold = true; break;
    }
    default: throw new Error('Unknown private operation');
  }
  audit(s, cmd.type, actor, now, { recordId: cmd.record?.id || cmd.sessionId || cmd.payerId || cmd.receiptId || cmd.id || null });
  return { ok: true };
}
export function sessionDisposition(s, session) {
  if (!session.approvedAt) return session.status;
  const ids = new Set(s.obligations.filter(o => o.sessionId === session.id).map(o => o.id));
  const ops = s.operations.filter(o => o.items.some(i => ids.has(i.obligationId)));
  if (ops.some(o => ['held', 'failed', 'uncertain'].includes(o.status))) return 'needs_attention';
  if (ops.some(activeOperation)) return 'processing';
  return 'complete';
}
export function dashboard(s, now, month = localDate(now).slice(0, 7)) {
  insist(/^\d{4}-(0[1-9]|1[0-2])$/.test(month), 'Invalid month');
  const obligations = s.obligations.filter(o => o.sessionDate.startsWith(month));
  const monthReceipts = s.receipts.filter(r => localDate(r.receivedAt).startsWith(month) && r.status === 'received' && !['personal', 'transfer'].includes(r.classification));
  const receipts = monthReceipts.filter(r => r.direction === 'incoming');
  const received = receipts.reduce((n, r) => n + r.amountCents, 0), allocatedReceipts = receipts.reduce((n, r) => n + allocated(s, r.id), 0);
  return { now, month, coverage: trackingCoverage(s, now, month), collectionEnabled: s.settings.collectionEnabled, recoveryHold: s.settings.recoveryHold, needsCloseout: s.sessions.filter(x => !x.approvedAt && x.status !== 'canceled' && x.endsAt <= now), upcoming: s.sessions.filter(x => x.status === 'scheduled' && !x.approvedAt && x.startsAt > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt)), attention: s.operations.filter(o => ['held', 'failed', 'uncertain'].includes(o.status)), unmatched: s.receipts.filter(r => r.reviewReason && !['personal', 'transfer'].includes(r.classification)), feeds: s.feeds,
    totals: { expected: obligations.reduce((n, o) => n + o.amountCents, 0), outstanding: obligations.reduce((n, o) => n + balance(s, o.id), 0), received, allocatedReceipts, unallocated: receipts.reduce((n, r) => n + Math.max(0, r.amountCents - r.refundedCents - allocated(s, r.id)), 0), pending: s.operations.filter(o => ['queued', 'processing', 'pending', 'uncertain'].includes(o.status)).flatMap(o => o.items).filter(i => obligations.some(o => o.id === i.obligationId)).reduce((n, i) => n + i.amountCents, 0), refunds: receipts.reduce((n, r) => n + (r.refundedCents || 0), 0), providerFees: receipts.filter(r => r.feeCents !== null).reduce((n, r) => n + r.feeCents, 0) + monthReceipts.filter(r => r.direction === 'fee').reduce((n, r) => n + r.amountCents, 0), feesIncomplete: receipts.some(r => r.feeCents === null) },
    tables: s.tables.map(t => { const date = localDate(now, t.timezone), members = reserved(s, t.id, date), own = obligations.filter(o => o.tableId === t.id); return { ...t, occupiedSeats: members.length, openSeats: Math.max(0, t.capacity - members.length), estimatedSessionCents: members.reduce((n, m) => n + (activePayerPlan(s, m.id, date) ? 0 : Math.min(m.fixedCents ?? calculateFeeCents(t.normalMinutes, m.rateCents), m.capCents)), 0), collectedCents: own.reduce((n, o) => n + o.amountCents - balance(s, o.id), 0), outstandingCents: own.reduce((n, o) => n + balance(s, o.id), 0) }; }),
    enrollment: Object.fromEntries(['Needs setup', 'Awaiting authorization', 'Ready', 'Needs attention'].map(status => [status, s.payers.filter(p => enrollment(p, localDate(now)) === status).length])) };
}
export function trackingCoverage(s, now, month) {
  const from = localToInstant(`${month}-01T00:00`, 'America/Chicago');
  const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const through = new Date(Math.min(Date.parse(now), Date.parse(localToInstant(`${nextMonth}T00:00`, 'America/Chicago')))).toISOString();
  const gaps = [], providers = {};
  if (from > now) gaps.push('This reporting month has not happened yet');
  if (!s.settings.trackingConfirmedAt) gaps.push('Private roster, fees and opening history have not been reviewed');
  if (!s.settings.trackingFrom || s.settings.trackingFrom > `${month}-01`) gaps.push('Opening history does not cover the whole selected month');
  for (const [id, feed] of Object.entries(s.feeds)) {
    const label = { stripe: 'Stripe', venmo: 'Venmo', cashapp: 'Cash App' }[id];
    const fresh = feed.lastSuccess && Number.isFinite(Date.parse(feed.lastSuccess)) && Date.parse(now) - Date.parse(feed.lastSuccess) <= FEED_MAX_AGE_MS;
    const covered = feed.coveredFrom && feed.coveredThrough && Date.parse(feed.coveredFrom) <= Date.parse(from) && Date.parse(feed.coveredThrough) >= Date.parse(through) - FEED_MAX_AGE_MS;
    const problem = !feed.verified ? 'authentic receipt evidence is unverified' : feed.status !== 'connected' ? (feed.status === 'backfilling' ? 'history backfill is incomplete' : 'connection is unavailable') : !fresh ? 'last successful sync is stale' : !covered ? 'the selected interval is not fully covered' : null;
    if (problem) gaps.push(`${label}: ${problem}`);
    providers[id] = { label, problem, from: feed.coveredFrom || null, through: feed.coveredThrough || null, lastSuccess: feed.lastSuccess, status: problem ? 'incomplete' : 'current' };
  }
  if (s.receipts.some(r => r.reviewReason && !['personal', 'transfer'].includes(r.classification))) gaps.push('Receipt matches, refunds or unknown notices still need owner review');
  return { complete: gaps.length === 0, from, through, gaps, providers };
}
