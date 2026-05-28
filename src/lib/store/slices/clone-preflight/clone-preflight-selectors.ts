import { createSelector } from '../../utils/create-selector';
import type { ClonePreflightStatus } from './clone-preflight-slice';

export const selectClonePreflightStatus = createSelector(
  (state): ClonePreflightStatus => state.clonePreflight.status,
);

export const selectClonePreflightUrl = createSelector(
  (state): string => state.clonePreflight.url,
);

export const selectClonePreflightError = createSelector(
  (state): string | null => state.clonePreflight.error,
);
