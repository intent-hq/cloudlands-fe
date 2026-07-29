/**
 * App Settings Service (Main Process)
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
 * `initAppSettingsService()` hydrates each value into a module-level cache
 * via `settings.get` at process start; the sync getters serve the cached
 * value and fall back to `''` while unhydrated (matches the pre-P3-4
 * behaviour when the electron-store key was absent). This mirrors the
 * hydration-cache pattern used by workspace-settings.service.ts and
 * notification.service.ts.
 *
 * A failed per-path fetch leaves that cache UN-hydrated (never cached as
 * `''`): a later `initAppSettingsService()` call retries the missing paths,
 * and an armed `status` listener re-runs hydration on the client's next
 * `connected` transition (the init-before-sidecar boot order means the
 * first attempt can race the daemon socket, see main/index.ts).
 *
 * Saved settings refresh in-session: the service owns ONE long-lived
 * `events.subscribe(['settings:changed'])` subscription (§6.5, same
 * pattern as notification.service.ts) and applies deltas for the three
 * paths straight into the cache, so `settings.update` from the Git &
 * Workspace settings panel takes effect without a relaunch. The
 * subscription is re-issued on backend reconnect (RESUB-1) alongside a
 * full re-fetch to cover changes missed while disconnected.
 *
 * The legacy `settings` electron-store, its `getSetting`/`setSetting`
 * facade, and the dead `websocketApi-*` helpers are retired here — no
 * remaining consumers in main.
 */

import { Logger } from '../../../shared/logger';
import { getBackendClient, onBackendReconnected } from '../../backend/main/backend.ipc';
import type { ConnectionStatus, JsonRpcNotification } from '../../backend/main/json-rpc-client';

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
let hydrationPromise: Promise<void> | null = null;
/** One-time guard for the notification / reconnect listeners. */
let listenersAttached = false;
/** Live `settings:changed` subscription id; undefined until subscribed. */
let subscriptionId: string | undefined;
/** Guards against stale in-flight `events.subscribe` calls (bumped on reconnect). */
let subscribeEpoch = 0;
/** Detaches the pending connect-retry `status` listener, when armed. */
let statusRetryDisposer: (() => void) | undefined;

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
  const result = (await getBackendClient().request('settings.get', {
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
  await Promise.all(
    paths.map(async (path) => {
      try {
        setCachedValue(path, await fetchStringSetting(path));
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
function handleBackendNotification(n: JsonRpcNotification): void {
  if (n.method !== 'events.event') return;
  const params = n.params as { subscriptionId?: unknown; event?: unknown } | undefined;
  const subId = typeof params?.subscriptionId === 'string' ? params.subscriptionId : undefined;
  // Strict match: the shared client also carries notifications for
  // renderer-proxied subscriptions; only our own subscription's events
  // may touch the cache.
  if (!subscriptionId || subId !== subscriptionId) return;
  const event = params?.event as { type?: unknown; data?: unknown } | undefined;
  if (!event || event.type !== 'settings:changed') return;
  const changes = (event.data as { changes?: unknown } | undefined)?.changes;
  if (!Array.isArray(changes)) return;
  for (const entry of changes) {
    if (!entry || typeof entry !== 'object') continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path !== 'string' || !APP_SETTING_PATHS.includes(path)) continue;
    const value = (entry as { value?: unknown }).value;
    setCachedValue(path, typeof value === 'string' ? value : '');
    logger.info('App setting refreshed from settings:changed', { path });
  }
}

/**
 * Issue `events.subscribe` for `settings:changed` (global — no workspace
 * envelope). On failure, arm the `status` retry so the next `connected`
 * transition re-issues it (covers the init-before-first-connect gap).
 */
async function subscribeToSettingsChanges(): Promise<void> {
  const epoch = subscribeEpoch;
  try {
    const result = (await getBackendClient().request('events.subscribe', {
      eventTypes: ['settings:changed'],
    })) as { subscriptionId?: string } | undefined;
    const id = result?.subscriptionId;
    if (epoch !== subscribeEpoch) {
      // A reconnect ran while subscribe was in flight; this id belongs to
      // the previous connection generation. Best-effort release it.
      if (id) {
        void getBackendClient()
          .request('events.unsubscribe', { subscriptionId: id })
          .catch(() => {});
      }
      return;
    }
    subscriptionId = id;
  } catch (error) {
    logger.warn(
      'events.subscribe for settings:changed failed; will retry on the next connected transition',
      { error: (error as Error).message },
    );
    armStatusRetry();
  }
}

/**
 * Re-run hydration and/or the `settings:changed` subscribe on the client's
 * next `connected` transition. Shared by both failure paths.
 */
function armStatusRetry(): void {
  if (statusRetryDisposer) return;
  const client = getBackendClient();
  const listener = (status: ConnectionStatus): void => {
    if (status !== 'connected') return;
    clearStatusRetry();
    if (!subscriptionId) void subscribeToSettingsChanges();
    if (!allHydrated()) void initAppSettingsService();
  };
  client.on('status', listener);
  statusRetryDisposer = () => client.off('status', listener);
}

function clearStatusRetry(): void {
  statusRetryDisposer?.();
  statusRetryDisposer = undefined;
}

/**
 * Attach the long-lived daemon notification listener, the reconnect
 * re-subscribe, and the initial `settings:changed` subscribe — once per
 * process (mirrors notification.service.ts).
 */
function attachSettingsListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  getBackendClient().on('notification', handleBackendNotification);
  onBackendReconnected(() => {
    // The daemon dropped every in-memory subscription on reconnect; the
    // stale id belonged to the previous connection. Re-issue it and
    // re-fetch all three paths to cover changes missed while disconnected.
    subscribeEpoch++;
    subscriptionId = undefined;
    void subscribeToSettingsChanges();
    void refreshSettings(APP_SETTING_PATHS);
  });
  void subscribeToSettingsChanges();
}

/**
 * Hydrate the branchPrefix / worktreesLocation / sshKeyPath caches from the
 * daemon. Safe to call repeatedly; sync getters keep returning the
 * empty-string default until this resolves. Paths that failed to hydrate
 * stay un-hydrated, so a later call (or the armed connected-retry) fetches
 * them again instead of serving a permanently cached failure.
 */
export async function initAppSettingsService(): Promise<void> {
  attachSettingsListeners();
  if (allHydrated()) return;
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
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
  })().finally(() => {
    hydrationPromise = null;
  });
  return hydrationPromise;
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
  cachedBranchPrefix = null;
  cachedWorktreesLocation = null;
  cachedSshKeyPath = null;
  hydrationPromise = null;
  listenersAttached = false;
  subscriptionId = undefined;
  subscribeEpoch++;
  clearStatusRetry();
}
