<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    cityScenarios,
    createCityFixture,
    createReservedCityLayout,
    type CityScenario,
  } from './home-city-fixtures';

  interface Props {
    scenario?: CityScenario;
  }
  export const preview = definePreview<Props>({
    id: 'home-city',
    title: 'Workspace city',
    defaultState: 'showcase',
    states: Object.fromEntries(
      cityScenarios.map((scenario) => [scenario, { props: { scenario } }]),
    ),
  });
</script>

<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import HomeWorkspaceCity from './HomeWorkspaceCity.svelte';
  import { emptyCityLayout, normalizeCityLayout } from './home-city-layout';
  import { untrack } from 'svelte';

  let { scenario = 'showcase' }: Props = $props();
  let query = $state('');
  let revision = $state(0);
  let removed = $state(false);
  let generation = $state(0);
  let opened = $state('');
  let listRequested = $state(false);
  let searchInput: HTMLInputElement | undefined = $state();
  let populated = $state(false);
  let layout = $state(
    untrack(() =>
      scenario === 'reserved-layout' ? createReservedCityLayout() : emptyCityLayout(),
    ),
  );
  const original = $derived(createCityFixture(populated ? 'two' : scenario));
  const model = $derived({
    repositories: original.repositories,
    buildings: original.buildings
      .filter((_, index) => !removed || index !== 0)
      .map((building) =>
        revision === 0
          ? building
          : {
              ...building,
              status: 'complete' as const,
              files: 250,
              additions: 2_000,
              deletions: 40,
              floors: 8,
              metricSource: 'working-tree' as const,
              metricBase: 'HEAD',
            },
      ),
  });
  const matchingIds = $derived(
    model.buildings
      .filter((building) => building.title.toLowerCase().includes(query.toLowerCase()))
      .map((building) => building.id),
  );
</script>

<div
  class="flex h-[850px] w-full flex-col gap-3 bg-background p-4 text-foreground"
  data-city-fixture
  data-city-preview
>
  <div class="flex flex-wrap items-center gap-2">
    <div class="min-w-0 flex-1">
      <Input
        type="search"
        aria-label="Search city workspaces"
        placeholder="Search workspaces…"
        bind:value={query}
        bind:ref={searchInput}
        data-city-fixture-search
      />
    </div>
    <Button
      variant="ghost"
      size="sm"
      onclick={() => {
        query = '';
      }}>Clear search</Button
    >
    <Button
      variant="outline"
      size="sm"
      onclick={() => {
        revision += 1;
      }}>Update metrics</Button
    >
    <Button
      variant="outline"
      size="sm"
      onclick={() => {
        removed = true;
      }}>Remove first</Button
    >
    <Button
      variant="outline"
      size="sm"
      onclick={() => {
        generation += 1;
        listRequested = false;
      }}>Remount city</Button
    >
    {#if scenario === 'empty-populate' || scenario === 'reserved-layout'}
      <Button
        variant="outline"
        size="sm"
        onclick={() => {
          populated = true;
        }}>Populate city</Button
      >
    {/if}
    {#if scenario === 'reserved-layout'}
      <Button
        variant="outline"
        size="sm"
        onclick={() => {
          layout = normalizeCityLayout(JSON.parse(JSON.stringify(layout)));
          generation += 1;
        }}>Reload saved layout</Button
      >
    {/if}
  </div>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    {#key generation}
      <HomeWorkspaceCity
        {model}
        {matchingIds}
        {query}
        {layout}
        onlayout={(next) => {
          layout = next;
        }}
        onsearch={() => searchInput?.focus()}
        onclear={() => {
          query = '';
        }}
        onopen={(id) => {
          opened = id;
        }}
        onlist={() => {
          listRequested = true;
        }}
      />
    {/key}
  </div>
  <output class="sr-only" data-city-opened>{opened}</output>
  <output class="sr-only" data-city-list-requested>{listRequested}</output>
  <output class="sr-only" data-city-fixture-count>{model.buildings.length}</output>
  <output class="sr-only" data-city-reservations>{layout.plots.length}</output>
</div>
