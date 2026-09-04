<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export interface WorkspaceTabStripGeometryPreviewProps {
    activeWorkspaceId?: string;
    initialOpenWorkspaceIds?: string[];
    interactive?: boolean;
    sidebarPanelOpen?: boolean;
  }

  const ids = ['geometry-alpha', 'geometry-beta', 'geometry-gamma'];

  export const preview = definePreview<WorkspaceTabStripGeometryPreviewProps>({
    id: 'workspace-tab-strip-geometry',
    title: 'Workspace tab-strip geometry',
    defaultState: 'first-tab',
    states: {
      'first-tab': { props: { activeWorkspaceId: ids[0] } },
      'middle-tab': { props: { activeWorkspaceId: ids[1] } },
      'open-close': { props: { initialOpenWorkspaceIds: ids.slice(0, 2), interactive: true } },
      'sidebar-closed': { props: { activeWorkspaceId: ids[0], sidebarPanelOpen: false } },
      'sidebar-open': { props: { activeWorkspaceId: ids[0], sidebarPanelOpen: true } },
    },
  });
</script>

<script lang="ts">
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { Button } from '$lib/components/ui/button';
  import IntentNavigationIcon from '$lib/icons/IntentNavigationIcon.svelte';
  import { store } from '$store/renderer/configured-store';
  import {
    closeWorkspaceTab,
    loadWorkspaceTabsState,
    openWorkspaceTab,
  } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    TITLEBAR_LEFT_DRAG_SURFACE_CLASS,
    getWorkspaceTabBorderMaskImage,
    getWorkspaceTabLeadingInsetPx,
    getWorkspaceTabScrollerMarginLeftPx,
    WINDOW_TITLEBAR_HEIGHT_PX,
    WORKSPACE_TAB_MOTION_DURATION_MS,
    WORKSPACE_TAB_MOTION_EASING,
    type WorkspaceTabBorderMaskBounds,
  } from './titlebar-geometry';
  import WorkspaceTabStrip from './WorkspaceTabStrip.svelte';

  const timestamp = '2026-09-01T12:00:00.000Z';
  let {
    activeWorkspaceId,
    initialOpenWorkspaceIds = ids,
    interactive = false,
    sidebarPanelOpen = true,
  }: WorkspaceTabStripGeometryPreviewProps = $props();
  let activeTabBounds = $state<WorkspaceTabBorderMaskBounds | null>(null);
  let activeTabTracking = $state(false);
  const leadingInsetPx = $derived(getWorkspaceTabLeadingInsetPx(sidebarPanelOpen));
  const scrollerMarginLeftPx = $derived(getWorkspaceTabScrollerMarginLeftPx(sidebarPanelOpen));

  for (const [index, id] of ids.entries()) {
    const workspace: Workspace = {
      id: WorkspaceId(id),
      title: `Geometry workspace ${index + 1}`,
      branch: `geometry-${index + 1}`,
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.dispatch(setWorkspaceEntity(workspace));
  }
  function initializeTabs() {
    store.dispatch(
      loadWorkspaceTabsState({
        openTabs: initialOpenWorkspaceIds,
        currentTabId: activeWorkspaceId ?? initialOpenWorkspaceIds.at(-1) ?? null,
        pinnedTabs: [],
        unsavedTabs: [],
        optimisticTabs: [],
        tabOrder: initialOpenWorkspaceIds,
      }),
    );
  }

  initializeTabs();
</script>

<div
  class="window-title-bar-wrapper"
  style:height="{WINDOW_TITLEBAR_HEIGHT_PX}px"
  data-titlebar-geometry-root
>
  <div class="window-title-bar" style:height="{WINDOW_TITLEBAR_HEIGHT_PX}px">
    <div class={TITLEBAR_LEFT_DRAG_SURFACE_CLASS} data-titlebar-left-drag-surface>
      <div class="fixed-controls">
        <span class="preview-logo" data-preview-logo>
          <IntentNavigationIcon name="dandelion" size={16} />
        </span>
      </div>
      <div class="workspace-controls" data-titlebar-workspace-controls>
        <WorkspaceTabStrip
          activeWorkspaceId={interactive ? undefined : activeWorkspaceId}
          {leadingInsetPx}
          {scrollerMarginLeftPx}
          horizontalPositionTrackingKey={leadingInsetPx + scrollerMarginLeftPx}
          onActiveTabBoundsChange={(bounds) => (activeTabBounds = bounds)}
          onActiveTabTrackingChange={(tracking) => (activeTabTracking = tracking)}
        />
        <div
          class="preview-launcher"
          data-preview-launcher
          aria-hidden="true"
          style:translate="var(--workspace-tab-launcher-offset, 0px) 0"
        >
          +
        </div>
      </div>
      <div class="drag-handle"></div>
    </div>
    {#if activeTabBounds}
      <div
        class="active-tab-mask"
        style:left={`${activeTabBounds.left}px`}
        style:width={`${activeTabBounds.width}px`}
        style:mask-image={getWorkspaceTabBorderMaskImage(activeTabBounds)}
        style:transition={activeTabTracking
          ? 'none'
          : `left ${WORKSPACE_TAB_MOTION_DURATION_MS}ms ${WORKSPACE_TAB_MOTION_EASING}, width ${WORKSPACE_TAB_MOTION_DURATION_MS}ms ${WORKSPACE_TAB_MOTION_EASING}`}
        data-active-tab-border-mask
      ></div>
    {/if}
    <div></div>
  </div>
  <div class="preview-panel" data-preview-panel></div>
</div>

{#if interactive}
  <div class="preview-controls">
    <!-- i18n-ignore (component preview control) -->
    <Button type="button" onclick={() => store.dispatch(openWorkspaceTab(ids[2]))} data-open-tab>
      Open tab
    </Button>
    <!-- i18n-ignore (component preview control) -->
    <Button type="button" onclick={() => store.dispatch(closeWorkspaceTab(ids[2]))} data-close-tab>
      Close tab
    </Button>
  </div>
{/if}

<style>
  .window-title-bar-wrapper {
    position: relative;
    z-index: 50;
    width: 360px;
  }

  .window-title-bar {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    position: relative;
    width: 100%;
    padding-top: 2px;
  }

  .active-tab-mask {
    position: absolute;
    bottom: -1px;
    height: 1px;
    background: hsl(var(--sidebar));
    pointer-events: none;
  }

  .preview-panel {
    position: absolute;
    z-index: -1;
    top: 100%;
    left: 0;
    box-sizing: border-box;
    width: 100%;
    height: 16px;
    border-top: 1px solid hsl(var(--border));
    background: hsl(var(--sidebar));
  }

  .preview-controls {
    display: flex;
    gap: 8px;
    padding: 12px;
  }

  .titlebar-left-drag-surface {
    display: flex;
    min-width: 0;
    align-self: stretch;
    align-items: center;
    gap: 4px;
  }

  .fixed-controls {
    display: grid;
    width: 32px;
    height: 32px;
    flex: none;
    place-items: center;
  }

  .preview-logo {
    display: grid;
    width: 20px;
    height: 20px;
    place-items: center;
  }

  .workspace-controls {
    display: flex;
    min-width: 0;
    align-self: flex-end;
    align-items: center;
    gap: 4px;
  }

  .preview-launcher {
    display: grid;
    width: 32px;
    height: 32px;
    flex: none;
    place-items: center;
  }

  .drag-handle {
    min-width: 48px;
    flex: 1;
  }
</style>
