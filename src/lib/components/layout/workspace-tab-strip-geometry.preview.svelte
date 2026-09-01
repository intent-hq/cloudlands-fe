<script lang="ts">
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { store } from '$store/renderer/configured-store';
  import { loadWorkspaceTabsState } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import WorkspaceTabStrip from './WorkspaceTabStrip.svelte';

  const ids = ['geometry-alpha', 'geometry-beta', 'geometry-gamma'];
  const timestamp = '2026-09-01T12:00:00.000Z';

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

<div class="window-title-bar-wrapper" data-titlebar-geometry-root>
  <div class="window-title-bar">
    <div class="titlebar-left-drag-surface" data-titlebar-left-drag-surface>
      <div class="fixed-controls"></div>
      <div class="workspace-controls" data-titlebar-workspace-controls>
        <WorkspaceTabStrip activeWorkspaceId={ids[0]} />
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
    height: 36px;
    overflow: visible;
  }

  .window-title-bar {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    position: relative;
    width: 100%;
    height: 36px;
    padding-top: 2px;
  }

  .titlebar-left-drag-surface {
    display: flex;
    min-width: 0;
    align-self: stretch;
    align-items: center;
    gap: 4px;
    overflow: visible;
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
