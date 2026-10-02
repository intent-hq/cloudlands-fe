<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import HomeSearch from './HomeSearch.svelte';
  import Fa from 'svelte-fa';
  import { faList, faTableColumns, faCube } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import HomeFilterSelect from './HomeFilterSelect.svelte';
  import HomeViewOptions from './HomeViewOptions.svelte';
  import type { HomeFilter } from './home-model';
  let {
    query,
    filter,
    view,
    filters,
    onquery,
    onfilter,
    onview,
    settings,
  }: {
    query: string;
    filter: HomeFilter;
    view: 'list' | 'board' | 'city';
    filters: { id: HomeFilter; label: string; count: number }[];
    onquery: (query: string) => void;
    onfilter: (filter: HomeFilter) => void;
    onview: (view: 'list' | 'board' | 'city') => void;
    settings: Snippet;
    children?: Snippet;
  } = $props();
</script>

<HomeSearch
  value={query}
  onchange={onquery}
  placeholder={m.home_search_workspaces()}
  class="min-w-24 w-48 shrink"
  inputClass="home-control-fill rounded-xl border-transparent"
/>
<div
  class="home-choice-group home-workspace-filters-wide ml-auto shrink-0"
  role="group"
  aria-label={m.layout_allCard_status_label()}
>
  {#each filters as item (item.id)}
    <Button
      variant="ghost"
      size="sm"
      active={filter === item.id}
      aria-pressed={filter === item.id}
      onclick={() => onfilter(item.id)}
      >{item.label}<span
        class="home-filter-count ml-1.5 tabular-nums"
        class:text-muted-foreground={filter !== item.id}>{formatInteger(item.count)}</span
      ></Button
    >
  {/each}
  <Button
    variant="ghost"
    size="sm"
    active={filter === 'archived'}
    aria-pressed={filter === 'archived'}
    onclick={() => onfilter('archived')}>{m.home_filter_archived()}</Button
  >
</div>
<div class="home-workspace-filters-compact ml-auto min-w-0">
  <HomeFilterSelect
    value={filter}
    label={m.layout_allCard_status_label()}
    options={[
      ...filters.map((item) => ({ value: item.id, label: item.label })),
      { value: 'archived', label: m.home_filter_archived() },
    ]}
    onchange={(value) => onfilter(value as HomeFilter)}
  />
</div>
<div class="home-choice-group shrink-0" role="group" aria-label={m.home_workspace_view()}>
  <Button
    variant="ghost"
    size="icon-sm"
    active={view === 'list'}
    aria-pressed={view === 'list'}
    aria-label={m.home_list_view()}
    tooltip={m.home_list_view()}
    onclick={() => onview('list')}><Fa icon={faList} /></Button
  >
  <Button
    variant="ghost"
    size="icon-sm"
    active={view === 'board'}
    aria-pressed={view === 'board'}
    aria-label={m.home_board_view()}
    tooltip={m.home_board_view()}
    onclick={() => onview('board')}><Fa icon={faTableColumns} /></Button
  >
  <Button
    variant="ghost"
    size="icon-sm"
    active={view === 'city'}
    aria-pressed={view === 'city'}
    aria-label={m.home_city_view()}
    tooltip={m.home_city_view()}
    onclick={() => onview('city')}><Fa icon={faCube} /></Button
  >
</div>
<HomeViewOptions>{@render settings()}</HomeViewOptions>
