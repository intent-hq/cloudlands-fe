<script lang="ts">
  import SemanticMapCanvas from '../SemanticMapCanvas.svelte';
  import type { Manifest, MapActivity, Route } from '../core/types';
  import type { RegionGeometry } from '../layout/place';
  import type { SemanticMapSelection } from '../render/types';

  let {
    activityFixture = false,
    compareFixture = false,
    routeFixture = false,
    width = 640,
    height = 360,
  }: {
    activityFixture?: boolean;
    compareFixture?: boolean;
    routeFixture?: boolean;
    width?: number;
    height?: number;
  } = $props();

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
  const activities = $derived.by<MapActivity[]>(() =>
    activityFixture
      ? [
          {
            id: 'read',
            agentId: 'reading',
            agentName: 'Reading',
            regionId: 'first',
            path: 'src/read.ts',
            kind: 'read',
            ts: '2026-09-06T10:19:59.800Z',
          },
          {
            id: 'edit',
            agentId: 'thinking',
            agentName: 'Thinking',
            regionId: 'second',
            path: 'src/edit.ts',
            kind: 'edit',
            ts: '2026-09-06T10:19:59.700Z',
          },
          {
            id: 'tool',
            agentId: 'tooling',
            agentName: 'Tooling',
            regionId: 'first',
            path: 'src/tool.ts',
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
          ...(compareFixture
            ? [
                {
                  id: 'shared-edit',
                  agentId: 'thinking',
                  agentName: 'Thinking',
                  regionId: 'first',
                  path: 'src/shared.ts',
                  kind: 'edit' as const,
                  ts: '2026-09-06T10:19:59.600Z',
                },
                {
                  id: 'shared-read',
                  agentId: 'reading',
                  agentName: 'Reading',
                  regionId: 'second',
                  path: 'src/shared-read.ts',
                  kind: 'read' as const,
                  ts: '2026-09-06T10:19:59.650Z',
                },
              ]
            : []),
        ]
      : [],
  );
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
    { id: 'first', x: 180, y: 180, radius: 70, budget: 1, hull: firstHull },
  ];
  const focus: RegionGeometry[] = rest.map((region) =>
    region.id === 'first' && routeFixture
      ? { ...region, y: region.y + 120, hull: region.hull.map(([x, y]) => [x, y + 120]) }
      : region.id === 'first'
        ? {
            ...region,
            hull: firstHull.map(([x, y]): [number, number] => [x + Math.max(0, x - 180) * 0.5, y]),
          }
        : region,
  );
  const geometry = { rest, focus };
  const route = $derived.by<Route | undefined>(() =>
    routeFixture
      ? {
          visits: ['first', 'second'],
          transitions: [{ from: 'first', to: 'second', count: 1, evidence: ['src/example.ts'] }],
        }
      : undefined,
  );
  let openedFile = $state('');
  let openedDiff = $state('');
  const timeWindow = { start: '2026-09-06T10:00:00.000Z', end: '2026-09-06T10:20:00.000Z' };
</script>

<button type="button" data-testid="before-map">Before map</button>
<SemanticMapCanvas
  {manifest}
  {geometry}
  {activities}
  routes={route ? [{ agentId: 'reading', route }] : []}
  {selection}
  filters={{}}
  {timeWindow}
  {width}
  {height}
  onSelectRegion={(regionIds) => (selection = { type: 'region', regionIds })}
  onSelectAgent={(agentId, additive) => {
    const current = selection?.type === 'agent' ? selection.agentIds : [];
    selection = {
      type: 'agent',
      agentIds: additive ? [...new Set([...current, agentId])] : [agentId],
      pinnedRegionIds:
        selection?.type === 'region' ? selection.regionIds : selection?.pinnedRegionIds,
    };
  }}
  onSelectRoute={(agentId, transitionIndex) =>
    (selection = { type: 'route', agentId, transitionIndex })}
  onOpenFile={(path) => (openedFile = path)}
  onOpenDiff={(path) => (openedDiff = path)}
  onClearSelection={() => (selection = null)}
/>
<output
  data-testid="selected-region"
  data-region={selection?.type === 'region' ? selection.regionIds[0] : ''}
  >{selection?.type === 'region' ? selection.regionIds[0] : ''}</output
>
<output
  data-testid="selected-route"
  data-selected={selection?.type === 'route'}
  data-transition-index={selection?.type === 'route' ? selection.transitionIndex : undefined}
></output>
<output
  data-testid="selected-agent"
  data-agent={selection?.type === 'agent' ? selection.agentIds.join(',') : ''}
></output>
<output data-testid="opened-file">{openedFile}</output>
<output data-testid="opened-diff">{openedDiff}</output>
