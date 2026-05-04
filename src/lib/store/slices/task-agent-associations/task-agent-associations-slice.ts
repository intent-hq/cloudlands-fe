import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type {
  TaskAgentAssociation,
  TaskAgentAssociationsByTaskKey,
  TaskAgentAssociationsState,
  TaskAgentAssociationsWorkspaceState,
} from "./task-agent-associations-types";

export const TASK_AGENT_ASSOCIATIONS_STORAGE_PREFIX = "task-agent-associations:";
export const TASK_ASSOCIATION_CHANGED_EVENT = "task-association-changed";
export const AGENT_ASSOCIATIONS_REMOVED_EVENT = "agent-associations-removed";

const TASK_AGENT_KEY_PREFIX = "agent:";

export const emptyTaskAgentAssociationsWorkspaceState: TaskAgentAssociationsWorkspaceState = {
  byNoteId: {},
};

export const initialState: TaskAgentAssociationsState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyTaskAgentAssociationsWorkspaceState);

export const hydrateTaskAgentAssociations = createAction<[
  workspaceId: string,
  byNoteId: Record<string, TaskAgentAssociationsByTaskKey>,
]>("taskAgentAssociations/hydrateTaskAgentAssociations");

export const addTaskAgentAssociation = createAction<[
  workspaceId: string,
  noteId: string,
  association: TaskAgentAssociation,
]>("taskAgentAssociations/addTaskAgentAssociation");

export const removeTaskAgentAssociation = createAction<[
  workspaceId: string,
  noteId: string,
  taskKeyOrText: string,
]>("taskAgentAssociations/removeTaskAgentAssociation");

export const pruneTaskAgentAssociationsForNote = createAction<[
  workspaceId: string,
  noteId: string,
  currentTaskKeysOrTexts: string[],
]>("taskAgentAssociations/pruneTaskAgentAssociationsForNote");

export const removeTaskAgentAssociationsForAgent = createAction<[
  workspaceId: string,
  agentId: string,
]>("taskAgentAssociations/removeTaskAgentAssociationsForAgent");

export const applyRemoveTaskAgentAssociationsForAgent = createAction<[
  workspaceId: string,
  agentId: string,
]>("taskAgentAssociations/applyRemoveTaskAgentAssociationsForAgent");

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _omitted, ...rest } = record;
  return rest;
}

function getAssociationKey(association: TaskAgentAssociation, storedKey?: string): string {
  return association.taskKey ?? storedKey ?? association.taskText;
}

function isAgentDerivedTaskKey(taskKey: string): boolean {
  return taskKey.startsWith(TASK_AGENT_KEY_PREFIX);
}

function countAssociationsByTaskText(
  noteAssociations: TaskAgentAssociationsByTaskKey
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const association of Object.values(noteAssociations)) {
    counts[association.taskText] = (counts[association.taskText] ?? 0) + 1;
  }
  return counts;
}

function countCurrentTasksByText(
  currentTaskKeysOrTexts: string[],
  associationTexts: Set<string>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const currentKeyOrText of currentTaskKeysOrTexts) {
    if (associationTexts.has(currentKeyOrText)) {
      counts[currentKeyOrText] = (counts[currentKeyOrText] ?? 0) + 1;
    }
  }
  return counts;
}

function findAssociationKey(
  noteAssociations: TaskAgentAssociationsByTaskKey,
  taskKeyOrText: string
): string | undefined {
  if (noteAssociations[taskKeyOrText]) return taskKeyOrText;
  return Object.entries(noteAssociations).find(([, association]) => association.taskText === taskKeyOrText)?.[0];
}

export const taskAgentAssociationsReducer = createReducer<TaskAgentAssociationsState>(initialState)
  .with(hydrateTaskAgentAssociations, (state, { payload: [workspaceId, byNoteId] }) =>
    setWorkspaceState(state, workspaceId, { byNoteId })
  )
  .with(addTaskAgentAssociation, (state, { payload: [workspaceId, noteId, association] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    const noteAssociations = workspaceState.byNoteId[noteId] ?? {};

    return setWorkspaceState(state, workspaceId, {
      byNoteId: {
        ...workspaceState.byNoteId,
        [noteId]: {
          ...noteAssociations,
          [getAssociationKey(association)]: association,
        },
      },
    });
  })
  .with(removeTaskAgentAssociation, (state, { payload: [workspaceId, noteId, taskKeyOrText] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    const noteAssociations = workspaceState.byNoteId[noteId];
    if (!noteAssociations) return state;
    const associationKey = findAssociationKey(noteAssociations, taskKeyOrText);
    if (!associationKey) return state;

    const nextNoteAssociations = omitKey(noteAssociations, associationKey);
    const byNoteId = Object.keys(nextNoteAssociations).length === 0
      ? omitKey(workspaceState.byNoteId, noteId)
      : { ...workspaceState.byNoteId, [noteId]: nextNoteAssociations };

    return setWorkspaceState(state, workspaceId, { byNoteId });
  })
  .with(pruneTaskAgentAssociationsForNote, (state, { payload: [workspaceId, noteId, currentTaskKeysOrTexts] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    const noteAssociations = workspaceState.byNoteId[noteId];
    if (!noteAssociations) return state;

    const currentTaskKeySet = new Set(currentTaskKeysOrTexts);
    const associationsByTaskText = countAssociationsByTaskText(noteAssociations);
    const currentTasksByText = countCurrentTasksByText(
      currentTaskKeysOrTexts,
      new Set(Object.keys(associationsByTaskText))
    );
    const nextNoteAssociations = Object.fromEntries(
      Object.entries(noteAssociations).filter(([storedKey, association]) => {
        const associationKey = getAssociationKey(association, storedKey);
        if (isAgentDerivedTaskKey(associationKey)) return currentTaskKeySet.has(associationKey);

        if ((associationsByTaskText[association.taskText] ?? 0) > (currentTasksByText[association.taskText] ?? 0)) {
          return false;
        }

        return currentTaskKeySet.has(associationKey) ||
          (!association.taskKey && currentTaskKeySet.has(association.taskText));
      })
    );
    if (Object.keys(nextNoteAssociations).length === Object.keys(noteAssociations).length) return state;

    const byNoteId = Object.keys(nextNoteAssociations).length === 0
      ? omitKey(workspaceState.byNoteId, noteId)
      : { ...workspaceState.byNoteId, [noteId]: nextNoteAssociations };

    return setWorkspaceState(state, workspaceId, { byNoteId });
  })
  .with(applyRemoveTaskAgentAssociationsForAgent, (state, { payload: [workspaceId, agentId] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    const byNoteId: Record<string, TaskAgentAssociationsByTaskKey> = {};
    let changed = false;

    for (const [noteId, noteAssociations] of Object.entries(workspaceState.byNoteId)) {
      const filtered = Object.fromEntries(
        Object.entries(noteAssociations).filter(([, association]) => association.agentId !== agentId)
      );
      if (Object.keys(filtered).length !== Object.keys(noteAssociations).length) changed = true;
      if (Object.keys(filtered).length > 0) byNoteId[noteId] = filtered;
    }

    return changed ? setWorkspaceState(state, workspaceId, { byNoteId }) : state;
  })
  .with(workspaceUnmounted, (state, { payload: [workspaceId] }) => clearWorkspaceState(state, workspaceId));
