/**
 * Invite-progress invoke bridge — forwards `invite-progress:ack` and
 * `invite-progress:response` (renderer → main invokes from
 * `src/features/invite-progress/invite-progress-service.ts`) to the real
 * Electron preload bridge (`window.electronAPI.invoke`) when present, so the
 * main-process handlers in `src/main/invite-progress.ts` receive the ack
 * within its short window and the user's Cancel.
 *
 * Without a bridge the mock router REJECTS these channels
 * (`UnbridgedMockIpcChannelError`) for any caller routed through it. In a
 * bridge-less build (browser dev) there is no main process driving an invite
 * join — `invite-progress:show` can never arrive — so resolving undefined is a
 * correct no-op, matching the invite-consent-bridge-seeder disposition.
 *
 * Payload contracts live in `src/shared/ipc/invite-progress.ts`.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { INVITE_PROGRESS_CHANNELS } from '$shared/ipc/channels';

const INVITE_PROGRESS_INVOKE_CHANNELS = [
  INVITE_PROGRESS_CHANNELS.ACK,
  INVITE_PROGRESS_CHANNELS.RESPONSE,
] as const;

/** Register the invite-progress invoke bridge handlers. Idempotent. */
export function registerInviteProgressBridge(): void {
  for (const channel of INVITE_PROGRESS_INVOKE_CHANNELS) {
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

registerInviteProgressBridge();
