/**
 * Onboarding Selectors
 */

import { store } from "../../store";
import type { OnboardingState } from './onboarding-types';

export const selectOnboardingState = store.createSelector((state): OnboardingState => state.onboarding);

export const selectOnboardingStep = store.createSelector(
  (state) => state.onboarding.step,
);

export const selectOnboardingProjectConfig = store.createSelector(
  (state) => state.onboarding.projectConfig,
);

export const selectOnboardingAgentStatus = store.createSelector(
  (state) => state.onboarding.agentStatus,
);

export const selectOnboardingWorkspaceId = store.createSelector(
  (state) => state.onboarding.workspaceId,
);
