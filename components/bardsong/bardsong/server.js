import { createServer } from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SceneDirector } from './lib/director.js';
import { asrStatus, transcribeFloat32 } from './lib/asr.js';
import { LibraryStore, publicSettings, safeImportName, TRACK_KINDS } from './lib/library.js';
import { SCENES, isScene } from './lib/scenes.js';
import { DiscordManager } from './lib/discord-manager.js';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appRoot, '..');
const publicRoot = path.join(appRoot, 'public');
const MAX_JSON = 2 * 1024 * 1024;
const MAX_AUDIO = 200 * 1024 * 1024;
const MAX_TRANSCRIBE = 16_000 * 60 * 4;
const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i;

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.wav', 'audio/wav'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'],
  ['.aac', 'audio/aac']
]);

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
}

function sendJson(res, status, value, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function sendText(res, status, value) {
  const body = Buffer.from(String(value));
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

async function readBuffer(req, limit) {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw Object.assign(new Error('Request is too large'), { statusCode: 413 });
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw Object.assign(new Error('Request is too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const data = await readBuffer(req, MAX_JSON);
  try {
    return data.length ? JSON.parse(data.toString('utf8')) : {};
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 });
  }
}

async function serveFile(req, res, filename, { downloadName = null } = {}) {
  let stat;
  try {
    stat = await fs.stat(filename);
  } catch {
    return sendJson(res, 404, { error: 'Audio file is missing' });
  }
  if (!stat.isFile() || stat.size === 0) return sendJson(res, 422, { error: 'Audio file is empty or invalid' });

  const type = MIME.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream';
  const range = req.headers.range;
  const disposition = downloadName ? `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}` : null;
  if (!range) {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      ...(disposition ? { 'Content-Disposition': disposition } : {})
    });
    createReadStream(filename).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    res.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= stat.size) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    'Content-Type': type,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes'
  });
  createReadStream(filename, { start, end }).pipe(res);
}

export async function createBardsongServer(options = {}) {
  const root = options.appRoot ?? appRoot;
  const store = options.store ?? new LibraryStore({ appRoot: root, repoRoot: options.repoRoot ?? path.resolve(root, '..') });
  await store.load();
  const director = options.director ?? new SceneDirector();
  const sessionToken = randomUUID();
  const discord = options.discordFactory
    ? options.discordFactory({ appRoot: root, store, director })
    : options.discord ?? new DiscordManager({ appRoot: root, store, director });

  const server = createServer(async (req, res) => {
    securityHeaders(res);
    try {
      const host = String(req.headers.host ?? '');
      if (!LOCAL_HOST.test(host)) return sendJson(res, 421, { error: 'Bardsong only accepts localhost requests' });
      const origin = req.headers.origin;
      if (origin) {
        let sameOrigin = false;
        try {
          const parsedOrigin = new URL(origin);
          sameOrigin = parsedOrigin.protocol === 'http:' && parsedOrigin.host.toLowerCase() === host.toLowerCase();
        } catch {
          sameOrigin = false;
        }
        if (!sameOrigin) return sendJson(res, 403, { error: 'Cross-origin requests are not allowed' });
      }

      let requestUrl;
      let pathname;
      try {
        requestUrl = new URL(req.url, `http://${host}`);
        pathname = decodeURIComponent(requestUrl.pathname);
      } catch {
        return sendJson(res, 400, { error: 'Malformed request URL' });
      }

      if (req.method === 'GET' && pathname === '/api/session') {
        return sendJson(res, 200, { token: sessionToken });
      }

      const mutation = !['GET', 'HEAD'].includes(req.method);
      if (mutation && req.headers['x-bardsong-token'] !== sessionToken) {
        return sendJson(res, 403, { error: 'Missing or invalid local session token' });
      }

      if (req.method === 'GET' && pathname === '/api/state') {
        return sendJson(res, 200, {
          app: { name: 'Bardsong', version: '0.1.0', localOnly: true },
          scenes: SCENES,
          settings: publicSettings(store.getSettings()),
          director: director.snapshot(),
          asr: await asrStatus(),
          discord: await discord.publicStatus()
        });
      }

      if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, localOnly: true });
      }

      if (req.method === 'POST' && pathname === '/api/infer') {
        const body = await readJson(req);
        const result = director.ingest(String(body.text ?? ''));
        if (result.changed) await discord.cueScene(result.state.currentScene);
        return sendJson(res, 200, result);
      }

      if (req.method === 'POST' && pathname === '/api/director') {
        const body = await readJson(req);
        let state;
        if (body.action === 'override') {
          if (!isScene(body.scene)) throw Object.assign(new Error('Unknown scene'), { statusCode: 400 });
          state = director.override(body.scene).state;
          await discord.cueScene(state.currentScene);
        } else if (body.action === 'hold') state = director.hold();
        else if (body.action === 'resume') state = director.resume();
        else if (body.action === 'start') {
          state = director.start();
          await discord.cueScene(state.currentScene);
        } else if (body.action === 'stop') {
          state = director.stop();
          discord.stopAudio();
        }
        else throw Object.assign(new Error('Unknown director action'), { statusCode: 400 });
        return sendJson(res, 200, { state });
      }

      if (req.method === 'PATCH' && pathname === '/api/settings') {
        const body = await readJson(req);
        const patch = {};
        for (const key of ['musicVolume', 'ambienceVolume', 'transitionSeconds', 'allowUnreviewed']) {
          if (Object.hasOwn(body, key)) patch[key] = body[key];
        }
        const settings = await store.updatePreferences(patch);
        discord.updateLevels();
        await discord.cueScene(director.currentScene);
        return sendJson(res, 200, { settings: publicSettings(settings) });
      }

      if (req.method === 'GET' && pathname === '/api/settings/export') {
        const body = Buffer.from(`${JSON.stringify(publicSettings(store.getSettings()), null, 2)}\n`);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': body.length,
          'Content-Disposition': 'attachment; filename="bardsong-settings.json"',
          'Cache-Control': 'no-store'
        });
        res.end(body);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/settings/restore') {
        const body = await readJson(req);
        const settings = await store.restore(body);
        discord.updateLevels();
        await discord.cueScene(director.currentScene);
        return sendJson(res, 200, { settings: publicSettings(settings) });
      }

      if (req.method === 'POST' && pathname === '/api/library/import') {
        const rawName = requestUrl.searchParams.get('filename') ?? 'track';
        const kind = requestUrl.searchParams.get('kind') ?? 'music';
        if (!TRACK_KINDS.has(kind)) throw Object.assign(new Error('Track kind must be music or ambience'), { statusCode: 400 });
        const filename = safeImportName(rawName);
        const bytes = await readBuffer(req, MAX_AUDIO);
        if (bytes.length < 64) throw Object.assign(new Error('Audio file is empty or too small'), { statusCode: 422 });
        const destination = path.join(store.libraryDir, filename);
        const temp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
        await fs.writeFile(temp, bytes, { flag: 'wx' });
        await fs.rename(temp, destination);
        try {
          const track = await store.addImportedTrack({
            filename,
            displayName: path.basename(rawName, path.extname(rawName)),
            kind
          });
          return sendJson(res, 201, { track });
        } catch (error) {
          await fs.unlink(destination).catch(() => {});
          throw error;
        }
      }

      const trackMatch = /^\/api\/tracks\/([^/]+)$/.exec(pathname);
      if (req.method === 'PATCH' && trackMatch) {
        const body = await readJson(req);
        const track = await store.updateTrack(trackMatch[1], {
          name: body.name,
          kind: body.kind,
          status: body.status,
          scenes: body.scenes
        });
        await discord.cueScene(director.currentScene);
        return sendJson(res, 200, { track });
      }

      if (req.method === 'GET' && pathname === '/api/discord/status') {
        return sendJson(res, 200, await discord.publicStatus());
      }

      if (req.method === 'POST' && pathname === '/api/discord/connect') {
        return sendJson(res, 200, await discord.connect());
      }

      if (req.method === 'POST' && pathname === '/api/discord/disconnect') {
        return sendJson(res, 200, await discord.disconnect());
      }

      if (req.method === 'POST' && pathname === '/api/discord/listen') {
        const body = await readJson(req);
        discord.setListening(Boolean(body.enabled));
        return sendJson(res, 200, await discord.publicStatus());
      }

      if (req.method === 'POST' && pathname === '/api/discord/mute') {
        const body = await readJson(req);
        discord.setMuted(Boolean(body.muted));
        return sendJson(res, 200, await discord.publicStatus());
      }

      if (req.method === 'POST' && pathname === '/api/runtime/shutdown') {
        if (typeof options.onShutdown !== 'function') {
          return sendJson(res, 409, { error: 'This runtime is not managed by Familiar' });
        }
        sendJson(res, 202, { stopping: true });
        setImmediate(() => Promise.resolve(options.onShutdown()).catch(() => {}));
        return;
      }

      const audioMatch = /^\/api\/tracks\/([^/]+)\/audio$/.exec(pathname);
      if (req.method === 'GET' && audioMatch) {
        const track = store.trackById(audioMatch[1]);
        if (!track) return sendJson(res, 404, { error: 'Track not found' });
        return serveFile(req, res, store.resolveTrackPath(track));
      }

      if (req.method === 'GET' && pathname === '/api/asr') {
        return sendJson(res, 200, await asrStatus());
      }

      if (req.method === 'POST' && pathname === '/api/transcribe') {
        const bytes = await readBuffer(req, MAX_TRANSCRIBE);
        if (bytes.length % 4 !== 0) throw Object.assign(new Error('Expected 32-bit float audio'), { statusCode: 400 });
        const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
        try {
          const text = await transcribeFloat32(samples);
          return sendJson(res, 200, { text });
        } finally {
          samples.fill(0);
          bytes.fill(0);
        }
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });

      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const filename = path.resolve(publicRoot, relative);
      const safeRelative = path.relative(publicRoot, filename);
      if (safeRelative.startsWith('..') || path.isAbsolute(safeRelative)) return sendJson(res, 404, { error: 'Not found' });
      let stat;
      try {
        stat = await fs.stat(filename);
      } catch {
        return sendJson(res, 404, { error: 'Not found' });
      }
      if (!stat.isFile()) return sendJson(res, 404, { error: 'Not found' });
      const type = MIME.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream';
      const body = req.method === 'HEAD' ? null : await fs.readFile(filename);
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache'
      });
      res.end(body);
    } catch (error) {
      const message = error?.message || 'Unexpected local server error';
      const status = error?.statusCode ?? (/not prepared/i.test(message) ? 503 : 500);
      if (!res.headersSent) sendJson(res, status, { error: message });
      else res.destroy(error);
    }
  });

  server.bardsong = { store, director, discord };
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.BARDSONG_PORT ?? 4317);
  const server = await createBardsongServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Bardsong is ready at http://127.0.0.1:${port}`);
    console.log('Audio and transcripts remain on this PC. Press Ctrl+C to stop.');
  });
  const shutDown = async () => {
    await server.bardsong.discord.disconnect().catch(() => {});
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutDown);
  process.once('SIGTERM', shutDown);
}
