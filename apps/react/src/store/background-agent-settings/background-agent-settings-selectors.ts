import { store } from '@/store';
import * as projections from '../../../../../src/store/renderer/slices/background-agent-settings/background-agent-settings-projections';
export const selectBgDefaultModel = store.createSelector(projections.getBgDefaultModel);
export const selectBgTypeOverrides = store.createSelector(projections.getBgTypeOverrides);
export const selectHasOverride = store.createSelector(projections.getHasOverride);
export const selectBgDefaultReasoningEffort = store.createSelector(
  projections.getBgDefaultReasoningEffort,
);
export const selectBgTypeReasoningEffortOverrides = store.createSelector(
  projections.getBgTypeReasoningEffortOverrides,
);
export const selectBgSettings = store.createSelector(projections.getBgSettings);
