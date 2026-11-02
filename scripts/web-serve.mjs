#!/usr/bin/env node
// Serve the production web build (dist/web) with a same-origin bridge to the
// local intentd socket, so a browser can use the app without Electron.
//
// Security model: the bridge grants FULL daemon access to anyone who reaches
// it, so this server never authenticates on its own. By default it listens on
// a 0600 Unix socket that only the owner (or a front-end the owner points at
// it, such as `tailscale serve`, `ssh -L`, Caddy or nginx) can connect to; the
// front-end supplies reach and TLS. WEB_SERVE_PORT opts into a loopback TCP
// port for single-user hosts, where any local user could connect.
//
// Configuration (environment):
//   WEB_SERVE_SOCKET          Unix socket path (default .dev/web-serve/web.sock)
//   WEB_SERVE_PORT            Listen on 127.0.0.1:<port> instead of a socket
//   WEB_SERVE_REQUIRE_HEADER  Name=value[,value...] identity header a trusted
//                             front-end must set (e.g. Tailscale-User-Login)
//   WEB_SERVE_ROOT            Build directory (default dist/web)
//   INTENTD_SOCKET / INTENTD_DATA_DIR  Daemon socket override
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import {
  BRIDGE_PATH,
  MAX_MESSAGE_BYTES,
  bridgeConnection,
  computeAccept,
  isLoopbackHostname,
  probeSocket,
  rejectUpgrade,
  resolveIntentdSocketPath,
} from './intentd-ws-bridge.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_PREFIX = '[web-serve]';
const IMMUTABLE_PREFIX = '/app/immutable/';
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};
const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.map',
  '.svg',
  '.wasm',
  '.webmanifest',
  '.txt',
]);

export const RUNTIME_CONFIG_SOURCE = `globalThis.__INTENT_RUNTIME_CONFIG__ = Object.freeze({ intentdWsUrl: ${JSON.stringify(BRIDGE_PATH)} });\n`;

/** Parse `Name=value[,value...]`; returns null when unset. Throws on malformed input. */
export function parseRequiredHeader(spec) {
  const raw = typeof spec === 'string' ? spec.trim() : '';
  if (!raw) return null;
  const separator = raw.indexOf('=');
  const name = separator === -1 ? '' : raw.slice(0, separator).trim();
  const values = raw
    .slice(separator + 1)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!HEADER_NAME.test(name) || values.length === 0) {
    throw new Error(
      `WEB_SERVE_REQUIRE_HEADER must look like Name=value[,value...]; got ${JSON.stringify(raw)}`,
    );
  }
  return { name: name.toLowerCase(), displayName: name, values: new Set(values) };
}

function firstHeaderValue(value) {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string') return undefined;
  const first = text.split(',')[0].trim();
  return first || undefined;
}

function originOf(protocol, host) {
  if (!host) return null;
  try {
    const url = new URL(`${protocol}://${host}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The page origin the browser should be on. Behind the Unix socket only a
 * trusted front-end can connect, so its X-Forwarded-Proto/Host are honored.
 * In TCP mode forwarded headers are ignored and Host must be loopback.
 */
export function expectedOrigin(request, mode) {
  const headers = request.headers;
  if (mode === 'socket') {
    const forwardedProto = firstHeaderValue(headers['x-forwarded-proto'])?.toLowerCase();
    const protocol = forwardedProto === 'https' ? 'https' : 'http';
    const host = firstHeaderValue(headers['x-forwarded-host']) ?? firstHeaderValue(headers.host);
    return originOf(protocol, host);
  }
  return originOf('http', firstHeaderValue(headers.host));
}

/** Returns null when allowed, otherwise a short denial reason for logs. */
export function authorizeRequest(request, { mode, requiredHeader }) {
  if (mode === 'tcp') {
    const origin = expectedOrigin(request, mode);
    if (!origin || !isLoopbackHostname(new URL(origin).hostname)) return 'host';
  }
  if (requiredHeader) {
    const value = request.headers[requiredHeader.name];
    if (typeof value !== 'string' || !requiredHeader.values.has(value.trim())) return 'identity';
  }
  return null;
}

/** Same-origin check for the bridge upgrade (blocks cross-site WebSocket hijacking). */
export function isAllowedUpgradeOrigin(request, mode) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string') return false;
  const expected = expectedOrigin(request, mode);
  return expected !== null && origin.toLowerCase() === expected.toLowerCase();
}

function resolveStaticFile(root, pathname) {
  if (pathname.includes('\0')) return null;
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

function wantsHtml(request) {
  if (request.headers['sec-fetch-mode'] === 'navigate') return true;
  return String(request.headers.accept || '').includes('text/html');
}

function acceptsGzip(request) {
  return /\bgzip\b/.test(String(request.headers['accept-encoding'] || ''));
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
}

/**
 * Build the HTTP server. Call `listen()` to bind and `close()` to stop; both
 * resolve when done. The server owns the socket file while listening.
 */
export function createWebServer({
  root,
  mode,
  socketPath,
  port,
  daemonSocketPath,
  requiredHeader = null,
  maxMessageBytes = MAX_MESSAGE_BYTES,
  log = console,
}) {
  const buildRoot = path.resolve(root);
  const gzipCache = new Map();
  const clients = new Set();
  let ownsSocket = false;

  const gzipped = (file, stat) => {
    const key = `${file}:${stat.mtimeMs}:${stat.size}`;
    let entry = gzipCache.get(file);
    if (!entry || entry.key !== key) {
      entry = {
        key,
        data: new Promise((resolve, reject) =>
          fs.readFile(file, (readError, raw) => {
            if (readError) return reject(readError);
            zlib.gzip(raw, (zipError, data) => (zipError ? reject(zipError) : resolve(data)));
          }),
        ),
      };
      entry.data.catch(() => gzipCache.delete(file));
      gzipCache.set(file, entry);
    }
    return entry.data;
  };

  const sendFile = (request, response, file, cacheControl) => {
    const ext = path.extname(file).toLowerCase();
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    response.setHeader('Cache-Control', cacheControl);
    const head = request.method === 'HEAD';
    if (COMPRESSIBLE.has(ext)) {
      response.setHeader('Vary', 'Accept-Encoding');
      if (acceptsGzip(request) && stat.size > 1024) {
        gzipped(file, stat).then(
          (data) => {
            response.setHeader('Content-Encoding', 'gzip');
            response.setHeader('Content-Length', data.length);
            response.end(head ? undefined : data);
          },
          () => {
            response.statusCode = 500;
            response.end();
          },
        );
        return;
      }
    }
    response.setHeader('Content-Length', stat.size);
    if (head) {
      response.end();
      return;
    }
    fs.createReadStream(file)
      .on('error', () => response.destroy())
      .pipe(response);
  };

  const server = http.createServer((request, response) => {
    setSecurityHeaders(response);
    const denied = authorizeRequest(request, { mode, requiredHeader });
    if (denied) {
      log.warn(`${LOG_PREFIX} 403 ${denied} ${request.method} ${request.url}`);
      response.statusCode = 403;
      response.end('Forbidden\n');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.statusCode = 400;
      response.end();
      return;
    }
    if (pathname === '/runtime-config.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(request.method === 'HEAD' ? undefined : RUNTIME_CONFIG_SOURCE);
      return;
    }
    if (pathname === BRIDGE_PATH) {
      response.statusCode = 426;
      response.setHeader('Connection', 'close');
      response.setHeader('Upgrade', 'websocket');
      response.end();
      return;
    }
    const file = resolveStaticFile(buildRoot, pathname);
    if (file) {
      const immutable = pathname.startsWith(IMMUTABLE_PREFIX);
      sendFile(
        request,
        response,
        file,
        immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
      return;
    }
    if (wantsHtml(request)) {
      sendFile(request, response, path.join(buildRoot, 'index.html'), 'no-cache');
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      return rejectUpgrade(socket, 400, 'Bad Request');
    }
    if (pathname !== BRIDGE_PATH) return rejectUpgrade(socket, 404, 'Not Found');
    const denied = authorizeRequest(request, { mode, requiredHeader });
    if (denied || !isAllowedUpgradeOrigin(request, mode)) {
      log.warn(`${LOG_PREFIX} 403 upgrade ${denied ?? 'origin'}`);
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
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${computeAccept(key)}\r\n\r\n`,
    );
    clients.add(socket);
    socket.once('close', () => clients.delete(socket));
    bridgeConnection(socket, head, daemonSocketPath, maxMessageBytes);
  });

  const prepareSocketPath = async () => {
    fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    let stat;
    try {
      stat = fs.lstatSync(socketPath);
    } catch {
      return;
    }
    if (!stat.isSocket()) {
      throw new Error(`${socketPath} exists and is not a socket; refusing to replace it`);
    }
    const probe = await probeSocket(socketPath, 250);
    if (probe.reachable) {
      throw new Error(`another server is already listening on ${socketPath}`);
    }
    fs.rmSync(socketPath, { force: true });
  };

  return {
    server,
    async listen() {
      if (mode === 'socket') {
        await prepareSocketPath();
        const previousUmask = process.umask(0o177);
        try {
          await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(socketPath, () => {
              server.off('error', reject);
              resolve();
            });
          });
        } finally {
          process.umask(previousUmask);
        }
        ownsSocket = true;
        fs.chmodSync(socketPath, 0o600);
        return { socketPath };
      }
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      return { port: server.address().port };
    },
    async close() {
      for (const client of clients) client.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      if (ownsSocket) {
        ownsSocket = false;
        fs.rmSync(socketPath, { force: true });
      }
    },
  };
}

/** Resolve configuration from the environment; throws with a user-facing message. */
export function resolveConfig(env = process.env, cwd = process.cwd()) {
  const rawPort = env.WEB_SERVE_PORT?.trim();
  let port = null;
  if (rawPort) {
    if (!/^[0-9]+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65_535) {
      throw new Error(`WEB_SERVE_PORT must be a port number between 1 and 65535; got ${rawPort}`);
    }
    port = Number(rawPort);
  }
  const socketPath = path.resolve(
    cwd,
    env.WEB_SERVE_SOCKET?.trim() || path.join('.dev', 'web-serve', 'web.sock'),
  );
  return {
    root: path.resolve(cwd, env.WEB_SERVE_ROOT?.trim() || path.join(PACKAGE_ROOT, 'dist', 'web')),
    mode: port === null ? 'socket' : 'tcp',
    socketPath,
    port,
    daemonSocketPath: resolveIntentdSocketPath(env),
    requiredHeader: parseRequiredHeader(env.WEB_SERVE_REQUIRE_HEADER),
  };
}

function printAccessHelp(config, bound) {
  const lines = [];
  if (config.mode === 'socket') {
    lines.push(`${LOG_PREFIX} serving on unix socket ${bound.socketPath} (mode 0600)`);
    lines.push(`${LOG_PREFIX} put a front-end in front of it, for example:`);
    lines.push(`${LOG_PREFIX}   tailscale serve --bg unix:${bound.socketPath}`);
    lines.push(
      `${LOG_PREFIX}   ssh -N -L 8080:${bound.socketPath} <this-host>   # then open http://localhost:8080`,
    );
  } else {
    lines.push(`${LOG_PREFIX} serving on http://127.0.0.1:${bound.port}/ (loopback only)`);
    lines.push(
      `${LOG_PREFIX} WARNING: any user on this machine can reach this port and drive the daemon as you.`,
    );
  }
  lines.push(`${LOG_PREFIX} daemon socket ${config.daemonSocketPath}`);
  if (config.requiredHeader) {
    lines.push(
      `${LOG_PREFIX} requiring ${config.requiredHeader.displayName} in {${[...config.requiredHeader.values].join(', ')}}`,
    );
  } else if (config.mode === 'socket') {
    lines.push(
      `${LOG_PREFIX} NOTE: no WEB_SERVE_REQUIRE_HEADER set; everyone your front-end lets through gets full daemon access.`,
    );
  }
  for (const line of lines) console.log(line);
}

async function main() {
  if (process.platform === 'win32') {
    console.error(
      `${LOG_PREFIX} ERROR: Windows is unsupported (the bridge needs a Unix domain socket).`,
    );
    process.exit(1);
  }
  let config;
  try {
    config = resolveConfig();
  } catch (error) {
    console.error(`${LOG_PREFIX} ERROR: ${error.message}`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(config.root, 'index.html'))) {
    console.error(
      `${LOG_PREFIX} ERROR: no web build at ${config.root}; run: corepack pnpm run build:web`,
    );
    process.exit(1);
  }
  const daemon = await probeSocket(config.daemonSocketPath, 500);
  if (!daemon.reachable) {
    console.warn(
      `${LOG_PREFIX} WARNING: daemon socket ${config.daemonSocketPath} is not reachable (${daemon.error}); the app will show as disconnected until intentd runs.`,
    );
  }
  const web = createWebServer(config);
  let bound;
  try {
    bound = await web.listen();
  } catch (error) {
    console.error(`${LOG_PREFIX} ERROR: ${error.message}`);
    process.exit(1);
  }
  printAccessHelp(config, bound);
  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${LOG_PREFIX} ${signal}: shutting down`);
    void web.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
