import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
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

const { setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceSkillsState);

// ============================================================================
// Actions
// ============================================================================

/** Trigger: request loading skills for a workspace */
export const loadSkillsRequested = createAction<[workspaceId: string]>(
  "skills/loadSkillsRequested",
);

/** Reducer: store loaded skills */
export const setSkills = createAction<[workspaceId: string, skills: SkillInfo[]]>(
  "skills/setSkills",
);

// ============================================================================
// Reducer
// ============================================================================

export const skillsReducer = createReducer<SkillsState>(initialState);
skillsReducer.with(setSkills, (state, { payload: [workspaceId, skills] }) => {
    return setWorkspaceState(state, workspaceId, {
      skills,
      loading: false,
      error: null,
    });
  });
skillsReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));

