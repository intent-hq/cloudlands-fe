import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = { tabState: { currentTabId: 'ws-1' as string | null } };

vi.mock('$store/renderer/store', () => ({
  store: {
    get state() {
      return mockState;
    },
  },
}));

import {
  beginVisibleWorkspaceNavigation,
  getVisibleWorkspaceId,
  resetVisibleWorkspaceNavigationForTests,
  resolveVisibleWorkspaceId,
} from '../visible-workspace';

beforeEach(() => {
  mockState.tabState.currentTabId = 'ws-1';
  window.history.replaceState(null, '', '/workspace/ws-1');
  resetVisibleWorkspaceNavigationForTests();
});

describe('resolveVisibleWorkspaceId', () => {
  it.each([
    ['/workspace/ws-1', 'ws-1'],
    ['/workspace/ws-1/files', 'ws-1'],
    ['/', null],
    ['/settings', null],
    ['/workspace/new', null],
  ])('on %s with the ws-1 tab → %s', (path, expected) => {
    expect(resolveVisibleWorkspaceId('ws-1', path)).toBe(expected);
  });

  it('keeps the tab as the source of truth while tab and route briefly disagree', () => {
    // A tab-strip click selects its tab before navigating; show-workspace opens
    // the tab only after landing. Either way the tab is the latest choice.
    expect(resolveVisibleWorkspaceId('ws-1', '/workspace/ws-2')).toBe('ws-1');
  });

  it('falls back to the route workspace when no tab is selected', () => {
    expect(resolveVisibleWorkspaceId(null, '/workspace/ws-1')).toBe('ws-1');
    expect(resolveVisibleWorkspaceId('', '/workspace/ws-1/files')).toBe('ws-1');
  });

  it('is null without a tab or a workspace route', () => {
    expect(resolveVisibleWorkspaceId(null, '/')).toBeNull();
    expect(resolveVisibleWorkspaceId(null, null)).toBeNull();
  });

  it('prefers a pending navigation whose tab is selected over the route being left', () => {
    expect(resolveVisibleWorkspaceId('ws-1', '/workspace/ws-2', 'ws-1')).toBe('ws-1');
  });

  it('trusts the current tab when the route is unknown', () => {
    expect(resolveVisibleWorkspaceId('ws-1', null)).toBe('ws-1');
  });

  it('counts a pending navigation to the current tab as visible', () => {
    expect(resolveVisibleWorkspaceId('ws-1', '/', 'ws-1')).toBe('ws-1');
    expect(resolveVisibleWorkspaceId('ws-1', '/', 'ws-2')).toBeNull();
  });
});

describe('getVisibleWorkspaceId', () => {
  it('reads the current tab and route', () => {
    expect(getVisibleWorkspaceId()).toBe('ws-1');
    window.history.replaceState(null, '', '/');
    expect(getVisibleWorkspaceId()).toBeNull();
    window.history.replaceState(null, '', '/settings');
    expect(getVisibleWorkspaceId()).toBeNull();
  });

  it('treats an in-flight navigation as visible until it settles', () => {
    window.history.replaceState(null, '', '/');
    const settle = beginVisibleWorkspaceNavigation('ws-1');
    expect(getVisibleWorkspaceId()).toBe('ws-1');
    settle();
    expect(getVisibleWorkspaceId()).toBeNull();
  });

  it('keeps the newest navigation when an older one to the same workspace settles', () => {
    window.history.replaceState(null, '', '/');
    const first = beginVisibleWorkspaceNavigation('ws-1');
    beginVisibleWorkspaceNavigation('ws-2');
    beginVisibleWorkspaceNavigation('ws-1');
    first();
    expect(getVisibleWorkspaceId()).toBe('ws-1');
  });

  it('ignores a pending navigation to a workspace whose tab is not selected', () => {
    window.history.replaceState(null, '', '/');
    beginVisibleWorkspaceNavigation('ws-2');
    expect(getVisibleWorkspaceId()).toBeNull();
  });
});
