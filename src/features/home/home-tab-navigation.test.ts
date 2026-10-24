import { describe, expect, it } from 'vitest';
import { getHomeTabChange } from './home-tab-navigation';

describe('homepage tab navigation', () => {
  it('moves from a custom view back to any regular tab', () => {
    for (const tab of ['workspaces', 'prs', 'linear']) {
      expect(getHomeTabChange('custom', tab)).toEqual({ tab, direction: -1 });
    }
  });

  it('preserves direction between regular tabs', () => {
    expect(getHomeTabChange('workspaces', 'linear')).toEqual({ tab: 'linear', direction: 1 });
    expect(getHomeTabChange('linear', 'prs')).toEqual({ tab: 'prs', direction: -1 });
  });

  it('ignores the current tab, unavailable custom tabs, and unknown tabs', () => {
    expect(getHomeTabChange('prs', 'prs')).toBeNull();
    expect(getHomeTabChange('custom', 'custom')).toBeNull();
    expect(getHomeTabChange('workspaces', 'custom')).toBeNull();
    expect(getHomeTabChange('workspaces', 'unknown')).toBeNull();
  });
});
