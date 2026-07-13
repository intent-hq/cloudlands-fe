import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import type { AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { createAgentId, createWorkspaceId } from '$shared/types/branded-ids';
import {
  agentSessionReducer,
  bulkUpsertSessions,
  initialState as agentSessionInitialState,
} from '../agent-session/agent-session-slice';
import { selectChiefThreadPreview, selectChiefThreads } from './sidebar-nav-selectors';
import { CHIEF_WORKSPACE_ID } from './sidebar-nav-types';

function message(
  id: string,
  role: AgentMessage['role'],
  text: string,
  timestamp: string,
): AgentMessage {
  return {
    id,
    role,
    timestamp,
    contentBlocks: [{ type: 'text', text }],
  } as AgentMessage;
}

function session(
  id: string,
  workspaceId: string,
  messages: AgentMessage[],
  updatedAt: string,
  flags: Partial<Pick<AgentSession, 'isStreaming' | 'isProcessing' | 'isResponding'>> = {},
): AgentSession {
  return {
    id: createAgentId(id),
    backendSessionId: null,
    workspaceId: createWorkspaceId(workspaceId),
    name: `Agent ${id}`,
    status: AgentStatus.Active,
    messages,
    createdAt: updatedAt,
    updatedAt,
    lastActivity: updatedAt,
    ...flags,
  } as AgentSession;
}

function stateWithSessions(
  sessions: AgentSession[],
  indexedIds?: string[],
  trackedAgentIds?: string[],
): StoreState {
  return {
    agentSessions: {
      byAgentId: Object.fromEntries(sessions.map((item) => [item.id, item])),
      agentIdsByWorkspace: indexedIds ? { [CHIEF_WORKSPACE_ID]: indexedIds } : {},
    },
    workspaceAgents: trackedAgentIds
      ? {
          byWorkspaceId: {
            [CHIEF_WORKSPACE_ID]: { agentIds: trackedAgentIds },
          },
        }
      : undefined,
  } as unknown as StoreState;
}

describe('sidebar nav Chief selectors', () => {
  it('returns Chief threads sorted by latest activity', () => {
    const older = session(
      'agent-chief-older',
      CHIEF_WORKSPACE_ID,
      [message('m1', 'user', 'Older task', '2026-01-01T10:00:00.000Z')],
      '2026-01-01T10:00:00.000Z',
    );
    const newer = session(
      'agent-chief-newer',
      CHIEF_WORKSPACE_ID,
      [
        message('m2', 'user', 'Newer task', '2026-01-01T11:00:00.000Z'),
        message('m3', 'assistant', 'Latest answer', '2026-01-01T11:05:00.000Z'),
      ],
      '2026-01-01T11:00:00.000Z',
      { isStreaming: true },
    );
    const otherWorkspace = session(
      'agent-other',
      'alpha-beta-1234',
      [message('m4', 'user', 'Ignore me', '2026-01-01T12:00:00.000Z')],
      '2026-01-01T12:00:00.000Z',
    );

    const result = selectChiefThreads.select(stateWithSessions([older, newer, otherWorkspace]));

    expect(result.map((thread) => thread.agentId)).toEqual([newer.id, older.id]);
    expect(result[0]).toMatchObject({
      title: 'Newer task',
      preview: 'Latest answer',
      isActive: true,
      messageCount: 2,
    });
  });

  it('uses the workspace index for the latest Chief preview when present', () => {
    const latest = session(
      'agent-chief-indexed',
      CHIEF_WORKSPACE_ID,
      [message('m5', 'user', 'Indexed Chief thread', '2026-01-01T13:00:00.000Z')],
      '2026-01-01T13:00:00.000Z',
    );
    const unindexed = session(
      'agent-chief-unindexed',
      CHIEF_WORKSPACE_ID,
      [message('m6', 'user', 'Should not appear', '2026-01-01T14:00:00.000Z')],
      '2026-01-01T14:00:00.000Z',
    );

    const result = selectChiefThreadPreview.select(
      stateWithSessions([latest, unindexed], [String(latest.id)]),
    );

    expect(result).toMatchObject({
      agentId: latest.id,
      title: 'Indexed Chief thread',
      preview: 'Indexed Chief thread',
      messageCount: 1,
    });
  });

  it('hides Chief threads removed from workspaceAgents (soft-delete with undo)', () => {
    const kept = session(
      'agent-chief-kept',
      CHIEF_WORKSPACE_ID,
      [message('m7', 'user', 'Still here', '2026-01-01T15:00:00.000Z')],
      '2026-01-01T15:00:00.000Z',
    );
    const removed = session(
      'agent-chief-removed',
      CHIEF_WORKSPACE_ID,
      [message('m8', 'user', 'Pending deletion', '2026-01-01T16:00:00.000Z')],
      '2026-01-01T16:00:00.000Z',
    );

    const result = selectChiefThreads.select(
      stateWithSessions([kept, removed], [String(kept.id), String(removed.id)], [String(kept.id)]),
    );

    expect(result.map((thread) => thread.agentId)).toEqual([kept.id]);
  });

  it('returns an empty Chief thread upserted through agent-session state', () => {
    const chief = {
      ...session('agent-chief-empty', CHIEF_WORKSPACE_ID, [], '2026-01-01T15:00:00.000Z'),
      name: 'Chief of Staff',
    };
    const agentSessions = agentSessionReducer(
      agentSessionInitialState,
      bulkUpsertSessions([chief], { preserveExplicitRuntimeFlags: false }),
    );

    const result = selectChiefThreads.select({ agentSessions } as unknown as StoreState);

    expect(agentSessions.byAgentId[String(chief.id)]?.workspaceId).toBe(CHIEF_WORKSPACE_ID);
    expect(agentSessions.agentIdsByWorkspace[CHIEF_WORKSPACE_ID]).toEqual([String(chief.id)]);
    expect(result).toEqual([
      expect.objectContaining({
        agentId: chief.id,
        title: 'New chat with Intent',
        preview: 'No messages yet.',
        messageCount: 0,
      }),
    ]);
  });

  it('uses the neutral title for empty generated Chief thread names', () => {
    const chief = {
      ...session('agent-chief-generated', CHIEF_WORKSPACE_ID, [], '2026-01-01T15:00:00.000Z'),
      name: 'New thread May 1st',
    };

    const result = selectChiefThreads.select(stateWithSessions([chief]));

    expect(result).toEqual([
      expect.objectContaining({
        agentId: chief.id,
        title: 'New chat with Intent',
        preview: 'No messages yet.',
        messageCount: 0,
      }),
    ]);
  });
});
