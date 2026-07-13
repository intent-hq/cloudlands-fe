import { store } from "../../store";
import type { ClonePreflightStatus } from './clone-preflight-slice';

export const selectClonePreflightStatus = store.createSelector(
  (state): ClonePreflightStatus => state.clonePreflight.status,
);

export const selectClonePreflightUrl = store.createSelector(
  (state): string => state.clonePreflight.url,
);

export const selectClonePreflightError = store.createSelector(
  (state): string | null => state.clonePreflight.error,
);
