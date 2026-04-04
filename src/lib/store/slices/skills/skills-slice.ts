import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type { SkillInfo, SkillsState, SkillsWorkspaceState } from "./skills-types";

// ============================================================================
// Empty / initial state
// ============================================================================

export const emptyWorkspaceSkillsState: SkillsWorkspaceState = {
  skills: [],
  loading: false,
  error: null,
};

export const initialState: SkillsState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceSkillsState);

// ============================================================================
// Actions
// ============================================================================

/** Trigger: request loading skills for a workspace */
export const loadSkillsRequested = createAction<[workspaceId: string]>(
  "skills/loadSkillsRequested",
);

/** Reducer: mark loading state */
export const setSkillsLoading = createAction<[workspaceId: string, loading: boolean]>(
  "skills/setSkillsLoading",
);

/** Reducer: store loaded skills */
export const setSkills = createAction<[workspaceId: string, skills: SkillInfo[]]>(
  "skills/setSkills",
);

/** Reducer: store error */
export const setSkillsError = createAction<[workspaceId: string, error: string]>(
  "skills/setSkillsError",
);

// ============================================================================
// Reducer
// ============================================================================

export const skillsReducer = createReducer<SkillsState>(initialState)
  .with(setSkillsLoading, (state, { payload: [workspaceId, loading] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    if (ws.loading === loading) {
      return state; // No change needed
    }
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      loading,
      error: loading ? null : ws.error,
    });
  })
  .with(setSkills, (state, { payload: [workspaceId, skills] }) => {
    return setWorkspaceState(state, workspaceId, {
      skills,
      loading: false,
      error: null,
    });
  })
  .with(setSkillsError, (state, { payload: [workspaceId, error] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    if (ws.error === error && !ws.loading) {
      return state; // No change needed
    }
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      loading: false,
      error,
    });
  })
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));

