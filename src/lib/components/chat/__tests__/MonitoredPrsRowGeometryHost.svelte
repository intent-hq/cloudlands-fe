<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import MonitoredPrsRow from '../MonitoredPrsRow.svelte';
  import PrMonitorWakeAttributionHeader from '../PrMonitorWakeAttributionHeader.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    prMonitorsUpdated,
    prMonitorsSnapshotFailed,
  } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
  import { removeWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import type { ReviewMonitorRow as PrMonitorRow } from '$shared/types/pr-monitor';
  import SidebarPrDropdown from '$lib/components/workspace/sidebar/SidebarPrDropdown.svelte';
  import SidebarPrList from '$lib/components/workspace/sidebar/SidebarPrList.svelte';
  import WorkspaceCard from '$lib/components/workspace/WorkspaceCard.svelte';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import { buildWorkspacePRPresentationModel } from '$lib/components/workspace/sidebar/workspace-pr-presentation';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';

  let {
    zoom = 1,
    width = 360,
    referenceState = 'pending',
    provider,
    surface = 'chat',
  }: {
    zoom?: number;
    width?: number;
    referenceState?: string;
    provider?: 'github' | 'gitlab';
    surface?: 'chat' | 'sidebar' | 'card';
  } = $props();
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

  const workspace: Workspace = {
    id: WorkspaceId(workspaceId),
    title: 'Review workspace',
    branch: 'feat/review',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: monitor.createdAt,
    updatedAt: monitor.updatedAt,
    displayStatus: 'idle',
    activity: 'idle',
    repositoryOwner: 'intent-hq',
    repositoryName: 'cloudlands-fe',
  };
  let rows = $state<PrMonitorRow[]>([]);
  const presentation = $derived(
    buildWorkspacePRPresentationModel({
      workspacePRs: [],
      activePR: null,
      monitors: rows,
      workspaceRepo: 'intent-hq/cloudlands-fe',
      buildPrUrl: () => '',
      getDisplayTitle: (pr) => pr.title,
    }),
  );
  $effect(() => {
    if (surface !== 'chat') untrack(() => store.dispatch(setWorkspaceEntity(workspace)));
    const row = structuredClone(monitor);
    if (provider) {
      row.resource = {
        repository: {
          provider,
          instanceBaseUrl:
            provider === 'gitlab' ? 'https://forge.example/gitlab' : 'https://github.com',
          projectPath: row.repo,
        },
        kind: provider === 'gitlab' ? 'merge-request' : 'pull-request',
        number: row.prNumber,
      };
      row.monitorAvailability = { state: 'available' };
      row.url =
        provider === 'gitlab'
          ? `https://forge.example/gitlab/${row.repo}/-/merge_requests/${row.prNumber}`
          : `https://github.com/${row.repo}/pull/${row.prNumber}`;
      row.origin = { backendId: 'fixture', sessionId: 'confirmed', workspaceId };
      row.lastSnapshot!.availability = {
        policy: 'available',
        approvals: 'available',
        checks: 'available',
        discussions: 'available',
      };
    }
    const snapshot = row.lastSnapshot!;
    if (referenceState === 'loading') return;
    if (referenceState === 'failed') {
      store.dispatch(prMonitorsSnapshotFailed(workspaceId));
      return;
    }
    if (referenceState === 'passing') {
      snapshot.mergeable = true;
      snapshot.checks.passed = 4;
      snapshot.checks.pending = 0;
      snapshot.checks.pendingRequired = 0;
      snapshot.approvals.have = 1;
      snapshot.threads.unresolved = 0;
      row.hasPendingChanges = false;
      row.pendingChanges = [];
    }
    if (referenceState === 'failing') {
      snapshot.checks.failed = 2;
      snapshot.checks.pending = 0;
      snapshot.checks.failingRequired = 2;
      snapshot.checks.pendingRequired = 0;
      const { total, passed, failed, pending, failingRequired, pendingRequired } = snapshot.checks;
      if (
        total !== passed! + failed! + pending! ||
        failingRequired !== failed ||
        pendingRequired !== pending
      ) {
        throw new Error('Failing reference checks and required counts must be coherent');
      }
    }
    if (referenceState === 'unknown') {
      row.lastSnapshot = undefined;
      row.hasPendingChanges = false;
      row.pendingChanges = [];
    }
    if (referenceState === 'restricted') snapshot.threads.unresolved = undefined;
    if (referenceState === 'draft') snapshot.isDraft = true;
    if (referenceState === 'queued') snapshot.isInMergeQueue = true;
    if (referenceState === 'paused') {
      row.pausedUntil = '2030-01-01T12:00:00Z';
      row.lastPolledAt = '2026-10-09T12:00:00Z';
    }
    if (referenceState === 'completed') {
      row.state = 'completed';
      snapshot.state = 'merged';
    }
    if (referenceState === 'restricted' && provider) {
      snapshot.approvals.have = null;
      snapshot.approvals.changesRequested = null;
      snapshot.approvals.decision = null;
      snapshot.availability!.approvals = 'restricted';
    }
    if (referenceState === 'null' && provider) {
      snapshot.checks.total = null;
      snapshot.checks.passed = null;
      snapshot.checks.failed = null;
      snapshot.checks.pending = null;
      snapshot.checks.failingRequired = null;
      snapshot.checks.pendingRequired = null;
      snapshot.availability!.checks = 'unknown';
      snapshot.mergeable = null;
    }
    if (referenceState === 'reconnect') row.monitorAvailability = { state: 'reconnect-required' };
    if (referenceState === 'unresolved') {
      row.resource = undefined;
      row.url = undefined;
      row.monitorAvailability = { state: 'unresolved', reason: 'missing-provenance' };
    }
    if (referenceState === 'no-link') row.url = null;
    const nextRows = [row];
    if (referenceState === 'mixed' && row.resource) {
      const github = structuredClone(row);
      github.monitorId = 'github-monitor';
      github.resource = {
        repository: {
          provider: 'github',
          instanceBaseUrl: 'https://github.com',
          projectPath: row.repo,
        },
        kind: 'pull-request',
        number: row.prNumber,
      };
      github.url = `https://github.com/${row.repo}/pull/${row.prNumber}`;
      const otherInstance = structuredClone(row);
      otherInstance.monitorId = 'second-gitlab';
      otherInstance.resource!.repository.instanceBaseUrl = 'https://second.example/install';
      otherInstance.url = null;
      nextRows.push(github, otherInstance);
    }
    rows = nextRows;
    untrack(() => store.dispatch(prMonitorsUpdated(workspaceId, nextRows)));
  });

  onDestroy(() => {
    store.dispatch(removeWorkspaceEntity(workspaceId));
    disposeStore();
  });
</script>

<section class="bg-background p-2 text-foreground" style:width="{width}px" style:zoom>
  {#if surface === 'sidebar'}
    <SidebarPrDropdown rows={presentation} {workspaceId} />
    <SidebarPrList rows={presentation} interactive={false} onSelect={() => {}} />
  {:else if surface === 'card'}
    <WorkspaceCard {workspace} onClick={() => {}} />
    <WorkspaceHoverCard {workspace} loadAgentSessions={false} />
  {:else if referenceState === 'wake' || referenceState === 'wake-no-link'}
    <PrMonitorWakeAttributionHeader
      attribution={{
        monitorId: monitor.monitorId,
        repo: monitor.repo,
        prNumber: monitor.prNumber,
        resource: rows[0]?.resource,
        monitorAvailability: rows[0]?.monitorAvailability,
        url: referenceState === 'wake-no-link' ? undefined : (rows[0]?.url ?? undefined),
      }}
    />
  {:else}
    <MonitoredPrsRow {workspaceId} {agentId} embedded />
  {/if}
</section>
