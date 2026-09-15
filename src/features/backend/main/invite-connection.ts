/**
 * Invite redemption client (main process) — the guest side of multiplayer
 * invites (intentd #1872).
 *
 * The daemon serves exactly one method on its UNAUTHENTICATED `/invite`
 * WebSocket endpoint: `invite.redeem`, in two phases on the same name:
 *
 * 1. `{ inviteId, secret }` starts an identity-only GitHub device flow and
 *    answers `{ flowId, userCode, verificationUri, expiresIn, interval,
 *    workspaceId, workspaceTitle }` — the UI shows the code + URL.
 * 2. `{ flowId }` blocks until the grant settles and answers the collaborator
 *    credential exactly once: `{ status: "authorized", token, principalId,
 *    login, workspaceId }`.
 *
 * Refusals carry `error.data.code` (`invite-expired`, `invite-pin-mismatch`,
 * `invite-flow-denied`, `workspace-full`, …) so the flow routes on a code,
 * never on prose.
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

/** Bound on phase-1 (`{ inviteId, secret }`): the daemon talks to GitHub once. */
const INVITE_START_TIMEOUT_MS = 30_000;

/** Method name for both redeem phases. */
// i18n-ignore (wire method name)
const INVITE_REDEEM_METHOD = 'invite.redeem';

/** Phase-1 result: the device-flow prompt. */
interface InviteRedeemStart {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  workspaceId: string;
  workspaceTitle: string;
}

/** Phase-2 result: the collaborator credential (returned exactly once). */
interface InviteCredential {
  status: 'authorized';
  token: string;
  principalId: string;
  login: string;
  workspaceId: string;
}

/**
 * The daemon's documented `error.data.code` values for `invite.redeem`
 * (intentd #1872; `workspace-full` — the guest cap is spent at join time —
 * from intentd #1917). The closed set is the ONLY server-authored text that
 * ever leaves {@link InviteRpcError}: a code outside it maps to `null`.
 */
const INVITE_ERROR_CODES = [
  'invite-not-found',
  'invite-expired',
  'invite-revoked',
  'invite-redeemed',
  'invite-pin-mismatch',
  'invite-pin-unknown',
  'invite-flow-busy',
  'invite-flow-denied',
  'invite-flow-error',
  'invite-flow-expired',
  'invite-flow-not-found',
  'workspace-full',
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
  /** Phase 1: start the device flow for this invite. */
  redeemStart(inviteId: string, secret: string): Promise<InviteRedeemStart>;
  /**
   * Phase 2: wait for the grant. Blocks for as long as the device flow is
   * open; `timeoutMs` (default: `expiresIn` + margin, supplied by the caller)
   * bounds the wait locally.
   */
  redeemWait(flowId: string, timeoutMs: number): Promise<InviteCredential>;
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
 * transport error ({@link PinMismatchError} for a foreign cert); `cancel()`
 * tears the socket down at whatever stage it is (a still-connecting
 * handshake is aborted, an open socket terminated) and rejects the promise.
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
      fail(new Error(`Unexpected server response: ${response.statusCode ?? 0}`));
    });
    ws.on('error', (error: Error) => fail(error));
    ws.on('close', () => fail(new Error('invite socket closed before open')));
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
 * cert changed), else the last transport error, else a timeout.
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
    let lastError: Error | null = null;
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
      settle(null, mismatch ?? lastError ?? new Error('invite connect timed out'));
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
            lastError = error;
          }
          pending -= 1;
          if (pending === 0) {
            settle(null, mismatch ?? lastError ?? new Error('invite connect failed'));
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
 */
async function dialThroughTunnel(
  tcAddress: string,
  port: number,
  expected: string,
  timeoutMs: number,
  spawn?: TailcatSpawn,
): Promise<{ ws: WsWebSocket; tunnel: TailcatTunnel }> {
  const binaryPath = resolveTailcatBinaryPath();
  if (!binaryPath) throw new Error('tailcat binary unavailable; cannot dial the invite tunnel');
  const tunnel = await createTailcatTunnel({
    // tc addresses are daemon-minted lowercase; normalise like captureFingerprint.
    tcAddress: tcAddress.trim().toLowerCase(),
    remotePort: port,
    binaryPath,
    ...(spawn ? { spawn } : {}),
  });
  try {
    const { ws } = await raceDirectHosts(['127.0.0.1'], tunnel.localPort, expected, timeoutMs);
    return { ws, tunnel };
  } catch (error) {
    tunnel.close();
    throw error;
  }
}

/**
 * Open a pin-verified `/invite` connection: the direct candidate hosts race
 * first; when none answers (or the link has none) and the envelope carries a
 * tc address, the tunnel is tried next. Rejects when everything fails: a
 * {@link PinMismatchError} from any candidate wins over generic failures
 * (the user must learn the cert changed), else the last transport error.
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
      directError = error instanceof Error ? error : new Error(String(error));
      if (tcAddress === null) throw directError;
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
 * `tunnel` that carried the socket is closed together with it.
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
  ws.on('error', (error: Error) => failAll(error));
  ws.on('close', () => {
    closed = true;
    failAll(new Error('invite connection closed'));
    closeTunnel();
  });

  const request = (params: Record<string, string>, timeoutMs: number): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      if (closed) {
        reject(new Error('invite connection closed'));
        return;
      }
      const id = nextId++;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              pending.delete(id);
              reject(new Error(`${INVITE_REDEEM_METHOD} timed out`));
            }, timeoutMs)
          : null;
      pending.set(id, { resolve, reject, timer });
      ws.send(
        JSON.stringify({ jsonrpc: '2.0', id, method: INVITE_REDEEM_METHOD, params }),
        (err) => {
          if (!err) return;
          pending.delete(id);
          if (timer) clearTimeout(timer);
          reject(err);
        },
      );
    });

  return {
    host,
    via,
    redeemStart: (inviteId, secret) =>
      request({ inviteId, secret }, INVITE_START_TIMEOUT_MS) as Promise<InviteRedeemStart>,
    redeemWait: (flowId, timeoutMs) => request({ flowId }, timeoutMs) as Promise<InviteCredential>,
    close: () => {
      if (closed) return;
      closed = true;
      failAll(new Error('invite connection closed'));
      ws.removeAllListeners('error');
      ws.on('error', () => {});
      ws.close();
      closeTunnel();
    },
  };
}
