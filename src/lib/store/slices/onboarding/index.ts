// Onboarding slice — public API

// Types
export type {
  OnboardingStep,
  ProjectConfig,
  AgentStatus,
  OnboardingState,
} from './onboarding-types';

export { STEP_ORDER } from './onboarding-types';

// Actions + Reducer
export {
  onboardingReducer,
  initialState,
  goToStep,
  nextStep,
  prevStep,
  setProjectConfig,
  setAgentStatus,
  setOnboardingWorkspaceId,
  resetOnboarding,
} from './onboarding-slice';

// Selectors
export {
  selectOnboardingState,
  selectOnboardingStep,
  selectOnboardingProjectConfig,
  selectOnboardingAgentStatus,
  selectOnboardingWorkspaceId,
} from './onboarding-selectors';
