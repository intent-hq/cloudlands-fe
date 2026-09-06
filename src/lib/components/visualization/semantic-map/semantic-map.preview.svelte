<script lang="ts" module>
  import { m } from '$shared/paraglide/messages.js';
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export type SemanticMapPreviewState =
    'rest' | 'busy' | 'route' | 'focus-region' | 'replay' | 'unsorted-heavy';

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
    },
  });
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { Button } from '$lib/components/ui/button';
  import { Slider } from '$lib/components/ui/slider';
  import SemanticMapCanvas from './SemanticMapCanvas.svelte';
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

  const width = queryDimension('w', 900, 1600);
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
  let selection = $state<SemanticMapSelection>(
    initialMode === 'route'
      ? { type: 'agent', agentId: SCRIPT_AGENTS[0].id }
      : initialMode === 'focus-region'
        ? { type: 'region', regionIds: ['renderer-ui'] }
        : null,
  );

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
  const route = $derived(
    selection?.type === 'agent' ? script.routes[selection.agentId] : undefined,
  );
  const geometry = $derived.by(() => ({
    rest: placeRegions(manifest, computeBudget(manifest), { width, height }),
    focus: placeRegions(
      manifest,
      computeBudget(manifest, {
        regionIds: selection?.type === 'region' ? selection.regionIds : undefined,
        route,
      }),
      { width, height },
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
  <div class="grid gap-3 rounded-lg border border-border bg-card p-3 text-sm">
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
    <label class="grid grid-cols-[auto_1fr_auto] items-center gap-3">
      <span>{m.semanticMap_sandbox_timeWindow_label()}</span>
      <Slider min="1" max={SCRIPT_DURATION_MINUTES} step="1" bind:value={timeWindowMinutes} />
      <span>{m.semanticMap_sandbox_minutes_label({ count: formatInteger(timeWindowMinutes) })}</span
      >
    </label>
    {#if mode === 'replay'}
      <div class="grid grid-cols-[auto_1fr_auto] items-center gap-3">
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
        <label class="grid grid-cols-[auto_1fr_auto] items-center gap-3">
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

  <SemanticMapCanvas
    {manifest}
    {geometry}
    {activities}
    {route}
    {selection}
    {filters}
    {timeWindow}
    {width}
    {height}
    onSelectRegion={(regionIds) => (selection = { type: 'region', regionIds })}
    onSelectAgent={(agentId) => (selection = { type: 'agent', agentId })}
    onSelectRoute={() => (selection = { type: 'route' })}
    onClearSelection={() => (selection = null)}
  />
</section>
