import { emptyLedger, validateLedger } from './ledger.mjs';

export function ledgerStore(rpc) {
  async function read() { return await rpc('owner_panel_load', {}) || { revision: -1, body: emptyLedger() }; }
  return {
    read,
    async backup() {
      const backup = await rpc('owner_panel_backup', {});
      if (backup?.ledger === null && Array.isArray(backup.fences) && backup.fences.length === 0) return { ...backup, ledger: { revision: -1, body: emptyLedger() } };
      validateLedger(backup?.ledger?.body); return backup;
    },
    async due() { return await rpc('owner_panel_due', {}); },
    async transact(fn) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const snapshot = await read(), body = structuredClone(snapshot.body);
        const result = await fn(body); validateLedger(body);
        if (await rpc('owner_panel_cas', { expected_revision: snapshot.revision, next_body: body })) return { body, result, revision: snapshot.revision + 1 };
      }
      throw new Error('Another update is in progress. Refresh and review the latest records.');
    },
    async fence(operationId, phase, digest) { return await rpc('owner_panel_effect_once', { op_id: operationId, effect_phase: phase, effect_digest: digest }); }
  };
}
