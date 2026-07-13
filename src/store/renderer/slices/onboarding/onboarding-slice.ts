/**
 * Onboarding Redux Slice
 *
 * Actions and reducer for the onboarding flow state machine.
 * No saga needed — this is pure synchronous UI state.
 */

import { createAction } from '@augmentcode/ag-redux-toolkit/utils/store/create-action';
import { createReducer } from '@augmentcode/ag-redux-toolkit/utils/store/create-reducer';
import type { OnboardingState, OnboardingStep, ProjectConfig, AgentStatus } from './onboarding-types';
import { STEP_ORDER } from './onboarding-types';

// =============================================================================
// Initial State
// =============================================================================

export const initialState: OnboardingState = {
  step: 'welcome',
  projectConfig: {
    repoUrl: null,
    repoName: null,
    localPath: null,
    branch: null,
  },
  agentStatus: {
    state: 'idle',
    message: null,
  },
  workspaceId: null,
};

// =============================================================================
// Actions
// =============================================================================

export const goToStep = createAction<[step: OnboardingStep]>('onboarding/goToStep');
export const nextStep = createAction('onboarding/nextStep');
export const setProjectConfig = createAction<[config: Partial<ProjectConfig>]>('onboarding/setProjectConfig');
export const setAgentStatus = createAction<[status: Partial<AgentStatus>]>('onboarding/setAgentStatus');
export const setOnboardingWorkspaceId = createAction<[id: string]>('onboarding/setWorkspaceId');
export const resetOnboarding = createAction('onboarding/reset');

// =============================================================================
// Reducer
// =============================================================================

export const onboardingReducer = createReducer<OnboardingState>(initialState)
  .with(goToStep, (state, { payload: [step] }) => ({
    ...state,
    step,
  }))
  .with(nextStep, (state) => {
    const idx = STEP_ORDER.indexOf(state.step);
    if (idx < STEP_ORDER.length - 1) {
      return { ...state, step: STEP_ORDER[idx + 1] };
    }
    return state;
  })
  .with(setProjectConfig, (state, { payload: [config] }) => ({
    ...state,
    projectConfig: { ...state.projectConfig, ...config },
  }))
  .with(setAgentStatus, (state, { payload: [status] }) => ({
    ...state,
    agentStatus: { ...state.agentStatus, ...status },
  }))
  .with(setOnboardingWorkspaceId, (state, { payload: [id] }) => ({
    ...state,
    workspaceId: id,
  }))
  .with(resetOnboarding, () => initialState);
