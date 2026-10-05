import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../test/mocks/backend-transport.mock';
import { store } from '$store/renderer/store';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { chatTranscriptSnapshotApplied } from '$store/renderer/slices/chat-state/chat-state-slice';
import { AgentStatus, type AgentSession } from '$shared/types';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { setSubscriptionSnapshot } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import {
  routeDaemonEventsNotification,
  __resetDaemonEventsBridgeForTests,
} from '$features/events/daemon-events-bridge.client';
import {
  resetAgentSubscriptionsViewStateForTests,
  setWaitingAgentsExpanded,
} from '../agent-subscriptions-view-state';
import AgentSubscriptions from '../AgentSubscriptions.svelte';
import EventSubscriptionsCard from '../EventSubscriptionsCard.svelte';

const WS = 'visible-task-workspace';
const AGENT = 'watcher';
const CHILD = 'worker';

describe('displayed chat task consumers through the real store and mock wire', () => {
  let backend: MockBackendHandle;
  let dispose: () => void;
  let stop: () => void;
  let eventId = 0;
  const reads = () => backend.requests.filter(({ method }) => method === 'task.list');
  const demand = (id = WS) => store.state.workspaceTasks.byWorkspaceId[id]?.demandIds ?? [];
  const settle = async () => {
    flushSync();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
  };
  function watch(workspaceId = WS) {
    store.dispatch(
      setSubscriptionSnapshot(workspaceId, AGENT, {
        subscriptions: [
          {
            id: `watch-${workspaceId}`,
            description: 'Waiting for worker',
            agentId: AGENT,
            actorIds: [CHILD],
            eventTypes: ['agent:idle'],
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'waiting',
      }),
    );
  }
  function event(workspaceId = WS) {
    routeDaemonEventsNotification('events.event', {
      event: {
        id: `visibility-${++eventId}`,
        type: 'task:created',
        workspaceId,
        data: { noteId: 'task-1' },
      },
    });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockBackend();
    resetAgentSubscriptionsViewStateForTests();
    __resetDaemonEventsBridgeForTests();
    backend = installMockBackend();
    backend.onRequest('task.list', () => ({
      tasks: [],
      stats: { total: 0, completed: 0, inProgress: 0 },
    }));
    dispose = store.init();
    stop = store.runSaga(lifecycleReadSaga);
    watch();
  });
  afterEach(() => {
    cleanup();
    stop();
    dispose();
    __resetDaemonEventsBridgeForTests();
    resetMockBackend();
    vi.useRealTimers();
  });

  it('loads empty visible rows, stays quiet while hidden, and refreshes the first task on return', async () => {
    const props = { workspaceId: WS, agentId: AGENT, isActive: false };
    const view = render(AgentSubscriptions, props);
    await settle();
    expect(reads()).toEqual([]);
    expect(demand()).toEqual([]);
    await view.rerender({ ...props, isActive: true });
    await settle();
    expect(reads()).toEqual([{ method: 'task.list', params: { workspaceId: WS } }]);
    expect(store.state.workspaceTasks.byWorkspaceId[WS].initialized).toBe(true);
    await view.rerender(props);
    expect(demand()).toEqual([]);
    backend.onRequest('task.list', () => ({
      tasks: [{ id: 'task-1', title: 'First task', status: 'in_progress' }],
      stats: { total: 1, completed: 0, inProgress: 1 },
    }));
    event();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(1);
    await view.rerender({ ...props, isActive: true });
    await settle();
    expect(reads()).toHaveLength(2);
    expect(store.state.workspaceTasks.byWorkspaceId[WS].tasks.map['task-1']).toMatchObject({
      title: 'First task',
      status: 'in_progress',
    });
    await view.rerender(props);
    await view.rerender({ ...props, isActive: true });
    await settle();
    expect(reads()).toHaveLength(2);
  });

  it('updates an already displayed empty list when its first task is created and renders the reply', async () => {
    store.dispatch(
      bulkUpsertSessions([
        {
          id: CHILD,
          workspaceId: WS,
          name: 'Worker',
          status: AgentStatus.Idle,
          messages: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          metadata: { taskNoteId: 'task-1' },
        } as AgentSession,
      ]),
    );
    store.dispatch(chatTranscriptSnapshotApplied(CHILD, { truncated: false, totalMessages: 0 }));
    render(AgentSubscriptions, { workspaceId: WS, agentId: AGENT, isActive: true });
    await settle();
    expect(reads()).toHaveLength(1);
    backend.onRequest('task.list', () => ({
      tasks: [{ id: 'task-1', title: 'First live task', status: 'in_progress' }],
      stats: { total: 1, completed: 0, inProgress: 1 },
    }));
    event();
    await vi.advanceTimersByTimeAsync(1100);
    await settle();
    expect(reads()).toHaveLength(2);
    expect(store.state.workspaceTasks.byWorkspaceId[WS].stats).toEqual({
      total: 1,
      completed: 0,
      inProgress: 1,
    });
    await fireEvent.click(screen.getByRole('button', { name: /Task progress: 0 of 1/ }));
    await settle();
    expect(screen.getByText('First live task')).toBeTruthy();
  });

  it('shares one read across chats and releases only each closing consumer', async () => {
    const props = { workspaceId: WS, agentId: AGENT, isActive: true };
    const first = render(AgentSubscriptions, props);
    const second = render(AgentSubscriptions, props);
    await settle();
    expect(new Set(demand()).size).toBe(2);
    expect(reads()).toHaveLength(1);
    first.unmount();
    expect(demand()).toHaveLength(1);
    event();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(2);
    second.unmount();
    expect(demand()).toEqual([]);
    event();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(2);
  });

  it('releases old workspace demand on switch and workspace unmount', async () => {
    watch('other-workspace');
    const view = render(AgentSubscriptions, { workspaceId: WS, agentId: AGENT, isActive: true });
    await settle();
    await view.rerender({ workspaceId: 'other-workspace', agentId: AGENT, isActive: true });
    await settle();
    expect(demand()).toEqual([]);
    expect(demand('other-workspace')).toHaveLength(1);
    expect(reads()).toEqual([
      { method: 'task.list', params: { workspaceId: WS } },
      { method: 'task.list', params: { workspaceId: 'other-workspace' } },
    ]);
    store.dispatch(workspaceUnmounted('other-workspace'));
    expect(demand('other-workspace')).toEqual([]);
    event();
    event('other-workspace');
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(2);
  });

  it('does not load collapsed delegated rows and releases demand when their disclosure closes', async () => {
    render(AgentSubscriptions, {
      workspaceId: WS,
      agentId: AGENT,
      isActive: true,
      forceWaitingHeader: true,
    });
    await settle();
    expect(reads()).toEqual([]);
    const disclosure = screen.getByRole('button', { expanded: false });
    await fireEvent.click(disclosure);
    await settle();
    expect(reads()).toHaveLength(1);
    expect(demand()).toHaveLength(1);
    await fireEvent.click(disclosure);
    await settle();
    expect(demand()).toEqual([]);
    event();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(1);
  });

  it('passes owning chat visibility through the real event card to delegated summaries', async () => {
    setWaitingAgentsExpanded(WS, AGENT, true);
    const props = { workspaceId: WS, agentId: AGENT, isActive: false };
    const view = render(EventSubscriptionsCard, props);
    await settle();
    expect(demand()).toEqual([]);
    await view.rerender({ ...props, isActive: true });
    await settle();
    expect(reads()).toHaveLength(1);
    await view.rerender(props);
    expect(demand()).toEqual([]);
    await view.rerender({ ...props, isActive: true });
    await settle();
    expect(demand()).toHaveLength(1);
    await fireEvent.click(screen.getByTestId('event-subscriptions-summary'));
    await settle();
    expect(demand()).toEqual([]);
    event();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(1);
  });
});
