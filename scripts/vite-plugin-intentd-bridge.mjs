import crypto from 'node:crypto';
import net from 'node:net';

export const BRIDGE_PATH = '/intentd/ws';
export const MAX_MESSAGE_BYTES = 40 * 1024 * 1024;

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const NEWLINE = Buffer.from('\n');
const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

export function resolveIntentdSocketPath(env = process.env, platform = process.platform) {
  if (env.INTENTD_SOCKET) return env.INTENTD_SOCKET;
  if (env.INTENTD_DATA_DIR) return `${env.INTENTD_DATA_DIR}/intentd.sock`;
  const home = env.HOME || env.USERPROFILE || '';
  if (platform === 'darwin') {
    return `${home}/Library/Application Support/intentd/intentd.sock`;
  }
  const dataHome = env.XDG_DATA_HOME || `${home}/.local/share`;
  return `${dataHome}/intentd/intentd.sock`;
}

export function isLoopbackHostname(hostname) {
  const host = String(hostname)
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return host === 'localhost' || host === '::1' || /^127(?:\.[0-9]{1,3}){3}$/.test(host);
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

      server.middlewares.use((request, response, next) => {
        if (request.url !== BRIDGE_PATH) return next();
        response.statusCode = 426;
        response.setHeader('Connection', 'close');
        response.setHeader('Upgrade', 'websocket');
        response.end();
      });

      const clients = new Set();
      const onUpgrade = (request, socket, head) => {
        if (isViteHmrUpgrade(request)) return;
        if (request.url !== BRIDGE_PATH) return rejectUpgrade(socket, 404, 'Not Found');
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
