<script lang="ts" module>
  import { m } from '$shared/paraglide/messages.js';
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export type SemanticMapPreviewState =
    | 'rest'
    | 'busy'
    | 'route'
    | 'focus-region'
    | 'replay'
    | 'unsorted-heavy'
    | 'detail-region'
    | 'detail-agent'
    | 'detail-route'
    | 'detail-crossing';

  export interface SemanticMapPreviewProps {
    state: SemanticMapPreviewState;
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
      replay: previewState('replay'),
      'unsorted-heavy': previewState('unsorted-heavy'),
      'detail-region': previewState('detail-region'),
      'detail-agent': previewState('detail-agent'),
      'detail-route': previewState('detail-route'),
      'detail-crossing': previewState('detail-crossing'),
    },
  });
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { Button } from '$lib/components/ui/button';
  import { Slider } from '$lib/components/ui/slider';
  import SemanticMapCanvas from './SemanticMapCanvas.svelte';
  import SemanticMapDetail, { type SemanticMapDetailSelection } from './SemanticMapDetail.svelte';
  import manifestJson from './fixtures/intent-manifest.json';
  import { computeBudget } from './layout/budget';
  import { placeRegions } from './layout/place';
  import type { Manifest, MapActivityKind } from './core/types';
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

  const canvasWidth = queryDimension('w', 1200, 1600);
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
    initialMode === 'route' || initialMode === 'detail-agent'
      ? { type: 'agent', agentId: SCRIPT_AGENTS[0].id }
      : initialMode === 'focus-region' || initialMode === 'detail-region'
        ? { type: 'region', regionIds: ['renderer-ui'] }
        : initialMode === 'detail-route' || initialMode === 'detail-crossing'
          ? { type: 'route' }
          : null,
  );
  let detailSelection = $state<SemanticMapDetailSelection>(
    initialMode === 'detail-region'
      ? { type: 'region', regionId: 'renderer-ui' }
      : initialMode === 'detail-agent'
        ? { type: 'agent', agentId: SCRIPT_AGENTS[0].id }
        : initialMode === 'detail-route'
          ? { type: 'route' }
          : initialMode === 'detail-crossing'
            ? { type: 'crossing', transitionIndex: 0 }
            : null,
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
  const activities = $derived(
    mode === 'rest'
      ? []
      : [...script.activities, ...unsortedActivities].filter(
          ({ ts }) => Date.parse(ts) <= currentTime,
        ),
  );
  const route = $derived(routeAgentId ? script.routes[routeAgentId] : undefined);
  const geometry = $derived.by(() => ({
    rest: placeRegions(manifest, computeBudget(manifest), { width: canvasWidth, height }),
    focus: placeRegions(
      manifest,
      computeBudget(manifest, {
        regionIds: selection?.type === 'region' ? selection.regionIds : undefined,
        route,
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
  }

  function selectAgent(agentId: string): void {
    routeAgentId = agentId;
    selection = { type: 'agent', agentId };
    detailSelection = { type: 'agent', agentId };
  }

  function selectRoute(): void {
    selection = { type: 'route' };
    detailSelection = { type: 'route' };
  }

  function clearSelection(): void {
    routeAgentId = null;
    selection = null;
    detailSelection = null;
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

<section class="grid gap-4" data-semantic-map-preview data-semantic-map-state={mode}>
  <div
    class="flex flex-wrap items-start gap-x-8 gap-y-3 rounded-lg border border-border bg-card p-3 text-sm"
  >
    <fieldset class="flex flex-wrap items-center gap-2">
      <legend class="mr-2 inline font-medium">{m.semanticMap_sandbox_agents_label()}</legend>
      {#each SCRIPT_AGENTS as agent (agent.id)}
        <Button
          type="button"
          size="sm"
          variant={selectedAgentIds.includes(agent.id) ? 'secondary' : 'outline'}
          aria-pressed={selectedAgentIds.includes(agent.id)}
          onclick={() => toggleAgent(agent.id)}>{agent.name}</Button
        >
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
          onclick={() => toggleKind(kind)}>{kindLabel(kind)}</Button
        >
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
    class="grid min-w-0 grid-cols-[minmax(0,1fr)_18rem] overflow-hidden rounded-lg border border-border bg-background"
  >
    <SemanticMapCanvas
      {manifest}
      {geometry}
      {activities}
      {route}
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
    <aside class="overflow-y-auto border-l border-border p-4" style="height: {height}px">
      <SemanticMapDetail
        {manifest}
        {activities}
        {route}
        selection={detailSelection}
        agents={detailAgents}
        fileChanges={detailFileChanges}
        routeSubjectLabel={SCRIPT_AGENTS.find(({ id }) => id === routeAgentId)?.name}
        onSelectCrossing={(transitionIndex) =>
          (detailSelection = { type: 'crossing', transitionIndex })}
        onSelectFile={(path) => (detailSelection = { type: 'file', path })}
      />
    </aside>
  </div>
</section>
