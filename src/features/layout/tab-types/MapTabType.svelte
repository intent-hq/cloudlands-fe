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
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectSemanticMapState } from '$store/renderer/slices/semantic-map/semantic-map-selectors';
  import {
    semanticMapSelectedAgentChanged,
    semanticMapSelectedRegionChanged,
    semanticMapSelectedTaskChanged,
  } from '$store/renderer/slices/semantic-map/semantic-map-slice';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { selectWorkspaceTaskDisplayList } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
  import { selectFileTrackingChanges } from '$store/renderer/slices/changes/changes-selectors';
  import {
    openWorkspaceDiff,
    openWorkspaceFile,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import type { TabTypeComponentProps } from './registry';

  let { workspaceId }: TabTypeComponentProps = $props();
  const mapState = selectSemanticMapState(workspaceId);
  const agents = selectAllWorkspaceAgents(workspaceId);
  const tasks = selectWorkspaceTaskDisplayList(workspaceId);
  const trackedChanges = selectFileTrackingChanges(workspaceId);
  let canvasWidth = $state(1);
  let canvasHeight = $state(1);
  let detailOverride = $state<SemanticMapDetailSelection>(null);

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
  const detailSelection = $derived<SemanticMapDetailSelection>(
    detailOverride ??
      ($mapState.selectedAgentId
        ? { type: 'agent', agentId: $mapState.selectedAgentId }
        : $mapState.selectedRegionId
          ? { type: 'region', regionId: $mapState.selectedRegionId }
          : $mapState.selectedTaskNoteId
            ? { type: 'route' }
            : null),
  );
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

  function selectAgent(agentId: string | null): void {
    detailOverride = null;
    appStore.dispatch(semanticMapSelectedAgentChanged(workspaceId, agentId));
  }

  function selectRegion(regionId: string | null): void {
    detailOverride = null;
    appStore.dispatch(semanticMapSelectedRegionChanged(workspaceId, regionId));
  }

  function selectTask(taskNoteId: string): void {
    detailOverride = null;
    appStore.dispatch(semanticMapSelectedTaskChanged(workspaceId, taskNoteId));
  }

  function clearSelection(): void {
    detailOverride = null;
    appStore.dispatch(semanticMapSelectedRegionChanged(workspaceId, null));
  }

  function openDiff(path: string): void {
    const change = $trackedChanges.find(
      ({ relativePath, file }) => relativePath === path || file === path,
    );
    if (change) appStore.dispatch(openWorkspaceDiff(workspaceId, change, { filePath: path }));
  }
</script>

<div class="grid h-full min-h-0 grid-cols-[16rem_minmax(0,1fr)_16rem] bg-background">
  <aside class="min-h-0 overflow-y-auto border-r border-border p-3">
    <h2 class="mb-2 text-sm font-semibold">{m.semanticMap_sandbox_agents_label()}</h2>
    <WorkspaceAgentsList
      agents={$agents}
      selectedAgentId={$mapState.selectedAgentId}
      onSelect={({ agentId }) => selectAgent(agentId)}
    />
    <h2 class="mb-2 mt-4 text-sm font-semibold">
      {m.workspace_flameGraph_tasksComplete_label({ completed: 0, total: $tasks.length })}
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
  </aside>

  <main
    class="relative min-h-0 min-w-0 p-3"
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
        onSelectRoute={() => (detailOverride = { type: 'route' })}
        onClearSelection={clearSelection}
      />
    {/if}
  </main>

  <aside class="min-h-0 overflow-y-auto border-l border-border p-4">
    {#if $mapState.manifest}
      <SemanticMapDetail
        manifest={$mapState.manifest}
        activities={$mapState.activities}
        route={$mapState.route ?? undefined}
        selection={detailSelection}
        agents={detailAgents}
        fileChanges={detailFileChanges}
        {routeSubjectLabel}
        onSelectCrossing={(transitionIndex) =>
          (detailOverride = { type: 'crossing', transitionIndex })}
        onSelectFile={(path) => (detailOverride = { type: 'file', path })}
        onOpenFile={(path) => appStore.dispatch(openWorkspaceFile(workspaceId, path))}
        onOpenDiff={openDiff}
      />
    {/if}
  </aside>
</div>
