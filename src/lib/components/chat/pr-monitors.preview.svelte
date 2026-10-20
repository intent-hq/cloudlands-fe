<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  type PreviewProps = { estimate?: boolean; legacy?: boolean };
  export const preview = definePreview<PreviewProps>({
    id: 'pr-monitors',
    title: 'PR monitors — merge queue',
    defaultState: 'queued',
    states: {
      queued: { props: { estimate: true } },
      'queued-no-estimate': { props: { estimate: false } },
      'queued-older-daemon': { props: { legacy: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { prMonitorsUpdated } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
  import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
  import EventSubscriptionsCard from './EventSubscriptionsCard.svelte';
  import MonitoredPrsRow from './MonitoredPrsRow.svelte';
  import { setExpandedPrMonitorId } from './agent-subscriptions-view-state';

  let { estimate = true, legacy = false }: PreviewProps = $props();

  const workspaceId = 'preview-pr-monitors';
  const agentId = 'preview-pr-monitors-agent';

  function monitor(): PrMonitorRow {
    return {
      monitorId: 'preview-pr-monitor',
      workspaceId,
      agentId,
      repo: 'intent-hq/intentd',
      prNumber: 2534,
      state: 'active',
      pendingChanges: [],
      hasPendingChanges: false,
      createdAt: '2026-10-20T03:50:00Z',
      updatedAt: '2026-10-20T03:58:00Z',
      title:
        'fix: name the env -u NODE_OPTIONS re-run when the callback fixture refuses an injected preload',
      url: 'https://github.com/intent-hq/intentd/pull/2534',
      lastSnapshot: {
        state: 'open',
        isDraft: false,
        hasConflicts: false,
        isBehind: false,
        mergeable: true,
        checks: {
          total: 12,
          passed: 12,
          failed: 0,
          pending: 0,
          failingRequired: 0,
          pendingRequired: 0,
          requiredKnown: true,
        },
        approvals: { decision: 'approved', have: 1, needed: 1, changesRequested: 0 },
        threads: { unresolved: 0, resolutionRequired: true },
        isInMergeQueue: true,
        ...(legacy
          ? {}
          : {
              mergeQueue: {
                position: 2,
                queueSize: 2,
                state: 'queued',
                enqueuedAt: '2026-10-20T03:50:26Z',
                ...(estimate ? { estimatedTimeToMerge: 2254 } : {}),
              },
            }),
        rulesKnown: true,
      },
    };
  }

  setExpandedPrMonitorId(workspaceId, agentId, 'preview-pr-monitor');
  onMount(() => {
    store.dispatch(prMonitorsUpdated(workspaceId, [monitor()]));
    return () => store.dispatch(prMonitorsUpdated(workspaceId, []));
  });
</script>

<div class="w-full bg-background text-foreground" data-testid="pr-monitors-preview">
  <EventSubscriptionsCard
    {workspaceId}
    {agentId}
    isolatedPreview={{ count: 1, initiallyExpanded: true }}
    suppressTopGap
  >
    {#snippet previewContent()}<MonitoredPrsRow {workspaceId} {agentId} />{/snippet}
  </EventSubscriptionsCard>
</div>
