/**
 * Task↔agent association mutation service — routes the local
 * `taskAgentAssociations/*` reducer actions to the daemon-owned
 * `task.linkAgent` / `task.unlinkAgent` RPCs (PROTOCOL §5.4). The reducer
 * runs first for instant UI feedback; the middleware then issues the wire
 * calls so the daemon becomes the source of truth. Cross-window convergence
 * flows via the self-sufficient `task:agent-linked` / `task:agent-unlinked`
 * events (§6.5), folded back into the store by the daemon-events bridge.
 *
 * `removeTaskAgentAssociation` and `pruneTaskAgentAssociationsForNote` are
 * diff-driven: the reducer's own logic decides which rows survive (a remove
 * may match by taskText, a prune may drop several at once), so this
 * middleware snapshots the pre-reducer note state, lets the reducer run, and
 * fires an `unlinkAgent` for every `taskKey` that disappeared. The wire
 * calls are fire-and-forget — the event stream (not the mutation response)
 * is the convergence path.
 *
 * READ-THROUGH: never writes state itself; only issues the wire calls so the
 * daemon owns persistence. Dependency-light per src/store AGENTS.md.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  addTaskAgentAssociation,
  pruneTaskAgentAssociationsForNote,
  removeTaskAgentAssociation,
} from "$store/renderer/slices/task-agent-associations/task-agent-associations-slice";
import type {
  TaskAgentAssociation,
  TaskAgentAssociationsByTaskKey,
} from "$store/renderer/slices/task-agent-associations/task-agent-associations-types";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("TaskAgentAssociationsMutationService");

function readNoteAssociations(
  workspaceId: string,
  noteId: string,
): TaskAgentAssociationsByTaskKey {
  return (
    appStore.state.taskAgentAssociations.byWorkspaceId[workspaceId]?.byNoteId[noteId] ?? {}
  );
}

async function pushLink(
  workspaceId: string,
  noteId: string,
  association: TaskAgentAssociation,
): Promise<void> {
  try {
    await appClient.tasks.linkAgent(workspaceId, noteId, association);
  } catch (error) {
    logger.error("task.linkAgent failed", { workspaceId, noteId, error });
  }
}

async function pushUnlink(
  workspaceId: string,
  noteId: string,
  taskKey: string,
): Promise<void> {
  try {
    await appClient.tasks.unlinkAgent(workspaceId, noteId, taskKey);
  } catch (error) {
    logger.error("task.unlinkAgent failed", { workspaceId, noteId, taskKey, error });
  }
}

function workspaceIdOf(action: { payload?: unknown }): string | undefined {
  return Array.isArray(action.payload) && typeof action.payload[0] === "string"
    ? action.payload[0]
    : undefined;
}

function noteIdOf(action: { payload?: unknown }): string | undefined {
  return Array.isArray(action.payload) && typeof action.payload[1] === "string"
    ? action.payload[1]
    : undefined;
}

/**
 * Middleware giving the task-agent-associations mutation actions a real write
 * path. `add` → `task.linkAgent`; `remove` / `prune` diff pre vs post state
 * per note and unlink every dropped `taskKey`.
 */
export function createTaskAgentAssociationsMutationMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    if (!action) return next(action);

    // Snapshot the pre-reducer note state for actions whose reducer removes
    // rows by text-match or by prune diff — the removed `taskKey` is only
    // knowable by comparing pre vs post state.
    let preSnapshot: TaskAgentAssociationsByTaskKey | undefined;
    const isRemove = action.type === removeTaskAgentAssociation.type;
    const isPrune = action.type === pruneTaskAgentAssociationsForNote.type;
    if (isRemove || isPrune) {
      const workspaceId = workspaceIdOf(action);
      const noteId = noteIdOf(action);
      if (workspaceId && noteId) {
        preSnapshot = { ...readNoteAssociations(workspaceId, noteId) };
      }
    }

    const result = next(action);

    if (action.type === addTaskAgentAssociation.type) {
      const workspaceId = workspaceIdOf(action);
      const noteId = noteIdOf(action);
      const payload = (action as { payload?: unknown }).payload;
      const association =
        Array.isArray(payload) && payload[2] && typeof payload[2] === "object"
          ? (payload[2] as TaskAgentAssociation)
          : undefined;
      if (workspaceId && noteId && association) {
        void pushLink(workspaceId, noteId, association);
      }
    } else if ((isRemove || isPrune) && preSnapshot) {
      const workspaceId = workspaceIdOf(action);
      const noteId = noteIdOf(action);
      if (workspaceId && noteId) {
        const post = readNoteAssociations(workspaceId, noteId);
        for (const key of Object.keys(preSnapshot)) {
          if (!(key in post)) void pushUnlink(workspaceId, noteId, key);
        }
      }
    }
    return result;
  };
}
