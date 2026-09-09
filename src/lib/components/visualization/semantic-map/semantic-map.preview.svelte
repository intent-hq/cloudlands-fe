<script lang="ts" module>
  import { m } from '$shared/paraglide/messages.js';
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export type SemanticMapPreviewState =
    | 'rest'
    | 'busy'
    | 'route'
    | 'focus-region'
    | 'focus-region-idle'
    | 'replay'
    | 'unsorted-heavy'
    | 'detail-region'
    | 'detail-agent'
    | 'detail-route'
    | 'detail-crossing'
    | 'compare-agents';

  export interface SemanticMapPreviewProps {
    state: SemanticMapPreviewState;
  }

  export const SEMANTIC_MAP_PREVIEW_COMPACT_BREAKPOINT = '48rem';

  export function resolveSemanticMapPreviewCanvasWidth(
    measuredWidth: number,
    requestedWidth = 0,
  ): number {
    return Math.max(1, Math.floor(requestedWidth || measuredWidth));
  }

  const previewState = (state: SemanticMapPreviewState) => ({ props: { state } });

  export const preview = definePreview<SemanticMapPreviewProps>({
    id: 'semantic-map',
    get title() {
      return m.semanticMap_sandbox_title();
    },
    defaultState: 'busy',
    states: {
      rest: previewState('rest'),
      busy: previewState('busy'),
      route: previewState('route'),
      'focus-region': previewState('focus-region'),
      'focus-region-idle': previewState('focus-region-idle'),
      replay: previewState('replay'),
      'unsorted-heavy': previewState('unsorted-heavy'),
      'detail-region': previewState('detail-region'),
      'detail-agent': previewState('detail-agent'),
      'detail-route': previewState('detail-route'),
      'detail-crossing': previewState('detail-crossing'),
      'compare-agents': previewState('compare-agents'),
    },
  });
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { Button } from '$lib/components/ui/button';
  import { Slider } from '$lib/components/ui/slider';
  import { getAgentColorsWithSeed } from '$lib/utils/agent-colors';
  import SemanticMapCanvas from './SemanticMapCanvas.svelte';
  import SemanticMapDetail, { type SemanticMapDetailSelection } from './SemanticMapDetail.svelte';
  import SemanticMapKindGlyph from './SemanticMapKindGlyph.svelte';
  import manifestJson from './fixtures/intent-manifest.json';
  import { computeBudget } from './layout/budget';
  import { placeRegions } from './layout/place';
  import type { Manifest, MapActivity, MapActivityKind } from './core/types';
  import type { SemanticMapSelection } from './render/types';
  import {
    createSemanticMapScript,
    SCRIPT_AGENTS,
    SCRIPT_DURATION_MINUTES,
    SCRIPT_START,
  } from './semantic-map-script';

  let { state: mode }: SemanticMapPreviewProps = $props();
  const initialMode = untrack(() => mode);

  function queryDimension(name: 'w' | 'h', fallback: number, maximum: number): number {
    if (typeof window === 'undefined') return fallback;
    const value = Number(new URL(window.location.href).searchParams.get(name));
    return Number.isInteger(value) && value >= 240 && value <= maximum ? value : fallback;
  }

  const requestedCanvasWidth = queryDimension('w', 0, 1600);
  const height = queryDimension('h', 620, 1200);
  const script = createSemanticMapScript();
  const baseManifest = manifestJson as Manifest;
  const kinds = ['read', 'edit', 'tool', 'thinking'] as const;
  const replaySpeeds = [1, 8, 32] as const;
  const unsortedRegion = {
    id: 'Unsorted',
    label: 'Unsorted', // i18n-ignore (daemon-shaped fallback region)
    responsibility: 'This is where files without a curated responsibility remain visible.', // i18n-ignore (daemon-shaped fixture)
    anchor: [0.52, 0.9] as [number, number],
    paths: Array.from({ length: 48 }, (_, index) => `unmatched/${index}.ts`),
  };

  const initialMinute =
    initialMode === 'busy' ? 8 : initialMode === 'replay' ? 14 : SCRIPT_DURATION_MINUTES;
  let currentMinute = $state(initialMinute);
  let measuredCanvasWidth = $state(1);
  let timeWindowMinutes = $state(SCRIPT_DURATION_MINUTES);
  let speed = $state<1 | 8 | 32>(8);
  let playing = $state(initialMode === 'busy');
  let selectedAgentIds = $state<string[]>(SCRIPT_AGENTS.map(({ id }) => id));
  let enabledKinds = $state<MapActivityKind[]>([...kinds]);
  let routeAgentId = $state<string | null>(
    initialMode === 'route' ||
      initialMode === 'detail-agent' ||
      initialMode === 'detail-route' ||
      initialMode === 'detail-crossing'
      ? SCRIPT_AGENTS[0].id
      : null,
  );
  let selection = $state<SemanticMapSelection>(
    initialMode === 'compare-agents'
      ? { type: 'agent', agentIds: SCRIPT_AGENTS.slice(0, 2).map(({ id }) => id) }
      : initialMode === 'route' || initialMode === 'detail-agent'
        ? { type: 'agent', agentIds: [SCRIPT_AGENTS[0].id] }
        : initialMode === 'focus-region' ||
            initialMode === 'focus-region-idle' ||
            initialMode === 'detail-region'
          ? { type: 'region', regionIds: ['renderer-ui'] }
          : initialMode === 'detail-route'
            ? { type: 'route' }
            : initialMode === 'detail-crossing'
              ? { type: 'route', transitionIndex: 0 }
              : null,
  );
  let detailSelection = $state<SemanticMapDetailSelection>(
    initialMode === 'compare-agents'
      ? { type: 'agent', agentIds: SCRIPT_AGENTS.slice(0, 2).map(({ id }) => id) }
      : initialMode === 'detail-region'
        ? { type: 'region', regionId: 'renderer-ui' }
        : initialMode === 'detail-agent'
          ? { type: 'agent', agentIds: [SCRIPT_AGENTS[0].id] }
          : initialMode === 'detail-route'
            ? { type: 'route' }
            : initialMode === 'detail-crossing'
              ? { type: 'crossing', transitionIndex: 0 }
              : null,
  );
  let detailHistory = $state<SemanticMapDetailSelection[]>(
    initialMode === 'detail-crossing' ? [{ type: 'route' }] : [],
  );
  const detailAgents = SCRIPT_AGENTS.map(({ id, name }, index) => ({
    id,
    name,
    status: ['active', 'waiting', 'completed'][index], // i18n-ignore (daemon-shaped status fixture)
  }));
  const detailFileChanges = [
    {
      path: 'packages/intentd/crates/intent-core/src/events/mod.rs',
      additions: 18,
      deletions: 4,
    },
  ];

  const manifest = $derived<Manifest>(
    mode === 'unsorted-heavy'
      ? { ...baseManifest, regions: [...baseManifest.regions, unsortedRegion] }
      : baseManifest,
  );
  const currentTime = $derived(Date.parse(SCRIPT_START) + currentMinute * 60_000);
  const timeWindow = $derived({
    start: new Date(
      Math.max(Date.parse(SCRIPT_START), currentTime - timeWindowMinutes * 60_000),
    ).toISOString(),
    end: new Date(currentTime).toISOString(),
  });
  const unsortedActivities = $derived(
    mode === 'unsorted-heavy'
      ? Array.from({ length: 24 }, (_, index) => ({
          id: `semantic-map-unsorted-${index}`,
          regionId: 'Unsorted',
          agentId: SCRIPT_AGENTS[index % SCRIPT_AGENTS.length].id,
          agentName: SCRIPT_AGENTS[index % SCRIPT_AGENTS.length].name,
          path: `unmatched/${index}.ts`,
          kind: 'edit' as const,
          ts: new Date(Date.parse(SCRIPT_START) + index * 45_000).toISOString(),
        }))
      : [],
  );
  const focusEvidenceActivities: MapActivity[] = [
    ['focus-canvas', 'SemanticMapCanvas.svelte', 'edit', 'agent-renderer', 'Quinn'],
    ['focus-scene', 'render/scene.ts', 'read', 'agent-renderer', 'Quinn'],
    ['focus-labels', 'render/labels.ts', 'edit', 'agent-research', 'Sol'],
    ['focus-layout', 'layout/place.ts', 'read', 'agent-daemon', 'Mina'],
    ['focus-preview', 'semantic-map.preview.svelte', 'tool', 'agent-research', 'Sol'],
  ].map(([id, path, kind, agentId, agentName], index) => ({
    id,
    regionId: 'renderer-ui',
    agentId,
    agentName,
    path: `packages/cloudlands-fe/src/lib/components/visualization/semantic-map/${path}`,
    kind: kind as MapActivityKind,
    ts: new Date(Date.parse(SCRIPT_START) + (15 + index) * 60_000).toISOString(),
  }));
  const comparisonActivities: MapActivity[] = ['event-stream', 'transport-rpc'].map(
    (regionId, index) => ({
      id: `semantic-map-shared-${index}`,
      regionId,
      agentId: SCRIPT_AGENTS[1].id,
      agentName: SCRIPT_AGENTS[1].name,
      kind: 'read',
      ts: new Date(Date.parse(SCRIPT_START) + (11 + index) * 60_000).toISOString(),
    }),
  );
  const activities = $derived(
    mode === 'rest' || mode === 'focus-region-idle'
      ? []
      : mode === 'focus-region'
        ? focusEvidenceActivities.filter(({ ts }) => Date.parse(ts) <= currentTime)
        : [
            ...script.activities,
            ...unsortedActivities,
            ...(mode === 'compare-agents' ? comparisonActivities : []),
          ].filter(({ ts }) => Date.parse(ts) <= currentTime),
  );
  const canvasWidth = $derived(
    resolveSemanticMapPreviewCanvasWidth(measuredCanvasWidth, requestedCanvasWidth),
  );
  const canvasRoutes = $derived.by(() => {
    const agentIds =
      selection?.type === 'agent' ? selection.agentIds : routeAgentId ? [routeAgentId] : [];
    return agentIds.flatMap((agentId) => {
      const agentRoute = script.routes[agentId];
      return agentRoute ? [{ agentId, route: agentRoute }] : [];
    });
  });
  const route = $derived(routeAgentId ? script.routes[routeAgentId] : undefined);
  const comparisonRoute = $derived(
    canvasRoutes.length > 0
      ? {
          visits: canvasRoutes.flatMap(({ route: agentRoute }) => agentRoute.visits),
          transitions: canvasRoutes.flatMap(({ route: agentRoute }) => agentRoute.transitions),
        }
      : undefined,
  );
  const geometry = $derived.by(() => ({
    rest: placeRegions(manifest, computeBudget(manifest), { width: canvasWidth, height }),
    focus: placeRegions(
      manifest,
      computeBudget(manifest, {
        regionIds: selection?.type === 'region' ? selection.regionIds : undefined,
        route: comparisonRoute,
      }),
      { width: canvasWidth, height },
    ),
  }));
  const filters = $derived({ agentIds: selectedAgentIds, kinds: enabledKinds });

  function toggleAgent(agentId: string): void {
    selectedAgentIds = selectedAgentIds.includes(agentId)
      ? selectedAgentIds.filter((id) => id !== agentId)
      : [...selectedAgentIds, agentId];
  }

  function toggleKind(kind: MapActivityKind): void {
    enabledKinds = enabledKinds.includes(kind)
      ? enabledKinds.filter((candidate) => candidate !== kind)
      : [...enabledKinds, kind];
  }

  function selectRegion(regionIds: string[]): void {
    routeAgentId = null;
    selection = { type: 'region', regionIds };
    detailSelection = { type: 'region', regionId: regionIds[0] };
    detailHistory = [];
  }

  function selectAgent(agentId: string, additive = false): void {
    const current = selection?.type === 'agent' ? selection.agentIds : [];
    const next = additive
      ? current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId]
      : [agentId];
    routeAgentId = agentId;
    selection = {
      type: 'agent',
      agentIds: next,
      pinnedRegionIds:
        selection?.type === 'region' ? selection.regionIds : selection?.pinnedRegionIds,
    };
    detailSelection = next.length > 0 ? { type: 'agent', agentIds: next } : null;
    detailHistory = [];
  }

  function selectRoute(agentId: string | undefined, transitionIndex: number): void {
    routeAgentId = agentId ?? routeAgentId;
    selection = { type: 'route', agentId, transitionIndex };
    detailSelection = { type: 'crossing', transitionIndex };
    detailHistory = [];
  }

  function clearSelection(): void {
    routeAgentId = null;
    selection = null;
    detailSelection = null;
    detailHistory = [];
  }

  function selectDetail(next: Exclude<SemanticMapDetailSelection, null>): void {
    detailHistory = detailSelection ? [...detailHistory, detailSelection] : detailHistory;
    detailSelection = next;
    if (next.type === 'crossing')
      selection = { type: 'route', transitionIndex: next.transitionIndex };
  }

  function navigateDetailBack(): void {
    const previous = detailHistory.at(-1) ?? null;
    detailSelection = previous;
    if (previous?.type === 'route') selection = { type: 'route' };
    else if (previous?.type === 'crossing')
      selection = { type: 'route', transitionIndex: previous.transitionIndex };
    detailHistory = detailHistory.slice(0, -1);
  }

  function kindLabel(kind: (typeof kinds)[number]): string {
    return {
      read: m.semanticMap_sandbox_read_label(),
      edit: m.semanticMap_sandbox_edit_label(),
      tool: m.semanticMap_sandbox_tool_label(),
      thinking: m.semanticMap_sandbox_thinking_label(),
    }[kind];
  }

  onMount(() => {
    if (mode !== 'busy') return;
    const timer = window.setInterval(() => {
      currentMinute = currentMinute >= SCRIPT_DURATION_MINUTES ? 0 : currentMinute + 0.5;
    }, 800);
    return () => window.clearInterval(timer);
  });

  $effect(() => {
    if (mode !== 'replay' || !playing) return;
    const timer = window.setInterval(() => {
      currentMinute =
        currentMinute >= SCRIPT_DURATION_MINUTES
          ? 0
          : Math.min(SCRIPT_DURATION_MINUTES, currentMinute + speed / 16);
    }, 250);
    return () => window.clearInterval(timer);
  });
</script>

<section class="preview-root grid gap-4" data-semantic-map-preview data-semantic-map-state={mode}>
  <div
    class="flex flex-wrap items-start gap-x-8 gap-y-3 rounded-lg border border-border bg-card p-3 text-sm"
  >
    <fieldset class="flex flex-wrap items-center gap-2">
      <legend class="mr-2 inline font-medium">{m.semanticMap_sandbox_agents_label()}</legend>
      {#each SCRIPT_AGENTS as agent (agent.id)}
        <Button
          type="button"
          size="sm"
          variant={(mode === 'compare-agents' &&
            selection?.type === 'agent' &&
            selection.agentIds.includes(agent.id)) ||
          (mode !== 'compare-agents' && selectedAgentIds.includes(agent.id))
            ? 'secondary'
            : 'outline'}
          aria-pressed={mode === 'compare-agents' && selection?.type === 'agent'
            ? selection.agentIds.includes(agent.id)
            : selectedAgentIds.includes(agent.id)}
          onclick={() =>
            mode === 'compare-agents' ? selectAgent(agent.id, true) : toggleAgent(agent.id)}
        >
          <span aria-hidden="true" data-agent-color-swatch>
            <span
              class="block size-2.5 shrink-0 rounded-full ring-1 ring-foreground dark:hidden"
              style:background-color={getAgentColorsWithSeed(agent.id)[0]}
            ></span>
            <span
              class="hidden size-2.5 shrink-0 rounded-full ring-1 ring-foreground dark:block"
              style:background-color={getAgentColorsWithSeed(agent.id, true)[0]}
            ></span>
          </span>
          {agent.name}
        </Button>
      {/each}
    </fieldset>
    <fieldset class="flex flex-wrap items-center gap-2">
      <legend class="mr-2 inline font-medium">{m.semanticMap_sandbox_actions_label()}</legend>
      {#each kinds as kind (kind)}
        <Button
          type="button"
          size="sm"
          variant={enabledKinds.includes(kind) ? 'secondary' : 'outline'}
          aria-pressed={enabledKinds.includes(kind)}
          onclick={() => toggleKind(kind)}
        >
          <SemanticMapKindGlyph {kind} />
          {kindLabel(kind)}
        </Button>
      {/each}
    </fieldset>
    <label class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3">
      <span>{m.semanticMap_sandbox_timeWindow_label()}</span>
      <Slider min="1" max={SCRIPT_DURATION_MINUTES} step="1" bind:value={timeWindowMinutes} />
      <span>{m.semanticMap_sandbox_minutes_label({ count: formatInteger(timeWindowMinutes) })}</span
      >
    </label>
    {#if mode === 'replay'}
      <div class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant={playing ? 'secondary' : 'outline'}
          aria-pressed={playing}
          onclick={() => (playing = !playing)}
        >
          {playing
            ? m.agentOverview_timeScrubber_live_label()
            : m.agentOverview_timeScrubber_paused_label()}
        </Button>
        <label class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3">
          <span>{m.semanticMap_sandbox_scrub_label()}</span>
          <Slider min="0" max={SCRIPT_DURATION_MINUTES} step="0.25" bind:value={currentMinute} />
          <span
            >{m.semanticMap_sandbox_minutes_label({
              count: formatInteger(Math.round(currentMinute)),
            })}</span
          >
        </label>
        <fieldset class="flex items-center gap-1">
          <legend class="sr-only">{m.semanticMap_sandbox_speed_label()}</legend>
          {#each replaySpeeds as replaySpeed (replaySpeed)}
            <Button
              type="button"
              size="sm"
              variant={speed === replaySpeed ? 'secondary' : 'outline'}
              aria-pressed={speed === replaySpeed}
              onclick={() => (speed = replaySpeed)}>{formatInteger(replaySpeed)}×</Button
            >
          {/each}
        </fieldset>
      </div>
    {/if}
  </div>

  <div
    class="preview-layout grid min-w-0 grid-cols-[minmax(0,1fr)_18rem] overflow-hidden rounded-lg border border-border bg-background"
    data-semantic-map-layout
    data-compact-breakpoint={SEMANTIC_MAP_PREVIEW_COMPACT_BREAKPOINT}
  >
    <div
      class="preview-canvas min-w-0 overflow-hidden"
      data-semantic-map-canvas-panel
      bind:clientWidth={measuredCanvasWidth}
    >
      <SemanticMapCanvas
        {manifest}
        {geometry}
        {activities}
        routes={canvasRoutes}
        {selection}
        {filters}
        {timeWindow}
        width={canvasWidth}
        {height}
        onSelectRegion={selectRegion}
        onSelectAgent={selectAgent}
        onSelectRoute={selectRoute}
        onClearSelection={clearSelection}
      />
    </div>
    <aside
      class="preview-detail overflow-y-auto border-l border-border bg-background p-4"
      data-semantic-map-detail-panel
      style="height: {height}px"
    >
      <SemanticMapDetail
        {manifest}
        {activities}
        {route}
        selection={detailSelection}
        agents={detailAgents}
        fileChanges={detailFileChanges}
        routeSubjectLabel={SCRIPT_AGENTS.find(({ id }) => id === routeAgentId)?.name}
        routes={canvasRoutes}
        onSelectCrossing={(transitionIndex, agentId) => {
          routeAgentId = agentId ?? routeAgentId;
          selectDetail({ type: 'crossing', transitionIndex });
        }}
        onSelectFile={(path) => selectDetail({ type: 'file', path })}
        onNavigateBack={navigateDetailBack}
      />
    </aside>
  </div>
</section>

<style>
  .preview-root {
    container-type: inline-size;
  }

  @container (max-width: 47.99rem) {
    .preview-layout {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto;
    }

    .preview-detail {
      border-top: 1px solid var(--color-border);
      border-left: 0;
    }
  }
</style>
