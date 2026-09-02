// @vitest-environment node
import crypto from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BRIDGE_PATH,
  intentdBridgePlugin,
  resolveIntentdSocketPath,
} from './vite-plugin-intentd-bridge.mjs';

const resources = [];

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

async function setup(maxMessageBytes = 40 * 1024 * 1024) {
  const socketPath = path.join(
    os.tmpdir(),
    `intentd-vite-${crypto.randomBytes(6).toString('hex')}.sock`,
  );
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
  await new Promise((resolve) => udsServer.listen(socketPath, resolve));

  const { server, middlewares } = middlewareServer();
  const tcpSockets = new Set();
  server.on('connection', (socket) => {
    tcpSockets.add(socket);
    socket.on('close', () => tcpSockets.delete(socket));
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  intentdBridgePlugin({ socketPath, maxMessageBytes }).configureServer({
    httpServer: server,
    middlewares,
  });
  server.on('upgrade', (request, socket) => {
    if (request.headers['sec-websocket-protocol'] === 'vite-hmr') {
      socket.end('HTTP/1.1 200 HMR Pass Through\r\nConnection: close\r\n\r\n');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  resources.push(async () => {
    for (const socket of tcpSockets) socket.destroy();
    for (const socket of udsSockets) socket.destroy();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => udsServer.close(resolve)),
    ]);
  });
  return {
    port,
    received: () => received,
    udsConnections: () => udsConnections,
  };
}

async function connect(port, { url = BRIDGE_PATH, origin, protocol, method = 'GET' } = {}) {
  const socket = net.connect(port, '127.0.0.1');
  await once(socket, 'connect');
  const host = `127.0.0.1:${port}`;
  const requestOrigin = origin === undefined ? `http://${host}` : origin;
  socket.write(
    `${method} ${url} HTTP/1.1\r\n` +
      `Host: ${host}\r\n` +
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

  it('resolves socket overrides before platform defaults', () => {
    expect(resolveIntentdSocketPath({ INTENTD_SOCKET: '/run/custom.sock' }, 'linux')).toBe(
      '/run/custom.sock',
    );
    expect(resolveIntentdSocketPath({ INTENTD_DATA_DIR: '/var/lib/intentd-dev' }, 'linux')).toBe(
      '/var/lib/intentd-dev/intentd.sock',
    );
    expect(resolveIntentdSocketPath({ HOME: '/Users/dev' }, 'darwin')).toBe(
      '/Users/dev/Library/Application Support/intentd/intentd.sock',
    );
    expect(resolveIntentdSocketPath({ HOME: '/home/dev' }, 'linux')).toBe(
      '/home/dev/.local/share/intentd/intentd.sock',
    );
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

  it('rejects WebSocket upgrades on other paths', async () => {
    const bridge = await setup();
    const { response } = await connect(bridge.port, { url: '/other' });
    expect(response).toMatch(/^HTTP\/1\.1 404 /);
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
    const bridge = await setup(16);
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
