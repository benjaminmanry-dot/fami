import { createClient } from 'npm:@supabase/supabase-js@2.115.0';
import StripeClient from 'npm:stripe@22.6.1';
import { ledgerStore } from '../_shared/store.mjs';
import { ownerService } from '../_shared/service.mjs';
import { stripeGateway } from '../_shared/stripe.mjs';
import { GmailFeed } from '../_shared/receipts.mjs';
import { ownerHandler, verifyOwner } from '../_shared/http.mjs';
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const env = (name: string) => Deno.env.get(name) || '';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), options);
const auth = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), options);
const store = ledgerStore(async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error('Private database transaction did not complete');
  return data;
});
const mode = env('OWNER_STRIPE_MODE') === 'live' ? 'live' : 'test';
const key = env('STRIPE_RESTRICTED_KEY');
// This release is tracking-only, not an environment-variable activation gate.
// A future collection release needs Ben's separate decision and reviewed code.
const trackingOnly = true;
const providerWrites = !trackingOnly && env('OWNER_PROVIDER_WRITES_ACTIVATED') === 'true';
const unavailable = async () => { throw new Error('Stripe restricted key is not connected in the declared mode'); };
// A provider outage must not take away the owner's ledger or stop control.
const gateway = key.startsWith(mode === 'live' ? 'rk_live_' : 'rk_test_')
  ? stripeGateway(new StripeClient(key, { maxNetworkRetries: 0, timeout: 15000, httpClient: StripeClient.createFetchHttpClient() }), { mode, accountId: env('STRIPE_ACCOUNT_ID'), allowWrites: providerWrites, trackingOnly, cryptoProvider: StripeClient.createSubtleCryptoProvider() })
  : { mode, allowWrites: false, preflight: unavailable, collect: unavailable, inspect: unavailable, setup: unavailable, verifySetup: unavailable, history: unavailable, event: unavailable };
const gmail = new GmailFeed({ clientId: env('GMAIL_CLIENT_ID'), clientSecret: env('GMAIL_CLIENT_SECRET'), refreshToken: env('GMAIL_REFRESH_TOKEN'), mailbox: env('GMAIL_RECEIPT_MAILBOX'), cashappTemplateVerified: env('CASHAPP_TEMPLATE_VERIFIED') === 'true' });
const service = ownerService({ store, gateway, gmail, trackingOnly, collectionActivated: providerWrites && env('OWNER_COLLECTION_ACTIVATED') === 'true' });
const handler = ownerHandler({ service, store, gateway, authorize: (token: string) => verifyOwner(auth, token, env('OWNER_USER_ID')), origin: 'https://20fates.com', cronSecret: env('OWNER_CRON_SECRET'), backupSecret: env('OWNER_BACKUP_SECRET'), backupKey: env('OWNER_BACKUP_KEY'), webhookSecret: env('STRIPE_WEBHOOK_SECRET'), background: (promise: Promise<unknown>) => EdgeRuntime.waitUntil(promise) });
Deno.serve(handler);
