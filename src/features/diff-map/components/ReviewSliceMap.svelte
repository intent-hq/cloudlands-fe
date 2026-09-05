<script lang="ts">
  import type { DiffMapDensityRung } from '../layout/layout-diff-map';
  import type { DiffMapDocument, DiffMapFile } from '../model/types';
  import type { DiffMapLayers } from './DiffMapRow.svelte';
  import DiffMap from './DiffMap.svelte';
  import ReviewSliceAction from './ReviewSliceAction.svelte';

  interface Props {
    workspaceId: string;
    document: DiffMapDocument;
    activePath?: string;
    layers?: DiffMapLayers;
    rungOverride?: DiffMapDensityRung;
    onOpen: (file: DiffMapFile, event: MouseEvent | KeyboardEvent) => void;
  }

  let { workspaceId, document, activePath, layers, rungOverride = 2, onOpen }: Props = $props();
  let selection = $state(new Set<string>());
</script>

<div class="flex size-full min-w-0 flex-col overflow-hidden rounded border border-border">
  <div class="flex h-8 shrink-0 items-center justify-end border-b border-border px-1">
    <ReviewSliceAction {workspaceId} {document} {selection} />
  </div>
  <div class="min-h-0 flex-1">
    <DiffMap
      {document}
      bind:selection
      {layers}
      {activePath}
      {rungOverride}
      filterable={false}
      {onOpen}
    />
  </div>
</div>
