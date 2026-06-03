import {
  call,
  fork,
  put,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import {
  getLocalStorageJSON,
  getLocalStorageKeysWithPrefix,
  removeLocalStorageItem,
  setLocalStorageJSON,
} from "$store/renderer/utils/safe-local-storage-saga";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import {
  addTaskAgentAssociation,
  applyRemoveTaskAgentAssociationsForAgent,
  hydrateTaskAgentAssociations,
  pruneTaskAgentAssociationsForNote,
  removeTaskAgentAssociation,
  removeTaskAgentAssociationsForAgent,
  TASK_AGENT_ASSOCIATIONS_STORAGE_PREFIX,
} from "../task-agent-associations-slice";
import {
  selectAssociationsForNote,
  selectTaskAgentAssociationsByNoteId,
} from "../task-agent-associations-selectors";
import { removeAgent } from "../../workspace-agents/workspace-agents-slice";
import type {
  TaskAgentAssociation,
  TaskAgentAssociationsByTaskKey,
} from "../task-agent-associations-types";
import {
  dispatchAgentAssociationsRemovedEvent,
  dispatchTaskAssociationChangedEvent,
} from "../task-agent-associations-window-events";

function getStoragePrefix(workspaceId: string): string {
  return `${TASK_AGENT_ASSOCIATIONS_STORAGE_PREFIX}${workspaceId}:`;
}

function getStorageKey(workspaceId: string, noteId: string): string {
  return `${getStoragePrefix(workspaceId)}${noteId}`;
}

function isAssociation(value: unknown): value is TaskAgentAssociation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.taskText === "string" &&
    (candidate.taskKey === undefined || typeof candidate.taskKey === "string") &&
    typeof candidate.agentId === "string" &&
    typeof candidate.noteId === "string" &&
    typeof candidate.createdAt === "number";
}

function normalizeAssociations(value: unknown): TaskAgentAssociationsByTaskKey {
  if (!Array.isArray(value)) return {};
  return value.reduce<TaskAgentAssociationsByTaskKey>((acc, item) => {
    if (isAssociation(item)) acc[item.taskKey ?? item.taskText] = item;
    return acc;
  }, {});
}

function affectedNoteIds(
  byNoteId: Record<string, TaskAgentAssociationsByTaskKey>,
  agentId: string
): string[] {
  return Object.entries(byNoteId)
    .filter(([, associations]) =>
      Object.values(associations).some((association) => association.agentId === agentId)
    )
    .map(([noteId]) => noteId);
}

export function* hydrateWorkspaceTaskAgentAssociationsSaga(
  action: ReturnType<typeof workspaceMounted>
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const prefix = getStoragePrefix(workspaceId);
  let keys: string[] = [];
  try {
    keys = yield* call(getLocalStorageKeysWithPrefix, prefix);
  } catch {
    // Safe storage helpers catch internally; keep hydration resilient if one throws unexpectedly.
  }
  const byNoteId: Record<string, TaskAgentAssociationsByTaskKey> = {};

  for (const key of keys) {
    const noteId = key.slice(prefix.length);
    let associations: TaskAgentAssociationsByTaskKey = {};
    try {
      associations = normalizeAssociations(yield* call(getLocalStorageJSON<unknown>, key));
    } catch {
      // Ignore malformed/unreadable note association records.
    }
    if (noteId && Object.keys(associations).length > 0) {
      byNoteId[noteId] = associations;
    }
  }

  yield* put(hydrateTaskAgentAssociations(workspaceId, byNoteId));
  if (Object.keys(byNoteId).length > 0) {
    yield* call(dispatchTaskAssociationChangedEvent);
  }
}

export function* persistAssociationsForNote(workspaceId: string, noteId: string): SagaGenerator<void> {
  const associations = yield* selectAssociationsForNote.effect(workspaceId, noteId);
  const key = getStorageKey(workspaceId, noteId);
  if (associations.length === 0) {
    try {
      yield* call(removeLocalStorageItem, key);
    } catch {
      // Ignore storage errors; Redux state remains updated for the current session.
    }
    return;
  }
  try {
    yield* call(setLocalStorageJSON, key, associations);
  } catch {
    // Ignore storage errors; Redux state remains updated for the current session.
  }
}

export function* persistTaskAgentAssociationChangeSaga(
  action:
    | ReturnType<typeof addTaskAgentAssociation>
    | ReturnType<typeof removeTaskAgentAssociation>
    | ReturnType<typeof pruneTaskAgentAssociationsForNote>
): SagaGenerator<void> {
  const [workspaceId, noteId] = action.payload;
  yield* call(persistAssociationsForNote, workspaceId, noteId);
  yield* call(dispatchTaskAssociationChangedEvent);
}

function* watchTaskAgentAssociationChanges(): SagaGenerator<void> {
  yield* takeEvery(
    [addTaskAgentAssociation, removeTaskAgentAssociation, pruneTaskAgentAssociationsForNote],
    persistTaskAgentAssociationChangeSaga
  );
}

export function* removeWorkspaceAgentAssociationsSaga(
  action: ReturnType<typeof removeTaskAgentAssociationsForAgent> | ReturnType<typeof removeAgent>
): SagaGenerator<void> {
  const [workspaceId, agentId] = action.payload;
  const before = yield* selectTaskAgentAssociationsByNoteId.effect(workspaceId);
  const noteIds = affectedNoteIds(before, agentId);

  if (noteIds.length === 0) return;

  yield* put(applyRemoveTaskAgentAssociationsForAgent(workspaceId, agentId));
  for (const noteId of noteIds) {
    yield* call(persistAssociationsForNote, workspaceId, noteId);
    yield* call(dispatchAgentAssociationsRemovedEvent, { agentId, noteId, workspaceId });
  }
  yield* call(dispatchTaskAssociationChangedEvent);
}

function* watchRemoveAssociationsForAgent(): SagaGenerator<void> {
  yield* takeEvery(
    [removeTaskAgentAssociationsForAgent, removeAgent],
    removeWorkspaceAgentAssociationsSaga
  );
}

export function* taskAgentAssociationsSaga(): SagaGenerator<void> {
  yield* takeEvery(workspaceMounted, hydrateWorkspaceTaskAgentAssociationsSaga);
  yield* fork(watchTaskAgentAssociationChanges);
  yield* fork(watchRemoveAssociationsForAgent);
}
