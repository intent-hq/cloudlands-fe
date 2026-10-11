import { store } from '@/store';
import { getMountedWorkspaceIds } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-projections';
export const selectMountedWorkspaceIds = store.createSelector(getMountedWorkspaceIds);
