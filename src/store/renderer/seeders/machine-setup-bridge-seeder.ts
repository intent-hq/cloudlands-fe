/**
 * SSH machine setup (Labs) runs in Electron main: forward each channel to the
 * main process. Without one (web build, tests) there is no SSH runner: no
 * agent, no run, and nothing to trust or cancel.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { SshSetupDefaults, SshSetupStartResult } from '$shared/types/machine-setup';

const CHANNELS = IPC_CHANNELS.MACHINE_SETUP;

const FALLBACKS = {
  [CHANNELS.SSH_DEFAULTS]: { agent: false } satisfies SshSetupDefaults,
  [CHANNELS.SSH_START]: { ok: false, code: 'busy' } satisfies SshSetupStartResult,
  [CHANNELS.SSH_TRUST]: { ok: false },
  [CHANNELS.SSH_CANCEL]: { ok: false },
} as const;

for (const [channel, fallback] of Object.entries(FALLBACKS)) {
  registerMockIpcHandler(channel, async (arg) => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    const invoke = bridge?.invoke as
      ((channel: string, payload?: unknown) => Promise<unknown>) | undefined;
    return invoke ? invoke(channel, arg) : fallback;
  });
}
