import { insist, get, cents, money } from './ledger.mjs';

const idOf = value => typeof value === 'string' ? value : value?.id || null;
export function stripeGateway(stripe, { mode = 'test', accountId, allowWrites = false, trackingOnly = false, siteOrigin = 'https://20fates.com', cryptoProvider } = {}) {
  allowWrites = !trackingOnly && allowWrites;
  const requireMode = object => insist(object && object.livemode === (mode === 'live'), 'Stripe mode does not match this private deployment');
  const writesAllowed = () => insist(allowWrites, 'External Stripe writes have not been activated');
  async function listAll(resource, args) {
    const result = []; let after;
    for (let pageNo = 0; pageNo < 100; pageNo++) {
      const page = await resource.list({ ...args, limit: 100, ...(after ? { starting_after: after } : {}) });
      result.push(...page.data); if (!page.has_more) return result;
      insist(page.data.length, 'Stripe returned incomplete pagination'); after = page.data.at(-1).id;
    }
    throw new Error('Stripe history exceeds the bounded sync; finish the backfill before collection');
  }
  async function preflight(op, s) {
      const p = get(s, 'payers', op.payerId);
    const [account, customer, method] = await Promise.all([stripe.accounts.retrieve(), stripe.customers.retrieve(op.customerId), stripe.paymentMethods.retrieve(op.paymentMethodId)]);
    insist(account.id === accountId && account.charges_enabled, 'Stripe account is not the approved, collection-ready account');
    requireMode(customer); requireMode(method);
    insist(!customer.deleted && customer.metadata?.autopay_status !== 'revoked', 'Stripe customer is deleted or consent was revoked');
    insist(idOf(method.customer) === op.customerId, 'Saved payment method belongs to another payer');
    insist(['card', 'us_bank_account'].includes(method.type), 'This payment method type needs separate verification');
    insist(idOf(customer.invoice_settings?.default_payment_method) === (p.setup?.defaultAtSetup || null), 'Stripe default method changed since verified enrollment');
    insist(customer.balance === 0 && !(customer.discount || customer.discounts?.length), 'Customer credit or discount requires separate review');
    return customer;
  }
  function checkInvoice(invoice, op) {
    requireMode(invoice);
    insist(idOf(invoice.customer) === op.customerId && invoice.metadata?.owner_operation_id === op.id && invoice.metadata?.owner_amount_cents === String(op.amountCents), 'Stripe invoice does not match the approved operation');
    insist(invoice.auto_advance === false && !invoice.next_payment_attempt && invoice.collection_method === 'charge_automatically', 'Stripe invoice has an unexpected collection or retry policy');
  }
  async function inspect(op) {
    let invoice;
    if (op.invoiceId) invoice = await stripe.invoices.retrieve(op.invoiceId);
    else {
      const matches = (await listAll(stripe.invoices, { customer: op.customerId })).filter(i => i.metadata?.owner_operation_id === op.id);
      insist(matches.length <= 1, 'Several Stripe invoices share a permanent collection identity');
      if (!matches.length) return { status: 'uncertain', reason: 'No matching invoice is visible; the started operation is not retried' };
      invoice = matches[0];
    }
    checkInvoice(invoice, op);
    const payments = await listAll(stripe.invoicePayments, { invoice: invoice.id, expand: ['data.payment.payment_intent'] });
    const intents = payments.map(p => p.payment?.payment_intent).filter(Boolean);
    insist(intents.length <= 1, 'Invoice has multiple payment attempts; review in Stripe');
    const pi = intents[0] ? await stripe.paymentIntents.retrieve(idOf(intents[0]), { expand: ['latest_charge.balance_transaction'] }) : null;
    if (pi) requireMode(pi);
    const common = { invoiceId: invoice.id, invoiceStatus: invoice.status, attemptCount: invoice.attempt_count };
    if (pi?.status === 'succeeded') {
      insist(idOf(pi.customer) === op.customerId && pi.amount_received === op.amountCents && pi.currency === 'usd' && invoice.total === op.amountCents && invoice.amount_paid === op.amountCents, 'Stripe received an unexpected amount or payer');
      const charge = pi.latest_charge, transaction = typeof charge === 'object' && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;
      return { ...common, status: 'succeeded', paymentIntentId: pi.id, receivedAt: new Date(pi.created * 1000).toISOString(), amountCents: pi.amount_received, refundedCents: charge?.amount_refunded || 0, disputed: charge?.disputed === true, feeCents: transaction?.fee ?? null };
    }
    if (pi?.status === 'processing') return { ...common, status: 'pending', paymentIntentId: pi.id, reason: 'Stripe is still processing the payment' };
    if (pi && ['requires_action', 'requires_payment_method', 'canceled'].includes(pi.status)) return { ...common, status: 'failed', reason: pi.status === 'requires_action' ? 'Payer authentication is required; no automatic retry' : 'Stripe did not complete the payment; no automatic retry' };
    return { ...common, status: 'uncertain', reason: invoice.status === 'paid' ? 'Invoice is marked paid without a verified matching payment; reconcile its source' : 'No completed attempt is proven; inspect the existing invoice, never create a replacement' };
  }
  return {
    mode, allowWrites, preflight, inspect,
    async collect(op, s, effect, checkpoint) {
      writesAllowed(); await preflight(op, s);
      const metadata = { owner_operation_id: op.id, owner_amount_cents: String(op.amountCents), owner_payer_id: op.payerId, owner_authorization_id: op.authorization.id, source: '20fates_owner_panel' };
      let invoice = await effect('invoice', () => stripe.invoices.create({ customer: op.customerId, default_payment_method: op.paymentMethodId, auto_advance: false, collection_method: 'charge_automatically', pending_invoice_items_behavior: 'exclude', automatic_tax: { enabled: false }, default_tax_rates: [], discounts: '', metadata }, { idempotencyKey: `${op.id}:invoice` }));
      await checkpoint({ invoiceId: invoice.id }); checkInvoice(invoice, op);
      for (const item of op.items) {
        const o = get(s, 'obligations', item.obligationId);
        const description = `${o.tableName || get(s, 'tables', o.tableId).name} · ${o.sessionDate} · ${o.minutes} minutes · ${o.fixedCents === null ? money(o.rateCents) + '/hour' : 'fixed session fee'} · session fee ${money(o.amountCents)}${item.amountCents !== o.amountCents ? ' · partial collection ' + money(item.amountCents) : ''}`;
        await effect(`line:${item.obligationId}`, () => stripe.invoiceItems.create({ invoice: invoice.id, customer: op.customerId, amount: item.amountCents, currency: 'usd', discountable: false, tax_rates: [], description, metadata: { owner_operation_id: op.id, owner_obligation_id: o.id, session_date: o.sessionDate, duration_minutes: String(o.minutes), rate_cents: String(o.rateCents), calculated_cents: String(o.calculatedCents), approved_session_cents: String(o.amountCents) } }, { idempotencyKey: `${op.id}:line:${item.obligationId}` }));
      }
      const lines = await listAll(stripe.invoices.listLineItems ? { list: params => stripe.invoices.listLineItems(invoice.id, params) } : null, {});
      insist(lines.length === op.items.length && op.items.every(i => lines.filter(l => l.metadata?.owner_obligation_id === i.obligationId && l.amount === i.amountCents).length === 1), 'Invoice lines do not match the approved itemization');
      invoice = await effect('finalize', () => stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false }, { idempotencyKey: `${op.id}:finalize` }));
      checkInvoice(invoice, op);
      insist(invoice.status === 'open' && invoice.total === op.amountCents && invoice.amount_due === op.amountCents && invoice.amount_paid === 0 && invoice.attempt_count === 0 && !invoice.attempted && !invoice.starting_balance, 'Invoice amount or attempt state changed before collection');
      await effect('pay', () => stripe.invoices.pay(invoice.id, { off_session: true, payment_method: op.paymentMethodId }, { idempotencyKey: `${op.id}:pay` }));
      return await inspect({ ...op, invoiceId: invoice.id });
    },
    async setup(payer, request, effect) {
      writesAllowed(); const account = await stripe.accounts.retrieve(); insist(account.id === accountId, 'Stripe account mismatch');
      let customerId = payer.stripeCustomerId;
      if (!customerId) { const customer = await effect('customer', () => stripe.customers.create({ name: payer.name, email: payer.email || undefined, metadata: { owner_payer_id: payer.id } }, { idempotencyKey: `${request.id}:customer` })); requireMode(customer); customerId = customer.id; }
      insist(/^[a-z]{8}$/.test(request.integrationSuffix), 'Hosted setup identity is missing');
      const session = await effect('setup', () => stripe.checkout.sessions.create({ mode: 'setup', customer: customerId, currency: 'usd', client_reference_id: request.id, integration_identifier: `20fates_owner_panel_${request.integrationSuffix}`, consent_collection: { terms_of_service: 'required' }, custom_text: { submit: { message: 'Save a payment method for individually agreed 20Fates session fees. Saving alone does not activate collection; Ben separately records your authorization and its start date.' } }, setup_intent_data: { metadata: { owner_setup_request_id: request.id, owner_payer_id: payer.id } }, metadata: { owner_setup_request_id: request.id, owner_payer_id: payer.id }, success_url: `${siteOrigin}/billing/setup-complete/`, cancel_url: `${siteOrigin}/billing/terms/` }, { idempotencyKey: `${request.id}:setup` }));
      requireMode(session); insist(/^https:\/\/checkout\.stripe\.com\//.test(session.url), 'Stripe returned an unexpected setup URL');
      return { customerId, sessionId: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1000).toISOString() };
    },
    async verifySetup(sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['setup_intent.payment_method'] }); requireMode(session);
      insist(session.mode === 'setup' && session.status === 'complete' && session.consent?.terms_of_service === 'accepted', 'Hosted setup or terms acceptance is incomplete');
      const si = session.setup_intent; insist(typeof si === 'object' && si.status === 'succeeded', 'Payment method setup has not succeeded');
      const method = si.payment_method, customerId = idOf(session.customer), customer = await stripe.customers.retrieve(customerId); requireMode(customer);
      insist(typeof method === 'object' && idOf(method.customer) === customerId, 'Hosted method does not belong to the payer');
      const label = method.card ? `${method.card.brand} ending ${method.card.last4}` : method.us_bank_account ? `Bank account ending ${method.us_bank_account.last4}` : method.type;
      return { requestId: session.metadata.owner_setup_request_id, payerId: session.metadata.owner_payer_id, customerId, sessionId, setupIntentId: si.id, paymentMethodId: method.id, label, defaultAtSetup: idOf(customer.invoice_settings?.default_payment_method), mandateId: idOf(si.mandate), termsAccepted: true };
    },
    async history(s, since) {
      const account = await stripe.accounts.retrieve(); insist(account.id === accountId, 'Stripe account mismatch');
      const intents = await listAll(stripe.paymentIntents, { created: { gte: Math.floor(Date.parse(since) / 1000) }, expand: ['data.latest_charge.balance_transaction'] });
      const receipts = [];
      for (const p of intents) {
        requireMode(p); if (p.status !== 'succeeded' || p.currency !== 'usd') continue;
        const charge = p.latest_charge, tx = typeof charge?.balance_transaction === 'object' ? charge.balance_transaction : null;
        receipts.push({ id: `stripe:${p.id}`, providerId: p.id, provider: 'stripe', amountCents: cents(p.amount_received), currency: p.currency, direction: 'incoming', status: 'received', receivedAt: new Date(p.created * 1000).toISOString(), payerName: '', payerId: s.payers.find(x => x.stripeCustomerId === idOf(p.customer))?.id || null, authenticated: true, source: 'stripe_api', refundedCents: charge?.amount_refunded || 0, disputed: charge?.disputed === true, feeCents: tx?.fee ?? null, reviewReason: 'Historical payment: confirm its allocation; no collection is created' });
      }
      const fees = await listAll(stripe.balanceTransactions, { created: { gte: Math.floor(Date.parse(since) / 1000) }, type: 'stripe_fee' });
      for (const f of fees) if (f.currency === 'usd') receipts.push({ id: `stripe:${f.id}`, providerId: f.id, provider: 'stripe', amountCents: Math.abs(f.amount), currency: f.currency, direction: 'fee', status: 'received', receivedAt: new Date(f.created * 1000).toISOString(), payerName: '', authenticated: true, source: 'stripe_api', feeCents: 0 });
      return receipts;
    },
    async event(raw, signature, secret) {
      // The SDK accepts an empty HMAC key. Missing configuration is a closed
      // endpoint, not permission to verify signatures against a public key.
      insist(typeof secret === 'string' && /^whsec_[A-Za-z0-9]{16,256}$/.test(secret), 'Stripe webhook verification has not been configured');
      return await stripe.webhooks.constructEventAsync(raw, signature, secret, undefined, cryptoProvider);
    }
  };
}
