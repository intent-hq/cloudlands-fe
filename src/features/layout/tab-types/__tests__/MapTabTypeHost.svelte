<script lang="ts">
  import { store } from '$store/renderer/store';
  import {
    semanticMapHydrated,
    semanticMapLoadStarted,
  } from '$store/renderer/slices/semantic-map/semantic-map-slice';
  import { SEMANTIC_MAP_FIXTURE_MANIFEST } from '$lib/components/visualization/semantic-map/core/fixtures';
  import MapTabType from '../MapTabType.svelte';

  let { width }: { width: number } = $props();
  const workspaceId = `compact-map-${width}`;
  const tab = { id: 'map', type: 'map' as const, title: 'Map', closable: true };

  store.dispatch(semanticMapLoadStarted(workspaceId, 1));
  store.dispatch(
    semanticMapHydrated(workspaceId, 1, SEMANTIC_MAP_FIXTURE_MANIFEST, 'curated', [], []),
  );
</script>

<div style={`width: ${width}px; height: 700px; container: panel / size;`}>
  <MapTabType {tab} {workspaceId} isActive isPanelFocused />
</div>
