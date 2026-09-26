<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { Tooltip } from 'bits-ui';
  import RetainedWorkspaceSurfaces from '../../../src/routes/(app)/workspace/[id]/RetainedWorkspaceSurfaces.svelte';
  import Panel from '$lib/components/layout/panel-system/Panel.svelte';
  import OffscreenWebviewHost from '$lib/components/browser/OffscreenWebviewHost.svelte';
  import { errorHandler } from '$lib/utils/error-handler.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { browserIpcSaga } from '$store/renderer/slices/app-layout/sagas/browser-ipc-saga';
  import { ownClientIdReceived } from '$store/renderer/slices/browser-clients/browser-clients-slice';
  import { selectPanelLayoutWorkspaces } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    initializeLayout,
    setActiveTab,
    closeTab,
    clearPanelLayout,
    destroyOwnedTabsForWorkspace,
    updateTabBrowserUrl,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  const dispose = startRootStoreLifecycle(store, {
    startSagas: () => [store.runSaga(browserIpcSaga)],
  });
  onDestroy(dispose);
  const ownerAgentId =
    new URLSearchParams(location.search).get('owned') === 'true' ? 'fixture-agent' : undefined;
  const blankTab = new URLSearchParams(location.search).get('blankTab');
  store.dispatch(ownClientIdReceived('fixture-client'));
  const workspaceIds = ['A', 'B'];
  let activeWorkspaceId = $state('A');
  let openWorkspaceIds = $state(workspaceIds);
  let workspaceEntityIds = $state(workspaceIds);
  let maxWebviews = $state<number | undefined>(undefined);
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
              browserUrl:
                blankTab === `${id}-${n}`
                  ? 'about:blank'
                  : `${new URLSearchParams(location.search).get('guest')}/lifetime-qa?tab=${id}-${n}`,
              ownerAgentId,
              hostClientId: 'fixture-client',
            })),
          },
        },
      }),
    );
  }
  if (blankTab && new URLSearchParams(location.search).get('hiddenBlank') === 'true') {
    store.dispatch(closeTab(blankTab[0], blankTab, blankTab[0]));
  }
  const layouts = selectPanelLayoutWorkspaces();
  const observedLoads: string[] = [];
  Object.assign(window, {
    lifetimeFixture: {
      errors: () => errorHandler.errors,
      flush: () => tick(),
      loads: () => [...observedLoads],
      async setUrl(tabId: string, url: string) {
        store.dispatch(updateTabBrowserUrl(tabId[0], tabId, url));
        await tick();
      },
      monitorLoads(tabId: string) {
        const webview = document.querySelector(`[data-offscreen-webview-tab="${tabId}"]`) as
          (HTMLElement & { loadURL(url: string): Promise<void> }) | null;
        if (!webview) throw new Error(`Missing offscreen guest ${tabId}`);
        const load = webview.loadURL.bind(webview);
        webview.loadURL = (url) => {
          observedLoads.push(url);
          return load(url);
        };
      },
      urls() {
        return Object.fromEntries(
          Object.values(store.state.panelLayout.byWorkspaceId).flatMap((layout) =>
            [
              ...Object.values(layout.panels).flatMap((panel) => panel.tabs),
              ...layout.hiddenTabs.ids.map((id) => layout.hiddenTabs.map[id]),
            ].map((tab) => [tab.id, tab.browserUrl]),
          ),
        );
      },
      async switchWorkspace(id: string) {
        activeWorkspaceId = id;
        await tick();
        await window.electronAPI?.invoke('fixture:active-workspace', id);
      },
      async setOffscreenLimit(limit: number) {
        maxWebviews = limit;
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
        return {
          activeWorkspaceId,
          ...Object.fromEntries(
            Object.entries(store.state.panelLayout.byWorkspaceId).map(([id, layout]) => [
              id,
              {
                activeTab: layout.panels[id]?.activeTabId,
                focusedPanel: layout.focusedPanelId,
                owners: Object.fromEntries(
                  [
                    ...Object.values(layout.panels).flatMap((panel) => panel.tabs),
                    ...layout.hiddenTabs.ids.map((id) => layout.hiddenTabs.map[id]),
                  ].map((tab) => [tab.id, tab.ownerAgentId]),
                ),
                hosts: Object.fromEntries(
                  [
                    ...Object.values(layout.panels).flatMap((panel) => panel.tabs),
                    ...layout.hiddenTabs.ids.map((id) => layout.hiddenTabs.map[id]),
                  ].map((tab) => [tab.id, tab.hostClientId]),
                ),
                visible: Object.values(layout.panels).flatMap((panel) =>
                  panel.tabs.map((tab) => tab.id),
                ),
                hidden: layout.hiddenTabs.ids,
              },
            ]),
          ),
        };
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
  <OffscreenWebviewHost excludedWorkspaceIds={new Set([activeWorkspaceId])} {maxWebviews} />
</Tooltip.Provider>

<style>
  :global(html),
  :global(body),
  :global(#fixture) {
    height: 100%;
    margin: 0;
  }
</style>
