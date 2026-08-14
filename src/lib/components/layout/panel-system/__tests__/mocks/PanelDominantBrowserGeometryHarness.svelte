<script lang="ts">
  import PanelContainer from '../../PanelContainer.svelte';
  import type { PanelLayoutNode } from '$features/layout/panel-layout-adapter';
  import { store as appStore } from '$store/renderer/store';

  appStore.init();

  let {
    viewportWidth = 1600,
    sidebarWidth = 0,
    zoomFactor = 1,
    scenario = 'flat',
  }: {
    viewportWidth?: number;
    sidebarWidth?: number;
    zoomFactor?: number;
    scenario?: 'flat' | 'nested' | 'wide';
  } = $props();

  function createRoot(layout: 'flat' | 'nested' | 'wide'): PanelLayoutNode {
    const panel = (panelId: string): PanelLayoutNode => ({ type: 'panel', panelId });
    if (layout === 'nested') {
      return {
        type: 'split',
        direction: 'horizontal',
        children: [
          panel('target'),
          {
            type: 'split',
            direction: 'horizontal',
            children: [panel('sibling-1'), panel('sibling-2')],
            sizes: [50, 50],
          },
        ],
        sizes: [65, 35],
      };
    }
    const siblings = layout === 'wide' ? 4 : 1;
    return {
      type: 'split',
      direction: 'horizontal',
      children: [panel('target'), ...Array.from({ length: siblings }, (_, i) => panel(`s${i}`))],
      sizes: Array.from({ length: siblings + 1 }, () => 100 / (siblings + 1)),
    };
  }

  const root = $derived(createRoot(scenario));
  const availableWidth = $derived((viewportWidth - sidebarWidth) / zoomFactor);
  const minimumCanvasWidth = $derived(
    scenario === 'nested' ? 1076 : scenario === 'wide' ? 1652 : 788,
  );
  const canvasWidth = $derived(Math.max(minimumCanvasWidth, availableWidth));
</script>

<div data-testid="physical-viewport" style:width={`${viewportWidth}px`} class="overflow-hidden">
  <div data-testid="zoom-layer" style:zoom={zoomFactor}>
    <div
      data-testid="available-viewport"
      style:width={`${availableWidth}px`}
      class="overflow-x-auto"
    >
      <div
        data-testid="panel-workspace-inset"
        data-canvas-width={canvasWidth}
        style:width={`${canvasWidth}px`}
        class="h-48"
      >
        <PanelContainer
          node={root}
          panels={{}}
          focusedPanelId={null}
          workspaceId="browser-geometry"
          layoutId="browser-geometry"
          rootPanelReferenceSize={canvasWidth}
          dominantPanelId="target"
          suppressLayoutMotion
        />
      </div>
    </div>
  </div>
</div>
