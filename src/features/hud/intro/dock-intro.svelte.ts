import { safeLocalStorage } from '$lib/utils/safe-storage';

/**
 * "Meet the notch": an intro card the dock shows until the user dismisses it,
 * once per profile. Closed until the real dock window calls `initDockIntro()`,
 * so previews and harnesses keep their usual layout.
 *
 * `hold` opens the notch on first appearance only: opening a workspace or the
 * Assistant, or the pointer leaving the overview, releases the hold, and it never
 * applies to an open conversation. After that the card still shows whenever the overview
 * opens, until "Got it", but never keeps the notch open by itself.
 */
const STORAGE_KEY = 'intent:dock-intro-seen:v1';

export const dockIntro = $state({ open: false, hold: false });

export function initDockIntro(): void {
  dockIntro.open = safeLocalStorage.getItem(STORAGE_KEY) !== '1';
  dockIntro.hold = dockIntro.open;
}

export function releaseDockIntroHold(): void {
  dockIntro.hold = false;
}

export function dismissDockIntro(): void {
  dockIntro.open = false;
  dockIntro.hold = false;
  safeLocalStorage.setItem(STORAGE_KEY, '1');
}
