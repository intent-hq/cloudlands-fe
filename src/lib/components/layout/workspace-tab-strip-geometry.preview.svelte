<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export interface WorkspaceTabStripGeometryPreviewProps {
    activeWorkspaceId?: string;
  }

  const ids = ['geometry-alpha', 'geometry-beta', 'geometry-gamma'];

  export const preview = definePreview<WorkspaceTabStripGeometryPreviewProps>({
    id: 'workspace-tab-strip-geometry',
    title: 'Workspace tab-strip geometry',
    defaultState: 'first-tab',
    states: {
      'first-tab': { props: { activeWorkspaceId: ids[0] } },
      'middle-tab': { props: { activeWorkspaceId: ids[1] } },
    },
  });
</script>

<script lang="ts">
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { store } from '$store/renderer/configured-store';
  import { loadWorkspaceTabsState } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { TITLEBAR_LEFT_DRAG_SURFACE_CLASS, WINDOW_TITLEBAR_HEIGHT_PX } from './titlebar-geometry';
  import WorkspaceTabStrip from './WorkspaceTabStrip.svelte';

  const timestamp = '2026-09-01T12:00:00.000Z';
  let { activeWorkspaceId = ids[0] }: WorkspaceTabStripGeometryPreviewProps = $props();

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
  store.dispatch(
    loadWorkspaceTabsState({
      openTabs: ids,
      currentTabId: ids[0],
      pinnedTabs: [],
      unsavedTabs: [],
      optimisticTabs: [],
      tabOrder: ids,
    }),
  );
</script>

<div
  class="window-title-bar-wrapper"
  style:height="{WINDOW_TITLEBAR_HEIGHT_PX}px"
  data-titlebar-geometry-root
>
  <div class="window-title-bar" style:height="{WINDOW_TITLEBAR_HEIGHT_PX}px">
    <div class={TITLEBAR_LEFT_DRAG_SURFACE_CLASS} data-titlebar-left-drag-surface>
      <div class="fixed-controls"></div>
      <div class="workspace-controls" data-titlebar-workspace-controls>
        <WorkspaceTabStrip {activeWorkspaceId} />
      </div>
      <div class="drag-handle"></div>
    </div>
    <div></div>
  </div>
</div>

<style>
  .window-title-bar-wrapper {
    position: relative;
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

  .titlebar-left-drag-surface {
    display: flex;
    min-width: 0;
    align-self: stretch;
    align-items: center;
    gap: 4px;
  }

  .fixed-controls {
    width: 8px;
    flex: none;
  }

  .workspace-controls {
    display: flex;
    min-width: 0;
    align-self: flex-end;
    align-items: center;
    gap: 4px;
  }

  .drag-handle {
    min-width: 48px;
    flex: 1;
  }
</style>
