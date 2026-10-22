import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const isGitLabStatus = (f) =>
  f.method === 'sourceControl.authStatus' && f.params?.provider === 'gitlab';
export const forbidden = (f) =>
  /^(sourceControl|github)\.(connect|cancelAuth|revoke|disconnect|pollAuth|pollForToken)$/.test(
    f.method,
  );

// Evidence may contain rendered invite links. Keep route text but remove URL
// queries/fragments and credentials before persisting any row or exception.
export const sanitizeEvidence = (value) =>
  JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (/^(token|secret|authorization|password|deviceCode|userCode)$/i.test(key))
        return '[redacted]';
      if (typeof item !== 'string') return item;
      return item.replace(/(?:https?|wss?):\/\/[^\s"<>]+/g, (text) => {
        try {
          const url = new URL(text);
          url.username = '';
          url.password = '';
          url.search = '';
          url.hash = '';
          return url.toString();
        } catch {
          return '[redacted-url]';
        }
      });
    }),
  );
const canonicalPin = (v) => v.replaceAll(':', '').toLowerCase();

export async function tlsSocket(port, fingerprint, token, endpoint = '/ws') {
  const socket = new WebSocket(
    `wss://127.0.0.1:${port}${endpoint}${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    {
      rejectUnauthorized: false,
      handshakeTimeout: 15000,
      maxPayload: 41943040,
    },
  );
  await once(socket, 'open');
  const actual = digest(socket._socket.getPeerCertificate().raw);
  if (actual !== canonicalPin(fingerprint)) {
    socket.terminate();
    throw new Error('TLS certificate pin mismatch');
  }
  return socket;
}

export async function rpcClient(port, fingerprint, token, endpoint) {
  const socket = await tlsSocket(port, fingerprint, token, endpoint);
  let sequence = 0;
  const pending = new Map();
  socket.on('message', (bytes) => {
    const frame = JSON.parse(bytes.toString());
    const p = pending.get(frame.id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(frame.id);
      frame.error
        ? p.reject(Object.assign(new Error('RPC refused'), { rpc: frame.error }))
        : p.resolve(frame.result);
    }
  });
  socket.on('close', () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('original TLS socket closed'));
    }
    pending.clear();
  });
  return {
    socket,
    close: () => socket.close(),
    request(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolveResult, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`RPC deadline: ${method}`));
        }, 30000);
        pending.set(id, { resolve: resolveResult, reject, timer });
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      });
    },
  };
}

// The hold retains an actual daemon frame with its original request and socket.
// It never synthesizes a response, edits the payload, or retargets a reconnect.
export class OriginalSocketHold {
  armed = false;
  held = null;
  arm() {
    if (this.armed || this.held) throw new Error('hold already owned');
    this.armed = true;
  }
  take(record) {
    if (!this.armed) return false;
    this.armed = false;
    this.held = record;
    return true;
  }
  release() {
    const h = this.held;
    if (!h) throw new Error('no actual held response');
    this.held = null;
    const open =
      h.upstream.readyState === WebSocket.OPEN && h.downstream.readyState === WebSocket.OPEN;
    if (open) h.downstream.send(h.bytes, { binary: false });
    return {
      socketId: h.socketId,
      requestId: h.requestId,
      sha256: digest(h.bytes),
      disposition: open ? 'delivered-original-socket' : 'closed-origin-discard',
      staleSagaDeliveryProved: false,
    };
  }
}

export async function roleBridge({ role, token, port, fingerprint, webRoot, record, fail }) {
  const hold = new OriginalSocketHold();
  const sockets = new Map();
  const frames = [];
  let offline = false;
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/runtime-config.js') {
        res.setHeader('content-type', 'text/javascript');
        res.end('globalThis.__INTENT_RUNTIME_CONFIG__={intentdWsUrl:"/rpc"};');
        return;
      }
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      let path = resolve(webRoot, `.${pathname}`);
      if (!path.startsWith(`${resolve(webRoot)}${sep}`)) path = resolve(webRoot, 'index.html');
      let bytes;
      try {
        const real = await realpath(path);
        if (!real.startsWith(`${resolve(webRoot)}${sep}`)) throw new Error('static escape');
        bytes = await readFile(real);
      } catch (error) {
        if (!['ENOENT', 'EISDIR'].includes(error.code)) throw error;
        path = resolve(webRoot, 'index.html');
        bytes = await readFile(path);
      }
      const mime = {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
      };
      res.setHeader('content-type', mime[extname(path)] ?? 'application/octet-stream');
      res.end(bytes);
    } catch (error) {
      fail(error);
      res.writeHead(500).end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 41943040 });
  server.on('upgrade', (req, socket, head) => {
    if (offline || req.url !== '/rpc' || req.socket.remoteAddress !== '127.0.0.1') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, async (downstream) => {
      const socketId = randomUUID();
      const requests = new Map();
      let upstream;
      // Browser frames may arrive before the upstream TLS handshake completes.
      const queued = [];
      const forward = (bytes) => {
        try {
          const f = JSON.parse(bytes.toString());
          if (forbidden(f)) throw new Error(`forbidden account action: ${f.method}`);
          if (requests.has(f.id)) throw new Error('duplicate request ID on socket');
          if (f.id !== undefined) requests.set(f.id, f);
          if (frames.length >= 20000) throw new Error('wire evidence frame bound');
          frames.push({ direction: 'request', role, socketId, frame: f });
          record({
            kind: 'request',
            role,
            socketId,
            requestId: f.id,
            method: f.method,
            sha256: digest(bytes),
          });
          if (upstream) upstream.send(bytes, { binary: false });
          else {
            if (queued.length >= 128) throw new Error('pre-TLS queue bound');
            queued.push(bytes);
          }
        } catch (error) {
          fail(error);
          downstream.terminate();
          upstream?.terminate();
        }
      };
      downstream.on('message', forward);
      try {
        upstream = await tlsSocket(port, fingerprint, token);
        sockets.set(socketId, { upstream, downstream });
        record({ kind: 'TLS', role, socketId, fingerprint: canonicalPin(fingerprint) });
        upstream.on('message', (bytes) => {
          try {
            const f = JSON.parse(bytes.toString());
            const request = requests.get(f.id);
            if (frames.length >= 20000) throw new Error('wire evidence frame bound');
            frames.push({ direction: 'response', role, socketId, request, frame: f });
            record({
              kind: 'response',
              role,
              socketId,
              requestId: f.id,
              method: request?.method,
              sha256: digest(bytes),
              errorCode: f.error?.data?.code ?? f.error?.code,
              ...(request?.method === 'principal.me'
                ? { principal: f.result?.principal, revision: f.result?.revision }
                : {}),
              ...(request?.method === 'client.hello' ? { server: f.result?.server } : {}),
            });
            if (
              request &&
              isGitLabStatus(request) &&
              hold.take({
                bytes: Buffer.from(bytes),
                upstream,
                downstream,
                socketId,
                requestId: f.id,
              })
            )
              return;
            if (downstream.readyState === WebSocket.OPEN) downstream.send(bytes, { binary: false });
          } catch (error) {
            fail(error);
            upstream.terminate();
            downstream.terminate();
          }
        });
        upstream.on('close', () => {
          downstream.close();
          sockets.delete(socketId);
        });
        downstream.on('close', () => {
          upstream.close();
          sockets.delete(socketId);
        });
        upstream.on('error', fail);
        downstream.on('error', fail);
        for (const bytes of queued) upstream.send(bytes, { binary: false });
      } catch (error) {
        fail(error);
        downstream.terminate();
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    role,
    frames,
    hold,
    url: `http://127.0.0.1:${server.address().port}`,
    sockets,
    disconnect() {
      offline = true;
      for (const pair of sockets.values()) {
        pair.upstream.terminate();
        pair.downstream.terminate();
      }
    },
    reconnect() {
      offline = false;
    },
    async close() {
      this.disconnect();
      wss.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
