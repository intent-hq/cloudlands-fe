<script lang="ts">
  import WorkspaceAgentsList from '$lib/components/workspace/WorkspaceAgentsList.svelte';
  import TaskStatusIndicator from '$lib/components/workspace/TaskStatusIndicator.svelte';
  import SemanticMapCanvas from '$lib/components/visualization/semantic-map/SemanticMapCanvas.svelte';
  import SemanticMapDetail, {
    type SemanticMapDetailSelection,
  } from '$lib/components/visualization/semantic-map/SemanticMapDetail.svelte';
  import { computeBudget } from '$lib/components/visualization/semantic-map/layout/budget';
  import { placeRegions } from '$lib/components/visualization/semantic-map/layout/place';
  import { Button } from '$lib/components/ui/button';
  import { formatInteger } from '$lib/i18n/format';
  import { getAgentColorsWithSeed } from '$lib/utils/agent-colors';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectFilteredSemanticMapActivities,
    selectSemanticMapState,
  } from '$store/renderer/slices/semantic-map/semantic-map-selectors';
  import {
    semanticMapAgentFilterChanged,
    semanticMapKindFilterChanged,
    semanticMapSelectedAgentChanged,
    semanticMapSelectedRegionChanged,
    semanticMapSelectedTaskChanged,
    semanticMapTimeWindowChanged,
  } from '$store/renderer/slices/semantic-map/semantic-map-slice';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import {
    selectWorkspaceTaskDisplayList,
    selectWorkspaceTaskProgress,
  } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
  import { selectFileTrackingChanges } from '$store/renderer/slices/changes/changes-selectors';
  import {
    openWorkspaceDiff,
    openWorkspaceFile,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import type { TabTypeComponentProps } from './registry';
  import type { MapActivityKind } from '$lib/components/visualization/semantic-map/core/types';

  type StableDetailSelection =
    | Exclude<SemanticMapDetailSelection, { type: 'crossing' }>
    | { type: 'crossing'; from: string; to: string; agentId: string | null };

  const activityKinds: MapActivityKind[] = [
    'read',
    'edit',
    'create',
    'delete',
    'move',
    'tool',
    'thinking',
  ];
  const timeWindowMinutes = [5, 15, 60] as const;

  let { workspaceId }: TabTypeComponentProps = $props();
  const mapState = selectSemanticMapState(workspaceId);
  const filteredActivities = selectFilteredSemanticMapActivities(workspaceId);
  const agents = selectAllWorkspaceAgents(workspaceId);
  const tasks = selectWorkspaceTaskDisplayList(workspaceId);
  const taskProgress = selectWorkspaceTaskProgress(workspaceId);
  const trackedChanges = selectFileTrackingChanges(workspaceId);
  let canvasWidth = $state(1);
  let canvasHeight = $state(1);
  let detailOverride = $state<StableDetailSelection>(null);
  let detailHistory = $state<StableDetailSelection[]>([]);
  let filtersExpanded = $state(false);
  let detailsExpanded = $state(false);

  const selectedTask = $derived($tasks.find(({ id }) => id === $mapState.selectedTaskNoteId));
  const selectedAgent = $derived($agents.find(({ id }) => id === $mapState.selectedAgentId));
  const selection = $derived(
    $mapState.selectedAgentId
      ? { type: 'agent' as const, agentId: $mapState.selectedAgentId }
      : $mapState.selectedRegionId
        ? { type: 'region' as const, regionIds: [$mapState.selectedRegionId] }
        : $mapState.selectedTaskNoteId
          ? { type: 'route' as const }
          : null,
  );
  const detailSelection = $derived.by<SemanticMapDetailSelection>(() => {
    if (detailOverride?.type === 'crossing') {
      const crossing = detailOverride;
      if (crossing.agentId !== $mapState.selectedAgentId) return null;
      const transitionIndex = $mapState.route?.transitions.findIndex(
        ({ from, to }) => from === crossing.from && to === crossing.to,
      );
      return transitionIndex === undefined || transitionIndex < 0
        ? null
        : { type: 'crossing', transitionIndex };
    }
    return (
      detailOverride ??
      ($mapState.selectedAgentId
        ? { type: 'agent', agentId: $mapState.selectedAgentId }
        : $mapState.selectedRegionId
          ? { type: 'region', regionId: $mapState.selectedRegionId }
          : $mapState.selectedTaskNoteId
            ? { type: 'route' }
            : null)
    );
  });
  const detailAgents = $derived(
    $agents.map(({ id, name, status }) => ({ id: String(id), name, status: String(status) })),
  );
  const detailFileChanges = $derived(
    $trackedChanges.map(({ relativePath, stats }) => ({
      path: relativePath,
      additions: stats.additions,
      deletions: stats.deletions,
    })),
  );
  const routeSubjectLabel = $derived(selectedTask?.title ?? selectedAgent?.name);
  const geometry = $derived.by(() => {
    if (!$mapState.manifest) return null;
    const viewport = { width: Math.max(1, canvasWidth), height: Math.max(1, canvasHeight) };
    return {
      rest: placeRegions($mapState.manifest, computeBudget($mapState.manifest), viewport),
      focus: placeRegions(
        $mapState.manifest,
        computeBudget($mapState.manifest, {
          regionIds: $mapState.selectedRegionId ? [$mapState.selectedRegionId] : undefined,
          route: $mapState.route ?? undefined,
        }),
        viewport,
      ),
    };
  });
  const canvasTimeWindow = $derived({
    start: $mapState.timeWindow.startTs ?? '1970-01-01T00:00:00.000Z',
    end: $mapState.timeWindow.endTs ?? '9999-12-31T23:59:59.999Z',
  });
  const filterAgents = $derived.by(() => {
    const names = new Map($agents.map(({ id, name }) => [String(id), name]));
    for (const activity of $mapState.activities) {
      if (activity.agentId && !names.has(activity.agentId)) {
        names.set(activity.agentId, activity.agentName ?? activity.agentId);
      }
    }
    return [...names].map(([id, name]) => ({ id, name }));
  });

  function toggleAgentFilter(agentId: string): void {
    const allAgentIds = filterAgents.map(({ id }) => id);
    const enabled = $mapState.agentFilter.length > 0 ? $mapState.agentFilter : allAgentIds;
    const next = enabled.includes(agentId)
      ? enabled.filter((id) => id !== agentId)
      : [...enabled, agentId];
    if (next.length === 0) return;
    appStore.dispatch(
      semanticMapAgentFilterChanged(workspaceId, next.length === allAgentIds.length ? [] : next),
    );
  }

  function toggleKindFilter(kind: MapActivityKind): void {
    const enabled = $mapState.kindFilter.length > 0 ? $mapState.kindFilter : activityKinds;
    const next = enabled.includes(kind)
      ? enabled.filter((candidate) => candidate !== kind)
      : [...enabled, kind];
    if (next.length === 0) return;
    appStore.dispatch(
      semanticMapKindFilterChanged(workspaceId, next.length === activityKinds.length ? [] : next),
    );
  }

  function setTimeWindow(minutes: number | null): void {
    appStore.dispatch(
      semanticMapTimeWindowChanged(workspaceId, {
        startTs: minutes === null ? null : new Date(Date.now() - minutes * 60_000).toISOString(),
        endTs: null,
      }),
    );
  }

  function isTimeWindowSelected(minutes: number | null): boolean {
    if (minutes === null) return $mapState.timeWindow.startTs === null;
    if (!$mapState.timeWindow.startTs || $mapState.timeWindow.endTs) return false;
    return (
      Math.abs(Date.now() - Date.parse($mapState.timeWindow.startTs) - minutes * 60_000) < 30_000
    );
  }

  function kindLabel(kind: MapActivityKind): string {
    return {
      read: m.semanticMap_sandbox_read_label(),
      edit: m.semanticMap_sandbox_edit_label(),
      create: m.semanticMap_detail_create_label(),
      delete: m.semanticMap_detail_delete_label(),
      move: m.semanticMap_detail_move_label(),
      tool: m.semanticMap_sandbox_tool_label(),
      thinking: m.semanticMap_sandbox_thinking_label(),
    }[kind];
  }

  function selectCrossing(transitionIndex: number): void {
    const transition = $mapState.route?.transitions[transitionIndex];
    if (!transition) return;
    detailOverride = {
      type: 'crossing',
      from: transition.from,
      to: transition.to,
      agentId: $mapState.selectedAgentId,
    };
    detailHistory = [];
    detailsExpanded = true;
  }

  function selectDetailFile(path: string): void {
    detailHistory = detailOverride ? [...detailHistory, detailOverride] : detailHistory;
    detailOverride = { type: 'file', path };
  }

  function navigateDetailBack(): void {
    detailOverride = detailHistory.at(-1) ?? null;
    detailHistory = detailHistory.slice(0, -1);
  }

  function selectAgent(agentId: string | null): void {
    detailOverride = null;
    detailHistory = [];
    detailsExpanded = agentId !== null;
    appStore.dispatch(semanticMapSelectedAgentChanged(workspaceId, agentId));
  }

  function selectRegion(regionId: string | null): void {
    detailOverride = null;
    detailHistory = [];
    detailsExpanded = regionId !== null;
    appStore.dispatch(semanticMapSelectedRegionChanged(workspaceId, regionId));
  }

  function selectTask(taskNoteId: string): void {
    detailOverride = null;
    detailHistory = [];
    detailsExpanded = true;
    appStore.dispatch(semanticMapSelectedTaskChanged(workspaceId, taskNoteId));
  }

  function clearSelection(): void {
    detailOverride = null;
    detailHistory = [];
    appStore.dispatch(semanticMapSelectedRegionChanged(workspaceId, null));
  }

  function openDiff(path: string): void {
    const change = $trackedChanges.find(
      ({ relativePath, file }) => relativePath === path || file === path,
    );
    if (change) appStore.dispatch(openWorkspaceDiff(workspaceId, change, { filePath: path }));
  }
</script>

<div
  class="map-layout grid h-full min-h-0 grid-cols-[16rem_minmax(0,1fr)_16rem] bg-background"
  data-semantic-map-layout
  data-compact-breakpoint="48rem"
>
  <aside
    class:compact-collapsed={!filtersExpanded}
    class="filters-sidebar min-h-0 overflow-y-auto border-r border-border p-3"
    data-semantic-map-sidebar="filters"
  >
    <div class="compact-disclosure">
      <Button
        variant="plain"
        class="w-full justify-between px-0"
        aria-expanded={filtersExpanded}
        onclick={() => (filtersExpanded = !filtersExpanded)}
      >
        {m.semanticMap_panel_filters_label()}
      </Button>
    </div>
    <div class="compact-panel-content">
      <h2 class="mb-2 text-sm font-semibold">{m.semanticMap_panel_filters_label()}</h2>
      {#if filterAgents.length > 0}
        <fieldset class="mb-3 flex flex-wrap gap-1.5">
          <legend class="mb-1 text-xs text-muted-foreground">
            {m.semanticMap_panel_filterAgents_label()}
          </legend>
          {#each filterAgents as agent (agent.id)}
            <Button
              size="sm"
              variant={$mapState.agentFilter.length === 0 ||
              $mapState.agentFilter.includes(agent.id)
                ? 'secondary'
                : 'outline'}
              aria-pressed={$mapState.agentFilter.length === 0 ||
                $mapState.agentFilter.includes(agent.id)}
              onclick={() => toggleAgentFilter(agent.id)}
            >
              <span aria-hidden="true" data-agent-color-swatch>
                <span
                  class="block size-2.5 shrink-0 rounded-full dark:hidden"
                  style:background-color={getAgentColorsWithSeed(agent.id)[0]}
                ></span>
                <span
                  class="hidden size-2.5 shrink-0 rounded-full dark:block"
                  style:background-color={getAgentColorsWithSeed(agent.id, true)[0]}
                ></span>
              </span>
              {agent.name}
            </Button>
          {/each}
        </fieldset>
      {/if}
      <fieldset class="mb-3 flex flex-wrap gap-1.5">
        <legend class="mb-1 text-xs text-muted-foreground">
          {m.semanticMap_panel_filterKinds_label()}
        </legend>
        {#each activityKinds as kind (kind)}
          <Button
            size="sm"
            variant={$mapState.kindFilter.length === 0 || $mapState.kindFilter.includes(kind)
              ? 'secondary'
              : 'outline'}
            aria-pressed={$mapState.kindFilter.length === 0 || $mapState.kindFilter.includes(kind)}
            onclick={() => toggleKindFilter(kind)}>{kindLabel(kind)}</Button
          >
        {/each}
      </fieldset>
      <fieldset class="mb-4 flex flex-wrap gap-1.5">
        <legend class="mb-1 text-xs text-muted-foreground">
          {m.semanticMap_panel_filterTime_label()}
        </legend>
        <Button
          size="sm"
          variant={isTimeWindowSelected(null) ? 'secondary' : 'outline'}
          aria-pressed={isTimeWindowSelected(null)}
          onclick={() => setTimeWindow(null)}>{m.semanticMap_panel_allTime_label()}</Button
        >
        {#each timeWindowMinutes as minutes (minutes)}
          <Button
            size="sm"
            variant={isTimeWindowSelected(minutes) ? 'secondary' : 'outline'}
            aria-pressed={isTimeWindowSelected(minutes)}
            onclick={() => setTimeWindow(minutes)}
            >{m.semanticMap_sandbox_minutes_label({ count: formatInteger(minutes) })}</Button
          >
        {/each}
      </fieldset>
      <h2 class="mb-2 text-sm font-semibold">{m.semanticMap_sandbox_agents_label()}</h2>
      <WorkspaceAgentsList
        agents={$agents}
        selectedAgentId={$mapState.selectedAgentId}
        onSelect={({ agentId }) => selectAgent(agentId)}
      />
      <h2 class="mb-2 mt-4 text-sm font-semibold">
        {m.workspace_flameGraph_tasksComplete_label({
          completed: formatInteger($taskProgress.completed),
          total: formatInteger($taskProgress.total),
        })}
      </h2>
      <div class="flex flex-col gap-1">
        {#each $tasks as task (task.id)}
          <Button
            variant="plain"
            class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60 {$mapState.selectedTaskNoteId ===
            task.id
              ? 'bg-muted'
              : ''}"
            aria-pressed={$mapState.selectedTaskNoteId === task.id}
            onclick={() => selectTask(task.id)}
          >
            <span class="min-w-0 flex-1 truncate">{task.title}</span>
            <TaskStatusIndicator status={task.status} readonly compact />
          </Button>
        {/each}
      </div>
    </div>
  </aside>

  <main
    class="map-canvas relative min-h-0 min-w-0 p-3"
    data-semantic-map-canvas-panel
    bind:clientWidth={canvasWidth}
    bind:clientHeight={canvasHeight}
  >
    {#if $mapState.hydrationStatus === 'idle' || $mapState.hydrationStatus === 'loading'}
      <p
        class="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {m.semanticMap_panel_loading_description()}
      </p>
    {:else if $mapState.hydrationStatus === 'error'}
      <p
        class="absolute inset-0 z-10 flex items-center justify-center text-sm text-danger"
        role="alert"
      >
        {m.semanticMap_panel_error_description()}
      </p>
    {/if}
    {#if $mapState.hydrationStatus === 'loaded' && $mapState.source === 'structural'}
      <p
        class="absolute left-5 top-5 z-10 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground"
        data-testid="semantic-map-source-hint"
        data-map-source="structural"
      >
        {m.semanticMap_panel_structuralHint_description()}
      </p>
    {/if}
    {#if $mapState.hydrationStatus === 'loaded' && $mapState.manifest && $filteredActivities.length === 0}
      <p
        class="pointer-events-none absolute inset-x-5 top-1/2 z-10 -translate-y-1/2 rounded bg-background/90 px-3 py-2 text-center text-sm text-muted-foreground"
        role="status"
        data-testid="semantic-map-empty-state"
      >
        {$mapState.activities.length === 0
          ? m.semanticMap_panel_noActivity_description()
          : m.semanticMap_panel_noMatchingActivity_description()}
      </p>
    {/if}
    {#if $mapState.manifest && geometry}
      <SemanticMapCanvas
        manifest={$mapState.manifest}
        {geometry}
        activities={$mapState.activities}
        route={$mapState.route ?? undefined}
        {selection}
        filters={{ agentIds: $mapState.agentFilter, kinds: $mapState.kindFilter }}
        timeWindow={canvasTimeWindow}
        width={Math.max(1, canvasWidth - 24)}
        height={Math.max(1, canvasHeight - 24)}
        onSelectRegion={(regionIds) => selectRegion(regionIds[0] ?? null)}
        onSelectAgent={selectAgent}
        onSelectRoute={() => {
          detailOverride = { type: 'route' };
          detailsExpanded = true;
        }}
        onClearSelection={clearSelection}
      />
    {/if}
  </main>

  <aside
    class:compact-collapsed={!detailsExpanded}
    class="details-sidebar min-h-0 overflow-y-auto border-l border-border p-4"
    data-semantic-map-sidebar="details"
  >
    <div class="compact-disclosure">
      <Button
        variant="plain"
        class="w-full justify-between px-0"
        aria-expanded={detailsExpanded}
        onclick={() => (detailsExpanded = !detailsExpanded)}
      >
        {m.semanticMap_panel_details_label()}
      </Button>
    </div>
    <div class="compact-panel-content">
      {#if $mapState.manifest}
        <SemanticMapDetail
          manifest={$mapState.manifest}
          activities={$filteredActivities}
          route={$mapState.route ?? undefined}
          selection={detailSelection}
          agents={detailAgents}
          fileChanges={detailFileChanges}
          {routeSubjectLabel}
          onSelectCrossing={selectCrossing}
          onSelectFile={selectDetailFile}
          onOpenFile={(path) => appStore.dispatch(openWorkspaceFile(workspaceId, path))}
          onOpenDiff={openDiff}
          onNavigateBack={navigateDetailBack}
        />
      {/if}
    </div>
  </aside>
</div>

<style>
  .compact-disclosure {
    display: none;
  }

  .compact-panel-content {
    display: contents;
  }

  @container panel (max-width: 47.99rem) {
    .map-layout {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(18rem, 1fr) auto;
    }

    .compact-disclosure {
      display: flex;
    }

    .filters-sidebar {
      border-right: 0;
      border-bottom: 1px solid var(--color-border);
    }

    .details-sidebar {
      border-top: 1px solid var(--color-border);
      border-left: 0;
    }

    .filters-sidebar:not(.compact-collapsed),
    .details-sidebar:not(.compact-collapsed) {
      max-height: 16rem;
    }

    .compact-collapsed > .compact-panel-content {
      display: none;
    }

    .map-canvas {
      min-height: 18rem;
    }
  }
</style>
