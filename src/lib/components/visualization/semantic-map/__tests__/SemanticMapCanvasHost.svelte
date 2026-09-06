<script lang="ts">
  import SemanticMapCanvas from '../SemanticMapCanvas.svelte';
  import type { Manifest, MapActivity } from '../core/types';
  import { computeBudget } from '../layout/budget';
  import { placeRegions } from '../layout/place';
  import type { SemanticMapSelection } from '../render/types';

  const manifest: Manifest = {
    version: 1,
    regions: [
      {
        id: 'first',
        label: 'First',
        responsibility: 'First region',
        anchor: [0.25, 0.5],
        paths: ['a/**'],
      },
      {
        id: 'second',
        label: 'Second',
        responsibility: 'Second region',
        anchor: [0.75, 0.5],
        paths: ['b/**'],
      },
    ],
  };
  const activities: MapActivity[] = [];
  let selection = $state<SemanticMapSelection>(null);
  const rest = placeRegions(manifest, computeBudget(manifest), { width: 640, height: 360 });
  const geometry = { rest, focus: rest };
  const timeWindow = { start: '2026-09-06T10:00:00.000Z', end: '2026-09-06T10:20:00.000Z' };
</script>

<button type="button" data-testid="before-map">Before map</button>
<SemanticMapCanvas
  {manifest}
  {geometry}
  {activities}
  {selection}
  filters={{}}
  {timeWindow}
  width={640}
  height={360}
  onSelectRegion={(regionIds) => (selection = { type: 'region', regionIds })}
  onClearSelection={() => (selection = null)}
/>
<output
  data-testid="selected-region"
  data-region={selection?.type === 'region' ? selection.regionIds[0] : ''}
  >{selection?.type === 'region' ? selection.regionIds[0] : ''}</output
>
