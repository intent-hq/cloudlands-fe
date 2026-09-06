<script lang="ts" module>
  import type { Manifest, MapActivity, Route } from './core/types';

  export type SemanticMapDetailSelection =
    | { type: 'region'; regionId: string }
    | { type: 'agent'; agentId: string }
    | { type: 'route' }
    | { type: 'crossing'; transitionIndex: number }
    | { type: 'file'; path: string }
    | null;

  export interface SemanticMapDetailAgent {
    id: string;
    name: string;
    status: string;
  }

  export interface SemanticMapDetailFileChange {
    path: string;
    additions: number;
    deletions: number;
  }

  export interface SemanticMapDetailProps {
    manifest: Manifest;
    activities: MapActivity[];
    route?: Route;
    selection: SemanticMapDetailSelection;
    agents?: SemanticMapDetailAgent[];
    fileChanges?: SemanticMapDetailFileChange[];
    routeSubjectLabel?: string;
    onSelectCrossing?: (transitionIndex: number) => void;
    onSelectFile?: (path: string) => void;
    onOpenFile?: (path: string) => void;
    onOpenDiff?: (path: string) => void;
  }
</script>

<script lang="ts">
  import { formatInteger, formatTime } from '$lib/i18n/format';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { MapActivityKind, RouteTransition } from './core/types';

  let {
    manifest,
    activities,
    route,
    selection,
    agents = [],
    fileChanges = [],
    routeSubjectLabel,
    onSelectCrossing,
    onSelectFile,
    onOpenFile,
    onOpenDiff,
  }: SemanticMapDetailProps = $props();

  const selectedRegion = $derived(
    selection?.type === 'region'
      ? manifest.regions.find(({ id }) => id === selection.regionId)
      : undefined,
  );
  const selectedAgent = $derived(
    selection?.type === 'agent' ? agents.find(({ id }) => id === selection.agentId) : undefined,
  );
  const selectedTransition = $derived(
    selection?.type === 'crossing' ? route?.transitions[selection.transitionIndex] : undefined,
  );
  const selectedFileChange = $derived(
    selection?.type === 'file'
      ? fileChanges.find(({ path }) => path === selection.path)
      : undefined,
  );
  const selectedFileActivities = $derived(
    selection?.type === 'file'
      ? activities
          .filter(({ path }) => path === selection.path)
          .toSorted((left, right) => Date.parse(right.ts) - Date.parse(left.ts))
      : [],
  );
  const regionChildren = $derived(
    selectedRegion ? manifest.regions.filter(({ parent }) => parent === selectedRegion.id) : [],
  );
  const agentActivities = $derived(
    selection?.type === 'agent'
      ? activities
          .filter(({ agentId }) => agentId === selection.agentId)
          .toSorted((left, right) => Date.parse(right.ts) - Date.parse(left.ts))
      : [],
  );
  const regionFileGroups = $derived.by(() => {
    if (!selectedRegion) return [];
    const grouped = new Map<string, { agentName: string; paths: string[] }>();
    for (const activity of activities) {
      if (activity.regionId !== selectedRegion.id || !activity.path) continue;
      const key = activity.agentId ?? activity.agentName ?? '';
      const group = grouped.get(key) ?? {
        agentName:
          activity.agentName ?? activity.agentId ?? m.semanticMap_detail_unknownAgent_label(),
        paths: [],
      };
      if (!group.paths.includes(activity.path)) group.paths.push(activity.path);
      grouped.set(key, group);
    }
    return [...grouped.values()];
  });
  const crossingActivities = $derived.by(() => {
    if (!selectedTransition) return [];
    const evidence = new Set(selectedTransition.evidence);
    return activities
      .filter(({ path }) => path && evidence.has(path))
      .toSorted((left, right) => Date.parse(left.ts) - Date.parse(right.ts));
  });

  function regionLabel(regionId: string): string {
    return manifest.regions.find(({ id }) => id === regionId)?.label ?? regionId;
  }

  function transitionLabel(transition: RouteTransition): string {
    return transition.label ?? `${regionLabel(transition.from)} → ${regionLabel(transition.to)}`;
  }

  function activityKindLabel(kind: MapActivityKind): string {
    switch (kind) {
      case 'read':
        return m.semanticMap_sandbox_read_label();
      case 'edit':
        return m.semanticMap_sandbox_edit_label();
      case 'create':
        return m.semanticMap_detail_create_label();
      case 'delete':
        return m.semanticMap_detail_delete_label();
      case 'move':
        return m.semanticMap_detail_move_label();
      case 'tool':
        return m.semanticMap_sandbox_tool_label();
      case 'thinking':
        return m.semanticMap_sandbox_thinking_label();
    }
  }

  function statusLabel(status: string): string {
    switch (status.toLowerCase()) {
      case 'active':
      case 'processing':
      case 'responding':
      case 'streaming':
        return m.agentOverview_hierarchyGraph_statusResponding_label();
      case 'waiting':
      case 'pending':
        return m.agentOverview_hierarchyGraph_statusWaiting_label();
      case 'completed':
        return m.agentOverview_hierarchyGraph_statusCompleted_label();
      case 'error':
      case 'failed':
      case 'deleted':
        return m.agentOverview_hierarchyGraph_statusFailed_label();
      default:
        return m.agentOverview_hierarchyGraph_statusIdle_label();
    }
  }
</script>

<div
  class="flex min-h-full flex-col gap-5 text-sm"
  data-semantic-map-detail
  data-selection={selection?.type ?? 'empty'}
>
  {#if selectedRegion}
    <header>
      <h2 class="font-serif text-lg font-semibold">{selectedRegion.label}</h2>
      <p class="mt-2 leading-relaxed text-muted-foreground">{selectedRegion.responsibility}</p>
    </header>
    {#if regionChildren.length > 0}
      <section>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {m.semanticMap_detail_subregions_label()}
        </h3>
        <ul class="space-y-1">
          {#each regionChildren as child (child.id)}
            <li>{child.label}</li>
          {/each}
        </ul>
      </section>
    {/if}
    <section>
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {m.semanticMap_detail_filesTouched_label()}
      </h3>
      {#if regionFileGroups.length > 0}
        <div class="space-y-3">
          {#each regionFileGroups as group (group.agentName)}
            <div>
              <p class="mb-1 font-medium">{group.agentName}</p>
              <ul class="space-y-1">
                {#each group.paths as path (path)}
                  <li>
                    <button
                      class="break-all text-left font-mono text-xs text-primary hover:underline"
                      type="button"
                      onclick={() => onOpenFile?.(path)}>{path}</button
                    >
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-muted-foreground">{m.semanticMap_detail_noEvidence_description()}</p>
      {/if}
    </section>
  {:else if selection?.type === 'agent'}
    <header>
      <h2 class="font-serif text-lg font-semibold">{selectedAgent?.name ?? selection.agentId}</h2>
      {#if selectedAgent}
        <p class="mt-1 text-muted-foreground">{statusLabel(selectedAgent.status)}</p>
      {/if}
    </header>
    <section>
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {m.semanticMap_detail_recentActivity_label()}
      </h3>
      <ul class="space-y-2">
        {#each agentActivities.slice(0, 8) as activity (`${activity.ts}-${activity.path ?? activity.kind}`)}
          <li class="border-l border-border pl-2">
            <div class="flex items-baseline justify-between gap-2">
              <span>{activityKindLabel(activity.kind)}</span>
              <time class="text-xs text-muted-foreground" datetime={activity.ts}
                >{formatTime(activity.ts)}</time
              >
            </div>
            <p class="truncate text-xs text-muted-foreground">
              {activity.path ?? (activity.regionId ? regionLabel(activity.regionId) : '')}
            </p>
          </li>
        {/each}
      </ul>
    </section>
    <section>
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {m.semanticMap_detail_routeSoFar_label()}
      </h3>
      <ol class="space-y-2">
        {#each route?.visits ?? [] as regionId, index (`${regionId}-${index}`)}
          <li>
            <span class="mr-2 font-mono text-xs text-muted-foreground"
              >{formatInteger(index + 1)}</span
            >{regionLabel(regionId)}
          </li>
        {/each}
      </ol>
      {#if route?.transitions.length}
        <div class="mt-3 space-y-1">
          {#each route.transitions as transition, index (`${transition.from}-${transition.to}-${index}`)}
            <button
              type="button"
              class="block w-full rounded border border-border px-2 py-1.5 text-left hover:bg-muted"
              onclick={() => onSelectCrossing?.(index)}>{transitionLabel(transition)}</button
            >
          {/each}
        </div>
      {/if}
    </section>
  {:else if selection?.type === 'route'}
    <header>
      <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {m.semanticMap_detail_route_label()}
      </p>
      {#if routeSubjectLabel}<h2 class="mt-1 font-serif text-lg font-semibold">
          {routeSubjectLabel}
        </h2>{/if}
    </header>
    {#if route}
      <ol class="space-y-2">
        {#each route.transitions as transition, index (`${transition.from}-${transition.to}-${index}`)}
          <li>
            <button
              type="button"
              class="w-full rounded border border-border p-2 text-left hover:bg-muted"
              onclick={() => onSelectCrossing?.(index)}
            >
              <span class="block font-medium">{transitionLabel(transition)}</span>
              <span class="mt-1 block text-xs text-muted-foreground"
                >{m.semanticMap_detail_crossingCount_label({
                  count: formatInteger(transition.count),
                })}</span
              >
            </button>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="text-muted-foreground">{m.semanticMap_detail_noEvidence_description()}</p>
    {/if}
  {:else if selectedTransition}
    <header>
      <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {m.semanticMap_detail_crossing_label()}
      </p>
      <h2 class="mt-1 font-serif text-lg font-semibold">{transitionLabel(selectedTransition)}</h2>
      <p class="mt-1 text-muted-foreground">
        {regionLabel(selectedTransition.from)} → {regionLabel(selectedTransition.to)}
      </p>
    </header>
    <section>
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {m.semanticMap_detail_evidence_label()}
      </h3>
      <ul class="space-y-1">
        {#each selectedTransition.evidence as path (path)}
          <li>
            <button
              type="button"
              class="break-all text-left font-mono text-xs text-primary hover:underline"
              onclick={() => onSelectFile?.(path)}>{path}</button
            >
          </li>
        {/each}
      </ul>
    </section>
    {#if crossingActivities.length > 0}
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
        <dt class="text-muted-foreground">{m.semanticMap_detail_firstObserved_label()}</dt>
        <dd>
          <time datetime={crossingActivities[0].ts}>{formatTime(crossingActivities[0].ts)}</time>
        </dd>
        <dt class="text-muted-foreground">{m.semanticMap_detail_lastObserved_label()}</dt>
        <dd>
          <time datetime={crossingActivities.at(-1)?.ts}
            >{formatTime(crossingActivities.at(-1)!.ts)}</time
          >
        </dd>
      </dl>
    {/if}
  {:else if selection?.type === 'file'}
    <header>
      <h2 class="break-all font-mono text-sm font-semibold">{selection.path}</h2>
    </header>
    {#if selectedFileActivities[0]?.agentName || selectedFileActivities[0]?.agentId}
      <p>
        <span class="text-muted-foreground">{m.semanticMap_detail_lastActor_label()}</span>
        {selectedFileActivities[0].agentName ?? selectedFileActivities[0].agentId}
      </p>
    {/if}
    {#if selectedFileChange}
      <p class="text-muted-foreground">
        {m.ui_diffViewer_additions_many({ count: formatInteger(selectedFileChange.additions) })} · {m.ui_diffViewer_deletions_many(
          { count: formatInteger(selectedFileChange.deletions) },
        )}
      </p>
    {/if}
    <div class="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onclick={() => onOpenFile?.(selection.path)}
        >{m.fileTracking_fileRow_openFile_label()}</Button
      >
      {#if selectedFileChange && onOpenDiff}
        <Button size="sm" variant="outline" onclick={() => onOpenDiff?.(selection.path)}
          >{m.layout_tabTypes_diff_title()}</Button
        >
      {/if}
    </div>
  {:else}
    <div class="m-auto max-w-52 text-center text-muted-foreground">
      <p>{m.semanticMap_detail_empty_description()}</p>
    </div>
  {/if}
</div>
