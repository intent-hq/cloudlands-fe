import { store } from '../index';
import {
  getCurrentCommits,
  getOlderCommits,
  getCommitHistory,
} from '../../../../../src/store/renderer/slices/changes/changes-projections';
export const selectWorkspaceHistory = store.createSelector((state, workspaceId: string) => ({
  commits: getCurrentCommits(state, workspaceId),
  older: getOlderCommits(state, workspaceId),
  history: getCommitHistory(state, workspaceId),
  boundarySha: state.changes.byWorkspaceId[workspaceId]?.boundarySha ?? null,
}));
