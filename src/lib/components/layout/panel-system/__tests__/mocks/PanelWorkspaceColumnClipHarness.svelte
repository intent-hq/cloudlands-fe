<script lang="ts">
  import PanelLayout from '../../PanelLayout.svelte';
  import { CONTAINED_PANEL_INLINE_CHROME } from '$shared/panel-layout-sizing';
  import { store as appStore } from '$store/renderer/store';
  import {
    initializeLayout,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  appStore.init();

  let {
    mode = 'contained',
    direction = 'horizontal',
    sidebarWidth = 360,
    canvasWidth = 800,
    persistedCanvasWidth = 800,
    insetChrome = CONTAINED_PANEL_INLINE_CHROME,
  }: {
    mode?: 'contained' | 'uncontained';
    /** Root split direction: horizontal columns or a vertical stack. */
    direction?: 'horizontal' | 'vertical';
    sidebarWidth?: number;
    /** Content width the outer column reserves for the panel canvas. */
    canvasWidth?: number;
    /** Persisted (explicit) canvas width in Redux; null = automatic. */
    persistedCanvasWidth?: number | null;
    /** Extra column width reserved for the contained inset padding
     *  (CONTAINED_PANEL_INLINE_CHROME in production). */
    insetChrome?: number;
  } = $props();

  const LAYOUT_ID = 'column-clip-check';

  appStore.dispatch(
    initializeLayout(LAYOUT_ID, {
      root: {
        type: 'split',
        direction,
        sizes: [50, 50],
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
        ],
      },
      panels: {
        p1: { id: 'p1', tabs: [], activeTabId: null },
        p2: { id: 'p2', tabs: [], activeTabId: null },
      },
      focusedPanelId: 'p1',
      ...(persistedCanvasWidth !== null ? { canvasWidth: persistedCanvasWidth } : {}),
    }),
  );
  appStore.dispatch(setRestoreStatus(LAYOUT_ID, 'restored'));

  const stackWidth = $derived(sidebarWidth + canvasWidth + insetChrome);
</script>

{#if mode === 'contained'}
  <!-- Mirrors WorkspaceColumnsView: column div (stackWidth) > section (overflow-hidden)
       > WorkspaceLayout row (fixed sidebar + flex-1 content) > PanelLayout. -->
  <div
    data-testid="workspace-column"
    style:width={`${stackWidth}px`}
    class="h-96 shrink-0 overflow-hidden rounded-md bg-sidebar"
  >
    <div class="flex h-full min-h-0">
      <div
        style:width={`${sidebarWidth}px`}
        class="h-full flex-none"
        data-testid="column-sidebar"
      ></div>
      <div class="flex h-full min-w-0 flex-1" data-testid="column-content">
        <PanelLayout
          workspaceId={LAYOUT_ID}
          layoutId={LAYOUT_ID}
          contained
          canvasSizing="content"
          allowCloseLastPanel
        />
      </div>
    </div>
  </div>
{:else}
  <!-- Mirrors tab view: app frame row (pl-2) > fixed sidebar > flex-1 content
       > uncontained PanelLayout (viewport sizing, overflow-x-auto inset). -->
  <div
    data-testid="workspace-column"
    style:width={`${stackWidth}px`}
    class="flex h-96 min-h-0 shrink-0 overflow-hidden pl-2"
  >
    <div
      style:width={`${sidebarWidth}px`}
      class="h-full flex-none"
      data-testid="column-sidebar"
    ></div>
    <div class="flex h-full min-w-0 flex-1" data-testid="column-content">
      <PanelLayout
        workspaceId={LAYOUT_ID}
        layoutId={LAYOUT_ID}
        canvasSizing="viewport"
        allowCloseLastPanel
      />
    </div>
  </div>
{/if}
