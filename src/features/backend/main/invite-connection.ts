/**
 * Invite redemption client (main process) — the guest side of multiplayer
 * invites (intentd #1872).
 *
 * The daemon serves four methods on its UNAUTHENTICATED `/invite`
 * WebSocket endpoint. The first join on a host is the gist identity proof
 * (intentd #1967), in two steps:
 *
 * 1. `invite.challenge { inviteId, secret }` validates the invite and answers
 *    its decoration plus a short-lived single-use nonce: `{ workspaceId,
 *    workspaceTitle, hostname, prettyHostname, nonce, nonceExpiresAt }`.
 * 2. `invite.prove { inviteId, secret, nonce, gistId, login }` joins once the
 *    host has read a gist owned by `login` whose proof file starts with that
 *    nonce (the guest publishes it through its own daemon's
 *    `github.identityProof.create`), answering the collaborator credential
 *    exactly once: `{ status: "authorized", token, principalId, login,
 *    workspaceId }`.
 *
 * A guest that already holds a credential for the host skips the proof:
 * `invite.inspect { inviteId, secret }` is the challenge's validation and
 * decoration with no nonce issued (`{ workspaceId, workspaceTitle, hostname,
 * prettyHostname }`), and `invite.accept { inviteId, secret, credential }`
 * joins with the stored credential and answers the same credential shape as
 * `invite.prove`. An unknown or revoked credential is refused with
 * `credential-invalid`, on which the caller falls back to the proof.
 *
 * Refusals carry `error.data.code` (`invite-expired`, `invite-pin-mismatch`,
 * `proof-invalid`, `workspace-full`, …) so the flow routes on a code, never
 * on prose.
 *
 * Trust: the link's `fp` pins the daemon's self-signed cert and every
 * candidate is dialed through {@link pinnedTlsConnect}, so the invite secret
 * never leaves this process before the pin has been verified at the TLS
 * handshake. Direct candidate hosts race in parallel (first pin-verified
 * open wins, every other candidate — still connecting or already open — is
 * torn down); when none answers, or the link carries no direct host at all
 * (the daemon's default loopback-bound invite is `hosts=[]` + `tc=`), the
 * tunnel address is dialed through a local tailcat forwarder with the same
 * pin, exactly like {@link captureFingerprint} does for a tc-address host.
 */

import net from 'node:net';
import tls from 'node:tls';
import { createRequire } from 'node:module';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket as WsWebSocket } from 'ws';
import { Logger } from '$shared/logger';
import { PinMismatchError, normalizeFingerprint, pinnedTlsConnect } from './backend-connection';
import {
  createTailcatTunnel,
  resolveTailcatBinaryPath,
  type TailcatSpawn,
  type TailcatTunnel,
} from './tailcat-tunnel';

const logger = new Logger('InviteConnection');

// Same CJS require dance as backend-connection.ts: the vitest suite aliases
// the ESM `ws` import to a browser-safe stub.
const nodeRequire = createRequire(import.meta.url);
const { WebSocket: NodeWebSocket } = nodeRequire('ws') as {
  WebSocket: typeof import('ws').WebSocket;
};

/** Overall bound on the multi-host `/invite` race. */
const INVITE_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Bound on the local-only requests (`invite.challenge`, `invite.inspect`,
 * `invite.accept`): the daemon answers from its own store.
 */
const INVITE_REQUEST_TIMEOUT_MS = 30_000;

/** Bound on `invite.prove`: the daemon reads the proof gist from GitHub once. */
const INVITE_PROVE_TIMEOUT_MS = 60_000;

/** Method name for the flow-less preview of an invite. */
// i18n-ignore (wire method name)
const INVITE_INSPECT_METHOD = 'invite.inspect';
/** Method name for the returning-guest join with a stored credential. */
// i18n-ignore (wire method name)
const INVITE_ACCEPT_METHOD = 'invite.accept';
/** Method name for the proof step 1: the preview plus a single-use nonce. */
// i18n-ignore (wire method name)
const INVITE_CHALLENGE_METHOD = 'invite.challenge';
/** Method name for the proof step 2: join with the published proof gist. */
// i18n-ignore (wire method name)
const INVITE_PROVE_METHOD = 'invite.prove';

/**
 * `invite.inspect` result: the invite's decoration with nothing issued.
 * `hostname` / `prettyHostname` name the host machine for the consent
 * prompt; older daemons omit both, in which case the dialed address is shown
 * instead.
 */
export interface InviteInspection {
  workspaceId: string;
  workspaceTitle: string;
  hostname?: string;
  prettyHostname?: string;
}

/** `invite.challenge` result: the inspection plus the nonce the proof gist must carry. */
export interface InviteChallenge extends InviteInspection {
  /** Single-use nonce; the first line of the proof gist. */
  nonce: string;
  /** RFC 3339 instant after which the host refuses the nonce (`proof-expired`). */
  nonceExpiresAt: string;
}

/** The guest's published identity proof, as `invite.prove` names it. */
interface InviteProof {
  nonce: string;
  gistId: string;
  login: string;
}

/** Join result (`invite.prove` / `invite.accept`): the collaborator credential, returned exactly once. */
interface InviteCredential {
  status: 'authorized';
  token: string;
  principalId: string;
  login: string;
  workspaceId: string;
}

/**
 * The daemon's documented `error.data.code` values for the `/invite` methods
 * (intentd #1872; `workspace-full` — the guest cap is spent at join time —
 * from intentd #1917; `credential-invalid` — `invite.accept` with an unknown
 * or revoked credential — from the returning-guest join; `proof-invalid` /
 * `proof-expired` / `github-unreachable` — `invite.prove` could not verify
 * the gist, the nonce is spent or past `nonceExpiresAt`, or the host could
 * not reach GitHub — from intentd #1967). The closed set is the ONLY
 * server-authored text that ever leaves {@link InviteRpcError}: a code
 * outside it maps to `null`.
 */
const INVITE_ERROR_CODES = [
  'invite-not-found',
  'invite-expired',
  'invite-revoked',
  'invite-redeemed',
  'invite-pin-mismatch',
  'invite-pin-unknown',
  'workspace-full',
  'credential-invalid',
  'proof-invalid',
  'proof-expired',
  'github-unreachable',
] as const;

export type InviteErrorCode = (typeof INVITE_ERROR_CODES)[number];

function toInviteErrorCode(value: unknown): InviteErrorCode | null {
  return typeof value === 'string' && (INVITE_ERROR_CODES as readonly string[]).includes(value)
    ? (value as InviteErrorCode)
    : null;
}

/**
 * A JSON-RPC error frame from the `/invite` endpoint, reduced to bounded
 * fields: the numeric JSON-RPC `code` and `inviteCode`, the daemon's
 * `error.data.code` when it is one of {@link INVITE_ERROR_CODES}. The frame's
 * `message` and the rest of `data` are server-authored free text that could
 * echo the secret, so they are dropped here — never stored on the error,
 * never logged, never shown.
 */
export class InviteRpcError extends Error {
  readonly code: number;
  readonly inviteCode: InviteErrorCode | null;

  constructor(code: number, data?: unknown) {
    // i18n-ignore (internal error, fixed text)
    super('invite request failed');
    this.name = 'InviteRpcError';
    this.code = code;
    const c = data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined;
    this.inviteCode = toInviteErrorCode(c);
  }
}

/**
 * Why the transport failed, as a closed set the failure dialog and the log
 * route on (the underlying socket/library error text is dropped: it can echo
 * addresses or argv, including the tc address's pre-shared key):
 * - `tailcat-unavailable`: no direct host answered (or none was given) and
 *   the bundled tailcat client binary is missing, so the tunnel cannot be
 *   dialed at all.
 * - `tunnel-failed`: the local tailcat forwarder could not start, or the
 *   tunneled dial broke before the handshake completed (e.g. the tailcat
 *   child exited immediately).
 * - `host-unreachable`: no candidate answered within the connect bound, or
 *   the daemon never answered an invite request within its bound.
 * - `host-refused`: a candidate answered but refused the connection
 *   (ECONNREFUSED, or a non-101 answer to the `/invite` upgrade).
 * - `connection-closed`: the socket closed (or reset) before the invite flow
 *   completed.
 */
export type InviteTransportCode =
  | 'tailcat-unavailable'
  | 'tunnel-failed'
  | 'host-unreachable'
  | 'host-refused'
  | 'connection-closed';

/** A transport-level failure of the `/invite` connection, identified by a bounded code. */
export class InviteTransportError extends Error {
  constructor(readonly transportCode: InviteTransportCode) {
    // i18n-ignore (internal error, fixed text + local code literal)
    super(`invite transport failed: ${transportCode}`);
    this.name = 'InviteTransportError';
  }
}

/** Node `SystemError` codes meaning the peer never answered (as opposed to refusing). */
const UNREACHABLE_SOCKET_CODES = new Set([
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/**
 * Reduce a socket/library error to an {@link InviteTransportError}: only the
 * Node error `code` is inspected, never the message. An unrecognized error
 * (reset, EOF mid-handshake, …) counts as `connection-closed`.
 */
function toTransportError(error: unknown): InviteTransportError {
  if (error instanceof InviteTransportError) return error;
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (code === 'ECONNREFUSED') return new InviteTransportError('host-refused');
  if (typeof code === 'string' && UNREACHABLE_SOCKET_CODES.has(code)) {
    return new InviteTransportError('host-unreachable');
  }
  return new InviteTransportError('connection-closed');
}

/** Where to dial: the invite link's envelope. */
export interface InviteTarget {
  /** Direct candidate hosts (`host=`); may be empty when `tcAddress` is set. */
  hosts: string[];
  port: number;
  /** Pinned cert fingerprint, any case/separator (normalized before use). */
  fingerprint: string;
  /** tailcat tunnel address (`tc=`, PROTOCOL §12.3); dialed after the hosts. */
  tcAddress?: string | null;
}

/** An open, pin-verified `/invite` connection. */
export interface InviteConnection {
  /**
   * Candidate that won: a direct host, or the tc address when the tunnel
   * carried the connection (the tc address stands in as the host, matching
   * the owner registry's tunnel-only convention).
   */
  readonly host: string;
  /** Whether the tunnel carried the connection. */
  readonly via: 'direct' | 'tunnel';
  /** Proof step 1: preview the invite and obtain the single-use nonce. */
  challenge(inviteId: string, secret: string): Promise<InviteChallenge>;
  /**
   * Proof step 2: join with the published proof gist. The host reads the
   * gist from GitHub, so this is the one host round-trip that talks to a
   * third party; `timeoutMs` bounds the wait locally.
   */
  prove(
    inviteId: string,
    secret: string,
    proof: InviteProof,
    timeoutMs?: number,
  ): Promise<InviteCredential>;
  /** Preview the invite (workspace + host names) without issuing a nonce. */
  inspect(inviteId: string, secret: string): Promise<InviteInspection>;
  /**
   * Join with a credential this guest already holds for the host; refused
   * with `credential-invalid` when the host no longer recognizes it.
   */
  accept(inviteId: string, secret: string, credential: string): Promise<InviteCredential>;
  /** Tear the socket down; every pending request rejects. */
  close(): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
}

function formatInviteUrl(host: string, port: number): string {
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `wss://${authority}:${port}/invite`;
}

function peerFingerprint(response: IncomingMessage): string {
  const socket = response.socket as tls.TLSSocket;
  return normalizeFingerprint(socket.getPeerCertificate?.()?.fingerprint256 ?? '');
}

function rawToText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return String(data);
}

/** One in-flight candidate dial: the open promise plus a way to abandon it. */
interface InviteDial {
  socket: Promise<WsWebSocket>;
  /** Abandon the dial: a connecting or already-open socket is destroyed. */
  cancel(): void;
}

/**
 * Dial one candidate's `/invite` endpoint with the pin enforced at the TLS
 * handshake. The promise resolves with the open socket or rejects with the
 * transport error ({@link PinMismatchError} for a foreign cert, else an
 * {@link InviteTransportError}); `cancel()` tears the socket down at whatever
 * stage it is (a still-connecting handshake is aborted, an open socket
 * terminated) and rejects the promise.
 */
function dialInvite(host: string, port: number, expected: string): InviteDial {
  let cancel: () => void = () => {};
  const socket = new Promise<WsWebSocket>((resolve, reject) => {
    const ws = new NodeWebSocket(formatInviteUrl(host, port), {
      rejectUnauthorized: false,
      createConnection: ((connectOptions: tls.ConnectionOptions) =>
        pinnedTlsConnect(connectOptions, expected)) as unknown as typeof net.createConnection,
    });
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.terminate();
      reject(error);
    };
    cancel = () => {
      if (settled) {
        // Already open (resolved): the caller owns the socket unless it lost
        // the race, in which case it is torn down right here.
        ws.removeAllListeners();
        ws.on('error', () => {});
        ws.terminate();
        return;
      }
      fail(new Error('invite candidate cancelled'));
    };
    ws.on('upgrade', (response: IncomingMessage) => {
      const actual = peerFingerprint(response);
      if (actual !== expected) fail(new PinMismatchError(expected, actual));
    });
    ws.on('unexpected-response', (_req, response: IncomingMessage) => {
      const actual = peerFingerprint(response);
      if (actual !== expected) {
        fail(new PinMismatchError(expected, actual));
        return;
      }
      fail(new InviteTransportError('host-refused'));
    });
    ws.on('error', (error: Error) => {
      // pinnedTlsConnect rejects a foreign cert by erroring the socket.
      fail(error instanceof PinMismatchError ? error : toTransportError(error));
    });
    ws.on('close', () => fail(new InviteTransportError('connection-closed')));
    ws.on('open', () => {
      if (settled) return;
      settled = true;
      ws.removeAllListeners();
      resolve(ws);
    });
  });
  return { socket, cancel: () => cancel() };
}

/**
 * Race the direct candidate hosts; resolves with the first pin-verified open
 * socket. Every non-winning candidate — still connecting or opened late — is
 * destroyed the moment the race settles (winner, all-failed, or the overall
 * deadline), so no stray TLS session outlives the outcome. Rejects with a
 * {@link PinMismatchError} over generic failures (the user must learn the
 * cert changed), else the last candidate's {@link InviteTransportError},
 * else `host-unreachable` (the deadline hit with nothing answering).
 */
function raceDirectHosts(
  hosts: string[],
  port: number,
  expected: string,
  timeoutMs: number,
): Promise<{ host: string; ws: WsWebSocket }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pending = hosts.length;
    let mismatch: PinMismatchError | null = null;
    let lastError: InviteTransportError | null = null;
    const dials = new Map<string, InviteDial>();
    const settle = (winner: string | null, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const [host, dial] of dials) {
        if (host !== winner) dial.cancel();
      }
      if (error) reject(error);
    };
    const timer = setTimeout(() => {
      settle(null, mismatch ?? lastError ?? new InviteTransportError('host-unreachable'));
    }, timeoutMs);
    for (const host of hosts) {
      const dial = dialInvite(host, port, expected);
      dials.set(host, dial);
      dial.socket.then(
        (ws) => {
          if (settled) return;
          settle(host);
          resolve({ host, ws });
        },
        (error: Error) => {
          if (settled) return;
          if (error instanceof PinMismatchError) {
            mismatch ??= error;
            logger.warn('invite candidate presented a foreign certificate', { host });
          } else {
            lastError = toTransportError(error);
          }
          pending -= 1;
          if (pending === 0) {
            settle(null, mismatch ?? lastError ?? new InviteTransportError('host-unreachable'));
          }
        },
      );
    }
  });
}

/**
 * Dial the tc address through a local tailcat forwarder (loopback wss to
 * the forwarder's port, pin enforced exactly like a direct dial). Returns
 * the open socket plus the tunnel that carries it; the tunnel is closed on
 * any failure so no forwarder or tailcat child is left behind.
 *
 * Failure codes: a missing binary is `tailcat-unavailable`; a forwarder that
 * cannot start, or a tunneled dial that breaks before the handshake completes
 * (the loopback forwarder itself always accepts, so a reset or early close
 * means the tailcat child died — e.g. a bad tc address), is `tunnel-failed`;
 * a connect that hits the bound stays `host-unreachable` (the daemon behind
 * the tunnel never answered); a {@link PinMismatchError} passes through.
 */
async function dialThroughTunnel(
  tcAddress: string,
  port: number,
  expected: string,
  timeoutMs: number,
  spawn?: TailcatSpawn,
): Promise<{ ws: WsWebSocket; tunnel: TailcatTunnel }> {
  const binaryPath = resolveTailcatBinaryPath();
  if (!binaryPath) throw new InviteTransportError('tailcat-unavailable');
  const tunnel = await createTailcatTunnel({
    tcAddress: tcAddress.trim(),
    remotePort: port,
    binaryPath,
    ...(spawn ? { spawn } : {}),
  }).catch(() => {
    throw new InviteTransportError('tunnel-failed');
  });
  try {
    const { ws } = await raceDirectHosts(['127.0.0.1'], tunnel.localPort, expected, timeoutMs);
    return { ws, tunnel };
  } catch (error) {
    tunnel.close();
    if (error instanceof PinMismatchError) throw error;
    if (error instanceof InviteTransportError && error.transportCode === 'host-unreachable') {
      throw error;
    }
    throw new InviteTransportError('tunnel-failed');
  }
}

/**
 * Open a pin-verified `/invite` connection: the direct candidate hosts race
 * first; when none answers (or the link has none) and the envelope carries a
 * tc address, the tunnel is tried next. Rejects when everything fails: a
 * {@link PinMismatchError} from any candidate wins over generic failures
 * (the user must learn the cert changed), else the last attempt's
 * {@link InviteTransportError} (the tunnel's when it was tried; the direct
 * race's code is logged when the flow falls through to the tunnel).
 */
export async function openInviteConnection(
  target: InviteTarget,
  options: { timeoutMs?: number; tailcatSpawn?: TailcatSpawn } = {},
): Promise<InviteConnection> {
  const hosts = [...new Set(target.hosts.map((h) => h.trim()).filter((h) => h !== ''))];
  const tcAddress = target.tcAddress?.trim() || null;
  if (hosts.length === 0 && tcAddress === null) {
    throw new Error('invite target has no host and no tunnel address');
  }
  const expected = normalizeFingerprint(target.fingerprint);
  if (expected === '') throw new Error('invite target has no pinned fingerprint');
  const timeoutMs = options.timeoutMs ?? INVITE_CONNECT_TIMEOUT_MS;

  let directError: Error | null = null;
  if (hosts.length > 0) {
    try {
      const winner = await raceDirectHosts(hosts, target.port, expected, timeoutMs);
      return attachRpc(winner.host, 'direct', winner.ws);
    } catch (error) {
      directError = error instanceof PinMismatchError ? error : toTransportError(error);
      if (tcAddress === null) throw directError;
      if (directError instanceof InviteTransportError) {
        logger.debug('no direct invite candidate answered; trying the tunnel', {
          transportCode: directError.transportCode,
        });
      }
    }
  }

  try {
    const { ws, tunnel } = await dialThroughTunnel(
      tcAddress as string,
      target.port,
      expected,
      timeoutMs,
      options.tailcatSpawn,
    );
    return attachRpc(tcAddress as string, 'tunnel', ws, tunnel);
  } catch (error) {
    if (error instanceof PinMismatchError) throw error;
    if (directError instanceof PinMismatchError) throw directError;
    throw error;
  }
}

/**
 * Minimal JSON-RPC 2.0 request/response over an open `/invite` socket. A
 * `tunnel` that carried the socket is closed together with it. Requests
 * reject with an {@link InviteRpcError} on a daemon error frame, else an
 * {@link InviteTransportError}: `connection-closed` when the socket ends
 * (or `close()` is called) with the request outstanding, `host-unreachable`
 * when the daemon never answers within the request's bound.
 */
function attachRpc(
  host: string,
  via: InviteConnection['via'],
  ws: WsWebSocket,
  tunnel?: TailcatTunnel,
): InviteConnection {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let closed = false;
  let tunnelOpen = tunnel !== undefined;
  const closeTunnel = (): void => {
    if (!tunnelOpen) return;
    tunnelOpen = false;
    tunnel?.close();
  };

  const failAll = (error: Error): void => {
    for (const [id, p] of pending) {
      pending.delete(id);
      if (p.timer) clearTimeout(p.timer);
      p.reject(error);
    }
  };

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) return;
    let frame: { id?: unknown; result?: unknown; error?: unknown };
    try {
      frame = JSON.parse(rawToText(data)) as typeof frame;
    } catch {
      return;
    }
    if (typeof frame.id !== 'number') return;
    const p = pending.get(frame.id);
    if (!p) return;
    pending.delete(frame.id);
    if (p.timer) clearTimeout(p.timer);
    if (frame.error && typeof frame.error === 'object') {
      const e = frame.error as { code?: unknown; data?: unknown };
      p.reject(new InviteRpcError(typeof e.code === 'number' ? e.code : -32000, e.data));
      return;
    }
    p.resolve(frame.result);
  });
  ws.on('error', (error: Error) => failAll(toTransportError(error)));
  ws.on('close', () => {
    closed = true;
    failAll(new InviteTransportError('connection-closed'));
    closeTunnel();
  });

  const request = (
    method: string,
    params: Record<string, string>,
    timeoutMs: number,
  ): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      if (closed) {
        reject(new InviteTransportError('connection-closed'));
        return;
      }
      const id = nextId++;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              pending.delete(id);
              reject(new InviteTransportError('host-unreachable'));
            }, timeoutMs)
          : null;
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }), (err) => {
        if (!err) return;
        pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(toTransportError(err));
      });
    });

  return {
    host,
    via,
    challenge: (inviteId, secret) =>
      request(
        INVITE_CHALLENGE_METHOD,
        { inviteId, secret },
        INVITE_REQUEST_TIMEOUT_MS,
      ) as Promise<InviteChallenge>,
    prove: (inviteId, secret, proof, timeoutMs = INVITE_PROVE_TIMEOUT_MS) =>
      request(
        INVITE_PROVE_METHOD,
        { inviteId, secret, nonce: proof.nonce, gistId: proof.gistId, login: proof.login },
        timeoutMs,
      ) as Promise<InviteCredential>,
    inspect: (inviteId, secret) =>
      request(
        INVITE_INSPECT_METHOD,
        { inviteId, secret },
        INVITE_REQUEST_TIMEOUT_MS,
      ) as Promise<InviteInspection>,
    accept: (inviteId, secret, credential) =>
      request(
        INVITE_ACCEPT_METHOD,
        { inviteId, secret, credential },
        INVITE_REQUEST_TIMEOUT_MS,
      ) as Promise<InviteCredential>,
    close: () => {
      if (closed) return;
      closed = true;
      failAll(new InviteTransportError('connection-closed'));
      ws.removeAllListeners('error');
      ws.on('error', () => {});
      ws.close();
      closeTunnel();
    },
  };
}
