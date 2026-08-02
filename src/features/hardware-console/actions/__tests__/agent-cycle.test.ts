import { describe, expect, it } from 'vitest';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import type { Workspace } from '$shared/types';
import type { StoredAgentSession } from '$store/renderer/slices/agent-session/agent-session-types';
import {
  collectCycleAgents,
  compareLastIdleDesc,
  getLastIdleTime,
  isSessionIdle,
  isSessionInProgress,
  sessionHasFailed,
  sessionNeedsAttention,
  type AgentCycleState,
} from '../agent-cycle';

function makeSession(id: string, overrides: Record<string, unknown> = {}): StoredAgentSession {
  return { id, status: 'Completed', messages: [], ...overrides } as never;
}

function makeState(
  agentsByWorkspace: Record<string, string[]>,
  sessions: Record<string, StoredAgentSession>,
): AgentCycleState {
  return {
    workspace: {
      workspaces: createCollection(
        'id',
        Object.keys(agentsByWorkspace).map((id) => ({ id }) as unknown as Workspace),
      ),
    },
    workspaceAgents: {
      byWorkspaceId: Object.fromEntries(
        Object.entries(agentsByWorkspace).map(([wsId, ids]) => [
          wsId,
          { foregroundAgentIds: ids },
        ]),
      ),
    },
    agentSessions: { byAgentId: sessions },
  };
}

describe('predicates', () => {
  it('isSessionInProgress matches running flags and statuses only', () => {
    expect(isSessionInProgress(makeSession('a', { isProcessing: true, status: 'active' }))).toBe(
      true,
    );
    expect(isSessionInProgress(makeSession('a', { isStreaming: true, status: 'idle' }))).toBe(
      true,
    );
    expect(isSessionInProgress(makeSession('a'))).toBe(false);
    expect(isSessionInProgress(makeSession('a', { isProcessing: true, status: 'error' }))).toBe(
      false,
    );
    expect(isSessionInProgress(undefined)).toBe(false);
  });

  it('sessionNeedsAttention matches the LED attention definition', () => {
    expect(sessionNeedsAttention(makeSession('a', { attentionRequestKind: 'blocker' }))).toBe(
      true,
    );
    expect(
      sessionNeedsAttention(makeSession('a', { attentionRequestKind: 'discussion' })),
    ).toBe(true);
    expect(
      sessionNeedsAttention(
        makeSession('a', { metadata: { attentionRequestKind: 'blocker' } }),
      ),
    ).toBe(true);
    expect(sessionNeedsAttention(makeSession('a'))).toBe(false);
    expect(
      sessionNeedsAttention(
        makeSession('a', { attentionRequestKind: 'blocker', status: 'deleted' }),
      ),
    ).toBe(false);
  });

  it('sessionHasFailed matches error status only', () => {
    expect(sessionHasFailed(makeSession('a', { status: 'error' }))).toBe(true);
    expect(sessionHasFailed(makeSession('a'))).toBe(false);
    expect(sessionHasFailed(undefined)).toBe(false);
  });

  it('isSessionIdle excludes running, failed, attention, and deleted sessions', () => {
    expect(isSessionIdle(makeSession('a'))).toBe(true);
    expect(isSessionIdle(makeSession('a', { status: 'idle' }))).toBe(true);
    expect(isSessionIdle(makeSession('a', { isProcessing: true, status: 'active' }))).toBe(false);
    expect(isSessionIdle(makeSession('a', { status: 'Waiting' }))).toBe(false);
    expect(isSessionIdle(makeSession('a', { status: 'error' }))).toBe(false);
    expect(isSessionIdle(makeSession('a', { attentionRequestKind: 'blocker' }))).toBe(false);
    expect(isSessionIdle(makeSession('a', { status: 'deleted' }))).toBe(false);
    expect(isSessionIdle(undefined)).toBe(false);
  });
});

describe('ordering', () => {
  it('getLastIdleTime prefers stopReasonTimestamp over lastActivity', () => {
    const session = makeSession('a', {
      stopReasonTimestamp: '2026-08-01T12:00:00.000Z',
      lastActivity: '2026-08-01T09:00:00.000Z',
    });
    expect(getLastIdleTime(session)).toBe(Date.parse('2026-08-01T12:00:00.000Z'));
    expect(getLastIdleTime(makeSession('a', { lastActivity: '2026-08-01T09:00:00.000Z' }))).toBe(
      Date.parse('2026-08-01T09:00:00.000Z'),
    );
    expect(getLastIdleTime(makeSession('a'))).toBe(0);
    expect(getLastIdleTime(undefined)).toBe(0);
  });

  it('compareLastIdleDesc sorts most-recently-idle first', () => {
    const older = makeSession('a', { stopReasonTimestamp: '2026-08-01T08:00:00.000Z' });
    const newer = makeSession('b', { stopReasonTimestamp: '2026-08-01T10:00:00.000Z' });
    expect([older, newer].sort(compareLastIdleDesc).map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('collectCycleAgents', () => {
  it('collects matching top-level agents across workspaces in workspace order', () => {
    const state = makeState(
      { 'ws-1': ['a-1', 'a-2'], 'ws-2': ['b-1'] },
      {
        'a-1': makeSession('a-1', { status: 'error' }),
        'a-2': makeSession('a-2'),
        'b-1': makeSession('b-1', { status: 'error' }),
      },
    );
    expect(collectCycleAgents(state, sessionHasFailed)).toEqual([
      { wsId: 'ws-1', agentId: 'a-1' },
      { wsId: 'ws-2', agentId: 'b-1' },
    ]);
  });

  it('skips agents without a loaded session and applies the comparator', () => {
    const state = makeState(
      { 'ws-1': ['a-1', 'a-2', 'a-3'] },
      {
        'a-1': makeSession('a-1', { stopReasonTimestamp: '2026-08-01T08:00:00.000Z' }),
        'a-2': makeSession('a-2', { stopReasonTimestamp: '2026-08-01T10:00:00.000Z' }),
      },
    );
    const entries = collectCycleAgents(state, () => true, compareLastIdleDesc);
    expect(entries.map((entry) => entry.agentId)).toEqual(['a-2', 'a-1']);
  });
});
