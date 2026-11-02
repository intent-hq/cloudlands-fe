import { afterEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { navigateToRoute } from './navigation.client';
import { navigationEpoch } from './navigation-epoch';

describe('navigation epoch', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.mocked(goto).mockReset();
  });

  it('navigateToRoute marks a navigation synchronously, before its first await', async () => {
    const before = navigationEpoch();

    const navigation = navigateToRoute('/settings');

    expect(navigationEpoch()).toBe(before + 1);
    await navigation;
    expect(goto).toHaveBeenCalledWith('/settings');
  });

  it('does not count navigation ignored in the HUD window', async () => {
    window.history.replaceState({}, '', '/hud');
    const before = navigationEpoch();

    await navigateToRoute('/workspace/ws-1');

    expect(navigationEpoch()).toBe(before);
  });

  it('does not count links that may open in the Assistant panel instead', () => {
    const before = navigationEpoch();

    void navigateToRoute('intent://local/ws-1/note/spec').catch(() => {});
    void navigateToRoute('https://example.com').catch(() => {});

    expect(navigationEpoch()).toBe(before);
  });
});
