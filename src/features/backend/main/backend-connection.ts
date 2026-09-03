/**
 * Connection-target resolution and the default socket factory for the live
 * backend transport.
 *
 * Local dev and packaged builds talk to intentd over its Unix Domain Socket by
 * default. The target is configurable via environment variables so the same
 * client works in every posture:
 *   - `INTENTD_SOCKET=/path/to.sock` → force UDS (highest precedence).
 *   - `INTENTD_WS_URL=ws://host:port[/ws]` → plain WebSocket to that URL.
 *   - `INTENTD_TCP=host:port` → legacy TCP (optionally TLS) stub, unchanged.
 *   - no transport override → UDS at `defaultSocketPath(env)` (honors
 *     `INTENTD_DATA_DIR`), whether intentd is an adopted installed daemon, an
 *     explicitly spawned dev sidecar, or the packaged sidecar.
 *
 * The daemon's WebSocket endpoint at `/ws` frames JSON-RPC as one message per
 * text frame (`intent-transport/src/ws.rs::connection_loop`). The
 * main-process JSON-RPC client speaks newline-delimited JSON over a duplex
 * stream, so [[createBackendSocket]] wraps the `ws.WebSocket` in a small
 * adapter that translates between the two framings.
 */
import net from 'node:net';
import tls from 'node:tls';
import { Duplex } from 'node:stream';
import { createRequire } from 'node:module';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket as WsWebSocket } from 'ws';

import { Logger } from '$shared/logger';
import { describeBackendUrl } from './backend-log-descriptor';
import { resolveIntentdSocketPath } from './intentd-data-dir';
import { toLocalEndpoint } from './intentd-pipe-name';
import {
  createTailcatTunnel,
  createTunneledSocket,
  resolveTailcatBinaryPath,
  type TailcatSpawn,
  type TailcatTunnel,
} from './tailcat-tunnel';
import { isTcAddress } from '$shared/tc-address';

const raceLogger = new Logger('BackendConnection');

// The `ws` package is CJS and the vitest suite aliases the ESM import to a
// browser-safe stub (see `vitest.config.ts`); `createRequire` sidesteps both.
const nodeRequire = createRequire(import.meta.url);
const { WebSocket: NodeWebSocket } = nodeRequire('ws') as {
  WebSocket: typeof import('ws').WebSocket;
};

/** Resolved connection target for the backend transport. */
export interface BackendConnectionConfig {
  transport: 'uds' | 'tcp' | 'ws' | 'wss';
  /** UDS socket path (when `transport === 'uds'`). */
  socketPath?: string;
  /** Host (when `transport === 'tcp'` or `'wss'`). */
  host?: string;
  /**
   * Candidate hosts for the `wss` transport (#1746): the primary `host` plus
   * any additional IPs the backend reported at pairing time. When more than
   * one distinct candidate is present, every connect races them all in
   * parallel (mirroring iOS `raceHosts`) and keeps whichever pin-verified
   * connection succeeds first. Optional — absent or single-entry behaves
   * exactly like the plain single-host connect.
   */
  hosts?: string[];
  /** Port (when `transport === 'tcp'` or `'wss'`). */
  port?: number;
  /** Use TLS for the TCP transport (remote). Defaults to true for TCP. */
  tls?: boolean;
  /** Full `ws://…` URL (when `transport === 'ws'`); `/ws` is added if missing. */
  wsUrl?: string;
  /**
   * Bearer token for the `wss` transport (PROTOCOL §2.1), presented on the
   * WebSocket upgrade via the `Authorization` header (with a `?token=` query
   * fallback).
   */
  token?: string;
  /**
   * Pinned self-signed certificate SHA-256 fingerprint for the `wss` transport
   * (PROTOCOL §1.2), colon-separated uppercase hex. Every connect verifies the
   * presented cert against this pin; a mismatch fails with {@link PinMismatchError}.
   */
  fingerprint?: string;
  /**
   * tc address of the daemon's tailcat tunnel endpoint (PROTOCOL §12.3, the
   * pairing URI `tc=` parameter / `system.status.tcAddress`). When present and
   * the bundled tailcat client binary is available, the connect race gains a
   * tunnel candidate alongside the direct host candidates: the same pinned
   * `wss` transport dialed through a local tailcat forwarder (see
   * `tailcat-tunnel.ts`), so remote daemons stay reachable when no direct
   * host works. Fail-soft — a missing binary just skips the candidate.
   */
  tcAddress?: string;
}

/** Options for [[resolveBackendConfig]]. */
export interface ResolveBackendConfigOptions {
  /**
   * Retained for call-site compatibility. Build posture does not change the
   * zero-config UDS target; WebSocket transport requires `INTENTD_WS_URL`.
   */
  isDev?: boolean;
  /** Platform override for tests; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
}

/**
 * Default local connect target for the running intentd daemon.
 *
 * The socket lives in the daemon's data dir — resolved by
 * `intentd-data-dir.ts`, which honors `INTENTD_DATA_DIR` (so the FE connects
 * to the same socket the sidecar spawned intentd with) and mirrors the
 * daemon's platform defaults (macOS: `~/Library/Application Support/intentd`,
 * Linux: `$XDG_DATA_HOME/intentd` with a `~/.local/share/intentd` fallback,
 * Windows: `%APPDATA%\intentd\data`). On win32 the daemon serves a named pipe
 * derived from the socket path, so this returns the pipe name (see
 * `intentd-pipe-name.ts` for the contract).
 */
export function defaultSocketPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return toLocalEndpoint(resolveIntentdSocketPath(env, platform), platform);
}

/** Resolve the connection target from environment variables (with UDS default). */
export function resolveBackendConfig(
  env: NodeJS.ProcessEnv = process.env,
  opts: ResolveBackendConfigOptions = {},
): BackendConnectionConfig {
  const platform = opts.platform ?? process.platform;
  const socketOverride = env.INTENTD_SOCKET?.trim();
  if (socketOverride) {
    // On win32 a `.sock` override maps to its derived named pipe; explicit
    // pipe paths (`\\.\pipe\…`) pass through unchanged.
    return { transport: 'uds', socketPath: toLocalEndpoint(socketOverride, platform) };
  }
  const wsUrl = env.INTENTD_WS_URL?.trim();
  if (wsUrl) {
    return { transport: 'ws', wsUrl: normalizeWsUrl(wsUrl) };
  }
  const tcp = env.INTENTD_TCP?.trim();
  if (tcp) {
    const lastColon = tcp.lastIndexOf(':');
    const host = lastColon > 0 ? tcp.slice(0, lastColon) : '127.0.0.1';
    const port = Number(lastColon > 0 ? tcp.slice(lastColon + 1) : tcp);
    return { transport: 'tcp', host, port, tls: env.INTENTD_TCP_INSECURE !== '1' };
  }
  return { transport: 'uds', socketPath: defaultSocketPath(env, platform) };
}

/**
 * Add the daemon's `/ws` upgrade path when the caller only supplied a host+port
 * URL. `resolveBackendConfig` normalises the value on the way in so
 * [[describeBackendConfig]] and [[createBackendSocket]] both see the final URL.
 */
function normalizeWsUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.pathname === '' || url.pathname === '/') {
      url.pathname = '/ws';
    }
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * Create a connected stream for the given config.
 *
 * UDS, the loopback `ws://` transport, and the pinned `wss://` remote transport
 * (self-signed-cert fingerprint pinning + bearer token, see
 * {@link createWssSocket}) are fully supported. The legacy TCP configuration is
 * retained for diagnostics only and fails closed until authenticated transport
 * and compatible framing are implemented.
 */
export function createBackendSocket(config: BackendConnectionConfig): Duplex {
  if (config.transport === 'uds') {
    if (!config.socketPath) throw new Error('UDS transport requires a socketPath');
    return net.connect({ path: config.socketPath });
  }
  if (config.transport === 'ws') {
    if (!config.wsUrl) throw new Error('WS transport requires a wsUrl');
    return new WebSocketDuplex(new NodeWebSocket(config.wsUrl));
  }
  if (config.transport === 'wss') {
    const hosts = candidateWssHosts(config);
    const attempts: RaceAttempt[] = hosts.map((host) => ({
      host,
      create: () => createWssSocket({ ...config, host }),
    }));
    const tunnelAttempt = tunnelRaceAttempt(config);
    if (tunnelAttempt) attempts.push(tunnelAttempt);
    if (attempts.length > 1) {
      return raceDuplexSockets(attempts);
    }
    return attempts[0]?.create() ?? createWssSocket(config);
  }
  throw new Error(
    // i18n-ignore (developer-facing config error naming env vars; surfaces in logs, not UI)
    'Legacy INTENTD_TCP transport is disabled because authenticated remote transport is not implemented; use INTENTD_SOCKET or INTENTD_WS_URL',
  );
}

/** Human-readable description of a connection target (for logs). */
export function describeBackendConfig(config: BackendConnectionConfig): string {
  if (config.transport === 'uds') return `uds:${config.socketPath}`;
  if (config.transport === 'ws') return `ws:${describeBackendUrl(config.wsUrl)}`;
  // Deliberately omit the token and fingerprint — this string reaches logs.
  if (config.transport === 'wss') {
    const extra = candidateWssHosts(config).length - 1;
    const suffix = extra > 0 ? ` (+${extra} candidate${extra === 1 ? '' : 's'})` : '';
    return `wss:${config.host}:${config.port}${suffix}`;
  }
  return `tcp:${config.host}:${config.port}${config.tls ? ' (tls)' : ''}`;
}

/**
 * Distinct candidate hosts for a `wss` config: the primary `host` first, then
 * the `hosts` extras, trimmed and deduplicated in order. No loopback
 * filtering here — pairing URIs and tests legitimately dial loopback; the
 * legacy-record sanitize lives in the store's `candidateHosts`, which feeds
 * synced records into this config.
 */
export function candidateWssHosts(config: BackendConnectionConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [config.host ?? '', ...(config.hosts ?? [])]) {
    const host = raw.trim();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

/** One observed per-host certificate-pin mismatch (#1746 race surfacing). */
export interface HostCertMismatch {
  /** Candidate host that presented the mismatching certificate. */
  host: string;
  /** Pinned fingerprint (colon-hex uppercase). */
  expected: string;
  /** Fingerprint the peer actually presented (colon-hex uppercase). */
  actual: string;
}

/**
 * Raised when a `wss` peer presents a certificate whose SHA-256 fingerprint
 * does not match the pinned value (PROTOCOL §1.2). Distinct from a generic
 * connect failure so the switch/UI layer can surface the "certificate changed"
 * failure modal instead of a transient reconnect. When raised by the
 * multi-host race, `mismatches` carries every per-host mismatch observed;
 * `expected`/`actual` mirror the first one so consumers that predate the
 * aggregation keep working unchanged.
 */
export class PinMismatchError extends Error {
  /** Pinned fingerprint (colon-hex uppercase). */
  readonly expected: string;
  /** Fingerprint the peer actually presented (colon-hex uppercase). */
  readonly actual: string;
  /**
   * Every per-host mismatch observed. Empty for single-host errors raised
   * below the race layer (where the host is not known).
   */
  readonly mismatches: HostCertMismatch[];
  constructor(expected: string, actual: string, mismatches: HostCertMismatch[] = []) {
    const hosts = mismatches.map((m) => m.host).join(', ');
    super(
      `certificate fingerprint mismatch: expected ${expected || '(none)'}, got ${actual || '(none)'}${
        hosts ? ` (hosts: ${hosts})` : ''
      }`,
    );
    this.name = 'PinMismatchError';
    this.expected = expected;
    this.actual = actual;
    this.mismatches = mismatches;
  }
}

/**
 * Raised when a `wss` upgrade is rejected by the daemon's bearer-token check
 * (PROTOCOL §2.1): HTTP 401 on a bad/rotated token, 403 when the WS API is
 * disabled. Distinct from a generic transport error so the switch/UI layer can
 * surface "authentication rejected" instead of a transient reconnect.
 */
export class AuthRejectedError extends Error {
  /** HTTP status the upgrade was rejected with (401 or 403). */
  readonly statusCode: number;
  constructor(statusCode: number) {
    // i18n-ignore (main-process error message for logs, not renderer copy)
    super(`WebSocket upgrade rejected with HTTP ${statusCode} (authentication rejected)`);
    this.name = 'AuthRejectedError';
    this.statusCode = statusCode;
  }
}

/**
 * Normalize a certificate SHA-256 fingerprint to the daemon's canonical form
 * (PROTOCOL §1.2): colon-separated **uppercase** hex byte pairs. Accepts any
 * mix of case and separators (Node's `fingerprint256` is already colon-hex
 * uppercase, but a user-pasted or persisted pin may not be), so both sides of
 * a pin comparison can be run through it before an exact string match.
 */
export function normalizeFingerprint(fingerprint: string): string {
  const hex = fingerprint.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return hex.match(/.{2}/g)?.join(':') ?? '';
}

/**
 * Build the daemon's `wss://<host>:<port>/ws` upgrade URL, bracketing a bare
 * IPv6 host and optionally appending the `?token=` query fallback (PROTOCOL
 * §2.1 checks the header first, then the query).
 */
function formatWssUrl(host: string, port: number, token?: string): string {
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const base = `wss://${authority}:${port}/ws`;
  if (!token) return base;
  const url = new URL(base);
  url.searchParams.set('token', token);
  return url.toString();
}

/** Read the peer cert fingerprint (normalized) from an upgrade/response socket. */
function peerFingerprint(response: IncomingMessage): string {
  const socket = response.socket as tls.TLSSocket;
  const cert = socket.getPeerCertificate?.();
  return normalizeFingerprint(cert?.fingerprint256 ?? '');
}

/**
 * Connect the pinned `wss` transport: open the TLS WebSocket with
 * `rejectUnauthorized: false` (the daemon's cert is self-signed, PROTOCOL
 * §1.2) and verify the presented cert's fingerprint against the config pin at
 * the TLS HANDSHAKE via {@link pinnedTlsConnect} — the upgrade request
 * (carrying the bearer token) stays corked until the pin matches, and a
 * mismatch destroys the socket with a {@link PinMismatchError} before a
 * single application byte reaches the wire (monorepo#4055: the steady-state
 * arm of the token-before-trust leak, every reconnect re-presents the token).
 * A match hands the connection to the shared {@link WebSocketDuplex} newline
 * framing adapter. The bearer token is sent via the `Authorization` header
 * (PROTOCOL §2.1) with a `?token=` query fallback. An upgrade rejected with
 * HTTP 401/403 (bad token / WS API disabled, PROTOCOL §2.1) destroys the
 * stream with a distinct {@link AuthRejectedError} instead of a generic
 * transport error. The `upgrade`/`unexpected-response` pin checks are kept as
 * defense-in-depth behind the handshake-level pin.
 */
function createWssSocket(config: BackendConnectionConfig): Duplex {
  const { host, port, token, fingerprint } = config;
  if (!host || !port) throw new Error('WSS transport requires host and port');
  if (!token) throw new Error('WSS transport requires a token');
  if (!fingerprint) throw new Error('WSS transport requires a pinned fingerprint');
  const expected = normalizeFingerprint(fingerprint);

  const ws = new NodeWebSocket(formatWssUrl(host, port, token), {
    rejectUnauthorized: false,
    headers: { Authorization: `Bearer ${token}` },
    // ws types createConnection as `typeof net.createConnection` but always
    // invokes it with a single options object (websocket.js `initAsClient`),
    // which is what pinnedTlsConnect consumes.
    createConnection: ((connectOptions: tls.ConnectionOptions) =>
      pinnedTlsConnect(connectOptions, expected)) as unknown as typeof net.createConnection,
  });
  const duplex = new WebSocketDuplex(ws);
  ws.on('upgrade', (response: IncomingMessage) => {
    const actual = peerFingerprint(response);
    if (actual !== expected) {
      // Destroy through the duplex so the JSON-RPC client observes a single
      // `error` (then `close`) — the same failure path every transport uses.
      duplex.destroy(new PinMismatchError(expected, actual));
    }
  });
  ws.on('unexpected-response', (_req, response: IncomingMessage) => {
    // Attaching this listener suppresses ws's own generic error, so every
    // status must be handled here. Verify the pinned fingerprint FIRST: a
    // changed or intercepted endpoint can also answer 401/403, and classifying
    // that as an auth rejection would steer the user into re-pairing (typing a
    // fresh secret) against an untrusted certificate. The pin decides trust
    // before any status-code interpretation.
    const actual = peerFingerprint(response);
    if (actual !== expected) {
      duplex.destroy(new PinMismatchError(expected, actual));
      return;
    }
    // 401/403 are the daemon's auth rejections (PROTOCOL §2.1); anything else
    // keeps the generic failure shape.
    const statusCode = response.statusCode ?? 0;
    if (statusCode === 401 || statusCode === 403) {
      duplex.destroy(new AuthRejectedError(statusCode));
      return;
    }
    duplex.destroy(new Error(`Unexpected server response: ${statusCode}`));
  });
  return duplex;
}

/** One racing attempt: a candidate host plus a factory for its socket. */
export interface RaceAttempt {
  host: string;
  create: () => Duplex;
}

/**
 * Payload of the race facade's `'connect'` event: the candidate host that won
 * ({@link TUNNEL_RACE_HOST} when the tunnel candidate won). Single-host sockets
 * emit a bare `'connect'`, so consumers must treat the payload as optional.
 */
export interface RaceConnectInfo {
  host: string;
}

/** Overall bound on the multi-host race; matches the capture timeout. */
const RACE_TIMEOUT_MS = 10_000;

/** Pseudo-host label for the tunnel candidate in race logs/events. */
export const TUNNEL_RACE_HOST = 'tailcat-tunnel';

/**
 * Build the tunnel race attempt for a `wss` config carrying a `tcAddress`,
 * or `null` when the tunnel cannot be dialed (no tc address, or no bundled
 * tailcat binary — fail-soft, the direct candidates still race). The attempt
 * dials the SAME pinned wss transport through a local tailcat forwarder
 * (`tailcat-tunnel.ts`), so pin + token verification are identical to the
 * direct candidates; only the TCP path differs. The pin is fingerprint-based
 * (`servername` is not used for verification), so the loopback hop does not
 * weaken it. Exported for unit tests.
 */
export function tunnelRaceAttempt(config: BackendConnectionConfig): RaceAttempt | null {
  const { tcAddress, port } = config;
  if (!tcAddress || !port) return null;
  const binaryPath = resolveTailcatBinaryPath();
  if (!binaryPath) {
    raceLogger.debug('tailcat binary unavailable; skipping tunnel race candidate');
    return null;
  }
  return {
    host: TUNNEL_RACE_HOST,
    create: () =>
      createTunneledSocket({
        tcAddress,
        remotePort: port,
        binaryPath,
        createInner: (localPort) =>
          createWssSocket({ ...config, host: '127.0.0.1', port: localPort }),
      }),
  };
}

/**
 * Generic first-connect-wins race over candidate socket attempts. Exported
 * (with an injectable per-attempt factory) so unit tests can drive it with
 * in-memory fake sockets.
 *
 * Semantics (see #1746 acceptance criteria; iOS `raceHosts` model):
 * - The first candidate to emit `connect` wins; all others are destroyed.
 * - A {@link PinMismatchError} on a candidate counts that candidate out but
 *   does NOT fail the race — the remaining candidates keep racing, so one
 *   stale IP now owned by a foreign pinned daemon cannot block a candidate
 *   presenting the right cert. Every observed mismatch is recorded per host
 *   and emitted as a non-fatal `'pin-mismatch'` event ({@link HostCertMismatch})
 *   on the facade — both before and after a winner settles — so a mismatch on
 *   a losing candidate stays observable instead of being log-only.
 * - Once a pin-verified winner has settled, the winner takes precedence: a
 *   late mismatch on a losing candidate is emitted/logged, never tears down
 *   the established (itself pin-verified) connection.
 * - If no candidate wins and at least one mismatch was observed, the facade
 *   errors with a {@link PinMismatchError} aggregating every per-host
 *   mismatch — preferred over the generic last failure (including on race
 *   timeout) so a cert problem is surfaced as a cert error.
 * - If every candidate fails without a pin mismatch, the facade errors with
 *   the last candidate failure.
 * - A race-wide timeout bounds the whole attempt so a black-hole candidate
 *   set cannot hang the client's connect (the reconnect loop retries).
 * - The facade's `'connect'` event carries a {@link RaceConnectInfo} naming
 *   the winning candidate host, so the connection layer can tell a tunnel win
 *   from a direct one.
 */
export function raceDuplexSockets(
  attempts: RaceAttempt[],
  options: { timeoutMs?: number } = {},
): Duplex {
  const timeoutMs = options.timeoutMs ?? RACE_TIMEOUT_MS;
  let winner: Duplex | null = null;
  let settled = false;
  let pendingCount = attempts.length;
  let lastError: Error | null = null;
  const candidates: Duplex[] = [];
  const candidateHosts = new Map<Duplex, string>();
  const mismatches: HostCertMismatch[] = [];
  const reportedMismatchHosts = new Set<string>();

  // Record one mismatch per host: fold it into the aggregate while the race
  // is undecided (including a late mismatch on an already-counted candidate,
  // e.g. one that first failed generically), and always emit the non-fatal
  // event. The per-host dedupe keeps a candidate that surfaces the same
  // mismatch twice from double-reporting.
  const recordMismatch = (host: string, error: PinMismatchError): void => {
    if (reportedMismatchHosts.has(host)) return;
    reportedMismatchHosts.add(host);
    const info: HostCertMismatch = { host, expected: error.expected, actual: error.actual };
    if (!settled) mismatches.push(info);
    facade.emit('pin-mismatch', info);
  };

  // Tear a losing/failed candidate down without leaving it listener-less: a
  // destroyed-but-alive socket can still emit async 'error' events, and a
  // zero-listener 'error' is an uncaught exception in the main process. A
  // late pin mismatch is logged AND recorded so a foreign cert on a
  // torn-down candidate stays observable (and, pre-settlement, aggregated).
  const teardownCandidate = (candidate: Duplex): void => {
    candidate.removeAllListeners();
    candidate.on('error', (error: Error) => {
      if (error instanceof PinMismatchError) {
        const host = candidateHosts.get(candidate) ?? '';
        raceLogger.warn('late pin mismatch on a torn-down race candidate', {
          host,
          error: error.message,
        });
        recordMismatch(host, error);
      }
    });
    candidate.destroy();
  };

  const facade = new Duplex({
    allowHalfOpen: false,
    read() {
      // Inbound data is pushed from the winning socket's `data` events.
    },
    write(chunk, encoding, callback) {
      if (winner) {
        winner.write(chunk, encoding, callback);
        return;
      }
      // The JSON-RPC client only writes after `connect`, so a pre-win write is
      // unexpected — fail it like a not-yet-open socket.
      callback(new Error('Socket is not connected'));
    },
    destroy(error, callback) {
      settled = true;
      clearTimeout(timer);
      for (const candidate of candidates) {
        if (candidate !== winner) teardownCandidate(candidate);
      }
      winner?.removeAllListeners();
      winner?.destroy();
      callback(error);
    },
  });

  const failRace = (error: Error): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    for (const candidate of candidates) {
      teardownCandidate(candidate);
    }
    facade.destroy(error);
  };

  // Prefer surfacing observed cert mismatches over a generic failure when the
  // race produces no winner (#1746): the aggregate carries every per-host
  // mismatch, with expected/actual mirroring the first one.
  const preferCertError = (fallback: Error): Error =>
    mismatches.length > 0
      ? new PinMismatchError(mismatches[0].expected, mismatches[0].actual, [...mismatches])
      : fallback;

  const timer = setTimeout(
    () => failRace(preferCertError(new Error(`connection race timed out after ${timeoutMs}ms`))),
    timeoutMs,
  );
  timer.unref?.();

  const countCandidateFailure = (host: string, error: Error): void => {
    if (settled) return;
    // A pinned-cert mismatch counts this candidate out but keeps the race
    // going (#1746): record it per host and emit the non-fatal event so it
    // stays observable even if another candidate wins.
    if (error instanceof PinMismatchError) {
      recordMismatch(host, error);
    } else {
      lastError = error;
    }
    pendingCount -= 1;
    if (pendingCount <= 0) {
      failRace(preferCertError(lastError ?? new Error('no candidate hosts to connect')));
    }
  };

  const onCandidateFailure = (candidate: Duplex, host: string, error: Error): void => {
    // A failed candidate is dead to the race either way — destroy it now so
    // it cannot raise an uncaught 'error' while other racers continue, and so
    // its socket is freed before the race settles.
    teardownCandidate(candidate);
    countCandidateFailure(host, error);
  };

  const onCandidateWin = (candidate: Duplex): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    winner = candidate;
    for (const other of candidates) {
      if (other === candidate) continue;
      teardownCandidate(other);
    }
    candidate.removeAllListeners();
    // Forward the winning socket through the facade: data, error, and close
    // all surface exactly as they would on a single-host socket.
    candidate.on('data', (chunk: Buffer | string) => facade.push(chunk));
    candidate.on('error', (error: Error) => {
      if (!facade.destroyed) facade.destroy(error);
    });
    candidate.on('close', () => facade.push(null));
    const info: RaceConnectInfo = { host: candidateHosts.get(candidate) ?? '' };
    facade.emit('connect', info);
  };

  for (const attempt of attempts) {
    let candidate: Duplex;
    try {
      candidate = attempt.create();
    } catch (error) {
      countCandidateFailure(
        attempt.host,
        error instanceof Error ? error : new Error(String(error)),
      );
      continue;
    }
    candidates.push(candidate);
    candidateHosts.set(candidate, attempt.host);
    // A failing candidate can emit `error` AND `close`; count it out only once.
    let counted = false;
    const failOnce = (error: Error): void => {
      if (counted) return;
      counted = true;
      onCandidateFailure(candidate, attempt.host, error);
    };
    const onConnect = (): void => onCandidateWin(candidate);
    candidate.once('connect', onConnect);
    candidate.once('secureConnect', onConnect);
    candidate.once('error', failOnce);
    candidate.once('close', () => {
      failOnce(new Error(`connection to ${attempt.host} closed before connecting`));
    });
  }
  // Every attempt threw synchronously (or the list was empty).
  if (candidates.length === 0 && !settled) {
    failRace(lastError ?? new Error('no candidate hosts to connect'));
  }

  return facade;
}

/** Successful trust-on-first-use capture: the presented cert's fingerprint. */
interface CaptureFingerprintOk {
  ok: true;
  /** Presented cert SHA-256 fingerprint, colon-hex uppercase (PROTOCOL §1.2). */
  fingerprint: string;
  /** True only when the WebSocket upgrade itself succeeded. */
  connected: boolean;
  /**
   * `false` when the daemon rejected the upgrade with HTTP 401/403 (bad token
   * / WS API disabled, PROTOCOL §2.1) — the cert was still captured from the
   * TLS layer, but pairing with this token would fail. `true` for an accepted
   * upgrade (and for non-auth upgrade statuses, which say nothing about the
   * token).
   */
  tokenValid: boolean;
  /** HTTP status for rejected/non-upgraded responses. */
  statusCode?: number;
}

/** Failed trust-on-first-use capture, with a machine-readable reason. */
interface CaptureFingerprintError {
  ok: false;
  code: 'no-certificate' | 'connect-failed' | 'timeout';
  error: string;
}

/**
 * Pinned capture aborted at the TLS handshake: the peer presented a
 * certificate that does not match `expectedFingerprint`. Nothing beyond the
 * handshake — no upgrade request, no `Authorization` header, no `?token=`
 * query — reached the wire.
 */
interface CaptureFingerprintMismatch {
  ok: false;
  code: 'fingerprint-mismatch';
  error: string;
  /** Fingerprint the peer actually presented, normalized (PROTOCOL §1.2). */
  actualFingerprint: string;
}

export type CaptureFingerprintResult =
  CaptureFingerprintOk | CaptureFingerprintError | CaptureFingerprintMismatch;

/**
 * `tls.connect` with a fingerprint pin enforced at the HANDSHAKE boundary:
 * application data (the WebSocket upgrade request, including any
 * `Authorization` header or `?token=` query) is corked until the presented
 * certificate's SHA-256 fingerprint has been verified against `expected`, and
 * a mismatch destroys the socket with a {@link PinMismatchError} before a
 * single request byte reaches the wire. This closes the TOCTOU window of
 * monorepo#3782: a host that swaps its certificate between the
 * unauthenticated probe and the authenticated verify never sees the token.
 * Exported so every pinned `wss` upgrade shares the one enforcement point —
 * the JSON-RPC transport and TOFU capture here, and the `/tunnel` socket in
 * `tunnel-manager.ts` (monorepo#4072).
 */
export function pinnedTlsConnect(
  connectOptions: tls.ConnectionOptions,
  expected: string,
): tls.TLSSocket {
  // Mirror ws's own `tlsConnect`: drop the URL path (tls.connect would read
  // it as a UDS path) and derive `servername` for non-IP hosts.
  const opts: tls.ConnectionOptions & { host?: string } = { ...connectOptions, path: undefined };
  if (!opts.servername && opts.servername !== '') {
    opts.servername = net.isIP(opts.host ?? '') ? '' : opts.host;
  }
  const socket = tls.connect(opts);
  socket.cork();
  socket.once('secureConnect', () => {
    const actual = normalizeFingerprint(socket.getPeerCertificate()?.fingerprint256 ?? '');
    if (actual !== expected) {
      socket.destroy(new PinMismatchError(expected, actual));
      return;
    }
    socket.uncork();
  });
  return socket;
}

/**
 * Trust-on-first-use helper: open a `wss` connection to `{host, port}` with
 * `rejectUnauthorized: false`, read the presented self-signed cert's SHA-256
 * fingerprint (PROTOCOL §1.2), then close. Returns the normalized fingerprint
 * for the user to confirm, or a structured error. When a `token` is supplied
 * it is sent so the capture exercises the real upgrade path; the fingerprint
 * is still read from the TLS layer even when the token is rejected (401/403 →
 * unexpected response), and the rejection is reported as `tokenValid: false`
 * (with the status code) so a bad or stale token surfaces during pairing
 * rather than only at pinned-connect time.
 *
 * Without a `token` the probe is fully unauthenticated — no `Authorization`
 * header and no `?token=` query reach the wire (monorepo#3782: a saved secret
 * must never be transmitted to a host whose certificate the user has not yet
 * confirmed). The daemon is then expected to reject the upgrade (PROTOCOL
 * §2.1); a 401/403 says nothing about any token, so `tokenValid` stays `true`.
 *
 * With an `expectedFingerprint` the pin is enforced at the TLS handshake via
 * {@link pinnedTlsConnect}: a peer presenting any other certificate is cut
 * off before the upgrade request is written, so a supplied `token` cannot
 * leak to a swapped endpoint (TOCTOU). The mismatch is reported as a
 * structured `fingerprint-mismatch` result carrying the presented
 * fingerprint.
 *
 * A `host` that is a tc address (PROTOCOL §12.3, manual tunnel entry) is
 * captured through a local tailcat forwarder: the wss dial targets the
 * forwarder's loopback port and tailcat carries it to the daemon, so cert +
 * token verification are identical to a direct capture. Fails structured
 * (`connect-failed`) when the bundled tailcat binary is unavailable.
 */
export async function captureFingerprint(
  target: { host: string; port: number; token?: string; expectedFingerprint?: string },
  options: { timeoutMs?: number; tailcatSpawn?: TailcatSpawn } = {},
): Promise<CaptureFingerprintResult> {
  if (isTcAddress(target.host)) {
    const binaryPath = resolveTailcatBinaryPath();
    if (!binaryPath) {
      return {
        ok: false,
        code: 'connect-failed',
        error: 'tailcat binary unavailable; cannot capture through the tunnel',
      };
    }
    let tunnel: TailcatTunnel;
    try {
      tunnel = await createTailcatTunnel({
        // Lowercase like `isTcAddress` does for its check: tc addresses are
        // daemon-minted lowercase, so a hand-typed `TC-…` still dials.
        tcAddress: target.host.trim().toLowerCase(),
        remotePort: target.port,
        binaryPath,
        ...(options.tailcatSpawn ? { spawn: options.tailcatSpawn } : {}),
      });
    } catch (error) {
      return {
        ok: false,
        code: 'connect-failed',
        error: `tailcat forwarder failed to start: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    try {
      return await captureFingerprintDirect(
        { ...target, host: '127.0.0.1', port: tunnel.localPort },
        options,
      );
    } finally {
      tunnel.close();
    }
  }
  return captureFingerprintDirect(target, options);
}

function captureFingerprintDirect(
  target: { host: string; port: number; token?: string; expectedFingerprint?: string },
  options: { timeoutMs?: number } = {},
): Promise<CaptureFingerprintResult> {
  const { host, port, token } = target;
  const expected =
    target.expectedFingerprint !== undefined
      ? normalizeFingerprint(target.expectedFingerprint)
      : undefined;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return new Promise<CaptureFingerprintResult>((resolve) => {
    let settled = false;
    const ws = new NodeWebSocket(formatWssUrl(host, port, token), {
      rejectUnauthorized: false,
      // Keyed off truthiness like `formatWssUrl` so both wire surfaces agree:
      // an empty-string token sends neither `Authorization` nor `?token=`.
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      ...(expected !== undefined
        ? {
            // ws types createConnection as `typeof net.createConnection` but
            // always invokes it with a single options object (websocket.js
            // `initAsClient`), which is what pinnedTlsConnect consumes.
            createConnection: ((connectOptions: tls.ConnectionOptions) =>
              pinnedTlsConnect(connectOptions, expected)) as unknown as typeof net.createConnection,
          }
        : {}),
    });
    const finish = (result: CaptureFingerprintResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        // ignore teardown errors
      }
      resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          code: 'timeout',
          error: `fingerprint capture timed out after ${timeoutMs}ms`,
        }),
      timeoutMs,
    );
    timer.unref?.();
    const readCert = (
      response: IncomingMessage,
      connected: boolean,
      authRejectedStatus?: number,
    ): void => {
      const fingerprint = peerFingerprint(response);
      if (!fingerprint) {
        finish({ ok: false, code: 'no-certificate', error: 'server presented no certificate' });
        return;
      }
      if (authRejectedStatus !== undefined) {
        finish({
          ok: true,
          fingerprint,
          connected,
          tokenValid: false,
          statusCode: authRejectedStatus,
        });
        return;
      }
      finish({
        ok: true,
        fingerprint,
        connected,
        tokenValid: true,
        ...(!connected && response.statusCode !== undefined
          ? { statusCode: response.statusCode }
          : {}),
      });
    };
    ws.on('upgrade', (response: IncomingMessage) => readCert(response, true));
    ws.on('unexpected-response', (_req, response: IncomingMessage) => {
      // 401/403 are the daemon's auth rejections (PROTOCOL §2.1); any other
      // status says nothing about the token, so tokenValid stays true. When
      // no token was supplied, a 401/403 is the expected answer to the
      // unauthenticated probe and judges no token either.
      const statusCode = response.statusCode ?? 0;
      const authRejected = Boolean(token) && (statusCode === 401 || statusCode === 403);
      readCert(response, false, authRejected ? statusCode : undefined);
    });
    ws.on('error', (err: Error) => {
      if (err instanceof PinMismatchError) {
        finish({
          ok: false,
          code: 'fingerprint-mismatch',
          error: err.message,
          actualFingerprint: err.actual,
        });
        return;
      }
      finish({ ok: false, code: 'connect-failed', error: err.message });
    });
  });
}

/**
 * Adapt an `ws.WebSocket` to a newline-delimited `Duplex` stream so the shared
 * JSON-RPC client can drive UDS and loopback WebSocket transports through the
 * same read/write path.
 *
 * - **Outbound (write)** — the caller writes newline-delimited JSON; each
 *   complete line becomes one WebSocket text frame (daemon `process_frame`
 *   expects one JSON envelope per frame).
 * - **Inbound (read)** — each incoming text frame is pushed as `<frame>\n` so
 *   the caller's newline splitter yields exactly one JSON envelope per push.
 * - Bubbles `open`/`error`/`close` from the underlying socket via `connect`,
 *   `error`, and stream end respectively.
 */
export class WebSocketDuplex extends Duplex {
  private readonly ws: WsWebSocket;
  private writeBuffer = '';
  // Named to avoid clashing with `Duplex.closed` (public in Node's types).
  private wsClosed = false;

  constructor(ws: WsWebSocket) {
    super({ allowHalfOpen: false });
    this.ws = ws;
    ws.on('open', () => this.emit('connect'));
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) return;
      const text = Array.isArray(data)
        ? Buffer.concat(data as Buffer[]).toString('utf8')
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString('utf8')
            : String(data);
      this.push(`${text}\n`);
    });
    ws.on('error', (err: Error) => {
      if (this.wsClosed) return;
      this.emit('error', err);
    });
    ws.on('close', () => {
      if (this.wsClosed) return;
      this.wsClosed = true;
      this.push(null);
    });
  }

  override _read(_size: number): void {
    // Backpressure is handled by the ws socket itself; nothing to pull.
  }

  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const text =
      typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : String(chunk);
    this.writeBuffer += text;
    const lines = this.writeBuffer.split('\n');
    this.writeBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length === 0) continue;
      if (this.ws.readyState !== NodeWebSocket.OPEN) {
        callback(new Error('WebSocket is not open'));
        return;
      }
      try {
        this.ws.send(line);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
    callback();
  }

  override _destroy(error: Error | null, callback: (err: Error | null) => void): void {
    this.wsClosed = true;
    try {
      this.ws.terminate();
    } catch {
      // ignore teardown errors
    }
    callback(error);
  }
}
