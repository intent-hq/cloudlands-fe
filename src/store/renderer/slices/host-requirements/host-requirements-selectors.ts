/**
 * Host Requirements Selectors
 */

import { store } from '../../store';

export const selectGitRequirement = store.createSelector((state) => state.hostRequirements.git);

export const selectNodeRequirement = store.createSelector((state) => state.hostRequirements.node);

/** Informational only — never part of the onboarding gate. */
export const selectGhRequirement = store.createSelector((state) => state.hostRequirements.gh);

export const selectHostRequirementsChecking = store.createSelector(
  (state) => state.hostRequirements.checking,
);

export const selectHostRequirementsHasCheckedOnce = store.createSelector(
  (state) => state.hostRequirements.hasCheckedOnce,
);

export const selectRtkRequirement = store.createSelector((state) => state.hostRequirements.rtk);
export const selectRtkEnabled = store.createSelector((state) => state.hostRequirements.rtkEnabled);
export const selectRtkSettingsLoaded = store.createSelector(
  (state) => state.hostRequirements.rtkSettingsLoaded,
);
export const selectRtkChecking = store.createSelector(
  (state) => state.hostRequirements.rtkChecking,
);
export const selectRtkUpdating = store.createSelector(
  (state) => state.hostRequirements.rtkUpdating,
);
export const selectRtkError = store.createSelector((state) => state.hostRequirements.rtkError);

/** Terminal gate: git available AND node meets the minimum version. */
export const selectAllRequirementsMet = store.createSelector(
  (state) => state.hostRequirements.git.available && state.hostRequirements.node.ok,
);
