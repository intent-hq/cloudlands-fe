// Keep socket resolution aligned with src/features/backend/main/intentd-data-dir.ts,
// the source of truth for the FE's mirror of the daemon's platform defaults.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

export const BRIDGE_PATH = '/intentd/ws';
export const SANDBOX_HEALTH_PATH = '/__sandbox/health';
export const MAX_MESSAGE_BYTES = 40 * 1024 * 1024;

const SOCKET_CONNECT_TIMEOUT_MS = 250;

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const NEWLINE = Buffer.from('\n');
const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

export function resolveIntentdSocketPath(env = process.env, platform = process.platform) {
  const socketPath = env.INTENTD_SOCKET?.trim();
  if (socketPath) return socketPath;
  const dataDir = env.INTENTD_DATA_DIR?.trim();
  if (dataDir) return `${dataDir}/intentd.sock`;
  const home = env.HOME || env.USERPROFILE || '';
  if (platform === 'darwin') {
    return `${home}/Library/Application Support/intentd/intentd.sock`;
  }
  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  const dataHome =
    xdgDataHome && path.isAbsolute(xdgDataHome) ? xdgDataHome : `${home}/.local/share`;
  return `${dataHome}/intentd/intentd.sock`;
}

export function isLoopbackHostname(hostname) {
  const host = String(hostname)
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127(?:\.[0-9]{1,3}){3}$/.test(host)
  );
}

export function isSameLoopbackOrigin(origin, host) {
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.origin === origin &&
      isLoopbackHostname(parsed.hostname) &&
      parsed.host.toLowerCase() === host.trim().toLowerCase()
    );
  } catch {
    return false;
  }
}

function normalizeSocketAddress(address) {
  return String(address || '').replace(/^::ffff:/i, '');
}

function isLoopbackPeer(socket) {
  return isLoopbackHostname(normalizeSocketAddress(socket.remoteAddress));
}

function isLoopbackRequest(request) {
  const host = request.headers.host;
  if (typeof host !== 'string') return false;
  try {
    const hostname = new URL(`http://${host}`).hostname;
    return isLoopbackHostname(hostname) && isLoopbackHostname(request.socket.localAddress);
  } catch {
    return false;
  }
}

function probeSocket(socketPath, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ reachable: true }));
    socket.once('timeout', () => finish({ reachable: false, error: 'timeout' }));
    socket.once('error', (error) =>
      finish({ reachable: false, error: error.code || error.message || 'unknown' }),
    );
  });
}

function resolveGitInfo(root) {
  const run = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  try {
    return { sha: run('rev-parse', 'HEAD'), branch: run('rev-parse', '--abbrev-ref', 'HEAD') };
  } catch {
    return { sha: 'unknown', branch: 'unknown' };
  }
}

function clientModuleGraph(server) {
  return server.environments?.client?.moduleGraph ?? server.moduleGraph;
}

function configuredEntriesAreWarm(server, moduleGraph) {
  const entries = server.config?.server?.warmup?.clientFiles ?? [];
  if (!entries.length) return true;
  if (!moduleGraph?.idToModuleMap) return false;
  const root = server.config.root;
  const files = [...moduleGraph.idToModuleMap.values()]
    .map((module) => module.file)
    .filter((file) => typeof file === 'string')
    .map((file) => file.replaceAll('\\', '/'));
  return entries.every((entry) => {
    const normalizedEntry = entry.replaceAll('\\', '/');
    const absoluteEntry = path.resolve(root, entry).replaceAll('\\', '/');
    return files.some((file) => {
      const relativeFile = path.relative(root, file).replaceAll('\\', '/');
      try {
        return (
          file === absoluteEntry ||
          relativeFile === normalizedEntry ||
          path.matchesGlob(file, absoluteEntry) ||
          path.matchesGlob(relativeFile, normalizedEntry)
        );
      } catch {
        return false;
      }
    });
  });
}

async function writeHealthResponse(request, response, server, socketPath, timeoutMs, gitInfo) {
  if (request.method !== 'GET') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET');
    response.end();
    return;
  }
  const origin = request.headers.origin;
  if (
    !isLoopbackRequest(request) ||
    (origin !== undefined && !isSameLoopbackOrigin(origin, request.headers.host))
  ) {
    response.statusCode = 403;
    response.end();
    return;
  }

  const moduleGraph = clientModuleGraph(server);
  const daemon = await probeSocket(socketPath, timeoutMs);
  const entriesWarm = configuredEntriesAreWarm(server, moduleGraph);
  const body = {
    ok: daemon.reachable && entriesWarm,
    vite: { ready: true },
    daemon: { socket: socketPath, ...daemon },
    warm: { moduleGraph: moduleGraph?.idToModuleMap?.size ?? 0, entriesWarm },
    git: gitInfo,
  };
  response.statusCode = body.ok ? 200 : 503;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function computeAccept(key) {
  return crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');
}

function encodeFrame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

function closePayload(code, reason = '') {
  const detail = Buffer.from(reason, 'utf8').subarray(0, 123);
  const payload = Buffer.alloc(2 + detail.length);
  payload.writeUInt16BE(code, 0);
  detail.copy(payload, 2);
  return payload;
}

function rejectUpgrade(socket, status, reason) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
}

function bridgeConnection(socket, head, socketPath, maxMessageBytes) {
  let wsBuffer = Buffer.alloc(0);
  let udsBuffer = Buffer.alloc(0);
  let fragments = null;
  let closeSent = false;
  let closed = false;
  const uds = net.connect(socketPath);

  const sendFrame = (opcode, payload) => {
    if (!socket.destroyed && socket.writable) socket.write(encodeFrame(opcode, payload));
  };
  const shutdown = (code, reason) => {
    if (closed) return;
    closed = true;
    if (!closeSent) {
      closeSent = true;
      sendFrame(OP_CLOSE, closePayload(code, reason));
    }
    socket.end();
    uds.destroy();
    setTimeout(() => socket.destroy(), 1_000).unref();
  };

  uds.on('error', (error) =>
    shutdown(1011, `intentd socket error: ${error.code || error.message}`),
  );
  uds.on('close', () => shutdown(1000, 'intentd socket closed'));
  uds.on('data', (chunk) => {
    udsBuffer = udsBuffer.length ? Buffer.concat([udsBuffer, chunk]) : chunk;
    let newline;
    while ((newline = udsBuffer.indexOf(0x0a)) !== -1) {
      const line = udsBuffer.subarray(0, newline);
      udsBuffer = udsBuffer.subarray(newline + 1);
      if (line.length > maxMessageBytes) return shutdown(1009, 'daemon message exceeds limit');
      sendFrame(OP_TEXT, line);
    }
    if (udsBuffer.length > maxMessageBytes) shutdown(1009, 'daemon message exceeds limit');
  });

  const deliver = (payload) => {
    if (!uds.destroyed) uds.write(Buffer.concat([payload, NEWLINE]));
  };
  const protocolError = () => shutdown(1002, 'invalid client frame');

  const handleFrame = (fin, opcode, payload) => {
    if (opcode === OP_PING) return sendFrame(OP_PONG, payload);
    if (opcode === OP_PONG) return;
    if (opcode === OP_CLOSE) {
      if (!closeSent) {
        closeSent = true;
        sendFrame(OP_CLOSE, payload);
      }
      closed = true;
      socket.end();
      uds.destroy();
      return;
    }
    if (opcode === OP_CONTINUATION) {
      if (!fragments) return protocolError();
      fragments.chunks.push(payload);
      fragments.size += payload.length;
      if (fin) {
        const complete = fragments;
        fragments = null;
        if (complete.opcode === OP_TEXT) deliver(Buffer.concat(complete.chunks));
      }
      return;
    }
    if (opcode !== OP_TEXT && opcode !== OP_BINARY) return protocolError();
    if (fragments) return protocolError();
    if (fin) {
      if (opcode === OP_TEXT) deliver(payload);
      return;
    }
    fragments = { opcode, chunks: [payload], size: payload.length };
  };

  const onData = (chunk) => {
    wsBuffer = wsBuffer.length ? Buffer.concat([wsBuffer, chunk]) : chunk;
    while (!closed) {
      if (wsBuffer.length < 2) return;
      const first = wsBuffer[0];
      const second = wsBuffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      if ((first & 0x70) !== 0 || !masked) return protocolError();
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (wsBuffer.length < 4) return;
        length = wsBuffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (wsBuffer.length < 10) return;
        const largeLength = wsBuffer.readBigUInt64BE(2);
        if (largeLength > BigInt(maxMessageBytes)) return shutdown(1009, 'message exceeds limit');
        length = Number(largeLength);
        offset = 10;
      }
      const controlFrame = opcode >= OP_CLOSE;
      if (controlFrame && (!fin || length > 125)) return protocolError();
      if (!controlFrame) {
        const assembled = fragments?.size ?? 0;
        if (length > maxMessageBytes || assembled + length > maxMessageBytes) {
          return shutdown(1009, 'message exceeds limit');
        }
      }
      if (wsBuffer.length < offset + 4 + length) return;
      const mask = wsBuffer.subarray(offset, offset + 4);
      const payload = Buffer.from(wsBuffer.subarray(offset + 4, offset + 4 + length));
      for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index & 3];
      wsBuffer = wsBuffer.subarray(offset + 4 + length);
      handleFrame(fin, opcode, payload);
    }
  };

  socket.on('data', onData);
  socket.on('error', () => {
    closed = true;
    uds.destroy();
    socket.destroy();
  });
  socket.on('end', () => {
    closed = true;
    uds.destroy();
    socket.destroy();
  });
  socket.on('close', () => {
    closed = true;
    uds.destroy();
  });
  if (head?.length) onData(head);
}

function isViteHmrUpgrade(request) {
  const protocols = String(request.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((value) => value.trim().toLowerCase());
  return protocols.includes('vite-hmr');
}

export function intentdBridgePlugin({
  socketPath = resolveIntentdSocketPath(),
  platform = process.platform,
  maxMessageBytes = MAX_MESSAGE_BYTES,
  socketConnectTimeoutMs = SOCKET_CONNECT_TIMEOUT_MS,
  gitInfo,
} = {}) {
  return {
    name: 'intentd-same-origin-bridge',
    apply: 'serve',
    configureServer(server) {
      if (platform === 'win32') {
        console.warn(
          '[intentd-bridge] DEV ONLY bridge disabled: Windows named pipes are unsupported',
        );
        return;
      }
      if (!server.httpServer) return;

      console.log(`[intentd-bridge] proxying ${BRIDGE_PATH} to ${socketPath}`);
      console.warn(
        '[intentd-bridge] WARNING: DEV ONLY — same-origin clients receive full daemon access',
      );

      let bridgeAvailable = true;
      server.httpServer.once('listening', () => {
        const address = server.httpServer?.address();
        const boundAddress =
          address && typeof address === 'object' ? normalizeSocketAddress(address.address) : '';
        if (!isLoopbackHostname(boundAddress)) {
          bridgeAvailable = false;
          console.warn(
            `[intentd-bridge] REFUSING bridge: dev server is bound to non-loopback address ${boundAddress || 'unknown'}`,
          );
        }
      });

      const resolvedGitInfo = gitInfo ?? resolveGitInfo(server.config?.root ?? process.cwd());

      server.middlewares.use((request, response, next) => {
        if (request.url === SANDBOX_HEALTH_PATH) {
          void writeHealthResponse(
            request,
            response,
            server,
            socketPath,
            socketConnectTimeoutMs,
            resolvedGitInfo,
          );
          return;
        }
        if (request.url !== BRIDGE_PATH) return next();
        if (!bridgeAvailable || !isLoopbackPeer(request.socket)) {
          response.statusCode = 403;
          response.end();
          return;
        }
        response.statusCode = 426;
        response.setHeader('Connection', 'close');
        response.setHeader('Upgrade', 'websocket');
        response.end();
      });

      const clients = new Set();
      const onUpgrade = (request, socket, head) => {
        if (isViteHmrUpgrade(request)) return;
        if (request.url !== BRIDGE_PATH) return;
        if (!bridgeAvailable || !isLoopbackPeer(socket)) {
          return rejectUpgrade(socket, 403, 'Forbidden');
        }
        const key = request.headers['sec-websocket-key'];
        if (
          request.method !== 'GET' ||
          String(request.headers.upgrade || '').toLowerCase() !== 'websocket' ||
          typeof key !== 'string' ||
          request.headers['sec-websocket-version'] !== '13'
        ) {
          return rejectUpgrade(socket, 400, 'Bad Request');
        }
        if (!isSameLoopbackOrigin(request.headers.origin, request.headers.host)) {
          return rejectUpgrade(socket, 403, 'Forbidden');
        }
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${computeAccept(key)}\r\n\r\n`,
        );
        clients.add(socket);
        socket.once('close', () => clients.delete(socket));
        bridgeConnection(socket, head, socketPath, maxMessageBytes);
      };

      server.httpServer.prependListener('upgrade', onUpgrade);
      server.httpServer.once('close', () => {
        server.httpServer?.removeListener('upgrade', onUpgrade);
        for (const client of clients) client.destroy();
      });
    },
  };
}
