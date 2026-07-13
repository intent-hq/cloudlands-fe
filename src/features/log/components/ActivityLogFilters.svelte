<!--
  Activity Log Filters Component

  Provides advanced filtering options for the activity log with
  real-time updates and saved filter presets.
-->

<script lang="ts">
  import { slide } from 'svelte/transition';
  import {
  deleteActivityLogPreset,
  saveActivityLogPreset,
  type ActivityLogPresetPreference,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { selectActivityLogPresets } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { store as appStore } from '$store/renderer/store';


  interface Filters {
    showFileChanges: boolean;
    showAgentActivity: boolean;
    showSystemEvents: boolean;
    showErrors: boolean;
    searchQuery: string;
    dateRange: string;
    actorFilter: string;
  }

  let {
    filters = $bindable({
      showFileChanges: true,
      showAgentActivity: true,
      showSystemEvents: true,
      showErrors: true,
      searchQuery: '',
      dateRange: 'all',
      actorFilter: 'all',
    } as Filters),
    onfilter,
  }: {
    filters: Filters;
    onfilter?: (filters: Filters) => void;
  } = $props();

  const activityLogPresets$ = selectActivityLogPresets();
  let showAdvanced = $state(false);

  // Event type mappings
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const eventTypeCategories = {
    fileChanges: ['file:created', 'file:changed', 'file:deleted', 'file:renamed'],
    agentActivity: [
      'agent:started',
      'agent:completed',
      'agent:failed',
      'agent:message',
      'agent:tool:call',
    ],
    systemEvents: ['workspace:opened', 'workspace:closed', 'git:commit', 'git:push', 'git:pull'],
    errors: ['error:file', 'error:git', 'error:agent', 'error:system'],
  };

  // Date range options
  const dateRangeOptions = [
    { value: 'all', label: 'All Time' },
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'week', label: 'Last 7 Days' },
    { value: 'month', label: 'Last 30 Days' },
    { value: 'custom', label: 'Custom Range' },
  ];

  // Actor filter options (populated dynamically)
  let actorOptions = $state([
    { value: 'all', label: 'All Actors' },
    { value: 'user', label: 'User' },
    { value: 'agent', label: 'Agents' },
    { value: 'system', label: 'System' },
  ]);

  // Apply filters
  function applyFilters() {
    onfilter?.(filters);
  }

  // Reset filters
  function resetFilters() {
    filters = {
      showFileChanges: true,
      showAgentActivity: true,
      showSystemEvents: true,
      showErrors: true,
      searchQuery: '',
      dateRange: 'all',
      actorFilter: 'all',
    };
    applyFilters();
  }

  // Save current filters as preset
  function savePreset() {
    const name = prompt('Enter preset name:');
    if (name) {
      appStore.dispatch(saveActivityLogPreset({ name, filters: { ...filters } }));
    }
  }

  // Load preset
  function loadPreset(preset: ActivityLogPresetPreference) {
    filters = { ...preset.filters };
    applyFilters();
  }

  // Delete preset
  function deletePreset(index: number) {
    appStore.dispatch(deleteActivityLogPreset(index));
  }

  // Auto-apply filters on change
  $effect(() => {
    applyFilters();
  });
</script>

<div class="p-4 bg-background border-b border-border">
  <!-- Quick Filters -->
  <div class="flex gap-4 items-center mb-2">
    <label class="flex items-center gap-1 cursor-pointer select-none">
      <input type="checkbox" bind:checked={filters.showFileChanges} class="cursor-pointer" />
      <span class="text-sm">File Changes</span>
    </label>

    <label class="flex items-center gap-1 cursor-pointer select-none">
      <input type="checkbox" bind:checked={filters.showAgentActivity} class="cursor-pointer" />
      <span class="text-sm">Agent Activity</span>
    </label>

    <label class="flex items-center gap-1 cursor-pointer select-none">
      <input type="checkbox" bind:checked={filters.showSystemEvents} class="cursor-pointer" />
      <span class="text-sm">System Events</span>
    </label>

    <label class="flex items-center gap-1 cursor-pointer select-none">
      <input type="checkbox" bind:checked={filters.showErrors} class="cursor-pointer" />
      <span class="text-sm">Errors</span>
    </label>

    <button
      class="bg-transparent border-none text-primary cursor-pointer text-sm px-2 py-1 ml-auto hover:underline"
      onclick={() => (showAdvanced = !showAdvanced)}
    >
      {showAdvanced ? 'Hide' : 'Show'} Advanced
    </button>
  </div>

  <!-- Search Bar -->
  <div class="relative mt-2">
    <input
      type="text"
      placeholder="Search activity..."
      bind:value={filters.searchQuery}
      class="w-full p-2 pr-8 border border-border rounded text-sm"
    />
    {#if filters.searchQuery}
      <button
        class="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none text-subtle cursor-pointer text-xl p-1"
        onclick={() => (filters.searchQuery = '')}
      >
        ×
      </button>
    {/if}
  </div>

  <!-- Advanced Filters -->
  {#if showAdvanced}
    <div class="mt-4 pt-4 border-t border-border" transition:slide={{ duration: 200 }}>
      <!-- Date Range -->
      <div class="flex items-center gap-2 mb-3">
        <label for="date-range" class="text-sm min-w-[100px]">Date Range:</label>
        <select
          id="date-range"
          bind:value={filters.dateRange}
          class="flex-1 px-2 py-1 border border-border rounded text-sm"
        >
          {#each dateRangeOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <!-- Actor Filter -->
      <div class="flex items-center gap-2 mb-3">
        <label for="actor-filter" class="text-sm min-w-[100px]">Actor:</label>
        <select
          id="actor-filter"
          bind:value={filters.actorFilter}
          class="flex-1 px-2 py-1 border border-border rounded text-sm"
        >
          {#each actorOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <!-- Filter Presets -->
      <div class="mt-4 p-3 bg-muted rounded">
        <div class="flex justify-between items-center mb-2">
          <span class="text-sm font-medium">Presets:</span>
          <button
            class="px-2 py-1 text-xs bg-primary text-primary-foreground border-none rounded cursor-pointer"
            onclick={savePreset}
          >
            Save Current
          </button>
        </div>

        {#if $activityLogPresets$.length > 0}
          <div class="flex flex-col gap-1">
            {#each $activityLogPresets$ as preset, i (`preset-${i}-${preset.name}`)}
              <div class="flex justify-between items-center">
                <button
                  class="flex-1 text-left px-2 py-1 bg-transparent border border-transparent rounded cursor-pointer text-sm hover:bg-background hover:border-border"
                  onclick={() => loadPreset(preset)}
                >
                  {preset.name}
                </button>
                <button
                  class="bg-transparent border-none text-subtle cursor-pointer text-base p-1"
                  onclick={() => deletePreset(i)}
                >
                  ×
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <div class="text-sm text-subtle text-center p-2">No saved presets</div>
        {/if}
      </div>

      <!-- Actions -->
      <div class="mt-4 flex justify-end">
        <button
          class="px-4 py-2 bg-muted border border-border rounded cursor-pointer text-sm hover:bg-background"
          onclick={resetFilters}
        >
          Reset All
        </button>
      </div>
    </div>
  {/if}
</div>
