/**
 * Quit-confirmation invoke bridge — forwards `quit-confirmation:ack` and
 * `quit-confirmation:response` (renderer → main invokes from
 * `src/features/quit-confirmation/quit-confirmation-service.ts`) to the real
 * Electron preload bridge (`window.electronAPI.invoke`) when present, so the
 * main-process handlers in `src/main/quit-confirmation.ts` receive the ack
 * within its fallback window and the user's proceed/cancel decision.
 *
 * Without a bridge the mock router REJECTS these channels
 * (`UnbridgedMockIpcChannelError`) for any caller routed through it. In a
 * bridge-less build (browser dev) there is no main process orchestrating a
 * quit round-trip — `quit-confirmation:show` can never arrive — so resolving
 * undefined is a correct no-op, matching the window-state-bridge-seeder
 * disposition for fire-and-forget callers.
 *
 * Payload contracts live in `src/shared/ipc/quit-confirmation.ts`.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { QUIT_CONFIRMATION_CHANNELS } from '$shared/ipc/channels';

const QUIT_CONFIRMATION_INVOKE_CHANNELS = [
  QUIT_CONFIRMATION_CHANNELS.ACK,
  QUIT_CONFIRMATION_CHANNELS.RESPONSE,
] as const;

/** Register the quit-confirmation invoke bridge handlers. Idempotent. */
export function registerQuitConfirmationBridge(): void {
  for (const channel of QUIT_CONFIRMATION_INVOKE_CHANNELS) {
    // Forward exactly one payload argument — the real preload bridge signature
    // is `invoke(channel, data?)`, so extra args would be silently dropped.
    registerMockIpcHandler(channel, async (payload?: unknown) => {
      const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (bridge && typeof bridge.invoke === 'function') {
        return bridge.invoke(channel, payload);
      }
      return undefined;
    });
  }
}

registerQuitConfirmationBridge();
