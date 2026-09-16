import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createBardsongServer } from '../server.js';

async function fixtureServer(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bardsong-server-'));
  const appRoot = path.join(root, 'app');
  const repoRoot = path.join(root, 'repo');
  const audioDir = path.join(repoRoot, 'outputs', 'roll20-loops');
  await fs.mkdir(audioDir, { recursive: true });
  await fs.writeFile(path.join(audioDir, 'wandering-vale-loop.ogg'), Buffer.alloc(1_024, 7));
  const server = await createBardsongServer({ appRoot, repoRoot, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(async () => {
    await server.bardsong.discord.disconnect();
    await new Promise((resolve) => server.close(resolve));
    if (path.resolve(root).startsWith(path.resolve(os.tmpdir()))) await fs.rm(root, { recursive: true, force: true });
  });
  return { server, port };
}

function request(port, { method = 'GET', requestPath = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: { Host: `127.0.0.1:${port}`, ...headers }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('host, origin, and request-token boundaries reject hostile control', async (t) => {
  const { server, port } = await fixtureServer(t);
  const hostileHost = await request(port, { requestPath: '/api/state', headers: { Host: 'untrusted.example' } });
  assert.equal(hostileHost.status, 421);

  const crossOriginState = await request(port, { requestPath: '/api/state', headers: { Origin: 'https://untrusted.example' } });
  assert.equal(crossOriginState.status, 403);

  const session = JSON.parse((await request(port, { requestPath: '/api/session' })).body);
  assert.match(session.token, /^[0-9a-f-]{36}$/i);
  const mutations = [
    '/api/director',
    '/api/settings',
    '/api/settings/restore',
    '/api/library/import?filename=test.ogg&kind=music',
    '/api/transcribe',
    '/api/discord/connect',
    '/api/discord/disconnect',
    '/api/discord/listen',
    '/api/discord/mute',
    '/api/runtime/shutdown'
  ];
  for (const requestPath of mutations) {
    const result = await request(port, {
      method: requestPath === '/api/settings' ? 'PATCH' : 'POST',
      requestPath,
      headers: {
        Origin: 'https://untrusted.example',
        'Content-Type': 'text/plain',
        'X-Bardsong-Token': session.token
      },
      body: '{}'
    });
    assert.equal(result.status, 403, requestPath);
  }
  assert.equal(server.bardsong.director.active, true);

  const tokenless = await request(port, {
    method: 'POST',
    requestPath: '/api/director',
    headers: { 'Content-Type': 'text/plain' },
    body: '{"action":"stop"}'
  });
  assert.equal(tokenless.status, 403);
  assert.equal(server.bardsong.director.active, true);

  const accepted = await request(port, {
    method: 'POST',
    requestPath: '/api/director',
    headers: { 'Content-Type': 'application/json', 'X-Bardsong-Token': session.token },
    body: '{"action":"stop"}'
  });
  assert.equal(accepted.status, 200);
  assert.equal(server.bardsong.director.active, false);

  const manual = await request(port, {
    method: 'POST',
    requestPath: '/api/director',
    headers: { 'Content-Type': 'application/json', 'X-Bardsong-Token': session.token },
    body: '{"action":"override","scene":"travel"}'
  });
  const manualState = JSON.parse(manual.body).state;
  assert.equal(manualState.currentScene, 'travel');
  assert.equal(manualState.held, true);
  assert.equal(manualState.state, undefined, 'API returns one state object, not a nested transition wrapper');
});

test('managed shutdown requires the local token and invokes its owner after responding', async (t) => {
  let called = false;
  const { port } = await fixtureServer(t, { onShutdown: async () => { called = true; } });
  const denied = await request(port, { method: 'POST', requestPath: '/api/runtime/shutdown', body: '{}' });
  assert.equal(denied.status, 403);
  const session = JSON.parse((await request(port, { requestPath: '/api/session' })).body);
  const accepted = await request(port, {
    method: 'POST',
    requestPath: '/api/runtime/shutdown',
    headers: { 'X-Bardsong-Token': session.token },
    body: '{}'
  });
  assert.equal(accepted.status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(called, true);
});

test('malformed URLs return a client error and leave the server healthy', async (t) => {
  const { port } = await fixtureServer(t);
  const malformed = await request(port, { requestPath: '/%E0%A4%A' });
  assert.equal(malformed.status, 400);
  const health = await request(port, { requestPath: '/api/health' });
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).ok, true);
});

test('track media supports byte ranges and missing files report clearly', async (t) => {
  const { port } = await fixtureServer(t);
  const ranged = await request(port, {
    requestPath: '/api/tracks/wandering-vale-loop/audio',
    headers: { Range: 'bytes=10-19' }
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.body.length, 10);
  assert.equal(ranged.headers['content-range'], 'bytes 10-19/1024');
  const missing = await request(port, { requestPath: '/api/tracks/no-such-track/audio' });
  assert.equal(missing.status, 404);
});

test('local library import and scene assignment persist', async (t) => {
  const { port, server } = await fixtureServer(t);
  const session = JSON.parse((await request(port, { requestPath: '/api/session' })).body);
  const audio = Buffer.alloc(256, 3);
  const importedResponse = await request(port, {
    method: 'POST',
    requestPath: '/api/library/import?filename=Owned%20Cue.wav&kind=music',
    headers: { 'Content-Type': 'audio/wav', 'X-Bardsong-Token': session.token },
    body: audio
  });
  assert.equal(importedResponse.status, 201);
  const imported = JSON.parse(importedResponse.body).track;
  assert.equal(imported.status, 'unreviewed');
  assert.deepEqual(imported.scenes, []);

  const updatedResponse = await request(port, {
    method: 'PATCH',
    requestPath: `/api/tracks/${imported.id}`,
    headers: { 'Content-Type': 'application/json', 'X-Bardsong-Token': session.token },
    body: JSON.stringify({ name: imported.name, kind: 'music', status: 'accepted', scenes: ['travel'] })
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal(JSON.parse(updatedResponse.body).track.status, 'accepted');
  assert.deepEqual(server.bardsong.store.trackById(imported.id).scenes, ['travel']);

  const media = await request(port, { requestPath: `/api/tracks/${imported.id}/audio` });
  assert.equal(media.status, 200);
  assert.deepEqual(media.body, audio);
  const saved = JSON.parse(await fs.readFile(server.bardsong.store.settingsPath, 'utf8'));
  assert.equal(saved.tracks.find((track) => track.id === imported.id).status, 'accepted');
});
