// @vitest-environment node
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket as WsWebSocket } from 'ws';

import { LoginRateLimiter, SESSION_COOKIE, deriveSessionToken } from './browser-access-auth';
import {
  CONNECTIONS_PATH,
  LOGIN_PATH,
  createBrowserAccessServer,
  runtimeConfigSource,
  type BrowserAccessServerDeps,
  type LoginPageText,
} from './browser-access-server';

const nodeRequire = createRequire(import.meta.url);
const { WebSocket } = nodeRequire('ws') as { WebSocket: typeof WsWebSocket };

const ACCESS_KEY = 'test-access-key-0123456789abcdefghijklmnopqrstuv';
const COOKIE = `${SESSION_COOKIE}=${deriveSessionToken(ACCESS_KEY)}`;
const TEXT: LoginPageText = {
  lang: 'en',
  title: 'Sign in to Intent',
  prompt: 'Enter the access key',
  keyLabel: 'Access key',
  submit: 'Sign in',
  invalidKey: 'That access key is not correct.',
  tooManyAttempts: 'Too many attempts.',
};
const silentLog = { info() {}, warn() {} };
const cleanups: Array<() => unknown> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeWebRoot(dir: string): string {
  const root = path.join(dir, 'web');
  fs.mkdirSync(path.join(root, 'app', 'immutable'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>app</title>');
  fs.writeFileSync(
    path.join(root, 'app', 'immutable', 'entry.js'),
    'export const x = 1;\n'.repeat(200),
  );
  fs.writeFileSync(path.join(root, 'favicon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'top secret');
  return root;
}

async function startFakeDaemon(dir: string): Promise<string> {
  const socketPath = path.join(dir, 'd.sock');
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const request = JSON.parse(buffer.slice(0, newline)) as { id: number };
        buffer = buffer.slice(newline + 1);
        socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: 'pong' })}\n`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return socketPath;
}

interface Started {
  port: number;
  dir: string;
  opened: string[];
  listed: string[];
  server: ReturnType<typeof createBrowserAccessServer>;
}

async function start(overrides: Partial<BrowserAccessServerDeps> = {}): Promise<Started> {
  const dir = tempDir();
  const webRoot = makeWebRoot(dir);
  const daemon = await startFakeDaemon(dir);
  const opened: string[] = [];
  const listed: string[] = [];
  const server = createBrowserAccessServer({
    webRoot,
    getAccessKey: () => ACCESS_KEY,
    listConnections: async (backendId) => {
      listed.push(backendId);
      return { connections: [{ id: 'remote-1', label: 'Studio' }], windowBackendId: backendId };
    },
    openUpstream: async (id) => {
      opened.push(id);
      return net.connect(daemon);
    },
    loginText: () => TEXT,
    log: silentLog,
    ...overrides,
  });
  const port = await server.listen(0);
  cleanups.push(() => server.close());
  return { port, dir, opened, listed, server };
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function request(
  port: number,
  {
    method = 'GET',
    path: requestPath = '/',
    headers = {},
    body,
  }: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: requestPath,
        headers: { host: `127.0.0.1:${port}`, ...headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function connectWs(
  port: number,
  id: string,
  headers: Record<string, string>,
): Promise<{ ws: WsWebSocket | null; status: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/intentd/ws/${id}`, { headers });
    cleanups.push(() => ws.terminate());
    ws.once('open', () => resolve({ ws, status: 101 }));
    ws.once('unexpected-response', (_req, response) => {
      resolve({ ws: null, status: response.statusCode ?? 0 });
      response.resume();
    });
    ws.once('error', () => resolve({ ws: null, status: 0 }));
  });
}

function nextMessage(ws: WsWebSocket): Promise<string> {
  return new Promise((resolve) => ws.once('message', (data) => resolve(String(data))));
}

const sameOrigin = (port: number) => ({ origin: `http://127.0.0.1:${port}`, cookie: COOKIE });

describe('Browser access server: access control', () => {
  it('rejects non-loopback Host headers (DNS rebinding)', async () => {
    const { port } = await start();
    const reply = await request(port, { headers: { host: 'rebound.example', cookie: COOKIE } });
    expect(reply.status).toBe(403);
  });

  it('serves a front-end that forwards its public host (tailscale serve)', async () => {
    const { port } = await start();
    const reply = await request(port, {
      headers: {
        host: 'box.tailnet.ts.net:8443',
        'x-forwarded-host': 'box.tailnet.ts.net:8443',
        'x-forwarded-proto': 'https',
        cookie: COOKIE,
      },
    });
    expect(reply.status).toBe(200);
  });

  it('shows the login page to signed-out navigations and 401s other requests', async () => {
    const { port } = await start();
    const page = await request(port, { headers: { accept: 'text/html' } });
    expect(page.status).toBe(401);
    expect(page.body.toString()).toContain('Sign in to Intent');
    expect(page.headers['set-cookie']).toBeUndefined();
    const script = await request(port, { path: '/app/immutable/entry.js' });
    expect(script.status).toBe(401);
    expect(script.body.length).toBe(0);
  });

  it('signs in with ?key=, drops the key from the URL and sets a session cookie', async () => {
    const { port } = await start();
    const reply = await request(port, { path: `/workspace/a?backend=remote-1&key=${ACCESS_KEY}` });
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe('/workspace/a?backend=remote-1');
    expect(String(reply.headers['set-cookie'])).toContain(COOKIE);
    expect(String(reply.headers['set-cookie'])).not.toContain('Secure');
  });

  it('never redirects off-site after a key login', async () => {
    const { port } = await start();
    for (const attack of [
      '//evil.example/',
      '/\\evil.example',
      '/%5Cevil.example',
      '/%2F%2Fevil.example',
    ]) {
      const reply = await request(port, { path: `${attack}?key=${ACCESS_KEY}` });
      expect(reply.status).toBe(303);
      const location = String(reply.headers.location);
      expect(location.startsWith('/')).toBe(true);
      expect(new URL(location, 'https://box.ts.net').origin).toBe('https://box.ts.net');
    }
  });

  it('marks the cookie Secure behind an https front-end', async () => {
    const { port } = await start();
    const reply = await request(port, {
      path: `/?key=${ACCESS_KEY}`,
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'box.ts.net' },
    });
    expect(String(reply.headers['set-cookie'])).toContain('Secure');
  });

  it('signs in through the login form and rejects a wrong key', async () => {
    const { port } = await start();
    const wrong = await request(port, {
      method: 'POST',
      path: LOGIN_PATH,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'key=nope',
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.toString()).toContain('That access key is not correct.');
    const right = await request(port, {
      method: 'POST',
      path: LOGIN_PATH,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `key=${encodeURIComponent(ACCESS_KEY)}`,
    });
    expect(right.status).toBe(303);
    expect(String(right.headers['set-cookie'])).toContain(COOKIE);
  });

  it('rate-limits repeated wrong keys, even before checking a correct one', async () => {
    const { port } = await start({ rateLimiter: new LoginRateLimiter(2, 60_000) });
    await request(port, { path: '/?key=bad1' });
    await request(port, { path: '/?key=bad2' });
    const blocked = await request(port, { path: `/?key=${ACCESS_KEY}` });
    expect(blocked.status).toBe(429);
    expect(blocked.body.toString()).toContain('Too many attempts.');
  });

  it('escapes login text', async () => {
    const { port } = await start({ loginText: () => ({ ...TEXT, title: '<script>x</script>' }) });
    const page = await request(port, { headers: { accept: 'text/html' } });
    expect(page.body.toString()).not.toContain('<script>x');
  });

  it('sends hardening headers', async () => {
    const { port } = await start();
    const reply = await request(port, { headers: { cookie: COOKIE } });
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(reply.headers['x-frame-options']).toBe('DENY');
    expect(reply.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(reply.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('Browser access server: serving', () => {
  it('serves index, immutable assets (gzipped) and SPA routes for navigations only', async () => {
    const { port, dir } = await start();
    const index = await request(port, { headers: { cookie: COOKIE } });
    expect(index.status).toBe(200);
    expect(index.headers['cache-control']).toBe('no-cache');
    const asset = await request(port, {
      path: '/app/immutable/entry.js',
      headers: { cookie: COOKIE, 'accept-encoding': 'gzip' },
    });
    expect(asset.headers['cache-control']).toContain('immutable');
    expect(asset.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(asset.body).toString()).toBe(
      fs.readFileSync(path.join(dir, 'web', 'app', 'immutable', 'entry.js'), 'utf8'),
    );
    const route = await request(port, {
      path: '/workspace/abc',
      headers: { cookie: COOKIE, accept: 'text/html' },
    });
    expect(route.body.toString()).toContain('<title>app</title>');
    const missing = await request(port, {
      path: '/@vite/client',
      headers: { cookie: COOKIE, accept: '*/*' },
    });
    expect(missing.status).toBe(404);
  });

  it('never serves files outside the web root', async () => {
    const { port } = await start();
    for (const requestPath of [
      '/..%2Fsecret.txt',
      '/%2e%2e/secret.txt',
      '/app/..%2F..%2Fsecret.txt',
    ]) {
      const reply = await request(port, { path: requestPath, headers: { cookie: COOKIE } });
      expect(reply.body.toString()).not.toContain('top secret');
    }
  });

  it('rejects unsupported methods and malformed paths', async () => {
    const { port } = await start();
    expect((await request(port, { method: 'POST', headers: { cookie: COOKIE } })).status).toBe(405);
    expect((await request(port, { path: '/%E0%A4%A', headers: { cookie: COOKIE } })).status).toBe(
      400,
    );
  });

  it('lists connections for the requested backend and validates the id', async () => {
    const { port, listed } = await start();
    const reply = await request(port, {
      path: `${CONNECTIONS_PATH}?backend=remote-1`,
      headers: { cookie: COOKIE },
    });
    expect(reply.status).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(reply.body.toString())).toMatchObject({ windowBackendId: 'remote-1' });
    expect(listed).toEqual(['remote-1']);
    const bad = await request(port, {
      path: `${CONNECTIONS_PATH}?backend=..%2Fx`,
      headers: { cookie: COOKIE },
    });
    expect(bad.status).toBe(400);
  });

  it('serves a runtime config that binds the tab to its backend', async () => {
    const { port } = await start();
    const reply = await request(port, { path: '/runtime-config.js', headers: { cookie: COOKIE } });
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.body.toString()).toBe(runtimeConfigSource());
  });
});

describe('runtimeConfigSource', () => {
  function evaluate(search: string, stored: Record<string, string> = {}) {
    const storage = new Map(Object.entries(stored));
    const context = {
      location: { search },
      URLSearchParams,
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      globalThis: {} as Record<string, unknown>,
    };
    vm.runInNewContext(runtimeConfigSource(), context);
    return {
      config: context.globalThis.__INTENT_RUNTIME_CONFIG__ as Record<string, string>,
      storage,
    };
  }

  it('defaults to the local daemon', () => {
    expect(evaluate('').config).toEqual({
      intentdWsUrl: '/intentd/ws/local',
      backendId: 'local',
      connectionsUrl: CONNECTIONS_PATH,
    });
  });

  it('binds to ?backend= and remembers it for reloads', () => {
    const first = evaluate('?backend=remote-1');
    expect(first.config.intentdWsUrl).toBe('/intentd/ws/remote-1');
    const stored = Object.fromEntries(first.storage);
    expect(evaluate('', stored).config.backendId).toBe('remote-1');
  });

  it('ignores invalid backend ids', () => {
    expect(evaluate('?backend=../x').config.backendId).toBe('local');
  });
});

describe('Browser access server: WebSocket bridge', () => {
  it('rejects upgrades without a session, from another origin, or with a bad id', async () => {
    const { port, opened } = await start();
    expect((await connectWs(port, 'local', { origin: `http://127.0.0.1:${port}` })).status).toBe(
      403,
    );
    expect(
      (await connectWs(port, 'local', { origin: 'https://evil.example', cookie: COOKIE })).status,
    ).toBe(403);
    expect((await connectWs(port, 'bad%20id', sameOrigin(port))).status).toBe(400);
    expect(opened).toEqual([]);
  });

  it('bridges frames to the chosen backend, including frames sent before it connects', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const dir = tempDir();
    const daemon = await startFakeDaemon(dir);
    const { port, opened } = await start({
      openUpstream: async (id) => {
        opened.push(id);
        await gate;
        return net.connect(daemon);
      },
    });
    const { ws, status } = await connectWs(port, 'remote-1', sameOrigin(port));
    expect(status).toBe(101);
    const reply = nextMessage(ws!);
    ws!.send(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }));
    release();
    expect(JSON.parse(await reply)).toEqual({ jsonrpc: '2.0', id: 7, result: 'pong' });
    expect(opened).toEqual(['remote-1']);
  });

  it('closes the browser socket when the backend cannot be opened', async () => {
    const { port } = await start({
      openUpstream: async () => {
        throw new Error('No stored token for connection: gone');
      },
    });
    const { ws } = await connectWs(port, 'gone', sameOrigin(port));
    const code = await new Promise<number>((resolve) =>
      ws!.once('close', (closeCode) => resolve(closeCode)),
    );
    expect(code).toBe(1011);
  });

  it('cuts the backend off immediately on reset, even if the browser ignores the close', async () => {
    const dir = tempDir();
    const socketPath = path.join(dir, 'spy.sock');
    const received: string[] = [];
    const upstreams: net.Socket[] = [];
    const daemon = net.createServer((socket) => {
      upstreams.push(socket);
      socket.on('data', (chunk) => received.push(String(chunk)));
    });
    await new Promise<void>((resolve) => daemon.listen(socketPath, resolve));
    cleanups.push(() => new Promise((resolve) => daemon.close(resolve)));
    const { port, server } = await start({ openUpstream: async () => net.connect(socketPath) });
    const { ws } = await connectWs(port, 'local', sameOrigin(port));
    ws!.send('{"id":1}');
    await vi.waitFor(() => expect(received.join('')).toContain('"id":1'));
    // An uncooperative browser: stop reading so it never answers the close frame.
    (ws as unknown as { _socket: net.Socket })._socket.pause();
    const upstreamClosed = new Promise<void>((resolve) =>
      upstreams[0]!.once('close', () => resolve()),
    );
    server.disconnectAll();
    ws!.send('{"id":2}');
    await upstreamClosed;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received.join('')).not.toContain('"id":2');
  });

  it('disconnects every browser when asked (access key reset)', async () => {
    const { port, server } = await start();
    const { ws } = await connectWs(port, 'local', sameOrigin(port));
    const closed = new Promise<number>((resolve) => ws!.once('close', (code) => resolve(code)));
    server.disconnectAll();
    expect(await closed).toBe(4401);
  });
});

describe('standalone host extension', () => {
  it('requires a session before dispatching management requests', async () => {
    const handler = vi.fn(async (_request: http.IncomingMessage, response: http.ServerResponse) => {
      response.end('managed');
      return true;
    });
    const { port } = await start({ handleAuthenticatedRequest: handler });
    expect(
      (await request(port, { method: 'POST', path: '/__intent-web/connections' })).status,
    ).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(
      (
        await request(port, {
          method: 'POST',
          path: '/__intent-web/connections',
          headers: { Cookie: COOKIE },
        })
      ).body.toString(),
    ).toBe('managed');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('supports runtime configuration supplied by the standalone host', async () => {
    const { port } = await start({ runtimeConfig: () => 'globalThis.standalone = true;' });
    expect(
      (
        await request(port, { path: '/runtime-config.js', headers: { Cookie: COOKIE } })
      ).body.toString(),
    ).toBe('globalThis.standalone = true;');
  });

  it('binds a private unix socket without replacing an existing path', async () => {
    const { server, dir } = await start();
    await server.close();
    const socket = path.join(dir, 'web.sock');
    await server.listenSocket!(socket);
    expect(fs.statSync(socket).mode & 0o777).toBe(0o600);
    const response = await new Promise<number>((resolve, reject) => {
      http
        .get({ socketPath: socket, path: '/', headers: { Host: 'localhost' } }, (res) => {
          res.resume();
          resolve(res.statusCode!);
        })
        .on('error', reject);
    });
    expect(response).toBe(401);
  });
});
