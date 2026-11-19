/**
 * Recent agents IPC bridge — mock fallback for the `recent-agents:*` channels.
 *
 * Main owns the app-wide list, so it exists in the desktop app only. With a
 * bridge these handlers forward verbatim (the mock cannot drift from main);
 * in bridge-less builds (browser mock) and tests the list is empty and changes
 * are dropped, so a call resolves instead of rejecting with
 * UnbridgedMockIpcChannelError.
 *
 * Handlers are registered at import time (host-bridge-seeder idiom). Tests
 * override individual channels via `registerMockIpcHandler` after this runs.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const { RECENT_AGENTS } = IPC_CHANNELS;

for (const channel of [
  RECENT_AGENTS.LIST,
  RECENT_AGENTS.RECORD,
  RECENT_AGENTS.FORGET_WORKSPACE,
] as const) {
  registerMockIpcHandler(channel, async (arg) => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    const invoke = bridge?.invoke as
      ((channel: string, payload?: unknown) => Promise<unknown>) | undefined;
    if (invoke) return invoke(channel, arg);
    return [];
  });
}
