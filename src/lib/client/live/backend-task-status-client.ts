import { m } from '../../../shared/paraglide/messages.js';
import type { TaskStatus } from '../../../shared/types';
import type { MutationResult } from '../client-types';
import type {
  TaskStatusClient,
  TaskStatusReceipt,
  TaskStatusTransport,
} from './backend-task-status-types';
import { extractConflict, mutationErrorMessage } from './backend-mutation';
import { isDaemonErrorResponse } from './backend-transport-types';
import { conflictToTask } from './task-normalization';

import { isTaskStatus } from '../../../features/tasks/task-status-policy';

/** Validate the pinned raw Note receipt; retain only status/revision, never another note body. */
function readReceipt(
  value: unknown,
  workspaceId: string,
  noteId: string,
): TaskStatusReceipt | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const note = value as {
    id?: unknown;
    workspaceId?: unknown;
    rev?: unknown;
    metadata?: { task?: { status?: unknown } };
  };
  const status = note.metadata?.task?.status;
  if (
    note.id !== noteId ||
    note.workspaceId !== workspaceId ||
    !isTaskStatus(status) ||
    typeof note.rev !== 'number' ||
    !Number.isSafeInteger(note.rev) ||
    note.rev < 0
  )
    return undefined;
  return { status, rev: note.rev };
}

/** One task-status encoder; compatibility callers opt out of strict dispatch/receipt admission. */
export function createBackendTaskStatusClient(
  request: TaskStatusTransport,
  legacyMutation?: (method: string, params: unknown) => Promise<MutationResult>,
): TaskStatusClient {
  const paramsFor = (
    workspaceId: string,
    noteId: string,
    status: TaskStatus,
    expectedVersion?: number,
  ) => ({
    workspaceId,
    noteId,
    status,
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  });
  return {
    async updateLegacy(workspaceId, noteId, status, expectedVersion) {
      if (!legacyMutation) throw new Error(m.notes_writeService_updateFailed_error());
      const result = await legacyMutation(
        'task.updateNoteStatus',
        paramsFor(workspaceId, noteId, status, expectedVersion),
      );
      const current = result.conflict?.current;
      const task =
        current && typeof current === 'object'
          ? conflictToTask(current as Record<string, unknown>)
          : undefined;
      return task ? { ...result, conflict: { current: task } } : result;
    },
    async update(workspaceId, noteId, status, expectedVersion, options) {
      let dispatched = false;
      try {
        if (
          !workspaceId ||
          !noteId ||
          !isTaskStatus(status) ||
          !Number.isSafeInteger(expectedVersion) ||
          expectedVersion < 0
        )
          throw new Error(m.notes_writeService_updateFailed_error());
        const raw = await request(
          'task.updateNoteStatus',
          paramsFor(workspaceId, noteId, status, expectedVersion),
          {
            onDispatch() {
              if (dispatched) throw new Error(m.ui_reversibleActions_cancelled_message());
              options.onDispatch();
              dispatched = true;
            },
          },
        );
        const result = raw as {
          ok?: unknown;
          noteId?: unknown;
          status?: unknown;
          note?: unknown;
          advisory?: unknown;
        } | null;
        const receipt = readReceipt(result?.note, workspaceId, noteId);
        if (
          dispatched &&
          result?.ok === true &&
          result.noteId === noteId &&
          receipt &&
          result.status === receipt.status &&
          (receipt.status === status || typeof result.advisory === 'string') &&
          receipt.rev >= expectedVersion &&
          (result.advisory === undefined || typeof result.advisory === 'string')
        ) {
          return {
            outcome: 'confirmed',
            receipt,
            ...(typeof result.advisory === 'string' ? { error: result.advisory } : {}),
          };
        }
        return { outcome: 'unknown' };
      } catch (error) {
        const conflict = extractConflict(error);
        if (dispatched && conflict)
          return {
            outcome: 'conflict',
            receipt: readReceipt(conflict.current, workspaceId, noteId),
            error: mutationErrorMessage(error),
          };
        return {
          outcome: !dispatched || isDaemonErrorResponse(error) ? 'failed' : 'unknown',
          error: mutationErrorMessage(error),
        };
      }
    },
  };
}
