/**
 * LED status wiring: store → snapshot → engine → device.
 *
 * Attaches/detaches the engine to the shared manager's RPC client on
 * connect/disconnect so lighting replays after a reconnect. The app-owned
 * device saga feeds snapshots to the engine through a selector channel.
 *
 * Dependency-light device service per src/store/renderer/AGENTS.md: no
 * selector imports — state is read via the pure snapshot derivation.
 */

import type { HardwareConsoleManager } from '../device/device-manager';
import { HardwareLedEngine } from './engine';
import { buildHardwareLedSnapshot, type LedSnapshotState } from './snapshot';

export interface LedStatusDeps {
  engine?: HardwareLedEngine;
  /** Optional one-time state read for isolated service consumers/tests. */
  getState?: () => LedSnapshotState;
  /** Optional change notifications for isolated service consumers/tests. */
  subscribe?: (listener: () => void) => () => void;
}

/**
 * Wire the LED engine to a manager and the app store. Returns the teardown
 * function. Exported for tests; production installation is owned by the device saga.
 */
export function installHardwareConsoleLedStatus(
  manager: HardwareConsoleManager,
  deps: LedStatusDeps = {},
): () => void {
  const engine = deps.engine ?? new HardwareLedEngine();

  const refresh = (): void => {
    if (deps.getState) engine.update(buildHardwareLedSnapshot(deps.getState()));
  };

  const offStatus = manager.onStatusChange((status) => {
    if (status === 'connected' && manager.client) {
      refresh();
      engine.attach(manager.client);
    } else if (status === 'disconnected' || status === 'unavailable') {
      engine.detach();
    }
  });

  const unsubscribeStore = deps.subscribe ? deps.subscribe(refresh) : () => {};

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
