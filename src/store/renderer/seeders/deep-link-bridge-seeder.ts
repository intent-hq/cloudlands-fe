/**
 * Deep-link invoke bridge — forwards `deep-link:consume-pending` (the
 * renderer deep-links saga draining the actions main queued for its window,
 * see `src/features/deeplink/main/pending-deep-links.ts`) to the real Electron
 * preload bridge (`window.electronAPI.invoke`) when present.
 *
 * Without a bridge the mock router REJECTS the channel
 * (`UnbridgedMockIpcChannelError`), so every `intent://` link main queued
 * would sit undelivered. A bridge-less build (browser dev) has no main
 * process to queue links, so an empty queue is the correct answer there.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { DEEP_LINK_CHANNELS } from '$shared/ipc/channels';

/** Register the deep-link invoke bridge handler. Idempotent. */
export function registerDeepLinkBridge(): void {
  registerMockIpcHandler(DEEP_LINK_CHANNELS.CONSUME_PENDING, async (payload?: unknown) => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === 'function') {
      return bridge.invoke(DEEP_LINK_CHANNELS.CONSUME_PENDING, payload);
    }
    return { actions: [] };
  });
}

registerDeepLinkBridge();
