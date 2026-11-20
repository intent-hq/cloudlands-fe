/**
 * Assistant remote backends (protocol `backends.report` / `backends.relayCall`).
 *
 * Every pooled main client tells its daemon which backends this app holds
 * credentials for, so that daemon's Assistant can call them through this app.
 * The report never carries a token; the daemon relays a call back here and
 * this app makes it with its own stored credential.
 */
import { Logger } from '$shared/logger';
import type { ConnectionRecord } from '$shared/types/connections';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { JsonRpcError, type JsonRpcErrorShape } from './json-rpc-errors';
import { ReverseRpcHandlerError, type JsonRpcClient } from './json-rpc-client';

const logger = new Logger('AssistantBackendRelay');

const BACKENDS_REPORT_METHOD = 'backends.report';
const BACKENDS_RELAY_METHOD = 'backends.relayCall';

/** Longest relayed call this app accepts; the daemon passes its own bound. */
const MAX_RELAY_TIMEOUT_MS = 10 * 60_000;

/** One reported backend (never a token). */
export interface ReportedBackend {
  name: string;
  host: string;
  hosts?: string[];
  port: number;
  fingerprint?: string;
  tcAddress?: string;
  connected?: boolean;
  daemonVersion?: string;
}

/** What this app knows about its local daemon, for the local entry. */
export interface LocalBackendFacts {
  name: string;
  host: string;
  port: number;
  fingerprint: string;
  daemonVersion?: string;
}

/** The Keychain machine identity (docs/protocol/backend-keychain.md). @internal */
export function backendIdentity(backend: {
  host: string;
  port: number;
  fingerprint?: string | null;
  tcAddress?: string | null;
}): string {
  const fingerprint = backend.fingerprint?.trim();
  if (fingerprint) return `fp:${fingerprint.toUpperCase()}`;
  const host = backend.host.trim().toLowerCase();
  if (host) return `addr:${host}:${backend.port}`;
  return `tc:${backend.tcAddress?.trim() ?? ''}`;
}

/**
 * The report for every saved remote connection plus this machine's local
 * daemon (when its fingerprint is known). Display-only rows are skipped.
 */
export function buildBackendsReport(
  records: readonly ConnectionRecord[],
  isConnected: (id: string) => boolean,
  local: LocalBackendFacts | null,
): ReportedBackend[] {
  const report: ReportedBackend[] = [];
  if (local) {
    report.push({
      name: local.name,
      host: local.host,
      port: local.port,
      fingerprint: local.fingerprint,
      connected: true,
      ...(local.daemonVersion ? { daemonVersion: local.daemonVersion } : {}),
    });
  }
  for (const record of records) {
    if (record.id === LOCAL_CONNECTION_ID || record.displayOnly) continue;
    const host = record.host ?? '';
    const tcAddress = record.tcAddress ?? undefined;
    if (!host && !tcAddress) continue;
    report.push({
      name: record.label,
      host,
      ...(record.hosts && record.hosts.length > 0 ? { hosts: [...record.hosts] } : {}),
      port: record.port ?? 0,
      ...(record.fingerprint ? { fingerprint: record.fingerprint } : {}),
      ...(tcAddress ? { tcAddress } : {}),
      connected: isConnected(record.id),
      ...(record.daemonVersion ? { daemonVersion: record.daemonVersion } : {}),
    });
  }
  return report;
}

interface RelayParams {
  backendId: string;
  method: string;
  params: unknown;
  timeoutMs: number;
}

function parseRelayParams(params: unknown): RelayParams {
  const obj = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  if (typeof obj.backendId !== 'string' || typeof obj.method !== 'string') {
    throw new ReverseRpcHandlerError(-32602, 'backendId and method are required');
  }
  const timeoutMs =
    typeof obj.timeoutMs === 'number' && obj.timeoutMs > 0
      ? Math.min(obj.timeoutMs, MAX_RELAY_TIMEOUT_MS)
      : 30_000;
  return { backendId: obj.backendId, method: obj.method, params: obj.params ?? {}, timeoutMs };
}

export interface RelayDeps {
  list(): Promise<readonly ConnectionRecord[]>;
  localFacts(): LocalBackendFacts | null;
  /** A connected client for a saved connection id (local included). */
  clientFor(connectionId: string): Promise<JsonRpcClient>;
}

/** Resolve the saved connection a relayed `backendId` names. @internal */
export async function connectionForBackend(
  backendId: string,
  deps: RelayDeps,
): Promise<string | null> {
  const local = deps.localFacts();
  if (local && backendIdentity(local) === backendId) return LOCAL_CONNECTION_ID;
  for (const record of await deps.list()) {
    if (record.id === LOCAL_CONNECTION_ID || record.displayOnly) continue;
    const identity = backendIdentity({
      host: record.host ?? '',
      port: record.port ?? 0,
      fingerprint: record.fingerprint,
      tcAddress: record.tcAddress,
    });
    if (identity === backendId) return record.id;
  }
  return null;
}

/** Serve `backends.relayCall`: `{ result }` or the remote's `{ error }`. @internal */
export async function handleRelayCall(params: unknown, deps: RelayDeps): Promise<unknown> {
  const call = parseRelayParams(params);
  const connectionId = await connectionForBackend(call.backendId, deps);
  if (!connectionId) {
    return {
      error: {
        code: -32602,
        // i18n-ignore (wire error for the daemon and agent, not UI copy)
        message: `This app has no saved connection for backend ${call.backendId}`,
        data: { code: 'unknown-backend' },
      },
    };
  }
  let client: JsonRpcClient;
  try {
    client = await deps.clientFor(connectionId);
  } catch (error) {
    // Nothing was sent: the call certainly did not run.
    return {
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
        data: { code: 'relay-unreachable' },
      },
    };
  }
  try {
    const result = await client.request(call.method, call.params, { timeoutMs: call.timeoutMs });
    return { result: result ?? null };
  } catch (error) {
    if (error instanceof JsonRpcError) {
      const shape: JsonRpcErrorShape = {
        code: error.rpcCode,
        message: error.message,
        ...(error.data === undefined ? {} : { data: error.data }),
      };
      return { error: shape };
    }
    // Sent, but no reply (timeout or the connection dropped): it may have run.
    logger.warn('Relayed call lost its reply', { backendId: call.backendId, method: call.method });
    return {
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
        data: { code: 'relay-outcome-unknown' },
      },
    };
  }
}

/** Register the relay handler on one pooled client. Returns the disposer. */
export function registerBackendRelayHandler(client: JsonRpcClient, deps: RelayDeps): () => void {
  return client.registerMethod(BACKENDS_RELAY_METHOD, (params) => handleRelayCall(params, deps));
}

/** Send this app's full backend list to one daemon. Never throws. */
export async function sendBackendsReport(
  client: JsonRpcClient,
  backends: ReportedBackend[],
): Promise<void> {
  try {
    await client.request(BACKENDS_REPORT_METHOD, { backends });
  } catch (error) {
    // Older daemons do not know the method; guests are refused. Neither matters here.
    logger.debug('backends.report not accepted', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
