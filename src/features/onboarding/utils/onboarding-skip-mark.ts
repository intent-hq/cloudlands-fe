/**
 * Permanent per-backend mark that this profile has used the backend: once its
 * workspace list is non-empty, boot and empty-window navigation land on Home
 * instead of the full-page onboarding wizard, even when the list is slow or
 * later empty. Explicit "Show onboarding" still opens the wizard.
 */
import { safeLocalStorage } from '$lib/utils/safe-storage';
import type { StoreState } from '$store/renderer/types';
import {
  getActiveBackendId,
  namespaceBackendKey,
} from '$store/renderer/utils/backend-storage-namespace';

const ONBOARDING_SKIP_STORAGE_KEY = 'intent:onboarding-skip:v1';

export function hasOnboardingSkipMark(backendId: string): boolean {
  return (
    safeLocalStorage.getItem(namespaceBackendKey(ONBOARDING_SKIP_STORAGE_KEY, backendId)) === '1'
  );
}

export function recordOnboardingSkipMark(backendId: string): void {
  if (hasOnboardingSkipMark(backendId)) return;
  safeLocalStorage.setItem(namespaceBackendKey(ONBOARDING_SKIP_STORAGE_KEY, backendId), '1');
}

/**
 * True when this window's backend carries the mark. Unknown (false) until the
 * connections list binds the window to its backend.
 */
export function isOnboardingSkippedForWindow(state: StoreState): boolean {
  return (
    state.connections?.hasReceivedList === true && hasOnboardingSkipMark(getActiveBackendId(state))
  );
}
