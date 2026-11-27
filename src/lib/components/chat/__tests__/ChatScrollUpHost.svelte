<script lang="ts">
  import { onDestroy } from 'svelte';
  import ChatPanel from '../ChatPanel.svelte';
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
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    chatTranscriptSnapshotApplied,
    transcriptHydrationSettled,
  } from '$store/renderer/slices/chat-state/chat-state-slice';
  // eslint-disable-next-line themis/forbidden-component-import -- CT runs the real paging owner against the scripted wire.
  import { chatScrollbackSaga } from '$store/renderer/slices/chat-state/sagas/chat-scrollback-saga';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';

  let { total = 400, initialCount = 40 }: { total?: number; initialCount?: number } = $props();
  const agentId = 'primary';
  const timestamp = '2026-09-01T00:00:00.000Z';
  const workspace = {
    id: WorkspaceId('chat-scroll-up'),
    title: 'Chat scroll up',
    branch: 'test',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    path: '/tmp/chat-scroll-up',
    status: WorkspaceStatus.Active,
    createdAt: timestamp,
    updatedAt: timestamp,
  } as Workspace;

  // Rows of very different heights, like a real transcript: short prompts and
  // replies from one line to many paragraphs.
  function text(index: number): string {
    if (index % 2 === 0) return `Prompt ${index}.`;
    const paragraphs = 1 + ((index * 7) % 13);
    return Array.from(
      { length: paragraphs },
      (_, i) =>
        `Reply ${index} paragraph ${i}. The agent explains what it changed and why, with enough words to wrap across lines.`,
    ).join('\n\n');
  }

  const message = (index: number): AgentMessage =>
    ({
      id: `m-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      timestamp: new Date(Date.parse(timestamp) + index * 1000).toISOString(),
      contentBlocks: [{ type: 'text', text: text(index) }],
    }) as AgentMessage;

  installMockElectronBridge({
    'agent.get': (input) =>
      store.state.agentSessions.byAgentId[(input as { agentId: string }).agentId],
    'chat.subscribe': () => ({ subscriptionId: 'chat-scroll-up' }),
    'chat.unsubscribe': () => ({}),
    'agent.getConversation': async (input) => {
      const params = input as { limit: number; nextToken?: string };
      await new Promise((resolve) => setTimeout(resolve, 50));
      const end = Number(params.nextToken?.replace('before-', '') ?? total - initialCount);
      const start = Math.max(0, end - params.limit);
      return {
        messages: Array.from({ length: end - start }, (_, i) => message(start + i)),
        totalMessages: total,
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
  // svelte-ignore state_referenced_locally -- fixture size is fixed at mount.
  const loaded = initialCount;
  // svelte-ignore state_referenced_locally -- fixture size is fixed at mount.
  const totalMessages = total;
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        workspaceId: workspace.id,
        name: agentId,
        status: 'idle',
        messages: Array.from({ length: loaded }, (_, i) => message(totalMessages - loaded + i)),
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: { lastSeenMessageId: `m-${totalMessages - 1}` },
      } as AgentSession,
    ]),
  );
  store.dispatch(
    chatTranscriptSnapshotApplied(agentId, {
      initialHistory: { target: loaded, received: loaded, complete: true },
      truncated: true,
      totalMessages,
      oldestMessageId: `m-${totalMessages - loaded}`,
      nextToken: `before-${totalMessages - loaded}`,
    }),
  );
  store.dispatch(transcriptHydrationSettled(agentId));

  onDestroy(dispose);
</script>

<div style:height="900px" style:width="720px">
  <ChatPanel {workspace} {agentId} isActive={true} />
</div>
