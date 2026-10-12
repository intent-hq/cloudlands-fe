import { store } from '../index';
import { getPRStatusLastRefreshTime } from '../../../../../src/store/renderer/slices/pr-status/pr-status-projections';

export const selectPRStatusLastRefreshTime = store.createSelector(getPRStatusLastRefreshTime);
