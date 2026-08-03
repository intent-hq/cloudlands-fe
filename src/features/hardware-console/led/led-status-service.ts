/**
 * LED status wiring: store → snapshot → engine → device.
 *
 * Subscribes to the app store, derives the lighting snapshot on every state
 * change (the engine dedupes by content and coalesces sends to ≤ ~10 fps),
 * and attaches/detaches the engine to the shared manager's RPC client on
 * connect/disconnect so lighting replays after a reconnect.
 *
 * Dependency-light middleware module per src/store/renderer/AGENTS.md: no
 * selector imports — state is read via the pure snapshot derivation.
 */

import type { StoreMiddleware } from '$lib/store-shim/types';
import { store as appStore } from '$store/renderer/store';
import type { HardwareConsoleManager } from '../device/device-manager';
import { getHardwareConsoleManager } from '../instance';
import { installHardwareConsoleClearLightingListener } from './clear-lighting';
import { HardwareLedEngine } from './engine';
import { buildHardwareLedSnapshot, type LedSnapshotState } from './snapshot';

export interface LedStatusDeps {
  engine?: HardwareLedEngine;
  /** One-time state read. Defaults to `appStore.state`. */
  getState?: () => LedSnapshotState;
  /** Change notifications; the callback re-reads via `getState`. Defaults to
   *  the app store subscription. Returns the unsubscribe function. */
  subscribe?: (listener: () => void) => () => void;
}

/**
 * Wire the LED engine to a manager and the app store. Returns the teardown
 * function. Exported for tests; production installs via the middleware below.
 */
export function installHardwareConsoleLedStatus(
  manager: HardwareConsoleManager,
  deps: LedStatusDeps = {},
): () => void {
  const engine = deps.engine ?? new HardwareLedEngine();
  const getState = deps.getState ?? ((): LedSnapshotState => appStore.state);
  const subscribe =
    deps.subscribe ??
    ((listener: () => void) => appStore.getReadableState().subscribe(listener));

  const refresh = (): void => {
    engine.update(buildHardwareLedSnapshot(getState()));
  };

  const offStatus = manager.onStatusChange((status) => {
    if (status === 'connected' && manager.client) {
      refresh();
      engine.attach(manager.client);
    } else if (status === 'disconnected' || status === 'unavailable') {
      engine.detach();
    }
  });

  const unsubscribeStore = subscribe(() => {
    refresh();
  });

  if (manager.status === 'connected' && manager.client) {
    refresh();
    engine.attach(manager.client);
  }

  return () => {
    offStatus();
    unsubscribeStore();
    engine.dispose();
  };
}

let installed = false;

/**
 * Lazily install on the first dispatched action (same pattern as the
 * connection-toast / key-switch middlewares): starts the shared manager —
 * idempotent, a no-op without WebHID — and wires LED status updates plus the
 * shutdown clear-lighting IPC listener (which tears the LED wiring down
 * before sending the off-frame; see clear-lighting.ts).
 */
export function createHardwareConsoleLedStatusMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    if (!installed) {
      installed = true;
      const manager = getHardwareConsoleManager();
      const disposeLedWiring = installHardwareConsoleLedStatus(manager);
      installHardwareConsoleClearLightingListener(manager, { disposeLedWiring });
      void manager.start();
    }
    return next(action);
  };
}
