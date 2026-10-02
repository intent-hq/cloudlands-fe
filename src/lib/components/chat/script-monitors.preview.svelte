<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ failure?: boolean }>({
    id: 'script-monitors',
    title: 'Script monitors',
    defaultState: 'conditions',
    states: { conditions: { props: {} }, 'cancel-error': { props: { failure: true } } },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import {
    scriptMonitorsUpdated,
    scriptMonitorOperationUpdated,
  } from '$store/renderer/slices/script-monitor/script-monitor-slice';
  import { monitorFixture, scriptFixture } from '$features/script-monitor/script-monitor.fixture';
  import { m } from '$shared/paraglide/messages.js';
  import EventSubscriptionsCard from './EventSubscriptionsCard.svelte';
  import MonitoredScriptsRow from './MonitoredScriptsRow.svelte';
  let { failure = false }: { failure?: boolean } = $props();
  onMount(() => {
    store.dispatch(
      scriptMonitorsUpdated(monitorFixture.workspaceId, {
        monitors: [
          monitorFixture,
          {
            ...monitorFixture,
            monitorId: 'monitor-build',
            scriptId: 'build',
            scriptName: 'Build preview',
            outputPattern: undefined,
            lineCount: undefined,
          },
        ],
        scripts: [scriptFixture, { ...scriptFixture, id: 'build', name: 'Build preview' }],
        status: 'ready',
      }),
    );
    if (failure)
      store.dispatch(
        scriptMonitorOperationUpdated(monitorFixture.workspaceId, monitorFixture.monitorId, {
          pending: false,
          error: true,
          message: m.chat_scriptMonitor_action_error(),
        }),
      );
    return () =>
      store.dispatch(
        scriptMonitorsUpdated(monitorFixture.workspaceId, {
          monitors: [],
          scripts: [],
          status: 'unsupported',
        }),
      );
  });
</script>

<div class="w-full bg-background text-foreground" data-testid="script-monitors-preview">
  <EventSubscriptionsCard
    workspaceId={monitorFixture.workspaceId}
    agentId={monitorFixture.agentId}
    isolatedPreview={{ count: 2, initiallyExpanded: true }}
    suppressTopGap
  >
    {#snippet previewContent()}<MonitoredScriptsRow
        workspaceId={monitorFixture.workspaceId}
        agentId={monitorFixture.agentId}
      />{/snippet}
  </EventSubscriptionsCard>
</div>
