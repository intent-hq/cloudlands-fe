/**
 * git-roots slice — per-workspace live git-root list (multi git root
 * tracking, intent-hq/monorepo#2053).
 *
 * The companion `gitRootsSaga` owns the active workspace's `gitRoot:*`
 * events.subscribe + `gitRoot.list` seed round-trip and writes every fold
 * result back via `gitRootsUpdated`, so components render purely from
 * selectors and never touch the live backend transport.
 */
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import {
  workspaceUnmounted,
  workspaceDeleted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import type { GitRootRow } from '$features/git-roots/git-roots-service';

/** Per-workspace live git-root state (registered roots only; the primary
 * workspace root is synthesized by the selectors, never stored here). */
interface GitRootsWorkspaceState {
  consumers?: Record<string, true>;
  gitRoots: Collection<GitRootRow, 'id'>;
}

/** Root git-roots state, keyed by workspace ID. */
export interface GitRootsState {
  byWorkspaceId: Record<string, GitRootsWorkspaceState>;
}

const emptyGitRootsWorkspaceState: GitRootsWorkspaceState = {
  gitRoots: createCollection<GitRootRow, 'id'>('id'),
};

export const initialState: GitRootsState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyGitRootsWorkspaceState,
);

export const gitRootsConsumerMounted = createAction<[wsId: string, consumerId: string]>(
  'gitRoots/consumerMounted',
);
export const gitRootsConsumerUnmounted = createAction<[wsId: string, consumerId: string]>(
  'gitRoots/consumerUnmounted',
);

// ── Actions ──

/** Service → reducer: full root list after a seed or event fold. */
export const gitRootsUpdated =
  createAction<[workspaceId: string, gitRoots: GitRootRow[]]>('gitRoots/updated');

// ── Reducer ──

export const gitRootsReducer = createReducer<GitRootsState>(initialState);

gitRootsReducer.with(gitRootsUpdated, (state, { payload: [workspaceId, gitRoots] }) => {
  return setWorkspaceState(state, workspaceId, {
    ...getWorkspaceState(state, workspaceId),
    gitRoots: createCollection<GitRootRow, 'id'>('id', gitRoots),
  });
});

gitRootsReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);

gitRootsReducer.with(gitRootsConsumerMounted, (state, { payload: [wsId, id] }) => {
  const entry = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...entry,
    consumers: { ...entry.consumers, [id]: true },
  });
});
gitRootsReducer.with(gitRootsConsumerUnmounted, (state, { payload: [wsId, id] }) => {
  const entry = state.byWorkspaceId[wsId];
  if (!entry?.consumers?.[id]) return state;
  const consumers = { ...entry.consumers };
  delete consumers[id];
  return setWorkspaceState(state, wsId, { ...entry, consumers });
});

gitRootsReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
gitRootsReducer.with(workspaceDeleted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
