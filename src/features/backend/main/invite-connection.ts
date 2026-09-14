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
 * `invite-flow-denied`, …) so the flow routes on a code, never on prose.
 *
 * Trust: the link's `fp` pins the daemon's self-signed cert and every
 * candidate host is dialed through {@link pinnedTlsConnect}, so the invite
 * secret never leaves this process before the pin has been verified at the
 * TLS handshake. Candidate hosts race in parallel (first pin-verified open
 * wins, the rest are torn down); the tunnel candidate is not raced here —
 * the stored guest session keeps `tcAddress` for the regular connect path.
 */

import net from 'node:net';
import tls from 'node:tls';
import { createRequire } from 'node:module';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket as WsWebSocket } from 'ws';
import { Logger } from '$shared/logger';
import { PinMismatchError, normalizeFingerprint, pinnedTlsConnect } from './backend-connection';

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
 * A JSON-RPC error frame from the `/invite` endpoint. `inviteCode` is the
 * daemon's `error.data.code` (`invite-expired`, `invite-flow-denied`, …)
 * when present, so callers branch on it instead of the message.
 */
export class InviteRpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  readonly inviteCode: string | null;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'InviteRpcError';
    this.code = code;
    this.data = data;
    const c = data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined;
    this.inviteCode = typeof c === 'string' ? c : null;
  }
}

/** Where to dial: the invite link's envelope. */
export interface InviteTarget {
  hosts: string[];
  port: number;
  /** Pinned cert fingerprint, any case/separator (normalized before use). */
  fingerprint: string;
}

/** An open, pin-verified `/invite` connection. */
export interface InviteConnection {
  /** Candidate host that won the race. */
  readonly host: string;
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

/**
 * Dial one candidate host's `/invite` endpoint with the pin enforced at the
 * TLS handshake. Resolves with the open socket; rejects with the transport
 * error ({@link PinMismatchError} for a foreign cert).
 */
function dialInvite(host: string, port: number, expected: string): Promise<WsWebSocket> {
  return new Promise<WsWebSocket>((resolve, reject) => {
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
}

/**
 * Open a pin-verified `/invite` connection to the first candidate host that
 * answers. Rejects when every candidate fails: a {@link PinMismatchError}
 * wins over generic failures (the user must learn the cert changed), else
 * the last transport error, else a timeout.
 */
export async function openInviteConnection(
  target: InviteTarget,
  options: { timeoutMs?: number } = {},
): Promise<InviteConnection> {
  const hosts = [...new Set(target.hosts.map((h) => h.trim()).filter((h) => h !== ''))];
  if (hosts.length === 0) throw new Error('invite target has no host');
  const expected = normalizeFingerprint(target.fingerprint);
  if (expected === '') throw new Error('invite target has no pinned fingerprint');
  const timeoutMs = options.timeoutMs ?? INVITE_CONNECT_TIMEOUT_MS;

  const winner = await new Promise<{ host: string; ws: WsWebSocket }>((resolve, reject) => {
    let settled = false;
    let pending = hosts.length;
    let mismatch: PinMismatchError | null = null;
    let lastError: Error | null = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(mismatch ?? lastError ?? new Error('invite connect timed out'));
    }, timeoutMs);
    for (const host of hosts) {
      dialInvite(host, target.port, expected).then(
        (ws) => {
          if (settled) {
            ws.on('error', () => {});
            ws.terminate();
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve({ host, ws });
        },
        (error: Error) => {
          if (error instanceof PinMismatchError) {
            mismatch ??= error;
            logger.warn('invite candidate presented a foreign certificate', { host });
          } else {
            lastError = error;
          }
          pending -= 1;
          if (pending === 0 && !settled) {
            settled = true;
            clearTimeout(timer);
            reject(mismatch ?? lastError ?? new Error('invite connect failed'));
          }
        },
      );
    }
  });

  return attachRpc(winner.host, winner.ws);
}

/** Minimal JSON-RPC 2.0 request/response over an open `/invite` socket. */
function attachRpc(host: string, ws: WsWebSocket): InviteConnection {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let closed = false;

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
      const e = frame.error as { code?: unknown; message?: unknown; data?: unknown };
      p.reject(
        new InviteRpcError(
          typeof e.code === 'number' ? e.code : -32000,
          typeof e.message === 'string' ? e.message : 'invite request failed',
          e.data,
        ),
      );
      return;
    }
    p.resolve(frame.result);
  });
  ws.on('error', (error: Error) => failAll(error));
  ws.on('close', () => {
    closed = true;
    failAll(new Error('invite connection closed'));
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
    },
  };
}
