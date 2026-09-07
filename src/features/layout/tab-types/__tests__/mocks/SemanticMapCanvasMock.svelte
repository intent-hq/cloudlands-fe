<script lang="ts">
  import type { MapActivity } from '$lib/components/visualization/semantic-map/core/types';
  import type { SemanticMapFilters } from '$lib/components/visualization/semantic-map/render/types';

  let { activities, filters }: { activities: MapActivity[]; filters: SemanticMapFilters } =
    $props();
</script>

<div
  data-testid="semantic-map-canvas"
  data-activity-count={activities.length}
  data-agent-filter={filters.agentIds?.join(',')}
  data-kind-filter={filters.kinds?.join(',')}
  aria-hidden="true"
></div>
