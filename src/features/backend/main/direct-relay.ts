/**
 * DirectRelay — plain FE-side loopback TCP relay for LOCAL transports
 * (UDS / loopback ws / tcp), the local counterpart of the `/tunnel` mux
 * (`tunnel-manager.ts`).
 *
 * `browser.exec` tunnel actions promise uniform semantics regardless of
 * transport: `openTunnel` always creates a real client-loopback listener.
 * When the daemon runs on this machine, routing through the daemon's
 * `/tunnel` WebSocket would be a pointless double hop (and `/tunnel` does not
 * exist for UDS transports), so each forward is a direct relay
 * `127.0.0.1:<ephemeral>` → `127.0.0.1:<remotePort>` with no daemon
 * involvement.
 *
 * Lifecycle mirrors the mux backend: repeated `forwardPort()` for the same
 * remote port reuses the existing forward, a definitively connection-refused
 * target drops the whole forward (the server is gone; the next
 * `forwardPort()` recreates it fresh), and forwards idle past the timeout
 * with no live sockets are swept.
 */
import net from 'node:net';

import { Logger } from '$shared/logger';

const logger = new Logger('DirectRelay');

/** Options for [[DirectRelay]]. */
export interface DirectRelayOptions {
  /** A forward with no sockets and no activity this long is closed. Default 10 min. */
  idleTimeoutMs?: number;
  /** Cadence of the idle-forward sweep. Default 30s. */
  idleCheckIntervalMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_IDLE_CHECK_INTERVAL_MS = 30_000;

/** One local forwarded port: an ephemeral loopback listener relaying to a local target port. */
interface RelayForwardState {
  remotePort: number;
  localPort: number;
  server: net.Server;
  sockets: Set<net.Socket>;
  lastActivityAt: number;
}

/**
 * Local-transport tunnel backend satisfying the same provider surface as
 * `TunnelManager` (`forwardPort` / `activeForwards` / `closeForward` /
 * `dispose`), so `browser.exec` tunnel actions stay backend-agnostic.
 */
export class DirectRelay {
  /** Backend discriminator echoed in tunnel action results. */
  readonly backend = 'direct' as const;

  private readonly idleTimeoutMs: number;
  private readonly idleCheckIntervalMs: number;
  private readonly forwards = new Map<number, RelayForwardState>();
  private readonly pendingForwards = new Map<number, Promise<number>>();
  private idleTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(options: DirectRelayOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.idleCheckIntervalMs = options.idleCheckIntervalMs ?? DEFAULT_IDLE_CHECK_INTERVAL_MS;
  }

  /**
   * Forward local `remotePort` to a client-loopback ephemeral port; resolves
   * with the local port. Repeated calls for the same remote port reuse the
   * existing forward (and refresh its idle clock).
   */
  forwardPort(remotePort: number): Promise<number> {
    if (this.disposed) return Promise.reject(new Error('DirectRelay disposed'));
    if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
      return Promise.reject(new Error(`invalid remote port: ${remotePort}`));
    }
    const existing = this.forwards.get(remotePort);
    if (existing) {
      existing.lastActivityAt = Date.now();
      return Promise.resolve(existing.localPort);
    }
    const pending = this.pendingForwards.get(remotePort);
    if (pending) return pending;
    const promise = this.createForward(remotePort);
    this.pendingForwards.set(remotePort, promise);
    const clear = (): void => {
      this.pendingForwards.delete(remotePort);
    };
    promise.then(clear, clear);
    return promise;
  }

  /** Active forwards, for diagnostics and result echoes. */
  activeForwards(): Array<{ remotePort: number; localPort: number }> {
    return [...this.forwards.values()].map(({ remotePort, localPort }) => ({
      remotePort,
      localPort,
    }));
  }

  /**
   * Close the forward for `remotePort` on request (its local listener and any
   * remaining sockets). Returns true when a forward existed, false otherwise.
   */
  closeForward(remotePort: number): boolean {
    const forward = this.forwards.get(remotePort);
    if (!forward) return false;
    this.dropForward(forward, 'closed on request');
    return true;
  }

  /** Tear down every forward. The relay is unusable after. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const forward of this.forwards.values()) {
      forward.server.close();
      for (const socket of forward.sockets) {
        if (!socket.destroyed) socket.destroy();
      }
      forward.sockets.clear();
    }
    this.forwards.clear();
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
  }

  private async createForward(remotePort: number): Promise<number> {
    // allowHalfOpen: a client FIN must not kill the write side — the target's
    // response still flows back until its own FIN.
    const server = net.createServer({ allowHalfOpen: true });
    const localPort = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('local forward listener has no address'));
        }
      });
    });
    const forward: RelayForwardState = {
      remotePort,
      localPort,
      server,
      sockets: new Set(),
      lastActivityAt: Date.now(),
    };
    server.on('connection', (socket) => this.handleLocalConnection(forward, socket));
    if (this.disposed) {
      server.close();
      throw new Error('DirectRelay disposed while creating the forward');
    }
    this.forwards.set(remotePort, forward);
    this.ensureIdleTimer();
    logger.info('forward opened', { remotePort, localPort });
    return localPort;
  }

  private handleLocalConnection(forward: RelayForwardState, socket: net.Socket): void {
    if (this.forwards.get(forward.remotePort) !== forward) {
      socket.destroy();
      return;
    }
    forward.sockets.add(socket);
    forward.lastActivityAt = Date.now();
    socket.setNoDelay(true);

    // Hold local bytes until the target connect succeeds — piping starts on
    // 'connect', and an unpaused socket with 'data' listeners would discard
    // everything arriving before then.
    socket.pause();

    const target = net.connect({ host: '127.0.0.1', port: forward.remotePort });
    target.setNoDelay(true);
    let connected = false;
    const touch = (): void => {
      forward.lastActivityAt = Date.now();
    };
    target.on('connect', () => {
      connected = true;
      // Relay both ways; pipe() propagates FIN for half-close (allowHalfOpen)
      // and resumes the paused local socket.
      socket.pipe(target);
      target.pipe(socket);
      socket.on('data', touch);
      target.on('data', touch);
    });
    target.on('error', (error: NodeJS.ErrnoException) => {
      // A definitively refused connect means the target server is gone: drop
      // the whole forward so it leaves activeForwards() now (instead of
      // lingering until the idle sweep) and the next forwardPort() recreates
      // it fresh — symmetric with the mux backend's refused-OPEN drop
      // (intent-hq/monorepo#2537). Other errors end only this socket pair.
      if (!connected && error.code === 'ECONNREFUSED') {
        logger.warn('relay target refused the connect', {
          remotePort: forward.remotePort,
          error: error.message,
        });
        this.dropForward(forward, 'target port refused the connect');
      }
    });
    socket.on('error', () => {
      // 'close' follows and owns the teardown.
    });
    socket.on('close', () => {
      forward.sockets.delete(socket);
      forward.lastActivityAt = Date.now();
      if (!target.destroyed) target.destroy();
    });
    target.on('close', () => {
      forward.lastActivityAt = Date.now();
      if (!socket.destroyed) socket.destroy();
    });
  }

  /**
   * Close a forward's local listener and remaining sockets and deregister it,
   * so the next `forwardPort(remotePort)` recreates it fresh.
   */
  private dropForward(forward: RelayForwardState, reason: string): void {
    if (this.forwards.get(forward.remotePort) !== forward) return;
    this.forwards.delete(forward.remotePort);
    forward.server.close();
    for (const socket of [...forward.sockets]) {
      if (!socket.destroyed) socket.destroy();
    }
    forward.sockets.clear();
    logger.info('forward dropped', {
      reason,
      remotePort: forward.remotePort,
      localPort: forward.localPort,
    });
  }

  /** Sweep forwards that have no sockets and have been idle past the timeout. */
  private ensureIdleTimer(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      const now = Date.now();
      for (const [remotePort, forward] of this.forwards) {
        if (forward.sockets.size > 0) continue;
        if (now - forward.lastActivityAt < this.idleTimeoutMs) continue;
        this.forwards.delete(remotePort);
        forward.server.close();
        logger.info('idle forward closed', { remotePort, localPort: forward.localPort });
      }
      if (this.forwards.size === 0 && this.idleTimer) {
        clearInterval(this.idleTimer);
        this.idleTimer = null;
      }
    }, this.idleCheckIntervalMs);
    this.idleTimer.unref?.();
  }
}
