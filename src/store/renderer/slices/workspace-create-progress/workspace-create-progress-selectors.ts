import { store } from '../../store';
import type { WorkspaceCreateProgressEntry } from './workspace-create-progress-types';

export const selectWorkspaceCreateProgress = store.createSelector<
  [progressId: string],
  WorkspaceCreateProgressEntry | null
>((state, progressId) => {
  return state.workspaceCreateProgress.byProgressId[progressId] ?? null;
});
