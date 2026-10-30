<script lang="ts">
  import { createDockPointerRegionController } from '$features/hud/utils/dock-pointer-routing';
  import { adaptiveDockFixture } from '../dock-rail.preview-fixtures';
  import DockRail from '../DockRail.svelte';

  // Main's presence report is the only hover signal here: the real controller listens
  // on a fake bridge, and the spec emits through window.__dockPresence.
  // eslint-disable-next-line intent/no-component-async-data-fetch -- fake IPC boundary for the presence fixture; no domain data
  const pointerController = createDockPointerRegionController({
    invoke: async () => undefined,
    on: (_channel, callback) => {
      (window as unknown as { __dockPresence: typeof callback }).__dockPresence = callback;
      return 'presence-listener';
    },
    offById: () => {},
  });
</script>

<section data-testid="dock-presence-boundary" style="height: 600px; width: 640px">
  <DockRail
    workspaces={[]}
    viewportHeight={600}
    placement={adaptiveDockFixture('notch')}
    onPlacementCommand={() => {}}
    {pointerController}
    staticData
    onOpenWorkspace={() => {}}
    onOpenAssistant={() => {}}
    onOpenHud={() => {}}
  />
</section>
