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
  selectIsInitialSpecWriteInProgress,
  selectIsLoadingAgents,
  selectRecentlyCreatedAgents,
  resolveCanonicalInitialAgent,
  resolveEmptyLayoutAgent,
  selectEmptyLayoutAgent,
  selectWorkspaceAgentIsSoftDeleted,
  selectWorkspaceAgentIsStreaming,
  selectWorkspaceAgentSession,
  selectWorkspaceForegroundAgentIds,
  selectWorkspaceHasAgent,
  selectWorkspaceHasUnreadForegroundAgents,
} from './workspace-agents-selectors';
import {
  addAgent,
  adjustRetiredCount,
  agentsLoaded,
  createAgentRequested,
  createAgentWithSpecialistRequested,
  emptyWorkspaceAgentState,
  initialState,
  markAgentRecentlyCreated,
  removeWorkspaceAgentState,
  removeAgent,
  setActiveAgentId,
  recordAgentCreatedEvent,
  cleanupAgentCreatedEvents,
  setAgents,
  setAgentsLoaded,
  setInitialAgentId,
  setInitialSpecWriteInProgress,
  setIsLoadingAgents,
  setIsLoadingRetiredAgents,
  setRetiredAgentsLoaded,
  setRetiredCount,
  setWaitingForFirstMessage,
  workspaceAgentsReducer,
} from './workspace-agents-slice';
import { upsertSession } from '../agent-session/agent-session-slice';
import { selectAgentSession } from '../agent-session/agent-session-selectors';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';

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
          diskMessageCounts: { 'agent-1': 0, 'agent-2': 0 },
        },
      },
    });
  });

  it('tracks foreground agent IDs when adding agents', () => {
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent('agent-1')));
    state = workspaceAgentsReducer(state, addAgent(WS_1, mockBackgroundAgent('agent-2')));
    state = workspaceAgentsReducer(state, addAgent(WS_1, mockMetadataBackgroundAgent('agent-3')));
    const previousState = state;
    state = workspaceAgentsReducer(state, addAgent(WS_1, mockBackgroundAgent('agent-2')));

    expect(state).toBe(previousState);
    expect(state.byWorkspaceId[WS_1].agentIds).toEqual(['agent-1', 'agent-2', 'agent-3']);
    expect(state.byWorkspaceId[WS_1].foregroundAgentIds).toEqual(['agent-1']);
  });

  it('removes stale foreground IDs when an existing agent is added as background', () => {
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent('agent-1')));

    state = workspaceAgentsReducer(state, addAgent(WS_1, mockBackgroundAgent('agent-1')));

    expect(state.byWorkspaceId[WS_1].agentIds).toEqual(['agent-1']);
    expect(state.byWorkspaceId[WS_1].foregroundAgentIds).toEqual([]);
  });

  it('adds agent IDs without affecting other workspaces', () => {
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent('agent-1')));
    state = workspaceAgentsReducer(state, addAgent(WS_2, mockAgent('agent-2', WS_2, 'Setup')));

    expect(state.byWorkspaceId[WS_1].agentIds).toEqual(['agent-1']);
    expect(state.byWorkspaceId[WS_2].agentIds).toEqual(['agent-2']);
  });

  it('does not duplicate an existing agent', () => {
    const previousState = workspaceAgentsReducer(
      initialState,
      addAgent(WS_1, mockAgent('agent-1')),
    );

    expect(workspaceAgentsReducer(previousState, addAgent(WS_1, mockAgent('agent-1')))).toBe(
      previousState,
    );
  });

  it('removes an agent and clears related metadata', () => {
    let state = workspaceAgentsReducer(
      initialState,
      setAgents(WS_1, [mockBackgroundAgent('agent-1'), mockBackgroundAgent('agent-2')]),
    );
    state = workspaceAgentsReducer(state, setInitialAgentId(WS_1, 'agent-1'));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, 'agent-1'));
    state = workspaceAgentsReducer(state, setWaitingForFirstMessage(WS_1, 'agent-1', true));

    expect(workspaceAgentsReducer(state, removeAgent(WS_1, 'agent-1'))).toEqual({
      byWorkspaceId: {
        [WS_1]: {
          ...emptyWorkspaceAgentState,
          agentIds: ['agent-2'],
          foregroundAgentIds: [],
          diskMessageCounts: { 'agent-2': 0 },
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

  it('updates loading and initialization flags for a workspace', () => {
    let state = workspaceAgentsReducer(initialState, setIsLoadingAgents(WS_1, true));
    state = workspaceAgentsReducer(state, setAgentsLoaded(WS_1, true));
    state = workspaceAgentsReducer(state, setInitialAgentId(WS_1, 'agent-1'));

    expect(state.byWorkspaceId[WS_1]).toEqual({
      ...emptyWorkspaceAgentState,
      isLoadingAgents: true,
      agentsLoaded: true,
      initialAgentId: 'agent-1',
    });
  });

  it('tracks the lazy retired-bin state per workspace (§5.5 v8.2)', () => {
    let state = workspaceAgentsReducer(initialState, setRetiredCount(WS_1, 3));
    state = workspaceAgentsReducer(state, setIsLoadingRetiredAgents(WS_1, true));
    state = workspaceAgentsReducer(state, setRetiredAgentsLoaded(WS_1, true));

    expect(state.byWorkspaceId[WS_1]).toEqual({
      ...emptyWorkspaceAgentState,
      retiredCount: 3,
      isLoadingRetiredAgents: true,
      retiredAgentsLoaded: true,
    });

    // Event nudges move the count but never below zero.
    state = workspaceAgentsReducer(state, adjustRetiredCount(WS_1, -1));
    expect(state.byWorkspaceId[WS_1].retiredCount).toBe(2);
    state = workspaceAgentsReducer(state, adjustRetiredCount(WS_1, -5));
    expect(state.byWorkspaceId[WS_1].retiredCount).toBe(0);
    state = workspaceAgentsReducer(state, adjustRetiredCount(WS_1, 1));
    expect(state.byWorkspaceId[WS_1].retiredCount).toBe(1);
    // A daemon-served count can never be negative in state either.
    state = workspaceAgentsReducer(state, setRetiredCount(WS_1, -2));
    expect(state.byWorkspaceId[WS_1].retiredCount).toBe(0);
  });

  it('stores waiting-for-first-message per agent and clears it when false', () => {
    let state = workspaceAgentsReducer(
      initialState,
      setWaitingForFirstMessage(WS_1, 'agent-1', true),
    );

    expect(state.byWorkspaceId[WS_1].isWaitingForFirstMessage).toEqual({ 'agent-1': true });

    state = workspaceAgentsReducer(state, setWaitingForFirstMessage(WS_1, 'agent-1', false));

    expect(state.byWorkspaceId[WS_1].isWaitingForFirstMessage).toEqual({});
  });

  it('reconciles agent-scoped metadata when merging agent list from disk', () => {
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent('agent-1')));
    state = workspaceAgentsReducer(state, addAgent(WS_1, mockAgent('agent-2')));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, 'agent-1'));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, 'agent-2'));
    state = workspaceAgentsReducer(state, setWaitingForFirstMessage(WS_1, 'agent-1', true));
    state = workspaceAgentsReducer(state, setWaitingForFirstMessage(WS_1, 'agent-2', true));

    // Disk only has agent-2; daemon IDs are authoritative, optimistic agent-1 appended
    const nextState = workspaceAgentsReducer(state, setAgents(WS_1, [mockAgent('agent-2')]));

    expect(nextState.byWorkspaceId[WS_1].agentIds).toEqual(['agent-2', 'agent-1']);
    expect(nextState.byWorkspaceId[WS_1].recentlyCreatedAgents).toEqual(['agent-1', 'agent-2']);
    expect(nextState.byWorkspaceId[WS_1].isWaitingForFirstMessage).toEqual({
      'agent-1': true,
      'agent-2': true,
    });
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

  it('daemon snapshot IDs are authoritative; non-optimistic IPC agents are removed', () => {
    // 1. Coordinator created and added to state
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent('coordinator')));
    // 2. Subagent arrives via IPC (upsertSession) but is NOT marked optimistic
    state = workspaceAgentsReducer(state, upsertSession(mockAgent('subagent', WS_1)));
    expect(state.byWorkspaceId[WS_1].agentIds).toEqual(['coordinator', 'subagent']);

    // 3. loadAgentsFromDiskSaga finishes — disk only has coordinator
    state = workspaceAgentsReducer(state, setAgents(WS_1, [mockAgent('coordinator')]));

    // Daemon snapshot is authoritative; non-optimistic subagent is removed
    expect(state.byWorkspaceId[WS_1].agentIds).toEqual(['coordinator']);
  });

  it('adds new disk-loaded agents not already in agentIds', () => {
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent('agent-1')));

    // Disk has agent-1 (already known) + agent-2 (new from disk)
    state = workspaceAgentsReducer(
      state,
      setAgents(WS_1, [mockAgent('agent-1'), mockAgent('agent-2')]),
    );

    expect(state.byWorkspaceId[WS_1].agentIds).toEqual(['agent-1', 'agent-2']);
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

  it('creates an agentsLoaded action', () => {
    expect(agentsLoaded(WS_1)).toEqual({
      type: agentsLoaded.type,
      payload: [WS_1],
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
    expect(selectEmptyLayoutAgent.select(state, WS_1)).toBeNull();
    expect(selectWorkspaceHasUnreadForegroundAgents.select(state, WS_1)).toBe(false);
  });

  it('reports unread foreground agents while ignoring background-only unread', () => {
    const stateFor = (sessions: AgentSession[]) =>
      mockState(workspaceAgentsReducer(initialState, setAgents(WS_1, sessions)), sessions);
    const unreadForeground = { ...mockAgent('agent-foreground'), hasUnread: true };
    const readForeground = { ...mockAgent('agent-foreground'), hasUnread: false };
    const unreadBackground = { ...mockBackgroundAgent('agent-background'), hasUnread: true };

    expect(
      selectWorkspaceHasUnreadForegroundAgents.select(
        stateFor([unreadForeground, unreadBackground]),
        WS_1,
      ),
    ).toBe(true);
    expect(
      selectWorkspaceHasUnreadForegroundAgents.select(
        stateFor([readForeground, unreadBackground]),
        WS_1,
      ),
    ).toBe(false);
    expect(
      selectWorkspaceHasUnreadForegroundAgents.select(stateFor([unreadBackground]), WS_1),
    ).toBe(false);
    expect(selectWorkspaceHasUnreadForegroundAgents.select(stateFor([readForeground]), WS_1)).toBe(
      false,
    );
  });

  it('resolves the primary agent with the newest valid user-message timestamp', () => {
    const older = {
      ...mockAgent('agent-older'),
      messages: [{ id: 'message-1', role: 'user', timestamp: '2026-03-19T01:00:00.000Z' }],
    } as AgentSession;
    const newer = {
      ...mockAgent('agent-newer'),
      messages: [{ id: 'message-2', role: 'user', timestamp: '2026-03-19T02:00:00.000Z' }],
    } as AgentSession;
    const workspaceAgents = workspaceAgentsReducer(initialState, setAgents(WS_1, [older, newer]));

    expect(selectEmptyLayoutAgent.select(mockState(workspaceAgents, [older, newer]), WS_1)).toBe(
      newer,
    );
  });

  it('orders transcript-free restored AgentLite sessions by durable activity timestamp', () => {
    const older = {
      ...mockAgent('agent-older'),
      lastUserMessage: 'Older message',
      lastActivity: '2026-03-19T01:00:00.000Z',
    } as AgentSession;
    const newer = {
      ...mockAgent('agent-newer'),
      lastUserMessage: 'Newer message',
      lastActivity: '2026-03-19T02:00:00.000Z',
    } as AgentSession;

    expect(resolveEmptyLayoutAgent([newer, older], WS_1)).toBe(newer);
  });

  it('excludes background and delegated agents from recent-message selection', () => {
    const primary = {
      ...mockAgent('agent-primary'),
      messages: [{ id: 'primary', role: 'user', timestamp: '2026-03-19T01:00:00.000Z' }],
    } as AgentSession;
    const background = {
      ...mockBackgroundAgent('agent-background'),
      messages: [{ id: 'background', role: 'user', timestamp: '2026-03-19T04:00:00.000Z' }],
    } as AgentSession;
    const metadataBackground = {
      ...mockMetadataBackgroundAgent('agent-metadata-background'),
      messages: [
        { id: 'metadata-background', role: 'user', timestamp: '2026-03-19T05:00:00.000Z' },
      ],
    } as AgentSession;
    const delegated = {
      ...mockAgent('agent-delegated'),
      metadata: { createdByAgentId: 'agent-primary' } as AgentSession['metadata'],
      messages: [{ id: 'delegated', role: 'user', timestamp: '2026-03-19T03:00:00.000Z' }],
    } as AgentSession;
    const child = {
      ...mockAgent('agent-child'),
      parentSessionId: 'agent-primary' as AgentSession['parentSessionId'],
      messages: [{ id: 'child', role: 'user', timestamp: '2026-03-19T02:00:00.000Z' }],
    } as AgentSession;

    expect(
      resolveEmptyLayoutAgent([background, metadataBackground, delegated, child, primary], WS_1),
    ).toBe(primary);
  });

  it('breaks equal user-message timestamp ties by canonical creation order', () => {
    const laterCreated = {
      ...mockAgent('agent-later'),
      createdAt: '2026-03-19T01:00:00.000Z',
      messages: [{ id: 'later', role: 'user', timestamp: '2026-03-19T02:00:00.000Z' }],
    } as AgentSession;
    const earlierCreated = {
      ...mockAgent('agent-earlier'),
      createdAt: '2026-03-19T00:00:00.000Z',
      messages: [{ id: 'earlier', role: 'user', timestamp: '2026-03-19T02:00:00.000Z' }],
    } as AgentSession;

    expect(resolveEmptyLayoutAgent([laterCreated, earlierCreated], WS_1)).toBe(earlierCreated);
  });

  it('returns null when no eligible agent has a valid ordering timestamp', () => {
    const invalidRecent = {
      ...mockAgent('agent-invalid'),
      messages: [{ id: 'invalid', role: 'user', timestamp: undefined }],
    } as unknown as AgentSession;

    expect(resolveEmptyLayoutAgent([invalidRecent], WS_1)).toBeNull();
  });

  it.each([
    ['top-level initial marker', { isInitialAgent: true }],
    ['metadata initial marker', { metadata: { isInitialAgent: true } }],
    ['alternate metadata initial marker', { agentMetadata: { isInitialAgent: true } }],
    ['wrong workspace', { workspaceId: WS_2 }],
    ['deleted status', { status: 'deleted' }],
    ['pending deletion', { pendingDeleteAt: '2026-03-19T03:00:00.000Z' }],
  ])('excludes an agent with %s', (_name, overrides) => {
    const excluded = {
      ...mockAgent('agent-excluded'),
      messages: [{ id: 'excluded', role: 'user', timestamp: '2026-03-19T02:00:00.000Z' }],
      ...overrides,
    } as AgentSession;

    expect(resolveEmptyLayoutAgent([excluded], WS_1)).toBeNull();
  });

  it('resolveCanonicalInitialAgent skips retired sessions (§5.5 soft retire)', () => {
    const retiredInitial = {
      ...mockAgent('agent-retired'),
      isInitialAgent: true,
      retiredAt: '2026-03-19T01:00:00.000Z',
    } as AgentSession;
    const active = mockAgent('agent-active');

    expect(resolveCanonicalInitialAgent([retiredInitial, active])).toBe(active);
    expect(resolveCanonicalInitialAgent([retiredInitial])).toBeNull();
  });

  it('returns per-workspace agent values (sessions from agent-session slice)', () => {
    const foregroundAgent = mockAgent('agent-1');
    const backgroundAgent = {
      ...mockAgent('agent-2'),
      isBackground: true,
    } satisfies AgentSession;
    const workspaceState = {
      ...emptyWorkspaceAgentState,
      agentIds: ['agent-1', 'agent-2'],
      foregroundAgentIds: ['agent-1'],
      agentsLoaded: true,
      isLoadingAgents: true,
      initialAgentId: 'agent-1',
      recentlyCreatedAgents: ['agent-1'],
      isWaitingForFirstMessage: { 'agent-1': true },
    };
    const state = mockState({ byWorkspaceId: { [WS_1]: workspaceState as any } }, [
      foregroundAgent,
      backgroundAgent,
    ]);

    expect(selectAllWorkspaceAgents.select(state, WS_1)).toEqual([
      foregroundAgent,
      backgroundAgent,
    ]);
    expect(selectWorkspaceForegroundAgentIds.select(state, WS_1)).toEqual(['agent-1']);
    expect(selectBackgroundWorkspaceAgents.select(state, WS_1)).toEqual([backgroundAgent]);
    expect(selectForegroundWorkspaceAgents.select(state, WS_1)).toEqual([foregroundAgent]);
    expect(selectAgentsLoaded.select(state, WS_1)).toBe(true);
    expect(selectIsLoadingAgents.select(state, WS_1)).toBe(true);
    expect(selectInitialAgentId.select(state, WS_1)).toBe('agent-1');
    expect(selectRecentlyCreatedAgents.select(state, WS_1)).toEqual(['agent-1']);
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

  describe('hydration membership snapshots', () => {
    it('records disk message counts in the setAgents membership commit', () => {
      const withMessage = mockAgent('agent-1', WS_1, 'Agent');
      withMessage.messages = [
        { id: 'msg-1', role: 'user', timestamp: '2026-03-19T00:00:00.000Z' } as any,
      ];

      const state = workspaceAgentsReducer(initialState, setAgents(WS_1, [withMessage]));

      expect(state.byWorkspaceId[WS_1].diskMessageCounts).toEqual({ 'agent-1': 1 });
    });

    it('records disk message counts when a retired hydration appends with addAgent', () => {
      const withMessage = mockAgent('agent-1', WS_1, 'Agent');
      withMessage.messages = [
        { id: 'msg-1', role: 'user', timestamp: '2026-03-19T00:00:00.000Z' } as any,
      ];

      const state = workspaceAgentsReducer(initialState, addAgent(WS_1, withMessage));

      expect(state.byWorkspaceId[WS_1].diskMessageCounts).toEqual({ 'agent-1': 1 });
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

  describe('setInitialSpecWriteInProgress', () => {
    it('sets and clears the flag', () => {
      let state = workspaceAgentsReducer(initialState, setInitialSpecWriteInProgress(WS_1, true));
      expect(selectIsInitialSpecWriteInProgress.select(mockState(state), WS_1)).toBe(true);
      state = workspaceAgentsReducer(state, setInitialSpecWriteInProgress(WS_1, false));
      expect(selectIsInitialSpecWriteInProgress.select(mockState(state), WS_1)).toBe(false);
    });
  });

  describe('removeWorkspaceAgentState', () => {
    it('removes entire workspace state entry', () => {
      let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent('agent-1')));
      state = workspaceAgentsReducer(state, removeWorkspaceAgentState(WS_1));
      expect(state.byWorkspaceId[WS_1]).toBeUndefined();
    });
  });

  describe('workspaceDeleted', () => {
    it('purges the workspace state entry so ghost agents cannot resurface', () => {
      let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent('agent-1')));
      state = workspaceAgentsReducer(state, addAgent(WS_2, mockAgent('agent-2')));
      state = workspaceAgentsReducer(state, workspaceDeleted(WS_1, ['agent-1']));
      expect(state.byWorkspaceId[WS_1]).toBeUndefined();
      expect(state.byWorkspaceId[WS_2]).toBeDefined();
    });

    it('is a no-op when the workspace has no state entry', () => {
      const state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent('agent-1')));
      const next = workspaceAgentsReducer(state, workspaceDeleted('ws-missing', []));
      expect(next).toBe(state);
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

  describe('recordAgentCreatedEvent', () => {
    it('records a timestamp for agent-created deduplication', () => {
      const ts = 1700000000000;
      const state = workspaceAgentsReducer(
        initialState,
        recordAgentCreatedEvent(WS_1, 'agent-1', ts),
      );
      expect(state.byWorkspaceId[WS_1].recentAgentCreatedEvents['agent-1']).toBe(ts);
    });
  });

  describe('cleanupAgentCreatedEvents', () => {
    it('removes entries older than cutoff', () => {
      let state = workspaceAgentsReducer(
        initialState,
        recordAgentCreatedEvent(WS_1, 'agent-old', 1000),
      );
      state = workspaceAgentsReducer(state, recordAgentCreatedEvent(WS_1, 'agent-new', 5000));
      state = workspaceAgentsReducer(state, cleanupAgentCreatedEvents(WS_1, 3000));
      expect(state.byWorkspaceId[WS_1].recentAgentCreatedEvents['agent-old']).toBeUndefined();
      expect(state.byWorkspaceId[WS_1].recentAgentCreatedEvents['agent-new']).toBe(5000);
    });

    it('returns same state when nothing to clean', () => {
      const state = workspaceAgentsReducer(
        initialState,
        recordAgentCreatedEvent(WS_1, 'agent-1', 5000),
      );
      const next = workspaceAgentsReducer(state, cleanupAgentCreatedEvents(WS_1, 1000));
      expect(next).toBe(state);
    });
  });
});
