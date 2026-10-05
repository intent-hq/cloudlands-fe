<script lang="ts">
  import { onDestroy } from 'svelte';
  import PanelLayout from '../../PanelLayout.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    clearPanelLayout,
    initializeLayout,
    openTab,
    setRestoreStatus,
    setPanelColumnCount,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    selectPanelColumnCount,
    selectFocusedPanelId,
    selectPanelIds,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';

  const WORKSPACE_ID = 'rightmost-column-selector-production';
  const initialTab = {
    id: 'initial-note-tab',
    type: 'note' as const,
    title: 'Release plan',
    noteId: 'note-initial',
    workspaceId: WORKSPACE_ID,
    closable: true,
  };

  appStore.init();
  appStore.dispatch(clearPanelLayout(WORKSPACE_ID));
  appStore.dispatch(
    initializeLayout(WORKSPACE_ID, {
      root: { type: 'panel', panelId: 'initial-panel' },
      panels: {
        'initial-panel': {
          id: 'initial-panel',
          tabs: [initialTab],
          activeTabId: initialTab.id,
        },
      },
      focusedPanelId: 'initial-panel',
      columnCount: 1,
      canvasWidth: 1200,
    }),
  );
  appStore.dispatch(setRestoreStatus(WORKSPACE_ID, 'restored'));

  let availableCanvasWidth = $state<number | undefined>();

  const panelIds$ = selectPanelIds(WORKSPACE_ID);
  const columnCount$ = selectPanelColumnCount(WORKSPACE_ID);
  const focusedPanelId$ = selectFocusedPanelId(WORKSPACE_ID);

  function addColumn() {
    if ($columnCount$ >= 4) return;
    appStore.dispatch(
      setPanelColumnCount(WORKSPACE_ID, $columnCount$ + 1, undefined, availableCanvasWidth),
    );
  }

  function populateRightmostPanel() {
    const panelId = selectPanelIds.select(appStore.state, WORKSPACE_ID).at(-1);
    if (!panelId) return;
    appStore.dispatch(
      openTab(
        WORKSPACE_ID,
        {
          type: 'note',
          title: 'Populated panel',
          noteId: 'note-populated',
          workspaceId: WORKSPACE_ID,
          closable: true,
        },
        panelId,
        'populated-note-tab',
        true,
        100,
      ),
    );
  }

  onDestroy(() => appStore.dispatch(clearPanelLayout(WORKSPACE_ID)));
</script>

<!-- Drive the production column-count action without depending on a header menu entry. -->
<button data-testid="add-column-fixture" onclick={addColumn} disabled={$columnCount$ >= 4}>
  Add column
</button>
<button class="sr-only" data-testid="populate-rightmost-panel" onclick={populateRightmostPanel}>
  Populate rightmost panel
</button>
<output
  class="sr-only"
  data-testid="panel-layout-state"
  data-panel-ids={$panelIds$.join(',')}
  data-column-count={$columnCount$}
  data-focused-panel-id={$focusedPanelId$}
></output>

<div class="overflow-hidden rounded-lg bg-sidebar" style="height: 420px; width: 1200px;">
  <PanelLayout
    workspaceId={WORKSPACE_ID}
    layoutId={WORKSPACE_ID}
    onAvailableCanvasWidthChange={(width) => (availableCanvasWidth = width)}
    contained
    canvasSizing="content"
    allowCloseLastPanel
  />
</div>
