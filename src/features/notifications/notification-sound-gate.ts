/**
 * Shared notification-sound gate.
 *
 * Extracted verbatim from the renderer notification IPC middleware
 * (`src/store/renderer/middlewares/notification-ipc-service.ts`) so both
 * delivery paths honor the SAME sound settings the same way:
 *   - Electron: the main-process NotificationService's `notification:show`
 *     renderer event (notification-ipc-service middleware).
 *   - Web: the browser-platform substitute in `web-notification-service.ts`.
 *
 * Gate semantics (unchanged): `soundEnabled` off = no sound;
 * `soundOnlyWhenUnfocused` on + document focused = no sound; else play at
 * `volume`. State is read directly off `appStore.state` (no selector modules)
 * and the sound util is imported lazily, per the original middleware.
 */
import { store as appStore } from '$store/renderer/store';
import type { StoreState } from '$store/renderer/types';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('NotificationSoundGate');

/**
 * Play the notification sound per the user's sound settings. Never rejects;
 * playback failures are logged (sound is best-effort).
 */
export async function playNotificationSoundPerSettings(): Promise<void> {
  const state = appStore.state as StoreState;
  const { soundEnabled, soundOnlyWhenUnfocused, volume } = state.userPreferences;

  if (!soundEnabled) {
    return;
  }
  if (soundOnlyWhenUnfocused && document.hasFocus()) {
    return;
  }

  try {
    const { playNotificationSound } = await import('$lib/utils/notification-sound');
    await playNotificationSound(volume);
  } catch (error) {
    // Sound is best-effort — never let playback failures propagate.
    logger.warn('Failed to play notification sound', { error });
  }
}
