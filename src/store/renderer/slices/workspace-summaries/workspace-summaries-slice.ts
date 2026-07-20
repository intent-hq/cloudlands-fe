import type { WorkspaceDiffSummary, WorkspaceGitSummary } from "$shared/types";
import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import { removeWorkspaceEntity } from "../workspace/workspace-slice";
import type {
  WorkspaceSummariesState,
  WorkspaceSummariesWorkspaceState,
} from "./workspace-summaries-types";

export type { WorkspaceSummariesState, WorkspaceSummariesWorkspaceState };

export const emptyWorkspaceSummariesState: WorkspaceSummariesWorkspaceState = {
  diffSummary: null,
  gitSummary: null,
  loading: false,
  error: null,
  initialized: false,
};

export const initialState: WorkspaceSummariesState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceSummariesState);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Saga trigger: fetch on-demand diff/git summaries for a workspace. */
export const loadWorkspaceSummariesRequested = createAction<[workspaceId: string]>(
  "workspaceSummaries/loadWorkspaceSummariesRequested"
);

export const loadWorkspaceSummariesSucceeded = createAction<
  [
    workspaceId: string,
    diffSummary: WorkspaceDiffSummary | null,
    gitSummary: WorkspaceGitSummary | null,
  ]
>("workspaceSummaries/loadWorkspaceSummariesSucceeded");

export const loadWorkspaceSummariesFailed = createAction<[workspaceId: string, error: string]>(
  "workspaceSummaries/loadWorkspaceSummariesFailed"
);

/** Clear all summary state for a workspace. */
export const clearWorkspaceSummaries = createAction<[workspaceId: string]>(
  "workspaceSummaries/clearWorkspaceSummaries"
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const workspaceSummariesReducer = createReducer<WorkspaceSummariesState>(initialState)
  .with(loadWorkspaceSummariesRequested, (state, { payload: [workspaceId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    if (ws.loading && ws.error === null) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      loading: true,
      error: null,
    });
  })
  .with(
    loadWorkspaceSummariesSucceeded,
    (state, { payload: [workspaceId, diffSummary, gitSummary] }) => {
      const ws = getWorkspaceState(state, workspaceId);
      return setWorkspaceState(state, workspaceId, {
        ...ws,
        diffSummary,
        gitSummary,
        loading: false,
        error: null,
        initialized: true,
      });
    }
  )
  .with(loadWorkspaceSummariesFailed, (state, { payload: [workspaceId, error] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    if (!ws.loading && ws.error === error) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      loading: false,
      error,
    });
  })
  .with(clearWorkspaceSummaries, (state, { payload: [workspaceId] }) =>
    clearWorkspaceState(state, workspaceId)
  )
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId))
  .with(removeWorkspaceEntity, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));

