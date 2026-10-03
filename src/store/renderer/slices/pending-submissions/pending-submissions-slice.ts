import type { QueuedMessage } from '$shared/types';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  getItems,
} from '@themislib/themis/utils/collections/collection-utils';
import { backendReconnected } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  principalContextChanged,
  hostMembershipChanged,
  principalIdentityChanged,
} from '../principal/principal-slice';
import {
  removeWorkspaceEntity,
  resetWorkspaceState,
  updateWorkspaceEntity,
  setWorkspaceEntity,
  replaceWorkspaceList,
  bulkUpdateWorkspaceEntities,
} from '../workspace/workspace-slice';
import {
  setLabsMultiplayerEnabled,
  toggleLabsMultiplayer,
} from '../user-preferences/user-preferences-slice';
import {
  createPendingEntry,
  evidenceSubmissionIds,
  PENDING_SUBMISSION_LIMIT,
  pruneSubmissionTombstones,
  retireSubmissions,
  sameSubmissionScope,
  submissionReadIsCurrent,
  supportsSubmissionCorrelation,
} from './pending-submissions-model';
import type {
  PendingSubmissionEntry,
  PendingSubmissionsState,
  SubmissionEvidence,
  SubmissionInput,
  SubmissionRead,
  SubmissionScope,
} from './pending-submissions-types';

const initialState: PendingSubmissionsState = { byAgentId: {} };
export const pendingScopeActivated = createAction<[scope: SubmissionScope, capability: unknown]>(
  'pendingSubmissions/scopeActivated',
);
export const pendingScopeReleased = createAction<[scope: SubmissionScope]>(
  'pendingSubmissions/scopeReleased',
);
export const pendingSubmissionAccepted = createAction<
  [scope: SubmissionScope, input: SubmissionInput]
>('pendingSubmissions/accepted');
export const pendingSubmissionSending = createAction<[scope: SubmissionScope, id: string]>(
  'pendingSubmissions/sending',
);
export const pendingSubmissionSettled = createAction<
  [
    scope: SubmissionScope,
    id: string,
    outcome: 'rejected' | 'uncertain' | 'accepted',
    now: number,
    queued?: QueuedMessage,
    queuedFallback?: boolean,
  ]
>('pendingSubmissions/settled');
/** Dispatch alongside authoritative publication; these rows never replace history or queue here. */
export const pendingEvidenceObserved = createAction<
  [
    scope: SubmissionScope,
    kind: 'queue' | 'processing' | 'history',
    rows: SubmissionEvidence[],
    now: number,
  ]
>('pendingSubmissions/evidenceObserved');
export const pendingLifecycleObserved = createAction<[scope: SubmissionScope, active: boolean]>(
  'pendingSubmissions/lifecycleObserved',
);
export const pendingReadStarted = createAction<[read: SubmissionRead]>(
  'pendingSubmissions/readStarted',
);
/** Call submissionReadIsCurrent before publishing the corresponding authoritative read too. */
export const pendingReadCompleted = createAction<
  [read: SubmissionRead, rows: SubmissionEvidence[], now: number]
>('pendingSubmissions/readCompleted');
export const pendingRetentionPruned = createAction<[scope: SubmissionScope, now: number]>(
  'pendingSubmissions/retentionPruned',
);

export const pendingSubmissionsReducer = createReducer<PendingSubmissionsState>(initialState);

function update(
  state: PendingSubmissionsState,
  scope: SubmissionScope,
  change: (entry: PendingSubmissionEntry) => PendingSubmissionEntry,
): PendingSubmissionsState {
  const entry = state.byAgentId[scope.agentId];
  if (!entry || !sameSubmissionScope(entry.scope, scope)) return state;
  const next = change(entry);
  return next === entry
    ? state
    : { ...state, byAgentId: { ...state.byAgentId, [scope.agentId]: next } };
}

function observe(
  entry: PendingSubmissionEntry,
  kind: 'queue' | 'processing' | 'history',
  rows: SubmissionEvidence[],
  now: number,
): PendingSubmissionEntry {
  if (!entry.supported) return entry;
  const ids = rows.flatMap((row) => evidenceSubmissionIds(row, entry.scope.principalId));
  const next = retireSubmissions(entry, ids, kind, now);
  let processing = kind === 'queue' && entry.attemptActive ? entry.processing : next.processing;
  if (kind === 'processing') {
    const known = new Set([
      ...getItems(entry.submissions).map((s) => s.id),
      ...getItems(entry.operations)
        .filter((op) => !op.observed)
        .map((op) => op.id),
      ...getItems(entry.tombstones)
        .filter((t) => t.reason === 'queue' || t.reason === 'processing')
        .map((t) => t.id),
    ]);
    const snapshots = rows.filter(
      (row): row is QueuedMessage =>
        typeof row.id === 'string' &&
        typeof row.content === 'string' &&
        typeof row.queuedAt === 'string' &&
        typeof row.position === 'number' &&
        evidenceSubmissionIds(row, entry.scope.principalId).some((id) => known.has(id)),
    );
    processing = createCollection('id', [
      ...getItems(entry.processing).filter((row) => !snapshots.some((s) => s.id === row.id)),
      ...snapshots,
    ]);
  }
  return {
    ...next,
    processing,
    seeds: createCollection(
      'id',
      kind === 'queue'
        ? []
        : getItems(next.seeds).filter(
            (seed) =>
              !evidenceSubmissionIds(seed, entry.scope.principalId).some((id) => ids.includes(id)),
          ),
    ),
  };
}

pendingSubmissionsReducer.with(pendingScopeActivated, (state, { payload: [scope, capability] }) => {
  const current = state.byAgentId[scope.agentId];
  if (
    current &&
    sameSubmissionScope(current.scope, scope) &&
    current.supported === supportsSubmissionCorrelation(capability)
  )
    return state;
  return {
    ...state,
    byAgentId: { ...state.byAgentId, [scope.agentId]: createPendingEntry(scope, capability) },
  };
});
pendingSubmissionsReducer.with(pendingScopeReleased, (state, { payload: [scope] }) => {
  if (
    !state.byAgentId[scope.agentId] ||
    !sameSubmissionScope(state.byAgentId[scope.agentId].scope, scope)
  )
    return state;
  const byAgentId = { ...state.byAgentId };
  delete byAgentId[scope.agentId];
  return { ...state, byAgentId };
});
pendingSubmissionsReducer.with(pendingSubmissionAccepted, (state, { payload: [scope, input] }) =>
  update(state, scope, (entry) => {
    const occupied = new Set([
      ...[
        ...getItems(entry.submissions),
        ...getItems(entry.operations),
        ...getItems(entry.processing),
      ].map((s) => s.id),
      ...getItems(entry.seeds).flatMap((seed) => evidenceSubmissionIds(seed, scope.principalId)),
    ]);
    if (
      !input.id ||
      occupied.has(input.id) ||
      getItem(entry.tombstones, input.id) ||
      occupied.size >= PENDING_SUBMISSION_LIMIT
    )
      return entry;
    return {
      ...pruneSubmissionTombstones(entry, input.createdAt),
      submissions: createCollection('id', [
        ...getItems(entry.submissions),
        { ...input, status: 'preparing' as const },
      ]),
      operations: createCollection('id', [
        ...getItems(entry.operations),
        { id: input.id, observationVersion: entry.observationVersion, observed: false },
      ]),
    };
  }),
);
pendingSubmissionsReducer.with(pendingSubmissionSending, (state, { payload: [scope, id] }) =>
  update(state, scope, (entry) => ({
    ...entry,
    submissions: createCollection(
      'id',
      getItems(entry.submissions).map((s) =>
        s.id === id ? { ...s, status: 'sending' as const } : s,
      ),
    ),
  })),
);
pendingSubmissionsReducer.with(
  pendingSubmissionSettled,
  (state, { payload: [scope, id, outcome, now, queued, queuedFallback] }) =>
    update(state, scope, (entry) => {
      const operation = getItem(entry.operations, id);
      // Original callback identity is retained separately from expiring tombstones.
      if (!operation) return entry;
      let next = {
        ...entry,
        operations: createCollection(
          'id',
          getItems(entry.operations).filter((op) => op.id !== id),
        ),
      };
      if (operation.observed) return next;
      if (outcome === 'rejected') return retireSubmissions(next, [id], 'rejected', now);
      next = {
        ...next,
        submissions: createCollection(
          'id',
          getItems(next.submissions).map((s) =>
            s.id === id
              ? {
                  ...s,
                  status: outcome,
                  destination: queued || queuedFallback ? ('queue' as const) : s.destination,
                }
              : s,
          ),
        ),
      };
      if (outcome !== 'accepted' || !queued || !entry.supported) return next;
      // A raw mutation reply may correlate its own request despite outer author:null.
      const aliases = queued.recoverySources
        ? evidenceSubmissionIds(queued, scope.principalId)
        : (queued.submissionIds ?? []);
      if (!aliases.includes(id)) return { ...next, refreshNeeded: true };
      if (operation.observationVersion !== entry.observationVersion)
        return { ...next, refreshNeeded: true };
      const existing = getItem(entry.seeds, queued.id);
      const oldIds = existing ? evidenceSubmissionIds(existing, scope.principalId) : [];
      if (existing && !oldIds.every((alias) => aliases.includes(alias))) {
        // Older/subset echoes cannot replace a newer aggregate; ambiguous sets need a read.
        return oldIds.includes(id)
          ? retireSubmissions(next, [id], 'queue', now)
          : { ...next, refreshNeeded: true };
      }
      next = retireSubmissions(next, aliases, 'queue', now);
      const author = queued.author ?? {
        principalId: scope.principalId,
        login: null,
        displayName: null,
        avatarUrl: null,
      };
      return {
        ...next,
        refreshNeeded: true,
        seeds: createCollection('id', [
          ...getItems(next.seeds).filter((s) => s.id !== queued.id),
          { ...queued, author },
        ]),
      };
    }),
);
pendingSubmissionsReducer.with(
  pendingEvidenceObserved,
  (state, { payload: [scope, kind, rows, now] }) =>
    update(state, scope, (entry) => ({
      ...observe(entry, kind, rows, now),
      generation: entry.generation + 1,
      observationVersion: entry.observationVersion + 1,
      queueFresh: false,
      historyFresh: false,
      refreshNeeded: true,
      attemptActive: kind === 'processing' || entry.attemptActive,
    })),
);
pendingSubmissionsReducer.with(pendingLifecycleObserved, (state, { payload: [scope, active] }) =>
  update(state, scope, (entry) => ({
    ...entry,
    generation: entry.generation + 1,
    observationVersion: entry.observationVersion + 1,
    queueFresh: false,
    historyFresh: false,
    refreshNeeded: true,
    attemptActive: active,
  })),
);
pendingSubmissionsReducer.with(pendingReadStarted, (state, { payload: [read] }) =>
  update(state, read.scope, (entry) =>
    entry.generation !== read.generation
      ? entry
      : { ...entry, [read.kind === 'queue' ? 'queueReadId' : 'historyReadId']: read.id },
  ),
);
pendingSubmissionsReducer.with(pendingReadCompleted, (state, { payload: [read, rows, now] }) =>
  update(state, read.scope, (entry) => {
    if (!submissionReadIsCurrent(entry, read)) return { ...entry, refreshNeeded: true };
    const next = observe(entry, read.kind, rows, now);
    const queueFresh = read.kind === 'queue' || next.queueFresh;
    const historyFresh = read.kind === 'history' || next.historyFresh;
    return {
      ...next,
      queueFresh,
      historyFresh,
      observationVersion: entry.observationVersion + 1,
      refreshNeeded: !(queueFresh && historyFresh),
      [read.kind === 'queue' ? 'queueReadId' : 'historyReadId']: null,
    };
  }),
);
pendingSubmissionsReducer.with(pendingRetentionPruned, (state, { payload: [scope, now] }) =>
  update(state, scope, (entry) => pruneSubmissionTombstones(entry, now)),
);
// Authority changes clear recoverable text, not just its projection. A new participation
// lifetime must explicitly activate again; old callbacks cannot reopen it.
pendingSubmissionsReducer.with(backendReconnected, () => initialState);
pendingSubmissionsReducer.with(principalContextChanged, () => initialState);
pendingSubmissionsReducer.with(hostMembershipChanged, () => initialState);
pendingSubmissionsReducer.with(principalIdentityChanged, () => initialState);
pendingSubmissionsReducer.with(removeWorkspaceEntity, (state, { payload: [workspaceId] }) => ({
  ...state,
  byAgentId: Object.fromEntries(
    Object.entries(state.byAgentId).filter(([, entry]) => entry.scope.workspaceId !== workspaceId),
  ),
}));

function forgetWorkspace(
  state: PendingSubmissionsState,
  workspaceId: string,
): PendingSubmissionsState {
  return {
    ...state,
    byAgentId: Object.fromEntries(
      Object.entries(state.byAgentId).filter(
        ([, entry]) => entry.scope.workspaceId !== workspaceId,
      ),
    ),
  };
}
function denied(changes: { myRole?: string | null; canManage?: boolean }): boolean {
  return (
    'myRole' in changes &&
    changes.myRole !== 'owner' &&
    changes.myRole !== 'collaborator' &&
    changes.canManage !== true
  );
}
pendingSubmissionsReducer.with(resetWorkspaceState, () => initialState);
pendingSubmissionsReducer.with(setLabsMultiplayerEnabled, () => initialState);
pendingSubmissionsReducer.with(toggleLabsMultiplayer, () => initialState);
pendingSubmissionsReducer.with(updateWorkspaceEntity, (state, { payload: [id, changes] }) =>
  denied(changes) ? forgetWorkspace(state, id) : state,
);
pendingSubmissionsReducer.with(bulkUpdateWorkspaceEntities, (state, { payload: [actions] }) =>
  actions.reduce(
    (current, action) =>
      denied(action.payload[1]) ? forgetWorkspace(current, action.payload[0]) : current,
    state,
  ),
);
pendingSubmissionsReducer.with(setWorkspaceEntity, (state, { payload: [workspace] }) =>
  denied(workspace) ? forgetWorkspace(state, workspace.id) : state,
);
pendingSubmissionsReducer.with(
  replaceWorkspaceList,
  (state, { payload: [workspaces, projection] }) => {
    let next = state;
    for (const entry of Object.values(state.byAgentId)) {
      const row = workspaces.find((workspace) => workspace.id === entry.scope.workspaceId);
      if ((row && denied(row)) || (!row && projection?.complete))
        next = forgetWorkspace(next, entry.scope.workspaceId);
    }
    return next;
  },
);
