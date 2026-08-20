<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import PanelLayout from '../../PanelLayout.svelte';
  import PanelNavigator from '../../PanelNavigator.svelte';
  import { KeyboardShortcutManager } from '$lib/utils/keyboardShortcuts';
  import { registerWorkspaceTabShortcuts } from '$features/workspace/utils/workspace-tab-navigation';
  import { store as appStore } from '$store/renderer/store';
  import {
    clearPanelLayout,
    focusPanel,
    initializeLayout,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    selectFocusedPanelId,
    selectPanelCanvasWidth,
    selectPanelColumnCount,
    selectPanelIds,
    selectPanelLayoutRoot,
    selectPanelNavigatorItems,
    selectPanels,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { loadWorkspaceTabsState } from '$store/renderer/slices/tab-state/tab-state-slice';
  import {
    selectCurrentWorkspaceTabId,
    selectWorkspaceTabOrder,
  } from '$store/renderer/slices/tab-state/tab-state-selectors';

  let { zoomFactor = 1, panelCount = 3 }: { zoomFactor?: number; panelCount?: 1 | 3 } = $props();
  // svelte-ignore state_referenced_locally - component-test props are fixed for each mount
  const initialZoomFactor = $state.snapshot(zoomFactor);
  // svelte-ignore state_referenced_locally - component-test props are fixed for each mount
  const initialPanelCount = $state.snapshot(panelCount);
  const workspaceId = `mod-w-browser-${initialZoomFactor}-${initialPanelCount}`;
  const panelIds = Array.from({ length: initialPanelCount }, (_, index) => `p${index + 1}`);
  const focusedPanelId = panelIds[Math.floor(panelIds.length / 2)];
  const initialSizes = initialPanelCount === 3 ? [20, 50, 30] : [100];
  const disposeStore = appStore.init();
  let viewport: HTMLElement | null = $state(null);
  let panelRoot: HTMLElement | null = $state(null);
  let navigationCount = $state(0);

  appStore.dispatch(
    loadWorkspaceTabsState({
      openTabs: ['other-workspace', workspaceId],
      currentTabId: workspaceId,
      pinnedTabs: [],
      unsavedTabs: [],
      optimisticTabs: [],
      tabOrder: ['other-workspace', workspaceId],
      workspaceStacks: [['other-workspace'], [workspaceId]],
      viewMode: 'columns',
    }),
  );
  appStore.dispatch(
    initializeLayout(workspaceId, {
      root:
        initialPanelCount === 1
          ? { type: 'panel', panelId: panelIds[0] }
          : {
              type: 'split',
              direction: 'horizontal',
              sizes: initialSizes,
              children: panelIds.map((panelId) => ({ type: 'panel' as const, panelId })),
            },
      panels: Object.fromEntries(
        panelIds.map((panelId) => [
          panelId,
          {
            id: panelId,
            tabs: [
              {
                id: `${panelId}-tab`,
                type: 'note' as const,
                title: `Note ${panelId}`,
                noteId: `${panelId}-note`,
                workspaceId,
                closable: true,
              },
            ],
            activeTabId: `${panelId}-tab`,
          },
        ]),
      ),
      focusedPanelId,
      columnCount: initialPanelCount,
      canvasWidth: 960,
    }),
  );
  appStore.dispatch(setRestoreStatus(workspaceId, 'restored'));

  const root$ = selectPanelLayoutRoot(workspaceId);
  const panels$ = selectPanels(workspaceId);
  const ids$ = selectPanelIds(workspaceId);
  const count$ = selectPanelColumnCount(workspaceId);
  const focused$ = selectFocusedPanelId(workspaceId);
  const canvasWidth$ = selectPanelCanvasWidth(workspaceId);
  const navigatorItems$ = selectPanelNavigatorItems(workspaceId);
  const tabOrder$ = selectWorkspaceTabOrder();
  const currentTab$ = selectCurrentWorkspaceTabId();
  const shortcutManager = new KeyboardShortcutManager();

  onMount(() => {
    registerWorkspaceTabShortcuts({
      isMac: false,
      register: (shortcut) => shortcutManager.register(shortcut),
      store: appStore,
      getCurrentPath: () => '/',
      navigate: () => (navigationCount += 1),
      openNewWorkspace: () => undefined,
      toggleWorkspaceViewMode: () => undefined,
    });
    shortcutManager.attach();
  });

  onDestroy(() => {
    shortcutManager.destroy();
    appStore.dispatch(clearPanelLayout(workspaceId));
    disposeStore();
  });
</script>

<output
  data-testid="mod-w-state"
  data-panel-ids={$ids$.join(',')}
  data-empty-panel-ids={Object.values($panels$)
    .filter((panel) => panel.tabs.length === 0)
    .map((panel) => panel.id)
    .join(',')}
  data-column-count={$count$}
  data-focused-panel={$focused$ ?? ''}
  data-root-sizes={$root$.type === 'split' ? $root$.sizes.join(',') : '100'}
  data-canvas-width={$canvasWidth$ ?? ''}
  data-tab-order={$tabOrder$.join(',')}
  data-current-tab={$currentTab$ ?? ''}
  data-navigation-count={navigationCount}
></output>
<div class="relative h-96 w-[960px]" style:zoom={initialZoomFactor}>
  <div bind:this={viewport} class="h-full overflow-x-auto" data-testid="mod-w-viewport">
    <div bind:this={panelRoot} class="h-full min-w-0">
      <PanelLayout {workspaceId} layoutId={workspaceId} canvasSizing="viewport" />
    </div>
  </div>
  {#if $navigatorItems$.length >= 2}
    <PanelNavigator
      panels={$navigatorItems$}
      {viewport}
      {panelRoot}
      ariaLabel="Panel layout"
      activePanelId={$focused$}
      onActivate={(panelId) => appStore.dispatch(focusPanel(workspaceId, panelId))}
    />
  {/if}
</div>
