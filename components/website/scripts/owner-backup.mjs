// Private recovery utility. It never connects to Stripe or writes a live DB.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { decryptBackup, prepareRestore } from '../supabase/functions/_shared/backup.mjs';
import { validateLedger, insist } from '../supabase/functions/_shared/ledger.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
export function restoreSql(data) {
  const safe = prepareRestore(data);
  return `-- PRIVATE ROSTER AND FINANCIAL DATA. Do not commit or publish.\n` +
    `-- Apply the schema migration to a NEW EMPTY database first.\n` +
    `-- Every restored collection is held; this never invokes a provider.\nbegin;\n` +
    `do $$ begin\nif exists (select 1 from owner_private.ledger) or exists (select 1 from owner_private.effect_fences) then\nraise exception 'Restore requires empty owner tables; existing data was not changed';\nend if;\nend $$;\n` +
    `insert into owner_private.ledger(singleton,revision,body) values(true,0,${quote(JSON.stringify(safe.ledger.body))}::jsonb);\n` +
    safe.fences.map(f => `insert into owner_private.effect_fences(operation_id,phase,digest,started_at) values(${quote(f.operation_id)},${quote(f.phase)},${quote(f.digest)},${quote(f.started_at)}::timestamptz);\n`).join('') +
    `commit;\n`;
}
export async function checkRestore(data) {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(await readFile(new URL('../supabase/migrations/202609040001_owner_panel.sql', import.meta.url), 'utf8'));
    await db.exec(restoreSql(data));
    const restored = (await db.query('select public.owner_panel_backup() as result')).rows[0].result;
    validateLedger(restored.ledger.body);
    const wanted = prepareRestore(data);
    insist(isDeepStrictEqual(restored.ledger.body, wanted.ledger.body), 'Recovery ledger differs after database restore');
    insist(restored.fences.length === wanted.fences.length, 'Recovery lost collection fences');
    for (const f of wanted.fences) {
      const denied = (await db.query('select public.owner_panel_effect_once($1,$2,$3) as started', [f.operation_id, f.phase, f.digest])).rows[0].started;
      insist(denied === false, 'A recovered provider action could replay');
    }
    await db.exec('set role authenticated;');
    let denied = false; try { await db.query('select public.owner_panel_load()'); } catch { denied = true; }
    insist(denied, 'Restored database is not private');
    return { verified: true, payers: restored.ledger.body.payers.length, sessions: restored.ledger.body.sessions.length, permanentFences: restored.fences.length, collectionEnabled: false, recoveryHold: true };
  } finally { await db.close(); }
}
async function main() {
  const [command, file, option] = process.argv.slice(2);
  insist(command === 'check' && file, 'Use: npm run owner:restore-check -- check PATH [--write-restore-sql]');
  insist(!option || option === '--write-restore-sql', 'Unknown recovery option');
  const envelope = JSON.parse(await readFile(resolve(file), 'utf8'));
  const data = envelope.format === '20fates-backup/1' ? envelope : await decryptBackup(envelope, process.env.OWNER_BACKUP_KEY || '');
  const result = await checkRestore(data);
  if (option) {
    const folder = resolve(root, '.owner-private'), target = resolve(folder, `restore-${Date.now()}.private.sql`), part = relative(folder, target);
    insist(part && !part.startsWith('..') && !isAbsolute(part), 'Invalid private recovery location');
    await mkdir(folder, { recursive: true }); await writeFile(target, restoreSql(data), { flag: 'wx', mode: 0o600 });
    result.privateSql = target;
  }
  process.stdout.write(JSON.stringify(result) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  process.stderr.write('Recovery check failed. No live database or payment was changed. Check the file, recovery key and documented format.\n'); process.exitCode = 1;
});
