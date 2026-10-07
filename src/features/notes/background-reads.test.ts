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
  acquireWorkspaceTasksDemand,
  releaseWorkspaceTasksDemand,
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
import {
  agentSubscriptionReadSaga,
  COMPLETED_DISPLAY_DURATION_MS,
} from '$store/renderer/slices/agent-subscription-ui/sagas/agent-subscription-read-saga';
import {
  requestSubscriptionFetch,
  refreshWorkspaceSubscriptionEntriesRequested,
  setSubscriptionSnapshot,
  makeKey,
} from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import {
  initializeChatRequested,
  transcriptHydrationStarted,
  transcriptHydrationSettled,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  routeDaemonEventsNotification,
  __resetDaemonEventsBridgeForTests,
} from '$features/events/daemon-events-bridge.client';

import { markAgentAsViewed } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  AgentStatus,
  WorkspaceStatusEnum,
  type AgentSession,
  type Workspace,
  type WorkspaceId,
} from '$shared/types';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { selectHudWorkspaceCards } from '$store/renderer/slices/hud/hud-selectors';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  selectWorkspaceTaskProgress,
  selectWorkspaceTasks,
} from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';

import {
  bootstrapNewWorkspaceLayout,
  initializeLayout,
  setActiveTab,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import {
  openWorkspaceTab,
  workspaceTabsHydrated,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import { panelLayoutSaga } from '$store/renderer/slices/panel-layout/sagas/panel-layout-saga';
import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  selectAwaitingSwitchBackSnapshot,
  selectTranscriptHydratedOnce,
} from '$store/renderer/slices/chat-state/chat-state-selectors';
import { shouldDeferTranscriptReveal } from '$lib/components/chat/chat-panel-visibility';
import { selectSubscriptionSnapshotStatus } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-selectors';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { startWorkspaceNotesSagaFixture } from '../../test/fixtures/workspace-notes-saga-fixture';

const WS = 'read-workspace';
const AGENT = 'read-agent';
const settle = () => vi.advanceTimersByTimeAsync(0);
const empty = () => ({ subscriptions: [], delegationGroups: [], agentStatuses: {} });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('background reads through the real store, sagas, clients and event bridge', () => {
  let backend: MockBackendHandle;
  let dispose: () => void;
  const cancel: Array<() => void> = [];
  let eventId = 0;
  const reads = (method: string) => backend.requests.filter((r) => r.method === method);
  const note = (content = 'fresh') =>
    normalizeNote({ id: 'task-note', title: 'Task', content }, WS);
  function event(type: string, data: Record<string, unknown> = {}, workspaceId = WS) {
    routeDaemonEventsNotification('events.event', {
      event: { id: `read-${++eventId}`, type, workspaceId, data },
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
    backend.onRequest('task.list', () => ({
      tasks: [],
      stats: { total: 1, completed: 1, inProgress: 0 },
    }));
    dispose = store.init();
    cancel.push(
      ...startWorkspaceNotesSagaFixture(store),
      store.runSaga(agentSubscriptionReadSaga),
      store.runSaga(lifecycleReadSaga),
    );
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

  function conversationLayout(wsId = WS, agentId = AGENT) {
    store.dispatch(
      initializeLayout(wsId, {
        root: { type: 'panel', panelId: 'conversation' },
        panels: {
          conversation: {
            id: 'conversation',
            activeTabId: 'visible',
            tabs: [
              { id: 'visible', type: 'agent', title: 'Visible', agentId },
              { id: 'hidden', type: 'agent', title: 'Hidden', agentId: 'hidden-agent' },
            ],
          },
        },
        focusedPanelId: 'conversation',
      }),
    );
  }

  it.each(['pending', 'completed'] as const)(
    'prefetches on workspace selection and shares %s demand with chat mounting',
    async (timing) => {
      const pending = deferred<ReturnType<typeof empty>>();
      backend.onRequest('agent.getSubscriptions', () => pending.promise);
      conversationLayout();
      store.dispatch(workspaceTabsHydrated(LOCAL_CONNECTION_ID));
      expect(reads('agent.getSubscriptions')).toHaveLength(0);
      store.dispatch(openWorkspaceTab(WS));
      expect(reads('agent.getSubscriptions')).toEqual([
        { method: 'agent.getSubscriptions', params: { workspaceId: WS, agentId: AGENT } },
      ]);
      if (timing === 'completed') {
        pending.resolve(empty());
        await settle();
      }
      store.dispatch(
        bulkUpsertSessions([
          {
            id: AGENT,
            workspaceId: WS,
            name: AGENT,
            status: AgentStatus.Pending,
            messages: [],
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          } as AgentSession,
        ]),
      );
      store.dispatch(initializeChatRequested(AGENT, { wsId: WS }));
      store.dispatch(markAgentAsViewed(AGENT));
      store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
      pending.resolve(empty());
      await settle();
      expect(reads('agent.getSubscriptions')).toHaveLength(1);
      expect(store.state.agentSubscriptionUI.entries[makeKey(WS, AGENT)].snapshotStatus).toBe(
        'ready',
      );
      store.dispatch(openWorkspaceTab('elsewhere'));
      store.dispatch(openWorkspaceTab(WS));
      await settle();
      expect(reads('agent.getSubscriptions')).toHaveLength(2);
    },
  );

  it('waits for the destination layout and refreshes only newly displayed conversations', async () => {
    store.dispatch(workspaceTabsHydrated(LOCAL_CONNECTION_ID));
    store.dispatch(openWorkspaceTab(WS));
    expect(reads('agent.getSubscriptions')).toHaveLength(0);
    conversationLayout('inactive-workspace', 'inactive-agent');
    expect(reads('agent.getSubscriptions')).toHaveLength(0);
    conversationLayout();
    await settle();
    expect(reads('agent.getSubscriptions').map((r) => r.params)).toEqual([
      { workspaceId: WS, agentId: AGENT },
    ]);
    store.dispatch(setActiveTab(WS, 'hidden', 'conversation'));
    await settle();
    store.dispatch(setActiveTab(WS, 'visible', 'conversation'));
    await settle();
    expect(reads('agent.getSubscriptions').map((r) => r.params)).toEqual([
      { workspaceId: WS, agentId: AGENT },
      { workspaceId: WS, agentId: 'hidden-agent' },
      { workspaceId: WS, agentId: AGENT },
    ]);
  });

  it('starts demand when delayed sessions resolve the initial conversation through the layout saga', async () => {
    cancel.push(store.runSaga(panelLayoutSaga));
    store.dispatch(workspaceTabsHydrated(LOCAL_CONNECTION_ID));
    store.dispatch(openWorkspaceTab(WS));
    store.dispatch(bootstrapNewWorkspaceLayout(WS, null, 'Initial agent'));
    expect(reads('agent.getSubscriptions')).toHaveLength(0);
    const session = {
      id: AGENT,
      workspaceId: WS,
      name: AGENT,
      status: AgentStatus.Pending,
      messages: [],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      isInitialAgent: true,
    } as AgentSession;
    store.dispatch(
      setAgents(WS, [
        { ...session, id: 'background-agent', isInitialAgent: false, isBackground: true },
        session,
      ]),
    );
    await settle();
    expect(reads('agent.getSubscriptions')).toEqual([
      { method: 'agent.getSubscriptions', params: { workspaceId: WS, agentId: AGENT } },
    ]);
  });

  it('prefetches each displayed conversation once across restored columns', async () => {
    store.dispatch(
      initializeLayout(WS, {
        root: {
          type: 'split',
          direction: 'horizontal',
          sizes: [34, 33, 33],
          children: [
            { type: 'panel', panelId: 'left' },
            { type: 'panel', panelId: 'middle' },
            { type: 'panel', panelId: 'right' },
          ],
        },
        panels: Object.fromEntries(
          [
            ['left', AGENT],
            ['middle', 'second-agent'],
            ['right', AGENT],
          ].map(([id, agentId]) => [
            id,
            {
              id,
              activeTabId: id,
              tabs: [{ id, type: 'agent', agentId, title: id }],
            },
          ]),
        ),
        focusedPanelId: 'left',
        columnCount: 3,
      }),
    );
    store.dispatch(workspaceTabsHydrated(LOCAL_CONNECTION_ID));
    store.dispatch(openWorkspaceTab(WS));
    await settle();
    expect(reads('agent.getSubscriptions').map((r) => r.params)).toEqual([
      { workspaceId: WS, agentId: AGENT },
      { workspaceId: WS, agentId: 'second-agent' },
    ]);
  });

  it('settles the transcript reveal while the selected conversation subscription read is still pending', async () => {
    const pending = deferred<ReturnType<typeof empty>>();
    backend.onRequest('agent.getSubscriptions', () => pending.promise);
    conversationLayout();
    store.dispatch(workspaceTabsHydrated(LOCAL_CONNECTION_ID));
    store.dispatch(openWorkspaceTab(WS));
    store.dispatch(initializeChatRequested(AGENT, { wsId: WS }));
    store.dispatch(transcriptHydrationStarted(AGENT));
    store.dispatch(transcriptHydrationSettled(AGENT));
    expect(reads('agent.getSubscriptions')).toHaveLength(1);
    expect(selectSubscriptionSnapshotStatus.select(store.state, WS, AGENT)).toBe('loading');
    expect(
      shouldDeferTranscriptReveal({
        awaitingSwitchBackSnapshot: selectAwaitingSwitchBackSnapshot.select(store.state, AGENT),
        transcriptHydratedOnce: selectTranscriptHydratedOnce.select(store.state, AGENT),
        hasPendingInitialPrompt: false,
      }),
    ).toBe(false);
    pending.resolve(empty());
    await settle();
  });

  it('keeps rapid workspace switches isolated and retains invalidation during prefetch', async () => {
    const first = deferred<ReturnType<typeof empty>>();
    backend.onRequest('agent.getSubscriptions', (params) =>
      params.workspaceId === WS ? first.promise : empty(),
    );
    conversationLayout();
    conversationLayout('second-workspace', 'second-agent');
    store.dispatch(workspaceTabsHydrated(LOCAL_CONNECTION_ID));
    store.dispatch(openWorkspaceTab(WS));
    store.dispatch(openWorkspaceTab('second-workspace'));
    store.dispatch(openWorkspaceTab(WS));
    event('agent:subscriptions-changed', { agentId: AGENT });
    first.resolve(empty());
    await settle();
    expect(reads('agent.getSubscriptions').map((r) => r.params)).toEqual([
      { workspaceId: WS, agentId: AGENT },
      { workspaceId: 'second-workspace', agentId: 'second-agent' },
      { workspaceId: WS, agentId: AGENT },
    ]);
    expect(store.state.agentSubscriptionUI.entries[makeKey(WS, AGENT)].snapshotStatus).toBe(
      'ready',
    );
    expect(
      store.state.agentSubscriptionUI.entries[makeKey('second-workspace', 'second-agent')]
        .snapshotStatus,
    ).toBe('ready');
    expect(store.state.agentSubscriptionUI.entries[makeKey(WS, 'second-agent')]).toBeUndefined();
  });

  it('does not prefetch the previous backend tab strip before hydration', async () => {
    conversationLayout();
    store.dispatch(openWorkspaceTab(WS));
    store.dispatch(workspaceTabsHydrated('other-backend'));
    expect(reads('agent.getSubscriptions')).toHaveLength(0);
    store.dispatch(workspaceTabsHydrated(LOCAL_CONNECTION_ID));
    await settle();
    expect(reads('agent.getSubscriptions')).toEqual([
      { method: 'agent.getSubscriptions', params: { workspaceId: WS, agentId: AGENT } },
    ]);
  });

  it('settles concurrent note content demand while the latest seq owns the store update', async () => {
    const pending = deferred<{ note: ReturnType<typeof note> }>();
    backend.onRequest('note.get', () => pending.promise);
    const first = ensureNoteContentLoaded(WS, 'task-note');
    const second = ensureNoteContentLoaded(WS, 'task-note');
    await settle();
    expect(reads('note.get')).toEqual([
      { method: 'note.get', params: { workspaceId: WS, noteId: 'task-note' } },
      { method: 'note.get', params: { workspaceId: WS, noteId: 'task-note' } },
    ]);
    pending.resolve({ note: note() });
    await settle();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads('note.get')).toHaveLength(2);
  });

  it('preserves one trailing event read when a genuine note event arrives during content demand', async () => {
    const pending = deferred<{ note: ReturnType<typeof note> }>();
    let calls = 0;
    backend.onRequest('note.get', () =>
      ++calls === 1 ? pending.promise : { note: note('newer') },
    );
    const loaded = ensureNoteContentLoaded(WS, 'task-note');
    await settle();
    event('note:updated', { noteId: 'task-note' });
    event('note:updated', { noteId: 'task-note' });
    pending.resolve({ note: note('older') });
    await settle();
    expect(await loaded).toBe(true);
    // Event reads are trailing-coalesced, and their newer async-action seq keeps
    // the earlier content-demand response from overwriting the refreshed note.
    expect(reads('note.get')).toHaveLength(3);
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

  it.each(['empty', 'failed'] as const)(
    'settles switch-back demand during an %s completion confirmation',
    async (outcome) => {
      store.dispatch(
        bulkUpsertSessions([
          {
            id: AGENT,
            workspaceId: WS,
            name: AGENT,
            status: AgentStatus.Pending,
            messages: [],
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          } as AgentSession,
        ]),
      );
      store.dispatch(setSubscriptionSnapshot(WS, AGENT, { ...empty(), waitingState: 'waiting' }));
      store.dispatch(requestSubscriptionFetch(WS, AGENT));
      await settle();
      expect(store.state.agentSubscriptionUI.entries[makeKey(WS, AGENT)].waitingState).toBe(
        'completed',
      );
      const confirmation = deferred<ReturnType<typeof empty>>();
      backend.onRequest('agent.getSubscriptions', () => confirmation.promise);
      await vi.advanceTimersByTimeAsync(COMPLETED_DISPLAY_DURATION_MS);
      expect(reads('agent.getSubscriptions')).toHaveLength(2);
      store.dispatch(markAgentAsViewed(AGENT));
      store.dispatch(initializeChatRequested(AGENT, { wsId: WS }));
      store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
      expect(store.state.agentSubscriptionUI.entries[makeKey(WS, AGENT)].snapshotStatus).toBe(
        'loading',
      );
      if (outcome === 'empty') confirmation.resolve(empty());
      else confirmation.reject(new Error('confirmation failed'));
      await settle();
      expect(store.state.agentSubscriptionUI.entries[makeKey(WS, AGENT)]).toMatchObject({
        waitingState: 'idle',
        snapshotStatus: outcome === 'empty' ? 'ready' : 'failed',
      });
      expect(reads('agent.getSubscriptions')).toHaveLength(2);
      if (outcome === 'failed') {
        backend.onRequest('agent.getSubscriptions', empty);
        store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
        await settle();
        expect(reads('agent.getSubscriptions')).toHaveLength(3);
        expect(store.state.agentSubscriptionUI.entries[makeKey(WS, AGENT)].snapshotStatus).toBe(
          'ready',
        );
      }
    },
  );

  it.each(['empty', 'failed'] as const)(
    'retains event invalidation when view demand joins an %s confirmation',
    async (outcome) => {
      store.dispatch(
        bulkUpsertSessions([
          {
            id: AGENT,
            workspaceId: WS,
            name: AGENT,
            status: AgentStatus.Pending,
            messages: [],
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          } as AgentSession,
        ]),
      );
      store.dispatch(setSubscriptionSnapshot(WS, AGENT, { ...empty(), waitingState: 'waiting' }));
      store.dispatch(requestSubscriptionFetch(WS, AGENT));
      await settle();
      const confirmation = deferred<ReturnType<typeof empty>>();
      backend.onRequest('agent.getSubscriptions', () => confirmation.promise);
      await vi.advanceTimersByTimeAsync(COMPLETED_DISPLAY_DURATION_MS);
      store.dispatch(markAgentAsViewed(AGENT));
      event('agent:subscriptions-changed', { agentId: AGENT });
      store.dispatch(initializeChatRequested(AGENT, { wsId: WS }));
      store.dispatch(requestSubscriptionFetch(WS, AGENT, true));
      backend.onRequest('agent.getSubscriptions', () => ({
        ...empty(),
        subscriptions: [
          {
            id: 'event-watch',
            agentId: 'child',
            eventTypes: [],
            actorIds: [],
            createdAt: '2026-01-01',
            description: '',
          },
        ],
      }));
      if (outcome === 'empty') confirmation.resolve(empty());
      else confirmation.reject(new Error('confirmation failed'));
      await settle();
      expect(reads('agent.getSubscriptions')).toHaveLength(3);
      expect(store.state.agentSubscriptionUI.entries[makeKey(WS, AGENT)]).toMatchObject({
        subscriptions: [{ id: 'event-watch' }],
        waitingState: 'waiting',
        snapshotStatus: 'ready',
      });
    },
  );

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

  describe('daemon aggregate task progress without list demand', () => {
    const OTHER = 'other-summary-workspace';
    const running = { total: 2, completed: 0, inProgress: 2 };
    const halfDone = { total: 2, completed: 1, inProgress: 1 };
    const done = { total: 2, completed: 2, inProgress: 0 };
    const workspace = (id = WS, taskStats = running): Workspace => ({
      id: id as WorkspaceId,
      title: id,
      branch: 'main',
      status: WorkspaceStatusEnum.Active,
      changesets: [],
      timeline: [],
      conversationInfo: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      taskStats,
    });
    const progress = (id = WS) => selectWorkspaceTaskProgress.select(store.state, id);
    const hudProgress = (id = WS) =>
      selectHudWorkspaceCards.select(store.state).find((card) => card.workspaceId === id)?.tasks;
    const summary = (id = WS) => selectWorkspaceById.select(store.state, id)?.taskStats;
    const taskChange = () =>
      event('task:status-changed', {
        noteId: 'task-note',
        previousStatus: 'in_progress',
        newStatus: 'complete',
      });

    beforeEach(() => {
      store.dispatch(replaceWorkspaceList([workspace(), workspace(OTHER)]));
    });

    it.each(['unloaded', 'previously loaded'] as const)(
      'refreshes canonical counters for a %s hidden list after one of two running tasks completes',
      async (cache) => {
        if (cache === 'previously loaded') {
          backend.onRequest('task.list', () => ({
            tasks: [
              { id: 'task-note', title: 'First', status: 'in_progress' },
              { id: 'second-task', title: 'Second', status: 'in_progress' },
            ],
            stats: running,
          }));
          store.dispatch(acquireWorkspaceTasksDemand(WS, 'old-chat'));
          await settle();
          store.dispatch(releaseWorkspaceTasksDemand(WS, 'old-chat'));
        }
        const initialLists = reads('task.list').length;
        backend.onRequest('workspace.get', () => ({ workspace: workspace(WS, halfDone) }));
        taskChange();
        event('note:updated', { noteId: 'task-note' });
        await vi.advanceTimersByTimeAsync(2000);

        expect(progress()).toEqual(halfDone);
        expect(summary()).toEqual(halfDone);
        expect(hudProgress()).toEqual(halfDone);
        expect(progress(OTHER)).toEqual(running);
        expect(reads('workspace.get').length).toBeGreaterThan(0);
        expect(reads('workspace.get').length).toBeLessThanOrEqual(2);
        for (const request of reads('workspace.get')) {
          expect(request).toEqual({ method: 'workspace.get', params: { workspaceId: WS } });
        }
        expect(reads('task.list')).toHaveLength(initialLists);
        expect(store.state.workspaceTasks.byWorkspaceId[WS]).toMatchObject({
          initialized: cache === 'previously loaded',
          stale: true,
          demandIds: [],
        });
        if (cache === 'previously loaded') {
          expect(selectWorkspaceTasks.select(store.state, WS).map(({ status }) => status)).toEqual([
            'complete',
            'in_progress',
          ]);
        } else {
          expect(selectWorkspaceTasks.select(store.state, WS)).toEqual([]);
        }
      },
    );

    it.each(['summary first', 'task list first'] as const)(
      'keeps canonical progress after an invalidated task read finishes with no demand: %s',
      async (order) => {
        const pendingTasks = deferred<{ tasks: []; stats: typeof running }>();
        const pendingSummary = deferred<{ workspace: Workspace }>();
        backend.onRequest('task.list', () => pendingTasks.promise);
        backend.onRequest('workspace.get', () => pendingSummary.promise);
        store.dispatch(acquireWorkspaceTasksDemand(WS, 'closing-chat'));
        await settle();
        taskChange();
        store.dispatch(releaseWorkspaceTasksDemand(WS, 'closing-chat'));
        await settle();
        expect(reads('task.list')).toEqual([{ method: 'task.list', params: { workspaceId: WS } }]);
        expect(reads('workspace.get')).toEqual([
          { method: 'workspace.get', params: { workspaceId: WS } },
        ]);
        if (order === 'summary first') {
          pendingSummary.resolve({ workspace: workspace(WS, halfDone) });
          await settle();
          expect(progress()).toEqual(halfDone);
          pendingTasks.resolve({ tasks: [], stats: running });
        } else {
          pendingTasks.resolve({ tasks: [], stats: running });
          await settle();
          pendingSummary.resolve({ workspace: workspace(WS, halfDone) });
        }
        await vi.advanceTimersByTimeAsync(2000);
        expect(progress()).toEqual(halfDone);
        expect(hudProgress()).toEqual(halfDone);
        expect(store.state.workspaceTasks.byWorkspaceId[WS]).toMatchObject({
          loading: false,
          stale: true,
          demandIds: [],
        });
        expect(reads('task.list')).toHaveLength(1);
        expect(reads('workspace.get')).toHaveLength(1);
      },
    );

    it.each(['note:created', 'note:updated', 'note:deleted', 'task:created'])(
      'refreshes daemon counters on %s alone without inferring stats from task rows',
      async (type) => {
        backend.onRequest('workspace.get', () => ({ workspace: workspace(WS, halfDone) }));
        event(type, { noteId: 'task-note' });
        await vi.advanceTimersByTimeAsync(2000);
        expect(progress()).toEqual(halfDone);
        expect(summary()).toEqual(halfDone);
        expect(hudProgress()).toEqual(halfDone);
        expect(reads('workspace.get')).toEqual([
          { method: 'workspace.get', params: { workspaceId: WS } },
        ]);
        expect(reads('task.list')).toHaveLength(0);
      },
    );

    it('coalesces task/note bursts through trailing reads and isolates another workspace', async () => {
      const first = deferred<{ workspace: Workspace }>();
      const second = deferred<{ workspace: Workspace }>();
      let calls = 0;
      backend.onRequest('workspace.get', (params) => {
        const { workspaceId } = params as { workspaceId: string };
        if (workspaceId === OTHER) return { workspace: workspace(OTHER, halfDone) };
        calls++;
        return calls === 1
          ? first.promise
          : calls === 2
            ? second.promise
            : { workspace: workspace(WS, done) };
      });
      taskChange();
      await vi.advanceTimersByTimeAsync(2000);
      for (let i = 0; i < 5; i++) {
        taskChange();
        event('note:updated', { noteId: 'task-note' });
      }
      await vi.advanceTimersByTimeAsync(2000);
      expect(reads('workspace.get')).toEqual([
        { method: 'workspace.get', params: { workspaceId: WS } },
      ]);
      event('task:created', { noteId: 'other-task' }, OTHER);
      store.dispatch(openWorkspaceTab(OTHER));
      await vi.advanceTimersByTimeAsync(2000);
      expect(progress(OTHER)).toEqual(halfDone);
      first.resolve({ workspace: workspace() });
      await settle();
      expect(calls).toBe(2);
      for (let i = 0; i < 5; i++) taskChange();
      await vi.advanceTimersByTimeAsync(2000);
      expect(calls).toBe(2);
      second.resolve({ workspace: workspace(WS, halfDone) });
      await settle();
      expect(calls).toBe(3);
      expect(progress()).toEqual(done);
      expect(summary()).toEqual(done);
      expect(hudProgress()).toEqual(done);
      expect(progress(OTHER)).toEqual(halfDone);
      expect(summary(OTHER)).toEqual(halfDone);
      expect(reads('workspace.get')).toEqual([
        { method: 'workspace.get', params: { workspaceId: WS } },
        { method: 'workspace.get', params: { workspaceId: OTHER } },
        { method: 'workspace.get', params: { workspaceId: WS } },
        { method: 'workspace.get', params: { workspaceId: WS } },
      ]);
      expect(reads('task.list')).toHaveLength(0);
    });
  });

  it.each([
    ['ensure', 0],
    ['ensure', 2000],
    ['force', 0],
    ['force', 2000],
  ] as const)(
    'retains task invalidations during first %s load with response delayed %i ms',
    async (trigger, delay) => {
      const pending = deferred<{
        tasks: [];
        stats: { total: number; completed: number; inProgress: number };
      }>();
      let calls = 0;
      backend.onRequest('task.list', () =>
        ++calls === 1
          ? pending.promise
          : { tasks: [], stats: { total: 1, completed: 1, inProgress: 0 } },
      );
      store.dispatch(
        trigger === 'ensure' ? ensureWorkspaceTasksLoaded(WS) : loadWorkspaceTasksRequested(WS),
      );
      store.dispatch(acquireWorkspaceTasksDemand(WS, 'visible-chat'));
      await settle();
      event('task:status-changed', {
        noteId: 'task-note',
        previousStatus: 'in_progress',
        newStatus: 'complete',
      });
      event('note:updated', { noteId: 'task-note' });
      await vi.advanceTimersByTimeAsync(delay);
      pending.resolve({ tasks: [], stats: { total: 1, completed: 0, inProgress: 1 } });
      await vi.advanceTimersByTimeAsync(2000);
      expect(reads('task.list')).toHaveLength(2);
      expect(store.state.workspaceTasks.byWorkspaceId[WS].stats.completed).toBe(1);
    },
  );

  it('invalidates task caches on reconnect but refreshes only currently displayed consumers', async () => {
    store.dispatch(acquireWorkspaceTasksDemand(WS, 'visible-chat'));
    store.dispatch(acquireWorkspaceTasksDemand(WS, 'second-visible-chat'));
    store.dispatch(acquireWorkspaceTasksDemand('hidden-workspace', 'old-chat'));
    await settle();
    store.dispatch(releaseWorkspaceTasksDemand('hidden-workspace', 'old-chat'));
    backend.onRequest('task.list', () => ({
      tasks: [],
      stats: { total: 3, completed: 2, inProgress: 1 },
    }));
    store.dispatch(backendReconnected());
    await settle();
    expect(reads('task.list')).toEqual([
      { method: 'task.list', params: { workspaceId: WS } },
      { method: 'task.list', params: { workspaceId: 'hidden-workspace' } },
      { method: 'task.list', params: { workspaceId: WS } },
    ]);
    expect(store.state.workspaceTasks.byWorkspaceId[WS].stats.completed).toBe(2);
    expect(store.state.workspaceTasks.byWorkspaceId['hidden-workspace'].stale).toBe(true);
    store.dispatch(acquireWorkspaceTasksDemand('hidden-workspace', 'new-chat'));
    await settle();
    expect(reads('task.list')).toHaveLength(4);
    expect(store.state.workspaceTasks.byWorkspaceId['hidden-workspace'].stats.completed).toBe(2);
  });

  it('retries a failed first task read and keeps never-demanded workspaces quiet', async () => {
    event('task:status-changed', { noteId: 'task-note', newStatus: 'complete' });
    event('note:updated', { noteId: 'task-note' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(reads('task.list')).toHaveLength(0);
    backend.onRequest('task.list', () => {
      throw new Error('temporary failure');
    });
    store.dispatch(acquireWorkspaceTasksDemand(WS, 'visible-chat'));
    await settle();
    expect(store.state.workspaceTasks.byWorkspaceId[WS].loading).toBe(false);
    backend.onRequest('task.list', () => ({
      tasks: [],
      stats: { total: 1, completed: 1, inProgress: 0 },
    }));
    store.dispatch(ensureWorkspaceTasksLoaded(WS));
    await settle();
    expect(reads('task.list')).toHaveLength(2);
    expect(store.state.workspaceTasks.byWorkspaceId[WS].stats.completed).toBe(1);
  });

  it('drops pending initial task invalidations on unmount and permits the next demand', async () => {
    const pending = deferred<{
      tasks: [];
      stats: { total: number; completed: number; inProgress: number };
    }>();
    backend.onRequest('task.list', () => pending.promise);
    store.dispatch(acquireWorkspaceTasksDemand(WS, 'visible-chat'));
    await settle();
    event('task:status-changed', { noteId: 'task-note', newStatus: 'complete' });
    store.dispatch(workspaceUnmounted(WS));
    pending.resolve({ tasks: [], stats: { total: 1, completed: 0, inProgress: 1 } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(reads('task.list')).toHaveLength(1);
    expect(store.state.workspaceTasks.byWorkspaceId[WS]?.initialized).not.toBe(true);
    store.dispatch(acquireWorkspaceTasksDemand(WS, 'returned-chat'));
    await settle();
    expect(reads('task.list')).toHaveLength(2);
  });

  it('coalesces paired task status and note events into one authoritative task-list refresh', async () => {
    store.dispatch(acquireWorkspaceTasksDemand(WS, 'visible-chat'));
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
