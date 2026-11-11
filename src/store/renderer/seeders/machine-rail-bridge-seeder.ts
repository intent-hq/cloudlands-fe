/**
 * Machine rail IPC bridge — mock fallback for the `machine-rail:*` channels.
 *
 * The rail needs main-owned views, so it exists in the desktop app only. In
 * bridge-less builds (browser mock) and tests these handlers answer with the
 * lab off and a single machine (with a bridge they forward to main), so a call resolves instead of rejecting with
 * UnbridgedMockIpcChannelError.
 *
 * Handlers are registered at import time (host-bridge-seeder idiom). Tests
 * override individual channels via `registerMockIpcHandler` after this runs.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { MachineRailState } from '$shared/types/machine-rail';

const { MACHINE_RAIL } = IPC_CHANNELS;

const railOff = (): MachineRailState => ({
  enabled: false,
  homeId: LOCAL_CONNECTION_ID,
  machineIds: [LOCAL_CONNECTION_ID],
  selectedId: LOCAL_CONNECTION_ID,
});

const STATE_CHANNELS = [
  MACHINE_RAIL.GET_STATE,
  MACHINE_RAIL.SELECT,
  MACHINE_RAIL.ADD,
  MACHINE_RAIL.REMOVE,
  MACHINE_RAIL.OPEN_MENU,
  MACHINE_RAIL.SET_ENABLED,
] as const;

const FORWARDED_CHANNELS = [
  ...STATE_CHANNELS,
  MACHINE_RAIL.SHOWN,
  MACHINE_RAIL.FORWARD_TOAST,
] as const;

// Main owns the rail: forward verbatim when the desktop bridge exists, so the
// mock can never drift from the real handler.
for (const channel of FORWARDED_CHANNELS) {
  registerMockIpcHandler(channel, async (arg) => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    const invoke = bridge?.invoke as
      ((channel: string, payload?: unknown) => Promise<unknown>) | undefined;
    if (invoke) return invoke(channel, arg);

    if (channel === MACHINE_RAIL.SHOWN) return { ok: true };
    if (channel === MACHINE_RAIL.FORWARD_TOAST) return { forwarded: false };
    return railOff();
  });
}
