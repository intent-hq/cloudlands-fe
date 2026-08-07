/**
 * focus-first-unread-agent tests.
 *
 * The store is faked with a mutable state object (the key-switch-service
 * pattern) and the store-subscription seam is injected via `deps.subscribe`
 * so the async "agents load after navigation" path is deterministic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockSession {
  lastMessageRole?: 'user' | 'assistant';
}

const mockState = {
  workspace: { activeWorkspaceId: null as string | null },
  workspaceAgents: {
    byWorkspaceId: {} as Record<
      string,
      { foregroundAgentIds: string[]; agentsLoaded: boolean; activeAgentId: string | null }
    >,
  },
  agentSessions: { byAgentId: {} as Record<string, MockSession> },
};

const dispatched: { type: string; payload?: unknown }[] = [];

vi.mock('$store/renderer/store', () => ({
  store: {
    get state() {
      return mockState;
    },
    dispatch: vi.fn((action: { type: string }) => {
      dispatched.push(action);
      return action;
    }),
    getReadableState: () => ({ subscribe: () => () => {} }),
  },
}));

import {
  findFirstUnreadForegroundAgentId,
  focusFirstUnreadAgent,
} from '../focus-first-unread-agent';

const WS = 'ws-1';

function seedAgents(
  foregroundAgentIds: string[],
  agentsLoaded: boolean,
  activeAgentId: string | null = null,
): void {
  mockState.workspaceAgents.byWorkspaceId[WS] = {
    foregroundAgentIds,
    agentsLoaded,
    activeAgentId,
  };
}

function seedSessions(sessions: Record<string, MockSession>): void {
  mockState.agentSessions.byAgentId = sessions;
}

interface SubscribeSeam {
  subscribe: (listener: () => void) => () => void;
  notify: () => void;
  unsubscribeCalls: () => number;
}

/** Controllable store-change seam: `notify()` replays the store listener. */
function createSubscribeSeam(): SubscribeSeam {
  let listener: (() => void) | null = null;
  let unsubscribeCalls = 0;
  return {
    subscribe: (fn) => {
      listener = fn;
      return () => {
        unsubscribeCalls++;
        listener = null;
      };
    },
    notify: () => listener?.(),
    unsubscribeCalls: () => unsubscribeCalls,
  };
}

function dispatchedTypes(): string[] {
  return dispatched.map((action) => action.type);
}

beforeEach(() => {
  dispatched.length = 0;
  mockState.workspace.activeWorkspaceId = WS;
  mockState.workspaceAgents.byWorkspaceId = {};
  mockState.agentSessions.byAgentId = {};
});

describe('findFirstUnreadForegroundAgentId', () => {
  it('returns the first foreground agent that spoke last, in foregroundAgentIds order', () => {
    seedAgents(['agent-a', 'agent-b', 'agent-c'], true);
    seedSessions({
      'agent-a': { lastMessageRole: 'user' },
      'agent-b': { lastMessageRole: 'assistant' },
      'agent-c': { lastMessageRole: 'assistant' },
    });
    expect(findFirstUnreadForegroundAgentId(WS)).toBe('agent-b');
  });

  it('returns null when the user spoke last in every foreground agent', () => {
    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': { lastMessageRole: 'user' } });
    expect(findFirstUnreadForegroundAgentId(WS)).toBeNull();
  });

  it('returns null when the role is absent (older daemons omit lastMessageRole)', () => {
    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': {} });
    expect(findFirstUnreadForegroundAgentId(WS)).toBeNull();
  });

  it('ignores background agents (not in foregroundAgentIds)', () => {
    seedAgents(['agent-a'], true);
    seedSessions({
      'agent-a': { lastMessageRole: 'user' },
      'agent-bg': { lastMessageRole: 'assistant' },
    });
    expect(findFirstUnreadForegroundAgentId(WS)).toBeNull();
  });
});

describe('focusFirstUnreadAgent', () => {
  it('activates and opens the tab for the first candidate already in the store', () => {
    seedAgents(['agent-a', 'agent-b'], true);
    seedSessions({
      'agent-a': { lastMessageRole: 'user' },
      'agent-b': { lastMessageRole: 'assistant' },
    });

    focusFirstUnreadAgent(WS, true);

    expect(dispatchedTypes()).toEqual([
      'workspaceAgents/setActiveAgentId',
      'appLayout/openAgentTabRequested',
    ]);
    expect(dispatched[0].payload).toEqual([WS, 'agent-b']);
    expect(dispatched[1].payload).toEqual([WS, { agentId: 'agent-b' }]);
  });

  it('dispatches nothing and arms no watch when the workspace was not unread', () => {
    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': { lastMessageRole: 'assistant' } });
    const seam = createSubscribeSeam();

    focusFirstUnreadAgent(WS, false, seam);

    expect(dispatched).toEqual([]);
    seam.notify();
    expect(dispatched).toEqual([]);
  });

  it('dispatches nothing when agents are loaded and none is a candidate', () => {
    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': { lastMessageRole: 'user' } });

    focusFirstUnreadAgent(WS, true, { subscribe: () => () => {} });

    expect(dispatched).toEqual([]);
  });

  it('switches once the agent sessions land after navigation', () => {
    const seam = createSubscribeSeam();
    focusFirstUnreadAgent(WS, true, seam);
    expect(dispatched).toEqual([]);

    // Load lands: foreground list plus a session whose agent spoke last.
    seedAgents(['agent-a', 'agent-b'], true);
    seedSessions({
      'agent-a': { lastMessageRole: 'user' },
      'agent-b': { lastMessageRole: 'assistant' },
    });
    seam.notify();

    expect(dispatchedTypes()).toEqual([
      'workspaceAgents/setActiveAgentId',
      'appLayout/openAgentTabRequested',
    ]);
    expect(dispatched[0].payload).toEqual([WS, 'agent-b']);
  });

  it('keeps watching through the real multi-dispatch hydration order', () => {
    const seam = createSubscribeSeam();
    focusFirstUnreadAgent(WS, true, seam);

    // `setAgentsLoaded(wsId, true)` lands first, before setAgents /
    // bulkUpsertSessions — the watch must not stop here.
    seedAgents([], true);
    seam.notify();
    expect(dispatched).toEqual([]);

    // `setAgents` populates the foreground list; sessions are still missing.
    seedAgents(['agent-a', 'agent-b'], true);
    seam.notify();
    expect(dispatched).toEqual([]);

    // `bulkUpsertSessions` lands the sessions carrying lastMessageRole.
    seedSessions({
      'agent-a': { lastMessageRole: 'user' },
      'agent-b': { lastMessageRole: 'assistant' },
    });
    seam.notify();

    expect(dispatchedTypes()).toEqual([
      'workspaceAgents/setActiveAgentId',
      'appLayout/openAgentTabRequested',
    ]);
    expect(dispatched[0].payload).toEqual([WS, 'agent-b']);
  });

  it('stops watching once agents load with no candidate', () => {
    const seam = createSubscribeSeam();
    focusFirstUnreadAgent(WS, true, seam);

    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': { lastMessageRole: 'user' } });
    seam.notify();
    expect(dispatched).toEqual([]);

    // A later assistant message must not retroactively switch tabs.
    seedSessions({ 'agent-a': { lastMessageRole: 'assistant' } });
    seam.notify();
    expect(dispatched).toEqual([]);
  });

  it('stops watching at the timeout when hydration never completes', () => {
    vi.useFakeTimers();
    try {
      const seam = createSubscribeSeam();
      focusFirstUnreadAgent(WS, true, { ...seam, timeoutMs: 100 });

      // Only the loaded flag ever arrives (e.g. an agent-less workspace).
      seedAgents([], true);
      seam.notify();
      expect(dispatched).toEqual([]);

      vi.advanceTimersByTime(100);
      expect(seam.unsubscribeCalls()).toBe(1);

      // Watch torn down: a late candidate must not switch tabs.
      seedAgents(['agent-a'], true);
      seedSessions({ 'agent-a': { lastMessageRole: 'assistant' } });
      seam.notify();
      expect(dispatched).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('supersedes the previous pending watch instead of stacking', () => {
    const first = createSubscribeSeam();
    focusFirstUnreadAgent(WS, true, first);

    const second = createSubscribeSeam();
    focusFirstUnreadAgent(WS, true, second);

    // The first watch was torn down by the second call.
    expect(first.unsubscribeCalls()).toBe(1);

    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': { lastMessageRole: 'assistant' } });

    // A notification on the superseded seam must not dispatch.
    first.notify();
    expect(dispatched).toEqual([]);

    // Only the surviving watch acts, and exactly once.
    second.notify();
    expect(dispatchedTypes()).toEqual([
      'workspaceAgents/setActiveAgentId',
      'appLayout/openAgentTabRequested',
    ]);
  });

  it('supersedes a pending watch even on a not-unread call', () => {
    const first = createSubscribeSeam();
    focusFirstUnreadAgent(WS, true, first);

    focusFirstUnreadAgent(WS, false, createSubscribeSeam());
    expect(first.unsubscribeCalls()).toBe(1);

    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': { lastMessageRole: 'assistant' } });
    first.notify();
    expect(dispatched).toEqual([]);
  });

  it('tolerates a store seam that emits synchronously during subscribe', () => {
    // The real store readable notifies immediately on subscribe; that emission
    // reflects the state already checked, so it must not dispatch or throw.
    let listener: (() => void) | null = null;
    const subscribe = (fn: () => void) => {
      listener = fn;
      fn();
      return () => {
        listener = null;
      };
    };

    expect(() => focusFirstUnreadAgent(WS, true, { subscribe })).not.toThrow();
    expect(dispatched).toEqual([]);

    // The watch is still armed and works on the next real change.
    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': { lastMessageRole: 'assistant' } });
    listener?.();
    expect(dispatchedTypes()).toEqual([
      'workspaceAgents/setActiveAgentId',
      'appLayout/openAgentTabRequested',
    ]);
  });

  it('abandons the watch when the user navigates to another workspace', () => {
    const seam = createSubscribeSeam();
    focusFirstUnreadAgent(WS, true, seam);

    mockState.workspace.activeWorkspaceId = 'ws-other';
    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': { lastMessageRole: 'assistant' } });
    seam.notify();

    expect(dispatched).toEqual([]);
    expect(seam.unsubscribeCalls()).toBe(1);
  });

  it('tolerates arming before the navigation sets activeWorkspaceId', () => {
    // The watch arms right after `goto()` is invoked, so the store still
    // reports the previous workspace: emissions in that gap must not read as a
    // navigation away.
    mockState.workspace.activeWorkspaceId = 'ws-previous';
    const seam = createSubscribeSeam();
    focusFirstUnreadAgent(WS, true, seam);

    seedAgents(['agent-a'], true);
    seam.notify();
    expect(dispatched).toEqual([]);
    expect(seam.unsubscribeCalls()).toBe(0);

    // Navigation lands, then hydration completes.
    mockState.workspace.activeWorkspaceId = WS;
    seedSessions({ 'agent-a': { lastMessageRole: 'assistant' } });
    seam.notify();

    expect(dispatchedTypes()).toEqual([
      'workspaceAgents/setActiveAgentId',
      'appLayout/openAgentTabRequested',
    ]);
  });

  it('abandons the watch when the user leaves after the navigation landed', () => {
    mockState.workspace.activeWorkspaceId = 'ws-previous';
    const seam = createSubscribeSeam();
    focusFirstUnreadAgent(WS, true, seam);

    mockState.workspace.activeWorkspaceId = WS;
    seedAgents(['agent-a'], true);
    seam.notify();
    expect(seam.unsubscribeCalls()).toBe(0);

    // User navigates away before hydration finished.
    mockState.workspace.activeWorkspaceId = 'ws-other';
    seedSessions({ 'agent-a': { lastMessageRole: 'assistant' } });
    seam.notify();

    expect(dispatched).toEqual([]);
    expect(seam.unsubscribeCalls()).toBe(1);
  });

  it('abandons the watch when the user picks an agent tab themselves', () => {
    seedAgents([], false, 'agent-user-picked');
    const seam = createSubscribeSeam();
    focusFirstUnreadAgent(WS, true, seam);

    // User opened a different agent tab before hydration landed.
    seedAgents(['agent-a'], true, 'agent-other');
    seedSessions({ 'agent-a': { lastMessageRole: 'assistant' } });
    seam.notify();

    expect(dispatched).toEqual([]);
    expect(seam.unsubscribeCalls()).toBe(1);
  });

  it('still switches when hydration sets the default agent from no selection', () => {
    // No selection when the watch arms: hydration picking a default agent is
    // expected, not a user takeover.
    seedAgents([], false, null);
    const seam = createSubscribeSeam();
    focusFirstUnreadAgent(WS, true, seam);

    seedAgents(['agent-a', 'agent-b'], true, 'agent-a');
    seedSessions({
      'agent-a': { lastMessageRole: 'user' },
      'agent-b': { lastMessageRole: 'assistant' },
    });
    seam.notify();

    expect(dispatchedTypes()).toEqual([
      'workspaceAgents/setActiveAgentId',
      'appLayout/openAgentTabRequested',
    ]);
    expect(dispatched[0].payload).toEqual([WS, 'agent-b']);
  });
});
