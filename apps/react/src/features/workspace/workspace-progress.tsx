import { useNavigate } from '@tanstack/react-router';
import { FlameGraph } from '@/components/workspace/sidebar/flame-graph';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import {
  selectAllNotes,
  selectWorkspaceNotesState,
} from '@/store/workspace-notes/workspace-notes-selectors';
import {
  selectWorkspaceTaskProgress,
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
  const workspace = selectWorkspaceById(workspaceId);
  const stats = selectWorkspaceTaskProgress(workspaceId);
  const initialized = selectWorkspaceTasksInitialized(workspaceId);
  const notes = selectAllNotes(workspaceId);
  const noteState = selectWorkspaceNotesState(workspaceId);
  const ready = initialized.value || !!workspace.value?.taskStats;
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
