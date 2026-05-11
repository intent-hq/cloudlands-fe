import { describe, expect, it } from 'vitest';
import { AgentStatus } from '$shared/types';
import type { AgentSession } from '$shared/types/agent-session';
import {
  getWorkspaceStatsSessionIds,
  getWorkspaceStatsSessionRequests,
  MAX_WORKSPACE_STATS_SESSION_IDS,
} from './workspace-session-selection';

function agent(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: `agent-${id}` as AgentSession['id'],
    backendSessionId: `backend-${id}` as AgentSession['backendSessionId'],
    acpSessionId: `acp-${id}`,
    workspaceId: 'ws-1' as AgentSession['workspaceId'],
    name: id,
    provider: 'auggie',
    status: AgentStatus.Idle,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('getWorkspaceStatsSessionIds', () => {
  it('prioritizes active and recent sessions while capping large workspaces', () => {
    const agents = Array.from({ length: 25 }, (_, i) =>
      agent(`idle-${i}`, { updatedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }),
    );
    agents.push(agent('active-old', { status: AgentStatus.Active }));

    const ids = getWorkspaceStatsSessionIds(agents);

    expect(ids).toHaveLength(MAX_WORKSPACE_STATS_SESSION_IDS);
    expect(ids[0]).toBe('acp-active-old');
    expect(ids).toContain('acp-idle-24');
    expect(ids).not.toContain('acp-idle-0');
  });

  it('filters non-Auggie agents and deduplicates resolved session IDs', () => {
    const ids = getWorkspaceStatsSessionIds([
      agent('one', { acpSessionId: 'shared-session' }),
      agent('duplicate', { acpSessionId: 'shared-session' }),
      agent('other-provider', { provider: 'codex' }),
    ]);

    expect(ids).toEqual(['shared-session']);
  });

  it('returns request metadata used for incremental refresh decisions', () => {
    const requests = getWorkspaceStatsSessionRequests([
      agent('one', {
        messages: [{ id: 'm1' }, { id: 'm2' }] as AgentSession['messages'],
        status: AgentStatus.Active,
      }),
    ]);

    expect(requests).toEqual([
      {
        agentId: 'agent-one',
        sessionId: 'acp-one',
        messageCount: 2,
        isActive: true,
      },
    ]);
  });
});