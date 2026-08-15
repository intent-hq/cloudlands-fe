/**
 * git-roots slice — per-workspace live git-root list (multi git root
 * tracking, intent-hq/monorepo#2053).
 *
 * The companion `gitRootsSaga` owns the active workspace's `gitRoot:*`
 * events.subscribe + `gitRoot.list` seed round-trip and writes every fold
 * result back via `gitRootsUpdated`, so components render purely from
 * selectors and never touch the live backend transport.
 */
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import type { GitRootRow } from '$features/git-roots/git-roots-service';

/** Per-workspace live git-root state (registered roots only; the primary
 * workspace root is synthesized by the selectors, never stored here). */
export interface GitRootsWorkspaceState {
  gitRoots: Collection<GitRootRow, 'id'>;
}

/** Root git-roots state, keyed by workspace ID. */
export interface GitRootsState {
  byWorkspaceId: Record<string, GitRootsWorkspaceState>;
}

export const emptyGitRootsWorkspaceState: GitRootsWorkspaceState = {
  gitRoots: createCollection<GitRootRow, 'id'>('id'),
};

export const initialState: GitRootsState = {
  byWorkspaceId: {},
};

const { setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyGitRootsWorkspaceState,
);

// ── Actions ──

/** Service → reducer: full root list after a seed or event fold. */
export const gitRootsUpdated =
  createAction<[workspaceId: string, gitRoots: GitRootRow[]]>('gitRoots/updated');

// ── Reducer ──

export const gitRootsReducer = createReducer<GitRootsState>(initialState);

gitRootsReducer.with(gitRootsUpdated, (state, { payload: [workspaceId, gitRoots] }) => {
  return setWorkspaceState(state, workspaceId, {
    gitRoots: createCollection<GitRootRow, 'id'>('id', gitRoots),
  });
});

gitRootsReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
