import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { encryptBackup, decryptBackup, prepareRestore } from '../supabase/functions/_shared/backup.mjs';
import { ledgerStore } from '../supabase/functions/_shared/store.mjs';

const migration = await readFile(new URL('../supabase/migrations/202609040001_owner_panel.sql', import.meta.url), 'utf8');
const database = async () => {
  const db = new PGlite(); await db.exec('create role anon; create role authenticated; create role service_role;'); await db.exec(migration);
  const rpc = async (name, args) => (await db.query(`select public.${name}(${Object.keys(args).map((_, index) => '$' + (index + 1)).join(',')}) as result`, Object.values(args))).rows[0].result;
  return { db, store: ledgerStore(rpc) };
};

test('empty database backup is encrypted, restored, and does not create a source ledger row', async () => {
  const source = await database(), target = await database();
  try {
    assert.equal((await source.db.query('select count(*)::int as count from owner_private.ledger')).rows[0].count, 0);
    const backup = await source.store.backup();
    assert.equal(backup.ledger.revision, -1); assert.deepEqual(backup.fences, []);
    assert.equal((await source.db.query('select count(*)::int as count from owner_private.ledger')).rows[0].count, 0);
    const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    const decoded = await decryptBackup(await encryptBackup(backup, secret), secret);
    assert.deepEqual(decoded, backup);
    const restored = prepareRestore(decoded);
    await target.store.transact(body => Object.assign(body, restored.ledger.body));
    const loaded = await target.store.read();
    assert.equal(loaded.revision, 0); assert.deepEqual(loaded.body, restored.ledger.body);
    await assert.rejects(ledgerStore(async () => ({ ...backup, ledger: { revision: 0, body: { schema: 1 } } })).backup(), /Invalid ledger/);
    await assert.rejects(ledgerStore(async () => ({ ...backup, ledger: null, fences: [{ operation_id: 'missing-history' }] })).backup());
    await assert.rejects(ledgerStore(async () => ({ ...backup, ledger: null, fences: null })).backup());
  } finally { await source.db.close(); await target.db.close(); }
});
