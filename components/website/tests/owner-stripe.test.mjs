import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { ownerHandler } from '../supabase/functions/_shared/http.mjs';
import { stripeGateway } from '../supabase/functions/_shared/stripe.mjs';
import { seedDemo, DEMO_TIME } from '../scripts/owner-simulation.mjs';
import { applyCommand, previewCloseout } from '../supabase/functions/_shared/ledger.mjs';

function fixture() {
  const s = seedDemo(), write = c => applyCommand(s,c,'synthetic owner',DEMO_TIME);
  write({type:'collectionSwitch',enabled:true});
  const input={sessionId:'session-today',minutes:120,rows:['player-1','player-2','player-3','player-4'].map(playerId=>({playerId,disposition:'defer'}))};
  write({type:'closeSession',input,reviewed:previewCloseout(s,input,DEMO_TIME)});
  const op=s.operations[0], calls=[], lines=[];
  const invoice={id:'in_synthetic',livemode:false,status:'draft',auto_advance:false,next_payment_attempt:null,collection_method:'charge_automatically',customer:op.customerId,attempt_count:0,attempted:false,amount_paid:0,starting_balance:0};
  const pi={id:'pi_synthetic',livemode:false,status:'succeeded',customer:op.customerId,currency:'usd',amount_received:op.amountCents,created:Math.floor(Date.parse(DEMO_TIME)/1000),latest_charge:{amount_refunded:0,disputed:false,balance_transaction:{fee:81}}};
  const customer={id:op.customerId,livemode:false,balance:0,invoice_settings:{default_payment_method:null}};
  const method={id:op.paymentMethodId,livemode:false,type:'card',customer:op.customerId};
  const fake={
    accounts:{retrieve:async()=>({id:'acct_synthetic',charges_enabled:true})},
    customers:{retrieve:async()=>customer},paymentMethods:{retrieve:async()=>method},
    invoices:{
      create:async(args,options)=>{calls.push({phase:'invoice',args,options});Object.assign(invoice,args);return structuredClone(invoice);},
      retrieve:async()=>structuredClone(invoice),list:async()=>({data:[structuredClone(invoice)],has_more:false}),
      listLineItems:async()=>({data:structuredClone(lines),has_more:false}),
      finalizeInvoice:async(id,args,options)=>{calls.push({phase:'finalize',id,args,options});Object.assign(invoice,{status:'open',total:op.amountCents,amount_due:op.amountCents});return structuredClone(invoice);},
      pay:async(id,args,options)=>{calls.push({phase:'pay',id,args,options});Object.assign(invoice,{status:'paid',amount_paid:op.amountCents,attempt_count:1,attempted:true});return structuredClone(invoice);}
    },
    invoiceItems:{create:async(args,options)=>{calls.push({phase:'line',args,options});lines.push({id:'il_synthetic',...args});return args;}},
    invoicePayments:{list:async()=>({data:[{payment:{payment_intent:pi.id}}],has_more:false})},
    paymentIntents:{retrieve:async()=>structuredClone(pi)}
  };
  return {s,op,calls,invoice,pi,customer,method,lines,fake,gateway:stripeGateway(fake,{mode:'test',accountId:'acct_synthetic',allowWrites:true})};
}
test('real Stripe adapter emits exact itemized amount, no pending items, no tax, discounts or retries',async()=>{
  const f=fixture(), phases=[];
  const result=await f.gateway.collect(f.op,f.s,async(phase,run)=>{phases.push(phase);return run();},async patch=>Object.assign(f.op,patch));
  assert.equal(result.status,'succeeded');assert.equal(result.amountCents,1900);assert.equal(result.feeCents,81);
  assert.equal(f.calls.filter(c=>c.phase==='pay').length,1);
  const invoice=f.calls[0].args;
  assert.equal(invoice.auto_advance,false);assert.equal(invoice.pending_invoice_items_behavior,'exclude');assert.deepEqual(invoice.automatic_tax,{enabled:false});assert.deepEqual(invoice.default_tax_rates,[]);assert.equal(invoice.discounts,'');
  const line=f.calls.find(c=>c.phase==='line').args;
  assert.equal(line.amount,1900);assert.equal(line.currency,'usd');assert.equal(line.discountable,false);assert.deepEqual(line.tax_rates,[]);assert.match(line.description,/120 minutes.*\$9.50\/hour/);assert.equal(line.metadata.owner_obligation_id,f.op.items[0].obligationId);
  assert.deepEqual(phases,['invoice','line:session-today:player-0','finalize','pay']);
  for(const c of f.calls)assert.ok(c.options.idempotencyKey.startsWith(f.op.id+':'));
  const written=f.calls.length;f.pi.status='processing';f.invoice.status='open';assert.equal((await f.gateway.inspect(f.op)).status,'pending');
  f.pi.status='succeeded';f.invoice.status='paid';f.pi.latest_charge.amount_refunded=500;assert.equal((await f.gateway.inspect(f.op)).refundedCents,500);assert.equal(f.calls.length,written);
});
test('unactivated writes, mode mismatch, changed method, unexpected invoice lines and customer credit cannot pay',async()=>{
  const disabled=fixture();await assert.rejects(stripeGateway(disabled.fake,{accountId:'acct_synthetic'}).collect(disabled.op,disabled.s,async(_,run)=>run(),async()=>{}),/not been activated/);assert.equal(disabled.calls.length,0);
  for(const change of [f=>f.customer.livemode=true,f=>f.method.customer='cus_someoneElse',f=>f.customer.invoice_settings.default_payment_method='pm_changed',f=>f.customer.balance=-100]){
    const f=fixture();change(f);await assert.rejects(f.gateway.collect(f.op,f.s,async(_,run)=>run(),async()=>{}));assert.equal(f.calls.length,0);
  }
  const f=fixture();f.lines.push({id:'il_unexpected',amount:100,metadata:{}});await assert.rejects(f.gateway.collect(f.op,f.s,async(_,run)=>run(),async()=>{}),/itemization/);assert.equal(f.calls.filter(c=>c.phase==='pay').length,0);
});
test('Stripe SDK checks the complete signed webhook body and rejects a forged or modified body',async()=>{
  const sdk=new Stripe('synthetic-key-never-used-for-network',{httpClient:Stripe.createFetchHttpClient()}),gateway=stripeGateway(sdk,{cryptoProvider:Stripe.createSubtleCryptoProvider()}),secret='whsec_SyntheticLocalSignatureFixture0123456789';
  const body=JSON.stringify({id:'evt_synthetic_signed',livemode:false,type:'invoice.paid',data:{object:{id:'in_synthetic'}}});
  const signature=sdk.webhooks.generateTestHeaderString({payload:body,secret});
  assert.equal((await gateway.event(body,signature,secret)).id,'evt_synthetic_signed');
  await assert.rejects(gateway.event(body+' ',signature,secret));await assert.rejects(gateway.event(body,signature,'wrong-synthetic-secret'));
  const emptySignature=sdk.webhooks.generateTestHeaderString({payload:body,secret:''});
  await assert.rejects(gateway.event(body,emptySignature,''),/not been configured/);
  let mutated=false;
  const handler=ownerHandler({gateway,webhookSecret:'',origin:'https://20fates.com',service:{stripeEvent:async()=>{mutated=true;}}});
  const response=await handler(new Request('https://example.supabase.co/functions/v1/owner-api/stripe-event',{method:'POST',headers:{'stripe-signature':emptySignature},body}));
  assert.equal(response.status,401);assert.equal(mutated,false);
});

test('tracking history uses only the declared read resources and keeps refunds and fees separate', async () => {
  const s = seedDemo(), calls = [];
  const read = (resource, result) => async args => { calls.push({ resource, args }); return result; };
  const fake = {
    accounts: { retrieve: read('account', { id: 'acct_synthetic' }) },
    paymentIntents: { list: read('payment_intents', { data: [{ id: 'pi_tracking_read', livemode: false, status: 'succeeded', customer: s.payers[0].stripeCustomerId, currency: 'usd', amount_received: 1900, created: Date.parse(DEMO_TIME) / 1000, latest_charge: { amount_refunded: 500, disputed: true, balance_transaction: { fee: 81 } } }], has_more: false }) },
    balanceTransactions: { list: read('balance_transactions', { data: [{ id: 'txn_tracking_fee', amount: -50, currency: 'usd', created: Date.parse(DEMO_TIME) / 1000 }], has_more: false }) }
  };
  const gateway = stripeGateway(fake, { mode: 'test', accountId: 'acct_synthetic', trackingOnly: true, allowWrites: true });
  const receipts = await gateway.history(s, '2026-06-06T23:00:00Z');
  assert.deepEqual(calls.map(c => c.resource), ['account', 'payment_intents', 'balance_transactions']);
  assert.deepEqual(calls[1].args.expand, ['data.latest_charge.balance_transaction']);
  assert.equal(receipts[0].amountCents, 1900); assert.equal(receipts[0].refundedCents, 500); assert.equal(receipts[0].disputed, true); assert.equal(receipts[0].feeCents, 81); assert.equal(receipts[0].payerId, 'payer-0');
  assert.equal(receipts[1].direction, 'fee'); assert.equal(receipts[1].amountCents, 50);
  assert.equal(gateway.allowWrites, false);
});
