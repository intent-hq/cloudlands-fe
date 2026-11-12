<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import ChatPanel from '../ChatPanel.svelte';
  import { Toast } from '$lib/components/ui/toast';
  import type {
    AgentMessage,
    AgentSession,
    ContentBlock,
    PendingProposalRef,
    Workspace,
  } from '$shared/types';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import type { Proposal } from '$shared/types/proposal';
  import { createProposalResource } from '$shared/types/proposal-resource';
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
  // eslint-disable-next-line themis/forbidden-component-import -- CT runs the real recovery and paging owner against the scripted wire.
  import { chatScrollbackSaga } from '$store/renderer/slices/chat-state/sagas/chat-scrollback-saga';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';

  // A long conversation whose only loaded rows are the live tail. The pending
  // proposal's carrying message (m-41) sits far outside that window, so the
  // pill can only reach it through an `aroundMessageId` seek.
  let {
    scenario = 'seekable',
  }: {
    /**
     * `seekable`: every `aroundMessageId` page contains the carrying message.
     * `vanished`: the first lookup (pending-proposal recovery) finds it, then
     * the message is gone, so the pill's seek cannot load it.
     */
    scenario?: 'seekable' | 'vanished';
  } = $props();
  const fixture = untrack(() => scenario);
  const total = 200;
  const initialCount = 5;
  const carryingIndex = 41;
  const timestamp = '2026-09-01T00:00:00.000Z';
  const workspace = {
    id: WorkspaceId('pending-proposal-seek'),
    title: 'Pending proposal seek',
    branch: 'test',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    path: '/tmp/pending-proposal-seek',
    status: WorkspaceStatus.Active,
    createdAt: timestamp,
    updatedAt: timestamp,
  } as Workspace;
  const agentId = 'primary';

  const workspaceCreate = (title: string, applyToolCallId?: string): Proposal => ({
    kind: 'workspace-create',
    ...(applyToolCallId ? { applyToolCallId } : {}),
    payload: { operation: 'workspace.create', params: { title, initialPrompt: `Do ${title}.` } },
    preview: {
      title,
      workspaceCreate: { mode: 'sibling', title, initialPrompt: `Do ${title}.` },
    },
  });
  const proposalBlock = (proposal: Proposal): ContentBlock =>
    ({ type: 'resource', resource: createProposalResource(proposal) }) as unknown as ContentBlock;

  // The carrying message holds two pending cards: an id-bearing one first,
  // then the id-less (title-keyed) one the pill targets.
  const pendingProposals: PendingProposalRef[] = [
    { proposalId: 'Title keyed follow-up', messageId: `m-${carryingIndex}` },
    { proposalId: 'id-keyed-proposal', messageId: `m-${carryingIndex}` },
  ];

  const message = (index: number): AgentMessage =>
    ({
      id: `m-${index}`,
      seq: index,
      role: index % 2 ? 'assistant' : 'user',
      timestamp: new Date(Date.parse(timestamp) + index * 1000).toISOString(),
      contentBlocks:
        index === carryingIndex
          ? [
              { type: 'text', text: 'Here are two follow-ups.' },
              proposalBlock(workspaceCreate('Id keyed follow-up', 'id-keyed-proposal')),
              proposalBlock(workspaceCreate('Title keyed follow-up')),
            ]
          : [
              {
                type: 'text',
                text: Array.from({ length: 12 }, (_, i) => `Message ${index} line ${i}.`).join(
                  '\n\n',
                ),
              },
            ],
    }) as AgentMessage;

  let aroundLookups = 0;
  // eslint-disable-next-line intent/no-component-async-data-fetch -- CT serves scripted wire responses; the production saga and seek helper own every request.
  installMockElectronBridge({
    'agent.get': (input) =>
      store.state.agentSessions.byAgentId[(input as { agentId: string }).agentId],
    'chat.subscribe': () => ({ subscriptionId: 'pending-proposal-seek' }),
    'chat.unsubscribe': () => ({}),
    'agent.getQueue': () => ({ success: true, queue: [] }),
    'agent.getConversation': async (input) => {
      const params = input as { limit: number; nextToken?: string; aroundMessageId?: string };
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (params.aroundMessageId) {
        aroundLookups++;
        if (fixture === 'vanished' && aroundLookups > 1) {
          throw Object.assign(new Error('Message not found'), { code: -32602 });
        }
      }
      const start = params.nextToken?.startsWith('before-')
        ? Math.max(0, Number(params.nextToken.slice(7)) - params.limit)
        : params.nextToken?.startsWith('after-')
          ? Number(params.nextToken.slice(6)) + 1
          : Math.max(
              0,
              Number(params.aroundMessageId?.replace('m-', '') ?? total) -
                Math.floor((params.limit - 1) / 2),
            );
      const end = Math.min(total, start + params.limit);
      return {
        messages: Array.from({ length: end - start }, (_, i) => message(start + i)),
        totalMessages: total,
        truncated: start > 0,
        nextToken: start ? `before-${start}` : null,
        prevToken: end < total ? `after-${end - 1}` : null,
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
        metadata: { pendingProposals },
        createdAt: timestamp,
        updatedAt: timestamp,
      } as AgentSession,
    ]),
  );
  store.dispatch(
    chatTranscriptSnapshotApplied(agentId, {
      truncated: true,
      totalMessages: total,
      oldestMessageId: `m-${total - initialCount}`,
      nextToken: `before-${total - initialCount}`,
    }),
  );
  store.dispatch(transcriptHydrationSettled(agentId));
  onDestroy(dispose);
</script>

<div style:height="900px" style:width="640px" data-testid="pending-proposal-seek-host">
  <ChatPanel {workspace} {agentId} isActive />
</div>
<Toast />
