<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{
    mode: 'foreground' | 'background' | 'pending' | 'delegated';
  }>({
    id: 'agent-background-mode',
    title: 'Agent mode menu',
    defaultState: 'foreground',
    states: {
      foreground: { props: { mode: 'foreground' } },
      background: { props: { mode: 'background' } },
      pending: { props: { mode: 'pending' } },
      delegated: { props: { mode: 'delegated' } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    bulkUpsertSessions,
    removeSession,
    setAgentBackgroundPending,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { AgentStatus, type AgentSession } from '$shared/types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import AgentCard from './AgentCard.svelte';

  let { mode = 'foreground' }: { mode?: 'foreground' | 'background' | 'pending' | 'delegated' } =
    $props();
  const agentId = 'agent-background-mode-preview';
  onMount(() => {
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: AgentId(agentId),
          workspaceId: WorkspaceId('mode-preview'),
          backendSessionId: null,
          name: 'Demo developer',
          status: AgentStatus.Idle,
          messages: [],
          isBackground: mode === 'background' || mode === 'delegated',
          ...(mode === 'delegated'
            ? { parentAgentId: AgentId('preview-parent'), metadata: { taskNoteId: 'preview-task' } }
            : {}),
          createdAt: '2026-09-30T00:00:00Z',
          updatedAt: '2026-09-30T00:00:00Z',
        } as AgentSession,
      ]),
    );
    appStore.dispatch(setAgentBackgroundPending(agentId, mode === 'pending'));
    return () => {
      appStore.dispatch(setAgentBackgroundPending(agentId, false));
      appStore.dispatch(removeSession(agentId));
    };
  });
</script>

<section
  class="w-full max-w-sm rounded-xl border border-border bg-background p-4 text-foreground"
  data-testid="agent-mode-preview"
>
  <h2 class="mb-2 text-sm font-semibold">Agent mode menu</h2>
  <p class="mb-4 text-sm text-muted-foreground">
    Right-click the row or focus it and press Shift+F10. This preview shows menu states; saving is
    tested with a mock daemon.
  </p>
  <AgentCard {agentId} agentName="Demo developer" panelRow hidePreview />
</section>
