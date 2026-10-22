<script lang="ts">
  import PanelLayout from '../../PanelLayout.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    clearPanelLayout,
    initializeLayout,
    setRestoreStatus,
    setPanelColumnCount,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  import { selectPanelColumnCount } from '$store/renderer/slices/panel-layout/panel-layout-selectors';

  let {
    viewportWidth = 960,
    zoomFactor = 1,
    persistedCanvasWidth = 1800,
  }: {
    viewportWidth?: number;
    zoomFactor?: number;
    persistedCanvasWidth?: number;
  } = $props();

  appStore.init();
  // svelte-ignore state_referenced_locally - test props define immutable initial state
  const initialViewportWidth = $state.snapshot(viewportWidth);
  // svelte-ignore state_referenced_locally - test props define immutable initial state
  const initialZoomFactor = $state.snapshot(zoomFactor);
  // svelte-ignore state_referenced_locally - test props define immutable initial state
  const initialPersistedCanvasWidth = $state.snapshot(persistedCanvasWidth);
  const layoutId = `structural-column-fit-${initialViewportWidth}-${initialZoomFactor}`;
  let availableCanvasWidth = $state<number | undefined>();
  const columnCount$ = selectPanelColumnCount(layoutId);

  function addColumn() {
    if ($columnCount$ >= 4) return;
    appStore.dispatch(
      setPanelColumnCount(layoutId, $columnCount$ + 1, undefined, availableCanvasWidth),
    );
  }

  appStore.dispatch(clearPanelLayout(layoutId));
  appStore.dispatch(
    initializeLayout(layoutId, {
      root: { type: 'panel', panelId: 'p1' },
      panels: {
        p1: { id: 'p1', tabs: [], activeTabId: null, pristine: true },
      },
      focusedPanelId: 'p1',
      columnCount: 1,
      canvasWidth: initialPersistedCanvasWidth,
      canvasWidthSource: 'explicit',
    }),
  );
  appStore.dispatch(setRestoreStatus(layoutId, 'restored'));
</script>

<!-- Keep the structural column-count contract separate from the split-panel shortcut. -->
<button data-testid="add-column-fixture" onclick={addColumn} disabled={$columnCount$ >= 4}>
  Add column
</button>
<div
  data-testid="structural-column-viewport"
  style:width={`${viewportWidth / zoomFactor}px`}
  style:zoom={zoomFactor}
  class="h-96 overflow-hidden"
>
  <PanelLayout
    workspaceId={layoutId}
    {layoutId}
    canvasSizing="viewport"
    onAvailableCanvasWidthChange={(width) => (availableCanvasWidth = width)}
  />
</div>
