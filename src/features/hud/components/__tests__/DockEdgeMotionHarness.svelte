<script lang="ts">
  import DockEdgeConversation, {
    type DockEdgeConversationState,
  } from '../DockEdgeConversation.svelte';
  import { adaptiveDockFixture } from '../dock-rail.preview-fixtures';
  import type { DockPointerRect } from '$shared/dock-layout';

  let { open = false }: { open?: boolean } = $props();
  let edgeState = $state<DockEdgeConversationState>({ held: false, reveal: 0, shell: null });
  let regions = $state<DockPointerRect[]>([]);
  const placement = {
    ...adaptiveDockFixture('edge', 'right'),
    windowBounds: { x: 0, y: 0, width: 640, height: 600 },
    sidePanel: { x: 40, y: 60, width: 400, height: 420 },
  };
</script>

<section
  data-testid="edge-motion-host"
  data-state={JSON.stringify(edgeState)}
  data-regions={JSON.stringify(regions)}
  style="position:relative;width:640px;height:600px"
>
  <DockEdgeConversation
    {open}
    workspaceId="motion-proof"
    {placement}
    shown={{ x: 580, y: 80, width: 40, height: 240 }}
    onStateChange={(value) => (edgeState = value)}
    onRegionsChange={(value) => (regions = value)}
  >
    <p>Unsaved conversation stays mounted during reversal.</p>
  </DockEdgeConversation>
</section>
