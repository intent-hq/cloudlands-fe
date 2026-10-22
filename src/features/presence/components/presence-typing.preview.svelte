<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    width?: number;
    theme?: 'light' | 'dark';
    multiple?: boolean;
    chief?: boolean;
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
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import ChatPanelOperationalGeometryHost from '$lib/components/chat/__tests__/ChatPanelOperationalGeometryHost.svelte';
  import { store } from '$store/renderer/store';
  import {
    presenceContextReceived,
    presenceReset,
    presenceRosterReceived,
    presenceWorkspacesReceived,
  } from '$store/renderer/slices/presence/presence-slice';

  let { width = 720, theme = 'light', multiple = false, chief = false }: Props = $props();

  onMount(() => {
    const workspaceId = chief ? '__chief__' : 'chat-panel-operational-geometry';
    const agentId = 'chat-panel-operational-agent';
    store.dispatch(presenceContextReceived('typing-preview', 'preview-viewer'));
    store.dispatch(presenceWorkspacesReceived([workspaceId]));
    store.dispatch(
      presenceRosterReceived({
        workspaceId,
        members: (multiple ? ['Amelia', 'Sam', 'Morgan'] : ['Amelia']).map((name) => ({
          principalId: `preview-${name}`,
          login: name.toLowerCase(),
          displayName: name,
          avatarUrl: null,
          focus: [{ workspaceId, agentId }],
          typing: [
            { agentId, source: `typing-${name}`, pulse: 1, since: '2026-10-22T12:00:00.000Z' },
          ],
        })),
      }),
    );
    return () => store.dispatch(presenceReset());
  });
</script>

<ChatPanelOperationalGeometryHost
  {width}
  {theme}
  height={520}
  chiefWorkspace={chief}
  initializeStore={false}
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
