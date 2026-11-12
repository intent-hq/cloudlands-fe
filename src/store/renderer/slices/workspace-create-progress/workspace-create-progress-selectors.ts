import { store } from '../../store';
import type { WorkspaceCreateProgressEntry } from './workspace-create-progress-types';

export const selectWorkspaceCreateProgress = store.createSelector<
  [progressId: string | null],
  WorkspaceCreateProgressEntry | null
>((state, progressId) => {
  if (!progressId) return null;
  return state.workspaceCreateProgress.byProgressId[progressId] ?? null;
});
