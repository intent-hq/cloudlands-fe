/**
 * Redeem a local pairing code against another Intent on this computer
 * (protocol §5.58, requester side).
 *
 * The record is re-read from the discovery folder by instance id (the
 * renderer never supplies a port or fingerprint). The `/local-pair` upgrade is
 * pinned to the record's fingerprint at the TLS handshake, so the code is
 * never written to any other listener. The grant is checked against the
 * record and the dialed port before the credential is saved as a machine;
 * on any mismatch the token is dropped.
 */

import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import type net from 'node:net';
import type tls from 'node:tls';
import { Logger } from '$shared/logger';
import type { ConnectionRecord } from '$shared/types/connections';
import type {
  LocalRedeemError,
  LocalRedeemErrorCode,
  LocalRedeemResult,
} from '$shared/types/local-pairing';
import { formatLocalCode, isWellFormedLocalCode } from '$shared/utils/local-pairing-code';
import {
  normalizeFingerprint,
  PinMismatchError,
  pinnedTlsConnect,
} from '../../backend/main/backend-connection';
import type { NewConnection } from '../../backend/main/connections-store';
import type { LocalDaemonRecord } from './local-daemon-discovery';

const logger = new Logger('LocalPairRedeem');

const nodeRequire = createRequire(import.meta.url);

/** The contract's `appName` limit. */
const MAX_APP_NAME = 64;
const EXCHANGE_TIMEOUT_MS = 10_000;
const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const;

/** What one `/local-pair` exchange produced. */
export type LocalPairExchange =
  | { kind: 'response'; message: unknown; presentedFingerprint: string }
  /** The upgrade was answered with an HTTP status instead of 101. */
  | { kind: 'http'; status: number }
  | { kind: 'pin-mismatch' }
  /** Nothing listening: the request was never sent. */
  | { kind: 'connect-failed' }
  /** The connection closed after the request was sent, before an answer. */
  | { kind: 'dropped' }
  | { kind: 'timeout' };

export interface LocalPairRequest {
  host: string;
  port: number;
  /** Normalized pin. */
  fingerprint: string;
  body: string;
}

export interface LocalPairRedeemDeps {
  /** Re-read the discovery folder for this instance; null when it is gone. */
  findRecord(instanceId: string): Promise<LocalDaemonRecord | null>;
  exchange(request: LocalPairRequest): Promise<LocalPairExchange>;
  add(connection: NewConnection): Promise<ConnectionRecord>;
  /** Shown on the other Intent's list, for example "Intent Alpha". */
  appName: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (code: LocalRedeemErrorCode, extra: Partial<LocalRedeemError> = {}) =>
  ({ ok: false, error: { code, ...extra } }) as const;

/**
 * @internal Exported for tests.
 *
 * Map a JSON-RPC error from `pairing.redeemLocalCode` to the error shown.
 * Unknown codes fall through to `unknown`; any code that names the remote
 * access tunnel maps to `remote-access-on`.
 */
export function mapRedeemRpcError(error: unknown): LocalRedeemError {
  const value = isRecord(error) ? error : {};
  const numeric = typeof value.code === 'number' ? value.code : null;
  const data = isRecord(value.data) ? value.data : {};
  const code = typeof data.code === 'string' ? data.code : null;
  switch (code) {
    case 'local-code-invalid': {
      const left = data.attemptsRemaining;
      return typeof left === 'number' && Number.isInteger(left) && left >= 1
        ? { code: 'wrong-code', attemptsRemaining: left }
        : { code: 'wrong-code' };
    }
    case 'local-code-locked':
      return { code: 'locked' };
    case 'local-code-expired':
      return { code: 'expired' };
    case 'invalid-params':
      return { code: 'code-format' };
    case 'not-loopback':
      return { code: 'refused' };
  }
  if (code && /tunnel|remote-access/i.test(code)) return { code: 'remote-access-on' };
  if (!code && (numeric === -32001 || numeric === -32601)) return { code: 'unsupported' };
  return { code: 'unknown' };
}

/** Map an upgrade answered with an HTTP status. */
function mapHttpStatus(status: number): LocalRedeemErrorCode {
  if (status === 403) return 'refused';
  if (status === 404) return 'unsupported';
  if (status === 503) return 'busy';
  return 'unreachable';
}

interface Grant {
  host: string;
  port: number;
  fingerprint: string;
  token: string;
  displayName: string;
}

/** Check the grant against what was pinned and dialed; null on any mismatch. */
function verifyGrant(
  result: unknown,
  record: LocalDaemonRecord,
  dialed: { port: number; presentedFingerprint: string },
): Grant | null {
  if (!isRecord(result) || result.version !== 1) return null;
  const { host, port, fingerprint, token, credentialId, displayName } = result;
  if (typeof host !== 'string' || !(LOOPBACK_HOSTS as readonly string[]).includes(host))
    return null;
  if (port !== dialed.port || port !== record.port) return null;
  if (typeof fingerprint !== 'string') return null;
  const pin = normalizeFingerprint(fingerprint);
  if (pin !== record.fingerprint || pin !== dialed.presentedFingerprint) return null;
  if (typeof token !== 'string' || !/^[0-9a-fA-F]{64}$/.test(token)) return null;
  if (typeof credentialId !== 'string' || !credentialId) return null;
  return {
    host,
    port,
    fingerprint: pin,
    token,
    displayName:
      typeof displayName === 'string' && displayName.trim()
        ? displayName.trim().slice(0, 200)
        : record.displayName,
  };
}

export function createLocalPairRedeemer(deps: LocalPairRedeemDeps) {
  const appName =
    deps.appName.trim().slice(0, MAX_APP_NAME) || 'Intent'; /* i18n-ignore (wire value) */

  return async function redeem(instanceId: string, code: string): Promise<LocalRedeemResult> {
    if (!isWellFormedLocalCode(code)) return fail('code-format');
    const record = await deps.findRecord(instanceId);
    if (!record) return fail('gone');
    if (record.port === null) return fail('not-listening');
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'pairing.redeemLocalCode',
      params: { code: formatLocalCode(code), appName },
    });

    let outcome: LocalPairExchange = { kind: 'connect-failed' };
    let dialedHost: string = LOOPBACK_HOSTS[0];
    for (const host of LOOPBACK_HOSTS) {
      dialedHost = host;
      outcome = await deps.exchange({
        host,
        port: record.port,
        fingerprint: record.fingerprint,
        body,
      });
      // Only "nothing listening here" tries the other loopback address: an
      // answer of any kind means the code may have been read.
      if (outcome.kind !== 'connect-failed') break;
    }

    switch (outcome.kind) {
      case 'pin-mismatch':
        return fail('certificate');
      case 'http':
        return fail(mapHttpStatus(outcome.status));
      case 'connect-failed':
      case 'dropped':
      case 'timeout':
        return fail('unreachable');
    }
    const message = isRecord(outcome.message) ? outcome.message : {};
    if (message.error !== undefined) {
      const error = mapRedeemRpcError(message.error);
      if (error.code === 'unknown') {
        const data =
          isRecord(message.error) && isRecord(message.error.data) ? message.error.data : {};
        logger.warn('Local pairing refused with an unknown error', {
          rpcCode: isRecord(message.error) ? message.error.code : null,
          dataCode: typeof data.code === 'string' ? data.code.slice(0, 64) : null,
        });
      }
      return { ok: false, error };
    }
    const grant = verifyGrant(message.result, record, {
      port: record.port,
      presentedFingerprint: outcome.presentedFingerprint,
    });
    if (!grant) {
      logger.warn('Local pairing grant did not match the discovery record; discarded', {
        dialedHost,
      });
      return fail('certificate');
    }
    try {
      const connection = await deps.add({
        label: grant.displayName,
        host: grant.host,
        port: grant.port,
        fingerprint: grant.fingerprint,
        token: grant.token,
        // The credential is admitted only from loopback: never look for LAN
        // addresses, never sync this record to other computers.
        detectHosts: false,
        syncExcluded: true,
        daemonMode: 'regular',
        localPairing: true,
      });
      return { ok: true, connection };
    } catch (error) {
      logger.warn('Could not save the paired machine', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return fail('save-failed');
    }
  };
}

const { WebSocket: NodeWebSocket } = nodeRequire('ws') as {
  WebSocket: typeof import('ws').WebSocket;
};

function presentedFingerprint(response: IncomingMessage): string {
  const socket = response.socket as tls.TLSSocket;
  return normalizeFingerprint(socket.getPeerCertificate?.()?.fingerprint256 ?? '');
}

/**
 * One `/local-pair` request over a pinned TLS WebSocket: no Origin, no
 * Authorization, one request, the first reply with a matching id.
 */
export function exchangeOverLocalPair(
  request: LocalPairRequest,
  timeoutMs = EXCHANGE_TIMEOUT_MS,
): Promise<LocalPairExchange> {
  const authority = request.host.includes(':') ? `[${request.host}]` : request.host;
  return new Promise<LocalPairExchange>((resolve) => {
    let settled = false;
    let fingerprint = '';
    let opened = false;
    const ws = new NodeWebSocket(`wss://${authority}:${request.port}/local-pair`, {
      rejectUnauthorized: false,
      followRedirects: false,
      maxPayload: 64 * 1024,
      handshakeTimeout: timeoutMs,
      createConnection: ((options: tls.ConnectionOptions) =>
        pinnedTlsConnect(options, request.fingerprint)) as unknown as typeof net.createConnection,
    });
    const finish = (outcome: LocalPairExchange) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        // already closed
      }
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
    timer.unref?.();
    ws.on('upgrade', (response: IncomingMessage) => {
      fingerprint = presentedFingerprint(response);
      if (fingerprint !== request.fingerprint) finish({ kind: 'pin-mismatch' });
    });
    ws.on('unexpected-response', (_req, response: IncomingMessage) => {
      if (presentedFingerprint(response) !== request.fingerprint) {
        finish({ kind: 'pin-mismatch' });
        return;
      }
      finish({ kind: 'http', status: response.statusCode ?? 0 });
    });
    ws.on('open', () => {
      opened = true;
      ws.send(request.body);
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let message: unknown;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (isRecord(message) && message.id === 1)
        finish({ kind: 'response', message, presentedFingerprint: fingerprint });
    });
    const lost = (): LocalPairExchange =>
      opened ? { kind: 'dropped' } : { kind: 'connect-failed' };
    ws.on('error', (error: Error) =>
      finish(error instanceof PinMismatchError ? { kind: 'pin-mismatch' } : lost()),
    );
    ws.on('close', () => finish(lost()));
  });
}
