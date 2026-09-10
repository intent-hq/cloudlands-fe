import { describe, expect, it } from 'vitest';
import type { AgentSession, WorkspaceTask } from '$shared/types';
import type { WorkspaceEvent } from '$features/events/types';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { TaskAgentAssociationsByTaskKey } from '../task-agent-associations/task-agent-associations-types';
import type { StoreState } from '../../types';
import { selectGraphState, selectGraphStateAt } from './agent-overview-selectors';

const WS = 'ws-test';

function makeOverviewState(
  input: AgentSession | AgentSession[],
  workspaceEvents: WorkspaceEvent[] = [],
  tasks: WorkspaceTask[] = [],
  taskAssociations: Record<string, TaskAgentAssociationsByTaskKey> = {},
  historyEvents: WorkspaceEvent[] = [],
): StoreState {
  const sessions = Array.isArray(input) ? input : [input];
  return {
    agentSessions: {
      byAgentId: Object.fromEntries(
        sessions.map((session) => [
          session.id,
          {
            ...session,
            messages: session.messages,
          },
        ]),
      ),
    },
    workspaceAgents: {
      byWorkspaceId: {
        [WS]: {
          agentIds: sessions.map((session) => String(session.id)),
          agentsLoaded: true,
          isLoadingAgents: false,
          initialAgentId: null,
          recentlyCreatedAgents: [],
          isWaitingForFirstMessage: {},
          activeAgentId: null,
          isInitialSpecWriteInProgress: false,
          diskMessageCounts: {},
          recentAgentCreatedEvents: {},
        },
      },
    },
    changes: { byWorkspaceId: {}, fileListViewMode: 'flat', mainPanelView: null, agentStats: {} },
    workspaceNotes: { byWorkspaceId: {} },
    workspaceTasks: {
      byWorkspaceId: {
        [WS]: {
          tasks: createCollection<WorkspaceTask, 'id'>('id', tasks),
          stats: { total: tasks.length, completed: 0, inProgress: 0 },
          loading: false,
          error: null,
          initialized: true,
        },
      },
    },
    taskAgentAssociations: {
      byWorkspaceId: { [WS]: { byNoteId: taskAssociations } },
    },
    workspace: {
      workspaces: createCollection('id', [
        { id: WS, path: '/repo', worktreePath: '/repo/worktree' },
      ] as any[]),
    },
    workspaceEvents: {
      byWorkspaceId:
        workspaceEvents.length > 0 ? { [WS]: { events: workspaceEvents, loading: false } } : {},
    },
    agentOverviewHistory: {
      byWorkspaceId:
        historyEvents.length > 0
          ? {
              [WS]: {
                events: createCollection<WorkspaceEvent, 'id'>('id', historyEvents),
                status: 'complete',
                nextToken: null,
                loadedAt: '2026-03-20T14:00:00.000Z',
              },
            }
          : {},
    },
  } as unknown as StoreState;
}

function makeWorkspaceEvent(overrides: Partial<WorkspaceEvent>): WorkspaceEvent {
  return {
    id: 'event-1',
    workspaceId: WS,
    timestamp: '2026-03-20T13:30:00.000Z',
    type: 'file:changed',
    actor: { type: 'agent', id: 'a1', name: 'Agent a1' },
    data: {
      path: 'src/actual.ts',
      relativePath: 'src/actual.ts',
      action: 'modify',
    },
    ...overrides,
  } as WorkspaceEvent;
}

describe('selectGraphState', () => {
  it('starts replay before the earliest agent and reveals agents at their creation time', () => {
    const early = makeSession('early', { createdAt: '2026-03-20T13:00:00.000Z' });
    const late = makeSession('late', { createdAt: '2026-03-20T13:30:00.000Z' });
    const events = [
      makeWorkspaceEvent({ id: 'early-file', timestamp: '2026-03-20T13:10:00.000Z' }),
      makeWorkspaceEvent({
        id: 'late-file',
        timestamp: '2026-03-20T13:40:00.000Z',
        actor: { type: 'agent', id: 'late', name: 'Late agent' },
        data: { path: 'src/future.ts', relativePath: 'src/future.ts', action: 'modify' },
      }),
    ];

    const state = makeOverviewState([early, late], events);
    const graph = selectGraphStateAt.select(state, WS, '2026-03-20T13:20:00.000Z');

    expect(graph.isLive).toBe(false);
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ type: 'agent', agentId: 'early' }),
    );
    expect(graph.nodes).not.toContainEqual(
      expect.objectContaining({ type: 'agent', agentId: 'late' }),
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ type: 'file', path: 'src/actual.ts' }),
    );
    expect(graph.nodes).not.toContainEqual(expect.objectContaining({ path: 'src/future.ts' }));
    expect(graph.minTime).toBe('2026-03-20T12:59:12.000Z');
    expect(graph.maxTime).toBe('2026-03-20T13:40:00.000Z');

    const graphAtStart = selectGraphStateAt.select(state, WS, graph.minTime);
    expect(graphAtStart.nodes).not.toContainEqual(expect.objectContaining({ type: 'agent' }));

    const graphAtFirstCreation = selectGraphStateAt.select(state, WS, String(early.createdAt));
    expect(graphAtFirstCreation.nodes).toContainEqual(
      expect.objectContaining({ type: 'agent', agentId: 'early' }),
    );
    expect(graphAtFirstCreation.nodes).not.toContainEqual(
      expect.objectContaining({ type: 'agent', agentId: 'late' }),
    );
  });

  it('keeps every agent visible in live mode', () => {
    const graph = selectGraphState.select(
      makeOverviewState(
        [
          makeSession('early', { createdAt: '2026-03-20T13:00:00.000Z' }),
          makeSession('late', { createdAt: '2026-03-20T14:00:00.000Z' }),
        ],
        [makeWorkspaceEvent({ timestamp: '2026-03-20T13:30:00.000Z' })],
      ),
      WS,
    );

    expect(graph.isLive).toBe(true);
    expect(graph.nodes.filter((node) => node.type === 'agent')).toHaveLength(2);
    expect(graph.maxTime).toBe('2026-03-20T14:00:00.000Z');
  });

  it('keeps agents with unparseable creation times visible without changing the range start', () => {
    const currentTime = '2026-03-20T13:20:00.000Z';
    const graph = selectGraphStateAt.select(
      makeOverviewState(makeSession('unknown', { createdAt: 'not-a-date' })),
      WS,
      currentTime,
    );

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ type: 'agent', agentId: 'unknown' }),
    );
    expect(graph.minTime).toBe(currentTime);
  });

  it('uses the requested time as both bounds when no events or agents exist', () => {
    const currentTime = '2026-03-20T13:20:00.000Z';
    const graph = selectGraphStateAt.select(makeOverviewState([]), WS, currentTime);

    expect(graph.minTime).toBe(currentTime);
    expect(graph.maxTime).toBe(currentTime);
  });

  it('reveals task assignments at the later agent or task creation time', () => {
    const agent = makeSession('a1', {
      createdAt: '2026-03-20T13:00:00.000Z',
      metadata: { taskNoteId: 'task-1' as any },
    });
    const tasks: WorkspaceTask[] = [{ id: 'task-1', title: 'Replay task', status: 'in_progress' }];
    const created = makeTaskEvent('task-created', 'task:created', '2026-03-20T13:10:00.000Z', {
      noteId: 'task-1',
      noteTitle: 'Replay task',
      status: 'not_started',
      createdAt: '2026-03-20T13:10:00.000Z',
    });
    const state = makeOverviewState(agent, [], tasks, {}, [created]);

    const before = selectGraphStateAt.select(state, WS, '2026-03-20T13:09:59.999Z');
    expect(before.nodes).not.toContainEqual(
      expect.objectContaining({ type: 'task', taskId: 'task-1' }),
    );
    expect(before.edges).not.toContainEqual(
      expect.objectContaining({ type: 'task-assignment', targetId: 'task-1' }),
    );

    const atCreation = selectGraphStateAt.select(state, WS, '2026-03-20T13:10:00.000Z');
    expect(atCreation.nodes).toContainEqual(
      expect.objectContaining({ type: 'task', taskId: 'task-1' }),
    );
    expect(atCreation.edges).toContainEqual(
      expect.objectContaining({
        type: 'task-assignment',
        targetId: 'task-1',
        timestamp: '2026-03-20T13:10:00.000Z',
      }),
    );

    expect(selectGraphState.select(state, WS).edges).toContainEqual(
      expect.objectContaining({ type: 'task-assignment', targetId: 'task-1' }),
    );
  });

  it('starts the timeline before the earliest derived task creation time', () => {
    const tasks: WorkspaceTask[] = [{ id: 'task-1', title: 'Replay task', status: 'not_started' }];
    const created = makeTaskEvent('task-created', 'task:created', '2026-03-20T13:10:00.000Z', {
      noteId: 'task-1',
    });
    const graph = selectGraphStateAt.select(
      makeOverviewState([], [], tasks, {}, [created]),
      WS,
      '2026-03-20T13:20:00.000Z',
    );

    expect(graph.minTime).toBe('2026-03-20T13:09:48.000Z');
  });

  it('uses note creation and the first status change as task creation fallbacks', () => {
    const tasks: WorkspaceTask[] = [
      { id: 'from-note', title: 'Created note', status: 'not_started' },
      { id: 'from-status', title: 'Older task', status: 'in_progress' },
    ];
    const events = [
      makeTaskEvent('note-created', 'note:created', '2026-03-20T13:05:00.000Z', {
        noteId: 'from-note',
        action: 'create',
      }),
      makeTaskEvent('status-changed', 'task:status-changed', '2026-03-20T13:10:00.000Z', {
        noteId: 'from-status',
        previousStatus: 'not_started',
        newStatus: 'in_progress',
        changedAt: '2026-03-20T13:10:00.000Z',
      }),
    ];
    const state = makeOverviewState([], [], tasks, {}, events);

    const graph = selectGraphStateAt.select(state, WS, '2026-03-20T13:07:00.000Z');
    expect(graph.nodes).toContainEqual(expect.objectContaining({ taskId: 'from-note' }));
    expect(graph.nodes).not.toContainEqual(expect.objectContaining({ taskId: 'from-status' }));
  });

  it('keeps tasks without creation events visible and never gates tasks in live mode', () => {
    const tasks: WorkspaceTask[] = [
      { id: 'known', title: 'Known task', status: 'not_started' },
      { id: 'fallback', title: 'Fallback task', status: 'waiting' },
    ];
    const created = makeTaskEvent('task-created', 'task:created', '2026-03-20T13:10:00.000Z', {
      noteId: 'known',
    });
    const state = makeOverviewState([], [], tasks, {}, [created]);

    const replay = selectGraphStateAt.select(state, WS, '2026-03-20T13:00:00.000Z');
    expect(replay.nodes).not.toContainEqual(expect.objectContaining({ taskId: 'known' }));
    expect(replay.nodes).toContainEqual(expect.objectContaining({ taskId: 'fallback' }));
    expect(
      selectGraphState.select(state, WS).nodes.filter((node) => node.type === 'task'),
    ).toHaveLength(2);
  });

  it('rewinds task status before, between, and after recorded transitions', () => {
    const task: WorkspaceTask = { id: 'task-1', title: 'Replay task', status: 'complete' };
    const events = [
      makeTaskEvent('task-created', 'task:created', '2026-03-20T13:00:00.000Z', {
        noteId: task.id,
      }),
      makeTaskEvent('task-started', 'task:status-changed', '2026-03-20T13:10:00.000Z', {
        noteId: task.id,
        previousStatus: 'not_started',
        newStatus: 'in_progress',
        changedAt: '2026-03-20T13:10:00.000Z',
      }),
      makeTaskEvent('task-completed', 'task:status-changed', '2026-03-20T13:30:00.000Z', {
        noteId: task.id,
        previousStatus: 'in_progress',
        newStatus: 'complete',
      }),
    ];
    const state = makeOverviewState([], [], [task], {}, events);
    const statusAt = (timestamp: string) =>
      selectGraphStateAt
        .select(state, WS, timestamp)
        .nodes.find((node) => node.type === 'task' && node.taskId === task.id)?.state;

    expect(statusAt('2026-03-20T13:05:00.000Z')).toBe('not_started');
    expect(statusAt('2026-03-20T13:20:00.000Z')).toBe('in_progress');
    expect(statusAt('2026-03-20T13:35:00.000Z')).toBe('complete');
    const timeline = selectGraphStateAt.select(state, WS, '2026-03-20T13:20:00.000Z');
    expect(timeline.maxTime).toBe('2026-03-20T13:30:00.000Z');
    expect(timeline.eventTimes).toEqual(
      expect.arrayContaining([
        '2026-03-20T13:00:00.000Z',
        '2026-03-20T13:10:00.000Z',
        '2026-03-20T13:30:00.000Z',
      ]),
    );
  });

  it('uses current task status without status events and throughout live mode', () => {
    const fallback: WorkspaceTask = { id: 'fallback', title: 'Fallback', status: 'waiting' };
    const current: WorkspaceTask = { id: 'current', title: 'Current', status: 'cancelled' };
    const currentEvents = [
      makeTaskEvent('current-created', 'task:created', '2026-03-20T13:00:00.000Z', {
        noteId: current.id,
      }),
      makeTaskEvent('current-changed', 'task:status-changed', '2026-03-20T13:10:00.000Z', {
        noteId: current.id,
        previousStatus: 'not_started',
        newStatus: 'complete',
        changedAt: '2026-03-20T13:10:00.000Z',
      }),
    ];

    const fallbackGraph = selectGraphStateAt.select(
      makeOverviewState([], [], [fallback]),
      WS,
      '2026-03-20T13:20:00.000Z',
    );
    expect(fallbackGraph.nodes).toContainEqual(
      expect.objectContaining({ taskId: fallback.id, state: 'waiting' }),
    );

    const liveGraph = selectGraphState.select(
      makeOverviewState([], [], [current], {}, currentEvents),
      WS,
    );
    expect(liveGraph.nodes).toContainEqual(
      expect.objectContaining({ taskId: current.id, state: 'cancelled' }),
    );
  });

  it('derives graph interactions from canonical workspace events via .select', () => {
    const session: AgentSession = {
      id: 'a1' as any,
      backendSessionId: null,
      workspaceId: WS as any,
      name: 'Agent a1',
      status: 'idle' as any,
      messages: [],
      createdAt: '2026-03-20T13:00:00.000Z',
      updatedAt: '2026-03-20T13:00:00.000Z',
    };

    const graph = selectGraphState.select(
      makeOverviewState(session, [makeWorkspaceEvent({ id: 'file-event' })]),
      WS,
    );

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ type: 'file', path: 'src/actual.ts' }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: 'file-write',
        agentId: 'a1',
        filePath: 'src/actual.ts',
        count: 1,
      }),
    );
  });

  it('uses graph history instead of the shared event buffer once history has events', () => {
    const sharedEvent = makeWorkspaceEvent({
      id: 'shared-event',
      data: { path: 'src/shared.ts', relativePath: 'src/shared.ts', action: 'modify' },
    });
    const historyEvent = makeWorkspaceEvent({
      id: 'history-event',
      data: { path: 'src/history.ts', relativePath: 'src/history.ts', action: 'modify' },
    });

    const graph = selectGraphState.select(
      makeOverviewState(makeSession('a1'), [sharedEvent], [], {}, [historyEvent]),
      WS,
    );

    expect(graph.nodes).toContainEqual(expect.objectContaining({ path: 'src/history.ts' }));
    expect(graph.nodes).not.toContainEqual(expect.objectContaining({ path: 'src/shared.ts' }));
  });

  it('excludes malformed graph events without disturbing valid history order', () => {
    const validLater = makeWorkspaceEvent({
      id: 'valid-later',
      timestamp: '2026-03-20T13:40:00.000Z',
      data: { path: 'src/later.ts', relativePath: 'src/later.ts', action: 'modify' },
    });
    const validEarlier = makeWorkspaceEvent({
      id: 'valid-earlier',
      timestamp: '2026-03-20T13:20:00.000Z',
      data: { path: 'src/earlier.ts', relativePath: 'src/earlier.ts', action: 'modify' },
    });
    const graph = selectGraphState.select(
      makeOverviewState(makeSession('a1'), [], [], {}, [
        validLater,
        { ...makeWorkspaceEvent({ id: 'bad-time' }), timestamp: 'not-a-date' },
        { ...makeWorkspaceEvent({ id: 'missing-agent' }), actor: { type: 'agent' } },
        validEarlier,
      ]),
      WS,
    );

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/earlier.ts' }),
        expect.objectContaining({ path: 'src/later.ts' }),
      ]),
    );
    expect(graph.edges).toHaveLength(2);
    expect(graph.eventTimes).toEqual(['2026-03-20T13:20:00.000Z', '2026-03-20T13:40:00.000Z']);
  });

  it('marks event-derived files outside workspace roots as external', () => {
    const graph = selectGraphState.select(
      makeOverviewState(makeSession('a1'), [
        makeWorkspaceEvent({
          id: 'external-file',
          data: { path: '/tmp/capture.jpg', action: 'read' },
        }),
        makeWorkspaceEvent({
          id: 'internal-file',
          data: { path: 'src/internal.ts', relativePath: 'src/internal.ts', action: 'read' },
        }),
      ]),
      WS,
    );

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ type: 'file', path: '/tmp/capture.jpg', isExternal: true }),
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ type: 'file', path: 'src/internal.ts', isExternal: false }),
    );
  });

  it('builds canonical task anchors even when no agent is assigned', () => {
    const session = makeSession('a1');
    const tasks: WorkspaceTask[] = [
      { id: 'task-1', title: 'First task', status: 'in_progress', dependsOn: ['task-0' as any] },
      { id: 'task-2', title: 'Unassigned task', status: 'waiting' },
    ];

    const graph = selectGraphState.select(makeOverviewState(session, [], tasks), WS);

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: 'task-1',
        type: 'task',
        taskId: 'task-1',
        title: 'First task',
        state: 'in_progress',
        dependsOn: ['task-0'],
      }),
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: 'task-2',
        type: 'task',
        title: 'Unassigned task',
        state: 'waiting',
      }),
    );
  });

  it('attaches agents to canonical tasks from session metadata and task-agent links', () => {
    const metadataAgent = makeSession('a1', { metadata: { taskNoteId: 'task-1' as any } });
    const linkedAgent = makeSession('a2');
    const tasks: WorkspaceTask[] = [
      { id: 'task-1', title: 'Metadata task', status: 'in_progress' },
      { id: 'task-2', title: 'Linked task', status: 'not_started' },
    ];
    const associations = {
      'task-2': {
        'agent:a2': {
          noteId: 'task-2',
          taskKey: 'agent:a2',
          taskText: 'Linked task',
          agentId: 'a2',
          createdAt: 1_700_000_000_000,
        },
      },
    };

    const graph = selectGraphState.select(
      makeOverviewState([metadataAgent, linkedAgent], [], tasks, associations),
      WS,
    );

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ type: 'agent', agentId: 'a1', taskNoteId: 'task-1' }),
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ type: 'agent', agentId: 'a2', taskNoteId: 'task-2' }),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'task-assignment',
          sourceId: 'agent-a1',
          targetId: 'task-1',
        }),
        expect.objectContaining({
          type: 'task-assignment',
          sourceId: 'agent-a2',
          targetId: 'task-2',
        }),
      ]),
    );
  });

  it('aggregates agent messages by directed pair and keeps the last timestamp', () => {
    const first = makeWorkspaceEvent({
      id: 'queue-1',
      timestamp: '2026-03-20T13:20:00.000Z',
      type: 'agent:queue:updated' as any,
      data: { agentId: 'a2', queue: [{ id: 'message-1', fromAgentId: 'a1' }] },
    });
    const second = makeWorkspaceEvent({
      id: 'queue-2',
      timestamp: '2026-03-20T13:30:00.000Z',
      type: 'agent:queue:updated' as any,
      data: {
        agentId: 'a2',
        queue: [
          { id: 'message-1', fromAgentId: 'a1' },
          { id: 'message-2', fromAgentId: 'a1' },
        ],
      },
    });

    const graph = selectGraphState.select(
      makeOverviewState([makeSession('a1'), makeSession('a2')], [first, second]),
      WS,
    );

    expect(graph.edges.filter((edge) => edge.type === 'message')).toEqual([
      expect.objectContaining({
        sourceId: 'agent-a1',
        targetId: 'agent-a2',
        count: 2,
        timestamp: '2026-03-20T13:30:00.000Z',
      }),
    ]);
  });

  it('creates waiting-on edges from the canonical session snapshot', () => {
    const waiter = makeSession('a1', { waitingForAgentIds: ['a2'] });
    const graph = selectGraphState.select(makeOverviewState([waiter, makeSession('a2')]), WS);

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: 'waiting-on',
        sourceId: 'agent-a1',
        targetId: 'agent-a2',
      }),
    );
  });

  it('summarizes agents, task states, files, and notes', () => {
    const active = makeSession('a1', { isStreaming: true });
    const completed = makeSession('a2', { status: 'completed' as any });
    const tasks: WorkspaceTask[] = [
      { id: 'task-1', title: 'Active task', status: 'in_progress' },
      { id: 'task-2', title: 'Done task', status: 'complete' },
    ];
    const events = [
      makeWorkspaceEvent({ id: 'file-event' }),
      makeWorkspaceEvent({
        id: 'note-event',
        type: 'note:updated',
        data: { noteId: 'note-1', title: 'A note', action: 'update' },
      }),
    ];

    const graph = selectGraphState.select(
      makeOverviewState([active, completed], events, tasks),
      WS,
    );

    expect(graph.stats.agents).toEqual({ active: 1, total: 2 });
    expect(graph.stats.tasks).toMatchObject({ in_progress: 1, complete: 1, waiting: 0 });
    expect(graph.stats.files).toBe(1);
    expect(graph.stats.notes).toBe(1);
  });

  it('uses the centralized agent responding selector for graph status without re-exposing transport flags', () => {
    const session: AgentSession = {
      id: 'a1' as any,
      backendSessionId: null,
      workspaceId: WS as any,
      name: 'Agent a1',
      status: 'idle' as any,
      isStreaming: true,
      messages: [],
      createdAt: '2026-03-20T13:00:00.000Z',
      updatedAt: '2026-03-20T13:00:00.000Z',
    };

    const graph = selectGraphState.select(makeOverviewState(session), WS);
    const agentNode = graph.nodes.find((node) => node.type === 'agent' && node.agentId === 'a1');

    expect(agentNode?.status).toBe('responding');
    expect(agentNode && 'isResponding' in agentNode).toBe(false);
    expect(agentNode && 'isThinking' in agentNode).toBe(false);
    expect(agentNode && 'isWaiting' in agentNode).toBe(false);
    expect(agentNode && 'isWaitingForOtherAgents' in agentNode).toBe(false);
  });

  it('maps AgentStatus.Waiting active-thread sessions through selector-derived waiting state', () => {
    const session: AgentSession = {
      id: 'a1' as any,
      backendSessionId: null,
      workspaceId: WS as any,
      name: 'Agent a1',
      status: 'Waiting' as any,
      messages: [],
      createdAt: '2026-03-20T13:00:00.000Z',
      updatedAt: '2026-03-20T13:00:00.000Z',
    };

    const graph = selectGraphState.select(makeOverviewState(session), WS);
    const agentNode = graph.nodes.find((node) => node.type === 'agent' && node.agentId === 'a1');

    expect(agentNode?.status).toBe('waiting');
    expect(agentNode && 'isWaiting' in agentNode).toBe(false);
    expect(agentNode && 'isWaitingForOtherAgents' in agentNode).toBe(false);
  });

  it('marks daemon tool-waiting turns as selector-derived waiting without changing Thinking label eligibility', () => {
    const session: AgentSession = {
      id: 'a1' as any,
      backendSessionId: null,
      workspaceId: WS as any,
      name: 'Agent a1',
      status: 'idle' as any,
      isWaitingOnTool: true,
      messages: [],
      createdAt: '2026-03-20T13:00:00.000Z',
      updatedAt: '2026-03-20T13:00:00.000Z',
    };

    const graph = selectGraphState.select(makeOverviewState(session), WS);
    const agentNode = graph.nodes.find((node) => node.type === 'agent' && node.agentId === 'a1');

    expect(agentNode?.status).toBe('responding');
    expect(agentNode && 'isWaiting' in agentNode).toBe(false);
    expect(agentNode && 'isWaitingForOtherAgents' in agentNode).toBe(false);
  });

  it('keeps explicit waiting-for-other-agents graph status distinct via the canonical selector', () => {
    const session: AgentSession = {
      id: 'a1' as any,
      backendSessionId: null,
      workspaceId: WS as any,
      name: 'Agent a1',
      status: 'Waiting' as any,
      isWaitingForOtherAgents: true,
      waitingForAgentIds: ['a2'],
      messages: [],
      createdAt: '2026-03-20T13:00:00.000Z',
      updatedAt: '2026-03-20T13:00:00.000Z',
    };

    const graph = selectGraphState.select(makeOverviewState(session), WS);
    const agentNode = graph.nodes.find((node) => node.type === 'agent' && node.agentId === 'a1');

    expect(agentNode?.status).toBe('waiting');
    expect(agentNode?.waitingForAgentIds).toEqual(['a2']);
    expect(agentNode && 'isWaiting' in agentNode).toBe(false);
    expect(agentNode && 'isWaitingForOtherAgents' in agentNode).toBe(false);
  });
});

function makeSession(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: id as any,
    backendSessionId: null,
    workspaceId: WS as any,
    name: `Agent ${id}`,
    status: 'idle' as any,
    messages: [],
    createdAt: '2026-03-20T13:00:00.000Z',
    updatedAt: '2026-03-20T13:00:00.000Z',
    ...overrides,
  };
}

function makeTaskEvent(
  id: string,
  type: string,
  timestamp: string,
  data: Record<string, unknown>,
): WorkspaceEvent {
  return makeWorkspaceEvent({ id, type: type as any, timestamp, data });
}
