// @vitest-environment node
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
  RUNTIME_CONFIG_SOURCE,
  authorizeRequest,
  createWebServer,
  expectedOrigin,
  isAllowedUpgradeOrigin,
  parseRequiredHeader,
  resolveConfig,
} from './web-serve.mjs';

const resources = [];
const silentLog = { warn() {}, log() {}, error() {} };

afterEach(async () => {
  while (resources.length) await resources.pop()();
});

function tempDir() {
  // Unix socket paths are limited to ~104 bytes, so stay short under /tmp.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  resources.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeBuild(dir) {
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

async function startFakeDaemon(dir) {
  const socketPath = path.join(dir, 'd.sock');
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const request = JSON.parse(line);
        socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: 'pong' })}\n`);
      }
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  resources.push(() => new Promise((resolve) => server.close(resolve)));
  return socketPath;
}

async function startWeb(options) {
  const web = createWebServer({ log: silentLog, ...options });
  const bound = await web.listen();
  resources.push(() => web.close());
  return { web, bound };
}

function request(target, { method = 'GET', path: requestPath = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { ...target, method, path: requestPath, headers: { host: 'localhost', ...headers } },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function leaveStaleSocket(socketPath) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `require('net').createServer().listen(${JSON.stringify(socketPath)}, () => console.log('ready'))`,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: process.env.PATH } },
  );
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => String(chunk).includes('ready') && resolve());
    child.once('exit', () => reject(new Error('listener exited early')));
  });
  child.removeAllListeners('exit');
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  await exited;
}

function maskedTextFrame(text) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : null;
  const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index & 3]));
  return Buffer.concat([header, mask, masked]);
}

function upgrade(target, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      ...target,
      path: '/intentd/ws',
      headers: {
        host: 'localhost',
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': crypto.randomBytes(16).toString('base64'),
        ...headers,
      },
    });
    req.on('upgrade', (response, socket) => {
      resources.push(async () => socket.destroy());
      resolve({ status: response.statusCode, socket });
    });
    req.on('response', (response) => {
      response.resume();
      resolve({ status: response.statusCode });
    });
    req.on('error', reject);
    req.end();
  });
}

function readTextFrame(socket) {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 2) return;
      const length = buffer[1] & 0x7f;
      if (length > 125 || buffer.length < 2 + length) return;
      socket.off('data', onData);
      resolve(buffer.subarray(2, 2 + length).toString('utf8'));
    };
    socket.on('data', onData);
  });
}

describe('parseRequiredHeader', () => {
  it('returns null when unset or blank', () => {
    expect(parseRequiredHeader(undefined)).toBeNull();
    expect(parseRequiredHeader('  ')).toBeNull();
  });

  it('parses a name and one or more values', () => {
    const parsed = parseRequiredHeader('Tailscale-User-Login = a@x.com, b@y.com');
    expect(parsed.name).toBe('tailscale-user-login');
    expect(parsed.displayName).toBe('Tailscale-User-Login');
    expect([...parsed.values]).toEqual(['a@x.com', 'b@y.com']);
  });

  it.each(['NoEquals', '=value', 'Bad Header=v', 'Name=', 'Name= , '])('rejects %j', (spec) => {
    expect(() => parseRequiredHeader(spec)).toThrow(/WEB_SERVE_REQUIRE_HEADER/);
  });
});

describe('expectedOrigin', () => {
  it('honors forwarded headers behind the socket', () => {
    const request = {
      headers: {
        host: 'localhost',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'box.tail.ts.net:8443',
      },
    };
    expect(expectedOrigin(request, 'socket')).toBe('https://box.tail.ts.net:8443');
  });

  it('drops the default port and uses the first proxy hop', () => {
    const request = {
      headers: { 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'box.ts.net:443, inner' },
    };
    expect(expectedOrigin(request, 'socket')).toBe('https://box.ts.net');
  });

  it('falls back to Host over plain http without a proxy', () => {
    expect(expectedOrigin({ headers: { host: 'localhost:8080' } }, 'socket')).toBe(
      'http://localhost:8080',
    );
  });

  it('ignores forwarded headers in tcp mode', () => {
    const request = {
      headers: {
        host: '127.0.0.1:9000',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
      },
    };
    expect(expectedOrigin(request, 'tcp')).toBe('http://127.0.0.1:9000');
  });

  it('rejects hosts carrying userinfo or paths', () => {
    expect(expectedOrigin({ headers: { host: 'a@b' } }, 'socket')).toBeNull();
    expect(expectedOrigin({ headers: { host: 'a/b' } }, 'socket')).toBeNull();
    expect(expectedOrigin({ headers: {} }, 'socket')).toBeNull();
  });
});

describe('authorizeRequest', () => {
  const required = parseRequiredHeader('Tailscale-User-Login=me@x.com');

  it('allows any host behind the socket without a required header', () => {
    expect(authorizeRequest({ headers: { host: 'whatever' } }, { mode: 'socket' })).toBeNull();
  });

  it('requires a loopback Host in tcp mode (DNS rebinding)', () => {
    expect(authorizeRequest({ headers: { host: 'evil.example:9000' } }, { mode: 'tcp' })).toBe(
      'host',
    );
    expect(authorizeRequest({ headers: { host: 'localhost:9000' } }, { mode: 'tcp' })).toBeNull();
    expect(authorizeRequest({ headers: { host: '[::1]:9000' } }, { mode: 'tcp' })).toBeNull();
  });

  it('enforces the required identity header', () => {
    const base = { mode: 'socket', requiredHeader: required };
    expect(authorizeRequest({ headers: {} }, base)).toBe('identity');
    expect(authorizeRequest({ headers: { 'tailscale-user-login': 'other@x.com' } }, base)).toBe(
      'identity',
    );
    expect(authorizeRequest({ headers: { 'tailscale-user-login': 'me@x.com' } }, base)).toBeNull();
  });
});

describe('isAllowedUpgradeOrigin', () => {
  it('accepts only the exact page origin', () => {
    const headers = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'box.ts.net' };
    expect(
      isAllowedUpgradeOrigin({ headers: { ...headers, origin: 'https://box.ts.net' } }, 'socket'),
    ).toBe(true);
    expect(
      isAllowedUpgradeOrigin({ headers: { ...headers, origin: 'https://evil.example' } }, 'socket'),
    ).toBe(false);
    expect(
      isAllowedUpgradeOrigin({ headers: { ...headers, origin: 'http://box.ts.net' } }, 'socket'),
    ).toBe(false);
    expect(isAllowedUpgradeOrigin({ headers }, 'socket')).toBe(false);
  });
});

describe('resolveConfig', () => {
  it('defaults to a socket under .dev in the working directory', () => {
    const config = resolveConfig({ HOME: '/home/u' }, '/work');
    expect(config.mode).toBe('socket');
    expect(config.socketPath).toBe('/work/.dev/web-serve/web.sock');
    expect(config.requiredHeader).toBeNull();
  });

  it('switches to tcp mode with WEB_SERVE_PORT', () => {
    const config = resolveConfig({ WEB_SERVE_PORT: '8080', INTENTD_SOCKET: '/d.sock' }, '/work');
    expect(config).toMatchObject({ mode: 'tcp', port: 8080, daemonSocketPath: '/d.sock' });
  });

  it.each(['0', '70000', 'abc', '80x'])('rejects WEB_SERVE_PORT=%s', (value) => {
    expect(() => resolveConfig({ WEB_SERVE_PORT: value }, '/work')).toThrow(/WEB_SERVE_PORT/);
  });
});

describe('web server over a unix socket', () => {
  async function setup(extra = {}) {
    const dir = tempDir();
    const root = makeBuild(dir);
    const daemonSocketPath = await startFakeDaemon(dir);
    const socketPath = path.join(dir, 'run', 'web.sock');
    const { web } = await startWeb({
      root,
      mode: 'socket',
      socketPath,
      daemonSocketPath,
      ...extra,
    });
    return { dir, root, socketPath, target: { socketPath }, web };
  }

  it('creates the socket with owner-only permissions and removes it on close', async () => {
    const { socketPath, web } = await setup();
    expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);
    await web.close();
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it('serves index, runtime config and immutable assets with the right headers', async () => {
    const { target } = await setup();
    const index = await request(target);
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toContain('text/html');
    expect(index.headers['cache-control']).toBe('no-cache');
    expect(index.headers['x-content-type-options']).toBe('nosniff');
    expect(index.headers['x-frame-options']).toBe('DENY');

    const config = await request(target, { path: '/runtime-config.js' });
    expect(config.body.toString()).toBe(RUNTIME_CONFIG_SOURCE);
    expect(config.headers['cache-control']).toBe('no-store');

    const asset = await request(target, { path: '/app/immutable/entry.js' });
    expect(asset.headers['content-type']).toContain('text/javascript');
    expect(asset.headers['cache-control']).toContain('immutable');
  });

  it('gzips compressible assets when the client accepts it', async () => {
    const { target, root } = await setup();
    const response = await request(target, {
      path: '/app/immutable/entry.js',
      headers: { 'accept-encoding': 'gzip, br' },
    });
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.headers.vary).toBe('Accept-Encoding');
    expect(zlib.gunzipSync(response.body).toString()).toBe(
      fs.readFileSync(path.join(root, 'app', 'immutable', 'entry.js'), 'utf8'),
    );
    const png = await request(target, {
      path: '/favicon.png',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(png.headers['content-encoding']).toBeUndefined();
  });

  it('falls back to index.html only for page navigations', async () => {
    const { target } = await setup();
    const route = await request(target, {
      path: '/workspace/abc',
      headers: { accept: 'text/html' },
    });
    expect(route.status).toBe(200);
    expect(route.body.toString()).toContain('<title>app</title>');
    const missingScript = await request(target, {
      path: '/@vite/client',
      headers: { accept: '*/*' },
    });
    expect(missingScript.status).toBe(404);
  });

  it('never serves files outside the build root', async () => {
    const { target } = await setup();
    for (const requestPath of [
      '/..%2Fsecret.txt',
      '/%2e%2e/secret.txt',
      '/app/..%2F..%2Fsecret.txt',
    ]) {
      const response = await request(target, { path: requestPath });
      expect(response.body.toString()).not.toContain('top secret');
    }
  });

  it('rejects non-GET methods and malformed paths', async () => {
    const { target } = await setup();
    expect((await request(target, { method: 'POST' })).status).toBe(405);
    expect((await request(target, { path: '/%E0%A4%A' })).status).toBe(400);
  });

  it('enforces WEB_SERVE_REQUIRE_HEADER on pages and the bridge', async () => {
    const { target } = await setup({ requiredHeader: parseRequiredHeader('X-User=me') });
    expect((await request(target)).status).toBe(403);
    expect((await request(target, { headers: { 'x-user': 'you' } })).status).toBe(403);
    expect((await request(target, { headers: { 'x-user': 'me' } })).status).toBe(200);
    const denied = await upgrade(target, { origin: 'http://localhost' });
    expect(denied.status).toBe(403);
  });

  it('bridges same-origin WebSocket frames to the daemon', async () => {
    const { target } = await setup();
    const forwarded = {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'box.ts.net',
      origin: 'https://box.ts.net',
    };
    const { status, socket } = await upgrade(target, forwarded);
    expect(status).toBe(101);
    const reply = readTextFrame(socket);
    socket.write(maskedTextFrame(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })));
    expect(JSON.parse(await reply)).toEqual({ jsonrpc: '2.0', id: 7, result: 'pong' });
  });

  it('rejects cross-origin WebSocket upgrades', async () => {
    const { target } = await setup();
    const result = await upgrade(target, {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'box.ts.net',
      origin: 'https://evil.example',
    });
    expect(result.status).toBe(403);
  });

  it('replaces a stale socket but refuses a live one or a regular file', async () => {
    const dir = tempDir();
    const root = makeBuild(dir);
    const daemonSocketPath = await startFakeDaemon(dir);
    const socketPath = path.join(dir, 'web.sock');

    await leaveStaleSocket(socketPath);
    expect(fs.lstatSync(socketPath).isSocket()).toBe(true);

    const { web } = await startWeb({ root, mode: 'socket', socketPath, daemonSocketPath });
    const second = createWebServer({
      root,
      mode: 'socket',
      socketPath,
      daemonSocketPath,
      log: silentLog,
    });
    await expect(second.listen()).rejects.toThrow(/already listening/);
    await web.close();

    const file = path.join(dir, 'plain-file');
    fs.writeFileSync(file, 'keep me');
    const third = createWebServer({
      root,
      mode: 'socket',
      socketPath: file,
      daemonSocketPath,
      log: silentLog,
    });
    await expect(third.listen()).rejects.toThrow(/not a socket/);
    expect(fs.readFileSync(file, 'utf8')).toBe('keep me');
  });
});

describe('web server over loopback tcp', () => {
  it('binds 127.0.0.1 and requires a loopback Host', async () => {
    const dir = tempDir();
    const root = makeBuild(dir);
    const daemonSocketPath = await startFakeDaemon(dir);
    const { bound } = await startWeb({ root, mode: 'tcp', port: 0, daemonSocketPath });
    const target = { host: '127.0.0.1', port: bound.port };
    expect((await request(target, { headers: { host: `127.0.0.1:${bound.port}` } })).status).toBe(
      200,
    );
    expect(
      (await request(target, { headers: { host: `rebound.example:${bound.port}` } })).status,
    ).toBe(403);
    const cross = await upgrade(target, {
      host: `127.0.0.1:${bound.port}`,
      origin: `http://rebound.example:${bound.port}`,
    });
    expect(cross.status).toBe(403);
    const same = await upgrade(target, {
      host: `127.0.0.1:${bound.port}`,
      origin: `http://127.0.0.1:${bound.port}`,
    });
    expect(same.status).toBe(101);
  });
});
