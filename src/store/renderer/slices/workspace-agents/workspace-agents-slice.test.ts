import type { AgentSession, AgentStatus } from '$shared/types';
import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import { selectAgentQueuedMessages } from '../agent-session/agent-session-selectors';
import {
  agentQueueReducer,
  initialState as initialAgentQueueState,
  replaceAgentQueue,
} from '../agent-queue/agent-queue-slice';
import {
  selectActiveAgent,
  selectAllWorkspaceAgents,
  selectBackgroundWorkspaceAgents,
  selectAgentsLoaded,
  selectForegroundWorkspaceAgents,
  selectInitialAgentId,
  selectDiskMessageCount,
  selectIsLoadingAgents,
  selectRecentlyCreatedAgents,
  selectWorkspaceAgentIsSoftDeleted,
  selectWorkspaceAgentIsStreaming,
  selectWorkspaceAgentSession,
  selectWorkspaceForegroundAgentIds,
  selectWorkspaceHasAgent,
} from './workspace-agents-selectors';
import { createAgentRequested, createAgentWithSpecialistRequested, emptyWorkspaceAgentState, initialState, markAgentRecentlyCreated, setActiveAgentId, setAgents, setInitialAgentId, workspaceAgentsReducer } from './workspace-agents-slice';
import { upsertSession } from '../agent-session/agent-session-slice';
import { selectAgentSession } from '../agent-session/agent-session-selectors';

const WS_1 = 'ws-1';
const WS_2 = 'ws-2';

const mockAgent = (id: string, workspaceId = WS_1, name = 'Agent'): AgentSession => ({
  id,
  backendSessionId: null,
  workspaceId,
  name,
  status: 'active' as AgentStatus,
  messages: [],
  createdAt: '2026-03-19T00:00:00.000Z',
  updatedAt: '2026-03-19T00:00:00.000Z',
});

const mockBackgroundAgent = (id: string, workspaceId = WS_1): AgentSession => ({
  ...mockAgent(id, workspaceId),
  isBackground: true,
});

const mockMetadataBackgroundAgent = (id: string, workspaceId = WS_1): AgentSession => ({
  ...mockAgent(id, workspaceId),
  metadata: { isBackground: true } as AgentSession['metadata'],
});

/**
 * Build a mock StoreState with both workspaceAgents and agentSessions data.
 * Session data now lives in agentSessions; workspaceAgents only tracks IDs.
 */
function mockState(
  overrides: Partial<StoreState['workspaceAgents']> = {},
  sessions: AgentSession[] = [],
): StoreState {
  const byAgentId: Record<string, any> = {};
  for (const s of sessions) {
    byAgentId[s.id] = s;
  }
  return {
    workspaceAgents: {
      ...initialState,
      ...overrides,
    },
    agentSessions: {
      byAgentId,
    },
  } as StoreState;
}

describe('workspaceAgentsReducer', () => {
  it('returns the initial state', () => {
    expect(workspaceAgentsReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('stores agent IDs for a workspace', () => {
    const agents = [mockAgent('agent-1'), mockAgent('agent-2')];

    expect(workspaceAgentsReducer(initialState, setAgents(WS_1, agents))).toEqual({
      byWorkspaceId: {
        [WS_1]: {
          ...emptyWorkspaceAgentState,
          agentIds: ['agent-1', 'agent-2'],
          foregroundAgentIds: ['agent-1', 'agent-2'],
        },
      },
    });
  });

  it('tracks recently created agents per workspace', () => {
    let state = workspaceAgentsReducer(initialState, markAgentRecentlyCreated(WS_1, 'agent-1'));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, 'agent-1'));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, 'agent-2'));

    expect(state.byWorkspaceId[WS_1].recentlyCreatedAgents).toEqual(['agent-1', 'agent-2']);
  });

  it('reconciles foreground agent IDs from disk snapshots', () => {
    let state = workspaceAgentsReducer(
      initialState,
      setAgents(WS_1, [mockBackgroundAgent('agent-1'), mockAgent('agent-2')]),
    );

    expect(state.byWorkspaceId[WS_1].foregroundAgentIds).toEqual(['agent-2']);

    state = workspaceAgentsReducer(
      state,
      setAgents(WS_1, [
        mockAgent('agent-1'),
        mockMetadataBackgroundAgent('agent-2'),
        mockAgent('agent-3'),
      ]),
    );

    expect(state.byWorkspaceId[WS_1].agentIds).toEqual(['agent-1', 'agent-2', 'agent-3']);
    expect(state.byWorkspaceId[WS_1].foregroundAgentIds).toEqual(['agent-1', 'agent-3']);
  });
});

describe('workspace-agents actions', () => {
  it('creates a createAgentRequested action', () => {
    expect(createAgentRequested(WS_1, 'chat')).toEqual({
      type: createAgentRequested.type,
      payload: [WS_1, 'chat'],
    });
  });

  it('creates a createAgentWithSpecialistRequested action', () => {
    expect(createAgentWithSpecialistRequested(WS_1, 'implementor')).toEqual({
      type: createAgentWithSpecialistRequested.type,
      payload: [WS_1, 'implementor'],
    });
  });
});

describe('workspace-agents selectors', () => {
  it('returns empty defaults for a workspace with no agent state', () => {
    const state = mockState();

    expect(selectAllWorkspaceAgents.select(state, WS_1)).toEqual([]);
    expect(selectWorkspaceForegroundAgentIds.select(state, WS_1)).toEqual([]);
    expect(selectBackgroundWorkspaceAgents.select(state, WS_1)).toEqual([]);
    expect(selectForegroundWorkspaceAgents.select(state, WS_1)).toEqual([]);
    expect(selectAgentsLoaded.select(state, WS_1)).toBe(false);
    expect(selectIsLoadingAgents.select(state, WS_1)).toBe(false);
    expect(selectInitialAgentId.select(state, WS_1)).toBeNull();
    expect(selectRecentlyCreatedAgents.select(state, WS_1)).toEqual([]);
  });

  it('keeps raw selectors inclusive while foreground selectors hide reducer-maintained background agents', () => {
    const foregroundAgent = mockAgent('agent-1');
    const backgroundAgent = {
      ...mockAgent('agent-2'),
      isBackground: true,
    } satisfies AgentSession;
    const metadataBackgroundAgent = {
      ...mockAgent('agent-3'),
      metadata: { isBackground: true } as AgentSession['metadata'],
    } satisfies AgentSession;
    const workspaceAgents = workspaceAgentsReducer(
      initialState,
      setAgents(WS_1, [foregroundAgent, backgroundAgent, metadataBackgroundAgent]),
    );
    const state = mockState(workspaceAgents, [
      foregroundAgent,
      backgroundAgent,
      metadataBackgroundAgent,
    ]);

    expect(selectAllWorkspaceAgents.select(state, WS_1)).toEqual([
      foregroundAgent,
      backgroundAgent,
      metadataBackgroundAgent,
    ]);
    expect(selectWorkspaceForegroundAgentIds.select(state, WS_1)).toEqual(['agent-1']);
    expect(selectBackgroundWorkspaceAgents.select(state, WS_1)).toEqual([
      backgroundAgent,
      metadataBackgroundAgent,
    ]);
    expect(selectForegroundWorkspaceAgents.select(state, WS_1)).toEqual([foregroundAgent]);
  });

  it('uses foreground agent IDs for foreground list derivation instead of session background flags', () => {
    const foregroundAgent = mockAgent('agent-1');
    const idTrackedBackgroundAgent = mockAgent('agent-2');
    const flagOnlyAgent = mockBackgroundAgent('agent-3');
    const state = mockState(
      {
        byWorkspaceId: {
          [WS_1]: {
            ...emptyWorkspaceAgentState,
            agentIds: ['agent-1', 'agent-2', 'agent-3'],
            foregroundAgentIds: ['agent-1', 'agent-3'],
          },
        },
      },
      [foregroundAgent, idTrackedBackgroundAgent, flagOnlyAgent],
    );

    expect(selectWorkspaceForegroundAgentIds.select(state, WS_1)).toEqual(['agent-1', 'agent-3']);
    expect(selectBackgroundWorkspaceAgents.select(state, WS_1)).toEqual([idTrackedBackgroundAgent]);
    expect(selectForegroundWorkspaceAgents.select(state, WS_1)).toEqual([
      foregroundAgent,
      flagOnlyAgent,
    ]);
  });

  describe('selectInitialAgentId metadata fallback', () => {
    const initialFlaggedAgent = (id: string): AgentSession => ({
      ...mockAgent(id),
      metadata: { isInitialAgent: true } as AgentSession['metadata'],
    });

    it('falls back to the agent flagged metadata.isInitialAgent when the in-memory id is unset', () => {
      const plainAgent = mockAgent('agent-1');
      const flaggedAgent = initialFlaggedAgent('agent-2');
      const workspaceAgents = workspaceAgentsReducer(
        initialState,
        setAgents(WS_1, [plainAgent, flaggedAgent]),
      );
      const state = mockState(workspaceAgents, [plainAgent, flaggedAgent]);

      expect(selectInitialAgentId.select(state, WS_1)).toBe('agent-2');
    });

    it('prefers the explicitly set in-memory initialAgentId over the metadata flag', () => {
      const plainAgent = mockAgent('agent-1');
      const flaggedAgent = initialFlaggedAgent('agent-2');
      let workspaceAgents = workspaceAgentsReducer(
        initialState,
        setAgents(WS_1, [plainAgent, flaggedAgent]),
      );
      workspaceAgents = workspaceAgentsReducer(workspaceAgents, setInitialAgentId(WS_1, 'agent-1'));
      const state = mockState(workspaceAgents, [plainAgent, flaggedAgent]);

      expect(selectInitialAgentId.select(state, WS_1)).toBe('agent-1');
    });

    it('stays null when no agent carries the metadata flag (older daemons)', () => {
      const plainAgent = mockAgent('agent-1');
      const otherAgent = mockAgent('agent-2');
      const workspaceAgents = workspaceAgentsReducer(
        initialState,
        setAgents(WS_1, [plainAgent, otherAgent]),
      );
      const state = mockState(workspaceAgents, [plainAgent, otherAgent]);

      expect(selectInitialAgentId.select(state, WS_1)).toBeNull();
    });

    it('ignores non-true metadata values and agents from other workspaces', () => {
      const falseFlagged = {
        ...mockAgent('agent-1'),
        metadata: { isInitialAgent: false } as AgentSession['metadata'],
      } satisfies AgentSession;
      const otherWorkspaceFlagged = {
        ...initialFlaggedAgent('agent-2'),
        workspaceId: WS_2,
      } satisfies AgentSession;
      let workspaceAgents = workspaceAgentsReducer(initialState, setAgents(WS_1, [falseFlagged]));
      workspaceAgents = workspaceAgentsReducer(
        workspaceAgents,
        setAgents(WS_2, [otherWorkspaceFlagged]),
      );
      const state = mockState(workspaceAgents, [falseFlagged, otherWorkspaceFlagged]);

      expect(selectInitialAgentId.select(state, WS_1)).toBeNull();
      expect(selectInitialAgentId.select(state, WS_2)).toBe('agent-2');
    });

    it('resolves the first flagged agent in agentIds order when multiple carry the flag', () => {
      const firstFlagged = initialFlaggedAgent('agent-1');
      const secondFlagged = initialFlaggedAgent('agent-2');
      const workspaceAgents = workspaceAgentsReducer(
        initialState,
        setAgents(WS_1, [firstFlagged, secondFlagged]),
      );
      const state = mockState(workspaceAgents, [firstFlagged, secondFlagged]);

      expect(selectInitialAgentId.select(state, WS_1)).toBe('agent-1');
    });
  });

  // -----------------------------------------------------------------------
  // New actions for unified-state-store migration
  // -----------------------------------------------------------------------

  describe('setActiveAgentId', () => {
    it('sets the active agent for a workspace', () => {
      const state = workspaceAgentsReducer(initialState, setActiveAgentId(WS_1, 'agent-1'));
      expect(state.byWorkspaceId[WS_1].activeAgentId).toBe('agent-1');
    });

    it('clears the active agent', () => {
      let state = workspaceAgentsReducer(initialState, setActiveAgentId(WS_1, 'agent-1'));
      state = workspaceAgentsReducer(state, setActiveAgentId(WS_1, null));
      expect(state.byWorkspaceId[WS_1].activeAgentId).toBeNull();
    });

    it('returns same reference when value unchanged', () => {
      const state = workspaceAgentsReducer(initialState, setActiveAgentId(WS_1, 'agent-1'));
      const next = workspaceAgentsReducer(state, setActiveAgentId(WS_1, 'agent-1'));
      expect(next).toBe(state);
    });
  });

  describe('upsertSession', () => {
    it('adds agent ID when session is new', () => {
      const agent = mockAgent('agent-1');
      const state = workspaceAgentsReducer(initialState, upsertSession(agent));
      expect(state.byWorkspaceId[WS_1].agentIds).toContain('agent-1');
    });

    it('records disk message count from the upsertSession payload', () => {
      const agent = mockAgent('agent-1', WS_1, 'Agent');
      agent.messages = [
        { id: 'msg-1', role: 'user', timestamp: '2026-03-19T00:00:00.000Z' } as any,
      ];

      const state = workspaceAgentsReducer(initialState, upsertSession(agent));

      expect(state.byWorkspaceId[WS_1].diskMessageCounts['agent-1']).toBe(1);
      expect(selectDiskMessageCount.select(mockState(state), WS_1, 'agent-1')).toBe(1);
    });

    it('does not overwrite disk message count on later upsertSession payloads', () => {
      const oneMessage = mockAgent('agent-1', WS_1, 'Agent');
      oneMessage.messages = [
        { id: 'msg-1', role: 'user', timestamp: '2026-03-19T00:00:00.000Z' } as any,
      ];
      const noMessages = mockAgent('agent-1', WS_1, 'Agent');

      let state = workspaceAgentsReducer(initialState, upsertSession(oneMessage));
      state = workspaceAgentsReducer(state, upsertSession(noMessages));

      expect(state.byWorkspaceId[WS_1].diskMessageCounts['agent-1']).toBe(1);
    });

    it('does not duplicate agent ID when session already tracked', () => {
      let state = workspaceAgentsReducer(initialState, upsertSession(mockAgent('agent-1', WS_1)));
      const before = state.byWorkspaceId[WS_1].agentIds.length;
      state = workspaceAgentsReducer(state, upsertSession(mockAgent('agent-1', WS_1)));
      expect(state.byWorkspaceId[WS_1].agentIds.length).toBe(before);
    });

    it('does not track foreground IDs when a background session is upserted', () => {
      const state = workspaceAgentsReducer(
        initialState,
        upsertSession(mockBackgroundAgent('agent-1', WS_1)),
      );
      expect(state.byWorkspaceId[WS_1].foregroundAgentIds).toEqual([]);
    });

    it('adds a foreground agent ID when an existing background session is upserted as foreground', () => {
      let state = workspaceAgentsReducer(
        initialState,
        upsertSession(mockBackgroundAgent('agent-1', WS_1)),
      );

      state = workspaceAgentsReducer(state, upsertSession(mockAgent('agent-1', WS_1)));

      expect(state.byWorkspaceId[WS_1].agentIds).toEqual(['agent-1']);
      expect(state.byWorkspaceId[WS_1].foregroundAgentIds).toEqual(['agent-1']);
    });

    it('removes a stale foreground agent ID when an existing session is upserted as background', () => {
      let state = workspaceAgentsReducer(initialState, upsertSession(mockAgent('agent-1', WS_1)));

      state = workspaceAgentsReducer(state, upsertSession(mockBackgroundAgent('agent-1', WS_1)));

      expect(state.byWorkspaceId[WS_1].agentIds).toEqual(['agent-1']);
      expect(state.byWorkspaceId[WS_1].foregroundAgentIds).toEqual([]);
    });
  });

  describe('selectAgentSession (reads from agent-session)', () => {
    it('returns agent from agent-session slice', () => {
      const agent = mockAgent('agent-1');
      const state = mockState(
        { byWorkspaceId: { [WS_1]: { ...emptyWorkspaceAgentState, agentIds: ['agent-1'] } } },
        [agent],
      );
      expect(selectAgentSession.select(state, 'agent-1')).toEqual(agent);
    });

    it('returns undefined for unknown agent', () => {
      const state = mockState();
      expect(selectAgentSession.select(state, 'unknown')).toBeUndefined();
    });
  });

  describe('selectAgentQueuedMessages (deprecated agentQueue bridge)', () => {
    it('returns queued messages from agentQueue slice', () => {
      const queued = [{ id: 'q1', content: 'hi', queuedAt: '2024-01-01', position: 0 }];
      const state = {
        ...mockState(
          { byWorkspaceId: { [WS_1]: { ...emptyWorkspaceAgentState, agentIds: ['agent-1'] } } },
          [mockAgent('agent-1')],
        ),
        agentQueue: agentQueueReducer(initialAgentQueueState, replaceAgentQueue('agent-1', queued)),
      } as StoreState;
      expect(selectAgentQueuedMessages.select(state, 'agent-1')).toEqual(queued);
    });

    it('returns empty array when no session', () => {
      const state = mockState();
      expect(selectAgentQueuedMessages.select(state, 'agent-1')).toEqual([]);
    });
  });

  describe('workspace-scoped agent selectors', () => {
    it('returns sessions that are tracked by workspace agent IDs', () => {
      const agent = mockAgent('agent-1');
      const state = mockState(
        { byWorkspaceId: { [WS_1]: { ...emptyWorkspaceAgentState, agentIds: ['agent-1'] } } },
        [agent],
      );

      expect(selectWorkspaceAgentSession.select(state, WS_1, 'agent-1')).toEqual(agent);
      expect(selectWorkspaceHasAgent.select(state, WS_1, 'agent-1')).toBe(true);
    });

    it('does not return a session from a different workspace', () => {
      const agent = mockAgent('agent-1', WS_2);
      const state = mockState(
        { byWorkspaceId: { [WS_1]: { ...emptyWorkspaceAgentState, agentIds: [] } } },
        [agent],
      );

      expect(selectWorkspaceAgentSession.select(state, WS_1, 'agent-1')).toBeUndefined();
      expect(selectWorkspaceHasAgent.select(state, WS_1, 'agent-1')).toBe(false);
    });

    it('reads streaming and soft-deleted flags for a workspace-scoped agent', () => {
      const agent = {
        ...mockAgent('agent-1'),
        isStreaming: true,
        metadata: { softDeleted: true } as AgentSession['metadata'],
      };
      const state = mockState(
        { byWorkspaceId: { [WS_1]: { ...emptyWorkspaceAgentState, agentIds: ['agent-1'] } } },
        [agent],
      );

      expect(selectWorkspaceAgentIsStreaming.select(state, WS_1, 'agent-1')).toBe(true);
      expect(selectWorkspaceAgentIsSoftDeleted.select(state, WS_1, 'agent-1')).toBe(true);
      expect(selectWorkspaceAgentIsStreaming.select(state, WS_2, 'agent-1')).toBe(false);
      expect(selectWorkspaceAgentIsSoftDeleted.select(state, WS_2, 'agent-1')).toBe(false);
    });
  });

  describe('selectActiveAgent (reads from agent-session)', () => {
    it('returns the active agent session from agent-session slice', () => {
      const agent = mockAgent('agent-1');
      const state = mockState(
        {
          byWorkspaceId: {
            [WS_1]: {
              ...emptyWorkspaceAgentState,
              agentIds: ['agent-1'],
              activeAgentId: 'agent-1',
            },
          },
        },
        [agent],
      );
      const active = selectActiveAgent.select(state, WS_1);
      expect(active?.id).toBe('agent-1');
    });

    it('returns undefined when no active agent', () => {
      const agent = mockAgent('agent-1');
      const state = mockState(
        { byWorkspaceId: { [WS_1]: { ...emptyWorkspaceAgentState, agentIds: ['agent-1'] } } },
        [agent],
      );
      const active = selectActiveAgent.select(state, WS_1);
      expect(active).toBeUndefined();
    });
  });
});
