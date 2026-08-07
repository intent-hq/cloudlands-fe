/**
 * focus-first-unread-agent tests.
 *
 * The store is faked with a mutable state object (the key-switch-service
 * pattern) and the store-subscription seam is injected via `deps.subscribe`
 * so the async "agents load after navigation" path is deterministic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockSession {
  hasUnread?: boolean;
}

const mockState = {
  workspaceAgents: {
    byWorkspaceId: {} as Record<
      string,
      { foregroundAgentIds: string[]; agentsLoaded: boolean }
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

function seedAgents(foregroundAgentIds: string[], agentsLoaded: boolean): void {
  mockState.workspaceAgents.byWorkspaceId[WS] = { foregroundAgentIds, agentsLoaded };
}

function seedSessions(sessions: Record<string, MockSession>): void {
  mockState.agentSessions.byAgentId = sessions;
}

/** Controllable store-change seam: `notify()` replays the store listener. */
function createSubscribeSeam(): { subscribe: (listener: () => void) => () => void; notify: () => void } {
  let listener: (() => void) | null = null;
  return {
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
    notify: () => listener?.(),
  };
}

function dispatchedTypes(): string[] {
  return dispatched.map((action) => action.type);
}

beforeEach(() => {
  dispatched.length = 0;
  mockState.workspaceAgents.byWorkspaceId = {};
  mockState.agentSessions.byAgentId = {};
});

describe('findFirstUnreadForegroundAgentId', () => {
  it('returns the first foreground agent with unread, in foregroundAgentIds order', () => {
    seedAgents(['agent-a', 'agent-b', 'agent-c'], true);
    seedSessions({
      'agent-a': { hasUnread: false },
      'agent-b': { hasUnread: true },
      'agent-c': { hasUnread: true },
    });
    expect(findFirstUnreadForegroundAgentId(WS)).toBe('agent-b');
  });

  it('returns null when no foreground agent has unread', () => {
    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': { hasUnread: false } });
    expect(findFirstUnreadForegroundAgentId(WS)).toBeNull();
  });

  it('ignores background agents (not in foregroundAgentIds)', () => {
    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': { hasUnread: false }, 'agent-bg': { hasUnread: true } });
    expect(findFirstUnreadForegroundAgentId(WS)).toBeNull();
  });
});

describe('focusFirstUnreadAgent', () => {
  it('activates and opens the tab for the first unread agent already in the store', () => {
    seedAgents(['agent-a', 'agent-b'], true);
    seedSessions({ 'agent-a': { hasUnread: false }, 'agent-b': { hasUnread: true } });

    focusFirstUnreadAgent(WS);

    expect(dispatchedTypes()).toEqual([
      'workspaceAgents/setActiveAgentId',
      'appLayout/openAgentTabRequested',
    ]);
    expect(dispatched[0].payload).toEqual([WS, 'agent-b']);
    expect(dispatched[1].payload).toEqual([WS, { agentId: 'agent-b' }]);
  });

  it('dispatches nothing when agents are loaded and none is unread', () => {
    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': { hasUnread: false } });

    focusFirstUnreadAgent(WS, { subscribe: () => () => {} });

    expect(dispatched).toEqual([]);
  });

  it('switches once the agent sessions land after navigation', () => {
    const seam = createSubscribeSeam();
    focusFirstUnreadAgent(WS, seam);
    expect(dispatched).toEqual([]);

    // Load lands: foreground list plus an unread session.
    seedAgents(['agent-a', 'agent-b'], true);
    seedSessions({ 'agent-a': { hasUnread: false }, 'agent-b': { hasUnread: true } });
    seam.notify();

    expect(dispatchedTypes()).toEqual([
      'workspaceAgents/setActiveAgentId',
      'appLayout/openAgentTabRequested',
    ]);
    expect(dispatched[0].payload).toEqual([WS, 'agent-b']);
  });

  it('keeps watching through the real multi-dispatch hydration order', () => {
    const seam = createSubscribeSeam();
    focusFirstUnreadAgent(WS, seam);

    // `setAgentsLoaded(wsId, true)` lands first, before setAgents /
    // bulkUpsertSessions — the watch must not stop here.
    seedAgents([], true);
    seam.notify();
    expect(dispatched).toEqual([]);

    // `setAgents` populates the foreground list; sessions are still missing.
    seedAgents(['agent-a', 'agent-b'], true);
    seam.notify();
    expect(dispatched).toEqual([]);

    // `bulkUpsertSessions` lands the sessions carrying hasUnread.
    seedSessions({ 'agent-a': { hasUnread: false }, 'agent-b': { hasUnread: true } });
    seam.notify();

    expect(dispatchedTypes()).toEqual([
      'workspaceAgents/setActiveAgentId',
      'appLayout/openAgentTabRequested',
    ]);
    expect(dispatched[0].payload).toEqual([WS, 'agent-b']);
  });

  it('stops watching once agents load with no unread agent', () => {
    const seam = createSubscribeSeam();
    focusFirstUnreadAgent(WS, seam);

    seedAgents(['agent-a'], true);
    seedSessions({ 'agent-a': { hasUnread: false } });
    seam.notify();
    expect(dispatched).toEqual([]);

    // A later unread arrival must not retroactively switch tabs.
    seedSessions({ 'agent-a': { hasUnread: true } });
    seam.notify();
    expect(dispatched).toEqual([]);
  });

  it('stops watching at the timeout when hydration never completes', () => {
    vi.useFakeTimers();
    try {
      const seam = createSubscribeSeam();
      focusFirstUnreadAgent(WS, { ...seam, timeoutMs: 100 });

      // Only the loaded flag ever arrives (e.g. an agent-less workspace).
      seedAgents([], true);
      seam.notify();
      expect(dispatched).toEqual([]);

      vi.advanceTimersByTime(100);

      // Watch torn down: a late unread arrival must not switch tabs.
      seedAgents(['agent-a'], true);
      seedSessions({ 'agent-a': { hasUnread: true } });
      seam.notify();
      expect(dispatched).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
