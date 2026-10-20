import { describe, it, expect, beforeEach } from 'vitest';
import {
  ANY_HOST,
  collectOpenWorkspaceIds,
  collectWindowIdsForWorkspace,
  pickBackgroundHostWindow,
  type ActiveWorkspaceEntry,
  type OpenWorkspaceTabsEntry,
  type WindowHostChecker,
} from '../window-workspace-tracking';

const LOCAL = 'local';
const REMOTE = 'remote-1';

const active = (workspaceId: string, backendId = LOCAL): ActiveWorkspaceEntry => ({
  workspaceId,
  backendId,
});
const tabs = (workspaceIds: string[], backendId = LOCAL): OpenWorkspaceTabsEntry => ({
  workspaceIds,
  backendId,
});

describe('collectOpenWorkspaceIds', () => {
  let windowWorkspaceIds: Map<number, ActiveWorkspaceEntry>;
  let windowOpenWorkspaceTabs: Map<number, OpenWorkspaceTabsEntry>;
  let aliveWindows: Set<number>;
  let checker: WindowHostChecker;
  let windowHosts: Map<number, string>;

  beforeEach(() => {
    windowWorkspaceIds = new Map();
    windowOpenWorkspaceTabs = new Map();
    aliveWindows = new Set();
    windowHosts = new Map();
    checker = {
      isAlive: (id) => aliveWindows.has(id),
      backendIdOf: (id) => windowHosts.get(id) ?? LOCAL,
    };
  });

  it('returns the active workspace for a live window', () => {
    windowWorkspaceIds.set(1, active('ws-active'));
    aliveWindows.add(1);

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    expect(result).toEqual(['ws-active']);
  });

  it('includes background tab workspaces (the bug fix)', () => {
    // Window 1 is viewing ws-A, but has tabs open for ws-B and ws-C
    windowWorkspaceIds.set(1, active('ws-A'));
    windowOpenWorkspaceTabs.set(1, tabs(['ws-A', 'ws-B', 'ws-C']));
    aliveWindows.add(1);

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    expect(result.sort()).toEqual(['ws-A', 'ws-B', 'ws-C']);
  });

  it('does not include workspaces from destroyed windows', () => {
    windowWorkspaceIds.set(1, active('ws-alive'));
    windowWorkspaceIds.set(2, active('ws-dead'));
    windowOpenWorkspaceTabs.set(2, tabs(['ws-dead', 'ws-also-dead']));
    aliveWindows.add(1); // window 2 is NOT alive

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    expect(result).toEqual(['ws-alive']);
  });

  it('cleans up stale entries from both maps', () => {
    windowWorkspaceIds.set(1, active('ws-alive'));
    windowWorkspaceIds.set(2, active('ws-stale'));
    windowOpenWorkspaceTabs.set(2, tabs(['ws-stale', 'ws-stale-tab']));
    aliveWindows.add(1); // window 2 is stale

    collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);

    expect(windowWorkspaceIds.has(2)).toBe(false);
    expect(windowOpenWorkspaceTabs.has(2)).toBe(false);
    // Window 1 untouched
    expect(windowWorkspaceIds.get(1)).toEqual(active('ws-alive'));
  });

  it('deduplicates workspace IDs across active and tabs', () => {
    windowWorkspaceIds.set(1, active('ws-A'));
    windowOpenWorkspaceTabs.set(1, tabs(['ws-A', 'ws-B']));
    aliveWindows.add(1);

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    // ws-A should appear only once despite being in both maps
    expect(result.sort()).toEqual(['ws-A', 'ws-B']);
  });

  it('handles multiple windows with overlapping tabs', () => {
    windowWorkspaceIds.set(1, active('ws-A'));
    windowOpenWorkspaceTabs.set(1, tabs(['ws-A', 'ws-B']));
    windowWorkspaceIds.set(2, active('ws-C'));
    windowOpenWorkspaceTabs.set(2, tabs(['ws-B', 'ws-C', 'ws-D']));
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
    windowWorkspaceIds.set(1, active('ws-A'));
    aliveWindows.add(1);
    // No windowOpenWorkspaceTabs entry for window 1

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    expect(result).toEqual(['ws-A']);
  });

  it('includes tabs when window navigates away from workspace (no active workspace)', () => {
    // Window navigated to home/settings — no windowWorkspaceIds entry,
    // but tabs are still open in the tab bar
    windowOpenWorkspaceTabs.set(1, tabs(['ws-A', 'ws-B']));
    aliveWindows.add(1);
    // Notably: windowWorkspaceIds does NOT have an entry for window 1

    const result = collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);
    expect(result.sort()).toEqual(['ws-A', 'ws-B']);
  });

  it('cleans up stale tabs-only entries (no active workspace)', () => {
    // Window 1 is alive with tabs only, window 2 is destroyed with tabs only
    windowOpenWorkspaceTabs.set(1, tabs(['ws-A']));
    windowOpenWorkspaceTabs.set(2, tabs(['ws-B']));
    aliveWindows.add(1); // window 2 is NOT alive

    collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, checker);

    expect(windowOpenWorkspaceTabs.has(1)).toBe(true);
    expect(windowOpenWorkspaceTabs.has(2)).toBe(false);
  });
});

describe('collectWindowIdsForWorkspace', () => {
  let windowWorkspaceIds: Map<number, ActiveWorkspaceEntry>;
  let windowOpenWorkspaceTabs: Map<number, OpenWorkspaceTabsEntry>;
  let aliveWindows: Set<number>;
  let checker: WindowHostChecker;
  let windowHosts: Map<number, string>;

  beforeEach(() => {
    windowWorkspaceIds = new Map();
    windowOpenWorkspaceTabs = new Map();
    aliveWindows = new Set();
    windowHosts = new Map();
    checker = {
      isAlive: (id) => aliveWindows.has(id),
      backendIdOf: (id) => windowHosts.get(id) ?? LOCAL,
    };
  });

  it('returns window ID when workspace is actively viewed', () => {
    windowWorkspaceIds.set(1, active('ws-A'));
    aliveWindows.add(1);

    const result = collectWindowIdsForWorkspace(
      'ws-A',
      ANY_HOST,
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result).toEqual([1]);
  });

  it('returns window ID when workspace is in background tabs (the bug fix)', () => {
    // Window 1 is viewing ws-A, but has ws-B open in background tab
    windowWorkspaceIds.set(1, active('ws-A'));
    windowOpenWorkspaceTabs.set(1, tabs(['ws-A', 'ws-B', 'ws-C']));
    aliveWindows.add(1);

    const result = collectWindowIdsForWorkspace(
      'ws-B',
      ANY_HOST,
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result).toEqual([1]);
  });

  it('returns empty array when workspace is not open anywhere', () => {
    windowWorkspaceIds.set(1, active('ws-A'));
    windowOpenWorkspaceTabs.set(1, tabs(['ws-A']));
    aliveWindows.add(1);

    const result = collectWindowIdsForWorkspace(
      'ws-nonexistent',
      ANY_HOST,
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result).toEqual([]);
  });

  it('does not include destroyed windows', () => {
    windowWorkspaceIds.set(1, active('ws-A'));
    windowWorkspaceIds.set(2, active('ws-A'));
    aliveWindows.add(1); // window 2 is NOT alive

    const result = collectWindowIdsForWorkspace(
      'ws-A',
      ANY_HOST,
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result).toEqual([1]);
  });

  it('returns multiple windows when workspace is open in several', () => {
    // ws-B is active in window 1, in background tab in window 2
    windowWorkspaceIds.set(1, active('ws-B'));
    windowWorkspaceIds.set(2, active('ws-A'));
    windowOpenWorkspaceTabs.set(2, tabs(['ws-A', 'ws-B']));
    aliveWindows.add(1);
    aliveWindows.add(2);

    const result = collectWindowIdsForWorkspace(
      'ws-B',
      ANY_HOST,
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result.sort()).toEqual([1, 2]);
  });

  it('cleans up stale entries from destroyed windows', () => {
    windowWorkspaceIds.set(1, active('ws-A'));
    windowWorkspaceIds.set(2, active('ws-B'));
    windowOpenWorkspaceTabs.set(2, tabs(['ws-B']));
    aliveWindows.add(1); // window 2 is NOT alive

    collectWindowIdsForWorkspace(
      'ws-A',
      ANY_HOST,
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );

    expect(windowWorkspaceIds.has(2)).toBe(false);
    expect(windowOpenWorkspaceTabs.has(2)).toBe(false);
  });

  it('includes window when workspace is only in tabs (no active workspace)', () => {
    // Window navigated to home/settings — no windowWorkspaceIds entry,
    // but ws-A is still in the tab bar
    windowOpenWorkspaceTabs.set(1, tabs(['ws-A', 'ws-B']));
    aliveWindows.add(1);

    const result = collectWindowIdsForWorkspace(
      'ws-A',
      ANY_HOST,
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result).toEqual([1]);
  });

  it('does not duplicate window ID when workspace is both active and in tabs', () => {
    // ws-A is both the active workspace AND in the tabs list
    windowWorkspaceIds.set(1, active('ws-A'));
    windowOpenWorkspaceTabs.set(1, tabs(['ws-A', 'ws-B']));
    aliveWindows.add(1);

    const result = collectWindowIdsForWorkspace(
      'ws-A',
      ANY_HOST,
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
    );
    expect(result).toEqual([1]);
  });

  describe('host scoping', () => {
    it('returns only the requested host windows for a workspace id shared across hosts', () => {
      // The Assistant's virtual workspace id is the same on every host.
      windowWorkspaceIds.set(1, active('__chief__', LOCAL));
      windowWorkspaceIds.set(2, active('__chief__', REMOTE));
      windowHosts.set(2, REMOTE);
      aliveWindows.add(1);
      aliveWindows.add(2);

      const lookup = (scope: string | typeof ANY_HOST) =>
        collectWindowIdsForWorkspace(
          '__chief__',
          scope,
          windowWorkspaceIds,
          windowOpenWorkspaceTabs,
          checker,
        );
      expect(lookup(REMOTE)).toEqual([2]);
      expect(lookup(LOCAL)).toEqual([1]);
      expect(lookup(ANY_HOST).sort()).toEqual([1, 2]);
    });

    it('scopes background-tab matches by host too', () => {
      windowOpenWorkspaceTabs.set(1, tabs(['ws-A'], LOCAL));
      windowOpenWorkspaceTabs.set(2, tabs(['ws-A'], REMOTE));
      windowHosts.set(2, REMOTE);
      aliveWindows.add(1);
      aliveWindows.add(2);

      expect(
        collectWindowIdsForWorkspace(
          'ws-A',
          REMOTE,
          windowWorkspaceIds,
          windowOpenWorkspaceTabs,
          checker,
        ),
      ).toEqual([2]);
    });

    it('stops matching a window that reconnected to another host since it reported', () => {
      windowWorkspaceIds.set(1, active('ws-A', LOCAL));
      windowOpenWorkspaceTabs.set(1, tabs(['ws-A'], LOCAL));
      aliveWindows.add(1);
      // The window is now connected to the remote host but has not re-reported.
      windowHosts.set(1, REMOTE);

      for (const scope of [LOCAL, REMOTE, ANY_HOST] as const) {
        expect(
          collectWindowIdsForWorkspace(
            'ws-A',
            scope,
            windowWorkspaceIds,
            windowOpenWorkspaceTabs,
            checker,
          ),
        ).toEqual([]);
      }
    });
  });
});

describe('background-hosted workspaces', () => {
  let windowWorkspaceIds: Map<number, ActiveWorkspaceEntry>;
  let windowOpenWorkspaceTabs: Map<number, OpenWorkspaceTabsEntry>;
  let windowBackgroundWorkspaces: Map<number, OpenWorkspaceTabsEntry>;
  let aliveWindows: Set<number>;
  let windowHosts: Map<number, string>;
  let checker: WindowHostChecker;

  beforeEach(() => {
    windowWorkspaceIds = new Map();
    windowOpenWorkspaceTabs = new Map();
    windowBackgroundWorkspaces = new Map();
    aliveWindows = new Set();
    windowHosts = new Map();
    checker = {
      isAlive: (id) => aliveWindows.has(id),
      backendIdOf: (id) => windowHosts.get(id) ?? LOCAL,
    };
  });

  const lookup = (workspaceId: string, scope: string | typeof ANY_HOST) =>
    collectWindowIdsForWorkspace(
      workspaceId,
      scope,
      windowWorkspaceIds,
      windowOpenWorkspaceTabs,
      checker,
      windowBackgroundWorkspaces,
    );

  it('routes to a window hosting the workspace in the background (no tab, not viewed)', () => {
    windowWorkspaceIds.set(1, active('ws-viewed'));
    windowOpenWorkspaceTabs.set(1, tabs(['ws-viewed']));
    windowBackgroundWorkspaces.set(1, tabs(['ws-closed']));
    aliveWindows.add(1);

    expect(lookup('ws-closed', LOCAL)).toEqual([1]);
    expect(lookup('ws-other', LOCAL)).toEqual([]);
  });

  it('scopes background matches by host and drops them after the window changes host', () => {
    windowBackgroundWorkspaces.set(1, tabs(['ws-closed'], LOCAL));
    aliveWindows.add(1);

    expect(lookup('ws-closed', REMOTE)).toEqual([]);
    expect(lookup('ws-closed', LOCAL)).toEqual([1]);

    windowHosts.set(1, REMOTE);
    expect(lookup('ws-closed', ANY_HOST)).toEqual([]);
  });

  it('ignores background hosts while a window genuinely has the workspace open', () => {
    windowBackgroundWorkspaces.set(1, tabs(['ws-A']));
    windowOpenWorkspaceTabs.set(2, tabs(['ws-A']));
    aliveWindows.add(1);
    aliveWindows.add(2);

    expect(lookup('ws-A', LOCAL)).toEqual([2]);
    windowOpenWorkspaceTabs.delete(2);
    expect(lookup('ws-A', LOCAL)).toEqual([1]);
  });

  it('counts background workspaces as open so their caches are not trimmed', () => {
    windowOpenWorkspaceTabs.set(1, tabs(['ws-tab']));
    windowBackgroundWorkspaces.set(1, tabs(['ws-closed']));
    aliveWindows.add(1);

    expect(
      collectOpenWorkspaceIds(
        windowWorkspaceIds,
        windowOpenWorkspaceTabs,
        checker,
        windowBackgroundWorkspaces,
      ).sort(),
    ).toEqual(['ws-closed', 'ws-tab']);
  });

  it('cleans up background entries of destroyed windows', () => {
    windowBackgroundWorkspaces.set(2, tabs(['ws-closed']));

    expect(lookup('ws-closed', LOCAL)).toEqual([]);
    expect(windowBackgroundWorkspaces.has(2)).toBe(false);
  });
});

describe('pickBackgroundHostWindow', () => {
  const checker = (alive: number[], hosts: Record<number, string> = {}): WindowHostChecker => ({
    isAlive: (id) => alive.includes(id),
    backendIdOf: (id) => (alive.includes(id) ? (hosts[id] ?? LOCAL) : null),
  });

  it('returns the first live candidate connected to the owning host', () => {
    expect(pickBackgroundHostWindow(LOCAL, [3, 1, 2], checker([1, 2, 3]))).toBe(3);
    expect(pickBackgroundHostWindow(REMOTE, [3, 1, 2], checker([1, 2, 3], { 2: REMOTE }))).toBe(2);
  });

  it('skips dead windows and windows on other hosts', () => {
    expect(pickBackgroundHostWindow(LOCAL, [3, 1], checker([1], { 1: LOCAL }))).toBe(1);
    expect(pickBackgroundHostWindow(LOCAL, [1, 2], checker([1, 2], { 1: REMOTE, 2: REMOTE }))).toBe(
      undefined,
    );
    expect(pickBackgroundHostWindow(LOCAL, [], checker([]))).toBeUndefined();
  });
});
