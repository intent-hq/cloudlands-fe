import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import {
  collectOpenWorkspaceIds,
  collectWindowIdsForWorkspace,
  type WindowChecker,
} from '../window-workspace-tracking';

describe('collectOpenWorkspaceIds', () => {
  let windowWorkspaceIds: Map<number, string>;
  let windowOpenWorkspaceTabs: Map<number, string[]>;
  let aliveWindows: Set<number>;
  let checker: WindowChecker;

  beforeEach(() => {
    windowWorkspaceIds = new Map();
    windowOpenWorkspaceTabs = new Map();
    aliveWindows = new Set();
    checker = { isAlive: (id) => aliveWindows.has(id) };
  });

  it('returns the active workspace for a live window', () => {
    windowWorkspaceIds.set(1, 'ws-active');
    aliveWindows.add(1);

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    expect(result).toEqual(['ws-active']);
  });

  it('includes background tab workspaces (the bug fix)', () => {
    // Window 1 is viewing ws-A, but has tabs open for ws-B and ws-C
    windowWorkspaceIds.set(1, 'ws-A');
    windowOpenWorkspaceTabs.set(1, ['ws-A', 'ws-B', 'ws-C']);
    aliveWindows.add(1);

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    expect(result.sort()).toEqual(['ws-A', 'ws-B', 'ws-C']);
  });

  it('does not include workspaces from destroyed windows', () => {
    windowWorkspaceIds.set(1, 'ws-alive');
    windowWorkspaceIds.set(2, 'ws-dead');
    windowOpenWorkspaceTabs.set(2, ['ws-dead', 'ws-also-dead']);
    aliveWindows.add(1); // window 2 is NOT alive

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    expect(result).toEqual(['ws-alive']);
  });

  it('cleans up stale entries from both maps', () => {
    windowWorkspaceIds.set(1, 'ws-alive');
    windowWorkspaceIds.set(2, 'ws-stale');
    windowOpenWorkspaceTabs.set(2, ['ws-stale', 'ws-stale-tab']);
    aliveWindows.add(1); // window 2 is stale

    collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);

    expect(windowWorkspaceIds.has(2)).toBe(false);
    expect(windowOpenWorkspaceTabs.has(2)).toBe(false);
    // Window 1 untouched
    expect(windowWorkspaceIds.get(1)).toBe('ws-alive');
  });

  it('deduplicates workspace IDs across active and tabs', () => {
    windowWorkspaceIds.set(1, 'ws-A');
    windowOpenWorkspaceTabs.set(1, ['ws-A', 'ws-B']);
    aliveWindows.add(1);

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    // ws-A should appear only once despite being in both maps
    expect(result.sort()).toEqual(['ws-A', 'ws-B']);
  });

  it('handles multiple windows with overlapping tabs', () => {
    windowWorkspaceIds.set(1, 'ws-A');
    windowOpenWorkspaceTabs.set(1, ['ws-A', 'ws-B']);
    windowWorkspaceIds.set(2, 'ws-C');
    windowOpenWorkspaceTabs.set(2, ['ws-B', 'ws-C', 'ws-D']);
    aliveWindows.add(1);
    aliveWindows.add(2);

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    expect(result.sort()).toEqual(['ws-A', 'ws-B', 'ws-C', 'ws-D']);
  });

  it('returns empty when no windows exist', () => {
    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    expect(result).toEqual([]);
  });

  it('handles window with no tab entries', () => {
    windowWorkspaceIds.set(1, 'ws-A');
    aliveWindows.add(1);
    // No windowOpenWorkspaceTabs entry for window 1

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    expect(result).toEqual(['ws-A']);
  });

  it('includes tabs when window navigates away from workspace (no active workspace)', () => {
    // Window navigated to home/settings — no windowWorkspaceIds entry,
    // but tabs are still open in the tab bar
    windowOpenWorkspaceTabs.set(1, ['ws-A', 'ws-B']);
    aliveWindows.add(1);
    // Notably: windowWorkspaceIds does NOT have an entry for window 1

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    expect(result.sort()).toEqual(['ws-A', 'ws-B']);
  });

  it('cleans up stale tabs-only entries (no active workspace)', () => {
    // Window 1 is alive with tabs only, window 2 is destroyed with tabs only
    windowOpenWorkspaceTabs.set(1, ['ws-A']);
    windowOpenWorkspaceTabs.set(2, ['ws-B']);
    aliveWindows.add(1); // window 2 is NOT alive

    collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);

    expect(windowOpenWorkspaceTabs.has(1)).toBe(true);
    expect(windowOpenWorkspaceTabs.has(2)).toBe(false);
  });
});

describe('collectWindowIdsForWorkspace', () => {
  let windowWorkspaceIds: Map<number, string>;
  let windowOpenWorkspaceTabs: Map<number, string[]>;
  let aliveWindows: Set<number>;
  let checker: WindowChecker;

  beforeEach(() => {
    windowWorkspaceIds = new Map();
    windowOpenWorkspaceTabs = new Map();
    aliveWindows = new Set();
    checker = { isAlive: (id) => aliveWindows.has(id) };
  });

  it('returns window ID when workspace is actively viewed', () => {
    windowWorkspaceIds.set(1, 'ws-A');
    aliveWindows.add(1);

    const result = collectWindowIdsForWorkspace(
      'ws-A',
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result).toEqual([1]);
  });

  it('returns window ID when workspace is in background tabs (the bug fix)', () => {
    // Window 1 is viewing ws-A, but has ws-B open in background tab
    windowWorkspaceIds.set(1, 'ws-A');
    windowOpenWorkspaceTabs.set(1, ['ws-A', 'ws-B', 'ws-C']);
    aliveWindows.add(1);

    const result = collectWindowIdsForWorkspace(
      'ws-B',
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result).toEqual([1]);
  });

  it('returns empty array when workspace is not open anywhere', () => {
    windowWorkspaceIds.set(1, 'ws-A');
    windowOpenWorkspaceTabs.set(1, ['ws-A']);
    aliveWindows.add(1);

    const result = collectWindowIdsForWorkspace(
      'ws-nonexistent',
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result).toEqual([]);
  });

  it('does not include destroyed windows', () => {
    windowWorkspaceIds.set(1, 'ws-A');
    windowWorkspaceIds.set(2, 'ws-A');
    aliveWindows.add(1); // window 2 is NOT alive

    const result = collectWindowIdsForWorkspace(
      'ws-A',
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result).toEqual([1]);
  });

  it('returns multiple windows when workspace is open in several', () => {
    // ws-B is active in window 1, in background tab in window 2
    windowWorkspaceIds.set(1, 'ws-B');
    windowWorkspaceIds.set(2, 'ws-A');
    windowOpenWorkspaceTabs.set(2, ['ws-A', 'ws-B']);
    aliveWindows.add(1);
    aliveWindows.add(2);

    const result = collectWindowIdsForWorkspace(
      'ws-B',
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result.sort()).toEqual([1, 2]);
  });

  it('cleans up stale entries from destroyed windows', () => {
    windowWorkspaceIds.set(1, 'ws-A');
    windowWorkspaceIds.set(2, 'ws-B');
    windowOpenWorkspaceTabs.set(2, ['ws-B']);
    aliveWindows.add(1); // window 2 is NOT alive

    collectWindowIdsForWorkspace('ws-A', windowWorkspaceIds, windowOpenWorkspaceTabs, checker);

    expect(windowWorkspaceIds.has(2)).toBe(false);
    expect(windowOpenWorkspaceTabs.has(2)).toBe(false);
  });

  it('includes window when workspace is only in tabs (no active workspace)', () => {
    // Window navigated to home/settings — no windowWorkspaceIds entry,
    // but ws-A is still in the tab bar
    windowOpenWorkspaceTabs.set(1, ['ws-A', 'ws-B']);
    aliveWindows.add(1);

    const result = collectWindowIdsForWorkspace(
      'ws-A',
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result).toEqual([1]);
  });

  it('does not duplicate window ID when workspace is both active and in tabs', () => {
    // ws-A is both the active workspace AND in the tabs list
    windowWorkspaceIds.set(1, 'ws-A');
    windowOpenWorkspaceTabs.set(1, ['ws-A', 'ws-B']);
    aliveWindows.add(1);

    const result = collectWindowIdsForWorkspace(
      'ws-A',
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result).toEqual([1]);
  });
});
