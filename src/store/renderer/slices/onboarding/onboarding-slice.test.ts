/**
 * Onboarding reducer tests — step ordering and advance logic.
 *
 * The GitHub device-token step sits between agent-CLI selection ('welcome')
 * and project selection ('project'); `nextStep` must walk the full order and
 * `goToStep` must accept every step including 'github'.
 */
import { describe, expect, it } from 'vitest';

import {
  goToStep,
  initialState,
  nextStep,
  onboardingReducer,
  resetOnboarding,
} from './onboarding-slice';
import { STEP_ORDER, type OnboardingStep } from './onboarding-types';

describe('onboarding step ordering', () => {
  it('places the github step between welcome and project', () => {
    expect(STEP_ORDER).toEqual(['welcome', 'github', 'project', 'configuring', 'ready']);
  });

  it('starts at welcome', () => {
    expect(initialState.step).toBe('welcome');
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

  it('resetOnboarding returns to welcome', () => {
    const onGitHub = onboardingReducer(initialState, goToStep('github'));
    expect(onboardingReducer(onGitHub, resetOnboarding()).step).toBe('welcome');
  });
});
