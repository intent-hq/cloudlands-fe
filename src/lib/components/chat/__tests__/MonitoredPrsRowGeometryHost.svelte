<script lang="ts">
  import { onDestroy } from 'svelte';
  import MonitoredPrsRow from '../MonitoredPrsRow.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { prMonitorsUpdated } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
  import { removeWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';

  let { zoom = 1 }: { zoom?: number } = $props();
  const componentId = $props.id();
  const workspaceId = `monitored-pr-details-geometry-${componentId}`;
  const agentId = `monitored-pr-details-agent-${componentId}`;
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });

  const monitor: PrMonitorRow = {
    monitorId: 'geometry-monitor',
    workspaceId,
    agentId,
    repo: 'intent-hq/cloudlands-fe',
    prNumber: 2105,
    state: 'active',
    title: 'Align expanded monitored PR details',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:04:00.000Z',
    lastChangeAt: '2026-09-01T09:03:00.000Z',
    hasPendingChanges: true,
    pendingChanges: ['checks'],
    lastSnapshot: {
      state: 'open',
      isDraft: false,
      hasConflicts: false,
      isBehind: false,
      mergeable: false,
      checks: {
        total: 4,
        passed: 2,
        failed: 0,
        pending: 2,
        failingRequired: 0,
        pendingRequired: 2,
        requiredKnown: true,
      },
      approvals: { decision: 'review_required', have: 0, needed: 1, changesRequested: 0 },
      threads: { unresolved: 2, resolutionRequired: true },
      rulesKnown: true,
    },
  };

  store.dispatch(prMonitorsUpdated(workspaceId, [monitor]));

  onDestroy(() => {
    store.dispatch(removeWorkspaceEntity(workspaceId));
    disposeStore();
  });
</script>

<section class="bg-background p-2 text-foreground" style:width="360px" style:zoom>
  <MonitoredPrsRow {workspaceId} {agentId} embedded />
</section>
