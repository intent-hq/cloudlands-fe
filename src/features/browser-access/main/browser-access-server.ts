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
  parseCookies,
  sessionCookieHeader,
} from './browser-access-auth';
import { DEVICE_LOGIN_TTL_MS, DeviceLoginStore, LinkTokenVerifier } from './device-login';

// `ws` is CJS and the vitest suite aliases the ESM import to a browser stub
// (see vitest.config.ts); createRequire loads the real package, as
// backend-connection.ts does.
const nodeRequire = createRequire(import.meta.url);
const { WebSocketServer } = nodeRequire('ws') as { WebSocketServer: typeof WsServer };

const BRIDGE_PREFIX = '/intentd/ws/';
export const CONNECTIONS_PATH = '/__browser-access/connections';
export const LOGIN_PATH = '/__browser-access/login';
/** QR sign-in: the page the QR opens on the approving device. */
export const APPROVE_PATH = '/__browser-access/approve';
/** QR sign-in: polled by the waiting browser. */
export const DEVICE_POLL_PATH = '/__browser-access/device/poll';
/** One-time sign-in links (`intent-web link`). */
export const LINK_PATH = '/__browser-access/link';
/** HttpOnly cookie holding a waiting browser's QR request secret. */
export const PENDING_COOKIE = 'intent_browser_access_pending';
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

/** Strings for QR sign-in and one-time links. */
export interface DeviceLoginText {
  readonly qrTitle: string;
  readonly qrPrompt: string;
  readonly matchLabel: string;
  readonly keyFallback: string;
  readonly approveTitle: string;
  readonly approvePrompt: string;
  readonly approveSubmit: string;
  readonly approved: string;
  readonly expired: string;
  readonly linkInvalid: string;
}

/** Turns on QR sign-in and one-time links (Intent Web only). */
interface DeviceLoginOptions {
  readonly text: () => DeviceLoginText;
  /** Render a QR code for a URL as an inline `<svg>` element. */
  readonly renderQr: (url: string) => Promise<string>;
  readonly store?: DeviceLoginStore;
  readonly links?: LinkTokenVerifier;
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
  /** Runs only after Host and session validation. The host validates mutations. */
  readonly handleAuthenticatedRequest?: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => Promise<boolean>;
  readonly runtimeConfig?: () => string | Promise<string>;
  /** Called after a browser bridge opens or closes (see `bridgedBackendIds`). */
  readonly onBridgesChanged?: () => void;
  /** QR sign-in and one-time links; off when absent (desktop Browser access). */
  readonly deviceLogin?: DeviceLoginOptions;
}

export interface BrowserAccessServer {
  /** Bind 127.0.0.1:`port` (0 picks a free port); resolves with the bound port. */
  listen(port: number): Promise<number>;
  /** Drop every bridged browser (used when the access key is reset). */
  disconnectAll(): void;
  disconnectBackend?(connectionId: string): void;
  /** Backends with at least one live browser bridge. */
  bridgedBackendIds?(): Set<string>;
  listenSocket?(socketPath: string): Promise<void>;
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

interface QrPanel {
  readonly text: DeviceLoginText;
  readonly svg: string;
  readonly matchCode: string;
  readonly destinations: { home: string; fresh: string };
}

const PAGE_STYLE = `  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
  form, main { width: min(22rem, calc(100vw - 2rem)); display: grid; gap: 0.75rem; }
  h1 { font-size: 1.25rem; margin: 0; }
  h2 { font-size: 1rem; margin: 0; }
  p { margin: 0; opacity: 0.8; }
  input, button { font: inherit; padding: 0.6rem 0.75rem; border-radius: 0.5rem; }
  input { border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: transparent; color: inherit; }
  button { border: 0; cursor: pointer; background: #1f6feb; color: white; }
  .error { color: #d73a49; opacity: 1; }
  .qr { display: grid; gap: 0.5rem; justify-items: center; text-align: center; }
  .qr svg { width: 12rem; height: 12rem; background: white; padding: 0.5rem; border-radius: 0.5rem; }
  .match { font: 600 1.5rem ui-monospace, monospace; letter-spacing: 0.15em; opacity: 1; }
  hr { width: 100%; border: 0; border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent); }`;

/**
 * Where the QR page goes after approval (`home`) and to get a fresh QR (`fresh`).
 * Sign-in routes such as a rejected one-time link go to the app root, and a rejected
 * `?key=` is dropped, so neither is retried; app deep links are kept.
 */
export function qrDestinations(requestUrl: string | undefined): { home: string; fresh: string } {
  let url: URL;
  try {
    url = new URL(requestUrl ?? '/', 'http://localhost');
  } catch {
    return { home: '/', fresh: LOGIN_PATH };
  }
  if (url.pathname.startsWith('/__browser-access/')) return { home: '/', fresh: LOGIN_PATH };
  url.searchParams.delete('key');
  // Never leave the site: `//host` and `/\host` are protocol-relative to browsers.
  const target = /^\/[/\\]/.test(url.pathname) ? '/' : `${url.pathname}${url.search}`;
  return { home: target, fresh: target };
}

/** JSON for an inline script, safe against `</script>` in the value. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Polls for approval; reloads for a fresh QR when the request expires. */
function pollScript(destinations: { home: string; fresh: string }): string {
  return `<script>
(() => {
  const home = ${scriptJson(destinations.home)};
  const fresh = ${scriptJson(destinations.fresh)};
  const poll = async () => {
    try {
      const response = await fetch(${scriptJson(DEVICE_POLL_PATH)}, { cache: 'no-store', credentials: 'same-origin' });
      const { status } = await response.json();
      if (status === 'approved') return location.replace(home);
      if (status === 'expired') return location.replace(fresh);
    } catch {}
    setTimeout(poll, 2000);
  };
  setTimeout(poll, 2000);
})();
</script>`;
}

function qrPanelHtml(panel: QrPanel): string {
  return `<section class="qr" aria-labelledby="qr-title">
  <h2 id="qr-title">${escapeHtml(panel.text.qrTitle)}</h2>
  ${panel.svg}
  <p>${escapeHtml(panel.text.qrPrompt)}</p>
  <p>${escapeHtml(panel.text.matchLabel)}</p>
  <p class="match" data-testid="match-code">${escapeHtml(panel.matchCode)}</p>
</section>
<hr>
<p>${escapeHtml(panel.text.keyFallback)}</p>`;
}

function messagePageHtml(lang: string, title: string, message: string, isError: boolean): string {
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>
${PAGE_STYLE}
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p${isError ? ' class="error" role="alert"' : ' role="status"'}>${escapeHtml(message)}</p>
</main>
</body>
</html>
`;
}

function approvePageHtml(
  login: LoginPageText,
  text: DeviceLoginText,
  code: string,
  matchCode: string,
  error: string | null,
): string {
  return `<!doctype html>
<html lang="${escapeHtml(login.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(text.approveTitle)}</title>
<style>
${PAGE_STYLE}
</style>
</head>
<body>
<form method="post" action="${APPROVE_PATH}">
  <h1>${escapeHtml(text.approveTitle)}</h1>
  <p>${escapeHtml(text.approvePrompt)}</p>
  <p>${escapeHtml(text.matchLabel)}</p>
  <p class="match" data-testid="match-code">${escapeHtml(matchCode)}</p>
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <input type="hidden" name="code" value="${escapeHtml(code)}">
  <label for="key">${escapeHtml(login.keyLabel)}</label>
  <input id="key" name="key" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">${escapeHtml(text.approveSubmit)}</button>
</form>
</body>
</html>
`;
}

function loginPageHtml(
  text: LoginPageText,
  error: string | null,
  qr: QrPanel | null = null,
): string {
  if (qr) {
    return `<!doctype html>
<html lang="${escapeHtml(text.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(text.title)}</title>
<style>
${PAGE_STYLE}
</style>
</head>
<body>
<form method="post" action="${LOGIN_PATH}">
  <h1>${escapeHtml(text.title)}</h1>
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  ${qrPanelHtml(qr)}
  <label for="key">${escapeHtml(text.keyLabel)}</label>
  <input id="key" name="key" type="password" autocomplete="current-password" required>
  <button type="submit">${escapeHtml(text.submit)}</button>
</form>
${pollScript(qr.destinations)}
</body>
</html>
`;
  }
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
function bridgeWebSocket(
  socket: WsWebSocket,
  upstreamPromise: Promise<Duplex>,
): (code: number, reason: string) => void {
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
  /** Revoke the bridge now: drop the backend and the socket without waiting for the browser. */
  const revoke = (code: number, reason: string): void => {
    shutdown(code, reason);
    socket.terminate();
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
  return revoke;
}

export function createBrowserAccessServer(deps: BrowserAccessServerDeps): BrowserAccessServer {
  const webRoot = path.resolve(deps.webRoot);
  const log = deps.log ?? console;
  const limiter = deps.rateLimiter ?? new LoginRateLimiter();
  const gzipCache = new Map<string, { key: string; data: Promise<Buffer> }>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  /** Live bridges, revoked synchronously on key reset and shutdown. */
  const bridges = new Map<(code: number, reason: string) => void, string>();

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

  const device = deps.deviceLogin ?? null;
  const deviceStore = device ? (device.store ?? new DeviceLoginStore()) : null;
  const links = device ? (device.links ?? new LinkTokenVerifier()) : null;

  const isSecure = (request: http.IncomingMessage): boolean =>
    pageOrigin(request.headers)?.startsWith('https:') ?? false;

  const pendingCookie = (secret: string, secure: boolean, maxAgeSeconds: number): string =>
    [
      `${PENDING_COOKIE}=${secret}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAgeSeconds}`,
      ...(secure ? ['Secure'] : []),
    ].join('; ');

  /** The QR panel for a sign-in page, reusing the browser's live request. */
  const qrPanel = async (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<QrPanel | null> => {
    if (!device || !deviceStore) return null;
    const origin = pageOrigin(request.headers);
    if (!origin) return null;
    const accessKey = deps.getAccessKey();
    const cookie = parseCookies(request.headers.cookie).get(PENDING_COOKIE);
    const pending = deviceStore.pending(cookie, accessKey) ?? deviceStore.create(accessKey);
    const approveUrl = `${origin}${APPROVE_PATH}?code=${encodeURIComponent(pending.approveCode)}`;
    const svg = await device.renderQr(approveUrl);
    const maxAge = Math.ceil(
      Math.min(DEVICE_LOGIN_TTL_MS, Math.max(1000, pending.expiresAt - Date.now())) / 1000,
    );
    response.setHeader('Set-Cookie', pendingCookie(pending.secret, isSecure(request), maxAge));
    return {
      text: device.text(),
      svg,
      matchCode: pending.matchCode,
      destinations: qrDestinations(request.url),
    };
  };

  const sendLogin = async (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    status: number,
    error: string | null,
  ): Promise<void> => {
    const qr = await qrPanel(request, response);
    response.statusCode = status;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(loginPageHtml(deps.loginText(), error, qr));
  };

  const sendHtml = (response: http.ServerResponse, status: number, html: string): void => {
    response.statusCode = status;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(html);
  };

  /** QR approval, approval polling and one-time links. Returns false for other paths. */
  const handleDeviceLogin = async (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
    pathname: string,
  ): Promise<boolean> => {
    if (!device || !deviceStore || !links) return false;
    const login = deps.loginText();
    const accessKey = deps.getAccessKey();

    if (pathname === DEVICE_POLL_PATH && request.method === 'GET') {
      const status = deviceStore.claim(
        parseCookies(request.headers.cookie).get(PENDING_COOKIE),
        accessKey,
      );
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      if (status === 'approved') {
        const secure = isSecure(request);
        response.setHeader('Set-Cookie', [
          sessionCookieHeader(accessKey, secure),
          pendingCookie('', secure, 0),
        ]);
        log.info('[BrowserAccess] signed in a browser by QR approval');
      }
      response.end(JSON.stringify({ status }));
      return true;
    }

    if (pathname === APPROVE_PATH && (request.method === 'GET' || request.method === 'POST')) {
      const text = device.text();
      const page = (status: number, title: string, message: string, isError: boolean) =>
        sendHtml(response, status, messagePageHtml(login.lang, title, message, isError));
      const form = request.method === 'POST' ? await readForm(request) : null;
      const code = request.method === 'POST' ? form?.get('code') : url.searchParams.get('code');
      if (!limiter.allow()) {
        page(429, text.approveTitle, login.tooManyAttempts, true);
        return true;
      }
      const target = deviceStore.lookup(code, accessKey);
      if (!target || typeof code !== 'string') {
        limiter.recordFailure();
        page(410, text.approveTitle, text.expired, true);
        return true;
      }
      if (request.method === 'GET') {
        sendHtml(response, 200, approvePageHtml(login, text, code, target.matchCode, null));
        return true;
      }
      if (!accessKeyMatches(form?.get('key'), accessKey)) {
        limiter.recordFailure();
        log.warn('[BrowserAccess] rejected an access key for a QR sign-in');
        sendHtml(
          response,
          401,
          approvePageHtml(login, text, code, target.matchCode, login.invalidKey),
        );
        return true;
      }
      if (deviceStore.approve(code, accessKey)) page(200, text.approveTitle, text.approved, false);
      else page(410, text.approveTitle, text.expired, true);
      return true;
    }

    if (pathname === LINK_PATH && request.method === 'GET') {
      if (!limiter.allow()) {
        await sendLogin(request, response, 429, login.tooManyAttempts);
        return true;
      }
      if (!links.redeem(url.searchParams.get('t'), accessKey)) {
        limiter.recordFailure();
        log.warn('[BrowserAccess] rejected a sign-in link');
        await sendLogin(request, response, 401, device.text().linkInvalid);
        return true;
      }
      log.info('[BrowserAccess] signed in a browser with a one-time link');
      redirect(response, '/', sessionCookieHeader(accessKey, isSecure(request)));
      return true;
    }
    return false;
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
    return { cookie: sessionCookieHeader(accessKey, isSecure(request)) };
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
        return sendLogin(request, response, result.status, result.error);
      }
      return sendLogin(request, response, 200, null);
    }

    if (await handleDeviceLogin(request, response, url, pathname)) return;

    const keyParam = request.method === 'GET' ? url.searchParams.get('key') : null;
    if (keyParam !== null) {
      const result = tryLogin(request, keyParam);
      if ('error' in result) return sendLogin(request, response, result.status, result.error);
      url.searchParams.delete('key');
      // Never redirect off-site: `//host` and `/\host` are protocol-relative to browsers.
      const target = /^\/[/\\]/.test(url.pathname) ? '/' : `${url.pathname}${url.search}`;
      return redirect(response, target, result.cookie);
    }

    if (!hasValidSession(request.headers, deps.getAccessKey())) {
      if (wantsHtml(request)) return sendLogin(request, response, 401, null);
      response.statusCode = 401;
      response.setHeader('Cache-Control', 'no-store');
      response.end();
      return;
    }

    if (await deps.handleAuthenticatedRequest?.(request, response)) return;

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.end();
      return;
    }

    if (pathname === RUNTIME_CONFIG_PATH) {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(
        request.method === 'HEAD'
          ? undefined
          : await (deps.runtimeConfig?.() ?? runtimeConfigSource()),
      );
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
      const revoke = bridgeWebSocket(ws, deps.openUpstream(connectionId));
      bridges.set(revoke, connectionId);
      deps.onBridgesChanged?.();
      ws.once('close', () => {
        bridges.delete(revoke);
        deps.onBridgesChanged?.();
      });
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
    listenSocket(socketPath: string): Promise<void> {
      if (process.platform === 'win32')
        return Promise.reject(new Error('Windows supports loopback TCP only'));
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        // Create with private permissions from the outset, before accepting requests.
        const mask = process.umask(0o177);
        try {
          server.listen(socketPath, () => {
            server.off('error', reject);
            try {
              fs.chmodSync(socketPath, 0o600);
              resolve();
            } catch (error) {
              server.close();
              reject(error);
            }
          });
        } finally {
          process.umask(mask);
        }
      });
    },
    bridgedBackendIds(): Set<string> {
      return new Set(bridges.values());
    },
    disconnectBackend(connectionId: string): void {
      for (const [revoke, id] of bridges) {
        if (id === connectionId) {
          revoke(4401, 'connection removed');
          bridges.delete(revoke);
        }
      }
    },
    disconnectAll(): void {
      for (const revoke of [...bridges.keys()]) revoke(4401, 'access key reset');
      bridges.clear();
    },
    close(): Promise<void> {
      for (const revoke of [...bridges.keys()]) revoke(1001, 'browser access stopped');
      bridges.clear();
      for (const client of wss.clients) client.terminate();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
