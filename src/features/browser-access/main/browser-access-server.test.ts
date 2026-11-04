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
import { DeviceLoginStore, LinkTokenVerifier, mintLinkToken } from './device-login';
import {
  APPROVE_PATH,
  CONNECTIONS_PATH,
  DEVICE_POLL_PATH,
  LINK_PATH,
  LOGIN_PATH,
  PENDING_COOKIE,
  createBrowserAccessServer,
  qrDestinations,
  type DeviceLoginText,
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

const DEVICE_TEXT: DeviceLoginText = {
  qrTitle: 'Sign in with your phone',
  qrPrompt: 'Scan this code',
  matchLabel: 'Match code',
  keyFallback: 'Or enter the key',
  approveTitle: 'Sign in another browser',
  approvePrompt: 'Check the code',
  approveSubmit: 'Approve sign-in',
  approved: 'Approved.',
  expired: 'Expired code.',
  linkInvalid: 'Bad link.',
};

describe('Browser access server: QR sign-in and one-time links', () => {
  const qrUrls: string[] = [];
  const startDevice = (overrides: Partial<BrowserAccessServerDeps> = {}) => {
    qrUrls.length = 0;
    return start({
      deviceLogin: {
        text: () => DEVICE_TEXT,
        renderQr: async (url) => {
          qrUrls.push(url);
          return '<svg data-qr="1"></svg>';
        },
      },
      ...overrides,
    });
  };
  const pendingCookieOf = (reply: Reply): string => {
    const cookies = ([] as string[]).concat(reply.headers['set-cookie'] ?? []);
    const pending = cookies.find((c) => c.startsWith(`${PENDING_COOKIE}=`));
    if (!pending) throw new Error('no pending cookie');
    return pending.split(';')[0];
  };
  const approveCodeOf = () => new URL(qrUrls.at(-1) ?? '').searchParams.get('code') ?? '';
  const form = (fields: Record<string, string>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

  it('leaves the login page unchanged when the option is off', async () => {
    const { port } = await start();
    const reply = await request(port, { path: LOGIN_PATH });
    expect(reply.headers['set-cookie']).toBeUndefined();
    expect(String(reply.body)).not.toContain('<script');
    expect((await request(port, { path: DEVICE_POLL_PATH })).status).toBe(401);
    expect(
      (await request(port, { path: `${APPROVE_PATH}?code=x`, headers: { accept: 'text/html' } }))
        .status,
    ).toBe(401);
  });

  it('shows a QR and match code with an HttpOnly pending cookie', async () => {
    const { port } = await startDevice();
    const reply = await request(port, { path: LOGIN_PATH });
    const html = String(reply.body);
    expect(reply.status).toBe(200);
    expect(html).toContain('<svg data-qr="1"></svg>');
    expect(html).toMatch(/data-testid="match-code">[2-9A-Z]{3}-[2-9A-Z]{3}</);
    expect(html).toContain(DEVICE_POLL_PATH);
    expect(qrUrls[0]).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}${APPROVE_PATH}\\?code=`));
    const cookie = ([] as string[]).concat(reply.headers['set-cookie'] ?? [])[0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain(approveCodeOf());
  });

  it('uses the forwarded https origin for the QR and marks the cookie Secure', async () => {
    const { port } = await startDevice();
    const reply = await request(port, {
      path: LOGIN_PATH,
      headers: {
        host: 'box.tailnet.ts.net',
        'x-forwarded-host': 'box.tailnet.ts.net',
        'x-forwarded-proto': 'https',
      },
    });
    expect(qrUrls[0].startsWith(`https://box.tailnet.ts.net${APPROVE_PATH}?code=`)).toBe(true);
    expect(pendingCookieOf(reply)).toBeTruthy();
    expect(String(reply.headers['set-cookie'])).toContain('Secure');
  });

  it('reuses the live request when the page reloads', async () => {
    const { port } = await startDevice();
    const first = await request(port, { path: LOGIN_PATH });
    const cookie = pendingCookieOf(first);
    const code = approveCodeOf();
    await request(port, { path: LOGIN_PATH, headers: { cookie } });
    expect(approveCodeOf()).toBe(code);
  });

  it('signs in the waiting browser once after approval with the right key', async () => {
    const { port } = await startDevice();
    const page = await request(port, { path: LOGIN_PATH });
    const pending = pendingCookieOf(page);
    const code = approveCodeOf();
    const match = /data-testid="match-code">([^<]+)</.exec(String(page.body))?.[1];

    const poll = () => request(port, { path: DEVICE_POLL_PATH, headers: { cookie: pending } });
    expect(JSON.parse(String((await poll()).body))).toEqual({ status: 'pending' });

    const approvePage = await request(port, { path: `${APPROVE_PATH}?code=${code}` });
    expect(approvePage.status).toBe(200);
    expect(String(approvePage.body)).toContain(`data-testid="match-code">${match}<`);

    const wrong = await request(port, { path: APPROVE_PATH, ...form({ code, key: 'nope' }) });
    expect(wrong.status).toBe(401);
    expect(String(wrong.body)).toContain(TEXT.invalidKey);
    expect(JSON.parse(String((await poll()).body))).toEqual({ status: 'pending' });

    const ok = await request(port, { path: APPROVE_PATH, ...form({ code, key: ACCESS_KEY }) });
    expect(ok.status).toBe(200);
    expect(String(ok.body)).toContain(DEVICE_TEXT.approved);
    expect(ok.headers['set-cookie']).toBeUndefined();

    const claimed = await poll();
    expect(JSON.parse(String(claimed.body))).toEqual({ status: 'approved' });
    const cookies = ([] as string[]).concat(claimed.headers['set-cookie'] ?? []);
    expect(cookies.some((c) => c.startsWith(`${COOKIE};`))).toBe(true);
    expect(
      cookies.some((c) => c.startsWith(`${PENDING_COOKIE}=;`) && c.includes('Max-Age=0')),
    ).toBe(true);

    const again = await poll();
    expect(JSON.parse(String(again.body))).toEqual({ status: 'expired' });
    expect(again.headers['set-cookie']).toBeUndefined();
    const reuse = await request(port, { path: APPROVE_PATH, ...form({ code, key: ACCESS_KEY }) });
    expect(reuse.status).toBe(410);
  });

  it('rejects unknown and expired approve codes', async () => {
    let now = Date.now();
    const store = new DeviceLoginStore(() => now);
    const { port } = await startDevice({
      deviceLogin: {
        text: () => DEVICE_TEXT,
        renderQr: async (url) => (qrUrls.push(url), '<svg></svg>'),
        store,
      },
    });
    const page = await request(port, { path: LOGIN_PATH });
    const pending = pendingCookieOf(page);
    const unknown = await request(port, { path: `${APPROVE_PATH}?code=unknown` });
    expect(unknown.status).toBe(410);
    expect(String(unknown.body)).toContain(DEVICE_TEXT.expired);
    now += 2 * 60_000;
    expect((await request(port, { path: `${APPROVE_PATH}?code=${approveCodeOf()}` })).status).toBe(
      410,
    );
    const poll = await request(port, { path: DEVICE_POLL_PATH, headers: { cookie: pending } });
    expect(JSON.parse(String(poll.body))).toEqual({ status: 'expired' });
  });

  it('counts wrong approve keys against the sign-in rate limit', async () => {
    const { port } = await startDevice({ rateLimiter: new LoginRateLimiter(2, 60_000) });
    await request(port, { path: LOGIN_PATH });
    const code = approveCodeOf();
    for (let i = 0; i < 2; i++)
      await request(port, { path: APPROVE_PATH, ...form({ code, key: 'nope' }) });
    const locked = await request(port, { path: APPROVE_PATH, ...form({ code, key: ACCESS_KEY }) });
    expect(locked.status).toBe(429);
    const login = await request(port, { path: LOGIN_PATH, ...form({ key: ACCESS_KEY }) });
    expect(login.status).toBe(429);
  });

  it('drops pending requests when the access key changes', async () => {
    let key = ACCESS_KEY;
    const { port } = await startDevice({ getAccessKey: () => key });
    const page = await request(port, { path: LOGIN_PATH });
    const pending = pendingCookieOf(page);
    const code = approveCodeOf();
    await request(port, { path: APPROVE_PATH, ...form({ code, key: ACCESS_KEY }) });
    key = 'a-new-access-key-0123456789abcdefghijklmnopq';
    const poll = await request(port, { path: DEVICE_POLL_PATH, headers: { cookie: pending } });
    expect(JSON.parse(String(poll.body))).toEqual({ status: 'expired' });
  });

  it('applies the Host check to the new routes', async () => {
    const { port } = await startDevice();
    for (const path of [DEVICE_POLL_PATH, `${APPROVE_PATH}?code=x`, `${LINK_PATH}?t=x`])
      expect((await request(port, { path, headers: { host: 'rebound.example' } })).status).toBe(
        403,
      );
  });

  it('signs in once with a one-time link and redirects home', async () => {
    const { port } = await startDevice();
    const { token } = mintLinkToken(ACCESS_KEY, 5);
    const first = await request(port, { path: `${LINK_PATH}?t=${token}` });
    expect(first.status).toBe(303);
    expect(first.headers.location).toBe('/');
    expect(String(first.headers['set-cookie'])).toContain(COOKIE);
    const second = await request(port, { path: `${LINK_PATH}?t=${token}` });
    expect(second.status).toBe(401);
    expect(String(second.body)).toContain(DEVICE_TEXT.linkInvalid);
    expect(
      ([] as string[]).concat(second.headers['set-cookie'] ?? []).some((c) => c.startsWith(COOKIE)),
    ).toBe(false);
  });

  it('rejects tampered links and links made with another key', async () => {
    const links = new LinkTokenVerifier();
    const { port } = await startDevice({
      deviceLogin: { text: () => DEVICE_TEXT, renderQr: async () => '<svg></svg>', links },
    });
    const { token } = mintLinkToken('another-key', 5);
    expect((await request(port, { path: `${LINK_PATH}?t=${token}` })).status).toBe(401);
    const good = mintLinkToken(ACCESS_KEY, 5).token;
    expect((await request(port, { path: `${LINK_PATH}?t=${good}x` })).status).toBe(401);
    expect((await request(port, { path: `${LINK_PATH}?t=${good}` })).status).toBe(303);
  });

  it('sends QR recovery from a rejected link page to the app, not back to the link', async () => {
    const { port } = await startDevice();
    const { token } = mintLinkToken(ACCESS_KEY, 5);
    await request(port, { path: `${LINK_PATH}?t=${token}` });
    const rejected = await request(port, { path: `${LINK_PATH}?t=${token}` });
    expect(rejected.status).toBe(401);
    const html = String(rejected.body);
    expect(html).toContain('const home = "/";');
    expect(html).toContain(`const fresh = "${LOGIN_PATH}";`);
    const pending = pendingCookieOf(rejected);
    await request(port, {
      path: APPROVE_PATH,
      ...form({ code: approveCodeOf(), key: ACCESS_KEY }),
    });
    const poll = await request(port, { path: DEVICE_POLL_PATH, headers: { cookie: pending } });
    expect(JSON.parse(String(poll.body))).toEqual({ status: 'approved' });
    const home = await request(port, {
      path: '/',
      headers: { cookie: COOKIE, accept: 'text/html' },
    });
    expect(String(home.body)).toContain('<title>app</title>');
  });
});

describe('qrDestinations', () => {
  it('sends sign-in routes to the app root and a fresh sign-in page', () => {
    expect(qrDestinations(`${LINK_PATH}?t=v1.1.x.y`)).toEqual({ home: '/', fresh: LOGIN_PATH });
    expect(qrDestinations(LOGIN_PATH)).toEqual({ home: '/', fresh: LOGIN_PATH });
    expect(qrDestinations(`${APPROVE_PATH}?code=x`)).toEqual({ home: '/', fresh: LOGIN_PATH });
  });

  it('keeps app deep links but drops a rejected key', () => {
    expect(qrDestinations('/workspace/abc?backend=b1')).toEqual({
      home: '/workspace/abc?backend=b1',
      fresh: '/workspace/abc?backend=b1',
    });
    expect(qrDestinations('/workspace/abc?key=wrong&backend=b1').home).toBe(
      '/workspace/abc?backend=b1',
    );
    expect(qrDestinations('/?key=wrong').home).toBe('/');
  });

  it('never leaves the site', () => {
    for (const path of ['//evil.example/x', '/\\evil.example', '/%2F%2Fevil.example']) {
      const { home, fresh } = qrDestinations(path);
      for (const target of [home, fresh]) expect(target).toMatch(/^\/(?![/\\])/);
    }
  });

  it('escapes the destination inside the inline script', async () => {
    const { port } = await start({
      deviceLogin: { text: () => DEVICE_TEXT, renderQr: async () => '<svg></svg>' },
    });
    const reply = await request(port, {
      path: '/a%3C/script%3E%3Cb',
      headers: { accept: 'text/html' },
    });
    const html = String(reply.body);
    expect(html.match(/<\/script>/g)?.length).toBe(1);
  });
});
