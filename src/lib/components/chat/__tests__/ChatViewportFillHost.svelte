<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import ChatPanel from '../ChatPanel.svelte';
  import type { AgentMessage, AgentSession, Workspace } from '$shared/types';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    bulkUpsertSessions,
    replaceMessages,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    chatTranscriptSnapshotApplied,
    transcriptHydrationSettled,
  } from '$store/renderer/slices/chat-state/chat-state-slice';
  // eslint-disable-next-line themis/forbidden-component-import -- CT runs the real paging owner against the scripted wire.
  import { chatScrollbackSaga } from '$store/renderer/slices/chat-state/sagas/chat-scrollback-saga';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';

  let {
    height = 900,
    active = true,
    agent = 'primary',
    scenario = 'short',
    compact = false,
    retained = false,
  }: {
    height?: number;
    active?: boolean;
    agent?: string;
    scenario?: 'short' | 'large' | 'filtered' | 'error' | 'stalled' | 'exhausted';
    retained?: boolean;
    compact?: boolean;
  } = $props();
  const fixture = untrack(() => scenario);
  const total = fixture === 'exhausted' ? 8 : 100;
  const initialCount = untrack(() => retained) ? 40 : 5;
  const timestamp = '2026-09-01T00:00:00.000Z';
  const workspace = {
    id: WorkspaceId('viewport-fill'),
    title: 'Viewport fill',
    branch: 'test',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    path: '/tmp/viewport-fill',
    status: WorkspaceStatus.Active,
    createdAt: timestamp,
    updatedAt: timestamp,
  } as Workspace;
  let requests = $state<
    { agentId: string; limit: number; nextToken?: string; placeholders: number }[]
  >([]);
  let inFlight = 0;
  let maxInFlight = $state(0);
  const message = (index: number, large = false): AgentMessage =>
    ({
      id: `m-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      timestamp: new Date(Date.parse(timestamp) + index * 1000).toISOString(),
      contentBlocks: [
        {
          type: 'text',
          text: large
            ? Array.from({ length: 90 }, (_, i) => `Long message line ${i}.`).join('\n\n')
            : `Message ${index}.`,
        },
      ],
    }) as AgentMessage;
  // eslint-disable-next-line intent/no-component-async-data-fetch -- CT serves scripted wire responses; the production saga owns every request.
  installMockElectronBridge({
    'agent.getQueue': () => ({ success: true, queue: [] }),
    'agent.getConversation': async (input) => {
      const params = input as { agentId: string; limit: number; nextToken?: string };
      requests = [
        ...requests,
        {
          ...params,
          placeholders: document.querySelectorAll('[data-lazy-visible="false"]').length,
        },
      ];
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 100));
      inFlight--;
      if (fixture === 'error') throw new Error('Paging fixture failure');
      const end = Number(params.nextToken?.replace('before-', '') ?? total - initialCount);
      const start = Math.max(0, end - params.limit);
      const messages =
        fixture === 'filtered' && end > 80
          ? []
          : Array.from({ length: end - start }, (_, i) => message(start + i));
      return {
        messages,
        totalMessages: total,
        truncated: start > 0,
        nextToken: fixture === 'stalled' ? params.nextToken : start ? `before-${start}` : null,
        prevToken: `after-${end - 1}`,
      };
    },
  });
  const dispose = startRootStoreLifecycle(store, {
    startSagas: () => [store.runSaga(chatScrollbackSaga)],
  });
  admitLegacyPrincipal();
  store.dispatch(setWorkspaceEntity(workspace));
  for (const id of ['primary', 'secondary']) {
    store.dispatch(
      bulkUpsertSessions([
        {
          id,
          workspaceId: workspace.id,
          name: id,
          status: 'idle',
          messages: Array.from({ length: initialCount }, (_, i) =>
            message(total - initialCount + i, fixture === 'large'),
          ),
          createdAt: timestamp,
          updatedAt: timestamp,
        } as AgentSession,
      ]),
    );
    store.dispatch(
      chatTranscriptSnapshotApplied(id, {
        truncated: true,
        totalMessages: total,
        oldestMessageId: `m-${total - initialCount}`,
        nextToken: `before-${total - initialCount}`,
      }),
    );
    store.dispatch(transcriptHydrationSettled(id));
  }
  $effect(() => {
    if (!compact) return;
    untrack(() =>
      store.dispatch(
        replaceMessages(
          'primary',
          Array.from({ length: 5 }, (_, i) => message(95 + i)),
        ),
      ),
    );
  });
  onDestroy(dispose);
</script>

<div style:height="{height}px" style:width="640px" data-testid="fill-host">
  <ChatPanel {workspace} agentId={agent} isActive={active} />
</div>
<output data-testid="requests">{JSON.stringify({ requests, maxInFlight })}</output>
