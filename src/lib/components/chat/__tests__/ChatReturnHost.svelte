<script module lang="ts">
  /**
   * Drives one agent chat through the app's return paths:
   * - `workspace-quick`: workspace switch and back within the tab TTL (same instance);
   * - `workspace-rebuilt`: workspace switch, tab content expired (remount);
   * - `workspace-dropped`: workspace surface dropped (remount over a re-hydrated tail);
   * - `tab-quick` / `tab-rebuilt`: agent-tab switch inside the workspace (no boundary).
   */
  export type ReturnPath =
    'workspace-quick' | 'workspace-rebuilt' | 'workspace-dropped' | 'tab-quick' | 'tab-rebuilt';
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import ChatPanel from '../ChatPanel.svelte';
  import { clearCachedChatScroll } from '../chat-scroll-cache';
  import type { AgentMessage, AgentSession, Workspace } from '$shared/types';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { startChatFixtureSagas } from '../../../../test/chat-fixture-sagas';
  import { store } from '$store/renderer/store';
  import { setSubscriptionSnapshot } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
  import { backgroundHooksUpdated } from '$store/renderer/slices/background-hooks/background-hooks-slice';
  import { prMonitorsUpdated } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
  import { scriptMonitorsUpdated } from '$store/renderer/slices/script-monitor/script-monitor-slice';
  import {
    addMessage,
    bulkUpsertSessions,
    replaceMessages,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    chatLiveStreamPhaseChanged,
    chatTranscriptSnapshotApplied,
    transcriptHydrationSettled,
  } from '$store/renderer/slices/chat-state/chat-state-slice';
  import { endDividerSession } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
  // eslint-disable-next-line themis/forbidden-component-import -- CT runs the real paging owner against the scripted wire.
  import { chatScrollbackSaga } from '$store/renderer/slices/chat-state/sagas/chat-scrollback-saga';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';

  let {
    lastSeen,
  }: {
    /** Daemon seen marker at first open; defaults to the newest row (no unread). */
    lastSeen?: string;
  } = $props();
  const agentId = 'primary';
  const total = 1000;
  const initialCount = 40;
  const timestamp = '2026-09-01T00:00:00.000Z';
  const workspace = {
    id: WorkspaceId('chat-return'),
    title: 'Chat return',
    branch: 'test',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    path: '/tmp/chat-return',
    status: WorkspaceStatus.Active,
    createdAt: timestamp,
    updatedAt: timestamp,
  } as Workspace;

  // Every busy-state transition the safety net gates on, for test oracles.
  const busyLog: { t: number; event: string; detail?: unknown }[] = [];
  const busyFlags = { older: false, gap: false, seek: false };
  function sampleBusyFlags() {
    const chat = store.state.chatState?.byAgentId[agentId];
    const next = {
      older: chat?.fetchingOlderHistory === true,
      gap: chat?.fetchingGapFill === true,
      seek: chat?.fetchingHistorySeek === true,
    };
    for (const key of ['older', 'gap', 'seek'] as const) {
      if (next[key] !== busyFlags[key]) {
        busyFlags[key] = next[key];
        busyLog.push({ t: performance.now(), event: `${key}:${next[key] ? 'start' : 'end'}` });
      }
    }
  }
  let mounted = $state(true);
  let visible = $state(true);
  let active = $state(true);
  let newest = total - 1;
  let requests = $state(0);

  const message = (index: number, large = false): AgentMessage =>
    ({
      id: `m-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      timestamp: new Date(Date.parse(timestamp) + index * 1000).toISOString(),
      contentBlocks: [
        {
          type: 'text',
          text: large
            ? Array.from({ length: 30 }, (_, i) => `Unread line ${i} of ${index}.`).join('\n\n')
            : `Message ${index}.`,
        },
      ],
    }) as AgentMessage;

  // eslint-disable-next-line intent/no-component-async-data-fetch -- CT serves scripted wire responses; the production saga owns every request.
  installMockElectronBridge({
    'agent.get': (input) =>
      store.state.agentSessions.byAgentId[(input as { agentId: string }).agentId],
    'chat.subscribe': () => ({ subscriptionId: 'chat-return' }),
    'chat.unsubscribe': () => ({}),
    'agent.getQueue': () => ({ success: true, queue: [] }),
    'agent.getConversation': async (input) => {
      const params = input as { limit: number; nextToken?: string; aroundMessageId?: string };
      requests++;
      const id = requests;
      busyLog.push({ t: performance.now(), event: `request-start#${id}`, detail: params });
      await new Promise((resolve) => setTimeout(resolve, 100));
      busyLog.push({ t: performance.now(), event: `request-end#${id}` });
      const end = Number(params.nextToken?.replace('before-', '') ?? total - initialCount);
      const start = Math.max(0, end - params.limit);
      return {
        messages: Array.from({ length: end - start }, (_, i) => message(start + i)),
        totalMessages: newest + 1,
        truncated: start > 0,
        nextToken: start ? `before-${start}` : null,
        prevToken: `after-${end - 1}`,
      };
    },
  });

  const dispose = startRootStoreLifecycle(store, {
    startSagas: () => [...startChatFixtureSagas(store), store.runSaga(chatScrollbackSaga)],
  });
  admitLegacyPrincipal();
  store.dispatch(setWorkspaceEntity(workspace));
  store.dispatch(backgroundHooksUpdated(workspace.id, []));
  store.dispatch(prMonitorsUpdated(workspace.id, []));
  store.dispatch(
    scriptMonitorsUpdated(workspace.id, { monitors: [], scripts: [], status: 'ready' }),
  );
  store.dispatch(
    setSubscriptionSnapshot(workspace.id, agentId, {
      subscriptions: [],
      eventSubscriptions: [],
      delegationGroups: [],
      agentStatuses: {},
      waitingState: 'idle',
    }),
  );
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        workspaceId: workspace.id,
        name: agentId,
        status: 'idle',
        messages: Array.from({ length: initialCount }, (_, i) => message(total - initialCount + i)),
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: { lastSeenMessageId: untrack(() => lastSeen) ?? `m-${total - 1}` },
      } as AgentSession,
    ]),
  );
  applySnapshot();
  store.dispatch(transcriptHydrationSettled(agentId));

  function applySnapshot() {
    const loaded = store.state.agentSessions.byAgentId[agentId]?.messages.length ?? initialCount;
    const oldest = newest + 1 - loaded;
    store.dispatch(
      chatTranscriptSnapshotApplied(agentId, {
        initialHistory: { target: loaded, received: loaded, complete: true },
        truncated: true,
        totalMessages: newest + 1,
        oldestMessageId: `m-${oldest}`,
        nextToken: `before-${oldest}`,
      }),
    );
  }

  let leftPath: ReturnPath | null = null;

  /** Leave the chat: hide its wrapper, release the subscription, run the boundary. */
  function leave(path: ReturnPath, unread = 0) {
    leftPath = path;
    active = false;
    visible = false;
    if (path.startsWith('workspace-')) {
      // Workspace stop-looking boundary (unread-tracking saga finishBoundary).
      clearCachedChatScroll([agentId]);
      store.dispatch(endDividerSession(agentId));
    }
    store.dispatch(chatLiveStreamPhaseChanged(agentId, null));
    for (let i = 0; i < unread; i++) {
      newest++;
      store.dispatch(addMessage(agentId, message(newest, true)));
    }
    if (path === 'workspace-rebuilt' || path === 'workspace-dropped' || path === 'tab-rebuilt') {
      mounted = false;
    }
  }

  /** Return: reveal the panel; the panel's activation arms the switch-back skeleton. */
  function reactivate() {
    if (leftPath === 'workspace-dropped') {
      // A dropped surface re-hydrates the newest window only.
      const tail = store.state.agentSessions.byAgentId[agentId]!.messages.slice(-initialCount);
      store.dispatch(replaceMessages(agentId, tail));
    }
    mounted = true;
    visible = true;
    active = true;
  }

  /** The fresh subscription's seq-0 snapshot lands and clears the skeleton. */
  function deliverSnapshot() {
    store.dispatch(chatLiveStreamPhaseChanged(agentId, 'live'));
    applySnapshot();
    store.dispatch(transcriptHydrationSettled(agentId));
  }

  (window as unknown as { chatReturn: unknown }).chatReturn = {
    leave,
    reactivate,
    deliverSnapshot,
    awaitingSkeleton: () =>
      store.state.chatState.byAgentId[agentId]?.awaitingSwitchBackSnapshot === true,
    requests: () => requests,
    busyLog: () => busyLog,
    busyNow: () => busyFlags.older || busyFlags.gap || busyFlags.seek,
  };
  let sampling = true;
  const sample = () => {
    if (!sampling) return;
    sampleBusyFlags();
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);

  onDestroy(() => {
    sampling = false;
    dispose();
  });
</script>

<div style:height="900px" style:width="640px" style:display={visible ? 'block' : 'none'}>
  {#if mounted}
    <ChatPanel {workspace} {agentId} isActive={active} />
  {/if}
</div>
