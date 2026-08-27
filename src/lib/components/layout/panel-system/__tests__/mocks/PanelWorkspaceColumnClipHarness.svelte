<script lang="ts">
  import PanelLayout from '../../PanelLayout.svelte';
  import { CONTAINED_PANEL_INLINE_CHROME } from '$shared/panel-layout-sizing';
  import { store as appStore } from '$store/renderer/store';
  import {
    closePanel,
    initializeLayout,
    openTabInAdjacentOrSplit,
    openTabInNewRootColumn,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    selectPanelCanvasWidth,
    selectPanelCanvasWidthSource,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import type { PanelTabType } from '$store/renderer/slices/panel-layout/panel-layout-types';

  appStore.init();

  let {
    mode = 'contained',
    direction = 'horizontal',
    sidebarWidth = 360,
    canvasWidth = 800,
    persistedCanvasWidth = 800,
    insetChrome = CONTAINED_PANEL_INLINE_CHROME,
    scenario = 'pair',
    zoomFactor = 1,
    panelTypes = null,
    panelSizes = null,
    pristine = false,
    followPersistedCanvas = false,
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
    scenario?: 'pair' | 'create-agent' | 'reuse-agent' | 'restore-agent';
    zoomFactor?: number;
    panelTypes?: PanelTabType[] | null;
    panelSizes?: number[] | null;
    pristine?: boolean;
    followPersistedCanvas?: boolean;
  } = $props();

  let widthAdjustment = $state(0);
  let layoutMountKey = $state(0);
  const LAYOUT_ID = `column-clip-check-${scenario}-${panelTypes?.join('-') ?? 'default'}`;
  const layoutCanvasWidth$ = selectPanelCanvasWidth(LAYOUT_ID);
  const layoutCanvasWidthSource$ = selectPanelCanvasWidthSource(LAYOUT_ID);
  const agentTab = {
    type: 'agent' as const,
    title: 'Ada',
    agentId: 'agent-1',
    workspaceId: LAYOUT_ID,
    closable: true,
  };
  const startsWithAgent = scenario === 'restore-agent';
  const startsWithPair = scenario === 'pair' || panelTypes !== null;
  const initialPanelCount = panelTypes?.length ?? (startsWithPair ? 2 : 1);
  const initialPanelIds = Array.from({ length: initialPanelCount }, (_, index) => `p${index + 1}`);

  appStore.dispatch(
    initializeLayout(LAYOUT_ID, {
      root: startsWithPair
        ? {
            type: 'split',
            direction,
            sizes: panelSizes ?? initialPanelIds.map(() => 100 / initialPanelCount),
            children: initialPanelIds.map((panelId) => ({
              type: 'panel' as const,
              panelId,
            })),
          }
        : { type: 'panel', panelId: 'p1' },
      panels: Object.fromEntries(
        initialPanelIds.map((panelId, index) => {
          const type = panelTypes?.[index];
          const tabId = `${panelId}-tab`;
          if (type) {
            return [
              panelId,
              {
                id: panelId,
                tabs: [{ ...agentTab, id: tabId, type, title: type }],
                activeTabId: tabId,
              },
            ];
          }
          if (startsWithAgent && index === 0) {
            return [
              panelId,
              {
                id: panelId,
                tabs: [{ ...agentTab, id: 'agent-tab' }],
                activeTabId: 'agent-tab',
              },
            ];
          }
          return [
            panelId,
            { id: panelId, tabs: [], activeTabId: null, pristine: pristine || undefined },
          ];
        }),
      ),
      focusedPanelId: 'p1',
      ...(persistedCanvasWidth !== null ? { canvasWidth: persistedCanvasWidth } : {}),
    }),
  );
  appStore.dispatch(setRestoreStatus(LAYOUT_ID, 'restored'));
  if (scenario === 'reuse-agent') {
    appStore.dispatch(openTabInAdjacentOrSplit(LAYOUT_ID, agentTab, 'p1', { force: true }, 10));
  }

  function createAgentPanel() {
    appStore.dispatch(openTabInNewRootColumn(LAYOUT_ID, agentTab, { force: true }, 10));
  }

  function closeFirstPanel() {
    appStore.dispatch(closePanel(LAYOUT_ID, 'p1'));
  }

  const outerCanvasWidth = $derived(
    followPersistedCanvas ? ($layoutCanvasWidth$ ?? canvasWidth) : canvasWidth,
  );
  const stackWidth = $derived(sidebarWidth + outerCanvasWidth + insetChrome + widthAdjustment);
</script>

<button data-testid="width-minus-one" class="sr-only" onclick={() => (widthAdjustment = -1)}>
  Narrow
</button>
<button data-testid="width-at-threshold" class="sr-only" onclick={() => (widthAdjustment = 0)}>
  Exact
</button>
<button data-testid="width-plus-one" class="sr-only" onclick={() => (widthAdjustment = 1)}>
  Wide
</button>
<button data-testid="reload-panel-layout" class="sr-only" onclick={() => (layoutMountKey += 1)}>
  Reload
</button>
<button data-testid="close-first-panel" class="sr-only" onclick={closeFirstPanel}>Close</button>

{#if scenario === 'create-agent'}
  <button data-testid="create-agent-panel" class="sr-only" onclick={createAgentPanel}>
    Create
  </button>
{/if}

{#if mode === 'contained'}
  <!-- Mirrors the contained workspace shell: fixed sidebar + flex-1 PanelLayout. -->
  <div
    data-testid="panel-column"
    data-scenario={scenario}
    data-persisted-canvas-width={$layoutCanvasWidth$ ?? 'null'}
    data-canvas-width-source={$layoutCanvasWidthSource$ ?? 'null'}
    style:width={`${stackWidth}px`}
    style:zoom={zoomFactor}
    class="h-96 shrink-0 overflow-hidden rounded-md bg-sidebar"
  >
    <div class="flex h-full min-h-0">
      <div
        style:width={`${sidebarWidth}px`}
        class="h-full flex-none"
        data-testid="column-sidebar"
      ></div>
      <div class="flex h-full min-w-0 flex-1" data-testid="column-content">
        {#key layoutMountKey}
          <PanelLayout
            workspaceId={LAYOUT_ID}
            layoutId={LAYOUT_ID}
            contained
            canvasSizing="content"
            allowCloseLastPanel
          />
        {/key}
      </div>
    </div>
  </div>
{:else}
  <!-- Mirrors tab view: app frame row (pl-2) > fixed sidebar > flex-1 content
       > uncontained PanelLayout (viewport sizing, overflow-x-auto inset). -->
  <div
    data-testid="panel-column"
    data-scenario={scenario}
    data-persisted-canvas-width={$layoutCanvasWidth$ ?? 'null'}
    data-canvas-width-source={$layoutCanvasWidthSource$ ?? 'null'}
    style:width={`${stackWidth}px`}
    style:zoom={zoomFactor}
    class="flex h-96 min-h-0 shrink-0 overflow-hidden pl-2"
  >
    <div
      style:width={`${sidebarWidth}px`}
      class="h-full flex-none"
      data-testid="column-sidebar"
    ></div>
    <div class="flex h-full min-w-0 flex-1" data-testid="column-content">
      {#key layoutMountKey}
        <PanelLayout
          workspaceId={LAYOUT_ID}
          layoutId={LAYOUT_ID}
          canvasSizing="viewport"
          allowCloseLastPanel
        />
      {/key}
    </div>
  </div>
{/if}
