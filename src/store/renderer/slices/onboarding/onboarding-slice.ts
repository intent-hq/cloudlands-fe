/**
 * Onboarding Redux Slice
 *
 * Actions and reducer for the onboarding flow state machine.
 * No saga needed — this is pure synchronous UI state.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { OnboardingState, OnboardingStep, ProjectConfig } from './onboarding-types';
import { STEP_ORDER } from './onboarding-types';

// =============================================================================
// Initial State
// =============================================================================

export const initialState: OnboardingState = {
  step: 'requirements',
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
  fullFlowRequested: false,
};

// =============================================================================
// Actions
// =============================================================================

export const goToStep = createAction<[step: OnboardingStep]>('onboarding/goToStep');
export const nextStep = createAction('onboarding/nextStep');
export const setProjectConfig = createAction<[config: Partial<ProjectConfig>]>(
  'onboarding/setProjectConfig',
);
export const setOnboardingWorkspaceId = createAction<[id: string]>('onboarding/setWorkspaceId');
export const resetOnboarding = createAction('onboarding/reset');
export const setOnboardingFullFlowRequested = createAction<[value: boolean]>(
  'onboarding/setFullFlowRequested',
);

// =============================================================================
// Reducer
// =============================================================================

export const onboardingReducer = createReducer<OnboardingState>(initialState);
onboardingReducer.with(goToStep, (state, { payload: [step] }) => ({
  ...state,
  step,
}));
onboardingReducer.with(nextStep, (state) => {
  const idx = STEP_ORDER.indexOf(state.step);
  if (idx < STEP_ORDER.length - 1) {
    return { ...state, step: STEP_ORDER[idx + 1] };
  }
  return state;
});
onboardingReducer.with(setProjectConfig, (state, { payload: [config] }) => ({
  ...state,
  projectConfig: { ...state.projectConfig, ...config },
}));
onboardingReducer.with(setOnboardingWorkspaceId, (state, { payload: [id] }) => ({
  ...state,
  workspaceId: id,
}));
// Reset preserves a pending full-flow request: explicit restart paths dispatch
// it before navigating, and OnboardingPage's own mount reset must not clear it
// before the initial-step decision consumes it.
onboardingReducer.with(resetOnboarding, (state) => ({
  ...initialState,
  fullFlowRequested: state.fullFlowRequested,
}));
onboardingReducer.with(setOnboardingFullFlowRequested, (state, { payload: [value] }) => ({
  ...state,
  fullFlowRequested: value,
}));
