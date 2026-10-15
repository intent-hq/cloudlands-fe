import { ErrorState } from '@/components/patterns/screen';
import { m } from '$shared/paraglide/messages.js';
import { useEffect } from 'react';
import { store } from '@/store';
import {
  acquireWorkspaceTasksDemand,
  releaseWorkspaceTasksDemand,
  loadWorkspaceTasksRequested,
} from '../../../../../src/store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { useNavigate } from '@tanstack/react-router';
import { FlameGraph } from '@/components/workspace/sidebar/flame-graph';
import {
  selectAllNotes,
  selectWorkspaceNotesState,
} from '@/store/workspace-notes/workspace-notes-selectors';
import {
  selectWorkspaceTaskProgress,
  selectWorkspaceTaskReadState,
  selectWorkspaceTasksInitialized,
} from '@/store/workspace-tasks/workspace-tasks-selectors';

export function WorkspaceProgress({
  workspaceId,
  query,
  fileQuery,
}: {
  workspaceId: string;
  query?: string;
  fileQuery?: string;
}) {
  const navigate = useNavigate();
  const context = selectAdmittedWorkspaceReadContext(workspaceId).value;
  useEffect(() => {
    if (!context) return;
    const demandId = crypto.randomUUID();
    store.dispatch(acquireWorkspaceTasksDemand(workspaceId, demandId));
    return () => {
      store.dispatch(releaseWorkspaceTasksDemand(workspaceId, demandId));
    };
  }, [workspaceId, context]);
  const read = selectWorkspaceTaskReadState(workspaceId).value;
  const stats = selectWorkspaceTaskProgress(workspaceId);
  const initialized = selectWorkspaceTasksInitialized(workspaceId);
  const notes = selectAllNotes(workspaceId);
  const noteState = selectWorkspaceNotesState(workspaceId);
  const ready = initialized.value && !read.loading && !read.stale;
  if (read.error)
    return (
      <ErrorState
        density="compact"
        message={m.workspaceSummary_tasksFailed_error()}
        retryLabel={m.ui_combobox_retry_label()}
        onRetry={() => {
          if (
            selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) === context &&
            context
          )
            store.dispatch(loadWorkspaceTasksRequested(workspaceId));
        }}
      />
    );
  if (noteState.value.error || (ready && stats.value.total === 0)) return null;
  return (
    <div className="min-w-0" data-testid="workspace-task-progress">
      <FlameGraph
        notes={notes.value}
        progress={
          ready
            ? stats.value.total > 0
              ? stats.value.completed / stats.value.total
              : 0
            : undefined
        }
        loading={!ready || !noteState.value.initialized}
        animationKey={workspaceId}
        onTaskClick={(noteId) => {
          void navigate({
            to: '/workspaces/$workspaceId',
            params: { workspaceId },
            search: { note: noteId, q: query || undefined, fileQuery: fileQuery || undefined },
          });
        }}
      />
    </div>
  );
}
