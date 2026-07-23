import { describe, it, expect } from 'vitest';
import {
  deriveWorkspaceAgentState,
  getWorkspaceAgentDisplayInfos,
  type WorkspaceAgentStateSnapshot,
} from './workspace-agent-display';

function makeSnapshot(
  overrides: Partial<WorkspaceAgentStateSnapshot> = {},
): WorkspaceAgentStateSnapshot {
  return {
    hasLoadedSession: true,
    isWaiting: false,
    isResponding: false,
    isStreamingFallback: false,
    ...overrides,
  };
}

describe('deriveWorkspaceAgentState', () => {
  it('returns running for a responding agent', () => {
    expect(deriveWorkspaceAgentState(makeSnapshot({ isResponding: true }))).toBe('running');
  });

  it('returns waiting for a waiting agent (even when also responding)', () => {
    expect(
      deriveWorkspaceAgentState(makeSnapshot({ isWaiting: true, isResponding: true })),
    ).toBe('waiting');
  });

  it('returns idle for an inactive agent', () => {
    expect(deriveWorkspaceAgentState(makeSnapshot())).toBe('idle');
  });

  it('uses the streaming fallback when the session is not loaded', () => {
    expect(
      deriveWorkspaceAgentState(
        makeSnapshot({ hasLoadedSession: false, isStreamingFallback: true }),
      ),
    ).toBe('running');
  });

  it('ignores isWaiting/isResponding when the session is not loaded', () => {
    expect(
      deriveWorkspaceAgentState(
        makeSnapshot({ hasLoadedSession: false, isWaiting: true, isResponding: true }),
      ),
    ).toBe('idle');
  });

  it('ignores the streaming fallback when the session is loaded', () => {
    expect(
      deriveWorkspaceAgentState(
        makeSnapshot({ hasLoadedSession: true, isResponding: false, isStreamingFallback: true }),
      ),
    ).toBe('idle');
  });

  it('treats workspace activity idle as authoritative over running/waiting', () => {
    expect(
      deriveWorkspaceAgentState(makeSnapshot({ isResponding: true }), 'idle'),
    ).toBe('idle');
    expect(deriveWorkspaceAgentState(makeSnapshot({ isWaiting: true }), 'idle')).toBe('idle');
  });

  it('returns failed for error/failed sessions, even when activity is idle', () => {
    expect(deriveWorkspaceAgentState(makeSnapshot({ sessionStatus: 'error' }))).toBe('failed');
    expect(deriveWorkspaceAgentState(makeSnapshot({ sessionStatus: 'failed' }))).toBe('failed');
    expect(
      deriveWorkspaceAgentState(makeSnapshot({ sessionStatus: 'failed' }), 'idle'),
    ).toBe('failed');
  });
});

describe('getWorkspaceAgentDisplayInfos', () => {
  it('returns an empty array when there are no member agents', () => {
    expect(
      getWorkspaceAgentDisplayInfos({
        memberAgentIds: [],
        unreadAgentIds: ['agent-1'],
        getAgentSnapshot: () => makeSnapshot(),
      }),
    ).toEqual([]);
  });

  it('shows responding and waiting agents, hides idle agents', () => {
    const snapshots: Record<string, WorkspaceAgentStateSnapshot> = {
      'agent-running': makeSnapshot({ isResponding: true }),
      'agent-waiting': makeSnapshot({ isWaiting: true }),
      'agent-idle': makeSnapshot(),
    };
    const result = getWorkspaceAgentDisplayInfos({
      memberAgentIds: ['agent-running', 'agent-waiting', 'agent-idle'],
      unreadAgentIds: [],
      getAgentSnapshot: (id) => snapshots[id],
    });
    expect(result).toEqual([
      { id: 'agent-running', state: 'running', specialist: null, isUnread: false },
      { id: 'agent-waiting', state: 'waiting', specialist: null, isUnread: false },
    ]);
  });

  it('shows unread idle agents', () => {
    const result = getWorkspaceAgentDisplayInfos({
      memberAgentIds: ['agent-1'],
      unreadAgentIds: ['agent-1'],
      getAgentSnapshot: () => makeSnapshot(),
    });
    expect(result).toEqual([
      { id: 'agent-1', state: 'idle', specialist: null, isUnread: true },
    ]);
  });

  it('keeps state running for an unread agent that is running (unread override happens at render)', () => {
    const result = getWorkspaceAgentDisplayInfos({
      memberAgentIds: ['agent-1'],
      unreadAgentIds: ['agent-1'],
      getAgentSnapshot: () => makeSnapshot({ isResponding: true }),
    });
    expect(result).toEqual([
      { id: 'agent-1', state: 'running', specialist: null, isUnread: true },
    ]);
  });

  it('hides running/waiting agents when workspace activity is idle, unless unread', () => {
    const snapshots: Record<string, WorkspaceAgentStateSnapshot> = {
      'agent-running': makeSnapshot({ isResponding: true }),
      'agent-waiting': makeSnapshot({ isWaiting: true }),
      'agent-unread': makeSnapshot({ isResponding: true }),
    };
    const result = getWorkspaceAgentDisplayInfos({
      memberAgentIds: ['agent-running', 'agent-waiting', 'agent-unread'],
      unreadAgentIds: ['agent-unread'],
      workspaceActivity: 'idle',
      getAgentSnapshot: (id) => snapshots[id],
    });
    expect(result).toEqual([
      { id: 'agent-unread', state: 'idle', specialist: null, isUnread: true },
    ]);
  });

  it('shows failed-session agents with the failed state', () => {
    const result = getWorkspaceAgentDisplayInfos({
      memberAgentIds: ['agent-1'],
      unreadAgentIds: [],
      getAgentSnapshot: () => makeSnapshot({ sessionStatus: 'failed' }),
    });
    expect(result).toEqual([
      { id: 'agent-1', state: 'failed', specialist: null, isUnread: false },
    ]);
  });

  it('passes through the specialist from the snapshot', () => {
    const result = getWorkspaceAgentDisplayInfos({
      memberAgentIds: ['agent-1'],
      unreadAgentIds: [],
      getAgentSnapshot: () =>
        makeSnapshot({ isResponding: true, specialist: 'implementor' }),
    });
    expect(result).toEqual([
      { id: 'agent-1', state: 'running', specialist: 'implementor', isUnread: false },
    ]);
  });
});
