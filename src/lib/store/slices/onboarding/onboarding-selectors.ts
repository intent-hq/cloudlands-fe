/**
 * Onboarding Selectors
 */

import { createSelector } from '../../utils/create-selector';
import type { OnboardingState } from './onboarding-types';

export const selectOnboardingState = createSelector((state): OnboardingState => state.onboarding);

export const selectOnboardingStep = createSelector(
  (state) => state.onboarding.step,
);

export const selectOnboardingProjectConfig = createSelector(
  (state) => state.onboarding.projectConfig,
);

export const selectOnboardingAgentStatus = createSelector(
  (state) => state.onboarding.agentStatus,
);

export const selectOnboardingWorkspaceId = createSelector(
  (state) => state.onboarding.workspaceId,
);
