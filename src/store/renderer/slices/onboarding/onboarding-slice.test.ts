/**
 * Onboarding reducer tests — step ordering and advance logic.
 *
 * The 'requirements' gate precedes 'welcome', and the GitHub device-token
 * step sits between agent-CLI selection ('welcome') and project selection
 * ('project'); `nextStep` must walk the full order and `goToStep` must
 * accept every step including 'github'.
 */
import { describe, expect, it } from 'vitest';

import {
  goToStep,
  initialState,
  nextStep,
  onboardingReducer,
  resetOnboarding,
  setOnboardingFullFlowRequested,
} from './onboarding-slice';
import { STEP_ORDER, type OnboardingStep } from './onboarding-types';

describe('onboarding step ordering', () => {
  it('places requirements before welcome and github between welcome and project', () => {
    expect(STEP_ORDER).toEqual([
      'requirements',
      'welcome',
      'github',
      'project',
      'configuring',
      'ready',
    ]);
  });

  it('starts at requirements', () => {
    expect(initialState.step).toBe('requirements');
  });

  it('nextStep advances through every step in order and stops at the last', () => {
    let state = initialState;
    const visited: OnboardingStep[] = [state.step];
    for (let i = 0; i < STEP_ORDER.length - 1; i++) {
      state = onboardingReducer(state, nextStep());
      visited.push(state.step);
    }
    expect(visited).toEqual(STEP_ORDER);

    // Terminal step: nextStep is a no-op.
    const after = onboardingReducer(state, nextStep());
    expect(after.step).toBe('ready');
  });

  it('goToStep advances from requirements to welcome', () => {
    const state = onboardingReducer(initialState, goToStep('welcome'));
    expect(state.step).toBe('welcome');
  });

  it('goToStep jumps directly to the github step', () => {
    const state = onboardingReducer(initialState, goToStep('github'));
    expect(state.step).toBe('github');
  });

  it('goToStep supports skipping github (welcome → github → project)', () => {
    // "Skip for now" advances from github straight to project.
    const onGitHub = onboardingReducer(initialState, goToStep('github'));
    const skipped = onboardingReducer(onGitHub, goToStep('project'));
    expect(skipped.step).toBe('project');
  });

  it('resetOnboarding returns to requirements', () => {
    const onGitHub = onboardingReducer(initialState, goToStep('github'));
    expect(onboardingReducer(onGitHub, resetOnboarding()).step).toBe('requirements');
  });
});

describe('onboarding full-flow request flag', () => {
  it('starts unset', () => {
    expect(initialState.fullFlowRequested).toBe(false);
  });

  it('setOnboardingFullFlowRequested sets and clears the flag', () => {
    const set = onboardingReducer(initialState, setOnboardingFullFlowRequested(true));
    expect(set.fullFlowRequested).toBe(true);
    const cleared = onboardingReducer(set, setOnboardingFullFlowRequested(false));
    expect(cleared.fullFlowRequested).toBe(false);
  });

  it('resetOnboarding preserves a pending full-flow request', () => {
    // Explicit restart paths dispatch the request before navigating;
    // OnboardingPage's mount reset must not clear it before the initial-step
    // decision consumes it.
    const requested = onboardingReducer(initialState, setOnboardingFullFlowRequested(true));
    const onProject = onboardingReducer(requested, goToStep('project'));
    const reset = onboardingReducer(onProject, resetOnboarding());
    expect(reset.step).toBe('requirements');
    expect(reset.fullFlowRequested).toBe(true);
  });

  it('resetOnboarding keeps the flag unset when no request is pending', () => {
    const onProject = onboardingReducer(initialState, goToStep('project'));
    expect(onboardingReducer(onProject, resetOnboarding()).fullFlowRequested).toBe(false);
  });
});
