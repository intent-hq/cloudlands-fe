/**
 * Invite-consent invoke bridge — forwards `invite-consent:ack` and
 * `invite-consent:response` (renderer → main invokes from
 * `src/features/invite-consent/invite-consent-service.ts`) to the real
 * Electron preload bridge (`window.electronAPI.invoke`) when present, so the
 * main-process handlers in `src/main/invite-consent.ts` receive the ack
 * within its fallback window and the user's open/cancel decision.
 *
 * Without a bridge the mock router REJECTS these channels
 * (`UnbridgedMockIpcChannelError`) for any caller routed through it. In a
 * bridge-less build (browser dev) there is no main process driving an invite
 * join — `invite-consent:show` can never arrive — so resolving undefined is a
 * correct no-op, matching the quit-confirmation-bridge-seeder disposition.
 *
 * Payload contracts live in `src/shared/ipc/invite-consent.ts`.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { INVITE_CONSENT_CHANNELS } from '$shared/ipc/channels';

const INVITE_CONSENT_INVOKE_CHANNELS = [
  INVITE_CONSENT_CHANNELS.ACK,
  INVITE_CONSENT_CHANNELS.RESPONSE,
] as const;

/** Register the invite-consent invoke bridge handlers. Idempotent. */
export function registerInviteConsentBridge(): void {
  for (const channel of INVITE_CONSENT_INVOKE_CHANNELS) {
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

registerInviteConsentBridge();
