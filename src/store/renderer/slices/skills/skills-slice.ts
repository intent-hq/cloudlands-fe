import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type { SkillInfo, SkillsState, SkillsWorkspaceState } from './skills-types';

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
  'skills/loadSkillsRequested',
);

/** Reducer: store loaded skills */
export const setSkills =
  createAction<[workspaceId: string, skills: SkillInfo[]]>('skills/setSkills');

/** Reducer: store a failed skills load while preserving the last known roster */
export const loadSkillsFailed =
  createAction<[workspaceId: string, error: string]>('skills/loadSkillsFailed');

// ============================================================================
// Reducer
// ============================================================================

export const skillsReducer = createReducer<SkillsState>(initialState);
skillsReducer.with(loadSkillsRequested, (state, { payload: [workspaceId] }) => {
  const current = state.byWorkspaceId[workspaceId] ?? emptyWorkspaceSkillsState;
  return setWorkspaceState(state, workspaceId, {
    ...current,
    loading: true,
    error: null,
  });
});
skillsReducer.with(setSkills, (state, { payload: [workspaceId, skills] }) => {
  return setWorkspaceState(state, workspaceId, {
    skills,
    loading: false,
    error: null,
  });
});
skillsReducer.with(loadSkillsFailed, (state, { payload: [workspaceId, error] }) => {
  const current = state.byWorkspaceId[workspaceId] ?? emptyWorkspaceSkillsState;
  return setWorkspaceState(state, workspaceId, {
    ...current,
    loading: false,
    error,
  });
});
skillsReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
