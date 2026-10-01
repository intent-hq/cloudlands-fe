import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock(
  '$lib/client/live/backend-transport',
  async () => (await import('../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../test/mocks/backend-transport.mock';
import { store } from '$store/renderer/store';
import { normalizeNote } from '$lib/client/live/live-notes-client';
import { ensureNoteContentLoaded, __resetNotesReadServiceForTests } from './notes-read-service';
import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import {
  ensureWorkspaceTasksLoaded,
  loadWorkspaceTasksRequested,
} from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import {
  workspaceUnmounted,
  backendReconnected,
} from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  daemonEventsSubscribed,
  daemonEventsSubscribing,
} from '$store/renderer/slices/workspace-events/workspace-events-slice';
import { workspaceReconnectSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/workspace-reconnect-saga';
import { daemonEventsSaga } from '$store/renderer/slices/workspace-events/sagas/daemon-events-saga';
import { agentSubscriptionReadSaga } from '$store/renderer/slices/agent-subscription-ui/sagas/agent-subscription-read-saga';
import {
  requestSubscriptionFetch,
  refreshWorkspaceSubscriptionEntriesRequested,
  makeKey,
} from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import { initializeChatRequested } from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  routeDaemonEventsNotification,
  __resetDaemonEventsBridgeForTests,
} from '$features/events/daemon-events-bridge.client';

import { markAgentAsViewed } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { AgentStatus, type AgentSession } from '$shared/types';

const WS = 'read-workspace';
const AGENT = 'read-agent';
const settle = () => vi.advanceTimersByTimeAsync(0);
const empty = () => ({ subscriptions: [], delegationGroups: [], agentStatuses: {} });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('background reads through the real store, sagas, clients and event bridge', () => {
  let backend: MockBackendHandle;
  let dispose: () => void;
  const cancel: Array<() => void> = [];
  let eventId = 0;
  const reads = (method: string) => backend.requests.filter((r) => r.method === method);
  const note = (content = 'fresh') =>
    normalizeNote({ id: 'task-note', title: 'Task', content }, WS);
  function event(type: string, data: Record<string, unknown> = {}) {
    routeDaemonEventsNotification('events.event', {
      event: { id: `read-${++eventId}`, type, workspaceId: WS, data },
    });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockBackend();
    __resetNotesReadServiceForTests();
    __resetDaemonEventsBridgeForTests();
    backend = installMockBackend();
    backend.onRequest('agent.getSubscriptions', empty);
    backend.onRequest('note.get', () => ({ note: note() }));
    backend.onRequest('task.list', () => ({ tasks: [], stats: { total: 1, completed: 1 } }));
    dispose = store.init();
    cancel.push(store.runSaga(agentSubscriptionReadSaga), store.runSaga(lifecycleReadSaga));
    store.dispatch(
      loadWorkspaceNotesSucceeded([WS], { [WS]: [{ ...note(''), contentLength: 5 }] }),
    );
  });
  afterEach(() => {
    cancel
      .splice(0)
      .reverse()
      .forEach((stop) => stop());
    __resetDaemonEventsBridgeForTests();
    __resetNotesReadServiceForTests();
    dispose();
    resetMockBackend();
    vi.useRealTimers();
  });

  it('joins concurrent note content demand without an unnecessary trailing note.get', async () => {
    const pending = deferred<{ note: ReturnType<typeof note> }>();
    backend.onRequest('note.get', () => pending.promise);
    const first = ensureNoteContentLoaded(WS, 'task-note');
    const second = ensureNoteContentLoaded(WS, 'task-note');
    expect(reads('note.get')).toEqual([
      { method: 'note.get', params: { workspaceId: WS, noteId: 'task-note' } },
    ]);
    pending.resolve({ note: note() });
    await settle();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads('note.get')).toHaveLength(1);
  });

  it('preserves one trailing read when a genuine note event arrives during content demand', async () => {
    const pending = deferred<{ note: ReturnType<typeof note> }>();
    let calls = 0;
    backend.onRequest('note.get', () =>
      ++calls === 1 ? pending.promise : { note: note('newer') },
    );
    const loaded = ensureNoteContentLoaded(WS, 'task-note');
    event('note:updated', { noteId: 'task-note' });
    event('note:updated', { noteId: 'task-note' });
    pending.resolve({ note: note('older') });
    await settle();
    expect(await loaded).toBe(true);
    expect(reads('note.get')).toHaveLength(2);
    expect(store.state.workspaceNotes.byWorkspaceId[WS].notes.map['task-note'].content).toBe(
      'newer',
    );
  });

  it('shares initial subscription demand with card mounting and ignores repeated ready demand', async () => {
    const pending = deferred<ReturnType<typeof empty>>();
    backend.onRequest('agent.getSubscriptions', () => pending.promise);
    store.dispatch(initializeChatRequested(AGENT, { wsId: WS }));
    store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
    pending.resolve(empty());
    await settle();
    store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
    store.dispatch(initializeChatRequested(AGENT, { wsId: WS }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads('agent.getSubscriptions')).toEqual([
      { method: 'agent.getSubscriptions', params: { workspaceId: WS, agentId: AGENT } },
    ]);
    expect(store.state.agentSubscriptionUI.entries[makeKey(WS, AGENT)].snapshotStatus).toBe(
      'ready',
    );
    store.dispatch(refreshWorkspaceSubscriptionEntriesRequested(WS));
    await settle();
    expect(reads('agent.getSubscriptions')).toHaveLength(2);
    store.dispatch(workspaceUnmounted(WS));
    store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
    await settle();
    expect(reads('agent.getSubscriptions')).toHaveLength(3);
  });

  it.each(['initialize', 'request'] as const)(
    'retains events during the first %s subscription read',
    async (trigger) => {
      const pending = deferred<ReturnType<typeof empty>>();
      let calls = 0;
      backend.onRequest('agent.getSubscriptions', () =>
        ++calls === 1
          ? pending.promise
          : {
              ...empty(),
              subscriptions: [
                {
                  id: 'new-watch',
                  agentId: 'child',
                  eventTypes: [],
                  actorIds: [],
                  createdAt: '2026-01-01',
                },
              ],
            },
      );
      store.dispatch(
        trigger === 'initialize'
          ? initializeChatRequested(AGENT, { wsId: WS })
          : requestSubscriptionFetch(WS, AGENT, true),
      );
      event('agent:subscriptions-changed', { agentId: AGENT });
      event('agent:subscriptions-changed', { agentId: 'never-viewed' });
      store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
      pending.resolve(empty());
      await settle();
      expect(reads('agent.getSubscriptions')).toHaveLength(2);
      expect(store.state.agentSubscriptionUI.entries[makeKey(WS, AGENT)].subscriptions[0].id).toBe(
        'new-watch',
      );
    },
  );

  it('reconciles demand that completed before the initial event subscription went live', async () => {
    const ack = deferred<{ subscriptionId: string }>();
    backend.onSubscribe(() => ack.promise);
    cancel.push(store.runSaga(workspaceReconnectSaga), store.runSaga(daemonEventsSaga));
    store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
    await settle();
    expect(reads('agent.getSubscriptions')).toHaveLength(1);
    backend.onRequest('agent.getSubscriptions', () => ({
      ...empty(),
      subscriptions: [
        {
          id: 'boot-watch',
          agentId: 'child',
          eventTypes: [],
          actorIds: [],
          createdAt: '2026-01-01',
          description: '',
        },
      ],
    }));
    ack.resolve({ subscriptionId: 'initial' });
    await settle();
    expect(
      store.state.agentSubscriptionUI.entries[makeKey(WS, AGENT)].subscriptions.map((s) => s.id),
    ).toEqual(['boot-watch']);
    expect(reads('agent.getSubscriptions')).toHaveLength(2);
  });

  it('reconciles subscriptions after the replacement event subscription is acknowledged', async () => {
    cancel.push(store.runSaga(workspaceReconnectSaga), store.runSaga(daemonEventsSaga));
    await settle();
    expect(store.state.workspaceEvents.subscriptionGeneration).toBe(1);
    store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
    await settle();
    const initialReads = reads('agent.getSubscriptions').length;
    const ack = deferred<{ subscriptionId: string }>();
    backend.onSubscribe(() => ack.promise);
    backend.triggerReconnect();
    await settle();
    expect(store.state.workspaceEvents.subscriptionPending).toBe(true);
    // Any read before the replacement subscription is live misses this change.
    backend.onRequest('agent.getSubscriptions', () => ({
      ...empty(),
      subscriptions: [
        {
          id: 'gap-watch',
          agentId: 'child',
          eventTypes: [],
          actorIds: [],
          createdAt: '2026-01-01',
          description: '',
        },
      ],
    }));
    ack.resolve({ subscriptionId: 'replacement' });
    await settle();
    expect(store.state.workspaceEvents.subscriptionGeneration).toBe(2);
    expect(
      store.state.agentSubscriptionUI.entries[makeKey(WS, AGENT)].subscriptions.map((s) => s.id),
    ).toEqual(['gap-watch']);
    expect(reads('agent.getSubscriptions')).toHaveLength(initialReads + 1);
  });

  it('refreshes cached subscriptions only on an admitted live generation while the card stays mounted', async () => {
    store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
    await settle();
    store.dispatch(daemonEventsSubscribing());
    const attempt = store.state.workspaceEvents.subscriptionAttempt;
    store.dispatch(daemonEventsSubscribed(attempt - 1));
    await settle();
    expect(reads('agent.getSubscriptions')).toHaveLength(1);
    store.dispatch(daemonEventsSubscribed(attempt));
    await settle();
    expect(reads('agent.getSubscriptions')).toHaveLength(2);
    store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
    await settle();
    expect(reads('agent.getSubscriptions')).toHaveLength(2);
  });

  it('keeps switch-back freshness and retries failed mount demand', async () => {
    for (const id of [AGENT, 'second-agent']) {
      store.dispatch(
        bulkUpsertSessions([
          {
            id,
            workspaceId: WS,
            name: id,
            status: AgentStatus.Pending,
            messages: [],
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          } as AgentSession,
        ]),
      );
    }
    let failed = true;
    backend.onRequest('agent.getSubscriptions', () => {
      if (failed) throw new Error('temporary transport failure');
      return empty();
    });
    store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
    await settle();
    expect(store.state.agentSubscriptionUI.entries[makeKey(WS, AGENT)].snapshotStatus).toBe(
      'failed',
    );
    failed = false;
    store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
    await settle();
    store.dispatch(markAgentAsViewed('second-agent'));
    await settle();
    store.dispatch(markAgentAsViewed(AGENT));
    store.dispatch(initializeChatRequested(AGENT, { wsId: WS }));
    store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
    await settle();
    expect(reads('agent.getSubscriptions').map((r) => r.params)).toEqual([
      { workspaceId: WS, agentId: AGENT },
      { workspaceId: WS, agentId: AGENT },
      { workspaceId: WS, agentId: 'second-agent' },
      { workspaceId: WS, agentId: AGENT },
    ]);
  });

  it('retains an event invalidation when mount demand arrives during a pending subscription read', async () => {
    // Seed tracking, then hold an authoritative event refresh.
    store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
    await settle();
    const pending = deferred<ReturnType<typeof empty>>();
    let calls = 0;
    backend.onRequest('agent.getSubscriptions', () => (++calls === 1 ? pending.promise : empty()));
    event('agent:subscriptions-changed', { agentId: AGENT });
    event('agent:subscriptions-changed', { agentId: AGENT });
    store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
    pending.resolve(empty());
    await settle();
    expect(reads('agent.getSubscriptions')).toHaveLength(3);
    // An unmounted workspace must no longer be tracked for reconnect.
    store.dispatch(workspaceUnmounted(WS));
    store.dispatch(backendReconnected());
    store.dispatch(daemonEventsSubscribed());
    await settle();
    expect(reads('agent.getSubscriptions')).toHaveLength(3);
  });

  it('refreshes only the changed parent instead of every tracked subscription entry', async () => {
    for (const id of [AGENT, 'other-a', 'other-b'])
      store.dispatch(requestSubscriptionFetch(WS, id));
    await settle();
    const initial = reads('agent.getSubscriptions').length;
    event('agent:subscriptions-changed', { agentId: AGENT });
    await settle();
    expect(reads('agent.getSubscriptions').slice(initial)).toEqual([
      { method: 'agent.getSubscriptions', params: { workspaceId: WS, agentId: AGENT } },
    ]);
    event('agent:subscriptions-changed', { agentId: 'never-viewed' });
    await settle();
    expect(reads('agent.getSubscriptions')).toHaveLength(initial + 1);
    event('agent:subscriptions-changed');
    await settle();
    expect(reads('agent.getSubscriptions')).toHaveLength(initial + 4);
  });

  it.each([
    ['ensure', 0],
    ['ensure', 2000],
    ['force', 0],
    ['force', 2000],
  ] as const)(
    'retains task invalidations during first %s load with response delayed %i ms',
    async (trigger, delay) => {
      const pending = deferred<{ tasks: []; stats: { total: number; completed: number } }>();
      let calls = 0;
      backend.onRequest('task.list', () =>
        ++calls === 1 ? pending.promise : { tasks: [], stats: { total: 1, completed: 1 } },
      );
      store.dispatch(
        trigger === 'ensure' ? ensureWorkspaceTasksLoaded(WS) : loadWorkspaceTasksRequested(WS),
      );
      await settle();
      event('task:status-changed', {
        noteId: 'task-note',
        previousStatus: 'in_progress',
        newStatus: 'complete',
      });
      event('note:updated', { noteId: 'task-note' });
      await vi.advanceTimersByTimeAsync(delay);
      pending.resolve({ tasks: [], stats: { total: 1, completed: 0 } });
      await vi.advanceTimersByTimeAsync(2000);
      expect(reads('task.list')).toHaveLength(2);
      expect(store.state.workspaceTasks.byWorkspaceId[WS].stats.completed).toBe(1);
    },
  );

  it('retries a failed first task read and keeps never-demanded workspaces quiet', async () => {
    event('task:status-changed', { noteId: 'task-note', newStatus: 'complete' });
    event('note:updated', { noteId: 'task-note' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(reads('task.list')).toHaveLength(0);
    backend.onRequest('task.list', () => {
      throw new Error('temporary failure');
    });
    store.dispatch(ensureWorkspaceTasksLoaded(WS));
    await settle();
    expect(store.state.workspaceTasks.byWorkspaceId[WS].loading).toBe(false);
    backend.onRequest('task.list', () => ({ tasks: [], stats: { total: 1, completed: 1 } }));
    store.dispatch(ensureWorkspaceTasksLoaded(WS));
    await settle();
    expect(reads('task.list')).toHaveLength(2);
    expect(store.state.workspaceTasks.byWorkspaceId[WS].stats.completed).toBe(1);
  });

  it('drops pending initial task invalidations on unmount and permits the next demand', async () => {
    const pending = deferred<{ tasks: []; stats: { total: number; completed: number } }>();
    backend.onRequest('task.list', () => pending.promise);
    store.dispatch(ensureWorkspaceTasksLoaded(WS));
    await settle();
    event('task:status-changed', { noteId: 'task-note', newStatus: 'complete' });
    store.dispatch(workspaceUnmounted(WS));
    pending.resolve({ tasks: [], stats: { total: 1, completed: 0 } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(reads('task.list')).toHaveLength(1);
    expect(store.state.workspaceTasks.byWorkspaceId[WS]?.initialized).not.toBe(true);
    store.dispatch(ensureWorkspaceTasksLoaded(WS));
    await settle();
    expect(reads('task.list')).toHaveLength(2);
  });

  it('coalesces paired task status and note events into one authoritative task-list refresh', async () => {
    store.dispatch(ensureWorkspaceTasksLoaded(WS));
    await settle();
    const initial = reads('task.list').length;
    event('task:status-changed', {
      noteId: 'task-note',
      previousStatus: 'in_progress',
      newStatus: 'complete',
    });
    event('note:updated', { noteId: 'task-note' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(reads('task.list').slice(initial)).toEqual([
      { method: 'task.list', params: { workspaceId: WS } },
    ]);
    expect(store.state.workspaceTasks.byWorkspaceId[WS].stats.completed).toBe(1);
    const settled = reads('task.list').length;
    store.dispatch(ensureWorkspaceTasksLoaded(WS));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads('task.list')).toHaveLength(settled);
  });
});
