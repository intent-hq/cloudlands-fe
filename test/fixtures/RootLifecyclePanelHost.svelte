<script lang="ts">
  import { onDestroy } from 'svelte';
  import PanelLayout from '$lib/components/layout/panel-system/PanelLayout.svelte';
  import {
    startRootStoreLifecycle,
    type RootStoreHmrData,
  } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    initializeLayout,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import type { WorkspacePanelLayout } from '$store/renderer/slices/panel-layout/panel-layout-types';

  let {
    workspaceId,
    layout,
    hmrData,
    startSagas,
    beforeLayoutMount,
  }: {
    workspaceId: string;
    layout: WorkspacePanelLayout;
    hmrData: RootStoreHmrData;
    startSagas: () => Array<() => void>;
    beforeLayoutMount?: () => void;
  } = $props();

  const disposeStore = startRootStoreLifecycle(store, { startSagas }, hmrData);
  store.dispatch(initializeLayout(workspaceId, layout));
  store.dispatch(setRestoreStatus(workspaceId, 'restored'));
  beforeLayoutMount?.();
  onDestroy(disposeStore);
</script>

<PanelLayout {workspaceId} layoutId={workspaceId} contained canvasSizing="content" />
