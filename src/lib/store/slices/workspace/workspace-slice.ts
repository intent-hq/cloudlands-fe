import type {
  CreateWorkspaceRequest,
  TaskStatus,
  Workspace,
} from "$shared/types";
import { WorkspaceStatusEnum } from "$shared/types";
import {
  EXCLUDED_STATUSES,
  IN_PROGRESS_STATUSES,
} from "$shared/utils/task-stats";
import {
  openTerminalOverlay,
  toggleTerminalOverlay,
} from "../terminals/terminals-slice";
import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import { createReducer } from "svelte-redux-toolkit/utils/store/create-reducer";
import {
  addItem,
  createCollection,
  getItem,
  type Collection,
  removeItem,
  updateItem,
  upsertItem,
} from "svelte-redux-toolkit/utils/collections/collection-utils";

export type WorkspaceUpdatedEvent = {
  workspaceId: string;
  changes: Partial<Workspace>;
};

export type WorkspaceBackgroundEnrichmentEvent = {
  workspaceId: string;
  updates?: Partial<
    Pick<
      Workspace,
      | "repositoryOwner"
      | "repositoryName"
      | "activePullRequest"
      | "prStatus"
      | "prNumber"
      | "prUrl"
      | "pullRequests"
      | "diffSummary"
      | "agentSummary"
      | "taskStats"
      | "gitSummary"
    >
  >;
};

export type OptimisticTaskStatusPayload = {
  workspaceId?: string;
  previousStatus?: TaskStatus;
  newStatus?: TaskStatus;
  data?: {
    previousStatus?: TaskStatus;
    newStatus?: TaskStatus;
  };
};

export interface WorkspaceRecencyState {
  lastViewedAt: Record<string, number>;
}

export const defaultWorkspaceRecencyState: WorkspaceRecencyState = {
  lastViewedAt: {},
};

// ---------------------------------------------------------------------------
// Root workspace state
// ---------------------------------------------------------------------------

export type WorkspaceState = {
  activeWorkspaceId: string | null;
  workspaces: Collection<Workspace, "id">;
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
  isCreating: boolean;
  pendingDeletions: Record<string, boolean>;
  pendingArchives: Record<string, boolean>;
  pendingCreations: Record<string, Workspace>;
  recency: WorkspaceRecencyState;
};

export const initialState: WorkspaceState = {
  activeWorkspaceId: null,
  workspaces: createCollection("id"),
  loading: false,
  error: null,
  hasLoaded: false,
  isCreating: false,
  pendingDeletions: {},
  pendingArchives: {},
  pendingCreations: {},
  recency: defaultWorkspaceRecencyState,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const setActiveWorkspaceId = createAction<[wsId: string]>("workspace/setActiveWorkspaceId");

export const clearActiveWorkspace = createAction("workspace/clearActiveWorkspace");

export const setWorkspaceLoading = createAction<[loading: boolean]>("workspace/setWorkspaceLoading");

export const setWorkspaceError = createAction<[error: string | null]>("workspace/setWorkspaceError");

export const setWorkspaceHasLoaded = createAction<[hasLoaded: boolean]>(
  "workspace/setWorkspaceHasLoaded"
);

export const setWorkspaceCreating = createAction<[isCreating: boolean]>(
  "workspace/setWorkspaceCreating"
);

export const replaceWorkspaceList = createAction<[workspaces: Workspace[]]>(
  "workspace/replaceWorkspaceList"
);

export const markWorkspacePendingDeletion = createAction<[wsId: string]>(
  "workspace/markWorkspacePendingDeletion"
);

export const clearWorkspacePendingDeletion = createAction<[wsId: string]>(
  "workspace/clearWorkspacePendingDeletion"
);

export const setPendingCreation = createAction<[workspace: Workspace]>(
  "workspace/setPendingCreation"
);

export const clearPendingCreation = createAction<[wsId: string]>(
  "workspace/clearPendingCreation"
);

export const applyOptimisticTaskStatusUpdate = createAction<
  [payload: OptimisticTaskStatusPayload]
>("workspace/applyOptimisticTaskStatusUpdate");

export const resetWorkspaceState = createAction("workspace/resetWorkspaceState");

/** Store a full workspace entity by ID. */
export const setWorkspaceEntity = createAction<[workspace: Workspace]>(
  "workspace/setWorkspaceEntity"
);

/** Merge partial changes into an existing workspace entity. No-op if workspace not found. */
export const updateWorkspaceEntity = createAction<
  [wsId: string, changes: Partial<Workspace>]
>("workspace/updateWorkspaceEntity");

/** Remove a workspace entity by ID. */
export const removeWorkspaceEntity = createAction<[wsId: string]>(
  "workspace/removeWorkspaceEntity"
);

/** Record the last-viewed timestamp for a workspace. */
export const recordWorkspaceView = createAction<[wsId: string, viewedAt: number]>(
  "workspace/recordWorkspaceView"
);

/** Hydrate workspace recency data from persistence. */
export const loadRecencyData = createAction<[data: WorkspaceRecencyState]>(
  "workspace/loadRecencyData"
);

/** Remove recency entries for workspaces that no longer exist. */
export const cleanupRecency = createAction<[workspaceIds: string[]]>("workspace/cleanupRecency");

// ---------------------------------------------------------------------------
// Saga trigger actions
// ---------------------------------------------------------------------------

export const loadWorkspacesRequested = createAction<[retryCount?: number]>(
  "workspace/loadWorkspacesRequested"
);

export const createWorkspaceRequested = createAction<[request: CreateWorkspaceRequest]>(
  "workspace/createWorkspaceRequested"
);

export const openWorkspaceRequested = createAction<[wsId: string]>(
  "workspace/openWorkspaceRequested"
);

export const updateWorkspaceRequested = createAction<
  [wsId: string, changes: Partial<Workspace>]
>("workspace/updateWorkspaceRequested");

export const duplicateWorkspaceRequested = createAction<[wsId: string, newTitle?: string]>(
  "workspace/duplicateWorkspaceRequested"
);

export const deleteWorkspaceRequested = createAction<[wsId: string]>(
  "workspace/deleteWorkspaceRequested"
);

// ---------------------------------------------------------------------------
// Reducer helpers
// ---------------------------------------------------------------------------

function normalizeWorkspacePaths(workspace: Workspace): Workspace {
  return {
    ...workspace,
    path: workspace.path?.replaceAll("\\", "/"),
    repositoryPath: workspace.repositoryPath?.replaceAll("\\", "/"),
    worktreePath: workspace.worktreePath?.replaceAll("\\", "/"),
  };
}

function mergeWorkspaceEnrichment(existing: Workspace | undefined, incoming: Workspace): Workspace {
  const normalized = normalizeWorkspacePaths(incoming);
  if (!existing) {
    return normalized;
  }

  return {
    ...normalized,
    taskStats: normalized.taskStats ?? existing.taskStats,
    diffSummary: normalized.diffSummary ?? existing.diffSummary,
    agentSummary: normalized.agentSummary ?? existing.agentSummary,
    gitSummary: normalized.gitSummary ?? existing.gitSummary,
    activePullRequest: normalized.activePullRequest ?? existing.activePullRequest,
  };
}

function mergeLocalWorkspaceUpdate(existing: Workspace, changes: Partial<Workspace>): Workspace {
  return normalizeWorkspacePaths({
    ...existing,
    ...changes,
    id: existing.id,
    updatedAt: existing.updatedAt,
    createdAt: existing.createdAt,
  });
}

function clearBooleanMapEntry(
  map: Record<string, boolean>,
  key: string,
): Record<string, boolean> {
  if (!(key in map)) {
    return map;
  }


  const { [key]: _, ...rest } = map;
  return rest;
}

function clearPendingCreationEntry(
  map: Record<string, Workspace>,
  key: string,
): Record<string, Workspace> {
  if (!(key in map)) {
    return map;
  }


  const { [key]: _, ...rest } = map;
  return rest;
}

function buildVisibleWorkspaceState(
  state: WorkspaceState,
  workspaces: Workspace[],
): Pick<WorkspaceState, "workspaces" | "pendingCreations"> {
  const nextPendingCreations = { ...state.pendingCreations };
  const visibleWorkspaces: Workspace[] = [];

  for (const workspace of workspaces) {
    if (!workspace?.id || workspace.id === "undefined") {
      continue;
    }

    if (state.pendingDeletions[workspace.id]) {
      continue;
    }

    let merged = mergeWorkspaceEnrichment(getItem(state.workspaces, workspace.id), workspace);
    if (state.pendingArchives[workspace.id]) {
      merged = {
        ...merged,
        status: WorkspaceStatusEnum.Archived,
        archived: true,
        archivedAt: merged.archivedAt ?? getItem(state.workspaces, workspace.id)?.archivedAt,
      };
    }

    visibleWorkspaces.push(merged);

    if (workspace.id in nextPendingCreations) {
      delete nextPendingCreations[workspace.id];
    }
  }

  for (const [workspaceId, workspace] of Object.entries(nextPendingCreations)) {
    if (state.pendingDeletions[workspaceId]) {
      continue;
    }

    visibleWorkspaces.push(
      mergeWorkspaceEnrichment(getWorkspaceById(state.workspaces, workspaceId), workspace),
    );
  }

  return {
    workspaces: createCollection("id", visibleWorkspaces),
    pendingCreations: nextPendingCreations,
  };
}

function getWorkspaceById(
  collection: WorkspaceState["workspaces"],
  wsId: string | null | undefined,
): Workspace | undefined {
  return wsId ? getItem(collection, wsId as Workspace["id"]) : undefined;
}

function updateActiveWorkspaceId(state: WorkspaceState, wsId: string): WorkspaceState {
  if (state.activeWorkspaceId === wsId) return state;
  return { ...state, activeWorkspaceId: wsId };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const workspaceReducer = createReducer<WorkspaceState>(initialState)
  .with(setActiveWorkspaceId, (state, { payload: [wsId] }) => {
    return updateActiveWorkspaceId(state, wsId);
  })
  .with(clearActiveWorkspace, (state) => {
    if (state.activeWorkspaceId === null) return state;
    return { ...state, activeWorkspaceId: null };
  })
  .with(openTerminalOverlay, (state, { payload: [wsId] }) => {
    return updateActiveWorkspaceId(state, wsId);
  })
  .with(toggleTerminalOverlay, (state, { payload: [wsId] }) => {
    return updateActiveWorkspaceId(state, wsId);
  })
  .with(setWorkspaceLoading, (state, { payload: [loading] }) => {
    if (state.loading === loading) return state;
    return { ...state, loading };
  })
  .with(setWorkspaceError, (state, { payload: [error] }) => {
    if (state.error === error) return state;
    return { ...state, error };
  })
  .with(setWorkspaceHasLoaded, (state, { payload: [hasLoaded] }) => {
    if (state.hasLoaded === hasLoaded) return state;
    return { ...state, hasLoaded };
  })
  .with(setWorkspaceCreating, (state, { payload: [isCreating] }) => {
    if (state.isCreating === isCreating) return state;
    return { ...state, isCreating };
  })
  .with(replaceWorkspaceList, (state, { payload: [workspaces] }) => {
    const nextVisibleState = buildVisibleWorkspaceState(state, workspaces);
    return {
      ...state,
      workspaces: nextVisibleState.workspaces,
      pendingCreations: nextVisibleState.pendingCreations,
    };
  })
  .with(markWorkspacePendingDeletion, (state, { payload: [wsId] }) => {
    if (state.pendingDeletions[wsId]) return state;
    return {
      ...state,
      pendingDeletions: { ...state.pendingDeletions, [wsId]: true },
    };
  })
  .with(clearWorkspacePendingDeletion, (state, { payload: [wsId] }) => {
    const next = clearBooleanMapEntry(state.pendingDeletions, wsId);
    if (next === state.pendingDeletions) return state;
    return { ...state, pendingDeletions: next };
  })
  .with(setPendingCreation, (state, { payload: [workspace] }) => {
    const normalized = mergeWorkspaceEnrichment(state.pendingCreations[workspace.id], workspace);
    return {
      ...state,
      pendingCreations: {
        ...state.pendingCreations,
        [workspace.id]: normalized,
      },
    };
  })
  .with(clearPendingCreation, (state, { payload: [wsId] }) => {
    const next = clearPendingCreationEntry(state.pendingCreations, wsId);
    if (next === state.pendingCreations) return state;
    return { ...state, pendingCreations: next };
  })
  .with(setWorkspaceEntity, (state, { payload: [workspace] }) => {
    const existing = getWorkspaceById(state.workspaces, workspace.id);
    const merged = mergeWorkspaceEnrichment(existing, workspace);
    return {
      ...state,
      workspaces: existing ? upsertItem(state.workspaces, merged) : addItem(state.workspaces, merged),
    };
  })
  .with(updateWorkspaceEntity, (state, { payload: [wsId, changes] }) => {
    const existing = getWorkspaceById(state.workspaces, wsId);
    if (!existing) return state;

    let updated = mergeLocalWorkspaceUpdate(existing, changes);
    if (state.pendingArchives[wsId] && changes.status === undefined) {
      updated = {
        ...updated,
        status: WorkspaceStatusEnum.Archived,
        archived: true,
        archivedAt: updated.archivedAt ?? existing.archivedAt,
      };
    }

    return {
      ...state,
      workspaces: updateItem(state.workspaces, updated),
    };
  })
  .with(removeWorkspaceEntity, (state, { payload: [wsId] }) => {
    if (!getWorkspaceById(state.workspaces, wsId)) return state;
    return {
      ...state,
      activeWorkspaceId: state.activeWorkspaceId === wsId ? null : state.activeWorkspaceId,
      workspaces: removeItem(state.workspaces, wsId as Workspace["id"]),
    };
  })
  .with(applyOptimisticTaskStatusUpdate, (state, { payload: [payload] }) => {
    const workspaceId = payload.workspaceId;
    const previousStatus = payload.previousStatus || payload.data?.previousStatus;
    const newStatus = payload.newStatus || payload.data?.newStatus;

    if (!workspaceId || !previousStatus || !newStatus) {
      return state;
    }

    const workspace = getWorkspaceById(state.workspaces, workspaceId);
    const taskStats = workspace?.taskStats;
    if (!workspace || !taskStats) {
      return state;
    }

    const wasExcluded = EXCLUDED_STATUSES.has(previousStatus);
    const isExcluded = EXCLUDED_STATUSES.has(newStatus);
    const wasInProgress = IN_PROGRESS_STATUSES.has(previousStatus);
    const isInProgress = IN_PROGRESS_STATUSES.has(newStatus);
    const wasCompleted = previousStatus === "complete";
    const isCompleted = newStatus === "complete";

    let total = taskStats.total;
    let completed = taskStats.completed;
    let inProgress = taskStats.inProgress;

    if (!wasExcluded && isExcluded) total = Math.max(0, total - 1);
    if (wasExcluded && !isExcluded) total += 1;
    if (wasCompleted && !isCompleted) completed = Math.max(0, completed - 1);
    if (!wasCompleted && isCompleted) completed += 1;
    if (wasInProgress && !isInProgress) inProgress = Math.max(0, inProgress - 1);
    if (!wasInProgress && isInProgress) inProgress += 1;

    return {
      ...state,
      workspaces: updateItem(state.workspaces, {
        ...workspace,
        taskStats: {
          ...taskStats,
          total,
          completed,
          inProgress,
        },
      }),
    };
  })
  .with(recordWorkspaceView, (state, { payload: [wsId, viewedAt] }) => {
    if (state.recency.lastViewedAt[wsId] === viewedAt) return state;
    return {
      ...state,
      recency: {
        lastViewedAt: { ...state.recency.lastViewedAt, [wsId]: viewedAt },
      },
    };
  })
  .with(loadRecencyData, (state, { payload: [recency] }) => {
    return {
      ...state,
      recency,
    };
  })
  .with(cleanupRecency, (state, { payload: [workspaceIds] }) => {
    const existingWorkspaceIds = new Set(workspaceIds);
    let removed = false;
    const nextLastViewedAt: Record<string, number> = {};

    for (const [wsId, viewedAt] of Object.entries(state.recency.lastViewedAt)) {
      if (existingWorkspaceIds.has(wsId)) {
        nextLastViewedAt[wsId] = viewedAt;
      } else {
        removed = true;
      }
    }

    if (!removed) return state;

    return {
      ...state,
      recency: {
        lastViewedAt: nextLastViewedAt,
      },
    };
  })
  .with(resetWorkspaceState, (state) => ({
    ...state,
    activeWorkspaceId: null,
    workspaces: createCollection("id"),
    loading: false,
    error: null,
    hasLoaded: false,
    isCreating: false,
    pendingDeletions: {},
    pendingArchives: {},
    pendingCreations: {},
    recency: defaultWorkspaceRecencyState,
  }));
