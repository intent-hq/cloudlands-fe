import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  AgentSkills,
  SkillInfo,
  SkillsAgentState,
  SkillsState,
  SkillsWorkspaceState,
} from './skills-types';

// ============================================================================
// Empty / initial state
// ============================================================================

export const emptyWorkspaceSkillsState: SkillsWorkspaceState = {
  skills: [],
  loading: false,
  error: null,
};

export const emptyAgentSkillsState: SkillsAgentState = {
  ...emptyWorkspaceSkillsState,
  stale: false,
  unavailable: null,
};

export const initialState: SkillsState = {
  byWorkspaceId: {},
  byAgentId: {},
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

/** Trigger: load a remote agent's machine skills (`skill.list` with `agentId`). */
export const loadAgentSkillsRequested = createAction<[workspaceId: string, agentId: string]>(
  'skills/loadAgentSkillsRequested',
);

/** Trigger: `skills:changed` named a remote agent (its machine's catalog changed). */
export const agentSkillsChanged = createAction<[workspaceId: string, agentId: string]>(
  'skills/agentSkillsChanged',
);

/** Reducer: store a remote agent's machine skills */
export const setAgentSkills =
  createAction<[agentId: string, result: AgentSkills]>('skills/setAgentSkills');

/** Reducer: a failed remote agent skills load, keeping the last list */
export const loadAgentSkillsFailed = createAction<[agentId: string, error: string]>(
  'skills/loadAgentSkillsFailed',
);

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

function setAgentState(state: SkillsState, agentId: string, next: SkillsAgentState): SkillsState {
  return { ...state, byAgentId: { ...(state.byAgentId ?? {}), [agentId]: next } };
}

skillsReducer.with(loadAgentSkillsRequested, (state, { payload: [, agentId] }) => {
  const current = state.byAgentId?.[agentId] ?? emptyAgentSkillsState;
  return setAgentState(state, agentId, { ...current, loading: true, error: null });
});
skillsReducer.with(setAgentSkills, (state, { payload: [agentId, result] }) =>
  setAgentState(state, agentId, { ...result, loading: false, error: null }),
);
skillsReducer.with(loadAgentSkillsFailed, (state, { payload: [agentId, error] }) => {
  const current = state.byAgentId?.[agentId] ?? emptyAgentSkillsState;
  return setAgentState(state, agentId, { ...current, loading: false, error });
});
