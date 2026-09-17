<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { Tooltip } from 'bits-ui';
  import RetainedWorkspaceSurfaces from '../../../src/routes/(app)/workspace/[id]/RetainedWorkspaceSurfaces.svelte';
  import Panel from '$lib/components/layout/panel-system/Panel.svelte';
  import OffscreenWebviewHost from '$lib/components/browser/OffscreenWebviewHost.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { selectPanelLayoutWorkspaces } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    initializeLayout,
    setActiveTab,
    closeTab,
    clearPanelLayout,
    destroyOwnedTabsForWorkspace,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(dispose);
  const ownerAgentId =
    new URLSearchParams(location.search).get('owned') === 'true' ? 'fixture-agent' : undefined;
  const workspaceIds = ['A', 'B'];
  let activeWorkspaceId = $state('A');
  let openWorkspaceIds = $state(workspaceIds);
  let workspaceEntityIds = $state(workspaceIds);
  for (const id of workspaceIds) {
    store.dispatch(
      initializeLayout(id, {
        root: { type: 'panel', panelId: id },
        focusedPanelId: id,
        panels: {
          [id]: {
            id,
            activeTabId: `${id}-1`,
            tabs: [1, 2].map((n) => ({
              id: `${id}-${n}`,
              title: `${id}-${n}`,
              type: 'browser' as const,
              closable: true,
              browserUrl: `${new URLSearchParams(location.search).get('guest')}/lifetime-qa?tab=${id}-${n}`,
              ownerAgentId,
            })),
          },
        },
      }),
    );
  }
  const layouts = selectPanelLayoutWorkspaces();
  Object.assign(window, {
    lifetimeFixture: {
      async switchWorkspace(id: string) {
        activeWorkspaceId = id;
        await tick();
      },
      async switchPanelTab(id: string) {
        store.dispatch(setActiveTab('A', id, 'A'));
        await tick();
      },
      async close(id: string, destroy = false) {
        store.dispatch(closeTab(id[0], id, id[0], undefined, { destroy }));
        await tick();
      },
      async archive(id: string) {
        store.dispatch(destroyOwnedTabsForWorkspace(id));
        store.dispatch(clearPanelLayout(id));
        openWorkspaceIds = openWorkspaceIds.filter((entry) => entry !== id);
        workspaceEntityIds = workspaceEntityIds.filter((entry) => entry !== id);
        if (activeWorkspaceId === id) activeWorkspaceId = id === 'A' ? 'B' : 'A';
        await tick();
      },
      records() {
        return Object.fromEntries(
          Object.entries(store.state.panelLayout.byWorkspaceId).map(([id, layout]) => [
            id,
            {
              activeTab: layout.panels[id]?.activeTabId,
              visible: Object.values(layout.panels).flatMap((panel) =>
                panel.tabs.map((tab) => tab.id),
              ),
              hidden: layout.hiddenTabs.ids,
            },
          ]),
        );
      },
    },
  });
</script>

<Tooltip.Provider>
  <RetainedWorkspaceSurfaces {activeWorkspaceId} {openWorkspaceIds} {workspaceEntityIds}>
    {#snippet children(workspaceId, active)}
      {#if $layouts[workspaceId]?.panels[workspaceId]}
        <Panel
          panel={$layouts[workspaceId].panels[workspaceId]}
          {workspaceId}
          layoutId={workspaceId}
          {active}
        />
      {/if}
    {/snippet}
  </RetainedWorkspaceSurfaces>
  <!-- Mirrors the routed-workspace exclusion in the production app layout. -->
  <OffscreenWebviewHost excludedWorkspaceIds={new Set([activeWorkspaceId])} />
</Tooltip.Provider>

<style>
  :global(html),
  :global(body),
  :global(#fixture) {
    height: 100%;
    margin: 0;
  }
</style>
