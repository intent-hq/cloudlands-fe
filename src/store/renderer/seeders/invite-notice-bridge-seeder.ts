/**
 * Invite-notice invoke bridge — forwards `invite-notice:ack` and
 * `invite-notice:response` (renderer → main invokes from
 * `src/features/invite-notice/invite-notice-service.ts`) to the real Electron
 * preload bridge (`window.electronAPI.invoke`) when present, so the
 * main-process handlers in `src/main/invite-notice.ts` receive the ack within
 * its fallback window and the user's acknowledgement.
 *
 * Without a bridge the mock router REJECTS these channels
 * (`UnbridgedMockIpcChannelError`) for any caller routed through it. In a
 * bridge-less build (browser dev) there is no main process driving an invite
 * join — `invite-notice:show` can never arrive — so resolving undefined is a
 * correct no-op, matching the invite-consent-bridge-seeder disposition.
 *
 * Payload contracts live in `src/shared/ipc/invite-notice.ts`.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { INVITE_NOTICE_CHANNELS } from '$shared/ipc/channels';

const INVITE_NOTICE_INVOKE_CHANNELS = [
  INVITE_NOTICE_CHANNELS.ACK,
  INVITE_NOTICE_CHANNELS.RESPONSE,
] as const;

/** Register the invite-notice invoke bridge handlers. Idempotent. */
export function registerInviteNoticeBridge(): void {
  for (const channel of INVITE_NOTICE_INVOKE_CHANNELS) {
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

registerInviteNoticeBridge();
