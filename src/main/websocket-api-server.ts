/**
 * WebSocket API Server
 *
 * Runs its own HTTP server on a dedicated port (bound to 0.0.0.0 for LAN access)
 * and provides an authenticated WebSocket endpoint at `/ws`. Validates bearer
 * tokens on upgrade, manages heartbeat ping/pong, and exposes a broadcast helper.
 *
 * Lifecycle hardening (mirrors `http-mcp-bridge.ts`):
 *   - Origin allow-list in handleUpgrade (cross-origin browser upgrades → 403;
 *     non-browser native clients without Origin are accepted).
 *   - Single-flight start()/stop() — concurrent start() callers share one
 *     in-flight promise; stop() during an in-flight start() cancels it.
 *   - Async stop() awaits both wss.close() and httpServer.close().
 *   - Post-listen `httpServer.on('error', …)` so EADDRINUSE / runtime errors
 *     don't escape to `uncaughtException`.
 *   - Shared `findAvailablePort` + per-attempt `listenOnce` (same-port backoff
 *     before falling through to the next port).
 */

import { createServer as createHttpsServer, type Server as HttpsServer } from 'https';
import { type IncomingMessage } from 'http';
import { type Duplex } from 'stream';
import { URL } from 'url';
import * as os from 'os';
import type { WebSocket as WebSocketType, WebSocketServer as WebSocketServerType } from 'ws';
import { Logger } from '../shared/logger';
import { validateToken, extractBearerToken, isWebSocketApiEnabled } from './websocket-auth';
import { handleWebSocketMessage } from './websocket-protocol-handler';
import {
  handleSubscribe,
  handleUnsubscribe,
  cleanupClient,
  cleanupAllClients,
  registerSendCallback,
} from './websocket-event-bridge';
import { ensureTlsCertificate, getCertFingerprint } from './websocket-tls';
import { getWebSocketClass, getWebSocketServerClass } from './utils/ws-runtime';
import { findAvailablePort } from '../utils/port-utils';

const logger = new Logger('WebSocketApiServer');
const WebSocket = getWebSocketClass();
const WebSocketServer = getWebSocketServerClass();
type WebSocket = WebSocketType;
type WebSocketServer = InstanceType<typeof WebSocketServerType>;

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const HEARTBEAT_TIMEOUT_MS = 60_000; // 60 seconds — disconnect if no pong

// Backoff schedule for same-port EADDRINUSE retries before falling through to
// the next port. Mirrors HTTP_MCP_LISTEN_BACKOFF_MS in http-mcp-bridge.ts.
export const WS_API_LISTEN_BACKOFF_MS: number[] = [100, 200, 400];
// Maximum number of distinct ports to try before giving up.
export const WS_API_MAX_PORT_ATTEMPTS = 10;

interface ClientMeta {
  isAlive: boolean;
  lastPong: number;
  connectedAt: number;
}

/**
 * Origin allow-list for WebSocket upgrade requests.
 *
 * Returns true when the upgrade should be accepted:
 *   - `origin === undefined` → native (non-browser) clients (iOS, CLI). These
 *     never send an Origin header and must be allowed through.
 *   - `file://` → Electron renderer.
 *   - hostname is loopback (localhost, 127.0.0.1, [::1], ::1).
 *   - hostname matches the host's hostname (advertised via Bonjour/mDNS so
 *     LAN clients can connect by hostname).
 */
export function isAllowedWebSocketApiOrigin(origin: string | undefined): boolean {
  if (origin === undefined || origin === '') return true;
  if (origin === 'null') return false; // sandboxed/data: contexts
  if (origin === 'file://' || origin.startsWith('file://')) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  ) {
    return true;
  }
  // Strip [] from IPv6 literals and compare against os.hostname() (and its
  // .local form, since Bonjour advertises e.g. "Clement.local").
  const cleanHost = hostname.replace(/^\[|\]$/g, '');
  const localHost = os.hostname().toLowerCase();
  if (
    cleanHost === localHost ||
    cleanHost === `${localHost}.local` ||
    `${cleanHost}.local` === localHost
  ) {
    return true;
  }
  return false;
}

export class WebSocketApiServer {
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private clients: Map<WebSocket, ClientMeta> = new Map();
  private clientsById: Map<string, WebSocket> = new Map();
  private unregisterSendCallback: (() => void) | null = null;
  private httpServer: HttpsServer | null = null;
  private started = false;
  private port: number;
  private actualPort: number = 0;
  // In-flight start() promise — concurrent callers share it.
  private startPromise: Promise<void> | null = null;
  // Set true by stop() so an in-flight start() retry loop aborts cleanly
  // instead of binding a new listener after the server has been torn down.
  // Cleared at the top of the next start() call.
  private shuttingDown = false;
  // Monotonic counter incremented by every external stop() call. start()
  // captures this at entry and aborts if it changes, so an external stop()
  // racing with an in-flight start() cannot be "undone" by a late listen().
  private externalStopGeneration = 0;
  // Exposed as a hook for tests that need shorter backoff than production.
  protected listenBackoffMs: number[] = WS_API_LISTEN_BACKOFF_MS;

  constructor(port: number = 5180) {
    this.port = port;
  }

  /** Get the actual port the server is bound to (0 if not started). */
  getPort(): number {
    return this.actualPort;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Get the SHA-256 fingerprint of the TLS certificate.
   * Returns null if the server hasn't started yet.
   */
  getCertFingerprint(): string | null {
    return getCertFingerprint();
  }

  /**
   * Attempt a single listen() on (port, host). Resolves with the bound
   * server+wss on success, or with { error } on failure. Never throws.
   * Attaches `on('error')` BEFORE calling listen so EADDRINUSE can never
   * escape to `uncaughtException`. After successful listen, installs a
   * durable post-listen error handler so runtime errors are logged rather
   * than crashing the main process.
   */
  private listenOnce(
    port: number,
    host: string,
    tlsCert: { cert: string; key: string },
  ): Promise<
    | { server: HttpsServer; wss: WebSocketServer }
    | { error: NodeJS.ErrnoException }
  > {
    return new Promise((resolve) => {
      const wss = new WebSocketServer({ noServer: true });
      wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        this.onConnection(ws, req);
      });

      const server = createHttpsServer(
        { cert: tlsCert.cert, key: tlsCert.key },
        (_req, res) => {
          // Simple health endpoint
          if (_req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', clients: this.clients.size }));
            return;
          }
          res.writeHead(404);
          res.end();
        },
      );

      server.on('upgrade', this.handleUpgrade);

      let settled = false;
      const onError = (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        try {
          server.removeListener('error', onError);
        } catch {
          /* ignore */
        }
        // Release any partially-acquired resources from this attempt.
        try {
          wss.close();
        } catch {
          /* ignore */
        }
        try {
          server.removeListener('upgrade', this.handleUpgrade);
        } catch {
          /* ignore */
        }
        try {
          server.close(() => {});
        } catch {
          /* ignore */
        }
        resolve({ error });
      };
      // Attach error handler BEFORE listen — invariant that prevents
      // EADDRINUSE from reaching process.on('uncaughtException').
      server.once('error', onError);

      server.listen(port, '0.0.0.0', () => {
        if (settled) return;
        settled = true;
        try {
          server.removeListener('error', onError);
        } catch {
          /* ignore */
        }
        // Install a durable post-listen error handler so runtime errors from
        // the HTTPS server are logged rather than treated as unhandled 'error'
        // events by Node (which would crash the main process).
        server.on('error', (err: NodeJS.ErrnoException) => {
          logger.warn('WebSocket API server error after listening', {
            code: err.code,
            message: err.message,
          });
        });
        // Same for the WSS for symmetry.
        wss.on('error', (err: Error) => {
          logger.warn('WebSocket API WSS error after listening', {
            message: err.message,
          });
        });
        resolve({ server, wss });
      });
    });
  }

  /**
   * Start accepting WebSocket connections.
   * Creates a dedicated HTTPS server bound to 0.0.0.0 for LAN access.
   *
   * Single-flight: concurrent callers share one in-flight promise. Calling
   * start() while the server is already started is a no-op.
   */
  async start(): Promise<void> {
    if (this.started) {
      logger.warn('WebSocketApiServer already started');
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.doStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    // Capture the external-stop generation at entry. If an external stop()
    // increments it while we are running, we abort instead of binding — even
    // if our own code has since cleared `shuttingDown`.
    const genAtEntry = this.externalStopGeneration;
    // Fresh start clears any prior stop() shutdown marker.
    this.shuttingDown = false;

    // Load or generate TLS certificate
    const tlsCert = await ensureTlsCertificate();

    // Best-effort advisory pre-check: ask for an available port. Keep the
    // call for its validation side-effects only; let the retry loop own
    // port choice (mirrors http-mcp-bridge behaviour).
    try {
      await findAvailablePort(this.port, WS_API_MAX_PORT_ATTEMPTS);
    } catch (error) {
      logger.warn(`Could not find available port, trying default ${this.port}:`, error);
    }

    const host = '0.0.0.0';
    const startPort = this.port;
    let boundServer: HttpsServer | null = null;
    let boundWss: WebSocketServer | null = null;
    let boundPort = -1;
    let lastError: NodeJS.ErrnoException | null = null;

    const isAborted = (): boolean =>
      this.shuttingDown || this.externalStopGeneration !== genAtEntry;

    for (let portOffset = 0; portOffset < WS_API_MAX_PORT_ATTEMPTS; portOffset++) {
      if (isAborted()) {
        logger.info('WebSocketApiServer.start(): aborting port retry, stop() in progress');
        return;
      }
      const tryPort = startPort + portOffset;

      // Same-port backoff: retry a held port a few times before falling
      // through to the next port.
      const backoff = this.listenBackoffMs;
      const maxSamePortAttempts = backoff.length + 1;
      for (let attempt = 0; attempt < maxSamePortAttempts; attempt++) {
        if (isAborted()) {
          logger.info('WebSocketApiServer.start(): aborting port retry, stop() in progress');
          return;
        }
        const result = await this.listenOnce(tryPort, host, tlsCert);
        if ('server' in result) {
          boundServer = result.server;
          boundWss = result.wss;
          boundPort = tryPort;
          break;
        }
        lastError = result.error;
        if (result.error.code !== 'EADDRINUSE') {
          logger.error('WebSocket API server listen error (not retrying):', result.error);
          throw result.error;
        }
        if (attempt < backoff.length) {
          logger.warn(
            `WS API port ${tryPort} in use, waiting ${backoff[attempt]}ms before retry...`,
          );
          await new Promise((r) => setTimeout(r, backoff[attempt]));
          if (isAborted()) {
            logger.info(
              'WebSocketApiServer.start(): aborting after backoff sleep, stop() in progress',
            );
            return;
          }
        }
      }

      if (boundServer) break;
      logger.warn(
        `WS API port ${tryPort} still in use after ${maxSamePortAttempts} attempts, trying next port`,
      );
    }

    // If we were asked to shut down and somehow bound a server, close it
    // immediately and return — don't publish it.
    if (isAborted() && boundServer) {
      try {
        boundServer.close();
      } catch {
        /* ignore */
      }
      try {
        boundWss?.close();
      } catch {
        /* ignore */
      }
      logger.info(
        'WebSocketApiServer.start(): discarded newly-bound server, stop() in progress',
      );
      return;
    }

    if (!boundServer || !boundWss) {
      const err =
        lastError ??
        Object.assign(new Error('WebSocketApiServer: no ports available'), {
          code: 'EADDRINUSE',
        });
      logger.error(
        `WebSocketApiServer: could not bind to any port in range ${startPort}-${startPort + WS_API_MAX_PORT_ATTEMPTS - 1}`,
        err,
      );
      throw err;
    }

    this.httpServer = boundServer;
    this.wss = boundWss;
    this.actualPort = boundPort;

    // Register send callback for the event bridge. Keep the unregister handle
    // so stop() releases the process-global closure over this server instance.
    this.unregisterSendCallback?.();
    this.unregisterSendCallback = registerSendCallback((targetClientId: string, message: string) => {
      const targetWs = this.clientsById.get(targetClientId);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(message);
      }
    });

    this.startHeartbeat();
    this.started = true;
    logger.info(`WebSocket API server started on wss://0.0.0.0:${this.actualPort}/ws`, {
      fingerprint: tlsCert.fingerprint256,
    });
  }

  /**
   * Stop the WebSocket server, close all connections, and shut down the HTTP
   * server. Awaits both wss.close() and httpServer.close() so callers can
   * reliably toggle off → toggle on without EADDRINUSE races.
   */
  async stop(): Promise<void> {
    // External stops bump the generation counter so an in-flight start()
    // can observe "external stop fired while I was running" and abort
    // before its retry loop binds a new listener.
    this.externalStopGeneration++;
    this.shuttingDown = true;

    // If a start() is in flight, wait briefly for it to settle so we tear
    // down whatever it bound. The externalStopGeneration bump above is
    // what guarantees correctness if the inflight start outlives this wait.
    const inflight = this.startPromise;
    if (inflight) {
      try {
        await Promise.race([
          inflight.catch(() => {
            /* ignore — start() errors are surfaced to its caller */
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 1000)),
        ]);
      } catch {
        /* ignore */
      }
      // Re-assert in case start() flipped it.
      this.shuttingDown = true;
    }

    if (!this.started) {
      // Nothing was published; still clear any partial state.
      this.unregisterSendCallback?.();
      this.unregisterSendCallback = null;
      this.actualPort = 0;
      return;
    }

    this.stopHeartbeat();

    // Clean up event bridge subscriptions for every client before closing
    // sockets. Prevents subscription leaks if a socket is already dead or
    // close events don't fire.
    for (const [clientId] of this.clientsById) {
      cleanupClient(clientId);
    }
    cleanupAllClients();

    // Close every client
    for (const [ws] of this.clients) {
      try {
        ws.close(1001, 'Server shutting down');
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.clientsById.clear();
    this.unregisterSendCallback?.();
    this.unregisterSendCallback = null;

    // Remove the 'upgrade' listener BEFORE nulling/closing wss so an
    // in-flight upgrade can't reach handleUpgrade after this.wss is null.
    const httpServer = this.httpServer;
    this.httpServer = null;
    if (httpServer) {
      try {
        httpServer.removeListener('upgrade', this.handleUpgrade);
      } catch {
        /* ignore */
      }
    }

    // Close WSS first: terminate any lingering clients, then close. If we
    // close the HTTP server first, the WSS can linger holding refs.
    const wss = this.wss;
    this.wss = null;
    if (wss) {
      try {
        for (const client of wss.clients) {
          try {
            client.terminate();
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
      await new Promise<void>((resolve) => {
        try {
          wss.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }

    if (httpServer) {
      await new Promise<void>((resolve) => {
        try {
          httpServer.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }

    this.started = false;
    this.actualPort = 0;
    logger.info('WebSocket API server stopped');
  }

  /** Whether the server is currently running. */
  isRunning(): boolean {
    return this.started;
  }

  /** Number of currently connected clients. */
  get connectedClients(): number {
    return this.clients.size;
  }

  // ── Upgrade handling ───────────────────────────────────────────────────

  /**
   * Arrow function so `this` is bound when used as an event listener.
   */
  private handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    // Guard against races during stop(): if wss has been nulled, refuse the
    // upgrade rather than dereferencing null below.
    if (!this.wss) {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      return;
    }

    // Only handle /ws path
    const pathname = this.getPathname(req);
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // Gate: is the API enabled?
    if (!isWebSocketApiEnabled()) {
      logger.warn('WebSocket API connection rejected — API disabled');
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Origin allow-list: cross-origin browser upgrades are rejected with 403.
    // Native clients (iOS, CLI) don't send an Origin header and pass through.
    const originHeader = req.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    if (!isAllowedWebSocketApiOrigin(origin)) {
      logger.warn('WebSocket API connection rejected — disallowed origin', { origin });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Authenticate
    const token = this.extractToken(req);
    if (!token || !validateToken(token)) {
      logger.warn('WebSocket API connection rejected — invalid token');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Upgrade
    logger.info('Upgrading WebSocket connection', {
      path: this.getPathname(req),
      headers: {
        host: req.headers.host,
        origin: req.headers.origin,
        'sec-websocket-version': req.headers['sec-websocket-version'],
        'sec-websocket-key': req.headers['sec-websocket-key'],
      },
      remoteAddress: req.socket?.remoteAddress,
    });
    this.wss!.handleUpgrade(req, socket, head, (ws) => {
      this.wss!.emit('connection', ws, req);
    });
  };

  // ── Connection management ──────────────────────────────────────────────

  private onConnection(ws: WebSocket, _req: IncomingMessage): void {
    const clientId = `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const meta: ClientMeta = {
      isAlive: true,
      lastPong: Date.now(),
      connectedAt: Date.now(),
    };
    this.clients.set(ws, meta);
    this.clientsById.set(clientId, ws);

    logger.info('WebSocket client connected', {
      clientId,
      totalClients: this.clients.size,
      url: this.getPathname(_req),
      remoteAddress: _req.socket?.remoteAddress,
    });

    ws.on('message', async (raw) => {
      const message = raw.toString();
      logger.debug('WebSocket received message', { clientId, messageLength: message.length, messagePreview: message.substring(0, 200) });

      // Try to parse for event bridge routing
      try {
        const parsed = JSON.parse(message);

        // Validate JSON-RPC 2.0 shape before handling event methods.
        // If validation fails, fall through to the protocol handler which
        // returns proper JSON-RPC error responses.
        const isValidJsonRpc =
          typeof parsed === 'object' &&
          parsed !== null &&
          !Array.isArray(parsed) &&
          parsed.jsonrpc === '2.0' &&
          typeof parsed.method === 'string';

        const hasId = 'id' in parsed;

        // Validate id type for event fast-path (same check as parseMessage)
        if ('id' in parsed && parsed.id !== null && typeof parsed.id !== 'string' && typeof parsed.id !== 'number') {
          // Fall through to protocol handler which returns proper error
        } else if (isValidJsonRpc && parsed.method === 'events.subscribe') {
          try {
            const result = handleSubscribe(clientId, parsed.params || {});
            if (hasId) {
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: parsed.id ?? null, result }));
            }
          } catch (err) {
            if (hasId) {
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: parsed.id ?? null,
                error: { code: -32602, message: (err as Error).message },
              }));
            }
          }
          return;
        } else if (isValidJsonRpc && parsed.method === 'events.unsubscribe') {
          try {
            const result = handleUnsubscribe(clientId, parsed.params || {});
            if (hasId) {
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: parsed.id ?? null, result: { success: result } }));
            }
          } catch (err) {
            if (hasId) {
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: parsed.id ?? null,
                error: { code: -32602, message: (err as Error).message },
              }));
            }
          }
          return;
        }
      } catch {
        /* JSON parse failed — fall through to protocol handler */
      }

      const response = await handleWebSocketMessage(message);
      if (response) ws.send(response);
    });

    ws.on('pong', () => {
      const m = this.clients.get(ws);
      if (m) {
        m.isAlive = true;
        m.lastPong = Date.now();
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      cleanupClient(clientId);
      this.clients.delete(ws);
      this.clientsById.delete(clientId);
      logger.info('WebSocket client disconnected', { clientId, totalClients: this.clients.size, closeCode: code, closeReason: reason?.toString() });
    });

    ws.on('error', (err) => {
      logger.error('WebSocket client error', { clientId, errorMessage: err.message, stack: err.stack });
      cleanupClient(clientId);
      this.clients.delete(ws);
      this.clientsById.delete(clientId);
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    });
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [ws, meta] of this.clients) {
        // If we haven't received a pong within the timeout, terminate
        if (now - meta.lastPong > HEARTBEAT_TIMEOUT_MS) {
          logger.warn('WebSocket client timed out — no pong received');
          const clientId = this.findClientId(ws);
          this.clients.delete(ws);
          ws.terminate();
          if (clientId) {
            cleanupClient(clientId);
            this.clientsById.delete(clientId);
          }
          continue;
        }
        // Send ping
        meta.isAlive = false;
        try {
          ws.ping();
        } catch {
          const clientId = this.findClientId(ws);
          this.clients.delete(ws);
          ws.terminate();
          if (clientId) {
            cleanupClient(clientId);
            this.clientsById.delete(clientId);
          }
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Broadcast ──────────────────────────────────────────────────────────

  /**
   * Send a message to all connected clients.
   * `data` is serialised to JSON if it is not already a string.
   */
  broadcast(data: string | Record<string, unknown>): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch (err) {
          logger.error('Failed to send to WebSocket client', err as Error);
        }
      }
    }
  }

  /**
   * Send a message to a single client.
   */
  send(ws: WebSocket, data: string | Record<string, unknown>): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private findClientId(ws: WebSocket): string | undefined {
    for (const [id, socket] of this.clientsById) {
      if (socket === ws) return id;
    }
    return undefined;
  }

  private getPathname(req: IncomingMessage): string {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      return url.pathname;
    } catch {
      return req.url?.split('?')[0] || '/';
    }
  }

  private extractToken(req: IncomingMessage): string | null {
    // 1. Try Authorization header
    const headerToken = extractBearerToken(req.headers.authorization);
    if (headerToken) return headerToken;

    // 2. Try ?token= query param
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const queryToken = url.searchParams.get('token');
      if (queryToken) return queryToken;
    } catch {
      // ignore parse errors
    }

    return null;
  }
}
