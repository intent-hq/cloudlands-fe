import { describe, expect, it } from 'vitest';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { hasOnboardingSkipMark, recordOnboardingSkipMark } from './onboarding-skip-mark';

describe('onboarding skip mark', () => {
  it('is absent on a fresh profile', () => {
    expect(hasOnboardingSkipMark(LOCAL_CONNECTION_ID)).toBe(false);
  });

  it('is scoped to the backend that recorded it', () => {
    recordOnboardingSkipMark('remote-a');
    expect(localStorage.getItem('backend:remote-a:intent:onboarding-skip:v1')).toBe('1');
    expect(hasOnboardingSkipMark('remote-a')).toBe(true);
    expect(hasOnboardingSkipMark('remote-b')).toBe(false);
    expect(hasOnboardingSkipMark(LOCAL_CONNECTION_ID)).toBe(false);
  });

  it('persists across reads once recorded', () => {
    recordOnboardingSkipMark(LOCAL_CONNECTION_ID);
    recordOnboardingSkipMark(LOCAL_CONNECTION_ID);
    expect(hasOnboardingSkipMark(LOCAL_CONNECTION_ID)).toBe(true);
  });
});
