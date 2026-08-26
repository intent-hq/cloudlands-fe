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
 * When a reconcile pulls remote changes into the store, the injected
 * `onRemoteApplied` callback fires so backend.ipc.ts can broadcast the
 * existing `connections:changed` event to every renderer.
 */

import { app } from 'electron';
import { Logger } from '../../../shared/logger';
import { getLocalPref } from '../../../main/local-prefs';
import {
  reconcile,
  type KeychainSyncStatus,
  type LocalSyncAdapter,
  type ReconcileOptions,
} from './keychain-sync';
import { applyRemoteSyncRecord, listSyncRecords, onConnectionsMutated } from './connections-store';

const logger = new Logger('KeychainSyncLifecycle');

/** local-prefs key for the opt-in toggle (T4 UI). Default OFF. */
export const KEYCHAIN_SYNC_ENABLED_KEY = 'keychainSyncEnabled';

/** Quiet window collapsing bursts of triggers into one reconcile. */
export const RECONCILE_DEBOUNCE_MS = 2_000;

/** Minimum spacing between focus-triggered reconciles. */
export const FOCUS_MIN_INTERVAL_MS = 60_000;

/** True iff the user opted in to keychain sync (absent/off = disabled). */
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
  reconcileFn?: (
    adapter: LocalSyncAdapter,
    options?: ReconcileOptions,
  ) => ReturnType<typeof reconcile>;
  isEnabled?: () => Promise<boolean>;
  debounceMs?: number;
  focusMinIntervalMs?: number;
}

/** Handle returned by {@link initKeychainSyncLifecycle}. */
export interface KeychainSyncLifecycle {
  /** Last completed reconcile's availability status (null before the first). */
  getStatus(): KeychainSyncStatus | null;
  /** Request a reconcile through the debounce (pref-gated). */
  requestReconcile(): void;
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

  let disposed = false;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let rerunRequested = false;
  let lastStatus: KeychainSyncStatus | null = null;
  let lastFocusRunAt = 0;

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
      const result = await runReconcile(storeSyncAdapter);
      lastStatus = result.status;
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

  // Startup reconcile (async; never blocks IPC registration or boot restore).
  schedule();

  return {
    getStatus: () => lastStatus,
    requestReconcile: schedule,
    dispose(): void {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      app.removeListener('browser-window-focus', onFocus);
      unsubscribeMutations();
    },
  };
}
