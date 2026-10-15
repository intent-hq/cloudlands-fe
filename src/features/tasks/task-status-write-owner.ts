import { m } from '../../shared/paraglide/messages.js';
import type { TaskStatus, WorkspaceTask } from '../../shared/types';
import { getNoteById } from '../../store/renderer/slices/workspace-notes/workspace-notes-projections';
import { taskStatusReceiptAccepted } from '../../store/renderer/slices/workspace-notes/workspace-notes-slice';
import {
  getExplicitTaskStatusCurrent,
  getExplicitTaskStatusBlocked,
  getExplicitTaskStatusOperations,
} from '../../store/renderer/slices/workspace-tasks/workspace-tasks-projections';
import {
  explicitTaskStatusViewAdmitted,
  explicitTaskStatusQueued,
  explicitTaskStatusStarted,
  explicitTaskStatusSettled,
} from '../../store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import type {
  ExplicitTaskStatusIdentity,
  ExplicitTaskStatusRequest,
} from '../../store/renderer/slices/workspace-tasks/workspace-tasks-types';
import type { TaskStatusWriteDependencies } from './task-status-write-types';
import type { TaskStatusOutcome } from '../../lib/client/live/backend-task-status-types';
import { isTaskStatus, isTaskStatusEditable } from './task-status-policy';

/** Shared status writer. Source keeps its compatibility policy; explicit callers opt into scoped receipts. */
export function createTaskStatusWriteOwner(deps: TaskStatusWriteDependencies) {
  function open(identity: ExplicitTaskStatusIdentity): void {
    const host = deps.explicit;
    if (
      !host ||
      !identity.workspaceId ||
      !identity.noteId ||
      !identity.viewId ||
      !identity.consumerId ||
      !identity.authority ||
      !identity.context ||
      !host.isCurrent(identity)
    )
      return;
    const note = getNoteById(host.getState(), identity.workspaceId, identity.noteId);
    if (!isTaskStatusEditable(note)) return;
    host.dispatch(explicitTaskStatusViewAdmitted({ ...identity, noteRevision: note.rev }));
  }

  async function updateExplicit(
    workspaceId: string,
    noteId: string,
    status: TaskStatus,
    requested: ExplicitTaskStatusRequest,
  ): Promise<void> {
    const host = deps.explicit;
    const request = { ...requested };
    if (
      !host ||
      request.workspaceId !== workspaceId ||
      request.noteId !== noteId ||
      !request.requestId?.trim() ||
      !isTaskStatus(status)
    )
      return;
    const current = (requireRevision: boolean) => {
      const state = host.getState();
      const note = getNoteById(state, workspaceId, noteId);
      return (
        host.isCurrent(request) &&
        getExplicitTaskStatusCurrent(state, request) &&
        isTaskStatusEditable(note) &&
        (!requireRevision || note.rev === request.expectedVersion)
      );
    };
    if (!current(true)) return;
    const note = getNoteById(host.getState(), workspaceId, noteId);
    if (note?.metadata?.task?.status === status) return;
    // Synchronous reservation precedes the first await, serializing clicks across views of this note.
    const operations = getExplicitTaskStatusOperations(host.getState(), workspaceId, noteId);
    if (
      operations.some((operation) => operation.requestId === request.requestId) ||
      getExplicitTaskStatusBlocked(host.getState(), workspaceId, noteId)
    )
      return;
    host.dispatch(
      explicitTaskStatusQueued({ ...request, requestedStatus: status, status: 'queued' }),
    );
    const own = () =>
      getExplicitTaskStatusOperations(host.getState(), workspaceId, noteId).find(
        (operation) => operation.requestId === request.requestId,
      );
    if (own()?.status !== 'queued') return;
    let dispatched = false;
    let result: TaskStatusOutcome;
    try {
      result = await host.client.update(workspaceId, noteId, status, request.expectedVersion, {
        onDispatch() {
          if (dispatched || !current(true) || own()?.status !== 'queued')
            throw new Error(m.ui_reversibleActions_cancelled_message());
          host.dispatch(explicitTaskStatusStarted(request.requestId));
          if (!current(true) || own()?.status !== 'running')
            throw new Error(m.ui_reversibleActions_cancelled_message());
          dispatched = true;
        },
      });
    } catch (error) {
      result = {
        outcome: dispatched ? 'unknown' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    // A client that never reached the final boundary cannot provide confirmation.
    const outcome = !dispatched && result.outcome === 'confirmed' ? 'unknown' : result.outcome;
    host.dispatch(
      explicitTaskStatusSettled(
        request.requestId,
        outcome,
        result.receipt?.status,
        result.receipt?.rev,
        result.error,
      ),
    );
    if (
      dispatched &&
      outcome === 'confirmed' &&
      result.receipt &&
      result.receipt.rev > request.expectedVersion &&
      current(false)
    ) {
      host.dispatch(
        taskStatusReceiptAccepted(workspaceId, noteId, result.receipt.status, result.receipt.rev),
      );
    }
    if ((outcome === 'confirmed' || outcome === 'conflict') && current(false))
      host.requestRefresh(workspaceId, noteId);
  }

  async function update(
    workspaceId: string,
    noteId: string,
    status: TaskStatus,
    request?: ExplicitTaskStatusRequest,
  ): Promise<void> {
    if (request) return updateExplicit(workspaceId, noteId, status, request);
    if (!('readNote' in deps)) return;
    const note = deps.readNote(workspaceId, noteId);
    const task = deps.readTask(workspaceId, noteId);
    const previous = note?.metadata?.task?.status ?? task?.status;
    const rev = note?.rev ?? task?.rev;
    deps.applyStatus(workspaceId, noteId, status);
    const result =
      rev !== undefined
        ? await deps.updateNoteStatus(noteId, status, rev)
        : await deps.updateNoteStatus(noteId, status);
    if (result.success) return;
    if (result.conflict) {
      const current = result.conflict.current as WorkspaceTask | undefined;
      if (current && typeof current === 'object') {
        if (current.status) deps.applyStatus(workspaceId, noteId, current.status);
        if (typeof current.rev === 'number') deps.applyRev(workspaceId, noteId, current.rev);
      }
      deps.onConflict();
      return;
    }
    if (previous !== undefined) deps.applyStatus(workspaceId, noteId, previous);
    deps.onFailure(result.error);
  }
  return { open, update };
}
