<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ unknown?: boolean; failure?: boolean }>({
    id: 'agent-workers',
    title: 'Provider background tasks',
    defaultState: 'running',
    states: {
      running: { props: {} },
      'connection-lost': { props: { unknown: true } },
      'stop-error': { props: { failure: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import {
    agentWorkerOperationUpdated,
    agentWorkersUpdated,
  } from '$store/renderer/slices/agent-workers/agent-workers-slice';
  import {
    workerFixture,
    workerSnapshotFixture,
  } from '$features/agent-workers/agent-workers.fixture';
  import { m } from '$shared/paraglide/messages.js';
  import EventSubscriptionsCard from './EventSubscriptionsCard.svelte';
  import AgentWorkersRow from './AgentWorkersRow.svelte';
  let { unknown = false, failure = false }: { unknown?: boolean; failure?: boolean } = $props();
  const { workspaceId, agentId } = workerSnapshotFixture;
  onMount(() => {
    const status = unknown ? ('unknown' as const) : ('running' as const);
    store.dispatch(
      agentWorkersUpdated(workspaceId, agentId, {
        status: 'ready',
        snapshot: {
          ...workerSnapshotFixture,
          workers: [
            {
              ...workerFixture,
              status,
              ...(unknown ? { unknownReason: 'disconnected' as const } : {}),
            },
            {
              ...workerFixture,
              identity: { ...workerFixture.identity, asyncTaskId: 'bg-2' },
              // i18n-ignore (fixture shell command)
              name: 'pnpm vitest --watch src/lib/components/chat/__tests__/AgentWorkersRow.test.ts',
              status,
            },
          ],
        },
      }),
    );
    if (failure)
      store.dispatch(
        agentWorkerOperationUpdated(workspaceId, agentId, workerFixture.identity.asyncTaskId, {
          pending: false,
          error: true,
          message: m.chat_agentWorkers_stop_error(),
        }),
      );
    return () =>
      store.dispatch(agentWorkersUpdated(workspaceId, agentId, { status: 'unsupported' }));
  });
</script>

<div class="w-full bg-background text-foreground" data-testid="agent-workers-preview">
  <EventSubscriptionsCard
    {workspaceId}
    {agentId}
    isolatedPreview={{ count: 2, initiallyExpanded: true }}
    suppressTopGap
  >
    {#snippet previewContent()}<AgentWorkersRow {workspaceId} {agentId} />{/snippet}
  </EventSubscriptionsCard>
</div>
