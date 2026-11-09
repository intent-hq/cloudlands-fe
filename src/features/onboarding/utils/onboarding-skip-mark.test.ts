import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { hasOnboardingSkipMark, recordOnboardingSkipMark } from './onboarding-skip-mark';

// test-setup stubs localStorage with no-op vi.fn()s; back them with a Map.
const stored = new Map<string, string>();
beforeEach(() => {
  vi.mocked(window.localStorage.getItem).mockImplementation((key) => stored.get(key) ?? null);
  vi.mocked(window.localStorage.setItem).mockImplementation((key, value) => {
    stored.set(key, value);
  });
});
afterEach(() => {
  stored.clear();
  vi.mocked(window.localStorage.getItem).mockImplementation(() => null);
  vi.mocked(window.localStorage.setItem).mockImplementation(() => {});
});

describe('onboarding skip mark', () => {
  it('is absent on a fresh profile', () => {
    expect(hasOnboardingSkipMark(LOCAL_CONNECTION_ID)).toBe(false);
  });

  it('is scoped to the backend that recorded it', () => {
    recordOnboardingSkipMark('remote-a');
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
