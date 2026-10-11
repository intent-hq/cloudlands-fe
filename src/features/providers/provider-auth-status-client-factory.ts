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
export function createProviderAuthStatusClient({
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
  connectionContext,
}: {
  backendRequest: import('$lib/client/live/backend-transport-types').BackendTransport['request'];
  onBackendNotification: (
    handler: (
      notification: import('$lib/client/live/backend-transport-types').BackendNotification,
    ) => void,
  ) => () => void;
  onBackendReconnected: (handler: () => void) => () => void;
  connectionContext: () => string | null;
}) {
  const cache = new Map<string, Cached>();
  const pending = new Map<string, Pending>();
  const trailing = new Map<string, Trailing>();
  let generation = 0;
  let connectionGeneration = 0;

  const keyFor = (options: ProviderAuthStatusParams): string =>
    JSON.stringify([
      connectionContext(),
      connectionGeneration,
      options.workspaceId ?? null,
      options.providerId ?? '*',
    ]);

  function eventType(notification: { method: string; params?: unknown }): string | undefined {
    if (notification.method !== 'events.event' || !notification.params) return undefined;
    const params = notification.params as { event?: unknown; type?: unknown };
    const event = params.event && typeof params.event === 'object' ? params.event : params;
    const type = (event as { type?: unknown }).type;
    return typeof type === 'string' ? type : undefined;
  }

  function invalidateProviderAuthStatus(providerId?: string): void {
    generation += 1;
    if (providerId) {
      for (const key of cache.keys()) {
        const [, , , cachedProvider] = JSON.parse(key) as [
          string | null,
          number,
          string | null,
          string,
        ];
        if (cachedProvider === providerId || cachedProvider === '*') cache.delete(key);
      }
    } else cache.clear();
  }

  let cleanup: (() => void) | undefined;
  let lifetime = 0;
  function start(): void {
    if (cleanup) return;
    const offNotification = onBackendNotification((notification) => {
      if (
        ['provider:auth-changed', 'host:execution-context-changed'].includes(
          eventType(notification) ?? '',
        )
      )
        invalidateProviderAuthStatus();
    });
    const offReconnect = onBackendReconnected(() => {
      connectionGeneration += 1;
      invalidateProviderAuthStatus();
    });
    cleanup = () => {
      offNotification();
      offReconnect();
    };
  }
  function dispose(): void {
    cleanup?.();
    cleanup = undefined;
    lifetime += 1;
    __resetProviderAuthStatusForTests();
  }

  function getProviderAuthVerdicts(options: ProviderAuthStatusParams = {}): Promise<VerdictMap> {
    start();
    const requestLifetime = lifetime;
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
      const run = active.promise
        .catch(() => ({}))
        .then(() => {
          if (requestLifetime !== lifetime) throw new Error('Provider auth client disposed');
          if (trailing.get(key) === queuedState) trailing.delete(key);
          return getProviderAuthVerdicts({
            ...options,
            force: queuedState.force,
          });
        })
        .finally(() => {
          if (trailing.get(key) === queuedState) trailing.delete(key);
        });
      const queuedState: Trailing = { force: options.force === true, promise: run };
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
        if (
          requestLifetime === lifetime &&
          requestGeneration === generation &&
          key === keyFor(options)
        ) {
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

  function __resetProviderAuthStatusForTests(): void {
    cache.clear();
    pending.clear();
    trailing.clear();
    generation += 1;
  }

  return {
    getProviderAuthVerdicts,
    invalidateProviderAuthStatus,
    start,
    dispose,
    __resetProviderAuthStatusForTests,
  };
}
