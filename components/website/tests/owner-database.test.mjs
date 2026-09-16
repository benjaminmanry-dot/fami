import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { ledgerStore } from '../supabase/functions/_shared/store.mjs';
import { emptyLedger } from '../supabase/functions/_shared/ledger.mjs';
const migration = await readFile(new URL('../supabase/migrations/202609040001_owner_panel.sql', import.meta.url), 'utf8');

test('actual PostgreSQL permissions, concurrent CAS, immutable history and permanent effect fences', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(migration);
    const rpc = async (name, args) => (await db.query(`select public.${name}(${Object.keys(args).map((_, i) => '$' + (i + 1)).join(',')}) as result`, Object.values(args))).rows[0].result;
    const store = ledgerStore(rpc); await store.transact(s => { s.settings.example = true; });
    const before = await store.read();
    const [a, b] = await Promise.all([rpc('owner_panel_cas', { expected_revision: before.revision, next_body: before.body }), rpc('owner_panel_cas', { expected_revision: before.revision, next_body: before.body })]);
    assert.equal(Number(a) + Number(b), 1);
    assert.equal(await store.fence('permanent-operation', 'pay', 'digest'), true);
    assert.equal(await store.fence('permanent-operation', 'pay', 'changed'), false);
    await store.transact(s => { s.audit.push({ id: 'audit:1', type: 'approved', actor: 'owner' }); });
    await assert.rejects(store.transact(s => { s.audit.length = 0; }), /Audit history changed/);
    await db.exec('set role anon;');
    await assert.rejects(db.query('select public.owner_panel_load()'), /permission denied/);
    await assert.rejects(db.query('select * from owner_private.ledger'), /permission denied/);
    await db.exec('reset role; set role authenticated;');
    await assert.rejects(db.query('select public.owner_panel_cas(0, $1)', [emptyLedger()]), /permission denied/);
    await assert.rejects(db.query("select public.owner_panel_effect_once('x','pay','d')"), /permission denied/);
    await db.exec('reset role; set role service_role;');
    assert.ok((await db.query('select public.owner_panel_load() as result')).rows[0].result.body);
  } finally { await db.close(); }
});
