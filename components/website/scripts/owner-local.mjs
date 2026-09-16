import { createServer } from 'vite';
import { resolve } from 'node:path';
import { simulationRuntime } from './owner-simulation.mjs';
import { ownerHandler } from '../supabase/functions/_shared/http.mjs';
const runtime = await simulationRuntime({ directory: resolve('.owner-local/database') });
const tasks = new Set();
const handler = ownerHandler({ service: runtime.service, store: runtime.store, gateway: runtime.gateway, origin: 'http://127.0.0.1:5179', authorize: async token => { if (token !== 'local-proof-owner') throw new Error('Unauthorized'); return 'synthetic owner'; }, background: promise => { tasks.add(promise); promise.finally(() => tasks.delete(promise)); } });
const server = await createServer({ server: { host: '127.0.0.1', port: 5179, strictPort: true }, plugins: [{ name: 'local-owner-simulation', configureServer(vite) {
  vite.middlewares.use('/__owner/api', async (req, res) => {
    try {
      if (req.headers.host !== '127.0.0.1:5179') { res.writeHead(403); res.end(); return; }
      let size = 0; const parts = []; for await (const part of req) { size += part.length; if (size > 2000000) throw new Error('Too large'); parts.push(part); }
      const request = new Request('http://127.0.0.1:5179/__owner/api', { method: req.method, headers: req.headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Buffer.concat(parts) } : {}) });
      const response = await handler(request); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"Local request failed"}'); }
  });
} }] });
await server.listen();
console.log('Local fictional owner panel: http://127.0.0.1:5179/owner/');
console.log('No external provider calls or live payments. Stop this terminal to close the local rehearsal.');
process.on('SIGINT', async () => { await Promise.allSettled([...tasks]); await server.close(); await runtime.db.close(); process.exit(0); });
