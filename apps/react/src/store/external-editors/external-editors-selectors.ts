import { store } from '@/store';
import {
  createInstalledEditorsProjection,
  getInstalledEditorsCollection,
  getInstalledEditorsLoading,
  getLastFetched,
} from '../../../../../src/store/renderer/slices/external-editors/external-editors-projections';

const selectInstalledEditorsCollection = store.createSelector(getInstalledEditorsCollection);

export const selectInstalledEditors = store.createSelector(
  createInstalledEditorsProjection(selectInstalledEditorsCollection),
);
export const selectInstalledEditorsLoading = store.createSelector(getInstalledEditorsLoading);
export const selectLastFetched = store.createSelector(getLastFetched);
