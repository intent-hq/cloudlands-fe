/**
 * Browser access HTTP server (Electron main).
 *
 * Serves the bundled web build (`dist/web`) to a browser that reaches this
 * machine through a front-end such as `tailscale serve`, plus:
 * - `/runtime-config.js`: picks the backend for this tab (`?backend=<id>`,
 *   remembered in sessionStorage) and points the app at its bridge.
 * - `/__browser-access/connections`: the token-free connections list.
 * - `/intentd/ws/<connectionId>`: a WebSocket bridged to that backend through
 *   the same transport desktop windows use (UDS for the local daemon; pinned
 *   TLS, bearer token, host race and tunnel for remotes). Tokens stay here.
 *
 * Every request needs the access-key session cookie (see browser-access-auth).
 * Dependencies are injected so the server runs in tests without Electron.
 */
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import zlib from 'node:zlib';

import type { WebSocket as WsWebSocket, WebSocketServer as WsServer } from 'ws';

import {
  CONNECTION_ID_PATTERN,
  LoginRateLimiter,
  accessKeyMatches,
  hasValidSession,
  isAllowedHost,
  isSameOriginUpgrade,
  pageOrigin,
  sessionCookieHeader,
} from './browser-access-auth';

// `ws` is CJS and the vitest suite aliases the ESM import to a browser stub
// (see vitest.config.ts); createRequire loads the real package, as
// backend-connection.ts does.
const nodeRequire = createRequire(import.meta.url);
const { WebSocketServer } = nodeRequire('ws') as { WebSocketServer: typeof WsServer };

const BRIDGE_PREFIX = '/intentd/ws/';
export const CONNECTIONS_PATH = '/__browser-access/connections';
export const LOGIN_PATH = '/__browser-access/login';
const RUNTIME_CONFIG_PATH = '/runtime-config.js';
const IMMUTABLE_PREFIX = '/app/immutable/';
const BACKEND_STORAGE_KEY = 'intent.browserAccess.backend';
/** Same frame cap the daemon applies (PROTOCOL §1.3). */
const MAX_MESSAGE_BYTES = 40 * 1024 * 1024;
const MAX_FORM_BYTES = 4096;

const MIME_TYPES: Record<string, string> = {
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
  '.txt',
]);

/** Localized strings for the login page (main supplies them from Paraglide). */
export interface LoginPageText {
  readonly lang: string;
  readonly title: string;
  readonly prompt: string;
  readonly keyLabel: string;
  readonly submit: string;
  readonly invalidKey: string;
  readonly tooManyAttempts: string;
}

export interface BrowserAccessServerDeps {
  /** Directory holding the web build (`index.html`, `app/immutable/…`). */
  readonly webRoot: string;
  /** Current access key; read per request so a reset applies immediately. */
  readonly getAccessKey: () => string;
  /** Token-free connections list for a tab bound to `backendId`. */
  readonly listConnections: (backendId: string) => Promise<unknown>;
  /** Open a newline-delimited JSON-RPC stream to a backend; emits `connect` once usable. */
  readonly openUpstream: (connectionId: string) => Promise<Duplex>;
  readonly loginText: () => LoginPageText;
  readonly log?: Pick<Console, 'info' | 'warn'>;
  readonly rateLimiter?: LoginRateLimiter;
}

export interface BrowserAccessServer {
  /** Bind 127.0.0.1:`port` (0 picks a free port); resolves with the bound port. */
  listen(port: number): Promise<number>;
  /** Drop every bridged browser (used when the access key is reset). */
  disconnectAll(): void;
  close(): Promise<void>;
}

/** The per-request runtime config script. */
export function runtimeConfigSource(): string {
  const pattern = CONNECTION_ID_PATTERN.source;
  return `(() => {
  const pattern = /${pattern}/;
  const storageKey = ${JSON.stringify(BACKEND_STORAGE_KEY)};
  let backend = new URLSearchParams(location.search).get('backend');
  try {
    if (backend && pattern.test(backend)) sessionStorage.setItem(storageKey, backend);
    else backend = sessionStorage.getItem(storageKey);
  } catch {}
  if (!backend || !pattern.test(backend)) backend = 'local';
  globalThis.__INTENT_RUNTIME_CONFIG__ = Object.freeze({
    intentdWsUrl: ${JSON.stringify(BRIDGE_PREFIX)} + encodeURIComponent(backend),
    backendId: backend,
    connectionsUrl: ${JSON.stringify(CONNECTIONS_PATH)},
  });
})();
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function loginPageHtml(text: LoginPageText, error: string | null): string {
  return `<!doctype html>
<html lang="${escapeHtml(text.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(text.title)}</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
  form { width: min(22rem, calc(100vw - 2rem)); display: grid; gap: 0.75rem; }
  h1 { font-size: 1.25rem; margin: 0; }
  p { margin: 0; opacity: 0.8; }
  input, button { font: inherit; padding: 0.6rem 0.75rem; border-radius: 0.5rem; }
  input { border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: transparent; color: inherit; }
  button { border: 0; cursor: pointer; background: #1f6feb; color: white; }
  .error { color: #d73a49; opacity: 1; }
</style>
</head>
<body>
<form method="post" action="${LOGIN_PATH}">
  <h1>${escapeHtml(text.title)}</h1>
  <p>${escapeHtml(text.prompt)}</p>
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <label for="key">${escapeHtml(text.keyLabel)}</label>
  <input id="key" name="key" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">${escapeHtml(text.submit)}</button>
</form>
</body>
</html>
`;
}

function setSecurityHeaders(response: http.ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
}

function wantsHtml(request: http.IncomingMessage): boolean {
  if (request.headers['sec-fetch-mode'] === 'navigate') return true;
  return String(request.headers.accept ?? '').includes('text/html');
}

function resolveStaticFile(root: string, pathname: string): string | null {
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

function readForm(request: http.IncomingMessage): Promise<URLSearchParams | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_FORM_BYTES) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    request.on('error', () => resolve(null));
  });
}

/**
 * Pipe one browser WebSocket to an upstream newline-delimited stream. Browser
 * frames that arrive before the upstream connects are queued.
 */
function bridgeWebSocket(socket: WsWebSocket, upstreamPromise: Promise<Duplex>): void {
  let upstream: Duplex | null = null;
  let connected = false;
  let closed = false;
  const pending: string[] = [];
  let buffer = '';

  const shutdown = (code: number, reason: string): void => {
    if (closed) return;
    closed = true;
    upstream?.destroy();
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
      socket.close(code, reason.slice(0, 120));
    }
  };

  socket.on('message', (data, isBinary) => {
    if (isBinary || closed) return;
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : Buffer.from(data as ArrayBuffer).toString('utf8');
    if (connected && upstream) upstream.write(`${text}\n`);
    else pending.push(text);
  });
  socket.on('close', () => shutdown(1000, 'browser closed'));
  socket.on('error', () => shutdown(1011, 'browser socket error'));

  upstreamPromise.then(
    (stream) => {
      if (closed) {
        stream.destroy();
        return;
      }
      upstream = stream;
      stream.setEncoding?.('utf8');
      stream.on('connect', () => {
        connected = true;
        for (const text of pending.splice(0)) stream.write(`${text}\n`);
      });
      stream.on('data', (chunk: string | Buffer) => {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.length > MAX_MESSAGE_BYTES)
            return shutdown(1009, 'daemon message exceeds limit');
          if (line.length > 0 && socket.readyState === socket.OPEN) socket.send(line);
        }
        if (buffer.length > MAX_MESSAGE_BYTES) shutdown(1009, 'daemon message exceeds limit');
      });
      stream.on('error', (error: Error) => shutdown(1011, `backend error: ${error.message}`));
      stream.on('close', () => shutdown(1000, 'backend closed'));
      stream.on('end', () => shutdown(1000, 'backend closed'));
    },
    (error: unknown) =>
      shutdown(
        1011,
        `backend unavailable: ${error instanceof Error ? error.message : String(error)}`,
      ),
  );
}

export function createBrowserAccessServer(deps: BrowserAccessServerDeps): BrowserAccessServer {
  const webRoot = path.resolve(deps.webRoot);
  const log = deps.log ?? console;
  const limiter = deps.rateLimiter ?? new LoginRateLimiter();
  const gzipCache = new Map<string, { key: string; data: Promise<Buffer> }>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  const gzipped = (file: string, stat: fs.Stats): Promise<Buffer> => {
    const key = `${stat.mtimeMs}:${stat.size}`;
    const cached = gzipCache.get(file);
    if (cached && cached.key === key) return cached.data;
    const data = fs.promises
      .readFile(file)
      .then(
        (raw) =>
          new Promise<Buffer>((resolve, reject) =>
            zlib.gzip(raw, (error, result) => (error ? reject(error) : resolve(result))),
          ),
      );
    data.catch(() => gzipCache.delete(file));
    gzipCache.set(file, { key, data });
    return data;
  };

  const sendFile = (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    file: string,
    cacheControl: string,
  ): void => {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      response.statusCode = 404;
      response.end();
      return;
    }
    const ext = path.extname(file).toLowerCase();
    response.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', cacheControl);
    const head = request.method === 'HEAD';
    if (COMPRESSIBLE.has(ext)) {
      response.setHeader('Vary', 'Accept-Encoding');
      if (/\bgzip\b/.test(String(request.headers['accept-encoding'] ?? '')) && stat.size > 1024) {
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

  const sendLogin = (response: http.ServerResponse, status: number, error: string | null): void => {
    response.statusCode = status;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(loginPageHtml(deps.loginText(), error));
  };

  const redirect = (response: http.ServerResponse, location: string, cookie?: string): void => {
    response.statusCode = 303;
    response.setHeader('Location', location);
    response.setHeader('Cache-Control', 'no-store');
    if (cookie) response.setHeader('Set-Cookie', cookie);
    response.end();
  };

  /** Validate a submitted key. Returns the Set-Cookie on success, else the page error. */
  const tryLogin = (
    request: http.IncomingMessage,
    candidate: unknown,
  ): { cookie: string } | { error: string; status: number } => {
    const text = deps.loginText();
    if (!limiter.allow()) return { error: text.tooManyAttempts, status: 429 };
    const accessKey = deps.getAccessKey();
    if (!accessKeyMatches(candidate, accessKey)) {
      limiter.recordFailure();
      log.warn('[BrowserAccess] rejected an access key');
      return { error: text.invalidKey, status: 401 };
    }
    const secure = pageOrigin(request.headers)?.startsWith('https:') ?? false;
    return { cookie: sessionCookieHeader(accessKey, secure) };
  };

  const handle = async (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> => {
    setSecurityHeaders(response);
    if (!isAllowedHost(request.headers)) {
      response.statusCode = 403;
      response.end();
      return;
    }
    let url: URL;
    let pathname: string;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      response.statusCode = 400;
      response.end();
      return;
    }

    if (pathname === LOGIN_PATH) {
      if (request.method === 'POST') {
        const form = await readForm(request);
        const result = tryLogin(request, form?.get('key'));
        if ('cookie' in result) return redirect(response, '/', result.cookie);
        return sendLogin(response, result.status, result.error);
      }
      return sendLogin(response, 200, null);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.end();
      return;
    }

    const keyParam = url.searchParams.get('key');
    if (keyParam !== null) {
      const result = tryLogin(request, keyParam);
      if ('error' in result) return sendLogin(response, result.status, result.error);
      url.searchParams.delete('key');
      // Never redirect off-site: `//host` and `/\host` are protocol-relative to browsers.
      const target = /^\/[/\\]/.test(url.pathname) ? '/' : `${url.pathname}${url.search}`;
      return redirect(response, target, result.cookie);
    }

    if (!hasValidSession(request.headers, deps.getAccessKey())) {
      if (wantsHtml(request)) return sendLogin(response, 401, null);
      response.statusCode = 401;
      response.setHeader('Cache-Control', 'no-store');
      response.end();
      return;
    }

    if (pathname === RUNTIME_CONFIG_PATH) {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(request.method === 'HEAD' ? undefined : runtimeConfigSource());
      return;
    }
    if (pathname === CONNECTIONS_PATH) {
      const backend = url.searchParams.get('backend') ?? 'local';
      if (!CONNECTION_ID_PATTERN.test(backend)) {
        response.statusCode = 400;
        response.end();
        return;
      }
      try {
        const body = JSON.stringify(await deps.listConnections(backend));
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(request.method === 'HEAD' ? undefined : body);
      } catch (error) {
        log.warn('[BrowserAccess] listing connections failed', error);
        response.statusCode = 500;
        response.end();
      }
      return;
    }
    if (pathname.startsWith(BRIDGE_PREFIX)) {
      response.statusCode = 426;
      response.setHeader('Connection', 'close');
      response.setHeader('Upgrade', 'websocket');
      response.end();
      return;
    }

    const file = resolveStaticFile(webRoot, pathname);
    if (file) {
      const immutable = pathname.startsWith(IMMUTABLE_PREFIX);
      return sendFile(
        request,
        response,
        file,
        immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    }
    if (wantsHtml(request))
      return sendFile(request, response, path.join(webRoot, 'index.html'), 'no-cache');
    response.statusCode = 404;
    response.end();
  };

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      log.warn('[BrowserAccess] request failed', error);
      if (!response.headersSent) response.statusCode = 500;
      response.end();
    });
  });

  const rejectUpgrade = (socket: Duplex, status: number, reason: string): void => {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  };

  server.on('upgrade', (request: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    let connectionId: string;
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (!pathname.startsWith(BRIDGE_PREFIX)) return rejectUpgrade(socket, 404, 'Not Found');
      connectionId = decodeURIComponent(pathname.slice(BRIDGE_PREFIX.length));
    } catch {
      return rejectUpgrade(socket, 400, 'Bad Request');
    }
    if (!CONNECTION_ID_PATTERN.test(connectionId)) return rejectUpgrade(socket, 400, 'Bad Request');
    if (
      !isAllowedHost(request.headers) ||
      !hasValidSession(request.headers, deps.getAccessKey()) ||
      !isSameOriginUpgrade(request.headers)
    ) {
      log.warn('[BrowserAccess] rejected a WebSocket upgrade');
      return rejectUpgrade(socket, 403, 'Forbidden');
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      log.info(`[BrowserAccess] bridging a browser to backend ${connectionId}`);
      bridgeWebSocket(ws, deps.openUpstream(connectionId));
    });
  });

  return {
    listen(port: number): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    disconnectAll(): void {
      for (const client of wss.clients) client.close(4401, 'access key reset');
    },
    close(): Promise<void> {
      for (const client of wss.clients) client.terminate();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
