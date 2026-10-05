/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
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
import AgentSubscriptions from '../AgentSubscriptions.svelte';
import { setWaitingAgentsExpanded } from '../agent-subscriptions-view-state';
import { store } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  COMPLETED_DISPLAY_DURATION_MS,
  agentSubscriptionReadSaga,
} from '$store/renderer/slices/agent-subscription-ui/sagas/agent-subscription-read-saga';
import { agentReadSaga } from '$store/renderer/slices/workspace-agents/sagas/agent-read-saga';
import {
  makeKey,
  requestSubscriptionFetch,
  refreshWorkspaceSubscriptionEntriesRequested,
} from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';

import {
  bulkUpsertSessions,
  markAgentDetailHydrated,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectSubscriptionSnapshotStatus } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-selectors';
import {
  backendReconnected,
  workspaceUnmounted,
} from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearPendingAgentDeletions,
  setPendingAgentDeletion,
} from '$features/agent/utils/pending-agent-deletions';
import type { AgentSession } from '$shared/types';

import { daemonEventsSubscribed } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import {
  routeDaemonEventsNotification,
  __resetDaemonEventsBridgeForTests,
} from '$features/events/daemon-events-bridge.client';

const WS = 'bundled-workspace';
const PARENT = 'bundled-parent';
const CHILDREN = ['bundled-a', 'bundled-b', 'bundled-c'];
const row = (id: string, workspaceId = WS) => ({
  id,
  workspaceId,
  name: `Participant ${id}`,
  status: 'running',
  acpSessionId: `acp-${id}`,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
  messageCount: 2,
  lastAgentResponse: `Progress from ${id}`,
});
function snapshot(bundled = true) {
  return {
    subscriptions: [
      {
        id: 'watch',
        agentId: PARENT,
        actorIds: [CHILDREN[0]],
        eventTypes: ['agent:idle'],
        createdAt: '2026-10-01T00:00:00Z',
      },
    ],
    delegationGroups: [
      {
        groupId: 'group',
        parentAgentId: PARENT,
        awaitMode: 'all',
        expectedAgentIds: CHILDREN,
        completedAgentIds: [],
        deletedAgentIds: [],
        delivered: false,
      },
    ],
    agentStatuses: Object.fromEntries(CHILDREN.map((id) => [id, 'running'])),
    ...(bundled ? { agents: CHILDREN.map((id) => row(id)) } : {}),
  };
}

describe('bundled subscription rows through real expanded AgentCards', () => {
  let backend: MockBackendHandle;
  let dispose: () => void;
  let cancel: Array<() => void>;
  const reads = (method: string) => backend.requests.filter((r) => r.method === method);
  beforeEach(() => {
    __resetDaemonEventsBridgeForTests();
    setWaitingAgentsExpanded(WS, PARENT, false);
    clearPendingAgentDeletions();
    resetMockBackend();
    backend = installMockBackend();
    backend.onRequest('agent.getSubscriptions', () => snapshot());
    backend.onRequest('agent.get', (params) => ({
      agent: row((params as { agentId: string }).agentId),
    }));
    dispose = store.init();
    cancel = [store.runSaga(agentSubscriptionReadSaga), store.runSaga(agentReadSaga)];
    store.dispatch(setWorkspaceEntity({ id: WS, name: 'Workspace', path: '/workspace' } as never));
  });
  afterEach(() => {
    cleanup();
    cancel.reverse().forEach((stop) => stop());
    dispose();
    __resetDaemonEventsBridgeForTests();
    clearPendingAgentDeletions();
    resetMockBackend();
    vi.useRealTimers();
  });
  async function expand(initiallyExpanded = false) {
    setWaitingAgentsExpanded(WS, PARENT, initiallyExpanded);
    render(AgentSubscriptions, {
      props: { workspaceId: WS, agentId: PARENT, forceWaitingHeader: true },
    });
    if (!initiallyExpanded)
      await fireEvent.click(await screen.findByTestId('one-shot-summary-toggle'));
    await waitFor(() => expect(screen.getAllByTestId('agent-card-name')).toHaveLength(3));
    await tick();
  }

  it.each([false, true])(
    'seeds uncached participants without per-card agent.get (initially expanded: %s)',
    async (initiallyExpanded) => {
      expect(store.state.agentSessions.byAgentId).toEqual({});
      await expand(initiallyExpanded);
      expect(reads('agent.getSubscriptions')).toEqual([
        { method: 'agent.getSubscriptions', params: { workspaceId: WS, agentId: PARENT } },
      ]);
      expect(reads('agent.get')).toEqual([]);
      expect(screen.getAllByTestId('agent-card-name').map((node) => node.textContent)).toEqual(
        CHILDREN.map((id) => `Participant ${id}`),
      );
      for (const id of CHILDREN) {
        expect(store.state.agentSessions.byAgentId[id].backendSessionId).toBe(`acp-${id}`);
        expect(store.state.agentSessions.detailHydrated?.[id]).toBeUndefined();
      }
    },
  );

  it('retains the missing-session fallback for an older daemon omitting agents', async () => {
    backend.onRequest('agent.getSubscriptions', () => snapshot(false));
    await expand();
    await waitFor(() => expect(reads('agent.get')).toHaveLength(3));
    expect(reads('agent.get').map((r) => r.params)).toEqual(
      CHILDREN.map((agentId) => ({ workspaceId: WS, agentId })),
    );
  });

  it('fetches only an omitted participant from a partial bundle while preserving membership', async () => {
    backend.onRequest('agent.getSubscriptions', () => ({
      ...snapshot(),
      agents: CHILDREN.slice(0, 2).map((id) => row(id)),
    }));
    await expand();
    await waitFor(() =>
      expect(reads('agent.get')).toEqual([
        { method: 'agent.get', params: { workspaceId: WS, agentId: CHILDREN[2] } },
      ]),
    );
    expect(store.state.agentSubscriptionUI.entries[makeKey(WS, PARENT)]).toMatchObject({
      snapshotStatus: 'ready',
      subscriptions: [{ actorIds: [CHILDREN[0]] }],
      delegationGroups: [{ expectedAgentIds: CHILDREN }],
    });
    expect(reads('agent.getSubscriptions')).toHaveLength(1);
    expect(Object.keys(store.state.agentSessions.byAgentId)).toEqual(CHILDREN);
    expect(store.state.agentSessions.detailHydrated?.[CHILDREN[0]]).toBeUndefined();
    expect(store.state.agentSessions.detailHydrated?.[CHILDREN[1]]).toBeUndefined();
  });

  it('preserves the true workspace of a cross-workspace participant without fetching it', async () => {
    backend.onRequest('agent.getSubscriptions', () => ({
      ...snapshot(),
      agents: CHILDREN.map((id) => row(id, 'watched-workspace')),
    }));
    await expand();
    expect(reads('agent.get')).toEqual([]);
    for (const id of CHILDREN)
      expect(store.state.agentSessions.byAgentId[id].workspaceId).toBe('watched-workspace');
  });

  it('preserves cached transcript and detail metadata while updating slim row fields', async () => {
    const detail = {
      ...row(CHILDREN[0]),
      messages: [
        {
          id: 'message',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'Keep transcript' }],
          timestamp: '2026-10-01T00:00:00Z',
        },
      ],
      harnessFeatures: { peerAgents: true },
      effortLevels: ['low', 'high'],
      metadata: {
        pendingProposals: [{ proposalId: 'p1', messageId: 'message' }],
        proposalResolutions: { p0: 'applied' },
      },
    } as unknown as AgentSession;
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    backend.onRequest(
      'agent.getSubscriptions',
      () =>
        new Promise<ReturnType<typeof snapshot>>((done) => {
          resolve = done;
        }),
    );
    store.dispatch(requestSubscriptionFetch(WS, PARENT));
    // Detail/transcript hydration wins a race with the slower subscription read.
    store.dispatch(bulkUpsertSessions([detail]));
    store.dispatch(markAgentDetailHydrated(CHILDREN[0]));
    const messages = store.state.agentSessions.byAgentId[CHILDREN[0]].messages;
    resolve({
      ...snapshot(),
      agents: CHILDREN.map((id) => ({
        ...row(id),
        name: 'Updated name',
        isBackground: false,
        metadata: { isBackground: true },
      })),
    });
    await waitFor(() =>
      expect(selectSubscriptionSnapshotStatus.select(store.state, WS, PARENT)).toBe('ready'),
    );
    const session = store.state.agentSessions.byAgentId[CHILDREN[0]];
    expect(session.name).toBe(detail.name);
    expect(session.messages).toEqual(messages);
    expect(session.harnessFeatures).toEqual(detail.harnessFeatures);
    expect(session.effortLevels).toEqual(detail.effortLevels);
    expect(session.metadata).toMatchObject(detail.metadata!);
    backend.onRequest('agent.getSubscriptions', () => ({
      ...snapshot(),
      agents: CHILDREN.map((id) => ({
        ...row(id),
        name: 'Fresh row',
        isBackground: false,
        metadata: { isBackground: true },
      })),
    }));
    await fetchSnapshot();
    expect(store.state.agentSessions.byAgentId[CHILDREN[0]]).toMatchObject({
      name: 'Fresh row',
      metadata: { ...detail.metadata, isBackground: false },
    });
    expect(store.state.agentSessions.detailHydrated?.[CHILDREN[0]]).toBe(true);
    expect(store.state.agentSessions.detailHydrated?.[CHILDREN[1]]).toBeUndefined();
  });

  it('does not resurrect locally or remotely pending deletions from a response', async () => {
    setPendingAgentDeletion({ wsId: WS, agentId: CHILDREN[0] });
    backend.onRequest('agent.getSubscriptions', () => ({
      ...snapshot(),
      agents: [
        row(CHILDREN[0]),
        { ...row(CHILDREN[1]), pendingDeleteAt: '2026-10-02T00:01:00Z' },
        row(CHILDREN[2]),
      ],
    }));
    await fetchSnapshot();
    expect(Object.keys(store.state.agentSessions.byAgentId)).toEqual([CHILDREN[2]]);
  });

  it('drops bundled rows when workspace cleanup cancels the pending snapshot', async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    backend.onRequest(
      'agent.getSubscriptions',
      () =>
        new Promise<ReturnType<typeof snapshot>>((done) => {
          resolve = done;
        }),
    );
    store.dispatch(requestSubscriptionFetch(WS, PARENT));
    store.dispatch(workspaceUnmounted(WS));
    resolve(snapshot());
    await new Promise((done) => setTimeout(done, 0));
    expect(store.state.agentSessions.byAgentId).toEqual({});
    expect(store.state.agentSubscriptionUI.entries[makeKey(WS, PARENT)]).toBeUndefined();
  });

  it('refreshes bundled rows after an invalidation racing the initial read', async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    backend.onRequest(
      'agent.getSubscriptions',
      () =>
        new Promise<ReturnType<typeof snapshot>>((done) => {
          resolve = done;
        }),
    );
    store.dispatch(requestSubscriptionFetch(WS, PARENT));
    store.dispatch(requestSubscriptionFetch(WS, PARENT, true));
    store.dispatch(refreshWorkspaceSubscriptionEntriesRequested(WS, PARENT));
    expect(reads('agent.getSubscriptions')).toHaveLength(1);
    backend.onRequest('agent.getSubscriptions', () => ({
      ...snapshot(),
      agents: CHILDREN.map((id) => ({ ...row(id), name: 'Refreshed participant' })),
    }));
    resolve(snapshot());
    await waitFor(() =>
      expect(store.state.agentSessions.byAgentId[CHILDREN[0]]?.name).toBe('Refreshed participant'),
    );
    expect(reads('agent.getSubscriptions')).toHaveLength(2);
  });

  it('ingests rows returned by the completed-state confirmation read', async () => {
    vi.useFakeTimers();
    backend.onRequest('agent.getSubscriptions', () => snapshot(false));
    store.dispatch(requestSubscriptionFetch(WS, PARENT));
    await vi.advanceTimersByTimeAsync(0);
    backend.onRequest('agent.getSubscriptions', () => ({
      subscriptions: [],
      delegationGroups: [],
      agentStatuses: {},
      agents: [],
    }));
    store.dispatch(requestSubscriptionFetch(WS, PARENT));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.agentSubscriptionUI.entries[makeKey(WS, PARENT)].waitingState).toBe(
      'completed',
    );
    backend.onRequest('agent.getSubscriptions', () => snapshot());
    await vi.advanceTimersByTimeAsync(COMPLETED_DISPLAY_DURATION_MS);
    expect(Object.keys(store.state.agentSessions.byAgentId)).toEqual(CHILDREN);
    expect(store.state.agentSubscriptionUI.entries[makeKey(WS, PARENT)]).toMatchObject({
      waitingState: 'waiting',
      snapshotStatus: 'ready',
    });
    expect(reads('agent.getSubscriptions')).toHaveLength(3);
  });

  it.each(['snapshot', 'confirmation'] as const)(
    'keeps newer participant updates over a delayed %s reply',
    async (mode) => {
      vi.useFakeTimers();
      await primeConfirmation(mode);
      const initial = { ...row(CHILDREN[0]), messages: [] } as unknown as AgentSession;
      store.dispatch(bulkUpsertSessions([initial]));
      let resolve!: (value: ReturnType<typeof snapshot>) => void;
      backend.onRequest(
        'agent.getSubscriptions',
        () =>
          new Promise<ReturnType<typeof snapshot>>((done) => {
            resolve = done;
          }),
      );
      if (mode === 'snapshot') store.dispatch(requestSubscriptionFetch(WS, PARENT));
      else await vi.advanceTimersByTimeAsync(COMPLETED_DISPLAY_DURATION_MS);
      store.dispatch(
        updateSession(CHILDREN[0], {
          name: 'Newer rename',
          status: 'completed' as AgentSession['status'],
          lastAgentResponse: 'Newer preview',
          metadata: { model: 'newer-model' },
        }),
      );
      resolve(snapshot());
      await vi.advanceTimersByTimeAsync(0);
      expect(store.state.agentSessions.byAgentId[CHILDREN[0]]).toMatchObject({
        name: 'Newer rename',
        status: 'completed',
        lastAgentResponse: 'Newer preview',
        metadata: { model: 'newer-model' },
      });
      expect(store.state.agentSessions.byAgentId[CHILDREN[1]].name).toBe(
        `Participant ${CHILDREN[1]}`,
      );
      backend.onRequest('agent.getSubscriptions', () => ({
        ...snapshot(),
        agents: CHILDREN.map((id) => ({ ...row(id), name: 'Fresh read' })),
      }));
      store.dispatch(requestSubscriptionFetch(WS, PARENT));
      await vi.advanceTimersByTimeAsync(0);
      expect(store.state.agentSessions.byAgentId[CHILDREN[0]].name).toBe('Fresh read');
    },
  );

  async function primeConfirmation(mode: 'snapshot' | 'confirmation') {
    if (mode !== 'confirmation') return;
    backend.onRequest('agent.getSubscriptions', () => snapshot(false));
    store.dispatch(requestSubscriptionFetch(WS, PARENT));
    await vi.advanceTimersByTimeAsync(0);
    backend.onRequest('agent.getSubscriptions', () => ({
      subscriptions: [],
      delegationGroups: [],
      agentStatuses: {},
      agents: [],
    }));
    store.dispatch(requestSubscriptionFetch(WS, PARENT));
    await vi.advanceTimersByTimeAsync(0);
  }

  it.each(['agent:deleted', 'agent:delete-scheduled'])(
    'does not resurrect an uncached participant after %s arrives during the read',
    async (type) => {
      let resolve!: (value: ReturnType<typeof snapshot>) => void;
      backend.onRequest(
        'agent.getSubscriptions',
        () =>
          new Promise<ReturnType<typeof snapshot>>((done) => {
            resolve = done;
          }),
      );
      store.dispatch(requestSubscriptionFetch(WS, PARENT));
      routeDaemonEventsNotification('events.event', {
        event: {
          id: 'delete-during-subscriptions',
          type,
          workspaceId: WS,
          data: {
            agentId: CHILDREN[0],
            workspaceId: WS,
            deleteAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      });
      backend.onRequest('agent.getSubscriptions', () => snapshot());
      resolve(snapshot());
      await waitFor(() =>
        expect(selectSubscriptionSnapshotStatus.select(store.state, WS, PARENT)).toBe('ready'),
      );
      expect(store.state.agentSessions.byAgentId[CHILDREN[0]]).toBeUndefined();
      expect(store.state.agentSessions.byAgentId[CHILDREN[1]]).toBeDefined();
    },
  );

  it('discards pre-reconnect bundled rows and refreshes after the event lease is restored', async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    backend.onRequest(
      'agent.getSubscriptions',
      () =>
        new Promise<ReturnType<typeof snapshot>>((done) => {
          resolve = done;
        }),
    );
    store.dispatch(requestSubscriptionFetch(WS, PARENT));
    store.dispatch(backendReconnected());
    resolve(snapshot());
    await new Promise((done) => setTimeout(done, 0));
    expect(store.state.agentSessions.byAgentId).toEqual({});
    backend.onRequest('agent.getSubscriptions', () => snapshot());
    store.dispatch(daemonEventsSubscribed());
    await waitFor(() => expect(Object.keys(store.state.agentSessions.byAgentId)).toEqual(CHILDREN));
    expect(reads('agent.getSubscriptions')).toHaveLength(2);
  });

  async function fetchSnapshot() {
    store.dispatch(requestSubscriptionFetch(WS, PARENT));
    await waitFor(() =>
      expect(selectSubscriptionSnapshotStatus.select(store.state, WS, PARENT)).toBe('ready'),
    );
  }

  it('has rows available as soon as the subscription snapshot becomes ready', async () => {
    const readyRows: string[][] = [];
    const unsubscribe = selectSubscriptionSnapshotStatus
      .withStore(store)(WS, PARENT)
      .subscribe((status) => {
        if (status === 'ready') readyRows.push(Object.keys(store.state.agentSessions.byAgentId));
      });
    try {
      await fetchSnapshot();
      await waitFor(() => expect(readyRows).toEqual([CHILDREN]));
    } finally {
      unsubscribe();
    }
  });
});
