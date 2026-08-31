/**
 * User-activity invoke bridge — forwards `user-activity:mark-note-read` and
 * `user-activity:get-unread-note-ids` to the real Electron preload bridge
 * (`window.electronAPI.invoke`) when present.
 *
 * The generated `invoke()` routes ALL legacy renderer invokes through the
 * mock router in every build, including the packaged app, where the live
 * main-process handlers live in features/user-activity/main/user-activity.ipc.ts
 * (per-backend read-state persistence). The note-read-tracking saga invokes
 * both channels to persist read marks and compute unread note IDs.
 *
 * Same pattern as auto-update-bridge-seeder: forward verbatim when the
 * preload bridge exists; fold to the handlers' documented failure envelope
 * (`{ success: false, error }`) when it does not (browser dev / bridge-less
 * build) — the saga treats a non-success result as "nothing unread computed"
 * and clears its loading flag, so callers degrade to no badges, never a throw.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { USER_ACTIVITY_CHANNELS } from '$shared/ipc/channels';

const USER_ACTIVITY_INVOKE_CHANNELS = [
  USER_ACTIVITY_CHANNELS.MARK_NOTE_READ,
  USER_ACTIVITY_CHANNELS.GET_UNREAD_NOTE_IDS,
] as const;

const NOT_AVAILABLE = {
  success: false,
  error: 'User-activity read tracking is not available in this build',
} as const;

/** Register the user-activity invoke bridge handlers. Idempotent. */
export function registerUserActivityBridge(): void {
  for (const channel of USER_ACTIVITY_INVOKE_CHANNELS) {
    // Forward exactly one payload argument — the real preload bridge signature
    // is `invoke(channel, data?)`, so extra args would be silently dropped.
    registerMockIpcHandler(channel, async (payload?: unknown) => {
      const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (bridge && typeof bridge.invoke === 'function') {
        return bridge.invoke(channel, payload);
      }
      return NOT_AVAILABLE;
    });
  }
}

registerUserActivityBridge();
