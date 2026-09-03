<script lang="ts">
  import ActivityLogFilters from './ActivityLogFilters.svelte';

  interface Filters {
    showFileChanges: boolean;
    showAgentActivity: boolean;
    showSystemEvents: boolean;
    showErrors: boolean;
    searchQuery: string;
    dateRange: string;
    actorFilter: string;
  }

  let filters = $state<Filters>({
    showFileChanges: true,
    showAgentActivity: true,
    showSystemEvents: true,
    showErrors: true,
    searchQuery: '',
    dateRange: 'all',
    actorFilter: 'all',
  });
</script>

<ActivityLogFilters bind:filters />
<output data-testid="filters">{JSON.stringify(filters)}</output>
