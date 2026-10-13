/**
 * App Settings Service (Main Process)
 *
 * Backend policy: local-only. Every RPC goes through the shared
 * `getLocalBackendClient()` (fail-closed when the local backend has no live
 * client — never falls back to the primary), and all listeners are pinned to
 * `LOCAL_CONNECTION_ID`: these values feed local filesystem/git paths in the
 * Electron main process.
 *
 * Sync accessors for the three workspace-scoped app settings consumed on
 * synchronous main-process paths (branch-prefix injection, worktree layout,
 * git-env SSH key). The source of truth is the daemon settings catalog
 * (PROTOCOL.md §5.12):
 *
 *   - `workspace.branchPrefix`      → `getBranchPrefix()`
 *   - `workspace.worktreesLocation` → `getWorktreesLocation()`
 *   - `workspace.sshKeyPath`        → `getSshKeyPath()`  (plain string,
 *                                     see intent-services/settings.rs A9)
 *
 * `initAppSettingsService()` hydrates each value from the LOCAL backend into
 * a module-level cache via `settings.get` at process start; the sync getters serve the cached
 * value and fall back to `''` while unhydrated (matches the pre-P3-4
 * behaviour when the electron-store key was absent). This mirrors the
 * hydration-cache pattern used by workspace-settings.service.ts and
 * notification.service.ts.
 *
 * Hydration is NON-BLOCKING: `initAppSettingsService()` resolves as soon as
 * the listeners are attached and the fetch has been started, never on a
 * daemon round-trip. It runs in the `criticalIPC` phase of main/index.ts
 * ahead of window creation, and a freshly spawned sidecar can take seconds
 * to open its socket — awaiting the fetch there gated the first window on
 * the JSON-RPC reconnect backoff.
 *
 * A failed per-path fetch leaves that cache UN-hydrated (never cached as
 * `''`): a later `initAppSettingsService()` call retries the missing paths,
 * and an armed `status` listener re-runs hydration on the client's next
 * `connected` transition (the first attempt can still race the socket of a
 * sidecar that was just spawned, see main/index.ts).
 *
 * Saved settings refresh in-session: the service owns ONE long-lived
 * LOCAL-backend `events.subscribe(['settings:changed'])` subscription (§6.5, same
 * pattern as notification.service.ts) and applies deltas for the three
 * paths straight into the cache, so `settings.update` from the Git &
 * Workspace settings panel takes effect without a relaunch. The
 * subscription is re-issued on backend reconnect (RESUB-1) alongside a
 * full re-fetch to cover changes missed while disconnected. Remote backend
 * changes are intentionally ignored: these values feed local filesystem/git
 * paths in the Electron main process.
 *
 * The legacy `settings` electron-store, its `getSetting`/`setSetting`
 * facade, and the dead `websocketApi-*` helpers are retired here — no
 * remaining consumers in main.
 */

import {
  captureMainEventRecovery,
  onMainEventRecoveryReady,
} from '../../backend/main/main-event-recovery';
import { Logger } from '../../../shared/logger';
import {
  getLocalBackendClient,
  onBackendNotification,
  onBackendReconnected,
  onBackendStatus,
} from '../../backend/main/backend.ipc';
import { LOCAL_CONNECTION_ID } from '../../backend/main/connections-store';
import type {
  ConnectionStatus,
  JsonRpcClient,
  JsonRpcNotification,
} from '../../backend/main/json-rpc-client';

const logger = new Logger({ category: 'AppSettingsService' });

/** Daemon setting paths hydrated by this service (§5.12). */
const SETTING_PATH_BRANCH_PREFIX = 'workspace.branchPrefix';
const SETTING_PATH_WORKTREES_LOCATION = 'workspace.worktreesLocation';
const SETTING_PATH_SSH_KEY_PATH = 'workspace.sshKeyPath';

const APP_SETTING_PATHS: readonly string[] = [
  SETTING_PATH_BRANCH_PREFIX,
  SETTING_PATH_WORKTREES_LOCATION,
  SETTING_PATH_SSH_KEY_PATH,
];

/**
 * Hydrated caches. `null` while unhydrated; the sync getters fall back to
 * `''` in that window (identical to the pre-P3-4 default).
 */
let cachedBranchPrefix: string | null = null;
let cachedWorktreesLocation: string | null = null;
let cachedSshKeyPath: string | null = null;
let recovery: ReturnType<typeof captureMainEventRecovery>;
let recoveryResource:
  ReturnType<NonNullable<typeof recovery>['coordinator']['registerResource']> | undefined;
let authorityRetired = false;
let identityClient: JsonRpcClient | undefined;
let identityDisposer: (() => void) | undefined;
let ordinaryRefresh: Promise<void> | undefined;
let hydrationPromise: Promise<void> | null = null;
/** One-time guard for the notification / reconnect listeners. */
let listenersAttached = false;
/** Live `settings:changed` subscription id; undefined until subscribed. */
let subscriptionId: string | undefined;
/** Guards against stale in-flight `events.subscribe` calls (bumped on reconnect). */
let subscribeEpoch = 0;
/** Detaches the pending connect-retry `status` listener, when armed. */
let statusRetryDisposer: (() => void) | undefined;
/** Disposers for the long-lived listeners `attachSettingsListeners` installs. */
let notificationDisposer: (() => void) | undefined;
let reconnectDisposer: (() => void) | undefined;
/**
 * Per-path counter bumped on every `settings:changed` write, so an in-flight
 * `settings.get` result that raced a newer delta is discarded as stale.
 */
const deltaVersions = new Map<string, number>();
/** Bounded delayed retry for `events.subscribe` failures on a healthy connection. */
const SUBSCRIBE_RETRY_DELAY_MS = 5_000;
const MAX_SUBSCRIBE_RETRIES = 3;
let subscribeRetryTimer: ReturnType<typeof setTimeout> | undefined;
let subscribeRetryCount = 0;

function getCachedValue(path: string): string | null {
  switch (path) {
    case SETTING_PATH_BRANCH_PREFIX:
      return cachedBranchPrefix;
    case SETTING_PATH_WORKTREES_LOCATION:
      return cachedWorktreesLocation;
    case SETTING_PATH_SSH_KEY_PATH:
      return cachedSshKeyPath;
    default:
      return null;
  }
}

function setCachedValue(path: string, value: string): void {
  switch (path) {
    case SETTING_PATH_BRANCH_PREFIX:
      cachedBranchPrefix = value;
      break;
    case SETTING_PATH_WORKTREES_LOCATION:
      cachedWorktreesLocation = value;
      break;
    case SETTING_PATH_SSH_KEY_PATH:
      cachedSshKeyPath = value;
      break;
  }
}

function allHydrated(): boolean {
  return APP_SETTING_PATHS.every((path) => getCachedValue(path) !== null);
}

async function fetchStringSetting(path: string): Promise<string> {
  const client = getLocalBackendClient();
  if (typeof client.getRepositoryConnection === 'function' && !client.getRepositoryConnection())
    throw new Error('Local identity unavailable');
  const result = (await (recovery?.session ?? getLocalBackendClient()).request('settings.get', {
    path,
  })) as { value?: unknown } | null;
  const value = result?.value;
  return typeof value === 'string' ? value : '';
}

/**
 * Fetch `paths` from the daemon and cache each on success. A per-path
 * failure is warn-logged and leaves that cache untouched (un-hydrated when
 * it was `null`), so a later retry can still hydrate it.
 */
async function refreshSettings(paths: readonly string[]): Promise<void> {
  const epoch = subscribeEpoch;
  const run = (ordinaryRefresh ?? Promise.resolve()).then(() => {
    if (epoch === subscribeEpoch) return refreshSettingsPass(paths);
  });
  ordinaryRefresh = run;
  try {
    await run;
  } finally {
    if (ordinaryRefresh === run) ordinaryRefresh = undefined;
  }
}

async function refreshSettingsPass(paths: readonly string[]): Promise<void> {
  if (
    authorityRetired ||
    (typeof getLocalBackendClient().getRepositoryConnection === 'function' &&
      !recovery?.session.isCurrent())
  )
    return;
  // Missing-path hydration joins recovery demand instead of issuing parallel reads.
  if (recoveryResource?.status.stale) {
    if (recoveryResource.status.suspended) recoveryResource.refresh();
    return;
  }
  const epoch = subscribeEpoch;
  const receipt = recoveryResource?.captureLifetime();
  await Promise.all(
    paths.map(async (path) => {
      const versionAtFetch = deltaVersions.get(path) ?? 0;
      try {
        const value = await fetchStringSetting(path);
        if ((deltaVersions.get(path) ?? 0) !== versionAtFetch) {
          // A settings:changed delta for this path landed while the fetch
          // was in flight — the delta is newer, keep it.
          logger.info(`Discarding stale settings.get result for ${path}`);
          return;
        }
        if (epoch !== subscribeEpoch) return;
        if (receipt) {
          const committed = receipt.commit(() => {
            setCachedValue(path, value);
          });
          // These paths are independent settings. An unrelated path's push
          // supersedes the grouped receipt, but not this unchanged path version.
          // Re-admit only within the same lease epoch and a clean resource.
          const current = recoveryResource?.captureLifetime();
          if (!committed && current?.key === receipt.key && !authorityRetired)
            current.commit(() => {
              setCachedValue(path, value);
            });
        } else setCachedValue(path, value);
      } catch (error) {
        logger.warn(`Failed to hydrate ${path} from daemon`, {
          error: (error as Error).message,
        });
      }
    }),
  );
}

/**
 * Apply a `settings:changed` delta (§6.5, `data.changes: [{ path, value }]`)
 * for the paths this service owns. Values are normalized like
 * `fetchStringSetting` — non-string (e.g. a reset to the catalog default)
 * becomes `''`.
 */
function handleBackendNotification(n: JsonRpcNotification, ordered = false): void {
  if (recovery && !ordered) return;
  if (n.method !== 'events.event') return;
  const params = n.params as { subscriptionId?: unknown; event?: unknown } | undefined;
  const subId = typeof params?.subscriptionId === 'string' ? params.subscriptionId : undefined;
  // Strict match: the shared client also carries notifications for
  // renderer-proxied subscriptions; only our own subscription's events
  // may touch the cache.
  if (!ordered && (!subscriptionId || subId !== subscriptionId)) return;
  const event = params?.event as { type?: unknown; data?: unknown } | undefined;
  if (!event || event.type !== 'settings:changed') return;
  const changes = (event.data as { changes?: unknown } | undefined)?.changes;
  if (!Array.isArray(changes)) return;
  for (const entry of changes) {
    if (!entry || typeof entry !== 'object') continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path !== 'string' || !APP_SETTING_PATHS.includes(path)) continue;
    const value = (entry as { value?: unknown }).value;
    deltaVersions.set(path, (deltaVersions.get(path) ?? 0) + 1);
    setCachedValue(path, typeof value === 'string' ? value : '');
    logger.info('App setting refreshed from settings:changed', { path });
  }
}

/**
 * Issue `events.subscribe` for `settings:changed` (global — no workspace
 * envelope). On failure (including a response without a `subscriptionId`),
 * arm the `status` retry so the next `connected` transition re-issues it
 * (covers the init-before-first-connect gap) AND schedule a bounded delayed
 * retry, which covers a transient subscribe failure while the connection is
 * already up and never transitions.
 */
function retireSettings(): void {
  authorityRetired = true;
  subscribeEpoch++;
  subscriptionId = undefined;
  cachedBranchPrefix = cachedWorktreesLocation = cachedSshKeyPath = null;
  hydrationPromise = null;
  recoveryResource = undefined;
}

function captureSettingsRecovery(): void {
  const client = getLocalBackendClient();
  if (identityClient !== client) {
    identityDisposer?.();
    identityClient = client;
    identityDisposer =
      typeof client.getRepositoryConnection === 'function'
        ? onMainEventRecoveryReady(client, () => {
            if (recovery?.session.isCurrent()) return;
            void initAppSettingsService();
          })
        : undefined;
  }
  if (recovery?.session.isCurrent()) return;
  recovery = captureMainEventRecovery(client, retireSettings);
  if (!recovery) return;
  authorityRetired = false;
  recoveryResource = recovery.coordinator.registerResource({
    key: 'app-settings',
    workspaceId: null,
    eventTypes: ['settings:changed'],
    read: async (reader) => {
      await ordinaryRefresh;
      const results = await Promise.allSettled(
        APP_SETTING_PATHS.map(async (path) => {
          const result = await reader.request<{ value?: unknown }>('settings.get', { path });
          return [path, typeof result?.value === 'string' ? result.value : ''] as const;
        }),
      );
      // Keep the cycle active until every sibling settles; an early rejection
      // must not allow the retry timer to duplicate still-running path reads.
      const failures = results.filter((result) => result.status === 'rejected');
      const authorityFailure = failures.find(({ reason }) => {
        const error = reason as { rpcCode?: number; data?: { code?: string } } | null;
        return (
          error?.rpcCode === -32003 ||
          error?.rpcCode === -32001 ||
          (error?.rpcCode === -32602 && error.data?.code === 'not-found')
        );
      });
      if (failures.length) throw (authorityFailure ?? failures[0]).reason;
      return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    },
    apply: (values) => {
      for (const [path, value] of values) setCachedValue(path, value);
    },
    invalidate: () => {},
    retire: () => {
      retireSettings();
    },
    onEvent: (n) => handleBackendNotification(n, true),
  });
}

async function subscribeToSettingsChanges(): Promise<void> {
  captureSettingsRecovery();
  const epoch = subscribeEpoch;
  try {
    const client = getLocalBackendClient();
    if (typeof client.getRepositoryConnection === 'function' && !client.getRepositoryConnection())
      throw new Error('Local identity unavailable');
    if (typeof client.getRepositoryConnection === 'function' && !recovery) return;
    const id = recovery
      ? (
          await recovery.coordinator.subscribe(
            { eventTypes: ['settings:changed'] },
            { recover: true },
          )
        )?.id
      : (
          (await client.request('events.subscribe', { eventTypes: ['settings:changed'] })) as {
            subscriptionId?: string;
          }
        )?.subscriptionId;
    if (epoch !== subscribeEpoch) {
      // A reconnect ran while subscribe was in flight; this id belongs to
      // the previous connection generation. Best-effort release it.
      if (id) {
        void client.request('events.unsubscribe', { subscriptionId: id }).catch(() => {});
      }
      return;
    }
    if (!id) {
      // A subscribe without an id would silently drop every delta (strict
      // id match in handleBackendNotification) — treat it as a failure.
      logger.warn('events.subscribe returned no subscriptionId; will retry');
      armStatusRetry();
      scheduleSubscribeRetry();
      return;
    }
    subscriptionId = id;
    subscribeRetryCount = 0;
  } catch (error) {
    logger.warn('events.subscribe for settings:changed failed; will retry', {
      error: (error as Error).message,
    });
    if (epoch !== subscribeEpoch) return;
    armStatusRetry();
    scheduleSubscribeRetry();
  }
}

/**
 * Re-run hydration and/or the `settings:changed` subscribe on the client's
 * next `connected` transition. Shared by both failure paths.
 */
function armStatusRetry(): void {
  if (statusRetryDisposer) return;
  const listener = (status: ConnectionStatus): void => {
    if (status !== 'connected') return;
    clearStatusRetry();
    clearSubscribeRetry();
    void (async () => {
      // Subscribe-before-fetch: a change landing during the re-fetch is
      // then delivered as a delta instead of being lost.
      if (!subscriptionId) await subscribeToSettingsChanges();
      if (!allHydrated()) await initAppSettingsService();
    })();
  };
  // Register on the stable status forwarder so the retry survives a backend
  // switch instead of stranding on the disposed client.
  statusRetryDisposer = onBackendStatus(listener, LOCAL_CONNECTION_ID);
}

function clearStatusRetry(): void {
  statusRetryDisposer?.();
  statusRetryDisposer = undefined;
}

/**
 * Schedule one delayed `events.subscribe` retry (bounded, no backoff needed:
 * the armed `status` listener remains the backstop for disconnect cycles).
 */
function scheduleSubscribeRetry(): void {
  if (subscribeRetryTimer) return;
  if (subscribeRetryCount >= MAX_SUBSCRIBE_RETRIES) return;
  subscribeRetryCount++;
  const epoch = subscribeEpoch;
  subscribeRetryTimer = setTimeout(() => {
    subscribeRetryTimer = undefined;
    if (epoch !== subscribeEpoch || subscriptionId) return;
    void subscribeToSettingsChanges();
  }, SUBSCRIBE_RETRY_DELAY_MS);
  (subscribeRetryTimer as { unref?: () => void }).unref?.();
}

function clearSubscribeRetry(): void {
  if (subscribeRetryTimer) {
    clearTimeout(subscribeRetryTimer);
    subscribeRetryTimer = undefined;
  }
  subscribeRetryCount = 0;
}

/**
 * Attach the long-lived daemon notification listener, the reconnect
 * re-subscribe, and the initial `settings:changed` subscribe — once per
 * process (mirrors notification.service.ts). Returns the initial subscribe
 * promise so `initAppSettingsService` can order subscribe-before-fetch.
 */
function attachSettingsListeners(): Promise<void> {
  if (listenersAttached)
    return !recovery?.session.isCurrent() &&
      typeof getLocalBackendClient().getRepositoryConnection === 'function'
      ? subscribeToSettingsChanges()
      : Promise.resolve();
  listenersAttached = true;
  notificationDisposer = onBackendNotification(handleBackendNotification, LOCAL_CONNECTION_ID);
  reconnectDisposer = onBackendReconnected(() => {
    if (recovery?.session.isCurrent()) return;
    // The daemon dropped every in-memory subscription on reconnect; the
    // stale id belonged to the previous connection. Re-subscribe FIRST,
    // then re-fetch all three paths: a change landing between the fetch
    // reads and the subscription registration is then delivered as a
    // delta instead of being silently lost until the next reconnect.
    recovery?.coordinator.dispose();
    recovery = undefined;
    recoveryResource = undefined;
    subscribeEpoch++;
    subscriptionId = undefined;
    clearSubscribeRetry();
    void (async () => {
      await subscribeToSettingsChanges();
      await refreshSettings(APP_SETTING_PATHS);
    })();
  }, LOCAL_CONNECTION_ID);
  return subscribeToSettingsChanges();
}

/**
 * Attach the listeners and START hydrating the branchPrefix /
 * worktreesLocation / sshKeyPath caches from the daemon. Resolves once the
 * fetch is in flight — it does NOT wait for the daemon round-trip, so window
 * creation is never gated on daemon latency or availability. Safe to call
 * repeatedly (concurrent calls share one hydration); sync getters keep
 * returning the empty-string default until the values arrive. Paths that
 * failed to hydrate stay un-hydrated, so a later call (or the armed
 * connected-retry) fetches them again instead of serving a permanently
 * cached failure.
 */
export async function initAppSettingsService(): Promise<void> {
  const subscribed = attachSettingsListeners();
  if (allHydrated()) return;
  if (hydrationPromise) return;
  const epoch = subscribeEpoch;
  hydrationPromise = (async () => {
    // Subscribe-before-fetch (never rejects — failures arm the retries):
    // changes landing during the initial fetch arrive as deltas.
    await subscribed;
    await refreshSettings(APP_SETTING_PATHS.filter((path) => getCachedValue(path) === null));
    if (allHydrated()) {
      logger.info('App settings hydrated', {
        hasBranchPrefix: (cachedBranchPrefix ?? '').length > 0,
        hasWorktreesLocation: (cachedWorktreesLocation ?? '').length > 0,
        hasSshKeyPath: (cachedSshKeyPath ?? '').length > 0,
      });
    } else {
      armStatusRetry();
    }
  })()
    .catch((error: unknown) => {
      logger.warn('App settings hydration failed', { error: (error as Error).message });
      armStatusRetry();
    })
    .finally(() => {
      if (epoch === subscribeEpoch) hydrationPromise = null;
    });
}

/**
 * Get the branch prefix setting.
 * Returns empty string if not set (no prefix) or before hydration completes.
 */
export function getBranchPrefix(): string {
  return cachedBranchPrefix ?? '';
}

/**
 * Get the custom worktrees location setting.
 * Returns empty string if not set (use default ~/intent/workspaces) or
 * before hydration completes.
 */
export function getWorktreesLocation(): string {
  return cachedWorktreesLocation ?? '';
}

/**
 * Get the SSH key path setting.
 * Returns empty string if not set (use default SSH behavior) or before
 * hydration completes.
 */
export function getSshKeyPath(): string {
  return cachedSshKeyPath ?? '';
}

/**
 * Test-only: reset internal caches and subscription state so a fresh
 * hydration can run in isolation.
 * @internal
 */
export function __resetAppSettingsForTesting(): void {
  recovery?.coordinator.dispose();
  recovery = undefined;
  recoveryResource = undefined;
  authorityRetired = false;
  identityDisposer?.();
  identityDisposer = undefined;
  identityClient = undefined;
  cachedBranchPrefix = null;
  cachedWorktreesLocation = null;
  cachedSshKeyPath = null;
  hydrationPromise = null;
  notificationDisposer?.();
  notificationDisposer = undefined;
  reconnectDisposer?.();
  reconnectDisposer = undefined;
  listenersAttached = false;
  subscriptionId = undefined;
  subscribeEpoch++;
  deltaVersions.clear();
  clearSubscribeRetry();
  clearStatusRetry();
}
