<script lang="ts">
  import SemanticMapCanvas from '../SemanticMapCanvas.svelte';
  import type { Manifest, MapActivity } from '../core/types';
  import type { RegionGeometry } from '../layout/place';
  import type { SemanticMapSelection } from '../render/types';

  let {
    activityFixture = false,
    width = 640,
    height = 360,
  }: { activityFixture?: boolean; width?: number; height?: number } = $props();

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
  const activities: MapActivity[] = activityFixture
    ? [
        {
          id: 'read',
          agentId: 'reading',
          agentName: 'Reading',
          regionId: 'first',
          kind: 'read',
          ts: '2026-09-06T10:19:59.800Z',
        },
        {
          id: 'edit',
          agentId: 'thinking',
          agentName: 'Thinking',
          regionId: 'second',
          kind: 'edit',
          ts: '2026-09-06T10:19:59.700Z',
        },
        {
          id: 'tool',
          agentId: 'tooling',
          agentName: 'Tooling',
          regionId: 'first',
          kind: 'tool',
          ts: '2026-09-06T10:19:59.900Z',
        },
        {
          id: 'thinking',
          agentId: 'thinking',
          agentName: 'Thinking',
          regionId: 'second',
          kind: 'thinking',
          ts: '2026-09-06T10:19:59.900Z',
        },
      ]
    : [];
  let selection = $state<SemanticMapSelection>(null);
  const firstHull: [number, number][] = [
    [180, 130],
    [205, 160],
    [280, 180],
    [205, 200],
    [180, 230],
    [160, 200],
    [125, 215],
    [145, 180],
    [125, 145],
    [160, 160],
  ];
  const rest: RegionGeometry[] = [
    { id: 'first', x: 180, y: 180, radius: 70, budget: 1, hull: firstHull },
    {
      id: 'second',
      x: 470,
      y: 180,
      radius: 60,
      budget: 1,
      hull: [
        [410, 140],
        [530, 140],
        [530, 220],
        [410, 220],
      ],
    },
  ];
  const focus: RegionGeometry[] = rest.map((region) =>
    region.id === 'first'
      ? {
          ...region,
          hull: firstHull.map(([x, y]): [number, number] => [x + Math.max(0, x - 180) * 0.5, y]),
        }
      : region,
  );
  const geometry = { rest, focus };
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
  {width}
  {height}
  onSelectRegion={(regionIds) => (selection = { type: 'region', regionIds })}
  onClearSelection={() => (selection = null)}
/>
<output
  data-testid="selected-region"
  data-region={selection?.type === 'region' ? selection.regionIds[0] : ''}
  >{selection?.type === 'region' ? selection.regionIds[0] : ''}</output
>
