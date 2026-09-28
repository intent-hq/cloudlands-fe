<script lang="ts">
  import { onDestroy } from 'svelte';
  import PanelLayout from '../../PanelLayout.svelte';
  import { store } from '$store/renderer/store';
  import {
    clearPanelLayout,
    initializeLayout,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    selectPanelLayoutWorkspace,
    selectPanelColumnCount,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';

  const workspaceId = 'vertical-movement-browser';
  let { lone = false }: { lone?: boolean } = $props();
  let generation = $state(0);
  store.init();
  store.dispatch(clearPanelLayout(workspaceId));
  const tabs = ['alpha', ...(lone ? [] : ['beta', 'gamma'])].map((id) => ({
    id,
    type: 'note' as const,
    title: id,
    noteId: id,
    workspaceId,
    closable: true,
  }));
  store.dispatch(
    initializeLayout(workspaceId, {
      root: { type: 'panel', panelId: 'source' },
      panels: { source: { id: 'source', tabs, activeTabId: 'alpha' } },
      focusedPanelId: 'source',
      canvasWidth: 900,
    }),
  );
  store.dispatch(setRestoreStatus(workspaceId, 'restored'));
  const layout$ = selectPanelLayoutWorkspace(workspaceId);
  const columnCount$ = selectPanelColumnCount(workspaceId);

  function restore() {
    const saved = JSON.parse(
      JSON.stringify(selectPanelLayoutWorkspace.select(store.state, workspaceId)),
    );
    store.dispatch(clearPanelLayout(workspaceId));
    store.dispatch(initializeLayout(workspaceId, saved));
    store.dispatch(setRestoreStatus(workspaceId, 'restored'));
    generation += 1;
  }
  onDestroy(() => store.dispatch(clearPanelLayout(workspaceId)));
</script>

<button data-testid="restore-layout" class="sr-only" onclick={restore}>Restore saved layout</button>
<output data-testid="vertical-layout-state" class="sr-only" data-columns={$columnCount$}>
  {JSON.stringify($layout$)}
</output>
<div style="width: 900px; height: 700px;" class="bg-sidebar">
  {#key generation}
    <PanelLayout {workspaceId} contained canvasSizing="content" allowCloseLastPanel />
  {/key}
</div>
