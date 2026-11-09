/**
 * Store-aware wrapper of `resolveEmptyWindowDestination` for this window:
 * reads the workspace list and the backend's onboarding skip mark.
 */
import { isOnboardingSkippedForWindow } from '$features/onboarding/utils/onboarding-skip-mark';
import type { StoreState } from '$store/renderer/types';
import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
import { resolveEmptyWindowDestination } from './empty-window-destination';

export function resolveWindowEmptyDestination(
  state: StoreState,
  excludedWorkspaceId?: string,
): '/' | '/workspace/new' {
  return resolveEmptyWindowDestination(
    selectWorkspaceItems.select(state),
    excludedWorkspaceId,
    isOnboardingSkippedForWindow(state),
  );
}
