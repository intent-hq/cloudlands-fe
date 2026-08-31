import type { WorkspaceDiffSummary, WorkspaceGitSummary } from '$shared/types';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import type {
  WorkspaceSummariesState,
  WorkspaceSummariesWorkspaceState,
} from './workspace-summaries-types';

export type { WorkspaceSummariesState };

const emptyWorkspaceSummariesState: WorkspaceSummariesWorkspaceState = {
  diffSummary: null,
  gitSummary: null,
  initialized: false,
};

export const initialState: WorkspaceSummariesState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyWorkspaceSummariesState,
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const loadWorkspaceSummariesSucceeded = createAction<
  [
    workspaceId: string,
    diffSummary: WorkspaceDiffSummary | null,
    gitSummary: WorkspaceGitSummary | null,
  ]
>('workspaceSummaries/loadWorkspaceSummariesSucceeded');

/** Clear all summary state for a workspace. */
export const clearWorkspaceSummaries = createAction<[workspaceId: string]>(
  'workspaceSummaries/clearWorkspaceSummaries',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const workspaceSummariesReducer = createReducer<WorkspaceSummariesState>(initialState);
workspaceSummariesReducer.with(
  loadWorkspaceSummariesSucceeded,
  (state, { payload: [workspaceId, diffSummary, gitSummary] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      diffSummary,
      gitSummary,
      initialized: true,
    });
  },
);
workspaceSummariesReducer.with(clearWorkspaceSummaries, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(state, workspaceId),
);
workspaceSummariesReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
workspaceSummariesReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
