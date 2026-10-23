<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    width?: number;
    theme?: 'light' | 'dark';
    multiple?: boolean;
    chief?: boolean;
    typing?: boolean;
    monitors?: boolean;
    initializeStore?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'presence-typing',
    title: 'Chat typing alignment',
    defaultState: 'light',
    captureReadiness: { selector: '[data-presence-typing-indicator]' },
    states: {
      light: { props: {} },
      dark: { props: { theme: 'dark' } },
      narrow: { props: { width: 320 } },
      'narrow-dark': { props: { width: 320, theme: 'dark' } },
      multiple: { props: { width: 320, multiple: true } },
      chief: { props: { width: 320, chief: true } },
      monitors: { props: { monitors: true } },
      'monitors-narrow': { props: { width: 320, monitors: true } },
      'monitors-chief': { props: { width: 320, monitors: true, chief: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import ChatPanelOperationalGeometryHost from '$lib/components/chat/__tests__/ChatPanelOperationalGeometryHost.svelte';
  import { store } from '$store/renderer/store';
  import {
    chatTranscriptSnapshotApplied,
    transcriptHydrationSettled,
  } from '$store/renderer/slices/chat-state/chat-state-slice';
  import { setSubscriptionSnapshot } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
  import {
    presenceContextReceived,
    presenceReset,
    presenceRosterReceived,
    presenceWorkspacesReceived,
  } from '$store/renderer/slices/presence/presence-slice';

  let {
    width = 720,
    theme = 'light',
    multiple = false,
    chief = false,
    typing = true,
    monitors = false,
    initializeStore = false,
  }: Props = $props();

  onMount(async () => {
    const workspaceId = chief ? '__chief__' : 'chat-panel-operational-geometry';
    const agentId = 'chat-panel-operational-agent';
    store.dispatch(presenceContextReceived('typing-preview', 'preview-viewer'));
    store.dispatch(presenceWorkspacesReceived([workspaceId]));
    if (monitors)
      store.dispatch(
        setSubscriptionSnapshot(workspaceId, agentId, {
          subscriptions: [
            {
              id: 'typing-preview-subscription',
              agentId,
              actorIds: ['typing-preview-watched-agent'],
              eventTypes: ['agent:completed'],
              createdAt: '2026-10-22T12:00:00.000Z',
              description: 'Wait for the review agent',
            },
          ],
          delegationGroups: [],
          agentStatuses: {},
          waitingState: 'waiting',
        }),
      );
    await tick();
    if (monitors) {
      store.dispatch(
        chatTranscriptSnapshotApplied(agentId, { truncated: false, totalMessages: 2 }),
      );
      store.dispatch(transcriptHydrationSettled(agentId));
    }
  });
  $effect(() => {
    const workspaceId = chief ? '__chief__' : 'chat-panel-operational-geometry';
    const agentId = 'chat-panel-operational-agent';
    const active = typing;
    const names = multiple ? ['Amelia', 'Sam', 'Morgan'] : ['Amelia'];
    untrack(() => {
      store.dispatch(
        presenceRosterReceived({
          workspaceId,
          members: names.map((name) => ({
            principalId: `preview-${name}`,
            login: name.toLowerCase(),
            displayName: name,
            avatarUrl: null,
            focus: [{ workspaceId, agentId }],
            typing: active
              ? [{ agentId, source: `typing-${name}`, pulse: 1, since: '2026-10-22T12:00:00.000Z' }]
              : [],
          })),
        }),
      );
    });
  });
  onDestroy(() => store.dispatch(presenceReset()));
</script>

<ChatPanelOperationalGeometryHost
  {width}
  {theme}
  height={520}
  chiefWorkspace={chief}
  {initializeStore}
  cardSeamMessages={[
    {
      id: 'typing-preview-reviewer',
      role: 'user',
      timestamp: '2026-10-22T12:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'The chat layout review is ready.' }],
      metadata: {
        type: 'agent_message',
        fromAgentId: 'typing-preview-reviewer',
        fromAgentName: 'Review the chat layout',
      },
    },
    {
      id: 'typing-preview-response',
      role: 'assistant',
      timestamp: '2026-10-22T12:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool_use',
          id: 'typing-preview-view',
          name: 'view',
          input: { path: 'src/lib/components/chat/ChatPanel.svelte' },
        },
        {
          type: 'tool_result',
          id: 'typing-preview-view-result',
          tool_use_id: 'typing-preview-view',
          output: 'The chat panel is ready to inspect.',
        },
        { type: 'text', text: 'The chat layout is ready to review.' },
      ],
    },
  ]}
/>
