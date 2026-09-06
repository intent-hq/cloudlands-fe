<script lang="ts">
  import WorkspaceAgentsList from '$lib/components/workspace/WorkspaceAgentsList.svelte';
  import TaskStatusIndicator from '$lib/components/workspace/TaskStatusIndicator.svelte';
  import SemanticMapCanvas from '$lib/components/visualization/semantic-map/SemanticMapCanvas.svelte';
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
  import type { TabTypeComponentProps } from './registry';

  let { workspaceId }: TabTypeComponentProps = $props();
  const mapState = selectSemanticMapState(workspaceId);
  const agents = selectAllWorkspaceAgents(workspaceId);
  const tasks = selectWorkspaceTaskDisplayList(workspaceId);
  let canvasWidth = $state(1);
  let canvasHeight = $state(1);

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
</script>

<div class="grid h-full min-h-0 grid-cols-[16rem_minmax(0,1fr)_16rem] bg-background">
  <aside class="min-h-0 overflow-y-auto border-r border-border p-3">
    <h2 class="mb-2 text-sm font-semibold">{m.semanticMap_sandbox_agents_label()}</h2>
    <WorkspaceAgentsList
      agents={$agents}
      selectedAgentId={$mapState.selectedAgentId}
      onSelect={({ agentId }) =>
        appStore.dispatch(semanticMapSelectedAgentChanged(workspaceId, agentId))}
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
          onclick={() => appStore.dispatch(semanticMapSelectedTaskChanged(workspaceId, task.id))}
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
    {#if $mapState.source === 'structural'}
      <p
        class="absolute left-5 top-5 z-10 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground"
      >
        {m.semanticMap_canvas_selectionNone_description()}
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
        onSelectRegion={(regionIds) =>
          appStore.dispatch(semanticMapSelectedRegionChanged(workspaceId, regionIds[0] ?? null))}
        onSelectAgent={(agentId) =>
          appStore.dispatch(semanticMapSelectedAgentChanged(workspaceId, agentId))}
        onClearSelection={() =>
          appStore.dispatch(semanticMapSelectedRegionChanged(workspaceId, null))}
      />
    {/if}
  </main>

  <aside class="min-h-0 overflow-y-auto border-l border-border p-4">
    {#if selectedTask}
      <h2 class="text-sm font-semibold">{selectedTask.title}</h2>
      <div class="mt-2"><TaskStatusIndicator status={selectedTask.status} readonly /></div>
    {:else if selectedAgent}
      <h2 class="text-sm font-semibold">{selectedAgent.name}</h2>
    {:else}
      <p class="text-sm text-muted-foreground">
        {m.semanticMap_canvas_selectionNone_description()}
      </p>
    {/if}
  </aside>
</div>
