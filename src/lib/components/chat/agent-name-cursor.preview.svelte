<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{ cursor: 'pointer' | 'default' }>({
    id: 'agent-name-cursor',
    title: 'Agent name cursor',
    defaultState: 'pointer',
    states: {
      pointer: { props: { cursor: 'pointer' } },
      default: { props: { cursor: 'default' } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    bulkUpsertSessions,
    removeSession,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { AgentStatus, type AgentSession } from '$shared/types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import AgentCard from './AgentCard.svelte';

  let { cursor = 'pointer' }: { cursor?: 'pointer' | 'default' } = $props();
  const agentId = 'agent-name-cursor-preview';
  onMount(() => {
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: AgentId(agentId),
          backendSessionId: null,
          workspaceId: WorkspaceId('agent-name-cursor-preview-workspace'),
          name: 'Demo developer',
          nameExplicitlySet: true,
          status: AgentStatus.Idle,
          messages: [],
          createdAt: '2026-09-16T00:00:00.000Z',
          updatedAt: '2026-09-16T00:00:00.000Z',
        } as AgentSession,
      ]),
    );
    return () => appStore.dispatch(removeSession(agentId));
  });
</script>

<section
  class="w-full max-w-80 rounded-xl border border-border bg-background p-4 text-foreground"
  data-testid="agent-name-preview"
>
  <h2 class="mb-2 text-sm font-semibold">Agents</h2>
  <p class="mb-4 text-sm text-muted-foreground">Focus the row and press Enter to rename.</p>
  <AgentCard
    {agentId}
    agentName="Demo developer"
    panelRow
    hidePreview
    typographyClass={cursor === 'default' ? 'cursor-default!' : ''}
  />
</section>
