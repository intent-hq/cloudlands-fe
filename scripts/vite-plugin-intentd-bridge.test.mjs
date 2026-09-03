// @vitest-environment node
import crypto from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BRIDGE_PATH,
  SANDBOX_HEALTH_PATH,
  intentdBridgePlugin,
  isLoopbackHostname,
  isSameLoopbackOrigin,
  resolveIntentdSocketPath,
} from './vite-plugin-intentd-bridge.mjs';

const TEST_GIT_INFO = { sha: '0123456789abcdef', branch: 'feat/health-test' };

const resources = [];
const nonLoopbackIpv4 = Object.values(os.networkInterfaces())
  .flat()
  .find((address) => address?.family === 'IPv4' && !address.internal)?.address;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (resources.length) await resources.pop()();
});

function maskedFrame(opcode, payload, fin = true, masked = true) {
  const data = Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  const length = data.length;
  const headerLength = length < 126 ? 2 : length < 65_536 ? 4 : 10;
  const header = Buffer.alloc(headerLength);
  header[0] = (fin ? 0x80 : 0) | opcode;
  header[1] = (masked ? 0x80 : 0) | (length < 126 ? length : length < 65_536 ? 126 : 127);
  if (headerLength === 4) header.writeUInt16BE(length, 2);
  if (headerLength === 10) header.writeBigUInt64BE(BigInt(length), 2);
  if (!masked) return Buffer.concat([header, data]);
  const encoded = Buffer.from(data);
  for (let index = 0; index < encoded.length; index++) encoded[index] ^= mask[index & 3];
  return Buffer.concat([header, mask, encoded]);
}

function parseServerFrame(buffer) {
  if (buffer.length < 2) return null;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (buffer.length < offset + length) return null;
  return {
    opcode: buffer[0] & 0x0f,
    payload: buffer.subarray(offset, offset + length),
    consumed: offset + length,
  };
}

class FrameReader {
  buffer = Buffer.alloc(0);
  frames = [];
  waiters = [];

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let frame;
    while ((frame = parseServerFrame(this.buffer))) {
      this.buffer = this.buffer.subarray(frame.consumed);
      const waiter = this.waiters.shift();
      if (waiter) waiter(frame);
      else this.frames.push(frame);
    }
  }

  next() {
    if (this.frames.length) return Promise.resolve(this.frames.shift());
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

function middlewareServer() {
  const handlers = [];
  const server = http.createServer((request, response) => {
    let index = 0;
    const next = () => {
      const handler = handlers[index++];
      if (handler) return handler(request, response, next);
      response.statusCode = 404;
      response.end();
    };
    next();
  });
  return { server, middlewares: { use: (handler) => handlers.push(handler) } };
}

async function setup({
  maxMessageBytes = 40 * 1024 * 1024,
  listenHost = '127.0.0.1',
  startDaemon = true,
  warmupEntries = ['src/routes/+page.svelte'],
  warmModules = ['src/routes/+page.svelte', 'src/hooks.client.ts'],
  waitForRequestsIdle = async () => {},
} = {}) {
  const socketPath = path.join(
    os.tmpdir(),
    `intentd-vite-${crypto.randomBytes(6).toString('hex')}.sock`,
  );
  const root = path.join(os.tmpdir(), `intentd-vite-root-${crypto.randomBytes(6).toString('hex')}`);
  let received = Buffer.alloc(0);
  let udsConnections = 0;
  const udsSockets = new Set();
  const udsServer = net.createServer((socket) => {
    udsConnections++;
    udsSockets.add(socket);
    socket.on('close', () => udsSockets.delete(socket));
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      socket.write(chunk);
    });
  });
  if (startDaemon) await new Promise((resolve) => udsServer.listen(socketPath, resolve));

  const { server, middlewares } = middlewareServer();
  const tcpSockets = new Set();
  server.on('connection', (socket) => {
    tcpSockets.add(socket);
    socket.on('close', () => tcpSockets.delete(socket));
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const viteServer = {
    httpServer: server,
    middlewares,
    config: { root, server: { warmup: { clientFiles: warmupEntries } } },
    waitForRequestsIdle,
    moduleGraph: {
      idToModuleMap: new Map(
        warmModules.map((file, index) => [file, { file: path.resolve(root, file), index }]),
      ),
    },
  };
  intentdBridgePlugin({ socketPath, maxMessageBytes, gitInfo: TEST_GIT_INFO }).configureServer(
    viteServer,
  );
  server.on('upgrade', (request, socket) => {
    if (request.headers['sec-websocket-protocol'] === 'vite-hmr') {
      socket.end('HTTP/1.1 200 HMR Pass Through\r\nConnection: close\r\n\r\n');
    } else if (request.url === '/other') {
      socket.end('HTTP/1.1 200 Other Pass Through\r\nConnection: close\r\n\r\n');
    }
  });
  await new Promise((resolve) => server.listen(0, listenHost, resolve));
  const port = server.address().port;

  resources.push(async () => {
    for (const socket of tcpSockets) socket.destroy();
    for (const socket of udsSockets) socket.destroy();
    const closures = [new Promise((resolve) => server.close(resolve))];
    if (startDaemon) closures.push(new Promise((resolve) => udsServer.close(resolve)));
    await Promise.all(closures);
  });
  return {
    port,
    socketPath,
    received: () => received,
    udsConnections: () => udsConnections,
  };
}

async function requestHttp(port, { url = SANDBOX_HEALTH_PATH, method = 'GET', origin, host } = {}) {
  const headers = {};
  if (origin !== undefined)
    headers.Origin = origin === 'same' ? `http://127.0.0.1:${port}` : origin;
  if (host !== undefined) headers.Host = host;
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: url, method, headers },
      async (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        await once(response, 'end');
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString(),
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function connect(
  port,
  { url = BRIDGE_PATH, origin, protocol, method = 'GET', address = '127.0.0.1', host } = {},
) {
  const socket = net.connect(port, address);
  await once(socket, 'connect');
  const requestHost = host ?? `127.0.0.1:${port}`;
  const requestOrigin = origin === undefined ? `http://${requestHost}` : origin;
  socket.write(
    `${method} ${url} HTTP/1.1\r\n` +
      `Host: ${requestHost}\r\n` +
      'Connection: Upgrade\r\n' +
      'Upgrade: websocket\r\n' +
      `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n` +
      'Sec-WebSocket-Version: 13\r\n' +
      (requestOrigin === null ? '' : `Origin: ${requestOrigin}\r\n`) +
      (protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : '') +
      '\r\n',
  );
  let response = Buffer.alloc(0);
  while (response.indexOf('\r\n\r\n') === -1) {
    const [chunk] = await once(socket, 'data');
    response = Buffer.concat([response, chunk]);
  }
  const boundary = response.indexOf('\r\n\r\n');
  const reader = new FrameReader();
  socket.on('data', (chunk) => reader.feed(chunk));
  reader.feed(response.subarray(boundary + 4));
  return { socket, response: response.subarray(0, boundary).toString(), reader };
}

describe('intentd Vite bridge', () => {
  it('is wired only into web development with page-origin HMR', async () => {
    vi.stubEnv('INTENT_BUILD_TARGET', 'web');
    vi.stubEnv('INTENT_DEV_DAEMON_BRIDGE', '1');
    vi.stubEnv('VITE_INTENTD_WS_URL', '');
    const { default: configure } = await import('../vite.config.mjs');
    const development = configure({ command: 'serve', mode: 'development', isPreview: false });
    expect(development.plugins.some((plugin) => plugin.name === 'intentd-same-origin-bridge')).toBe(
      true,
    );
    expect(development.server.hmr).toBeUndefined();
    expect(JSON.parse(development.define['process.env.VITE_INTENTD_WS_URL'])).toBe(BRIDGE_PATH);

    const preview = configure({ command: 'serve', mode: 'development', isPreview: true });
    expect(preview.plugins.some((plugin) => plugin.name === 'intentd-same-origin-bridge')).toBe(
      false,
    );

    vi.stubEnv('INTENT_DEV_DAEMON_BRIDGE', '');
    const defaultWeb = configure({ command: 'serve', mode: 'development', isPreview: false });
    expect(defaultWeb.plugins.some((plugin) => plugin.name === 'intentd-same-origin-bridge')).toBe(
      false,
    );
    expect(JSON.parse(defaultWeb.define['import.meta.env.VITE_ENABLE_BROWSER_MOCK'])).toBe('true');

    vi.stubEnv('INTENT_DEV_DAEMON_BRIDGE', '1');
    const build = configure({ command: 'build', mode: 'production', isPreview: false });
    expect(build.plugins.some((plugin) => plugin.name === 'intentd-same-origin-bridge')).toBe(
      false,
    );
  });

  it('resolves trimmed socket overrides before platform defaults', () => {
    expect(resolveIntentdSocketPath({ INTENTD_SOCKET: ' /run/custom.sock ' }, 'linux')).toBe(
      '/run/custom.sock',
    );
    expect(resolveIntentdSocketPath({ INTENTD_DATA_DIR: ' /var/lib/intentd-dev ' }, 'linux')).toBe(
      '/var/lib/intentd-dev/intentd.sock',
    );
  });

  it('follows the documented Linux XDG data directory contract', () => {
    expect(
      resolveIntentdSocketPath({ HOME: '/home/dev', XDG_DATA_HOME: '.dev/data' }, 'linux'),
    ).toBe('/home/dev/.local/share/intentd/intentd.sock');
    expect(
      resolveIntentdSocketPath({ HOME: '/home/dev', XDG_DATA_HOME: ' /srv/intent-data ' }, 'linux'),
    ).toBe('/srv/intent-data/intentd/intentd.sock');
  });

  it('keeps the documented darwin default independent of XDG_DATA_HOME', () => {
    expect(resolveIntentdSocketPath({ HOME: '/Users/dev' }, 'darwin')).toBe(
      '/Users/dev/Library/Application Support/intentd/intentd.sock',
    );
    expect(
      resolveIntentdSocketPath({ HOME: '/Users/dev', XDG_DATA_HOME: '/tmp/xdg' }, 'darwin'),
    ).toBe('/Users/dev/Library/Application Support/intentd/intentd.sock');
  });

  it('uses the documented Linux home fallback when XDG_DATA_HOME is absent', () => {
    expect(resolveIntentdSocketPath({ HOME: '/home/dev' }, 'linux')).toBe(
      '/home/dev/.local/share/intentd/intentd.sock',
    );
  });

  it.each([
    'localhost',
    'daemon.localhost',
    'foo.bar.localhost',
    '127.0.0.1',
    '127.255.255.255',
    '::1',
    '[::1]',
  ])('recognizes %s as a loopback hostname', (hostname) => {
    expect(isLoopbackHostname(hostname)).toBe(true);
  });

  it.each(['localhost.evil.com', 'evil-localhost', 'example.com'])(
    'rejects %s as a loopback hostname',
    (hostname) => {
      expect(isLoopbackHostname(hostname)).toBe(false);
    },
  );

  it.each([
    ['http://daemon.localhost:5173', 'daemon.localhost:5173'],
    ['https://foo.bar.localhost:5173', 'foo.bar.localhost:5173'],
    ['http://127.0.0.1:5173', '127.0.0.1:5173'],
    ['http://[::1]:5173', '[::1]:5173'],
  ])('accepts matching loopback origin %s', (origin, host) => {
    expect(isSameLoopbackOrigin(origin, host)).toBe(true);
  });

  it.each([
    ['http://localhost.evil.com:5173', 'localhost.evil.com:5173'],
    ['http://evil-localhost:5173', 'evil-localhost:5173'],
    ['http://example.com:5173', 'example.com:5173'],
    ['http://daemon.localhost:5173', 'localhost:5173'],
  ])('rejects non-loopback or mismatched origin %s', (origin, host) => {
    expect(isSameLoopbackOrigin(origin, host)).toBe(false);
  });

  it('round-trips one WebSocket message as one daemon line', async () => {
    const bridge = await setup();
    const { socket, response, reader } = await connect(bridge.port);
    expect(response).toMatch(/^HTTP\/1\.1 101 /);
    const request = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'workspace.list' });
    socket.write(maskedFrame(0x1, request));
    const reply = await reader.next();
    expect(reply.opcode).toBe(0x1);
    expect(JSON.parse(reply.payload.toString())).toEqual(JSON.parse(request));
    expect(bridge.received().toString()).toBe(`${request}\n`);
  });

  it('accepts matching forged loopback headers from a loopback peer', async () => {
    const bridge = await setup();
    const host = `localhost:${bridge.port}`;
    const { response } = await connect(bridge.port, { host, origin: `http://${host}` });
    expect(response).toMatch(/^HTTP\/1\.1 101 /);
    await vi.waitFor(() => expect(bridge.udsConnections()).toBe(1));
  });

  it.skipIf(!nonLoopbackIpv4)(
    'rejects a non-loopback peer with matching forged headers (no non-internal IPv4 skips)',
    async () => {
      const bridge = await setup({ listenHost: '0.0.0.0' });
      const host = `localhost:${bridge.port}`;
      const { response } = await connect(bridge.port, {
        address: nonLoopbackIpv4,
        host,
        origin: `http://${host}`,
      });
      expect(response).toMatch(/^HTTP\/1\.1 403 /);
      expect(bridge.udsConnections()).toBe(0);
    },
  );

  it('fails closed when the HTTP server reports a non-loopback bind address', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const httpServer = new EventEmitter();
    httpServer.address = () => ({ address: '0.0.0.0' });
    const use = vi.fn();
    intentdBridgePlugin({ socketPath: '/unused.sock' }).configureServer({
      httpServer,
      middlewares: { use },
    });

    httpServer.emit('listening');
    const response = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    use.mock.calls[0][0](
      { url: BRIDGE_PATH, socket: { remoteAddress: '127.0.0.1' } },
      response,
      next,
    );

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/REFUSING bridge.*0\.0\.0\.0/));
    expect(response.statusCode).toBe(403);
    expect(response.end).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    httpServer.emit('close');
  });

  it('reports a healthy warm Vite server connected to intentd', async () => {
    const bridge = await setup();
    const response = await requestHttp(bridge.port, { origin: 'same' });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      vite: { ready: true },
      daemon: { socket: bridge.socketPath, reachable: true },
      warm: { moduleGraph: 2, entriesWarm: true },
      git: TEST_GIT_INFO,
    });
  });

  it('waits for the configured warm-up import crawl before reporting health', async () => {
    let finishWarmup;
    const warmupFinished = new Promise((resolve) => {
      finishWarmup = resolve;
    });
    const bridge = await setup({ waitForRequestsIdle: () => warmupFinished });
    let responseReceived = false;
    const responsePromise = requestHttp(bridge.port).then((response) => {
      responseReceived = true;
      return response;
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(responseReceived).toBe(false);
    finishWarmup();
    expect((await responsePromise).status).toBe(200);
  });

  it('reports an unhealthy sandbox when the daemon socket is missing', async () => {
    const bridge = await setup({ startDaemon: false });
    const response = await requestHttp(bridge.port);
    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      vite: { ready: true },
      daemon: { socket: bridge.socketPath, reachable: false, error: expect.any(String) },
      warm: { moduleGraph: 2, entriesWarm: true },
      git: TEST_GIT_INFO,
    });
  });

  it('stays unhealthy until every configured warm-up entry is in the module graph', async () => {
    const bridge = await setup({ warmupEntries: ['src/routes/+page.svelte', 'src/app.html'] });
    const response = await requestHttp(bridge.port);
    expect(response.status).toBe(503);
    expect(JSON.parse(response.body).warm).toEqual({ moduleGraph: 2, entriesWarm: false });
  });

  it('has no pending warm-up work when no entries are configured', async () => {
    const bridge = await setup({ warmupEntries: [] });
    const response = await requestHttp(bridge.port);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).warm).toEqual({ moduleGraph: 2, entriesWarm: true });
  });

  it.each([
    ['non-GET health requests', { method: 'POST' }, 405],
    ['other paths', { url: '/other' }, 404],
    ['cross-origin requests', { origin: 'https://hostile.example' }, 403],
    ['non-loopback hosts', { host: 'example.com' }, 403],
  ])('rejects %s', async (_label, request, status) => {
    const bridge = await setup();
    const response = await requestHttp(bridge.port, request);
    expect(response.status).toBe(status);
    expect(bridge.udsConnections()).toBe(0);
  });

  it('leaves Vite HMR upgrades untouched', async () => {
    const bridge = await setup();
    const { response } = await connect(bridge.port, {
      url: '/',
      protocol: 'vite-hmr',
      origin: null,
    });
    expect(response).toMatch(/^HTTP\/1\.1 200 HMR Pass Through/);
    expect(bridge.udsConnections()).toBe(0);
  });

  it.each([
    ['a hostile origin', 'https://hostile.example'],
    ['a missing origin', null],
    ['a different loopback origin port', 'http://127.0.0.1:1'],
  ])('rejects %s', async (_label, origin) => {
    const bridge = await setup();
    const { response } = await connect(bridge.port, { origin });
    expect(response).toMatch(/^HTTP\/1\.1 403 /);
    expect(bridge.udsConnections()).toBe(0);
  });

  it('leaves non-bridge WebSocket upgrades to other listeners', async () => {
    const bridge = await setup();
    const { response } = await connect(bridge.port, { url: '/other' });
    expect(response).toMatch(/^HTTP\/1\.1 200 Other Pass Through/);
    expect(bridge.udsConnections()).toBe(0);
  });

  it('rejects plain HTTP requests on the bridge path', async () => {
    const bridge = await setup();
    const response = await new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: bridge.port, path: BRIDGE_PATH }, resolve)
        .on('error', reject);
    });
    expect(response.statusCode).toBe(426);
    response.resume();
    await once(response, 'end');
  });

  it('enforces the message cap across fragments', async () => {
    const bridge = await setup({ maxMessageBytes: 16 });
    const { socket, reader } = await connect(bridge.port);
    socket.write(maskedFrame(0x1, '1234567890', false));
    socket.write(maskedFrame(0x0, 'abcdefghij'));
    const close = await reader.next();
    expect(close.opcode).toBe(0x8);
    expect(close.payload.readUInt16BE(0)).toBe(1009);
  });

  it('rejects unmasked client frames', async () => {
    const bridge = await setup();
    const { socket, reader } = await connect(bridge.port);
    socket.write(maskedFrame(0x1, '{}', true, false));
    const close = await reader.next();
    expect(close.opcode).toBe(0x8);
    expect(close.payload.readUInt16BE(0)).toBe(1002);
  });
});
