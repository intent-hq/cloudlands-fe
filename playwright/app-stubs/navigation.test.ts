import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { goto } from './navigation';

describe('CT navigation arrival', () => {
  const initialUrl = window.location.href;
  const initialState = window.history.state;

  beforeEach(() => {
    window.history.replaceState({ presenceFollowRequestId: 'old-follow' }, '', '/');
  });

  afterEach(() => {
    window.history.replaceState(initialState, '', initialUrl);
  });

  it.each(['string', 'URL'])(
    'arrives at a %s destination with query, hash and page state',
    async (kind) => {
      const target = '/workspace/team%20space?note=project%20plan#section-2';
      const state = { presenceFollowRequestId: 'current-follow' };
      const length = window.history.length;

      await goto(kind === 'URL' ? new URL(target, window.location.href) : target, { state });

      expect(window.location.pathname).toBe('/workspace/team%20space');
      expect(window.location.search).toBe('?note=project%20plan');
      expect(window.location.hash).toBe('#section-2');
      expect(window.history.state).toEqual(state);
      expect(window.history.length).toBe(length + 1);
    },
  );

  it('replaces the current entry and clears page state when none is supplied', async () => {
    const length = window.history.length;

    await goto('/settings?tab=connections#integrations', { replaceState: true });

    expect(window.location.pathname).toBe('/settings');
    expect(window.location.search).toBe('?tab=connections');
    expect(window.location.hash).toBe('#integrations');
    expect(window.history.state).toEqual({});
    expect(window.history.length).toBe(length);
  });

  it('rejects a destination outside the preview origin without claiming arrival', async () => {
    const before = window.location.href;

    await expect(goto('https://outside.invalid/workspace/other')).rejects.toThrow();

    expect(window.location.href).toBe(before);
    expect(window.history.state).toEqual({ presenceFollowRequestId: 'old-follow' });
  });
});
