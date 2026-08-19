<script lang="ts">
  import { onDestroy } from 'svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    clearPanelLayout,
    initializeLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { selectPanelColumnCount } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import type { PanelColumnCount } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import WorkspaceProgressCard from '../../sidebar/WorkspaceProgressCard.svelte';

  let {
    theme = 'light',
    width = 320,
    zoom = 1,
    initialCount = 2,
  }: {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    initialCount?: PanelColumnCount;
  } = $props();

  const workspaceId = WorkspaceId('sidebar-header-columns-workspace');
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const count$ = selectPanelColumnCount(workspaceId);
  const workspace = {
    id: workspaceId,
    title: 'Column control workspace',
    branch: 'feat/columns',
    repositoryOwner: 'intent-hq',
    repositoryName: 'cloudlands-fe',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  } as Workspace;

  $effect(() => {
    store.dispatch(setWorkspaceEntity(workspace));
    store.dispatch(clearPanelLayout(workspaceId));
    store.dispatch(
      initializeLayout(workspaceId, {
        root: { type: 'panel', panelId: 'panel-1' },
        panels: { 'panel-1': { id: 'panel-1', tabs: [], activeTabId: null } },
        focusedPanelId: 'panel-1',
        columnCount: initialCount,
      }),
    );
  });

  $effect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  });

  onDestroy(() => {
    document.documentElement.classList.remove('dark');
    store.dispatch(clearPanelLayout(workspaceId));
    disposeStore();
  });
</script>

<section
  class="overflow-hidden bg-sidebar p-3 text-foreground"
  style:width={`${width}px`}
  style:zoom
  data-current-count={$count$}
  data-testid="workspace-sidebar-header-columns-host"
>
  <WorkspaceProgressCard {workspaceId} />
</section>
