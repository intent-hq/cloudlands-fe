<script lang="ts">
  import { createDockPointerRegionController } from '$features/hud/utils/dock-pointer-routing';
  import { adaptiveDockFixture } from '../dock-rail.preview-fixtures';
  import DockRail from '../DockRail.svelte';

  let {
    workspaceId = null,
    focusRequest = 0,
    hidden = false,
  }: {
    workspaceId?: string | null;
    focusRequest?: number;
    hidden?: boolean;
  } = $props();

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
    placement={{ ...adaptiveDockFixture('notch'), captureHidden: hidden }}
    conversationWorkspaceId={workspaceId}
    {focusRequest}
    onPlacementCommand={() => {}}
    {pointerController}
    staticData
    onOpenWorkspace={() => {}}
    onOpenAssistant={() => {}}
    onOpenHud={() => {}}
  >
    {#snippet conversation()}<p>Conversation draft</p>{/snippet}
  </DockRail>
</section>
