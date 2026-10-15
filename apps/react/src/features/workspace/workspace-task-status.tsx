import { TASK_STATUS_LABELS } from '$lib/components/workspace/utils/task-status-display';
import { useLayoutEffect, useRef, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { store } from '@/store';
import { selectNoteById } from '@/store/workspace-notes/workspace-notes-selectors';
import {
  selectNoteEditAuthority,
  selectNoteEditContext,
} from '@/store/workspace-notes/note-edit-selectors';
import {
  selectTaskStatusReady,
  selectTaskStatusRevokedViews,
  selectTaskStatusCurrent,
  selectTaskStatusBlocked,
  selectTaskStatusRefreshing,
  selectTaskStatusOperations,
} from '@/store/workspace-tasks/task-status-selectors';
import {
  acquireWorkspaceTasksDemand,
  releaseWorkspaceTasksDemand,
  explicitTaskStatusViewOpened,
  explicitTaskStatusReleased,
  explicitTaskStatusChangeRequested,
  invalidateWorkspaceTasks,
  loadWorkspaceTasksRequested,
} from '../../../../../src/store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import { readNoteRequested } from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import type { ExplicitTaskStatusIdentity } from '../../../../../src/store/renderer/slices/workspace-tasks/workspace-tasks-types';
import {
  isTaskStatus,
  isTaskStatusEditable,
} from '../../../../../src/features/tasks/task-status-policy';
import { m } from '$shared/paraglide/messages.js';

type Props = { workspaceId: string; noteId: string; consumerId: string };
function TaskStatusControl({
  workspaceId,
  noteId,
  consumerId,
  authority,
  context,
}: Props & { authority: string; context: string }) {
  const note = selectNoteById(workspaceId, noteId).value;
  const ready = selectTaskStatusReady(workspaceId, noteId, consumerId).value;
  const blocked = selectTaskStatusBlocked(workspaceId, noteId).value;
  const operations = selectTaskStatusOperations(workspaceId, noteId, authority).value;
  const last = operations.at(-1);
  const pending = operations.some((operation) => ['queued', 'running'].includes(operation.status));
  const unknown = operations.some((operation) => operation.status === 'unknown');
  const refreshing = selectTaskStatusRefreshing(workspaceId, noteId).value;
  const revoked = selectTaskStatusRevokedViews().value;
  const [epoch, setEpoch] = useState(0);
  const currentEpoch = useRef(epoch);
  const identity = useRef<ExplicitTaskStatusIdentity | null>(null);
  const menuOpen = useRef(false);
  const draftRevision = useRef<number | null>(null);
  useLayoutEffect(() => {
    currentEpoch.current = epoch;
    const current = {
      workspaceId,
      noteId,
      consumerId,
      authority,
      context,
      viewId: crypto.randomUUID(),
    };
    identity.current = current;
    store.dispatch(acquireWorkspaceTasksDemand(workspaceId, current.viewId));
    store.dispatch(explicitTaskStatusViewOpened(current));
    return () => {
      identity.current = null;
      store.dispatch(explicitTaskStatusReleased(current.viewId));
      store.dispatch(releaseWorkspaceTasksDemand(workspaceId, current.viewId));
    };
  }, [workspaceId, noteId, consumerId, authority, context, epoch]);
  useLayoutEffect(() => {
    if (identity.current && revoked[identity.current.viewId]) {
      identity.current = null;
      menuOpen.current = false;
      draftRevision.current = null;
      setEpoch((value) => value + 1);
    }
  }, [revoked]);
  const currentIdentity = () => {
    const current = identity.current;
    return currentEpoch.current === epoch &&
      current &&
      selectTaskStatusCurrent.select(store.state, current)
      ? current
      : null;
  };
  const items = Object.entries(TASK_STATUS_LABELS).map(([value, label]) => ({ value, label }));
  return (
    <div className="grid min-w-0 gap-2" data-testid="workspace-task-status">
      <div className="w-full max-w-xs">
        <Select
          key={epoch}
          value={note?.metadata?.task?.status ?? ''}
          items={items}
          disabled={!ready || blocked}
          onOpenChange={(open) => {
            menuOpen.current = open;
            if (open)
              draftRevision.current = currentIdentity()
                ? (selectNoteById.select(store.state, workspaceId, noteId)?.rev ?? null)
                : null;
          }}
          onValueChange={(status) => {
            if (!menuOpen.current) return;
            menuOpen.current = false;
            const current = currentIdentity();
            const expectedVersion = draftRevision.current;
            const saved = selectNoteById.select(store.state, workspaceId, noteId);
            draftRevision.current = null;
            if (
              !current ||
              expectedVersion === null ||
              !isTaskStatus(status) ||
              saved?.rev !== expectedVersion ||
              saved.metadata?.task?.status === status ||
              selectTaskStatusBlocked.select(store.state, workspaceId, noteId)
            )
              return;
            store.dispatch(
              explicitTaskStatusChangeRequested(workspaceId, noteId, status, {
                ...current,
                expectedVersion,
                requestId: crypto.randomUUID(),
              }),
            );
          }}
        >
          <SelectTrigger aria-label={m.workspace_taskStatus_change_ariaLabel()}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent portal>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value} label={item.label} />
            ))}
          </SelectContent>
        </Select>
      </div>
      {pending && <output>{m.workspace_taskStatus_updating_label()}</output>}
      {unknown && <p role="alert">{m.workspace_taskStatus_unknown_description()}</p>}
      {refreshing && (
        <div className="grid justify-items-start gap-2">
          <output>{m.workspace_taskStatus_refresh_description()}</output>
          <Button
            variant="outline"
            onClick={() => {
              if (!currentIdentity()) return;
              void store
                .dispatch(readNoteRequested(workspaceId, noteId, 'note:updated'))
                .catch(() => undefined);
              store.dispatch(invalidateWorkspaceTasks(workspaceId));
              store.dispatch(loadWorkspaceTasksRequested(workspaceId));
            }}
          >
            {m.ui_combobox_retry_label()}
          </Button>
        </div>
      )}
      {!pending && !unknown && last?.status === 'failed' && (
        <p role="alert">{m.workspace_taskStatus_failed_description()}</p>
      )}
      {!pending && !unknown && !refreshing && last?.status === 'conflict' && (
        <p role="alert">{m.tasks_write_conflict_description()}</p>
      )}
    </div>
  );
}
export function WorkspaceTaskStatus(props: Props) {
  const note = selectNoteById(props.workspaceId, props.noteId).value;
  const authority = selectNoteEditAuthority(props.workspaceId, props.noteId).value;
  const context = selectNoteEditContext(props.workspaceId, props.noteId).value;
  if (!isTaskStatusEditable(note) || !authority || !context) return null;
  return <TaskStatusControl key={context} {...props} authority={authority} context={context} />;
}
