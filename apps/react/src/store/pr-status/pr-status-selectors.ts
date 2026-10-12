import { store } from '../index';
import {
  getPRStatusLastRefreshTime,
  getPRStatusRefreshMetadata,
} from '../../../../../src/store/renderer/slices/pr-status/pr-status-projections';

export const selectPRStatusLastRefreshTime = store.createSelector(getPRStatusLastRefreshTime);

export const selectPRStatusRefreshMetadata = store.createSelector(getPRStatusRefreshMetadata);
