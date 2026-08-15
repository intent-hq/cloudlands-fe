<script lang="ts">
  import { onDestroy } from 'svelte';
  import PanelLayout from '$lib/components/layout/panel-system/PanelLayout.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    initializeLayout,
    openTabInNewRootColumn,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  let { workspaceId, openAgent = false }: { workspaceId: string; openAgent?: boolean } = $props();
  // svelte-ignore state_referenced_locally - the fixture applies its initial props once
  const initialWorkspaceId = workspaceId;
  // svelte-ignore state_referenced_locally - the fixture applies its initial props once
  const initiallyOpenAgent = openAgent;
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });

  if (initiallyOpenAgent) {
    store.dispatch(
      openTabInNewRootColumn(
        initialWorkspaceId,
        {
          type: 'agent',
          title: 'Ada',
          agentId: 'agent-1',
          workspaceId: initialWorkspaceId,
          closable: true,
        },
        { adaptiveFirstChat: true, availableCanvasWidth: 1400, force: true },
        10,
      ),
    );
  } else {
    store.dispatch(
      initializeLayout(initialWorkspaceId, {
        root: { type: 'panel', panelId: 'missing-panel' },
        panels: {},
        focusedPanelId: 'missing-panel',
      }),
    );
    store.dispatch(setRestoreStatus(initialWorkspaceId, 'restored'));
  }

  onDestroy(disposeStore);
</script>

<div class="h-[600px] w-[1400px]" data-panel-background-host>
  <PanelLayout workspaceId={initialWorkspaceId} layoutId={initialWorkspaceId} contained />
</div>
