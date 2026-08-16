import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { shallowEqual } from 'fast-equals';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  addItem,
  createCollection,
  getItem,
  type Collection,
  removeItem,
  updateItem,
  upsertItem,
} from '@augmentcode/themis/utils/collections/collection-utils';

export type WorkspaceUpdatedEvent = {
  workspaceId: string;
  changes: Partial<Workspace>;
};

export type WorkspaceCreatedEvent = {
  workspaceId: string;
  workspace?: Workspace;
};

export type WorkspaceDeletedEvent = {
  workspaceId: string;
};

export type WorkspaceArchivedEvent = {
  workspaceId: string;
};

export type WorkspaceBackgroundEnrichmentEvent = {
  workspaceId: string;
  updates?: Partial<
    Pick<
      Workspace,
      | 'repositoryOwner'
      | 'repositoryName'
      | 'activePullRequest'
      | 'prStatus'
      | 'prNumber'
      | 'prUrl'
      | 'pullRequests'
      | 'agentSummary'
    >
  >;
};

export interface WorkspaceRecencyState {
  lastViewedAt: Record<string, number>;
}

export type PendingWorkspaceTitleMutation = {
  token: number;
  optimisticTitle: string;
  previousTitle: string;
};

export const defaultWorkspaceRecencyState: WorkspaceRecencyState = {
  lastViewedAt: {},
};

// ---------------------------------------------------------------------------
// Root workspace state
// ---------------------------------------------------------------------------

export type WorkspaceState = {
  workspaces: Collection<Workspace, 'id'>;
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
  isCreating: boolean;
  pendingDeletions: Record<string, boolean>;
  pendingArchives: Record<string, boolean>;
  pendingCreations: Record<string, Workspace>;
  pendingTitleMutations: Record<string, PendingWorkspaceTitleMutation>;
  recency: WorkspaceRecencyState;
};

export const initialState: WorkspaceState = {
  workspaces: createCollection('id'),
  loading: false,
  error: null,
  hasLoaded: false,
  isCreating: false,
  pendingDeletions: {},
  pendingArchives: {},
  pendingCreations: {},
  pendingTitleMutations: {},
  recency: defaultWorkspaceRecencyState,
};

export const setWorkspaceHasLoaded = createAction<[hasLoaded: boolean]>(
  'workspace/setWorkspaceHasLoaded',
);

export const replaceWorkspaceList = createAction<[workspaces: Workspace[]]>(
  'workspace/replaceWorkspaceList',
);

export const markWorkspacePendingDeletion = createAction<[wsId: string]>(
  'workspace/markWorkspacePendingDeletion',
);

export const clearWorkspacePendingDeletion = createAction<[wsId: string]>(
  'workspace/clearWorkspacePendingDeletion',
);

export const resetWorkspaceState = createAction('workspace/resetWorkspaceState');

/** Store a full workspace entity by ID. */
export const setWorkspaceEntity = createAction<[workspace: Workspace]>(
  'workspace/setWorkspaceEntity',
);

/** Merge partial changes into an existing workspace entity. No-op if workspace not found. */
export const updateWorkspaceEntity = createAction<[wsId: string, changes: Partial<Workspace>]>(
  'workspace/updateWorkspaceEntity',
);

/** Apply queued workspace entity update actions in order. */
export const bulkUpdateWorkspaceEntities = createAction<
  [actions: ReturnType<typeof updateWorkspaceEntity>[]]
>('workspace/bulkUpdateWorkspaceEntities');

export const beginWorkspaceTitleMutation = createAction<
  [wsId: string, token: number, optimisticTitle: string, previousTitle: string]
>('workspace/beginWorkspaceTitleMutation');

export const completeWorkspaceTitleMutation = createAction<
  [wsId: string, token: number, workspace: Workspace]
>('workspace/completeWorkspaceTitleMutation');

export const failWorkspaceTitleMutation = createAction<[wsId: string, token: number]>(
  'workspace/failWorkspaceTitleMutation',
);

/** Remove a workspace entity by ID. */
export const removeWorkspaceEntity = createAction<[wsId: string]>(
  'workspace/removeWorkspaceEntity',
);

/** Record the last-viewed timestamp for a workspace. */
export const recordWorkspaceView = createAction<[wsId: string, viewedAt: number]>(
  'workspace/recordWorkspaceView',
);

/** Hydrate workspace recency data from persistence. */
export const loadRecencyData = createAction<[data: WorkspaceRecencyState]>(
  'workspace/loadRecencyData',
);

// ---------------------------------------------------------------------------
// Saga trigger actions
// ---------------------------------------------------------------------------

export const loadWorkspacesRequested = createAction<[retryCount?: number]>(
  'workspace/loadWorkspacesRequested',
);

export const openWorkspaceRequested = createAction<[wsId: string]>(
  'workspace/openWorkspaceRequested',
);

// ---------------------------------------------------------------------------
// Reducer helpers
// ---------------------------------------------------------------------------

function normalizeWorkspacePaths(workspace: Workspace): Workspace {
  return {
    ...workspace,
    path: workspace.path?.replaceAll('\\', '/'),
    repositoryPath: workspace.repositoryPath?.replaceAll('\\', '/'),
    worktreePath: workspace.worktreePath?.replaceAll('\\', '/'),
  };
}

function mergeWorkspaceEnrichment(existing: Workspace | undefined, incoming: Workspace): Workspace {
  const normalized = normalizeWorkspacePaths(incoming);
  if (!existing) {
    return normalized;
  }

  const hasIncomingPullRequests =
    normalized.pullRequests !== undefined && normalized.pullRequests.length > 0;

  return {
    ...normalized,
    agentSummary: normalized.agentSummary ?? existing.agentSummary,
    activePullRequest: normalized.activePullRequest ?? existing.activePullRequest,
    pullRequests: hasIncomingPullRequests ? normalized.pullRequests : existing.pullRequests,
    prNumber: normalized.prNumber ?? existing.prNumber,
    prStatus: normalized.prStatus ?? existing.prStatus,
    prUrl: normalized.prUrl ?? existing.prUrl,
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

function applyPendingWorkspaceTitle(state: WorkspaceState, workspace: Workspace): Workspace {
  const pending = state.pendingTitleMutations[workspace.id];
  if (!pending || workspace.title === pending.optimisticTitle) return workspace;
  return { ...workspace, title: pending.optimisticTitle };
}

function clearPendingTitleMutation(
  map: Record<string, PendingWorkspaceTitleMutation>,
  workspaceId: string,
): Record<string, PendingWorkspaceTitleMutation> {
  if (!(workspaceId in map)) return map;
  const { [workspaceId]: _, ...rest } = map;
  return rest;
}

function clearBooleanMapEntry(map: Record<string, boolean>, key: string): Record<string, boolean> {
  if (!(key in map)) {
    return map;
  }

  const { [key]: _, ...rest } = map;
  return rest;
}

function buildVisibleWorkspaceState(
  state: WorkspaceState,
  workspaces: Workspace[],
): Pick<WorkspaceState, 'workspaces' | 'pendingCreations'> {
  const nextPendingCreations = { ...state.pendingCreations };
  const visibleWorkspaces: Workspace[] = [];

  for (const workspace of workspaces) {
    if (!workspace?.id || workspace.id === 'undefined') {
      continue;
    }

    if (state.pendingDeletions[workspace.id]) {
      continue;
    }

    // Rows carrying the daemon's delete-grace-window deadline (PROTOCOL §5.1
    // `pendingDeleteAt`, v6.7+) stay hidden: the daemon still serves them while
    // the window runs, but the FE soft-hid them at delete-request time.
    if (workspace.pendingDeleteAt) {
      continue;
    }

    let merged = applyPendingWorkspaceTitle(
      state,
      mergeWorkspaceEnrichment(getItem(state.workspaces, workspace.id), workspace),
    );
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
    workspaces: createCollection('id', visibleWorkspaces),
    pendingCreations: nextPendingCreations,
  };
}

function getWorkspaceById(
  collection: WorkspaceState['workspaces'],
  wsId: string | null | undefined,
): Workspace | undefined {
  return wsId ? getItem(collection, wsId as Workspace['id']) : undefined;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const workspaceReducer = createReducer<WorkspaceState>(initialState);
workspaceReducer.with(setWorkspaceHasLoaded, (state, { payload: [hasLoaded] }) => {
  if (state.hasLoaded === hasLoaded) return state;
  return { ...state, hasLoaded };
});
workspaceReducer.with(replaceWorkspaceList, (state, { payload: [workspaces] }) => {
  const nextVisibleState = buildVisibleWorkspaceState(state, workspaces);
  return {
    ...state,
    workspaces: nextVisibleState.workspaces,
    pendingCreations: nextVisibleState.pendingCreations,
  };
});
workspaceReducer.with(markWorkspacePendingDeletion, (state, { payload: [wsId] }) => {
  if (state.pendingDeletions[wsId]) return state;
  return {
    ...state,
    pendingDeletions: { ...state.pendingDeletions, [wsId]: true },
  };
});
workspaceReducer.with(clearWorkspacePendingDeletion, (state, { payload: [wsId] }) => {
  const next = clearBooleanMapEntry(state.pendingDeletions, wsId);
  if (next === state.pendingDeletions) return state;
  return { ...state, pendingDeletions: next };
});
workspaceReducer.with(setWorkspaceEntity, (state, { payload: [workspace] }) => {
  if (state.pendingDeletions[workspace.id]) return state;
  // Hide rows carrying the daemon delete-grace-window deadline (see
  // buildVisibleWorkspaceState); drop the entity if it was still visible.
  if (workspace.pendingDeleteAt) {
    const visible = getWorkspaceById(state.workspaces, workspace.id);
    if (!visible) return state;
    return { ...state, workspaces: removeItem(state.workspaces, workspace.id) };
  }
  const existing = getWorkspaceById(state.workspaces, workspace.id);
  const merged = applyPendingWorkspaceTitle(state, mergeWorkspaceEnrichment(existing, workspace));
  return {
    ...state,
    workspaces: existing ? upsertItem(state.workspaces, merged) : addItem(state.workspaces, merged),
  };
});
workspaceReducer.with(bulkUpdateWorkspaceEntities, (state, { payload: [actions] }) => {
  let workspaces = state.workspaces;

  for (const action of actions) {
    const [wsId, changes] = action.payload;
    if (state.pendingDeletions[wsId]) continue;
    const existing = getWorkspaceById(workspaces, wsId);
    if (!existing) continue;

    let updated = applyPendingWorkspaceTitle(state, mergeLocalWorkspaceUpdate(existing, changes));
    if (state.pendingArchives[wsId] && changes.status === undefined) {
      updated = {
        ...updated,
        status: WorkspaceStatusEnum.Archived,
        archived: true,
        archivedAt: updated.archivedAt ?? existing.archivedAt,
      };
    }

    if (shallowEqual(existing, updated)) continue;

    workspaces = updateItem(workspaces, updated);
  }

  if (workspaces === state.workspaces) return state;

  return {
    ...state,
    workspaces,
  };
});
workspaceReducer.with(
  beginWorkspaceTitleMutation,
  (state, { payload: [wsId, token, optimisticTitle, previousTitle] }) => {
    if (state.pendingDeletions[wsId]) return state;
    const existing = getWorkspaceById(state.workspaces, wsId);
    if (!existing) return state;
    const current = state.pendingTitleMutations[wsId];
    return {
      ...state,
      workspaces: updateItem(state.workspaces, { ...existing, title: optimisticTitle }),
      pendingTitleMutations: {
        ...state.pendingTitleMutations,
        [wsId]: {
          token,
          optimisticTitle,
          previousTitle: current?.optimisticTitle ?? previousTitle,
        },
      },
    };
  },
);
workspaceReducer.with(
  completeWorkspaceTitleMutation,
  (state, { payload: [wsId, token, workspace] }) => {
    if (state.pendingTitleMutations[wsId]?.token !== token) return state;
    const pendingTitleMutations = clearPendingTitleMutation(state.pendingTitleMutations, wsId);
    if (state.pendingDeletions[wsId]) return { ...state, pendingTitleMutations };
    const existing = getWorkspaceById(state.workspaces, wsId);
    const merged = mergeWorkspaceEnrichment(existing, workspace);
    return {
      ...state,
      workspaces: existing
        ? upsertItem(state.workspaces, merged)
        : addItem(state.workspaces, merged),
      pendingTitleMutations,
    };
  },
);
workspaceReducer.with(failWorkspaceTitleMutation, (state, { payload: [wsId, token] }) => {
  const pending = state.pendingTitleMutations[wsId];
  if (pending?.token !== token) return state;
  const existing = getWorkspaceById(state.workspaces, wsId);
  const workspaces =
    existing?.title === pending.optimisticTitle
      ? updateItem(state.workspaces, { ...existing, title: pending.previousTitle })
      : state.workspaces;
  return {
    ...state,
    workspaces,
    pendingTitleMutations: clearPendingTitleMutation(state.pendingTitleMutations, wsId),
  };
});
workspaceReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) => {
  const existsInCollection = !!getWorkspaceById(state.workspaces, wsId);
  if (!existsInCollection) return state;
  return {
    ...state,
    workspaces: removeItem(state.workspaces, wsId as Workspace['id']),
    pendingTitleMutations: clearPendingTitleMutation(state.pendingTitleMutations, wsId),
  };
});
workspaceReducer.with(workspaceDeleted, (state, { payload: [wsId] }) => {
  const existsInCollection = !!getWorkspaceById(state.workspaces, wsId);
  const hasPendingState =
    state.pendingArchives[wsId] ||
    state.pendingCreations[wsId] ||
    state.pendingTitleMutations[wsId] ||
    state.recency.lastViewedAt[wsId] !== undefined;

  // No-op if workspace has no trace in state. The pendingDeletions tombstone
  // is deliberately NOT cleared here: a stale workspace.get/workspace.list
  // response can land after this event, so only the saga grace timer (or an
  // explicit undo, which never reaches commit) lifts the tombstone.
  if (!existsInCollection && !hasPendingState) return state;

  const { [wsId]: _removedArchive, ...nextPendingArchives } = state.pendingArchives;
  const { [wsId]: _removedCreation, ...nextPendingCreations } = state.pendingCreations;
  const { [wsId]: _removedTitleMutation, ...nextPendingTitleMutations } =
    state.pendingTitleMutations;
  const { [wsId]: _removedRecency, ...nextLastViewedAt } = state.recency.lastViewedAt;
  return {
    ...state,
    workspaces: existsInCollection
      ? removeItem(state.workspaces, wsId as Workspace['id'])
      : state.workspaces,
    pendingArchives: nextPendingArchives,
    pendingCreations: nextPendingCreations,
    pendingTitleMutations: nextPendingTitleMutations,
    recency: {
      lastViewedAt: nextLastViewedAt,
    },
  };
});
workspaceReducer.with(recordWorkspaceView, (state, { payload: [wsId, viewedAt] }) => {
  if (state.recency.lastViewedAt[wsId] === viewedAt) return state;
  return {
    ...state,
    recency: {
      lastViewedAt: { ...state.recency.lastViewedAt, [wsId]: viewedAt },
    },
  };
});
workspaceReducer.with(loadRecencyData, (state, { payload: [recency] }) => {
  return {
    ...state,
    recency,
  };
});
workspaceReducer.with(resetWorkspaceState, (state) => ({
  ...state,
  workspaces: createCollection('id'),
  loading: false,
  error: null,
  hasLoaded: false,
  isCreating: false,
  pendingDeletions: {},
  pendingArchives: {},
  pendingCreations: {},
  pendingTitleMutations: {},
  recency: defaultWorkspaceRecencyState,
}));
