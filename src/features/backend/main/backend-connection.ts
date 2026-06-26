/**
 * Connection-target resolution and the default socket factory for the live
 * backend transport.
 *
 * Local dev defaults to the intentd Unix Domain Socket; remote connections use
 * TCP/TLS. The target is configurable via environment variables so the same
 * client works in both modes:
 *   - `INTENTD_TCP=host:port` → TCP transport (remote/TLS stub).
 *   - `INTENTD_SOCKET=/path/to.sock` → override the UDS path.
 *   - otherwise the default dev UDS path is used.
 */
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import type { Duplex } from 'node:stream';

/** Resolved connection target for the backend transport. */
export interface BackendConnectionConfig {
  transport: 'uds' | 'tcp';
  /** UDS socket path (when `transport === 'uds'`). */
  socketPath?: string;
  /** Host (when `transport === 'tcp'`). */
  host?: string;
  /** Port (when `transport === 'tcp'`). */
  port?: number;
  /** Use TLS for the TCP transport (remote). Defaults to true for TCP. */
  tls?: boolean;
}

/** Default dev UDS path for the running intentd daemon. */
export function defaultSocketPath(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'intentd', 'intentd.sock');
}

/** Resolve the connection target from environment variables (with dev default). */
export function resolveBackendConfig(
  env: NodeJS.ProcessEnv = process.env,
): BackendConnectionConfig {
  const tcp = env.INTENTD_TCP?.trim();
  if (tcp) {
    const lastColon = tcp.lastIndexOf(':');
    const host = lastColon > 0 ? tcp.slice(0, lastColon) : '127.0.0.1';
    const port = Number(lastColon > 0 ? tcp.slice(lastColon + 1) : tcp);
    return { transport: 'tcp', host, port, tls: env.INTENTD_TCP_INSECURE !== '1' };
  }
  const socketPath = env.INTENTD_SOCKET?.trim() || defaultSocketPath();
  return { transport: 'uds', socketPath };
}

/**
 * Create a connected stream for the given config.
 *
 * UDS is fully supported. The TCP/TLS branch is a remote-transport stub: it
 * opens a (optionally TLS) socket but does NOT implement the WSS `/ws` handshake
 * yet, so remote framing beyond a raw newline-delimited stream is out of scope.
 */
export function createBackendSocket(config: BackendConnectionConfig): Duplex {
  if (config.transport === 'uds') {
    if (!config.socketPath) throw new Error('UDS transport requires a socketPath');
    return net.connect({ path: config.socketPath });
  }
  if (!config.host || !config.port) {
    throw new Error('TCP transport requires host and port');
  }
  // Remote transport stub: TLS-with-pinning and the WSS handshake are deferred.
  if (config.tls) {
    return tls.connect({
      host: config.host,
      port: config.port,
      rejectUnauthorized: false,
    });
  }
  return net.connect({ host: config.host, port: config.port });
}

/** Human-readable description of a connection target (for logs). */
export function describeBackendConfig(config: BackendConnectionConfig): string {
  return config.transport === 'uds'
    ? `uds:${config.socketPath}`
    : `tcp:${config.host}:${config.port}${config.tls ? ' (tls)' : ''}`;
}
