/**
 * Main-process client for the daemon's `host.providerAuthStatus` RPC
 * (intent-hq/intentd#339). The daemon owns all provider auth probing; RPC
 * failures fold to an empty verdict map (every provider reads as unknown, no
 * indicator) so availability aggregation degrades instead of throwing.
 */
import { Logger } from '../logger';
import {
  getBackendClient,
  onBackendNotification,
  onBackendReconnected,
} from '../../features/backend/main/backend.ipc';
import type { JsonRpcClient } from '../../features/backend/main/json-rpc-client';
import {
  PROVIDER_AUTH_STATUS_METHOD,
  buildProviderAuthStatusParams,
  toAuthVerdictMap,
  type ProviderAuthStatusParams,
  type ProviderAuthStatusResponse,
  type ProviderAuthVerdict,
} from '../provider-auth-status';

const logger = new Logger('ProviderAuthStatus');
type VerdictMap = Record<string, ProviderAuthVerdict>;
type Pending = { generation: number; promise: Promise<VerdictMap> };
type Trailing = { force: boolean; promise: Promise<VerdictMap> };
const cache = new Map<string, VerdictMap>();
const pending = new Map<string, Pending>();
const trailing = new Map<string, Trailing>();
let generation = 0;
let lifecycleInstalled = false;

function invalidateProviderAuthStatus(): void {
  generation += 1;
  cache.clear();
}

function ensureLifecycle(): void {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;
  if (typeof onBackendNotification === 'function') {
    onBackendNotification((notification) => {
      if (notification.method !== 'events.event' || !notification.params) return;
      const params = notification.params as { event?: unknown; type?: unknown };
      const event = params.event && typeof params.event === 'object' ? params.event : params;
      if ((event as { type?: unknown }).type === 'provider:auth-changed') {
        invalidateProviderAuthStatus();
      }
    });
  }
  if (typeof onBackendReconnected === 'function') {
    onBackendReconnected(() => invalidateProviderAuthStatus());
  }
}

/**
 * Sweep (or single-provider) auth status from the daemon as an id → verdict
 * map (`authenticated` is `true` / `false` / `undefined` for the wire's
 * `null` unknowns; `authDetails` carries the rendered identity when sent).
 */
export async function getProviderAuthVerdicts(
  options: ProviderAuthStatusParams = {},
  client?: JsonRpcClient,
): Promise<Record<string, ProviderAuthVerdict>> {
  ensureLifecycle();
  const params = buildProviderAuthStatusParams(options);
  const key = params.providerId ?? '*';
  if (params.force) invalidateProviderAuthStatus();
  else if (cache.has(key)) return cache.get(key) ?? {};

  const active = pending.get(key);
  if (!params.force && active?.generation === generation) return active.promise;
  if (active) {
    const queued = trailing.get(key);
    if (queued) {
      queued.force ||= params.force === true;
      return queued.promise;
    }
    let queuedState!: Trailing;
    const next = active.promise
      .then(() =>
        getProviderAuthVerdicts(
          { providerId: params.providerId, force: queuedState.force },
          client,
        ),
      )
      .finally(() => {
        if (trailing.get(key) === queuedState) trailing.delete(key);
      });
    queuedState = { force: params.force === true, promise: next };
    trailing.set(key, queuedState);
    return next;
  }
  const requestGeneration = generation;
  let run!: Promise<VerdictMap>;
  run = (async (): Promise<VerdictMap> => {
    try {
      const response = await (client ?? getBackendClient()).request<ProviderAuthStatusResponse>(
        PROVIDER_AUTH_STATUS_METHOD,
        params,
      );
      const verdicts = toAuthVerdictMap(response);
      if (requestGeneration === generation) cache.set(key, verdicts);
      return verdicts;
    } catch (error) {
      logger.warn('host.providerAuthStatus RPC failed; auth verdicts degrade to unknown', {
        providerId: options.providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    } finally {
      if (pending.get(key)?.promise === run) pending.delete(key);
    }
  })();
  pending.set(key, { generation: requestGeneration, promise: run });
  return run;
}

export function __resetProviderAuthStatusForTests(): void {
  cache.clear();
  pending.clear();
  trailing.clear();
  generation += 1;
}

/** Single-provider convenience over {@link getProviderAuthVerdicts}. */
export async function getProviderAuthVerdict(
  providerId: string,
  options: { force?: boolean } = {},
  client?: JsonRpcClient,
): Promise<ProviderAuthVerdict | undefined> {
  const verdicts = await getProviderAuthVerdicts({ providerId, force: options.force }, client);
  return verdicts[providerId];
}
