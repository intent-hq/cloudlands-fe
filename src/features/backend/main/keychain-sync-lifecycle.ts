/**
 * Keychain-sync lifecycle wiring (T3): connects the reconcile engine
 * (keychain-sync.ts) to the connections store (connections-store.ts) and the
 * app lifecycle.
 *
 * Triggers — all funnel into ONE debounced, single-flight reconcile:
 *  - startup (initKeychainSyncLifecycle, after the connections IPC registers)
 *  - app focus (`browser-window-focus`, rate-limited to one reconcile per
 *    FOCUS_MIN_INTERVAL_MS so window-hopping never hammers the keychain)
 *  - local store mutations (add/forget/setHostname/setHosts) — the push side;
 *    the mutation itself NEVER blocks on the keychain.
 *
 * Everything is gated on the opt-in preference (KEYCHAIN_SYNC_ENABLED_KEY,
 * default OFF — T4 owns the toggle UI). With the pref off this module is
 * fully inert: no reconcile runs, no helper spawns, no keychain access.
 *
 * Fresh-install auto-enable (T5): the pref is tri-state. When it has NEVER
 * been set (absent), startup on macOS runs a silent read-only probe (helper
 * `list`); existing synced items mean another Mac already opted in, so sync
 * is auto-enabled here (opt-in follows the data) and the startup reconcile
 * pulls the backends immediately. An explicit false (user turned it off on
 * this machine) is never overridden, and an explicit true never re-probes.
 * The probe is fail-soft: unavailable/error leaves the pref absent, so a
 * future startup probes again.
 *
 * When a reconcile pulls remote changes into the store, the injected
 * `onRemoteApplied` callback fires so backend.ipc.ts can broadcast the
 * existing `connections:changed` event to every renderer.
 */

import { app } from 'electron';
import { Logger } from '../../../shared/logger';
import { getLocalPref, setLocalPref } from '../../../main/local-prefs';
import {
  createHelperKeychainClient,
  reconcile,
  type KeychainClient,
  type KeychainSyncStatus,
  type LocalSyncAdapter,
  type ReconcileOptions,
} from './keychain-sync';
import { applyRemoteSyncRecord, listSyncRecords, onConnectionsMutated } from './connections-store';

const logger = new Logger('KeychainSyncLifecycle');

/**
 * local-prefs key for the opt-in toggle (T4 UI). Tri-state: absent = never
 * explicitly set (eligible for the T5 auto-enable probe), true = on, false =
 * user explicitly disabled on this machine (never auto-enabled again).
 * Absent and false both read as disabled everywhere else.
 */
export const KEYCHAIN_SYNC_ENABLED_KEY = 'keychainSyncEnabled';

/** Quiet window collapsing bursts of triggers into one reconcile. */
const RECONCILE_DEBOUNCE_MS = 2_000;

/** Minimum spacing between focus-triggered reconciles. */
const FOCUS_MIN_INTERVAL_MS = 60_000;

/** True iff keychain sync is on (tri-state pref: absent and false are both
 * disabled here; only the auto-enable probe distinguishes them). */
export async function isKeychainSyncEnabled(): Promise<boolean> {
  return (await getLocalPref<boolean>(KEYCHAIN_SYNC_ENABLED_KEY)) === true;
}

/** The store-backed LocalSyncAdapter handed to reconcile(). */
export const storeSyncAdapter: LocalSyncAdapter = {
  list: () => listSyncRecords(),
  async applyRemote(_account, record) {
    await applyRemoteSyncRecord(record);
  },
};

/** Injectable seams for {@link initKeychainSyncLifecycle} (tests). */
export interface KeychainSyncLifecycleOptions {
  /** Broadcast hook fired after a reconcile pulled/deleted local records. */
  onRemoteApplied?: () => void | Promise<void>;
  /** Broadcast hook fired when a reconcile's availability status changed
   * (first result, active ⇄ unavailable / different reason, or a changed
   * active `errorCount` — the degraded-writes note). T4 uses it to push
   * `connections:sync-status-changed` to the settings UI. */
  onStatusChanged?: (status: KeychainSyncStatus) => void;
  reconcileFn?: (
    adapter: LocalSyncAdapter,
    options?: ReconcileOptions,
  ) => ReturnType<typeof reconcile>;
  isEnabled?: () => Promise<boolean>;
  debounceMs?: number;
  focusMinIntervalMs?: number;
  /** Platform gate for the auto-enable probe (default `process.platform`). */
  platform?: NodeJS.Platform;
  /** Raw tri-state pref read for the probe: `undefined` = never set. */
  readEnabledPref?: () => Promise<boolean | undefined>;
  /** Pref write used when the probe auto-enables sync. */
  writeEnabledPref?: (value: boolean) => Promise<void>;
  /** Read-only keychain `list` used by the probe (default: real helper). */
  probeList?: KeychainClient['list'];
}

/** Handle returned by {@link initKeychainSyncLifecycle}. */
export interface KeychainSyncLifecycle {
  /** Last completed reconcile's availability status (null before the first). */
  getStatus(): KeychainSyncStatus | null;
  /** Request a reconcile through the debounce (pref-gated). */
  requestReconcile(): void;
  /** Clear the last-known status back to null (the "checking" state). Used
   * when the pref flips on so a stale pre-disable verdict is never shown;
   * the next reconcile then always fires onStatusChanged (first-status
   * rule), even when the fresh verdict equals the cleared one. */
  resetStatus(): void;
  /** Detach every trigger and cancel any pending debounce. */
  dispose(): void;
}

/**
 * Wire the sync triggers. Called once from backend.ipc.ts after the
 * connections IPC handlers register. Safe on every platform: off macOS (or
 * with the pref off) the reconcile resolves as `unavailable` / never runs.
 */
export function initKeychainSyncLifecycle(
  options: KeychainSyncLifecycleOptions = {},
): KeychainSyncLifecycle {
  const runReconcile = options.reconcileFn ?? reconcile;
  const isEnabled = options.isEnabled ?? isKeychainSyncEnabled;
  const debounceMs = options.debounceMs ?? RECONCILE_DEBOUNCE_MS;
  const focusMinIntervalMs = options.focusMinIntervalMs ?? FOCUS_MIN_INTERVAL_MS;
  const platform = options.platform ?? process.platform;
  const readEnabledPref =
    options.readEnabledPref ?? (() => getLocalPref<boolean>(KEYCHAIN_SYNC_ENABLED_KEY));
  const writeEnabledPref =
    options.writeEnabledPref ??
    ((value: boolean) => setLocalPref(KEYCHAIN_SYNC_ENABLED_KEY, value));
  const probeList = options.probeList ?? (() => createHelperKeychainClient().list());

  let disposed = false;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let rerunRequested = false;
  let lastStatus: KeychainSyncStatus | null = null;
  let lastFocusRunAt = 0;

  /**
   * Fresh-install auto-enable probe (T5). Only when the pref has NEVER been
   * explicitly set: a silent read-only `list` of the sync service; >=1 item
   * (record or tombstone) means another Mac already opted in, so persist
   * pref=true — the caller then schedules the normal reconcile, which pulls
   * the backends. Fail-soft and silent: unavailable/error writes nothing
   * (the pref stays absent, so a future startup probes again) and logs a
   * single debug line. Never runs off macOS, never writes to the keychain.
   */
  async function maybeAutoEnableFromKeychain(): Promise<void> {
    try {
      if (platform !== 'darwin') return;
      if ((await readEnabledPref()) !== undefined) return;
      const listed = await probeList();
      if (!listed.ok) {
        logger.debug('auto-enable probe: keychain unavailable', { reason: listed.code });
        return;
      }
      if (listed.items.length === 0 || disposed) return;
      await writeEnabledPref(true);
      logger.info('auto-enabled keychain sync: found existing synced items', {
        count: listed.items.length,
      });
    } catch (error) {
      logger.debug('auto-enable probe failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function run(): Promise<void> {
    if (running) {
      rerunRequested = true;
      return;
    }
    running = true;
    try {
      // The pref gate lives INSIDE the run so a toggle-off between schedule
      // and fire still results in a no-op (fully inert when disabled).
      if (disposed || !(await isEnabled())) return;
      // Re-checked before each account's writes so a toggle-off (or dispose)
      // while the helper call is in flight halts further pull/push side
      // effects instead of syncing on after the UI says sync is off.
      const result = await runReconcile(storeSyncAdapter, {
        shouldAbort: async () => disposed || !(await isEnabled()),
      });
      const previous = lastStatus;
      lastStatus = result.status;
      if (
        previous === null ||
        previous.state !== result.status.state ||
        (previous.state === 'unavailable' &&
          result.status.state === 'unavailable' &&
          previous.reason !== result.status.reason) ||
        (previous.state === 'active' &&
          result.status.state === 'active' &&
          (previous.errorCount ?? 0) !== (result.status.errorCount ?? 0))
      ) {
        options.onStatusChanged?.(result.status);
      }
      if (result.pulled.length > 0 || result.deletedLocally.length > 0) {
        await options.onRemoteApplied?.();
      }
    } catch (error) {
      logger.warn('keychain sync reconcile failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = false;
      if (rerunRequested && !disposed) {
        rerunRequested = false;
        schedule();
      }
    }
  }

  function schedule(): void {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, debounceMs);
  }

  const onFocus = (): void => {
    const now = Date.now();
    if (now - lastFocusRunAt < focusMinIntervalMs) return;
    lastFocusRunAt = now;
    schedule();
  };
  app.on('browser-window-focus', onFocus);
  const unsubscribeMutations = onConnectionsMutated(schedule);

  // Startup: auto-enable probe (T5), then the reconcile (async; never blocks
  // IPC registration or boot restore). The probe runs first so a flipped
  // pref is already visible when the startup reconcile's gate reads it.
  void maybeAutoEnableFromKeychain().then(schedule);

  return {
    getStatus: () => lastStatus,
    requestReconcile: schedule,
    resetStatus(): void {
      lastStatus = null;
    },
    dispose(): void {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      app.removeListener('browser-window-focus', onFocus);
      unsubscribeMutations();
    },
  };
}
