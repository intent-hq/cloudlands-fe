import type { DeviceIconSource } from '$lib/utils/device-icons';
import type { ConnectionAccent } from '$shared/types/connections';

/** Where a machine in the Unified window comes from. Remote nodes are never included. */
export type UnifiedMachineKind = 'local' | 'remote' | 'guest';

/** One machine as the Unified window shell shows it (dropdown, tab markers, palette, Home). */
export interface UnifiedMachine {
  /** Backend id: `local`, a saved connection id, or a guest session id. */
  id: string;
  label: string;
  kind: UnifiedMachineKind;
  /** Saved remote accent; guests and local carry none. */
  accent: ConnectionAccent;
  icon: DeviceIconSource;
  /** False while the machine is offline or not yet connected; its rows come from the cache. */
  online: boolean;
}

/** Local tabs carry no marker; every other machine is marked so mixed tabs stay distinguishable. */
export function showsMachineMarker(machine: UnifiedMachine | null | undefined): boolean {
  return !!machine && machine.kind !== 'local';
}
