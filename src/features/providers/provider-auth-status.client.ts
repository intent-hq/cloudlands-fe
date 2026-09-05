import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import {
  PROVIDER_AUTH_STATUS_METHOD,
  buildProviderAuthStatusParams,
  toAuthVerdictMap,
  type ProviderAuthStatusParams,
  type ProviderAuthStatusResponse,
  type ProviderAuthVerdict,
} from '$shared/provider-auth-status';

type VerdictMap = Record<string, ProviderAuthVerdict>;
type Pending = { generation: number; promise: Promise<VerdictMap> };
type Trailing = { force: boolean; promise: Promise<VerdictMap> };
type Cached = { expiresAt: number; verdicts: VerdictMap };

const PROVIDER_AUTH_CACHE_TTL_MS = 60_000;
const cache = new Map<string, Cached>();
const pending = new Map<string, Pending>();
const trailing = new Map<string, Trailing>();
let generation = 0;

const keyFor = (options: ProviderAuthStatusParams): string => options.providerId ?? '*';

function eventType(notification: { method: string; params?: unknown }): string | undefined {
  if (notification.method !== 'events.event' || !notification.params) return undefined;
  const params = notification.params as { event?: unknown; type?: unknown };
  const event = params.event && typeof params.event === 'object' ? params.event : params;
  const type = (event as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

export function invalidateProviderAuthStatus(providerId?: string): void {
  generation += 1;
  if (providerId) {
    cache.delete(providerId);
    cache.delete('*');
  } else cache.clear();
}

if (typeof onBackendNotification === 'function') {
  onBackendNotification((notification) => {
    if (eventType(notification) === 'provider:auth-changed') invalidateProviderAuthStatus();
  });
}
if (typeof onBackendReconnected === 'function') {
  onBackendReconnected(() => invalidateProviderAuthStatus());
}

export function getProviderAuthVerdicts(
  options: ProviderAuthStatusParams = {},
): Promise<VerdictMap> {
  const key = keyFor(options);
  if (options.force) invalidateProviderAuthStatus(options.providerId);
  else {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.verdicts);
    if (cached) cache.delete(key);
  }

  const active = pending.get(key);
  if (!options.force && active?.generation === generation) return active.promise;
  if (active) {
    const queued = trailing.get(key);
    if (queued) {
      queued.force ||= options.force === true;
      return queued.promise;
    }
    let queuedState!: Trailing;
    const run = active.promise
      .catch(() => ({}))
      .then(() => {
        if (trailing.get(key) === queuedState) trailing.delete(key);
        return getProviderAuthVerdicts({
          providerId: options.providerId,
          force: queuedState.force,
        });
      })
      .finally(() => {
        if (trailing.get(key) === queuedState) trailing.delete(key);
      });
    queuedState = { force: options.force === true, promise: run };
    trailing.set(key, queuedState);
    return run;
  }

  const requestGeneration = generation;
  const run = backendRequest<ProviderAuthStatusResponse>(
    PROVIDER_AUTH_STATUS_METHOD,
    buildProviderAuthStatusParams(options),
  )
    .then(toAuthVerdictMap)
    .then((verdicts) => {
      if (requestGeneration === generation) {
        cache.set(key, { verdicts, expiresAt: Date.now() + PROVIDER_AUTH_CACHE_TTL_MS });
      }
      return verdicts;
    })
    .finally(() => {
      if (pending.get(key)?.promise === run) pending.delete(key);
    });
  pending.set(key, { generation: requestGeneration, promise: run });
  return run;
}

export function __resetProviderAuthStatusForTests(): void {
  cache.clear();
  pending.clear();
  trailing.clear();
  generation += 1;
}
