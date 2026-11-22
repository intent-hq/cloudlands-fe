/**
 * Stand-ins for every channel marked `forwarded(...)` in `$shared/ipc-registry`.
 *
 * With a desktop bridge each call goes to main verbatim, so the stand-in cannot
 * drift from the real handler. Without one (browser build, tests) it answers the
 * channel's declared browser fallback instead of rejecting with
 * UnbridgedMockIpcChannelError. Marking a new channel needs no edit here.
 *
 * Handlers are registered at import time (host-bridge-seeder idiom). Tests
 * override individual channels via `registerMockIpcHandler` after this runs.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { FORWARDED_IPC_CHANNELS } from '$shared/ipc-registry';

for (const [channel, browserFallback] of FORWARDED_IPC_CHANNELS) {
  registerMockIpcHandler(channel, async (arg) => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    const invoke = bridge?.invoke as
      ((channel: string, payload?: unknown) => Promise<unknown>) | undefined;
    return invoke ? invoke(channel, arg) : browserFallback(arg);
  });
}
